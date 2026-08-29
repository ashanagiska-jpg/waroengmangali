/* Service Worker — Warung Mang Ali (offline shell + background sync hint) */
const CACHE = 'warung-mangali-v8';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './offline-core.js',
  './styles.css',
  './manifest.webmanifest'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS).catch(function (e) {
        console.warn('[SW] partial cache', e);
      });
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
          return caches.delete(k);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Jangan cache API Google Apps Script / unpkg dinamis agresif
  if (url.hostname.indexOf('script.google.com') !== -1 ||
      url.hostname.indexOf('googleusercontent.com') !== -1 ||
      url.hostname.indexOf('drive.google.com') !== -1) {
    return;
  }

  // Network-first untuk navigasi HTML; cache-first untuk asset lokal
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(req).then(function (res) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (r) {
          return r || caches.match(req);
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (cached) {
      const fetched = fetch(req).then(function (res) {
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return cached;
      });
      return cached || fetched;
    })
  );
});

/* Background Sync — bangunkan client untuk flush antrian */
self.addEventListener('sync', function (event) {
  if (event.tag === 'warung-sync') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
        clients.forEach(function (c) {
          c.postMessage({ type: 'WARUNG_SYNC' });
        });
      })
    );
  }
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
