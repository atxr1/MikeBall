// Special-teams scenes with all 22 players: kickoffs (current NFL kickoff
// alignment), punts, field goals and extra points. The result of each kick is
// decided by the rules engine first (src/game/kicks.js); this scene stages
// it: lines up both units, kicks, covers, blocks and makes the tackle at the
// spot the engine picked.
//
// Coordinates: x across the field (0..53.33 yd); f = yards from the KICKING
// team's goal line, so the kicking team always faces up the screen.

import { FIELD_W, MID_X, clamp, lerp, dist } from '../core/util.js';
import { rosterIndex } from '../game/personnel.js';
import { drawShadow, drawFootball } from '../render/pixelsprites.js';
import { drawRig } from '../render/rig.js';
import { outfitFor } from '../render/simdraw.js';
import { kickPose } from '../render/kickanim.js';

const PREFS_COVER = [['LB', 1], ['S', 1], ['CB', 2], ['TE', 1], ['RB', 1], ['WR', 3], ['LB', 3], ['S', 2], ['CB', 3], ['RB', 2], ['WR', 4], ['TE', 2], ['LB', 0], ['S', 0]];
const PREFS_LINE = [['OL', 5], ['OL', 6], ['OL', 7], ['TE', 0], ['TE', 1], ['LB', 2], ['DL', 4], ['OL', 0], ['OL', 1], ['OL', 2], ['OL', 3], ['OL', 4]];
const PREFS_RUSH = [['DL', 0], ['DL', 1], ['DL', 2], ['DL', 3], ['LB', 0], ['LB', 1], ['DL', 4], ['LB', 2], ['DL', 5], ['CB', 0], ['S', 0], ['CB', 1], ['S', 1]];

// Take n players following the preference list (position, starting depth),
// round-robin, skipping anyone already used.
function unit(roster, prefs, n, used) {
  const byId = rosterIndex(roster);
  const out = [];
  const cursor = prefs.map(([, i]) => i);
  let guard = 0;
  while (out.length < n && guard++ < 400) {
    for (let k = 0; k < prefs.length && out.length < n; k++) {
      const list = roster.depth[prefs[k][0]] || [];
      while (cursor[k] < list.length) {
        const p = byId.get(list[cursor[k]++]);
        if (p && !used.has(p.id) && !p.injured) { used.add(p.id); out.push(p); break; }
      }
    }
    if (prefs.every(([pos], k) => cursor[k] >= (roster.depth[pos] || []).length)) break;
  }
  for (const p of roster.players) {
    if (out.length >= n) break;
    if (!used.has(p.id)) { used.add(p.id); out.push(p); }
  }
  return out;
}

function ent(rec, side, x, f, role) {
  return {
    rec, side, role, x, f, vx: 0, vf: 0, tx: x, tf: f, speed: 0, maxSpd: 6.2 + rec.attrs.spd * 0.03,
    face: side === 'K' ? Math.PI / 2 : -Math.PI / 2, anim: 0, down: false, eng: null, carrying: false,
  };
}

export class KickScene {
  // opts: { type: 'kickoff'|'punt'|'fg'|'pat', out, game, kSide, rSide, rng, ballX }
  constructor(opts) {
    this.kind = 'kick';
    this.type = opts.type;
    this.out = opts.out;
    this.rng = opts.rng;
    this.fxEvents = []; // cosmetic moves/falls for the effects layer
    this.t = 0;
    this.done = false;
    this.players = [];
    this.ball = { x: MID_X, f: 0, z: 0, state: 'held', holder: null, spin: 0 };
    this.timeline = [];
    const g = opts.game;
    this.kRoster = g.rosters[opts.kSide];
    this.rRoster = g.rosters[opts.rSide];
    this.kicker = this.type === 'punt' ? g.punter(opts.kSide) : g.kicker(opts.kSide);
    this.holderRec = g.punter(opts.kSide);
    this.returnerRec = g.returner(opts.rSide);
    this.ballX = opts.ballX ?? MID_X;
    if (this.type === 'kickoff') this.setupKickoff();
    else if (this.type === 'punt') this.setupPunt();
    else this.setupFieldGoal();
  }

  add(rec, side, x, f, role) {
    const e = ent(rec, side, clamp(x, 0.8, FIELD_W - 0.8), f, role);
    this.players.push(e);
    return e;
  }

