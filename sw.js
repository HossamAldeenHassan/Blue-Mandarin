/**
 * ================================================================
 *  BLUE MANDARIN — Service Worker  (sw.js)  v1.5.0
 *
 *  v1.5.0 changes:
 *    · Cache version bumped to bm-v1.5.0 → evicts all older caches
 *    · PWA install prompt fully blocked (no beforeinstallprompt handling)
 *    · Icon paths remain removed (add ./icons/ files when ready)
 *    · activate: clients.claim() for instant takeover
 * ================================================================
 */

const CACHE_VERSION = 'bm-v1.5.0';          // ← bumped from v1.3.0
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;
const DATA_CACHE    = `${CACHE_VERSION}-data`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;

// App shell pre-cache — NO icon paths (files don't exist yet)
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/data.js',
  './js/progress.js',
  './js/shelly.js',
  './js/curriculum.js',
  './js/ui.js',
];

// Data file patterns — network-first
const DATA_PATH_PATTERNS = [
  /\/data\/hsk1\//,
  /raw\.githubusercontent\.com.*\/data\/hsk1\//,
];

// Hosts that must NEVER be intercepted (POST/AI APIs)
const BYPASS_HOSTNAMES = new Set([
  'generativelanguage.googleapis.com',
  'firebaseapp.com',
  'firebaseio.com',
]);

function shouldBypass(request) {
  try {
    const url = new URL(request.url);
    if (request.method !== 'GET')           return true;
    if (BYPASS_HOSTNAMES.has(url.hostname)) return true;
    if (!['http:', 'https:'].includes(url.protocol)) return true;
    return false;
  } catch { return true; }
}

function isDataRequest(url) {
  const full = url.pathname + url.hostname;
  return DATA_PATH_PATTERNS.some(p => p.test(full));
}

// ── INSTALL ──────────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW v1.5.0] Installing…');
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => {
        console.log('[SW v1.5.0] Shell cached ✓ — calling skipWaiting()');
        return self.skipWaiting();   // take over immediately
      })
      .catch(e => console.warn('[SW v3.0] Pre-cache failed (non-fatal):', e.message))
  );
});

// ── ACTIVATE — evict ALL old caches, claim clients immediately ────
self.addEventListener('activate', event => {
  console.log('[SW v1.5.0] Activating — evicting old caches…');
  const valid = new Set([SHELL_CACHE, DATA_CACHE, DYNAMIC_CACHE]);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !valid.has(k)).map(k => {
          console.log('[SW v1.5.0] Evicting:', k);
          return caches.delete(k);
        })
      ))
      .then(() => {
        console.log('[SW v1.5.0] Active. Claiming all clients immediately.');
        return self.clients.claim();   // take over open tabs without reload
      })
  );
});

// ── FETCH ─────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  if (shouldBypass(request)) return;

  const url = new URL(request.url);

  // Google Fonts → stale-while-revalidate
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, DYNAMIC_CACHE));
    return;
  }

  // HSK JSON data → network-first
  if (isDataRequest(url)) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  // Same-origin shell → cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  event.respondWith(cacheFirst(request, DYNAMIC_CACHE));
});

// ── BACKGROUND SYNC ───────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-progress') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        if (clients.length) clients[0].postMessage({ type: 'FLUSH_SYNC_QUEUE' });
      }).catch(e => { console.warn('[SW] sync-progress failed:', e); throw e; })
    );
  }
});

// ── PUSH NOTIFICATIONS ────────────────────────────────────────────
self.addEventListener('push', event => {
  const p = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(p.title ?? '❄️ Blue Mandarin — وقت الدراسة!', {
      body: p.body ?? '⏰ وقت الممارسة يا حسام! 加油🔥',
      tag: 'daily-reminder',
      vibrate: [200, 100, 200],
      data: { url: p.url ?? './' },
      actions: [
        { action: 'start',   title: '📖 ابدأ الدرس' },
        { action: 'dismiss', title: 'لاحقاً' },
      ],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const target = event.notification.data?.url ?? './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        const hit = clients.find(c => c.url === target);
        return hit ? hit.focus() : self.clients.openWindow(target);
      })
  );
});

// ── CACHING STRATEGIES ────────────────────────────────────────────
async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    if (request.mode === 'navigate') {
      const fb = await cache.match('./index.html');
      if (fb) return fb;
    }
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ error: 'offline', cached: false }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  const update = fetch(request)
    .then(r => { if (r.ok) cache.put(request, r.clone()); return r; })
    .catch(() => null);
  return cached ?? await update;
}
