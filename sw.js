// Service worker: network-first so new builds show up right away when
// online, with a cached copy for offline play. Bump CACHE_VERSION on every
// release so phones drop the old copy.

const CACHE_VERSION = 'mikeball-v15';
const NET_TIMEOUT_MS = 3500;
const TEAM_IDS = 'BUF MIA NE NYJ BAL CIN CLE PIT HOU IND JAX TEN DEN KC LV LAC DAL NYG PHI WAS CHI DET GB MIN ATL CAR NO TB ARI LAR SF SEA'.split(' ');
// Team logos are small and used on every screen, so they're cached up front.
const LOGOS = TEAM_IDS.flatMap((t) => [16, 32, 64].map((n) => `assets/teams/${t}/logo_${n}.png`));
// Helmet logos for the player sprites (Cleveland's helmet is plain).
const DECALS = TEAM_IDS.filter((t) => t !== 'CLE').map((t) => `assets/teams/${t}/helmet_5x4.png`);
// TV packages: each network's logo, scorebug and the title cards the game uses.
const NETS = ['cbs', 'fox', 'nbc', 'espn', 'abc', 'prime', 'nfl_network', 'netflix'];
const TV_FILES = ['logo_32.png', 'scorebug_standard_320x40.png', 'team_mask_standard_320x40.png',
  ...['kickoff', 'touchdown', 'field_goal', 'final', 'two_minute', 'halftime', 'overtime'].map((k) => `${k}_240x60.png`)];
const TV = ['assets/broadcast/layouts.json', ...NETS.flatMap((n) => TV_FILES.map((f) => `assets/broadcast/${n}/${f}`))];
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'fonts/mikeball-pixel.woff',
  'fonts/mikeball-pixel.ttf',
  'src/ui/pixelart.js',
  'src/main.js',
  'src/core/rng.js',
  'src/core/util.js',
  'src/core/storage.js',
  'src/data/teams.js',
  'src/data/names.js',
  'src/data/roster.js',
  'src/data/playbook.js',
  'src/data/realleague.js',
  'assets/data/league.json',
  'src/game/badges.js',
  'src/game/personnel.js',
  'src/game/kicks.js',
  'src/game/stats.js',
  'src/game/commentary.js',
  'src/game/rules.js',
  'src/game/cpu.js',
  'src/game/autoplay.js',
  'src/game/playedit.js',
  'src/sim/align.js',
  'src/sim/playsim.js',
  'src/sim/contact.js',
  'src/render/camera.js',
  'src/render/field.js',
  'src/render/pixelsprites.js',
  'src/render/pixelfont.js',
  'src/render/pixeldraw.js',
  'src/render/images.js',
  'src/render/playart.js',
  'src/render/crowd.js',
  'src/render/effects.js',
  'src/render/simdraw.js',
  'src/ui/dom.js',
  'src/ui/emblems.js',
  'src/ui/roster.js',
  'src/ui/menus.js',
  'src/ui/coach.js',
  'src/ui/kickscene.js',
  'src/ui/drawing.js',
  'src/ui/playclock.js',
  'src/ui/presentation.js',
  'src/data/broadcast.js',
  'src/data/honors.js',
  'src/data/traditions.js',
  'src/game/awards.js',
  'src/render/scoreshow.js',
  'src/sim/celebrate.js',
  'src/ui/broadcast.js',
  'src/sim/odds.js',
  'src/sim/passing.js',
  'src/sim/fouls.js',
  'src/sim/officials.js',
  'src/render/rig.js',
  'src/render/rigparts.js',
  'src/render/animate.js',
  'src/render/crewdraw.js',
  'src/render/kickanim.js',
  'src/render/sideline.js',
  'src/ui/presnap.js',
  'src/ui/coachstage.js',
  'src/ui/coachkicks.js',
  'src/ui/coachmenus.js',
  'src/ui/passaim.js',
  'src/ui/settings.js',
  'src/sim/offense.js',
  'src/sim/defense.js',
  'src/game/penalties.js',
  'src/game/kicking.js',
  'src/game/replay.js',
  'src/ui/coachreplay.js',
  'src/ui/myplays.js',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache so a release never mixes
  // old and new modules.
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then((c) => c.addAll([...SHELL, ...LOGOS, ...DECALS, ...TV].map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (err) => { clearTimeout(t); reject(err); });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin && !font) return;

  if (font) {
    // Fonts never change: cache-first.
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.put(req, copy)));
        return res;
      })),
    );
    return;
  }

  const network = fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res && res.ok) {
      const copy = res.clone();
      e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.put(req, copy)));
    }
    return res;
  });
  e.respondWith(
    withTimeout(network, NET_TIMEOUT_MS).catch(() =>
      caches.match(req, { ignoreSearch: true }).then((hit) => {
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('index.html');
        return network; // nothing cached: keep waiting on the network
      })),
  );
});
