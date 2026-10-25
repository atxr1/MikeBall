// The offseason, from the morning after the Super Bowl to the 53-man
// roster: a new league year, re-signing, free agency, the draft, training
// camp and cuts. CPU teams do all of it on their own; the user's team does
// what the user decides (src/ui/offseason.js), with "let my front office
// handle it" for every step.
//
//   s.off = { stage, year, order, class, pick, drafted, round, faDay,
//             retired, improved, log }
//   stages: 'resign' -> 'fa' -> 'draft' -> 'camp' -> 'ready'
//
// Rosters can run up to 90 in the offseason and must be down to 53 (and
// have at least MIN_POS at every position) to start the season. Pure
// logic: no DOM; every draw from the seeded RNG passed in.

import { capFor, marketBook, marketContract, percentile, minSalary, rookieDeal, askYears } from './contracts.js';
import { developPlayer, retireChance } from './progression.js';
import { makeDraftClass, prospectValue, streetFreeAgent } from '../data/draftclass.js';
import { seasonStandings, isPlayoff } from './season.js';
import { capSheet, logMove, touched, allPlayers } from './league.js';
import { valueOf, buildDepthChart, POS_LIST, NUMBER_RANGES } from '../data/roster.js';
import { TEAMS } from '../data/teams.js';
import { clamp } from '../core/util.js';

export const ROSTER_MAX = 53;
export const OFFSEASON_MAX = 90;
export const ROUNDS = 7;
export const FA_DAYS = 5;
export const MIN_POS = { QB: 2, RB: 3, WR: 5, TE: 2, OL: 8, DL: 7, LB: 5, CB: 5, S: 3, K: 1, P: 1 };
export const TARGET = { QB: 3, RB: 4, WR: 6, TE: 3, OL: 9, DL: 9, LB: 7, CB: 6, S: 4, K: 1, P: 1 };

// ---- the draft order ------------------------------------------------------

// Non-playoff teams worst record first (easier schedule picks first on a
// tie), then playoff teams by the round they went out in, the Super Bowl
// loser 31st and the champion last.
export function draftOrder(s, teams = TEAMS) {
  const st = seasonStandings(s, teams);
  const out = { };
  const games = s.games.filter(isPlayoff);
  for (const t of teams) out[t.id] = -1; // missed the playoffs
  for (const g of games) {
    if (g.hs == null) continue;
    const loser = g.hs > g.as ? g.away : g.home;
    out[loser] = g.round;
    if (g.round === 3) out[g.hs > g.as ? g.home : g.away] = 4;
  }
  const ids = teams.map((t) => t.id);
  return ids.sort((a, b) => out[a] - out[b] || st.rows[a].pct - st.rows[b].pct || st.rows[a].sos - st.rows[b].sos || a.localeCompare(b));
}

// ---- needs ------------------------------------------------------------------

function countAt(roster, pos) {
  return roster.players.filter((p) => p.pos === pos).length;
}

// How badly a team needs a player at pos (0 = not at all, ~2 = badly).
export function teamNeed(roster, pos, book, max = OFFSEASON_MAX) {
  const n = countAt(roster, pos);
  const target = TARGET[pos] || 2;
  let need = n < (MIN_POS[pos] || 1) ? 2 : n < target ? 1 : n < target + 2 ? 0.35 : 0.1;
  // weak starters make a need too
  const starters = roster.players.filter((p) => p.pos === pos).sort((a, b) => valueOf(b) - valueOf(a)).slice(0, Math.max(1, Math.ceil(target / 2)));
  if (starters.length) {
    const q = starters.reduce((s, p) => s + percentile(book, p), 0) / starters.length;
    need += clamp(0.6 - q, 0, 0.6) * 1.5;
  }
  if (roster.players.length >= max) need *= 0.3;
  return need;
}

// ---- the new league year -------------------------------------------------------

