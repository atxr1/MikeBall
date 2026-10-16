// Play art: drawn over the field before the snap (only for the user's side),
// and as small SVG diagrams on the play cards.

import { FORMATIONS, ZONES } from '../data/playbook.js';
import { alignOffense, alignDefense, routePoints, pathPoints } from '../sim/align.js';
import { MID_X, FIELD_W, clamp } from '../core/util.js';
import * as PX from './pixeldraw.js';
import { drawText } from './pixelfont.js';

export const READ_COLORS = ['#FFD23F', '#4FD1FF', '#FF8A3D', '#C77DFF', '#7CF29A'];
const RUN_COLOR = '#ffffff';
const BLOCK_COLOR = 'rgba(255,255,255,0.75)';
const RUSH_COLOR = '#FF5A4E';
const MAN_COLOR = '#FF8C82';

export function zoneColor(z) {
  if (!z) return '#FFD23F';
  if (z.deep) return '#3D8BFF';
  if (z.key && z.key.startsWith('flat')) return '#39C0FF';
  if (z.key && z.key.startsWith('tampa')) return '#A78BFA';
  return '#FFD23F';
}

function extend(pts, start, end, len) {
  if (end !== 'continue' || !pts.length) return pts;
  const a = pts.length > 1 ? pts[pts.length - 2] : start;
  const b = pts[pts.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const m = Math.hypot(dx, dy) || 1;
  return [...pts, { x: clamp(b.x + (dx / m) * len, 0.8, FIELD_W - 0.8), y: b.y + (dy / m) * len }];
}

// ---------------------------------------------------------------- on-field
// Drawn into the low-res pixel buffer with hard-edged lines.
export function drawFieldArt(ctx, cam, sim, side, los) {
  const X = (x) => Math.round(cam.sx(x));
  const Y = (y) => Math.round(cam.sy(los + y));
  const P = (pt) => ({ x: X(pt.x), y: Y(pt.y) });
  const shadowed = (pts, col, opts) => {
    PX.polyline(ctx, pts.map((p) => ({ x: p.x, y: p.y + 1 })), 'rgba(0,20,0,0.45)', opts);
    PX.polyline(ctx, pts, col, opts);
  };
  if (side === 'O') {
    const prog = sim.offPlay.progression || [];
    for (const p of sim.offense) {
      const j = p.job;
      const start = { x: p.sx, y: p.sy };
      if (j.t === 'route' || j.t === 'chkrel') {
        const idx = prog.indexOf(p.slot);
        const col = idx >= 0 ? READ_COLORS[idx % READ_COLORS.length] : '#ffffff';
        const pts = [start, ...extend(p.pts, start, p.routeEnd, 4)].map(P);
        shadowed(pts, col, { w: 2, dash: j.t === 'chkrel' ? [3, 2] : null });
        const a = pts[pts.length - 2];
        const b = pts[pts.length - 1];
        if (p.routeEnd === 'continue') PX.arrowHead(ctx, a.x, a.y, b.x, b.y, col, 5);
        else PX.disc(ctx, b.x, b.y, 2, col);
        if (idx >= 0) readTag(ctx, X(p.sx), Y(p.sy) + 3, idx + 1, col);
      } else if (j.t === 'carry') {
        const pts = [start, ...p.pts].map(P);
        shadowed(pts, '#ffffff', { w: 2 });
        const a = pts[pts.length - 2];
        const b = pts[pts.length - 1];
        PX.arrowHead(ctx, a.x, a.y, b.x, b.y, '#ffffff', 5);
      } else if (j.t === 'pafake') {
        shadowed([start, ...p.pts].map(P), '#ffffff', { dash: [2, 2] });
      } else if (j.t === 'pull' || j.t === 'lead') {
        const pts = [start, ...p.pts].map(P);
        shadowed(pts, BLOCK_COLOR, {});
        PX.tBar(ctx, pts[pts.length - 2].x, pts[pts.length - 2].y, pts[pts.length - 1].x, pts[pts.length - 1].y, BLOCK_COLOR, 3);
      } else if (j.t === 'zone' || j.t === 'stalk' || j.t === 'passpro' || j.t === 'draw' || j.t === 'screenOL') {
        const dir = j.t === 'zone' || j.t === 'stalk' ? (j.dir || 0) : 0;
        const fwd = j.t === 'zone' || j.t === 'stalk' ? 1.6 : -1.2;
        const a = P(start);
        const b = P({ x: p.sx + dir * 0.9, y: p.sy + fwd });
        PX.line(ctx, a.x, a.y, b.x, b.y, BLOCK_COLOR);
        PX.tBar(ctx, a.x, a.y, b.x, b.y, BLOCK_COLOR, 3);
      }
    }
  } else {
    const qb = sim.qb;
    for (const d of sim.defense) {
      const a = d.assign;
      const start = P({ x: d.sx, y: d.sy });
      if (a.t === 'zone' && a.zone) {
        const z = a.zone;
        const col = zoneColor(z);
        const c = P({ x: z.x, y: z.y });
        const rx = Math.round(z.rx * cam.s * 0.62);
        const ry = Math.round(z.ry * cam.s * 0.62 * 0.86);
        ctx.globalAlpha = 0.16;
        PX.disc(ctx, c.x, c.y, rx, col, ry / Math.max(1, rx));
        ctx.globalAlpha = 1;
        PX.ring(ctx, c.x, c.y, rx, ry, col, 2);
        PX.line(ctx, start.x, start.y, c.x, c.y, col, { dash: [2, 2] });
      } else if (a.t === 'man' && d.target) {
        const t = P({ x: d.target.sx, y: d.target.sy + 0.6 });
        PX.line(ctx, start.x, start.y, t.x, t.y, MAN_COLOR, { dash: [3, 2] });
      } else if (a.t === 'rush') {
        const b = P({ x: d.sx + (qb.sx - d.sx) * 0.35, y: d.sy - 2.2 });
        shadowed([start, b], RUSH_COLOR, { w: 2 });
        PX.arrowHead(ctx, start.x, start.y, b.x, b.y, RUSH_COLOR, 3);
      } else if (a.t === 'blitz') {
        const pts = [start, P({ x: a.gapX, y: 0 }), P({ x: a.gapX + (qb.sx - a.gapX) * 0.5, y: -3 })];
        shadowed(pts, '#FF2E63', { w: 2 });
        PX.arrowHead(ctx, pts[1].x, pts[1].y, pts[2].x, pts[2].y, '#FF2E63', 4);
      } else if (a.t === 'spy') {
        const c = P({ x: qb.sx, y: qb.sy + 5.5 });
        PX.ring(ctx, c.x, c.y, Math.round(cam.s * 1.6), Math.round(cam.s * 1.4), '#C77DFF', 2);
      } else if (a.t === 'fit') {
        const b = P({ x: d.sx, y: 1.2 });
        shadowed([start, b], '#FF8A3D', { w: 2 });
        PX.arrowHead(ctx, start.x, start.y, b.x, b.y, '#FF8A3D', 3);
      }
    }
  }
}

function readTag(ctx, x, y, n, col) {
  ctx.fillStyle = '#0e1a2b';
  ctx.fillRect(x - 4, y, 9, 9);
  ctx.fillStyle = col;
  ctx.fillRect(x - 3, y + 1, 7, 7);
  drawText(ctx, String(n), x - 2, y + 1, 1, '#0e1a2b');
}

function hexA(hex, a) {
  if (hex.startsWith('rgba')) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------------------------------------------------------------- cards (SVG)
const VB = { x0: 3.5, x1: 49.8, y0: -8.5, y1: 20 };
const svgCache = new Map();

export function playCardSVG(play, side) {
  const key = `${side}:${play.id}`;
  if (svgCache.has(key)) return svgCache.get(key);
  const w = VB.x1 - VB.x0;
  const h = VB.y1 - VB.y0;
  const X = (x) => (x - VB.x0).toFixed(2);
  const Y = (y) => (VB.y1 - y).toFixed(2);
  const parts = [];
  const line = (pts, col, sw, dash, marker) => {
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x)} ${Y(p.y)}`).join(' ');
    parts.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}${marker ? ` marker-end="url(#${marker})"` : ''}/>`);
  };
  parts.push(`<line x1="0" x2="${w}" y1="${Y(0)}" y2="${Y(0)}" stroke="rgba(255,255,255,0.25)" stroke-width="0.35"/>`);

  if (side === 'O') {
    if (play.special) {
      parts.push(specialArt(play, X, Y));
    } else {
      const al = alignOffense(play.formation, MID_X);
      const prog = play.progression || [];
      for (const s of FORMATIONS[play.formation].slots) {
        const p = al[s.slot];
        const j = play.assign[s.slot] || {};
        if (j.t === 'route' || j.t === 'chkrel') {
          const rp = routePoints(p, j.r, j.side, MID_X);
          const idx = prog.indexOf(s.slot);
          const col = idx >= 0 ? READ_COLORS[idx % READ_COLORS.length] : '#ffffff';
          const pts = extend(rp.pts, p, rp.end, 3);
          line([p, ...pts], col, 0.9, j.t === 'chkrel' ? '1.4 1' : null, rp.end === 'continue' ? `ah${idx >= 0 ? idx % 5 : 'w'}` : null);
        } else if (j.t === 'carry') {
          line([p, ...pathPoints(j.path, MID_X)], '#ffffff', 1.1, null, 'ahw');
        } else if (j.t === 'pull' || j.t === 'lead') {
          line([p, ...pathPoints(j.t === 'pull' ? j.path : [j.to], MID_X)], 'rgba(255,255,255,0.7)', 0.7);
        } else if (j.t === 'pafake') {
          line([p, ...pathPoints(j.path, MID_X)], '#ffffff', 0.7, '1.2 0.9');
        }
      }
      for (const s of FORMATIONS[play.formation].slots) {
        const p = al[s.slot];
        parts.push(`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="0.95" fill="${s.slot === 'C' ? '#ffffff' : '#e8eef6'}" stroke="#0e1a2b" stroke-width="0.3"/>`);
      }
    }
  } else {
    const off = alignOffense('gun_doubles', MID_X);
    const { players } = alignDefense(play, off, MID_X);
    for (const d of Object.values(players)) {
      const a = d.assign;
      if (a.t === 'zone' && a.zone) {
        const z = a.zone;
        const col = zoneColor(z);
        parts.push(`<ellipse cx="${X(z.x)}" cy="${Y(z.y)}" rx="${(z.rx * 0.62).toFixed(2)}" ry="${(z.ry * 0.62).toFixed(2)}" fill="${hexA(col, 0.22)}" stroke="${hexA(col, 0.9)}" stroke-width="0.45"/>`);
        line([d, { x: z.x, y: z.y }], hexA(col, 0.9), 0.5, '1 0.8');
      } else if (a.t === 'man' && a.man) {
        const r = off[a.man];
        line([d, { x: r.x, y: r.y + 0.8 }], MAN_COLOR, 0.6, '1.2 0.8');
      } else if (a.t === 'blitz') {
        line([d, { x: a.gapX, y: 0 }, { x: MID_X, y: -4 }], '#FF2E63', 0.9, null, 'ahr');
      } else if (a.t === 'rush') {
        line([d, { x: d.x + (MID_X - d.x) * 0.3, y: -2 }], RUSH_COLOR, 0.8, null, 'ahr');
      } else if (a.t === 'fit') {
        line([d, { x: d.x, y: 1.2 }], '#FF8A3D', 0.8, null, 'aho');
      } else if (a.t === 'spy') {
        parts.push(`<circle cx="${X(MID_X)}" cy="${Y(1)}" r="1.6" fill="none" stroke="#C77DFF" stroke-width="0.45" stroke-dasharray="1 0.7"/>`);
      }
    }
    for (const r of Object.values(off)) parts.push(`<circle cx="${X(r.x)}" cy="${Y(r.y)}" r="0.7" fill="rgba(255,255,255,0.35)"/>`);
    for (const d of Object.values(players)) {
      const x = +X(d.x);
      const y = +Y(d.y);
      parts.push(`<path d="M${x - 0.8} ${y - 0.8}L${x + 0.8} ${y + 0.8}M${x + 0.8} ${y - 0.8}L${x - 0.8} ${y + 0.8}" stroke="#f4f6fa" stroke-width="0.55" stroke-linecap="round"/>`);
    }
  }

  const markers = [
    ...READ_COLORS.map((c, i) => [`ah${i}`, c]),
    ['ahw', '#ffffff'], ['ahr', RUSH_COLOR], ['aho', '#FF8A3D'],
  ].map(([id, c]) => `<marker id="${id}" viewBox="0 0 4 4" refX="2" refY="2" markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse"><path d="M0 0L4 2L0 4z" fill="${c}"/></marker>`).join('');
  const svg = `<svg viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>${markers}</defs>${parts.join('')}</svg>`;
  svgCache.set(key, svg);
  return svg;
}

