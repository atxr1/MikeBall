// The quick play resolver: decides a snap from the players' attributes and
// the two calls without running the 22-man simulation, and hands back the
// same result PlaySim does, so the rules engine, the box score and the
// play-by-play don't know the difference. Season mode uses it for the games
// the user isn't coaching (a whole league week in well under a second).
//
// It reads the calls the way the full sim plays them out: who's in the
// progression and how deep their routes go, how many rushers come, man or
// zone, a run call against a pass, light boxes against nickel and dime.
// Its averages are tuned to the NFL's (Pro Football Reference league
// totals, 2023-25): about 65% completions, 7 yards an attempt, a sack on
// 6-7% of dropbacks, an interception on 2.2% of throws, 4.3 yards a carry.
// Pure logic: no DOM. Every draw comes from the seeded RNG passed in.

import { ROUTES } from '../data/playbook.js';
import { clamp } from '../core/util.js';
import { FOULS } from '../sim/fouls.js';

const A = (p, k, d = 50) => (p && p.attrs && p.attrs[k] != null ? p.attrs[k] : d);
const mean = (list) => (list.length ? list.reduce((s, x) => s + x, 0) / list.length : 50);
const OL = ['LT', 'LG', 'C', 'RG', 'RT'];

function routeDepth(r) {
  const def = ROUTES[r];
  if (!def) return 6;
  return Math.max(...def.pts.map((p) => p[1]));
}

export function foul(key, player, extra = {}) {
  const f = FOULS[key];
  return { key, name: f.name, on: f.on, yards: f.yards, auto1st: !!f.auto1st, spotFoul: !!f.spotFoul, afterPlay: !!f.afterPlay, deadBall: !!f.deadBall, lossOfDown: !!f.lossOfDown, spotY: null, player: player || null, signal: f.signal, dead: false, ...extra };
}

// exponential-ish draw with the given mean
const expo = (rng, m) => -Math.log(1 - rng.next() * 0.999) * m;

function units(off, def, dPlay) {
  const ol = OL.map((s) => off[s]).filter(Boolean);
  const front = Object.entries(def).filter(([s]) => /^(DE|DT|NT|OLB)/.test(s)).map(([, p]) => p);
  const backers = Object.entries(def).filter(([s]) => /^(WILL|MIKE|SAM|ILB)/.test(s)).map(([, p]) => p);
  const dbs = Object.entries(def).filter(([s]) => /^(CB|NB|DB|FS|SS)/.test(s)).map(([s, p]) => ({ s, p }));
  const assign = dPlay.assign || {};
  const rushers = Object.entries(assign).filter(([, a]) => a.t === 'rush' || a.t === 'blitz').map(([s]) => def[s]).filter(Boolean);
  return {
    ol,
    front,
    backers,
    dbs,
    rushers,
    runBlock: mean(ol.map((p) => A(p, 'rbk') * 0.75 + A(p, 'str') * 0.25)),
    passBlock: mean(ol.map((p) => A(p, 'pbk') * 0.8 + A(p, 'awr') * 0.2)),
    runStop: mean([...front, ...backers].map((p) => A(p, 'rsd') * 0.45 + A(p, 'tkl') * 0.35 + A(p, 'str') * 0.2)),
    rush: mean(rushers.map((p) => A(p, 'prs') * 0.6 + A(p, 'spd') * 0.2 + A(p, 'str') * 0.2)),
  };
}

// Who makes the tackle: the front on short gains, the secondary on long ones.
function tacklerFor(rng, def, gain) {
  const list = Object.entries(def).filter(([s]) => s !== 'K' && s !== 'P');
  return rng.weighted(list, ([s, p]) => {
    const db = /^(CB|NB|DB|FS|SS)/.test(s);
    const lb = /^(WILL|MIKE|SAM|ILB|OLB)/.test(s);
    const w = gain <= 3 ? (db ? 0.35 : lb ? 1.6 : 1.3) : gain <= 10 ? (db ? 1 : lb ? 1.5 : 0.6) : (db ? 2 : lb ? 0.8 : 0.15);
    return w * (0.5 + A(p, 'tkl') / 100);
  })[1];
}

