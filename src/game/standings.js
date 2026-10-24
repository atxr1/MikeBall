// Standings, NFL tiebreakers, playoff seeds and the bracket.
//
// Tiebreakers follow the NFL's "Tie-breaking procedures" (2024 rulebook
// wording). Win percentage counts a tie as half a win.
//
// Division, two or more clubs: head-to-head, division games, common games,
// conference games, strength of victory, strength of schedule, combined
// ranking in points scored and allowed (conference, then league), net
// points in common games, net points, net touchdowns, coin toss.
//
// Wild card: first knock out all but the top club from each division (by
// the division tiebreakers). Then head-to-head (for three or more clubs
// only a sweep counts: one club beat, or lost to, every other), conference
// games, common games (at least four), strength of victory, strength of
// schedule, the point rankings, net points in conference games, net points,
// net touchdowns, coin toss.
//
// Whenever a step knocks some clubs out but leaves more than one tied, the
// rest start over from the first step; once a club is placed, the others
// start over for the next spot.
//
// Seeds: the four division winners are 1 to 4, the three best other clubs
// 5 to 7; the 1 seed has a bye. Wild card round: 2-7, 3-6, 4-5 at the
// higher seed; the divisional round re-seeds, so the 1 seed gets the
// lowest seed left. Pure logic: no DOM.

import { hashString } from '../core/rng.js';

const EPS = 1e-9;
const pct = (r) => (r.g ? (r.w + r.t / 2) / r.g : 0);
const blank = () => ({ w: 0, l: 0, t: 0, g: 0 });
const tally = (r, res) => { r.g++; if (res === 1) r.w++; else if (res === 0) r.l++; else r.t++; };

// results: [{ home, away, hs, as, htd?, atd? }] (finished games only);
// teams: [{ id, conf, div }]. Returns a context the other calls share.
export function buildTable(results, teams, seasonKey = '') {
  const info = Object.fromEntries(teams.map((t) => [t.id, t]));
  const rows = {};
  for (const t of teams) {
    rows[t.id] = { id: t.id, conf: t.conf, div: t.div, ...blank(), pf: 0, pa: 0, td: 0, tda: 0, home: blank(), road: blank(), divRec: blank(), confRec: blank(), log: [], streak: '' };
  }
  for (const g of results) {
    if (g.hs == null || g.as == null || !rows[g.home] || !rows[g.away]) continue;
    const side = (id, opp, f, a, tdf, tda, home, res) => {
      const r = rows[id];
      tally(r, res);
      tally(home ? r.home : r.road, res);
      if (info[opp].conf === info[id].conf) {
        tally(r.confRec, res);
        if (info[opp].div === info[id].div) tally(r.divRec, res);
      }
      r.pf += f; r.pa += a; r.td += tdf || 0; r.tda += tda || 0;
      r.log.push({ opp, res, pf: f, pa: a, td: tdf || 0, tda: tda || 0, week: g.week || 0 });
    };
    // (a game played with short quarters carries g.pace: its points and
    // touchdowns count at full-game pace in the tiebreakers; the result is
    // the result)
    const k = g.pace || 1;
    const res = g.hs > g.as ? 1 : g.hs < g.as ? 0 : 0.5;
    side(g.home, g.away, g.hs * k, g.as * k, (g.htd || 0) * k, (g.atd || 0) * k, true, res);
    side(g.away, g.home, g.as * k, g.hs * k, (g.atd || 0) * k, (g.htd || 0) * k, false, 1 - res);
  }
  for (const r of Object.values(rows)) {
    r.pct = pct(r);
    r.log.sort((a, b) => a.week - b.week);
    let n = 0;
    let kind = null;
    for (let i = r.log.length - 1; i >= 0; i--) {
      const k = r.log[i].res === 1 ? 'W' : r.log[i].res === 0 ? 'L' : 'T';
      if (kind && k !== kind) break;
      kind = k;
      n++;
    }
    r.streak = kind ? `${kind}${n}` : '';
  }
  const ctx = { rows, info, teams, seasonKey };
  // strength of victory and schedule, league point rankings
  for (const r of Object.values(rows)) {
    const sov = blank();
    const sos = blank();
    for (const e of r.log) {
      const o = rows[e.opp];
      sos.w += o.w; sos.l += o.l; sos.t += o.t; sos.g += o.g;
      if (e.res === 1) { sov.w += o.w; sov.l += o.l; sov.t += o.t; sov.g += o.g; }
    }
    r.sov = pct(sov);
    r.sos = pct(sos);
  }
  const rankBy = (list, key, desc) => {
    const out = {};
    for (const r of list) out[r.id] = 1 + list.filter((x) => (desc ? x[key] > r[key] : x[key] < r[key])).length;
    return out;
  };
  const all = Object.values(rows);
  const lgPF = rankBy(all, 'pf', true);
  const lgPA = rankBy(all, 'pa', false);
  for (const conf of ['AFC', 'NFC']) {
    const list = all.filter((r) => r.conf === conf);
    const cPF = rankBy(list, 'pf', true);
    const cPA = rankBy(list, 'pa', false);
    for (const r of list) { r.confPts = cPF[r.id] + cPA[r.id]; r.lgPts = lgPF[r.id] + lgPA[r.id]; }
  }
  return ctx;
}

