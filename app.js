'use strict';

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------

const TILE_CACHE = 'tiles-v1';
const NETWORK_URL = 'data/network.json'; // erzeugt von tools/build_network.py
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

function bearing(a, b) {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
const COMPASS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
const compass = (deg) => COMPASS[Math.round(deg / 45) % 8];

// ---------------------------------------------------------------------------
// Wegnetz (alle Teilstrecken) & POIs
// ---------------------------------------------------------------------------

// Gut sichtbar auf Satellitenbildern, untereinander unterscheidbar
const GROUP_COLORS = ['#ff3d00', '#ffd600', '#00e5ff', '#ff4081', '#76ff03', '#e040fb', '#ffab40', '#40c4ff', '#ffffff'];

const network = {
  tracks: [],   // [{id, group, label, pts:[{lat,lon}], cum:[m], length}]
  groups: {},   // group -> {label, color, layer, visible, length}
  pois: [],     // [{name, lat, lon, ele?, desc?}]
  poiLayer: null,
  length: 0,
};
let layerControl = null;

function prepTrack(t) {
  const pts = t.coords.map(([lat, lon]) => ({ lat, lon }));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  return { id: t.id, group: t.group, label: t.label, pts, cum, length: cum[cum.length - 1] };
}

// Eigene GPX-Datei (Upload) ins gleiche Format wie network.json bringen
function parseGpx(text, fileName) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Ungültige GPX-Datei');
  const coordsOf = (nodes) => Array.from(nodes, (n) => [parseFloat(n.getAttribute('lat')), parseFloat(n.getAttribute('lon'))])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  const segs = [...doc.getElementsByTagName('trkseg'), ...doc.getElementsByTagName('rte')];
  const tracks = segs
    .map((s, i) => ({ id: `${fileName}-${i}`, group: 'eigene', label: 'Eigene GPX', coords: coordsOf(s.querySelectorAll('trkpt, rtept')) }))
    .filter((t) => t.coords.length >= 2);
  const pois = Array.from(doc.getElementsByTagName('wpt'), (w) => ({
    name: w.getElementsByTagName('name')[0]?.textContent.trim() || 'POI',
    lat: parseFloat(w.getAttribute('lat')),
    lon: parseFloat(w.getAttribute('lon')),
  }));
  if (!tracks.length && !pois.length) throw new Error('GPX enthält weder Strecken noch Wegpunkte');
  return { tracks, pois };
}

function setNetwork({ tracks, pois }) {
  // Control zuerst entfernen: sonst feuert das Entfernen der Layer
  // 'overlayremove' und würde alle Gruppen als ausgeblendet speichern.
  layerControl?.remove();
  for (const g of Object.values(network.groups)) g.layer.remove();
  network.poiLayer?.remove();

  network.tracks = tracks.map(prepTrack);
  network.length = network.tracks.reduce((s, t) => s + t.length, 0);
  network.groups = {};
  const hidden = new Set(JSON.parse(localStorage.getItem('hiddenGroups') || '[]'));

  for (const t of network.tracks) {
    let g = network.groups[t.group];
    if (!g) {
      const color = GROUP_COLORS[Object.keys(network.groups).length % GROUP_COLORS.length];
      g = network.groups[t.group] = { label: t.label, color, layer: L.layerGroup(), visible: !hidden.has(t.group), length: 0 };
    }
    g.length += t.length;
    const latlngs = t.pts.map((p) => [p.lat, p.lon]);
    // Dunkler Rand unter der farbigen Linie: auf Satellitenbildern besser sichtbar
    L.polyline(latlngs, { color: '#000', weight: 7, opacity: 0.45, interactive: false }).addTo(g.layer);
    L.polyline(latlngs, { color: g.color, weight: 4 })
      .bindTooltip(`${t.label} · ${fmtKm(t.length)}`, { sticky: true })
      .addTo(g.layer);
  }

  network.pois = pois;
  network.poiLayer = L.layerGroup(pois.map(poiMarker));

  // Ebenen-Menü: Kartentyp + jede Streckengruppe + POIs einzeln schaltbar
  const overlays = {};
  for (const [key, g] of Object.entries(network.groups)) {
    g.layer.options.groupKey = key;
    overlays[`<span class="swatch" style="background:${g.color}"></span>${g.label} <small>${fmtKm(g.length)}</small>`] = g.layer;
    if (g.visible) g.layer.addTo(map);
  }
  overlays['📍 POIs'] = network.poiLayer;
  if (localStorage.getItem('poisHidden') !== '1') network.poiLayer.addTo(map);
  layerControl = L.control.layers(baseLayers, overlays, { position: 'topright' }).addTo(map);

  const all = network.tracks.flatMap((t) => t.pts.map((p) => [p.lat, p.lon]))
    .concat(pois.map((p) => [p.lat, p.lon]));
  if (all.length) map.fitBounds(L.latLngBounds(all), { padding: [30, 30] });
  updateStatusIdle();
  updateEstimate();
}

