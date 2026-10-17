// Procedural pixel bodies. Instead of a fixed set of drawn frames, every
// person on the field is a little rig: hips, knees, feet, shoulders, elbows
// and hands are solved from wherever the animation wants the hands and feet
// to be (two-bone IK), the upper body can crouch and lean, and the whole
// figure can tip over, dive or fall at any angle. The same rig draws
// players (helmet and pads), officials (cap and stripes) and the people on
// the sidelines (caps, headsets, polos).
//
// A pose is a small object of whole pixels:
//   view   'N' back, 'S' front, 'E' side facing right, 'W' facing left
//   crouch hips drop this many px (knees bend to absorb it)
//   lean   upper body forward (side view) / head dips (front, back)
//   tx     upper body sideways (front, back views)
//   legs   [[dx, dy], [dx, dy]] feet from their standing spots
//   arms   [[dx, dy, front], [dx, dy, front]] hands from their hanging spots;
//          front = 1 when the hand is in front of the body
//   ball   which hand holds the ball (0 / 1), 2 = tucked, -1 = none
//   prop   { k: 'flag'|'camera'|'sheet'|'mic', hand }
//   rot    tilt of the whole body in 15-degree steps (screen, clockwise +)
//   pivot  'feet' | 'hips'
//   sy     vertical squash in tenths (10 = none), for falling toward or
//          away from the camera
// Arms index 0 is screen-left in front/back views and the far arm in side
// views. Sprites are cached by the quantized pose, cropped to their pixels.

import * as P from './rigparts.js';
import { ready } from './images.js';
import { drawNumber } from './pixelfont.js';

const W = 50;
const H = 50;
export const RIG_AX = 25;
export const RIG_AY = 40;
const BX = 9; // body center x in body space
const OX = RIG_AX - BX;
const OY = RIG_AY - 23;
const MAX = 3200;

const SKIN = ['#f3cfae', '#e3b18c', '#c98d66', '#a8714b', '#7f5236', '#5c3a26'];
const HAIR = ['#2a1d14', '#3b2a1c', '#14110f', '#5a3d22', '#1b1612', '#7a5a34', '#b8b0a3'];

