// Draws the officiating crew (src/sim/officials.js) with the rig: striped
// shirts, white knickers, black caps (the referee's is white). They run
// with the play, throw the flag, and give the NFL hand signals after the
// whistle: touchdown, incomplete pass, stop the clock, first down, and the
// referee's penalty signals (holding, pass interference, false start,
// offside, roughing the passer, face mask, delay of game...).

import { personOutfit, drawRig } from './rig.js';
import { gait } from './animate.js';
import { drawShadow } from './pixelsprites.js';
import { clamp } from '../core/util.js';

const R = Math.round;
const outfits = {};

export function officialOutfit(o) {
  const ref = o.role === 'R';
  const k = `${o.role}`;
  if (!outfits[k]) {
    outfits[k] = personOutfit({
      key: `official-${k}`,
      skin: (o.rec.num * 7) % 6,
      hair: o.rec.num % 7,
      shirt: { a: '#f2f2ee', b: '#16171a', collar: '#16171a' },
      sleeve: '#f2f2ee',
      cuff: '#16171a',
      pants: '#f4f4f0',
      socks: '#16171a',
      shoes: '#121316',
      cap: ref ? '#f6f6f2' : '#16171a',
      brim: ref ? '#f6f6f2' : '#16171a',
    });
  }
  return outfits[k];
}

const STYLE = { stride: 0.85, knee: 0.7, swing: 0.8, elbow: 1, lean: 0, wide: 0, seed: 7 };

function base(view) {
  return { view, crouch: 0, lean: 0, tx: 0, legs: [[0, 0], [0, 0]], arms: [[0, 0, 0], [0, 0, 0]], ball: -1, rot: 0, pivot: 'feet', sy: 10, lift: 0, prop: null, lie: null };
}

// A signal, animated over time u (seconds since it started).
function signalPose(e, kind, u) {
  const w = Math.sin(u * 9);
  e.view = 'S';
  switch (kind) {
    case 'td':
      e.arms[0] = [-1, -13, 0]; e.arms[1] = [1, -13, 0];
      return true;
    case 'incomplete':
      // arms swinging across in front, palms down
      e.arms[0] = [R(4 + w * 3), -5, 1];
      e.arms[1] = [R(-4 - w * 3), -5, 1];
      return true;
    case 'stop':
      // both hands crisscrossed above the head
      e.arms[0] = [R(2 + w * 2), -13, 0];
      e.arms[1] = [R(-2 - w * 2), -13, 0];
      return true;
    case 'first':
      // pointing toward the defense's goal (up the field)
      e.view = 'N';
      e.arms[1] = [2, -12, 0];
      return true;
    case 'holding':
      // grasping one wrist in front of the chest
      e.arms[0] = [4, -6, 1]; e.arms[1] = [-3, -6, 1];
      e.tx = R(w * 0.6);
      return true;
    case 'dpi':
      // both hands pushing forward from the shoulders
      e.arms[0] = [1, R(-9 + Math.max(0, w) * 2), 1]; e.arms[1] = [-1, R(-9 + Math.max(0, w) * 2), 1];
      return true;
    case 'contact':
      // one open hand pushed forward
      e.arms[1] = [-1, R(-8 + Math.max(0, w) * 2), 1];
      return true;
    case 'ur':
      // personal foul: arms overhead, one wrist struck by the other hand
      e.arms[0] = [1, -13, 0]; e.arms[1] = [R(-1 + w), -12, 0];
      return true;
    case 'rtp':
      // personal foul (wrist chop overhead), then a throwing motion
      if (u < 0.8) { e.arms[0] = [1, -13, 0]; e.arms[1] = [R(-1 + w), -12, 0]; }
      else { e.view = 'E'; e.arms[1] = [R(4 * Math.sin(u * 6)), -10, 0]; }
      return true;
    case 'mask':
      // personal foul, then a hand grabbing an imaginary face mask
      if (u < 0.8) { e.arms[0] = [1, -13, 0]; e.arms[1] = [R(-1 + w), -12, 0]; }
      else e.arms[1] = [-4, R(-11 + Math.max(0, w) * 3), 1];
      return true;
    case 'falseStart':
      // forearms rolling over each other in front of the body
      e.arms[0] = [R(3 + w * 2), R(-6 + Math.cos(u * 9) * 2), 1];
      e.arms[1] = [R(-3 + w * 2), R(-6 - Math.cos(u * 9) * 2), 1];
      return true;
    case 'offside':
      // hands on hips
      e.arms[0] = [-2, -3, 0]; e.arms[1] = [2, -3, 0];
      return true;
    case 'delay':
      // arms folded across the chest
      e.arms[0] = [6, -6, 1]; e.arms[1] = [-6, -6, 1];
      return true;
    case 'subs':
      // hands on top of the head
      e.arms[0] = [2, -12, 0]; e.arms[1] = [-2, -12, 0];
      return true;
    case 'timeout':
      e.arms[0] = [R(-2 + w * 2), -13, 0]; e.arms[1] = [R(2 - w * 2), -13, 0];
      return true;
    default:
      return false;
  }
}

