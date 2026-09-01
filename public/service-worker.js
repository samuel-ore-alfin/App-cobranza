/* bot_cobranza_v2 — service worker minimo.
   Cachea SOLO el cascaron estatico para que la app abra offline.
   NUNCA cachea /api/* : las respuestas con datos de cliente jamas se guardan.
*/
var CACHE = 'cobranza-shell-v1';
var SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);

  // Todo lo que sea API o no-GET va directo a la red, sin tocar cache.
  if (e.request.method !== 'GET' || url.pathname.indexOf('/api/') === 0) {
    return; // deja pasar a la red normal
  }

  // Cascaron: cache-first con actualizacion en segundo plano.
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      var red = fetch(e.request).then(function (res) {
        if (res && res.status === 200 && url.origin === self.location.origin) {
          var copia = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copia); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || red;
    })
  );
});
