// Puts a season's 272 matchups into 18 weeks and TV windows, the way the
// league's schedule makers lay one out:
//
//   - every club plays 17 games and has one bye, between weeks 5 and 14,
//     with 2 to 6 clubs off in any week
//   - week 18 is all division games
//   - Detroit and Dallas host on Thanksgiving
//   - no club sees the same opponent in back-to-back weeks, division
//     rematches are spread out, and three-game road trips are rare
//
// Each week is a set of games where nobody plays twice, so laying out the
// season is coloring the games with weeks. Games go in one at a time; when
// the two clubs have no open week in common, a Kempe swap (trade weeks a
// and b along the chain of games that alternate between them) frees one up,
// and when that fails the game bumps whatever is in its way back into the
// queue. The soft rules are then improved with the same swaps. Seeded and
// deterministic. Pure logic: no DOM.

import { makeRng } from '../core/rng.js';
import { TEAMS } from '../data/teams.js';
import { makeGame, gameDate, firstSunday, addDays, matchups, placesFrom, realSchedule2026, thanksgivingWeek } from './schedule.js';

const WEEKS = 18;
const BYE_FIRST = 5;
const BYE_LAST = 14;
const BYE = 'bye';

export function assignWeeks(list, opts = {}) {
  const rng = opts.rng || makeRng(opts.seed || 1);
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = tryAssign(list, rng, opts.champion, opts.thanksgiving || 12);
    if (res) return res;
  }
  throw new Error('schedule: no week layout found');
}

