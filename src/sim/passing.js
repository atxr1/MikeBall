// The passing game, mixed into PlaySim: the quarterback's drop, reads and
// decision, the throw (aimed away from the closest defender, with an error
// that grows with distance, pressure, throwing on the move or across his
// body, or getting hit as he lets go). What happens when the ball gets
// there is src/sim/catching.js.
//
// With opts.manualPass (the optional Retro Bowl-style control) the
// quarterback still drops and moves in the pocket, but he doesn't read or
// throw on his own: the player aims a spot with userThrow(x, y) and the ball
// goes there, with the passer's own error on top.
//
// No DOM here; every random draw comes from the sim's seeded RNG.

import { FIELD_W, clamp, dist } from '../core/util.js';
import { pocketPressure, throwError, looking } from './odds.js';
import { SIDE_LANE, laneFor, alongRoute, SETTLE_FRAC, settleStep } from './routes.js';

// How open the window looks to the passer, 0-1, from openness() (yards of
// room the closest defender can't make up while the ball's in the air).
export const windowOpen = (o) => 1 / (1 + Math.exp(-(o - 1.0) / 0.55));

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
      p.dropY = gun ? p.sy - (drop === 3 ? 0.5 : drop === 5 ? 1.4 : 2.4) : -(drop === 3 ? 4.0 : drop === 5 ? 6.0 : 7.6);
      p.qbState = play.pa ? 'fake' : 'drop';
      p.decT = 0;
    }
    // Wind-up: the ball isn't out yet, so the QB can still be hit. (A
    // player aiming his own throws can let it go during the drop.)
    if (p.pending) {
      if (this.t >= p.pending.at) {
        const pd = p.pending;
        p.pending = null;
        if (pd.away) this.throwAwayNow(p, pd.grounding);
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
      // the drop takes the time it takes (footwork, eyes downfield): he
      // paces it to reach his depth as the drop's steps finish
      const gun = p.sy < -2.5;
      const drop = play.drop || 5;
      const dropT = gun ? (drop === 3 ? 0.75 : drop === 5 ? 1.15 : 1.45) : drop === 3 ? 0.9 : drop === 5 ? 1.35 : 1.75;
      const left = Math.abs(p.dropY - p.y);
      const frac = clamp(left / (Math.max(0.15, dropT - this.t) * p.maxSpd) + 0.1, 0.3, 0.85);
      this.steer(p, this.ballX, p.dropY, frac, dt, 0.4);
      // a free blitzer: he sets up short and gets it out hot
      const hot = this.hotRusher(p);
      if (hot && !this.opts.manualPass && dist(hot.x, hot.y, p.x, p.y) < 5.5 && this.t > 0.45) {
        p.qbState = 'set';
        p.setT = this.t;
        p.hot = hot;
        return;
      }
      if (Math.abs(p.y - p.dropY) < 0.35 && this.t > dropT - 0.1) {
        // the hitch at the top of the drop: plant and gather before the
        // first throw (a quick drop is a quick hitch)
        p.qbState = 'set';
        p.setT = this.t + (drop === 3 ? 0.12 : drop === 5 ? 0.25 : 0.32);
      }
      return;
    }
    // Set in the pocket: read and decide.
    const tSet = this.t - p.setT;
    // he feels the rush a beat after it's there (sooner if he's poised),
    // and later still from his blind side (pressureOn)
    const felt = this.pressureOn(p);
    p.feltP = (p.feltP || 0) + (felt - (p.feltP || 0)) * Math.min(1, dt * (2.5 + p.a.awr / 40));
    const pressure = p.feltP;
    // a free rusher about to get him: he may dump it rather than eat it
    if (!p.dumpTried && tSet > 0.6 && !this.opts.manualPass) {
      const f = this.nearestFree(this.defense, p.x, p.y);
      if (f && dist(f.x, f.y, p.x, p.y) < 2.4 && f.y < p.y + 3) {
        p.dumpTried = true;
        if (this.legalThrowAway(p)) {
          if (this.rng.chance(0.2 + p.a.dec / 500)) {
            p.pending = { away: true, at: this.t + 0.05 };
            return;
          }
        } else if (this.rng.chance(clamp((100 - p.a.dec) / 70, 0.12, 0.55))) {
          // nowhere legal to throw it and about to be sacked: a panicky
          // passer throws it into the turf anyway (intentional grounding)
          p.pending = { away: true, grounding: true, at: this.t + 0.05 };
          return;
        }
      }
    }
    // pocket movement: slide away from the nearest free rusher
    const threat = this.nearestFree(this.defense, p.x, p.y);
    let mx = this.ballX;
    let my = p.dropY + clamp(tSet * 0.6, 0, 1.2);
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

    // Reads: he's on one receiver at a time, in the play's order, and stays
    // with him until that route has made its break and he's seen whether
    // it's open, then moves his eyes on (a smart passer moves on sooner).
    // Anyone he's already looked at is still a throw if he comes open.
    const idx = this.advanceRead(p, tSet, pressure, dt);
    // Under fire with nobody clearly open, he may escape first: a mobile
    // passer takes off through a lane, a smart one throws it away rather
    // than take the sack (decided a few times a second).
    p.escT = (p.escT ?? 0) - dt;
    let escape = false;
    const patience = 2.0 + p.a.dec / 100; // how long he'll stand there with no one open
    if ((pressure > 0.5 || tSet > patience) && p.escT <= 0) {
      p.escT = 0.25;
      escape = true;
    }
    // an unblocked rusher: throw hot, to whoever's quickest open
    const hot = p.hot || (tSet > 0.05 ? this.hotRusher(p) : null);
    if (hot) {
      p.hot = hot;
      const r = this.hotThrow(p);
      if (r) return this.throwTo(p, r, pressure);
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
        const late = tSet > 1.6 + (100 - p.a.dec) / 150 || idx >= this.progression.length - 1;
        if (i > idx && !(checkdown && (late || pressure > 0.45)) && !this.inView(p, this.progression[idx], r)) continue;
        const o = this.openness(p, r);
        if (o < -50) continue;
        const pe = windowOpen(o);
        // going back to a read he's left takes a bigger window; a shot deep
        // is worth giving his man a chance on
        const L = this.leadPoint(p, r);
        if (pe < need + (i < idx ? 0.06 : 0) - (L.y > 16 ? 0.05 : 0)) continue;
        // he weighs what it gains against how likely it's caught: an open
        // man deep is still a long throw
        const pc = pe * this.catchable(p, dist(p.x, p.y, L.x, L.y));
        const v = pc * (Math.min(Math.max(L.y, 0), 25) * 0.55 + 7) - (1 - pc) * 4 - Math.abs(i - idx) * 0.4;
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
      if (tSet > 3.6 && this.rng.chance(0.45)) {
        if (this.legalThrowAway(p)) return this.throwAway(p);
        // nobody out there and the pocket's caving in: some passers just
        // get rid of it anyway
        if (pressure > 0.6 && this.rng.chance(clamp((88 - p.a.dec) / 150, 0.05, 0.3))) {
          p.pending = { away: true, grounding: true, at: this.t + 0.1 };
          return;
        }
      }
      if (this.rng.chance(0.25)) this.escape(p, pressure, tSet);
    }
  },

  // A rusher coming at the passer that no blocker has (he can see it pre-
  // throw: a blitz the protection didn't account for).
  hotRusher(p) {
    if (this.t < 0.4) return null; // the line hasn't sorted itself out yet
    for (const d of this.defense) {
      // (one who beat his block is pressure, not a hot read)
      if (d.down || d.blk || d.engaged || d.freeT > 0 || d.y > 1.5 || d.y < p.y - 1) continue;
      const dq = dist(d.x, d.y, p.x, p.y);
      if (dq > 7) continue;
      // coming at him, not dropping
      const to = ((p.x - d.x) * d.vx + (p.y - d.y) * d.vy) / dq;
      if (to < 2) continue;
      // nobody on him or about to be: no blocker has him, none in his path
      let picked = false;
      for (const o of this.offense) {
        if (o === p || o.down) continue;
        if (o.target === d) { picked = true; break; }
        const u = ((o.x - d.x) * (p.x - d.x) + (o.y - d.y) * (p.y - d.y)) / (dq * dq);
        if (u > 0 && u < 1) {
          const px = d.x + (p.x - d.x) * u;
          const py = d.y + (p.y - d.y) * u;
          if (dist(px, py, o.x, o.y) < 1.0 && o.pos === 'OL' && !o.blk) { picked = true; break; }
        }
      }
      if (!picked) return d;
    }
    return null;
  },

  // Vs. a free rusher: the receiver he can get it to right now. Any route
  // that's released counts (the hot route is the quickest one), the
  // window just has to be there.
  hotThrow(p) {
    let best = null;
    let bv = -1e9;
    for (const r of this.eligible) {
      if (r.down || r.blk || !r.released || r.jamT > 0) continue;
      const L = this.leadPoint(p, r);
      if (L.y < p.y - 0.5 || L.T > 1.1) continue;
      let o = 99;
      for (const d of this.defense) {
        if (d.down || d.blk) continue;
        const dd = this.reachGap(p, d, L);
        if (dd < o) o = dd;
      }
      const pe = windowOpen(o);
      if (pe < 0.55) continue;
      const v = pe * (Math.min(Math.max(L.y, 0), 15) * 0.4 + 6);
      if (v > bv) { bv = v; best = r; }
    }
    return best;
  },

  // Has this route made its break (or nearly, for a passer who throws on
  // timing)? Before then the throw would be into the stem of the route.
  routeReady(p, r) {
    if (!r.pts || this.offPlay.screen) return true;
    // a route that just goes: once he's cleared the underneath coverage
    const last = r.pts[r.pts.length - 1];
    const prev = r.pts.length > 1 ? r.pts[r.pts.length - 2] : { x: r.sx, y: r.sy };
    // (near the goal line, once he's into the end zone)
    const straight = last.y - prev.y > 6 && Math.abs(last.x - prev.x) < (last.y - prev.y) * 0.35;
    if (r.routeEnd !== 'sit' && straight && r.wp >= r.pts.length - 1) return r.y > Math.min(10.5, Math.max(2.5, this.goalY + 0.5));
    if (r.pts.length < 2) return true;
    if (r.wp >= r.pts.length - 1) return true;
    if (r.wp === r.pts.length - 2) {
      // anticipation: the ball comes out as he gets into his break
      const tp = r.pts[r.wp];
      const lead = 0.6 + Math.max(0, p.a.dec - 70) * 0.04;
      return dist(r.x, r.y, tp.x, tp.y) < lead;
    }
    return false;
  },

  // Is receiver r in the passer's eye line while he's looking at his read
  // (two routes at the same level in the same window, like two seams read
  // off one safety)? A route underneath is a different read.
  inView(p, read, r) {
    if (!read || read === r || !r.pts || !read.pts) return false;
    if (Math.abs(r.pts[r.pts.length - 1].y - read.pts[read.pts.length - 1].y) > 5 || !this.routeReady(p, r)) return false;
    const a = Math.atan2(read.y - p.y, read.x - p.x);
    const b = Math.atan2(r.y - p.y, r.x - p.x);
    return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.42;
  },

  // The read he's on (an index into the progression), moving on when he's
  // seen the route break and it isn't there, or he's waited long enough.
  advanceRead(p, tSet, pressure, dt) {
    const prog = this.progression;
    if (!p.read) p.read = { i: 0, onT: 0, covered: 0 };
    const R = p.read;
    R.onT += dt;
    while (R.i < prog.length - 1) {
      const r = prog[R.i];
      // nothing to read: he's blocking, down, or never released
      if (!r || r.down || r.blk || !r.released || !r.pts) { R.i++; R.onT = 0; R.covered = 0; continue; }
      break;
    }
    const r = prog[R.i];
    if (R.i < prog.length - 1 && r) {
      const ready = this.routeReady(p, r);
      if (ready) {
        R.readyT = (R.readyT || 0) + dt;
        const pe = windowOpen(this.openness(p, r));
        R.covered = pe < 0.7 ? R.covered + dt : 0;
      }
      const look = 0.18 + (100 - p.a.dec) / 280; // how long he needs to see it's covered
      const wait = 1.1 - pressure * 0.5; // how long he'll stay on a route that's there to be read
      // a route still in its stem while the next one's already ready: he
      // doesn't stare at it
      const nextReady = !ready && R.onT > 0.6 && prog[R.i + 1] && this.routeReady(p, prog[R.i + 1]);
      if ((ready && (R.covered > look || R.readyT > wait)) || nextReady || R.onT > 2.2) { R.i++; R.onT = 0; R.covered = 0; R.readyT = 0; }
    }
    return R.i;
  },

  // Take off, or throw it away. Returns true if he did either.
  escape(p, pressure, tSet) {
    const mob = clamp((p.a.spd - 55) / 35, 0, 1);
    // the pocket's collapsing, or the coverage has everyone blanketed
    const scr = pressure > 0.5 ? 0.09 + 0.35 * mob : 0.12 + 0.35 * mob;
    const free = this.nearestFree(this.defense, p.x, p.y);
    const room = !free || dist(free.x, free.y, p.x, p.y) > 3.2; // nobody about to grab him
    const lane = room && this.rng.chance(scr) ? this.scrambleLane(p, free) : null;
    if (lane) {
      // up through the gap he saw, or out of the pocket and around the
      // edge, before he picks his way
      p.lane = lane;
      this.startScramble(p);
      return true;
    }
    if (pressure > 0.5 && tSet > 0.9 && this.legalThrowAway(p) && this.rng.chance(0.2 + p.a.dec / 500)) { this.throwAway(p); return true; }
    return false;
  },

  // Throwing it away without intentional grounding (Rule 8-2-1): out of the
  // tackle box, or toward a receiver in the area (at a back's feet).
  legalThrowAway(p) {
    if (Math.abs(p.x - this.ballX) > 4.5) return true;
    for (const r of this.offense) {
      if (r.down || r.blk || (r.pos !== 'WR' && r.pos !== 'TE' && r.pos !== 'RB')) continue;
      if (dist(r.x, r.y, p.x, p.y) < 5.5) return true;
    }
    return false;
  },

  // How often this passer puts the ball where an open man can catch it at
  // this range (yards from him to the catch point): a long ball is caught
  // far less often even when the receiver's open.
  catchable(qb, range) {
    const k = 1.45 - qb.a.tha / 200; // 1 for a 90 passer
    return clamp(0.97 - Math.max(0, range - 12) * 0.026 * k, 0.25, 0.97);
  },

  // How hard he's being rushed, 0-1, as he sees it: the closest rusher
  // (a blocked one counts for less), and one coming from behind where he's
  // looking (his current read) is felt later.
  pressureOn(qb) {
    const read = this.progression[qb.read ? qb.read.i : 0];
    let ex = 0;
    let ey = 1;
    if (read) {
      const m = Math.hypot(read.x - qb.x, read.y - qb.y) || 1;
      ex = (read.x - qb.x) / m;
      ey = (read.y - qb.y) / m;
    }
    let m = 9;
    for (const d of this.defense) {
      if (d.down) continue;
      const dq = dist(d.x, d.y, qb.x, qb.y);
      let dd = dq - (d.blk ? 1.4 : 0);
      if (((d.x - qb.x) * ex + (d.y - qb.y) * ey) / (dq || 1) < -0.15) dd += 0.9;
      if (dd < m) m = dd;
    }
    return clamp((3.2 - m) / 2.2, 0, 1);
  },

  // Where a scrambling passer can go: straight up through a gap in the
  // line, or out of the pocket around either end (away from the rush
  // first). The way there and the first yards beyond it have to be clear:
  // no free defender close, no blocked bodies in the path. Returns the
  // spot to get to, or null.
  scrambleLane(qb, threat) {
    const up = this.laneOpen(qb, 10);
    if (up === 0) return { x: qb.x, y: 1 };
    const away = threat ? Math.sign(qb.x - threat.x) || 1 : 1;
    for (const side of [away, -away]) {
      // out of the pocket and up at an angle, not flat along the line
      const tx = clamp(this.ballX + side * 6, 2.5, FIELD_W - 2.5);
      const ty = Math.min(qb.y + 3.5, -0.5);
      if (this.pathClear(qb.x, qb.y, tx, ty) && this.pathClear(tx, ty, tx + side * 1.5, 4)) return { x: tx, y: ty, edge: true };
    }
    return up != null ? { x: clamp(qb.x + up, 2, FIELD_W - 2), y: 1 } : null;
  },

  pathClear(x0, y0, x1, y1) {
    const lx = x1 - x0;
    const ly = y1 - y0;
    const len2 = lx * lx + ly * ly || 1;
    for (const d of this.defense) {
      if (d.down) continue;
      const u = clamp(((d.x - x0) * lx + (d.y - y0) * ly) / len2, 0, 1);
      if (dist(d.x, d.y, x0 + lx * u, y0 + ly * u) < (d.blk ? 1.2 : 3)) return false;
    }
    return true;
  },

  laneOpen(qb, depth = 5) {
    // Any of three lanes (middle, left, right) free of unblocked defenders
    // for `depth` yards. Returns the lane's x offset (or null).
    // (a blocked man still fills his part of it: the lane has to run
    // between the bodies)
    for (const lx of [0, -4, 4]) {
      let open = true;
      for (const d of this.defense) {
        if (d.down) continue;
        if (d.y > qb.y - 1 && d.y < qb.y + depth && Math.abs(d.x - (qb.x + lx)) < (d.blk ? 1.3 : 2.2)) { open = false; break; }
      }
      if (open) return lx;
    }
    return null;
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
    // he throws it to the field side of a receiver near the sideline
    return { x: clamp(P.x, SIDE_LANE + 0.6, FIELD_W - SIDE_LANE - 0.6), y: Math.min(P.y, this.goalY + 8), T };
  },

  routeAhead(r, T) {
    const pts = r.pts;
    const sp = Math.max(Math.hypot(r.vx, r.vy), r.maxSpd * 0.85);
    if (!pts || r.wp >= pts.length) {
      const sat = r.routeEnd === 'sit' && pts && r.wp >= pts.length;
      if (sat) return { x: r.x, y: r.y };
      const sp = Math.hypot(r.vx, r.vy) || 1;
      let lane = SIDE_LANE;
      if (pts && pts.length) {
        const a = pts.length > 1 ? pts[pts.length - 2] : { x: r.sx, y: r.sy };
        const b = pts[pts.length - 1];
        if (r.routeEnd === 'settle') return settleStep(r.x, r.y, b.x - a.x, b.y - a.y, r.maxSpd * SETTLE_FRAC * T);
        lane = laneFor(b.x - a.x, b.y - a.y);
      }
      return alongRoute(r.x, r.y, r.vx / sp, r.vy / sp, sp * T, lane);
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
    // past the last point he carries on the way the route finished
    const a = pts.length > 1 ? pts[pts.length - 2] : { x: r.sx, y: r.sy };
    const b = pts[pts.length - 1];
    if (r.routeEnd === 'settle') return settleStep(x, y, b.x - a.x, b.y - a.y, (left / sp) * r.maxSpd * SETTLE_FRAC);
    return alongRoute(x, y, dx, dy, left, laneFor(b.x - a.x, b.y - a.y));
  },

  // How far short of the catch point L this defender will be when the
  // ball gets there: the better of breaking on it (a defender with his back
  // to the passer reacts late) and just carrying on the way he's going (a
  // man running stride for stride with the receiver is there either way).
  reachGap(qb, d, L) {
    const react = d.ballReact + (1 - looking(d, qb.x, qb.y)) * 0.5;
    const brk = dist(d.x, d.y, L.x, L.y) - d.maxSpd * Math.max(0, L.T - react) * 0.85;
    const carry = dist(d.x + d.vx * L.T, d.y + d.vy * L.T, L.x, L.y);
    return Math.min(brk, carry) - 0.6;
  },

  openness(qb, r) {
    if (!r || r.down || !r.released || r.blk) return -99;
    if (r.jamT > 0) return -5;
    // timing: he throws on (or after) the receiver's last break, not into
    // the stem where a defender can sit on the route
    if (!this.routeReady(qb, r)) return -5;
    const L = this.leadPoint(qb, r);
    if (L.y < qb.y - 1 && !this.offPlay.screen) return -5;
    let o = 99;
    for (const d of this.defense) {
      if (d.down || d.blk) continue;
      const dd = this.reachGap(qb, d, L);
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
    // a Hail Mary goes up high and hangs: everyone gets under it
    if (this.offPlay.hailMary) b.T *= 1.3;
    b.peak = 0.6 + d * 0.1 + (hit ? 1.2 : 0);
    b.wobble = hit;
    b.target = r;
    this.phase = 'air';
    this.passer = qb;
    this.airYards = ty;
    this.throwInfo = { press: press.hurry, hit, moving, across };
    this.events.push({ t: this.t, k: 'throw', who: qb, to: r, hit });
  },

  // grounding: thrown into the turf with no receiver near, from inside the
  // tackle box (Rule 8-2-1), flagged by the referee where he threw it.
  throwAwayNow(qb, grounding = false) {
    const side = qb.x < this.ballX ? -1 : 1;
    const b = this.ball;
    b.state = 'air';
    b.holder = null;
    b.fx = qb.x; b.fy = qb.y;
    b.tx = grounding ? qb.x + side * 4 : side < 0 ? -3 : FIELD_W + 3;
    b.ty = grounding ? qb.y + 4 : Math.max(qb.y + 6, 2);
    b.tz = 0.4;
    if (grounding) this.flag('grounding', qb, qb.x, qb.y, { spotY: qb.y });
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
};
