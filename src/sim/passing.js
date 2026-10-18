// The passing game, mixed into PlaySim: the quarterback's drop, reads and
// decision, the throw (aimed away from the closest defender, with an error
// that grows with distance, pressure, throwing on the move or across his
// body, or getting hit as he lets go), and what happens when the ball gets
// there (src/sim/odds.js decides catch, drop, breakup or interception from
// everyone around the ball).
//
// With opts.manualPass (the optional Retro Bowl-style control) the
// quarterback still drops and moves in the pocket, but he doesn't read or
// throw on his own: the player aims a spot with userThrow(x, y) and the ball
// goes there, with the passer's own error on top.
//
// No DOM here; every random draw comes from the sim's seeded RNG.

import { FIELD_W, clamp, dist } from '../core/util.js';
import { catchOdds, missCause, interceptOdds, strayIntOdds, pocketPressure, throwError, looking } from './odds.js';

export const passingMethods = {
  ballSpeed(qb) {
    return 15.5 + qb.a.thp * 0.11;
  },

  qbPass(p, dt) {
    if (this.ball.holder !== p) {
      if (this.ball.state === 'snap') return this.brake(p, dt, 4);
      return this.brake(p, dt, 5);
    }
    const play = this.offPlay;
    if (p.qbState === undefined) {
      const gun = p.sy < -2.5;
      const drop = play.drop || 5;
      p.dropY = gun ? p.sy - (drop === 3 ? 0.6 : drop === 5 ? 1.8 : 2.8) : -(drop === 3 ? 4.2 : drop === 5 ? 6.6 : 8.2);
      p.qbState = play.pa ? 'fake' : 'drop';
      p.decT = 0;
    }
    // Wind-up: the ball isn't out yet, so the QB can still be hit. (A
    // player aiming his own throws can let it go during the drop.)
    if (p.pending) {
      if (this.t >= p.pending.at) {
        const pd = p.pending;
        p.pending = null;
        if (pd.away) this.throwAwayNow(p);
        else if (pd.aim) this.throwAt(p, pd.aim);
        else this.throwNow(p, pd.r);
      }
      return this.brake(p, dt, 8);
    }
    if (p.qbState === 'fake') {
      const rb = this.bySlot.RB;
      this.steer(p, (p.x + rb.x) / 2, p.y - 0.3, 0.5, dt, 0.3);
      if (this.t > 0.65) p.qbState = 'drop';
      return;
    }
    if (p.qbState === 'drop') {
      this.steer(p, this.ballX, p.dropY, 0.8, dt, 0.4);
      if (Math.abs(p.y - p.dropY) < 0.35) {
        p.qbState = 'set';
        p.setT = this.t;
      }
      return;
    }
    // Set in the pocket: read and decide.
    const tSet = this.t - p.setT;
    const pressure = this.pressureOn(p);
    // a free rusher about to get him: he may dump it rather than eat it
    if (!p.dumpTried && tSet > 0.6 && !this.opts.manualPass) {
      const f = this.nearestFree(this.defense, p.x, p.y);
      if (f && dist(f.x, f.y, p.x, p.y) < 2.4 && f.y < p.y + 3) {
        p.dumpTried = true;
        if (this.rng.chance(0.28 + p.a.dec / 450)) {
          p.pending = { away: true, at: this.t + 0.05 };
          return;
        }
      }
    }
    // pocket movement: slide away from the nearest free rusher
    const threat = this.nearestFree(this.defense, p.x, p.y);
    let mx = this.ballX;
    let my = p.dropY + Math.min(1.2, tSet * 0.6);
    if (threat && dist(threat.x, threat.y, p.x, p.y) < 4) {
      mx = p.x + clamp(p.x - threat.x, -1.5, 1.5) * 1.2;
      my = p.y + clamp(p.y - threat.y, -1, 1);
    }
    this.steer(p, clamp(mx, this.ballX - 5, this.ballX + 5), Math.min(my, -1.2), 0.45, dt, 0.4);

    // the player throws it (userThrow); if he never does, the passer gets
    // rid of it eventually
    if (this.opts.manualPass) {
      if (tSet > 7) this.throwAway(p);
      return;
    }
    if (play.screen) {
      if (this.t >= play.screen) this.throwTo(p, this.bySlot.RB, pressure);
      return;
    }
    if (play.hailMary) {
      if (tSet > 2.0 || pressure > 0.8) {
        let deep = null;
        for (const r of this.progression) if (!deep || r.y > deep.y) deep = r;
        this.throwTo(p, deep, pressure + 0.6);
      }
      return;
    }

    // Reads: he works through the progression; anyone he has already looked
    // at is still an option if he comes open. He takes the throw that's
    // worth the most among those he trusts to be caught, and trusts less
    // as the clock in his head runs and the pocket closes.
    const readDur = 0.45 + (100 - p.a.dec) / 260;
    const idx = Math.min(this.progression.length - 1, Math.floor(tSet / readDur));
    // Under fire with nobody clearly open, he may escape first: a mobile
    // passer takes off through a lane, a smart one throws it away rather
    // than take the sack (decided a few times a second).
    p.escT = (p.escT ?? 0) - dt;
    let escape = false;
    if ((pressure > 0.45 || tSet > 0.7) && p.escT <= 0) {
      p.escT = 0.2;
      escape = true;
    }
    if (tSet > 0.12) {
      const base = play.depth === 'short' ? 0.74 : play.depth === 'deep' ? 0.84 : 0.8;
      const need = base - Math.max(0, tSet - 1.5) * 0.12 - pressure * 0.3;
      let best = null;
      let bv = -1e9;
      let bpe = 0;
      for (let i = 0; i < this.progression.length; i++) {
        const r = this.progression[i];
        // short options underneath stay in his vision while he reads, but
        // he only takes the checkdown once the downfield reads have had
        // time, or when he's under fire
        const checkdown = r.y < 7 && r.pts && r.pts[r.pts.length - 1].y < 8;
        if (i > idx && !(checkdown && (tSet > 1.25 + (100 - p.a.dec) / 200 || pressure > 0.45))) continue;
        const o = this.openness(p, r);
        if (o < -50) continue;
        const pe = 1 / (1 + Math.exp(-(o - 1.0) / 0.55));
        if (pe < need) continue;
        const v = pe * (Math.min(Math.max(r.y, 0), 25) * 0.55 + 7) - (1 - pe) * 4 - i * 0.3;
        if (v > bv) { bv = v; best = r; bpe = pe; }
      }
      if (escape && (!best || bpe < 0.72) && this.escape(p, pressure, tSet)) return;
      if (best) return this.throwTo(p, best, pressure);
    } else if (escape && this.escape(p, pressure, tSet)) return;
    p.decT -= dt;
    if (p.decT > 0) return;
    p.decT = 0.22;
    if (pressure > 0.45 || tSet > 2.2) {
      let best = null;
      let bo = -99;
      for (const r of this.progression) {
        const o = this.openness(p, r) + r.y * 0.02;
        if (o > bo) { bo = o; best = r; }
      }
      if (best && bo > (tSet > 3.4 ? 0.6 : 1.0)) return this.throwTo(p, best, pressure);
      // nothing there and the play's breaking down
      if (tSet > 3.6 && this.rng.chance(0.45)) return this.throwAway(p);
      if (this.rng.chance(0.25)) this.escape(p, pressure, tSet);
    }
  },

  // Take off, or throw it away. Returns true if he did either.
  escape(p, pressure, tSet) {
    const mob = clamp((p.a.spd - 55) / 35, 0, 1);
    // the pocket's collapsing, or the coverage has everyone blanketed
    const scr = pressure > 0.45 ? 0.08 + 0.35 * mob : 0.05 + 0.3 * mob;
    const free = this.nearestFree(this.defense, p.x, p.y);
    const room = !free || dist(free.x, free.y, p.x, p.y) > 2.4; // nobody about to grab him
    if (room && this.rng.chance(scr) && this.laneOpen(p, 7)) { this.startScramble(p); return true; }
    if (pressure > 0.5 && tSet > 0.9 && this.rng.chance(0.2 + p.a.dec / 500)) { this.throwAway(p); return true; }
    return false;
  },

  pressureOn(qb) {
    let m = 9;
    for (const d of this.defense) {
      if (d.down) continue;
      const dd = dist(d.x, d.y, qb.x, qb.y) - (d.blk ? 1.4 : 0);
      if (dd < m) m = dd;
    }
    return clamp((3.2 - m) / 2.2, 0, 1);
  },

  laneOpen(qb, depth = 5) {
    // Any of three lanes (middle, left, right) free of unblocked defenders
    // for `depth` yards.
    for (const lx of [0, -4, 4]) {
      let open = true;
      for (const d of this.defense) {
        if (d.down || d.blk) continue;
        if (d.y > qb.y - 1 && d.y < qb.y + depth && Math.abs(d.x - (qb.x + lx)) < 2.2) { open = false; break; }
      }
      if (open) return true;
    }
    return false;
  },

  // Where the receiver will be when the ball gets there: the passer throws
  // to the spot on the route, not just ahead of where he's running now.
  leadPoint(qb, r) {
    const spd = this.ballSpeed(qb);
    let T = 0;
    let P = { x: r.x, y: r.y };
    for (let i = 0; i < 3; i++) {
      const d = dist(qb.x, qb.y, P.x, P.y);
      T = d / spd + 0.12 + (d > 25 ? (d - 25) * 0.012 : 0);
      P = this.routeAhead(r, T);
    }
    return { x: clamp(P.x, 0.8, FIELD_W - 0.8), y: Math.min(P.y, this.goalY + 8), T };
  },

  routeAhead(r, T) {
    const pts = r.pts;
    const sp = Math.max(Math.hypot(r.vx, r.vy), r.maxSpd * 0.85);
    if (!pts || r.wp >= pts.length) {
      const settle = r.routeEnd === 'sit' && pts && r.wp >= pts.length;
      return settle ? { x: r.x, y: r.y } : { x: r.x + r.vx * T, y: r.y + r.vy * T };
    }
    let x = r.x;
    let y = r.y;
    let left = sp * T;
    let i = r.wp;
    let dx = 0;
    let dy = 1;
    while (left > 0 && i < pts.length) {
      const seg = dist(x, y, pts[i].x, pts[i].y);
      dx = (pts[i].x - x) / (seg || 1);
      dy = (pts[i].y - y) / (seg || 1);
      if (seg >= left) return { x: x + dx * left, y: y + dy * left };
      x = pts[i].x; y = pts[i].y; left -= seg; i++;
    }
    if (r.routeEnd === 'sit') return { x, y };
    return { x: x + dx * left, y: y + dy * left };
  },

  openness(qb, r) {
    if (!r || r.down || !r.released || r.blk) return -99;
    if (r.jamT > 0) return -5;
    // timing: he throws on (or after) the receiver's last break, not into
    // the stem where a defender can sit on the route
    if (r.pts && r.pts.length > 1 && r.wp < r.pts.length - 1 && !this.offPlay.screen) return -5;
    const L = this.leadPoint(qb, r);
    if (L.y < qb.y - 1 && !this.offPlay.screen) return -5;
    let o = 99;
    for (const d of this.defense) {
      if (d.down || d.blk) continue;
      // where he can get to by the time the ball does: a defender with his
      // back to the quarterback reacts late
      const react = d.ballReact + (1 - looking(d, qb.x, qb.y)) * 0.5;
      const dd = dist(d.x, d.y, L.x, L.y) - d.maxSpd * Math.max(0, L.T - react) * 0.85 - 0.6;
      if (dd < o) o = dd;
      // underneath defender in the throwing lane
      const lx = L.x - qb.x;
      const ly = L.y - qb.y;
      const len2 = lx * lx + ly * ly || 1;
      const u = ((d.x - qb.x) * lx + (d.y - qb.y) * ly) / len2;
      if (u > 0.15 && u < 0.6) {
        const px = qb.x + lx * u;
        const py = qb.y + ly * u;
        if (dist(px, py, d.x, d.y) < 1.1) o -= 1.4;
      }
    }
    return o - Math.max(0, L.y - 10) * 0.09;
  },

  throwTo(qb, r, pressure) {
    if (qb.pending) return;
    qb.pending = { r, at: this.t + 0.1 + (100 - qb.a.dec) / 600 + pressure * 0.04 };
  },

  throwAway(qb) {
    if (qb.pending) return;
    qb.pending = { away: true, at: this.t + 0.14 };
  },

  // The player's throw (manual passing): aim at a spot. Returns false if
  // the ball can't be thrown now (not his yet, already gone, the play's over).
  userThrow(x, y) {
    const qb = this.qb;
    if (!this.opts.manualPass || this.done || this.phase !== 'pre' || !qb || this.ball.holder !== qb) return false;
    if (qb.pending || qb.qbState === undefined || qb.qbState === 'fake') return false;
    qb.pending = { aim: { x, y }, at: this.t + 0.08 };
    return true;
  },

  // Can the player throw right now? (for the aiming UI)
  canUserThrow() {
    const qb = this.qb;
    return !!(this.opts.manualPass && !this.done && this.phase === 'pre' && qb && this.ball.holder === qb && !qb.pending && qb.qbState && qb.qbState !== 'fake' && !this.scramble);
  },

  // The farthest he can put it in the air.
  maxThrow(qb = this.qb) {
    return 42 + (qb ? qb.a.thp : 80) * 0.2;
  },

  // A throw to a spot: whoever will be nearest it when the ball gets there
  // goes for it.
  throwAt(qb, aim) {
    const spd = this.ballSpeed(qb);
    const d0 = dist(qb.x, qb.y, aim.x, aim.y);
    const T = d0 / spd + 0.12 + (d0 > 25 ? (d0 - 25) * 0.012 : 0);
    let r = null;
    let rd = 5;
    for (const o of this.offense) {
      if (o.down || o.blk || (o.pos !== 'WR' && o.pos !== 'TE' && o.pos !== 'RB')) continue;
      const P = o.pts ? this.routeAhead(o, T) : { x: o.x + o.vx * T, y: o.y + o.vy * T };
      const dd = dist(P.x, P.y, aim.x, aim.y);
      if (dd < rd) { rd = dd; r = o; }
    }
    return this.throwNow(qb, r, { x: aim.x, y: aim.y, T });
  },

  throwNow(qb, r, aimed = null) {
    if (!r && !aimed) return this.throwAwayNow(qb);
    const L = aimed || this.leadPoint(qb, r);
    const d = dist(qb.x, qb.y, L.x, L.y);
    // a good passer puts it on the receiver's far side from the closest
    // defender (back shoulder, low and away)
    const cover = aimed ? null : this.nearestFree(this.defense, L.x, L.y);
    if (cover) {
      const cd = dist(cover.x, cover.y, L.x, L.y);
      if (cd < 2.6) {
        const k = (0.2 + qb.a.tha * 0.0035) * (2.6 - cd) / 2.6;
        L.x += ((L.x - cover.x) / (cd || 1)) * k;
        L.y += ((L.y - cover.y) / (cd || 1)) * k * 0.7;
      }
    }
    // how rushed, on the move, across his body, hit as he throws
    const press = pocketPressure(this, qb, L.x, L.y);
    const sp = Math.hypot(qb.vx, qb.vy);
    const moving = clamp(sp / 5, 0, 1);
    const across = sp > 1.5 && Math.sign(qb.vx) !== Math.sign(L.x - qb.x) && Math.abs(L.x - qb.x) > 4 ? clamp(Math.abs(qb.vx) / 4, 0, 1) : 0;
    let hit = press.blind > 0.55;
    for (const o of this.defense) if (!o.down && !o.blk && dist(o.x, o.y, qb.x, qb.y) < 0.95) hit = true;
    const err = throwError(qb, d, press, moving, across, hit);
    if (this.offPlay.hailMary) { err.sideSd += 1.6; err.depthSd += 1.8; }
    const ux = (L.x - qb.x) / (d || 1);
    const uy = (L.y - qb.y) / (d || 1);
    const es = this.rng.normal(0, err.sideSd);
    const ed = this.rng.normal(0, err.depthSd);
    const tx = L.x + ux * ed - uy * es;
    const ty = L.y + uy * ed + ux * es;
    const b = this.ball;
    const speed = this.ballSpeed(qb) * (hit ? 0.72 : 1);
    b.state = 'air';
    b.holder = null;
    b.fx = qb.x; b.fy = qb.y;
    b.tx = tx; b.ty = ty;
    b.tz = clamp(1.4 + this.rng.normal(0, err.heightSd) + (hit ? 0.5 : 0), 0.25, 3.4);
    b.t0 = this.t;
    b.speed = speed;
    b.T = Math.max(0.25, dist(qb.x, qb.y, tx, ty) / speed + 0.08 + (d > 25 ? (d - 25) * 0.012 : 0));
    b.peak = 0.6 + d * 0.1 + (hit ? 1.2 : 0);
    b.wobble = hit;
    b.target = r;
    this.phase = 'air';
    this.passer = qb;
    this.airYards = ty;
    this.throwInfo = { press: press.hurry, hit, moving, across };
    this.events.push({ t: this.t, k: 'throw', who: qb, to: r, hit });
  },

  throwAwayNow(qb) {
    const side = qb.x < this.ballX ? -1 : 1;
    const b = this.ball;
    b.state = 'air';
    b.holder = null;
    b.fx = qb.x; b.fy = qb.y;
    b.tx = side < 0 ? -3 : FIELD_W + 3;
    b.ty = Math.max(qb.y + 6, 2);
    b.tz = 0.4;
    b.t0 = this.t;
    b.speed = this.ballSpeed(qb);
    b.T = dist(qb.x, qb.y, b.tx, b.ty) / b.speed + 0.1;
    b.peak = 2.5;
    b.target = null;
    b.away = true;
    this.phase = 'air';
    this.passer = qb;
    this.events.push({ t: this.t, k: 'throwaway', who: qb });
  },

  startScramble(qb) {
    this.scramble = true;
    this.carrier = qb;
    this.phase = 'run';
    this.runT = this.t;
    this.rusher = qb;
    this.events.push({ t: this.t, k: 'scramble', who: qb });
  },

  // The intended receiver while the ball is in the air: run under it, and
  // lay out for it if he can't get there on his feet.
  trackBall(p, dt) {
    const b = this.ball;
    const tLeft = b.t0 + b.T - this.t;
    if (!p.diving && tLeft < 0.34 && tLeft > 0.05) {
      const gap = dist(p.x + p.vx * tLeft, p.y + p.vy * tLeft, b.tx, b.ty);
      if (gap > 1.05 && gap < 3.4) {
        p.diving = { t0: this.t };
        const d = dist(p.x, p.y, b.tx, b.ty) || 1;
        const v = Math.max(Math.hypot(p.vx, p.vy), Math.min(9, (d - 0.4) / tLeft));
        p.vx = ((b.tx - p.x) / d) * v;
        p.vy = ((b.ty - p.y) / d) * v;
      }
    }
    if (p.diving) return this.brake(p, dt, 3);
    return this.steer(p, b.tx, b.ty, 1, dt, 0.4);
  },

  // ---------------------------------------------------------------- catch
  resolveCatch() {
    const b = this.ball;
    const L = { x: b.tx, y: b.ty };
    this.phase = 'resolving';
    if (b.away || L.x < -0.4 || L.x > FIELD_W + 0.4 || L.y > this.goalY + 10) {
      return this.incomplete(b.away ? 'thrown away' : 'out of bounds', null);
    }
    let r = null;
    let rd = 1e9;
    for (const o of this.offense) {
      if (o.down || (o.pos !== 'WR' && o.pos !== 'TE' && o.pos !== 'RB')) continue;
      let dd = dist(o.x, o.y, L.x, L.y);
      if (o === b.target) dd -= 0.3;
      if (dd < rd) { rd = dd; r = o; }
    }
    const ball = { x: L.x, y: L.y, z: b.tz ?? 1.3, fx: b.fx, fy: b.fy, t0: b.t0, speed: b.speed || 20 };
    if (!r || dist(r.x, r.y, L.x, L.y) > 3.2) {
      // nobody near it: a defender under it may still come down with it
      if (this.strayPick(ball)) return;
      return this.incomplete(L.y > (b.target ? b.target.y : 0) ? 'overthrown' : 'incomplete', null);
    }
    if (!b.target) b.target = r; // a throw to a spot: he's the one who went for it
    const odds = catchOdds(this, r, ball);
    let sep = 99;
    for (const d of this.defense) if (!d.down && !d.blk) sep = Math.min(sep, dist(d.x, d.y, L.x, L.y));
    const info = { who: r, t: this.t, bx: L.x, by: L.y, bz: ball.z, reach: odds.reach, shoulder: odds.shoulder, p: odds.p, sep, place: odds.place, keep: odds.keep };
    this.catchInfo = info;
    if (L.x < 0 || L.x > FIELD_W) {
      // on the sideline: he needs a foot down in bounds (a close call for
      // the officials either way: src/game/replay.js)
      this.sidelineTry = true;
      if (!this.rng.chance(0.35 + r.a.cth * 0.003) || r.x < 0.2 || r.x > FIELD_W - 0.2) {
        info.kind = 'miss';
        return this.incomplete('out of bounds', null);
      }
    }
    if (this.rng.chance(odds.p)) {
      info.kind = 'catch';
      this.notePushOff?.(odds, r, info);
      return this.catchBy(r, L);
    }
    const why = missCause(odds, this.rng.next());
    if (why.cause === 'foe') {
      const f = why.foe;
      if (f.dd > 1.0) f.d.diveT = 0.3;
      if (this.rng.chance(interceptOdds(f, odds.place, odds.reach))) {
        info.kind = 'int';
        info.foe = f.d;
        return this.intercept(f.d);
      }
      info.kind = 'pbu';
      info.foe = f.d;
      // tipped up in the air: whoever is closest might come down with it
      if (this.rng.chance(0.07)) {
        let best = null;
        let bd = 3;
        for (const o of this.players) {
          if (o === f.d || o.down || o.blk || (o.side === 'O' && o.pos !== 'WR' && o.pos !== 'TE' && o.pos !== 'RB')) continue;
          const od = dist(o.x, o.y, L.x, L.y);
          if (od < bd) { bd = od; best = o; }
        }
        if (best && this.rng.chance(0.45)) {
          info.kind = best.side === 'D' ? 'int' : 'catch';
          info.tip = true;
          if (best.side === 'D') return this.intercept(best);
          return this.catchBy(best, L);
        }
      }
      this.noteCoverage?.(f, r, info);
      return this.incomplete(f.front > -0.2 || f.look > 0.5 ? 'broken up' : 'contested', f.d);
    }
    if (why.cause === 'place') {
      info.kind = 'miss';
      if (this.strayPick(ball)) return;
      const along = (L.x - r.x) * r.vx + (L.y - r.y) * r.vy;
      return this.incomplete(along > 0.4 || ball.z > 2.3 ? 'overthrown' : 'incomplete', null);
    }
    info.kind = 'drop';
    return this.incomplete('dropped', null);
  },

  strayPick(ball) {
    for (const d of this.defense) {
      if (d.down || d.blk) continue;
      if (this.rng.chance(strayIntOdds(d, ball, ball.fx, ball.fy))) {
        this.catchInfo = { who: d, t: this.t, bx: ball.x, by: ball.y, bz: ball.z, reach: dist(d.x, d.y, ball.x, ball.y), kind: 'int', foe: d };
        this.intercept(d);
        return true;
      }
    }
    return false;
  },

  catchBy(r, L) {
    r.x = L.x * 0.25 + r.x * 0.75;
    r.y = L.y * 0.25 + r.y * 0.75;
    this.ball.state = 'held';
    this.ball.holder = r;
    this.ball.target = null;
    this.carrier = r;
    this.phase = 'run';
    this.runT = this.t;
    this.receiver = r;
    this.catchY = r.y;
    r.moveCD = 0.6;
    r.secureT = 0.35;
    r.vx *= 0.7;
    r.vy *= 0.7;
    if (r.diving) this.layOut(r);
    this.events.push({ t: this.t, k: 'catch', who: r });
    for (const p of this.offense) if (p !== r) p.target = null;
  },

  // A diving player lands on the turf. Untouched, he gets up and keeps
  // going; a defender touching him there ends the play (down by contact).
  layOut(p) {
    p.diving = null;
    this.knockDown(p, 0.75, p.vx * 0.3, p.vy * 0.3);
  },

  intercept(d) {
    this.ball.state = 'held';
    this.ball.holder = d;
    this.ball.target = null;
    this.carrier = d;
    this.phase = 'run';
    this.runT = this.t;
    this.turnover = true;
    this.interceptor = d;
    this.events.push({ t: this.t, k: 'int', who: d });
    for (const p of this.players) { p.target = null; if (p.blk) this.breakBlock(p.blk); }
    if (d.diveT > 0) this.layOut(d);
    if (d.y >= this.goalY + 1.5) this.endPlay('touchback', { spotY: this.goalY, spotX: d.x });
  },

  incomplete(why, def) {
    const r = this.ball.target;
    if (r && r.diving) this.layOut(r);
    if (def && def.diveT > 0 && !def.down) this.knockDown(def, 0.8, def.vx * 0.3, def.vy * 0.3);
    this.events.push({ t: this.t, k: 'incomplete', why, def });
    this.endPlay('incomplete', { spotY: 0, spotX: this.ballX, why, defender: def });
  },
};