function tryAssign(list, rng, champion, THANKSGIVING) {
  const teams = [...new Set(list.flatMap((g) => [g.home, g.away]))];
  const games = list.map((g, i) => ({ ...g, i, week: 0, fixed: false }));
  // at[t][w]: club t's game in week w, BYE, or null
  const at = Object.fromEntries(teams.map((t) => [t, Array(WEEKS + 1).fill(null)]));
  const place = (g, w) => { g.week = w; at[g.home][w] = g; at[g.away][w] = g; };
  const lift = (g) => { at[g.home][g.week] = null; at[g.away][g.week] = null; g.week = 0; };

  // byes: ten weeks, an even number of clubs in each, 2 to 6
  const pairs = Array(BYE_LAST - BYE_FIRST + 1).fill(1);
  for (let n = teams.length / 2 - pairs.length; n > 0;) {
    const k = rng.int(0, pairs.length - 1);
    if (pairs[k] < 3) { pairs[k]++; n--; }
  }
  const byeWeeks = [];
  pairs.forEach((n, k) => { for (let j = 0; j < n * 2; j++) byeWeeks.push(BYE_FIRST + k); });
  const bye = {};
  for (const t of rng.shuffle([...teams])) {
    // the Thanksgiving hosts can't be off that week
    const k = byeWeeks.findIndex((w) => !((t === 'DET' || t === 'DAL') && w === THANKSGIVING));
    bye[t] = byeWeeks.splice(k, 1)[0];
    at[t][bye[t]] = BYE;
  }

  // week 18: one division game for everyone
  const rivals = (t) => games.filter((g) => g.kind === 'div' && (g.home === t || g.away === t));
  for (const t of rng.shuffle([...teams])) {
    if (at[t][WEEKS]) continue;
    const open = rivals(t).filter((g) => !at[g.home][WEEKS] && !at[g.away][WEEKS] && !g.week);
    if (!open.length) return null;
    const g = rng.pick(open);
    place(g, WEEKS);
    g.fixed = true;
  }
  // the defending champion opens the season at home
  if (champion && at[champion]) {
    const ok = games.filter((g) => g.home === champion && !g.week && g.kind !== 'div' && !at[g.away][1]);
    if (ok.length) {
      const g = rng.pick(ok);
      place(g, 1);
      g.fixed = true;
    }
  }
  // Thanksgiving: Detroit and Dallas each host someone free that day
  for (const host of ['DET', 'DAL']) {
    if (!at[host]) continue;
    const ok = games.filter((g) => g.home === host && !g.week && !at[g.away][THANKSGIVING] && !at[host][THANKSGIVING]);
    if (!ok.length) return null;
    const g = rng.weighted(ok, (x) => (x.kind === 'div' ? 3 : 1));
    place(g, THANKSGIVING);
    g.fixed = true;
  }

  const freeAt = (t) => {
    const out = [];
    for (let w = 1; w < WEEKS; w++) if (at[t][w] === null) out.push(w);
    return out;
  };
  // trade weeks a and b over the whole chain of games linked through club
  // x in those two weeks. Nobody ends up double-booked; it fails if the
  // chain runs into a bye, a fixed game, or the club in forbid.
  const kempe = (x, a, b, forbid) => {
    const edges = new Set();
    const nodes = new Set([x]);
    const stack = [x];
    while (stack.length) {
      const n = stack.pop();
      for (const c of [a, b]) {
        const g = at[n][c];
        if (g === null || g === BYE || edges.has(g)) continue;
        if (g.fixed) return false;
        edges.add(g);
        for (const m of [g.home, g.away]) if (!nodes.has(m)) { nodes.add(m); stack.push(m); }
      }
    }
    if (forbid && nodes.has(forbid)) return false;
    for (const n of nodes) {
      if ((at[n][a] === BYE && at[n][b] !== null) || (at[n][b] === BYE && at[n][a] !== null)) return false;
    }
    const list = [...edges].map((g) => [g, g.week === a ? b : a]);
    for (const [g] of list) lift(g);
    for (const [g, w] of list) place(g, w);
    return true;
  };

  const queue = rng.shuffle(games.filter((g) => !g.week));
  let steps = 0;
  while (queue.length) {
    if (++steps > 40000) return null;
    const g = queue.pop();
    const u = g.home;
    const v = g.away;
    const fu = freeAt(u);
    const fv = freeAt(v);
    const both = fu.filter((w) => fv.includes(w));
    if (both.length) { place(g, rng.pick(both)); continue; }
    // weeks free for one club, where the other has a movable game
    let done = false;
    for (let tries = 0; tries < 6 && !done; tries++) {
      const ca = fu.filter((w) => at[v][w] !== BYE);
      const cb = fv.filter((w) => at[u][w] !== BYE);
      if (!ca.length || !cb.length) break;
      const a = rng.pick(ca);
      const b = rng.pick(cb);
      // free week a at v by swapping a/b on v's chain
      if (kempe(v, a, b, u) && at[u][a] === null && at[v][a] === null) { place(g, a); done = true; break; }
      if (kempe(u, b, a, v) && at[u][b] === null && at[v][b] === null) { place(g, b); done = true; }
    }
    if (done) continue;
    // bump: take a week open to both clubs and send its games back
    const open = [];
    for (let w = 1; w < WEEKS; w++) {
      const x = at[u][w];
      const y = at[v][w];
      if (x === BYE || y === BYE || (x && x.fixed) || (y && y.fixed)) continue;
      open.push(w);
    }
    if (!open.length) return null;
    const w = rng.pick(open);
    for (const x of new Set([at[u][w], at[v][w]])) if (x) { lift(x); queue.unshift(x); }
    place(g, w);
  }

  polish(games, teams, at, kempe, rng);
  // never the same opponent two weeks running: start over if it happens
  for (const t of teams) {
    for (let w = 2; w <= WEEKS; w++) {
      const a = at[t][w - 1];
      const b = at[t][w];
      if (a && b && a !== BYE && b !== BYE && (a.home === t ? a.away : a.home) === (b.home === t ? b.away : b.home)) return null;
    }
  }
  return { games, bye };
}

