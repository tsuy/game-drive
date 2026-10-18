'use strict';

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------

const TILE_CACHE = 'tiles-v1';
const DEFAULT_ROUTE = 'route.gpx';
const AVG_TILE_KB = 20; // grobe Schätzung für Satellitenkacheln (JPEG)
const DOWNLOAD_CONCURRENCY = 6;

const $ = (id) => document.getElementById(id);
const fmtKm = (m) => (m / 1000).toFixed(2) + ' km';
const fmtMB = (b) => (b / 1024 / 1024).toFixed(1) + ' MB';

// Keine {s}-Subdomains: die Kachel-URL ist zugleich der Cache-Schlüssel,
// sie muss beim Download und beim Anzeigen identisch sein.
const LAYERS = {
  esri: {
    name: 'Satellit (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxNativeZoom: 18,
    attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics',
    downloadable: true,
  },
  google: {
    name: 'Satellit (Google)',
    url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    maxNativeZoom: 20,
    attribution: '&copy; Google',
    downloadable: true,
  },
  googleHybrid: {
    name: 'Satellit + Strassen (Google)',
    url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    maxNativeZoom: 20,
    attribution: '&copy; Google',
    downloadable: true,
  },
  osm: {
    // OSM-Tile-Policy verbietet Bulk-Downloads -> nur Online-Anzeige
    name: 'OpenStreetMap (nur online)',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxNativeZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
    downloadable: false,
  },
};

// ---------------------------------------------------------------------------
// Geo-Helfer
// ---------------------------------------------------------------------------

const R_EARTH = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

// Abstand Punkt -> Segment in Metern. Lokale equirektangulare Projektion um p
// ist auf Distanzen von einigen km praktisch exakt und viel billiger als
// sphärische Trigonometrie pro Segment.
function pointSegment(p, a, b) {
  const kx = Math.cos(toRad(p.lat)) * R_EARTH;
  const ky = R_EARTH;
  const ax = toRad(a.lon - p.lon) * kx, ay = toRad(a.lat - p.lat) * ky;
  const bx = toRad(b.lon - p.lon) * kx, by = toRad(b.lat - p.lat) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return { dist: Math.hypot(cx, cy), t };
}

