// sw.js - Cascade Staff service worker v1.2 (2026-10-08)
// Copied from the cleaning checklist's v1.2 strategy and tightened for a staff app:
//   Supabase (REST, RPC, Storage, Auth, Edge Functions), Telegram -> network-only, NEVER cached or replayed.
//   Google Fonts files and the pinned supabase-js build (jsDelivr)   -> cache-first (public, no personal data).
//   Navigation                                                       -> network-first, 3 s timeout, cached shell as the fallback.
//   Same-origin shell files                                          -> network-first, cache fallback.
// Nothing personal is ever stored here: the cache holds the shell (HTML, CSS, JS, fonts, icons) and nothing else.
// A shell that loads offline says "Live information needs a connection"; guest names exist only in JS memory.
const CACHE_NAME = 'cs-shell-v8';
const NAV_TIMEOUT_MS = 3000;
// The self-hosted font files styles.css @font-face points at. Theme v2 changes fonts: edit this one list (and styles.css), nothing else here.
const SELF_FONTS = ['cormorant-garamond-600.woff2', 'cormorant-garamond-700.woff2'];
// Every icon the manifest and the pages name (the maskable one is what an Android home screen draws).
const ICON_FILES = ['icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'apple-touch-icon-180.png'];
const SHELL_URLS = [
  './', './index.html', './styles.css', './app.js', './lib.js', './icons.js', './theme.js', './manifest.webmanifest',
  './quick/', './quick/index.html', './pay/', './pay/index.html', './pay/pay.js', './pay/pay-lib.js', './pay/bank.html',
  './guest/', './guest/index.html', './guest/guest.js', './guest/guest-lib.js',
  ...SELF_FONTS.map((f) => './fonts/' + f),
  ...ICON_FILES.map((f) => './icons/' + f)
];
const NETWORK_ONLY_HOSTS = ['supabase.co', 'supabase.in', 'api.telegram.org', 't.me'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net']; // public files only: fonts and the pinned supabase-js build
const NEVER_PATHS = ['/rest/v1/', '/functions/v1/', '/auth/v1/', '/storage/v1/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(SHELL_URLS.map((u) => cache.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // posts, uploads and payment requests go straight to the network
  const url = new URL(request.url);

  if (NETWORK_ONLY_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h)) || NEVER_PATHS.some((p) => url.pathname.includes(p))) {
    event.respondWith(fetch(request));
    return;
  }

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((resp) => {
      if (resp && resp.status === 200) { const copy = resp.clone(); caches.open(CACHE_NAME).then((c) => c.put(request, copy)); }
      return resp;
    })));
    return;
  }

  if (url.origin !== self.location.origin) return; // anything else cross-origin: the browser's own handling

  const fromNetwork = (req) => fetch(req).then((resp) => {
    if (resp && resp.status === 200 && resp.type === 'basic') { const copy = resp.clone(); caches.open(CACHE_NAME).then((c) => c.put(req, copy)); }
    return resp;
  });

  if (request.mode === 'navigate') {
    event.respondWith(
      Promise.race([fromNetwork(request), timeout(NAV_TIMEOUT_MS)]).catch(() =>
        caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }
  event.respondWith(fromNetwork(request).catch(() => caches.match(request, { ignoreSearch: true })));
});
