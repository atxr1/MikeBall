// The odds behind every contested moment: catches, throws, tackles, kick
// returns. Nothing here is a flat percentage: each one starts from the
// player's own ability in a clean situation (a wide-open, well-placed ball is
// caught about 95% of the time) and every opponent nearby takes a share of
// it, by how close he is, which side he's on (in front of the receiver can
// play the ball; trailing behind him can only reach through), whether he's
// looking for the ball and how fast he's closing.
//
//   p = clean × placement × Π (1 − influence of each opponent)
//
// So one defender a yard away and another three yards away turn a 95% catch
// into roughly 25%; a defender trailing a step behind matters less than one
// sitting in the throwing lane.
//
// Pure functions, no randomness: the sim rolls against what they return.

import { clamp, dist } from '../core/util.js';

// How much one opponent at `d` yards can affect the moment, before
// orientation and skill: ~0.8 within half a yard, 0.6 at 1 yd, 0.35 at 2,
// 0.17 at 3, nothing past about 6.
export function proximity(d) {
  return Math.min(0.88, 0.92 * Math.exp(-((Math.max(0, d) / 2.05) ** 1.35)));
}

const unit = (x, y) => {
  const m = Math.hypot(x, y) || 1;
  return [x / m, y / m];
};

// Is `o` looking toward the point (px, py)? 1 = square to it, 0 = his back
// to it. Uses his facing (the way his body is turned).
export function looking(o, px, py) {
  const [ux, uy] = unit(px - o.x, py - o.y);
  const c = Math.cos(o.face) * ux + Math.sin(o.face) * uy;
  return clamp(0.5 + c * 0.6, 0, 1);
}

// ------------------------------------------------------------------ catches
// sim: PlaySim. r: intended receiver (or the closest eligible). ball:
// { x, y, z, fx, fy, speed } where (x, y, z) is where the ball arrives, (fx,
// fy) where it was thrown from. Returns the full breakdown so the sim can
// pick an outcome and the animation can show the right kind of catch.
export function catchOdds(sim, r, ball) {
  const a = r.a;
  // clean: wide open, ball on the numbers, receiver set
  const clean = clamp(0.9 + a.cth * 0.0006, 0.88, 0.97);
  // where the ball is compared to where he is
  const reach = dist(r.x, r.y, ball.x, ball.y);
  const reachOK = 1.05 + (r.rec.height ? (r.rec.height - 72) * 0.02 : 0);
  let place = 1;
  if (reach > reachOK) place *= Math.exp(-(((reach - reachOK) / 1.5) ** 2));
  // height: chest to helmet is ideal; above that he has to go up for it,
  // below the knees he's scooping or diving
  const top = 2.05 + (r.rec.height ? (r.rec.height - 72) * 0.025 : 0);
  if (ball.z > top) place *= Math.exp(-(((ball.z - top) / 0.55) ** 2));
  if (ball.z < 0.55) place *= 0.72 + ball.z * 0.5;
  // over the shoulder (ball coming from behind him) is harder than a ball
  // he's coming back to
  const [bx, by] = unit(ball.x - ball.fx, ball.y - ball.fy);
  const range0 = dist(ball.fx, ball.fy, ball.x, ball.y);
  const sp = Math.hypot(r.vx, r.vy);
  let shoulder = 0;
  if (sp > 1) shoulder = (r.vx * bx + r.vy * by) / sp; // +1: running away from the throw
  place *= 1 - Math.max(0, shoulder) * (0.03 + clamp((range0 - 15) / 150, 0, 0.07)) + Math.max(0, -shoulder) * 0.02;
  // fastballs from close range are harder to hold
  const range = dist(ball.fx, ball.fy, ball.x, ball.y);
  place *= 1 - clamp((ball.speed - 18) / 40, 0, 0.08) * clamp((10 - range) / 8, 0, 1);
  // tracking a long ball over distance
  place *= 1 - clamp((range0 - 20) / 100, 0, 0.12);
  place = clamp(place, 0, 1);

  // defenders
  const strong = (a.cth * 0.6 + a.str * 0.4) / 250; // contested-catch strength
  const toPasser = [-bx, -by];
  const foes = [];
  let keep = 1;
  for (const d of sim.defense) {
    if (d.down || d.blk) continue;
    const dd = dist(d.x, d.y, ball.x, ball.y);
    if (dd > 5.2) continue;
    // in front (between the receiver and the throw) or trailing behind him
    const s = (d.x - r.x) * toPasser[0] + (d.y - r.y) * toPasser[1];
    const front = clamp(s / 1.5, -1, 1);
    // has he found the ball? (turned his head; his body may still be
    // running the other way)
    const seen = sim.t - ball.t0 > (d.seeBall ?? d.ballReact);
    const facing = looking(d, ball.fx, ball.fy);
    const look = seen ? 0.55 + 0.45 * facing : 0.25 * facing;
    const closing = clamp(-((d.vx * (d.x - ball.x) + d.vy * (d.y - ball.y)) / (dd || 1)) / 6, -0.3, 1);
    const skill = ((d.a.mcv + d.a.zcv) / 2 * 0.55 + d.a.bsk * 0.45) / 100;
    let c = proximity(dd)
      * (0.975 + 0.225 * front) // in front 1.2x, trailing 0.75x
      * (0.7 + 0.3 * look)
      * (1 + 0.15 * closing)
      * (0.65 + skill * 0.5)
      * (1.15 - strong);
    c = clamp(c, 0, 0.92);
    if (c < 0.005) continue;
    keep *= 1 - c;
    foes.push({ d, dd, c, front, look });
  }
  const p = clean * place * keep;
  return { p, clean, place, keep, foes, reach, shoulder };
}

