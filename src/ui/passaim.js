// Retro Bowl-style passing, an optional control (Settings → Passing; off
// by default). With the ball in the quarterback's hands on one of your
// pass plays, put a finger down anywhere on the field and pull back: a
// target appears downfield, opposite the pull like a slingshot, with the
// ball's arc drawn to it. Let go to throw it there; slide back to where you
// started to call it off. Whoever gets to the spot goes up for it, and the
// passer's own accuracy (pressure, on the move, distance) still applies
// (src/sim/passing.js userThrow).

import { FIELD_W, clamp } from '../core/util.js';
import { Y_SQUASH } from '../render/camera.js';

const DEAD_PX = 12; // a pull shorter than this aims nothing (let go: no throw)
const GAIN = 2.3; // the target moves this much farther than the finger
const HINTS_KEY = 'mb.aimHints';

export class PassAim {
  constructor(host) {
    this.host = host;
    this.drag = null;
    this.target = null;
  }

  attach(el) {
    this.el = el;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', () => this.cancel());
  }

  // The live play, if it's one the player throws himself.
  sim() {
    const h = this.host;
    const sc = h.scene;
    if (h.mode !== 'play' || h.paused || !sc || sc.kind !== 'sim') return null;
    return sc.sim.opts.manualPass ? sc.sim : null;
  }

  aiming() {
    return !!(this.drag && this.drag.aiming && this.target);
  }

  down(e) {
    const sim = this.sim();
    if (!sim || this.drag || !sim.canUserThrow()) return;
    this.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, aiming: false };
    try { this.el.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    e.preventDefault();
  }

  move(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const sim = this.sim();
    if (!sim || !sim.canUserThrow()) { this.cancel(); return; }
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    d.aiming = Math.hypot(dx, dy) >= DEAD_PX;
    d.dx = dx;
    d.dy = dy;
    this.target = d.aiming ? this.aimFor(sim, dx, dy) : null;
    this.host.dirty = true;
  }

  up(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const sim = this.sim();
    // aim from where the passer is now, at the moment he lets it go
    const t = sim && d.aiming ? this.aimFor(sim, d.dx, d.dy) : null;
    this.cancel();
    if (t && sim.userThrow(t.x, t.y)) this.host.dirty = true;
  }

  cancel() {
    if (this.drag && this.el) {
      try { this.el.releasePointerCapture(this.drag.id); } catch { /* already released */ }
    }
    this.drag = null;
    this.target = null;
    this.host.dirty = true;
  }

  // Finger pull (CSS px) → a spot on the field, play-local yards.
  aimFor(sim, dx, dy) {
    const h = this.host;
    const r = h.canvas.getBoundingClientRect();
    const perYard = (h.cam.s * r.width) / h.cam.w; // CSS px per yard across
    let ax = (-dx / perYard) * GAIN;
    let ay = (dy / (perYard * Y_SQUASH)) * GAIN;
    const len = Math.hypot(ax, ay);
    const max = sim.maxThrow();
    if (len > max) { ax *= max / len; ay *= max / len; }
    const qb = sim.qb;
    return { x: clamp(qb.x + ax, -4, FIELD_W + 4), y: qb.y + ay };
  }

  // Where the camera should look while the passer has it: downfield, and
  // toward the target while aiming.
  lookAt(sim) {
    const qb = sim.qb;
    if (!qb) return null;
    const y = this.target ? qb.y + (this.target.y - qb.y) * 0.55 : qb.y + 11;
    const x = this.target ? qb.x + (this.target.x - qb.x) * 0.4 : qb.x;
    return { x, y };
  }

  // The target on the turf and the ball's arc to it.
  draw(ctx, cam, los) {
    const sim = this.sim();
    const t = this.target;
    if (!sim || !t || !this.aiming() || !sim.canUserThrow()) return;
    const qb = sim.qb;
    const R = Math.round;
    const d = Math.hypot(t.x - qb.x, t.y - qb.y);
    const peak = 0.6 + d * 0.1; // matches the throw (src/sim/passing.js)
    // the arc: dots from his hand to the spot
    const n = Math.max(6, Math.round(d / 1.4));
    for (let i = 1; i < n; i++) {
      const u = i / n;
      const x = qb.x + (t.x - qb.x) * u;
      const y = qb.y + (t.y - qb.y) * u;
      const z = 1.8 + 4 * peak * u * (1 - u) - 0.8 * u;
      const px = R(cam.sx(x));
      const py = R(cam.sy(los + y) - z * cam.s * 0.9);
      ctx.fillStyle = 'rgba(8,12,24,0.6)';
      ctx.fillRect(px - 1, py - 1, 4, 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px, py, 2, 2);
    }
    // the target: a thick ring on the grass with a cross in the middle
    // (red when it's out of bounds: throwing it away)
    const cx = R(cam.sx(t.x));
    const cy = R(cam.sy(los + t.y));
    const rx = Math.max(6, R(cam.s * 1.5));
    const ry = Math.max(5, R(cam.s * 1.5 * Y_SQUASH));
    const out = t.x < 0 || t.x > FIELD_W;
    const col = out ? '#ff6f5e' : '#ffe24a';
    const pts = 36;
    ctx.fillStyle = 'rgba(8,12,24,0.6)';
    for (let a = 0; a < pts; a++) {
      const ang = (a / pts) * Math.PI * 2;
      ctx.fillRect(cx + R(Math.cos(ang) * rx) - 1, cy + R(Math.sin(ang) * ry), 3, 3);
    }
    ctx.fillStyle = col;
    for (let a = 0; a < pts; a++) {
      const ang = (a / pts) * Math.PI * 2;
      ctx.fillRect(cx + R(Math.cos(ang) * rx), cy + R(Math.sin(ang) * ry), 2, 2);
    }
    ctx.fillStyle = 'rgba(8,12,24,0.6)';
    ctx.fillRect(cx - 3, cy - 1, 8, 4);
    ctx.fillRect(cx - 1, cy - 3, 4, 8);
    ctx.fillStyle = col;
    ctx.fillRect(cx - 2, cy, 6, 2);
    ctx.fillRect(cx, cy - 2, 2, 6);
  }

  // At the snap of a play you throw: a reminder of how, the first few times.
  hint() {
    let n = 0;
    try { n = +(localStorage.getItem(HINTS_KEY) || 0); } catch { /* storage off */ }
    if (n >= 3) return;
    try { localStorage.setItem(HINTS_KEY, String(n + 1)); } catch { /* storage off */ }
    this.host.toast('Pull back to aim · let go to throw', 2.6);
  }
}
