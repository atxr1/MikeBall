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
      // a scramble: the coverage stays on its men until the passer's
      // crossed the line (he can still throw it), then a man with his back
      // to him finds out late
      if (this.scramble && !this.receiver && !this.interceptor && p.assign.t !== 'rush' && p.assign.t !== 'blitz' && p.assign.t !== 'spy') {
        if (carrier.y < -0.3 && dist(p.x, p.y, carrier.x, carrier.y) > 4.5) return this.coverage(p, dt);
        if (p.crossT == null) p.crossT = this.t;
      }
      const late = this.scramble && p.assign.t === 'man' ? (1 - looking(p, carrier.x, carrier.y)) * 0.7 : 0;
      const since = this.scramble && p.crossT != null ? this.t - p.crossT : this.t - this.runT;
      // (one who's been watching the ball in the air saw the catch)
      const sawIt = this.receiver && p.seeBall != null && this.runT - this.ball.t0 > p.seeBall;
      const knows = (p.readsRun && !this.receiver) || sawIt || since > (this.receiver || this.interceptor ? p.ballReact : p.readDelay + late);
      if (knows || p.assign.t === 'rush' || p.assign.t === 'blitz' || dist(p.x, p.y, carrier.x, carrier.y) < 4) {
        if (p.edge && !this.receiver && !this.interceptor && this.setEdge(p, dt, carrier)) return;
        // gap discipline: a lineman against a designed run plays it from the
        // line (a yard deep at most) until the back's on him, rather than
        // running himself out of the play in the backfield
        if ((p.pos === 'DL' || (p.edge && p.assign.t === 'rush')) && this.offPlay.cat === 'run' && !this.receiver && !this.interceptor && carrier.y < 0 && dist(p.x, p.y, carrier.x, carrier.y) > 3.2) {
          // (the end man stays outside the tackle while he does)
          if (p.edge && (carrier.x - this.ballX) * p.edge > -1) return this.steer(p, this.ballX + p.edge * Math.max(4.6, (carrier.x - this.ballX) * p.edge + 1.2), -0.3, 0.8, dt, 0.4);
          return this.pursue(p, dt, carrier, -0.5);
        }
        // the end man squeezing a run his way does it on the line, not in
        // the backfield (he spills the back outside)
        if (p.edge && p.assign.t === 'rush' && this.offPlay.cat === 'run' && !this.receiver && !this.interceptor && carrier.y < -0.5 && (carrier.x - this.ballX) * p.edge > 0) {
          return this.pursue(p, dt, carrier, -0.4);
        }
        // a linebacker fits his gap and waits for the back to come to him
        // rather than running through the line
        if (p.pos === 'LB' && p.assign.t !== 'blitz' && p.assign.t !== 'rush' && this.offPlay.cat === 'run' && !this.receiver && !this.interceptor && carrier.y < 0.3 && p.y > 1) {
          return this.pursue(p, dt, carrier, 2.6);
        }
        return this.pursue(p, dt, carrier);
      }
      return this.coverage(p, dt);
    }
    // a linebacker who's read run fills before the handoff, flowing to the
    // back (fit: the run-commit call's own fill)
    if (p.readsRun && this.phase === 'pre' && p.assign.t !== 'rush' && p.assign.t !== 'blitz' && this.t > 0.3 + p.readDelay * 0.8) {
      // he flows with the back's first steps (a counter step fools him for
      // a moment) to meet him at the line, scraping over the top with some
      // depth when the run's going wide, rather than chasing him into the
      // backfield
      const rb = this.offense.find((o) => o.job.t === 'carry');
      if (rb && rb !== this.qb) {
        const fx = clamp(rb.x + rb.vx * 0.8, 1, FIELD_W - 1);
        const wide = Math.abs(fx - p.x) > 3;
        const fitY = p.pos === 'S' ? 5.5 : wide ? 3.6 : 3.2;
        return this.steer(p, fx + Math.sign(p.x - fx) * (p.pos === 'S' ? 1.5 : 0.6), Math.min(p.y, fitY), wide || p.pos === 'S' ? 0.95 : 0.75, dt, 0.5);
      }
    }
    if (this.phase === 'air') {
      const b = this.ball;
      // a defender with his back to the quarterback finds the ball late
      if (p.seeBall == null) p.seeBall = p.ballReact + (1 - looking(p, b.fx, b.fy)) * 0.5;
      if (this.t - b.t0 > p.seeBall && (p.assign.t !== 'rush' && p.assign.t !== 'blitz' || p.y > 2)) {
        const tLeft = b.t0 + b.T - this.t;
        const d = dist(p.x, p.y, b.tx, b.ty);
        const drive = 1.5 + (p.a.zcv + p.a.mcv) / 500;
        if (d / p.maxSpd < tLeft + 1.2) return this.steer(p, b.tx, b.ty, 1, dt, 0.2, drive);
        if (b.target) return this.steer(p, b.tx, b.ty + 1, 1, dt, 0.5, drive);
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
    // a lineman who's read run block (the line fired out at him) attacks
    // his gap but stays at the line, a yard in
    if ((p.pos === 'DL' || p.edge) && this.offPlay.cat === 'run' && !this.isDraw && this.t > 0.3 && p.assign.t === 'rush') {
      // the end man keeps his outside leverage; an inside man works
      // toward the back
      if (p.edge) return this.steer(p, p.sx + p.edge * 0.4, -0.6, 0.7, dt, 0.5);
      const rb = this.offense.find((o) => o.job.t === 'carry') || qb;
      return this.steer(p, rb.x + (p.x - rb.x) * 0.5, -0.9, 0.7, dt, 0.5);
    }
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

  // The end man on the side the run is going: keep the runner inside him
  // (outside leverage) until he's turned upfield past the line. Returns
  // false when there's no edge to set.
  setEdge(p, dt, c) {
    const side = p.edge;
    if (c.y > 1.5 || (c.x - this.ballX) * side < 1 || p.stunT > 0) return false;
    // already outside him and level: squeeze down on him
    const ox = c.x + side * 1.1 + c.vx * 0.25;
    if ((p.x - ox) * side > -0.3 && Math.abs(p.y - c.y) < 1.5) return false;
    this.steer(p, ox, Math.max(c.y + 0.8, -1), 1, dt, 0);
    return true;
  },

  pursue(p, dt, c, minY = -99) {
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
    // a defender in front of a runner comes downhill to meet him rather
    // than waiting for him deep
    T = Math.min(T, this.offPlay.cat === 'run' && !this.receiver && !this.interceptor && c.side === 'O' && p.y > c.y + 3 ? 1.0 : 1.8);
    const tx = c.x + c.vx * T * 0.92;
    const ty = Math.max(minY, c.y + c.vy * T * 0.92);
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
    const lag = clamp(0.36 - p.a.mcv * 0.0026, 0.1, 0.34);
    const k = Math.round(lag / DT);
    const idx = ((r.hi - k) % HIST + HIST) % HIST;
    const lvx = r.hist[idx * 2];
    const lvy = r.hist[idx * 2 + 1];
    // he stays on top of him by his cushion (an off corner gives it up as
    // the route comes on) and steers by where the receiver was heading a
    // moment ago: a cut leaves him going the old way for that moment
    const startCush = p.assign.press ? 1.0 : Math.max(1.5, p.sy - r.sy - 1);
    const cushion = Math.max(1.4, startCush - this.t * 3.5);
    const inward = r.x > this.ballX ? -1 : 1;
    const tx = r.x + lvx * 0.15 + inward * 0.5;
    const ty = r.y + lvy * 0.15 + cushion;
    // reading the receiver's hips: when he sits down or comes back, a good
    // man defender plants and drives on it
    let drive = 1.2 + p.a.mcv / 250;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 2 && (p.vx * (tx - p.x) + p.vy * (ty - p.y)) < 0) drive *= 1.3 + p.a.mcv / 300;
    this.steer(p, tx, ty, 1, dt, 0.3, drive);
  },

  zoneCover(p, dt) {
    const z = p.assign.zone || { x: p.sx, y: p.sy + 4, rx: 5, ry: 4 };
    // a zone defender plays with his eyes on the passer (src/sim/playsim.js
    // integrate turns him to face him while he's not flat out running)
    if (this.phase === 'pre' && this.ball.holder === this.qb) p.eyesAt = this.t;
    let thr = null;
    let best = -1e9;
    let second = null;
    for (const r of this.eligible) {
      if (r.down || !r.released) continue;
      const nx = (r.x - z.x) / (z.rx * 1.35);
      const ny = (r.y - z.y) / (z.ry * 1.35);
      const inside = nx * nx + ny * ny;
      if (z.deep) {
        if (inside > 1.6 || r.y < z.y - z.ry * 1.2) continue;
        if (r.y > best) { second = thr; best = r.y; thr = r; } else if (!second || r.y > second.y) second = r;
      } else if (inside < 1) {
        const s = -inside;
        if (s > best) { best = s; thr = r; }
      }
    }
    const qb = this.qb;
    if (z.deep && thr) {
      // keep everything in front: deeper than the deepest man in his zone
      // (by more the faster he's coming), never coming up while someone's
      // still running at him; two going deep, he splits them and breaks
      // when the ball goes
      let x = thr.x + (this.ballX - thr.x) * 0.06;
      if (second && second.y > z.y - z.ry * 0.5 && Math.abs(second.x - thr.x) < z.rx * 1.6) x = thr.x * 0.6 + second.x * 0.4;
      let y = Math.max(thr.y + 2.8 + Math.max(0, thr.vy) * 0.45, z.y - z.ry * 0.4);
      if (thr.vy > 2 && thr.y > p.y - 12) y = Math.max(y, p.y);
      // he pedals, reading the passer, until the man's eating up his
      // cushion; then he turns and runs
      const pedal = this.phase === 'pre' && p.y - thr.y > 6 + Math.max(0, thr.vy) * 0.6;
      return this.steer(p, x, y, pedal ? 0.62 : 1, dt, 0.4);
    }
    if (!thr) {
      // nobody in his zone: carry a receiver running up through it (sink
      // under a vertical, wall off a seam) until he's someone else's
      const vert = this.verticalThrough(z);
      if (vert) {
        const inward = vert.x > this.ballX ? -1 : 1;
        return this.steer(p, clamp(vert.x + inward * 1.0, z.x - z.rx * 1.5, z.x + z.rx * 1.5), clamp(vert.y - 1.5, z.y, z.y + z.ry + 5), 0.95, dt, 0.4);
      }
      let tx = z.x + (qb.x - z.x) * 0.15;
      let ty = z.y;
      const look = this.passerLook();
      if (look) {
        const nx = (look.x - z.x) / (z.rx * 1.35);
        const ny = (look.y - z.y) / (z.ry * 1.35);
        if (nx * nx + ny * ny < 2.4) {
          const w = 0.35 * clamp((p.a.zcv + p.a.awr) / 200, 0.3, 1);
          tx += (look.x - tx) * w;
          ty += (look.y - ty) * w;
        }
      }
      const spd = this.t < 1.2 ? 0.85 : 0.6;
      return this.steer(p, tx, ty, spd, dt, 1);
    }
    // a man in his zone: on top of him and inside, giving ground to one
    // running at him rather than coming up to meet him
    const inward = thr.x > this.ballX ? -1 : 1;
    let ty = clamp(thr.y + 0.6, z.y - z.ry * 0.5, z.y + z.ry * 1.4);
    if (thr.vy > 3) ty = Math.max(thr.y + 1.5, p.y);
    let tx = clamp(thr.x + inward * 0.7, z.x - z.rx * 1.4, z.x + z.rx * 1.4);
    // eyes on the quarterback: he drifts toward the man the passer's
    // looking at, if that's someone near his zone
    const look = this.passerLook();
    if (look && look !== thr) {
      const nx = (look.x - z.x) / (z.rx * 1.35);
      const ny = (look.y - z.y) / (z.ry * 1.35);
      if (nx * nx + ny * ny < 2.4) {
        const w = 0.4 * clamp((p.a.zcv + p.a.awr) / 200, 0.3, 1);
        tx += (look.x - tx) * w;
        ty += (look.y + 0.5 - ty) * w;
      }
    }
    return this.steer(p, tx, ty, 0.95, dt, 0.4);
  },

  // The receiver the quarterback's eyes are on (his current read), once
  // he's set to throw.
  passerLook() {
    const qb = this.qb;
    if (!qb || qb.qbState !== 'set' || this.ball.holder !== qb || !qb.read) return null;
    return this.progression[qb.read.i] || null;
  },

  // A receiver going vertical up through this underneath zone's lane, past
  // it but not yet deep (the one an underneath defender carries).
  verticalThrough(z) {
    let best = null;
    let bd = 1e9;
    for (const r of this.eligible) {
      if (r.down || !r.released || r.vy < 3) continue;
      const lat = Math.abs(r.x - z.x);
      if (lat > z.rx * 1.3 || r.y < z.y || r.y > z.y + z.ry + 8) continue;
      if (lat < bd) { bd = lat; best = r; }
    }
    return best;
  },

};
