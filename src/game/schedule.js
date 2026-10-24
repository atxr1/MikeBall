// Season schedules.
//
// 2026 is the real NFL schedule (src/data/schedule2026.js). Later seasons
// are built the way the league builds them (NFL Football Operations, "How
// the NFL schedule is made"), from the previous season's division finishes:
//
//   6  division games, home and away against each rival
//   4  against one division in the same conference (three-year rotation),
//      two home and two away
//   4  against one division in the other conference (four-year rotation),
//      two home and two away
//   2  against the same-place finishers of the other two divisions in the
//      conference, one home and one away
//   1  the 17th game: the same-place finisher of the other-conference
//      division the club played two years earlier, hosted by the AFC in
//      odd years and the NFC in even years
//
// Weeks, byes and TV windows come from src/game/weeks.js. Pure logic: no
// DOM.

import { TEAMS, DIVISIONS } from '../data/teams.js';
import { SCHEDULE_2026 } from '../data/schedule2026.js';
import { SLOT_INFO } from '../data/broadcast.js';

export { SLOT_INFO };

// Same-conference division pairs by (year - 2023) % 3, as division indexes
// (East 0, North 1, South 2, West 3); the same in both conferences.
const INTRA = [
  [[0, 3], [1, 2]],
  [[0, 2], [1, 3]],
  [[0, 1], [2, 3]],
];
// Other-conference pairing by (year - 2023) % 4: INTER[k][afcDiv] = nfcDiv.
const INTER = [
  [0, 3, 2, 1], // 2023: AFC East-NFC East, North-West, South-South, West-North
  [3, 0, 1, 2], // 2024
  [2, 1, 3, 0], // 2025
  [1, 2, 0, 3], // 2026: AFC East-NFC North, North-South, South-East, West-West
];
const mod = (n, k) => ((n % k) + k) % k;

export const SLOT_ORDER = Object.keys(SLOT_INFO);

// ISO date arithmetic in UTC (no time zones to trip over).
export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Week 1 Sunday: the Sunday after Labor Day (the first Monday in September).
export function firstSunday(year) {
  const sep1 = new Date(Date.UTC(year, 8, 1, 12));
  const labor = 1 + mod(1 - sep1.getUTCDay(), 7);
  return `${year}-09-${String(labor + 6).padStart(2, '0')}`;
}

export function gameDate(sunday1, week, slot) {
  return addDays(sunday1, (week - 1) * 7 + (SLOT_INFO[slot] ? SLOT_INFO[slot].offset : 0));
}

// The playoff calendar from the week 18 Sunday: wild card weekend the next
// Saturday to Monday, divisional the week after, conference championships
// a week later, then an off week before the Super Bowl.
export function playoffDates(sunday1) {
  const w18 = addDays(sunday1, 17 * 7);
  return { wildcard: addDays(w18, 7), divisional: addDays(w18, 14), conference: addDays(w18, 21), superBowl: addDays(w18, 35) };
}

export function divisionsOf(teams = TEAMS) {
  const out = {};
  for (const conf of ['AFC', 'NFC']) {
    out[conf] = DIVISIONS.map((div) => teams.filter((t) => t.conf === conf && t.div === div).map((t) => t.id));
  }
  return out;
}

// The real 2026 schedule as game objects.
export function realSchedule2026() {
  const s = SCHEDULE_2026;
  const games = [];
  s.weeks.forEach((list, i) => {
    for (const entry of list) {
      const [pair, slot, net, ...rest] = entry.split(' ');
      const [away, home] = pair.split('@');
      const tag = rest.find((x) => /^[A-Z]+$/.test(x)) || null;
      const site = rest.find((x) => !/^[A-Z]+$/.test(x) && x[0] !== '@');
      const at = rest.find((x) => x[0] === '@');
      const g = makeGame(s.sunday1, i + 1, home, away, slot, net, site ? site.replace(/_/g, ' ') : null, tag);
      if (at) g.time = clock12(at.slice(1));
      games.push(g);
    }
  });
  return { year: s.year, sunday1: s.sunday1, games };
}

// '20:35' -> '8:35 PM'
export function clock12(hm) {
  const [h, m] = hm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function makeGame(sunday1, week, home, away, slot, net, site = null, tag = null) {
  return { id: `${week}-${away}-${home}`, week, home, away, slot, net, site, tag, date: gameDate(sunday1, week, slot) };
}

// Who plays whom, and where, in a season. places: { teamId: 1..4 } from
// last season's division standings.
export function matchups(year, places, teams = TEAMS) {
  const divs = divisionsOf(teams);
  const placeIn = (ids) => [...ids].sort((a, b) => (places[a] || 9) - (places[b] || 9));
  const out = [];
  const add = (home, away, kind) => out.push({ home, away, kind });
  const k3 = mod(year - 2023, 3);
  const k4 = mod(year - 2023, 4);
  const flip3 = Math.floor((year - 2023) / 3) % 2 === 1;
  const flip4 = Math.floor((year - 2023) / 4) % 2 === 1;

  // division: home and away against each rival
  for (const conf of ['AFC', 'NFC']) {
    for (const ids of divs[conf]) {
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        add(ids[i], ids[j], 'div');
        add(ids[j], ids[i], 'div');
      }
    }
  }
  // a whole division against a whole division, two home and two away each
  const divVsDiv = (A, B, flip, kind) => {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const aHosts = ((i + j) % 2 === 0) !== flip;
      if (aHosts) add(A[i], B[j], kind); else add(B[j], A[i], kind);
    }
  };
  for (const conf of ['AFC', 'NFC']) {
    for (const [a, b] of INTRA[k3]) divVsDiv(divs[conf][a], divs[conf][b], flip3, 'conf');
  }
  for (let a = 0; a < 4; a++) divVsDiv(divs.AFC[a], divs.NFC[INTER[k4][a]], flip4, 'inter');

  // same-place games against the other two divisions in the conference:
  // those four pairings form a cycle; each division hosts the next one
  // around it and visits the one before
  for (const conf of ['AFC', 'NFC']) {
    const [[a, b], [c, d]] = INTRA[k3];
    const cycle = [a, c, b, d];
    const forward = (Math.floor((year - 2023) / 3) + (conf === 'NFC' ? 1 : 0)) % 2 === 1;
    for (let n = 0; n < 4; n++) {
      const hostDiv = forward ? cycle[n] : cycle[(n + 1) % 4];
      const guestDiv = forward ? cycle[(n + 1) % 4] : cycle[n];
      const H = placeIn(divs[conf][hostDiv]);
      const G = placeIn(divs[conf][guestDiv]);
      for (let p = 0; p < 4; p++) add(H[p], G[p], 'place');
    }
  }
  // the 17th game
  const k17 = mod(year - 2 - 2023, 4);
  const nfcHosts = year % 2 === 0;
  for (let a = 0; a < 4; a++) {
    const A = placeIn(divs.AFC[a]);
    const N = placeIn(divs.NFC[INTER[k17][a]]);
    for (let p = 0; p < 4; p++) {
      if (nfcHosts) add(N[p], A[p], 'seventeen'); else add(A[p], N[p], 'seventeen');
    }
  }
  return out;
}

// Last season's division finishes from a final standings table
// ({ teamId: { divRank } }); falls back to the built-in order.
export function placesFrom(standings, teams = TEAMS) {
  const places = {};
  const divs = divisionsOf(teams);
  for (const conf of ['AFC', 'NFC']) {
    for (const ids of divs[conf]) {
      ids.forEach((id, i) => { places[id] = (standings && standings[id] && standings[id].divRank) || i + 1; });
    }
  }
  return places;
}
