/* Lectern offline cache: the app opens with no internet; your talks live in the browser's database. */
const CACHE = 'lectern-f8860717';
const SHELL = ['./', './index.html', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './vendor/jszip.min.js', './vendor/pdf.min.mjs', './vendor/pdf.worker.min.mjs', './vendor/serif.woff2', './vendor/serif-italic.woff2',
  './tts-worker.js', './mp3-worker.js', './vendor/lamejs.iife.js', './vendor/kokoro.web.js', './vendor/qrcode.js', './lectern-sync.gs'];
// cache: 'reload' skips the browser's own HTTP cache, so an update never stores yesterday's files
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  // old app versions go; the voice engine's own cache (lectern-voice) stays, so an update never re-downloads it
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => /^lectern-[0-9a-f]{8}$/.test(k) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
function withTimeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); }
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin === 'https://cdn.jsdelivr.net') {   // the voice engine's runtime files
    e.respondWith(caches.open('lectern-voice').then(c => c.match(r).then(m => m || fetch(r).then(res => { if (res.ok) c.put(r, res.clone()); return res; }))));
    return;
  }
  if (u.origin !== self.location.origin) return;
  if (r.mode === 'navigate' || u.pathname.endsWith('/') || u.pathname.endsWith('.html') || u.pathname.endsWith('/app.js')) {
    e.respondWith(withTimeout(fetch(r.url, { cache: 'no-cache', credentials: 'same-origin' }), 4000)
      .then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r.mode === 'navigate' ? './index.html' : r, cp)); } return res; })
      .catch(() => caches.match(r.mode === 'navigate' ? './index.html' : r).then(m => m || caches.match('./index.html'))));
    return;
  }
  e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; })));
});
