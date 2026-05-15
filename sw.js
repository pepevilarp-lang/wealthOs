// WealthOS Service Worker
const CACHE_NAME = 'wealthos-v6';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Install: cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for static
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;
  
  // API calls: always network
  if (url.pathname.startsWith('/api/')) {
    return;
  }
  
  // TwelveData and external APIs: always network
  if (url.hostname.includes('twelvedata.com') || 
      url.hostname.includes('yahoo.com') ||
      url.hostname.includes('allorigins.win') ||
      url.hostname.includes('anthropic.com')) {
    return;
  }
  
  // Static assets: cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        // Only cache successful responses
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