function lon2tile(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function lat2tile(lat, z) {
  const r = toRad(lat);
  return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z);
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const route = {
  name: '',
  pts: [],     // [{lat, lon}]
  cum: [],     // kumulierte Distanz in m bis Punkt i
  length: 0,
  line: null,  // Leaflet-Polyline
};

function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Ungültige GPX-Datei');
  let nodes = doc.getElementsByTagName('trkpt');
  if (!nodes.length) nodes = doc.getElementsByTagName('rtept');
  const pts = Array.from(nodes, (n) => ({
    lat: parseFloat(n.getAttribute('lat')),
    lon: parseFloat(n.getAttribute('lon')),
  })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (pts.length < 2) throw new Error('GPX enthält keine Trackpunkte');
  const nameEl = doc.querySelector('trk > name, rte > name, metadata > name');
  return { name: nameEl ? nameEl.textContent.trim() : 'Route', pts };
}

function setRoute({ name, pts }) {
  route.name = name;
  route.pts = pts;
  route.cum = [0];
  for (let i = 1; i < pts.length; i++) {
    route.cum.push(route.cum[i - 1] + haversine(pts[i - 1], pts[i]));
  }
  route.length = route.cum[route.cum.length - 1];

  if (route.line) route.line.remove();
  const latlngs = pts.map((p) => [p.lat, p.lon]);
  // Doppelte Linie (weisser Rand) ist auf Satellitenbildern besser sichtbar
  route.line = L.layerGroup([
    L.polyline(latlngs, { color: '#fff', weight: 8, opacity: 0.8 }),
    L.polyline(latlngs, { color: '#ff3d00', weight: 4 }),
  ]).addTo(map);
  L.circleMarker(latlngs[0], { radius: 7, color: '#fff', fillColor: '#1f8a3b', fillOpacity: 1 })
    .bindTooltip('Start').addTo(route.line);

  map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
  updateStatusIdle();
  updateEstimate();
}

// Nächster Punkt auf der Route: Abstand + zurückgelegte Distanz entlang der Route.
// Brute force über alle Segmente (~2000) ist pro GPS-Fix unproblematisch.
function nearestOnRoute(p) {
  let best = { dist: Infinity, along: 0 };
  const pts = route.pts;
  for (let i = 0; i < pts.length - 1; i++) {
    const { dist, t } = pointSegment(p, pts[i], pts[i + 1]);
    if (dist < best.dist) {
      best = { dist, along: route.cum[i] + t * (route.cum[i + 1] - route.cum[i]) };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Karte
// ---------------------------------------------------------------------------

const map = L.map('map', { zoomControl: false, maxZoom: 20 });
L.control.zoom({ position: 'topright' }).addTo(map);
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

const baseLayers = {};
for (const [key, cfg] of Object.entries(LAYERS)) {
  baseLayers[cfg.name] = L.tileLayer(cfg.url, {
    maxZoom: 20,
    maxNativeZoom: cfg.maxNativeZoom,
    attribution: cfg.attribution,
    crossOrigin: true, // CORS statt opaker Responses (siehe sw.js)
    key,
  });
}
const savedLayer = localStorage.getItem('layer');
const initialLayer = Object.values(baseLayers).find((l) => l.options.key === savedLayer) ||
  baseLayers[LAYERS.esri.name];
initialLayer.addTo(map);
L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);
map.on('baselayerchange', (e) => {
  localStorage.setItem('layer', e.layer.options.key);
  $('dlLayer').value = e.layer.options.key;
  updateEstimate();
});
map.setView([-22.07, 28.98], 13);

// ---------------------------------------------------------------------------
// UI-Helfer
// ---------------------------------------------------------------------------

function setStatus(cls, main, sub) {
  $('status').className = 'status ' + cls;
  $('statusText').textContent = main;
  $('statusSub').textContent = sub;
}

function updateStatusIdle() {
  setStatus('idle', 'GPS aus', `${route.name} · ${fmtKm(route.length)}`);
}

// ---------------------------------------------------------------------------
// GPS-Tracking & Auf-Strecke-Prüfung
// ---------------------------------------------------------------------------

const tracking = {
  watchId: null,
  simTimer: null,
  follow: true,
  offCount: 0,
  offRoute: false,
  marker: null,
  accCircle: null,
  wakeLock: null,
};

const WEAK_ACCURACY_M = 50;
const OFF_CONFIRM_FIXES = 2; // Hysterese gegen einzelne GPS-Ausreisser

function onPosition(lat, lon, accuracy) {
  const p = { lat, lon };
  const ll = [lat, lon];

  if (!tracking.marker) {
    tracking.accCircle = L.circle(ll, { radius: accuracy, color: '#1a73e8', weight: 1, fillOpacity: 0.12 }).addTo(map);
    tracking.marker = L.marker(ll, {
      icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      zIndexOffset: 1000,
    }).addTo(map);
    map.setView(ll, Math.max(map.getZoom(), 16));
  } else {
    tracking.marker.setLatLng(ll);
    tracking.accCircle.setLatLng(ll).setRadius(accuracy);
    if (tracking.follow) map.panTo(ll);
  }

  const tol = Number($('tolerance').value);
  const { dist, along } = nearestOnRoute(p);
  const progress = `${fmtKm(along)} / ${fmtKm(route.length)} · ±${Math.round(accuracy)} m`;

  if (dist > tol) tracking.offCount++;
  else tracking.offCount = 0;

  const wasOff = tracking.offRoute;
  tracking.offRoute = tracking.offCount >= OFF_CONFIRM_FIXES;

  if (tracking.offRoute) {
    setStatus('off', `Abseits! ${Math.round(dist)} m`, progress);
    if (!wasOff && navigator.vibrate) navigator.vibrate([300, 150, 300]);
  } else if (accuracy > WEAK_ACCURACY_M) {
    setStatus('weak', `GPS ungenau (${Math.round(dist)} m)`, progress);
  } else {
    setStatus('on', `Auf Strecke ✓ ${Math.round(dist)} m`, progress);
  }
}

function onPositionError(err) {
  const msg = {
    1: 'GPS-Zugriff verweigert',
    2: 'Position nicht verfügbar',
    3: 'GPS-Timeout',
  }[err.code] || err.message;
  setStatus('weak', msg, 'Warte auf GPS…');
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) tracking.wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* nicht kritisch */ }
}

function startGps() {
  if (!('geolocation' in navigator)) {
    alert('Geolocation wird nicht unterstützt');
    return;
  }
  stopSimulation();
  tracking.watchId = navigator.geolocation.watchPosition(
    (pos) => onPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
    onPositionError,
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
  );
  requestWakeLock();
  setStatus('weak', 'Suche GPS…', route.name);
  $('btnGps').textContent = 'GPS stoppen';
}

function stopGps() {
  if (tracking.watchId !== null) navigator.geolocation.clearWatch(tracking.watchId);
  tracking.watchId = null;
  tracking.wakeLock?.release();
  tracking.wakeLock = null;
  tracking.offCount = 0;
  tracking.offRoute = false;
  $('btnGps').textContent = 'GPS starten';
  updateStatusIdle();
}

// Wake Lock wird beim Tab-Wechsel automatisch freigegeben -> neu anfordern
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (tracking.watchId !== null || tracking.simTimer)) {
    requestWakeLock();
  }
});

