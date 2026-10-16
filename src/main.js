// App shell: league setup, screen routing, service worker.

import { generateLeague } from './data/roster.js';
import { TEAMS, teamById, setTeams } from './data/teams.js';
import { fromLeagueJson } from './data/realleague.js';
import { computeBadges } from './game/badges.js';
import { makeRng } from './core/rng.js';
import { load, save } from './core/storage.js';
import { injectDefs } from './ui/emblems.js';
import { titleScreen, setupScreen, finalScreen } from './ui/menus.js';
import { resolveHonors } from './data/honors.js';
import { CoachScreen } from './ui/coach.js';

const LEAGUE_SEED = 2026;

const app = {
  root: document.getElementById('app'),
  settings: load('settings', {}),
  league: null,
  coach: null,

  teamById,

  saveSettings() {
    save('settings', this.settings);
  },

  randomOpponent(userId) {
    const rng = makeRng((Date.now() & 0xffffffff) >>> 0);
    const pool = TEAMS.filter((t) => t.id !== userId);
    return rng.pick(pool).id;
  },

  mount(el) {
    if (this.coach) { this.coach.destroy(); this.coach = null; }
    for (const s of [...this.root.children]) s.remove();
    this.root.append(el);
    this.root.scrollTop = 0;
    window.scrollTo(0, 0);
  },

  showTitle() {
    this.mount(titleScreen(this));
  },

  showSetup(userId) {
    this.mount(setupScreen(this, userId));
  },

  startGame({ userId, oppId, userHome, qLen, seed, slot }) {
    if (this.coach) { this.coach.destroy(); this.coach = null; }
    for (const s of [...this.root.children]) s.remove();
    const gameSeed = seed ?? ((Date.now() ^ 0x9e3779b9) >>> 0);
    this.coach = new CoachScreen(this, { league: this.league, userId, oppId, userHome, qLen, seed: gameSeed, slot });
  },

  showFinal(game, opts) {
    const screen = finalScreen(this, game, opts);
    this.mount(screen);
  },
};

// Real teams and rosters from the asset pack; the generated league is the
// fallback if the file can't be loaded (e.g. first launch while offline).
async function loadLeague() {
  try {
    const res = await fetch('assets/data/league.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { teams, rosters } = fromLeagueJson(await res.json());
    setTeams(teams);
    app.realLeague = true;
    return rosters;
  } catch (err) {
    console.warn('Using generated league:', err.message);
    app.realLeague = false;
    return generateLeague(LEAGUE_SEED);
  }
}

async function boot() {
  injectDefs();
  app.league = await loadLeague();
  const everyone = Object.values(app.league).flatMap((r) => r.players);
  computeBadges(everyone);
  if (app.realLeague) resolveHonors(everyone);
  try {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  } catch { /* fonts are optional */ }
  window.MikeBall = app; // handy for debugging from the console
  const params = new URLSearchParams(location.search);
  app.timeScale = Math.min(10, Math.max(0.25, Number(params.get('speed')) || 1));
  if (params.get('autostart')) {
    const userId = params.get('team') || 'KC';
    app.startGame({ userId, oppId: params.get('opp') || 'BUF', userHome: true, qLen: Number(params.get('q') || 8), seed: Number(params.get('seed') || 42), slot: params.get('slot') || 'sun_early' });
  } else {
    app.showTitle();
  }
}

boot();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
