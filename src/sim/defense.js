// Defensive players in the play sim, mixed into PlaySim: reading the play,
// rushing the passer, pursuit angles, man and zone coverage, breaking on
// the ball. No DOM; seeded RNG only.

import { FIELD_W, clamp, dist } from '../core/util.js';
import { looking } from './odds.js';

const HIST = 40;
const DT = 1 / 60;

export const defenseMethods = {
  defThink(p, dt) {
    const carrier = this.carrier;
    const holder = this.ball.holder;
    if (this.phase === 'run' && carrier) {
      if (carrier.side === 'D') return this.escort(p, dt, carrier);
      const knows = this.t - this.runT > (this.receiver || this.interceptor ? p.ballReact : p.readDelay);
      if (knows || p.assign.t === 'rush' || p.assign.t === 'blitz' || dist(p.x, p.y, carrier.x, carrier.y) < 4) return this.pursue(p, dt, carrier);
      return this.coverage(p, dt);
    }
    if (this.phase === 'air') {
      const b = this.ball;
      // a defender with his back to the quarterback finds the ball late
      if (p.seeBall == null) p.seeBall = p.ballReact + (1 - looking(p, b.fx, b.fy)) * 0.5;
      if (this.t - b.t0 > p.seeBall && (p.assign.t !== 'rush' && p.assign.t !== 'blitz' || p.y > 2)) {
        const tLeft = b.t0 + b.T - this.t;
        const d = dist(p.x, p.y, b.tx, b.ty);
        if (d / p.maxSpd < tLeft + 1.2) return this.steer(p, b.tx, b.ty, 1, dt, 0.2);
        if (b.target) return this.steer(p, b.tx, b.ty + 1, 1, dt, 0.5);
      }
      return this.coverage(p, dt);
    }
    // ball in backfield (or QB scramble not yet a "run" phase)
    switch (p.assign.t) {
      case 'rush':
      case 'blitz':
        return this.rush(p, dt, holder);
      case 'spy':
        if (holder && holder.y > -0.5) return this.pursue(p, dt, holder);
        return this.steer(p, this.qb.x, Math.max(this.qb.y + 6, 4.5), 0.8, dt, 0.6);
      case 'fit':
        if (this.t < 0.8) return this.steer(p, this.ballX + (p.sx - this.ballX) * 0.5, 1.6, 0.9, dt, 0.5);
        p.assign = { ...p.assign, t: 'zone', zone: { x: this.ballX, y: 7, rx: 5, ry: 4 } };
        return this.zoneCover(p, dt);
      default:
        return this.coverage(p, dt);
    }
  },

  coverage(p, dt) {
    if (p.paFooled && this.t < 0.75) return this.steer(p, p.sx, p.sy - 2.2, 0.7, dt, 0.4);
    // Linebackers read-step before dropping so they can still fit the run.
    if (p.pos === 'LB' && this.t < 0.25 + p.readDelay * 0.6 && this.phase === 'pre') return this.steer(p, p.sx, p.sy - 0.6, 0.35, dt, 0.4);
    if (p.assign.t === 'man') return this.manCover(p, dt);
    if (p.assign.t === 'zone') return this.zoneCover(p, dt);
    if (p.assign.t === 'rush' || p.assign.t === 'blitz') return this.rush(p, dt, this.ball.holder || this.qb);
    return this.zoneCover(p, dt);
  },

  // ---------------------------------------------------------------- defense behaviors
  rush(p, dt, holder) {
    const qb = holder || this.qb;
    // blitzers (and linemen given a gap) attack their lane first
    if ((p.assign.t === 'blitz' || p.assign.gapX != null) && this.t < 0.55 && p.y > 0.3) {
      return this.steer(p, p.assign.gapX, -0.3, 1, dt, 0);
    }
    let tx = qb.x;
    let ty = qb.y;
    const side = p.x - qb.x;
    if (Math.abs(side) > 2 && p.y > qb.y + 2.5) {
      tx = qb.x + Math.sign(side) * 1.8;
      ty = qb.y + 0.8;
    }
    this.steer(p, tx, ty, p.freeT > 0 ? 1 : 0.95, dt, 0);
  },

  pursue(p, dt, c) {
    if (p.stunT > 0) return this.brake(p, dt, 5);
    // Solve for the earliest intercept: |r + v*t| = s*t
    const rx = c.x - p.x;
    const ry = c.y - p.y;
    const s = p.maxSpd * 0.97;
    const a = c.vx * c.vx + c.vy * c.vy - s * s;
    const b = 2 * (rx * c.vx + ry * c.vy);
    const cc = rx * rx + ry * ry;
    let T = Math.sqrt(cc) / s;
    if (Math.abs(a) > 1e-6) {
      const disc = b * b - 4 * a * cc;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        const t1 = (-b - sq) / (2 * a);
        const t2 = (-b + sq) / (2 * a);
        const cand = [t1, t2].filter((t) => t > 0);
        if (cand.length) T = Math.min(...cand);
      }
    }
    T = Math.min(T, 1.8);
    const tx = c.x + c.vx * T * 0.92;
    const ty = c.y + c.vy * T * 0.92;
    this.steer(p, clamp(tx, -1, FIELD_W + 1), ty, 1, dt, 0);
  },

  manCover(p, dt) {
    const r = p.target;
    if (!r) return this.zoneCover(p, dt);
    // receiver stayed in to block -> green-dog rush (LB) or rob the middle (DB)
    if (!r.released && this.t > 0.9) {
      if (p.pos === 'LB') { p.assign = { t: 'rush' }; return this.rush(p, dt, this.ball.holder || this.qb); }
      p.assign = { t: 'zone', zone: { x: this.ballX, y: 9, rx: 5, ry: 4 } };
      return this.zoneCover(p, dt);
    }
    const lag = clamp(0.42 - p.a.mcv * 0.0028, 0.12, 0.4);
    const k = Math.round(lag / DT);
    const idx = ((r.hi - k) % HIST + HIST) % HIST;
    const lvx = r.hist[idx * 2];
    const lvy = r.hist[idx * 2 + 1];
    const startCush = p.assign.press ? 1.0 : Math.max(1.5, p.sy - r.sy - 1);
    const cushion = Math.max(0.9, startCush - this.t * 2.6);
    const inward = r.x > this.ballX ? -1 : 1;
    const tx = r.x + lvx * 0.35 + inward * 0.5;
    const ty = r.y + lvy * 0.35 + cushion;
    this.steer(p, tx, ty, 1, dt, 0.3);
  },

  zoneCover(p, dt) {
    const z = p.assign.zone || { x: p.sx, y: p.sy + 4, rx: 5, ry: 4 };
    let thr = null;
    let best = -1e9;
    for (const r of this.eligible) {
      if (r.down || !r.released) continue;
      const nx = (r.x - z.x) / (z.rx * 1.35);
      const ny = (r.y - z.y) / (z.ry * 1.35);
      const inside = nx * nx + ny * ny;
      if (z.deep) {
        if (inside > 1.6 || r.y < z.y - z.ry * 1.2) continue;
        if (r.y > best) { best = r.y; thr = r; }
      } else if (inside < 1) {
        const s = -inside;
        if (s > best) { best = s; thr = r; }
      }
    }
    const qb = this.qb;
    if (!thr) {
      const eyes = (qb.x - z.x) * 0.15;
      const spd = this.t < 1.2 ? 0.85 : 0.6;
      return this.steer(p, z.x + eyes, z.y, spd, dt, 1);
    }
    if (z.deep) return this.steer(p, thr.x + (this.ballX - thr.x) * 0.06, Math.max(thr.y + 2.8, z.y - z.ry * 0.4), 1, dt, 0.4);
    const inward = thr.x > this.ballX ? -1 : 1;
    return this.steer(p, clamp(thr.x + inward * 0.7, z.x - z.rx * 1.4, z.x + z.rx * 1.4), clamp(thr.y + 0.6, z.y - z.ry * 1.4, z.y + z.ry * 1.4), 0.95, dt, 0.4);
  },

};
