// Turns what a player is doing in the sim into a body pose for the rig
// (src/render/rig.js). Nothing here is a canned frame: running is a gait
// generated from his speed, acceleration and his own running style (stride,
// knee lift, arm swing, lean — seeded from who he is); a catch reaches for
// where the ball actually is; a tackler wraps where the runner actually is
// and both fall the way their momentum carries them; celebrations are
// choreographed from a seed. Visual only: reads the sim, never changes
// anything that matters to the result.

import { hashString } from '../core/rng.js';
import { clamp } from '../core/util.js';

const TAU = Math.PI * 2;
export const PXY = 10; // sprite pixels per yard (about a player's height / 2.3)
const ROT = Math.PI / 12;

// ------------------------------------------------------------------ style
export function styleOf(rec) {
  if (rec._style) return rec._style;
  const h = hashString(String(rec.id || rec.last || 'x'));
  const u = (k) => ((h >>> k) & 255) / 255;
  const big = rec.pos === 'OL' || rec.pos === 'DL';
  rec._style = {
    stride: (big ? 0.8 : 0.92) + u(0) * 0.25,
    knee: (big ? 0.6 : 0.85) + u(8) * 0.5,
    swing: 0.7 + u(16) * 0.6,
    elbow: u(24) > 0.5 ? 1 : 0,
    lean: u(4) > 0.6 ? 1 : 0,
    bounce: u(12),
    wide: u(20) > 0.7 ? 1 : 0,
    seed: h,
  };
  return rec._style;
}

// ------------------------------------------------------------------ helpers
const R = Math.round;

function viewOf(p, ang) {
  // hysteresis so diagonal runners don't flicker between views
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const prev = p._view;
  const side = Math.abs(c);
  const k = prev === 'E' || prev === 'W' ? 0.62 : 0.78;
  const v = side > k ? (c > 0 ? 'E' : 'W') : s > 0 ? 'N' : 'S';
  p._view = v;
  return v;
}

function phaseOf(p, now, speed, cycle) {
  if (p._phT == null || now < p._phT || now - p._phT > 0.5) { p._phT = now; p._ph = p._ph || (styleOf(p.rec).seed % 100) / 16; }
  p._ph += (TAU * speed * (now - p._phT)) / Math.max(1.5, cycle);
  p._phT = now;
  return p._ph;
}

function pose(view) {
  return { view, crouch: 0, lean: 0, tx: 0, legs: [[0, 0], [0, 0]], arms: [[0, 0, 0], [0, 0, 0]], ball: -1, rot: 0, pivot: 'feet', sy: 10, lift: 0, prop: null, lie: null };
}

// screen-space offset (sprite px) of a world point from a player, at a
// height z (yards) above the ground, measured from his shoulder
function relShoulder(p, wx, wy, z) {
  return [(wx - p.x) * PXY, -(wy - p.y) * PXY * 0.86 - z * PXY + 14.5];
}

// set a hand to reach a target given relative to the shoulder (side view
// shoulder x shifts with lean)
function reach(e, i, rx, ry, front) {
  e.arms[i] = [R(clamp(rx, -8, 8)), R(clamp(ry - 6, -14, 3)), front];
}

// ------------------------------------------------------------------ gaits
// A running stride. a: 0..1 effort. carry: hold the ball in the arm away
// from the nearest sideline.
export function gait(e, st, ph, a, carry, carrySide) {
  // 12 steps per stride and four effort levels: still each player's own
  // running style, but his frames repeat so they stay cached
  const q = Math.round((ph / TAU) * 12) / 12 * TAU;
  const s = Math.sin(q);
  const c = Math.cos(q);
  const A = Math.round(clamp(a, 0, 1) * 4) / 4;
  const lift = 1 + 2.4 * A * st.knee;
  const stride = 3.4 * A * st.stride;
  const swing = 3.2 * A * st.swing;
  if (e.view === 'E' || e.view === 'W') {
    e.lean = R(A * 2 + st.lean);
    e.crouch = A > 0.25 && Math.abs(s) < 0.45 ? 1 : 0;
    e.legs[0] = [R(-c * stride), -R(Math.max(0, -s) * lift)];
    e.legs[1] = [R(c * stride), -R(Math.max(0, s) * lift)];
    const up = 1 + st.elbow;
    e.arms[0] = [R(c * swing), -R(up + Math.max(0, c) * 2 * A), 0];
    e.arms[1] = [R(-c * swing), -R(up + Math.max(0, -c) * 2 * A), 0];
    if (carry) { e.arms[1] = [3, -5, 0]; e.ball = 2; }
    return e;
  }
  const back = e.view === 'N';
  e.crouch = A > 0.25 && Math.abs(c) < 0.45 ? 1 : 0;
  e.lean = R(A * 1.5);
  const lu = R(Math.max(0, s) * lift);
  const ru = R(Math.max(0, -s) * lift);
  e.legs[0] = [st.wide ? -1 : 0, -lu];
  e.legs[1] = [st.wide ? 1 : 0, -ru];
  // the arm going forward comes up and in; the one going back drops behind
  const fwd = (k) => (k === 0 ? Math.max(0, -s) : Math.max(0, s));
  for (let k = 0; k < 2; k++) {
    const f = fwd(k);
    const inward = k === 0 ? 1 : -1;
    const going = f > 0.15;
    e.arms[k] = [R(inward * (going ? 1 + f * 1.5 : 0)), -R(1 + st.elbow + f * swing * 0.8), going ? 1 : back ? 0 : -1];
  }
  if (carry) {
    const k = carrySide;
    e.arms[k] = [k === 0 ? 3 : -3, -5, 1];
    e.ball = 2;
  }
  return e;
}

