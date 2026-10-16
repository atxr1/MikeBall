// Service worker: network-first so new builds show up right away when
// online, with a cached copy for offline play. Bump CACHE_VERSION on every
// release.

const CACHE_VERSION = 'mikeball-v1';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'src/main.js',
  'src/core/rng.js',
  'src/core/util.js',
  'src/core/storage.js',
  'src/data/teams.js',
  'src/data/names.js',
  'src/data/roster.js',
  'src/data/playbook.js',
  'src/game/badges.js',
  'src/game/personnel.js',
  'src/game/kicks.js',
  'src/game/stats.js',
  'src/game/commentary.js',
  'src/game/rules.js',
  'src/game/cpu.js',
  'src/game/autoplay.js',
  'src/sim/align.js',
  'src/sim/playsim.js',
  'src/render/camera.js',
  'src/render/field.js',
  'src/render/sprites.js',
  'src/render/playart.js',
  'src/ui/dom.js',
  'src/ui/emblems.js',
  'src/ui/roster.js',
  'src/ui/menus.js',
  'src/ui/coach.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !font) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