function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}
export function tone(h, amt) {
  const c = hex(h);
  return toHex(c.map((v) => (amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// ------------------------------------------------------------------ outfits
// A player in uniform. uni: { key, jersey, num, trim, helmet, stripe, pants,
// pantsStripe, socks, mask, cleats, collar, decal }
export function playerOutfit(uni, skin) {
  const K = SKIN[skin % SKIN.length];
  return {
    key: `p|${uni.key}|${skin}`,
    pads: true,
    decal: uni.decal || null,
    c: {
      J: uni.jersey, Jl: tone(uni.jersey, 0.22), Jd: tone(uni.jersey, -0.28),
      T: uni.trim, N: uni.num,
      H: uni.helmet, Hl: tone(uni.helmet, 0.45), Hd: tone(uni.helmet, -0.3),
      S: uni.stripe || uni.helmet,
      P: uni.pants, Pl: tone(uni.pants, 0.15), Pd: tone(uni.pants, -0.25),
      PS: uni.pantsStripe || null,
      O: uni.socks, Od: tone(uni.socks, -0.25),
      K, Kd: tone(K, -0.2),
      G: uni.gloves || null,
      M: uni.mask || '#c3c9d2', Md: tone(uni.mask || '#c3c9d2', -0.35),
      C: uni.cleats || '#1c1e24', Cl: tone(uni.cleats || '#1c1e24', 0.25),
      CO: uni.collar || null,
    },
  };
}

// Anyone without pads: officials, coaches, staff, photographers.
// o: { key, skin, hair, shirt: { a, b, collar, badge }, sleeve, pants,
//      socks, shoes, cap, brim, headset, belt, gloves }
export function personOutfit(o) {
  const K = SKIN[(o.skin || 0) % SKIN.length];
  const hair = o.hairColor || HAIR[(o.hair || 0) % HAIR.length];
  const sleeve = o.sleeve || o.shirt.a;
  return {
    key: `h|${o.key}`,
    pads: false,
    c: {
      J: sleeve, Jl: tone(sleeve, 0.2), Jd: tone(sleeve, -0.25),
      T: o.cuff || sleeve, N: null,
      shirt: { ...o.shirt, d: tone(o.shirt.a, -0.22), l: tone(o.shirt.a, 0.18) },
      head: { cap: o.cap || null, brim: o.brim || null, hair, headset: !!o.headset },
      P: o.pants, Pl: tone(o.pants, 0.12), Pd: tone(o.pants, -0.22), PS: null,
      O: o.socks || o.pants, Od: tone(o.socks || o.pants, -0.22),
      K, Kd: tone(K, -0.2),
      G: o.gloves || null,
      C: o.shoes || '#202228', Cl: tone(o.shoes || '#202228', 0.25),
      belt: o.belt || null,
    },
  };
}

// ------------------------------------------------------------------ painter
class Painter {
  constructor(ctx) { this.ctx = ctx; }
  px(x, y, c) { if (!c) return; this.ctx.fillStyle = c; this.ctx.fillRect(Math.round(x) + OX, Math.round(y) + OY, 1, 1); }
  rect(x, y, w, h, c) { if (!c || w <= 0 || h <= 0) return; this.ctx.fillStyle = c; this.ctx.fillRect(Math.round(x) + OX, Math.round(y) + OY, w, h); }
  hline(x0, x1, y, c) { this.rect(Math.min(x0, x1), y, Math.abs(x1 - x0) + 1, 1, c); }
  vline(x, y0, y1, c) { this.rect(x, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1, c); }
  // a limb segment w px thick
  seg(x0, y0, x1, y1, w, c) {
    if (!c) return;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    this.ctx.fillStyle = c;
    const o = (w - 1) / 2;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      this.ctx.fillRect(Math.round(x - o) + OX, Math.round(y - o) + OY, w, w);
    }
  }
}

// Two-bone IK: from root R toward target T with bone lengths a, b. Of the
// two places the middle joint can go, `pref(jx, jy)` picks the one that
// scores higher (knees forward, elbows out and down...). Returns
// [jx, jy, tx, ty] with the target clamped to what the limb can reach.
function ik(rx, ry, tx, ty, a, b, pref) {
  let dx = tx - rx;
  let dy = ty - ry;
  let d = Math.hypot(dx, dy);
  const max = a + b - 0.01;
  if (d > max) {
    tx = rx + (dx / d) * max;
    ty = ry + (dy / d) * max;
    dx = tx - rx; dy = ty - ry; d = max;
  }
  if (d < 1e-3) return [rx, ry + a, tx, ty];
  const cosA = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d)));
  const base = Math.atan2(dy, dx);
  const t = Math.acos(cosA);
  const j1x = rx + Math.cos(base - t) * a;
  const j1y = ry + Math.sin(base - t) * a;
  const j2x = rx + Math.cos(base + t) * a;
  const j2y = ry + Math.sin(base + t) * a;
  return pref(j1x, j1y) >= pref(j2x, j2y) ? [j1x, j1y, tx, ty] : [j2x, j2y, tx, ty];
}

// ------------------------------------------------------------------ build
const cache = new Map();
let scratch = null;
let scratch2 = null;

function poseKey(pose) {
  const l = pose.legs || Z2;
  const a = pose.arms || Z3;
  return `${pose.view}${pose.crouch | 0},${pose.lean | 0},${pose.tx | 0},${l[0][0]},${l[0][1]},${l[1][0]},${l[1][1]},${a[0][0]},${a[0][1]},${a[0][2] | 0},${a[1][0]},${a[1][1]},${a[1][2] | 0},${pose.ball ?? -1},${pose.rot | 0},${pose.pivot || 'f'},${pose.sy || 10},${pose.prop ? `${pose.prop.k}${pose.prop.hand}` : ''},${pose.lie || ''}`;
}
const Z2 = [[0, 0], [0, 0]];
const Z3 = [[0, 0, 0], [0, 0, 0]];

export function clearRigCache() {
  cache.clear();
}

// Building a sprite costs a few hundred canvas calls, so only a handful are
// built per frame; past that, a body keeps the sprite it had last frame
// (memo: any object kept per person) and catches up on the next one.
const BUDGET = 6;
let built = 0;

export function rigFrame() {
  built = 0;
}

