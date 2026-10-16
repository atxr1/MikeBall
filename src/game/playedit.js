// Play drawing (milestone 2): turns a coach's finger strokes and taps on the
// pre-snap field into assignment changes for the called play. Pure logic, no
// DOM, so it runs in Node tests.
//
// Edits are a map { slot: assignment } layered over the base play for one
// snap. Coordinates follow the sim: x across the field (yards), y = yards
// past the line of scrimmage, offense moving +y.
//
// Offense
//   drag a receiver/back        -> custom route (or a new run path for the
//                                  ball carrier)
//   drag any blocker to a man   -> block that defender
//   tap a receiver/back/TE      -> switch between running a route and blocking
//   double-tap a back on a run  -> he gets the ball
// Defense
//   drag to a receiver          -> man coverage on him
//   drag to the QB / backfield  -> blitz through that lane
//   drag a lineman              -> rush through that gap
//   drag into open field        -> zone at that spot
//   tap a linebacker/DB         -> switch between blitzing and covering

import { FIELD_W, clamp, dist } from '../core/util.js';

const SKILL = new Set(['WR', 'TE', 'RB']);
const DEFAULT_ROUTE = { WR: 'go', TE: 'seam', RB: 'flat' };
const GRAB = 1.9; // yards: how close a stroke must end to "connect" to a player

export function applyEdits(play, edits) {
  if (!play || !edits || !Object.keys(edits).length) return play;
  return { ...play, assign: { ...(play.assign || {}), ...edits }, editedSlots: Object.keys(edits) };
}

// Fewer points for a drawn stroke: drop points closer than `min` yards, then
// keep the corners (Ramer-Douglas-Peucker).
export function simplify(pts, tol = 0.6, min = 0.8, maxPts = 7) {
  const thin = [];
  for (const p of pts) if (!thin.length || dist(p.x, p.y, thin[thin.length - 1].x, thin[thin.length - 1].y) >= min) thin.push(p);
  const last = pts[pts.length - 1];
  if (thin.length && thin[thin.length - 1] !== last) thin.push(last);
  const rdp = (a, b) => {
    let worst = -1;
    let wd = 0;
    const A = thin[a];
    const B = thin[b];
    const L = dist(A.x, A.y, B.x, B.y) || 1e-6;
    for (let i = a + 1; i < b; i++) {
      const P = thin[i];
      const d = Math.abs((B.x - A.x) * (A.y - P.y) - (A.x - P.x) * (B.y - A.y)) / L;
      if (d > wd) { wd = d; worst = i; }
    }
    if (wd > tol && worst > 0) return [...rdp(a, worst), ...rdp(worst, b).slice(1)];
    return [a, b];
  };
  let idx = thin.length > 1 ? rdp(0, thin.length - 1) : [0];
  let out = idx.map((i) => thin[i]);
  while (out.length > maxPts) {
    // drop the point that bends the least
    let bi = 1;
    let bd = 1e9;
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i - 1];
      const b = out[i + 1];
      const p = out[i];
      const L = dist(a.x, a.y, b.x, b.y) || 1e-6;
      const d = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L;
      if (d < bd) { bd = d; bi = i; }
    }
    out.splice(bi, 1);
  }
  return out;
}

