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
import { passingMethods } from './passing.js';
import { offenseMethods } from './offense.js';
import { defenseMethods } from './defense.js';
import { foulMethods } from './fouls.js';
import { blockingMethods } from './blocking.js';
import { catchingMethods } from './catching.js';
import { Crew } from './officials.js';
import { BACK_ROOM, laneFor } from './routes.js';

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
    move: null, diveT: 0, diving: null, wrapOn: null, cheer: false, celeb: null, hidden: false,
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
    this.endY = this.goalY + 10; // the end line at the back of the end zone
    this.backY = this.endY - BACK_ROOM; // as deep as a receiver works
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
    this.fouls = [];
    this.setup();
    this.crew = new Crew(this, !!opts.umpireDefense);
    if (opts.preFoul) this.setupPreFoul(opts.preFoul);
    if (opts.snapFoul) this.setupSnapFoul(opts.snapFoul);
  }

  // ---------------------------------------------------------------- setup
  setup() {
    const { offPlay, defPlay, offLineup, defLineup, rng } = this.opts;
    const ballX = this.ballX;
    this.offAlign = alignOffense(offPlay.formation, ballX);
    const dal = alignDefense(defPlay, this.offAlign, ballX, this.goalY);
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
    // a draw: the line shows pass, the back gets it late
    this.isDraw = this.offense.some((p) => p.job.t === 'draw');
    for (const d of Object.values(this.defAlign)) {
      const e = mkEnt(defLineup[d.slot], 'D', d.slot, d.pos, d.x, d.y);
      e.assign = d.assign;
      e.readDelay = 0.12 + (100 - e.a.awr) / 280 + (d.pos === 'CB' ? 0.35 : d.pos === 'S' ? 0.15 : 0);
      e.ballReact = 0.14 + (100 - e.a.awr) / 380;
      if (offPlay.pa && (d.pos === 'LB' || d.pos === 'S')) e.paFooled = rng.chance(0.8 - e.a.awr / 200);
      // linebackers and box safeties key the linemen: run blocking fires
      // forward, pass protection sets back (a draw fools most of them)
      // (a deep safety reads it too, a little less often, and comes down
      // into the alley rather than the hole)
      if (offPlay.cat === 'run' && (d.pos === 'LB' || d.pos === 'S')) {
        const deep = d.pos === 'S' && d.y >= 8.5;
        e.readsRun = rng.chance(this.isDraw ? 0.1 + e.a.awr / 500 : deep ? 0.45 + e.a.awr / 300 : 0.5 + e.a.awr / 250);
      }
      this.defense.push(e);
    }
    // the men setting the edge: the widest of the front on each side
    for (const side of [-1, 1]) {
      let edge = null;
      for (const e of this.defense) {
        if (e.y > 2 || (e.pos !== 'DL' && e.pos !== 'LB') || (e.x - ballX) * side < 0) continue;
        if (!edge || (e.x - ballX) * side > (edge.x - ballX) * side) edge = e;
      }
      if (edge) edge.edge = side;
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
      if (j.t === 'route' || j.t === 'chkrel') {
        const rp = routePoints(p, j.r, j.side, ballX, j.pts);
        // near the goal line a route runs out of field at the back of the
        // end zone: it ends along the end line
        // (the sideline he'd turn up keeps to the route as drawn)
        const n = rp.pts.length;
        const a = n > 1 ? rp.pts[n - 2] : p;
        p.routeLane = laneFor(rp.pts[n - 1].x - a.x, rp.pts[n - 1].y - a.y);
        for (const q of rp.pts) if (q.y > this.backY) { q.y = this.backY; q.back = true; }
        p.pts = rp.pts;
        p.routeEnd = rp.end;
        if (j.t === 'route') p.released = true;
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
      this.carrier = qb;
      this.phase = 'run';
      this.runT = 0;
      this.rusher = qb;
    }

    // Initial pass-pro / run-block targets
    this.assignInitialBlocks();
  }

  // ---------------------------------------------------------------- main loop
  step() {
    if (this.done) return;
    const dt = DT;
    this.t += dt;
    if (this.preFoul) return this.stepPreFoul(dt);
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
    this.checkSnapFoul();
    this.checkCoverageHolds();
    this.checkLateHits();
    this.crew.update(dt);
    this.checkBoundaries();
    if (!this.done && this.t > MAX_TIME) {
      const h = this.ball.holder;
      this.endPlay(h ? 'tackle' : 'incomplete', { spotY: h ? h.y : 0, spotX: h ? h.x : this.ballX });
    }
  }

  // A foul before the snap (decided by the rules engine): the guilty
  // player moves early, the official throws the flag, the whistle blows.
  setupPreFoul(pf) {
    const rng = this.rng;
    let who;
    if (pf.key === 'falseStart') {
      const cands = this.offense.filter((p) => p.pos === 'OL' || p.pos === 'TE' || (p.pos === 'WR' && p.y > -1.2));
      who = rng.pick(cands.length ? cands : this.offense);
    } else {
      const cands = this.defense.filter((p) => p.pos === 'DL' || (p.pos === 'LB' && p.y < 2.5));
      who = rng.pick(cands.length ? cands : this.defense);
    }
    this.preFoul = { ...pf, who, flagged: false };
    this.ball.state = 'snap';
    this.ball.T = 99;
  }

  // A live-ball foul at the snap: offside (a lineman jumps early and is in
  // the neutral zone when the ball is snapped) or twelve men on the field.
  // The play runs; the offense takes the better of the play and the flag.
  setupSnapFoul(sf) {
    let who = null;
    if (sf.key === 'offside') {
      const cands = this.defense.filter((p) => p.pos === 'DL' || (p.pos === 'LB' && p.y < 2.5));
      who = this.rng.pick(cands.length ? cands : this.defense);
      who.y = Math.max(0.15, who.y - 0.9); // he's across the line as it's snapped
      who.freeT = 0.3;
    } else if (sf.key === 'formation') {
      // a receiver who should be on the line set a step off it (or vice versa)
      const wide = this.offense.filter((p) => p.pos === 'WR' || p.pos === 'TE');
      who = wide.length ? this.rng.pick(wide) : null;
    }
    this.snapFoul = { ...sf, who, flagged: false };
  }

  checkSnapFoul() {
    const sf = this.snapFoul;
    if (!sf || sf.flagged || this.t < 0.12) return;
    sf.flagged = true;
    const x = sf.who ? sf.who.x : this.ballX;
    this.flag(sf.key, sf.who, x, sf.who ? sf.who.y : 1);
  }

  stepPreFoul(dt) {
    const pf = this.preFoul;
    const p = pf.who;
    const t = this.t;
    if (t < 0.32) {
      // the flinch: a lineman jumps forward, a defender crosses the line
      const dir = p.side === 'O' ? 1 : -1;
      const reach = pf.key === 'falseStart' ? 0.5 : 1.6;
      p.vy = t < 0.16 ? dir * reach * 6 : 0;
      p.y += p.vy * dt;
      p.flinch = true;
    } else if (pf.key !== 'falseStart' && t < 0.9) {
      // he scrambles back to his side
      p.vy = (p.sy - p.y) * 4;
      p.y += p.vy * dt;
    } else p.vy = 0;
    // the other side reacts
    if (t > 0.12 && t < 0.4) {
      for (const o of this.players) {
        if (o.side === p.side || Math.abs(o.x - p.x) > 4 || o.pos !== 'OL' && o.pos !== 'DL') continue;
        o.flinch = true;
      }
    }
    if (!pf.flagged && t > 0.18) {
      pf.flagged = true;
      this.flag(pf.key, p, p.x, p.side === 'O' ? 0.2 : -0.2);
    }
    this.crew.update(dt);
    if (t > 1.1) this.endPlay('dead', { spotY: 0, spotX: this.ballX });
  }

  // Animation clock: play time, then time since the whistle.
  clock() {
    return this.t + (this.post ? this.post.t : 0);
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
      b.z = 1.8 + 4 * b.peak * u * (1 - u) + ((b.tz ?? 1.2) - 1.8) * u;
      if (u >= 1) {
        if (b.state === 'pitch') this.completePitch();
        else this.resolveCatch();
      }
    }
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

  // ---------------------------------------------------------------- QB
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
    // open-field blocking: after a catch or a turnover, or a runner well
    // past the line (not one still deep in the backfield)
    const open = this.phase === 'run' && !!(this.receiver || this.interceptor || (this.carrier && this.carrier.side === 'O' && this.carrier.y > 4));
    // a lineman climbing to a linebacker in space has the harder job: a
    // quick linebacker who sees him coming slips him altogether
    const level2 = run && b.side === 'O' && d.pos !== 'DL' && d.y > 1.5 && b.pos === 'OL';
    // a reach block (the man's already playside of him on a run going
    // wide) is the hardest block there is
    const dir = this.offPlay.dir || 0;
    const reach = run && b.side === 'O' && dir && (d.x - b.x) * dir > 0.6 && this.offPlay.cat === 'run';
    if (level2 && this.rng.chance(clamp(0.2 + (d.a.agi - b.a.agi) / 250 + (d.a.awr - 70) / 400, 0.1, 0.45))) {
      d.freeT = 0.45;
      b.stunT = 0.3;
      b.target = null;
      this.events.push({ t: this.t, k: 'shed', who: d });
      return;
    }
    const pair = { b, d, t: 0, run, open, level2, w: (dPow - bPow) / 100 + this.rng.normal(0, 0.06) + (open ? 0.08 : 0) + (level2 ? 0.12 : 0) + (reach ? 0.12 : 0) };
    // leverage: the side of him the blocker got to (0 square on him)
    pair.lev = Math.abs(b.x - d.x) > 0.3 ? Math.sign(b.x - d.x) : 0;
    d.engaged = true;
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
    // a draw: the line invites the rush upfield and wide of the passer
    if (h === this.qb && d.blk && d.blk.b.job?.t === 'draw' && this.phase === 'pre') {
      const side = Math.sign(d.x - h.x) || 1;
      return { x: h.x + side * 3.6, y: h.y - 1.2, vx: 0, vy: 0 };
    }
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
      // a screen: the line lets its men go and gets out in front
      if (b.job?.t === 'screenOL' && this.phase === 'pre' && this.t > 0.95) {
        this.breakBlock(pair);
        d.freeT = 0.4;
        b.target = null;
        continue;
      }
      const goal = this.defGoal(d);
      let dx = goal.x - d.x;
      let dy = goal.y - d.y;
      const m = Math.hypot(dx, dy) || 1;
      dx /= m; dy /= m;
      const w = pair.w;
      const spd = clamp(0.3 + 2.4 * w, -1.6, 1.7);
      let vx = dx * spd;
      let vy = dy * spd;
      if (pair.run && goal === this.carrier && (b.job?.t === 'pull' || b.job?.t === 'lead') && d.edge) {
        // a kick-out: the puller or lead back hits the end man from the
        // inside and drives him out of the hole
        vx = d.edge * clamp(1.2 - 3 * w, -0.4, 2);
        vy = Math.min(vy, 0.2);
      } else if (pair.run && goal === this.carrier) {
        // against the run he works down the line with the ball, riding the
        // blocker, easier sideways than straight ahead; but not across the
        // blocker's face: with the runner on the blocker's side of him he's
        // walled off, and only a man who's winning the block works through
        const gx = goal.x - d.x;
        const walled = pair.lev && Math.sign(gx) === pair.lev && Math.abs(gx) > 0.5;
        const lat = walled ? clamp(0.2 + 2 * w, 0, 1.4) : clamp(1.0 + 3 * w, 0, 2.6);
        vx = Math.abs(gx) < 0.3 ? vx : Math.sign(gx) * Math.max(Math.abs(vx), Math.min(lat, Math.abs(gx) * 3));
      }
      this.accelTo(d, vx, vy, dt, 20);
      // blocker sits between defender and the goal
      const kick = pair.run && goal === this.carrier && (b.job?.t === 'pull' || b.job?.t === 'lead') && d.edge;
      const bx = d.x + (kick ? -d.edge * 0.8 : pair.run && goal === this.carrier ? (pair.lev || Math.sign(goal.x - d.x)) * 0.6 : dx * 0.95);
      const by = d.y + dy * 0.95;
      this.accelTo(b, d.vx + (bx - b.x) * 6, d.vy + (by - b.y) * 6, dt, 30);
      // shed
      const c = this.carrier;
      let rate;
      if (c && c.side !== d.side) {
        const dc = dist(d.x, d.y, c.x, c.y);
        if (dc < 2.5) {
          // the runner coming by: a blocker in the way (leverage) holds him
          // far better than one the runner's going past on the open side
          const sealed = ((b.x - d.x) * (c.x - d.x) + (b.y - d.y) * (c.y - d.y)) / (dc || 1) > 0.3;
          rate = sealed ? 0.25 + 0.6 * clamp(w + 0.3, 0, 1) : 0.6 + 1.2 * clamp(w + 0.3, 0, 1);
          // blocks in space don't hold for long once the runner's there: a
          // linebacker fighting off a lineman, a corner off a receiver
          if (pair.level2) rate *= 2.5;
          else if (b.pos === 'WR') rate *= 2;
          else if (c.y < 0.5) rate *= 0.65; // a lineman at the point of attack, the back still behind the line
          else if (!pair.run && sealed) rate *= 0.5; // a pass blocker riding him past the scrambling passer
        } else rate = 0.12 + 0.36 * clamp(w + 0.35, 0, 1);
      } else if (b.job?.t === 'draw' || (pair.run && this.offPlay.cat === 'run')) {
        // a draw's line sits and invites the rush rather than battling it;
        // a run block before the handoff is a run block, not pass pro
        rate = 0.12 + 0.36 * clamp(w + 0.35, 0, 1);
      } else {
        // a pass rusher works his moves: the longer the block goes on, the
        // likelier he wins it
        rate = (0.08 + 0.58 * clamp(w + 0.35, 0, 1)) * (0.6 + 0.5 * Math.min(pair.t, 2));
      }
      if (pair.open) rate += 0.8;
      if (this.rng.next() < rate * dt) {
        this.onShed(pair);
        this.breakBlock(pair);
        d.freeT = 0.6;
        b.stunT = 0.45;
        b.target = null;
        this.events.push({ t: this.t, k: 'shed', who: d });
        // off the block with the runner right there: he gets a hand on him
        if (c && c === this.ball.holder && c.side !== d.side && !this.wrap && !c.down && dist(d.x, d.y, c.x, c.y) < 1.7 && d.tackleCD <= 0) {
          if (this.tryTackle(d, c)) return;
        }
      }
    }
  }

  // ---------------------------------------------------------------- physics
  // accMul: a defensive back breaking on a cut or a throw plants and
  // drives harder than a player just running
  steer(p, tx, ty, frac, dt, arrive, accMul = 1) {
    // nobody without the ball has a reason to run out the back of the end
    // zone: he pulls up short of the end line in time to stop
    let brake = false;
    if (this.ball.holder !== p) {
      const cap = this.endY - 0.5;
      if (ty > cap) ty = cap;
      brake = p.vy > 0 && p.y + (p.vy * p.vy) / (2 * p.accel * accMul) > cap;
    }
    let dx = tx - p.x;
    let dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    let spd = p.maxSpd * frac * (p.jamT > 0 ? 0.35 : 1);
    if (arrive > 0 && d < arrive) spd *= d / arrive;
    if (d > 1e-4) { dx /= d; dy /= d; } else { dx = 0; dy = 0; }
    if (brake) {
      // stopping comes first; he steers sideways with what's left
      p.vy = Math.max(0, p.vy - p.accel * accMul * dt * 1.2);
      return this.accelTo(p, dx * spd, Math.min(p.vy, dy * spd), dt, p.accel * accMul * 0.5);
    }
    this.accelTo(p, dx * spd, dy * spd, dt, p.accel * accMul);
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
      // eyes on the passer (a zone defender dropping): he faces him rather
      // than the way he's going, unless he's turned and running flat out
      const eyes = p.eyesAt === this.t && sp < 6.2 && this.qb;
      if (eyes && !p.down) {
        const target = Math.atan2(this.qb.y - p.y, this.qb.x - p.x);
        let da = target - p.face;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        p.face += da * Math.min(1, dt * 10);
      } else if (sp > 0.4 && !p.down) {
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
      // a run blocker with a man to get to goes to him rather than taking
      // whoever he brushes past
      if (t && this.canBeBlocked(t) && this.offPlay.cat === 'run' && this.t - (this.runT || 0) < 1.2) continue;
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
    h.fallAt = this.clock();
    this.fumbled = { by: h, forcedBy: by, recoveredBy: rec, lost, why };
    if (lost && h.side === 'O') this.turnover = true;
    else if (lost && h.side === 'D') this.turnover = false; // offense got it back
    this.endPlay(lost && h.side === 'O' ? 'fumble_lost' : 'tackle', { spotY: h.y, spotX: h.x, fumble: true });
  }

  checkBoundaries() {
    const h = this.ball.holder;
    if (!h || this.ball.state !== 'held') return;
    const offenseBall = h.side === 'O';
    // a touchdown is the ball breaking the plane: it's carried a little in
    // front of him, and a runner going down near the line reaches it out
    const reach = this.wrap && this.wrap.h === h ? 0.7 : 0.35;
    if (offenseBall && h.y + reach >= this.goalY && (this.phase === 'run' || h === this.carrier)) {
      return this.endPlay('td', { spotY: this.goalY, spotX: h.x });
    }
    if (!offenseBall && h.y - reach <= this.ownGoalY) {
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
    if (!this.preFoul) this.checkLateHitAfterWhistle(outcome, this.ball.holder);
    if (outcome === 'td' && this.wrap) this.tdContact = true; // in as he was being tackled
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
    // brought down (or stripped, whoever recovered) before he threw it
    if (kind === 'pass' && !this.passer && !this.receiver && outcome !== 'incomplete' && outcome !== 'spike' && outcome !== 'td') kind = 'sack';
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
      passer: (this.passer || (this.offPlay.cat !== 'run' || this.scramble || outcome === 'sack' ? this.qb : null))?.rec,
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
      // what the officials have to judge (src/game/replay.js)
      review: {
        sideline: !!this.sidelineTry,
        dive: !!(this.receiver && this.catchInfo && this.catchInfo.kind === 'catch' && (this.catchInfo.reach > 1.35 || this.receiver.diving)),
        tdContact: !!this.tdContact,
        ball: this.catchInfo ? { x: this.catchInfo.bx, y: this.catchInfo.by } : null,
      },
      firstDown: offense && !td && this.opts.toGo != null && spotY >= this.opts.toGo && outcome !== 'incomplete',
      fouls: this.foulsOut(),
      evCounts: this.events.reduce((m, e) => ((m[e.k] = (m[e.k] || 0) + 1), m), {}),
      offPlay: this.offPlay.id,
      defPlay: this.defPlay.id,
    };
    // Yards for turnovers: where the ball ends up, measured in the original
    // offense's frame (spotY relative to old LOS).
    this.result = res;
  }
}

Object.assign(PlaySim.prototype, contactMethods, celebrateMethods, passingMethods, catchingMethods, foulMethods, offenseMethods, defenseMethods, blockingMethods);


export function simulatePlay(opts) {
  const sim = new PlaySim(opts);
  return sim.runToEnd();
}
