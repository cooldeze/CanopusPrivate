/* Canopus — service worker
   Caches the app shell so pages are installable and work offline.
   Bump CACHE_NAME any time you change the ASSETS list or want to
   force clients to pick up new page content. */
const CACHE_NAME = 'canopus-v1';

const ASSETS = [
  './',
  './index.html',
  './conflicts.html',
  './empires.html',
  './interests.html',
  './library.html',
  './sirius.html',
  './vault.html',
  './manifest.json',
  './tracker.js',
  './favicon.ico',
  './favicon-16.png',
  './favicon-32.png',
  './favicon-48.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './logo-mark.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Only handle same-origin GET requests; let everything else
  // (cross-origin fonts/CDN, POST, etc.) pass straight through.
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached); // offline: fall back to cache
      return cached || network;
    })
  );
});