// Backpedal: facing the play, moving away from it. Short choppy steps,
// arms bent and low.
function backpedal(e, st, ph) {
  const s = Math.sin(ph * 1.4);
  e.crouch = 2;
  e.lean = 1;
  e.legs[0] = [0, -R(Math.max(0, s) * 1.5)];
  e.legs[1] = [0, -R(Math.max(0, -s) * 1.5)];
  e.arms[0] = [1, -3 - R(Math.max(0, s)), 1];
  e.arms[1] = [-1, -3 - R(Math.max(0, -s)), 1];
  return e;
}

// Shuffle / kick slide: wide base, feet coming together and apart.
function shuffle(e, st, ph, hands) {
  const s = Math.sin(ph * 1.2);
  e.crouch = 3;
  e.lean = 2;
  e.legs[0] = [-1 - R(Math.max(0, s) * 1.5), -R(Math.max(0, s))];
  e.legs[1] = [1 + R(Math.max(0, -s) * 1.5), -R(Math.max(0, -s))];
  const hy = hands === 'up' ? -6 : -3;
  e.arms[0] = [2, hy, 1];
  e.arms[1] = [-2, hy, 1];
  return e;
}

// ------------------------------------------------------------------ stances
// Before the snap: everyone set in the stance of his position.
export function stance(e, p, st, sim) {
  const pos = p.pos;
  const off = p.side === 'O';
  const sv = st.seed;
  const j = (k) => ((sv >>> k) & 1);
  e.view = off ? 'N' : 'S';
  if (pos === 'OL' || (pos === 'DL') || (pos === 'TE' && p.y > -1.6 && Math.abs(p.x - sim.ballX) < 9)) {
    const shotgun = off && sim.qb && sim.qb.y < -2.5 && pos === 'OL' && sim.offPlay && sim.offPlay.cat !== 'run';
    if (shotgun && j(3)) {
      // two-point: hands on the thighs
      e.crouch = 4; e.lean = 3;
      e.arms[0] = [2, -1, 1]; e.arms[1] = [-2, -1, 1];
    } else {
      // three-point (or four for a nose tackle): a hand in the turf
      e.crouch = 5; e.lean = 3;
      const hand = j(4);
      e.arms[hand] = [hand === 0 ? 2 : -2, 3, 1];
      e.arms[1 - hand] = pos === 'DL' && j(5) ? [hand === 0 ? -2 : 2, 3, 1] : [hand === 0 ? -1 : 1, -1, 1];
    }
    e.legs[0] = [-1, 0];
    e.legs[1] = [1, j(6) ? -1 : 0];
    return e;
  }
  switch (pos) {
    case 'QB': {
      const gun = p.y < -2.5;
      e.crouch = gun ? 1 : 3; e.lean = gun ? 1 : 3;
      e.arms[0] = gun ? [2, -4, 1] : [3, -2, 1];
      e.arms[1] = gun ? [-2, -4, 1] : [-3, -2, 1];
      e.legs[0] = [-1, 0]; e.legs[1] = [1, 0];
      return e;
    }
    case 'RB':
      e.crouch = 3; e.lean = 2;
      e.arms[0] = [2, -1, 1]; e.arms[1] = [-2, -1, 1];
      e.legs[0] = [-1, 0]; e.legs[1] = [1, 0];
      return e;
    case 'WR':
    case 'TE':
      // staggered two-point stance, outside foot up
      e.crouch = 2; e.lean = 2;
      e.legs[0] = [0, j(2) ? -1 : 0]; e.legs[1] = [0, j(2) ? 0 : -1];
      e.arms[0] = [1, -2, 1]; e.arms[1] = [-1, -3, 1];
      return e;
    case 'LB':
      e.crouch = 3; e.lean = 2;
      e.arms[0] = [2, -1, 1]; e.arms[1] = [-2, -1, 1];
      e.legs[0] = [-1, 0]; e.legs[1] = [1, 0];
      return e;
    case 'CB':
    case 'S':
      e.crouch = pos === 'CB' ? 2 : 1; e.lean = 1;
      e.legs[0] = [0, j(2) ? -1 : 0]; e.legs[1] = [0, j(2) ? 0 : -1];
      e.arms[0] = [1, -3, 1]; e.arms[1] = [-1, -3, 1];
      return e;
    default:
      return e;
  }
}