// Simulation zum Testen am Desktop: fährt die Route ab und weicht zwischen
// 30 % und 35 % der Strecke seitlich ab, damit der "Abseits"-Zustand sichtbar wird.
function startSimulation() {
  stopGps();
  let along = 0;
  const step = 25; // m pro Tick
  tracking.simTimer = setInterval(() => {
    along += step;
    if (along > route.length) { stopSimulation(); return; }
    let i = route.cum.findIndex((c) => c >= along);
    i = Math.max(1, i);
    const a = route.pts[i - 1], b = route.pts[i];
    const t = (along - route.cum[i - 1]) / (route.cum[i] - route.cum[i - 1] || 1);
    let lat = a.lat + t * (b.lat - a.lat);
    let lon = a.lon + t * (b.lon - a.lon);
    const frac = along / route.length;
    if (frac > 0.3 && frac < 0.35) lat += 0.0009; // ~100 m nach Norden
    onPosition(lat, lon, 8);
  }, 500);
  $('btnSim').textContent = 'Simulation stoppen';
}

function stopSimulation() {
  clearInterval(tracking.simTimer);
  tracking.simTimer = null;
  $('btnSim').textContent = 'Simulation starten';
}

// ---------------------------------------------------------------------------
// Offline-Download der Kacheln
// ---------------------------------------------------------------------------

// Alle Kacheln in einem Korridor von ±bufferM um die Route. Die Route wird
// verdichtet, sodass zwischen zwei Stützpunkten nie mehr als bufferM/2 liegt,
// sonst könnten auf langen, geraden Segmenten Lücken entstehen.
function corridorTiles(zMin, zMax, bufferM) {
  const samples = [];
  const pts = route.pts;
  const maxGap = Math.max(20, bufferM / 2);
  for (let i = 0; i < pts.length; i++) {
    samples.push(pts[i]);
    if (i === pts.length - 1) break;
    const d = route.cum[i + 1] - route.cum[i];
    const n = Math.floor(d / maxGap);
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      samples.push({
        lat: pts[i].lat + t * (pts[i + 1].lat - pts[i].lat),
        lon: pts[i].lon + t * (pts[i + 1].lon - pts[i].lon),
      });
    }
  }

  const tiles = [];
  for (let z = zMin; z <= zMax; z++) {
    const seen = new Set();
    for (const p of samples) {
      const dLat = (bufferM / R_EARTH) * (180 / Math.PI);
      const dLon = dLat / Math.cos(toRad(p.lat));
      const x0 = lon2tile(p.lon - dLon, z), x1 = lon2tile(p.lon + dLon, z);
      const y0 = lat2tile(p.lat + dLat, z), y1 = lat2tile(p.lat - dLat, z);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const k = x + '/' + y;
          if (!seen.has(k)) { seen.add(k); tiles.push({ z, x, y }); }
        }
      }
    }
  }
  return tiles;
}