// When the ball isn't caught, why not. Returns { cause, foe, intP } where
// cause is 'drop' | 'place' | 'foe'; intP is the chance the foe (or a
// defender near an off-target ball) comes down with it.
export function missCause(odds, u) {
  const wDrop = 1 - odds.clean;
  const wPlace = (1 - odds.place) * odds.clean;
  let total = wDrop + wPlace;
  for (const f of odds.foes) total += f.c;
  let x = u * total;
  if ((x -= wDrop) < 0) return { cause: 'drop', foe: null };
  if ((x -= wPlace) < 0) return { cause: 'place', foe: null };
  for (const f of odds.foes) if ((x -= f.c) < 0) return { cause: 'foe', foe: f };
  return { cause: 'drop', foe: null };
}

// The chance a defender who got to the ball catches it: he has to be in
// front of the receiver or closer to the ball than he is, looking for it,
// and good with his hands.
export function interceptOdds(f, place, reach) {
  const d = f.d;
  const better = clamp((reach + 0.3 - f.dd) / 1.0, 0, 1); // he's got better position
  const frontness = Math.max(clamp(0.25 + f.front * 0.6, 0, 1), better);
  return clamp(frontness * f.look * (0.2 + d.a.bsk * 0.0046) * (0.6 + place * 0.4) * 0.95, 0, 0.55);
}

// A defender near an off-target throw (behind the receiver, or overthrown
// into a safety) can pick it off too.
export function strayIntOdds(d, ball, passerX, passerY) {
  const dd = dist(d.x, d.y, ball.x, ball.y);
  if (dd > 1.8) return 0;
  const look = looking(d, passerX, passerY);
  return clamp(((1.8 - dd) / 1.8) * look * (0.12 + d.a.bsk * 0.0035), 0, 0.5);
}

// ------------------------------------------------------------------ throws
// How rushed the passer is: 0 = clean pocket, 1 = about to be hit. Rushers
// in front of him (in his face, where he can see them) hurry the throw;
// unseen ones from the blind side only matter when they arrive.
export function pocketPressure(sim, qb, targetX, targetY) {
  const [fx, fy] = unit(targetX - qb.x, targetY - qb.y);
  let keep = 1;
  let blind = 0;
  for (const d of sim.defense) {
    if (d.down) continue;
    const dd = dist(d.x, d.y, qb.x, qb.y);
    if (dd > 6) continue;
    const seen = ((d.x - qb.x) * fx + (d.y - qb.y) * fy) / (dd || 1) > -0.2;
    let c = clamp(1.05 * Math.exp(-(dd - 0.7) / 1.3), 0, 0.95);
    if (d.blk) c *= dd < 1.6 ? 0.45 : 0.18; // a blocked rusher still collapses the pocket
    if (!seen) {
      blind = Math.max(blind, dd < 1.4 ? c : 0);
      c *= 0.35;
    }
    keep *= 1 - c;
  }
  return { hurry: 1 - keep, blind };
}

