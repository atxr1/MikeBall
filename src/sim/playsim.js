// Real-time 22-player play simulation.
//
// Coordinates are yards. x: 0..53.33 across the field. y: relative to the
// line of scrimmage, offense moving +y (drawn up the screen).
// No DOM access here: this runs in the browser and in Node tests.

import { FIELD_W, clamp, dist } from '../core/util.js';
import { FORMATIONS } from '../data/playbook.js';
import { alignOffense, alignDefense, routePoints, pathPoints } from './align.js';
import { contactMethods } from './contact.js';
import { celebrateMethods } from './celebrate.js';

export const DT = 1 / 60;
const HIST = 40;
const MAX_TIME = 22;

function mkEnt(rec, side, slot, pos, x, y) {
  const a = rec.attrs;
  return {
    rec, a, side, slot, pos, x, y, sx: x, sy: y, vx: 0, vy: 0,
    maxSpd: 5.6 + a.spd * 0.042,
    accel: 7 + a.acc * 0.06,
    face: side === 'O' ? Math.PI / 2 : -Math.PI / 2,
    job: null, assign: null,
    blk: null, target: null, retarget: 0,
    freeT: 0, stunT: 0, stumbleT: 0, tackleCD: 0, moveCD: 0, jamT: 0,
    down: false, downT: 0, upT: 0, anim: (x * 7.3 + y * 3.1) % 6, juke: 0,
    move: null, diveT: 0, wrapOn: null, cheer: false, celeb: null, hidden: false,
    hist: new Float32Array(HIST * 2), hi: 0,
    wp: 0, pts: null, routeEnd: 'continue', released: false,
    readDelay: 0, ballReact: 0, paFooled: false, sat: false,
  };
}

export class PlaySim {
  // opts: { offPlay, defPlay, offLineup, defLineup, ballOn, ballX, rng, wantOOB, twoPoint }
  constructor(opts) {
    this.opts = opts;
    this.rng = opts.rng;
    this.offPlay = opts.offPlay;
    this.defPlay = opts.defPlay;
    this.ballOn = opts.ballOn;
    this.ballX = opts.ballX;
    this.goalY = 100 - opts.ballOn; // offense scores at y >= goalY
    this.ownGoalY = -opts.ballOn; // safety if downed at y <= ownGoalY
    this.t = 0;
    this.phase = 'pre';
    this.done = false;
    this.result = null;
    this.events = [];
    this.blocks = [];
    this.carrier = null;
    this.runT = null;
    this.turnover = false;
    this.wrap = null;
    this.offense = [];
    this.defense = [];
    this.players = [];
    this.setup();
  }

