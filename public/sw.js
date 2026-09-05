// Incremented version to clear old cached assets
const CACHE_NAME = 'shelfscan-v2.1';

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/android-icon-192x192.png',
  '/apple-icon-180x180.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting(); // Force activate new service worker immediately
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim(); // Take control of all open pages right away
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Always bypass cache for APIs
  if (url.includes('googleapis.com') || url.includes('openlibrary.org')) {
    return;
  }

  // Network-first strategy for navigation/HTML to prevent stale page locks
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
