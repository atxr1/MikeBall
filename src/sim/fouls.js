// Fouls that come out of what happens on the field, mixed into PlaySim:
//
//   offensive holding   a blocker who's getting beaten grabs the defender
//                       as he sheds (worse blockers grab more)
//   pass interference   a defender who gets to the receiver early without
//                       playing the ball (trailing, back to the ball)
//   defensive holding   a defender in man coverage hanging on through the
//                       route
//   roughing the passer a rusher who hits the quarterback well after the
//                       ball is gone
//   face mask           a tackler grabbing the mask on the way down
//   offensive PI        a receiver pushing off to make his catch
//   intentional         a passer about to be sacked throwing it into the
//     grounding         turf from the pocket (src/sim/passing.js)
//   unnecessary         a late hit on a runner who's down or out of
//     roughness         bounds (a dead-ball foul, after the whistle)
//   offside, 12 men,    set up at the snap (setupSnapFoul in playsim.js)
//     illegal formation
//
// Each one is flagged by the official who'd see it (src/sim/officials.js)
// at the moment it happens, and goes out with the result as `fouls`; the
// rules engine decides whether it's accepted (src/game/rules.js).
// Every random draw comes from the sim's seeded RNG.

import { dist, clamp } from '../core/util.js';

export const FOULS = {
  holdO: { name: 'Offensive holding', on: 'O', yards: 10, signal: 'holding' },
  dpi: { name: 'Defensive pass interference', on: 'D', yards: 0, spotFoul: true, auto1st: true, signal: 'dpi' },
  holdD: { name: 'Defensive holding', on: 'D', yards: 5, auto1st: true, signal: 'holding' },
  opi: { name: 'Offensive pass interference', on: 'O', yards: 10, signal: 'dpi' },
  grounding: { name: 'Intentional grounding', on: 'O', yards: 10, signal: 'grounding', lossOfDown: true },
  ur: { name: 'Unnecessary roughness', on: 'D', yards: 15, auto1st: true, signal: 'ur', afterPlay: true, deadBall: true },
  formation: { name: 'Illegal formation', on: 'O', yards: 5, signal: 'falseStart' },
  contact: { name: 'Illegal contact', on: 'D', yards: 5, auto1st: true, signal: 'contact' },
  rtp: { name: 'Roughing the passer', on: 'D', yards: 15, auto1st: true, signal: 'rtp', afterPlay: true },
  mask: { name: 'Face mask', on: 'D', yards: 15, auto1st: true, signal: 'mask', afterPlay: true },
  falseStart: { name: 'False start', on: 'O', yards: 5, signal: 'falseStart', dead: true },
  offside: { name: 'Offside', on: 'D', yards: 5, signal: 'offside' },
  subs: { name: 'Too many men on the field', on: 'D', yards: 5, signal: 'subs' },
  encroach: { name: 'Encroachment', on: 'D', yards: 5, signal: 'offside', dead: true },
  neutral: { name: 'Neutral zone infraction', on: 'D', yards: 5, signal: 'offside', dead: true },
};