function specialArt(play, X, Y) {
  const c = (x, y, r = 0.95) => `<circle cx="${X(x)}" cy="${Y(y)}" r="${r}" fill="#e8eef6" stroke="#0e1a2b" stroke-width="0.3"/>`;
  const out = [];
  const mid = MID_X;
  if (play.special === 'punt') {
    for (let i = -5; i <= 5; i++) if (i !== 0 || true) out.push(c(mid + i * 1.95, -0.9));
    out.push(c(mid, -14 + 8, 1));
    out.push(`<path d="M${X(mid)} ${Y(-6)} Q ${X(mid + 6)} ${Y(14)} ${X(mid + 3)} ${Y(19)}" fill="none" stroke="#FFD23F" stroke-width="0.9" stroke-dasharray="1.4 0.8"/>`);
  } else if (play.special === 'fg') {
    for (let i = -4; i <= 4; i++) out.push(c(mid + i * 1.95, -0.9));
    out.push(c(mid - 0.5, -6), c(mid - 2, -8.2));
    out.push(`<path d="M${X(mid)} ${Y(-6)} L ${X(mid)} ${Y(19)}" stroke="#FFD23F" stroke-width="0.9" stroke-dasharray="1.4 0.8"/>`);
    out.push(`<path d="M${X(mid - 3)} ${Y(17)} L${X(mid + 3)} ${Y(17)} M${X(mid - 3)} ${Y(17)} L${X(mid - 3)} ${Y(20)} M${X(mid + 3)} ${Y(17)} L${X(mid + 3)} ${Y(20)}" stroke="#f6d33a" stroke-width="0.7"/>`);
  } else if (play.special === 'kneel') {
    for (let i = -2; i <= 2; i++) out.push(c(mid + i * 1.95, -0.9));
    out.push(c(mid, -1.4), c(mid - 1.5, -4), c(mid + 1.5, -4), c(mid, -7));
    out.push(`<path d="M${X(mid)} ${Y(-1.4)} L${X(mid)} ${Y(-3)}" stroke="#ffffff" stroke-width="0.8"/>`);
  } else {
    for (let i = -2; i <= 2; i++) out.push(c(mid + i * 1.95, -0.9));
    out.push(c(mid, -5));
    out.push(`<path d="M${X(mid)} ${Y(-5)} L${X(mid)} ${Y(-6.5)}" stroke="#FFD23F" stroke-width="1"/>`);
  }
  return out.join('');
}

export { ZONES };