  // ------------------------------------------------------------------ kickoff
  setupKickoff() {
    const res = this.out.res;
    const from = this.out.from ?? 35;
    const onside = res.type.startsWith('onside');
    this.los = from;
    const usedK = new Set([this.kicker.id]);
    const usedR = new Set([this.returnerRec.id]);
    this.kickerEnt = this.add(this.kicker, 'K', MID_X - 1.5, from - 7, 'kicker');
    // 10 cover players line up at the receiving 40 (kicking frame f = from + 25)
    const cover = unit(this.kRoster, PREFS_COVER, 10, usedK);
    const coverF = onside ? from - 1 : from + 25;
    cover.forEach((p, i) => {
      const x = 3.5 + (i < 5 ? i : i + 1) * ((FIELD_W - 7) / 10);
      this.add(p, 'K', x, coverF, 'cover');
    });
    // receiving setup zone: 9 players between their 30 and 35, two deep
    const blockers = unit(this.rRoster, PREFS_COVER, 10, usedR);
    blockers.slice(0, 9).forEach((p, i) => {
      const x = 6 + i * ((FIELD_W - 12) / 8);
      this.add(p, 'R', x, from + 31 + (i % 2) * 2.5, 'block');
    });
    let landF = 100 - res.landing;
    if (res.type === 'touchback' && landF < 101 && !res.rolled) landF = 101.5 + this.rng.next() * 5;
    let landX = clamp(MID_X + (this.rng.next() - 0.5) * 18, 8, FIELD_W - 8);
    if (res.type === 'oob') landX = this.rng.next() < 0.5 ? -1.5 : FIELD_W + 1.5;
    this.returner = this.add(this.returnerRec, 'R', onside ? MID_X : clamp(landX + 3, 6, FIELD_W - 6), onside ? from + 31 : 92, 'returner');
    this.add(blockers[9], 'R', onside ? MID_X + 6 : (landX < MID_X ? landX + 14 : landX - 14), onside ? from + 31 : 88, 'block');

    this.ball = { x: MID_X, f: from, z: 0.3, state: 'tee', holder: null, spin: 0 };
    const tKick = 0.75;
    const T = onside ? 0.9 : clamp(1.0 + Math.abs(landF - from) * 0.02, 1.2, 2.3);
    this.plan = { tKick, T, land: { x: onside ? MID_X + (this.rng.next() - 0.5) * 6 : landX, f: landF }, peak: onside ? 1.2 : 15, onside };
    // kicker run-up
    this.kickerEnt.tx = MID_X - 0.4;
    this.kickerEnt.tf = from - 0.6;
    this.kickerEnt.speed = 6;
    this.frozen = true; // nobody else moves until the ball lands
    this.returner.tx = clamp(this.plan.land.x, 1, FIELD_W - 1); // never out of bounds after it
    this.returner.tf = landF;
  }

  // ------------------------------------------------------------------ punt
  setupPunt() {
    const res = this.out.res;
    const los = this.out.startBall;
    this.los = los;
    const bx = this.ballX;
    const usedK = new Set([this.kicker.id]);
    const usedR = new Set([this.returnerRec.id]);
    const line = unit(this.kRoster, PREFS_LINE, 7, usedK);
    const cover = unit(this.kRoster, PREFS_COVER, 3, usedK);
    const ls = this.add(line[0], 'K', bx, los - 0.8, 'line');
    [-1.95, 1.95, -3.9, 3.9].forEach((dx, i) => this.add(line[i + 1], 'K', bx + dx, los - 0.85, 'line'));
    this.add(line[5], 'K', bx - 5.2, los - 1.8, 'line');
    this.add(line[6], 'K', bx + 5.2, los - 1.8, 'line');
    this.add(cover[0], 'K', 4.5, los - 1, 'gunner');
    this.add(cover[1], 'K', FIELD_W - 4.5, los - 1, 'gunner');
    this.add(cover[2], 'K', bx + 1, los - 5.5, 'protector');
    this.kickerEnt = this.add(this.kicker, 'K', bx, los - 14, 'kicker');

    const rush = unit(this.rRoster, PREFS_RUSH, 8, usedR);
    const db = unit(this.rRoster, [['CB', 2], ['CB', 3], ['S', 2]], 2, usedR);
    [-1, 1, -3.2, 3.2, -5.6, 5.6].forEach((dx, i) => this.add(rush[i], 'R', bx + dx, los + 1.1, 'rush'));
    this.add(rush[6], 'R', bx - 6, los + 6, 'box');
    this.add(rush[7], 'R', bx + 6, los + 6, 'box');
    this.add(db[0], 'R', 5.5, los + 2, 'jammer');
    this.add(db[1], 'R', FIELD_W - 5.5, los + 2, 'jammer');
    const landF = res.type === 'touchback' ? 105 : res.type === 'blocked' ? los - 10 : res.landing;
    let landX = clamp(bx + (this.rng.next() - 0.5) * 16, 6, FIELD_W - 6);
    if (res.type === 'oob') landX = landX < MID_X ? -1.5 : FIELD_W + 1.5;
    this.returner = this.add(this.returnerRec, 'R', landX, Math.min(landF, 99) + (res.type === 'touchback' ? -4 : 0), 'returner');
    this.ball = { x: bx, f: los - 0.4, z: 0.5, state: 'held', holder: ls, spin: 0 };
    const tSnap = 0.3;
    const tCatch = 0.75;
    const tKick = 1.3;
    const blocked = res.type === 'blocked';
    // the engine's hang time, shortened a little so the scene keeps moving
    const T = blocked ? 0.5 : res.hang ? clamp(res.hang * 0.62, 1.8, 3.1) : clamp(1.5 + (res.gross || 40) * 0.02, 1.7, 2.8);
    this.plan = { tSnap, tCatch, tKick, T, land: { x: blocked ? bx + (this.rng.next() - 0.5) * 4 : landX, f: landF }, peak: blocked ? 1.5 : 18, blocked, gap: res.gap };
  }