function tileUrl(template, { z, x, y }) {
  return template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

function downloadParams() {
  const [zMin, zMax] = $('dlZoom').value.split('-').map(Number);
  return { layer: LAYERS[$('dlLayer').value], zMin, zMax, buffer: Number($('dlBuffer').value) };
}

function updateEstimate() {
  if (!route.pts.length) return;
  const { zMin, zMax, buffer } = downloadParams();
  const n = corridorTiles(zMin, zMax, buffer).length;
  $('dlEstimate').textContent = `${n} Kacheln · ca. ${fmtMB(n * AVG_TILE_KB * 1024)}`;
}

let dlAbort = null;

async function downloadTiles() {
  const { layer, zMin, zMax, buffer } = downloadParams();
  const tiles = corridorTiles(zMin, zMax, buffer);
  const cache = await caches.open(TILE_CACHE);

  // Verhindert, dass der Browser den Speicher bei Platzmangel räumt
  if (navigator.storage?.persist) await navigator.storage.persist();

  dlAbort = new AbortController();
  const signal = dlAbort.signal;
  let done = 0, skipped = 0, failed = 0, bytes = 0, next = 0;

  $('dlProgress').hidden = false;
  $('dlProgress').max = tiles.length;
  $('btnDownload').disabled = true;
  $('btnAbort').hidden = false;

  const report = () => {
    $('dlProgress').value = done;
    $('dlState').textContent =
      `${done}/${tiles.length} · neu ${fmtMB(bytes)} · vorhanden ${skipped} · Fehler ${failed}`;
  };

  // Einfacher Worker-Pool: N parallele Schleifen ziehen aus einer gemeinsamen Queue
  async function worker() {
    while (next < tiles.length && !signal.aborted) {
      const url = tileUrl(layer.url, tiles[next++]);
      try {
        if (await cache.match(url)) {
          skipped++;
        } else {
          const res = await fetch(url, { mode: 'cors', signal });
          if (!res.ok) throw new Error(res.status);
          const blob = await res.clone().blob();
          bytes += blob.size;
          await cache.put(url, res);
        }
      } catch (e) {
        if (signal.aborted) break;
        failed++;
      }
      done++;
      if (done % 10 === 0 || done === tiles.length) report();
    }
  }

  await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker));
  report();
  $('dlState').textContent += signal.aborted ? ' · abgebrochen' : ' · fertig ✓';
  $('btnDownload').disabled = false;
  $('btnAbort').hidden = true;
  dlAbort = null;
  updateStorage();
}

async function updateStorage() {
  let txt = '';
  try {
    const cache = await caches.open(TILE_CACHE);
    const keys = await cache.keys();
    txt = `Offline-Kacheln: ${keys.length}`;
  } catch { /* Cache API nicht verfügbar (z.B. http) */ }
  if (navigator.storage?.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    txt += ` · Speicher ${fmtMB(usage)} von ${fmtMB(quota)}`;
  }
  if (navigator.storage?.persisted) {
    txt += (await navigator.storage.persisted()) ? ' · persistent' : ' · nicht persistent';
  }
  $('storage').textContent = txt;
}

async function clearTiles() {
  if (!confirm('Alle Offline-Karten löschen?')) return;
  await caches.delete(TILE_CACHE);
  updateStorage();
  $('dlState').textContent = 'gelöscht';
}

// ---------------------------------------------------------------------------
// Verdrahtung
// ---------------------------------------------------------------------------

for (const [key, cfg] of Object.entries(LAYERS)) {
  if (!cfg.downloadable) continue;
  $('dlLayer').add(new Option(cfg.name, key));
}
$('dlLayer').value = LAYERS[savedLayer]?.downloadable ? savedLayer : 'esri';

$('btnGps').onclick = () => (tracking.watchId === null ? startGps() : stopGps());
$('btnFollow').onclick = () => {
  tracking.follow = !tracking.follow;
  $('btnFollow').setAttribute('aria-pressed', tracking.follow);
  if (tracking.follow && tracking.marker) map.panTo(tracking.marker.getLatLng());
};
map.on('dragstart', () => {
  tracking.follow = false;
  $('btnFollow').setAttribute('aria-pressed', 'false');
});
$('btnPanel').onclick = () => { $('panel').hidden = false; updateStorage(); };
$('btnClose').onclick = () => { $('panel').hidden = true; };
$('btnDownload').onclick = downloadTiles;
$('btnAbort').onclick = () => dlAbort?.abort();
$('btnClear').onclick = clearTiles;
$('btnSim').onclick = () => {
  $('panel').hidden = true;
  tracking.simTimer ? stopSimulation() : startSimulation();
};
['dlLayer', 'dlZoom', 'dlBuffer'].forEach((id) => $(id).addEventListener('change', updateEstimate));

$('gpxFile').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    setRoute(parseGpx(text));
    localStorage.setItem('customGpx', text); // überlebt Neuladen, auch offline
  } catch (err) {
    alert(err.message);
  }
};

async function loadInitialRoute() {
  const custom = localStorage.getItem('customGpx');
  try {
    if (custom) return setRoute(parseGpx(custom));
    const res = await fetch(DEFAULT_ROUTE);
    setRoute(parseGpx(await res.text()));
  } catch (err) {
    setStatus('off', 'Route konnte nicht geladen werden', err.message);
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW-Registrierung fehlgeschlagen', e));
}

loadInitialRoute();
