// Turns formations and defensive calls into on-field positions and resolved
// assignments (man matchups, zone landmarks, route points). Pure logic.

import { FORMATIONS, FRONTS, ZONES, ROUTES } from '../data/playbook.js';
import { FIELD_W, MID_X, clamp } from '../core/util.js';

const WIDE_INSET = 9.2;
const ELIGIBLE = new Set(['WR', 'TE', 'RB']);

export function alignOffense(formationId, ballX) {
  const f = FORMATIONS[formationId];
  const wideX = { L: WIDE_INSET, R: FIELD_W - WIDE_INSET };
  const out = {};
  for (const s of f.slots) {
    let x;
    if (s.wide) x = wideX[s.wide];
    else if (s.slotSide) {
      const tackle = ballX + (s.slotSide === 'L' ? -3.9 : 3.9);
      x = (tackle + wideX[s.slotSide]) / 2;
    } else x = ballX + s.dx;
    out[s.slot] = { slot: s.slot, pos: s.pos, x: clamp(x, 1.2, FIELD_W - 1.2), y: s.y };
  }
  return out;
}

export function eligibleSlots(offAlign) {
  return Object.values(offAlign).filter((a) => ELIGIBLE.has(a.pos));
}

// Strong side: more receivers (TE counts a bit more). Ties go to the TE side,
// then the wide side of the field.
export function strengthOf(offAlign, ballX) {
  let l = 0;
  let r = 0;
  let teSide = 0;
  for (const a of eligibleSlots(offAlign)) {
    if (a.pos === 'RB' && a.y < -2.5) continue;
    const w = a.pos === 'TE' ? 1.2 : 1;
    if (a.x < ballX - 0.5) l += w;
    else if (a.x > ballX + 0.5) r += w;
    if (a.pos === 'TE') teSide += a.x > ballX ? 1 : -1;
  }
  if (Math.abs(l - r) > 0.1) return r > l ? 'R' : 'L';
  if (teSide) return teSide > 0 ? 'R' : 'L';
  return ballX < MID_X ? 'R' : 'L';
}

export function resolveZone(name, strength, ballX) {
  let key = name;
  if (/[SW]$/.test(name) && !ZONES[name]) {
    const base = name.slice(0, -1);
    const strongR = strength === 'R';
    const side = name.endsWith('S') ? (strongR ? 'R' : 'L') : strongR ? 'L' : 'R';
    key = base + side;
  }
  const z = ZONES[key];
  const shift = (ballX - MID_X) * (z.deep ? 0.25 : 0.5);
  return { key, x: clamp(z.x + shift, 3, FIELD_W - 3), y: z.y, rx: z.rx, ry: z.ry, deep: !!z.deep };
}