  // ------------------------------------------------------------------ field goal / PAT
  setupFieldGoal() {
    const pat = this.type === 'pat';
    const los = pat ? 85 : this.out.startBall;
    this.los = los;
    const bx = pat ? MID_X : this.ballX;
    const usedK = new Set([this.kicker.id, this.holderRec.id]);
    const usedR = new Set();
    const line = unit(this.kRoster, [['OL', 0], ['OL', 1], ['OL', 2], ['OL', 3], ['OL', 4], ['OL', 5], ['TE', 0], ['TE', 1], ['OL', 6]], 9, usedK);
    const ls = this.add(line[0], 'K', bx, los - 0.8, 'line');
    [-1.9, 1.9, -3.8, 3.8, -5.7, 5.7].forEach((dx, i) => this.add(line[i + 1], 'K', bx + dx, los - 0.85, 'line'));
    this.add(line[7], 'K', bx - 7, los - 1.7, 'line');
    this.add(line[8], 'K', bx + 7, los - 1.7, 'line');
    this.holder = this.add(this.holderRec, 'K', bx - 0.4, los - 7, 'holder');
    this.kickerEnt = this.add(this.kicker, 'K', bx - 2.6, los - 9.6, 'kicker');
    const rush = unit(this.rRoster, PREFS_RUSH, 11, usedR);
    [-1, 1, -3, 3, -5, 5, -7, 7, -9, 9].forEach((dx, i) => this.add(rush[i], 'R', bx + dx, los + 1.1, 'rush'));
    this.add(rush[10], 'R', bx, los + 5, 'jumper');
    this.ball = { x: bx, f: los - 0.4, z: 0.5, state: 'held', holder: ls, spin: 0 };
    const a = this.out.anim || {};
    const res = this.out.res || {};
    const blocked = !!res.blocked;
    const miss = a.miss || '';
    const op = a.op || res.op || { snap: 'good', hold: 'clean', time: 1.28 };
    const landF = blocked ? los + 1.5 : miss === 'short' ? 107 : 118;
    const kickF = los - 7;
    // the kick flies on the angle the engine rolled (src/game/kicks.js)
    let tx;
    if (a.angle != null) tx = bx + Math.tan(a.angle) * (landF - kickF);
    else tx = MID_X + (a.good ? (this.rng.next() - 0.5) * 2.4 : miss.includes('left') ? -4.6 : miss.includes('right') ? 4.6 : (this.rng.next() - 0.5) * 2);
    const T = blocked ? 0.35 : clamp(0.7 + (landF - kickF) * 0.018, 0.9, 1.9);
    // snap to kick: about 1.3 s, longer when the snap or the hold goes wrong
    const tSnap = 0.25;
    const bad = op.snap !== 'good';
    const tCatch = tSnap + 0.36 + (bad ? 0.12 : 0);
    const tKick = tSnap + (op.time || 1.28);
    this.plan = { tSnap, tCatch, tKick, T, land: { x: tx, f: landF }, peak: blocked ? 1 : 6 + (landF - kickF) * 0.06, blocked, kickF, op };
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    if (this.done) return;
    this.t += dt;
    if (this.type === 'kickoff') this.updateKickoff();
    else if (this.type === 'punt') this.updatePunt();
    else this.updateFieldGoal();
    for (const p of this.players) this.move(p, dt);
    this.updateBall(dt);
  }

