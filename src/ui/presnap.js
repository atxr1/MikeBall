// Before the snap: nobody teleports. The offense breaks the huddle and
// jogs to its spots, the defense comes out of its huddle; change the play
// and they move to the new formation; change personnel (a different
// formation or front, or the depth chart) and the substitutes run on from
// their bench while the players they replace run off.
//
// NFL substitution rules, as the officials apply them:
//   - substitutes come on and replaced players leave only while the ball
//     is dead, the replaced players by their own sideline (Rule 5-2)
//   - when the offense substitutes, the umpire stands over the ball and the
//     snap waits until the defense has had a chance to respond (the
//     officials' substitution procedure; not used inside the last two
//     minutes of a half or on field goals and tries)
//   - after a shift the offense must be set for a full second (7-4)
//   - a player wearing an ineligible number at an eligible spot reports
//     to the referee (5-3, 7-5-1)
//   - a snap with 12 men on the field is a foul: the defense can be caught
//     subbing when a no-huddle offense snaps it (5-1-1)
//
// Coordinates are play-local like the sim's: x across, y past the line.

import { FIELD_W, clamp, dist } from '../core/util.js';
import { styleOf, gait } from '../render/animate.js';
import { drawRig } from '../render/rig.js';
import { drawShadow } from '../render/pixelsprites.js';
import { outfitFor } from '../render/simdraw.js';

const JOG = 5.6;
const SET_TIME = 1.0;
const R = Math.round;

export class PreSnap {
  constructor() {
    this.actors = new Map();
    this.leaving = [];
    this.t = 0;
    this.last = { O: null, D: null }; // who was on the field last snap
    this.hold = null; // umpire holding the ball for the defense
  }

  reset() {
    this.actors.clear();
    this.leaving.length = 0;
    this.hold = null;
  }

  key(team, rec) {
    return `${team}:${rec.id}`;
  }

  // A new call: everyone walks back to the huddles from where the last
  // play left them (or, no-huddle, lines up straight from there), then
  // breaks. Officials walk back to their spots too.
  begin(sim, ctx) {
    this.t = 0;
    this.sim = sim;
    this.ctx = ctx; // { offTeam: 'home'|'away', homeSide, hurry, twoMinute, fg, prevSim, prevLos, los }
    this.actors.clear();
    this.leaving.length = 0;
    this.hold = null;
    this.breakAt = ctx.hurry ? 0 : 0.7;
    const offT = ctx.offTeam;
    const defT = offT === 'home' ? 'away' : 'home';
    const offN = sim.offense.length;
    const defN = sim.defense.length;
    const shift = (ctx.prevLos ?? ctx.los) - ctx.los;
    const place = (a, prev, hx, hy, cy) => {
      a.huddle = { x: sim.ballX, y: cy };
      if (ctx.hurry && prev) { a.x = prev.x; a.y = prev.y + shift; return; }
      a.slot = { x: hx, y: hy }; // his spot in the huddle ring
      if (!prev) { a.x = hx; a.y = hy; return; }
      // from where the play ended (pulled in if he finished far downfield,
      // off the screen anyway)
      let x = clamp(prev.x, -1, FIELD_W + 1);
      let y = prev.y + shift;
      const d = dist(x, y, hx, hy);
      if (d > 14) { x = hx + ((x - hx) * 14) / d; y = hy + ((y - hy) * 14) / d; }
      a.x = x; a.y = y;
      a.toHuddle = d > 0.3;
    };
    sim.offense.forEach((p, i) => {
      // huddle: a ring seven yards back, facing in
      const ang = (i / offN) * Math.PI * 2;
      place(this.actor(offT, p), ctx.prevPos && ctx.prevPos.get(p.rec.id), sim.ballX + Math.cos(ang) * 1.9, -7.5 + Math.sin(ang) * 1.3, -7.5);
    });
    sim.defense.forEach((p, i) => {
      const ang = (i / defN) * Math.PI * 2;
      place(this.actor(defT, p), ctx.prevPos && ctx.prevPos.get(p.rec.id), sim.ballX + Math.cos(ang) * 2.2, 5.5 + Math.sin(ang) * 1.4, 5.5);
    });
    // the officials start where they finished the last play
    if (ctx.prevCrew && sim.crew) this.copyCrew(ctx.prevCrew, sim.crew, shift);
    for (const a of this.actors.values()) this.target(a);
    // personnel changed since the last snap? substitutes come from the bench
    this.markSubs(sim, offT, defT, true);
    this.huddling = [...this.actors.values()].some((a) => a.toHuddle);
  }

