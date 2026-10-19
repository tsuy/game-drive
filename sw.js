'use strict';

// App-Shell-Version: bei Änderungen an den Dateien unten hochzählen,
// damit Clients die neue Version erhalten.
const SHELL_CACHE = 'shell-v3';
// Muss mit TILE_CACHE in app.js übereinstimmen. Wird bei Shell-Updates NICHT
// gelöscht, damit heruntergeladene Karten erhalten bleiben.
const TILE_CACHE = 'tiles-v1';

const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'data/network.json',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png',
  'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/marker-icon.png',
  'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-shadow.png',
];

const TILE_HOSTS = [
  'server.arcgisonline.com',
  'mt1.google.com',
  'tile.openstreetmap.org',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== TILE_CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (TILE_HOSTS.includes(url.hostname)) {
    event.respondWith(tileStrategy(req));
  } else if (url.origin === self.location.origin) {
    event.respondWith(shellStrategy(req));
  }
});

// Kacheln: Cache first. Kacheln, die man online anschaut, werden zusätzlich
// gespeichert (nur CORS-Responses, opake würden das Quota aufblähen).
async function tileStrategy(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'cors') cache.put(req.url, res.clone());
    return res;
  } catch {
    // Offline und nicht im Cache: leere Antwort statt Netzwerkfehler,
    // Leaflet zeigt dann einfach eine graue Kachel.
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

// App-Shell: Cache first, im Hintergrund aktualisieren (stale-while-revalidate)
async function shellStrategy(req) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await network) || new Response('offline', { status: 503 });
}
