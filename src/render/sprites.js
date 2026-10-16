// Player and ball sprites, drawn in code at any resolution. Bodies stand
// upright on a three-quarter field so jerseys and helmets read clearly.

import { clamp, contrastText, shade } from '../core/util.js';

const SKIN = ['#f1c9a5', '#e0ac85', '#c68863', '#a46a45', '#7d4f32', '#5a3925'];

// Uniform colors for a team playing home (dark) or away (white).
export function uniform(team, home) {
  const c = team.colors;
  if (home) {
    const jersey = c.primary;
    return { jersey, num: c.secondary === jersey ? contrastText(jersey) : pickNum(jersey, c.secondary), trim: c.secondary, helmet: c.helmet, stripe: c.secondary === c.helmet ? c.primary : c.secondary, pants: c.pants, socks: c.primary };
  }
  return { jersey: '#f4f5f7', num: c.primary, trim: c.primary, helmet: c.helmet, stripe: c.secondary === c.helmet ? c.primary : c.secondary, pants: c.pants === '#FFFFFF' ? '#e6e8ec' : c.pants, socks: c.primary };
}

function pickNum(bg, preferred) {
  // ensure contrast between jersey and numbers
  const lumDiff = Math.abs(lum(bg) - lum(preferred));
  return lumDiff > 0.25 ? preferred : contrastText(bg);
}

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
}

// Sprites are drawn larger than true scale (like Retro Bowl) so they read
// on a phone while the whole formation still fits on screen.
export const SPRITE_SCALE = 1.65;

