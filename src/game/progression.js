// A year older: how players develop, peak and decline over an offseason,
// and when they retire. All hidden: the user sees it as badges moving.
//
// Speed and quickness come early and go first (running backs and corners
// before anyone); strength builds into the late twenties; football skill
// and awareness grow fastest in a player's first few years and hold into
// his thirties (quarterbacks, kickers and punters longest). Each player
// also has a hidden development trait (p.dev, -1 to 1: some come on faster
// than others) and his competitiveness speeds it up a little. Pure logic:
// no DOM; every draw from the seeded RNG passed in.

import { SKILL_WEIGHTS, ATTRS } from '../data/roster.js';
import { hashString } from '../core/rng.js';
import { clamp } from '../core/util.js';

const PHYS = ['spd', 'acc', 'agi'];
// when speed starts to go, by position
const SPEED_GOES = { RB: 27, WR: 28, CB: 28, S: 29, LB: 29, TE: 29, QB: 30, DL: 29, OL: 30, K: 33, P: 33 };
// how many years later than usual skills peak and fade
const SKILL_SHIFT = { QB: 3, K: 5, P: 5, OL: 1 };

// A hidden development trait for players who don't have one yet (the real
// league), steady from their id.
export function devTrait(p) {
  if (typeof p.dev === 'number') return p.dev;
  const u = (hashString(`dev:${p.id}`) % 10000) / 10000;
  return Math.round((u * 2 - 1) * 100) / 100;
}

// Skill growth (per year) by age, before the position shift.
function skillStep(age) {
  if (age <= 21) return 3.3;
  if (age <= 22) return 2.8;
  if (age <= 23) return 2.2;
  if (age <= 24) return 1.6;
  if (age <= 25) return 1.0;
  if (age <= 26) return 0.5;
  if (age <= 27) return 0.1;
  if (age <= 28) return -0.3;
  if (age <= 29) return -0.7;
  if (age <= 30) return -1.2;
  if (age <= 31) return -1.8;
  if (age <= 32) return -2.4;
  if (age <= 33) return -3;
  return -3.8;
}

// One offseason for one player: changes attrs in place, returns the net
// change in his position's key skills (for the "who got better" list).
export function developPlayer(p, rng) {
  const a = p.attrs;
  const age = p.age; // before his birthday
  const dev = devTrait(p);
  const comp = (((p.traits && p.traits.competitor) || 5) - 5.5) / 4.5; // -1..1
  const keys = new Set([...Object.keys(SKILL_WEIGHTS[p.pos] || {}), 'awr', ...(p.pos === 'QB' ? ['dec'] : [])]);
  const before = skillScore(p);
  const shift = SKILL_SHIFT[p.pos] || 0;
  // (the late bloomers' positions grow on the usual clock and fade later)
  let step = skillStep(age);
  if (step < 0 && shift) step = Math.min(0, skillStep(age - shift));
  if (step > 0) step *= 1 + 0.45 * dev + 0.2 * comp;
  else step *= 1 - 0.25 * dev - 0.1 * comp;
  for (const k of ATTRS) {
    let d = 0;
    if (keys.has(k)) d = step + rng.normal(0, 1.3);
    else if (PHYS.includes(k)) {
      const goes = SPEED_GOES[p.pos] || 29;
      if (age < 23) d = 0.8 + rng.normal(0, 0.8);
      else if (age >= goes) d = -(1 + 0.6 * (age - goes)) + rng.normal(0, 0.8) + 0.3 * dev;
      else d = rng.normal(0, 0.5);
    } else if (k === 'str') {
      if (age < 26) d = 1 + rng.normal(0, 0.8);
      else if (age >= 31) d = -1 + rng.normal(0, 0.6);
      else d = rng.normal(0, 0.4);
    } else continue; // off-position skills don't move
    a[k] = clamp(Math.round(a[k] + d), 15, 99);
  }
  // awareness keeps coming with experience
  if (age < 31 + shift) a.awr = clamp(a.awr + (rng.chance(0.6) ? 1 : 0), 15, 99);
  return skillScore(p) - before;
}

function skillScore(p) {
  const w = SKILL_WEIGHTS[p.pos] || {};
  let v = 0;
  for (const k in w) v += w[k] * p.attrs[k];
  return v;
}

// Chance he retires this offseason. pct: where he stands at his position
// (0-1); the great ones hang on longer.
export function retireChance(p, pct = 0.5) {
  const age = p.age - (p.pos === 'QB' ? 4 : p.pos === 'K' || p.pos === 'P' ? 6 : 0);
  let c;
  if (age < 28) c = 0.006;
  else if (age < 30) c = 0.03;
  else if (age < 31) c = 0.07;
  else if (age < 32) c = 0.11;
  else if (age < 33) c = 0.16;
  else if (age < 34) c = 0.23;
  else if (age < 35) c = 0.32;
  else if (age < 36) c = 0.42;
  else if (age < 37) c = 0.55;
  else c = 0.7;
  return clamp(c * (1.5 - pct), 0, 0.95);
}
