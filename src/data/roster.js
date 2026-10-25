// Generates fictional rosters with hidden attributes and builds depth charts.
// Attributes are 0-100 and are NEVER shown in the UI (badges only).

import { TEAMS } from './teams.js';
import { FIRST_NAMES, LAST_NAMES, COLLEGES } from './names.js';
import { makeRng, hashString } from '../core/rng.js';
import { clamp } from '../core/util.js';

export const POS_LIST = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P'];

export const POS_NAME = {
  QB: 'Quarterback', RB: 'Running Back', WR: 'Wide Receiver', TE: 'Tight End', OL: 'Offensive Line',
  DL: 'Defensive Line', LB: 'Linebacker', CB: 'Cornerback', S: 'Safety', K: 'Kicker', P: 'Punter',
};

export const ROSTER_COUNTS = { QB: 3, RB: 4, WR: 6, TE: 3, OL: 9, DL: 9, LB: 7, CB: 6, S: 4, K: 1, P: 1 };
export const STARTERS = { QB: 1, RB: 1, WR: 3, TE: 1, OL: 5, DL: 4, LB: 3, CB: 3, S: 2, K: 1, P: 1 };

export const ATTRS = [
  'spd', 'acc', 'agi', 'str', 'awr', // athletic + awareness
  'thp', 'tha', 'dec', // passing
  'car', 'elu', 'cth', 'rte', // ball skills
  'rbk', 'pbk', // blocking
  'prs', 'rsd', 'tkl', 'mcv', 'zcv', 'bsk', // defense
  'kpw', 'kac', // kicking
];

// [mean, sd] per position. Unlisted attributes default to [32, 8].
export const PROFILE = {
  QB: { spd: [64, 10], acc: [68, 8], agi: [64, 9], str: [58, 8], awr: [72, 9], thp: [82, 6], tha: [78, 7], dec: [74, 9], car: [62, 8], elu: [55, 12], cth: [30, 8], tkl: [25, 6] },
  RB: { spd: [86, 4], acc: [87, 4], agi: [86, 5], str: [66, 8], awr: [66, 9], car: [78, 8], elu: [78, 9], cth: [64, 10], rte: [55, 9], pbk: [52, 10], rbk: [45, 9], tkl: [30, 8] },
  WR: { spd: [88, 4], acc: [87, 4], agi: [86, 5], str: [52, 8], awr: [66, 9], car: [66, 8], elu: [70, 9], cth: [78, 7], rte: [76, 8], rbk: [42, 9], tkl: [28, 8] },
  TE: { spd: [77, 5], acc: [76, 5], agi: [70, 6], str: [72, 7], awr: [66, 9], car: [64, 8], elu: [55, 10], cth: [72, 8], rte: [64, 9], rbk: [66, 9], pbk: [58, 9], tkl: [34, 8] },
  OL: { spd: [52, 6], acc: [62, 6], agi: [50, 7], str: [84, 5], awr: [68, 9], rbk: [76, 7], pbk: [76, 7], tkl: [30, 6] },
  DL: { spd: [68, 8], acc: [73, 7], agi: [62, 8], str: [83, 6], awr: [64, 9], prs: [72, 9], rsd: [73, 8], tkl: [66, 8], zcv: [28, 8], mcv: [24, 6] },
  LB: { spd: [79, 5], acc: [80, 5], agi: [73, 6], str: [72, 6], awr: [68, 9], prs: [56, 12], rsd: [68, 9], tkl: [75, 7], mcv: [58, 9], zcv: [66, 9], bsk: [50, 10] },
  CB: { spd: [88, 4], acc: [88, 4], agi: [87, 5], str: [52, 7], awr: [66, 9], tkl: [58, 9], mcv: [76, 8], zcv: [72, 8], bsk: [68, 10], cth: [50, 9], rsd: [42, 8] },
  S: { spd: [84, 4], acc: [84, 5], agi: [80, 6], str: [62, 7], awr: [70, 9], tkl: [70, 8], mcv: [64, 9], zcv: [74, 8], bsk: [66, 10], rsd: [55, 9], cth: [48, 9] },
  K: { spd: [52, 8], acc: [55, 8], str: [45, 8], awr: [60, 10], kpw: [80, 8], kac: [80, 8] },
  P: { spd: [52, 8], acc: [55, 8], str: [45, 8], awr: [60, 10], kpw: [78, 8], kac: [74, 9] },
};

