const CACHE_NAME = 'eletroagro-shell-v5';
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/logo-eletroagro.jpeg'];

self.addEventListener('install', (event) => {
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    const response=await fetch('/offline-assets.json',{cache:'no-store'});
    if(!response.ok)throw new Error('Não foi possível preparar os recursos offline.');
    const assets=await response.json();
    if(!Array.isArray(assets)||!assets.length)throw new Error('Lista de recursos offline inválida.');
    await cache.addAll([...SHELL,...assets]);
    await cache.put('/offline-assets.json',new Response(JSON.stringify(assets),{headers:{'Content-Type':'application/json'}}));
    await self.skipWaiting();
  })());
});

self.addEventListener('message',(event)=>{
  if(event.data?.type!=='VERIFY_OFFLINE_SHELL'||!event.ports[0])return;
  event.waitUntil((async()=>{
    try{
      const cache=await caches.open(CACHE_NAME),manifest=await cache.match('/offline-assets.json');
      const assets=manifest?await manifest.json():[];
      const paths=[...SHELL,...assets,...(event.data.entry?[event.data.entry]:[])];
      const ready=assets.length>0&&(await Promise.all(paths.map(path=>cache.match(path)))).every(Boolean);
      event.ports[0].postMessage({ready,cache:CACHE_NAME});
    }catch{event.ports[0].postMessage({ready:false});}
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('eletroagro-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/neon-auth/')) return;
  event.respondWith(fetch(request).then((response) => {
    if(response.status>=500)throw new Error('Servidor indisponível');
    if (response.ok) {const copy=response.clone();event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request,copy)));}
    return response;
  }).catch(async () => (await caches.match(request)) || (request.mode === 'navigate' ? caches.match('/') : Response.error())));
});