// ---- the steps ----------------------------------------------------------

const recAgainst = (ctx, id, opps) => {
  const r = blank();
  for (const e of ctx.rows[id].log) if (opps.has(e.opp)) tally(r, e.res);
  return r;
};
const commonOpps = (ctx, ids) => {
  let common = null;
  for (const id of ids) {
    const mine = new Set(ctx.rows[id].log.map((e) => e.opp));
    common = common ? new Set([...common].filter((o) => mine.has(o))) : mine;
  }
  for (const id of ids) common.delete(id);
  return common;
};
const netIn = (ctx, id, keep) => {
  let n = 0;
  for (const e of ctx.rows[id].log) if (keep(e)) n += e.pf - e.pa;
  return n;
};

const S = {
  h2h: (ctx, ids) => {
    const set = new Set(ids);
    const recs = ids.map((id) => recAgainst(ctx, id, new Set([...set].filter((x) => x !== id))));
    // only counts if every club has played the others at least once
    if (ids.length > 2) {
      for (const id of ids) for (const o of ids) if (o !== id && !ctx.rows[id].log.some((e) => e.opp === o)) return null;
    }
    if (recs.every((r) => !r.g)) return null;
    return recs.map(pct);
  },
  sweep: (ctx, ids) => {
    // a club that beat each of the others is in; one that lost to each is out
    const beat = (a, b) => {
      const r = recAgainst(ctx, a, new Set([b]));
      return r.g && r.w === r.g;
    };
    const scores = ids.map((a) => {
      const others = ids.filter((b) => b !== a);
      if (others.every((b) => beat(a, b))) return 1;
      if (others.every((b) => beat(b, a))) return -1;
      return 0;
    });
    return scores.some((x) => x !== 0) ? scores : null;
  },
  div: (ctx, ids) => ids.map((id) => pct(ctx.rows[id].divRec)),
  common: (ctx, ids) => {
    const c = commonOpps(ctx, ids);
    return ids.map((id) => pct(recAgainst(ctx, id, c)));
  },
  common4: (ctx, ids) => {
    const c = commonOpps(ctx, ids);
    const recs = ids.map((id) => recAgainst(ctx, id, c));
    if (recs.some((r) => r.g < 4)) return null;
    return recs.map(pct);
  },
  conf: (ctx, ids) => ids.map((id) => pct(ctx.rows[id].confRec)),
  sov: (ctx, ids) => ids.map((id) => ctx.rows[id].sov),
  sos: (ctx, ids) => ids.map((id) => ctx.rows[id].sos),
  confPts: (ctx, ids) => ids.map((id) => -ctx.rows[id].confPts),
  lgPts: (ctx, ids) => ids.map((id) => -ctx.rows[id].lgPts),
  netCommon: (ctx, ids) => {
    const c = commonOpps(ctx, ids);
    return ids.map((id) => netIn(ctx, id, (e) => c.has(e.opp)));
  },
  netConf: (ctx, ids) => ids.map((id) => netIn(ctx, id, (e) => ctx.info[e.opp].conf === ctx.info[id].conf)),
  net: (ctx, ids) => ids.map((id) => ctx.rows[id].pf - ctx.rows[id].pa),
  netTD: (ctx, ids) => ids.map((id) => ctx.rows[id].td - ctx.rows[id].tda),
};
const DIV_STEPS = ['h2h', 'div', 'common', 'conf', 'sov', 'sos', 'confPts', 'lgPts', 'netCommon', 'net', 'netTD'];
const WC_TWO = ['h2h', 'conf', 'common4', 'sov', 'sos', 'confPts', 'lgPts', 'netConf', 'net', 'netTD'];
const WC_MANY = ['sweep', 'conf', 'common4', 'sov', 'sos', 'confPts', 'lgPts', 'netConf', 'net', 'netTD'];

function coin(ctx, ids) {
  return [...ids].sort((a, b) => hashString(`${ctx.seasonKey}:${a}`) - hashString(`${ctx.seasonKey}:${b}`))[0];
}

// The top club of a group tied on win percentage. why collects the step
// that decided it (for the standings notes).
function topOf(ctx, ids, kind, why) {
  if (ids.length === 1) return ids[0];
  const sameDiv = ids.every((id) => ctx.info[id].div === ctx.info[ids[0]].div && ctx.info[id].conf === ctx.info[ids[0]].conf);
  if (kind === 'wc' && !sameDiv) {
    // one club per division first
    const byDiv = {};
    for (const id of ids) (byDiv[`${ctx.info[id].conf}${ctx.info[id].div}`] ||= []).push(id);
    const lead = Object.values(byDiv).map((list) => topOf(ctx, list, 'div', null));
    if (lead.length < ids.length) {
      if (lead.length === 1) return lead[0];
      ids = lead;
    }
  }
  const steps = kind === 'div' || sameDiv ? DIV_STEPS : ids.length === 2 ? WC_TWO : WC_MANY;
  for (const step of steps) {
    const scores = S[step](ctx, ids);
    if (!scores) continue;
    const best = Math.max(...scores);
    const top = ids.filter((_, i) => scores[i] > best - EPS);
    if (top.length === ids.length) continue;
    if (why) why.step = why.step || step;
    if (top.length === 1) return top[0];
    return topOf(ctx, top, kind, why);
  }
  if (why) why.step = why.step || 'coin';
  return coin(ctx, ids);
}