// Football-skill blend per position (the "Skill" badge). Never includes
// speed or strength, and is never an overall.
export const SKILL_WEIGHTS = {
  QB: { tha: 0.45, thp: 0.3, dec: 0.25 },
  RB: { elu: 0.4, car: 0.25, cth: 0.2, pbk: 0.15 },
  WR: { rte: 0.45, cth: 0.45, elu: 0.1 },
  TE: { cth: 0.35, rte: 0.25, rbk: 0.25, pbk: 0.15 },
  OL: { pbk: 0.5, rbk: 0.5 },
  DL: { prs: 0.55, rsd: 0.45 },
  LB: { tkl: 0.35, rsd: 0.25, zcv: 0.25, mcv: 0.15 },
  CB: { mcv: 0.45, zcv: 0.3, bsk: 0.25 },
  S: { zcv: 0.35, tkl: 0.25, bsk: 0.25, mcv: 0.15 },
  K: { kac: 0.55, kpw: 0.45 },
  P: { kpw: 0.6, kac: 0.4 },
};

// Hidden value used only to order the depth chart.
const VALUE_WEIGHTS = {
  QB: { tha: 0.32, thp: 0.22, dec: 0.26, spd: 0.08, awr: 0.12 },
  RB: { spd: 0.22, acc: 0.12, elu: 0.26, car: 0.15, str: 0.1, cth: 0.1, pbk: 0.05 },
  WR: { spd: 0.25, rte: 0.3, cth: 0.3, acc: 0.08, elu: 0.07 },
  TE: { cth: 0.25, rte: 0.15, rbk: 0.2, pbk: 0.1, spd: 0.15, str: 0.15 },
  OL: { pbk: 0.38, rbk: 0.38, str: 0.2, awr: 0.04 },
  DL: { prs: 0.38, rsd: 0.28, str: 0.18, acc: 0.1, spd: 0.06 },
  LB: { tkl: 0.25, rsd: 0.2, zcv: 0.15, mcv: 0.1, spd: 0.18, awr: 0.12 },
  CB: { mcv: 0.3, zcv: 0.22, bsk: 0.13, spd: 0.25, acc: 0.1 },
  S: { zcv: 0.26, tkl: 0.18, bsk: 0.14, mcv: 0.1, spd: 0.2, awr: 0.12 },
  K: { kac: 0.55, kpw: 0.45 },
  P: { kpw: 0.6, kac: 0.4 },
};

export const SKILL_ATTRS = new Set(['thp', 'tha', 'dec', 'car', 'elu', 'cth', 'rte', 'rbk', 'pbk', 'prs', 'rsd', 'tkl', 'mcv', 'zcv', 'bsk', 'kpw', 'kac', 'awr']);

export const HEIGHT = { QB: [75, 1.5], RB: [70.5, 1.5], WR: [73, 2], TE: [77, 1], OL: [77, 1], DL: [76, 1.5], LB: [74, 1], CB: [71.5, 1.2], S: [72.5, 1.2], K: [72, 2], P: [74, 2] };
export const WEIGHT = { QB: [222, 10], RB: [214, 12], WR: [200, 12], TE: [252, 8], OL: [314, 10], DL: [295, 25], LB: [238, 9], CB: [192, 7], S: [205, 7], K: [195, 15], P: [210, 15] };

export const NUMBER_RANGES = {
  QB: [[1, 19]], RB: [[20, 39], [0, 9]], WR: [[10, 19], [80, 89], [0, 9]], TE: [[80, 89], [40, 49]],
  OL: [[60, 79], [50, 59]], DL: [[90, 99], [50, 59]], LB: [[40, 59], [0, 9]], CB: [[20, 39], [0, 9]],
  S: [[20, 49]], K: [[1, 9]], P: [[1, 19]],
};

export function valueOf(p) {
  const w = VALUE_WEIGHTS[p.pos];
  let v = 0;
  for (const k in w) v += w[k] * p.attrs[k];
  return v;
}

export function skillOf(p) {
  const w = SKILL_WEIGHTS[p.pos];
  let v = 0;
  for (const k in w) v += w[k] * p.attrs[k];
  return v;
}

