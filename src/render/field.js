// Draws the field: turf, lines, numbers, end zones, goal posts, LOS and
// first-down line. Offense always attacks up the screen.

import { FIELD_W, HASH_L, HASH_R, shade, contrastText } from '../core/util.js';
import { Y_SQUASH } from './camera.js';

const TURF_A = '#2f7a3b';
const TURF_B = '#2a7035';
const LINE = 'rgba(255,255,255,0.88)';

export function drawField(ctx, cam, opts) {
  const { offTeam, defTeam, homeTeam, los, ltg, showLines = true, night = false } = opts;
  const s = cam.s;
  const [f0, f1] = cam.fRange();
  const W = cam.w;
  const H = cam.h;

  // stands / sideline area
  ctx.fillStyle = night ? '#0a141f' : '#173a2a';
  ctx.fillRect(0, 0, W, H);
  const xL = cam.sx(-4);
  const xR = cam.sx(FIELD_W + 4);
  ctx.fillStyle = night ? '#1f5a2c' : '#2b6b35';
  ctx.fillRect(xL, 0, xR - xL, H);

  // turf stripes every 5 yards (including end zones)
  const x0 = cam.sx(0);
  const x1 = cam.sx(FIELD_W);
  for (let f = Math.floor(f0 / 5) * 5; f < f1; f += 5) {
    if (f < -10 || f >= 110) continue;
    const yTop = cam.sy(f + 5);
    const yBot = cam.sy(f);
    ctx.fillStyle = Math.floor(f / 5) % 2 === 0 ? TURF_A : TURF_B;
    ctx.fillRect(x0, yTop, x1 - x0, yBot - yTop + 0.5);
  }

  // end zones
  drawEndZone(ctx, cam, -10, 0, offTeam, false);
  drawEndZone(ctx, cam, 100, 110, defTeam, true);

  // sidelines (6 ft white border)
  ctx.fillStyle = LINE;
  const bw = Math.max(2, s * 0.6);
  ctx.fillRect(x0 - bw, cam.sy(110), bw, cam.sy(-10) - cam.sy(110));
  ctx.fillRect(x1, cam.sy(110), bw, cam.sy(-10) - cam.sy(110));
  // end lines
  ctx.fillRect(x0 - bw, cam.sy(110) - bw, x1 - x0 + bw * 2, bw);
  ctx.fillRect(x0 - bw, cam.sy(-10), x1 - x0 + bw * 2, bw);

  // yard lines
  for (let f = Math.ceil(Math.max(0, f0) / 5) * 5; f <= Math.min(100, f1); f += 5) {
    const y = cam.sy(f);
    ctx.fillStyle = LINE;
    const th = f === 0 || f === 100 ? Math.max(2, s * 0.35) : Math.max(1, s * 0.13);
    ctx.fillRect(x0, y - th / 2, x1 - x0, th);
  }
  // hash marks + inbound ticks each yard
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  const tick = Math.max(1, s * 0.11);
  for (let f = Math.ceil(Math.max(1, f0)); f <= Math.min(99, f1); f++) {
    if (f % 5 === 0) continue;
    const y = cam.sy(f);
    for (const hx of [HASH_L, HASH_R]) ctx.fillRect(cam.sx(hx - 0.33), y - tick / 2, s * 0.66, tick);
    ctx.fillRect(x0 + s * 0.3, y - tick / 2, s * 0.66, tick);
    ctx.fillRect(x1 - s * 0.96, y - tick / 2, s * 0.66, tick);
  }

  // numbers
  if (s > 4) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `700 ${Math.round(s * 1.5)}px "Big Shoulders Display", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let f = 10; f <= 90; f += 10) {
      if (f < f0 || f > f1) continue;
      const label = String(f <= 50 ? f : 100 - f);
      const y = cam.sy(f);
      for (const side of [-1, 1]) {
        const x = cam.sx(side < 0 ? 12 : FIELD_W - 12);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(side < 0 ? Math.PI / 2 : -Math.PI / 2);
        ctx.scale(1, 1 / Y_SQUASH > 1 ? 1 : 1);
        ctx.fillText(label.split('').join(' '), 0, 0);
        ctx.restore();
      }
    }
  }

  // midfield mark
  if (homeTeam && f0 < 52 && f1 > 48) {
    const cx = cam.sx(FIELD_W / 2);
    const cy = cam.sy(50);
    const r = s * 2.4;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, Y_SQUASH);
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = homeTeam.colors.primary;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, s * 0.3);
    ctx.strokeStyle = homeTeam.colors.secondary;
    ctx.stroke();
    ctx.fillStyle = contrastText(homeTeam.colors.primary);
    ctx.font = `800 ${Math.round(r * 0.9)}px "Big Shoulders Display", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(homeTeam.abbr, 0, r * 0.05);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // LOS and line to gain
  if (showLines && los != null) {
    ctx.fillStyle = 'rgba(61,139,255,0.95)';
    const y = cam.sy(los);
    ctx.fillRect(x0, y - Math.max(1.5, s * 0.16), x1 - x0, Math.max(3, s * 0.32));
    if (ltg != null && ltg < 100) {
      const y2 = cam.sy(ltg);
      ctx.fillStyle = 'rgba(255,210,63,0.95)';
      ctx.fillRect(x0, y2 - Math.max(1.5, s * 0.16), x1 - x0, Math.max(3, s * 0.32));
    }
  }

  drawPosts(ctx, cam, 110, false);
  drawPosts(ctx, cam, -10, true);
}

