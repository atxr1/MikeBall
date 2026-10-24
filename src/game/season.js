// Season mode: the state of a season and everything that moves it along.
//
// A season is plain JSON (it goes straight into localStorage and out as an
// export file):
//
//   { v, year, userId, seed, qLen, phase: 'regular'|'playoffs'|'done',
//     week, games: [...], bracket, players, teams, awards, champion,
//     last: { teamId: { w, l, t, divRank } }, lastChampion }
//
// games: the schedule with results filled in (hs/as home and away points,
// htd/atd touchdowns, ot, potg). Playoff games carry a round (0-3) and a
// conference. players: regular-season stat lines by player id; teams:
// regular-season team totals. Games the user doesn't coach are played by
// the rules engine with the quick play resolver (./quicksim.js), the same
// quarter length as the user's games so the league's numbers stay in
// proportion. Pure logic: no DOM.

import { TEAMS } from '../data/teams.js';
import { Game } from './rules.js';
import { simulateGame } from './autoplay.js';
import { buildSchedule } from './weeks.js';
import { playoffDates, addDays } from './schedule.js';
import { standings, newBracket, advance, winnerOf, ROUND_NAMES } from './standings.js';
import { playerOfTheGame, seasonAwards, offenseScore, defenseScore } from './awards.js';
import { STANDINGS_2025, CHAMPION_2025, COACHES } from '../data/league2025.js';
import { hashString } from '../core/rng.js';
import { clamp } from '../core/util.js';

export const SEASON_VERSION = 1;
export const REGULAR_WEEKS = 18;
export { ROUND_NAMES };

const teamsInfo = (teams) => teams.map((t) => ({ id: t.id, conf: t.conf, div: t.div }));

// prev: the season before (a finished season state), or null for 2026.
export function newSeason({ year = 2026, userId, seed = 1, qLen = 8, prev = null, teams = TEAMS }) {
  const last = {};
  let lastChampion = CHAMPION_2025;
  if (prev && prev.phase === 'done') {
    const st = seasonStandings(prev, teams);
    for (const t of teams) {
      const r = st.rows[t.id];
      last[t.id] = { w: r.w, l: r.l, t: r.t, divRank: r.divRank };
    }
    lastChampion = prev.champion;
  } else {
    for (const t of teams) {
      const r = STANDINGS_2025[t.id] || { w: 8, l: 9, t: 0, divRank: 2 };
      last[t.id] = { w: r.w, l: r.l, t: r.t, divRank: r.divRank };
    }
  }
  // the defending champion opens at home; last year's winners get the
  // most prime-time windows
  const places = Object.fromEntries(Object.entries(last).map(([id, r]) => [id, r.divRank]));
  const draw = Object.fromEntries(Object.entries(last).map(([id, r]) => [id, clamp((r.w - 8) / 3, 0, 2)]));
  const sched = buildSchedule(year, { places, champion: lastChampion, draw, teams, generate: year !== 2026 }, (seed ^ hashString(String(year))) >>> 0);
  const games = sched.games.map((g) => ({ ...g, hs: null, as: null, htd: 0, atd: 0, ot: false, potg: null }));
  return {
    v: SEASON_VERSION,
    year,
    userId,
    seed,
    qLen,
    sunday1: sched.sunday1,
    phase: 'regular',
    week: 1,
    games,
    bracket: null,
    players: {},
    teams: {},
    awards: null,
    champion: null,
    last,
    lastChampion,
  };
}

export const played = (g) => g.hs != null;
export const weekGames = (s, w) => s.games.filter((g) => g.week === w);
export const userGame = (s, w = s.week) => s.games.find((g) => g.week === w && (g.home === s.userId || g.away === s.userId)) || null;
export const teamGames = (s, id) => s.games.filter((g) => g.home === id || g.away === id).sort((a, b) => a.week - b.week);

export function gameSeed(s, g) {
  return (hashString(`${s.seed}:${s.year}:${g.id}`) ^ 0x5bd1e995) >>> 0;
}

export function isPlayoff(g) {
  return g.round != null;
}

// A Game for this schedule entry (the coach screen makes its own for the
// user's games from the same options).
export function gameOptions(s, g, rosters, teamById) {
  return {
    homeTeam: teamById(g.home),
    awayTeam: teamById(g.away),
    homeRoster: rosters[g.home],
    awayRoster: rosters[g.away],
    qLen: s.qLen,
    seed: gameSeed(s, g),
    playoff: isPlayoff(g),
  };
}

export function simGame(s, g, rosters, teamById) {
  const game = new Game({ ...gameOptions(s, g, rosters, teamById), userSide: 'none' });
  game.quick = true;
  simulateGame(game, 20000);
  recordGame(s, g, game, rosters);
  return game;
}