  // ---------------------------------------------------------------- setup
  setup() {
    const { offPlay, defPlay, offLineup, defLineup, rng } = this.opts;
    const ballX = this.ballX;
    this.offAlign = alignOffense(offPlay.formation, ballX);
    const dal = alignDefense(defPlay, this.offAlign, ballX);
    this.defAlign = dal.players;
    this.strength = dal.strength;
    const bySlot = {};

    for (const s of FORMATIONS[offPlay.formation].slots) {
      const al = this.offAlign[s.slot];
      const e = mkEnt(offLineup[s.slot], 'O', s.slot, s.pos, al.x, al.y);
      e.job = { ...(offPlay.assign?.[s.slot] || (s.pos === 'OL' ? { t: offPlay.cat === 'run' ? 'zone' : 'passpro', dir: offPlay.dir || 0 } : { t: 'stalk' })) };
      bySlot[s.slot] = e;
      this.offense.push(e);
    }
    for (const d of Object.values(this.defAlign)) {
      const e = mkEnt(defLineup[d.slot], 'D', d.slot, d.pos, d.x, d.y);
      e.assign = d.assign;
      e.readDelay = 0.12 + (100 - e.a.awr) / 280 + (d.pos === 'CB' ? 0.35 : d.pos === 'S' ? 0.15 : 0);
      e.ballReact = 0.14 + (100 - e.a.awr) / 380;
      if (offPlay.pa && (d.pos === 'LB' || d.pos === 'S')) e.paFooled = rng.chance(0.8 - e.a.awr / 200);
      this.defense.push(e);
    }
    this.bySlot = bySlot;
    this.defBySlot = Object.fromEntries(this.defense.map((d) => [d.slot, d]));
    this.qb = bySlot.QB;
    this.players = [...this.offense, ...this.defense];

    // Man assignments -> entities
    for (const d of this.defense) {
      if (d.assign.t === 'man') d.target = bySlot[d.assign.man] || null;
    }

    // Offensive job setup
    for (const p of this.offense) {
      const j = p.job;
      if (j.t === 'route') {
        const rp = routePoints(p, j.r, j.side, ballX, j.pts);
        p.pts = rp.pts;
        p.routeEnd = rp.end;
        p.released = true;
      } else if (j.t === 'chkrel') {
        const rp = routePoints(p, j.r, j.side, ballX, j.pts);
        p.pts = rp.pts;
        p.routeEnd = rp.end;
      } else if (j.t === 'carry' || j.t === 'pull' || j.t === 'pafake') {
        p.pts = pathPoints(j.path, ballX);
      } else if (j.t === 'lead') {
        p.pts = pathPoints([j.to], ballX);
      }
    }

    // Press jams
    for (const d of this.defense) {
      if (d.assign.t === 'man' && d.assign.press && d.target) {
        const r = d.target;
        const win = (d.a.str * 0.4 + d.a.mcv * 0.6) - (r.a.str * 0.3 + r.a.rte * 0.7) + this.rng.normal(0, 12);
        if (win > 0) r.jamT = 0.25 + Math.min(0.35, win / 60);
      }
    }

    // Reads: the play's progression, minus anyone the coach turned into a
    // blocker, plus anyone he drew a new route for.
    const isRoute = (e) => e && (e.job.t === 'route' || e.job.t === 'chkrel');
    const edited = new Set(offPlay.editedSlots || []);
    const prog = (offPlay.progression || []).filter((s) => bySlot[s] && !(edited.has(s) && !isRoute(bySlot[s])));
    for (const s of edited) if (isRoute(bySlot[s]) && !prog.includes(s)) prog.push(s);
    this.progression = prog.map((s) => bySlot[s]);
    this.eligible = this.offense.filter((p) => p.pos === 'WR' || p.pos === 'TE' || p.pos === 'RB');

    // Ball: under center = in QB's hands; shotgun = snapped through the air.
    const qb = this.qb;
    const center = bySlot.C;
    const gun = qb.y < -2.5;
    this.ball = {
      state: gun ? 'snap' : 'held',
      holder: gun ? null : qb,
      x: center.x, y: center.y, z: 0.4,
      fx: center.x, fy: center.y, tx: qb.x, ty: qb.y + 0.4, t0: 0, T: gun ? 0.32 : 0, peak: 0.6,
      target: null,
    };
    if (offPlay.cat === 'run' && offPlay.assign.QB?.t === 'carry') {
      // QB sneak: QB is the runner from the snap.
      this.ball.state = 'held';
      this.ball.holder = qb;
    }

    // Initial pass-pro / run-block targets
    this.assignInitialBlocks();
  }

  assignInitialBlocks() {
    const rushers = this.defense.filter((d) => d.y < 1.6);
    const blockers = this.offense.filter((p) => p.pos === 'OL');
    const taken = new Map();
    // drawn blocking assignments first
    for (const b of this.offense) {
      const t = b.job.target && this.defBySlot[b.job.target];
      if (t) { b.target = t; taken.set(t, b); }
    }
    if (this.offPlay.cat === 'pass' || this.offPlay.cat === 'special') {
      // Greedy by lateral distance; one blocker per rusher first.
      const pairs = [];
      for (const b of blockers) for (const r of rushers) pairs.push({ b, r, c: Math.abs(b.x - r.x) });
      pairs.sort((a, b) => a.c - b.c);
      const usedB = new Set([...taken.values()]);
      for (const { b, r, c } of pairs) {
        if (usedB.has(b) || taken.has(r) || c > 3.5) continue;
        b.target = r;
        usedB.add(b);
        taken.set(r, b);
      }
    }
  }

  // ---------------------------------------------------------------- main loop
  step() {
    if (this.done) return;
    const dt = DT;
    this.t += dt;
    this.updateBall(dt);
    if (this.done) return;
    for (const p of this.players) {
      if (p.stunT > 0) p.stunT -= dt;
      if (p.freeT > 0) p.freeT -= dt;
      if (p.tackleCD > 0) p.tackleCD -= dt;
      if (p.moveCD > 0) p.moveCD -= dt;
      if (p.juke > 0) p.juke -= dt;
      if (p.jamT > 0 && this.t > 0.05) p.jamT -= dt;
      this.tickMove(p, dt);
      this.think(p, dt);
    }
    this.updateWrap(dt);
    if (this.done) return;
    this.updateEngagements(dt);
    this.integrate(dt);
    if (this.done) return;
    this.checkContacts(dt);
    if (this.done) return;
    this.checkBoundaries();
    if (!this.done && this.t > MAX_TIME) {
      const h = this.ball.holder;
      this.endPlay(h ? 'tackle' : 'incomplete', { spotY: h ? h.y : 0, spotX: h ? h.x : this.ballX });
    }
  }

