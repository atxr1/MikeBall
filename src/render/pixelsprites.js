// Procedural pixel-art players. Each sprite is painted pixel by pixel into a
// tiny canvas, then given a dark selective outline, and cached. Views:
// 'N' (back, running up the screen), 'S' (front, facing the camera),
// 'E' (side, facing right; 'W' is E mirrored).

import { drawNumber } from './pixelfont.js';

export const SW = 22; // sprite canvas width
export const SH = 28; // sprite canvas height
export const AX = 11; // anchor x (between the feet)
export const AY = 26; // anchor y (ground)

const SKIN = ['#f3cfae', '#e3b18c', '#c98d66', '#a8714b', '#7f5236', '#5c3a26'];
const MASK = '#c3c9d2';
const MASK_D = '#7d8590';
const CLEAT = '#1c1e24';
const CLEAT_L = '#4a4f5a';
const EYE = '#16120f';

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
    S: uni.stripe,
    P: uni.pants, Pd: tone(uni.pants, -0.25),
    O: uni.socks, Od: tone(uni.socks, -0.25),
    K, Kd: tone(K, -0.2),
  };
}

// ------------------------------------------------------------------ painter
class Painter {
  constructor(ctx) { this.ctx = ctx; }
  px(x, y, c) { if (!c) return; this.ctx.fillStyle = c; this.ctx.fillRect(x, y, 1, 1); }
  rect(x, y, w, h, c) { if (!c || w <= 0 || h <= 0) return; this.ctx.fillStyle = c; this.ctx.fillRect(x, y, w, h); }
  hline(x0, x1, y, c) { this.rect(Math.min(x0, x1), y, Math.abs(x1 - x0) + 1, 1, c); }
  vline(x, y0, y1, c) { this.rect(x, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1, c); }
  // thick line between two points (for limbs)
  limb(x0, y0, x1, y1, w, c, cd) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / n);
      const y = Math.round(y0 + ((y1 - y0) * i) / n);
      this.rect(x, y, w, 1, c);
      if (cd && w > 1) this.px(x + w - 1, y, cd);
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
// All coordinates are in the 22x28 sprite canvas. Body center x = 11.

function helmetFront(p, c, oy, ox = 0) {
  const x = 6 + ox;
  const y = oy;
  // shell
  p.hline(x + 2, x + 7, y, c.H);
  p.hline(x + 1, x + 8, y + 1, c.H);
  p.rect(x, y + 2, 10, 6, c.H);
  p.px(x + 2, y, c.Hl); p.px(x + 3, y, c.Hl); p.px(x + 1, y + 1, c.Hl); p.px(x + 2, y + 1, c.Hl); p.px(x + 1, y + 2, c.Hl);
  p.vline(x + 9, y + 3, y + 7, c.Hd);
  p.vline(x, y + 4, y + 7, c.Hd);
  // stripe over the crown
  p.rect(x + 4, y, 2, 3, c.S);
  // face
  p.rect(x + 2, y + 3, 6, 5, c.K);
  p.hline(x + 2, x + 7, y + 3, c.Kd);
  p.px(x + 3, y + 4, EYE); p.px(x + 6, y + 4, EYE);
  p.px(x + 2, y + 6, c.Kd); p.px(x + 7, y + 6, c.Kd);
  p.hline(x + 4, x + 5, y + 7, c.Kd);
  // facemask: one bar across, a short chin bar
  p.hline(x + 1, x + 8, y + 5, MASK);
  p.px(x + 1, y + 5, MASK_D); p.px(x + 8, y + 5, MASK_D);
  p.hline(x + 3, x + 6, y + 8, MASK_D);
}

function helmetBack(p, c, oy, ox = 0) {
  const x = 6 + ox;
  const y = oy;
  p.hline(x + 2, x + 7, y, c.H);
  p.hline(x + 1, x + 8, y + 1, c.H);
  p.rect(x, y + 2, 10, 5, c.H);
  p.hline(x + 1, x + 8, y + 7, c.Hd);
  p.px(x + 2, y, c.Hl); p.px(x + 1, y + 1, c.Hl); p.px(x + 2, y + 1, c.Hl); p.px(x + 1, y + 2, c.Hl); p.px(x + 1, y + 3, c.Hl);
  p.vline(x + 9, y + 3, y + 6, c.Hd);
  p.rect(x + 4, y, 2, 7, c.S);
  // neck
  p.rect(x + 3, y + 8, 4, 1, c.Kd);
}

