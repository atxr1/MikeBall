// Procedural pixel-art players. Each sprite is painted pixel by pixel into a
// tiny canvas, then given a dark selective outline, and cached. Views:
// 'N' (back, running up the screen), 'S' (front, facing the camera),
// 'E' (side, facing right; 'W' is E mirrored).
//
// Proportions: about 23 px tall and 12 px across the shoulder pads, which
// on the field (≈11 px per yard) makes a player about 2.4 yards tall —
// slightly heroic, like broadcast pixel art, but true to the field.

import { drawNumber } from './pixelfont.js';
import { ready } from './images.js';
import { teamArt } from '../data/realleague.js';

export const SW = 24; // sprite canvas width (room for arms held out)
export const SH = 27; // sprite canvas height (2 px headroom for raised arms)
export const AX = 12; // anchor x (between the feet)
export const AY = 24; // anchor y (bottom row of the cleats)
const TOP = 2; // headroom above the helmet
const DX = 3; // left margin: body parts are drawn in 18-px-wide coordinates

const SKIN = ['#f3cfae', '#e3b18c', '#c98d66', '#a8714b', '#7f5236', '#5c3a26'];
const MASK = '#c3c9d2';
const MASK_D = '#7d8590';
const CLEAT = '#1c1e24';
const CLEAT_L = '#4a4f5a';
const EYE = '#16120f';
const BALL = '#7a3f1c';
const BALL_L = '#a35a2c';
const LACE = '#f1e7d8';

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
function lum(h) {
  const [r, g, b] = hex(h);
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// uni: { jersey, num, trim, helmet, stripe, pants, socks }
export function paletteFor(uni, skin) {
  const K = SKIN[skin % SKIN.length];
  return {
    J: uni.jersey, Jl: tone(uni.jersey, 0.22), Jd: tone(uni.jersey, -0.28),
    T: uni.trim,
    N: uni.num,
    H: uni.helmet, Hl: tone(uni.helmet, 0.45), Hd: tone(uni.helmet, -0.3),
    S: uni.stripe || uni.helmet,
    P: uni.pants, Pl: tone(uni.pants, 0.15), Pd: tone(uni.pants, -0.25),
    PS: uni.pantsStripe || null,
    O: uni.socks, Od: tone(uni.socks, -0.25),
    K, Kd: tone(K, -0.2),
    M: uni.mask || MASK, Md: tone(uni.mask || MASK, -0.35),
    C: uni.cleats || CLEAT, Cl: tone(uni.cleats || CLEAT, 0.25),
    CO: uni.collar || null,
  };
}

// ------------------------------------------------------------------ painter
class Painter {
  constructor(ctx, dy = 0, dx = 0) { this.ctx = ctx; this.dy = dy; this.dx = dx; }
  px(x, y, c) { if (!c) return; this.ctx.fillStyle = c; this.ctx.fillRect(x + this.dx, y + this.dy, 1, 1); }
  rect(x, y, w, h, c) { if (!c || w <= 0 || h <= 0) return; this.ctx.fillStyle = c; this.ctx.fillRect(x + this.dx, y + this.dy, w, h); }
  hline(x0, x1, y, c) { this.rect(Math.min(x0, x1), y, Math.abs(x1 - x0) + 1, 1, c); }
  vline(x, y0, y1, c) { this.rect(x, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1, c); }
  limb(x0, y0, x1, y1, w, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / n);
      const y = Math.round(y0 + ((y1 - y0) * i) / n);
      this.rect(x, y, w, 1, c);
    }
  }
}

// Selective outline: every empty pixel touching the sprite becomes a dark
// version of its neighbor.
function outline(canvas) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const out = new Uint8ClampedArray(d);
  const at = (x, y) => (y * w + x) * 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = at(x, y);
      if (d[i + 3] > 0) continue;
      let src = -1;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = at(nx, ny);
        if (d[j + 3] > 200) { src = j; break; }
      }
      if (src < 0) continue;
      out[i] = d[src] * 0.22 + 6;
      out[i + 1] = d[src + 1] * 0.22 + 6;
      out[i + 2] = d[src + 2] * 0.22 + 10;
      out[i + 3] = 255;
    }
  }
  img.data.set(out);
  ctx.putImageData(img, 0, 0);
}

