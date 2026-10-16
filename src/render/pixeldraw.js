// Pixel-exact drawing helpers for the low-res buffer (no anti-aliasing).

export function plot(ctx, x, y, w = 1) {
  ctx.fillRect(Math.round(x) - (w > 1 ? 1 : 0), Math.round(y) - (w > 1 ? 1 : 0), w, w);
}

// Bresenham line. opts: { w: 1|2, dash: [on, off] }
export function line(ctx, x0, y0, x1, y1, color, opts = {}) {
  const w = opts.w || 1;
  const dash = opts.dash;
  ctx.fillStyle = color;
  let x = Math.round(x0);
  let y = Math.round(y0);
  const X = Math.round(x1);
  const Y = Math.round(y1);
  const dx = Math.abs(X - x);
  const dy = -Math.abs(Y - y);
  const sx = x < X ? 1 : -1;
  const sy = y < Y ? 1 : -1;
  let err = dx + dy;
  let i = opts.phase || 0;
  for (let guard = 0; guard < 4000; guard++) {
    if (!dash || i % (dash[0] + dash[1]) < dash[0]) ctx.fillRect(x, y, w, w);
    i++;
    if (x === X && y === Y) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return i;
}

// Polyline through points [{x, y}] in screen pixels.
export function polyline(ctx, pts, color, opts = {}) {
  let phase = 0;
  for (let k = 1; k < pts.length; k++) {
    phase = line(ctx, pts[k - 1].x, pts[k - 1].y, pts[k].x, pts[k].y, color, { ...opts, phase });
  }
}

export function arrowHead(ctx, ax, ay, bx, by, color, size = 4) {
  const ang = Math.atan2(by - ay, bx - ax);
  ctx.fillStyle = color;
  const tip = { x: bx + Math.cos(ang) * 2, y: by + Math.sin(ang) * 2 };
  for (let r = 0; r <= size; r++) {
    const cx = tip.x - Math.cos(ang) * r;
    const cy = tip.y - Math.sin(ang) * r;
    const half = r * 0.6;
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    line(ctx, cx - nx * half, cy - ny * half, cx + nx * half, cy + ny * half, color);
  }
}

export function tBar(ctx, ax, ay, bx, by, color, half = 3) {
  const ang = Math.atan2(by - ay, bx - ax);
  const nx = -Math.sin(ang);
  const ny = Math.cos(ang);
  line(ctx, bx - nx * half, by - ny * half, bx + nx * half, by + ny * half, color, { w: 2 });
}

export function disc(ctx, cx, cy, r, color, squash = 1) {
  ctx.fillStyle = color;
  const ry = Math.max(1, Math.round(r * squash));
  for (let y = -ry; y <= ry; y++) {
    const half = Math.round(r * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2)));
    ctx.fillRect(Math.round(cx) - half, Math.round(cy) + y, half * 2 + 1, 1);
  }
}

// Ellipse outline with an optional dotted look.
export function ring(ctx, cx, cy, rx, ry, color, every = 1) {
  ctx.fillStyle = color;
  const n = Math.max(16, Math.round((rx + ry) * 3));
  let last = '';
  let k = 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * rx);
    const y = Math.round(cy + Math.sin(a) * ry);
    const key = `${x},${y}`;
    if (key === last) continue;
    last = key;
    if (k++ % every === 0) ctx.fillRect(x, y, 1, 1);
  }
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