function helmetSide(p, c, oy, ox = 0) {
  // facing right
  const x = 6 + ox;
  const y = oy;
  p.hline(x + 2, x + 7, y, c.H);
  p.hline(x + 1, x + 8, y + 1, c.H);
  p.rect(x, y + 2, 9, 5, c.H);
  p.hline(x + 1, x + 6, y + 7, c.Hd);
  p.hline(x + 1, x + 7, y, c.S);
  p.px(x + 2, y + 1, c.Hl); p.px(x + 1, y + 2, c.Hl); p.px(x + 1, y + 3, c.Hl);
  p.px(x + 3, y + 4, c.Hd); // ear hole
  // face
  p.rect(x + 6, y + 3, 3, 4, c.K);
  p.px(x + 7, y + 4, EYE);
  p.px(x + 6, y + 6, c.Kd);
  // facemask
  p.vline(x + 9, y + 4, y + 7, MASK_D);
  p.hline(x + 8, x + 10, y + 6, MASK);
}

function torsoFB(p, c, oy, back) {
  const y = oy;
  // shoulder pads
  p.hline(6, 15, y, c.J);
  p.rect(5, y + 1, 12, 2, c.J);
  // body
  p.rect(6, y + 3, 10, 5, c.J);
  p.vline(6, y + 1, y + 7, c.Jl);
  p.vline(15, y + 1, y + 7, c.Jd);
  p.px(5, y + 1, c.Jl);
  p.px(16, y + 1, c.Jd); p.px(16, y + 2, c.Jd);
  // collar
  if (!back) { p.hline(9, 12, y, c.Jd); p.px(10, y, c.Kd); p.px(11, y, c.Kd); }
  else p.hline(9, 12, y, c.Jd);
  // belt line
  p.hline(6, 15, y + 7, c.Jd);
}

function sleevesFB(p, c, oy, la, ra, pose) {
  // la / ra: arm swing offsets (-1 up, +1 down)
  const y = oy;
  if (pose === 'push') {
    // arms raised forward at shoulder height
    for (const [x, dir] of [[4, 1], [16, -1]]) {
      p.rect(x, y + 1, 2, 2, c.J);
      p.rect(x, y + 3, 2, 1, c.T);
      p.rect(x + dir * 0, y + 4, 2, 2, c.K);
    }
    p.rect(7, y + 2, 2, 2, c.K);
    p.rect(13, y + 2, 2, 2, c.K);
    return;
  }
  for (const [x, off, shade] of [[4, la, c.Jl], [16, ra, c.Jd]]) {
    p.rect(x, y + 1, 2, 3, c.J);
    p.px(x === 4 ? 4 : 17, y + 1, shade);
    p.rect(x, y + 3, 2, 1, c.T);
    p.rect(x, y + 4 + off, 2, 3, c.K);
    p.px(x === 4 ? 4 : 17, y + 5 + off, c.Kd);
  }
}

function throwArm(p, c, oy) {
  // right arm cocked up behind the helmet with the ball
  const y = oy;
  p.rect(4, y + 1, 2, 3, c.J);
  p.rect(4, y + 3, 2, 1, c.T);
  p.rect(4, y + 4, 2, 3, c.K);
  p.rect(16, y - 1, 2, 3, c.J);
  p.rect(16, y - 2, 2, 1, c.T);
  p.rect(16, y - 5, 2, 3, c.K);
  // ball
  p.rect(16, y - 8, 3, 3, '#7a3f1c');
  p.px(17, y - 8, '#a35a2c');
  p.px(17, y - 7, '#f1e7d8');
}

function legsFB(p, c, oy, lUp, rUp) {
  const y = oy;
  // pants
  p.rect(6, y, 10, 3, c.P);
  p.vline(6, y, y + 2, tone(c.P, 0.15));
  p.vline(15, y, y + 2, c.Pd);
  // leg split
  for (const [x, up] of [[6, lUp], [12, rUp]]) {
    const ly = y + 3 - up;
    p.rect(x, ly, 4, 2, c.P);
    p.px(x + 3, ly + 1, c.Pd);
    // socks
    p.rect(x + 1, ly + 2, 3, 4, c.O);
    p.px(x + 3, ly + 3, c.Od);
    p.hline(x + 1, x + 3, ly + 2, tone(c.O, 0.25));
    // cleats
    p.rect(x, ly + 6, 4, 2, CLEAT);
    p.hline(x, x + 1, ly + 6, CLEAT_L);
  }
}