// ------------------------------------------------------------------ parts
// Body center is x = 8.5 (columns 3..14). Rows: helmet 0-7, pads/torso 7-13,
// pants 14-17, socks 18-20, cleats 21-22 (before the TOP offset).

function helmetFront(p, c, y) {
  p.hline(7, 10, y, c.H);
  p.hline(6, 11, y + 1, c.H);
  p.rect(5, y + 2, 8, 4, c.H);
  p.px(7, y, c.Hl); p.px(6, y + 1, c.Hl); p.px(7, y + 1, c.Hl); p.px(6, y + 2, c.Hl);
  p.rect(8, y, 2, 2, c.S); // crown stripe
  p.vline(12, y + 3, y + 5, c.Hd);
  // face
  p.hline(6, 11, y + 3, c.Kd);
  p.hline(6, 11, y + 4, c.K);
  p.px(7, y + 4, EYE); p.px(10, y + 4, EYE);
  // facemask bar
  p.hline(6, 11, y + 5, c.M);
  // chin
  p.px(6, y + 6, c.Hd); p.px(11, y + 6, c.Hd);
  p.hline(7, 10, y + 6, c.K);
  p.px(8, y + 6, c.Kd); p.px(9, y + 6, c.Kd);
  p.hline(7, 10, y + 7, c.Md);
}

function helmetBack(p, c, y) {
  p.hline(7, 10, y, c.H);
  p.hline(6, 11, y + 1, c.H);
  p.rect(5, y + 2, 8, 4, c.H);
  p.hline(6, 11, y + 6, c.Hd);
  p.px(7, y, c.Hl); p.px(6, y + 1, c.Hl); p.px(6, y + 2, c.Hl); p.px(6, y + 3, c.Hl);
  p.vline(12, y + 3, y + 5, c.Hd);
  p.rect(8, y, 2, 6, c.S);
  p.hline(7, 10, y + 7, c.Kd); // neck
}

function helmetSide(p, c, y, ox) {
  // facing right
  const x = ox;
  p.hline(x + 6, x + 10, y, c.S);
  p.hline(x + 5, x + 11, y + 1, c.H);
  p.px(x + 6, y + 1, c.Hl);
  p.rect(x + 5, y + 2, 5, 4, c.H);
  p.px(x + 5, y + 2, c.Hl);
  p.px(x + 7, y + 3, c.Hd); // ear hole
  p.hline(x + 6, x + 9, y + 6, c.Hd);
  // face
  p.rect(x + 10, y + 2, 2, 4, c.K);
  p.px(x + 10, y + 2, c.H);
  p.px(x + 11, y + 3, EYE);
  p.px(x + 10, y + 5, c.Kd);
  // facemask
  p.vline(x + 12, y + 3, y + 6, c.Md);
  p.hline(x + 11, x + 13, y + 5, c.M);
}

function torsoFB(p, c, y, back) {
  // shoulder pads
  p.hline(5, 12, y, c.J);
  p.rect(3, y + 1, 12, 2, c.J);
  p.px(3, y + 1, c.Jl); p.px(4, y + 1, c.Jl);
  p.px(14, y + 1, c.Jd); p.px(14, y + 2, c.Jd);
  // body
  p.rect(5, y + 3, 8, 4, c.J);
  p.vline(5, y + 3, y + 6, c.Jl);
  p.vline(12, y + 3, y + 6, c.Jd);
  p.hline(5, 12, y + 6, c.Jd);
  // collar
  if (back) p.hline(7, 10, y, c.Jd);
  else { p.hline(7, 10, y, c.CO || c.Jd); p.px(8, y, c.Kd); p.px(9, y, c.Kd); }
}

function armsFB(p, c, y, la, ra, pose) {
  // y = top of the pads row
  if (pose === 'push') {
    for (const x of [3, 13]) {
      p.rect(x, y + 1, 2, 2, c.J);
      p.rect(x, y + 3, 2, 1, c.T);
    }
    // hands out in front, at chest height
    p.rect(4, y + 4, 2, 2, c.K);
    p.rect(12, y + 4, 2, 2, c.K);
    return;
  }
  for (const [x, off, shade] of [[3, la, c.Jl], [13, ra, c.Jd]]) {
    p.rect(x, y + 1, 2, 2, c.J);
    p.px(x === 3 ? 3 : 14, y + 1, shade);
    p.rect(x, y + 3, 2, 1, c.T);
    p.rect(x, y + 4 + off, 2, 3, c.K);
    p.px(x === 3 ? 3 : 14, y + 5 + off, c.Kd);
  }
}