  launch(fromX, fromF, land, T, peak) {
    const b = this.ball;
    b.state = 'air';
    b.holder = null;
    b.fx = fromX; b.ff = fromF; b.t0 = this.t; b.T = T; b.peak = peak;
    b.lx = land.x; b.lf = land.f;
  }

  updateBall(dt) {
    const b = this.ball;
    b.spin += dt * 14;
    if (b.state === 'air') {
      const u = clamp((this.t - b.t0) / b.T, 0, 1);
      b.x = lerp(b.fx, b.lx, u);
      b.f = lerp(b.ff, b.lf, u);
      b.z = 0.5 + 4 * b.peak * u * (1 - u);
      if (u >= 1) { b.state = 'ground'; b.landT = this.t; this.onLand && this.onLand(); }
    } else if (b.state === 'held' && b.holder) {
      b.x = b.holder.x;
      b.f = b.holder.f;
      b.z = 1;
    } else if (b.state === 'ground') {
      b.z = Math.max(0, b.z - dt * 3);
      if (b.rollTo != null) {
        // bouncing along toward where it stops
        const d = b.rollTo - b.f;
        b.f += Math.sign(d) * Math.min(Math.abs(d), dt * Math.max(1.2, Math.abs(d) * 1.6));
        b.z = Math.abs(Math.sin(this.t * 9)) * Math.min(0.5, Math.abs(d) * 0.12);
      }
    }
  }

  move(p, dt) {
    if (p.down && p.upT && this.t >= p.upT) { p.down = false; p.upT = 0; }
    if (p.down) { p.vx = 0; p.vf = 0; return; }
    let spd = p.speed;
    if (p.eng) spd = Math.min(spd, 0.6);
    const dx = p.tx - p.x;
    const df = p.tf - p.f;
    const d = Math.hypot(dx, df);
    const want = d > 0.15 ? Math.min(spd, d * 4) : 0;
    const tvx = d > 0 ? (dx / d) * want : 0;
    const tvf = d > 0 ? (df / d) * want : 0;
    const k = Math.min(1, dt * 7);
    p.vx += (tvx - p.vx) * k;
    p.vf += (tvf - p.vf) * k;
    p.x = clamp(p.x + p.vx * dt, -2, FIELD_W + 2);
    p.f += p.vf * dt;
    const sp = Math.hypot(p.vx, p.vf);
    if (sp > 0.5) p.face = Math.atan2(p.vf, p.vx);
    p.anim += sp * dt * 2.2;
  }

  // Blockers pick a man and get between him and the ball carrier.
  blockAndCover(carrier, coverSpeed = 1) {
    const kTeam = this.players.filter((p) => p.side === 'K' && !p.down);
    const rTeam = this.players.filter((p) => p.side === 'R' && p !== carrier && !p.down);
    const taken = new Set(rTeam.map((p) => p.mark).filter(Boolean));
    for (const b of rTeam) {
      if (!b.mark || b.mark.down) {
        let best = null;
        let bd = 1e9;
        for (const k of kTeam) {
          if (taken.has(k) || k.role === 'kicker') continue;
          const d = dist(b.x, b.f, k.x, k.f);
          if (d < bd) { bd = d; best = k; }
        }
        b.mark = best;
        if (best) taken.add(best);
      }
      const m = b.mark;
      if (!m) { b.speed = 0; continue; }
      if (b.eng) { b.tx = m.x; b.tf = m.f; continue; }
      const ix = lerp(m.x, carrier.x, 0.3);
      const iff = lerp(m.f, carrier.f, 0.3);
      b.tx = ix; b.tf = iff; b.speed = b.maxSpd * 0.92;
      if (dist(b.x, b.f, m.x, m.f) < 1.1 && !m.eng) {
        b.eng = m; m.eng = b;
      }
    }
    for (const k of kTeam) {
      if (k === this.tackler) continue;
      if (k.eng) { k.tx = k.eng.x; k.tf = k.eng.f; continue; }
      // stay in your lane until you're close, then converge
      if (k.lane == null) k.lane = clamp((k.x - carrier.x) * 0.45, -9, 9);
      const d = dist(k.x, k.f, carrier.x, carrier.f);
      const T = Math.min(1.2, d / k.maxSpd);
      k.tx = carrier.x + carrier.vx * T * 0.8 + k.lane * clamp((d - 4) / 14, 0, 1);
      k.tf = carrier.f + carrier.vf * T * 0.8;
      k.speed = k.maxSpd * coverSpeed * (k.role === 'kicker' ? 0.7 : 1);
    }
  }

