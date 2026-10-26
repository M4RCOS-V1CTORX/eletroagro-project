const CACHE_NAME = 'eletroagro-shell-v4';
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/logo-eletroagro.jpeg'];

self.addEventListener('install', (event) => {
  event.waitUntil((async()=>{const cache=await caches.open(CACHE_NAME);await cache.addAll(SHELL);const response=await fetch('/offline-assets.json',{cache:'no-store'});if(response.ok){const assets=await response.json();await cache.addAll(assets);}await self.skipWaiting();})());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('eletroagro-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/neon-auth/')) return;
  event.respondWith(fetch(request).then((response) => {
    if (response.ok) {const copy=response.clone();event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request,copy)));}
    return response;
  }).catch(async () => (await caches.match(request)) || (request.mode === 'navigate' ? caches.match('/') : Response.error())));
});
