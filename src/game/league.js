// The league as the front office sees it: every team's roster and depth
// chart, the free agents, dead money on each team's cap, and a log of
// moves. The game's rosters object ({ teamId: { players, depth } }) is the
// live part of it; this adds the rest and turns it all into plain JSON for
// the save (IndexedDB: it's about a megabyte) and back.
//
//   gm = { v, year, rosters, fa: [players], dead: { teamId: { year: $ } },
//          moves: [{ year, week, team, text }] }
//
// Pure logic: no DOM.

import { ensureContracts, payroll, capFor, committed } from './contracts.js';
import { buildDepthChart, POS_LIST } from '../data/roster.js';

export const LEAGUE_VERSION = 1;

// player fields that are derived at load (badges) or cached (none others)
const SKIP = new Set(['badges', 'honors']);
function plain(p) {
  const out = {};
  for (const [k, v] of Object.entries(p)) if (!SKIP.has(k) && v !== undefined) out[k] = v;
  return out;
}

export function newLeagueState(rosters, year) {
  ensureContracts(rosters, year);
  return { v: LEAGUE_VERSION, year, rosters, fa: [], dead: {}, moves: [] };
}

export function serializeLeague(gm) {
  const teams = {};
  for (const [id, r] of Object.entries(gm.rosters)) teams[id] = { depth: r.depth, players: r.players.map(plain) };
  return { v: LEAGUE_VERSION, year: gm.year, teams, fa: gm.fa.map(plain), dead: gm.dead, moves: gm.moves.slice(-400) };
}

// Back from the save. teamIds: the teams the game knows (a save from a
// league with different teams is refused).
export function deserializeLeague(data, teamIds) {
  if (!data || data.v !== LEAGUE_VERSION || !data.teams) return null;
  if (!teamIds.every((id) => data.teams[id] && Array.isArray(data.teams[id].players))) return null;
  const rosters = {};
  for (const id of teamIds) {
    const t = data.teams[id];
    const players = t.players.map((p) => ({ ...p, teamId: id, badges: null }));
    const ids = new Set(players.map((p) => p.id));
    const depth = {};
    const fresh = buildDepthChart(players);
    for (const pos of [...POS_LIST, 'EDGE']) {
      const saved = t.depth && Array.isArray(t.depth[pos]) ? t.depth[pos].filter((pid) => ids.has(pid)) : null;
      depth[pos] = saved || fresh[pos] || [];
    }
    rosters[id] = { teamId: id, players, depth };
  }
  return {
    v: LEAGUE_VERSION,
    year: data.year,
    rosters,
    fa: (data.fa || []).map((p) => ({ ...p, teamId: null, badges: null })),
    dead: data.dead || {},
    moves: data.moves || [],
  };
}

export function allPlayers(gm) {
  return [...Object.values(gm.rosters).flatMap((r) => r.players), ...gm.fa];
}

export function deadMoney(gm, teamId, year = gm.year) {
  return (gm.dead[teamId] && gm.dead[teamId][year]) || 0;
}

// This year's cap picture for a team.
export function capSheet(gm, teamId, year = gm.year) {
  const r = gm.rosters[teamId];
  const dead = deadMoney(gm, teamId, year);
  const used = payroll(r, dead);
  const cap = capFor(year);
  return { cap, used, dead, space: cap - used, next: committed(r, year + 1, year) + deadMoney(gm, teamId, year + 1), nextCap: capFor(year + 1) };
}

export function logMove(gm, team, text, week = null) {
  gm.moves.push({ year: gm.year, week, team, text });
}

// The roster object's id index is cached (personnel.js); a move clears it.
export function touched(roster) {
  delete roster._byId;
}