function throwArm(p, c, y) {
  p.rect(3, y + 1, 2, 2, c.J);
  p.rect(3, y + 3, 2, 1, c.T);
  p.rect(3, y + 4, 2, 3, c.K);
  // right arm cocked high behind the helmet
  p.rect(13, y - 1, 2, 2, c.J);
  p.rect(13, y - 2, 2, 1, c.T);
  p.rect(13, y - 5, 2, 3, c.K);
  p.rect(13, y - 8, 3, 3, BALL);
  p.px(14, y - 8, BALL_L);
  p.px(14, y - 7, LACE);
}

function legsFB(p, c, y, lUp, rUp) {
  // pants
  p.rect(5, y, 8, 2, c.P);
  p.vline(5, y, y + 1, c.Pl);
  p.vline(12, y, y + 1, c.Pd);
  if (c.PS) { p.vline(5, y, y + 3, c.PS); p.vline(12, y, y + 3, c.PS); }
  for (const [x, up, sx] of [[5, lUp, 6], [10, rUp, 10]]) {
    const ly = y + 2 - up;
    p.rect(x, ly, 3, 2, c.P);
    p.px(x + 2, ly + 1, c.Pd);
    p.rect(sx, ly + 2, 2, 3, c.O);
    p.px(sx + 1, ly + 3, c.Od);
    p.rect(x, ly + 5, 3, 2, c.C);
    p.px(x, ly + 5, c.Cl);
  }
}

function torsoSide(p, c, y, ox) {
  const x = ox;
  p.hline(x + 6, x + 11, y, c.J);
  p.rect(x + 5, y + 1, 8, 2, c.J);
  p.rect(x + 6, y + 3, 6, 4, c.J);
  p.vline(x + 6, y + 3, y + 6, c.Jd);
  p.vline(x + 11, y + 1, y + 5, c.Jl);
  p.hline(x + 6, x + 11, y + 6, c.Jd);
}

function armSide(p, c, y, ox, swing, front) {
  // swing: -1 back, 0 down, 1 forward
  const sx = 8 + ox;
  p.rect(sx, y + 1, 2, 2, front ? c.J : c.Jd);
  p.rect(sx, y + 3, 2, 1, c.T);
  const ex = sx + swing * 2;
  const ey = y + 6 - Math.abs(swing);
  p.limb(sx, y + 4, ex, ey, 2, front ? c.K : c.Kd);
}

function legsSide(p, c, y, frame) {
  p.rect(6, y, 6, 2, c.P);
  p.hline(6, 11, y + 1, c.Pd);
  if (c.PS) p.hline(6, 11, y, c.PS);
  // [hipX, kneeX, kneeY, footX, footY] relative to y
  const poses = [
    [[9, 11, 4, 12, 6], [7, 5, 4, 3, 5]],
    [[9, 9, 4, 9, 6], [7, 7, 4, 6, 5]],
    [[9, 10, 4, 11, 6], [7, 6, 4, 4, 6]],
    [[9, 8, 4, 8, 6], [7, 7, 3, 7, 5]],
  ][frame % 4];
  poses.forEach(([hx, kx, ky, fx, fy], i) => {
    p.limb(hx, y + 2, kx, y + ky, 2, i === 0 ? c.P : c.Pd);
    p.limb(kx, y + ky, fx, y + fy, 2, i === 0 ? c.O : c.Od);
    p.rect(fx - 1, y + fy + 1, 4, 2, c.C);
    p.px(fx + 2, y + fy + 2, c.Cl);
  });
}

