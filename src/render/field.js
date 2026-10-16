// Pixel-art field: dithered turf with mowing stripes, painted lines and
// numbers, block-letter end zones, midfield mark, goalposts, sideline and
// crowd. Drawn into the low-res buffer; offense always attacks up.

import { FIELD_W, HASH_L, HASH_R } from '../core/util.js';
import { drawText, drawTextOutlined, textWidth } from './pixelfont.js';
import { disc, makeCanvas } from './pixeldraw.js';
import { tone } from './pixelsprites.js';
import { makeRng } from '../core/rng.js';

const TURF_A = '#3d8c3c';
const TURF_B = '#367f36';
const SIDELINE = '#2f6e31';
const LINE = '#f2f5ef';
const TILE = 48;

let turfNoise = null;
const crowdCache = new Map();

function noiseTile() {
  if (turfNoise) return turfNoise;
  const c = makeCanvas(TILE, TILE);
  const ctx = c.getContext('2d');
  const rng = makeRng(77);
  for (let i = 0; i < TILE * TILE * 0.11; i++) {
    const x = rng.int(0, TILE - 1);
    const y = rng.int(0, TILE - 1);
    ctx.fillStyle = rng.chance(0.55) ? 'rgba(10,40,12,0.22)' : 'rgba(190,240,170,0.10)';
    ctx.fillRect(x, y, 1, rng.chance(0.3) ? 2 : 1);
  }
  turfNoise = c;
  return c;
}

function crowdTile(team) {
  const key = team ? team.id + team.colors.primary + team.colors.secondary : 'none';
  if (crowdCache.has(key)) return crowdCache.get(key);
  const c = makeCanvas(TILE, TILE);
  const ctx = c.getContext('2d');
  const rng = makeRng(31);
  ctx.fillStyle = '#20252f';
  ctx.fillRect(0, 0, TILE, TILE);
  const cols = team ? [team.colors.primary, team.colors.primary, team.colors.secondary, '#e8e2d6', '#c99a6e', '#7d5638', '#3a4150'] : ['#888'];
  for (let row = 0; row < TILE; row += 4) {
    ctx.fillStyle = '#2b313d';
    ctx.fillRect(0, row + 3, TILE, 1);
    for (let x = rng.int(0, 1); x < TILE; x += 3) {
      if (rng.chance(0.12)) continue;
      ctx.fillStyle = rng.pick(cols);
      ctx.fillRect(x, row + 1, 2, 2);
      ctx.fillStyle = rng.chance(0.5) ? '#d9a77c' : '#7a4f33';
      ctx.fillRect(x, row, 2, 1);
    }
  }
  crowdCache.set(key, c);
  return c;
}

// Tile an image over a rect, anchored to world origin (ox, oy) in pixels.
function tileRect(ctx, img, x, y, w, h, ox, oy) {
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const sx = x - ((((x - ox) % TILE) + TILE) % TILE);
  const sy = y - ((((y - oy) % TILE) + TILE) % TILE);
  for (let ty = sy; ty < y + h; ty += TILE) for (let tx = sx; tx < x + w; tx += TILE) ctx.drawImage(img, tx, ty);
  ctx.restore();
}