// How a club's season reads: back-to-back games against the same team,
// division rematches close together, three straight road games.
function softCost(t, at, where = null) {
  let c = 0;
  let road = 0;
  let prev = null;
  const seen = {};
  for (let w = 1; w <= WEEKS; w++) {
    const g = at[t][w];
    if (!g || g === BYE) { road = 0; prev = null; continue; }
    const opp = g.home === t ? g.away : g.home;
    const c0 = c;
    if (opp === prev) c += 6;
    if (seen[opp] && w - seen[opp] < 4) c += 2;
    seen[opp] = w;
    prev = opp;
    road = g.away === t ? road + 1 : 0;
    if (road >= 3) c += 3;
    if (where && c > c0) where.push(w, w - 1);
  }
  return c;
}

function polish(games, teams, at, kempe, rng) {
  const total = () => teams.reduce((s, t) => s + softCost(t, at), 0);
  let cur = total();
  // weeks swapped along chains; keep a swap when the league reads better
  for (let it = 0; it < 8000 && cur > 0; it++) {
    const t = rng.pick(teams);
    const where = [];
    if (softCost(t, at, where) === 0) continue;
    const a = rng.pick(where);
    const b = rng.int(1, WEEKS - 1);
    if (a === b || at[t][a] === BYE || at[t][a] === null) continue;
    if (!kempe(t, a, b, null)) continue;
    const next = total();
    if (next <= cur) { cur = next; continue; }
    kempe(t, a, b, null); // the same swap again puts it back
  }
  // division rivals: either meeting can be the home one; flip a pair when
  // it breaks up road trips
  const pairs = new Map();
  for (const g of games) if (g.kind === 'div') {
    const k = [g.home, g.away].sort().join('-');
    if (!pairs.has(k)) pairs.set(k, []);
    pairs.get(k).push(g);
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const [, [g1, g2]] of pairs) {
      const before = softCost(g1.home, at) + softCost(g1.away, at);
      const swap = () => {
        for (const g of [g1, g2]) { const h = g.home; g.home = g.away; g.away = h; }
      };
      swap();
      if (g1.fixed || g2.fixed || softCost(g1.home, at) + softCost(g1.away, at) > before) swap();
    }
  }
}

// ---- TV windows ---------------------------------------------------------

const WEST = new Set(['DEN', 'LV', 'LAC', 'ARI', 'LAR', 'SF', 'SEA']);
const SITES = ['London', 'London', 'London', 'Munich', 'Madrid', 'Paris', 'Mexico City', 'Rio de Janeiro', 'Dublin', 'Berlin'];