// Who got a game played: everyone with a line in the box score, plus the
// starters at every position (linemen don't show up in it).
const STARTERS = { QB: 1, RB: 1, WR: 3, TE: 1, OL: 5, DL: 4, EDGE: 2, LB: 3, CB: 3, S: 2, K: 1, P: 1 };
function startersOf(roster) {
  const out = new Set();
  for (const [pos, n] of Object.entries(STARTERS)) for (const id of (roster.depth[pos] || []).slice(0, n)) out.add(id);
  return out;
}

const addInto = (dst, src) => {
  for (const [k, v] of Object.entries(src)) {
    if (typeof v !== 'number') continue;
    if (k === 'long') dst[k] = Math.max(dst[k] || 0, v);
    else dst[k] = (dst[k] || 0) + v;
  }
};
const CATS = ['pass', 'rush', 'rec', 'def', 'kick', 'punt', 'ret'];

// Puts a finished game into the season: the score, and (in the regular
// season) every player's numbers and the team totals.
export function recordGame(s, g, game, rosters) {
  g.hs = game.score.home;
  g.as = game.score.away;
  g.htd = game.tds ? game.tds.home : 0;
  g.atd = game.tds ? game.tds.away : 0;
  g.ot = game.quarter >= 5;
  const pg = playerOfTheGame(game);
  g.potg = pg ? { id: pg.line.id, name: pg.line.name, pos: pg.line.pos, team: pg.team.id, summary: pg.summary } : null;
  if (isPlayoff(g)) {
    const b = s.bracket;
    const bg = b && b.rounds[g.round].find((x) => x.home === g.home && x.away === g.away);
    if (bg) { bg.hs = g.hs; bg.as = g.as; }
    return;
  }
  const sideTeam = { home: g.home, away: g.away };
  const seen = new Set();
  for (const l of game.stats.players.values()) {
    const team = sideTeam[l.side];
    const p = (s.players[l.id] ||= { id: l.id, team, name: l.name, pos: l.pos, num: l.num, gp: 0 });
    p.team = team;
    for (const c of CATS) if (l[c]) addInto((p[c] ||= {}), l[c]);
    if (!seen.has(l.id)) { p.gp++; seen.add(l.id); }
  }
  for (const side of ['home', 'away']) {
    const id = sideTeam[side];
    const roster = rosters && rosters[id];
    if (roster) {
      const byId = new Map(roster.players.map((x) => [x.id, x]));
      for (const pid of startersOf(roster)) {
        if (seen.has(pid)) continue;
        const r = byId.get(pid);
        if (!r || r.injured) continue;
        const p = (s.players[pid] ||= { id: pid, team: id, name: `${r.first[0]}. ${r.last}`, pos: r.pos, num: r.num, gp: 0 });
        p.gp++;
        seen.add(pid);
      }
    }
    const t = (s.teams[id] ||= {});
    addInto(t, game.stats.team[side]);
    t.pts = (t.pts || 0) + game.score[side];
    t.opp = (t.opp || 0) + game.score[side === 'home' ? 'away' : 'home'];
    t.games = (t.games || 0) + 1;
  }
}

// ---------------------------------------------------------------- weeks

export function weekDone(s, w = s.week) {
  return weekGames(s, w).every(played);
}

// Plays every unplayed game this week (or round) except the user's, unless
// includeUser. Returns the games it played.
export function simWeek(s, rosters, teamById, { includeUser = false } = {}) {
  const list = s.phase === 'playoffs' ? currentRound(s) : weekGames(s, s.week);
  const out = [];
  for (const g of list) {
    if (played(g)) continue;
    if (!includeUser && (g.home === s.userId || g.away === s.userId)) continue;
    simGame(s, g, rosters, teamById);
    out.push(g);
  }
  return out;
}

// Moves to the next week (or round) once everything in this one is played.
// Returns what happened: 'week', 'playoffs', 'round', 'champion', or null.
export function nextWeek(s, rosters, teams = TEAMS) {
  if (s.phase === 'regular') {
    if (!weekDone(s)) return null;
    if (s.week < REGULAR_WEEKS) { s.week++; return 'week'; }
    startPlayoffs(s, rosters, teams);
    return 'playoffs';
  }
  if (s.phase === 'playoffs') {
    const round = currentRound(s);
    if (!round.length || !round.every(played)) return null;
    advance(s.bracket);
    if (s.bracket.champion) {
      s.champion = s.bracket.champion;
      s.phase = 'done';
      return 'champion';
    }
    addRoundGames(s);
    s.week++;
    return 'round';
  }
  return null;
}