export function drawField(ctx, cam, opts) {
  const { offTeam, defTeam, homeTeam, los, ltg, showLines = true } = opts;
  const s = cam.s;
  const W = cam.w;
  const H = cam.h;
  const X = (x) => Math.round(cam.sx(x));
  const Y = (f) => Math.round(cam.sy(f));
  const [f0, f1] = cam.fRange();

  // stands everywhere first
  tileRect(ctx, crowdTile(homeTeam), 0, 0, W, H, X(0), Y(0));

  // sideline apron and wall
  const apronL = X(-7);
  const apronR = X(FIELD_W + 7);
  const top = Y(117);
  const bot = Y(-17);
  ctx.fillStyle = homeTeam ? tone(homeTeam.colors.primary, -0.35) : '#222';
  ctx.fillRect(apronL - 2, top - 2, apronR - apronL + 4, bot - top + 4);
  ctx.fillStyle = SIDELINE;
  ctx.fillRect(apronL, top, apronR - apronL, bot - top);

  // turf stripes (5 yards each), including end zones
  const x0 = X(0);
  const x1 = X(FIELD_W);
  for (let f = Math.max(-10, Math.floor(f0 / 5) * 5); f < Math.min(110, f1); f += 5) {
    ctx.fillStyle = Math.floor((f + 10) / 5) % 2 === 0 ? TURF_A : TURF_B;
    const yt = Y(f + 5);
    ctx.fillRect(x0, yt, x1 - x0, Y(f) - yt);
  }
  // white border around the playing field
  ctx.fillStyle = LINE;
  ctx.fillRect(x0 - 2, Y(110) - 2, 2, Y(-10) - Y(110) + 4);
  ctx.fillRect(x1, Y(110) - 2, 2, Y(-10) - Y(110) + 4);
  ctx.fillRect(x0 - 2, Y(110) - 2, x1 - x0 + 4, 2);
  ctx.fillRect(x0 - 2, Y(-10), x1 - x0 + 4, 2);

  drawEndZone(ctx, cam, -10, 0, offTeam);
  drawEndZone(ctx, cam, 100, 110, defTeam);

  // turf texture over everything green
  tileRect(ctx, noiseTile(), apronL, top, apronR - apronL, bot - top, X(0), Y(0));

  // yard lines
  ctx.fillStyle = LINE;
  for (let f = Math.ceil(Math.max(0, f0) / 5) * 5; f <= Math.min(100, f1); f += 5) {
    const y = Y(f);
    const th = f === 0 || f === 100 ? 2 : 1;
    ctx.fillRect(x0, y, x1 - x0, th);
  }
  // hashes and sideline ticks every yard
  const hw = Math.max(2, Math.round(s * 0.66));
  ctx.fillStyle = 'rgba(242,245,239,0.85)';
  for (let f = Math.ceil(Math.max(1, f0)); f <= Math.min(99, f1); f++) {
    if (f % 5 === 0) continue;
    const y = Y(f);
    ctx.fillRect(X(HASH_L) - (hw >> 1), y, hw, 1);
    ctx.fillRect(X(HASH_R) - (hw >> 1), y, hw, 1);
    ctx.fillRect(x0 + 2, y, hw, 1);
    ctx.fillRect(x1 - 2 - hw, y, hw, 1);
  }

  // yard numbers near each sideline; the yard line breaks around them
  // real numbers are 6 ft tall
  const ns = Math.max(1, Math.round((s * 0.86 * 2) / 7));
  for (let f = 10; f <= 90; f += 10) {
    if (f < f0 - 3 || f > f1 + 3) continue;
    const label = String(f <= 50 ? f : 100 - f);
    const len = textWidth(label, ns, 1);
    const y = Y(f) - Math.round((7 * ns) / 2);
    for (const cx of [X(12), X(FIELD_W - 12)]) {
      const lx = cx - Math.round(len / 2);
      ctx.fillStyle = Math.floor((f + 10) / 5) % 2 === 0 ? TURF_A : TURF_B;
      ctx.fillRect(lx - 2, Y(f) - 1, len + 4, 3);
      drawText(ctx, label, lx, y, ns, LINE, 0, 1);
    }
  }

  // midfield mark
  if (homeTeam && f0 < 54 && f1 > 46) {
    const cx = X(FIELD_W / 2);
    const cy = Y(50);
    const r = Math.round(s * 2.6);
    disc(ctx, cx, cy, r + 2, tone(homeTeam.colors.secondary, -0.2), 0.86);
    disc(ctx, cx, cy, r, homeTeam.colors.primary, 0.86);
    const sc = r >= 16 ? 2 : 1;
    const tw = textWidth(homeTeam.abbr, sc);
    const same = homeTeam.colors.secondary.toUpperCase() === homeTeam.colors.primary.toUpperCase();
    drawTextOutlined(ctx, homeTeam.abbr, cx - Math.round(tw / 2), cy - Math.round(3.5 * sc), sc, same ? '#ffffff' : homeTeam.colors.secondary, tone(homeTeam.colors.primary, -0.5));
  }

  // line of scrimmage and line to gain
  if (showLines && los != null) {
    ctx.fillStyle = '#3d8bff';
    ctx.fillRect(x0, Y(los), x1 - x0, 2);
    ctx.fillStyle = '#1f4fa8';
    ctx.fillRect(x0, Y(los) + 2, x1 - x0, 1);
    if (ltg != null && ltg < 100) {
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(x0, Y(ltg), x1 - x0, 2);
      ctx.fillStyle = '#a8801a';
      ctx.fillRect(x0, Y(ltg) + 2, x1 - x0, 1);
    }
  }
}