// games: [{week, home, away, kind}], conf: { teamId: 'AFC'|'NFC' };
// draw: { teamId: weight } (bigger draws get more prime time); champion
// hosts the opener.
export function assignTV(games, year, opts = {}) {
  const rng = opts.rng || makeRng(opts.seed || 7);
  const conf = opts.conf || {};
  const draw = opts.draw || {};
  const sunday1 = firstSunday(year);
  const weight = (g) => 1 + (draw[g.home] || 0) + (draw[g.away] || 0);
  const used = {}; // primetime appearances
  const night = (g) => { used[g.home] = (used[g.home] || 0) + 1; used[g.away] = (used[g.away] || 0) + 1; };
  const cap = (g) => (used[g.home] || 0) < 5 && (used[g.away] || 0) < 5;
  const THANKSGIVING = thanksgivingWeek(year);
  const lastWeekMon = new Set();
  const abroad = new Set();
  const out = [];
  const christmas = `${year}-12-25`;
  for (let w = 1; w <= WEEKS; w++) {
    const week = games.filter((g) => g.week === w);
    const left = new Set(week);
    // (the prime-time cap is for night games; net can depend on the game)
    const take = (pred, slot, net, extra = {}) => {
      const pool = [...left].filter((g) => pred(g) && (!/8$/.test(slot) || cap(g)));
      if (!pool.length) return null;
      const g = rng.weighted(pool, weight);
      left.delete(g);
      if (/8$/.test(slot)) night(g);
      out.push({ ...g, slot, net: typeof net === 'function' ? net(g) : net, site: extra.site || null, tag: extra.tag || null });
      return g;
    };
    const restOk = (g) => !lastWeekMon.has(g.home) && !lastWeekMon.has(g.away);
    if (w === 1) {
      const champ = opts.champion;
      take((g) => g.home === champ || !champ, 'Th8', 'nbc', { tag: 'KICKOFF' });
    } else if (w === THANKSGIVING) {
      take((g) => g.home === 'DET', 'Th1', (g) => (conf[g.away] === 'AFC' ? 'cbs' : 'fox'), { tag: 'THX' });
      take((g) => g.home === 'DAL', 'Th4', 'fox', { tag: 'THX' });
      take(restOk, 'Th8', 'nbc', { tag: 'THX' });
      take(restOk, 'Fr3', 'prime', { tag: 'BF' });
    } else if (w < WEEKS) {
      take(restOk, 'Th8', 'prime');
    }
    // Christmas on a weekday in this week: Netflix takes the afternoon pair
    const sun = addDays(sunday1, (w - 1) * 7);
    const xmasDay = { '-4': 'We', '-3': 'Th', '-2': 'Fr', '-1': 'Sa' }[[-4, -3, -2, -1].find((o) => addDays(sun, o) === christmas)];
    if (xmasDay && w < WEEKS) {
      take(restOk, `${xmasDay}1`, 'netflix', { tag: 'XMAS' });
      take(restOk, `${xmasDay}4`, 'netflix', { tag: 'XMAS' });
    }
    // a few international games in the autumn: Europe in the morning on
    // NFL Network, the Americas in the late window
    if (w >= 4 && w <= 11 && rng.chance(0.55)) {
      const site = rng.pick(SITES);
      const americas = site === 'Mexico City' || site === 'Rio de Janeiro';
      const g = take((x) => x.kind !== 'div' && !abroad.has(x.home) && !abroad.has(x.away), americas ? 'Su4' : 'Su9', 'nfl_network', { site });
      if (g) { abroad.add(g.home); abroad.add(g.away); }
      if (americas) { const g = out[out.length - 1]; if (g.site === site) g.net = conf[g.away] === 'NFC' ? 'fox' : 'cbs'; }
    }
    if (w < WEEKS) {
      take(() => true, 'Su8', 'nbc');
      take(() => true, 'Mo8', 'espn');
    } else {
      // the last week: a Saturday pair and the Sunday night finale
      take((g) => g.kind === 'div', 'Sa4', (g) => (conf[g.away] === 'AFC' ? 'cbs' : 'fox'));
      take((g) => g.kind === 'div', 'Sa8', 'espn');
      take((g) => g.kind === 'div', 'Su8', 'nbc');
    }
    lastWeekMon.clear();
    for (const g of out) if (g.week === w && g.slot === 'Mo8') { lastWeekMon.add(g.home); lastWeekMon.add(g.away); }
    // Sunday afternoon: the late window for western hosts and a share of
    // the rest, CBS for an AFC road team, FOX for an NFC one
    for (const g of left) {
      const late = WEST.has(g.home) || rng.chance(0.18);
      out.push({ ...g, slot: late ? 'Su4' : 'Su1', net: conf[g.away] === 'NFC' ? 'fox' : 'cbs', site: null, tag: null });
    }
  }
  return out.map((g) => ({ ...makeGame(sunday1, g.week, g.home, g.away, g.slot, g.net, g.site, g.tag), kind: g.kind, date: gameDate(sunday1, g.week, g.slot) }));
}

// The whole season's schedule: the real one for 2026, the formula after.
// prev: { places, champion, draw } from the season before.
export function buildSchedule(year, prev = {}, seed = year) {
  if (year === 2026 && !prev.generate) return realSchedule2026();
  const rng = makeRng(seed);
  const teams = prev.teams || TEAMS;
  const list = matchups(year, prev.places || placesFrom(null, teams), teams);
  const { games } = assignWeeks(list, { rng, champion: prev.champion, thanksgiving: thanksgivingWeek(year) });
  const conf = Object.fromEntries(teams.map((t) => [t.id, t.conf]));
  return { year, sunday1: firstSunday(year), games: assignTV(games, year, { rng, conf, draw: prev.draw, champion: prev.champion }) };
}