function lyingDown(p, c) {
  const y = 18;
  p.rect(0, y + 2, 2, 3, c.C);
  p.rect(1, y + 1, 3, 3, c.O);
  p.rect(4, y, 4, 4, c.P);
  p.rect(8, y - 1, 5, 5, c.J);
  p.hline(8, 12, y - 1, c.Jl);
  p.rect(9, y + 4, 3, 1, c.K);
  p.rect(13, y - 2, 4, 5, c.H);
  p.hline(14, 16, y - 2, c.S);
  p.vline(17, y - 1, y + 2, c.M);
}

function diving(p, c) {
  const y = 12;
  p.rect(0, y + 3, 2, 2, c.C);
  p.rect(1, y + 2, 3, 2, c.O);
  p.rect(4, y + 1, 4, 3, c.P);
  p.rect(8, y, 5, 4, c.J);
  p.hline(8, 12, y, c.Jl);
  p.rect(12, y - 3, 4, 5, c.H);
  p.hline(13, 15, y - 3, c.S);
  p.vline(16, y - 2, y + 1, c.M);
  p.hline(13, 17, y + 3, c.K);
}

// Arms raised in a V (touchdown, celebration).
function armsUpFB(p, c, y) {
  for (const [sx, hx, shade] of [[3, 1, c.Jl], [13, 15, c.Jd]]) {
    p.rect(sx, y + 1, 2, 2, c.J);
    p.px(sx === 3 ? 3 : 14, y + 1, shade);
    p.limb(sx, y + 1, hx, y - 4, 2, c.J);
    p.rect(hx, y - 5, 2, 1, c.T);
    p.rect(hx, y - 8, 2, 3, c.K);
  }
}

// Right arm raised (first-down point: in a back view it points up field).
function armPointFB(p, c, y) {
  p.rect(3, y + 1, 2, 2, c.J);
  p.px(3, y + 1, c.Jl);
  p.rect(3, y + 3, 2, 1, c.T);
  p.rect(3, y + 4, 2, 3, c.K);
  p.rect(13, y + 1, 2, 2, c.J);
  p.px(14, y + 1, c.Jd);
  p.limb(13, y + 1, 14, y - 4, 2, c.J);
  p.rect(14, y - 5, 2, 1, c.T);
  p.rect(14, y - 9, 2, 4, c.K);
}

// Salute: right hand up at the helmet brim (drawn over the helmet).
function saluteHand(p, c, y) {
  p.limb(14, y - 1, 11, y - 4, 2, c.K);
  p.rect(10, y - 5, 2, 2, c.K);
}

// One arm held straight out to the left (stiff arm), or both (off balance).
function armOutLeft(p, c, y) {
  p.rect(3, y + 1, 2, 2, c.J);
  p.px(3, y + 1, c.Jl);
  p.rect(1, y + 2, 2, 2, c.J);
  p.rect(0, y + 2, 1, 2, c.T);
  p.rect(-1, y + 2, 1, 2, c.K);
  p.rect(-2, y + 1, 1, 4, c.K);
  p.px(-2, y + 4, c.Kd);
}
function armOutRight(p, c, y) {
  p.rect(13, y + 1, 2, 2, c.J);
  p.px(14, y + 1, c.Jd);
  p.rect(15, y + 2, 2, 2, c.J);
  p.rect(17, y + 2, 1, 2, c.T);
  p.rect(18, y + 2, 1, 2, c.K);
  p.rect(19, y + 1, 1, 4, c.K);
  p.px(19, y + 4, c.Kd);
}
function armDownRight(p, c, y) {
  p.rect(13, y + 1, 2, 2, c.J);
  p.px(14, y + 1, c.Jd);
  p.rect(13, y + 3, 2, 1, c.T);
  p.rect(13, y + 4, 2, 3, c.K);
}

// Juke: weight on the right leg, left leg stepping out wide.
function legsCut(p, c, y) {
  p.rect(4, y, 8, 2, c.P);
  p.vline(4, y, y + 1, c.Pl);
  p.vline(11, y, y + 1, c.Pd);
  p.limb(4, y + 2, 1, y + 4, 2, c.P);
  p.rect(0, y + 5, 2, 2, c.O);
  p.rect(-1, y + 7, 3, 2, c.C);
  p.px(-1, y + 7, c.Cl);
  p.limb(10, y + 2, 12, y + 4, 2, c.Pd);
  p.rect(12, y + 5, 2, 2, c.Od);
  p.rect(12, y + 7, 3, 2, c.C);
}