  // A kick call: the huddles stay (or re-form) until the kick scene takes
  // over; another call lets them break again.
  setHoldHuddle(on) {
    if (on === !!this.holdHuddle) return;
    this.holdHuddle = on;
    if (!on || !this.ctx) return;
    for (const a of this.actors.values()) {
      if (!a.slot) continue;
      a.toHuddle = dist(a.x, a.y, a.slot.x, a.slot.y) > 0.3;
      if (a.toHuddle) a.state = 'move';
    }
    this.huddling = [...this.actors.values()].some((a) => a.toHuddle);
  }

  copyCrew(from, to, shift = 0) {
    for (const o of to.list) {
      const f = from.by[o.role];
      if (!f) continue;
      o.x = f.x; o.y = f.y + shift; o.face = f.face; o.anim = f.anim || 0;
    }
  }

  actor(team, p) {
    const a = { team, side: p.side, rec: p.rec, x: p.x, y: p.y, vx: 0, vy: 0, tx: p.x, ty: p.y, state: 'move', setAt: 0, p, ph: 0, face: p.side === 'O' ? Math.PI / 2 : -Math.PI / 2 };
    this.actors.set(this.key(team, p.rec), a);
    return a;
  }

  target(a) {
    a.tx = a.p.x;
    a.ty = a.p.y;
    a.state = 'move';
  }

  benchX(team) {
    const homeSide = this.ctx.homeSide ?? -1;
    const s = team === 'home' ? homeSide : -homeSide;
    return s < 0 ? -4 : FIELD_W + 4;
  }

  // New players run on from the bench; the ones they replace run off.
  markSubs(sim, offT, defT, initial) {
    const subsO = [];
    const subsD = [];
    for (const [side, team, list, out] of [['O', offT, sim.offense, subsO], ['D', defT, sim.defense, subsD]]) {
      const last = this.last[side];
      if (!last || last.team !== team) continue;
      for (const p of list) {
        if (last.ids.has(p.rec.id)) continue;
        out.push(p);
        if (initial) {
          // he comes from the sideline, level with the bench
          const a = this.actors.get(this.key(team, p.rec));
          a.x = this.benchX(team);
          a.y = clamp(a.ty, -12, 14);
          a.sub = true;
          a.toHuddle = false;
        }
      }
      if (initial) {
        const now = new Set(list.map((p) => p.rec.id));
        for (const id of last.ids) {
          if (now.has(id)) continue;
          const rec = last.recs.get(id);
          if (!rec) continue;
          // the man he replaces jogs off
          const x0 = last.pos.get(id);
          this.leaving.push({ team, side, rec, x: x0 ? x0.x : sim.ballX, y: x0 ? x0.y : (side === 'O' ? -6 : 5), vx: 0, vy: 0, tx: this.benchX(team), ty: x0 ? x0.y : 0, ph: 0, gone: false });
        }
      }
    }
    this.subbed = { O: subsO.length > 0, D: subsD.length > 0 };
    // offense substituted: the umpire holds the ball for the defense
    const c = this.ctx;
    if (initial && this.subbed.O && !c.twoMinute && !c.fg) this.hold = { t0: 0, released: false };
    return { subsO, subsD };
  }

  // The play changed while calling it: new spots, maybe new personnel.
  sync(sim) {
    if (!this.ctx) return;
    // the officials are the same men, wherever they've got to
    if (this.sim && this.sim.crew && sim.crew && this.sim !== sim) this.copyCrew(this.sim.crew, sim.crew);
    this.sim = sim;
    const offT = this.ctx.offTeam;
    const defT = offT === 'home' ? 'away' : 'home';
    const seen = new Set();
    for (const [team, list] of [[offT, sim.offense], [defT, sim.defense]]) {
      for (const p of list) {
        const k = this.key(team, p.rec);
        seen.add(k);
        let a = this.actors.get(k);
        if (!a) {
          // a substitute for the new call
          a = this.actor(team, p);
          a.x = this.benchX(team);
          a.y = clamp(p.y, -12, 14);
          a.sub = true;
          if (p.side === 'O' && !this.ctx.twoMinute && !this.ctx.fg) this.hold = { t0: this.t, released: false };
        }
        a.p = p;
        this.target(a);
      }
    }
    for (const [k, a] of this.actors) {
      if (seen.has(k)) continue;
      this.actors.delete(k);
      this.leaving.push({ team: a.team, side: a.side, rec: a.rec, x: a.x, y: a.y, vx: a.vx, vy: a.vy, tx: this.benchX(a.team), ty: a.y, ph: a.ph, gone: false });
    }
  }

  // Remember who's on the field at the snap (or at a flag that killed the
  // play before it: they're still the men on the field).
  snapped(sim, offT) {
    this.remember(sim, offT);
    this.ctx = null;
    this.actors.clear();
    this.leaving.length = 0;
    this.hold = null;
  }