export const foulMethods = {
  flag(key, who, x, y, extra = {}) {
    if (this.opts.noFouls) return null; // tries: not modeled
    if (!this.fouls) this.fouls = [];
    // one flag per foul type per player is plenty
    if (this.fouls.some((f) => f.key === key && f.who === who)) return null;
    const f = { key, ...FOULS[key], who, x, y, t: this.t, ...extra };
    this.fouls.push(f);
    this.events.push({ t: this.t, k: 'flag', key, who, x, y });
    if (this.crew) this.crew.throwFlag(f);
    return f;
  },

  // A defender just shed a block. If the blocker was losing badly, he may
  // have grabbed a handful of jersey to slow him down.
  onShed(pair) {
    const b = pair.b;
    const d = pair.d;
    if (b.side !== 'O' || this.done) return;
    const skill = pair.run ? b.a.rbk : b.a.pbk;
    const beaten = clamp(pair.w + 0.2, 0, 1);
    // the farther from the ball, the less it matters (and the less it's called)
    const h = this.ball.holder || this.qb;
    const near = h ? clamp(1.2 - dist(b.x, b.y, h.x, h.y) / 12, 0.2, 1) : 0.6;
    const p = (0.01 + beaten * 0.026) * (1.3 - skill / 160) * near;
    if (this.rng.chance(p)) this.flag('holdO', b, b.x, b.y, { victim: d });
  },

  // A receiver and his defender at the catch (called from resolveCatch).
  // f: the defender's share of the incompletion (src/sim/odds.js).
  noteCoverage(f, r, info) {
    const d = f.d;
    if (f.dd > 1.0 || this.done) return;
    // playing the man, not the ball, and getting there early
    const early = f.look < 0.6 ? 1 : 0.3;
    const trail = f.front < -0.2 ? 1.2 : 0.6;
    const p = 0.42 * early * trail * (1.25 - (d.a.mcv + d.a.awr) / 260);
    if (info.bz > 3) return; // uncatchable
    if (this.rng.chance(p)) this.flag('dpi', d, (d.x + r.x) / 2, (d.y + r.y) / 2, { victim: r, spotY: Math.max(1, Math.round(info.by)) });
    // or the receiver pushed off to make his space
    else if (f.front > 0 && this.rng.chance(0.05 * clamp((r.a.str - d.a.str) / 30 + 0.6, 0.2, 1.2))) this.flag('opi', r, r.x, r.y, { victim: d });
  },

  // A contested catch: sometimes the separation came from a push-off
  // (called from resolveCatch).
  notePushOff(odds, r, info) {
    if (this.done || info.bz > 3) return;
    let f = null;
    for (const o of odds.foes || []) if (!f || o.dd < f.dd) f = o;
    if (!f || f.dd > 1.2) return;
    const p = 0.03 * clamp((r.a.str - f.d.a.str) / 30 + 0.8, 0.3, 1.4);
    if (this.rng.chance(p)) this.flag('opi', r, r.x, r.y, { victim: f.d });
  },

  // Man coverage hanging on through the route, checked a few times a second
  // while the routes develop. Within 5 yards a defender may chuck the
  // receiver; grabbing him is holding anywhere; contact past 5 yards is
  // illegal contact (Rule 8-4).
  checkCoverageHolds() {
    if (this.phase !== 'pre' || this.t < 0.6 || this.t > 3.2) return;
    if (this.t < (this._holdNext || 0)) return;
    this._holdNext = this.t + 0.25;
    for (const d of this.defense) {
      if (!d.target || d.assign.t !== 'man' || d.down) continue;
      const r = d.target;
      if (!r.released || dist(d.x, d.y, r.x, r.y) > 1.0) continue;
      // he's beaten (receiver separating) and grabbing
      const beat = clamp((r.a.rte - d.a.mcv) / 40 + 0.35, 0.1, 1);
      if (!this.rng.chance(0.018 * beat)) continue;
      const key = r.y > 5 && this.rng.chance(0.3) ? 'contact' : 'holdD';
      this.flag(key, d, d.x, d.y, { victim: r });
      return;
    }
  },

  // Rushers arriving at the quarterback after the throw.
  checkLateHits() {
    if (!this.passer || this.ball.state === 'held' && this.ball.holder !== this.qb) return;
    const qb = this.qb;
    if (!qb || qb.down || this.ball.t0 == null || this.phase === 'pre') return;
    const since = this.t - this.ball.t0;
    if (since < 0.05 || since > 1.6) return;
    for (const d of this.defense) {
      if (d.down || d.blk || d._hitQB || dist(d.x, d.y, qb.x, qb.y) > 0.85) continue;
      d._hitQB = true;
      // a hit right as he lets it go is legal; two steps later isn't
      if (since > 0.45 && this.rng.chance(0.05)) this.flag('rtp', d, qb.x, qb.y, { victim: qb });
      if (since < 0.9) {
        this.knockDown(qb, 0.9, (qb.x - d.x) * 2, (qb.y - d.y) * 2);
        qb.fellBack = true;
      }
      d.vx *= 0.4;
      d.vy *= 0.4;
    }
  },

  // After the whistle: a late hit on a runner who's down or out of bounds.
  checkLateHitAfterWhistle(outcome, h) {
    if (!h || (outcome !== 'tackle' && outcome !== 'oob')) return;
    if ((this.opts.ballOn ?? 50) + h.y <= 0.5) return; // down in his own end zone
    if (!this.rng.chance(outcome === 'oob' ? 0.012 : 0.003)) return;
    const foes = h.side === 'O' ? this.defense : this.offense;
    let best = null;
    let bd = 4;
    for (const d of foes) { const dd = dist(d.x, d.y, h.x, h.y); if (dd < bd) { bd = dd; best = d; } }
    if (best && best.side === 'D') this.flag('ur', best, h.x, h.y, { victim: h });
  },

  // A made tackle: once in a while he grabs the face mask.
  onTackle(w) {
    if (w.kind === 'pushout') return;
    const d = w.ds[0];
    if (!d || d.side !== 'D') return; // returns after a turnover aren't modeled
    const p = w.kind === 'sack' ? 0.012 : 0.0035;
    if (this.rng.chance(p)) this.flag(w.kind === 'sack' ? 'rtp' : 'mask', d, w.h.x, w.h.y, { victim: w.h });
  },

  // The result's view of the fouls: records instead of sim entities.
  foulsOut() {
    return (this.fouls || []).map((f) => ({ key: f.key, name: f.name, on: f.on, yards: f.yards, auto1st: !!f.auto1st, spotFoul: !!f.spotFoul, afterPlay: !!f.afterPlay, deadBall: !!f.deadBall, lossOfDown: !!f.lossOfDown, spotY: f.spotY ?? null, player: f.who ? f.who.rec : null, signal: f.signal, dead: !!f.dead }));
  },
};
