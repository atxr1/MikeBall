// Little on-field effects for contact: floating move labels ("JUKE!",
// "TRUCKED!"), impact bursts on hits, and dust when someone hits the turf.
// Fed from the play sim's event list; positions are in world yards.

import { drawTextOutlined, textWidth } from './pixelfont.js';

const LABELS = {
  juke: ['JUKE!', '#ffd23f'],
  spin: ['SPIN!', '#ffd23f'],
  stiff: ['STIFF ARM!', '#ffd23f'],
  truck: ['TRUCKED!', '#ffd23f'],
  hurdle: ['HURDLE!', '#ffd23f'],
  shrugDrag: ['BROKE FREE!', '#ffd23f'],
  hit: ['BOOM!', '#ff7a4a'],
  pushout: ['PUSHED OUT', '#ffffff'],
};

const DUST = ['#c9b98f', '#a99a72', '#e6dcc0', '#7fae6a'];

export class Effects {
  constructor() {
    this.list = [];
    this.seen = 0;
    this.sim = null;
  }

  reset(sim) {
    this.list.length = 0;
    this.seen = 0;
    this.sim = sim;
  }

  // Turn new sim events into effects. `los` is the line of scrimmage (f).
  pull(sim, los) {
    if (sim !== this.sim) this.reset(sim);
    const ev = sim.events;
    for (; this.seen < ev.length; this.seen++) {
      const e = ev[this.seen];
      const who = e.who;
      const x = e.x ?? who?.x;
      const y = e.y ?? who?.y;
      if (x == null) continue;
      const f = los + y;
      switch (e.k) {
        case 'juke':
        case 'spin':
        case 'hurdle':
          this.label(e.k, x, f);
          break;
        case 'stiff':
        case 'truck':
          this.label(e.k, x, f);
          if (e.on) this.burst((x + e.on.x) / 2, los + (y + e.on.y) / 2, e.k === 'truck' ? 2 : 1);
          break;
        case 'shrug':
          if (e.from === 'drag') this.label('shrugDrag', x, f);
          else if (e.on) this.burst((x + e.on.x) / 2, los + (y + e.on.y) / 2, 0);
          break;
        case 'contact':
          if (e.kind === 'hit') {
            this.label('hit', x, f);
            this.burst(x, f, 2);
          } else if (e.kind !== 'pushout') this.burst(x, f, e.kind === 'sack' ? 1 : 0);
          break;
        case 'pushedout':
          this.label('pushout', x, f);
          break;
        case 'fall':
          this.dust(x, f);
          break;
        case 'tackle':
        case 'sack':
          if (e.on) this.dust(e.on.x, los + e.on.y);
          break;
        default:
      }
    }
  }

  // Kick scenes report cosmetic events as {k, x, f} in field yards.
  pullList(owner, list) {
    if (owner !== this.sim) this.reset(owner);
    for (; this.seen < list.length; this.seen++) {
      const e = list[this.seen];
      if (e.k === 'fall') this.dust(e.x, e.f);
      else if (e.k === 'hit') { this.label('hit', e.x, e.f); this.burst(e.x, e.f, 2); }
      else if (LABELS[e.k]) this.label(e.k, e.x, e.f);
    }
  }

  label(key, x, f) {
    const [text, color] = LABELS[key];
    // one label at a time: a new move replaces the last one
    this.list = this.list.filter((fx) => fx.type !== 'label' || fx.age > 0.5);
    this.list.push({ type: 'label', text, color, x, f, age: 0, life: 1.0 });
  }

  burst(x, f, size) {
    this.list.push({ type: 'burst', x, f, size, age: 0, life: 0.28 });
  }

  dust(x, f) {
    const n = this.list.length;
    const puffs = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + n;
      puffs.push({ dx: Math.cos(a), dy: Math.sin(a) * 0.5, c: DUST[(i + n) % DUST.length] });
    }
    this.list.push({ type: 'dust', x, f, puffs, age: 0, life: 0.5 });
  }

  update(dt) {
    if (!this.list.length) return false;
    for (const fx of this.list) fx.age += dt;
    this.list = this.list.filter((fx) => fx.age < fx.life);
    return true;
  }

  get active() {
    return this.list.length > 0;
  }

  draw(ctx, cam) {
    for (const fx of this.list) {
      const X = Math.round(cam.sx(fx.x));
      const Y = Math.round(cam.sy(fx.f));
      const u = fx.age / fx.life;
      if (fx.type === 'dust') {
        const r = 2 + u * 7;
        for (const p of fx.puffs) {
          if (u > 0.6 && (p.dx > 0) === (u > 0.8)) continue;
          ctx.fillStyle = p.c;
          ctx.fillRect(Math.round(X + p.dx * r), Math.round(Y + p.dy * r), u < 0.5 ? 2 : 1, 1);
        }
      } else if (fx.type === 'burst') {
        const y0 = Y - 12;
        const big = fx.size;
        const r = (u < 0.4 ? 3 : 5) + big * 2;
        ctx.fillStyle = u < 0.4 ? '#ffffff' : '#ffd23f';
        // star: four long rays and four short diagonals
        ctx.fillRect(X - r, y0, r * 2 + 1, 1);
        ctx.fillRect(X, y0 - r, 1, r * 2 + 1);
        const d = Math.round(r * 0.6);
        for (let i = 1; i <= d; i++) {
          if (i < d * 0.4) continue;
          ctx.fillRect(X - i, y0 - i, 1, 1);
          ctx.fillRect(X + i, y0 - i, 1, 1);
          ctx.fillRect(X - i, y0 + i, 1, 1);
          ctx.fillRect(X + i, y0 + i, 1, 1);
        }
        if (u < 0.4) {
          ctx.fillStyle = '#ffd23f';
          ctx.fillRect(X - 1, y0 - 1, 3, 3);
        }
      } else if (fx.type === 'label') {
        if (u > 0.82 && Math.floor(fx.age * 20) % 2) continue; // blink out
        const rise = Math.round(Math.min(1, u * 3) * 8);
        // 2x pixel text so it reads on a phone (about 14 px tall)
        const w = textWidth(fx.text, 2, 1);
        const lx = Math.max(3, Math.min(cam.w - w - 3, X - (w >> 1)));
        drawTextOutlined(ctx, fx.text, lx, Y - 48 - rise, 2, fx.color, '#14100a');
      }
    }
  }
}