function nearestTo(list, x, y, max) {
  let best = null;
  let bd = max;
  for (const p of list) {
    const d = dist(p.x, p.y, x, y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// The player under a finger, from the side the coach controls.
export function pickPlayer(sim, side, x, y, radius = 2.2) {
  return nearestTo(side === 'O' ? sim.offense : sim.defense, x, y, radius);
}

// What a stroke from player `p` (an entity in the preview sim) means.
// `stroke` is the list of play-local points the finger passed through.
// Returns { slot, assign, label } or null if it means nothing.
// `bodyOff` (yards): how far above a player's feet a finger touching his
// sprite lands, so a stroke ending on a sprite connects to that player.
export function editFromStroke(sim, play, p, stroke, bodyOff = 0) {
  if (!stroke || stroke.length < 2) return null;
  const tip = stroke[stroke.length - 1];
  const end = { x: tip.x, y: tip.y - bodyOff };
  const travel = dist(p.x, p.y, end.x, end.y);
  if (travel < 1.2) return null;
  const base = (play.assign && play.assign[p.slot]) || {};
  if (p.side === 'O') {
    // ending on a defender = block him
    const foe = nearestTo(sim.defense, end.x, end.y, GRAB);
    if (foe && (p.pos === 'OL' || !SKILL.has(p.pos) || travel < 9 || base.t !== 'route')) {
      if (p.pos === 'QB') return null;
      const t = p.pos === 'OL' ? (base.t === 'pull' ? 'zone' : base.t || (play.cat === 'run' ? 'zone' : 'passpro')) : play.cat === 'run' ? 'stalk' : 'passpro';
      const keep = p.pos === 'OL' && (base.t === 'zone' || base.t === 'passpro' || base.t === 'draw' || base.t === 'screenOL') ? base : {};
      return { slot: p.slot, assign: { ...keep, t, target: foe.slot }, label: `${nm(p)} blocks ${num(foe)}` };
    }
    if (p.pos === 'OL' || p.pos === 'QB') return null;
    const pts = simplify([{ x: p.x, y: p.y }, ...stroke]).slice(1);
    if (!pts.length) return null;
    if (base.t === 'carry') {
      // a new run path for the ball carrier, kept relative to the ball
      const path = pts.map((q) => [round1(q.x - sim.ballX), round1(q.y)]);
      return { slot: p.slot, assign: { ...base, path }, label: `New path for ${nm(p)}` };
    }
    const custom = pts.map((q) => [round1(q.x - p.x), round1(clamp(q.y, -8, 45))]);
    return { slot: p.slot, assign: { t: 'route', r: 'custom', pts: custom }, label: `New route for ${nm(p)}` };
  }
  // defense
  const qb = sim.qb;
  // behind the line inside the tackle box, or at the quarterback
  const backfield = dist(end.x, end.y, qb.x, qb.y) < 3 || end.y < -2.5 || (end.y < -0.3 && Math.abs(end.x - sim.ballX) < 6);
  if (p.pos === 'DL') {
    // gap fit: rush through the lane the stroke points at
    const gx = clamp(tip.x, sim.ballX - 9, sim.ballX + 9);
    return { slot: p.slot, assign: { t: 'rush', gapX: round1(gx) }, label: `${nm(p)} rush lane set` };
  }
  // a receiver under the finger = man coverage (a back in the backfield
  // needs a precise touch, otherwise it's a blitz)
  const rec = nearestTo(sim.eligible, end.x, end.y, GRAB);
  if (rec && (rec.y > -2.5 || dist(end.x, end.y, rec.x, rec.y) < 1.2)) {
    return { slot: p.slot, assign: { t: 'man', man: rec.slot, lock: true }, label: `${nm(p)} on ${num(rec)}` };
  }
  if (backfield) {
    const gx = clamp(end.x, sim.ballX - 9, sim.ballX + 9);
    return { slot: p.slot, assign: { t: 'blitz', gapX: round1(gx) }, label: `${nm(p)} blitzes` };
  }
  const zy = clamp(tip.y, 2, 24);
  const deep = zy >= 12;
  const zone = { x: round1(clamp(tip.x, 3, FIELD_W - 3)), y: round1(zy), rx: deep ? 8 : 5, ry: deep ? 8 : 4, deep };
  return { slot: p.slot, assign: { t: 'zone', z: 'custom', zone }, label: `${nm(p)} ${deep ? 'deep zone' : 'zone'}` };
}

// What a tap on player `p` means (route <-> block, blitz <-> cover).
export function editFromTap(sim, play, origPlay, p) {
  const cur = (play.assign && play.assign[p.slot]) || {};
  const orig = (origPlay.assign && origPlay.assign[p.slot]) || {};
  if (p.side === 'O') {
    if (!SKILL.has(p.pos) || cur.t === 'carry' || cur.t === 'pafake') return null;
    const running = cur.t === 'route' || cur.t === 'chkrel';
    if (running) return { slot: p.slot, assign: { t: play.cat === 'run' ? 'stalk' : 'passpro' }, label: `${nm(p)} blocks` };
    const assign = orig.t === 'route' || orig.t === 'chkrel' ? { ...orig, t: 'route' } : { t: 'route', r: DEFAULT_ROUTE[p.pos] || 'go' };
    return { slot: p.slot, assign, label: `${nm(p)} runs a route` };
  }
  if (p.pos === 'DL') return null;
  if (cur.t === 'blitz') {
    const assign = orig.t && orig.t !== 'blitz' && orig.t !== 'rush' ? orig : { t: 'zone', z: 'hookM' };
    return { slot: p.slot, assign, label: `${nm(p)} drops into coverage` };
  }
  return { slot: p.slot, assign: { t: 'blitz', gap: p.x < sim.ballX ? (p.pos === 'LB' ? 'A' : 'edgeL') : p.pos === 'LB' ? 'B' : 'edgeR' }, label: `${nm(p)} blitzes` };
}

// Double-tap a back on a run play: he becomes the ball carrier on the same
// path (shifted to where he lines up); the old carrier lead-blocks.
export function editFromDoubleTap(sim, play, p) {
  if (play.cat !== 'run' || p.side !== 'O' || p.pos !== 'RB') return null;
  const cur = (play.assign && play.assign[p.slot]) || {};
  if (cur.t === 'carry') return null;
  const slots = Object.keys(play.assign || {});
  const oldSlot = slots.find((s) => play.assign[s].t === 'carry' && !play.assign[s].self);
  if (!oldSlot) return null;
  const old = sim.bySlot[oldSlot];
  const carry = play.assign[oldSlot];
  const shift = old ? p.x - old.x : 0;
  const path = carry.path.map(([dx, y], i) => [round1(dx + (i === 0 ? shift : shift * 0.5)), y]);
  const first = carry.path[carry.path.length > 1 ? 1 : 0];
  return {
    edits: {
      [p.slot]: { ...carry, path },
      [oldSlot]: { t: 'lead', to: [first[0], Math.max(-0.5, first[1])] },
    },
    label: `${nm(p)} gets the ball`,
  };
}

function nm(p) {
  return (p.rec && p.rec.last) || p.slot;
}
function num(p) {
  return p.rec && p.rec.num != null ? `#${p.rec.num}` : p.slot;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}
