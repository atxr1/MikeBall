// Where a receiver goes after his route's last point, shared by the
// receiver running it (src/sim/offense.js runRoute) and the passer
// projecting where he'll be when the ball gets there (src/sim/passing.js
// routeAhead), so the two always agree. Pure geometry, yards.

import { FIELD_W, clamp } from '../core/util.js';

// A receiver running toward the sideline turns upfield this far inside it
// (src/sim/offense.js runRoute), and the passer projects him the same way
// (src/sim/passing.js routeAhead).
// A route that finishes going sideways (a flat, an out) turns up a little
// further in, outside the numbers.
export const SIDE_LANE = 1.8;
export const FLAT_LANE = 4.5;
export const laneFor = (dx, dy) => (Math.abs(dx) > Math.abs(dy) * 1.5 ? FLAT_LANE : SIDE_LANE);

// In the end zone he can't go past the end line: a receiver working
// toward it pulls up this far inside, then works along it the way his route
// was angling, at this fraction of his speed (or sits there if he was going
// straight up).
export const BACK_ROOM = 2.2;
export const ENDLINE_FRAC = 0.5;
export const endLineSide = (dx) => (Math.abs(dx) > 0.25 ? Math.sign(dx) : 0);

// Where a receiver gets to going (dx, dy) for `left` yards from (x, y):
// straight on, or up the sideline once he reaches it, and along the end
// line (backY) once he gets there.
// `left` is at his running speed; along the end line he goes at
// ENDLINE_FRAC of it.
export function alongRoute(x, y, dx, dy, left, lane = laneFor(dx, dy), backY = Infinity, side = endLineSide(dx)) {
  const P = alongField(x, y, dx, dy, left, lane);
  if (P.y <= backY) return P;
  // how far he goes before he gets to the line (the path is two straight
  // pieces: on his way, then up the sideline)
  let l = 0;
  if (y < backY) {
    const toEdge = Math.abs(dx) > 1e-3 ? ((dx < 0 ? lane : FIELD_W - lane) - x) / dx : Infinity;
    if (toEdge < 0) l = (backY - y) / 0.95;
    else if (dy > 0 && (backY - y) / dy <= toEdge) l = (backY - y) / dy;
    else l = toEdge + (backY - (y + dy * toEdge)) / 0.95;
    l = clamp(l, 0, left);
  }
  const Q = l > 0 ? alongField(x, y, dx, dy, l, lane) : { x, y };
  return { x: clamp(Q.x + side * (left - l) * ENDLINE_FRAC, lane, FIELD_W - lane), y: backY };
}

function alongField(x, y, dx, dy, left, lane) {
  const lo = lane;
  const hi = FIELD_W - lane;
  if (Math.abs(dx) > 1e-3) {
    const edge = dx < 0 ? lo : hi;
    const toEdge = (edge - x) / dx;
    if (toEdge >= 0 && toEdge < left) {
      return { x: edge, y: y + dy * toEdge + Math.max(0, left - toEdge) * 0.95 };
    }
    if (toEdge < 0) return { x: clamp(x, lo, hi), y: y + left * 0.95 }; // already on it
  }
  return { x: x + dx * left, y: y + dy * left };
}

// A flat or a swing finishes by settling: on toward the sideline at a
// jog, a little deeper, looking back for the ball, stopping short of the
// boundary. settleStep: where he gets to drifting `d` yards from (x, y)
// after a last leg going (dx, dy).
export const SETTLE_FRAC = 0.45;
export function settleDir(dx, dy) {
  const m = Math.hypot(dx, dy) || 1;
  const ux = (dx / m) * 6;
  const uy = (dy / m) * 6 + 1.5;
  const k = Math.hypot(ux, uy) || 1;
  return [ux / k, uy / k];
}
export function settleStep(x, y, dx, dy, d, backY = Infinity) {
  const [ux, uy] = settleDir(dx, dy);
  return { x: clamp(x + ux * d, FLAT_LANE, FIELD_W - FLAT_LANE), y: Math.min(y + uy * d, Math.max(y, backY)) };
}