// Returns {slot: {slot, pos, x, y, assign}} for the defense.
export function alignDefense(play, offAlign, ballX) {
  const front = FRONTS[play.front];
  const strength = strengthOf(offAlign, ballX);
  const sS = strength === 'R' ? 1 : -1;
  const { LT, LG, C, RG, RT } = offAlign;
  const recs = eligibleSlots(offAlign).filter((a) => !(a.pos === 'RB' && a.y < -2.5));
  const left = recs.filter((a) => a.x < ballX).sort((a, b) => a.x - b.x);
  const right = recs.filter((a) => a.x >= ballX).sort((a, b) => b.x - a.x);
  const strongList = sS > 0 ? right : left;
  const weakList = sS > 0 ? left : right;
  const teOn = (side) => recs.find((a) => a.pos === 'TE' && Math.abs(a.y) < 1.2 && (side > 0 ? a.x > ballX : a.x < ballX));

  const out = {};
  const put = (slot, pos, x, y) => {
    out[slot] = { slot, pos, x: clamp(x, 0.8, FIELD_W - 0.8), y, assign: { ...(play.assign[slot] || { t: 'zone', z: 'hookM' }) } };
  };

  const f = play.front;
  for (const slot of front.slots) {
    const dl = 'DL';
    switch (slot) {
      case 'DE_L': {
        const te = teOn(-1);
        put(slot, dl, f === '34' ? LT.x + 0.4 : (te ? te.x - 1.0 : LT.x - 1.5), 0.9);
        break;
      }
      case 'DE_R': {
        const te = teOn(1);
        put(slot, dl, f === '34' ? RT.x - 0.4 : (te ? te.x + 1.0 : RT.x + 1.5), 0.9);
        break;
      }
      case 'DT_L':
        put(slot, dl, f === 'goal' ? LG.x - 0.3 : sS > 0 ? C.x - 0.8 : LG.x - 0.7, 0.85);
        break;
      case 'DT_R':
        put(slot, dl, f === 'goal' ? RG.x + 0.3 : sS > 0 ? RG.x + 0.7 : C.x + 0.8, 0.85);
        break;
      case 'NT':
        put(slot, dl, C.x, 0.85);
        break;
      case 'OLB_L': {
        const te = teOn(-1);
        put(slot, 'LB', (te ? te.x : LT.x) - 2.4, 1.1);
        break;
      }
      case 'OLB_R': {
        const te = teOn(1);
        put(slot, 'LB', (te ? te.x : RT.x) + 2.4, 1.1);
        break;
      }
      case 'ILB_L':
        put(slot, 'LB', LG.x - 0.6, 4.6);
        break;
      case 'ILB_R':
        put(slot, 'LB', RG.x + 0.6, 4.6);
        break;
      case 'MIKE':
        put(slot, 'LB', ballX + (f === 'nickel' ? sS * 1.8 : f === 'dime' ? 0 : sS * 0.8), f === 'goal' ? 3.2 : 4.7);
        break;
      case 'WILL':
        put(slot, 'LB', ballX - sS * (f === 'nickel' ? 2.4 : f === 'goal' ? 3 : 4), f === 'goal' ? 3.2 : 4.6);
        break;
      case 'SAM': {
        const te = teOn(sS);
        put(slot, 'LB', te ? te.x + sS * 0.6 : ballX + sS * (f === 'goal' ? 3 : 5), f === 'goal' ? 3.2 : 4.0);
        break;
      }
      case 'CB_L': {
        const r = left[0];
        put(slot, 'CB', r && r.x < LT.x - 4 ? r.x + 0.7 : LT.x - 9, 6.5);
        break;
      }
      case 'CB_R': {
        const r = right[0];
        put(slot, 'CB', r && r.x > RT.x + 4 ? r.x - 0.7 : RT.x + 9, 6.5);
        break;
      }
      case 'NB': {
        const r = strongList[1] || weakList[1];
        const inward = r ? (r.x > ballX ? -1 : 1) : 0;
        put(slot, 'CB', r ? r.x + inward * 0.6 : ballX + sS * 7, 5);
        break;
      }
      case 'DB': {
        const r = weakList[1] || strongList[2];
        const inward = r ? (r.x > ballX ? -1 : 1) : 0;
        put(slot, 'CB', r ? r.x + inward * 0.6 : ballX - sS * 7, 5.5);
        break;
      }
      case 'FS':
      case 'SS': {
        const mid = MID_X + (ballX - MID_X) * 0.4;
        let x;
        let y;
        if (play.shell === 2) {
          x = slot === 'FS' ? mid - 9 : mid + 9;
          y = 12.5;
        } else if (play.shell === 1) {
          if (slot === 'FS') { x = mid; y = 13; } else { x = ballX + sS * 6.5; y = 7.5; }
        } else {
          x = slot === 'FS' ? ballX - sS * 5 : ballX + sS * 6;
          y = f === 'goal' ? 4.5 : 7;
        }
        put(slot, 'S', x, y);
        break;
      }
      default:
        put(slot, 'LB', ballX, 5);
    }
  }

  // Resolve zones, blitz gaps and man matchups.
  const manSlots = [];
  for (const d of Object.values(out)) {
    const a = d.assign;
    // drawn assignments come with their own zone spot or rush lane
    if (a.t === 'zone' && !a.zone) a.zone = resolveZone(a.z, strength, ballX);
    if (a.t === 'blitz') {
      if (a.gapX == null) a.gapX = gapX(a.gap, offAlign, sS);
      d.y = Math.min(d.y, 3.2);
      if (a.gap && a.gap.startsWith('edge')) d.x = clamp(a.gapX + Math.sign(a.gapX - ballX) * 1.5, 1, FIELD_W - 1);
    }
    if (a.t === 'man') manSlots.push(d);
    if (a.t === 'fit') d.y = Math.min(d.y, 4);
  }
  assignMan(manSlots, recs.concat(eligibleSlots(offAlign).filter((a) => a.pos === 'RB' && a.y < -2.5)), ballX);
  for (const d of manSlots) {
    const r = d.assign.man && offAlign[d.assign.man];
    if (!r) continue;
    const inward = r.x > ballX ? -1 : 1;
    if (d.pos === 'CB' || d.pos === 'S') {
      if (Math.abs(r.y) < 2.5) {
        d.x = clamp(r.x + inward * 0.6, 0.8, FIELD_W - 0.8);
        d.y = d.assign.press ? 1.2 : d.pos === 'S' ? Math.min(d.y, 6) : 6;
      }
    } else if (d.pos === 'LB' && Math.abs(r.y) < 2.5 && Math.abs(r.x - ballX) > 6) {
      d.x = clamp(r.x + inward * 1.2, 0.8, FIELD_W - 0.8);
      d.y = 4.5;
    }
  }

  return { players: out, strength };
}