// The day after the Super Bowl: contracts tick down, everyone's a year
// older and develops, some retire, the draft class and order are set.
export function beginOffseason(s, gm, rng, teams = TEAMS) {
  const year = s.year + 1;
  gm.year = year;
  const retired = [];
  const improved = [];
  const book = marketBook(allPlayers(gm));
  for (const r of Object.values(gm.rosters)) {
    for (const p of [...r.players]) {
      const pct = percentile(book, p);
      const c = p.contract;
      if (c) {
        c.years -= 1;
        c.guaranteed = Math.max(0, (c.guaranteed || 0) - c.apy);
        c.capHit = c.years > 0 ? c.apy : 0;
      }
      const gain = developPlayer(p, rng);
      p.age += 1;
      p.exp = (p.exp || 0) + 1;
      if (rng.chance(retireChance(p, pct))) {
        retired.push({ id: p.id, name: `${p.first} ${p.last}`, pos: p.pos, team: r.teamId, age: p.age });
        removeFromRoster(gm, r, p);
        continue;
      }
      if (r.teamId === s.userId && Math.abs(gain) >= 2.5) improved.push({ id: p.id, name: `${p.first} ${p.last}`, pos: p.pos, gain: Math.round(gain * 10) / 10 });
      if (c && c.years <= 0) p.expiring = true;
    }
  }
  // last year's unsigned free agents: the young or good hang around, the
  // rest leave the game
  gm.fa = gm.fa.filter((p) => {
    developPlayer(p, rng);
    p.age += 1;
    const pct = percentile(book, p);
    if (pct < 0.25 || p.age >= 31) return rng.chance(0.15);
    return !rng.chance(Math.min(0.9, retireChance(p, pct) * 2));
  });
  const order = draftOrder(s, teams);
  s.off = {
    stage: 'resign',
    year,
    order,
    class: makeDraftClass(year, s.seed ^ year),
    pick: 0,
    drafted: [],
    faDay: 0,
    retired,
    improved: improved.sort((a, b) => b.gain - a.gain),
    log: [],
  };
  return s.off;
}

function removeFromRoster(gm, roster, p) {
  roster.players.splice(roster.players.indexOf(p), 1);
  for (const pos of Object.keys(roster.depth)) roster.depth[pos] = roster.depth[pos].filter((id) => id !== p.id);
  touched(roster);
}

function addToRoster(gm, teamId, p) {
  const r = gm.rosters[teamId];
  p.teamId = teamId;
  delete p.expiring;
  r.players.push(p);
  // a jersey number nobody's wearing
  const used = new Set(r.players.filter((x) => x !== p).map((x) => x.num));
  if (!p.num || used.has(p.num)) p.num = freeNumber(p.pos, used);
  // on the depth chart behind whoever's there
  const lists = p.pos === 'DL' ? ['DL', 'EDGE'] : [p.pos];
  for (const pos of lists) (r.depth[pos] ||= []).push(p.id);
  touched(r);
}

function freeNumber(pos, used) {
  for (const [a, b] of NUMBER_RANGES[pos] || [[0, 99]]) for (let n = a; n <= b; n++) if (!used.has(n)) return n;
  for (let n = 0; n < 100; n++) if (!used.has(n)) return n;
  return 0;
}

// The depth chart, rebuilt by value for a CPU team (the user keeps theirs).
export function resetDepth(r) {
  r.depth = buildDepthChart(r.players);
  touched(r);
}

// ---- re-signing --------------------------------------------------------------

export function expiring(gm, teamId) {
  return gm.rosters[teamId].players.filter((p) => p.expiring);
}

// What he wants from his own team: the market, nudged by greed and loyalty.
export function resignAsk(p, book, year, edge = false) {
  const c = marketContract(p, book, year, edge);
  const t = p.traits || {};
  const k = 1 + ((t.greed || 5) - 5) * 0.035 - ((t.loyalty || 5) - 5) * 0.03;
  c.apy = Math.max(minSalary(p.exp, year), Math.round((c.apy * k) / 50_000) * 50_000);
  c.guaranteed = Math.round(c.guaranteed * k);
  return c;
}

export function signPlayer(gm, teamId, p, contract, how = 'signed') {
  const year = gm.year;
  p.contract = { ...contract, capHit: contract.apy, fa: year + contract.years, signed: year };
  const r = gm.rosters[teamId];
  if (!r.players.includes(p)) {
    gm.fa = gm.fa.filter((x) => x !== p);
    addToRoster(gm, teamId, p);
  }
  delete p.expiring;
  delete p.ask;
  logMove(gm, teamId, `${how === 're-signed' ? 'Re-signed' : 'Signed'} ${p.pos} ${p.first} ${p.last}: ${contract.years} yr, $${(contract.apy / 1e6).toFixed(1)}M a year`);
}