// Not set yet, or between plays: weight shifts, hands on hips.
function idle(e, st, now) {
  const w = Math.sin(now * 0.9 + (st.seed % 31));
  e.tx = Math.abs(w) > 0.85 ? (w > 0 ? 1 : -1) : 0;
  if ((st.seed >>> 9) & 1) { e.arms[0] = [2, -3, 0]; e.arms[1] = [-2, -3, 0]; }
  return e;
}

// ------------------------------------------------------------------ falls
// A player going down: the body tips the way his momentum carries him, then
// he's on the turf. now - fallAt is how long since he started going down.
function fall(e, p, now, back) {
  const u = clamp((now - (p.fallAt ?? now - 1)) / 0.3, 0, 1);
  const ang = p.face;
  const c = Math.cos(ang);
  if (Math.abs(c) > 0.55) {
    e.view = c > 0 ? 'E' : 'W';
    // forward = toward his facing: clockwise for E, counter-clockwise for W
    const dir = (c > 0 ? 1 : -1) * (back ? -1 : 1);
    e.rot = dir * R(u * 6);
    e.pivot = 'feet';
    e.lean = 2;
    e.arms[0] = [3, -4, 0];
    e.arms[1] = [5, -3, 0];
    e.legs[0] = [-1, 0];
    e.legs[1] = [1, 0];
    return e;
  }
  const up = Math.sin(ang) > 0;
  if (u >= 1) {
    e.view = up ? 'N' : 'S';
    e.lie = (up !== !!back) ? 'up' : 'down';
    return e;
  }
  e.view = up ? 'N' : 'S';
  e.sy = R(10 - u * 4);
  e.crouch = R(u * 3);
  e.lean = 2;
  e.arms[0] = [2, -5, 1];
  e.arms[1] = [-2, -5, 1];
  return e;
}

// Getting back up: quick reverse of the fall.
function rising(e, p, now) {
  const u = clamp((now - p.upAt) / 0.28, 0, 1);
  e.crouch = R((1 - u) * 5);
  e.lean = R((1 - u) * 3);
  e.arms[0] = [2, R(-1 + u * 1), 1];
  e.arms[1] = [-2, R(-1 + u * 1), 1];
  return e;
}

// ------------------------------------------------------------------ throws
function throwing(e, p, sim) {
  const b = sim.ball;
  const since = sim.passer === p && b.t0 != null && b.state !== 'held' ? sim.t - b.t0 : -1;
  const target = b.state !== 'held' && b.t0 != null ? [b.tx, b.ty] : p.pending && p.pending.r ? [p.pending.r.x, p.pending.r.y] : [p.x, p.y + 10];
  const ang = Math.atan2(target[1] - p.y, target[0] - p.x);
  e.view = viewOf(p, ang);
  const side = e.view === 'E' || e.view === 'W';
  if (since < 0) {
    // wind-up: ball cocked by the ear, front arm pointing at the target
    e.lean = 0;
    e.ball = 1;
    if (side) { e.arms[1] = [-4, -10, 0]; e.arms[0] = [5, -6, 0]; e.legs[0] = [-2, 0]; e.legs[1] = [2, 0]; }
    else { e.arms[1] = [2, -12, 0]; e.arms[0] = [-2, -6, 1]; e.legs[0] = [-1, 0]; e.legs[1] = [1, -1]; }
    if (e.view === 'S' || e.view === 'W') { const t = e.arms[0]; e.arms[0] = e.arms[1]; e.arms[1] = t; e.ball = 0; }
    return e;
  }
  if (since < 0.12) {
    // release: arm high and through
    e.lean = 2;
    if (side) { e.arms[1] = [6, -11, 0]; e.arms[0] = [-2, -2, 0]; }
    else { e.arms[1] = [-1, -12, 0]; e.arms[0] = [-1, -3, 1]; }
  } else {
    // follow-through: throwing hand down across the body
    e.lean = 3;
    e.crouch = 1;
    if (side) { e.arms[1] = [4, 1, 0]; e.arms[0] = [-3, -1, 0]; }
    else { e.arms[1] = [-5, -1, 1]; e.arms[0] = [-1, -2, 0]; }
    e.legs[0] = [-1, 0]; e.legs[1] = [1, -2];
  }
  if (e.view === 'S' || e.view === 'W') { const t = e.arms[0]; e.arms[0] = e.arms[1]; e.arms[1] = t; }
  return e;
}