  // Run the returner from the catch to the engine's spot over `dur` seconds.
  startReturn(endF, endX, dur, outcome) {
    const r = this.returner;
    this.ret = { t0: this.t, dur, sx: r.x, sf: r.f, ex: endX, ef: endF, outcome, wob: this.rng.next() * 6 };
    r.carrying = true;
    this.ball.state = 'held';
    this.ball.holder = r;
    // the tackler: the closest cover man not likely to be blocked
    if (outcome === 'tackle') {
      const k = this.players.filter((p) => p.side === 'K' && p.role !== 'kicker').sort((a, b) => dist(a.x, a.f, endX, endF) - dist(b.x, b.f, endX, endF))[0];
      this.tackler = k || null;
    }
  }

  stepReturn() {
    const R = this.ret;
    const r = this.returner;
    const u = clamp((this.t - R.t0) / R.dur, 0, 1);
    const wob = Math.sin(u * Math.PI * 2 + R.wob) * 2.5 * (1 - u);
    r.tx = lerp(R.sx, R.ex, u) + wob;
    r.tf = lerp(R.sf, R.ef, Math.min(1, u + 0.04));
    r.speed = r.maxSpd * 1.05;
    if (this.tackler && !this.tackler.down) {
      const k = this.tackler;
      const left = Math.max(0.05, R.t0 + R.dur - this.t);
      k.tx = R.ex + (k.x < R.ex ? -0.6 : 0.6);
      k.tf = R.ef - 0.4;
      k.speed = Math.min(11, dist(k.x, k.f, k.tx, k.tf) / left + 1);
    }
    this.blockAndCover(r);
    this.whiffs(r, u);
    if (u >= 1 && !R.ended) {
      R.ended = true;
      r.x = R.ex; r.f = R.ef;
      if (R.outcome === 'tackle') {
        r.down = true;
        if (this.tackler) { this.tackler.x = R.ex + 0.7; this.tackler.f = R.ef - 0.3; this.tackler.down = this.rng.chance(0.6); }
        if (this.rng.chance(0.2)) this.fxEvents.push({ k: 'hit', x: r.x, f: r.f });
        this.fxEvents.push({ k: 'fall', x: r.x, f: r.f });
      } else if (R.outcome === 'fumble') {
        r.down = true;
        r.carrying = false;
        this.ball.state = 'ground';
        this.ball.holder = null;
        this.ball.x = R.ex + 1.2; this.ball.f = R.ef + 0.5; this.ball.z = 0;
        const k = this.players.filter((p) => p.side === 'K').sort((a, b) => dist(a.x, a.f, R.ex, R.ef) - dist(b.x, b.f, R.ex, R.ef))[0];
        if (k) { k.x = this.ball.x + 0.3; k.f = this.ball.f; k.down = true; }
      }
      this.endAt(this.t + 1.0);
      for (const p of this.players) if (!p.down) p.speed = Math.min(p.speed, 2.5);
    }
  }

  // Cover men who reach the returner but aren't the one who makes the
  // tackle miss him: he jukes, spins or stiff-arms past, and they hit the
  // turf. Cosmetic only; the return's result was decided by the rules.
  whiffs(r, u) {
    if (u > 0.85) return;
    for (const k of this.players) {
      if (k.side !== 'K' || k === this.tackler || k.down || k.eng || k.missed) continue;
      if (dist(k.x, k.f, r.x, r.f) > 1.3) continue;
      k.missed = true;
      const roll = this.rng.next();
      const move = roll < 0.45 ? 'juke' : roll < 0.75 ? 'spin' : 'stiff';
      k.down = true;
      k.upT = this.t + 1.1;
      k.diveT = this.t + 0.3;
      r.move = { k: move, t0: this.t, side: k.x < r.x ? 'L' : 'R', dir: k.x < r.x ? 1 : -1 };
      this.fxEvents.push({ k: move, x: r.x, f: r.f });
      this.fxEvents.push({ k: 'fall', x: k.x, f: k.f });
    }
  }

  endAt(t) {
    if (this.endT == null) this.endT = t;
  }

  settle() {
    for (const p of this.players) { p.speed = 1.5; p.tx = p.x + p.vx * 0.4; p.tf = p.f + p.vf * 0.4; }
  }