function blankResult(o) {
  return {
    outcome: 'tackle', kind: 'run', yards: 0, spotY: 0, spotX: o.ballX,
    turnover: false, interception: false, td: false, defTD: false, safety: false, touchback: false,
    incomplete: false, why: undefined, outOfBounds: false, slide: false, elapsed: 5,
    passer: null, target: null, receiver: null, rusher: null, tackler: null, assist: null,
    interceptor: null, defender: null, fumble: null, airYards: null, catchY: null,
    review: { sideline: false, dive: false, tdContact: false, ball: null },
    firstDown: false, fouls: [], evCounts: {}, offPlay: o.offPlay.id, defPlay: o.defPlay.id, quick: true,
  };
}

// Where the ball carrier ends up: touchdown, safety, or a spot.
function finish(r, o, gain) {
  const toGoal = 100 - o.ballOn;
  if (gain >= toGoal) { r.td = true; r.outcome = 'td'; gain = toGoal; r.outOfBounds = false; }
  if (gain <= -o.ballOn) { r.safety = true; gain = -o.ballOn; }
  r.yards = Math.round(gain);
  r.spotY = gain;
  r.firstDown = !r.td && o.toGo != null && gain >= o.toGo;
  if (r.td) r.tackler = null;
  return r;
}

function fumble(rng, carrier, def, r, tackler) {
  const p = 0.011 + (82 - A(carrier, 'car', 70)) / 2500;
  if (!rng.chance(clamp(p, 0.004, 0.03))) return false;
  const lost = rng.chance(0.5);
  const rec = lost ? tacklerFor(rng, def, 2) : carrier;
  r.fumble = { by: carrier, forcedBy: tackler, recoveredBy: rec, lost };
  if (lost) { r.turnover = true; r.outcome = 'fumble_lost'; }
  return true;
}

export function quickPlay(o) {
  const { offPlay, defPlay, offLineup: off, defLineup: def, rng } = o;
  const r = blankResult(o);
  const u = units(off, def, defPlay);
  const qb = off.QB;
  if (offPlay.special === 'kneel' || offPlay.id === 'kneel') {
    Object.assign(r, { kind: 'kneel', outcome: 'kneel', passer: qb, elapsed: 1.5 });
    return finish(r, o, -1);
  }
  if (offPlay.special === 'spike' || offPlay.id === 'spike') {
    Object.assign(r, { kind: 'spike', outcome: 'spike', passer: qb, incomplete: true, elapsed: 1 });
    return finish(r, o, 0);
  }
  return offPlay.cat === 'run' ? quickRun(o, r, u) : quickPass(o, r, u);
}