export function seasonStandings(s, teams = TEAMS) {
  const results = s.games.filter((g) => !isPlayoff(g) && played(g));
  return standings(results, teamsInfo(teams), `${s.seed}:${s.year}`);
}

// ---------------------------------------------------------------- playoffs

export function startPlayoffs(s, rosters, teams = TEAMS) {
  const st = seasonStandings(s, teams);
  s.bracket = newBracket(st.seeds, s.year);
  s.phase = 'playoffs';
  s.week = REGULAR_WEEKS + 1;
  // the regular season's awards (announced the week of the Super Bowl)
  s.awards = computeAwards(s, rosters, teams);
  addRoundGames(s);
}

export function currentRound(s) {
  return s.games.filter((g) => isPlayoff(g) && g.week === s.week);
}

// Schedule entries for the bracket's newest round: wild card weekend is a
// Saturday-to-Monday spread, the divisional round Saturday and Sunday, the
// title games Sunday, and the Super Bowl two weeks later in prime time.
function addRoundGames(s) {
  const b = s.bracket;
  const r = b.rounds.findIndex((list) => list.length && list.every((g) => g.hs == null));
  if (r < 0) return;
  const dates = playoffDates(s.sunday1);
  const base = [dates.wildcard, dates.divisional, dates.conference, dates.superBowl][r];
  const windows = [
    [['Sa4', 'nbc', -1], ['Sa8', 'prime', -1], ['Su1', 'cbs', 0], ['Su4', 'fox', 0], ['Su8', 'nbc', 0], ['Mo8', 'espn', 1]],
    [['Sa4', 'espn', -1], ['Sa8', 'cbs', -1], ['Su1', 'fox', 0], ['Su4', 'nbc', 0]],
    [['Su1', 'cbs', 0], ['Su8', 'fox', 0]],
    // the Super Bowl rotates CBS, FOX, NBC, ABC (LXI, the 2026 season's, is ABC's)
    [['Su8', ['cbs', 'fox', 'nbc', 'abc'][(s.year - 2023) % 4], 0]],
  ][r];
  b.rounds[r].forEach((bg, i) => {
    const [slot, net, off] = windows[i % windows.length];
    s.games.push({
      id: `P${r}-${bg.away}-${bg.home}`,
      week: REGULAR_WEEKS + 1 + r,
      round: r,
      conf: bg.conf,
      home: bg.home,
      away: bg.away,
      neutral: !!bg.neutral,
      slot,
      net,
      site: bg.neutral ? superBowlSite(s.year) : null,
      tag: r === 3 ? 'SB' : null,
      date: addDays(base, off),
      hs: null, as: null, htd: 0, atd: 0, ot: false, potg: null,
    });
  });
}

// Announced Super Bowl hosts: LXI at SoFi (Feb 2027), LXII Atlanta, LXIII
// New Orleans; after that the game moves around the league's big stadiums.
const SB_SITES = { 2026: 'Inglewood', 2027: 'Atlanta', 2028: 'New Orleans' };
const SB_ROTATION = ['Miami Gardens', 'Glendale', 'Las Vegas', 'Houston', 'Santa Clara', 'Inglewood', 'New Orleans', 'Atlanta', 'Minneapolis', 'Arlington'];
export function superBowlSite(year) {
  return SB_SITES[year] || SB_ROTATION[(year - 2029) % SB_ROTATION.length];
}

