// Pixel-art UI images (team marks and badges) rendered once to small
// canvases and shown as crisp, nearest-neighbor-scaled <img>s.

import { drawText, textWidth } from '../render/pixelfont.js';
import { tone } from '../render/pixelsprites.js';

const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
}

// ------------------------------------------------------------------ team marks
export const MARK_W = 22;
export const MARK_H = 16;

export function teamMarkURL(team) {
  const c = team.colors;
  const key = `mark:${team.abbr}:${c.primary}:${c.secondary}`;
  if (cache.has(key)) return cache.get(key);
  const cv = canvas(MARK_W, MARK_H);
  const ctx = cv.getContext('2d');
  const W = MARK_W;
  const H = MARK_H;
  const edge = tone(c.primary, -0.55);
  const rim = Math.abs(lum(c.secondary) - lum(c.primary)) < 0.12 ? '#ffffff' : c.secondary;
  // notched rectangle: outline, rim, fill
  ctx.fillStyle = edge;
  ctx.fillRect(1, 0, W - 2, H);
  ctx.fillRect(0, 1, W, H - 2);
  ctx.fillStyle = rim;
  ctx.fillRect(2, 1, W - 4, H - 2);
  ctx.fillRect(1, 2, W - 2, H - 4);
  ctx.fillStyle = c.primary;
  ctx.fillRect(2, 2, W - 4, H - 4);
  ctx.fillStyle = tone(c.primary, 0.18);
  ctx.fillRect(2, 2, W - 4, 1);
  ctx.fillStyle = tone(c.primary, -0.22);
  ctx.fillRect(2, H - 3, W - 4, 1);
  // letters with a dark outline
  const txt = team.abbr;
  const tw = textWidth(txt, 1);
  const tx = Math.round((W - tw) / 2);
  const ty = 4;
  const fg = lum(c.primary) > 0.62 ? tone(c.primary, -0.75) : (Math.abs(lum(rim) - lum(c.primary)) > 0.3 ? rim : '#ffffff');
  for (const [dx, dy] of [[1, 1], [0, 1], [1, 0]]) drawText(ctx, txt, tx + dx, ty + dy, 1, edge);
  drawText(ctx, txt, tx, ty, 1, fg);
  const url = cv.toDataURL();
  cache.set(key, url);
  return url;
}

// ------------------------------------------------------------------ badges
export const BADGE_W = 13;
export const BADGE_H = 15;

const SHIELD = [
  '...#######...',
  '.###########.',
  '#############',
  '#############',
  '#############',
  '#############',
  '#############',
  '#############',
  '.###########.',
  '.###########.',
  '..#########..',
  '...#######...',
  '....#####....',
  '.....###.....',
  '......#......',
];

const GLYPHS = {
  speed: ['#...#..', '.#...#.', '..#...#', '.#...#.', '#...#..'],
  strength: ['#.....#', '##...##', '#######', '##...##', '#.....#'],
  skill: ['..###..', '.#...#.', '#..#..#', '#.###.#', '#..#..#', '.#...#.', '..###..'],
};

const TIER = {
  bronze: { top: '#f4b980', bot: '#93501f', rim: '#4a2810', glyph: '#fff1dc', shadow: '#5b300f' },
  silver: { top: '#ffffff', bot: '#8d98a4', rim: '#4e5660', glyph: '#2c343d', shadow: '#c9d0d8' },
  gold: { top: '#fff3a8', bot: '#c18610', rim: '#6a4706', glyph: '#553800', shadow: '#f2d36a' },
  diamond: { top: '#eafaff', bot: '#2f86ec', rim: '#d6f1ff', glyph: '#ffffff', shadow: '#1d58b0' },
  master: { top: '#5c616c', bot: '#06070a', rim: '#c3c8d0', glyph: '#d8dde5', shadow: '#000000' },
  franchise: { top: '#ff2340', mid: '#7a0020', bot: '#5a12a6', rim: '#c04dff', rim2: '#ff2e4d', glyph: '#ffffff', shadow: '#3a0010' },
};

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (n, s) => (n >> s) & 255;
  const m = (s) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
  return `#${[m(16), m(8), m(0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function badgeURL(tier, stat) {
  const key = `badge:${tier}:${stat}`;
  if (cache.has(key)) return cache.get(key);
  const T = TIER[tier] || TIER.bronze;
  const cv = canvas(BADGE_W, BADGE_H);
  const ctx = cv.getContext('2d');
  const inside = (x, y) => y >= 0 && y < BADGE_H && x >= 0 && x < BADGE_W && SHIELD[y][x] === '#';
  for (let y = 0; y < BADGE_H; y++) {
    const t = y / (BADGE_H - 1);
    const fill = T.mid ? (t < 0.5 ? mix(T.top, T.mid, t * 2) : mix(T.mid, T.bot, (t - 0.5) * 2)) : mix(T.top, T.bot, t);
    for (let x = 0; x < BADGE_W; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      const inner = !edge && (!inside(x - 2, y) || !inside(x + 2, y) || !inside(x, y - 2) || !inside(x, y + 2));
      let col = fill;
      if (edge) col = T.rim;
      else if (inner && T.rim2) col = T.rim2;
      else if (inner && x < 6 && y < 7) col = mix(fill, '#ffffff', 0.35);
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  if (tier === 'diamond') {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (const [x, y] of [[3, 3], [4, 2], [9, 4], [8, 9], [3, 8]]) ctx.fillRect(x, y, 1, 1);
  }
  if (tier === 'franchise') {
    ctx.fillStyle = '#ffd6de';
    for (const [x, y] of [[6, 0], [0, 3], [12, 3]]) ctx.fillRect(x, y, 1, 1);
  }
  const g = GLYPHS[stat] || GLYPHS.skill;
  const gx = Math.round((BADGE_W - g[0].length) / 2);
  const gy = Math.round(6 - g.length / 2);
  for (let r = 0; r < g.length; r++) {
    for (let cIdx = 0; cIdx < g[r].length; cIdx++) {
      if (g[r][cIdx] !== '#') continue;
      ctx.fillStyle = T.shadow;
      ctx.fillRect(gx + cIdx, gy + r + 1, 1, 1);
    }
  }
  ctx.fillStyle = T.glyph;
  for (let r = 0; r < g.length; r++) for (let cIdx = 0; cIdx < g[r].length; cIdx++) if (g[r][cIdx] === '#') ctx.fillRect(gx + cIdx, gy + r, 1, 1);
  const url = cv.toDataURL();
  cache.set(key, url);
  return url;
}