  // After a kick the units on the field are different: start fresh.
  forget() {
    this.last = { O: null, D: null };
  }

  remember(sim, offT) {
    const defT = offT === 'home' ? 'away' : 'home';
    const rec = (list) => new Map(list.map((p) => [p.rec.id, p.rec]));
    const pos = (list) => new Map(list.map((p) => [p.rec.id, { x: p.x, y: p.y }]));
    this.last.O = { team: offT, ids: new Set(sim.offense.map((p) => p.rec.id)), recs: rec(sim.offense), pos: pos(sim.offense) };
    this.last.D = { team: defT, ids: new Set(sim.defense.map((p) => p.rec.id)), recs: rec(sim.defense), pos: pos(sim.defense) };
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    if (!this.ctx) return false;
    this.t += dt;
    let moving = false;
    if (this.huddling) {
      // walking back to the huddles; they break a moment after the last man's in
      let out = false;
      for (const a of this.actors.values()) {
        if (!a.toHuddle) continue;
        out = true;
        moving = true;
        const d = dist(a.x, a.y, a.slot.x, a.slot.y);
        if (d < 0.08) { a.toHuddle = false; a.x = a.slot.x; a.y = a.slot.y; a.vx = 0; a.vy = 0; continue; }
        const spd = Math.min(JOG * 0.95, d * 3 + 0.6);
        const step = Math.min(spd * dt, d);
        a.vx = ((a.slot.x - a.x) / d) * spd;
        a.vy = ((a.slot.y - a.y) / d) * spd;
        a.x += ((a.slot.x - a.x) / d) * step;
        a.y += ((a.slot.y - a.y) / d) * step;
        a.ph += (Math.PI * 2 * spd * dt) / 3.4;
        a.face = Math.atan2(a.vy, a.vx);
      }
      if (!out) { this.huddling = false; this.breakAt = Math.max(this.breakAt, this.t + 0.6); }
    }
    const broke = this.t >= this.breakAt && !this.huddling && !this.holdHuddle;
    for (const a of this.actors.values()) {
      let tx = a.tx;
      let ty = a.ty;
      if (!broke && !a.sub) {
        if (!a.toHuddle) { a.vx = 0; a.vy = 0; }
        continue;
      }
      const d = dist(a.x, a.y, tx, ty);
      if (d < 0.08) {
        if (a.state !== 'set') { a.state = 'set'; a.setAt = this.t; a.x = tx; a.y = ty; a.vx = 0; a.vy = 0; }
        continue;
      }
      moving = true;
      a.state = 'move';
      const spd = Math.min(JOG * (this.ctx.hurry ? 1.15 : 1), d * 3.2 + 0.6);
      const step = Math.min(spd * dt, d); // never past the spot, whatever the frame time
      a.vx = ((tx - a.x) / d) * spd;
      a.vy = ((ty - a.y) / d) * spd;
      a.x += ((tx - a.x) / d) * step;
      a.y += ((ty - a.y) / d) * step;
      a.ph += (Math.PI * 2 * spd * dt) / 3.4;
      a.face = Math.atan2(a.vy, a.vx);
    }
    for (const l of this.leaving) {
      if (l.gone) continue;
      moving = true;
      const d = dist(l.x, l.y, l.tx, l.ty);
      if (d < 0.3) { l.gone = true; continue; }
      const spd = Math.min(JOG, d * 3 + 0.6);
      const step = Math.min(spd * dt, d);
      l.vx = ((l.tx - l.x) / d) * spd;
      l.vy = ((l.ty - l.y) / d) * spd;
      l.x += ((l.tx - l.x) / d) * step;
      l.y += ((l.ty - l.y) / d) * step;
      l.ph += (Math.PI * 2 * spd * dt) / 3.4;
    }
    // the umpire lets the snap go once the defense has matched up
    if (this.hold && !this.hold.released) {
      const defenseSet = [...this.actors.values()].every((a) => a.side !== 'D' || a.state === 'set');
      const offOff = this.leaving.every((l) => l.gone || l.side !== 'D');
      if (defenseSet && offOff && this.t - this.hold.t0 > 1.2) this.hold.released = true;
    }
    const crewMoving = this.placeUmpire(dt);
    return moving || crewMoving || (this.hold && !this.hold.released);
  }

