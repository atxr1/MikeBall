// Stadium stands: big, non-repeating pixel crowds generated once per game.
//
// Each stand (behind each end zone, and along each sideline) is its own
// seeded image: every fan is placed one at a time with their own shirt,
// skin, hair or hat, and the stands have a ribbon board, seat rows, stair
// aisles, tunnels, an upper-deck facade and an away-fan section. Nothing is
// tiled, so no two patches match.
//
// Stands are anchored to the stadium wall around the field and don't scale
// with camera zoom, which keeps them pixel-crisp. Stands behind the end
// zones are built lazily the first time they come into view.
//
// Fans can wave their arms: `crowd.hype` (0..1) raises how many do, and the
// coach screen bumps it on big plays by the home team.

import { makeRng, hashString } from '../core/rng.js';
import { FIELD_W } from '../core/util.js';

const SKIN = [0xf3cfae, 0xe8bb94, 0xd09a72, 0xae7650, 0x85573a, 0x5e3c27];
const HAIR = [0x16110d, 0x2b1d14, 0x4a3020, 0x7a5a30, 0xc9a25a, 0x9a9a9a, 0x6b2a17];
const MISC = [0xe24b3b, 0x3b82e2, 0xf2c94c, 0x5ac46a, 0xb04be2, 0xf28c28, 0x2bbfb3];

