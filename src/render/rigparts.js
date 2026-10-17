// Body parts for the procedural rig (src/render/rig.js): helmets, caps and
// bare heads; shoulder pads, jerseys, striped officials' shirts and staff
// polos; drawn from the front ('S'), back ('N') or side ('E', facing right).
// All coordinates are body space: x 0..17 with the body centered on x = 9,
// y 0 = top of the head, 23 = the ground. Each painter takes (p, c, y, dx)
// where p is a Painter, c the palette, y the top row and dx a sideways
// shift (lean).

export const EYE = '#16120f';
export const BALL = '#7a3f1c';
export const BALL_L = '#a35a2c';
export const LACE = '#f1e7d8';

// ------------------------------------------------------------------ heads
export function helmetFront(p, c, y, dx = 0) {
  const x = dx;
  p.hline(x + 7, x + 10, y, c.H);
  p.hline(x + 6, x + 11, y + 1, c.H);
  p.rect(x + 5, y + 2, 8, 4, c.H);
  p.px(x + 7, y, c.Hl); p.px(x + 6, y + 1, c.Hl); p.px(x + 7, y + 1, c.Hl); p.px(x + 6, y + 2, c.Hl);
  p.rect(x + 8, y, 2, 2, c.S);
  p.vline(x + 12, y + 3, y + 5, c.Hd);
  p.hline(x + 6, x + 11, y + 3, c.Kd);
  p.hline(x + 6, x + 11, y + 4, c.K);
  p.px(x + 7, y + 4, EYE); p.px(x + 10, y + 4, EYE);
  p.hline(x + 6, x + 11, y + 5, c.M);
  p.px(x + 6, y + 6, c.Hd); p.px(x + 11, y + 6, c.Hd);
  p.hline(x + 7, x + 10, y + 6, c.K);
  p.px(x + 8, y + 6, c.Kd); p.px(x + 9, y + 6, c.Kd);
  p.hline(x + 7, x + 10, y + 7, c.Md);
}

export function helmetBack(p, c, y, dx = 0) {
  const x = dx;
  p.hline(x + 7, x + 10, y, c.H);
  p.hline(x + 6, x + 11, y + 1, c.H);
  p.rect(x + 5, y + 2, 8, 4, c.H);
  p.hline(x + 6, x + 11, y + 6, c.Hd);
  p.px(x + 7, y, c.Hl); p.px(x + 6, y + 1, c.Hl); p.px(x + 6, y + 2, c.Hl); p.px(x + 6, y + 3, c.Hl);
  p.vline(x + 12, y + 3, y + 5, c.Hd);
  p.rect(x + 8, y, 2, 6, c.S);
  p.hline(x + 7, x + 10, y + 7, c.Kd);
}

export function helmetSide(p, c, y, dx = 0) {
  const x = dx - 1;
  p.hline(x + 6, x + 10, y, c.S);
  p.hline(x + 5, x + 11, y + 1, c.H);
  p.px(x + 6, y + 1, c.Hl);
  p.rect(x + 5, y + 2, 5, 4, c.H);
  p.px(x + 5, y + 2, c.Hl);
  p.px(x + 7, y + 3, c.Hd);
  p.hline(x + 6, x + 9, y + 6, c.Hd);
  p.rect(x + 10, y + 2, 2, 4, c.K);
  p.px(x + 10, y + 2, c.H);
  p.px(x + 11, y + 3, EYE);
  p.px(x + 10, y + 5, c.Kd);
  p.vline(x + 12, y + 3, y + 6, c.Md);
  p.hline(x + 11, x + 13, y + 5, c.M);
}

