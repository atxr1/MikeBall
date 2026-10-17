// TV presentation for a game: the carrying network's scorebug (drawn from
// the pack's blank scorebug art, tinted with each team's color through its
// mask, filled in live), its title cards for big moments, and its logo in the
// corner of the field like a broadcast bug. Network and slot come from
// src/data/broadcast.js.

import { ready, image } from '../render/images.js';
import { drawText, textWidth } from '../render/pixelfont.js';
import { fmtClock } from '../core/util.js';

const ROOT = 'assets/broadcast';
let layoutsPromise = null;
let layouts = null;

export function loadLayouts() {
  if (!layoutsPromise) {
    layoutsPromise = fetch(`${ROOT}/layouts.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    layoutsPromise.then((l) => { layouts = l; });
  }
  return layoutsPromise;
}

export function netArt(net, file) {
  return `${ROOT}/${net}/${file}`;
}

// Title cards we have art for, by banner heading.
const CARD_FOR = {
  'Touchdown!': ['touchdown', 'TOUCHDOWN'],
  'Pick six!': ['touchdown', 'PICK SIX'],
  'Scoop and score!': ['touchdown', 'SCOOP & SCORE'],
  'Field goal': ['field_goal', 'FIELD GOAL'],
  Halftime: ['halftime', 'HALFTIME'],
  Overtime: ['overtime', 'OVERTIME'],
  'Two-minute warning': ['two_minute', '2:00 WARNING'],
  Kickoff: ['kickoff', 'KICKOFF'],
  Final: ['final', 'FINAL'],
};

export function preloadBroadcast(net) {
  loadLayouts();
  image(netArt(net, 'logo_32.png'));
  for (const [key] of Object.values(CARD_FOR)) image(netArt(net, `${key}_240x60.png`));
}

function hexRgb(h) {
  const n = parseInt(String(h || '#888888').replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lum(r, g, b) {
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
}

// A network title card with its words redrawn in the game's own pixel font
// (the pack's baked-in lettering has letters that read wrong). Returns a
// canvas, or null if the art hasn't loaded.
export function titleCard(net, heading) {
  const spec = CARD_FOR[heading];
  if (!spec) return null;
  const img = ready(netArt(net, `${spec[0]}_240x60.png`));
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  // find the baked-in lettering: light pixels right of the logo divider
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 60; x < c.width - 12; x++) {
      const i = (y * c.width + x) * 4;
      if (d.data[i + 3] && lum(d.data[i], d.data[i + 1], d.data[i + 2]) > 0.78) {
        if (y >= c.height - 12) continue; // the accent stripe
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 > x0) {
    // background = most common dark color around the words; ink = most
    // common light color in them
    const count = (dark) => {
      const m = new Map();
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = (y * c.width + x) * 4;
          if (!d.data[i + 3]) continue;
          const l = lum(d.data[i], d.data[i + 1], d.data[i + 2]);
          if (dark ? l > 0.5 : l <= 0.78) continue;
          const k = (d.data[i] << 16) | (d.data[i + 1] << 8) | d.data[i + 2];
          m.set(k, (m.get(k) || 0) + 1);
        }
      }
      let best = dark ? 0x101820 : 0xf0f0da;
      let bn = 0;
      for (const [k, v] of m) if (v > bn) { bn = v; best = k; }
      return `#${best.toString(16).padStart(6, '0')}`;
    };
    const bg = count(true);
    const ink = count(false);
    ctx.fillStyle = bg;
    ctx.fillRect(x0 - 1, y0 - 1, x1 - x0 + 3, y1 - y0 + 3);
    const text = spec[1];
    const scale = textWidth(text, 2, 1) <= c.width - 70 ? 2 : 1;
    const tw = textWidth(text, scale, 1);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    drawText(ctx, text, Math.round(cx - tw / 2), Math.round(cy - (7 * scale) / 2), scale, ink);
  }
  return c;
}

// Size a pixel canvas for the screen at a whole number of device pixels per
// art pixel, as wide as fits in `maxCss` CSS pixels.
export function fitPixelCanvas(canvas, maxCss) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const k = Math.max(1, Math.floor((maxCss * dpr) / canvas.width));
  canvas.style.width = `${(canvas.width * k) / dpr}px`;
  canvas.style.height = `${(canvas.height * k) / dpr}px`;
}

export class Scorebug {
  constructor(net, home, away) {
    this.net = net;
    this.teams = { home, away };
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'scorebug-canvas';
    this.canvas.setAttribute('role', 'img');
    this.key = '';
    this.base = null;
  }

  get layout() {
    return layouts && layouts[this.net] && layouts[this.net].standard;
  }