// Released (or let go): onto the free-agent list; guaranteed money left
// on his deal hits this year's cap as dead money.
export function releasePlayer(gm, teamId, p, why = 'Released') {
  const r = gm.rosters[teamId];
  const c = p.contract;
  if (c && c.years > 0 && c.guaranteed > 0) {
    const d = (gm.dead[teamId] ||= {});
    d[gm.year] = (d[gm.year] || 0) + c.guaranteed;
  }
  removeFromRoster(gm, r, p);
  p.prevTeam = teamId;
  p.teamId = null;
  p.contract = null;
  delete p.expiring;
  gm.fa.push(p);
  if (why) logMove(gm, teamId, `${why} ${p.pos} ${p.first} ${p.last}`);
}

// ---- the franchise tag --------------------------------------------------------
//
// One a year per team: a one-year deal, all of it guaranteed, for the
// average of the five biggest salaries at his position or 120% of what he
// made, whichever is more. He doesn't get a say.

export function tagValue(gm, p) {
  // (from the deals in place before this offseason, so it holds still
  // while teams re-sign and tag)
  const pays = allPlayers(gm).filter((x) => x.pos === p.pos && x !== p && x.contract && x.contract.years > 0 && x.contract.signed !== gm.year)
    .map((x) => x.contract.apy).sort((a, b) => b - a).slice(0, 5);
  const top5 = pays.length ? pays.reduce((s, x) => s + x, 0) / pays.length : 0;
  const last = (p.contract && p.contract.apy) || 0;
  return Math.max(minSalary(p.exp || 0, gm.year), Math.round(Math.max(top5, last * 1.2) / 50_000) * 50_000);
}

export function tagUsed(gm, teamId) {
  return gm.rosters[teamId].players.some((p) => p.contract && p.contract.type === 'tag' && p.contract.signed === gm.year);
}

export function franchiseTag(gm, teamId, p) {
  if (tagUsed(gm, teamId) || !p.expiring) return false;
  const v = tagValue(gm, p);
  p.contract = { type: 'tag', apy: v, capHit: v, years: 1, guaranteed: v, fa: gm.year + 1, signed: gm.year };
  delete p.expiring;
  logMove(gm, teamId, `Franchise-tagged ${p.pos} ${p.first} ${p.last}: 1 yr, $${(v / 1e6).toFixed(1)}M`);
  return true;
}

// CPU teams keep the expiring players worth keeping, if the player wants
// to stay and the cap allows; a star who won't sign gets the tag.
export function cpuResign(gm, teamId, rng) {
  const year = gm.year;
  const r = gm.rosters[teamId];
  const book = marketBook(allPlayers(gm));
  const edges = new Set((r.depth.EDGE || []).slice(0, 2));
  const list = expiring(gm, teamId).sort((a, b) => percentile(book, b) - percentile(book, a));
  for (const p of list) {
    const pct = percentile(book, p);
    const ask = resignAsk(p, book, year, edges.has(p.id));
    const space = capSheet(gm, teamId).space;
    const keep = pct > 0.55 && (p.age <= 30 || pct > 0.85) && ask.apy < space - 4_000_000;
    // some want to see what's out there
    const t = p.traits || {};
    // (teams work harder to keep their best: most stars sign)
    const stays = rng.chance(clamp(0.6 + ((t.loyalty || 5) - (t.greed || 5)) * 0.05 + Math.max(0, pct - 0.6), 0.25, 0.95));
    if (keep && stays) signPlayer(gm, teamId, p, ask, 're-signed');
    else if (keep && pct > 0.85 && p.age <= 31 && !tagUsed(gm, teamId) && tagValue(gm, p) < space - 6_000_000) franchiseTag(gm, teamId, p);
  }
}