// A cap (officials, coaches), bare head with hair, or a headset over it.
// h: { cap: color|null, hair: color, headset: bool, brim: color }
export function headFront(p, c, y, dx = 0) {
  const x = dx;
  const h = c.head;
  p.rect(x + 6, y + 1, 6, 6, c.K);
  p.px(x + 6, y + 6, c.Kd); p.px(x + 11, y + 6, c.Kd);
  p.vline(x + 11, y + 2, y + 5, c.Kd);
  p.px(x + 7, y + 3, EYE); p.px(x + 10, y + 3, EYE);
  p.hline(x + 8, x + 9, y + 5, c.Kd);
  if (h.cap) {
    p.hline(x + 6, x + 11, y, h.cap);
    p.hline(x + 5, x + 12, y + 1, h.cap);
    p.hline(x + 5, x + 12, y + 2, h.brim || h.cap);
  } else {
    p.hline(x + 6, x + 11, y, h.hair);
    p.hline(x + 5, x + 12, y + 1, h.hair);
    p.px(x + 5, y + 2, h.hair); p.px(x + 12, y + 2, h.hair);
  }
  if (h.headset) {
    p.hline(x + 6, x + 11, y - 1, '#1d2026');
    p.rect(x + 4, y + 2, 2, 3, '#1d2026');
    p.rect(x + 12, y + 2, 2, 3, '#1d2026');
    p.hline(x + 7, x + 9, y + 5, '#30343c');
  }
  p.rect(x + 7, y + 7, 4, 1, c.Kd); // neck
}

export function headBack(p, c, y, dx = 0) {
  const x = dx;
  const h = c.head;
  p.rect(x + 6, y + 1, 6, 6, h.hair);
  p.rect(x + 7, y + 6, 4, 1, c.Kd);
  p.px(x + 5, y + 3, c.Kd); p.px(x + 12, y + 3, c.Kd); // ears
  if (h.cap) {
    p.hline(x + 6, x + 11, y, h.cap);
    p.rect(x + 5, y + 1, 8, 2, h.cap);
    p.hline(x + 7, x + 10, y + 3, tone2(h.cap));
  } else {
    p.hline(x + 6, x + 11, y, h.hair);
  }
  if (h.headset) {
    p.hline(x + 6, x + 11, y - 1, '#1d2026');
    p.rect(x + 4, y + 2, 2, 3, '#1d2026');
    p.rect(x + 12, y + 2, 2, 3, '#1d2026');
  }
  p.rect(x + 7, y + 7, 4, 1, c.Kd);
}