export function rigSprite(outfit, pose, memo = null) {
  const side = pose.view === 'E' || pose.view === 'W';
  const decal = outfit.decal && side ? ready(outfit.decal) : null;
  const key = `${outfit.key}|${poseKey(pose)}|${decal ? 1 : 0}`;
  let spr = cache.get(key);
  if (spr) {
    cache.delete(key);
    cache.set(key, spr);
  } else if (memo && memo._spr && built >= BUDGET) {
    return memo._spr;
  } else {
    built++;
    spr = build(outfit, pose, decal);
    cache.set(key, spr);
    if (cache.size > MAX) cache.delete(cache.keys().next().value);
  }
  if (memo) memo._spr = spr;
  return spr;
}

function build(outfit, pose, decal) {
  if (!scratch) {
    scratch = makeCanvas(W, H);
    scratch2 = makeCanvas(W, H);
  }
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const p = new Painter(ctx);
  const c = outfit.c;
  const view = pose.view === 'W' ? 'E' : pose.view;
  const cr = pose.crouch | 0;
  const lean = pose.lean | 0;
  const tx = pose.tx | 0;
  const legs = pose.legs || Z2;
  const arms = pose.arms || Z3;
  const ty = 7 + cr; // top of the torso
  const duck = view === 'E' ? 0 : Math.min(2, Math.max(0, lean >> 1));
  const hy = cr + duck; // top of the head
  let numY = null;

  if (pose.lie) {
    P.lyingFB(p, c, pose.lie === 'up', outfit.pads);
  } else if (view === 'E') {
    paintSide(p, c, outfit, pose, cr, lean, ty, hy, legs, arms, decal, ctx);
  } else {
    numY = paintFB(p, c, outfit, pose, view === 'N', cr, tx, ty, hy, legs, arms);
  }

  // mirror, tilt, squash
  let src = scratch;
  const rot = (pose.rot | 0) * (Math.PI / 12);
  const sy = (pose.sy || 10) / 10;
  if (pose.view === 'W' || rot || sy !== 1) {
    const c2 = scratch2.getContext('2d', { willReadFrequently: true });
    c2.setTransform(1, 0, 0, 1, 0, 0);
    c2.clearRect(0, 0, W, H);
    c2.imageSmoothingEnabled = false;
    const pivY = pose.pivot === 'hips' ? OY + 15 + cr : RIG_AY;
    c2.translate(RIG_AX, pivY);
    if (rot) c2.rotate(rot);
    if (sy !== 1) c2.scale(1, sy);
    if (pose.view === 'W') c2.scale(-1, 1);
    c2.translate(-RIG_AX, -pivY);
    c2.drawImage(scratch, 0, 0);
    src = scratch2;
    if (rot || sy !== 1) numY = null;
  }
  return finish(src, numY, view, c.N);
}

// Outline, crop, and package.
function finish(src, numY, view, numColor) {
  const sctx = src.getContext('2d', { willReadFrequently: true });
  const img = sctx.getImageData(0, 0, W, H);
  const d = img.data;
  const out = new Uint8ClampedArray(d);
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] > 0) {
        if (d[i + 3] < 255) { out[i + 3] = 255; }
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        continue;
      }
      let s = -1;
      if (x + 1 < W && d[i + 7] > 200) s = i + 4;
      else if (x > 0 && d[i - 1] > 200) s = i - 4;
      else if (y + 1 < H && d[i + W * 4 + 3] > 200) s = i + W * 4;
      else if (y > 0 && d[i - W * 4 + 3] > 200) s = i - W * 4;
      if (s < 0) continue;
      out[i] = d[s] * 0.22 + 6;
      out[i + 1] = d[s + 1] * 0.22 + 6;
      out[i + 2] = d[s + 2] * 0.22 + 10;
      out[i + 3] = 255;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { canvas: null, dx: 0, dy: 0, numY: null, view, numColor };
  img.data.set(out);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const canvas = makeCanvas(w, h);
  canvas.getContext('2d').putImageData(img, -x0, -y0, x0, y0, w, h);
  return { canvas, dx: x0 - RIG_AX, dy: y0 - RIG_AY, numY: numY == null ? null : numY + OY - RIG_AY, view, numColor };
}