// When re-signing is over: everyone still expiring is a free agent.
export function openFreeAgency(gm) {
  const book = marketBook(allPlayers(gm));
  for (const r of Object.values(gm.rosters)) {
    for (const p of r.players.filter((x) => x.expiring)) releasePlayer(gm, r.teamId, p, null);
  }
  for (const p of gm.fa) {
    p.ask = marketContract(p, book, gm.year);
    const t = p.traits || {};
    p.ask.apy = Math.max(minSalary(p.exp, gm.year), Math.round((p.ask.apy * (1 + ((t.greed || 5) - 5) * 0.04)) / 50_000) * 50_000);
    p.offers = [];
  }
}

// ---- free agency ----------------------------------------------------------------

// How good a team looks to a free agent who wants to win (0-1).
const standingsCache = new WeakMap();
function contender(s, teamId) {
  if (!standingsCache.has(s)) standingsCache.set(s, seasonStandings(s));
  const r = standingsCache.get(s).rows[teamId];
  return r ? r.pct : 0.5;
}

// How a player rates an offer: the money first, then (by his personality)
// winning, his old team, and the chance to start.
export function offerScore(p, offer, ctx) {
  const t = p.traits || {};
  const years = Math.min(offer.years, askYears(p) + 1);
  let v = offer.apy * (0.75 + 0.25 * Math.min(years, 4) / 4) + (offer.guaranteed || 0) * 0.08;
  v *= 1 + ((t.competitor || 5) - 5) * 0.03 * (ctx.winPct - 0.5) * 2;
  if (ctx.teamId === p.prevTeam) v *= 1 + ((t.loyalty || 5) - 5) * 0.02;
  if (ctx.starter) v *= 1 + ((t.ego || 5) - 3) * 0.012;
  return v;
}

// One day of free agency: CPU teams make offers to the players they want;
// players take the best offer that's close enough to their ask (the user's
// offers in userOffers: [{ player, contract }]). Asks come down each day.
export function faDay(s, gm, rng, userOffers = [], teams = TEAMS) {
  const year = gm.year;
  const book = marketBook(allPlayers(gm));
  const signed = [];
  const pool = gm.fa.filter((p) => p.ask);
  for (const p of pool) p.offers = [];
  for (const o of userOffers) if (gm.fa.includes(o.player)) o.player.offers.push({ teamId: s.userId, contract: o.contract, user: true });
  // CPU teams, the ones with the most room first (a little shuffled)
  const cpu = teams.map((t) => t.id).filter((id) => id !== s.userId)
    .map((id) => ({ id, room: capSheet(gm, id).space + rng.normal(0, 3e6) }))
    .sort((a, b) => b.room - a.room);
  for (const { id } of cpu) {
    const r = gm.rosters[id];
    if (r.players.length >= OFFSEASON_MAX) continue;
    let room = capSheet(gm, id).space - 8_000_000; // keep some for the rookies
    const wants = pool.filter((p) => !p.offers.some((o) => o.teamId === id))
      .map((p) => ({ p, w: percentile(book, p) * (0.4 + teamNeed(r, p.pos, book)) }))
      .sort((a, b) => b.w - a.w);
    let made = 0;
    const most = 3 + Math.floor(Math.max(0, room) / 30e6); // deep pockets shop more
    for (const { p, w } of wants) {
      if (made >= most || w < 0.25) break;
      if (p.ask.apy > room) continue;
      const k = 0.92 + rng.next() * 0.2;
      const c = { ...p.ask, apy: Math.round((p.ask.apy * k) / 50_000) * 50_000, guaranteed: Math.round((p.ask.guaranteed || 0) * k) };
      p.offers.push({ teamId: id, contract: c });
      room -= c.apy;
      made++;
    }
  }
  // players decide
  for (const p of pool) {
    if (!p.offers.length) continue;
    const scored = p.offers.map((o) => ({
      o,
      v: offerScore(p, o.contract, { teamId: o.teamId, winPct: contender(s, o.teamId), starter: teamNeed(gm.rosters[o.teamId], p.pos, book) > 0.6 }),
    })).sort((a, b) => b.v - a.v);
    const best = scored[0];
    const askV = offerScore(p, p.ask, { teamId: null, winPct: 0.5, starter: false });
    // the longer he waits, the less he holds out for
    if (best.v >= askV * (0.97 - s.off.faDay * 0.05) || rng.chance(0.25 + s.off.faDay * 0.12)) {
      if (capSheet(gm, best.o.teamId).space < best.o.contract.apy) continue;
      signPlayer(gm, best.o.teamId, p, best.o.contract);
      signed.push({ player: p, teamId: best.o.teamId, contract: best.o.contract, user: !!best.o.user });
    }
  }
  // asks come down for whoever's left
  for (const p of gm.fa) if (p.ask) p.ask.apy = Math.max(minSalary(p.exp, year), Math.round((p.ask.apy * 0.9) / 50_000) * 50_000);
  s.off.faDay += 1;
  return signed;
}