  checkEnd() {
    if (this.endT != null && this.t >= this.endT) this.done = true;
  }

  updateKickoff() {
    const P = this.plan;
    const res = this.out.res;
    const b = this.ball;
    if (b.state === 'tee' && this.t >= P.tKick) {
      this.launch(MID_X, this.los, P.land, P.T, P.peak);
      this.kickerEnt.speed = 3;
      this.kickerEnt.tf = this.los + 3;
    }
    if (b.state === 'air' && this.returner && !P.onside) {
      // returner drifts under it (allowed before the ball lands)
      this.returner.tx = clamp(P.land.x, 1, FIELD_W - 1); this.returner.tf = P.land.f; this.returner.speed = 5;
    }
    if (b.state === 'air' || b.state === 'tee') { this.checkEnd(); return; }
    if (!this.landed) {
      this.landed = true;
      this.frozen = false;
      if (P.onside) {
        const rec = res.kickingRecovers ? 'K' : 'R';
        const near = this.players.filter((p) => p.side === rec).sort((a, c) => dist(a.x, a.f, b.x, b.f) - dist(c.x, c.f, b.x, b.f));
        for (const p of this.players) { p.tx = b.x + (this.rng.next() - 0.5) * 3; p.tf = b.f + (this.rng.next() - 0.5) * 3; p.speed = p.maxSpd * 0.9; }
        this.onsideDiver = near[0];
        this.endAt(this.t + 1.8);
      } else if (res.type === 'touchback' || res.type === 'short' || res.type === 'oob') {
        this.returner.carrying = res.type === 'touchback' && P.land.f >= 100;
        if (this.returner.carrying) { b.state = 'held'; b.holder = this.returner; }
        this.settle();
        if (res.rolled) {
          // it hit in the landing zone and rolled in; he lets it go and downs it there
          b.rollTo = 101.5 + this.rng.next() * 2;
          this.returner.tx = b.x; this.returner.tf = b.rollTo; this.returner.speed = 4;
          this.endAt(this.t + 1.9);
        } else this.endAt(this.t + 1.2);
      } else {
        const endF = res.type === 'td' ? -3 : res.type === 'fumble' ? 100 - res.ballOn : 100 - res.ballOn;
        const endX = clamp(P.land.x + (this.rng.next() - 0.5) * 16, 4, FIELD_W - 4);
        const dur = clamp(Math.abs(P.land.f - endF) / 8.8, 0.6, 5.5);
        this.returner.x = P.land.x; this.returner.f = P.land.f;
        this.startReturn(endF, endX, dur, res.type === 'td' ? 'td' : res.type === 'fumble' ? 'fumble' : 'tackle');
      }
    }
    if (this.onsideDiver && !this.onsideDiver.down && this.t > b.landT + 0.6) {
      const d = this.onsideDiver;
      d.x = b.x + 0.4; d.f = b.f; d.down = true;
      b.state = 'held'; b.holder = d;
      this.settle();
    }
    if (this.ret) this.stepReturn();
    this.checkEnd();
  }

