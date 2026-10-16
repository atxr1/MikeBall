// Play art: drawn over the field before the snap (only for the user's side),
// and as small SVG diagrams on the play cards.

import { FORMATIONS, ZONES } from '../data/playbook.js';
import { alignOffense, alignDefense, routePoints, pathPoints } from '../sim/align.js';
import { MID_X, FIELD_W, clamp } from '../core/util.js';

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
export function drawFieldArt(ctx, cam, sim, side, los) {
  const u = cam.s;
  const X = (x) => cam.sx(x);
  const Y = (y) => cam.sy(los + y);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (side === 'O') {
    const prog = (sim.offPlay.progression || []);
    for (const p of sim.offense) {
      const j = p.job;
      if (j.t === 'route' || j.t === 'chkrel') {
        const idx = prog.indexOf(p.slot);
        const col = idx >= 0 ? READ_COLORS[idx % READ_COLORS.length] : '#ffffff';
        const pts = extend(p.pts, { x: p.sx, y: p.sy }, p.routeEnd, 4);
        strokePath(ctx, [{ x: p.sx, y: p.sy }, ...pts], X, Y, col, u * 0.22, j.t === 'chkrel' ? [u * 0.5, u * 0.35] : null);
        if (p.routeEnd === 'continue') arrowHead(ctx, pts, X, Y, col, u);
        else endDot(ctx, pts, X, Y, col, u);
        if (idx >= 0 && u > 7) readBadge(ctx, X(p.sx), Y(p.sy) + u * 0.9, idx + 1, col, u);
      } else if (j.t === 'carry') {
        const pts = p.pts;
        strokePath(ctx, [{ x: p.sx, y: p.sy }, ...pts], X, Y, RUN_COLOR, u * 0.26);
        arrowHead(ctx, pts, X, Y, RUN_COLOR, u);
      } else if (j.t === 'pafake') {
        strokePath(ctx, [{ x: p.sx, y: p.sy }, ...p.pts], X, Y, RUN_COLOR, u * 0.18, [u * 0.4, u * 0.3]);
      } else if (j.t === 'pull' || j.t === 'lead') {
        const pts = p.pts;
        strokePath(ctx, [{ x: p.sx, y: p.sy }, ...pts], X, Y, BLOCK_COLOR, u * 0.18);
        tBar(ctx, pts, X, Y, BLOCK_COLOR, u);
      } else if (j.t === 'passpro' || j.t === 'draw' || j.t === 'screenOL') {
        const pts = [{ x: p.sx, y: p.sy - 1.1 }];
        strokePath(ctx, [{ x: p.sx, y: p.sy }, ...pts], X, Y, BLOCK_COLOR, u * 0.16);
        tBar(ctx, [{ x: p.sx, y: p.sy }, ...pts], X, Y, BLOCK_COLOR, u);
      } else if (j.t === 'zone' || j.t === 'stalk') {
        const dir = j.dir || 0;
        const pts = [{ x: p.sx + dir * 0.9, y: p.sy + 1.3 }];
        strokePath(ctx, [{ x: p.sx, y: p.sy }, ...pts], X, Y, BLOCK_COLOR, u * 0.16);
        tBar(ctx, [{ x: p.sx, y: p.sy }, ...pts], X, Y, BLOCK_COLOR, u);
      }
    }
  } else {
    const qb = sim.qb;
    for (const d of sim.defense) {
      const a = d.assign;
      if (a.t === 'zone' && a.zone) {
        const z = a.zone;
        const col = zoneColor(z);
        ctx.fillStyle = hexA(col, 0.12);
        ctx.strokeStyle = hexA(col, 0.7);
        ctx.lineWidth = Math.max(1, u * 0.1);
        ctx.beginPath();
        ctx.ellipse(X(z.x), Y(z.y), z.rx * u * 0.62, z.ry * u * 0.62 * 0.86, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        strokePath(ctx, [{ x: d.sx, y: d.sy }, { x: z.x, y: z.y }], X, Y, hexA(col, 0.9), u * 0.12, [u * 0.3, u * 0.25]);
      } else if (a.t === 'man' && d.target) {
        strokePath(ctx, [{ x: d.sx, y: d.sy }, { x: d.target.sx, y: d.target.sy + 0.6 }], X, Y, MAN_COLOR, u * 0.15, [u * 0.35, u * 0.25]);
      } else if (a.t === 'rush') {
        const pts = [{ x: d.sx + (qb.sx - d.sx) * 0.35, y: d.sy - 2.2 }];
        strokePath(ctx, [{ x: d.sx, y: d.sy }, ...pts], X, Y, RUSH_COLOR, u * 0.2);
        arrowHead(ctx, [{ x: d.sx, y: d.sy }, ...pts], X, Y, RUSH_COLOR, u);
      } else if (a.t === 'blitz') {
        const pts = [{ x: a.gapX, y: 0 }, { x: a.gapX + (qb.sx - a.gapX) * 0.5, y: -3 }];
        strokePath(ctx, [{ x: d.sx, y: d.sy }, ...pts], X, Y, '#FF2E63', u * 0.24);
        arrowHead(ctx, [{ x: d.sx, y: d.sy }, ...pts], X, Y, '#FF2E63', u);
      } else if (a.t === 'spy') {
        ctx.strokeStyle = '#C77DFF';
        ctx.lineWidth = Math.max(1, u * 0.12);
        ctx.setLineDash([u * 0.3, u * 0.25]);
        ctx.beginPath();
        ctx.arc(X(qb.sx), Y(qb.sy + 5.5), u * 1.6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (a.t === 'fit') {
        const pts = [{ x: d.sx + (MID_X - d.sx) * 0.05, y: 1.2 }];
        strokePath(ctx, [{ x: d.sx, y: d.sy }, ...pts], X, Y, '#FF8A3D', u * 0.2);
        arrowHead(ctx, [{ x: d.sx, y: d.sy }, ...pts], X, Y, '#FF8A3D', u);
      }
    }
  }
  ctx.restore();
}

function hexA(hex, a) {
  if (hex.startsWith('rgba')) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function strokePath(ctx, pts, X, Y, color, w, dash) {
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = w + 2;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
  ctx.stroke();
  ctx.setLineDash([]);
}

function arrowHead(ctx, pts, X, Y, color, u) {
  if (pts.length < 1) return;
  const b = pts[pts.length - 1];
  const a = pts.length > 1 ? pts[pts.length - 2] : { x: b.x, y: b.y - 1 };
  const ang = Math.atan2(Y(b.y) - Y(a.y), X(b.x) - X(a.x));
  const L = u * 0.75;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(X(b.x) + Math.cos(ang) * L * 0.3, Y(b.y) + Math.sin(ang) * L * 0.3);
  ctx.lineTo(X(b.x) + Math.cos(ang + 2.5) * L, Y(b.y) + Math.sin(ang + 2.5) * L);
  ctx.lineTo(X(b.x) + Math.cos(ang - 2.5) * L, Y(b.y) + Math.sin(ang - 2.5) * L);
  ctx.closePath();
  ctx.fill();
}

function endDot(ctx, pts, X, Y, color, u) {
  const b = pts[pts.length - 1];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(X(b.x), Y(b.y), u * 0.28, 0, Math.PI * 2);
  ctx.fill();
}

function tBar(ctx, pts, X, Y, color, u) {
  if (pts.length < 2) return;
  const b = pts[pts.length - 1];
  const a = pts[pts.length - 2];
  const ang = Math.atan2(Y(b.y) - Y(a.y), X(b.x) - X(a.x)) + Math.PI / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = u * 0.18;
  ctx.beginPath();
  ctx.moveTo(X(b.x) + Math.cos(ang) * u * 0.45, Y(b.y) + Math.sin(ang) * u * 0.45);
  ctx.lineTo(X(b.x) - Math.cos(ang) * u * 0.45, Y(b.y) - Math.sin(ang) * u * 0.45);
  ctx.stroke();
}

function readBadge(ctx, x, y, n, col, u) {
  const r = u * 0.34;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0e1a2b';
  ctx.font = `800 ${Math.round(r * 1.5)}px "Big Shoulders Display", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x, y + r * 0.08);
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