// ---- the draft ------------------------------------------------------------------

export function onTheClock(s) {
  const n = s.off.pick;
  if (n >= ROUNDS * 32) return null;
  return { overall: n + 1, round: Math.floor(n / 32) + 1, inRound: (n % 32) + 1, teamId: s.off.order[n % 32] };
}

export function available(s) {
  const taken = new Set(s.off.drafted.map((d) => d.id));
  return s.off.class.filter((p) => !taken.has(p.id));
}

export function makePick(s, gm, teamId, p) {
  const slot = onTheClock(s);
  if (!slot || slot.teamId !== teamId) return null;
  s.off.drafted.push({ id: p.id, teamId, overall: slot.overall, round: slot.round, pos: p.pos, name: `${p.first} ${p.last}` });
  p.draft = { year: s.off.year, round: slot.round, pick: slot.overall };
  addToRoster(gm, teamId, p);
  const deal = rookieDeal(slot.overall, gm.year);
  p.contract = deal;
  logMove(gm, teamId, `Drafted ${p.pos} ${p.first} ${p.last}, round ${slot.round} (No. ${slot.overall})`);
  s.off.pick += 1;
  return slot;
}

// The CPU's pick: the best prospect on its board, leaning toward needs.
export function cpuPick(s, gm, rng) {
  const slot = onTheClock(s);
  if (!slot) return null;
  const r = gm.rosters[slot.teamId];
  const book = marketBook(allPlayers(gm));
  const list = available(s);
  let best = null;
  let bestV = -1e9;
  for (const p of list.slice(0, 60)) {
    const v = prospectValue(p) * (0.75 + 0.35 * Math.min(1.5, teamNeed(r, p.pos, book))) + rng.normal(0, 0.12);
    if (v > bestV) { bestV = v; best = p; }
  }
  return best ? { slot, p: best, made: makePick(s, gm, slot.teamId, best) } : null;
}

// After the last pick: whoever wasn't taken can sign anywhere (undrafted
// free agents, at the minimum).
export function closeDraft(s, gm) {
  for (const p of available(s)) {
    p.ask = { type: 'min', apy: minSalary(0, gm.year), years: 2, guaranteed: 0 };
    p.offers = [];
    p.undrafted = true;
    gm.fa.push(p);
  }
}

// ---- cuts -------------------------------------------------------------------------

// Down to 53 for a CPU team: keep the best at each position up to what it
// needs, then the best of the rest; cut the others.
export function cpuCutdown(gm, teamId) {
  const r = gm.rosters[teamId];
  const keep = new Set();
  for (const pos of POS_LIST) {
    const list = r.players.filter((p) => p.pos === pos).sort((a, b) => valueOf(b) - valueOf(a));
    for (const p of list.slice(0, MIN_POS[pos] || 1)) keep.add(p);
  }
  const rest = r.players.filter((p) => !keep.has(p)).sort((a, b) => valueOf(b) - valueOf(a) - ((b.contract?.guaranteed || 0) - (a.contract?.guaranteed || 0)) / 2e6);
  for (const p of rest) { if (keep.size >= ROSTER_MAX) break; keep.add(p); }
  for (const p of [...r.players]) if (!keep.has(p)) releasePlayer(gm, teamId, p, 'Cut');
  resetDepth(r);
}