// ------------------------------------------------------------------ catches
// The receiver (or a defender playing the ball) as it arrives: hands go
// to where the ball will actually be; he goes up for high ones, gets low for
// low ones, lays out when he has to. Returns true if it took over the pose.
function playBall(e, p, sim, st) {
  const b = sim.ball;
  if (b.state !== 'air' || b.away) return false;
  const tLeft = b.t0 + b.T - sim.t;
  if (tLeft > 0.5) return false;
  const d = Math.hypot(b.tx - p.x, b.ty - p.y);
  const mine = b.target === p;
  if (!mine && (p.side !== 'D' || d > 2.4 || tLeft > 0.35)) return false;
  const u = clamp(1 - tLeft / 0.5, 0, 1);
  const z = b.tz ?? 1.3;
  const ang = Math.atan2(b.ty - p.y, b.tx - p.x);
  if (p.diving) {
    const dx = b.tx - p.x;
    e.view = dx >= 0 ? 'E' : 'W';
    e.rot = (dx >= 0 ? 1 : -1) * R(clamp((sim.t - p.diving.t0) / 0.18, 0, 1) * 5);
    e.pivot = 'hips';
    e.lean = 3;
    e.arms[0] = [7, -7, 0];
    e.arms[1] = [7, -6, 0];
    e.legs[0] = [-3, -2];
    e.legs[1] = [-2, -3];
    e.lift = R(Math.sin(clamp((sim.t - p.diving.t0) / 0.34, 0, 1) * Math.PI) * 3);
    return true;
  }
  // keep running toward it, hands coming up late
  const speed = Math.hypot(p.vx, p.vy);
  e.view = viewOf(p, speed > 1 ? Math.atan2(p.vy, p.vx) : ang);
  gait(e, st, p._ph || 0, clamp(speed / 8, 0, 1), false, 0);
  if (u < 0.35) return true;
  const k = clamp((u - 0.35) / 0.65, 0, 1);
  // reach: hands go out to meet the ball, a little in front of where it
  // arrives (toward the throw), never just waiting at the chest
  const bd = Math.hypot(b.fx - b.tx, b.fy - b.ty) || 1;
  const mx = b.tx + ((b.fx - b.tx) / bd) * 0.55;
  const my = b.ty + ((b.fy - b.ty) / bd) * 0.55;
  let [rx, ry] = relShoulder(p, mx, my, z);
  const side = e.view === 'E' || e.view === 'W';
  if (side && e.view === 'W') rx = -rx;
  const front = side ? 0 : e.view === 'N' ? (ry < -3 ? 0 : 1) : 1;
  const jump = z > 2.1 ? clamp((z - 1.9) * PXY, 0, 10) : 0;
  if (jump) {
    e.lift = R(jump * Math.sin(k * Math.PI * 0.5));
    e.legs[0] = [-1, -2];
    e.legs[1] = [1, -3];
    ry += e.lift;
  }
  if (z < 0.8) {
    e.crouch = R((0.8 - z) * 6 * k);
    e.lean = R(3 * k);
    ry -= e.crouch;
  }
  const one = d > 1.7 && mine; // stretching: one hand out
  const spread = side ? 0 : 1;
  const lerpTo = (cur, t) => cur + (t - cur) * k;
  for (let i = 0; i < 2; i++) {
    if (one && i === 0) continue;
    const off = (i === 0 ? -spread : spread) * (one ? 0 : 1);
    const cur = e.arms[i];
    e.arms[i] = [R(lerpTo(cur[0], clamp(rx + off, -8, 8))), R(lerpTo(cur[1], clamp(ry - 6, -14, 3))), front];
  }
  if (!mine) {
    // a defender swipes with one arm at the ball
    e.arms[0] = [e.arms[0][0], R(lerpTo(-2, -6)), e.arms[0][2]];
  }
  return true;
}