function drawEndZone(ctx, cam, fa, fb, team, far) {
  if (!team) return;
  const x0 = cam.sx(0);
  const x1 = cam.sx(FIELD_W);
  const yTop = cam.sy(fb);
  const yBot = cam.sy(fa);
  if (yBot < 0 || yTop > cam.h) return;
  ctx.fillStyle = shade(team.colors.primary, -0.12);
  ctx.fillRect(x0, yTop, x1 - x0, yBot - yTop);
  // diagonal hatch
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, yTop, x1 - x0, yBot - yTop);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = cam.s * 0.5;
  for (let x = x0 - (yBot - yTop); x < x1; x += cam.s * 2.2) {
    ctx.beginPath();
    ctx.moveTo(x, yBot);
    ctx.lineTo(x + (yBot - yTop), yTop);
    ctx.stroke();
  }
  ctx.restore();
  const s = cam.s;
  ctx.save();
  ctx.translate((x0 + x1) / 2, (yTop + yBot) / 2);
  ctx.fillStyle = team.colors.secondary === '#FFFFFF' ? '#ffffff' : shade(team.colors.secondary, 0.1);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, s * 0.15);
  ctx.font = `800 ${Math.round(s * 5.2)}px "Big Shoulders Display", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const word = team.name.toUpperCase();
  ctx.save();
  ctx.scale(1, Y_SQUASH);
  ctx.strokeText(word, 0, 0);
  ctx.fillText(word, 0, 0);
  ctx.restore();
  ctx.restore();
}

function drawPosts(ctx, cam, f, near) {
  const y = cam.sy(f);
  if (y < -cam.s * 14 || y > cam.h + cam.s * 4) return;
  const s = cam.s;
  const cx = cam.sx(FIELD_W / 2);
  const half = 3.08 * s; // 18'6" wide
  const bar = 3.33 * s * 0.9; // 10 ft crossbar
  const up = 9 * s * 0.9;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#f6d33a';
  ctx.lineWidth = Math.max(2, s * 0.32);
  // shadow
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.moveTo(cx - half + s * 0.8, y + s * 0.3);
  ctx.lineTo(cx + half + s * 0.8, y + s * 0.3);
  ctx.stroke();
  ctx.strokeStyle = '#f6d33a';
  const dir = near ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(cx, y);
  ctx.lineTo(cx, y - bar * (near ? 0.4 : 1));
  ctx.stroke();
  const yb = y - bar * (near ? 0.4 : 1);
  ctx.beginPath();
  ctx.moveTo(cx - half, yb);
  ctx.lineTo(cx + half, yb);
  ctx.moveTo(cx - half, yb);
  ctx.lineTo(cx - half, yb - up * (near ? 0.35 : 1) * (dir < 0 ? 1 : 1));
  ctx.moveTo(cx + half, yb);
  ctx.lineTo(cx + half, yb - up * (near ? 0.35 : 1));
  ctx.stroke();
  ctx.restore();
}