let nextId = 1;

function pickNumber(rng, pos, used) {
  for (const [a, b] of NUMBER_RANGES[pos]) {
    const options = [];
    for (let n = a; n <= b; n++) if (!used.has(n)) options.push(n);
    if (options.length) {
      const n = rng.pick(options);
      used.add(n);
      return n;
    }
  }
  for (let n = 0; n < 100; n++) if (!used.has(n)) { used.add(n); return n; }
  return 0;
}

function makePlayer(rng, pos, teamId, quality, teamTalent) {
  const prof = PROFILE[pos];
  const attrs = {};
  // "talent" correlates a player's football skills; athletic traits vary independently.
  const talent = rng.normal(0, 1);
  for (const k of ATTRS) {
    const [m, sd] = prof[k] || [32, 8];
    let v = rng.normal(m, sd * 0.8);
    if (SKILL_ATTRS.has(k) && prof[k]) v += talent * sd * 0.55 + quality + teamTalent;
    else if (prof[k] && (k === 'spd' || k === 'acc' || k === 'agi' || k === 'str')) v += quality * 0.35;
    attrs[k] = Math.round(clamp(v, 15, 99));
  }
  const age = clamp(Math.round(rng.normal(26.3, 3.1)), 21, pos === 'K' || pos === 'P' ? 40 : 36);
  const [hm, hs] = HEIGHT[pos];
  const [wm, ws] = WEIGHT[pos];
  return {
    id: nextId++,
    teamId,
    first: rng.pick(FIRST_NAMES),
    last: rng.pick(LAST_NAMES),
    pos,
    num: 0,
    age,
    exp: clamp(age - 22 + rng.int(-1, 1), 0, 18),
    college: rng.pick(COLLEGES),
    height: Math.round(rng.normal(hm, hs)),
    weight: Math.round(rng.normal(wm, ws)),
    attrs,
    // Personality (hidden), used by contract talks in milestone 4.
    traits: {
      loyalty: rng.int(1, 10),
      greed: rng.int(1, 10),
      competitor: rng.int(1, 10),
      ego: rng.int(1, 10),
    },
    skinTone: rng.int(0, 5),
    badges: null,
  };
}

export function generateTeamRoster(team, seed) {
  const rng = makeRng(seed ^ hashString(team.id));
  const teamTalent = clamp(rng.normal(0, 2.8), -6, 6);
  const players = [];
  const used = new Set();
  for (const pos of POS_LIST) {
    const n = ROSTER_COUNTS[pos];
    const starters = STARTERS[pos];
    for (let i = 0; i < n; i++) {
      const quality = i < starters ? 3 : -4 - (i - starters) * 0.8;
      const p = makePlayer(rng, pos, team.id, quality, teamTalent);
      players.push(p);
    }
  }
  for (const p of players) p.num = pickNumber(rng, p.pos, used);
  return { teamId: team.id, players, depth: buildDepthChart(players) };
}

export function buildDepthChart(players) {
  const depth = {};
  for (const pos of POS_LIST) {
    depth[pos] = players
      .filter((p) => p.pos === pos)
      .sort((a, b) => valueOf(b) - valueOf(a))
      .map((p) => p.id);
  }
  // pass rushers: the two best rushing linemen; the rest of DL stays interior-first
  const dl = players.filter((p) => p.pos === 'DL');
  const edges = [...dl].sort((a, b) => b.attrs.prs - a.attrs.prs).slice(0, 2);
  depth.EDGE = edges.map((p) => p.id).concat(dl.filter((p) => !edges.includes(p)).sort((a, b) => b.attrs.prs - a.attrs.prs).map((p) => p.id));
  depth.DL = dl.filter((p) => !edges.includes(p)).sort((a, b) => valueOf(b) - valueOf(a)).map((p) => p.id).concat(edges.map((p) => p.id));
  return depth;
}

export function generateLeague(seed = 2026) {
  nextId = 1;
  const rosters = {};
  for (const t of TEAMS) rosters[t.id] = generateTeamRoster(t, seed);
  return rosters;
}

export function playerName(p, short = false) {
  return short ? `${p.first[0]}. ${p.last}` : `${p.first} ${p.last}`;
}

export function heightStr(inches) {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}