function tone2(h) {
  // the cap's adjustable strap: a darker shade
  const n = parseInt(h.slice(1), 16);
  const f = (v) => Math.round(v * 0.6).toString(16).padStart(2, '0');
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

export function headSide(p, c, y, dx = 0) {
  const x = dx;
  const h = c.head;
  p.rect(x + 6, y + 1, 5, 6, c.K);
  p.px(x + 11, y + 3, c.K); p.px(x + 11, y + 4, c.K);
  p.px(x + 9, y + 3, EYE);
  p.vline(x + 6, y + 2, y + 5, h.cap ? h.hair : h.hair);
  p.px(x + 7, y + 6, c.Kd);
  if (h.cap) {
    p.hline(x + 6, x + 10, y, h.cap);
    p.hline(x + 5, x + 10, y + 1, h.cap);
    p.hline(x + 9, x + 12, y + 2, h.brim || h.cap);
  } else {
    p.hline(x + 6, x + 10, y, h.hair);
    p.hline(x + 5, x + 9, y + 1, h.hair);
  }
  if (h.headset) {
    p.hline(x + 6, x + 10, y - 1, '#1d2026');
    p.rect(x + 7, y + 2, 2, 3, '#1d2026');
    p.hline(x + 9, x + 11, y + 5, '#30343c');
  }
  p.rect(x + 7, y + 7, 3, 1, c.Kd);
}

// ------------------------------------------------------------------ torsos
// Shoulder pads under a jersey.
export function padsFB(p, c, y, back, dx = 0) {
  const x = dx;
  p.hline(x + 5, x + 12, y, c.J);
  p.rect(x + 3, y + 1, 12, 2, c.J);
  p.px(x + 3, y + 1, c.Jl); p.px(x + 4, y + 1, c.Jl);
  p.px(x + 14, y + 1, c.Jd); p.px(x + 14, y + 2, c.Jd);
  p.rect(x + 5, y + 3, 8, 4, c.J);
  p.vline(x + 5, y + 3, y + 6, c.Jl);
  p.vline(x + 12, y + 3, y + 6, c.Jd);
  p.hline(x + 5, x + 12, y + 6, c.Jd);
  if (back) p.hline(x + 7, x + 10, y, c.Jd);
  else { p.hline(x + 7, x + 10, y, c.CO || c.Jd); p.px(x + 8, y, c.Kd); p.px(x + 9, y, c.Kd); }
}

export function padsSide(p, c, y, dx = 0) {
  const x = dx - 1;
  p.hline(x + 6, x + 11, y, c.J);
  p.rect(x + 5, y + 1, 8, 2, c.J);
  p.rect(x + 6, y + 3, 6, 4, c.J);
  p.vline(x + 6, y + 3, y + 6, c.Jd);
  p.vline(x + 11, y + 1, y + 5, c.Jl);
  p.hline(x + 6, x + 11, y + 6, c.Jd);
}

// Shirts without pads (officials, staff): narrower shoulders.
// c.shirt: { a, b (stripe color or null), collar }
export function shirtFB(p, c, y, back, dx = 0) {
  const x = dx;
  const sh = c.shirt;
  p.rect(x + 4, y + 1, 10, 6, sh.a);
  p.hline(x + 5, x + 12, y, sh.a);
  if (sh.b) for (let i = 4; i <= 13; i += 2) p.vline(x + i, y + (i === 4 || i === 13 ? 1 : 0), y + 6, sh.b);
  p.vline(x + 13, y + 1, y + 6, sh.d || sh.a);
  if (!back) p.hline(x + 7, x + 10, y, sh.collar || sh.a);
  else p.hline(x + 7, x + 10, y, sh.collar || sh.a);
  if (sh.badge && !back) p.px(x + 6, y + 2, sh.badge);
}

export function shirtSide(p, c, y, dx = 0) {
  const x = dx - 1;
  const sh = c.shirt;
  p.rect(x + 6, y, 6, 7, sh.a);
  if (sh.b) for (let i = 6; i <= 11; i += 2) p.vline(x + i, y, y + 6, sh.b);
  p.vline(x + 11, y + 1, y + 5, sh.l || sh.a);
}

// Belt line and pants top (hips), drawn under the torso.
export function hipsFB(p, c, y, dx = 0) {
  const x = dx;
  p.rect(x + 5, y, 8, 2, c.P);
  p.vline(x + 5, y, y + 1, c.Pl);
  p.vline(x + 12, y, y + 1, c.Pd);
  if (c.PS) { p.vline(x + 5, y, y + 1, c.PS); p.vline(x + 12, y, y + 1, c.PS); }
  if (c.belt) p.hline(x + 5, x + 12, y, c.belt);
}

export function hipsSide(p, c, y, dx = 0) {
  const x = dx;
  p.rect(x + 6, y, 6, 2, c.P);
  p.hline(x + 6, x + 11, y + 1, c.Pd);
  if (c.PS) p.hline(x + 6, x + 11, y, c.PS);
  if (c.belt) p.hline(x + 6, x + 11, y, c.belt);
}

// Lying along the screen's vertical, seen from above: head up the screen
// (fell forward, going up) or toward the camera.
export function lyingFB(p, c, headUp, pads) {
  const rows = headUp
    ? { helm: 10, pads: 14, pants: 18, socks: 20, cleat: 22 }
    : { helm: 19, pads: 15, pants: 13, socks: 11, cleat: 10 };
  if (pads) {
    p.rect(6, rows.helm, 6, 4, c.H);
    p.rect(8, rows.helm, 2, 4, c.S);
    p.px(6, rows.helm, c.Hl);
    if (!headUp) p.hline(7, 10, rows.helm + 3, c.M);
  } else {
    p.rect(6, rows.helm, 6, 4, c.head.cap || c.head.hair);
  }
  p.rect(4, rows.pads, 10, 4, pads ? c.J : c.shirt.a);
  if (!pads && c.shirt.b) for (let i = 4; i <= 13; i += 2) p.vline(i, rows.pads, rows.pads + 3, c.shirt.b);
  p.hline(4, 13, headUp ? rows.pads : rows.pads + 3, pads ? c.Jl : c.shirt.a);
  p.rect(1, rows.pads + 1, 3, 2, c.G || c.K);
  p.rect(14, rows.pads + 1, 3, 2, c.G || c.K);
  p.rect(5, rows.pants, 8, 2, c.P);
  p.rect(5, rows.socks, 3, 2, c.O);
  p.rect(10, rows.socks, 3, 2, c.O);
  p.rect(5, rows.cleat, 3, 1, c.C);
  p.rect(10, rows.cleat, 3, 1, c.C);
}