// Bodies at every position: sign the best free agents who fit, at the
// minimum (a street free agent if there's nobody left).
export function fillMinimums(gm, teamId, rng) {
  const r = gm.rosters[teamId];
  const book = marketBook(allPlayers(gm));
  for (const pos of POS_LIST) {
    let guard = 0;
    while (countAt(r, pos) < (MIN_POS[pos] || 1) && guard++ < 10) {
      let fa = gm.fa.filter((p) => p.pos === pos).sort((a, b) => percentile(book, b) - percentile(book, a))[0];
      if (!fa) {
        if (!rng) break;
        fa = streetFreeAgent(pos, gm.year, rng);
        gm.fa.push(fa);
      }
      signPlayer(gm, teamId, fa, { type: 'min', apy: minSalary(fa.exp, gm.year), years: 1, guaranteed: 0 });
    }
  }
}

// Everything a CPU team does to get to opening day: down to 53, the
// holes filled, under the cap, nobody missing at any position.
export function cpuFinalize(gm, teamId, rng) {
  cpuCutdown(gm, teamId);
  cpuFillRoster(gm, teamId);
  cpuCapCompliance(gm, teamId);
  fillMinimums(gm, teamId, rng);
  // the minimums may have pushed it past 53: cut the least useful extras
  const r = gm.rosters[teamId];
  while (r.players.length > ROSTER_MAX) {
    const extra = r.players.filter((p) => countAt(r, p.pos) > (MIN_POS[p.pos] || 1)).sort((a, b) => valueOf(a) - valueOf(b))[0];
    if (!extra) break;
    releasePlayer(gm, teamId, extra, 'Cut');
  }
  resetDepth(r);
}

// A CPU team fills out its 53 with the best free agents it can get at the
// minimum (undrafted rookies, veterans nobody paid), positions it's
// shortest at first.
export function cpuFillRoster(gm, teamId) {
  const r = gm.rosters[teamId];
  const book = marketBook(allPlayers(gm));
  let guard = 0;
  while (r.players.length < ROSTER_MAX && gm.fa.length && guard++ < 60) {
    let best = null;
    let bestV = -1;
    for (const p of gm.fa) {
      const v = (percentile(book, p) + 0.2) * (0.3 + teamNeed(r, p.pos, book, ROSTER_MAX)) * (p.age <= 27 ? 1.1 : 1);
      if (v > bestV) { bestV = v; best = p; }
    }
    if (!best) break;
    signPlayer(gm, teamId, best, { type: 'min', apy: minSalary(best.exp, gm.year), years: best.exp === 0 ? 2 : 1, guaranteed: 0 });
  }
  resetDepth(r);
}

// Under the cap: let go of the players who cost the most for what they
// bring (and whose release saves money), until it fits.
export function cpuCapCompliance(gm, teamId) {
  const r = gm.rosters[teamId];
  let guard = 0;
  while (capSheet(gm, teamId).space < 0 && guard++ < 20) {
    const book = marketBook(allPlayers(gm));
    const cands = r.players.filter((p) => p.contract && p.contract.apy - (p.contract.guaranteed || 0) > 1e6);
    if (!cands.length) break;
    cands.sort((a, b) => (b.contract.apy - b.contract.guaranteed) * (1.2 - percentile(book, b)) - (a.contract.apy - a.contract.guaranteed) * (1.2 - percentile(book, a)));
    releasePlayer(gm, teamId, cands[0], 'Released (cap)');
  }
}

// Is a roster ready to start the season? Returns the problems.
export function rosterProblems(gm, teamId) {
  const r = gm.rosters[teamId];
  const out = [];
  if (r.players.length > ROSTER_MAX) out.push(`${r.players.length - ROSTER_MAX} over the 53-man limit`);
  for (const pos of POS_LIST) {
    const n = countAt(r, pos);
    if (n < (MIN_POS[pos] || 1)) out.push(`needs ${MIN_POS[pos] - n} more ${pos}`);
  }
  if (capSheet(gm, teamId).space < 0) out.push('over the salary cap');
  return out;
}

// What's left of the year for the CPU teams, so the new season can start:
// they re-sign, sign, draft and cut on their own.
export function cpuOffseason(s, gm, rng, teams = TEAMS) {
  for (const t of teams) if (t.id !== s.userId) cpuResign(gm, t.id, rng);
}

export function capOf(gm, teamId) {
  return capSheet(gm, teamId, gm.year);
}

export { capFor };