function quickRun(o, r, u) {
  const { offPlay, defPlay, offLineup: off, defLineup: def, rng } = o;
  const carrySlot = Object.entries(offPlay.assign || {}).find(([, a]) => a.t === 'carry');
  let carrier = (carrySlot && off[carrySlot[0]]) || off.RB || off.QB;
  // backs share the load: the No. 2 gets about a third of the carries
  if (carrier === off.RB && o.rb2 && !offPlay.shortYardage && rng.chance(0.3)) carrier = o.rb2;
  r.kind = 'run';
  r.rusher = carrier;
  const skill = A(carrier, 'spd') * 0.3 + A(carrier, 'elu') * 0.25 + A(carrier, 'agi') * 0.2 + A(carrier, 'str') * 0.15 + A(carrier, 'car') * 0.1;
  const box = defPlay.front === 'dime' ? 0.45 : defPlay.front === 'nickel' ? 0.15 : defPlay.front === 'goal' ? -0.45 : 0;
  const call = defPlay.cat === 'run' ? -0.4 : defPlay.cat === 'blitz' ? -0.1 : defPlay.cat === 'zone' ? 0.05 : 0;
  // (league starters average about 82 blocking against 75 at the point,
  // and an 84 skill line at running back)
  const adv = (u.runBlock - u.runStop - 6.8) / 17 + (skill - 84) / 30 + box + call;
  const short = !!offPlay.shortYardage;
  let gain;
  const pStuff = clamp(0.115 - adv * 0.045 + (defPlay.cat === 'blitz' ? 0.04 : 0), 0.04, 0.24);
  const pBig = clamp((short ? 0.008 : 0.048) + adv * 0.018 + (A(carrier, 'spd') - 85) / 500 + (defPlay.cat === 'blitz' ? 0.012 : 0), 0.004, 0.1);
  const roll = rng.next();
  if (roll < pStuff) gain = -rng.int(0, short ? 1 : 4);
  else if (roll < pStuff + pBig) gain = 11 + expo(rng, 11);
  else if (short) gain = Math.max(0, rng.normal(2.1 + adv * 0.5, 1.5));
  else gain = Math.max(0, rng.normal(4.75 + adv * 0.85, 2.7));
  gain = Math.round(gain);
  const tackler = tacklerFor(rng, def, gain);
  r.tackler = tackler;
  r.spotX = clamp(o.ballX + (offPlay.dir ? offPlay.dir * rng.float(1, 8) : rng.float(-3, 3)), 1, 52.3);
  r.elapsed = 3.8 + Math.min(gain, 40) * 0.09 + rng.float(0, 1.2);
  if (gain >= 4 && rng.chance(o.wantOOB ? 0.35 : 0.08)) { r.outOfBounds = true; r.outcome = 'oob'; r.tackler = null; }
  finish(r, o, gain);
  if (!r.td && !r.safety && fumble(rng, carrier, def, r, tackler)) {
    r.outOfBounds = false;
    if (r.turnover) r.yards = 0;
  }
  // flags: holding on the run, a face mask on the tackle
  if (!r.turnover && rng.chance(0.03 * (1.27 - u.runBlock / 300))) {
    const who = rng.pick(u.ol);
    r.fouls.push(foul('holdO', who, { spotY: Math.min(gain, 0) }));
  } else if (r.tackler && rng.chance(0.002)) r.fouls.push(foul('mask', r.tackler));
  return r;
}