// e: { x, f, vx, vy, face, anim, down, lean, diveT, num, skin, juke }
export function drawPlayer(ctx, cam, e, uni, opts = {}) {
  const u = cam.s * SPRITE_SCALE;
  const sx = cam.sx(e.x);
  const sy = cam.sy(e.f);
  if (sx < -u * 3 || sx > cam.w + u * 3 || sy < -u * 4 || sy > cam.h + u * 3) return;

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(sx + u * 0.12, sy, u * 0.46, u * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();

  if (opts.ring) {
    ctx.strokeStyle = opts.ring;
    ctx.lineWidth = Math.max(1.5, u * 0.12);
    ctx.beginPath();
    ctx.ellipse(sx, sy, u * 0.62, u * 0.26, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (e.down || e.diveT > 0) {
    drawDown(ctx, sx, sy, u, e, uni);
    return;
  }

  const speed = Math.hypot(e.vx || 0, e.vy || 0);
  const a = clamp(speed / 7.5, 0, 1);
  const ph = (e.anim || 0) * 2.4;
  const swing = Math.sin(ph) * a;
  const bob = Math.abs(Math.cos(ph)) * a * u * 0.07;
  const fx = Math.cos(e.face || 0);
  const fy = Math.sin(e.face || 0);
  const lean = (e.lean || 0) * u;
  const leanX = fx * lean;
  const set = speed < 0.4 && opts.stance;

  const hipY = sy - u * (set ? 0.5 : 0.62) - bob;
  const torsoTop = hipY - u * (set ? 0.5 : 0.62);

  // legs
  ctx.lineCap = 'round';
  ctx.lineWidth = u * 0.2;
  for (const side of [-1, 1]) {
    const st = swing * side;
    const footX = sx + side * u * 0.14 + fx * st * u * 0.18;
    const footY = sy - u * 0.04 - fy * st * u * 0.16 - Math.max(0, st) * u * 0.08;
    ctx.strokeStyle = uni.socks;
    ctx.beginPath();
    ctx.moveTo(sx + side * u * 0.14, hipY + u * 0.08);
    ctx.lineTo(footX, footY);
    ctx.stroke();
    ctx.fillStyle = '#16181d';
    ctx.beginPath();
    ctx.ellipse(footX, footY + u * 0.02, u * 0.12, u * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // pants
  ctx.fillStyle = uni.pants;
  roundRect(ctx, sx - u * 0.3, hipY - u * 0.12, u * 0.6, u * 0.3, u * 0.08);
  ctx.fill();

  // arms (behind torso)
  ctx.lineWidth = u * 0.17;
  for (const side of [-1, 1]) {
    const st = -swing * side;
    const shX = sx + leanX + side * u * 0.36;
    const shY = torsoTop + u * 0.16;
    const hx = shX + side * u * 0.08 + fx * st * u * 0.2 + leanX * 0.6;
    const hy = shY + u * 0.42 - fy * st * u * 0.18;
    ctx.strokeStyle = uni.jersey;
    ctx.beginPath();
    ctx.moveTo(shX, shY);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.fillStyle = SKIN[e.skin || 0];
    ctx.beginPath();
    ctx.arc(hx, hy, u * 0.085, 0, Math.PI * 2);
    ctx.fill();
  }

  // torso + shoulder pads
  ctx.fillStyle = uni.jersey;
  roundRect(ctx, sx + leanX * 0.7 - u * 0.33, torsoTop + u * 0.06, u * 0.66, hipY - torsoTop, u * 0.14);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(sx + leanX, torsoTop + u * 0.12, u * 0.47, u * 0.19, 0, 0, Math.PI * 2);
  ctx.fill();
  // sleeve trim
  ctx.fillStyle = uni.trim;
  ctx.fillRect(sx + leanX - u * 0.47, torsoTop + u * 0.13, u * 0.12, u * 0.06);
  ctx.fillRect(sx + leanX + u * 0.35, torsoTop + u * 0.13, u * 0.12, u * 0.06);

  // number
  if (u > 8.5 && e.num != null) {
    ctx.fillStyle = uni.num;
    ctx.font = `800 ${Math.round(u * 0.42)}px "Big Shoulders Display", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(e.num), sx + leanX * 0.8, torsoTop + u * 0.42);
  }

  // helmet
  const hx = sx + leanX * 1.2;
  const hy = torsoTop - u * 0.15;
  const r = u * 0.27;
  ctx.fillStyle = uni.helmet;
  ctx.beginPath();
  ctx.arc(hx, hy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = Math.max(0.6, u * 0.04);
  ctx.stroke();
  // stripe runs front-to-back
  ctx.strokeStyle = uni.stripe;
  ctx.lineWidth = u * 0.07;
  ctx.beginPath();
  ctx.moveTo(hx, hy - r * 0.95);
  ctx.lineTo(hx, hy + r * (fy > 0.2 ? 0.9 : 0.1));
  ctx.stroke();
  // facemask on the facing side
  if (fy < 0.35) {
    const mx = hx + fx * r * 0.75;
    const my = hy + r * 0.25 - fy * r * 0.35;
    ctx.strokeStyle = '#9aa3ad';
    ctx.lineWidth = Math.max(0.8, u * 0.055);
    ctx.beginPath();
    ctx.ellipse(mx, my, r * (0.55 - Math.abs(fx) * 0.25), r * 0.38, 0, 0, Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mx - r * 0.45, my);
    ctx.lineTo(mx + r * 0.45, my);
    ctx.stroke();
  }
  // gloss
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  ctx.ellipse(hx - r * 0.35, hy - r * 0.35, r * 0.28, r * 0.16, -0.6, 0, Math.PI * 2);
  ctx.fill();

  if (e.juke > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1, u * 0.08);
    ctx.beginPath();
    ctx.arc(sx, sy - u * 0.9, u * 0.95, -0.4, 0.9);
    ctx.stroke();
  }

  if (opts.marker) {
    ctx.fillStyle = opts.marker;
    const my = hy - r - u * 0.32;
    ctx.beginPath();
    ctx.moveTo(hx, my + u * 0.2);
    ctx.lineTo(hx - u * 0.18, my - u * 0.08);
    ctx.lineTo(hx + u * 0.18, my - u * 0.08);
    ctx.closePath();
    ctx.fill();
  }
}

function drawDown(ctx, sx, sy, u, e, uni) {
  const dir = Math.cos(e.face || 0) >= 0 ? 1 : -1;
  ctx.save();
  ctx.translate(sx, sy - u * 0.2);
  // body lying along facing direction
  ctx.fillStyle = uni.pants;
  roundRect(ctx, -dir * u * 0.15 - u * 0.25, -u * 0.18, u * 0.5, u * 0.34, u * 0.1);
  ctx.fill();
  ctx.fillStyle = uni.jersey;
  roundRect(ctx, dir > 0 ? u * 0.05 : -u * 0.65, -u * 0.22, u * 0.6, u * 0.42, u * 0.14);
  ctx.fill();
  ctx.strokeStyle = uni.socks;
  ctx.lineWidth = u * 0.17;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-dir * u * 0.35, 0);
  ctx.lineTo(-dir * u * 0.85, u * 0.1);
  ctx.moveTo(-dir * u * 0.35, -u * 0.05);
  ctx.lineTo(-dir * u * 0.8, -u * 0.18);
  ctx.stroke();
  ctx.fillStyle = uni.helmet;
  ctx.beginPath();
  ctx.arc(dir * u * 0.82, -u * 0.02, u * 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawBall(ctx, cam, b) {
  const u = cam.s * 1.8;
  const sx = cam.sx(b.x);
  const gy = cam.sy(b.f);
  const sy = gy - (b.z || 0) * u * 0.9;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(sx, gy, u * 0.2, u * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  const ang = b.ang || 0;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(ang);
  ctx.fillStyle = '#7a3f1c';
  ctx.beginPath();
  ctx.ellipse(0, 0, u * 0.24, u * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f5efe6';
  ctx.lineWidth = Math.max(0.8, u * 0.035);
  ctx.beginPath();
  ctx.moveTo(-u * 0.08, 0);
  ctx.lineTo(u * 0.08, 0);
  ctx.stroke();
  ctx.restore();
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { shade };
