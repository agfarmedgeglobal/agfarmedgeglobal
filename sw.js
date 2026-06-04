// ═══════════════════════════════════════════════════════════════
//  AG Farmedge Global — Service Worker v1
//  Provides: full offline support, asset caching, background sync
// ═══════════════════════════════════════════════════════════════

const CACHE_NAME = 'agfarmedge-v7.1';
const FIREBASE_CACHE = 'agfarmedge-firebase-v1';

// Assets to cache on install — the app shell
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// Google Fonts — cache on first fetch, serve from cache thereafter
const FONT_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com'
];

// Firebase SDK CDN — cache on first fetch
const FIREBASE_ORIGINS = [
  'https://www.gstatic.com/firebasejs/'
];

// ── INSTALL: cache the app shell ──────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(SHELL_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: clean up old caches ─────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== FIREBASE_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: serve from cache with network fallback ─────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Firebase Realtime DB calls: always go to network (real-time data)
  // but don't fail silently — let the app handle offline state
  if (url.hostname.includes('firebaseio.com') || url.hostname.includes('firebase.com')) {
    event.respondWith(fetch(event.request).catch(() => {
      // Return a synthetic offline response so the app's error handler fires
      return new Response(JSON.stringify({error: 'offline'}), {
        status: 503,
        headers: {'Content-Type': 'application/json'}
      });
    }));
    return;
  }

  // Firebase SDK & Google Fonts: cache-first (they never change for a given URL)
  const isStaticCDN = FONT_ORIGINS.some(o => url.href.startsWith(o))
                   || FIREBASE_ORIGINS.some(o => url.href.startsWith(o));
  if (isStaticCDN) {
    event.respondWith(
      caches.open(FIREBASE_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            // Only cache valid responses
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          });
        })
      )
    );
    return;
  }

  // App shell & local files: cache-first, then network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful local fetches
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // If offline and not cached — return the main app (handles navigation fallback)
        return caches.match('./index.html');
      });
    })
  );
});

// ── MESSAGE: force update from app ───────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