function torsoSide(p, c, oy, ox) {
  const y = oy;
  const x = 7 + ox;
  p.hline(x + 1, x + 7, y, c.J);
  p.rect(x, y + 1, 9, 2, c.J);
  p.rect(x + 1, y + 3, 7, 5, c.J);
  p.vline(x + 1, y + 3, y + 7, c.Jd);
  p.vline(x + 7, y + 1, y + 6, c.Jl);
  p.hline(x + 1, x + 7, y + 7, c.Jd);
  // number on the shoulder
  p.hline(x + 3, x + 5, y + 1, c.N);
}

function armSide(p, c, oy, ox, swing, front) {
  // swing: -1 back, 0 down, 1 forward
  const sx = 10 + ox;
  const sy = oy + 1;
  p.rect(sx, sy, 3, 3, front ? c.J : c.Jd);
  p.rect(sx, sy + 2, 3, 1, c.T);
  const ex = sx + 1 + swing * 3;
  const ey = sy + 6 - Math.abs(swing);
  p.limb(sx + 1, sy + 3, ex, ey, 2, c.K, c.Kd);
}

function legsSide(p, c, oy, frame) {
  const y = oy;
  p.rect(8, y, 7, 3, c.P);
  p.hline(8, 14, y + 2, c.Pd);
  const pose = [
    [[12, 3, 15, 6, 16, 9], [9, 3, 7, 6, 5, 8]], // stride, right leg ahead
    [[11, 3, 12, 6, 11, 9], [10, 3, 8, 5, 8, 7]], // passing, back leg tucked
    [[12, 3, 14, 6, 14, 9], [9, 3, 8, 6, 6, 9]], // stride 2
    [[11, 3, 11, 6, 12, 9], [9, 3, 7, 5, 6, 6]], // passing 2
  ][frame % 4];
  for (const [i, L] of pose.entries()) {
    const [hx, hy, kx, ky, fx, fy] = L;
    const col = i === 0 ? c.O : c.Od;
    p.limb(hx, y + hy - 1, kx, y + ky - 1, 3, i === 0 ? c.P : c.Pd);
    p.limb(kx, y + ky - 1, fx, y + fy - 1, 3, col);
    p.rect(fx - 1, y + fy, 5, 2, CLEAT);
    p.px(fx + 3, y + fy + 1, CLEAT_L);
  }
}

function lyingDown(p, c) {
  // body lying flat, head to the right
  const y = 19;
  p.rect(1, y + 1, 4, 3, c.O); // socks
  p.rect(0, y + 2, 2, 3, CLEAT);
  p.rect(5, y, 5, 4, c.P);
  p.rect(10, y - 1, 6, 5, c.J);
  p.hline(10, 15, y - 1, c.Jl);
  p.rect(12, y + 4, 3, 2, c.K); // arm
  p.rect(16, y - 2, 5, 5, c.H);
  p.rect(17, y - 2, 3, 1, c.S);
  p.vline(21, y - 1, y + 2, MASK);
}

function diving(p, c) {
  // stretched out horizontally, arms forward to the right
  const y = 14;
  p.rect(0, y + 3, 3, 2, CLEAT);
  p.rect(2, y + 2, 4, 2, c.O);
  p.rect(5, y + 1, 5, 3, c.P);
  p.rect(10, y, 6, 4, c.J);
  p.hline(10, 15, y, c.Jl);
  p.rect(15, y - 3, 5, 5, c.H);
  p.rect(16, y - 3, 3, 1, c.S);
  p.vline(20, y - 2, y + 1, MASK);
  p.hline(16, 21, y + 3, c.K);
}

// ------------------------------------------------------------------ build
const cache = new Map();

