// Draws the 22 players of a live (or pre-snap) play: picks each player's
// pose from the sim state (runs, cuts, stiff arms, spins, hurdles, wraps,
// falls, celebrations), then sprites, the ball and the carrier marker.

import { drawSprite, drawShadow, drawCarriedBall, drawFootball, viewFromFace } from './pixelsprites.js';

const TMP = { view: 'N', pose: 'stand', frame: 0, num: 0, skin: 0, lift: 0, ball: true };
const sortBuf = [];

export function poseFor(p, sim, live) {
  const e = TMP;
  e.num = p.rec.num;
  e.skin = p.rec.skinTone;
  e.frame = 0;
  e.lift = 0;
  e.ball = true;
  const side = (a) => (Math.cos(a) >= 0 ? 'E' : 'W');
  if (live && p.diveT > 0) { e.pose = 'dive'; e.view = side(p.face); return e; }
  if (p.down) {
    e.pose = 'down';
    const c = Math.cos(p.face);
    e.view = Math.abs(c) > 0.6 ? side(p.face) : Math.sin(p.face) > 0 ? 'N' : 'S';
    return e;
  }
  const speed = Math.hypot(p.vx, p.vy);
  if (!live || sim.t < 0.05) {
    e.pose = 'stand';
    e.view = p.side === 'O' ? 'N' : 'S';
    return e;
  }
  e.view = viewFromFace(p.face);
  if (p.cheer) { e.pose = 'cheer'; e.ball = false; return e; }
  const holder = sim.ball.holder === p;
  if (p === sim.qb && (p.pending || (sim.passer === p && sim.t - (sim.ball.t0 || 0) < 0.22 && sim.ball.state === 'air'))) {
    e.pose = 'throw';
    if (e.view === 'E' || e.view === 'W') e.view = 'N';
    return e;
  }
  const m = p.move;
  if (m) {
    const u = m.t / m.T;
    if (m.k === 'spin') {
      const order = ['N', 'E', 'S', 'W'];
      e.view = order[(order.indexOf(e.view) + 1 + Math.floor(u * 4)) % 4];
      e.pose = 'carry';
      e.frame = Math.floor(p.anim * 0.6) % 4;
      return e;
    }
    if (m.k === 'stiff') {
      if (e.view === 'E' || e.view === 'W') { e.pose = 'stiffL'; e.ball = false; }
      else e.pose = m.on && m.on.x < p.x ? 'stiffL' : 'stiffR';
      return e;
    }
    if (m.k === 'juke' && m.t < 0.26) {
      e.view = p.vy >= 0 ? 'N' : 'S';
      e.pose = m.dir < 0 ? 'cutL' : 'cutR';
      return e;
    }
    if (m.k === 'truck') { e.pose = 'push'; return e; }
    if (m.k === 'hurdle') {
      e.pose = 'carry';
      e.frame = 0;
      e.lift = Math.round(Math.sin(Math.min(1, u) * Math.PI) * 6);
      return e;
    }
  }
  if (p.wrapOn) {
    e.pose = 'push';
    e.view = viewFromFace(Math.atan2(p.wrapOn.y - p.y, p.wrapOn.x - p.x));
    return e;
  }
  if (sim.wrap && sim.wrap.h === p) {
    e.pose = 'carry';
    e.frame = Math.floor(sim.t * 9) % 4;
    return e;
  }
  if (p.stumbleT > 0 && !p.blk) { e.pose = 'reel'; return e; }
  if (p.blk) { e.pose = 'push'; return e; }
  if (speed > 0.7) {
    e.pose = holder ? 'carry' : 'run';
    e.frame = Math.floor(p.anim * 0.6) % 4;
    return e;
  }
  e.pose = 'stand';
  return e;
}

// sc: { sim, los, offUni, defUni }; live: the play is running or just ended.
export function drawSimPlayers(ctx, cam, sc, live) {
  const sim = sc.sim;
  const list = sortBuf;
  list.length = 0;
  for (const p of sim.players) list.push(p);
  list.sort((a, b) => b.y - a.y);
  for (const p of list) {
    const x = cam.sx(p.x);
    const y = cam.sy(sc.los + p.y);
    if (x < -20 || x > cam.w + 20 || y < -4 || y > cam.h + 30) continue;
    drawShadow(ctx, x, y, p.down ? 16 : 10);
  }
  const b = sim.ball;
  for (const p of list) {
    const x = cam.sx(p.x);
    const y = cam.sy(sc.los + p.y);
    if (x < -20 || x > cam.w + 20 || y < -4 || y > cam.h + 30) continue;
    const e = poseFor(p, sim, live);
    const yy = y - e.lift;
    drawSprite(ctx, p.side === 'O' ? sc.offUni : sc.defUni, e, x, yy);
    const holder = b.holder === p && b.state === 'held';
    if (holder && live && e.ball && e.pose !== 'throw' && e.pose !== 'down' && e.pose !== 'dive') drawCarriedBall(ctx, e.view, x, yy);
    if (holder && live && sim.phase === 'run' && !p.down && !sim.done) carrierMarker(ctx, x, yy);
  }
  if (b.state !== 'held') {
    drawFootball(ctx, cam.sx(b.x), cam.sy(sc.los + b.y), b.z * cam.s * 0.9, sim.t * 12);
  }
}

export function carrierMarker(ctx, x, y) {
  const X = Math.round(x);
  const Y = Math.round(y) - 28;
  ctx.fillStyle = '#2a2100';
  ctx.fillRect(X - 3, Y - 1, 7, 2);
  ctx.fillRect(X - 2, Y + 1, 5, 1);
  ctx.fillRect(X - 1, Y + 2, 3, 1);
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(X - 2, Y - 1, 5, 1);
  ctx.fillRect(X - 1, Y, 3, 1);
  ctx.fillRect(X, Y + 1, 1, 1);
}