// Order a group of clubs: by win percentage, ties broken one spot at a time.
export function order(ctx, ids, kind = 'div') {
  const left = [...ids];
  const out = [];
  while (left.length) {
    const best = Math.max(...left.map((id) => ctx.rows[id].pct));
    const tied = left.filter((id) => ctx.rows[id].pct > best - EPS);
    const why = {};
    const top = topOf(ctx, tied, kind, why);
    if (tied.length > 1) ctx.rows[top].tieNote = why.step;
    out.push(top);
    left.splice(left.indexOf(top), 1);
  }
  return out;
}

const DIVS = ['East', 'North', 'South', 'West'];

// Divisions in order, each club's divRank, and both conferences' seeds.
export function standings(results, teams, seasonKey = '') {
  const ctx = buildTable(results, teams, seasonKey);
  const divisions = {};
  const seeds = {};
  for (const conf of ['AFC', 'NFC']) {
    divisions[conf] = {};
    const winners = [];
    const rest = [];
    for (const div of DIVS) {
      const ids = teams.filter((t) => t.conf === conf && t.div === div).map((t) => t.id);
      const ord = order(ctx, ids, 'div');
      ord.forEach((id, i) => { ctx.rows[id].divRank = i + 1; });
      divisions[conf][div] = ord;
      winners.push(ord[0]);
      rest.push(...ord.slice(1));
    }
    const top = order(ctx, winners, 'wc');
    const wild = order(ctx, rest, 'wc');
    seeds[conf] = [...top, ...wild];
    seeds[conf].forEach((id, i) => { ctx.rows[id].seed = i < 7 ? i + 1 : null; ctx.rows[id].confRank = i + 1; });
  }
  return { rows: ctx.rows, divisions, seeds, ctx };
}

// ---- playoffs -------------------------------------------------------------

// The bracket from both conferences' seeds; games are filled in as rounds
// are played. Each game: { round, conf, home, away, hs, as }.
export function newBracket(seeds, year) {
  const b = {
    seeds: { AFC: seeds.AFC.slice(0, 7), NFC: seeds.NFC.slice(0, 7) },
    rounds: [[], [], [], []],
    champion: null,
    // the Super Bowl's designated home team alternates: the AFC in
    // odd-numbered games (the 2026 season's is LXI)
    homeConf: (year - 1965) % 2 === 1 ? 'AFC' : 'NFC',
  };
  for (const conf of ['AFC', 'NFC']) {
    const s = b.seeds[conf];
    for (const [hi, lo] of [[2, 7], [3, 6], [4, 5]]) b.rounds[0].push({ round: 0, conf, home: s[hi - 1], away: s[lo - 1], hs: null, as: null });
  }
  return b;
}

export const ROUND_NAMES = ['Wild Card', 'Divisional', 'Conference Championship', 'Super Bowl'];

const seedOf = (b, id) => {
  for (const conf of ['AFC', 'NFC']) {
    const i = b.seeds[conf].indexOf(id);
    if (i >= 0) return i + 1;
  }
  return 99;
};
export const winnerOf = (g) => (g.hs == null ? null : g.hs > g.as ? g.home : g.away);

// After a round is finished, set up the next one.
export function advance(b) {
  const r = b.rounds.findIndex((list, i) => list.length && list.every((g) => winnerOf(g)) && !(b.rounds[i + 1] && b.rounds[i + 1].length));
  if (r < 0) return b;
  if (r === 3) { b.champion = winnerOf(b.rounds[3][0]); return b; }
  const next = [];
  if (r < 2) {
    for (const conf of ['AFC', 'NFC']) {
      const alive = b.rounds[r].filter((g) => g.conf === conf).map(winnerOf);
      if (r === 0) alive.push(b.seeds[conf][0]);
      alive.sort((x, y) => seedOf(b, x) - seedOf(b, y));
      if (r === 0) {
        next.push({ round: 1, conf, home: alive[0], away: alive[3], hs: null, as: null });
        next.push({ round: 1, conf, home: alive[1], away: alive[2], hs: null, as: null });
      } else {
        next.push({ round: 2, conf, home: alive[0], away: alive[1], hs: null, as: null });
      }
    }
  } else {
    const afc = winnerOf(b.rounds[2].find((g) => g.conf === 'AFC'));
    const nfc = winnerOf(b.rounds[2].find((g) => g.conf === 'NFC'));
    next.push({ round: 3, conf: 'SB', home: b.homeConf === 'NFC' ? nfc : afc, away: b.homeConf === 'NFC' ? afc : nfc, hs: null, as: null, neutral: true });
  }
  b.rounds[r + 1] = next;
  return b;
}