function quickPass(o, r, u) {
  const { offPlay, defPlay, offLineup: off, defLineup: def, rng } = o;
  const qb = off.QB;
  r.kind = 'pass';
  r.passer = qb;
  const drop = offPlay.drop || 5;
  const blitz = Math.max(0, u.rushers.length - 4);
  const rbBlocks = offPlay.assign && offPlay.assign.RB && offPlay.assign.RB.t === 'passpro' ? 4 : 0;
  // how fast the pocket closes
  // (starting rushers average about 74 against 79 pass blocking)
  let pressure = 0.27 + (u.rush - u.passBlock + 5.3 - rbBlocks) / 60 + blitz * 0.075 + (drop >= 7 ? 0.06 : drop <= 3 ? -0.09 : 0) - (offPlay.screen ? 0.12 : 0);
  if (defPlay.cat === 'run') pressure -= 0.04;
  pressure = clamp(pressure, 0.06, 0.62);
  const feel = (A(qb, 'awr') + A(qb, 'dec')) / 2;

  if (!offPlay.screen && !offPlay.hailMary && rng.chance(pressure * 0.29 * (1.25 - feel / 200) * (1.15 - A(qb, 'agi') / 400))) {
    // sacked
    r.kind = 'sack';
    r.outcome = 'sack';
    const sacker = rng.weighted(u.rushers.length ? u.rushers : u.front, (p) => A(p, 'prs') ** 1.3);
    r.tackler = sacker;
    r.elapsed = 2.6 + rng.float(0, 1.6);
    const loss = -rng.int(3, 10);
    finish(r, o, loss);
    if (!r.safety && rng.chance(0.11)) {
      const lost = rng.chance(0.5);
      r.fumble = { by: qb, forcedBy: sacker, recoveredBy: lost ? rng.pick(u.front) : rng.pick(u.ol), lost };
      if (lost) { r.turnover = true; r.outcome = 'fumble_lost'; r.yards = 0; }
    }
    return r;
  }
  if (!offPlay.screen && !offPlay.hailMary && rng.chance(pressure * 0.12 * (A(qb, 'spd') / 75) ** 2)) {
    // scrambles
    r.kind = 'scramble';
    r.rusher = qb;
    let gain = rng.chance(0.08) ? 12 + expo(rng, 8) : Math.max(-2, rng.normal(5 + (A(qb, 'spd') - 75) / 10, 3.5));
    gain = Math.round(gain);
    r.slide = gain > 3 && rng.chance(0.4);
    r.tackler = r.slide ? null : tacklerFor(rng, def, gain);
    if (!r.slide && gain > 3 && rng.chance(0.35)) { r.outOfBounds = true; r.outcome = 'oob'; r.tackler = null; }
    r.elapsed = 5 + rng.float(0, 2);
    return finish(r, o, gain);
  }
  if (!offPlay.hailMary && rng.chance(pressure * 0.075)) {
    r.incomplete = true;
    r.outcome = 'incomplete';
    r.why = 'thrown away';
    r.elapsed = 3.5 + rng.float(0, 1.5);
    return finish(r, o, 0);
  }

  // who's it going to, and how far downfield
  const prog = (offPlay.progression || ['X', 'Z', 'Y', 'RB']).filter((s) => off[s]);
  const order = [0.36, 0.25, 0.17, 0.12, 0.1];
  const cands = prog.map((s, i) => {
    const a = offPlay.assign && offPlay.assign[s];
    const route = a && (a.r || (a.t === 'chkrel' ? 'flat' : null));
    const p = off[s];
    const q = A(p, 'rte') * 0.35 + A(p, 'cth') * 0.35 + A(p, 'spd') * 0.3;
    return { s, p, route, w: (order[i] || 0.08) * (0.55 + q / 180) };
  });
  if (!cands.length) cands.push({ s: 'RB', p: off.RB || qb, route: 'flat', w: 1 });
  const tgt = offPlay.screen ? cands[0] : rng.weighted(cands, (c) => c.w);
  const rec = tgt.p;
  r.target = rec;
  const rd = routeDepth(tgt.route);
  const goes = ROUTES[tgt.route] && ROUTES[tgt.route].end === 'continue' && rd >= 20;
  let air;
  if (offPlay.screen || tgt.route === 'screen') air = rng.float(-3, 0);
  else if (offPlay.hailMary) air = Math.min(100 - o.ballOn + 3, rng.float(40, 55));
  else if (goes) air = rng.chance(0.6) ? 16 + expo(rng, 10) : rng.float(8, 17);
  else air = Math.max(-1, rng.normal(rd * 0.85, 2.2));
  air = Math.min(air, 100 - o.ballOn + 9);
  r.airYards = Math.round(air);

  // the man covering him
  const man = defPlay.cat === 'man' || defPlay.cat === 'blitz';
  const dbs = u.dbs.map((d) => d.p);
  const lbs = u.backers;
  const coverPool = air >= 15 ? dbs : [...dbs, ...lbs, ...lbs];
  const cover = rng.weighted(coverPool.length ? coverPool : Object.values(def), (p) => (man ? A(p, 'mcv') : A(p, 'zcv')) / 50);
  const cov = man ? A(cover, 'mcv') : A(cover, 'zcv');
  const tha = A(qb, 'tha');
  let pc = air <= 0 ? 0.86 : air < 5 ? 0.78 : air < 10 ? 0.67 : air < 15 ? 0.585 : air < 20 ? 0.5 : air < 30 ? 0.39 : 0.28;
  // (centered on league starters: 84 accuracy, 80 hands, 78 routes, 76 cover)
  pc += (tha - 84) / 150 + (A(rec, 'cth') - 80) / 260 + (A(rec, 'rte') - 78) / 400 - (cov - 76) / 160 - (pressure - 0.27) * 0.45;
  if (!man && air < 10) pc += 0.03;
  if (defPlay.cat === 'blitz') pc += air < 10 ? 0.02 : -0.03;
  if (defPlay.cat === 'run') pc += 0.04;
  if (defPlay.id === 'prevent') pc += air < 15 ? 0.06 : -0.15;
  // the red zone: less room, tighter windows
  if (o.ballOn >= 80 && air >= 4) pc -= 0.06 + (o.ballOn - 80) * 0.004;
  if (offPlay.hailMary) pc = 0.07;
  pc = clamp(pc, 0.04, 0.94);
  let pInt = (air < 5 ? 0.009 : air < 15 ? 0.022 : 0.04) * (1 + (81 - A(qb, 'dec')) / 55) * (1 + (pressure - 0.27) * 1.2) * (A(cover, 'bsk', 60) / 72);
  if (offPlay.hailMary) pInt = 0.2;
  pInt = clamp(pInt, 0.002, 0.25);
  r.elapsed = 2.4 + drop * 0.22 + rng.float(0, 0.8);
  r.spotX = clamp(o.ballX + rng.float(-18, 18), 2, 51.3);

  const roll = rng.next();
  if (roll < pInt) {
    // picked off: back the other way
    r.interception = true;
    r.turnover = true;
    r.interceptor = cover;
    r.outcome = 'tackle';
    let back = rng.chance(0.07) ? 100 : Math.round(expo(rng, 9));
    const catchAt = Math.max(air, -1);
    if (o.ballOn + catchAt >= 100) {
      // in the end zone: usually down for the touchback
      if (rng.chance(0.7)) { r.touchback = true; back = 0; }
    }
    const spot = catchAt - back;
    if (o.ballOn + spot <= 0) { r.defTD = true; r.td = true; r.outcome = 'td'; r.spotY = -o.ballOn; } else r.spotY = spot;
    // caught in the end zone and never brought out: a touchback
    if (!r.defTD && o.ballOn + spot >= 100) r.touchback = true;
    r.yards = 0;
    r.tackler = r.defTD || r.touchback ? null : rng.pick(Object.values(off));
    r.elapsed += 2 + back * 0.12;
    if (!man && !r.defTD && rng.chance(0.01)) r.fouls.push(foul('holdO', rng.pick(u.ol)));
    return r;
  }
  if (roll < pInt + pc) {
    // caught (or dropped)
    if (!offPlay.hailMary && rng.chance(clamp(0.033 + (70 - A(rec, 'cth')) / 900, 0.01, 0.08))) {
      Object.assign(r, { incomplete: true, outcome: 'incomplete', why: 'dropped' });
      return finish(r, o, 0);
    }
    r.receiver = rec;
    r.catchY = Math.round(air);
    const yacMean = (air <= 0 ? 6.2 : air < 5 ? 5.1 : air < 10 ? 3.9 : air < 20 ? 3.4 : 4.2) * (0.6 + (A(rec, 'spd') + A(rec, 'elu') + A(rec, 'agi')) / 600);
    let yac = expo(rng, yacMean * 0.82);
    if (rng.chance(0.03 + (A(rec, 'spd') - 85) / 600)) yac += 10 + expo(rng, 14);
    const gain = Math.round(air + yac);
    r.tackler = tacklerFor(rng, def, gain);
    if (!r.td && gain >= 3 && rng.chance(o.wantOOB ? 0.45 : 0.14)) { r.outOfBounds = true; r.outcome = 'oob'; r.tackler = null; }
    r.elapsed += 1 + Math.min(yac, 40) * 0.11;
    finish(r, o, gain);
    if (!r.td && fumble(rng, rec, def, r, r.tackler) && r.turnover) r.yards = 0;
    if (!r.turnover && rng.chance(0.024)) r.fouls.push(foul('holdO', rng.pick(u.ol)));
    else if (!r.turnover && man && rng.chance(0.018)) r.fouls.push(foul('holdD', cover));
    else if (!r.turnover && rng.chance(0.006)) r.fouls.push(foul('rtp', rng.pick(u.rushers.length ? u.rushers : u.front)));
    return r;
  }
  // incomplete
  r.incomplete = true;
  r.outcome = 'incomplete';
  if (rng.chance(0.42)) { r.why = 'broken up'; r.defender = cover; } else r.why = rng.chance(0.5) ? 'overthrown' : 'off target';
  finish(r, o, 0);
  r.yards = 0;
  r.spotY = 0;
  // the flags downfield
  if (air >= 8 && rng.chance(0.07)) r.fouls.push(foul('dpi', cover, { spotY: Math.max(1, Math.round(air)) }));
  else if (rng.chance(man ? 0.04 : 0.018)) r.fouls.push(foul(rng.chance(0.7) ? 'holdD' : 'contact', cover));
  else if (rng.chance(0.022)) r.fouls.push(foul('holdO', rng.pick(u.ol)));
  else if (rng.chance(0.004)) r.fouls.push(foul('rtp', rng.pick(u.rushers.length ? u.rushers : u.front)));
  return r;
}
