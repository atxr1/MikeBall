// The home stadium's own show when the home team scores (see
// src/data/traditions.js): fireworks over the stands, the pirate ship's
// cannons, the End Zone Militia's muskets, the horse mascot's gallop.
// Drawn in low-res pixels (ctx already scaled to art pixels).

import { scoreShowFor } from '../data/traditions.js';
import { FIELD_W } from '../core/util.js';
import { makeCanvas } from './pixeldraw.js';

function hexNum(h) {
  return parseInt(String(h || '#ffffff').replace('#', ''), 16);
}
function rgb(n, a = 1) {
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
// small deterministic noise so shows don't need an RNG
function noise(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// ---------------------------------------------------------------- sprites
function paint(w, h, rows, pal) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const k = row[x];
      if (k === '.' || !pal[k]) continue;
      ctx.fillStyle = pal[k];
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

let shipSprite = null;
function ship() {
  if (shipSprite) return shipSprite;
  // the Buccaneers' pirate ship, seen from the field
  const rows = [
    '..............k.................',
    '.............kRk................',
    '..............k.........k.......',
    '.........wwwwwkwwww....kRk......',
    '.........wwwwwkwwww.....k.......',
    '........wwwwwwkwwwww.wwwkwww....',
    '........wwwwwwkwwwww.wwwkwww....',
    '........wwwwbbkbbwww.wwwkwww....',
    '.......wwwwwbbkbbwwwwwwwkwwww...',
    '.......wwwwwwwkwwwwwwwwwkwwww...',
    '..............k.........k.......',
    '..ttttttttttttttttttttttttttt...',
    '.tHHHHHHHHHHHHHHHHHHHHHHHHHHHt..',
    '.tHgHHHgHHHgHHHgHHHgHHHgHHHgHt..',
    '..tHHHHHHHHHHHHHHHHHHHHHHHHHt...',
    '...tddddddddddddddddddddddddt...',
    '....tddddddddddddddddddddddt....',
    '.....tttttttttttttttttttttt.....',
  ];
  shipSprite = paint(32, rows.length, rows, {
    k: '#2a1a10', R: '#d50a0a', w: '#ece6d6', b: '#2a2a2a', t: '#3b2412', H: '#7a4a24', g: '#141010', d: '#5a3418',
  });
  return shipSprite;
}

let militiaSprite = null;
function militiaman() {
  if (militiaSprite) return militiaSprite;
  // tricorn hat, blue coat, white breeches, musket on the shoulder
  const rows = [
    '......m',
    '.kkk..m',
    'kkkkk.m',
    '.sss..m',
    '.BBBBBm',
    'BBBBB..',
    '.BBB...',
    '.www...',
    '.w.w...',
    '.k.k...',
  ];
  militiaSprite = paint(7, rows.length, rows, { k: '#141414', m: '#6b4a2a', s: '#e3b18c', B: '#1d3c78', w: '#efefef' });
  return militiaSprite;
}

const SHELL_RISE = 0.42; // seconds a firework shell climbs before it bursts
const horseCache = new Map();
function horse(frame, coat, rider) {
  const key = `${frame % 2}|${coat}|${rider}`;
  if (horseCache.has(key)) return horseCache.get(key);
  // galloping horse facing right, rider carrying the team flag
  const top = [
    '...........p..............',
    '...........pFFF...........',
    '...........pFFFF..........',
    '...........p..............',
    '...........p.oo...........',
    '...........pRRR........ee.',
    '............RRR.......ccc.',
    '............RR.......ccccc',
    '....cccccccSSSccccccccc.cc',
    '..ccccccccSSSSccccccc.....',
    '.cccccccccccccccccccc.....',
    'tccccccccccccccccccc......',
    'tt.cccccccccccccccc.......',
    't...cccc.......cccc.......',
  ];
  const legs = [
    ['....cc..c.....cc..c.......', '...cc....c...cc....c......', '...c......c..c......c.....', '..kk......kk.kk.....kk....'],
    ['.....cc.cc....cc.cc.......', '.....c...c....c...c.......', '....c....c...c....c.......', '....kk...kk..kk...kk......'],
  ][frame % 2];
  const rows = [...top, ...legs];
  const c = paint(26, rows.length, rows, {
    c: coat, k: '#2a2622', t: '#bdb6a6', R: rider, o: '#e3b18c', S: '#1d2c4c', F: rider, p: '#5a3a1e', e: coat,
  });
  outlineCanvas(c);
  horseCache.set(key, c);
  return c;
}

// dark selective outline, like the player sprites
function outlineCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const out = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = (ny * w + nx) * 4;
        if (d[j + 3] > 200) {
          out[i] = d[j] * 0.22 + 6;
          out[i + 1] = d[j + 1] * 0.22 + 6;
          out[i + 2] = d[j + 2] * 0.22 + 10;
          out[i + 3] = 255;
          break;
        }
      }
    }
  }
  img.data.set(out);
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------- show
export class ScoreShow {
  constructor(homeTeam) {
    this.team = homeTeam;
    this.show = scoreShowFor(homeTeam);
    const c = homeTeam ? homeTeam.colors : {};
    this.cols = [hexNum(c.primary), hexNum(c.secondary), 0xffffff, 0xffd23f];
    this.t = 0;
    this.items = []; // scheduled shells / booms / volleys / gallops
    this.parts = []; // live particles
    this.n = 0;
  }

