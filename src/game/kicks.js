// Kicking plays: kickoffs, punts, field goals and extra points.
// Outcomes are resolved here; the renderer animates them from the returned
// `anim` description. Field positions are in the receiving team's frame
// (ballOn 0 = their own goal line) unless noted.

import { clamp } from '../core/util.js';
import { puntCatchOdds } from '../sim/odds.js';

export function fgDistance(ballOn) {
  return Math.round(100 - ballOn + 17);
}

// Field goals and extra points are kicked at a target: the uprights are
// 18'6" apart, so from the hash the window is a little narrower and tilted.
// The kick goes off with an angle error (the kicker's accuracy, a bad snap
// or hold, a late-game kick) and a carry (his leg); it has to get inside the
// uprights and over the bar. The rush gets a hand on it when it's slow or
// low. ctx: { ballX, rush, pro, clutch } — rush/pro are 0-100 averages of
// the rushers and the protection; clutch 0..1 for a late, close game.
const POST = 3.083; // half the distance between the uprights, yards
const MID = 80 / 3;

// Snap and hold: almost always clean. time = snap to kick, seconds.
export function kickOperation(rng, holder) {
  const op = { snap: 'good', hold: 'clean', time: 1.28 + rng.normal(0, 0.04) };
  if (rng.chance(0.012)) {
    op.snap = rng.pick(['high', 'low', 'wide']);
    op.time += 0.15 + rng.next() * 0.3;
  }
  if (rng.chance(0.006 + (holder ? Math.max(0, 70 - holder.attrs.awr) * 0.0003 : 0))) {
    op.hold = 'bobbled';
    op.time += 0.25 + rng.next() * 0.25;
  }
  return op;
}

export function kickWindow(distance, ballX = MID) {
  const left = Math.atan2(MID - POST - ballX, distance);
  const right = Math.atan2(MID + POST - ballX, distance);
  return { left, right, aim: (left + right) / 2 };
}

// Angle error, degrees (1 sd).
export function kickSpread(kicker, op, clutch = 0) {
  const a = kicker.attrs;
  let sd = 2.7 * (1 + (80 - a.kac) * 0.013);
  if (op.snap !== 'good') sd *= 1.3;
  if (op.hold !== 'clean') sd *= 1.45;
  sd *= 1 + clutch * Math.max(0, 75 - a.awr) * 0.004;
  return Math.max(1.2, sd);
}

// a long kick takes a harder swing, and a harder swing is less accurate
const longKick = (distance) => 1 + Math.max(0, distance - 45) * 0.016;

export function maxFgRange(kicker) {
  return Math.floor(52 + kicker.attrs.kpw * 0.12);
}

export function blockChance(distance, op, ctx = {}) {
  const push = ((ctx.rush ?? 70) - (ctx.pro ?? 72)) / 2500;
  return clamp(0.006 + push + Math.max(0, op.time - 1.32) * 0.22 + Math.max(0, distance - 45) * 0.0007, 0.002, 0.25);
}

// Make probability for the CPU's decisions (no snap or hold trouble).
export function fgMakeProb(kicker, distance, ballX = MID) {
  const w = kickWindow(distance, ballX);
  const sd = (kickSpread(kicker, { snap: 'good', hold: 'clean' }) * longKick(distance) * Math.PI) / 180;
  const half = (w.right - w.left) / 2;
  const lat = erf(half / (sd * Math.SQRT2));
  const carry = 1 / (1 + Math.exp(-(maxFgRange(kicker) + 1.5 - distance) / 1.6));
  return clamp(lat * carry, 0.01, 0.995);
}