// Lying along the screen's vertical, seen from above: head up the screen
// (fell forward) or toward the camera (knocked back).
function lyingVertical(p, c, headUp) {
  const rows = headUp
    ? { helm: 10, pads: 14, pants: 18, socks: 20, cleat: 22 }
    : { helm: 19, pads: 15, pants: 13, socks: 11, cleat: 10 };
  p.rect(6, rows.helm, 6, 4, c.H);
  p.rect(8, rows.helm, 2, 4, c.S);
  p.px(6, rows.helm, c.Hl);
  if (!headUp) p.hline(7, 10, rows.helm + 3, c.M);
  p.rect(4, rows.pads, 10, 4, c.J);
  p.hline(4, 13, headUp ? rows.pads : rows.pads + 3, c.Jl);
  p.rect(1, rows.pads + 1, 3, 2, c.K);
  p.rect(14, rows.pads + 1, 3, 2, c.K);
  p.rect(5, rows.pants, 8, 2, c.P);
  p.rect(5, rows.socks, 3, 2, c.O);
  p.rect(10, rows.socks, 3, 2, c.O);
  p.rect(5, rows.cleat, 3, 1, c.C);
  p.rect(10, rows.cleat, 3, 1, c.C);
}

// ------------------------------------------------------------------ build
const cache = new Map();

// Poses: stand, run, carry, throw, push, down, dive, cheer (arms up),
// point (first-down signal), salute,
// stiffL / stiffR (arm out to that side of the screen; side views push it
// forward), reel (off balance, both arms out), cutL / cutR (juke).

