const CACHE_NAME = 'sing-it-again-v11-performance-feedback';
const APP_SHELL = [
  './',
  './index.html',
  './firebase-config.js',
  './src/cloud.js?v=syncfix1',
  './src/performance-feedback.js?v=1',
  './src/singo.js',
  './src/backstage-history.js',
  './src/state-data.js',
  './src/singo-store.js',
  './src/singo-engine.js',
  './src/singo-pool.js',
  './src/singo.css',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './Limelight.woff2',
  './Archivo.woff2'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
  ));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const firebaseSdk = url.origin === 'https://www.gstatic.com' &&
    url.pathname.startsWith('/firebasejs/12.19.0/');
  if (url.origin !== self.location.origin && !firebaseSdk) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const copy=response.clone();
          caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy));
        }
        return response;
      })
      .catch(()=>caches.match(event.request).then(cached =>
        cached || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