function erf(x) {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

function kickAt(kicker, distance, rng, ctx) {
  const op = kickOperation(rng, ctx.holder);
  if (rng.chance(blockChance(distance, op, ctx))) return { good: false, blocked: true, distance, op };
  const w = kickWindow(distance, ctx.ballX ?? MID);
  const sd = (kickSpread(kicker, op, ctx.clutch || 0) * longKick(distance) * Math.PI) / 180;
  const ang = w.aim + rng.normal(0, sd);
  const carry = maxFgRange(kicker) + 1.5 + rng.normal(0, 1.6);
  const edge = (0.12 * Math.PI) / 180;
  let inside = ang > w.left && ang < w.right;
  // off the upright: right on the edge it can bounce either way
  let doink = false;
  if (Math.abs(ang - w.left) < edge || Math.abs(ang - w.right) < edge) {
    doink = true;
    inside = rng.chance(0.4);
  }
  const long = carry >= distance;
  const good = inside && long;
  let miss = null;
  if (!long) miss = 'short';
  else if (!inside) miss = ang <= (w.left + w.right) / 2 ? 'wide left' : 'wide right';
  return { good, blocked: false, distance, miss, op, angle: ang, window: w, doink, carry };
}

export function fieldGoal(kicker, ballOn, rng, ctx = {}) {
  return kickAt(kicker, fgDistance(ballOn), rng, ctx);
}

export function extraPoint(kicker, rng, ctx = {}) {
  return kickAt(kicker, 33, rng, { ...ctx, ballX: MID });
}

// Returns { type, ballOn (receiving team frame), returnYds, landing, td, fumble }
export function kickoff(kicker, returner, rng, { onside = false, fromYard = 35 } = {}) {
  const a = kicker.attrs;
  if (onside) {
    const recovered = rng.chance(0.12);
    const spot = fromYard + rng.int(10, 13); // kicking-team frame
    return {
      type: recovered ? 'onside_recovered' : 'onside_failed',
      kickingRecovers: recovered,
      ballOn: recovered ? spot : 100 - spot,
      landing: 100 - spot,
      returnYds: 0,
    };
  }
  // The 2025 kickoff: the kicker aims for the landing zone (the receiving
  // 20 to the goal line). Into the end zone and downed (or out the back):
  // touchback at the 35. Lands in the zone and rolls in, downed: the 20.
  // Short of the zone, or out of bounds: the receiving team's 40.
  const distance = 61 + (a.kpw - 78) * 0.3 + rng.normal(0, 4.5);
  const landing = clamp(100 - fromYard - distance, -9, 45); // yards from receiving goal line
  if (rng.chance(0.006)) return { type: 'oob', ballOn: 40, landing, returnYds: 0 };
  if (fromYard === 35) {
    if (landing > 20) return { type: 'short', ballOn: 40, landing, returnYds: 0 };
    if (landing < 0) {
      // the returner can bring it out, but deep in the end zone he takes the 35
      const out = landing > -8 && rng.chance(clamp(0.45 + landing * 0.07, 0.04, 0.45));
      if (!out) return { type: 'touchback', ballOn: 35, landing, returnYds: 0 };
    } else if (landing < 2.5 && rng.chance(0.2)) {
      return { type: 'touchback', ballOn: 20, landing, returnYds: 0, rolled: true };
    }
  }
  if (rng.chance(0.004)) return { type: 'fumble', kickingRecovers: true, ballOn: clamp(Math.round(landing + 20), 1, 99), landing, returnYds: 20 };
  const r = returner.attrs;
  let ret = 22 + (r.spd - 85) * 0.5 + (r.elu - 70) * 0.15 + rng.normal(0, 7);
  if (rng.chance(0.035)) ret += rng.int(15, 45);
  ret = Math.max(5, ret);
  let ballOn = landing + ret;
  // brought out of the end zone but stopped before he gets out of it
  if (ballOn <= 0) return { type: 'touchback', ballOn: 35, landing, returnYds: 0 };
  if (ballOn >= 100 || rng.chance(0.003)) return { type: 'td', ballOn: 100, landing, returnYds: Math.round(100 - landing), td: true };
  ballOn = clamp(Math.round(ballOn), 1, 99);
  return { type: 'return', ballOn, landing, returnYds: Math.round(ballOn - landing) };
}

// ballOn: punting team's frame. Returns new ballOn in the receiving team's
// frame. The coverage matters: how long the punt hangs against how fast the
// gunners get down the field decides how much room the returner has when it
// comes down, and that decides fair catch, muff and return (same proximity
// model as a contested pass, src/sim/odds.js). ctx: { rush, pro, gunner
// (fastest cover man), jammer, holder }.
export function punt(punter, returner, ballOn, rng, ctx = {}) {
  const a = punter.attrs;
  const op = kickOperation(rng, null);
  op.time += 0.75; // a punt takes longer than a field goal
  if (rng.chance(clamp(0.003 + ((ctx.rush ?? 70) - (ctx.pro ?? 72)) / 4000 + Math.max(0, op.time - 2.08) * 0.2, 0.001, 0.2))) {
    const spot = clamp(ballOn - 8, 1, 99);
    return { type: 'blocked', ballOn: 100 - spot, gross: 0, returnYds: 0, landing: spot, op };
  }
  const room = 100 - ballOn;
  // from midfield in, he pooches it short of the goal line instead
  const aim = room < 54 ? room - 10 : 45.5 + (a.kpw - 78) * 0.25;
  const gross = clamp(rng.normal(aim - (op.snap !== 'good' ? 6 : 0), room < 54 ? 4.5 : 5.5), 25, 70);
  // hang: a big leg hangs it longer; a line drive that goes far comes down sooner
  const hang = clamp(4.3 + (a.kpw - 78) * 0.012 - (gross - 45.5) * 0.02 + rng.normal(0, 0.25) - (op.snap !== 'good' ? 0.4 : 0), 3.2, 5.2);
  const landing = ballOn + gross; // punting team frame
  if (landing >= 100) {
    // Some punts are downed inside the 5 instead of reaching the end zone.
    if (landing < 104 && rng.chance(0.35)) {
      const spot = clamp(rng.int(95, 99), 1, 99);
      return { type: 'downed', ballOn: 100 - spot, gross: Math.round(spot - ballOn), returnYds: 0, landing: spot, hang, op };
    }
    return { type: 'touchback', ballOn: 20, gross: Math.round(100 - ballOn), returnYds: 0, landing: 100, hang, op };
  }
  // angled for the sideline: out of bounds where it crosses
  if (rng.chance(landing > 75 ? 0.1 : 0.04)) {
    const spot = clamp(Math.round(landing - rng.float(0, 4)), 1, 99);
    return { type: 'oob', ballOn: 100 - spot, gross: Math.round(spot - ballOn), returnYds: 0, landing: spot, hang, op };
  }
  // the gunner: release (beat the jam), then run it down
  const g = ctx.gunner ? ctx.gunner.attrs : { spd: 88, str: 55 };
  const j = ctx.jammer ? ctx.jammer.attrs : { mcv: 70, str: 55 };
  const speed = 8.3 + (g.spd - 80) * 0.06;
  const release = clamp(0.35 + ((j.mcv * 0.5 + j.str * 0.5) - (g.spd * 0.5 + g.str * 0.5)) / 120 + rng.normal(0, 0.15), 0.1, 1.2);
  const path = gross + 3;
  const arrive = release + path / speed - 0.9; // the ball's in the air from ~0.9 s after the snap
  // he has to give the returner a yard to make the catch
  const gap = Math.max(1, (arrive - hang) * speed);
  const k = puntCatchOdds(returner, gap);
  const deep = landing > 88;
  // inside the 20 the returner often lets it bounce: the coverage downs it,
  // or it rolls into the end zone
  if (landing >= 82 && rng.chance(0.38 + (landing - 82) * 0.02)) {
    const end = landing + rng.normal(3, 4);
    if (end >= 100) return { type: 'touchback', ballOn: 20, gross: Math.round(100 - ballOn), returnYds: 0, landing: 100, hang, op };
    const spot = clamp(Math.round(end), 1, 99);
    return { type: 'downed', ballOn: 100 - spot, gross: Math.round(spot - ballOn), returnYds: 0, landing: spot, hang, gap, op };
  }
  if (rng.chance(k.muff)) {
    return { type: 'muff', kickingRecovers: true, ballOn: clamp(Math.round(landing), 1, 99), gross: Math.round(gross), returnYds: 0, landing, hang, gap, op };
  }
  if (rng.chance(deep ? Math.max(0.65, k.fair) : k.fair)) {
    return { type: 'fair', ballOn: clamp(Math.round(100 - landing), 1, 99), gross: Math.round(gross), returnYds: 0, landing, hang, gap, op };
  }
  const r = returner.attrs;
  let ret = Math.max(0, rng.normal(6.5 + (r.spd - 85) * 0.25 + (r.elu - 70) * 0.1 + (gap - 5) * 0.55, 4.5));
  if (rng.chance(0.012 + Math.max(0, gap - 6) * 0.004)) ret += rng.int(15, 50);
  const spot = 100 - landing + ret;
  if (spot >= 100) return { type: 'td', ballOn: 100, gross: Math.round(gross), returnYds: Math.round(ret), landing, td: true, hang, gap, op };
  return { type: 'return', ballOn: clamp(Math.round(spot), 1, 99), gross: Math.round(gross), returnYds: Math.round(ret), landing, hang, gap, op };
}