// Just after the catch (secure it) or the miss (empty hands, or the ball
// popping out).
function afterCatch(e, p, sim, info, now) {
  const dt = now - info.t;
  if (dt > 0.4) return false;
  if (info.kind === 'catch' && info.who === p) {
    // pull it in to the chest
    if (dt < 0.12) return false;
    e.ball = 2;
    return false;
  }
  if ((info.kind === 'drop' || info.kind === 'miss') && info.who === p) {
    e.arms[0] = [-2, -8, 1];
    e.arms[1] = [2, -8, 1];
    e.lean = 1;
    return true;
  }
  if (info.kind === 'pbu' && info.foe === p && !p.down) {
    e.arms[0] = [-3, -11, 0];
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ contact
function wrapPose(e, p, sim, w, now) {
  const h = w.h;
  const ang = Math.atan2(h.y - p.y, h.x - p.x);
  e.view = viewOf(p, ang);
  const side = e.view === 'E' || e.view === 'W';
  const fwd = e.view === 'E' ? 1 : e.view === 'W' ? -1 : 0;
  const k = clamp(w.t / Math.max(0.1, w.T), 0, 1);
  // hands around him: his waist (wrap, sack), his legs (drag, trip)
  const low = w.kind === 'drag' || w.kind === 'trip';
  let [rx, ry] = relShoulder(p, h.x, h.y, low ? 0.6 : 1.1);
  if (e.view === 'W') rx = -rx;
  const front = side ? 0 : 1;
  e.arms[0] = [R(clamp(rx - 1, -7, 8)), R(clamp(ry - 6, -12, 4)), front];
  e.arms[1] = [R(clamp(rx + 1, -7, 8)), R(clamp(ry - 6, -12, 4)), front];
  const ph = now * 13;
  e.legs[0] = [-1, -R(Math.max(0, Math.sin(ph)) * 1.5)];
  e.legs[1] = [1, -R(Math.max(0, -Math.sin(ph)) * 1.5)];
  e.crouch = low ? 4 : 2;
  e.lean = low ? 4 : 3;
  if (side) {
    const tilt = w.kind === 'trip' ? 5 : w.kind === 'drag' ? 3 + R(k) : w.kind === 'hit' ? 2 : 1 + R(k);
    e.rot = fwd * tilt;
    e.pivot = w.kind === 'trip' ? 'hips' : 'feet';
  }
  if (w.kind === 'pushout') {
    e.arms[0] = [R(clamp(rx, -8, 8)), -5, front];
    e.arms[1] = [R(clamp(rx, -8, 8)), -4, front];
    e.crouch = 2;
  }
}

function wrappedPose(e, p, sim, w, now, st) {
  const sp = Math.hypot(p.vx, p.vy);
  const dir = sp > 0.3 ? Math.atan2(p.vy, p.vx) : p.face;
  e.view = viewOf(p, dir);
  const side = e.view === 'E' || e.view === 'W';
  const k = clamp(w.t / Math.max(0.1, w.T), 0, 1);
  // legs still churning, ball tucked with both arms
  const ph = now * (w.kind === 'drag' ? 14 : 11);
  gait(e, st, ph, 0.55, true, 1);
  e.ball = 2;
  e.arms[0] = side ? [3, -5, 0] : [3, -5, 1];
  e.arms[1] = side ? [3, -4, 0] : [-3, -5, 1];
  const fwd = e.view === 'E' ? 1 : e.view === 'W' ? -1 : 0;
  if (w.kind === 'hit') {
    // rocked back
    if (side) { e.rot = -fwd * R(1 + k * 2); e.lean = 0; }
    else e.sy = R(10 - k * 2);
  } else if (w.kind === 'drag' || w.kind === 'trip' || w.kind === 'wrap' || w.kind === 'sack') {
    // falling forward, fighting for the last yard
    if (side) e.rot = fwd * R(k * (w.kind === 'trip' ? 4 : 2));
    e.lean = 3;
  }
}

// Ball carrier making a move.
function movePose(e, p, sim, st, now) {
  const m = p.move;
  const u = clamp(m.t / m.T, 0, 1);
  const carry = sim.ball.holder === p;
  const sp = Math.hypot(p.vx, p.vy);
  const dir = sp > 0.3 ? Math.atan2(p.vy, p.vx) : p.face;
  switch (m.k) {
    case 'spin': {
      const order = ['N', 'E', 'S', 'W'];
      e.view = order[(order.indexOf(viewOf(p, dir)) + 1 + Math.floor(u * 4)) % 4];
      gait(e, st, p._ph || 0, 0.6, carry, 1);
      e.arms[0] = [-4, -5, 0];
      return true;
    }
    case 'stiff': {
      e.view = viewOf(p, dir);
      gait(e, st, p._ph || 0, 0.8, carry, 1);
      if (m.on) {
        // the arm locks out into the defender's helmet
        let [rx, ry] = relShoulder(p, m.on.x, m.on.y, 1.9);
        const side = e.view === 'E' || e.view === 'W';
        if (e.view === 'W') rx = -rx;
        const arm = side ? 1 : rx < 0 ? 0 : 1;
        e.arms[arm] = [R(clamp(rx, -8, 8)), R(clamp(ry - 6, -12, 0)), side ? 0 : 1];
        if (!side) { e.arms[1 - arm] = [arm === 0 ? -3 : 3, -5, 1]; e.ball = 2; }
        else { e.arms[0] = [3, -5, 0]; e.ball = 2; }
      }
      return true;
    }
    case 'juke': {
      if (m.t > 0.26) return false;
      e.view = sp > 0.3 && p.vy < 0 ? 'S' : 'N';
      const d = m.dir || 1;
      e.tx = d;
      e.crouch = 2;
      e.lean = 2;
      e.legs[0] = d < 0 ? [-3, 0] : [0, -1];
      e.legs[1] = d < 0 ? [0, -1] : [3, 0];
      e.arms[0] = [-3, -4, 0];
      e.arms[1] = [3, -4, 0];
      if (carry) { e.arms[d < 0 ? 1 : 0] = [d < 0 ? -3 : 3, -5, 1]; e.ball = 2; }
      e.rot = d > 0 ? 1 : -1;
      return true;
    }
    case 'truck':
      e.view = viewOf(p, dir);
      gait(e, st, p._ph || 0, 0.7, carry, 1);
      e.crouch = 3;
      e.lean = 4;
      if (e.view === 'E' || e.view === 'W') { e.rot = e.view === 'E' ? 1 : -1; e.arms[0] = [5, -6, 0]; }
      return true;
    case 'hurdle':
      e.view = viewOf(p, dir);
      gait(e, st, 0, 0.5, carry, 1);
      e.lift = R(Math.sin(u * Math.PI) * 9);
      e.legs[0] = [-3, -4];
      e.legs[1] = [3, -2];
      e.arms[0] = [-4, -7, 0];
      return true;
    case 'shrug':
      e.view = viewOf(p, dir);
      gait(e, st, p._ph || 0, 0.7, carry, 1);
      e.tx = R(Math.sin(u * 12));
      return true;
    default:
      return false;
  }
}

// ------------------------------------------------------------------ celebrations
// Seeded choreography: the same celebration never plays the same way twice
// across players, but a replay of the same play matches.
function celebPose(e, p, c, u, speed, now, st) {
  const sd = (st.seed ^ (c.seed || 0)) >>> 0;
  const r = (k) => ((sd >>> k) & 255) / 255;
  e.ball = c.k === 'point' || c.k === 'flexpoint' || c.k === 'arms' || c.k === 'hug' ? 2 : -1;
  const bounce = (f, a) => R(Math.abs(Math.sin(now * f + r(3) * 6)) * a);
  switch (c.k) {
    case 'dejected':
      if (speed > 0.7) return false;
      e.view = p.side === 'O' ? 'S' : 'N';
      e.lean = 2;
      if (r(5) > 0.5) { e.arms[0] = [3, -3, 0]; e.arms[1] = [-3, -3, 0]; } // hands on hips
      else { e.arms[0] = [3, -11, 0]; e.arms[1] = [-3, -11, 0]; } // hands on the helmet
      return true;
    case 'hug':
      if (speed > 1.2) return false;
      e.view = 'S';
      e.arms[0] = [-2, -12, 0];
      e.arms[1] = [2, -12, 0];
      e.lift = bounce(9 + r(7) * 4, 4);
      return true;
    case 'leap': {
      if (c.arrived == null) return false;
      const k = now - c.arrived;
      e.view = 'N';
      e.arms[0] = [-2, -12, 0];
      e.arms[1] = [2, -12, 0];
      e.legs[0] = [-1, -2];
      e.legs[1] = [1, -3];
      e.lift = R(Math.sin(Math.min(1, k / 0.45) * (Math.PI / 2)) * 14);
      return true;
    }
    case 'spike':
      e.view = 'S';
      if (u < 0.25) { e.arms[1] = [1, -12, 0]; e.ball = 1; e.lean = 0; }
      else { e.arms[1] = [-2, 2, 1]; e.lean = 3; e.crouch = 2; }
      if (u > 0.5) { e.arms[0] = [-2, -12, 0]; e.arms[1] = [2, -12, 0]; e.lean = 0; e.crouch = 0; }
      return true;
    case 'dance': {
      // a few moves, mixed and timed from the seed
      e.view = 'S';
      const f = 7 + r(1) * 6;
      const t = now * f;
      const move = Math.floor(now * (0.8 + r(2))) % 3;
      const style = (r(4) * 4) | 0;
      if (move === 0 || style === 0) {
        // arms swinging across, heels tapping
        const s = Math.sin(t);
        e.arms[0] = [R(1 + s * 3), R(-4 - Math.abs(s) * 2), 1];
        e.arms[1] = [R(-1 + s * 3), R(-4 - Math.abs(s) * 2), 1];
        e.legs[0] = [0, -R(Math.max(0, s) * 2)];
        e.legs[1] = [0, -R(Math.max(0, -s) * 2)];
        e.tx = R(s);
      } else if (move === 1 || style === 1) {
        // hips and shoulders: shimmy with the arms out
        const s = Math.sin(t * 1.3);
        e.tx = R(s * 1.4);
        e.arms[0] = [-4, R(-6 + s * 2), 0];
        e.arms[1] = [4, R(-6 - s * 2), 0];
        e.crouch = 2;
      } else {
        // one arm pumping to the sky, bouncing
        e.arms[style & 1] = [style & 1 ? 2 : -2, -12 + bounce(f, 2), 0];
        e.lift = bounce(f * 0.5, 3);
      }
      return true;
    }
    case 'arms':
      e.view = 'S';
      e.arms[0] = [-2, -12, 0];
      e.arms[1] = [2, -12, 0];
      e.lift = u < 0.6 ? bounce(10, 3) : 0;
      return true;
    case 'point':
      // first down: arm pointing down the field
      e.view = p.side === 'O' ? 'N' : 'S';
      e.arms[1] = [2, -12, 0];
      e.ball = 2;
      e.arms[0] = [3, -5, 1];
      return true;
    case 'flex':
      e.view = 'S';
      e.arms[0] = [-4, -9, 0];
      e.arms[1] = [4, -9, 0];
      e.crouch = 1;
      return true;
    case 'flexpoint':
      if (u < 0.7) { e.view = 'S'; e.arms[0] = [-4, -9, 0]; e.arms[1] = [4, -9, 0]; return true; }
      e.view = p.side === 'O' ? 'N' : 'S';
      e.arms[1] = [2, -12, 0];
      return true;
    case 'salute':
      e.view = 'S';
      e.arms[1] = [-5, -12, 0];
      return true;
    case 'sackdance': {
      e.view = 'S';
      const s = Math.sin(now * (8 + r(6) * 5));
      e.tx = R(s * 1.5);
      e.arms[0] = [-4, R(-7 + s * 3), 0];
      e.arms[1] = [4, R(-7 - s * 3), 0];
      e.legs[0] = [R(-1 - Math.max(0, s) * 2), 0];
      e.legs[1] = [R(1 + Math.max(0, -s) * 2), 0];
      e.crouch = 2;
      return true;
    }
    default:
      return false;
  }
}

// ------------------------------------------------------------------ main
// The pose of one sim player this frame. live: the play is running or
// just ended (else he's lined up before the snap).
export function animatePlayer(p, sim, live) {
  const st = styleOf(p.rec);
  const now = sim.t + (sim.post ? sim.post.t : 0);
  const e = pose(p.side === 'O' ? 'N' : 'S');
  const speed = Math.hypot(p.vx, p.vy);
  if (!live || (sim.t < 0.02 && !sim.post)) return stance(e, p, st, sim);
  // keep the stride clock running
  const cycle = (2.2 + 2.8 * clamp(speed / 8, 0, 1)) * st.stride;
  phaseOf(p, now, speed, cycle);
  if (p.down) return fall(e, p, now, p.fellBack);
  if (p.upAt != null && now - p.upAt < 0.28) return rising(e, p, now);
  if (live && p.diveT > 0 && !p.diving) {
    // lunging at a runner (or the ball)
    const tgt = sim.ball.holder || sim.ball;
    const dx = (tgt.x ?? p.x) - p.x;
    e.view = dx >= 0 ? 'E' : 'W';
    e.rot = (dx >= 0 ? 1 : -1) * 4;
    e.pivot = 'hips';
    e.lean = 3;
    e.arms[0] = [7, -6, 0];
    e.arms[1] = [7, -5, 0];
    e.legs[0] = [-3, -2];
    e.legs[1] = [-2, -2];
    return e;
  }
  const c = p.celeb;
  if (c && sim.post && sim.post.t >= c.t0 && celebPose(e, p, c, sim.post.t - c.t0, speed, now, st)) return e;
  const info = sim.catchInfo;
  if (info && afterCatch(e, p, sim, info, now)) return e;
  if (p === sim.qb && (p.pending || (sim.passer === p && sim.ball.t0 != null && sim.t - sim.ball.t0 < 0.4 && sim.ball.state !== 'held'))) return throwing(e, p, sim);
  if (playBall(e, p, sim, st)) return e;
  if (p.move && movePose(e, p, sim, st, now)) return e;
  const w = sim.wrap;
  if (p.wrapOn && w) { wrapPose(e, p, sim, w, now); return e; }
  if (w && w.h === p) { wrappedPose(e, p, sim, w, now, st); return e; }
  const holder = sim.ball.holder === p && sim.ball.state === 'held';
  if (p.blk) {
    const o = p.blk.b === p ? p.blk.d : p.blk.b;
    e.view = viewOf(p, Math.atan2(o.y - p.y, o.x - p.x));
    let [rx, ry] = relShoulder(p, o.x, o.y, 1.2);
    if (e.view === 'W') rx = -rx;
    const side = e.view === 'E' || e.view === 'W';
    const winning = (p.blk.w > 0) === (p.side === 'D');
    e.crouch = 3;
    e.lean = winning ? 4 : 2;
    e.arms[0] = [R(clamp(rx - 1, -6, 7)), R(clamp(ry - 6, -8, 0)), side ? 0 : 1];
    e.arms[1] = [R(clamp(rx + 1, -6, 7)), R(clamp(ry - 6, -8, 0)), side ? 0 : 1];
    const ph = now * 10 + (st.seed % 7);
    e.legs[0] = [-1, -R(Math.max(0, Math.sin(ph)) * 1.5)];
    e.legs[1] = [1, -R(Math.max(0, -Math.sin(ph)) * 1.5)];
    if (side && !winning) e.rot = e.view === 'E' ? -1 : 1;
    return e;
  }
  if (p.stumbleT > 0) {
    e.view = viewOf(p, speed > 0.3 ? Math.atan2(p.vy, p.vx) : p.face);
    e.arms[0] = [-5, -6, 0];
    e.arms[1] = [5, -7, 0];
    e.lean = 0;
    e.crouch = 1;
    if (e.view === 'E' || e.view === 'W') e.rot = e.view === 'E' ? -1 : 1;
    return e;
  }
  // moving
  if (speed > 0.6) {
    const dir = Math.atan2(p.vy, p.vx);
    const facing = Math.cos(p.face - dir);
    if (p === sim.qb && holder && sim.phase === 'pre' && !sim.scramble && p.vy < -0.5) {
      // the drop: backpedal with the ball up
      e.view = 'N';
      backpedal(e, st, p._ph);
      e.ball = 1;
      e.arms[1] = [-2, -5, 1];
      return e;
    }
    if (p === sim.qb && holder && sim.phase === 'pre' && !sim.scramble && p.vy >= -0.5) {
      // sliding in the pocket, eyes downfield
      e.view = 'N';
      shuffle(e, st, p._ph, 'up');
      e.crouch = 1;
      e.ball = 1;
      return e;
    }
    // backpedal / kick slide: moving one way while facing the other
    if (!holder && sim.phase !== 'run' && sim.t < 2.2) {
      if ((p.pos === 'CB' || p.pos === 'S') && p.vy > 0.5 && p.assign && p.assign.t !== 'blitz' && speed < 6.2 && sim.t < 1.4) {
        e.view = 'S';
        return backpedal(e, st, p._ph);
      }
      if (p.pos === 'OL' && (p.job.t === 'passpro' || p.job.t === 'draw') && p.vy < 0.2) {
        e.view = 'N';
        return shuffle(e, st, p._ph, 'up');
      }
      if (p.pos === 'LB' && p.assign && p.assign.t === 'zone' && Math.abs(p.vx) > Math.abs(p.vy) && sim.t < 1.6) {
        e.view = 'S';
        return shuffle(e, st, p._ph, 'low');
      }
    }
    e.view = viewOf(p, facing < -0.2 ? p.face : dir);
    const a = clamp(speed / 8, 0, 1);
    const carrySide = p.x < 26.7 ? 0 : 1; // ball in the arm away from... the near sideline
    gait(e, st, p._ph, a, holder, e.view === 'N' ? 1 - carrySide : carrySide);
    // closing on the ball carrier: breakdown, arms out to tackle
    const h = sim.ball.holder;
    if (h && h.side !== p.side && sim.phase === 'run' && !holder) {
      const dd = Math.hypot(h.x - p.x, h.y - p.y);
      if (dd < 2.6) {
        e.crouch = 2;
        e.lean = Math.max(e.lean, 3);
        let [rx, ry] = relShoulder(p, h.x, h.y, 1.1);
        if (e.view === 'W') rx = -rx;
        const side = e.view === 'E' || e.view === 'W';
        e.arms[0] = [R(clamp(rx - 2, -7, 7)), R(clamp(ry - 6, -9, 0)), side ? 0 : 1];
        e.arms[1] = [R(clamp(rx + 2, -7, 7)), R(clamp(ry - 6, -9, 0)), side ? 0 : 1];
      }
    }
    return e;
  }
  // standing
  e.view = viewOf(p, p.face);
  if (p === sim.qb && sim.phase === 'pre' && holder) {
    // set in the pocket, eyes downfield, ball up at the chest
    e.view = 'N';
    e.ball = 1;
    e.arms[1] = [-2, -5, 1];
    e.arms[0] = [2, -4, 1];
    e.crouch = 1;
    return e;
  }
  if (holder) { e.ball = 2; e.arms[1] = [-3, -5, 1]; }
  else if (sim.done) idle(e, st, now);
  return e;
}
