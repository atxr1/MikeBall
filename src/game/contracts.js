// Money: the salary cap, minimum salaries, the rookie wage scale, what a
// player is worth on the market, and cap math for a team.
//
// A contract is { type, apy, capHit, years, guaranteed, fa, signed }:
//   apy         average per year (each year's cap hit, kept flat here)
//   years       years left, this season included
//   guaranteed  guaranteed money still owed (it accelerates onto the cap as
//               dead money if he's released)
//   fa          the league year he becomes a free agent (year + years)
// The real 2026 contracts come from the asset pack (estimates); anyone
// without one (the generated league) gets a market-rate deal.
//
// Market value is hidden, like ratings: it's built from the same
// position-weighted skills the depth chart uses, ranked within the
// position, then shaped by what that position is paid and by age. Players
// only ever show badges; money is fine to show. Pure logic: no DOM.

import { valueOf } from '../data/roster.js';
import { clamp } from '../core/util.js';

// NFL salary cap: $301.2M in 2026 (NFL, Feb 2026); after that it grows
// about 6.5% a year, as it has over the last five.
export const CAP_2026 = 301_200_000;
export function capFor(year) {
  if (year <= 2026) return CAP_2026;
  return Math.round((CAP_2026 * 1.065 ** (year - 2026)) / 100_000) * 100_000;
}

// League minimums by credited seasons (2026 CBA figures, rising with the
// cap after).
const MINIMUM_2026 = [885_000, 1_030_000, 1_105_000, 1_180_000, 1_330_000, 1_330_000, 1_330_000, 1_425_000];
export function minSalary(exp, year) {
  const base = MINIMUM_2026[Math.min(Math.max(0, exp | 0), MINIMUM_2026.length - 1)];
  return Math.round((base * capFor(year)) / CAP_2026 / 5_000) * 5_000;
}

// Rookie wage scale by overall pick: about $11M a year for the first pick,
// $3.4M for the last of the first round, then down to the minimum. Four
// years, fully guaranteed in the first round.
export function rookieDeal(overall, year) {
  const k = capFor(year) / CAP_2026;
  let apy;
  if (overall <= 32) apy = 3_400_000 + (11_000_000 - 3_400_000) * ((32 - overall) / 31) ** 1.6;
  else if (overall <= 64) apy = 1_750_000 + (2_700_000 - 1_750_000) * ((64 - overall) / 31);
  else if (overall <= 100) apy = 1_250_000 + 300_000 * ((100 - overall) / 36);
  else apy = 1_030_000 + 150_000 * Math.max(0, (180 - overall) / 80);
  apy = Math.round((apy * k) / 5_000) * 5_000;
  const guaranteed = overall <= 32 ? apy * 4 : overall <= 64 ? Math.round(apy * 4 * 0.55) : Math.round(apy * 0.3);
  return { type: 'rookie', apy, capHit: apy, years: 4, guaranteed, fa: year + 4, signed: year };
}

// What the top of each position is paid (2026 dollars), and where a
// position's prime ends.
const TOP_PAY = { QB: 58e6, EDGE: 42e6, WR: 38e6, DL: 31e6, OL: 28e6, CB: 28e6, S: 21e6, LB: 20e6, TE: 17e6, RB: 15e6, K: 6e6, P: 4e6 };
const PRIME_ENDS = { QB: 34, RB: 27, WR: 29, TE: 30, OL: 31, DL: 30, EDGE: 29, LB: 29, CB: 29, S: 30, K: 37, P: 37 };

// The league's value ladder by position, for percentiles. players: all of
// them. Build once per offseason (or season start) and pass around.
export function marketBook(players) {
  const by = {};
  for (const p of players) (by[p.pos] ||= []).push(valueOf(p));
  for (const k of Object.keys(by)) by[k].sort((a, b) => a - b);
  return by;
}

export function percentile(book, p) {
  const list = book[p.pos] || [];
  if (!list.length) return 0.5;
  const v = valueOf(p);
  let lo = 0;
  let hi = list.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (list[m] < v) lo = m + 1; else hi = m; }
  return clamp(lo / Math.max(1, list.length - 1), 0, 1);
}

// edge: is he a pass rusher (paid like one)? Read off the depth chart.
export function payGroup(p, edge = false) {
  return edge && (p.pos === 'DL' || p.pos === 'LB') ? 'EDGE' : p.pos;
}

export function ageFactor(p, group = p.pos) {
  const end = PRIME_ENDS[group] || 29;
  if (p.age > end) return clamp(1 - 0.13 * (p.age - end), 0.25, 1);
  if (p.age <= 23) return 0.92;
  return 1;
}

// What he'd get on the open market this year, per year.
export function marketValue(p, book, year, edge = false) {
  const group = payGroup(p, edge);
  const pct = percentile(book, p);
  const top = TOP_PAY[group] || 10e6;
  const min = minSalary(p.exp || 0, year);
  const curve = 0.88 * pct ** 6 + 0.12 * pct ** 2;
  const k = capFor(year) / CAP_2026;
  const apy = Math.max(min, min + (top * k - min) * curve * ageFactor(p, group));
  return Math.round(apy / 50_000) * 50_000;
}

// How long he wants to be signed for, by age.
export function askYears(p) {
  if (p.age <= 25) return 4;
  if (p.age <= 28) return 4;
  if (p.age <= 30) return 3;
  if (p.age <= 32) return 2;
  return 1;
}

export function marketContract(p, book, year, edge = false) {
  const apy = marketValue(p, book, year, edge);
  const years = askYears(p);
  const pct = percentile(book, p);
  const guaranteed = Math.round(apy * years * (0.15 + 0.5 * pct ** 2));
  return { type: apy <= minSalary(p.exp || 0, year) * 1.05 ? 'min' : 'veteran', apy, capHit: apy, years, guaranteed, fa: year + years, signed: year };
}

// Fills in a contract for anyone who doesn't have one.
export function ensureContracts(rosters, year) {
  const all = Object.values(rosters).flatMap((r) => r.players);
  const book = marketBook(all);
  for (const r of Object.values(rosters)) {
    const edges = new Set((r.depth.EDGE || []).slice(0, 2));
    for (const p of r.players) {
      if (p.contract && p.contract.apy) continue;
      const c = marketContract(p, book, year, edges.has(p.id));
      // already partway through it
      c.years = 1 + (Math.abs(String(p.id).split('').reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)) % c.years);
      c.fa = year + c.years;
      p.contract = c;
    }
  }
}

// ---- a team's cap ----------------------------------------------------------

// Cap hits this year for the players on the team, plus dead money.
export function payroll(roster, deadThisYear = 0) {
  let sum = deadThisYear;
  for (const p of roster.players) sum += (p.contract && p.contract.capHit) || 0;
  return sum;
}

// Committed money in a future year (players under contract then).
export function committed(roster, year, thisYear) {
  let sum = 0;
  for (const p of roster.players) {
    const c = p.contract;
    if (c && c.years > year - thisYear) sum += c.apy;
  }
  return sum;
}

export function fmtMoney(n) {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, '')}M` : a >= 1e3 ? `$${Math.round(a / 1e3)}K` : `$${a}`;
  return n < 0 ? `-${s}` : s;
}