export function spriteFor(uni, skin, view, pose, frame) {
  // the helmet logo shows from the side; sprites made before it loads are
  // replaced once it has (it's part of the cache key)
  const decal = uni.decal && (view === 'E' || view === 'W') ? ready(uni.decal) : null;
  const key = `${uni.key}|${skin}|${view}|${pose}|${frame}|${decal ? 1 : 0}`;
  let spr = cache.get(key);
  if (spr) return spr;
  const canvas = makeCanvas(SW, SH);
  const ctx = canvas.getContext('2d');
  const p = new Painter(ctx, TOP, DX);
  const c = paletteFor(uni, skin);
  let v = view === 'W' ? 'E' : view;
  // right-hand variants of FB poses are the left ones mirrored
  let flipFB = false;
  if ((pose === 'stiffR' || pose === 'cutR') && v !== 'E') {
    flipFB = true;
    pose = pose === 'stiffR' ? 'stiffL' : 'cutL';
  }
  const mirror = view === 'W' || flipFB;
  let numY = null;
  let numDx = 0;

  if (v === 'E' && pose === 'point') pose = 'stiffL';
  if (v === 'E' && pose === 'salute') pose = 'cheer';
  if (pose === 'down') {
    if (v === 'E') lyingDown(p, c);
    else lyingVertical(p, c, v === 'N');
  } else if (pose === 'dive') diving(p, c);
  else if (v === 'E') {
    const run = pose === 'run' || pose === 'carry';
    const cut = pose === 'cutL' || pose === 'cutR';
    const f = run ? frame % 4 : cut ? 0 : 1;
    const bob = run && f % 2 === 0 ? 0 : 1;
    const lean = run || cut || pose === 'push' || pose === 'stiffL' || pose === 'stiffR' ? 1 : 0;
    legsSide(p, c, 14, f);
    if (pose === 'cheer') {
      const sx = 8 + lean;
      p.limb(sx, 8 + bob, sx - 1, 2 + bob, 2, c.Jd);
      p.rect(sx - 1, -1 + bob, 2, 3, c.Kd);
    } else armSide(p, c, 7 + bob, lean, run ? (f < 2 ? -1 : 1) : pose === 'reel' ? -2 : 0, false);
    torsoSide(p, c, 7 + bob, lean - 1);
    helmetSide(p, c, bob, lean - 1);
    if (decal) ctx.drawImage(decal, DX + lean - 1 + 5, TOP + bob + 2);
    if (pose === 'stiffL' || pose === 'stiffR') {
      // arm locked out in front
      const sx = 8 + lean - 1;
      p.rect(sx, 8 + bob, 2, 2, c.J);
      p.rect(sx + 2, 9 + bob, 2, 2, c.J);
      p.rect(sx + 4, 9 + bob, 1, 2, c.T);
      p.rect(sx + 5, 9 + bob, 1, 2, c.K);
      p.rect(sx + 6, 8 + bob, 1, 4, c.K);
    } else if (pose === 'cheer') {
      const sx = 8 + lean;
      p.limb(sx + 1, 8 + bob, sx + 2, 2 + bob, 2, c.J);
      p.rect(sx + 2, -1 + bob, 2, 3, c.K);
    } else armSide(p, c, 7 + bob, lean, pose === 'push' ? 1 : run ? (f < 2 ? 1 : -1) : pose === 'reel' ? 2 : 0, true);
  } else {
    const run = pose === 'run' || pose === 'carry';
    const f = frame % 4;
    const lUp = run && f === 0 ? 2 : 0;
    const rUp = run && f === 2 ? 2 : 0;
    const bob = run && (f === 1 || f === 3) ? 1 : pose === 'cutL' ? 1 : 0;
    const back = v === 'N';
    const up = pose === 'cutL' ? new Painter(ctx, TOP, DX - 1) : p;
    if (pose === 'cutL') {
      legsCut(p, c, 14);
      numDx = -1;
    } else legsFB(p, c, 14, lUp, rUp);
    torsoFB(up, c, 7 + bob, back);
    if (pose === 'throw') throwArm(up, c, 7 + bob);
    else if (pose === 'cheer') armsUpFB(up, c, 7 + bob);
    else if (pose === 'point') armPointFB(up, c, 7 + bob);
    else if (pose === 'salute') {
      const y = 7 + bob;
      up.rect(3, y + 1, 2, 2, c.J);
      up.px(3, y + 1, c.Jl);
      up.rect(3, y + 3, 2, 1, c.T);
      up.rect(3, y + 4, 2, 3, c.K);
      up.rect(13, y + 1, 2, 2, c.J);
      up.limb(14, y + 1, 15, y - 1, 2, c.J);
    }
    else if (pose === 'stiffL') {
      armOutLeft(up, c, 7 + bob);
      armDownRight(up, c, 7 + bob);
    } else if (pose === 'reel') {
      armOutLeft(up, c, 7 + bob - 2);
      armOutRight(up, c, 7 + bob - 2);
    } else if (pose === 'cutL') {
      armOutLeft(up, c, 7 + bob - 1);
      armDownRight(up, c, 7 + bob);
    } else armsFB(up, c, 7 + bob, run ? (f === 0 ? 1 : f === 2 ? -1 : 0) : 0, run ? (f === 0 ? -1 : f === 2 ? 1 : 0) : 0, pose);
    if (back) helmetBack(up, c, bob);
    else helmetFront(up, c, bob);
    if (pose === 'salute' && !back) saluteHand(up, c, 7 + bob);
    numY = TOP + 8 + bob;
  }
  outline(canvas);
  let out = canvas;
  if (mirror) {
    out = makeCanvas(SW, SH);
    const m = out.getContext('2d');
    m.translate(SW, 0);
    m.scale(-1, 1);
    m.drawImage(canvas, 0, 0);
    if (flipFB) numDx = -numDx;
  }
  spr = { canvas: out, numY, numDx, view: v, numColor: c.N };
  cache.set(key, spr);
  return spr;
}

export function clearSpriteCache() {
  cache.clear();
}

// Picks the view from a facing angle in world space (+y = up the screen).
export function viewFromFace(face) {
  const cx = Math.cos(face);
  const sy = Math.sin(face);
  if (Math.abs(cx) > 0.72) return cx > 0 ? 'E' : 'W';
  return sy > 0 ? 'N' : 'S';
}

// Draw a player with the ground point at low-res pixel (x, y).
// e: { view, pose, frame, num, skin }
export function drawSprite(ctx, uni, e, x, y) {
  const spr = spriteFor(uni, e.skin || 0, e.view, e.pose, e.frame || 0);
  const ox = Math.round(x) - AX;
  const oy = Math.round(y) - AY;
  ctx.drawImage(spr.canvas, ox, oy);
  if (spr.numY != null && e.num != null) drawNumber(ctx, e.num, ox + AX - 0.5 + spr.numDx, oy + spr.numY, spr.numColor);
}

