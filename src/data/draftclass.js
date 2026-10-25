// Draft classes: about 260 college prospects a year, with combine results.
//
// A prospect's real ability is hidden like everyone's. What a GM gets to
// see is the combine (40-yard dash, bench press, vertical and broad jumps,
// 3-cone, shuttle), shown as badges ranked within the class at his
// position, and a consensus big board: the scouts' order, which is close
// to the truth at the top and noisier the further down it goes. Rookies
// arrive raw: most of their growth is ahead of them (src/game/
// progression.js). Pure data/logic: no DOM.

import { makeRng, hashString } from '../core/rng.js';
import { clamp } from '../core/util.js';
import { FIRST_NAMES, LAST_NAMES, COLLEGES } from './names.js';
import { PROFILE, SKILL_ATTRS, HEIGHT, WEIGHT, ATTRS, valueOf } from './roster.js';
import { TIERS } from '../game/badges.js';

// how many of each position come out in a year
const CLASS_MIX = { QB: 14, RB: 22, WR: 36, TE: 16, OL: 44, DL: 38, LB: 28, CB: 32, S: 20, K: 4, P: 4 };
// how far below a veteran a typical rookie's football skills are
const ROOKIE_GAP = 9;

export const DRILLS = [
  { id: 'forty', label: '40-yard dash', lowerIsBetter: true },
  { id: 'bench', label: 'Bench press' },
  { id: 'vertical', label: 'Vertical jump' },
  { id: 'broad', label: 'Broad jump' },
  { id: 'cone', label: '3-cone drill', lowerIsBetter: true },
  { id: 'shuttle', label: 'Shuttle', lowerIsBetter: true },
];
// the combine badge's icon: which of the three badge stats it looks like
export const DRILL_ICON = { forty: 'speed', bench: 'strength', vertical: 'speed', broad: 'strength', cone: 'skill', shuttle: 'skill' };

function measure(p, rng) {
  const a = p.attrs;
  const skip = () => rng.chance(0.08);
  return {
    forty: skip() ? null : Math.round((5.62 - (a.spd - 40) * 0.0255 + rng.normal(0, 0.035)) * 100) / 100,
    bench: skip() ? null : Math.max(4, Math.round((a.str - 38) * 0.55 + rng.normal(0, 2))),
    vertical: skip() ? null : Math.round((24 + (a.acc + a.agi - 100) * 0.12 + rng.normal(0, 1.5)) * 2) / 2,
    broad: skip() ? null : Math.round(100 + (a.acc + a.spd - 100) * 0.3 + rng.normal(0, 3)),
    cone: skip() ? null : Math.round((8.05 - (a.agi - 40) * 0.022 + rng.normal(0, 0.06)) * 100) / 100,
    shuttle: skip() ? null : Math.round((4.92 - (a.agi - 40) * 0.012 + rng.normal(0, 0.04)) * 100) / 100,
  };
}

function prospect(rng, year, n, pos, talent) {
  const prof = PROFILE[pos];
  const attrs = {};
  for (const k of ATTRS) {
    const [m, sd] = prof[k] || [32, 8];
    let v;
    if (SKILL_ATTRS.has(k) && prof[k]) v = m - ROOKIE_GAP + talent * sd * 0.9 + rng.normal(0, sd * 0.45);
    else if (prof[k]) v = rng.normal(m, sd * 0.85) + talent * 1.2;
    else v = rng.normal(m, sd * 0.8);
    attrs[k] = Math.round(clamp(v, 15, 99));
  }
  const [hm, hs] = HEIGHT[pos];
  const [wm, ws] = WEIGHT[pos];
  const age = rng.pick([21, 21, 22, 22, 22, 23]);
  return {
    id: `d${year}_${n}`,
    teamId: null,
    first: rng.pick(FIRST_NAMES),
    last: rng.pick(LAST_NAMES),
    pos,
    num: 0,
    age,
    exp: 0,
    college: rng.pick(COLLEGES),
    height: Math.round(rng.normal(hm, hs)),
    weight: Math.round(rng.normal(wm, ws)),
    attrs,
    traits: {
      loyalty: rng.int(1, 10),
      greed: rng.int(1, 10),
      competitor: rng.int(1, 10),
      ego: rng.int(1, 10),
      durability: rng.int(2, 10),
    },
    skinTone: rng.int(0, 5),
    // how fast he'll come on (hidden): the best prospects lean high
    dev: Math.round(clamp(rng.normal(0.1 + talent * 0.15, 0.45), -1, 1) * 100) / 100,
    portrait: false,
    rookieYear: year,
    badges: null,
  };
}