  updatePunt() {
    const P = this.plan;
    const res = this.out.res;
    const b = this.ball;
    const t = this.t;
    const punter = this.kickerEnt;
    if (!this.snapped && t >= P.tSnap) {
      this.snapped = true;
      this.launch(b.x, b.f, { x: punter.x, f: punter.f + 0.3 }, P.tCatch - P.tSnap, 0.4);
      for (const p of this.players) {
        if (p.role === 'gunner') {
          // get there with the gap the engine worked out (how much room the
          // returner has when it comes down)
          const gap = P.gap ?? 4;
          const tx = clamp(P.land.x + (p.x < MID_X ? -1 : 1) * Math.min(gap, 4), 3, FIELD_W - 3);
          const tf = P.land.f - Math.max(1, gap * 0.8);
          const left = P.tKick + P.T - this.t;
          p.tx = tx; p.tf = tf;
          p.speed = clamp(dist(p.x, p.f, tx, tf) / Math.max(0.5, left), 4, p.maxSpd * 1.1);
        }
        if (p.role === 'jammer') { p.tx = p.x + (p.x < MID_X ? 1 : -1); p.tf = P.land.f - 8; p.speed = p.maxSpd * 0.85; }
        if (p.role === 'rush') { p.tx = p.x; p.tf = this.los - 0.5; p.speed = 3; }
        if (p.role === 'line') { p.speed = 1; p.tf = p.f - 0.3; }
        if (p.role === 'box') { p.tx = p.x; p.tf = p.f + 6; p.speed = 3; }
      }
    }
    if (this.snapped && !this.caught && t >= P.tCatch) {
      this.caught = true;
      b.state = 'held'; b.holder = punter;
    }
    if (this.caught && !this.kicked && t >= P.tKick) {
      this.kicked = true;
      this.launch(punter.x, punter.f + 0.6, P.land, P.T, P.peak);
      if (P.blocked) {
        const r = this.players.find((p) => p.role === 'rush');
        if (r) { r.tx = punter.x; r.tf = punter.f + 1; r.speed = 8; }
      }
      // everyone releases into coverage / sets up the return
      for (const p of this.players) {
        if (p.side === 'K' && p.role !== 'kicker' && p.role !== 'gunner') {
          p.tx = clamp(P.land.x + (p.x - this.ballX) * 0.9, 3, FIELD_W - 3); p.tf = P.land.f - 6; p.speed = p.maxSpd * 0.95; p.eng = null;
        }
        if (p.side === 'R' && p.role !== 'returner' && p.role !== 'jammer') {
          p.tx = clamp(P.land.x + (p.x - this.ballX) * 0.6, 3, FIELD_W - 3); p.tf = P.land.f - 10; p.speed = p.maxSpd * 0.85; p.eng = null;
        }
      }
      punter.tf = punter.f + 4; punter.speed = 3;
    }
    // pre-kick: rushers vs line
    if (this.snapped && !this.kicked) {
      for (const p of this.players) {
        if (p.role !== 'rush' || p.eng) continue;
        const blk = this.players.find((k) => k.side === 'K' && k.role === 'line' && !k.eng && dist(k.x, k.f, p.x, p.f) < 2.2);
        if (blk) { p.eng = blk; blk.eng = p; }
      }
    }
    if (this.kicked && b.state === 'ground' && !this.landed) {
      this.landed = true;
      for (const p of this.players) p.eng = null;
      const type = res.type;
      if (type === 'fair' || type === 'touchback' || type === 'downed' || type === 'oob') {
        if (type === 'fair') { this.returner.x = P.land.x; this.returner.f = P.land.f; this.returner.carrying = true; b.state = 'held'; b.holder = this.returner; }
        for (const p of this.players) {
          if (p === this.returner) { p.speed = 0; continue; }
          p.tx = clamp(b.x + (p.x - b.x) * 0.3, 2, FIELD_W - 2);
          p.tf = clamp(b.f + (p.side === 'K' ? -3 : -6), -8, 108);
          p.speed = p.maxSpd * 0.6;
        }
        if (type === 'downed') {
          const g = this.players.filter((p) => p.role === 'gunner').sort((a, c) => dist(a.x, a.f, b.x, b.f) - dist(c.x, c.f, b.x, b.f))[0];
          if (g) { g.tx = b.x; g.tf = b.f - 0.5; g.speed = g.maxSpd; }
        }
        this.endAt(this.t + 1.6);
      } else if (type === 'muff' || type === 'blocked') {
        const rec = this.players.filter((p) => p.side === (type === 'blocked' ? (this.rng.chance(0.5) ? 'K' : 'R') : 'K')).sort((a, c) => dist(a.x, a.f, b.x, b.f) - dist(c.x, c.f, b.x, b.f))[0];
        for (const p of this.players) { p.tx = b.x + (this.rng.next() - 0.5) * 4; p.tf = b.f + (this.rng.next() - 0.5) * 4; p.speed = p.maxSpd * 0.8; }
        this.muffDiver = rec;
        this.endAt(this.t + 1.8);
      } else {
        const endF = type === 'td' ? -3 : 100 - res.ballOn;
        const endX = clamp(P.land.x + (this.rng.next() - 0.5) * 14, 4, FIELD_W - 4);
        const dur = clamp(Math.abs(P.land.f - endF) / 8.8, 0.5, 5.5);
        this.returner.x = P.land.x; this.returner.f = P.land.f;
        this.startReturn(endF, endX, dur, type === 'td' ? 'td' : 'tackle');
      }
    }
    if (this.kicked && b.state === 'air' && this.returner) {
      this.returner.tx = clamp(P.land.x, 1, FIELD_W - 1); this.returner.tf = Math.min(P.land.f, 104); this.returner.speed = 5;
    }
    if (this.muffDiver && !this.muffDiver.down && this.t > b.landT + 0.7) {
      const d = this.muffDiver;
      d.x = b.x + 0.4; d.f = b.f; d.down = true;
      b.state = 'held'; b.holder = d;
    }
    if (this.ret) this.stepReturn();
    this.checkEnd();
  }

