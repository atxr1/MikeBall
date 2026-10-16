// After-the-whistle celebrations, mixed into PlaySim. Visual only: the play
// result is final by the time these run, and nothing here touches the sim's
// RNG (choices come from a hash of the player and the play), so they can't
// change a game.
//
// The coach screen calls sim.celebrate({kind, ...}) once when the play ends:
//   td       scorer celebrates (spike, dance, point to the crowd, flex,
//            Mile High Salute, Lambeau Leap), teammates run in and jump
//            with him, the other team hangs its heads
//   first    ball carrier pops up and signals first down
//   big      long gain: carrier flexes, then signals
//   sack     the sacker dances, teammates come over
//   int      interceptor celebrates, teammates mob him
//   takeaway fumble recovered by the defense

import { dist } from '../core/util.js';

const TD_STYLES = ['spike', 'dance', 'arms', 'point', 'flex', 'spike', 'dance'];

function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const celebrateMethods = {
  // info: { kind, leap (Lambeau), salute (Broncos), who (entity, optional) }
  celebrate(info) {
    if (!this.done || this.celebration) return;
    this.celebration = info;
    const r = this.result || {};
    const seed = hash(`${r.offPlay}|${Math.round(this.t * 60)}|${info.kind}`);
    const who = info.who || this.ball.holder;
    if (!who) return;
    const mates = this.players.filter((o) => o.side === who.side && o !== who);
    const foes = this.players.filter((o) => o.side !== who.side);
    const g = who.side === 'O' ? 1 : -1;
    const set = (p, k, t0, extra = {}) => { p.celeb = { k, t0, ...extra }; };
    // anyone on the ground who's celebrating gets up first
    const rise = (p, at) => {
      if (p.down) {
        p.upT = Math.max(p.downT + 0.05, at);
        p.downT = Math.min(p.downT, at);
      }
    };

    if (info.kind === 'td') {
      let style = TD_STYLES[seed % TD_STYLES.length];
      if (info.salute) style = 'salute';
      if (info.leap) style = 'leap';
      rise(who, 0.2);
      if (style === 'leap') {
        // run to the wall behind the end zone and jump into the crowd
        const wallY = (g > 0 ? this.goalY : this.ownGoalY) + g * 16.6;
        set(who, 'leap', 0.1, { tx: Math.min(Math.max(who.x, 14), 39), ty: wallY, spd: 6.5 });
      } else if (style === 'spike') {
        set(who, 'spike', 0.1);
        const b = this.ball;
        b.state = 'spike';
        b.holder = null;
        b.x = who.x + 0.3;
        b.y = who.y + 0.2 * g;
        b.z = 1.2;
        b.vz = -9;
        b.vx = 0.8;
        b.vy = 0;
        b.t0 = this.t;
      } else set(who, style, 0.15);
      // teammates run in and celebrate with him
      mates.forEach((m, i) => {
        const d = dist(m.x, m.y, who.x, who.y);
        if (d > 32 || m.pos === 'OL' && d > 14) return;
        const a = (i / 11) * Math.PI * 2;
        const near = style === 'leap' ? 2.2 : 1.3 + (i % 3) * 0.5;
        set(m, 'hug', 0.25 + (i % 4) * 0.12, { tx: who.x + Math.cos(a) * near, ty: who.y + Math.sin(a) * near * 0.7, follow: style !== 'leap' ? who : null, spd: 5.5 + (i % 3) });
        rise(m, 0.3);
      });
      for (const f of foes) set(f, 'dejected', 0);
      return;
    }

    if (info.kind === 'first' || info.kind === 'big') {
      rise(who, 0.45);
      set(who, info.kind === 'big' ? 'flexpoint' : 'point', 0.5);
      if (info.kind === 'big') {
        mates.forEach((m, i) => {
          if (dist(m.x, m.y, who.x, who.y) > 9) return;
          set(m, 'hug', 0.4 + (i % 3) * 0.1, { tx: who.x + (i % 2 ? 1.4 : -1.4), ty: who.y - g * (0.8 + (i % 3) * 0.4), spd: 5 });
          rise(m, 0.4);
        });
      }
      return;
    }

    if (info.kind === 'sack' || info.kind === 'int' || info.kind === 'takeaway') {
      rise(who, 0.4);
      set(who, info.kind === 'sack' ? 'sackdance' : 'arms', 0.45);
      mates.forEach((m, i) => {
        if (dist(m.x, m.y, who.x, who.y) > (info.kind === 'int' ? 20 : 8)) return;
        set(m, 'hug', 0.35 + (i % 4) * 0.1, { tx: who.x + (i % 2 ? 1.3 : -1.3), ty: who.y + (i % 3 - 1) * 0.9, follow: who, spd: 6 });
        rise(m, 0.35);
      });
    }
  },

  // Called from settle() each frame for a celebrating player who's up.
  celebMove(p, dt) {
    const c = p.celeb;
    const t = this.post.t - c.t0;
    if (t < 0) return this.brake(p, dt, 6.5);
    if (c.k === 'dejected') return this.brake(p, dt, 3);
    let tx = c.tx;
    let ty = c.ty;
    if (c.follow && !c.follow.hidden) {
      // keep the circle around the scorer as he moves
      tx = c.follow.x + (c.tx - (c.fx0 ?? (c.fx0 = c.follow.x)));
      ty = c.follow.y + (c.ty - (c.fy0 ?? (c.fy0 = c.follow.y)));
    }
    if (tx == null) return this.brake(p, dt, 5);
    const dx = tx - p.x;
    const dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.5) {
      c.arrived = c.arrived ?? this.post.t;
      // Lambeau Leap: up and over the wall, gone into the crowd
      if (c.k === 'leap' && this.post.t - c.arrived > 0.55) p.hidden = true;
      return this.brake(p, dt, 9);
    }
    const s = Math.min(c.spd || 5, d * 3);
    this.accelTo(p, (dx / d) * s, (dy / d) * s, dt, 12);
  },

  // The spiked ball bounces on the turf.
  spikeBall(dt) {
    const b = this.ball;
    if (b.state !== 'spike') return;
    b.vz -= 30 * dt;
    b.z += b.vz * dt;
    if (b.z < 0) {
      b.z = 0;
      b.vz = Math.abs(b.vz) * 0.45;
      b.vx *= 0.6;
      if (b.vz < 0.8) b.vz = 0;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  },
};