// ------------------------------------------------------------------ bodies
function legFB(p, c, hx, hy, fx, fy, out) {
  // knees a touch outward
  const [kx, ky, ax, ay] = ik(hx, hy, fx, fy, 3.4, 3.1, (jx) => jx * out);
  p.seg(hx, hy, kx, ky, 3, c.P);
  p.seg(kx, ky, ax, ay - 0.5, 2, c.O);
  p.px(kx - out, ky, c.Pd);
  p.rect(Math.round(ax) - 1, Math.round(ay), 3, 2, c.C);
  p.px(Math.round(ax) - 1, Math.round(ay), c.Cl);
}

function armFB(p, c, sx, sy, hx, hy, out, cross) {
  // elbows out to the side, or down when the hand comes across the body
  const pref = cross ? (jx, jy) => jy : (jx, jy) => jx * out + jy * 0.2;
  const [ex, ey, ax, ay] = ik(sx, sy, hx, hy, 3.2, 3.2, pref);
  p.seg(sx, sy, ex, ey, 2, c.J);
  p.seg(ex, ey, ax, ay, 2, c.G || c.K);
  p.px(ex, ey, c.T);
  return [Math.round(ax), Math.round(ay)];
}

function drawBall(p, x, y) {
  p.rect(x - 1, y - 1, 4, 3, P.BALL);
  p.px(x, y - 1, P.BALL_L);
  p.px(x + 1, y - 1, P.LACE);
}

function drawProp(p, prop, x, y) {
  if (prop.k === 'flag') {
    p.rect(x - 1, y - 2, 3, 3, '#ffd200');
    p.px(x, y + 1, '#c9a400');
  } else if (prop.k === 'camera') {
    p.rect(x - 2, y - 2, 4, 3, '#1b1d22');
    p.rect(x + 2, y - 2, 3, 2, '#2c3038');
    p.px(x + 4, y - 2, '#7d8a99');
  } else if (prop.k === 'sheet') {
    p.rect(x - 1, y - 3, 3, 4, '#f1efe6');
    p.px(x, y - 2, '#c43b3b');
  } else if (prop.k === 'mic') {
    p.rect(x - 2, y - 3, 4, 4, '#cfd3d8');
    p.px(x - 1, y - 2, '#8a929c');
  } else if (prop.k === 'tablet') {
    p.rect(x - 2, y - 2, 4, 3, '#22252c');
    p.px(x - 1, y - 1, '#5b8fd6');
  }
}

function paintFB(p, c, outfit, pose, back, cr, tx, ty, hy, legs, arms) {
  // legs
  const hipY = 15 + cr;
  for (let i = 0; i < 2; i++) {
    const hx = (i === 0 ? 6 : 11);
    const fx = hx + legs[i][0];
    const fy = 21 + legs[i][1];
    legFB(p, c, hx, hipY, fx, fy, i === 0 ? -1 : 1);
  }
  P.hipsFB(p, c, 14 + cr, Math.round(tx / 2));
  // arms behind the body (only visible in the back view when in front)
  const sh = [[3.5 + tx, 8.5 + cr], [13.5 + tx, 8.5 + cr]];
  const hands = [];
  const order = [0, 1];
  const behind = (i) => (back ? arms[i][2] === 1 : arms[i][2] === -1);
  for (const i of order) {
    if (!behind(i)) continue;
    const [sx, sy] = sh[i];
    hands[i] = armFB(p, c, sx, sy, sx + arms[i][0], sy + 6 + arms[i][1], i === 0 ? -1 : 1, false);
  }
  if (outfit.pads) P.padsFB(p, c, ty, back, tx);
  else P.shirtFB(p, c, ty, back, tx);
  if (outfit.pads && outfit.helmet !== false) {
    if (back) P.helmetBack(p, c, hy, tx);
    else P.helmetFront(p, c, hy, tx);
  } else if (back) P.headBack(p, c, hy, tx);
  else P.headFront(p, c, hy, tx);
  for (const i of order) {
    if (behind(i)) continue;
    const [sx, sy] = sh[i];
    // elbows bend outward unless the hand crosses the body
    const cross = i === 0 ? arms[i][0] > 4 : arms[i][0] < -4;
    hands[i] = armFB(p, c, sx, sy, sx + arms[i][0], sy + 6 + arms[i][1], i === 0 ? -1 : 1, cross);
  }
  const ball = pose.ball ?? -1;
  if (ball === 2) drawBall(p, (back ? 12 : 11) + tx, ty + 4);
  else if (ball >= 0 && hands[ball]) drawBall(p, hands[ball][0] - 1, hands[ball][1] - 1);
  if (pose.prop && hands[pose.prop.hand]) drawProp(p, pose.prop, hands[pose.prop.hand][0], hands[pose.prop.hand][1]);
  return ty + 1;
}

