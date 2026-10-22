// The seven-man officiating crew, on the field with the players. Visual
// only (no randomness, never changes a result): they line up where NFL
// officials do, move with the play without getting in the way, throw the
// flag when a foul happens, run in to spot the ball and give the signal
// after the whistle.
//
//   R   referee: offensive backfield, 10-12 yd deep, on the passer's arm side
//   U   umpire: offensive backfield opposite the referee (defensive side,
//       4-5 yd off the ball, late in halves and inside the 5)
//   DJ  down judge: on the line of scrimmage, chain-crew sideline
//   LJ  line judge: on the line, other sideline
//   SJ  side judge: about 20 yd deep, down judge's side
//   FJ  field judge: about 20 yd deep, line judge's side
//   BJ  back judge: about 25 yd deep, middle of the field
//
// Coordinates are the sim's: x across the field, y yards past the line.

import { FIELD_W, MID_X, clamp, dist } from '../core/util.js';

const ROLES = ['R', 'U', 'DJ', 'LJ', 'SJ', 'FJ', 'BJ'];
const SPEED = 6.6;

export class Crew {
  constructor(sim, umpireDefense = false) {
    this.sim = sim;
    this.flags = [];
    this.signal = null; // { who, kind, t0 }
    this.list = ROLES.map((role, i) => ({ role, x: 0, y: 0, vx: 0, vy: 0, face: 0, anim: 0, throwT: -9, signal: null, rec: { id: `ref-${role}`, num: [12, 33, 104, 46, 125, 93, 61][i] } }));
    this.by = Object.fromEntries(this.list.map((o) => [o.role, o]));
    this.umpDef = umpireDefense;
    // the down judge works the chain crew's sideline: the visitors' side in
    // the first half, the home side in the second (sim.opts.homeSide: -1 =
    // home bench on the left of the screen)
    const home = sim.opts.homeSide ?? -1;
    this.chainX = sim.opts.half === 2 ? home : -home;
    this.place();
  }

  home(o) {
    const s = this.sim;
    const bx = s.ballX;
    const deep = Math.min(20, s.goalY + 1.5);
    switch (o.role) {
      case 'R': return { x: clamp(bx + 4, 6, FIELD_W - 6), y: -11.5 };
      case 'U': return this.umpDef ? this.clear({ x: clamp(bx - 1, 6, FIELD_W - 6), y: 6 }, 'U') : { x: clamp(bx - 4.5, 6, FIELD_W - 6), y: -10.5 };
      case 'DJ': return { x: this.sideX(this.chainX, 1.0), y: 0 };
      case 'LJ': return { x: this.sideX(-this.chainX, 1.0), y: 0 };
      case 'SJ': return { x: this.sideX(this.chainX, -2.5), y: deep };
      case 'FJ': return { x: this.sideX(-this.chainX, -2.5), y: deep };
      case 'BJ': return this.clear({ x: MID_X, y: Math.min(25, s.goalY + 6) }, 'BJ');
      default: return { x: bx, y: -10 };
    }
  }

  // A spot in the defense's area, stepped aside from any defender lined up
  // on it (the officials stand clear of the players).
  // Worked out where everyone lines up, then kept through the play.
  clear(h, role) {
    const s = this.sim;
    const memo = this._clear || (this._clear = {});
    if (s.t > 0 && memo[role] != null) return { x: h.x + memo[role], y: h.y };
    let dx = 0;
    for (const d of s.defense) {
      if (Math.abs(d.x - h.x) < 1.4 && Math.abs(d.y - h.y) < 1.4) { dx = d.x <= h.x ? 1.6 : -1.6; break; }
    }
    memo[role] = dx;
    return { x: h.x + dx, y: h.y };
  }

  // x just outside (off > 0) or inside (off < 0) the sideline on side s
  sideX(s, off) {
    return s < 0 ? -off : FIELD_W + off;
  }

