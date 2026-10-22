// The ball arriving, mixed into PlaySim: the intended receiver running
// under it (and laying out), then catch, drop, breakup or interception,
// decided from everyone around the ball by src/sim/odds.js. No DOM; every
// random draw comes from the sim's seeded RNG.

import { FIELD_W, clamp, dist } from '../core/util.js';
import { catchOdds, missCause, interceptOdds, strayIntOdds } from './odds.js';

export const catchingMethods = {
  // The intended receiver while the ball is in the air: run under it, and
  // lay out for it if he can't get there on his feet.
  trackBall(p, dt) {
    const b = this.ball;
    const tLeft = b.t0 + b.T - this.t;
    // until he's picked up the flight of the ball he runs to where it was
    // meant to go (his route); then he adjusts to where it's really going,
    // so a throw that's off is harder to get to the later he sees it
    const read = this.t - b.t0 > 0.18 + (100 - p.a.cth) / 400 || b.ax == null;
    const gx = read ? b.tx : b.ax;
    const gy = read ? b.ty : b.ay;
    const d = dist(p.x, p.y, gx, gy);
    if (read && !p.diving && tLeft < 0.34 && tLeft > 0.05) {
      // he can't get there on his feet: he lays out for it
      const short = d - Math.max(Math.hypot(p.vx, p.vy), p.maxSpd * 0.85) * tLeft;
      if (short > 0.75 && short < 3.1) {
        p.diving = { t0: this.t };
        const v = Math.max(Math.hypot(p.vx, p.vy), Math.min(9, (d - 0.4) / tLeft));
        p.vx = ((b.tx - p.x) / (d || 1)) * v;
        p.vy = ((b.ty - p.y) / (d || 1)) * v;
      }
    }
    if (p.diving) return this.brake(p, dt, 3);
    // he times his run to get there with the ball: a ball thrown ahead of
    // him he catches in stride, one he'd get to early he settles under
    const need = d / Math.max(tLeft, 0.05);
    return this.steer(p, gx, gy, clamp((need * 1.08) / p.maxSpd, 0.3, 1), dt, 0.4);
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
    r.secureT = 0.25;
    r.vx *= 0.82;
    r.vy *= 0.82;
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