  // The officials walk to their spots; the umpire stands over the ball
  // while he's holding it for the defense.
  placeUmpire(dt) {
    const crew = this.sim && this.sim.crew;
    if (!crew) return false;
    const holding = this.hold && !this.hold.released;
    let moving = false;
    for (const o of crew.list) {
      const home = crew.home(o);
      const um = o.role === 'U';
      const tx = um && holding ? this.sim.ballX + 0.4 : home.x;
      const ty = um && holding ? 1.0 : home.y;
      const d = dist(o.x, o.y, tx, ty);
      const rest = o.watch ?? o.face;
      if (d < 0.05) { o.vx = 0; o.vy = 0; o.face = um && holding ? -Math.PI / 2 : rest; continue; }
      moving = true;
      const spd = Math.min(5, d * 3 + 0.4);
      const step = Math.min(spd * dt, d);
      o.vx = ((tx - o.x) / d) * spd;
      o.vy = ((ty - o.y) / d) * spd;
      o.x += ((tx - o.x) / d) * step;
      o.y += ((ty - o.y) / d) * step;
      o.anim += spd * dt * 2.2;
      o.face = Math.atan2(o.vy, o.vx);
    }
    return moving;
  }

  // Can the ball be snapped? The offense set for a second, nobody still
  // jogging off, and the umpire out of the way.
  ready() {
    if (!this.ctx || this.holdHuddle) return true; // kicks don't wait on the stage
    if (this.hold && !this.hold.released) return false;
    for (const a of this.actors.values()) {
      if (a.state !== 'set') return false;
      if (a.side === 'O' && this.t - a.setAt < SET_TIME) return false;
    }
    // the offense's own subs have to be off; a defender still jogging off
    // when it's snapped is 12 men on the field
    for (const l of this.leaving) if (!l.gone && l.side === 'O') return false;
    const crew = this.sim && this.sim.crew;
    if (crew) {
      const u = crew.by.U;
      const h = crew.home(u);
      if (dist(u.x, u.y, h.x, h.y) > 0.6) return false;
    }
    return true;
  }

  // Defenders still on their way off when the offense snaps it.
  extraDefenders() {
    return this.leaving.filter((l) => !l.gone && l.side === 'D' && l.x > 0 && l.x < FIELD_W).length;
  }

  waitingFor() {
    if (this.hold && !this.hold.released) return 'umpire';
    return this.ready() ? null : 'set';
  }

  // ---------------------------------------------------------------- draw
  // For drawSimPlayers: where to draw a sim player, and how, while he's on
  // the move (null once he's set: the sim's stance takes over).
  override(p, team) {
    const a = this.actors.get(this.key(team, p.rec));
    if (!a || a.state === 'set') return null;
    const st = styleOf(p.rec);
    const e = { view: 'S', crouch: 0, lean: 0, tx: 0, legs: [[0, 0], [0, 0]], arms: [[0, 0, 0], [0, 0, 0]], ball: -1, rot: 0, pivot: 'feet', sy: 10, lift: 0, prop: null, lie: null };
    const sp = Math.hypot(a.vx, a.vy);
    if (sp < 0.3) {
      // in the huddle, leaning in
      const ang = Math.atan2(a.huddle ? a.huddle.y - a.y : 0, a.huddle ? a.huddle.x - a.x : 1);
      e.view = viewOf(ang);
      e.crouch = 1;
      e.lean = 2;
      e.arms[0] = [2, -1, e.view === 'E' || e.view === 'W' ? 0 : 1];
      e.arms[1] = [-2, -1, e.view === 'E' || e.view === 'W' ? 0 : 1];
      return { x: a.x, y: a.y, pose: e };
    }
    e.view = viewOf(a.face);
    gait(e, st, a.ph, clamp(sp / 8, 0, 1), false, 0);
    return { x: a.x, y: a.y, pose: e };
  }

  drawLeaving(ctx, cam, los, uniFor) {
    for (const l of this.leaving) {
      if (l.gone) continue;
      const x = cam.sx(l.x);
      const y = cam.sy(los + l.y);
      if (x < -24 || x > cam.w + 24 || y < -6 || y > cam.h + 34) continue;
      const e = { view: 'S', crouch: 0, lean: 0, tx: 0, legs: [[0, 0], [0, 0]], arms: [[0, 0, 0], [0, 0, 0]], ball: -1, rot: 0, pivot: 'feet', sy: 10, lift: 0, prop: null, lie: null };
      e.view = viewOf(Math.atan2(l.vy, l.vx));
      gait(e, styleOf(l.rec), l.ph, clamp(Math.hypot(l.vx, l.vy) / 8, 0, 1), false, 0);
      drawShadow(ctx, x, y, 10);
      drawRig(ctx, outfitFor(uniFor(l.team), l.rec.skinTone || 0), e, x, y, l.rec.num, l);
    }
  }
}

function viewOf(ang) {
  const c = Math.cos(ang);
  if (Math.abs(c) > 0.7) return c > 0 ? 'E' : 'W';
  return Math.sin(ang) > 0 ? 'N' : 'S';
}

export { R };