// Ball tucked in the arms, drawn on top of a sprite.
export function drawCarriedBall(ctx, view, x, y) {
  const bx = Math.round(x) + (view === 'W' ? -6 : view === 'E' ? 3 : view === 'N' ? 4 : 2);
  const by = Math.round(y) - 12;
  ctx.fillStyle = '#3a1c0a';
  ctx.fillRect(bx - 1, by - 1, 5, 4);
  ctx.fillStyle = '#8a4a20';
  ctx.fillRect(bx, by, 3, 2);
  ctx.fillStyle = LACE;
  ctx.fillRect(bx + 1, by, 1, 1);
}

export function drawShadow(ctx, x, y, w = 10) {
  ctx.fillStyle = 'rgba(10,30,12,0.35)';
  const X = Math.round(x);
  const Y = Math.round(y);
  const h = w >> 1;
  ctx.fillRect(X - h + 1, Y - 1, w - 2, 1);
  ctx.fillRect(X - h, Y, w, 2);
  ctx.fillRect(X - h + 1, Y + 2, w - 2, 1);
}

export function drawFootball(ctx, x, y, z, spin = 0) {
  const X = Math.round(x);
  const gy = Math.round(y);
  const Y = Math.round(y - z);
  if (z > 0.5) {
    ctx.fillStyle = 'rgba(10,30,12,0.35)';
    ctx.fillRect(X - 1, gy, 3, 1);
  }
  ctx.fillStyle = '#2a1408';
  ctx.fillRect(X - 2, Y - 1, 5, 3);
  ctx.fillRect(X - 1, Y - 2, 3, 5);
  ctx.fillStyle = '#8a4a20';
  ctx.fillRect(X - 1, Y - 1, 3, 3);
  ctx.fillStyle = Math.floor(spin) % 2 ? LACE : BALL_L;
  ctx.fillRect(X, Y - 1, 1, 1);
  ctx.fillStyle = LACE;
  ctx.fillRect(X, Y, 1, 1);
}

// Uniform colors for a team playing at home (dark) or away (white). Real
// teams carry their actual home/away kits; the fallback derives them.
export function uniform(team, home) {
  if (team.uniforms) {
    const k = team.uniforms[home ? 'home' : 'away'];
    const u = { ...k };
    // numbers must read on the jersey
    const readable = (col) => col && Math.abs(lum(col) - lum(u.jersey)) >= 0.35;
    if (!readable(u.num)) u.num = readable(k.numOutline) ? k.numOutline : lum(u.jersey) > 0.5 ? '#14181f' : '#ffffff';
    u.key = `${team.id}:${home ? 'h' : 'a'}:${Object.values(k).join('')}`;
    u.decal = team.helmetLogo ? teamArt(team, 'helmet_5x4.png') : null;
    return u;
  }
  const c = team.colors;
  const darkOnWhite = (col) => (lum(col) > 0.82 ? '#1d2a44' : col);
  let u;
  if (home) {
    const jersey = c.primary;
    let num = c.secondary;
    if (Math.abs(lum(num) - lum(jersey)) < 0.28) num = lum(jersey) > 0.5 ? '#14181f' : '#ffffff';
    u = { jersey, num, trim: num, helmet: c.helmet, stripe: pickStripe(c), pants: c.pants, socks: c.primary };
  } else {
    u = { jersey: '#f2f3f5', num: darkOnWhite(c.primary), trim: darkOnWhite(c.primary), helmet: c.helmet, stripe: pickStripe(c), pants: c.pants === '#FFFFFF' ? '#e8e9ec' : c.pants, socks: c.primary };
  }
  u.key = `${team.id}:${home ? 'h' : 'a'}:${u.jersey}${u.helmet}${u.pants}${u.num}`;
  return u;
}

function pickStripe(c) {
  const opts = [c.secondary, c.primary, '#ffffff'];
  return opts.find((o) => Math.abs(lum(o) - lum(c.helmet)) > 0.18) || c.secondary;
}