  place() {
    for (const o of this.list) {
      const h = this.home(o);
      o.x = h.x;
      o.y = h.y;
      o.face = o.role === 'R' || o.role === 'U' ? Math.PI / 2 : o.role === 'DJ' || o.role === 'LJ' ? (o.x < MID_X ? 0 : Math.PI) : -Math.PI / 2;
      o.watch = o.face;
    }
  }

  // ---------------------------------------------------------------- flags
  // Who sees it: the umpire and referee take the interior line, the wings
  // their sidelines, the deep officials what's downfield.
  throwFlag(f) {
    const s = this.sim;
    let o;
    if (f.key === 'rtp' || f.key === 'grounding' || f.key === 'falseStart') o = f.key !== 'falseStart' ? this.by.R : (f.x < s.ballX ? this.by.DJ : this.by.LJ);
    else if (f.key === 'offside' || f.key === 'encroach' || f.key === 'neutral' || f.key === 'formation') o = f.x < s.ballX ? (this.by.DJ.x < s.ballX ? this.by.DJ : this.by.LJ) : (this.by.DJ.x > s.ballX ? this.by.DJ : this.by.LJ);
    else if (f.key === 'subs') o = this.by.BJ;
    else {
      let best = null;
      let bd = 1e9;
      for (const c of this.list) {
        const d = dist(c.x, c.y, f.x, f.y);
        if (d < bd) { bd = d; best = c; }
      }
      o = best;
    }
    o.throwT = s.clock();
    o.flagged = true;
    // the flag flies from his hip toward the spot of the foul
    const tx = f.x + (o.x - f.x) * 0.15;
    const ty = f.y + (o.y - f.y) * 0.15;
    this.flags.push({ x0: o.x, y0: o.y, x1: clamp(tx, -1, FIELD_W + 1), y1: ty, t0: s.clock(), T: 0.55, x: o.x, y: o.y, z: 1.2, landed: false, by: o, foul: f });
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    const s = this.sim;
    const now = s.clock();
    for (const fl of this.flags) {
      const u = clamp((now - fl.t0) / fl.T, 0, 1);
      fl.x = fl.x0 + (fl.x1 - fl.x0) * u;
      fl.y = fl.y0 + (fl.y1 - fl.y0) * u;
      fl.z = 1.2 + 4 * 1.4 * u * (1 - u) - 1.2 * u;
      fl.landed = u >= 1;
    }
    if (s.t < 0.02 && !s.done) return;
    for (const o of this.list) {
      const t = s.done ? this.afterWhistle(o, now) : this.during(o);
      this.move(o, t.x, t.y, t.spd ?? 1, dt);
      if (t.face != null) o.face = t.face;
    }
  }

  // Where each official wants to be while the ball is live.
  during(o) {
    const s = this.sim;
    const b = s.ball;
    const h = b.holder && b.state === 'held' ? b.holder : null;
    const focus = h || (b.state === 'air' ? { x: b.tx, y: b.ty } : { x: b.x, y: b.y });
    let deepest = s.goalY - 20;
    for (const p of s.players) if (p.y > deepest) deepest = p.y;
    switch (o.role) {
      case 'DJ':
      case 'LJ': {
        // on the sideline, level with the ball once it's past the line
        const y = s.phase === 'run' || b.state === 'air' ? Math.max(0, focus.y - 1) : 0;
        const side = o.role === 'DJ' ? this.chainX : -this.chainX;
        return { x: this.sideX(side, 1.0), y, face: side < 0 ? 0 : Math.PI, spd: 0.85 };
      }
      case 'SJ':
      case 'FJ':
      case 'BJ': {
        // keep everyone in front of you
        const home = this.home(o);
        const y = Math.max(home.y, deepest + 5);
        const x = o.role === 'BJ' ? MID_X + (focus.x - MID_X) * 0.3 : home.x + (focus.x - home.x) * 0.12;
        return { x, y: Math.min(y, s.goalY + 9), face: -Math.PI / 2, spd: 0.95 };
      }
      default: {
        // R and U: stay behind the play, out of the way
        const home = this.home(o);
        if (s.phase === 'run' && h && h.y > 1) {
          return { x: home.x + (h.x - home.x) * 0.4, y: Math.min(h.y - 6, home.y + h.y * 0.8), face: Math.PI / 2, spd: 0.7 };
        }
        return { x: home.x, y: home.y, face: Math.PI / 2, spd: 0.5 };
      }
    }
  }