function poiMarker(poi) {
  const m = L.marker([poi.lat, poi.lon], {
    icon: L.divIcon({ className: 'poi', html: '<div class="poi-pin"></div>', iconSize: [26, 26], iconAnchor: [13, 26], popupAnchor: [0, -24] }),
    title: poi.name,
  });
  // Permanente Beschriftung; per CSS erst ab Zoom 14 sichtbar (siehe zoomend)
  m.bindTooltip(poi.name, { permanent: true, direction: 'right', offset: [10, -14], className: 'poi-label' });
  m.bindPopup(() => {
    const lines = [`<b>${escapeHtml(poi.name)}</b>`];
    if (poi.desc) lines.push(escapeHtml(poi.desc));
    if (poi.ele != null) lines.push(`Höhe ${poi.ele} m`);
    const me = tracking.marker?.getLatLng();
    if (me) {
      const from = { lat: me.lat, lon: me.lng };
      lines.push(`${fmtKm(haversine(from, poi))} Luftlinie · ${compass(bearing(from, poi))}`);
    }
    lines.push(`<span class="mono">${poi.lat.toFixed(5)}, ${poi.lon.toFixed(5)}</span>`);
    return lines.join('<br>');
  });
  return m;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const visibleTracks = () => network.tracks.filter((t) => network.groups[t.group].visible);

// Nächste Stelle im (sichtbaren) Wegnetz. Brute force über ~7000 Segmente
// dauert < 1 ms und ist pro GPS-Fix (1/s) unproblematisch.
function nearestOnNetwork(p) {
  let best = { dist: Infinity, track: null };
  for (const t of visibleTracks()) {
    for (let i = 0; i < t.pts.length - 1; i++) {
      const { dist } = pointSegment(p, t.pts[i], t.pts[i + 1]);
      if (dist < best.dist) best = { dist, track: t };
    }
  }
  return best;
}

function nearestPoi(p) {
  let best = null;
  for (const poi of network.pois) {
    const d = haversine(p, poi);
    if (!best || d < best.dist) best = { poi, dist: d };
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
map.on('baselayerchange', (e) => {
  localStorage.setItem('layer', e.layer.options.key);
  $('dlLayer').value = e.layer.options.key;
  updateEstimate();
});

// Sichtbarkeit der Streckengruppen/POIs merken; ausgeblendete Gruppen zählen
// auch nicht für "auf Strecke" und den Offline-Download.
function onOverlayToggle(e, visible) {
  if (e.layer === network.poiLayer) {
    localStorage.setItem('poisHidden', visible ? '0' : '1');
    return;
  }
  const g = network.groups[e.layer.options.groupKey];
  if (!g) return;
  g.visible = visible;
  const hidden = Object.entries(network.groups).filter(([, x]) => !x.visible).map(([k]) => k);
  localStorage.setItem('hiddenGroups', JSON.stringify(hidden));
  updateStatusIdle();
  updateEstimate();
}
map.on('overlayadd', (e) => onOverlayToggle(e, true));
map.on('overlayremove', (e) => onOverlayToggle(e, false));

// POI-Namen erst ab Zoom 14 einblenden, sonst überlagern sie sich
const updateLabelVisibility = () => map.getContainer().classList.toggle('hide-poi-labels', map.getZoom() < 14);
map.on('zoomend', updateLabelVisibility);
map.setView([-22.1, 29.0], 12);
updateLabelVisibility();

// ---------------------------------------------------------------------------
// UI-Helfer
// ---------------------------------------------------------------------------

function setStatus(cls, main, sub) {
  $('status').className = 'status ' + cls;
  $('statusText').textContent = main;
  $('statusSub').textContent = sub;
}

function updateStatusIdle() {
  if (tracking.watchId !== null || tracking.simTimer) return;
  const vis = visibleTracks();
  const km = vis.reduce((s, t) => s + t.length, 0);
  setStatus('idle', 'GPS aus', `${vis.length} Strecken · ${fmtKm(km)} · ${network.pois.length} POIs`);
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
  const { dist, track } = nearestOnNetwork(p);
  const near = nearestPoi(p);
  const parts = [];
  if (track) parts.push(track.label);
  if (near) parts.push(`${near.poi.name} ${fmtKm(near.dist)} ${compass(bearing(p, near.poi))}`);
  parts.push(`±${Math.round(accuracy)} m`);
  const progress = parts.join(' · ');

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
  setStatus('weak', 'Suche GPS…', '');
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

// Simulation zum Testen am Desktop: fährt die längste sichtbare Teilstrecke ab
// und weicht zwischen 30 % und 35 % seitlich ab, damit "Abseits" sichtbar wird.
function startSimulation() {
  stopGps();
  const sim = visibleTracks().reduce((a, b) => (b.length > (a?.length ?? 0) ? b : a), null);
  if (!sim) return;
  let along = 0;
  const step = 25; // m pro Tick
  tracking.simTimer = setInterval(() => {
    along += step;
    if (along > sim.length) { stopSimulation(); return; }
    const i = Math.max(1, sim.cum.findIndex((c) => c >= along));
    const a = sim.pts[i - 1], b = sim.pts[i];
    const t = (along - sim.cum[i - 1]) / (sim.cum[i] - sim.cum[i - 1] || 1);
    let lat = a.lat + t * (b.lat - a.lat);
    const lon = a.lon + t * (b.lon - a.lon);
    const frac = along / sim.length;
    if (frac > 0.3 && frac < 0.35) lat += 0.0009; // ~100 m nach Norden
    onPosition(lat, lon, 8);
  }, 500);
  $('btnSim').textContent = 'Simulation stoppen';
}

function stopSimulation() {
  clearInterval(tracking.simTimer);
  tracking.simTimer = null;
  $('btnSim').textContent = 'Simulation starten';
  updateStatusIdle();
}

// ---------------------------------------------------------------------------
// Offline-Download der Kacheln
// ---------------------------------------------------------------------------

// Alle Kacheln in einem Korridor von ±bufferM um alle sichtbaren Strecken und
// POIs. Die Strecken werden verdichtet, sodass zwischen zwei Stützpunkten nie
// mehr als bufferM/2 liegt, sonst entstehen auf langen Segmenten Lücken.
// Überlappende Strecken kosten nichts extra: Kacheln werden per Set dedupliziert.
function corridorTiles(zMin, zMax, bufferM) {
  const samples = [...network.pois];
  const maxGap = Math.max(20, bufferM / 2);
  for (const { pts, cum } of visibleTracks()) {
    for (let i = 0; i < pts.length; i++) {
      samples.push(pts[i]);
      if (i === pts.length - 1) break;
      const n = Math.floor((cum[i + 1] - cum[i]) / maxGap);
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        samples.push({
          lat: pts[i].lat + t * (pts[i + 1].lat - pts[i].lat),
          lon: pts[i].lon + t * (pts[i + 1].lon - pts[i].lon),
        });
      }
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
  if (!network.tracks.length && !network.pois.length) return;
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

// Eigene GPX-Datei ersetzt das Standard-Wegnetz (bleibt nach Neuladen erhalten)
$('gpxFile').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    setNetwork(parseGpx(text, file.name));
    localStorage.setItem('customGpx', text);
    localStorage.setItem('customGpxName', file.name);
    $('btnResetNetwork').hidden = false;
  } catch (err) {
    alert(err.message);
  }
};

$('btnResetNetwork').onclick = () => {
  localStorage.removeItem('customGpx');
  localStorage.removeItem('customGpxName');
  $('btnResetNetwork').hidden = true;
  $('gpxFile').value = '';
  loadNetwork();
};

async function loadNetwork() {
  const custom = localStorage.getItem('customGpx');
  $('btnResetNetwork').hidden = !custom;
  try {
    if (custom) return setNetwork(parseGpx(custom, localStorage.getItem('customGpxName') || 'eigene.gpx'));
    const res = await fetch(NETWORK_URL);
    if (!res.ok) throw new Error(`${NETWORK_URL}: HTTP ${res.status}`);
    setNetwork(await res.json());
  } catch (err) {
    setStatus('off', 'Strecken konnten nicht geladen werden', err.message);
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW-Registrierung fehlgeschlagen', e));
}

loadNetwork();
