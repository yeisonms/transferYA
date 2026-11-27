// TransferYA Service Worker
const CACHE_NAME = 'transferya-cache-v59';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/landing.html',
  '/sticker.html',
  '/calculadora.html',
  '/go.html',
  '/admin.html',
  '/terminos.html',
  '/privacidad.html',
  '/css/app.css',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/favicon-96x96.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/logo-sound-check.svg',
  '/icons/logo-transferya-horizontal.svg',
  '/icons/logo-wordmark.png',
  '/icons/brand-nequi-icon.png',
  '/icons/brand-daviplata-horizontal.png',
  '/icons/brand-breb-icon.png',
  '/icons/brand-bancolombia-icon.png',
  '/icons/bank-nequi.svg',
  '/icons/bank-daviplata.svg',
  '/icons/bank-breb.svg',
  '/icons/bank-bancolombia.svg',
  '/images/og-share.jpg',
  '/images/og-square.jpg',
  '/images/sticker-diecut-badge.jpg',
  '/images/qr-nequi-negocios-square.png',
  '/images/qr-nequi-negocios.jpg',
  '/vendor/qrcode-generator.js',
  '/vendor/xlsx.full.min.js',
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        STATIC_ASSETS.map((assetUrl) => {
          const req = assetUrl.startsWith('http')
            ? new Request(assetUrl)
            : new Request(assetUrl, { cache: 'reload' });
          return fetch(req)
            .then((res) => {
              if (res && res.status === 200) return cache.put(assetUrl, res);
            })
            .catch(() => {});
        })
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Nunca cachear llamadas API, Supabase REST o WebSockets
  if (
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('supabase.co') ||
    event.request.url.startsWith('ws')
  ) {
    return;
  }

  // Network-First para documentos HTML y hojas de estilo locales (garantiza que CSS e HTML siempre coincidan)
  const isNavigationOrHtml =
    event.request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    url.pathname.startsWith('/css/');

  if (isNavigationOrHtml) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((m) => m || caches.match('/index.html')))
    );
    return;
  }

  // Cache-First para librerías CDN, fuentes e íconos estáticos
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
      );
    })
  );
});

// ==========================================
// Web Push Notifications (Fase 2)
// Despierta el dispositivo en segundo plano incluso con pantalla apagada
// ==========================================
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: '⚡ ¡Pago Verificado! · TransferYA', body: event.data.text() };
    }
  }

  const title = data.title || '⚡ ¡Pago Verificado! · TransferYA';
  const options = {
    body: data.body || 'Recibiste una nueva transferencia verificada.',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/favicon-96x96.png',
    tag: data.tag || 'transferya-payment',
    renotify: true,
    requireInteraction: true,
    vibrate: [300, 120, 300, 120, 400],
    timestamp: data.timestamp || Date.now(),
    data: {
      url: data.url || '/',
      timestamp: data.timestamp || Date.now(),
    },
    actions: [
      { action: 'open', title: '👁️ Ver en Pantalla Mostrador' }
    ]
  };
  if (data.image) {
    options.image = data.image;
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
        windowClients.forEach((client) => {
          try {
            client.postMessage({ type: 'TRANSFERYA_PUSH_RECEIVED', data });
          } catch { }
        });
      }),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Si la ventana de TransferYA ya está abierta, traerla al frente
      for (const client of windowClients) {
        if ('focus' in client) {
          if (client.url.includes(self.location.origin)) {
            return client.focus();
          }
        }
      }
      // Si está cerrada, abrir una nueva ventana
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
