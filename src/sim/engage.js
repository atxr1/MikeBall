// Block engagements, mixed into PlaySim: a blocker and his man locked up
// (who's winning, which way the pair drifts, when the defender sheds),
// and what a blocked defender is fighting toward. Who blocks whom at the
// snap is src/sim/blocking.js. No DOM; seeded RNG only.

import { clamp, dist } from '../core/util.js';

export const engageMethods = {
  canBeBlocked(d) {
    return !d.blk && d.freeT <= 0 && !d.down && !d.wrapOn && d !== this.ball.holder;
  },

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
  },

  breakBlock(pair) {
    pair.b.blk = null;
    pair.d.blk = null;
    const i = this.blocks.indexOf(pair);
    if (i >= 0) this.blocks.splice(i, 1);
  },

  defGoal(d) {
    const h = this.ball.holder;
    // a draw: the line invites the rush upfield and wide of the passer
    if (h === this.qb && d.blk && d.blk.b.job?.t === 'draw' && this.phase === 'pre') {
      const side = Math.sign(d.x - h.x) || 1;
      return { x: h.x + side * 3.6, y: h.y - 1.2, vx: 0, vy: 0 };
    }
    // a designed run: a blocked man fights to the back, not the passer
    if (h === this.qb && this.runBack && this.phase === 'pre' && h.side !== d.side) return this.runBack;
    if (h && h.side !== d.side) return h;
    if (this.ball.state === 'air') return { x: this.ball.tx, y: this.ball.ty, vx: 0, vy: 0 };
    return this.qb;
  },

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
      // (on a designed run the defense is playing the back from the snap,
      // before he has the ball)
      const onRunner = pair.run && (goal === this.carrier || goal === this.runBack);
      if (onRunner && (b.job?.t === 'pull' || b.job?.t === 'lead') && d.edge) {
        // a kick-out: the puller or lead back hits the end man from the
        // inside and drives him out of the hole
        vx = d.edge * clamp(1.2 - 3 * w, -0.4, 2);
        vy = Math.min(vy, 0.2);
      } else if (onRunner) {
        // against the run he works down the line with the ball, riding the
        // blocker, easier sideways than straight ahead; but not across the
        // blocker's face: with the runner on the blocker's side of him he's
        // walled off, and only a man who's winning the block works through
        // (to where the runner's going, not where he is)
        const gx = goal.x + (goal.vx || 0) * 0.3 - d.x;
        const walled = pair.lev && Math.sign(gx) === pair.lev && Math.abs(gx) > 0.5;
        const lat = walled ? clamp(0.2 + 2 * w, 0, 1.4) : clamp(1.0 + 3 * w, 0, 2.6);
        vx = Math.abs(gx) < 0.3 ? vx : Math.sign(gx) * Math.max(Math.abs(vx), Math.min(lat, Math.abs(gx) * 3));
      }
      this.accelTo(d, vx, vy, dt, 20);
      // blocker sits between defender and the goal
      const kick = onRunner && (b.job?.t === 'pull' || b.job?.t === 'lead') && d.edge;
      const bx = d.x + (kick ? -d.edge * 0.8 : onRunner ? (pair.lev || Math.sign(goal.x - d.x)) * 0.6 : dx * 0.95);
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
  },
};