  // After the whistle: the nearest official runs in to mark the spot, the
  // rest drift in; the referee comes forward to announce a foul.
  afterWhistle(o, now) {
    const s = this.sim;
    const r = s.result;
    if (!this.spotter) {
      const spot = r ? { x: clamp(r.spotX ?? s.ballX, 0.5, FIELD_W - 0.5), y: r.incomplete ? (s.catchInfo ? s.catchInfo.by : 0) : r.spotY } : { x: s.ballX, y: 0 };
      if (r && r.td) spot.y = s.goalY + (r.defTD ? -100 : 0);
      this.spot = spot;
      let best = null;
      let bd = 1e9;
      for (const c of this.list) {
        if (c.role === 'R' || c.role === 'U') continue;
        const d = dist(c.x, c.y, spot.x, spot.y);
        if (d < bd) { bd = d; best = c; }
      }
      this.spotter = best;
      this.t0 = now;
      const fouls = s.fouls && s.fouls.length;
      if (r && r.td) best.signal = { kind: 'td', t0: now + 0.1 };
      else if (r && r.incomplete && !r.why?.includes('spike')) best.signal = { kind: 'incomplete', t0: now + 0.15 };
      else if (r && r.outOfBounds) best.signal = { kind: 'stop', t0: now + 0.2 };
      else if (r && r.firstDown) best.signal = { kind: 'first', t0: now + 0.5 };
      if (fouls) {
        const f = s.fouls[0];
        this.by.R.signal = { kind: f.signal, t0: now + 1.1, foul: f };
      }
    }
    const spot = this.spot;
    if (o === this.spotter) {
      const tx = clamp(spot.x, -1, FIELD_W + 1);
      return { x: tx, y: spot.y + (o.y > spot.y ? 0.6 : -0.6), spd: 1, face: Math.atan2(spot.y - o.y, spot.x - o.x) };
    }
    if (o.role === 'R' && o.signal) {
      // in front of the play to announce it, facing the camera
      return { x: clamp(spot.x + 3, 4, FIELD_W - 4), y: spot.y - 5, spd: 0.8, face: -Math.PI / 2 };
    }
    // drift toward the ball, staying a few yards off
    const dx = spot.x - o.x;
    const dy = spot.y - o.y;
    const d = Math.hypot(dx, dy);
    if (d < 7) return { x: o.x, y: o.y, spd: 0 };
    return { x: o.x + dx * 0.4, y: o.y + dy * 0.4, spd: 0.35 };
  }

  move(o, tx, ty, frac, dt) {
    const s = this.sim;
    let dx = tx - o.x;
    let dy = ty - o.y;
    // step around players
    for (const p of s.players) {
      const px = o.x - p.x;
      const py = o.y - p.y;
      const d2 = px * px + py * py;
      if (d2 < 3.2 && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        dx += (px / d) * (1.8 - d) * 3;
        dy += (py / d) * (1.8 - d) * 3;
      }
    }
    const d = Math.hypot(dx, dy);
    const want = d > 0.12 ? Math.min(SPEED * frac, d * 3) : 0;
    const tvx = d > 0 ? (dx / d) * want : 0;
    const tvy = d > 0 ? (dy / d) * want : 0;
    const k = Math.min(1, dt * 6);
    o.vx += (tvx - o.vx) * k;
    o.vy += (tvy - o.vy) * k;
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    const sp = Math.hypot(o.vx, o.vy);
    o.anim += sp * dt * 2.2;
    if (sp > 0.6) o.face = Math.atan2(o.vy, o.vx);
  }
}