export function superBowlName(year) {
  const n = year - 1965;
  const R = [[50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let x = n;
  let out = '';
  for (const [v, sym] of R) while (x >= v) { out += sym; x -= v; }
  return `Super Bowl ${out}`;
}

export function roundName(g, year) {
  if (!isPlayoff(g)) return `Week ${g.week}`;
  if (g.round === 3) return superBowlName(year);
  if (g.round === 2) return `${g.conf} Championship`;
  return `${g.conf} ${ROUND_NAMES[g.round]}`;
}

// Is the user still alive in the playoffs?
export function userAlive(s) {
  if (s.phase !== 'playoffs' || !s.bracket) return false;
  const seeds = [...s.bracket.seeds.AFC, ...s.bracket.seeds.NFC];
  if (!seeds.includes(s.userId)) return false;
  for (const list of s.bracket.rounds) for (const g of list) if ((g.home === s.userId || g.away === s.userId) && winnerOf(g) && winnerOf(g) !== s.userId) return false;
  return true;
}

// ---------------------------------------------------------------- awards

// Season lines in the shape the awards engine reads: positions and slots
// from the depth charts, and a season grade for the men the box score
// doesn't show (linemen, coverage), from their attributes and how their
// unit did.
export function awardLines(s, rosters, teams = TEAMS) {
  const lines = [];
  for (const t of teams) {
    const roster = rosters[t.id];
    if (!roster) continue;
    const ts = s.teams[t.id] || {};
    const g = Math.max(1, ts.games || 1);
    const depth = roster.depth;
    const slotOf = (p) => {
      const ol = (depth.OL || []).indexOf(p.id);
      if (p.pos === 'OL' && ol >= 0 && ol < 5) return ['LT', 'LG', 'C', 'RG', 'RT'][ol];
      if (p.pos === 'RB' && /FB/.test(p.posDetail || '')) return 'FB';
      if ((depth.EDGE || []).slice(0, 2).includes(p.id)) return 'EDGE';
      if (p.pos === 'CB' && ((depth.CB || []).indexOf(p.id) === 2 || /NCB/.test(p.posDetail || ''))) return 'slot';
      return p.pos;
    };
    for (const p of roster.players) {
      const l = s.players[p.id];
      if (!l) continue;
      const a = p.attrs || {};
      const pts = (ts.pts || 0) / g;
      const opp = (ts.opp || 0) / g;
      let grade = 60;
      if (p.pos === 'OL') grade = (a.pbk + a.rbk) / 2 + (pts - 21) * 0.4;
      else if (p.pos === 'TE' || (p.pos === 'RB' && slotOf(p) === 'FB')) grade = (a.rbk + a.cth) / 2 + (pts - 21) * 0.3;
      else if (p.pos === 'CB' || p.pos === 'S') grade = ((a.mcv + a.zcv) / 2 + a.bsk * 0.3) / 1.3 + (21 - opp) * 0.4;
      else if (p.pos === 'DL') grade = (a.prs + a.rsd) / 2 + (21 - opp) * 0.3;
      grade += ((hashString(`${s.seed}:${s.year}:${p.id}`) % 1000) / 1000 - 0.5) * 6;
      lines.push({ ...l, team: t.id, pos: p.pos, slot: slotOf(p), rookie: p.exp === 0, grade: clamp(grade, 0, 100), first: p.first, last: p.last });
    }
  }
  return lines;
}

export function computeAwards(s, rosters, teams = TEAMS) {
  if (!rosters) return null;
  const st = seasonStandings(s, teams);
  const tl = teams.map((t) => {
    const r = st.rows[t.id];
    const coach = t.id === s.userId ? 'You' : COACHES[t.id] || `${t.city} head coach`;
    return { id: t.id, wins: r.w, losses: r.l, coach, lastWins: (s.last[t.id] || {}).w || 0 };
  });
  const { awards, allPro } = seasonAwards({ lines: awardLines(s, rosters, teams), teams: tl });
  const pick = (l) => (l ? { id: l.id, name: `${l.first} ${l.last}`, short: l.name, pos: l.pos, team: l.team } : null);
  const out = {};
  for (const [k, v] of Object.entries(awards)) out[k] = k === 'COY' ? (v ? { coach: v.coach, team: v.id, wins: v.wins } : null) : pick(v);
  const ap = { first: allPro.first.map((x) => ({ slot: x.slot, ...pick(x.line) })), second: allPro.second.map((x) => ({ slot: x.slot, ...pick(x.line) })) };
  return { awards: out, allPro: ap };
}

// League leaders from the season lines.
export const LEADER_CATS = [
  { id: 'passYds', label: 'Passing yards', get: (l) => (l.pass && l.pass.yds) || 0 },
  { id: 'passTd', label: 'Passing TDs', get: (l) => (l.pass && l.pass.td) || 0 },
  { id: 'rushYds', label: 'Rushing yards', get: (l) => (l.rush && l.rush.yds) || 0 },
  { id: 'rushTd', label: 'Rushing TDs', get: (l) => (l.rush && l.rush.td) || 0 },
  { id: 'recYds', label: 'Receiving yards', get: (l) => (l.rec && l.rec.yds) || 0 },
  { id: 'rec', label: 'Receptions', get: (l) => (l.rec && l.rec.rec) || 0 },
  { id: 'recTd', label: 'Receiving TDs', get: (l) => (l.rec && l.rec.td) || 0 },
  { id: 'sacks', label: 'Sacks', get: (l) => (l.def && l.def.sacks) || 0 },
  { id: 'int', label: 'Interceptions', get: (l) => (l.def && l.def.int) || 0 },
  { id: 'tkl', label: 'Tackles', get: (l) => (l.def && l.def.tkl) || 0 },
  { id: 'fgm', label: 'Field goals', get: (l) => (l.kick && l.kick.fgm) || 0 },
];

export function leaders(s, catId, n = 10) {
  const cat = LEADER_CATS.find((c) => c.id === catId) || LEADER_CATS[0];
  return Object.values(s.players).map((l) => ({ l, v: cat.get(l) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, n);
}

export { offenseScore, defenseScore };