function hexNum(h) {
  return parseInt(String(h || '#888888').replace('#', ''), 16) || 0x888888;
}
function shade(c, k) {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * k)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * k)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * k)));
  return (r << 16) | (g << 8) | b;
}
function lum(c) {
  return (((c >> 16) & 255) * 0.299 + ((c >> 8) & 255) * 0.587 + (c & 255) * 0.114) / 255;
}
function mix(a, b, t) {
  const r = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t;
  const g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t;
  const bl = (a & 255) * (1 - t) + (b & 255) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

const LITTLE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const pack = (c) => (LITTLE ? 0xff000000 | ((c & 255) << 16) | (c & 0xff00) | ((c >> 16) & 255) : ((c << 8) | 0xff)) >>> 0;

// Build one stand image.
//   W, H     image size in pixels
//   wall     which image edge touches the field: 'bottom' | 'top' | 'left' | 'right'
//   face     'front' (fans facing the camera) or 'back' (backs of heads)
//   s0       pixels per yard the stand is laid out for
//   pal      team colors
//   rng      seeded RNG
//   away     true to include an away-fan section
function buildStand({ W, H, wall, face, s0, pal, rng, away }) {
  const data = new Uint32Array(W * H);
  const dOf = wall === 'bottom' ? (x, y) => H - 1 - y : wall === 'top' ? (x, y) => y : wall === 'left' ? (x) => x : (x) => W - 1 - x;
  const uOf = wall === 'bottom' || wall === 'top' ? (x) => x : (x, y) => y;
  const U = wall === 'bottom' || wall === 'top' ? W : H;
  const D = wall === 'bottom' || wall === 'top' ? H : W;

  // depth bands (distance from the wall, in pixels)
  const BOARD = 6; // front wall + ribbon board
  const LOWER = BOARD + Math.round(14 * s0); // end of lower bowl
  const CONC = LOWER + 6; // concourse
  const FACADE = CONC + 9; // upper-deck facade
  const UPPER = FACADE + Math.round(19 * s0); // end of upper deck
  const RIM = UPPER + 10; // roof rim, then night sky

  // aisles along the wall: lower and upper decks have their own
  const aisles = (lo) => {
    const out = [];
    for (let u = rng.int(10, 50); u < U; u += rng.int(lo, lo + 34)) out.push(u);
    return out;
  };
  const aisleLo = aisles(58);
  const aisleUp = aisles(70);
  // per-column lookups (u = position along the wall) so the pixel loops
  // below are plain array reads
  const aisleLoU = new Int8Array(U).fill(-1);
  for (const a of aisleLo) for (let i = 0; i < 4 && a + i < U; i++) aisleLoU[a + i] = i;
  const aisleUpU = new Int8Array(U).fill(-1);
  for (const a of aisleUp) for (let i = 0; i < 3 && a + i < U; i++) aisleUpU[a + i] = i;
  const inList = (list, u) => (list === aisleLo ? aisleLoU[u] : aisleUpU[u]);
  // tunnels (vomitories) cut into the lower bowl next to some aisles
  const tunnels = [];
  const tD0 = BOARD + Math.round((LOWER - BOARD) * 0.45);
  for (const a of aisleLo) if (rng.chance(0.4)) tunnels.push({ u0: a + 4, u1: a + 4 + rng.int(9, 13), d0: tD0, d1: tD0 + 7 });
  const tunnelU = new Int16Array(U).fill(-1);
  tunnels.forEach((t, i) => { for (let u = t.u0; u < t.u1 && u < U; u++) tunnelU[u] = i; });
  const inTunnel = (u, d) => u >= 0 && u < U && tunnelU[u] >= 0 && d >= tD0 && d < tD0 + 7;
  // away section: one block of the lower bowl
  const awayU0 = away ? rng.int(Math.round(U * 0.1), Math.round(U * 0.75)) : -1;
  const awayU1 = awayU0 + Math.round(U * 0.1);
  const inAway = (u, d) => away && u >= awayU0 && u < awayU1 && d < LOWER;

  // ribbon board segments
  const segU = new Int16Array(U);
  const segs = [];
  for (let u = 0; u < U; ) {
    const len = rng.int(40, 96);
    segs.push({ u0: u, u1: u + len, kind: rng.int(0, 3), ph: rng.int(0, 7) });
    for (let i = u; i < u + len && i < U; i++) segU[i] = segs.length - 1;
    u += len;
  }

  const seat = shade(lum(pal.p) < 0.3 ? pal.p : 0x2e3446, 0.5);
  const seatBack = shade(seat, 0.62);
  const stair = 0x707684;
  const concrete = 0x4b505c;
  const sky = 0x0c0f16;

  const depthK = (d) => {
    if (d < LOWER) {
      let k = 1 - 0.14 * ((d - BOARD) / (LOWER - BOARD));
      if (d > LOWER - 12) k *= 0.74; // shadow under the upper deck overhang
      return k;
    }
    return 0.8 - 0.2 * Math.min(1, (d - FACADE) / (UPPER - FACADE));
  };

  // ---- background, one row of the stand (constant d) at a time
  const at = wall === 'bottom' ? (u, d) => (H - 1 - d) * W + u : wall === 'top' ? (u, d) => d * W + u : wall === 'left' ? (u, d) => u * W + d : (u, d) => u * W + (W - 1 - d);
  const P = (c) => pack(c);
  for (let d = 0; d < D; d++) {
    const k = d < LOWER || (d >= FACADE && d < UPPER) ? depthK(d) : 1;
    const rowSeat = P(shade((d - (d < LOWER ? BOARD : FACADE)) % 5 === 4 ? seatBack : seat, k));
    const rowStair = P(shade(d % 2 ? stair : shade(stair, 0.78), k));
    for (let u = 0; u < U; u++) {
      let v;
      if (d < 2) v = P(0x1a1d24);
      else if (d < BOARD - 1) {
        const sg = segs[segU[u]];
        const q = (u - sg.u0 + sg.ph) % 8;
        const row = d - 2;
        let c;
        if (u === sg.u0) c = 0x0d0f13;
        else if (sg.kind === 0) c = row === 1 && q < 4 ? pal.s : pal.p;
        else if (sg.kind === 1) c = (u * 7 + row * 13 + sg.ph) % 5 < 2 && row < 3 ? 0xf4f4f4 : 0x14161c;
        else if (sg.kind === 2) c = (q + row) % 4 < 2 ? pal.s : pal.p;
        else c = row === 1 ? 0xf4f4f4 : pal.p;
        v = P(c);
      } else if (d < BOARD) v = P(0x22252d);
      else if (d < LOWER) {
        const ti = tunnelU[u];
        if (ti >= 0 && d >= tD0 && d < tD0 + 7) {
          const t = tunnels[ti];
          v = P(shade(d === t.d0 || u === t.u0 || u === t.u1 - 1 ? 0x8a8f9a : 0x090b0f, k));
        } else v = aisleLoU[u] >= 0 ? rowStair : rowSeat;
      } else if (d < CONC) v = P(d === LOWER || d === CONC - 1 ? 0x2a2e38 : shade(concrete, (u >> 2) % 9 === 0 ? 0.8 : 1));
      else if (d < FACADE) {
        const f = d - CONC;
        let c;
        if (f === 0 || f === 8) c = 0x15181f;
        else if (f === 1) c = u % 11 === 0 ? 0xfff1b8 : 0x1c2029;
        else if (f <= 4) c = pal.p;
        else if (f === 5) c = pal.s;
        else c = 0x1c2029;
        v = P(c);
      } else if (d < UPPER) v = aisleUpU[u] >= 0 ? rowStair : rowSeat;
      else if (d < RIM) {
        const f = d - UPPER;
        v = P(f < 3 ? 0x2a2e38 : f === 5 && u % 23 < 3 ? 0xfffbe6 : 0x181b22);
      } else v = P(((Math.imul(u, 73856093) ^ Math.imul(d, 19349663)) >>> 0) % 997 === 0 ? 0x8e95a8 : sky);
      data[at(u, d)] = v;
    }
  }

  // ---- fans
  const set = (x, y, c) => {
    if (x >= 0 && y >= 0 && x < W && y < H) data[y * W + x] = pack(c);
  };
  const shirtFor = (u, d) => {
    if (inAway(u, d)) return rng.chance(0.7) ? (rng.chance(0.68) ? pal.ap : pal.as) : rng.chance(0.6) ? pal.p : rng.pick([0xf2f2f2, 0x24262b]);
    const r = rng.next();
    if (r < 0.46) return pal.p;
    if (r < 0.62) return pal.s;
    if (r < 0.67) return pal.t;
    if (r < 0.77) return 0xf2f2f2;
    if (r < 0.88) return rng.pick([0x1d1f24, 0x55595f, 0x8a8f99, 0x3d4a66, 0x6b5a48]);
    if (r < 0.92) return pal.ap;
    return rng.pick(MISC);
  };
  const okFan = (x, y) => {
    const d = dOf(x, y);
    const u = uOf(x, y);
    if (d < BOARD + 2) return false;
    if (d < LOWER - 1) return inList(aisleLo, u) < 0 && !inTunnel(u, d) && !inTunnel(u, d + 3);
    if (d > FACADE + 1 && d < UPPER - 3) return inList(aisleUp, u) < 0;
    return false;
  };
  const fans = [];
  const ROW = 5;
  // rows run parallel to the wall for end stands; side stands use upright
  // rows too (fans always stand up on screen)
  for (let y = 1; y < H - 3; y += ROW) {
    let x = rng.int(0, 3);
    while (x < W - 3) {
      if (!okFan(x + 1, y) || !okFan(x + 1, y + 2)) {
        x += rng.int(2, 4);
        continue;
      }
      const d = dOf(x + 1, y);
      const u = uOf(x + 1, y);
      const upper = d >= FACADE;
      if (rng.chance(upper ? 0.13 : 0.05)) {
        x += rng.int(3, 5);
        continue;
      }
      const k = depthK(d);
      const skin = SKIN[rng.int(0, SKIN.length - 1)];
      const hair = HAIR[rng.int(0, HAIR.length - 1)];
      const shirt = shirtFor(u, d);
      const w = rng.chance(0.15) ? 2 : 3;
      const hx = x + (w === 3 ? 1 : rng.int(0, 1));
      const fy = y + (rng.chance(0.25) ? 1 : 0);
      const hatR = rng.next();
      const hat = hatR < 0.2 ? (rng.chance(0.75) ? pal.p : pal.s) : hatR < 0.24 ? 0xf2f2f2 : -1;
      if (face === 'front') {
        set(hx, fy, shade(skin, k));
        if (hat >= 0) {
          set(hx, fy - 1, shade(hat, k));
          if (w === 3 && rng.chance(0.5)) set(hx + (rng.chance(0.5) ? 1 : -1), fy - 1, shade(hat, k * 0.8));
        } else if (rng.chance(0.75)) set(hx, fy - 1, shade(hair, k));
        else set(hx, fy - 1, shade(skin, k * 0.92));
      } else {
        // seen from behind: hair or hat, a little skin at the neck
        const top = hat >= 0 ? hat : rng.chance(0.85) ? hair : skin;
        set(hx, fy - 1, shade(top, k));
        set(hx, fy, shade(hat >= 0 && rng.chance(0.5) ? hair : rng.chance(0.3) ? skin : top, k * 0.9));
      }
      for (let bx = 0; bx < w; bx++) {
        set(x + bx, fy + 1, shade(shirt, k));
        set(x + bx, fy + 2, shade(shirt, k * 0.8));
      }
      // stripes or a number on some jerseys
      if (w === 3 && rng.chance(0.12)) set(x + 1, fy + 1, shade(shirt === pal.p ? pal.s : 0xf2f2f2, k));
      const ex = rng.next();
      if (ex < 0.005 && !upper) {
        // sign held up overhead
        const sw = rng.int(7, 10);
        const ink = rng.chance(0.6) ? pal.p : 0x1d1f24;
        for (let i = 0; i < sw; i++) for (let j = 0; j < 4; j++) set(x - 3 + i, fy - 5 + j, shade(j === 3 ? 0xcfcfcf : 0xfafafa, k));
        for (let i = 1; i < sw - 1; i++) if (rng.chance(0.6)) set(x - 3 + i, fy - 4 + rng.int(0, 1), shade(ink, k));
        set(x - 2, fy - 1, shade(skin, k));
        set(x + sw - 5, fy - 1, shade(skin, k));
      } else if (ex < 0.011) {
        // foam finger
        set(x + w, fy - 2, shade(pal.s, k));
        set(x + w, fy - 1, shade(pal.s, k));
        set(x + w, fy, shade(pal.s, k * 0.85));
      } else if (ex < 0.016 && !upper) {
        // towel or flag in team colors
        set(x - 1, fy - 2, shade(pal.p, k));
        set(x - 2, fy - 2, shade(pal.p, k));
        set(x - 1, fy - 3, shade(pal.s, k));
        set(x - 1, fy - 1, shade(skin, k));
      } else if (ex < 0.05) {
        // already on their feet with arms up
        set(x - 1, fy - 1, shade(skin, k));
        set(x + w, fy - 1, shade(skin, k));
      }
      fans.push(x, fy, skin, Math.round(k * 100), w);
      x += w + rng.int(1, 2);
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  new Uint32Array(img.data.buffer).set(data);
  ctx.putImageData(img, 0, 0);
  return { canvas, W, H, fans: Int32Array.from(fans) };
}

// A crowd for one game. `w` is the low-res screen width.
export function makeCrowd(homeTeam, awayTeam, w, seed = 1) {
  const s0 = (w / 56) * 1.3;
  const pal = {
    p: hexNum(homeTeam.colors.primary),
    s: hexNum(homeTeam.colors.secondary),
    t: hexNum(homeTeam.colors.tertiary || '#f2f2f2'),
    ap: hexNum(awayTeam.colors.primary),
    as: hexNum(awayTeam.colors.secondary),
  };
  const base = (seed ^ hashString(homeTeam.id + awayTeam.id)) >>> 0;
  const stands = new Map();
  const endW = Math.round(w * 1.7);
  const endH = Math.round(w * 1.7);
  const ENDS = ['N:front', 'S:back', 'S:front', 'N:back'];
  const sideW = Math.round(w * 0.5);
  const sideH = Math.round(140 * s0 * 1.25 * 0.86);
  return {
    w,
    hype: 0,
    // end: 'N' | 'S' (the physical end), face: 'front' | 'back'
    stand(key) {
      let st = stands.get(key);
      if (st) return st;
      const [end, face] = key.split(':');
      const rng = makeRng((base + hashString(key)) >>> 0);
      if (end === 'L' || end === 'R') {
        st = buildStand({ W: sideW, H: sideH, wall: end === 'L' ? 'right' : 'left', face: 'front', s0, pal, rng, away: false });
      } else {
        st = buildStand({ W: endW, H: endH, wall: face === 'front' ? 'bottom' : 'top', face, s0, pal, rng, away: end === 'S' });
      }
      stands.set(key, st);
      return st;
    },
    // Build the end-zone stands ahead of time, one per call (call once a
    // frame during the intro) so the first look at an end zone doesn't stall.
    // Sideline stands are almost never on screen and stay lazy.
    prebuild() {
      const key = ENDS.find((k) => !stands.has(k));
      if (!key) return true;
      this.stand(key);
      return false;
    },
  };
}

function lowerBound(fans, y) {
  let lo = 0;
  let hi = fans.length / 5;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (fans[m * 5 + 1] < y) lo = m + 1;
    else hi = m;
  }
  return lo * 5;
}

// Draw one stand at (ox, oy), clipped to the screen rect (cx, cy, cw, ch),
// with some fans waving.
function blit(ctx, st, ox, oy, cx, cy, cw, ch, t, hype, night = false) {
  const x0 = Math.max(cx, ox);
  const y0 = Math.max(cy, oy);
  const x1 = Math.min(cx + cw, ox + st.W);
  const y1 = Math.min(cy + ch, oy + st.H);
  if (x1 <= x0 || y1 <= y0) return;
  ctx.drawImage(st.canvas, x0 - ox, y0 - oy, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  if (night) {
    // under the lights the field glows and the stands fall into shadow
    ctx.fillStyle = 'rgba(4,8,26,0.34)';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  const rate = 0.01 + hype * 0.35;
  const beat = Math.floor(t * (4 + hype * 3));
  const f = st.fans;
  const end = lowerBound(f, y1 - oy + 2);
  for (let i = lowerBound(f, y0 - oy - 2); i < end; i += 5) {
    const x = f[i] + ox;
    const y = f[i + 1] + oy;
    if (x < x0 + 1 || x > x1 - 4 || y < y0 + 3 || y > y1 - 1) continue;
    const h = (Math.imul(i + 1, 2654435761) ^ Math.imul(beat + 7, 40503)) >>> 0;
    if ((h % 1000) / 1000 > rate) continue;
    const k = f[i + 3] / 100;
    const s = f[i + 2];
    ctx.fillStyle = `rgb(${Math.round(((s >> 16) & 255) * k)},${Math.round(((s >> 8) & 255) * k)},${Math.round((s & 255) * k)})`;
    const up = (h >> 11) & 1;
    const w = f[i + 4];
    ctx.fillRect(x - 1, y - 2 - up, 1, 2);
    ctx.fillRect(x + w, y - 2 - up, 1, 2);
  }
  if (night) cameraFlashes(ctx, st, ox, oy, x0, y0, x1, y1, t, hype);
}

// Primetime: phones and cameras flashing all over the stands, more of them
// when the place is going crazy.
function cameraFlashes(ctx, st, ox, oy, x0, y0, x1, y1, t, hype) {
  const f = st.fans;
  const nFans = f.length / 5;
  if (!nFans) return;
  const tick = Math.floor(t * 12);
  const count = Math.round(((x1 - x0) * (y1 - y0)) / 9000 * (1 + hype * 5));
  for (let j = 0; j < count; j++) {
    const h = (Math.imul(tick * 97 + j, 2654435761) ^ Math.imul(j + 13, 40503)) >>> 0;
    const i = (h % nFans) * 5;
    const x = f[i] + ox + 1;
    const y = f[i + 1] + oy;
    if (x < x0 + 2 || x > x1 - 3 || y < y0 + 2 || y > y1 - 3) continue;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, 1, 1);
    if ((h >> 8) & 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(x - 1, y, 3, 1);
      ctx.fillRect(x, y - 1, 1, 3);
    }
  }
}

// Draw the stands around the stadium wall.
//   e: screen-pixel edges of the wall: { L, R, T, B } (stands are outside)
//   topEnd: which physical end ('N' or 'S') is at the top of the screen
export function drawCrowd(ctx, cam, crowd, e, topEnd, t = 0) {
  const W = cam.w;
  const H = cam.h;
  const hype = crowd.hype;
  const mid = Math.round(cam.sx(FIELD_W / 2));
  ctx.fillStyle = '#0c0f16';
  if (e.T > 0) {
    const st = crowd.stand(`${topEnd}:front`);
    ctx.fillRect(0, 0, W, e.T);
    blit(ctx, st, mid - (st.W >> 1), e.T - st.H, 0, 0, W, e.T, t, hype, crowd.night);
  }
  if (e.B < H) {
    const st = crowd.stand(`${topEnd === 'N' ? 'S' : 'N'}:back`);
    ctx.fillRect(0, e.B, W, H - e.B);
    blit(ctx, st, mid - (st.W >> 1), e.B, 0, e.B, W, H - e.B, t, hype, crowd.night);
  }
  const sy0 = Math.max(0, e.T);
  const sy1 = Math.min(H, e.B);
  if (sy1 > sy0) {
    const cy = Math.round(cam.sy(50));
    if (e.L > 0) {
      const st = crowd.stand('L:front');
      ctx.fillRect(0, sy0, e.L, sy1 - sy0);
      blit(ctx, st, e.L - st.W, cy - (st.H >> 1), 0, sy0, e.L, sy1 - sy0, t, hype, crowd.night);
    }
    if (e.R < W) {
      const st = crowd.stand('R:front');
      ctx.fillRect(e.R, sy0, W - e.R, sy1 - sy0);
      blit(ctx, st, e.R, cy - (st.H >> 1), e.R, sy0, W - e.R, sy1 - sy0, t, hype, crowd.night);
    }
  }
}
