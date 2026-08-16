/* Added by claude-code on 10thAug2026 at 12:33pm GMT+3. purpose: service worker, network-first
   falling back to cache, caches the app shell for offline use per SPEC.md */

const CACHE_NAME = 'brainwavelab-shell-v1';
const SHELL_FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'synth-processor.js',
  'manifest.webmanifest',
  'icon.svg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_FILES);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key !== CACHE_NAME; })
            .map(function (key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

// Network-first, falling back to cache (avoids stale dev files while still working offline).
self.addEventListener('fetch', function (event) {
  event.respondWith(
    fetch(event.request).then(function (response) {
      // Only cache good responses — a transient dev-server 404/500 must not
      // poison the offline fallback.
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
          return cache.put(event.request, copy);
        }));
      }
      return response;
    }).catch(function () {
      return caches.match(event.request);
    })
  );
});
