// Contact between the ball carrier and the defense, mixed into PlaySim.
//
//   - Moves before contact: juke, spin, stiff arm.
//   - Broken tackles show as a move: truck, stiff arm, spin, shed, hurdle.
//   - Made tackles play out over a few frames instead of ending on touch:
//     wrap-up, drag (runner falls forward for extra yards and can still slip
//     out), big hit (knocked back; ball spotted at forward progress), ankle
//     trip, gang tackle, sideline push-out, sack.
//   - Knocked-down players get back up and rejoin the play.
//   - After the whistle: players ease to a stop, pile on and celebrate.
//
// The odds of making or missing a tackle are the original contact model, so
// league averages stay in range; what's new is how each outcome plays out.
// No DOM here, and every random draw comes from the sim's seeded RNG.

import { FIELD_W, clamp, dist } from '../core/util.js';
import { tackleOdds, fumbleOdds } from './odds.js';

const MOVE_T = { juke: 0.34, spin: 0.42, stiff: 0.45, truck: 0.34, hurdle: 0.5, shrug: 0.3 };
const MOVE_BOOST = 1.3; // how often carriers try a move before contact

export const contactMethods = {
  // ---------------------------------------------------------------- helpers
  startMove(p, k, on, dir = 0, from = null) {
    p.move = { k, t: 0, T: MOVE_T[k], on, dir };
    this.events.push({ t: this.t, k, who: p, on, x: p.x, y: p.y, from });
  },

  tickMove(p, dt) {
    if (p.diveT > 0) p.diveT -= dt;
    if (!p.move) return;
    p.move.t += dt;
    if (p.move.t >= p.move.T) p.move = null;
  },

  moveSpeed(p) {
    const k = p.move && p.move.k;
    if (k === 'spin') return 0.74;
    if (k === 'stiff') return 0.9;
    if (k === 'truck') return 0.82;
    if (k === 'shrug') return 0.86;
    return 1;
  },

  knockDown(p, upT, vx = 0, vy = 0) {
    if (p.blk) this.breakBlock(p.blk);
    p.down = true;
    p.downT = 0;
    p.upT = upT;
    p.fallAt = this.clock();
    p.fellBack = false;
    p.vx = vx;
    p.vy = vy;
    if (Math.hypot(vx, vy) > 0.2) p.face = Math.atan2(vy, vx);
    p.move = null;
    this.events.push({ t: this.t, k: 'fall', who: p, x: p.x, y: p.y });
  },

  // Returns true while the player is still on the ground.
  stayDown(p, dt) {
    p.downT += dt;
    if (p.upT > 0 && p.downT >= p.upT) {
      p.down = false;
      p.upT = 0;
      p.stumbleT = 0.12;
      p.upAt = this.clock();
      return false;
    }
    this.brake(p, dt, 14);
    return true;
  },

  // ---------------------------------------------------------------- carrier
  // Steering for the runner in open field, including the cut of a juke.
  carrierSteer(p, ang, frac, dt) {
    const m = p.move;
    if (m && m.k === 'juke' && m.t < 0.22) {
      const g = p.side === 'O' ? 1 : -1;
      const tx = p.x + m.dir * 4;
      const ty = p.y + g * 2.2;
      const dx = tx - p.x;
      const dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      this.accelTo(p, (dx / d) * p.maxSpd, (dy / d) * p.maxSpd, dt, p.accel * 1.9);
      return;
    }
    this.steer(p, p.x + Math.cos(ang) * 5, p.y + Math.sin(ang) * 5, frac * this.moveSpeed(p), dt, 0);
  },

  // A move on a defender closing in front, before he gets a hand on him.
  carrierMoves(p, foes) {
    if (p.moveCD > 0 || p.move) return;
    const g = p.side === 'O' ? 1 : -1;
    for (const o of foes) {
      if (o.down || o.blk || o.stumbleT > 0 || o.wrapOn) continue;
      const dx = o.x - p.x;
      const dy = o.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 1.9 || d < 0.6) continue;
      if (dy * g < -0.3) continue;
      const pMove = (0.02 + ((p.a.elu + p.a.agi) / 200 - 0.55) * 0.5 - (o.a.awr - 65) / 500) * MOVE_BOOST;
      if (!this.rng.chance(pMove)) {
        p.moveCD = 0.7;
        return;
      }
      const lateral = Math.abs(dx) / d;
      const k = this.rng.weighted(
        [['juke', p.a.elu + p.a.agi * 0.5], ['spin', p.a.agi * 0.45], ['stiff', lateral > 0.55 ? Math.max(0, p.a.str - 45) * 1.6 : 0]],
        (x) => x[1],
      )[0];
      const dir = Math.abs(dx) < 0.3 ? (p.x < FIELD_W / 2 ? 1 : -1) : dx > 0 ? -1 : 1;
      p.juke = 0.35;
      p.moveCD = 1.1;
      this.startMove(p, k, o, dir);
      if (k === 'juke') {
        // he bit on the fake; sometimes his ankles go with it
        if (this.rng.chance(0.3)) this.knockDown(o, 0.85, o.vx * 0.4, o.vy * 0.4);
        else o.stumbleT = 0.6;
      } else if (k === 'spin') {
        o.stumbleT = 0.55;
      } else {
        const shove = 2.4 + (p.a.str - o.a.str) / 30;
        if (this.rng.chance(clamp(0.35 + (p.a.str - o.a.str) / 80, 0.15, 0.75))) this.knockDown(o, 1.0, (dx / d) * shove, (dy / d) * shove);
        else {
          o.stumbleT = 0.7;
          o.vx = (dx / d) * shove;
          o.vy = (dy / d) * shove;
        }
      }
      return;
    }
  },

  // ---------------------------------------------------------------- tackles
  checkTackles(dt) {
    const h = this.ball.holder;
    if (!h || this.ball.state !== 'held' || this.wrap) return;
    const foes = h.side === 'O' ? this.defense : this.offense;
    if (h.down) {
      // on the turf after a dive: a touch ends it (down by contact)
      for (const d of foes) {
        if (d.down || dist(d.x, d.y, h.x, h.y) > 1.2) continue;
        this.tackler = d;
        this.events.push({ t: this.t, k: 'tackle', who: d, on: h, kind: 'touch', gain: 0, v0: 0 });
        this.endPlay('tackle', { spotY: h.y, spotX: h.x });
        return;
      }
      return;
    }
    for (const d of foes) {
      if (d.down || d.stumbleT > 0 || d.tackleCD > 0 || d.wrapOn) continue;
      const dd = dist(d.x, d.y, h.x, h.y);
      if (dd > (d.blk ? 0.85 : 1.2)) {
        if (!d.blk && dd < 2.1 && (h.side !== 'O' || h.y > 1.5) && this.rng.chance(dt * 3.5)) {
          const closing = ((h.x - d.x) * (d.vx - h.vx) + (h.y - d.y) * (d.vy - h.vy)) / dd;
          if (closing > 0.3 && this.tryDive(d, h)) return;
        }
        continue;
      }
      if (d.blk && !this.rng.chance(0.35)) {
        d.tackleCD = 0.5;
        continue;
      }
      if (this.tryTackle(d, h)) return;
    }
  },

  tryTackle(d, h) {
    const o = tackleOdds(this, d, h);
    if (this.rng.chance(o.p)) {
      const n = 1 + (o.help > 0.6 ? 1 : 0);
      if (this.rng.chance(fumbleOdds(h, d, n, null, o.sack))) {
        this.fumble(h, o.sack ? 'strip sack' : 'fumble', d);
        return true;
      }
      if (d.blk) this.breakBlock(d.blk);
      this.startWrap(d, h, o.sack ? 'sack' : null, o);
      return true;
    }
    this.brokenTackle(d, h, o.sack);
    return false;
  },

  // He got a hand on him and didn't bring him down: show how.
  brokenTackle(d, h, sack) {
    d.tackleCD = 0.6;
    const dx = d.x - h.x;
    const dy = d.y - h.y;
    const dd = Math.hypot(dx, dy) || 1;
    const sp = Math.hypot(h.vx, h.vy);
    const front = sp > 0.5 ? (dx * h.vx + dy * h.vy) / (dd * sp) : 0;
    const side = sp > 0.5 ? Math.abs(dx * h.vy - dy * h.vx) / (dd * sp) : 0;
    const power = h.pos === 'RB' || h.pos === 'TE' || h.pos === 'QB' ? 1 : 0.5;
    const k = sack
      ? 'shrug'
      : this.rng.weighted(
        [
          ['truck', front > 0.5 ? Math.max(0, h.a.str - 55) * 2 * power : 0],
          ['stiff', side > 0.45 ? Math.max(0, h.a.str - 40) : 0],
          ['spin', h.a.agi * 0.35],
          ['shrug', 40],
        ],
        (x) => x[1],
      )[0];
    if (k === 'truck') {
      const ux = sp > 0.5 ? h.vx / sp : 0;
      const uy = sp > 0.5 ? h.vy / sp : h.side === 'O' ? 1 : -1;
      this.knockDown(d, 1.3, ux * 2.6, uy * 2.6);
      h.vx *= 0.66;
      h.vy *= 0.66;
    } else if (k === 'stiff') {
      if (this.rng.chance(0.55)) this.knockDown(d, 1.0, (dx / dd) * 3, (dy / dd) * 3);
      else {
        d.stumbleT = 0.6;
        d.vx = (dx / dd) * 2.5;
        d.vy = (dy / dd) * 2.5;
      }
      h.vx *= 0.86;
      h.vy *= 0.86;
    } else if (k === 'spin') {
      d.stumbleT = 0.5;
      h.juke = 0.3;
      h.vx *= 0.8;
      h.vy *= 0.8;
    } else {
      d.stumbleT = 0.5;
      h.vx *= 0.78;
      h.vy *= 0.78;
    }
    this.startMove(h, k, d, 0, 'tackle');
    this.events.push({ t: this.t, k: 'broken', who: h, on: d });
  },

  tryDive(d, h) {
    const p = clamp(0.48 + (d.a.tkl - 65) / 200 - (h.a.elu - 70) / 300 - (h.juke > 0 ? 0.2 : 0), 0.15, 0.75);
    d.diveT = 0.3;
    if (this.rng.chance(p)) {
      if (d.blk) this.breakBlock(d.blk);
      this.startWrap(d, h, 'trip');
      return true;
    }
    // missed: he's on the ground; a nimble runner may go right over him
    this.knockDown(d, 1.0, d.vx * 0.35, d.vy * 0.35);
    d.diveT = 0.3;
    d.tackleCD = 1.0;
    const g = h.side === 'O' ? 1 : -1;
    if (!h.move && (d.y - h.y) * g > 0.2 && this.rng.chance(clamp((h.a.agi - 60) / 80, 0.05, 0.45))) this.startMove(h, 'hurdle', d);
    this.events.push({ t: this.t, k: 'broken', who: h, on: d, dive: true });
    return false;
  },

  // A made tackle. The runner keeps fighting for a moment before he's down.
  startWrap(d, h, forced, odds = null) {
    const rng = this.rng;
    const g = h.side === 'O' ? 1 : -1;
    const sp = Math.hypot(h.vx, h.vy);
    const dx = h.x - d.x;
    const dy = h.y - d.y;
    const dd = Math.hypot(dx, dy) || 1;
    const closing = ((d.vx - h.vx) * dx + (d.vy - h.vy) * dy) / dd;
    let kind = forced || 'wrap';
    if (!forced) {
      const nearSide = h.x < 2.4 || h.x > FIELD_W - 2.4;
      const inside = Math.abs(d.x - FIELD_W / 2) < Math.abs(h.x - FIELD_W / 2);
      const behind = odds && odds.ahead < -0.35;
      if (nearSide && inside && rng.chance(0.55)) kind = 'pushout';
      else if (behind) kind = rng.chance(0.4) ? 'trip' : 'drag'; // caught from behind: ankles, or dragged down falling forward
      else if (closing > 6 && rng.chance(clamp(0.2 + (d.a.str - 70) / 150 + (d.a.tkl - 70) / 200, 0.05, 0.45))) kind = 'hit';
      else if (sp > 3 && h.a.str * 0.6 + h.a.car * 0.4 - (d.a.tkl * 0.7 + d.a.str * 0.3) + rng.normal(0, 12) > 2) kind = 'drag';
    }
    const w = { h, ds: [d], kind, t: 0, T: 0.28, g, y0: h.y, v0: Math.hypot(h.vx, h.vy), progY: h.y, fwd: 0.22, vx: 0, vy: 0, breakP: 0, rolled: false };
    if (kind === 'sack') {
      w.T = 0.32 + rng.next() * 0.12;
      w.vx = d.vx * 0.12;
      w.vy = d.vy * 0.12;
    } else if (kind === 'wrap') {
      w.T = 0.22 + rng.next() * 0.14;
      w.fwd = 0.12;
      h.vx *= 0.35;
      h.vy *= 0.35;
    } else if (kind === 'drag') {
      w.T = 0.45 + rng.next() * 0.35;
      w.fwd = 0.22;
      w.breakP = clamp(0.06 + (h.a.str - d.a.tkl) / 250, 0.02, 0.16);
      h.vx *= 0.5;
      h.vy *= 0.5;
    } else if (kind === 'hit') {
      w.T = 0.2;
      h.vx = (dx / dd) * 3.2;
      h.vy = (dy / dd) * 3.2;
    } else if (kind === 'trip') {
      w.T = 0.14;
      w.fwd = 0.3;
      h.vx *= 0.4;
      h.vy *= 0.4;
    } else if (kind === 'pushout') {
      w.T = 0.7;
      w.vx = (h.x < FIELD_W / 2 ? -1 : 1) * 4.5;
      w.vy = h.vy * 0.4;
    }
    d.wrapOn = h;
    h.move = null;
    this.wrap = w;
    this.events.push({ t: this.t, k: 'contact', kind, who: d, on: h, x: (h.x + d.x) / 2, y: (h.y + d.y) / 2 });
  },

  updateWrap(dt) {
    const w = this.wrap;
    if (!w || this.done) return;
    const h = w.h;
    w.t += dt;
    // gang tackle: anyone else arriving grabs on and ends it sooner
    if (w.kind !== 'pushout') {
      const foes = h.side === 'O' ? this.defense : this.offense;
      for (const o of foes) {
        if (o.wrapOn || o.down || o.blk || o.stumbleT > 0) continue;
        if (dist(o.x, o.y, h.x, h.y) < 1.1) {
          o.wrapOn = h;
          w.ds.push(o);
          w.T = Math.min(w.T, w.t + 0.2);
          w.breakP = 0;
          if (w.ds.length === 2) this.events.push({ t: this.t, k: 'contact', kind: 'gang', who: o, on: h, x: h.x, y: h.y });
        }
      }
    }
    const u = clamp(w.t / w.T, 0, 1);
    if (w.kind === 'hit') this.brake(h, dt, 7);
    else if (w.kind === 'sack' || w.kind === 'pushout') this.accelTo(h, w.vx, w.vy, dt, 18);
    else {
      // fighting forward, mostly straight up the field
      const s = h.maxSpd * w.fwd * (1 - 0.6 * u);
      const lat = clamp(h.vx / (Math.abs(h.vy) + 1), -0.6, 0.6);
      const n = Math.hypot(lat, 1);
      this.accelTo(h, (lat / n) * s, (w.g / n) * s, dt, 16);
    }
    // a strong runner can still slip out of a lone drag tackle
    if (w.breakP > 0 && !w.rolled && w.t > 0.35) {
      w.rolled = true;
      if (this.rng.chance(w.breakP)) {
        const d = w.ds[0];
        this.wrap = null;
        d.wrapOn = null;
        d.tackleCD = 1.0;
        this.knockDown(d, 1.0, -d.vx * 0.2, -d.vy * 0.2);
        h.vx = 0;
        h.vy = w.g * h.maxSpd * 0.55;
        this.startMove(h, 'shrug', d, 0, 'drag');
        this.events.push({ t: this.t, k: 'broken', who: h, on: d });
        return;
      }
    }
    // tacklers hang on
    const k = Math.min(1, dt * 10);
    for (const d of w.ds) {
      d.vx = h.vx;
      d.vy = h.vy;
      const ox = d.x - h.x;
      const oy = d.y - h.y;
      const od = Math.hypot(ox, oy) || 1;
      const want = od + (0.5 - od) * k;
      d.x = h.x + (ox / od) * want;
      d.y = h.y + (oy / od) * want;
    }
    if ((h.y - w.progY) * w.g > 0) w.progY = h.y;
    if (w.t >= w.T) this.finishWrap();
  },

  finishWrap() {
    const w = this.wrap;
    this.wrap = null;
    const h = w.h;
    const sack = w.kind === 'sack';
    const d0 = w.ds[0];
    this.tackler = d0;
    const foes = h.side === 'O' ? this.defense : this.offense;
    this.assist = w.ds[1] || foes.find((o) => o !== d0 && !o.down && dist(o.x, o.y, h.x, h.y) < 1.7) || null;
    for (const d of w.ds) {
      d.wrapOn = null;
      if (this.rng.chance(w.kind === 'hit' || w.kind === 'trip' ? 0.85 : 0.6)) {
        d.down = true;
        d.upT = 0;
        d.fallAt = this.clock();
        d.face = Math.atan2(h.y - d.y, h.x - d.x);
      }
      d.vx *= 0.3;
      d.vy *= 0.3;
    }
    h.down = true;
    h.upT = 0;
    h.move = null;
    h.fallAt = this.clock();
    // he goes down the way he was going (a big hit puts him on his back)
    h.fellBack = w.kind === 'hit';
    const hs = Math.hypot(h.vx, h.vy);
    h.face = w.kind === 'hit' ? Math.atan2(-(h.y - d0.y), -(h.x - d0.x)) : hs > 0.5 ? Math.atan2(h.vy, h.vx) : w.g > 0 ? Math.PI / 2 : -Math.PI / 2;
    // spot: where he went down, or his forward progress if he was driven back
    let spotY = h.y + (w.kind === 'hit' || sack ? 0 : 0.2 * w.g);
    if ((w.progY - spotY) * w.g > 0) spotY = w.progY; // forward progress (sacks too)
    this.onTackle(w);
    this.events.push({ t: this.t, k: sack ? 'sack' : 'tackle', who: d0, on: h, kind: w.kind, gain: (spotY - w.y0) * w.g, v0: w.v0 });
    this.endPlay(sack ? 'sack' : 'tackle', { spotY, spotX: h.x });
  },

  // ---------------------------------------------------------------- whistle
  // After the play: everyone eases to a stop, a few pile on, scorers
  // celebrate. Visual only (the result is final) and uses no RNG, so it
  // can run at any frame rate without changing anything.
  settle(dt) {
    if (!this.done) return;
    const r = this.result;
    const h = this.ball.holder;
    if (!this.post) {
      this.post = { t: 0 };
      if (h && r && (r.outcome === 'tackle' || r.outcome === 'sack')) {
        this.players.forEach((o, i) => {
          if (o === h || o.down || o.side === h.side) return;
          if (dist(o.x, o.y, h.x, h.y) < 1.8 && (i * 7 + Math.floor(o.x * 10)) % 3 !== 0) {
            o.down = true;
            o.upT = 0;
            o.fallAt = this.clock();
            o.face = Math.atan2(h.y - o.y, h.x - o.x);
          }
        });
      }
    }
    this.post.t += dt;
    this.spikeBall(dt);
    if (this.crew) this.crew.update(dt);
    for (const p of this.players) {
      if (p.down) {
        if (p.upT > 0) {
          p.downT += dt;
          if (p.downT >= p.upT) { p.down = false; p.upAt = this.clock(); }
        }
        this.brake(p, dt, 14);
      } else if (p.celeb) this.celebMove(p, dt);
      else this.brake(p, dt, 6.5);
      this.tickMove(p, dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.anim += Math.hypot(p.vx, p.vy) * dt * 2.2;
    }
  },
};
