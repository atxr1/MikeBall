// Uniform colors and the small shared sprite helpers (shadows, the ball in
// flight). Bodies are drawn by the procedural rig (src/render/rig.js).

import { teamArt } from '../data/realleague.js';

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

// How far apart two jersey colors look (0 same, ~1 black vs white).
function apart(a, b) {
  const [r1, g1, b1] = hex(a);
  const [r2, g2, b2] = hex(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2) / 441;
}

// Both teams' kits for a game. The home team picks (Dallas wears white at
// home); the visitors wear whichever of their kits stands apart from it,
// or white if neither does.
export function matchupUniforms(homeTeam, awayTeam) {
  const home = uniform(homeTeam, true);
  let away = uniform(awayTeam, false);
  if (apart(home.jersey, away.jersey) < 0.3) {
    const alt = uniform(awayTeam, true);
    if (apart(home.jersey, alt.jersey) > apart(home.jersey, away.jersey)) away = alt;
    if (apart(home.jersey, away.jersey) < 0.3 && lum(home.jersey) < 0.6) {
      // a white set in their colors
      const c = awayTeam.colors;
      const ink = lum(c.primary) > 0.75 ? '#1d2a44' : c.primary;
      away = { ...away, jersey: '#f2f3f5', num: ink, trim: ink, collar: ink, key: `${away.key}:white` };
    }
  }
  return { home, away };
}

function pickStripe(c) {
  const opts = [c.secondary, c.primary, '#ffffff'];
  return opts.find((o) => Math.abs(lum(o) - lum(c.helmet)) > 0.18) || c.secondary;
}