  runToEnd() {
    let guard = 0;
    while (!this.done && guard++ < 60 * 30) this.step();
    return this.result;
  }

  // ---------------------------------------------------------------- ball
  updateBall(dt) {
    const b = this.ball;
    if (b.state === 'snap') {
      const u = clamp((this.t - b.t0) / b.T, 0, 1);
      b.x = b.fx + (b.tx - b.fx) * u;
      b.y = b.fy + (b.ty - b.fy) * u;
      b.z = 0.5 + Math.sin(u * Math.PI) * 0.3;
      if (u >= 1) {
        b.state = 'held';
        b.holder = this.qb;
      }
      return;
    }
    if (b.state === 'held' && b.holder) {
      const h = b.holder;
      b.x = h.x + Math.cos(h.face) * 0.25;
      b.y = h.y + Math.sin(h.face) * 0.25;
      b.z = 1.1;
      return;
    }
    if (b.state === 'air' || b.state === 'pitch') {
      const u = clamp((this.t - b.t0) / b.T, 0, 1);
      b.x = b.fx + (b.tx - b.fx) * u;
      b.y = b.fy + (b.ty - b.fy) * u;
      b.z = 1.8 + 4 * b.peak * u * (1 - u) - 0.6 * u;
      if (u >= 1) {
        if (b.state === 'pitch') this.completePitch();
        else this.resolveCatch();
      }
    }
  }

  ballSpeed(qb) {
    return 15.5 + qb.a.thp * 0.11;
  }

