/**
 * ================================================================
 *  BLUE MANDARIN — Service Worker  (sw.js)  v2.0
 *
 *  Updated for modular architecture:
 *    · SHELL_CACHE now includes css/style.css + js/ui.js
 *    · DATA_PATHS updated to match new data/hsk1/ folder
 *    · Cache version bumped (bm-v1.2.0) to evict old caches
 *    · Gemini API bypass unchanged (POST passthrough)
 *    · GitHub Raw URLs for data/hsk1/ treated as network-first
 * ================================================================
 */

const CACHE_VERSION = 'bm-v1.2.0';
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;
const DATA_CACHE    = `${CACHE_VERSION}-data`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;

// ── App shell: pre-cached on install ────────────────────────────
// Every file the app needs to render offline without a network hit.
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/data.js',
  './js/progress.js',
  './js/shelly.js',
  './js/ui.js',
];

// ── HSK data paths: network-first, cached for offline ───────────
// Match both local (data/hsk1/) and GitHub Raw URLs.
const DATA_PATH_PATTERNS = [
  /\/data\/hsk1\//,
  /raw\.githubusercontent\.com.*\/data\/hsk1\//,
  /raw\.githubusercontent\.com.*hsk1/,
];

// ── Bypass rules ─────────────────────────────────────────────────
const BYPASS_HOSTNAMES = new Set([
  'generativelanguage.googleapis.com',
  'firebaseapp.com',
  'firebaseio.com',
]);

function shouldBypass(request) {
  try {
    const url = new URL(request.url);
    if (request.method !== 'GET')          return true;
    if (BYPASS_HOSTNAMES.has(url.hostname)) return true;
    if (!['http:', 'https:'].includes(url.protocol)) return true;
    return false;
  } catch { return true; }
}

function isDataRequest(url) {
  return DATA_PATH_PATTERNS.some(p => p.test(url.pathname + url.hostname));
}

// ================================================================
//  INSTALL
// ================================================================
self.addEventListener('install', event => {
  console.log('[SW v2.0] Installing…');
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => { console.log('[SW] Shell cached ✓'); return self.skipWaiting(); })
      .catch(e  => console.warn('[SW] Pre-cache failed (non-fatal):', e.message))
  );
});

// ================================================================
//  ACTIVATE — evict old cache versions
// ================================================================
self.addEventListener('activate', event => {
  console.log('[SW v2.0] Activating…');
  const valid = new Set([SHELL_CACHE, DATA_CACHE, DYNAMIC_CACHE]);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !valid.has(k)).map(k => {
          console.log('[SW] Evicting old cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => { console.log('[SW] Active. Claiming clients.'); return self.clients.claim(); })
  );
});

// ================================================================
//  FETCH — route every request
// ================================================================
self.addEventListener('fetch', event => {
  const { request } = event;

  // ① AI APIs + non-GET → pass through untouched
  if (shouldBypass(request)) return;

  const url = new URL(request.url);

  // ② Google Fonts → stale-while-revalidate
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, DYNAMIC_CACHE));
    return;
  }

  // ③ HSK JSON data (local or GitHub Raw) → network-first
  if (isDataRequest(url)) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  // ④ Same-origin shell assets → cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // ⑤ Everything else → cache-first with dynamic cache
  event.respondWith(cacheFirst(request, DYNAMIC_CACHE));
});

// ================================================================
//  BACKGROUND SYNC — flush progress queue
// ================================================================
self.addEventListener('sync', event => {
  if (event.tag === 'sync-progress') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        if (clients.length) clients[0].postMessage({ type: 'FLUSH_SYNC_QUEUE' });
      }).catch(e => { console.warn('[SW] sync-progress failed:', e); throw e; })
    );
  }
});

// ================================================================
//  PUSH NOTIFICATIONS
// ================================================================
self.addEventListener('push', event => {
  const p = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(p.title ?? '❄️ Blue Mandarin — وقت الدراسة!', {
      body:    p.body ?? '⏰ وقت الممارسة يا حسام! 加油🔥',
      icon:    './icons/icon-192.png',
      badge:   './icons/icon-96.png',
      tag:     'daily-reminder',
      vibrate: [200, 100, 200],
      data:    { url: p.url ?? './' },
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

// ================================================================
//  STRATEGY HELPERS
// ================================================================
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
