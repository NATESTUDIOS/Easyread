// EasyRead Service Worker
const APP_VERSION = '2';
const CACHE_NAME = `easyread-v${APP_VERSION}`;
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/blog.html',
  '/profile.html',
  '/article',
  '/api',
  '/?mode=pwa',
  
  // Icons (if you have them)
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-180.png',
  '/icons/icon-152.png',
  '/icons/icon-120.png',
  '/icons/icon-144.png',
];

// ── Install: Cache static assets ──
self.addEventListener('install', (event) => {
  console.log(`[SW] EasyRead v${APP_VERSION} installing...`);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log(`[SW] Caching ${STATIC_ASSETS.length} static assets`);
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] Some assets failed to cache:', err);
      });
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// ── Activate: Clean up old caches ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('easyread-') && name !== CACHE_NAME)
          .map((name) => {
            console.log(`[SW] Deleting old cache: ${name}`);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log(`[SW] EasyRead v${APP_VERSION} activated`);
      return self.clients.claim();
    })
  );
});

// ── Message handler ──
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CACHE_URLS') {
    const urls = event.data.urls || [];
    caches.open(CACHE_NAME).then(cache => {
      urls.forEach(url => {
        cache.add(url).catch(() => {});
      });
    });
  }
  if (event.data?.type === 'GET_VERSION') {
    const client = event.source;
    if (client) {
      client.postMessage({
        type: 'SW_VERSION',
        version: CACHE_NAME,
        appVersion: APP_VERSION
      });
    }
  }
});

// ── Fetch Strategy ──
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Skip non-http(s) requests
  if (!url.protocol.startsWith('http')) return;

  // Skip analytics
  if (url.pathname.includes('/analytics') || 
      url.pathname.includes('/gtag') || 
      url.pathname.includes('/collect')) {
    return;
  }

  // Skip external domains (except Google Fonts)
  if (url.origin !== self.location.origin) {
    if (url.hostname === 'fonts.googleapis.com' || 
        url.hostname === 'fonts.gstatic.com') {
      event.respondWith(cacheFirst(request));
      return;
    }
    return;
  }

  // HTML pages: Network-first with offline fallback
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Static assets: Cache-first
  if (url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2|woff|ttf|json)$/)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // API calls: Network-first, no caching
  if (url.pathname.includes('/api/')) {
    event.respondWith(networkOnly(request));
    return;
  }

  // Everything else: Network-first with cache fallback
  event.respondWith(networkFirst(request));
});

// ── Cache-first strategy ──
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    if (request.destination === 'image') {
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
        { headers: { 'Content-Type': 'image/svg+xml' } }
      );
    }
    throw error;
  }
}

// ── Network-first strategy ──
async function networkFirst(request) {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('timeout')), 8000);
  });

  try {
    const response = await Promise.race([fetch(request), timeoutPromise]);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);
    const cached = await caches.match(request);
    if (cached) return cached;

    if (request.mode === 'navigate') {
      return caches.match('/');
    }
    throw error;
  }
}

// ── Network-only strategy ──
async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'You are offline',
        offline: true,
        message: 'This feature requires an internet connection'
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ── Push Notifications ──
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.body || 'New content on EasyRead',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'easyread',
      data: { url: data.url || '/', type: data.type || 'general' },
      vibrate: [200, 100, 200],
      requireInteraction: data.requireInteraction || false,
      actions: data.actions || [],
    };

    event.waitUntil(
      self.registration.showNotification(data.title || 'EasyRead', options)
    );
  } catch (e) {
    event.waitUntil(
      self.registration.showNotification('EasyRead', {
        body: event.data.text(),
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url: '/' }
      })
    );
  }
});

// ── Notification Click ──
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  let urlToOpen = data.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.focus();
            client.postMessage({ type: 'navigate', url: urlToOpen, notificationData: data });
            return;
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// ── Background Sync ──
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-feed') {
    event.waitUntil(syncFeed());
  }
});

async function syncFeed() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await fetch('/api/article?action=list');
    if (response.ok) {
      await cache.put('/api/article?action=list', response.clone());
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({ type: 'feed-synced' });
      });
    }
  } catch (err) {
    console.log('[SW] Feed sync failed:', err);
  }
}

console.log(`[SW] EasyRead v${APP_VERSION} ready 🚀`);