export function officialPose(o, crew, now, live) {
  const e = base('S');
  const speed = Math.hypot(o.vx, o.vy);
  if (o.signal && now >= o.signal.t0 && now - o.signal.t0 < (o.signal.kind === 'td' ? 3 : 2.4)) {
    if (signalPose(e, o.signal.kind, now - o.signal.t0)) return e;
  }
  if (now - o.throwT < 0.32) {
    // the flag comes off the belt and out of the hand
    const u = (now - o.throwT) / 0.32;
    e.view = o.x < 26 ? 'E' : 'W';
    e.arms[1] = u < 0.35 ? [-3, -2, 0] : [6, -9, 0];
    if (u < 0.35) e.prop = { k: 'flag', hand: 1 };
    e.lean = 1;
    return e;
  }
  if (speed > 0.6) {
    const ang = Math.atan2(o.vy, o.vx);
    const c = Math.cos(ang);
    e.view = Math.abs(c) > 0.7 ? (c > 0 ? 'E' : 'W') : Math.sin(ang) > 0 ? 'N' : 'S';
    const ph = (o.anim * 0.6 / 4) * Math.PI * 2;
    gait(e, STYLE, ph, clamp(speed / 7.5, 0, 1), false, 0);
    return e;
  }
  // set: wings and the umpire lean on their knees before the snap
  const c = Math.cos(o.face);
  e.view = Math.abs(c) > 0.7 ? (c > 0 ? 'E' : 'W') : Math.sin(o.face) > 0 ? 'N' : 'S';
  if (!live && (o.role === 'DJ' || o.role === 'LJ' || o.role === 'U')) {
    e.crouch = 2;
    e.lean = 2;
    e.arms[0] = [2, -1, e.view === 'E' || e.view === 'W' ? 0 : 1];
    e.arms[1] = [-2, -1, e.view === 'E' || e.view === 'W' ? 0 : 1];
  }
  return e;
}

// sim: PlaySim with a crew; los: line of scrimmage (f).
export function drawCrew(ctx, cam, sim, los, live) {
  const crew = sim.crew;
  if (!crew) return;
  const now = sim.clock();
  const list = crew.list.slice().sort((a, b) => b.y - a.y);
  for (const o of list) {
    const x = cam.sx(o.x);
    const y = cam.sy(los + o.y);
    if (x < -24 || x > cam.w + 24 || y < -6 || y > cam.h + 34) continue;
    drawShadow(ctx, x, y, 9);
    drawRig(ctx, officialOutfit(o), officialPose(o, crew, now, live && sim.t > 0.02), x, y);
  }
}

// Yellow flags: in the air, then lying on the turf.
// landed: true draws the flags on the turf (under the players), false the
// ones still in the air (over them).
export function drawFlags(ctx, cam, sim, los, landed) {
  const crew = sim.crew;
  if (!crew) return;
  for (const f of crew.flags) {
    if (f.landed !== landed) continue;
    const x = Math.round(cam.sx(f.x));
    const gy = Math.round(cam.sy(los + f.y));
    if (f.landed) {
      ctx.fillStyle = 'rgba(10,30,12,0.4)';
      ctx.fillRect(x - 2, gy + 1, 5, 1);
      ctx.fillStyle = '#f7d117';
      ctx.fillRect(x - 2, gy - 1, 4, 2);
      ctx.fillRect(x + 1, gy, 2, 1);
      ctx.fillStyle = '#b89600';
      ctx.fillRect(x - 2, gy, 1, 1);
    } else {
      const y = gy - Math.round(f.z * cam.s * 0.9);
      ctx.fillStyle = 'rgba(10,30,12,0.35)';
      ctx.fillRect(x - 1, gy, 3, 1);
      ctx.fillStyle = '#f7d117';
      ctx.fillRect(x - 1, y - 1, 3, 3);
      ctx.fillStyle = '#b89600';
      ctx.fillRect(x, y + 2, 1, 1);
    }
  }
}
