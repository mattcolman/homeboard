const CACHE = 'homeboard-shell-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('homeboard-shell-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message', event => { if (event.data === 'CLEAR_HOMEBOARD_CACHE') event.waitUntil(caches.delete(CACHE)); });
self.addEventListener('message', event => {
  if (event.data?.type !== 'CACHE_SHELL') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const urls = ['/', ...(Array.isArray(event.data.assets) ? event.data.assets : []).filter(value => {
      try { const url = new URL(value); return url.origin === self.location.origin && url.pathname.startsWith('/assets/') && /\.(js|css|woff2)$/.test(url.pathname); } catch { return false; }
    }).slice(0, 50)];
    for (const url of urls) { try { const response = await fetch(url); if (response.ok && !response.redirected) await cache.put(url, response); } catch {} }
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.includes('signin') || url.pathname.includes('signout') || url.searchParams.has('_rsc')) return;
  const asset = url.pathname.startsWith('/assets/') && /\.(js|css|woff2)$/.test(url.pathname);
  if (!asset && !(request.mode === 'navigate' && url.pathname === '/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.status === 401 || response.status === 403 || response.redirected) { await caches.delete(CACHE); return response; }
      if (response.ok && !response.headers.get('content-type')?.includes('text/x-component')) await cache.put(request, response.clone());
      const keys = await cache.keys(); for (const old of keys.slice(0, Math.max(0, keys.length - 60))) await cache.delete(old);
      return response;
    } catch {
      const saved = await cache.match(request); if (saved) return saved;
      return new Response('Homeboard is offline. Reconnect once to open this board.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