  // ---------------------------------------------------------------- think
  think(p, dt) {
    if (p.down && this.stayDown(p, dt)) return;
    if (this.wrap && (p === this.wrap.h || p.wrapOn)) return; // tackle in progress
    if (p.stumbleT > 0) {
      p.stumbleT -= dt;
      this.brake(p, dt, 9);
      return;
    }
    if (p.blk) return; // engagement drives movement
    if (this.ball.holder === p && (this.phase === 'run' || p === this.carrier)) {
      this.carrierThink(p, dt);
      return;
    }
    if (p.side === 'O') this.offThink(p, dt);
    else this.defThink(p, dt);
  }

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
      if (p === this.ball.target) {
        this.steer(p, this.ball.tx, this.ball.ty, 1, dt, 0.4);
        return;
      }
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
  }

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
      if (this.t - b.t0 > p.ballReact && (p.assign.t !== 'rush' && p.assign.t !== 'blitz' || p.y > 2)) {
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
  }

  coverage(p, dt) {
    if (p.paFooled && this.t < 0.75) return this.steer(p, p.sx, p.sy - 2.2, 0.7, dt, 0.4);
    // Linebackers read-step before dropping so they can still fit the run.
    if (p.pos === 'LB' && this.t < 0.25 + p.readDelay * 0.6 && this.phase === 'pre') return this.steer(p, p.sx, p.sy - 0.6, 0.35, dt, 0.4);
    if (p.assign.t === 'man') return this.manCover(p, dt);
    if (p.assign.t === 'zone') return this.zoneCover(p, dt);
    if (p.assign.t === 'rush' || p.assign.t === 'blitz') return this.rush(p, dt, this.ball.holder || this.qb);
    return this.zoneCover(p, dt);
  }

  // ---------------------------------------------------------------- offense behaviors
  preHandoffSpeed(p) {
    if (p.job.self) return 0.9;
    if (p.job.handT >= 0.9) return this.t < p.job.handT - 0.25 ? 0 : 0.85;
    return 0.85;
  }

  followPath(p, dt, frac) {
    if (!p.pts || p.wp >= p.pts.length) return this.brake(p, dt, 6);
    const tp = p.pts[p.wp];
    if (frac <= 0) return this.brake(p, dt, 8);
    this.steer(p, tp.x, tp.y, frac, dt, 0);
    if (dist(p.x, p.y, tp.x, tp.y) < 0.6) p.wp++;
  }

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
  }

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
  }

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
  }

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
  }

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
  }

  // The defender the coach drew this blocker onto, while he's still blockable.
  drawnTarget(p) {
    const t = p.job.target && this.defBySlot[p.job.target];
    if (!t || t.down || (t.blk && t.blk.b !== p)) return null;
    return t;
  }

  runAim() {
    const c = this.carrier || this.bySlot.RB || this.qb;
    if (this.carrier) return { x: c.x, y: c.y };
    const rb = this.offense.find((p) => p.job.t === 'carry');
    if (rb && rb.pts) {
      const hole = rb.pts.find((pt) => pt.y > -1.5) || rb.pts[rb.pts.length - 1];
      return { x: hole.x, y: hole.y };
    }
    return { x: this.ballX, y: 0 };
  }

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
  }

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
  }

  // ---------------------------------------------------------------- QB
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
  }

  handTo(rb) {
    this.ball.state = 'held';
    this.ball.holder = rb;
    this.carrier = rb;
    this.phase = 'run';
    this.runT = this.t;
    this.rusher = rb;
    this.events.push({ t: this.t, k: 'handoff', who: rb });
  }

  pitchTo(qb, rb) {
    const b = this.ball;
    const lead = 0.38;
    b.state = 'pitch';
    b.holder = null;
    b.fx = qb.x; b.fy = qb.y;
    b.tx = rb.x + rb.vx * lead; b.ty = rb.y + rb.vy * lead;
    b.t0 = this.t; b.T = lead; b.peak = 0.25; b.target = rb;
    this.runT = this.t;
  }

  completePitch() {
    const rb = this.ball.target;
    this.ball.target = null;
    if (this.rng.chance(0.006)) return this.fumble(rb, 'muffed pitch');
    this.handTo(rb);
  }

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
    // Wind-up: the ball isn't out yet, so the QB can still be hit.
    if (p.pending) {
      if (this.t >= p.pending.at) {
        const pd = p.pending;
        p.pending = null;
        if (pd.away) this.throwAwayNow(p);
        else this.throwNow(p, pd.r, pd.pressure);
      }
      return this.brake(p, dt, 8);
    }
    // Set in the pocket: read and decide.
    const tSet = this.t - p.setT;
    const pressure = this.pressureOn(p);
    // pocket movement: slide away from the nearest free rusher
    const threat = this.nearestFree(this.defense, p.x, p.y);
    let mx = this.ballX;
    let my = p.dropY + Math.min(1.2, tSet * 0.6);
    if (threat && dist(threat.x, threat.y, p.x, p.y) < 4) {
      mx = p.x + clamp(p.x - threat.x, -1.5, 1.5) * 1.2;
      my = p.y + clamp(p.y - threat.y, -1, 1);
    }
    this.steer(p, clamp(mx, this.ballX - 5, this.ballX + 5), Math.min(my, -1.2), 0.45, dt, 0.4);

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

    const readDur = 0.45 + (100 - p.a.dec) / 260;
    const idx = Math.min(this.progression.length - 1, Math.floor(tSet / readDur));
    const base = play.depth === 'short' ? 1.3 : play.depth === 'deep' ? 2.1 : 1.8;
    const threshold = base - Math.max(0, tSet - 1.6) * 0.55 - pressure * 0.9;
    const cand = this.progression[idx];
    if (cand && tSet > 0.12) {
      const o = this.openness(p, cand);
      if (o >= threshold) return this.throwTo(p, cand, pressure);
    }
    p.decT -= dt;
    if (p.decT > 0) return;
    p.decT = 0.22;
    if (pressure > 0.65 || tSet > 2.8) {
      let best = null;
      let bo = -99;
      for (const r of this.progression) {
        const o = this.openness(p, r) + r.y * 0.02;
        if (o > bo) { bo = o; best = r; }
      }
      if (best && bo > (tSet > 3.4 ? 0.6 : 1.0)) return this.throwTo(p, best, pressure);
      const scrP = 0.12 + 0.45 * clamp((p.a.spd - 55) / 35, 0, 1);
      if (this.rng.chance(scrP) && this.laneOpen(p)) return this.startScramble(p);
      if (tSet > 4.4 || (pressure > 0.85 && this.rng.chance(0.25))) {
        if (this.rng.chance(0.55 + p.a.dec / 300)) return this.throwAway(p);
      }
    }
  }

  pressureOn(qb) {
    let m = 9;
    for (const d of this.defense) {
      if (d.down) continue;
      const dd = dist(d.x, d.y, qb.x, qb.y) - (d.blk ? 1.4 : 0);
      if (dd < m) m = dd;
    }
    return clamp((3.2 - m) / 2.2, 0, 1);
  }

  laneOpen(qb) {
    // Any of three lanes (middle, left, right) free of unblocked defenders.
    for (const lx of [0, -4, 4]) {
      let open = true;
      for (const d of this.defense) {
        if (d.down || d.blk) continue;
        if (d.y > qb.y - 1 && d.y < qb.y + 5 && Math.abs(d.x - (qb.x + lx)) < 2.2) { open = false; break; }
      }
      if (open) return true;
    }
    return false;
  }

  leadPoint(qb, r) {
    const spd = this.ballSpeed(qb);
    let lx = r.x;
    let ly = r.y;
    let T = 0;
    for (let i = 0; i < 3; i++) {
      const d = dist(qb.x, qb.y, lx, ly);
      T = d / spd + 0.12 + (d > 25 ? (d - 25) * 0.012 : 0);
      const settle = r.routeEnd === 'sit' && r.wp >= (r.pts ? r.pts.length : 0);
      lx = r.x + (settle ? 0 : r.vx * T);
      ly = r.y + (settle ? 0 : r.vy * T);
    }
    return { x: clamp(lx, 0.8, FIELD_W - 0.8), y: Math.min(ly, this.goalY + 8), T };
  }

  openness(qb, r) {
    if (!r || r.down || !r.released || r.blk) return -99;
    if (r.jamT > 0) return -5;
    const L = this.leadPoint(qb, r);
    if (L.y < qb.y - 1 && !this.offPlay.screen) return -5;
    let o = 99;
    for (const d of this.defense) {
      if (d.down || d.blk) continue;
      const dd = dist(d.x, d.y, L.x, L.y) - d.maxSpd * L.T * 0.55;
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
    return o - Math.max(0, L.y - 12) * 0.05;
  }

  throwTo(qb, r, pressure) {
    if (qb.pending) return;
    qb.pending = { r, pressure, at: this.t + 0.1 + (100 - qb.a.dec) / 600 + pressure * 0.04 };
  }

  throwAway(qb) {
    if (qb.pending) return;
    qb.pending = { away: true, at: this.t + 0.14 };
  }

  throwNow(qb, r, pressure) {
    if (!r) return this.throwAwayNow(qb);
    const L = this.leadPoint(qb, r);
    const d = dist(qb.x, qb.y, L.x, L.y);
    const sigma = 0.15 + (100 - qb.a.tha) * 0.012 + pressure * 0.6 + d * 0.015 + (this.offPlay.hailMary ? 1.6 : 0);
    const tx = L.x + this.rng.normal(0, sigma);
    const ty = L.y + this.rng.normal(0, sigma * 1.15);
    const b = this.ball;
    b.state = 'air';
    b.holder = null;
    b.fx = qb.x; b.fy = qb.y;
    b.tx = tx; b.ty = ty;
    b.t0 = this.t;
    b.T = Math.max(0.25, dist(qb.x, qb.y, tx, ty) / this.ballSpeed(qb) + 0.08 + (d > 25 ? (d - 25) * 0.012 : 0));
    b.peak = 0.6 + d * 0.1;
    b.target = r;
    this.phase = 'air';
    this.passer = qb;
    this.airYards = ty;
    this.events.push({ t: this.t, k: 'throw', who: qb, to: r });
  }

  throwAwayNow(qb) {
    const side = qb.x < this.ballX ? -1 : 1;
    const b = this.ball;
    b.state = 'air';
    b.holder = null;
    b.fx = qb.x; b.fy = qb.y;
    b.tx = side < 0 ? -3 : FIELD_W + 3;
    b.ty = Math.max(qb.y + 6, 2);
    b.t0 = this.t;
    b.T = dist(qb.x, qb.y, b.tx, b.ty) / this.ballSpeed(qb) + 0.1;
    b.peak = 2.5;
    b.target = null;
    b.away = true;
    this.phase = 'air';
    this.passer = qb;
    this.events.push({ t: this.t, k: 'throwaway', who: qb });
  }

  startScramble(qb) {
    this.scramble = true;
    this.carrier = qb;
    this.phase = 'run';
    this.runT = this.t;
    this.rusher = qb;
    this.events.push({ t: this.t, k: 'scramble', who: qb });
  }

  // ---------------------------------------------------------------- catch
  resolveCatch() {
    const b = this.ball;
    const L = { x: b.tx, y: b.ty };
    this.phase = 'resolving';
    if (b.away || L.x < 0 || L.x > FIELD_W || L.y > this.goalY + 10) {
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
    if (r === b.target) rd += 0.3;
    let def = null;
    let dd = 1e9;
    for (const d of this.defense) {
      if (d.down || d.blk) continue;
      const x = dist(d.x, d.y, L.x, L.y);
      if (x < dd) { dd = x; def = d; }
    }
    const contest = clamp((1.7 - dd) / 1.7, 0, 1);
    if (def && dd < 1.4) {
      const close = clamp((1.4 - dd) / 1.4, 0, 1);
      const pInt = (0.02 + def.a.bsk * 0.0018) * close * (r && rd < dd ? 0.4 : 1.1);
      if (this.rng.chance(pInt)) return this.intercept(def);
      const cov = (def.a.mcv + def.a.zcv) / 200;
      const pPbu = (0.16 + cov * 0.36) * close * (r && rd < dd ? 0.8 : 1.2);
      if (this.rng.chance(pPbu)) return this.incomplete('broken up', def);
    }
    if (r && rd < 1.45) {
      const deep = Math.max(0, L.y - 12) * 0.008;
      const pc = clamp(0.58 + r.a.cth * 0.004 - rd * 0.08 - contest * 0.3 - deep, 0.05, 0.97);
      if (this.rng.chance(pc)) return this.catchBy(r, L);
      return this.incomplete(contest < 0.3 && rd < 0.7 ? 'dropped' : 'contested', def);
    }
    return this.incomplete(L.y > (b.target ? b.target.y : 0) ? 'overthrown' : 'incomplete', null);
  }

  catchBy(r, L) {
    r.x = L.x * 0.6 + r.x * 0.4;
    r.y = L.y * 0.6 + r.y * 0.4;
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
    this.events.push({ t: this.t, k: 'catch', who: r });
    for (const p of this.offense) if (p !== r) p.target = null;
  }

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
    if (d.y >= this.goalY + 1.5) this.endPlay('touchback', { spotY: this.goalY, spotX: d.x });
  }

  incomplete(why, def) {
    this.events.push({ t: this.t, k: 'incomplete', why, def });
    this.endPlay('incomplete', { spotY: 0, spotX: this.ballX, why, defender: def });
  }

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
  }

  qbSlide(p) {
    if (p !== this.qb || !this.scramble || p.y < 1) return false;
    const foe = this.nearestFree(this.defense, p.x, p.y);
    if (foe && dist(foe.x, foe.y, p.x, p.y) < 1.6 && this.rng.chance(0.5)) {
      this.endPlay('tackle', { spotY: p.y, spotX: p.x, slide: true });
      return true;
    }
    return false;
  }

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
  }

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
  }

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
  }

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
  }

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
  }

  // ---------------------------------------------------------------- engagements
  canBeBlocked(d) {
    return !d.blk && d.freeT <= 0 && !d.down && !d.wrapOn && d !== this.ball.holder;
  }

  engage(b, d) {
    const run = this.phase === 'run' || this.offPlay.cat === 'run';
    let dPow;
    let bPow;
    if (b.side === 'O') {
      dPow = run ? d.a.rsd * 0.6 + d.a.str * 0.4 : d.a.prs * 0.6 + d.a.str * 0.25 + d.a.acc * 0.15;
      bPow = run ? b.a.rbk * 0.65 + b.a.str * 0.35 : b.a.pbk * 0.65 + b.a.str * 0.35;
    } else {
      // defenders blocking on an interception return
      dPow = d.a.str * 0.6 + d.a.agi * 0.4;
      bPow = b.a.str * 0.6 + b.a.tkl * 0.4;
    }
    const open = this.phase === 'run' && !!(this.receiver || this.interceptor || (this.carrier && Math.abs(this.carrier.y) > 4));
    const pair = { b, d, t: 0, run, open, w: (dPow - bPow) / 100 + this.rng.normal(0, 0.06) + (open ? 0.08 : 0) };
    b.blk = pair;
    d.blk = pair;
    b.target = d;
    this.blocks.push(pair);
  }

  breakBlock(pair) {
    pair.b.blk = null;
    pair.d.blk = null;
    const i = this.blocks.indexOf(pair);
    if (i >= 0) this.blocks.splice(i, 1);
  }

  defGoal(d) {
    const h = this.ball.holder;
    if (h && h.side !== d.side) return h;
    if (this.ball.state === 'air') return { x: this.ball.tx, y: this.ball.ty, vx: 0, vy: 0 };
    return this.qb;
  }

  updateEngagements(dt) {
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const pair = this.blocks[i];
      const { b, d } = pair;
      pair.t += dt;
      if (b.down || d.down || d === this.ball.holder) { this.breakBlock(pair); continue; }
      const goal = this.defGoal(d);
      let dx = goal.x - d.x;
      let dy = goal.y - d.y;
      const m = Math.hypot(dx, dy) || 1;
      dx /= m; dy /= m;
      const w = pair.w;
      const spd = clamp(0.3 + 2.4 * w, -1.6, 1.7);
      this.accelTo(d, dx * spd, dy * spd, dt, 20);
      // blocker sits between defender and the goal
      const bx = d.x + dx * 0.95;
      const by = d.y + dy * 0.95;
      this.accelTo(b, d.vx + (bx - b.x) * 6, d.vy + (by - b.y) * 6, dt, 30);
      // shed
      const c = this.carrier;
      let rate;
      if (c && c.side !== d.side) {
        const near = dist(d.x, d.y, c.x, c.y) < 2.5;
        rate = near ? 0.3 + 0.8 * clamp(w + 0.3, 0, 1) : 0.05 + 0.25 * clamp(w + 0.35, 0, 1);
      } else {
        rate = 0.07 + 0.45 * clamp(w + 0.35, 0, 1);
      }
      if (pair.open) rate += 0.8;
      if (this.rng.next() < rate * dt) {
        this.breakBlock(pair);
        d.freeT = 0.6;
        b.stunT = 0.45;
        b.target = null;
        this.events.push({ t: this.t, k: 'shed', who: d });
      }
    }
  }

  // ---------------------------------------------------------------- physics
  steer(p, tx, ty, frac, dt, arrive) {
    let dx = tx - p.x;
    let dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    let spd = p.maxSpd * frac * (p.jamT > 0 ? 0.35 : 1);
    if (arrive > 0 && d < arrive) spd *= d / arrive;
    if (d > 1e-4) { dx /= d; dy /= d; } else { dx = 0; dy = 0; }
    this.accelTo(p, dx * spd, dy * spd, dt, p.accel);
  }

  brake(p, dt, decel) {
    this.accelTo(p, 0, 0, dt, decel);
  }

  accelTo(p, tvx, tvy, dt, acc) {
    let ax = tvx - p.vx;
    let ay = tvy - p.vy;
    const m = Math.hypot(ax, ay);
    const lim = acc * dt;
    if (m > lim) { ax = (ax / m) * lim; ay = (ay / m) * lim; }
    p.vx += ax;
    p.vy += ay;
  }

  integrate(dt) {
    for (const p of this.players) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 0.4 && !p.down) {
        const target = Math.atan2(p.vy, p.vx);
        let da = target - p.face;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        p.face += da * Math.min(1, dt * 10);
      }
      p.anim += sp * dt * 2.2;
      p.hi = (p.hi + 1) % HIST;
      p.hist[p.hi * 2] = p.vx;
      p.hist[p.hi * 2 + 1] = p.vy;
    }
    // soft separation so bodies don't overlap
    const P = this.players;
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      if (a.down) continue;
      for (let j = i + 1; j < P.length; j++) {
        const b = P[j];
        if (b.down || (a.blk && a.blk === b.blk)) continue;
        if (a.wrapOn === b || b.wrapOn === a || (a.wrapOn && a.wrapOn === b.wrapOn)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.55 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (0.74 - d) * 0.5;
        const ux = dx / d;
        const uy = dy / d;
        const ha = this.ball.holder === a ? 0.3 : 1;
        const hb = this.ball.holder === b ? 0.3 : 1;
        a.x -= ux * push * ha; a.y -= uy * push * ha;
        b.x += ux * push * hb; b.y += uy * push * hb;
      }
    }
  }

  // ---------------------------------------------------------------- contacts
  checkContacts(dt) {
    // block engagements
    for (const b of this.offense) {
      if (b.blk || b.down || b.stunT > 0 || b === this.ball.holder) continue;
      const t = b.target;
      if (t && this.canBeBlocked(t) && dist(b.x, b.y, t.x, t.y) < 1.15) { this.engage(b, t); continue; }
      if (this.t < 0.15) continue;
      if (b.job.t === 'route' && this.phase !== 'run') continue;
      for (const d of this.defense) {
        if (!this.canBeBlocked(d)) continue;
        if (dist(b.x, b.y, d.x, d.y) < 0.95 && (d.assign.t === 'rush' || d.assign.t === 'blitz' || this.phase === 'run')) { this.engage(b, d); break; }
      }
    }
    if (this.turnover && this.carrier) {
      for (const b of this.defense) {
        if (b.blk || b.down || b === this.carrier || b.stunT > 0) continue;
        const t = b.target;
        if (t && this.canBeBlocked(t) && dist(b.x, b.y, t.x, t.y) < 1.1) this.engage(b, t);
      }
    }

    this.checkTackles(dt);
  }

  fumble(h, why, by) {
    // Recovery: weighted by who's closest. No returns yet.
    const near = this.players.filter((p) => !p.down && p !== h).map((p) => ({ p, d: dist(p.x, p.y, h.x, h.y) })).sort((a, b) => a.d - b.d).slice(0, 4);
    const pick = this.rng.weighted(near, (n) => 1 / (0.5 + n.d));
    const rec = pick ? pick.p : h;
    const lost = rec.side !== h.side;
    this.events.push({ t: this.t, k: 'fumble', who: h, by, rec });
    this.tackler = by || null;
    h.down = true;
    this.fumbled = { by: h, forcedBy: by, recoveredBy: rec, lost, why };
    if (lost && h.side === 'O') this.turnover = true;
    else if (lost && h.side === 'D') this.turnover = false; // offense got it back
    this.endPlay(lost && h.side === 'O' ? 'fumble_lost' : 'tackle', { spotY: h.y, spotX: h.x, fumble: true });
  }

  checkBoundaries() {
    const h = this.ball.holder;
    if (!h || this.ball.state !== 'held') return;
    const offenseBall = h.side === 'O';
    if (offenseBall && h.y >= this.goalY && (this.phase === 'run' || h === this.carrier)) {
      return this.endPlay('td', { spotY: this.goalY, spotX: h.x });
    }
    if (!offenseBall && h.y <= this.ownGoalY) {
      return this.endPlay('td', { spotY: this.ownGoalY, spotX: h.x, defTD: true });
    }
    if (h.x < 0 || h.x > FIELD_W) {
      this.events.push({ t: this.t, k: 'oob', who: h });
      return this.endPlay('oob', { spotY: h.y, spotX: h.x });
    }
  }

  nearest(list, x, y) {
    let best = null;
    let bd = 1e9;
    for (const p of list) {
      if (p.down) continue;
      const d = dist(p.x, p.y, x, y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  nearestFree(list, x, y) {
    let best = null;
    let bd = 1e9;
    for (const p of list) {
      if (p.down || p.blk) continue;
      const d = dist(p.x, p.y, x, y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // ---------------------------------------------------------------- result
  endPlay(outcome, info) {
    if (this.done) return;
    this.done = true;
    if (this.wrap) {
      // a tackle in progress ended at a boundary: out of bounds or in the end zone
      const w = this.wrap;
      if (outcome === 'oob') {
        this.tackler = this.tackler || w.ds[0];
        if (w.kind === 'pushout') this.events.push({ t: this.t, k: 'pushedout', who: w.h, x: w.h.x, y: w.h.y });
      }
      for (const d of w.ds) d.wrapOn = null;
      this.wrap = null;
    }
    const offense = !this.turnover;
    let spotY = info.spotY;
    let kind = this.offPlay.cat === 'run' ? 'run' : 'pass';
    if (this.scramble) kind = 'scramble';
    if (outcome === 'sack') kind = 'sack';
    if (outcome === 'kneel') kind = 'kneel';
    if (outcome === 'spike') kind = 'spike';

    let safety = false;
    let td = outcome === 'td';
    let defTD = !!info.defTD;
    let touchback = outcome === 'touchback';
    if (offense && (outcome === 'tackle' || outcome === 'sack' || outcome === 'oob') && spotY <= this.ownGoalY) safety = true;
    if (!offense && outcome !== 'td' && spotY >= this.goalY) touchback = true;
    if (outcome === 'fumble_lost' && spotY >= this.goalY) touchback = true;

    const res = {
      outcome,
      kind,
      yards: offense ? Math.round(spotY) : 0,
      spotY,
      spotX: info.spotX,
      turnover: this.turnover || outcome === 'fumble_lost',
      interception: !!this.interceptor,
      td,
      defTD,
      safety,
      touchback,
      incomplete: outcome === 'incomplete' || outcome === 'spike',
      why: info.why,
      outOfBounds: outcome === 'oob',
      slide: !!info.slide,
      elapsed: this.t,
      passer: (this.passer || (this.offPlay.cat !== 'run' || this.scramble ? this.qb : null))?.rec,
      target: this.ball.target?.rec,
      receiver: this.receiver?.rec,
      rusher: this.rusher?.rec,
      tackler: this.tackler?.rec,
      assist: this.assist?.rec,
      interceptor: this.interceptor?.rec,
      defender: info.defender?.rec,
      fumble: this.fumbled ? { by: this.fumbled.by.rec, forcedBy: this.fumbled.forcedBy?.rec, recoveredBy: this.fumbled.recoveredBy.rec, lost: this.fumbled.lost } : null,
      airYards: this.airYards != null ? Math.round(this.airYards) : null,
      catchY: this.catchY,
      evCounts: this.events.reduce((m, e) => ((m[e.k] = (m[e.k] || 0) + 1), m), {}),
      offPlay: this.offPlay.id,
      defPlay: this.defPlay.id,
    };
    // Yards for turnovers: where the ball ends up, measured in the original
    // offense's frame (spotY relative to old LOS).
    this.result = res;
  }
}

Object.assign(PlaySim.prototype, contactMethods, celebrateMethods);

const LOOKS = [[1.5, 1.4], [3.5, 1.0], [6, 0.6]];

export function simulatePlay(opts) {
  const sim = new PlaySim(opts);
  return sim.runToEnd();
}