  updateFieldGoal() {
    const P = this.plan;
    const b = this.ball;
    const t = this.t;
    if (!this.snapped && t >= P.tSnap) {
      this.snapped = true;
      // a bad snap sails high, skips low or goes wide of the holder
      const sn = P.op.snap;
      const off = sn === 'wide' ? 1.4 : 0.2;
      this.launch(b.x, b.f, { x: this.holder.x + off, f: this.holder.f + 0.3 }, P.tCatch - P.tSnap, sn === 'high' ? 1.4 : sn === 'low' ? 0.05 : 0.3);
      if (sn === 'wide') { this.holder.tx = this.holder.x + 1.1; this.holder.speed = 3; }
      for (const p of this.players) {
        if (p.side === 'R') {
          const edge = Math.abs(p.x - b.x) > 6;
          p.tx = edge ? lerp(p.x, this.holder.x, 0.6) : p.x;
          p.tf = edge ? this.holder.f + 2.5 : this.los - 0.3;
          p.speed = edge ? p.maxSpd * 0.8 : 2;
        }
        if (p.role === 'line') { p.speed = 0.5; p.tf = p.f - 0.2; }
        if (p.role === 'jumper') { p.tf = this.los + 1; p.speed = 4; }
      }
    }
    if (this.snapped && !this.caught && t >= P.tCatch) {
      this.caught = true;
      b.state = 'held'; b.holder = this.holder;
    }
    if (this.snapped && t > 0.45 && !this.kicked) {
      const k = this.kickerEnt;
      k.tx = this.holder.x - 0.5; k.tf = this.holder.f - 0.5; k.speed = 5;
    }
    if (this.snapped && !this.kicked) {
      for (const p of this.players) {
        if (p.side !== 'R' || p.eng) continue;
        const blk = this.players.find((k) => k.side === 'K' && k.role === 'line' && !k.eng && dist(k.x, k.f, p.x, p.f) < 1.6);
        if (blk) { p.eng = blk; blk.eng = p; }
      }
    }
    if (this.caught && !this.kicked && t >= P.tKick) {
      this.kicked = true;
      this.launch(this.holder.x, this.holder.f, P.land, P.T, P.peak);
      this.kickerEnt.speed = 2;
      this.kickerEnt.tf = this.kickerEnt.f + 2;
    }
    if (this.kicked && b.state === 'ground' && !this.landed) {
      this.landed = true;
      for (const p of this.players) { p.eng = null; p.speed = 1; p.tx = p.x; p.tf = p.f + (p.side === 'K' ? 0.5 : -0.5); }
      this.endAt(this.t + 0.9);
    }
    this.checkEnd();
  }

  // ------------------------------------------------------------------ camera
  focus() {
    const b = this.ball;
    if (this.ret && !this.ret.ended) return { x: this.returner.x, f: this.returner.f + 2 };
    if (b.state === 'air') return { x: b.x, f: b.f + 2 };
    if (b.holder) return { x: b.holder.x, f: b.holder.f + 3 };
    return { x: b.x, f: b.f + 2 };
  }

  // ------------------------------------------------------------------ draw
  draw(ctx, cam, uniK, uniR, marker) {
    const list = this.sortBuf || (this.sortBuf = []);
    list.length = 0;
    for (const p of this.players) list.push(p);
    list.sort((a, b) => b.f - a.f);
    for (const p of list) {
      const x = cam.sx(p.x);
      const y = cam.sy(p.f);
      if (x < -24 || x > cam.w + 24 || y < -6 || y > cam.h + 34) continue;
      drawShadow(ctx, x, y, p.down ? 16 : 10);
    }
    const b = this.ball;
    for (const p of list) {
      const x = cam.sx(p.x);
      const y = cam.sy(p.f);
      if (x < -24 || x > cam.w + 24 || y < -6 || y > cam.h + 34) continue;
      const e = kickPose(p, this);
      const yy = y - (e.lift || 0);
      drawRig(ctx, outfitFor(p.side === 'K' ? uniK : uniR, p.rec.skinTone || 0), e, x, yy, p.rec.num, p);
      if (b.state === 'held' && b.holder === p && !p.down && this.ret && !this.ret.ended) marker(ctx, x, yy);
    }
    if (b.state !== 'held' || (b.holder && b.holder.role === 'line')) {
      drawFootball(ctx, cam.sx(b.x), cam.sy(b.f), b.z * cam.s * 0.9, b.spin);
    }
  }
}
