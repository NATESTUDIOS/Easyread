// EasyRead Service Worker
const APP_VERSION = '1';
const CACHE_NAME = `easyread-v${APP_VERSION}`;

// ── Only cache files that are guaranteed to exist locally ──
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/blog.html',
  '/profile.html',
  '/?mode=pwa',
  '/manifest.json',
  
  // Icons (cached safely in try/catch block)
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-180.png',
  '/icons/icon-152.png',
  '/icons/icon-120.png',
  '/icons/icon-144.png',
  '/icons/favicon-32.png',
  '/icons/favicon-16.png',
  '/favicon.ico'
];

// ── Install: Cache static assets safely without failing if one icon is missing ──
self.addEventListener('install', (event) => {
  console.log(`[SW] EasyRead v${APP_VERSION} installing...`);
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log(`[SW] Caching static assets`);
      // Cache assets individually so 1 missing icon doesn't abort installation
      const cachePromises = STATIC_ASSETS.map(async (asset) => {
        try {
          const response = await fetch(asset);
          if (response.ok) {
            await cache.put(asset, response);
          }
        } catch (err) {
          console.warn(`[SW] Skipping asset ${asset}:`, err.message);
        }
      });
      return Promise.all(cachePromises);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// ── Activate: Clean up old version caches ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('easyread-') && name !== CACHE_NAME)
          .map((name) => {
            console.log(`[SW] Purging outdated cache: ${name}`);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log(`[SW] EasyRead v${APP_VERSION} active and claiming clients 🚀`);
      return self.clients.claim();
    })
  );
});

// ── Client Message Handling ──
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CACHE_URLS') {
    const urls = event.data.urls || [];
    caches.open(CACHE_NAME).then(cache => {
      urls.forEach(url => {
        fetch(url).then(res => {
          if (res.ok) cache.put(url, res);
        }).catch(() => {});
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

// ── Fetch Routing ──
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Only intercept GET requests
  if (request.method !== 'GET') return;

  // 2. Ignore non-http protocols (e.g. chrome-extension://)
  if (!url.protocol.startsWith('http')) return;

  // 3. Skip external analytics or trackers
  if (url.pathname.includes('/analytics') || 
      url.pathname.includes('/gtag') || 
      url.pathname.includes('/collect')) {
    return;
  }

  // 4. Handle Google Fonts (Cache-First)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 5. Handle API Requests
  if (url.pathname.includes('/api/')) {
    // Read-only GET list APIs -> Network First with cache fallback
    if (url.search.includes('action=list')) {
      event.respondWith(apiNetworkFirst(request));
      return;
    }
    // Generation, auth, or mutation endpoints -> Network Only
    event.respondWith(networkOnly(request));
    return;
  }

  // 6. Navigation requests (HTML pages) -> Network First with Page Cache Fallback
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(htmlNetworkFirst(request));
    return;
  }

  // 7. Static Assets (JS, CSS, Images, Fonts) -> Cache First
  if (url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2|woff|ttf|json)$/)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Default fallback
  event.respondWith(networkFirst(request));
});

// ── Cache-First Strategy ──
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    if (request.destination === 'image') {
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><rect width="24" height="24" fill="#1c1c1e"/></svg>',
        { headers: { 'Content-Type': 'image/svg+xml' } }
      );
    }
    throw error;
  }
}

// ── HTML Network-First Strategy ──
async function htmlNetworkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Fallback to home page if navigating offline
    const rootCached = await caches.match('/');
    if (rootCached) return rootCached;
    throw error;
  }
}

// ── API Network-First Strategy (for list feeds) ──
async function apiNetworkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ error: 'Offline', offline: true, articles: [], categories: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ── Network-First Strategy ──
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

// ── Network-Only Strategy ──
async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Network unavailable',
        offline: true,
        message: 'This feature requires an active internet connection.'
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
      body: data.body || 'New simplified content is ready on EasyRead',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'easyread-alert',
      data: { url: data.url || '/', type: data.type || 'general' },
      vibrate: [150, 80, 150],
      requireInteraction: false
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
  const targetUrl = data.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.focus();
            client.postMessage({ type: 'navigate', url: targetUrl });
            return;
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});

// ── Background Sync ──
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-feed') {
    event.waitUntil(
      fetch('/api/article?action=list')
        .then(res => res.ok ? caches.open(CACHE_NAME).then(cache => cache.put('/api/article?action=list', res)) : null)
        .catch(() => {})
    );
  }
});