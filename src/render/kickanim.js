// Poses for the special-teams scenes (src/ui/kickscene.js), from the same
// rig and gait as plays from scrimmage: the snapper bent over the ball, the
// holder down on a knee, the kicker's plant and swing, the punter's drop
// and kick, gunners and blockers, the returner getting under the ball (or
// waving for a fair catch), falls and dives.

import { styleOf, gait } from './animate.js';
import { clamp } from '../core/util.js';

const R = Math.round;

function base(view) {
  return { view, crouch: 0, lean: 0, tx: 0, legs: [[0, 0], [0, 0]], arms: [[0, 0, 0], [0, 0, 0]], ball: -1, rot: 0, pivot: 'feet', sy: 10, lift: 0, prop: null, lie: null };
}

function viewOf(ang) {
  const c = Math.cos(ang);
  if (Math.abs(c) > 0.72) return c > 0 ? 'E' : 'W';
  return Math.sin(ang) > 0 ? 'N' : 'S';
}

export function kickPose(p, sc) {
  const t = sc.t;
  const b = sc.ball;
  const kTeam = p.side === 'K';
  const e = base(kTeam ? 'N' : 'S');
  const sp = Math.hypot(p.vx, p.vf);
  const holder = b.state === 'held' && b.holder === p;
  const st = styleOf(p.rec);
  if (p.down) {
    if (p._downAt == null) p._downAt = t;
    const u = clamp((t - p._downAt) / 0.3, 0, 1);
    const c = Math.cos(p.face);
    if (Math.abs(c) > 0.5) {
      e.view = c > 0 ? 'E' : 'W';
      e.rot = (c > 0 ? 1 : -1) * R(u * 6);
      e.arms[0] = [3, -4, 0];
      e.arms[1] = [5, -3, 0];
      return e;
    }
    e.view = Math.sin(p.face) > 0 ? 'N' : 'S';
    if (u >= 1) { e.lie = Math.sin(p.face) > 0 ? 'up' : 'down'; return e; }
    e.sy = R(10 - u * 4);
    e.crouch = R(u * 3);
    return e;
  }
  p._downAt = null;
  if (p.diveT && t < p.diveT) {
    const dx = sc.returner ? sc.returner.x - p.x : 1;
    e.view = dx >= 0 ? 'E' : 'W';
    e.rot = (dx >= 0 ? 1 : -1) * 4;
    e.pivot = 'hips';
    e.arms[0] = [7, -6, 0];
    e.arms[1] = [7, -5, 0];
    e.legs[0] = [-3, -2];
    e.legs[1] = [-2, -2];
    return e;
  }
  const role = p.role;
  // the snapper, bent over the ball until it's gone
  if (role === 'line' && !sc.snapped && sc.type !== 'kickoff' && Math.abs(p.x - sc.ballX) < 0.4) {
    e.view = 'N'; e.crouch = 5; e.lean = 4;
    e.arms[0] = [2, 2, 1]; e.arms[1] = [-2, 2, 1];
    return e;
  }
  // the holder: down on one knee, hands out for the snap, then the spot
  if (role === 'holder') {
    e.view = 'E';
    e.crouch = 5;
    e.legs[0] = [-3, 0];
    e.legs[1] = [2, -1];
    if (holder) { e.arms[1] = [3, 1, 0]; e.ball = 1; }
    else { e.arms[0] = [4, -3, 0]; e.arms[1] = [5, -3, 0]; }
    return e;
  }
  // the kicker: run-up, plant and swing
  if (role === 'kicker') {
    const P = sc.plan || {};
    const kickT = sc.type === 'punt' ? P.tKick : P.tKick;
    const since = kickT != null ? t - kickT : -1;
    if (since >= -0.1 && since < 0.4) {
      e.view = 'E';
      const u = clamp((since + 0.1) / 0.5, 0, 1);
      e.lean = u < 0.3 ? 2 : 0;
      e.arms[0] = [-4, -6, 0];
      e.arms[1] = [5, -7, 0];
      // swing leg comes through and up
      e.legs[1] = [R(-3 + u * 9), R(-u * (sc.type === 'punt' ? 9 : 6))];
      e.legs[0] = [0, 0];
      if (sc.type === 'punt' && since < 0.05 && holder) { e.ball = 1; e.arms[1] = [5, -4, 0]; }
      return e;
    }
    if (sc.type === 'punt' && holder) {
      // catch and set to drop it
      e.view = 'N';
      e.arms[0] = [2, -6, 1]; e.arms[1] = [-2, -6, 1];
      e.ball = 2;
      return e;
    }
    if (sc.type === 'punt' && !sc.kicked) {
      // hands out for the snap
      e.view = 'N';
      e.arms[0] = [3, -6, 1]; e.arms[1] = [-3, -6, 1];
      e.crouch = 1;
      return e;
    }
  }
  // blocking
  if (p.eng) {
    const o = p.eng;
    e.view = viewOf(Math.atan2(o.f - p.f, o.x - p.x));
    const side = e.view === 'E' || e.view === 'W';
    e.crouch = 3; e.lean = 3;
    e.arms[0] = [side ? 5 : 1, -4, side ? 0 : 1];
    e.arms[1] = [side ? 6 : -1, -4, side ? 0 : 1];
    const ph = t * 10 + (st.seed % 7);
    e.legs[0] = [-1, -R(Math.max(0, Math.sin(ph)) * 1.5)];
    e.legs[1] = [1, -R(Math.max(0, -Math.sin(ph)) * 1.5)];
    return e;
  }
  // the returner under the ball: hands up to catch it, or waving for a fair catch
  if (p === sc.returner && b.state === 'air') {
    const tl = b.t0 + b.T - t;
    const res = sc.out && sc.out.res;
    if (tl < 1.6 && sp < 1.5) {
      e.view = kTeam ? 'N' : 'S';
      if (res && res.type === 'fair' && tl > 0.5) {
        e.arms[1] = [R(1 + Math.sin(t * 10) * 2), -13, 0];
        e.arms[0] = [-1, -4, 1];
      } else {
        e.arms[0] = [2, R(-6 - (1 - clamp(tl, 0, 1)) * 3), 1];
        e.arms[1] = [-2, R(-6 - (1 - clamp(tl, 0, 1)) * 3), 1];
      }
      return e;
    }
  }
  // spin / juke / stiff from the scene's cosmetic misses
  const mv = p.move && t - p.move.t0 < 0.4 ? p.move : null;
  if (mv && holder) {
    const u = (t - mv.t0) / 0.4;
    e.view = viewOf(Math.atan2(p.vf, p.vx));
    gait(e, st, p.anim * 0.6 * Math.PI / 2, 0.8, true, 1);
    if (mv.k === 'spin') {
      const order = ['N', 'E', 'S', 'W'];
      e.view = order[(order.indexOf(e.view) + 1 + Math.floor(u * 4)) % 4];
    } else if (mv.k === 'juke') {
      e.tx = mv.dir || 1;
      e.rot = (mv.dir || 1) > 0 ? 1 : -1;
    } else if (mv.k === 'stiff') {
      const side = e.view === 'E' || e.view === 'W';
      if (side) e.arms[0] = [7, -7, 0];
      else e.arms[mv.side === 'L' ? 0 : 1] = [mv.side === 'L' ? -7 : 7, -6, 0];
    }
    return e;
  }
  if (sp > 0.6) {
    e.view = viewOf(Math.atan2(p.vf, p.vx));
    gait(e, st, p.anim * 0.6 * Math.PI / 2, clamp(sp / 8, 0, 1), holder, p.x < 26.7 ? 0 : 1);
    return e;
  }
  // set before the kick
  if (!sc.snapped && sc.type !== 'kickoff') {
    if (role === 'line' || role === 'rush') { e.crouch = 4; e.lean = 3; e.arms[0] = [2, 2, 1]; e.arms[1] = [-1, -1, 1]; }
    else if (role === 'gunner' || role === 'jammer') { e.crouch = 2; e.lean = 2; e.arms[0] = [1, -2, 1]; e.arms[1] = [-1, -3, 1]; }
  } else if (sc.type === 'kickoff' && sc.frozen && (role === 'cover' || role === 'block')) {
    e.crouch = 1; e.lean = 1;
  }
  if (holder) { e.ball = 2; e.arms[1] = [-3, -5, 1]; }
  return e;
}
