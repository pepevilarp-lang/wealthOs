/* Orbit service worker
   - HTML: network-first  → la app SIEMPRE carga la última versión desplegada
                            (cae a caché solo si no hay red). Esto evita que la
                            versión vieja (sin splash / con WealthOS) se quede pegada.
   - Estáticos: cache-first (rápidos, offline).
   Sube CACHE_VERSION en cada deploy importante para limpiar lo viejo. */
const CACHE_VERSION = 'orbit-v19';
const STATIC = ['./manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting(); // activa el SW nuevo sin esperar a que cierren pestañas
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(STATIC).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // No tocar API ni dominios de terceros (Supabase, Finnhub, fuentes…)
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  const isHTML =
    req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    // network-first
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // estáticos: cache-first con relleno en background
  e.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          return res;
        })
    )
  );
});

// ═══ Push diario ═══
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Orbit', body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'Orbit';
  const opts = {
    body: d.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: d.tag || 'orbit-daily',
    renotify: true,
    data: { url: d.url || './' },
    vibrate: [80, 40, 80]
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) { c.focus(); if ('navigate' in c) { try { c.navigate(url); } catch (_) {} } return; } }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