function paintSide(p, c, outfit, pose, cr, lean, ty, hy, legs, arms, decal, ctx) {
  const hipX = 8.5;
  const hipY = 15 + cr;
  const sx = 8 + lean;
  const sy = 8.5 + cr;
  // far leg and arm first, in shadow
  const dark = { ...c, P: c.Pd, O: c.Od, J: c.Jd, K: c.Kd, G: c.G ? tone(c.G, -0.25) : null };
  legSide(p, dark, hipX, hipY, 8 + legs[0][0], 21 + legs[0][1]);
  const handB = armSide(p, dark, sx, sy, sx + arms[0][0], sy + 6 + arms[0][1]);
  legSide(p, c, hipX, hipY, 9 + legs[1][0], 21 + legs[1][1]);
  P.hipsSide(p, c, 14 + cr, Math.round(lean / 3));
  if (outfit.pads) P.padsSide(p, c, ty, Math.round(lean / 2));
  else P.shirtSide(p, c, ty, Math.round(lean / 2));
  if (outfit.pads && outfit.helmet !== false) {
    P.helmetSide(p, c, hy, lean);
    if (decal) ctx.drawImage(decal, OX + lean - 1 + 5, OY + hy + 2);
  } else P.headSide(p, c, hy, lean);
  const handF = armSide(p, c, sx, sy, sx + arms[1][0], sy + 6 + arms[1][1]);
  const ball = pose.ball ?? -1;
  const hands = [handB, handF];
  if (ball === 2) drawBall(p, sx + 2, ty + 3);
  else if (ball >= 0) drawBall(p, hands[ball][0] - 1, hands[ball][1] - 1);
  if (pose.prop) drawProp(p, pose.prop, hands[pose.prop.hand][0], hands[pose.prop.hand][1]);
}

function legSide(p, c, hx, hy, fx, fy) {
  // knees bend forward (to the right)
  const [kx, ky, ax, ay] = ik(hx, hy, fx, fy, 3.4, 3.1, (jx) => jx);
  p.seg(hx, hy, kx, ky, 2, c.P);
  p.seg(kx, ky, ax, ay - 0.5, 2, c.O);
  p.rect(Math.round(ax) - 1, Math.round(ay), 4, 2, c.C);
  p.px(Math.round(ax) + 2, Math.round(ay) + 1, c.Cl);
}

function armSide(p, c, sx, sy, hx, hy) {
  // elbows back and down; forward and up when the hands go overhead
  const up = hy < sy - 2;
  const pref = up ? (jx) => jx : (jx, jy) => -jx + jy;
  const [ex, ey, ax, ay] = ik(sx, sy, hx, hy, 3.2, 3.2, pref);
  p.seg(sx, sy, ex, ey, 2, c.J);
  p.seg(ex, ey, ax, ay, 2, c.G || c.K);
  return [Math.round(ax), Math.round(ay)];
}

// ------------------------------------------------------------------ draw
// Draw a rig sprite with its feet at low-res pixel (x, y). num: jersey
// number to print on front/back views (or null).
export function drawRig(ctx, outfit, pose, x, y, num = null, memo = null) {
  const spr = rigSprite(outfit, pose, memo);
  if (!spr.canvas) return spr;
  const X = Math.round(x);
  const Y = Math.round(y);
  ctx.drawImage(spr.canvas, X + spr.dx, Y + spr.dy);
  if (num != null && spr.numY != null && spr.numColor) drawNumber(ctx, num, X - 0.5 + (pose.tx | 0), Y + spr.numY, spr.numColor);
  return spr;
}
