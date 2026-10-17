// Draws the 22 players of a live (or pre-snap) play: each player's pose is
// generated from the sim state (src/render/animate.js) and drawn with the
// procedural rig (src/render/rig.js), then the ball and the carrier marker.

import { drawShadow, drawFootball } from './pixelsprites.js';
import { playerOutfit, drawRig } from './rig.js';
import { animatePlayer } from './animate.js';
import { officialPose, officialOutfit, drawFlags } from './crewdraw.js';

const sortBuf = [];
const outfits = new Map();

export function outfitFor(uni, skin) {
  const k = `${uni.key}|${skin}`;
  let o = outfits.get(k);
  if (!o) {
    o = playerOutfit(uni, skin);
    outfits.set(k, o);
  }
  return o;
}

export function clearOutfits() {
  outfits.clear();
}

// Players doing something other than their position's usual job — a corner
// or safety blitzing, a lineman dropping into coverage, a receiver or tight
// end staying in to block on a pass, anyone the coach redrew — get a colored
// ring on the turf so they're easy to find. Returns the ring color or null.
const BLITZ_RING = '#ff5a4e';
const COVER_RING = '#4fa3ff';
const BLOCK_RING = '#4fd1ff';
const ROUTE_RING = '#ffd23f';
export function secondaryRing(p, sim) {
  if (p.side === 'D') {
    const t = p.assign && p.assign.t;
    if ((p.pos === 'CB' || p.pos === 'S') && (t === 'blitz' || t === 'rush')) return BLITZ_RING;
    if (p.pos === 'DL' && (t === 'zone' || t === 'man' || t === 'spy')) return COVER_RING;
    return null;
  }
  const j = p.job && p.job.t;
  const block = j === 'passpro' || j === 'stalk' || j === 'zone' || (p.job && p.job.target);
  const pass = sim.offPlay && sim.offPlay.cat === 'pass';
  if ((p.pos === 'WR' || p.pos === 'TE') && block && pass) return BLOCK_RING;
  const edited = sim.offPlay && sim.offPlay.editedSlots && sim.offPlay.editedSlots.includes(p.slot);
  if (edited && p.pos !== 'OL') return block ? BLOCK_RING : ROUTE_RING;
  if (p.pos === 'OL' && (j === 'route' || j === 'chkrel' || j === 'carry')) return ROUTE_RING;
  return null;
}

function ring(ctx, x, y, col) {
  const X = Math.round(x);
  const Y = Math.round(y);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(X - 5, Y + 3, 11, 1);
  ctx.fillStyle = col;
  ctx.fillRect(X - 4, Y - 2, 9, 1);
  ctx.fillRect(X - 4, Y + 2, 9, 1);
  ctx.fillRect(X - 6, Y - 1, 2, 3);
  ctx.fillRect(X + 5, Y - 1, 2, 3);
}

// sc: { sim, los, offUni, defUni, markSide }; live: the play is running or
// just ended. markSide: 'O' | 'D' | null — whose secondary assignments to ring.
// override(p): optional { x, y, pose } for players the pre-snap stage is
// moving (src/ui/presnap.js).
export function drawSimPlayers(ctx, cam, sc, live, override = null) {
  const sim = sc.sim;
  const list = sortBuf;
  list.length = 0;
  for (const p of sim.players) list.push(p);
  const over = new Map();
  if (override) for (const p of list) { const o = override(p); if (o) over.set(p, o); }
  const pos = (p) => over.get(p) || null;
  const items = [];
  for (const p of list) {
    if (p.hidden) continue;
    const o = pos(p);
    if (o && o.gone) continue;
    const wx = o ? o.x : p.x;
    const wy = o ? o.y : p.y;
    const x = cam.sx(wx);
    const y = cam.sy(sc.los + wy);
    if (x < -24 || x > cam.w + 24 || y < -6 || y > cam.h + 34) continue;
    const e = o && o.pose ? o.pose : animatePlayer(p, sim, live);
    items.push([p, x, y, e]);
    if (sc.markSide === p.side && !p.down && !(live && sim.done && sim.post && sim.post.t > 0.6)) {
      const col = secondaryRing(p, sim);
      if (col) ring(ctx, x, y, col);
    }
    drawShadow(ctx, x, y, e.lie || Math.abs(e.rot) >= 4 ? 16 : 10);
  }
  // the officials, sorted in with the players
  if (sim.crew && sc.crew !== false) {
    const now = sim.clock();
    for (const o of sim.crew.list) {
      const x = cam.sx(o.x);
      const y = cam.sy(sc.los + o.y);
      if (x < -24 || x > cam.w + 24 || y < -6 || y > cam.h + 34) continue;
      drawShadow(ctx, x, y, 9);
      items.push([o, x, y, officialPose(o, sim.crew, now, live && (sim.t > 0.02 || sim.done)), true]);
    }
    drawFlags(ctx, cam, sim, sc.los, true);
  }
  // farther up the screen first
  items.sort((a, b) => a[2] - b[2]);
  const b = sim.ball;
  for (const [p, x, y, e, official] of items) {
    const yy = y - (e.lift || 0);
    if (official) { drawRig(ctx, officialOutfit(p), e, x, yy, null, p); continue; }
    const uni = p.side === 'O' ? sc.offUni : sc.defUni;
    drawRig(ctx, outfitFor(uni, p.rec.skinTone || 0), e, x, yy, p.rec.num, p);
    const holder = b.holder === p && b.state === 'held';
    if (holder && live && sim.phase === 'run' && !p.down && !sim.done) carrierMarker(ctx, x, yy);
  }
  if (sim.crew && sc.crew !== false) drawFlags(ctx, cam, sim, sc.los, false);
  if (b.state !== 'held') {
    drawFootball(ctx, cam.sx(b.x), cam.sy(sc.los + b.y), b.z * cam.s * 0.9, sim.t * 12);
  }
}

export function carrierMarker(ctx, x, y) {
  const X = Math.round(x);
  const Y = Math.round(y) - 30;
  ctx.fillStyle = '#2a2100';
  ctx.fillRect(X - 3, Y - 1, 7, 2);
  ctx.fillRect(X - 2, Y + 1, 5, 1);
  ctx.fillRect(X - 1, Y + 2, 3, 1);
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(X - 2, Y - 1, 5, 1);
  ctx.fillRect(X - 1, Y, 3, 1);
  ctx.fillRect(X, Y + 1, 1, 1);
}