function gapX(gap, off, sS) {
  const { LT, LG, C, RG, RT } = off;
  switch (gap) {
    case 'A': return (C.x + (sS > 0 ? RG.x : LG.x)) / 2;
    case 'B': return (sS > 0 ? (RG.x + RT.x) : (LG.x + LT.x)) / 2;
    case 'edgeS': return sS > 0 ? RT.x + 3 : LT.x - 3;
    case 'edgeW': return sS > 0 ? LT.x - 3 : RT.x + 3;
    case 'edgeL': return LT.x - 3;
    case 'edgeR': return RT.x + 3;
    default: return C.x;
  }
}

// Greedy man-coverage matching by alignment distance plus role fit.
function assignMan(defs, recs, ballX) {
  const pairs = [];
  const usedD = new Set();
  const usedR = new Set();
  // drawn matchups are fixed
  for (const d of defs) {
    if (!d.assign.lock || !d.assign.man) continue;
    const r = recs.find((x) => x.slot === d.assign.man);
    if (!r || usedR.has(r)) { d.assign.man = null; continue; }
    usedD.add(d);
    usedR.add(r);
  }
  for (const d of defs) {
    if (usedD.has(d)) continue;
    for (const r of recs) {
      if (usedR.has(r)) continue;
      let cost = Math.abs(d.x - r.x) + Math.abs(d.y - r.y) * 0.25;
      if (d.pos === 'CB' && r.pos === 'RB') cost += 14;
      if (d.pos === 'CB' && r.pos === 'TE') cost += 5;
      if (d.pos === 'LB' && r.pos === 'WR') cost += Math.abs(r.x - ballX) > 8 ? 14 : 6;
      if (d.pos === 'S' && r.pos === 'RB') cost += 4;
      if (d.pos === 'DL') cost += 30;
      pairs.push({ d, r, cost });
    }
  }
  pairs.sort((a, b) => a.cost - b.cost);
  for (const p of pairs) {
    if (usedD.has(p.d) || usedR.has(p.r)) continue;
    p.d.assign.man = p.r.slot;
    usedD.add(p.d);
    usedR.add(p.r);
  }
  // Leftover man defenders become robbers in the middle hook.
  for (const d of defs) {
    if (!d.assign.man) {
      d.assign = { t: 'zone', z: 'hookM', zone: resolveZone('hookM', 'R', ballX) };
    }
  }
}

// Absolute route points for a receiver. side: which sideline is "outside".
// A drawn route ('custom') carries its own points as [dx from the player's
// start, depth past the line].
export function routePoints(start, routeKey, side, ballX, custom = null) {
  if (routeKey === 'custom' && custom && custom.length) {
    const pts = custom.map(([dx, y]) => ({ x: clamp(start.x + dx, 1, FIELD_W - 1), y }));
    const n = pts.length;
    const a = n > 1 ? pts[n - 2] : { x: start.x, y: start.y };
    const b = pts[n - 1];
    // a route drawn back toward the line, or a tiny last leg, sits down there
    const sit = b.y < a.y - 0.8 || Math.hypot(b.x - a.x, b.y - a.y) < 1.5;
    return { pts, end: sit ? 'sit' : 'continue', name: 'Custom' };
  }
  const route = ROUTES[routeKey];
  const s = side || (start.x < ballX ? 'L' : 'R');
  const out = s === 'L' ? -1 : 1;
  const pts = route.pts.map(([o, dy]) => ({
    x: clamp(start.x + o * out, 1, FIELD_W - 1),
    y: dy,
  }));
  return { pts, end: route.end, name: route.name };
}

export function pathPoints(path, ballX) {
  return path.map(([dx, y]) => ({ x: clamp(ballX + dx, 0.8, FIELD_W - 0.8), y }));
}