function drawEndZone(ctx, cam, fa, fb, team) {
  if (!team) return;
  const x0 = Math.round(cam.sx(0));
  const x1 = Math.round(cam.sx(FIELD_W));
  const yt = Math.round(cam.sy(fb));
  const yb = Math.round(cam.sy(fa));
  if (yb < 0 || yt > cam.h) return;
  const base = team.colors.primary;
  ctx.fillStyle = tone(base, -0.08);
  ctx.fillRect(x0, yt, x1 - x0, yb - yt);
  // diagonal pinstripes
  ctx.fillStyle = tone(base, 0.08);
  for (let y = yt; y < yb; y++) {
    for (let x = x0 + ((y + 1000) % 8); x < x1; x += 8) ctx.fillRect(x, y, 2, 1);
  }
  const word = team.name.toUpperCase();
  const h = yb - yt;
  const maxW = (x1 - x0) * 0.86;
  const sc = Math.max(1, Math.floor(Math.min((h * 0.62) / 7, maxW / textWidth(word, 1))));
  const tw = textWidth(word, sc);
  const tx = Math.round((x0 + x1) / 2 - tw / 2);
  const ty = Math.round((yt + yb) / 2 - (7 * sc) / 2);
  const sec = team.colors.secondary;
  const fg = sec.toUpperCase() === base.toUpperCase() || Math.abs(lumOf(sec) - lumOf(base)) < 0.2 ? '#ffffff' : sec;
  // drop shadow, outline, fill: painted block letters
  drawText(ctx, word, tx + sc, ty + sc, sc, tone(base, -0.55));
  drawTextOutlined(ctx, word, tx, ty, sc, fg, tone(base, -0.6));
}

function lumOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
}

// Goalposts sit on the end lines; drawn after the players.
export function drawGoalposts(ctx, cam) {
  for (const f of [110]) {
    const y = Math.round(cam.sy(f));
    if (y < -60 || y > cam.h + 10) continue;
    const s = cam.s;
    const cx = Math.round(cam.sx(FIELD_W / 2));
    const half = Math.round(3.08 * s);
    const bar = Math.round(3.33 * s * 0.9); // 10 ft crossbar, same height scale as the ball
    const up = Math.round(7 * s);
    const P = '#f6d33a';
    const PD = '#a8861a';
    ctx.fillStyle = '#c9cdd6';
    ctx.fillRect(cx - 2, y - 2, 5, 4);
    ctx.fillStyle = PD;
    ctx.fillRect(cx, y - bar, 2, bar);
    ctx.fillStyle = P;
    ctx.fillRect(cx - 1, y - bar, 2, bar);
    ctx.fillRect(cx - half, y - bar - 2, half * 2 + 2, 2);
    ctx.fillStyle = PD;
    ctx.fillRect(cx - half, y - bar, half * 2 + 2, 1);
    ctx.fillStyle = P;
    ctx.fillRect(cx - half, y - bar - up, 2, up);
    ctx.fillRect(cx + half, y - bar - up, 2, up);
    ctx.fillStyle = '#d23a2a';
    ctx.fillRect(cx - half, y - bar - up - 3, 2, 3);
    ctx.fillRect(cx + half, y - bar - up - 3, 2, 3);
  }
}
