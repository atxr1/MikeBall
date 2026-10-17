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
    this.lockX = null;
  }

  attach(el) {
    this.el = el;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', () => this.cancel());
    el.addEventListener('lostpointercapture', (e) => { if (this.drag && e.pointerId === this.drag.id) this.cancel(); });
  }

  // The live play, if it's one the player throws himself.
  sim() {
    const h = this.host;
    const sc = h.scene;
    if (h.mode !== 'play' || h.paused || !sc || sc.kind !== 'sim') return null;
    const sim = sc.sim;
    return sim.opts.manualPass && !sim.done && sim.phase === 'pre' ? sim : null;
  }

  // Where the pull aims right now, from wherever the passer is now: the
  // ring on screen is exactly where the ball will go. Null if he can't
  // throw yet (the snap's still coming back, the fake) or the pull is short.
  current() {
    const d = this.drag;
    const sim = this.sim();
    if (!d || !d.aiming || !sim || !sim.canUserThrow()) return null;
    return this.aimFor(sim, d.dx, d.dy);
  }

  aiming() {
    return !!this.current();
  }

  // A finger can go down from the snap on (Retro Bowl players pull back
  // right away); the target shows once the ball's in his hands.
  down(e) {
    const sim = this.sim();
    if (!sim || this.drag) return;
    this.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, aiming: false };
    try { this.el.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    e.preventDefault();
  }

  move(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!this.sim()) { this.cancel(); return; }
    d.dx = e.clientX - d.sx;
    d.dy = e.clientY - d.sy;
    d.aiming = Math.hypot(d.dx, d.dy) >= DEAD_PX;
    this.host.dirty = true;
  }

  up(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const sim = this.sim();
    const t = this.current();
    this.cancel();
    if (t && sim.userThrow(t.x, t.y)) this.host.dirty = true;
  }

  cancel() {
    const d = this.drag;
    this.drag = null;
    if (d && this.el) {
      try { this.el.releasePointerCapture(d.id); } catch { /* already released */ }
    }
    this.host.dirty = true;
  }

  // A new play: nothing held over from the last one.
  reset() {
    this.cancel();
    this.lockX = null;
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

  // Where the camera should look while the passer has it: a steady view
  // downfield (it doesn't chase the ring under your thumb), moving only if
  // the target would go off the screen.
  lookAt(sim) {
    const qb = sim.qb;
    if (!qb) return null;
    const cam = this.host.cam;
    let y = 4; // yards past the line: the passer low on screen, the routes above
    let x = this.lockX ?? qb.x;
    this.lockX = x;
    const t = this.current();
    if (t) {
      const halfF = cam.h / 2 / (cam.s * Y_SQUASH) - 5;
      const halfX = cam.w / 2 / cam.s - 3;
      if (t.y > y + halfF) y = t.y - halfF;
      if (t.x > x + halfX) x = t.x - halfX;
      if (t.x < x - halfX) x = t.x + halfX;
    }
    return { x, y };
  }

  // The target on the turf and the ball's arc to it.
  draw(ctx, cam, los) {
    const sim = this.sim();
    const t = this.current();
    if (!t) return;
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
    const out = t.x < 0 || t.x > FIELD_W || t.y > sim.goalY + 10; // thrown away
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
