// Offensive players in the play sim, mixed into PlaySim: routes, pass
// protection, run blocking, escorting the ball carrier, the handoff and
// pitch, and the ball carrier's running (finding the lane, cutting, the
// moves in src/sim/contact.js). No DOM; seeded RNG only.

import { FIELD_W, clamp, dist } from '../core/util.js';

const LOOKS = [[1.5, 1.4], [3.5, 1.0], [6, 0.6]];

export const offenseMethods = {
  offThink(p, dt) {
    const carrier = this.carrier;
    if (this.phase === 'run' && carrier) {
      if (carrier.side === 'O') {
        if (p.job.t === 'passpro' && p.target && this.t - this.runT < 0.6 && !this.scramble) return this.passPro(p, dt);
        return this.escort(p, dt, carrier);
      }
      return this.pursue(p, dt, carrier); // turnover: offense chases
    }
    if (this.phase === 'air') {
      if (p === this.ball.target) return this.trackBall(p, dt);
      if (p.pts && p.released) return this.runRoute(p, dt);
      if (p.job.t === 'passpro' || p.job.t === 'chkrel') return this.passPro(p, dt);
      return this.brake(p, dt, 6);
    }
    // pre-snap-to-handoff / pass in pocket
    switch (p.job.t) {
      case 'pass': return this.qbPass(p, dt);
      case 'handoff': return this.qbHandoff(p, dt);
      case 'kneel':
        if (this.t > 0.45) this.endPlay('kneel', { spotY: -1, spotX: this.ballX });
        return this.steer(p, p.sx, p.sy - 0.6, 0.3, dt, 0.3);
      case 'spike':
        if (this.t > 0.55) this.endPlay('spike', { spotY: 0, spotX: this.ballX });
        return this.brake(p, dt, 8);
      case 'carry': return this.followPath(p, dt, this.preHandoffSpeed(p));
      case 'route': return this.runRoute(p, dt);
      case 'chkrel':
        if (!p.released && this.t > 1.5 && !this.blitzThreat(p)) p.released = true;
        return p.released ? this.runRoute(p, dt) : this.passPro(p, dt);
      case 'pafake':
        if (this.t < 0.9) return this.followPath(p, dt, 0.8);
        return this.passPro(p, dt);
      case 'passpro': return this.passPro(p, dt);
      case 'draw':
        return this.passPro(p, dt);
      case 'screenOL':
        if (this.t < 1.0) return this.passPro(p, dt);
        return this.releaseScreen(p, dt);
      case 'pull':
        if (p.wp < p.pts.length) return this.followPath(p, dt, 0.92);
        return this.runBlock(p, dt);
      case 'lead':
        if (p.wp < p.pts.length && this.t < 1.6) return this.followPath(p, dt, 0.95);
        return this.runBlock(p, dt);
      case 'zone':
      case 'stalk':
      default:
        return this.runBlock(p, dt);
    }
  },

  // ---------------------------------------------------------------- offense behaviors
  preHandoffSpeed(p) {
    if (p.job.self) return 0.9;
    if (p.job.handT >= 0.9) return this.t < p.job.handT - 0.25 ? 0 : 0.85;
    return 0.85;
  },

  followPath(p, dt, frac) {
    if (!p.pts || p.wp >= p.pts.length) return this.brake(p, dt, 6);
    const tp = p.pts[p.wp];
    if (frac <= 0) return this.brake(p, dt, 8);
    this.steer(p, tp.x, tp.y, frac, dt, 0);
    if (dist(p.x, p.y, tp.x, tp.y) < 0.6) p.wp++;
  },

  runRoute(p, dt) {
    if (p.jamT > 0) return this.steer(p, p.x, p.y + 1, 0.25, dt, 0);
    const pts = p.pts;
    if (p.wp < pts.length) {
      const tp = pts[p.wp];
      this.steer(p, tp.x, tp.y, 0.96, dt, 0);
      if (dist(p.x, p.y, tp.x, tp.y) < 0.7) {
        p.wp++;
        // cut: lose some speed depending on route running
        const keep = 0.45 + p.a.rte / 240;
        if (p.wp < pts.length || p.routeEnd === 'sit') { p.vx *= keep; p.vy *= keep; }
      }
      return;
    }
    if (p.routeEnd === 'sit') {
      // settle; drift away from the closest defender a little
      const def = this.nearest(this.defense, p.x, p.y);
      let tx = pts[pts.length - 1].x;
      let ty = pts[pts.length - 1].y;
      if (def && dist(def.x, def.y, p.x, p.y) < 3) {
        tx += clamp(p.x - def.x, -1, 1) * 1.2;
        ty += clamp(p.y - def.y, -1, 0.5) * 0.6;
      }
      return this.steer(p, clamp(tx, 1, FIELD_W - 1), ty, 0.5, dt, 0.8);
    }
    // continue in last direction
    const a = pts.length > 1 ? pts[pts.length - 2] : { x: p.sx, y: p.sy };
    const b = pts[pts.length - 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const m = Math.hypot(dx, dy) || 1;
    let tx = p.x + (dx / m) * 10;
    const ty = p.y + (dy / m) * 10;
    if (tx < 1.2 || tx > FIELD_W - 1.2) {
      tx = clamp(tx, 1.2, FIELD_W - 1.2);
      return this.steer(p, tx, p.y + 10, 0.96, dt, 0);
    }
    this.steer(p, tx, ty, 0.96, dt, 0);
  },

  blitzThreat(p) {
    for (const d of this.defense) {
      if (d.blk || d.down) continue;
      if ((d.assign.t === 'blitz' || d.assign.t === 'rush') && d.y < 2.5 && dist(d.x, d.y, this.qb.x, this.qb.y) < 7) {
        let blocked = false;
        for (const o of this.offense) if (o !== p && o.target === d) blocked = true;
        if (!blocked) return true;
      }
    }
    return false;
  },

  passPro(p, dt) {
    if (p.stunT > 0) return this.brake(p, dt, 6);
    p.retarget -= dt;
    let tgt = p.target;
    const qb = this.qb;
    const want = this.drawnTarget(p);
    if (want && !(this.t > 0.6 && want.y > 4 && want.vy > 0)) tgt = p.target = want;
    if (tgt && (tgt.down || (tgt.blk && tgt.blk.b !== p) || (this.t > 0.6 && tgt.y > 4 && tgt.vy > 0))) tgt = p.target = null;
    if (!tgt && p.retarget <= 0) {
      p.retarget = 0.15;
      let best = null;
      let bd = 1e9;
      for (const d of this.defense) {
        if (d.down || d.blk || d.freeT > 0.3) continue;
        if (d.y > 4.5) continue;
        if (this.t > 0.3 && d.vy > 1.5) continue; // dropping into coverage
        let taken = false;
        for (const o of this.offense) if (o !== p && o.target === d) taken = true;
        if (taken && p.pos !== 'OL') continue;
        const lat = Math.abs(d.x - p.x);
        const range = p.pos === 'OL' ? 3.6 : 6;
        if (lat > range) continue;
        const c = lat + Math.abs(d.y - p.y) * 0.5 + (taken ? 3 : 0);
        if (c < bd) { bd = c; best = d; }
      }
      tgt = p.target = best;
    }
    if (tgt) {
      const dx = qb.x - tgt.x;
      const dy = qb.y - tgt.y;
      const m = Math.hypot(dx, dy) || 1;
      const ix = tgt.x + (dx / m) * 1.0;
      const iy = tgt.y + (dy / m) * 1.0;
      return this.steer(p, ix, Math.min(iy, p.sy + 0.4), 0.82, dt, 0.25);
    }
    // nobody to block: hold the pocket
    return this.steer(p, p.sx + (qb.x - this.ballX) * 0.5, Math.max(p.sy - 1.8, qb.y + 2), 0.4, dt, 0.5);
  },

  releaseScreen(p, dt) {
    const dir = p.job.dir || 1;
    if (!p.target || p.target.down) {
      const rb = this.bySlot.RB;
      let best = null;
      let bd = 1e9;
      for (const d of this.defense) {
        if (d.down || d.blk) continue;
        const dd = dist(d.x, d.y, rb.x + dir * 2, rb.y + 4);
        if (dd < bd) { bd = dd; best = d; }
      }
      p.target = best;
    }
    if (this.phase === 'run') return this.escort(p, dt, this.carrier);
    return this.steer(p, clamp(p.sx + dir * 6, 1, FIELD_W - 1), 2.5, 0.8, dt, 0.5);
  },

  runBlock(p, dt) {
    if (p.stunT > 0) return this.brake(p, dt, 6);
    const aim = this.runAim();
    if (p.job.t === 'stalk' && this.t < 0.5) return this.steer(p, p.x, p.sy + 2, 0.6, dt, 0.3);
    p.retarget -= dt;
    let tgt = p.target;
    const want = this.drawnTarget(p);
    if (want) tgt = p.target = want;
    if (tgt && (tgt.down || (tgt.blk && tgt.blk.b !== p))) tgt = p.target = null;
    if (!tgt && p.retarget <= 0) {
      p.retarget = 0.2;
      tgt = p.target = this.pickRunTarget(p, aim);
    }
    if (tgt) {
      const dx = aim.x - tgt.x;
      const dy = aim.y - tgt.y;
      const m = Math.hypot(dx, dy) || 1;
      return this.steer(p, tgt.x + (dx / m) * 0.9, tgt.y + (dy / m) * 0.9, 0.95, dt, 0.2);
    }
    const dir = p.job.dir || 0;
    return this.steer(p, p.x + dir * 1.5, p.y + 2, 0.6, dt, 0.5);
  },

  // The defender the coach drew this blocker onto, while he's still blockable.
  drawnTarget(p) {
    const t = p.job.target && this.defBySlot[p.job.target];
    if (!t || t.down || (t.blk && t.blk.b !== p)) return null;
    return t;
  },

  runAim() {
    const c = this.carrier || this.bySlot.RB || this.qb;
    if (this.carrier) return { x: c.x, y: c.y };
    const rb = this.offense.find((p) => p.job.t === 'carry');
    if (rb && rb.pts) {
      const hole = rb.pts.find((pt) => pt.y > -1.5) || rb.pts[rb.pts.length - 1];
      return { x: hole.x, y: hole.y };
    }
    return { x: this.ballX, y: 0 };
  },

  pickRunTarget(p, aim) {
    const dir = p.job.dir || 0;
    let best = null;
    let bd = 1e9;
    const level2 = this.t > 0.35;
    for (const d of this.defense) {
      if (d.down) continue;
      if (d.blk && d.blk.b !== p) continue;
      let taken = 0;
      for (const o of this.offense) if (o !== p && o.target === d) taken++;
      if (taken >= 1) continue;
      const lat = d.x - p.x;
      const depth = d.y - p.y;
      if (depth < -2 || depth > (p.pos === 'WR' ? 14 : level2 ? 9 : 4)) continue;
      if (p.pos === 'OL' && Math.abs(lat) > 4.5) continue;
      let c = Math.abs(lat) + depth * 0.55;
      if (dir && lat * dir < -0.8) c += 2.2; // prefer playside
      c += dist(d.x, d.y, aim.x, aim.y) * 0.15;
      if (c < bd) { bd = c; best = d; }
    }
    return best;
  },

  escort(p, dt, carrier) {
    if (p.stunT > 0) return this.brake(p, dt, 6);
    const g = carrier.side === 'O' ? 1 : -1;
    const foes = carrier.side === 'O' ? this.defense : this.offense;
    p.retarget -= dt;
    if (!p.target || p.target.down || (p.target.blk && p.target.blk.b !== p) || p.retarget <= 0) {
      p.retarget = 0.25;
      let best = null;
      let bd = 1e9;
      for (const d of foes) {
        if (d.down || d.blk || d === carrier) continue;
        const ahead = (d.y - carrier.y) * g;
        if (ahead < -1.5) continue;
        const dd = dist(d.x, d.y, p.x, p.y);
        if (dd > 5 || dist(d.x, d.y, carrier.x, carrier.y) > 7) continue;
        const c = dd + dist(d.x, d.y, carrier.x, carrier.y) * 0.7;
        if (c < bd) { bd = c; best = d; }
      }
      p.target = best;
    }
    const tgt = p.target;
    if (tgt) {
      const dx = carrier.x - tgt.x;
      const dy = carrier.y - tgt.y;
      const m = Math.hypot(dx, dy) || 1;
      return this.steer(p, tgt.x + (dx / m) * 0.8, tgt.y + (dy / m) * 0.8, 0.95, dt, 0.2);
    }
    return this.steer(p, carrier.x + (p.x - carrier.x) * 0.5, carrier.y + g * 3, 0.7, dt, 1);
  },

  qbHandoff(p, dt) {
    const j = p.job;
    const rb = this.offense.find((o) => o.job.t === 'carry');
    if (!rb) return this.brake(p, dt, 6);
    if (this.ball.holder !== p || this.ball.state !== 'held') {
      // after handoff: carry out the fake
      const away = (this.offPlay.dir || 1) * -1;
      return this.steer(p, this.ballX + away * 4, p.y - 0.5, this.t - (this.runT || 0) < 0.9 ? 0.7 : 0.1, dt, 0.5);
    }
    if (j.pitch) {
      if (this.t > 0.28) this.pitchTo(p, rb);
      return this.brake(p, dt, 6);
    }
    if (j.fakeDrop && this.t < rb.job.handT - 0.15) return this.steer(p, this.ballX, p.sy - 2.2, 0.6, dt, 0.4);
    // meet the back
    const tgt = rb.pts[0];
    const mx = (tgt.x + p.x) / 2;
    this.steer(p, mx, Math.min(p.y, tgt.y + 0.6), 0.7, dt, 0.3);
    if ((this.t > 0.22 && dist(p.x, p.y, rb.x, rb.y) < 1.1) || this.t > rb.job.handT + 0.5) this.handTo(rb);
  },

  handTo(rb) {
    this.ball.state = 'held';
    this.ball.holder = rb;
    this.carrier = rb;
    this.phase = 'run';
    this.runT = this.t;
    this.rusher = rb;
    this.events.push({ t: this.t, k: 'handoff', who: rb });
  },

  pitchTo(qb, rb) {
    const b = this.ball;
    const lead = 0.38;
    b.state = 'pitch';
    b.holder = null;
    b.fx = qb.x; b.fy = qb.y;
    b.tx = rb.x + rb.vx * lead; b.ty = rb.y + rb.vy * lead;
    b.t0 = this.t; b.T = lead; b.peak = 0.25; b.target = rb;
    this.runT = this.t;
  },

  completePitch() {
    const rb = this.ball.target;
    this.ball.target = null;
    if (this.rng.chance(0.006)) return this.fumble(rb, 'muffed pitch');
    this.handTo(rb);
  },

  // ---------------------------------------------------------------- carrier
  carrierThink(p, dt) {
    // Designed run path before the line.
    if (p.job && p.job.t === 'carry' && p.pts && p.wp < p.pts.length && !this.turnover) {
      const tp = p.pts[p.wp];
      let clogged = false;
      for (const d of this.defense) {
        if (d.down || d.blk) continue;
        if (dist(d.x, d.y, tp.x, tp.y) < 1.5) { clogged = true; break; }
      }
      if (!clogged) {
        this.steer(p, tp.x, tp.y, 1, dt, 0);
        if (dist(p.x, p.y, tp.x, tp.y) < 0.8) p.wp++;
        return;
      }
      p.wp = p.pts.length;
    }
    if (this.qbSlide(p)) return;
    this.freeRun(p, dt);
  },

  qbSlide(p) {
    if (p !== this.qb || !this.scramble || p.y < 1) return false;
    const foe = this.nearestFree(this.defense, p.x, p.y);
    if (foe && dist(foe.x, foe.y, p.x, p.y) < 1.6 && this.rng.chance(0.5)) {
      this.endPlay('tackle', { spotY: p.y, spotX: p.x, slide: true });
      return true;
    }
    return false;
  },

  freeRun(p, dt) {
    const g = p.side === 'O' ? 1 : -1;
    const foes = p.side === 'O' ? this.defense : this.offense;
    const base = g > 0 ? Math.PI / 2 : -Math.PI / 2;
    const cur = Math.atan2(p.vy, p.vx);
    const wantOOB = this.opts.wantOOB && p.side === 'O';
    let bestA = base;
    let bestS = -1e9;
    for (let k = -4; k <= 4; k++) {
      const ang = base + k * (Math.PI / 9);
      const cx = Math.cos(ang);
      const cy = Math.sin(ang);
      let s = Math.sin(ang) * g * 1.2;
      for (const [look, w] of LOOKS) {
        const px = p.x + cx * look;
        const py = p.y + cy * look;
        if (px < 0.7 || px > FIELD_W - 0.7) {
          s += wantOOB ? 0.4 : -2.5;
          break;
        }
        const tCar = look / p.maxSpd;
        let minM = 3;
        for (const o of foes) {
          if (o.down || o.stumbleT > 0.15) continue;
          const tO = (dist(o.x, o.y, px, py) - 1.0) / o.maxSpd + (o.blk ? 0.8 : 0);
          const m = tO - tCar;
          if (m < minM) minM = m;
        }
        s += clamp(minM, -1.5, 1.2) * w;
      }
      if (p.vx * p.vx + p.vy * p.vy > 4) s += Math.cos(ang - cur) * 0.35;
      if (s > bestS) { bestS = s; bestA = ang; }
    }
    const turn = Math.abs(Math.atan2(Math.sin(bestA - cur), Math.cos(bestA - cur)));
    const cutPenalty = turn > 0.8 ? 0.82 + p.a.agi / 600 : 1;
    if (p.secureT > 0) p.secureT -= dt;
    this.carrierSteer(p, bestA, cutPenalty * 0.9 * (p.secureT > 0 ? 0.55 : 1), dt);
    this.carrierMoves(p, foes);
  },

};