export function spriteFor(uni, skin, view, pose, frame) {
  const key = `${uni.key}|${skin}|${view}|${pose}|${frame}`;
  let spr = cache.get(key);
  if (spr) return spr;
  const canvas = makeCanvas(SW, SH);
  const ctx = canvas.getContext('2d');
  const p = new Painter(ctx);
  const c = paletteFor(uni, skin);
  const mirror = view === 'W';
  const v = mirror ? 'E' : view;
  let numY = null;

  if (pose === 'down') lyingDown(p, c);
  else if (pose === 'dive') diving(p, c);
  else if (v === 'E') {
    const run = pose === 'run' || pose === 'carry';
    const f = run ? frame : 1;
    const bob = run && f % 2 === 1 ? 0 : 1;
    const lean = run ? 1 : 0;
    legsSide(p, c, 17, run ? f : 1);
    armSide(p, c, 8 + bob, lean, run ? (f < 2 ? -1 : 1) : 0, false);
    torsoSide(p, c, 8 + bob, lean);
    helmetSide(p, c, bob, lean + 1);
    if (pose === 'push') armSide(p, c, 8 + bob, lean, 1, true);
    else armSide(p, c, 8 + bob, lean, run ? (f < 2 ? 1 : -1) : 0, true);
  } else {
    const run = pose === 'run' || pose === 'carry';
    const f = frame % 4;
    const lUp = run && f === 0 ? 2 : 0;
    const rUp = run && f === 2 ? 2 : 0;
    const bob = run && (f === 1 || f === 3) ? 1 : 0;
    const back = v === 'N';
    legsFB(p, c, 17, lUp, rUp);
    torsoFB(p, c, 9 + bob, back);
    if (pose === 'throw') throwArm(p, c, 9 + bob);
    else sleevesFB(p, c, 9 + bob, run ? (f === 0 ? 1 : f === 2 ? -1 : 0) : 0, run ? (f === 0 ? -1 : f === 2 ? 1 : 0) : 0, pose);
    if (back) helmetBack(p, c, 1 + bob);
    else helmetFront(p, c, bob);
    numY = 11 + bob;
  }
  outline(canvas);
  let out = canvas;
  if (mirror) {
    out = makeCanvas(SW, SH);
    const m = out.getContext('2d');
    m.translate(SW, 0);
    m.scale(-1, 1);
    m.drawImage(canvas, 0, 0);
  }
  spr = { canvas: out, numY, view: v, numColor: c.N };
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

// Draw a player at low-res pixel position (x, y = ground point).
// e: { view, pose, frame, num, skin }
export function drawSprite(ctx, uni, e, x, y) {
  const spr = spriteFor(uni, e.skin || 0, e.view, e.pose, e.frame || 0);
  const ox = Math.round(x) - AX;
  const oy = Math.round(y) - AY;
  ctx.drawImage(spr.canvas, ox, oy);
  if (spr.numY != null && e.num != null && e.pose !== 'throw') {
    drawNumber(ctx, e.num, ox + 11, oy + spr.numY, spr.numColor);
  } else if (spr.numY != null && e.pose === 'throw' && e.num != null) {
    drawNumber(ctx, e.num, ox + 11, oy + spr.numY, spr.numColor);
  }
}

// Ball carried in the hands, drawn on top of a sprite.
export function drawCarriedBall(ctx, view, x, y) {
  const bx = Math.round(x) + (view === 'W' ? -6 : view === 'E' ? 3 : view === 'N' ? 5 : 3);
  const by = Math.round(y) - 13;
  ctx.fillStyle = '#5a2c12';
  ctx.fillRect(bx - 1, by - 1, 5, 4);
  ctx.fillStyle = '#8a4a20';
  ctx.fillRect(bx, by, 3, 2);
  ctx.fillStyle = '#f1e7d8';
  ctx.fillRect(bx + 1, by, 1, 1);
}

export function drawShadow(ctx, x, y, w = 12) {
  ctx.fillStyle = 'rgba(10,30,12,0.35)';
  const X = Math.round(x);
  const Y = Math.round(y);
  ctx.fillRect(X - w / 2 + 1, Y - 1, w - 2, 1);
  ctx.fillRect(X - w / 2, Y, w, 2);
  ctx.fillRect(X - w / 2 + 1, Y + 2, w - 2, 1);
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
  ctx.fillStyle = Math.floor(spin) % 2 ? '#f1e7d8' : '#a35a2c';
  ctx.fillRect(X, Y - 1, 1, 1);
  ctx.fillStyle = '#f1e7d8';
  ctx.fillRect(X, Y, 1, 1);
}

// Uniform colors for a team playing at home (dark) or away (white).
export function uniform(team, home) {
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
