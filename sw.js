/* Service worker for AI Fitness Coach.
   Strategy:
   - Precache the app shell (HTML/CSS/JS/icons) for instant, offline loads.
   - Stale-while-revalidate for same-origin app files so updates roll out
     without blocking startup.
   - Network-only for the MediaPipe/TensorFlow CDN (large WASM/model files are
     cached by the browser HTTP cache; we avoid bloating our cache quota).
*/

const VERSION = 'aifit-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/styles.css',
  './assets/js/app.js',
  './assets/js/core/logger.js',
  './assets/js/core/events.js',
  './assets/js/pose/landmarks.js',
  './assets/js/pose/smoothing.js',
  './assets/js/pose/poseEngine.js',
  './assets/js/exercises/registry.js',
  './assets/js/exercises/repCounter.js',
  './assets/js/exercises/recognizer.js',
  './assets/js/coach/coach.js',
  './assets/js/game/gamification.js',
  './assets/js/data/store.js',
  './assets/js/workout/session.js',
  './assets/js/workout/modes.js',
  './assets/js/ui/overlay.js',
  './assets/js/ui/views.js',
  './assets/js/ui/charts.js',
  './assets/js/ui/celebrate.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Don't intercept cross-origin (CDN, telemetry). Let the browser handle it.
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(e.request);
      const network = fetch(e.request)
        .then((res) => { if (res && res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    })
  );
});
