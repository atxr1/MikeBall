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
import { seasonHub, seasonSetupScreen, resumeSeason, recordUserGame, keepDepth } from './ui/season.js';
import { seasonStandings } from './game/season.js';

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

  showTitle(mode) {
    this.mount(titleScreen(this, mode));
  },

  // ---- season mode (src/ui/season.js)
  showSeason(tab) {
    if (!this.season) return this.showTitle('season');
    keepDepth(this);
    this.mount(seasonHub(this, tab));
  },

  showSeasonSetup(userId) {
    this.mount(seasonSetupScreen(this, userId));
  },

  seasonRecord(s) {
    const r = seasonStandings(s, TEAMS).rows[s.userId];
    return `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}`;
  },

  showSetup(userId) {
    this.mount(setupScreen(this, userId));
  },

  // extra: a season game's { broadcast, playoff, season: { gameId } }
  startGame({ userId, oppId, userHome, qLen, seed, slot, ...extra }) {
    if (this.coach) { this.coach.destroy(); this.coach = null; }
    for (const s of [...this.root.children]) s.remove();
    const gameSeed = seed ?? ((Date.now() ^ 0x9e3779b9) >>> 0);
    this.coach = new CoachScreen(this, { league: this.league, userId, oppId, userHome, qLen, seed: gameSeed, slot, ...extra });
  },

  showFinal(game, opts) {
    // a season game goes on the books before anything else
    if (opts && opts.season) recordUserGame(this, game, opts);
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

// Badges and honors for whoever's in the league now (after a load, a new
// league, or an offseason).
app.refreshPlayers = function refreshPlayers() {
  const everyone = Object.values(this.league).flatMap((r) => r.players).concat(this.gm ? this.gm.fa : []);
  computeBadges(everyone);
  if (this.realLeague) resolveHonors(everyone);
};

// A fresh copy of the league as the asset pack has it.
app.reloadLeague = async function reloadLeague() {
  const rosters = await loadLeague();
  const everyone = Object.values(rosters).flatMap((r) => r.players);
  computeBadges(everyone);
  if (this.realLeague) resolveHonors(everyone);
  return rosters;
};

async function boot() {
  injectDefs();
  app.league = await loadLeague();
  await resumeSeason(app);
  app.refreshPlayers();
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