  // Ready when the layout, frame and mask have loaded.
  ensureBase() {
    if (this.base) return true;
    const lay = this.layout;
    if (!lay) return false;
    const frame = ready(netArt(this.net, lay.file));
    const mask = ready(netArt(this.net, lay.mask));
    if (!frame || !mask) return false;
    const c = document.createElement('canvas');
    c.width = lay.width;
    c.height = lay.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(frame, 0, 0);
    const fd = ctx.getImageData(0, 0, c.width, c.height);
    const m = document.createElement('canvas').getContext('2d');
    m.canvas.width = c.width;
    m.canvas.height = c.height;
    m.drawImage(mask, 0, 0);
    const md = m.getImageData(0, 0, c.width, c.height).data;
    // team panels: red mask = away, blue = home; keep the frame's shading
    const tint = { away: hexRgb(this.teams.away.colors.primary), home: hexRgb(this.teams.home.colors.primary) };
    const sums = { away: [0, 0], home: [0, 0] };
    const sideAt = (i) => (md[i + 3] && fd.data[i + 3] ? (md[i] > 128 && md[i + 2] < 128 ? 'away' : md[i + 2] > 128 && md[i] < 128 ? 'home' : null) : null);
    for (let i = 0; i < fd.data.length; i += 4) {
      const s = sideAt(i);
      if (!s) continue;
      sums[s][0] += lum(fd.data[i], fd.data[i + 1], fd.data[i + 2]);
      sums[s][1]++;
    }
    for (let i = 0; i < fd.data.length; i += 4) {
      const s = sideAt(i);
      if (!s) continue;
      const avg = sums[s][0] / Math.max(1, sums[s][1]) || 0.3;
      const k = Math.min(1.35, Math.max(0.6, lum(fd.data[i], fd.data[i + 1], fd.data[i + 2]) / avg));
      fd.data[i] = Math.min(255, tint[s][0] * k);
      fd.data[i + 1] = Math.min(255, tint[s][1] * k);
      fd.data[i + 2] = Math.min(255, tint[s][2] * k);
    }
    ctx.putImageData(fd, 0, 0);
    this.base = c;
    this.canvas.width = c.width;
    this.canvas.height = c.height;
    return true;
  }

  // s: { away:{abbr,score,to}, home:{...}, poss: 'home'|'away'|null,
  //      period, clock (sec), pc (string or ''), dd }
  update(s) {
    if (!this.ensureBase()) return false;
    const key = JSON.stringify(s);
    if (key === this.key) return true;
    this.key = key;
    const lay = this.layout;
    const F = lay.fields;
    const ctx = this.canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, lay.width, lay.height);
    ctx.drawImage(this.base, 0, 0);
    const col = (f) => (lay.textColors && lay.textColors[f]) || lay.textColor || '#f0f0da';
    const text = (f, str, big = false) => {
      const r = F[f];
      if (!r || str == null || str === '') return;
      str = String(str).toUpperCase();
      let scale = big && r[3] >= 14 ? 2 : 1;
      let sp = 1;
      if (textWidth(str, scale, sp) > r[2] && scale === 2) scale = 1;
      if (textWidth(str, scale, sp) > r[2]) sp = 0;
      // shorter forms before cutting letters: "3RD & GOAL" -> "3RD & G"
      for (const [a, b] of [[' & GOAL', ' & G'], [' & INCHES', ' & IN'], [' & ', '&']]) {
        if (textWidth(str, scale, sp) > r[2] && str.includes(a)) str = str.replace(a, b);
      }
      while (str.length > 1 && textWidth(str, scale, sp) > r[2]) str = str.slice(0, -1);
      const w = textWidth(str, scale, sp);
      drawText(ctx, str, Math.round(r[0] + (r[2] - w) / 2), Math.round(r[1] + (r[3] - 7 * scale) / 2), scale, col(f), 0, sp);
    };
    for (const side of ['away', 'home']) {
      const t = this.teams[side];
      const r = F[`${side}_logo`];
      const logo = t.art ? ready(`assets/teams/${t.id}/logo_${r && r[2] >= 32 ? 32 : 16}.png`) : null;
      if (r && logo) ctx.drawImage(logo, Math.round(r[0] + (r[2] - logo.width) / 2), Math.round(r[1] + (r[3] - logo.height) / 2));
      text(`${side}_abbr`, s[side].abbr);
      text(`${side}_score`, s[side].score, true);
      (lay.timeouts[side] || []).forEach((rr, i) => {
        ctx.fillStyle = i < s[side].to ? '#ffd23f' : 'rgba(0,0,0,0.35)';
        ctx.fillRect(rr[0], rr[1], rr[2], rr[3]);
      });
    }
    text('period', s.period);
    text('clock', s.clock == null ? '' : fmtClock(s.clock));
    text('play_clock', s.pc);
    if (s.flag && F.down_distance) {
      // FLAG over the down and distance, like the broadcasts
      const r = F.down_distance;
      ctx.fillStyle = '#f7d117';
      ctx.fillRect(r[0], r[1], r[2], r[3]);
      ctx.fillStyle = '#1a1400';
      const w = textWidth('FLAG', 1, 1);
      drawText(ctx, 'FLAG', Math.round(r[0] + (r[2] - w) / 2), Math.round(r[1] + (r[3] - 7) / 2), 1, '#1a1400', 0, 1);
    } else text('down_distance', s.dd);
    const pm = s.poss && lay.possession[s.poss];
    if (pm) {
      ctx.fillStyle = '#ffd23f';
      for (let i = 0; i < 3; i++) ctx.fillRect(pm[0] + i, pm[1] + i, 1, 5 - i * 2);
    }
    return true;
  }
}