// Combine badges: each drill ranked within the class at his position
// (Franchise Altering: the single best result in the whole class).
function combineBadges(list) {
  const CUTS = [0.4, 0.67, 0.87, 0.96];
  const tier = (u) => TIERS[CUTS.findIndex((c) => u < c) === -1 ? 4 : CUTS.findIndex((c) => u < c)];
  for (const p of list) p.combineBadges = {};
  for (const d of DRILLS) {
    const by = {};
    for (const p of list) if (p.combine[d.id] != null) (by[p.pos] ||= []).push(p);
    for (const group of Object.values(by)) {
      group.sort((a, b) => (d.lowerIsBetter ? b.combine[d.id] - a.combine[d.id] : a.combine[d.id] - b.combine[d.id]));
      group.forEach((p, i) => { p.combineBadges[d.id] = tier(group.length > 1 ? i / (group.length - 1) : 0.5); });
    }
    const all = list.filter((p) => p.combine[d.id] != null);
    if (!all.length) continue;
    const best = all.reduce((x, y) => ((d.lowerIsBetter ? y.combine[d.id] < x.combine[d.id] : y.combine[d.id] > x.combine[d.id]) ? y : x));
    best.combineBadges[d.id] = 'franchise';
  }
}

// How much each position is worth a high pick (quarterbacks and pass
// rushers go early; kickers and punters late, if at all).
const POS_WEIGHT = { QB: 1.35, DL: 1.15, WR: 1.1, OL: 1.05, CB: 1.05, LB: 0.9, S: 0.9, TE: 0.85, RB: 0.85, K: 0.3, P: 0.25 };

// What a prospect is really worth to a team picking him (hidden): how far
// above the class at his position he is, what the position's worth, and
// how much he'll grow. Set on each prospect as p.draftValue.
function scoreClass(list) {
  const by = {};
  for (const p of list) (by[p.pos] ||= []).push(p);
  for (const group of Object.values(by)) {
    const v = group.map(valueOf);
    const m = v.reduce((x, y) => x + y, 0) / v.length;
    const sd = Math.sqrt(v.reduce((x, y) => x + (y - m) ** 2, 0) / v.length) || 1;
    for (const p of group) {
      const z = (valueOf(p) - m) / sd;
      p.draftValue = Math.round(((POS_WEIGHT[p.pos] || 1) * (z + 1.5) + (22.5 - p.age) * 0.15 + p.dev * 0.35) * 1000) / 1000;
    }
  }
}

export function prospectValue(p) {
  return p.draftValue ?? valueOf(p) / 30;
}

// A street free agent: somebody a team can always sign at a position it's
// short at (a journeyman, not much more).
export function streetFreeAgent(pos, year, rng) {
  const p = prospect(rng, year, `fa${Math.floor(rng.next() * 1e9)}`, pos, -1.1);
  p.id = `sfa${year}_${Math.floor(rng.next() * 1e9)}`;
  p.age = rng.int(24, 29);
  p.exp = p.age - 22;
  delete p.rookieYear;
  return p;
}

export function makeDraftClass(year, seed = year) {
  const rng = makeRng((seed ^ hashString(`draft${year}`)) >>> 0);
  const list = [];
  let n = 0;
  for (const [pos, count] of Object.entries(CLASS_MIX)) {
    for (let i = 0; i < count; i++) {
      // a class has a few stars, a good first round, and a long tail
      const talent = rng.normal(-0.35, 0.85) + (rng.chance(0.06) ? 1.1 : 0);
      list.push(prospect(rng, year, n++, pos, talent));
    }
  }
  for (const p of list) p.combine = measure(p, rng);
  combineBadges(list);
  scoreClass(list);
  // the consensus board: truth plus scouting noise that grows down the list
  const truth = [...list].sort((a, b) => prospectValue(b) - prospectValue(a));
  truth.forEach((p, i) => { p.boardScore = -i + rng.normal(0, 2 + i * 0.12); });
  list.sort((a, b) => b.boardScore - a.boardScore);
  list.forEach((p, i) => { p.board = i + 1; delete p.boardScore; });
  return list;
}