// Error of a throw, in yards at the target: { sideSd, depthSd, heightSd }.
// The passer's accuracy, how far it goes, how rushed he is, whether he's on
// the move or throwing across his body, and whether he's hit as he lets go.
export function throwError(qb, d, press, moving, across, hit) {
  const acc = (100 - qb.a.tha) * 0.012;
  let sd = 0.22 + acc + d * 0.013 + Math.max(0, d - 22) * 0.03;
  sd += press.hurry * (0.45 + (100 - qb.a.dec) * 0.004);
  sd += moving * (0.25 + (100 - qb.a.tha) * 0.006) + across * 0.3;
  if (hit) sd = sd * 1.8 + 0.6;
  return { sideSd: sd, depthSd: sd * 1.15, heightSd: 0.12 + sd * 0.22 };
}

// ------------------------------------------------------------------ tackles
// Chance a tackler who gets his hands on the carrier brings him down. Uses
// the angle he comes from (a square hit from the side is the best tackle;
// chasing from behind is an arm tackle), the carrier's momentum, help
// nearby, and both players' skills. Mean matches the original model.
export function tackleOdds(sim, d, h) {
  const brk = h.a.str * 0.35 + h.a.elu * 0.35 + h.a.agi * 0.15 + h.a.car * 0.15;
  const tk = d.a.tkl * 0.75 + d.a.str * 0.25;
  const sp = Math.hypot(h.vx, h.vy);
  const [ux, uy] = sp > 0.5 ? [h.vx / sp, h.vy / sp] : [0, h.side === 'O' ? 1 : -1];
  const [ax, ay] = unit(d.x - h.x, d.y - h.y);
  const ahead = ax * ux + ay * uy; // +1 tackler in front of him, -1 behind
  const side = Math.abs(ax * uy - ay * ux);
  let angle = 0.04 * side; // square from the side
  if (ahead < -0.3) {
    // chasing: an arm tackle unless he's closing fast
    const closing = (d.vx - h.vx) * -ax + (d.vy - h.vy) * -ay;
    angle -= 0.2 * clamp(-ahead, 0, 1) * clamp(1 - closing / 4, 0.25, 1);
  }
  // momentum: a big back at full speed is hard to stop head-on
  const mh = (h.rec.weight || 215) * sp;
  const md = (d.rec.weight || 230) * Math.max(1, Math.hypot(d.vx, d.vy));
  const mom = ahead > 0.3 ? clamp((md - mh) / 6000, -0.12, 0.08) : 0;
  // help: teammates arriving
  let help = 0;
  const mates = d.side === 'D' ? sim.defense : sim.offense;
  for (const o of mates) {
    if (o === d || o.down || o.blk) continue;
    const dd = dist(o.x, o.y, h.x, h.y);
    if (dd < 3) help += Math.exp(-dd / 1.1);
  }
  const sack = h === sim.qb && sim.phase === 'pre';
  let p = 0.9 + (tk - brk) / 160 + angle + mom + Math.min(help, 2.5) * 0.09
    - (h.juke > 0 ? 0.25 : 0) - (d.blk ? 0.3 : 0) - (d.stumbleT > 0 ? 0.2 : 0) + (sack ? 0.06 : 0);
  return { p: clamp(p, 0.15, 0.97), ahead, side, help, sack };
}

// Ball security on a made tackle: more hands, a bigger hit and a tackler on
// the ball side all knock it loose more often.
export function fumbleOdds(h, d, nTacklers, kind, sack) {
  if (sack) return 0.07 + (kind === 'blind' ? 0.05 : 0);
  let p = 0.009 * (1.3 - h.a.car / 100);
  p *= 1 + (nTacklers - 1) * 0.45;
  if (kind === 'hit') p *= 2.2;
  return p;
}

// ------------------------------------------------------------------ kicks
// A returner catching a punt with coverage bearing down: same proximity
// model as a pass. gap: yards from the nearest gunner when the ball comes
// down. Returns { fair, muff } chances.
export function puntCatchOdds(returner, gap) {
  const c = proximity(gap);
  const hands = (returner.attrs.cth || 60) / 100;
  return {
    fair: clamp(0.08 + c * 1.15, 0, 0.95),
    muff: clamp(0.004 + c * (0.05 - hands * 0.03), 0.002, 0.06),
  };
}