  get song() {
    return this.show && this.show.song;
  }

  // The home team just scored `points`.
  trigger(points) {
    const s = this.show;
    if (!s || points <= 0) return false;
    const n = Math.max(1, Math.min(8, points));
    if (s.fireworks) for (let i = 0; i < n; i++) this.items.push({ k: 'shell', at: this.t + 0.15 + i * 0.32, i: this.n++ });
    if (s.cannons) for (let i = 0; i < n; i++) this.items.push({ k: 'boom', at: this.t + 0.2 + i * 0.45, i: this.n++ });
    if (s.muskets) for (let i = 0; i < Math.min(3, n); i++) this.items.push({ k: 'volley', at: this.t + 0.2 + i * 0.9, i: this.n++ });
    if (s.horse && points >= 3) this.items.push({ k: 'gallop', at: this.t + 0.3, dur: 3.2 });
    return true;
  }

  get active() {
    return this.items.length > 0 || this.parts.length > 0;
  }

  update(dt, cam) {
    this.t += dt;
    for (const it of this.items) {
      if (!it.fired && this.t >= it.at) {
        it.fired = true;
        it.t0 = this.t;
        if (it.k === 'shell' && cam) it.spot = this.shellSpot(cam, it.i);
      }
      if (it.fired && it.k === 'shell' && !it.burst && this.t - it.t0 >= SHELL_RISE && cam) this.burst(cam, it);
    }
    for (const p of this.parts) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.g * dt;
      p.vx *= 1 - dt * p.drag;
      p.vy *= 1 - dt * p.drag;
    }
    this.parts = this.parts.filter((p) => p.age < p.life);
    this.items = this.items.filter((it) => !it.fired || this.t - it.t0 < (it.k === 'gallop' ? it.dur : it.k === 'shell' ? 0.5 : 1.2));
  }

  // where the stands start at each end of the screen (see field.js)
  ends(cam) {
    return { top: Math.round(cam.sy(117)) - 2, bot: Math.round(cam.sy(-17)) + 2, mid: Math.round(cam.sx(FIELD_W / 2)) };
  }

  // Fixed stadium features (the ship, the militia line), drawn over the
  // stands. topEnd: which physical end is at the top of the screen.
  drawStatic(ctx, cam, topEnd) {
    const s = this.show;
    if (!s) return;
    const e = this.ends(cam);
    if (s.cannons) {
      // the ship sits in the north end zone stands
      const img = ship();
      const atTop = topEnd === 'N';
      const x = e.mid - 16;
      const y = atTop ? e.top - img.height - 6 : e.bot + 10;
      if (y > -img.height && y < cam.h) ctx.drawImage(img, x, y);
      this.shipAt = { x, y, w: img.width, h: img.height };
    }
    if (s.muskets) {
      const img = militiaman();
      this.militia = [];
      for (const [y0, flip] of [[e.top + 3, false], [e.bot - img.height - 3, true]]) {
        if (y0 < -12 || y0 > cam.h) continue;
        for (let i = 0; i < 7; i++) {
          const x = e.mid - 42 + i * 13;
          ctx.drawImage(img, x, y0);
          this.militia.push({ x: x + 6, y: y0, flip });
        }
      }
    }
  }

  // Animated parts: shells, cannon flashes, musket smoke, the horse.
  draw(ctx, cam) {
    const e = this.ends(cam);
    for (const it of this.items) {
      if (!it.fired) continue;
      const u = this.t - it.t0;
      if (it.k === 'shell') this.drawShell(ctx, cam, e, it, u);
      else if (it.k === 'boom') this.drawBoom(ctx, it, u);
      else if (it.k === 'volley') this.drawVolley(ctx, it, u);
      else if (it.k === 'gallop') this.drawHorse(ctx, cam, it, u);
    }
    for (const p of this.parts) {
      const a = 1 - p.age / p.life;
      if (p.twinkle && a < 0.4 && Math.floor(p.age * 24 + p.seed) % 2) continue;
      ctx.fillStyle = rgb(p.col, Math.min(1, a * 1.6));
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.sz, p.sz);
      if (p.twinkle && p.age < 0.5) {
        // short trail behind each spark
        ctx.fillStyle = rgb(p.col, a * 0.45);
        ctx.fillRect(Math.round(p.x - p.vx * 0.05), Math.round(p.y - p.vy * 0.05), 1, 1);
      }
    }
  }

  // bursts over the stadium: the top third of the screen, over the far stands
  shellSpot(cam, i) {
    // above the far stands' wall when it's in view, else near the top
    const wall = this.ends(cam).top;
    const low = Math.max(40, Math.min(wall - 24, cam.h * 0.4));
    return { x: Math.round(cam.w * (0.12 + 0.76 * noise(i))), y: Math.round(10 + noise(i + 7) * (low - 10)) };
  }

  // A shell climbs from behind the far stands...
  drawShell(ctx, cam, e, it, u) {
    if (u >= SHELL_RISE) return;
    const { x: bx, y: by } = it.spot || this.shellSpot(cam, it.i);
    const k = u / SHELL_RISE;
    const y = Math.round(by + (1 - k) * 70);
    ctx.fillStyle = '#fff3c4';
    ctx.fillRect(bx, y, 2, 2);
    ctx.fillStyle = 'rgba(255,210,120,0.55)';
    ctx.fillRect(bx, y + 2, 2, 5);
    ctx.fillStyle = 'rgba(255,170,90,0.3)';
    ctx.fillRect(bx, y + 7, 1, 5);
  }

  // ...and bursts into the team's colors.
  burst(cam, it) {
    it.burst = true;
    const i = it.i;
    const { x: bx, y: by } = it.spot || this.shellSpot(cam, i);
    const col = this.cols[i % 2];
    const alt = this.cols[2 + (i % 2)];
    const n = 44;
    // the flash at the heart of the burst
    this.parts.push({ x: bx - 2, y: by - 2, vx: 0, vy: 0, g: 0, drag: 0, age: 0, life: 0.12, col: 0xffffff, sz: 5, twinkle: false, seed: 0 });
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + noise(i * 13 + j) * 0.2;
      const sp = 44 + noise(i * 7 + j) * 40;
      this.parts.push({
        x: bx, y: by, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8, g: 22, drag: 1.6,
        age: 0, life: 1.0 + noise(j + i) * 0.5, col: j % 3 === 0 ? alt : col, sz: j % 4 === 0 ? 1 : 2, twinkle: true, seed: j,
      });
    }
  }

  drawBoom(ctx, it, u) {
    const s = this.shipAt;
    if (!s) return;
    const port = it.i % 6;
    const x = s.x + 4 + port * 4;
    const y = s.y + 13;
    if (u < 0.12) {
      ctx.fillStyle = '#fff3c4';
      ctx.fillRect(x - 2, y - 1, 5, 3);
      ctx.fillStyle = '#ffb84a';
      ctx.fillRect(x - 1, y - 3, 3, 2);
    }
    // smoke drifting up and fading
    const r = 2 + u * 7;
    ctx.fillStyle = `rgba(220,220,220,${Math.max(0, 0.7 - u * 0.6)})`;
    for (let k = 0; k < 5; k++) {
      const a = k * 1.3 + it.i;
      ctx.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y - u * 10 + Math.sin(a) * r * 0.6), 2, 2);
    }
  }

  drawVolley(ctx, it, u) {
    for (const m of this.militia || []) {
      const x = m.x + 1;
      const y = m.y - 1;
      if (u < 0.1) {
        ctx.fillStyle = '#fff3c4';
        ctx.fillRect(x - 1, y - 1, 3, 2);
      }
      ctx.fillStyle = `rgba(235,235,235,${Math.max(0, 0.8 - u * 0.7)})`;
      const r = 1 + u * 5;
      ctx.fillRect(Math.round(x - r), Math.round(y - u * 8), Math.round(r * 2), 2);
      ctx.fillRect(Math.round(x - r * 0.6), Math.round(y - u * 8 - 2), Math.round(r * 1.2), 2);
    }
  }

  // The horse gallops across the back of the end zone, sideline to sideline.
  drawHorse(ctx, cam, it, u) {
    const h = this.show.horse;
    const k = u / it.dur;
    const x = Math.round(cam.sx(-5 + k * (FIELD_W + 10)));
    const y = Math.round(cam.sy(113.5));
    const img = horse(Math.floor(u * 10), h.coat, h.rider);
    ctx.drawImage(img, x - 13, y - img.height);
  }
}
