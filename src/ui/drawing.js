// Play drawing on the pre-snap field (milestone 2). Touch handling and the
// in-progress stroke live here; what a stroke or tap means is decided in
// src/game/playedit.js. Edits apply to the called play for this snap only.

import { applyEdits, pickPlayer, editFromStroke, editFromTap, editFromDoubleTap } from '../game/playedit.js';
import * as PX from '../render/pixeldraw.js';
import { h } from './dom.js';
import { Y_SQUASH } from '../render/camera.js';

const MOVE_PX = 8; // finger travel before a press becomes a stroke
const BODY_PX = 12; // a finger on a sprite lands about this far above his feet
const DOUBLE_MS = 320;

export class PlayDrawing {
  constructor(coach) {
    this.c = coach;
    this.edits = {};
    this.forPlay = null;
    this.drag = null;
    this.lastTap = null;
    // the how-to hint shows for a player's first few calls, ever
    this.hintsLeft = 4;
    try { this.hintsLeft = Number(localStorage.getItem('mb.drawHints') ?? 4); } catch { /* private mode */ }
    this.chip = h('button', { class: 'draw-chip', type: 'button', hidden: true, onclick: () => this.reset() });
    coach.stage.append(this.chip);
    const cv = coach.canvas;
    cv.addEventListener('pointerdown', (e) => this.down(e));
    cv.addEventListener('pointermove', (e) => this.move(e));
    cv.addEventListener('pointerup', (e) => this.up(e));
    cv.addEventListener('pointercancel', () => this.cancel());
  }

  // ---------------------------------------------------------------- state
  get canDraw() {
    const c = this.c;
    const sc = c.scene;
    return c.mode === 'call' && !c.paused && !c.bannerThen && sc && sc.kind === 'sim' && !!sc.artSide && !!c.sel && c.sel.cat !== 'special';
  }

  get side() {
    return this.c.game.poss === this.c.user ? 'O' : 'D';
  }

  // The user's play with the drawing applied.
  play() {
    return applyEdits(this.c.sel, this.edits);
  }

  // New play picked: drawings belong to the play they were made on.
  sync(sel) {
    if (sel !== this.forPlay) {
      this.edits = {};
      this.forPlay = sel;
    }
  }

  // A new down: start clean.
  clear() {
    this.edits = {};
    this.forPlay = null;
    this.drag = null;
    if (this.hintsLeft > 0) {
      this.hintsLeft--;
      try { localStorage.setItem('mb.drawHints', String(this.hintsLeft)); } catch { /* private mode */ }
    }
  }

  reset() {
    if (!Object.keys(this.edits).length) return;
    this.edits = {};
    this.c.buildPreview();
    this.c.toast('Drawing cleared', 1);
    this.updateChip();
  }

  updateChip() {
    const show = this.canDraw;
    const edited = Object.keys(this.edits).length > 0;
    const text = edited ? 'Reset drawing' : 'Drag from a player to draw · tap to switch';
    const visible = show && (edited || this.hintsLeft > 0);
    if (this.chip.hidden === visible) this.chip.hidden = !visible;
    if (this.chip.textContent !== text) this.chip.textContent = text;
    if (this.chip.disabled === edited) {
      this.chip.disabled = !edited;
      this.chip.classList.toggle('hint', !edited);
    }
  }

  // ---------------------------------------------------------------- input
  at(e) {
    const c = this.c;
    const r = c.canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) * c.cam.w) / r.width;
    const py = ((e.clientY - r.top) * c.cam.h) / r.height;
    const w = c.cam.toWorld(px, py);
    return { x: w.x, y: w.f - c.scene.los };
  }

  // yards from a fingertip on a sprite down to the player's feet
  bodyOff() {
    return BODY_PX / (this.c.cam.s * Y_SQUASH);
  }

  down(e) {
    if (!this.canDraw) return;
    const sim = this.c.scene.sim;
    const pt = this.at(e);
    const p = pickPlayer(sim, this.side, pt.x, pt.y - this.bodyOff(), 2.4);
    if (!p) return;
    this.drag = { p, pts: [], sx: e.clientX, sy: e.clientY, moved: false, id: e.pointerId };
    try { this.c.canvas.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    this.c.dirty = true;
  }

  move(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < MOVE_PX) return;
    d.moved = true;
    d.pts.push(this.at(e));
    this.c.dirty = true;
  }

  up(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    this.c.dirty = true;
    if (!this.canDraw) return;
    const c = this.c;
    const sim = c.scene.sim;
    if (d.moved) {
      d.pts.push(this.at(e));
      this.apply(editFromStroke(sim, this.play(), d.p, d.pts, this.bodyOff()));
      return;
    }
    // tap / double-tap
    const now = performance.now();
    const prev = this.lastTap;
    if (prev && prev.slot === d.p.slot && now - prev.t < DOUBLE_MS) {
      this.lastTap = null;
      const dbl = editFromDoubleTap(sim, this.play(), d.p);
      if (dbl) {
        // undo the first tap's toggle, then hand him the ball
        if (prev.undo) this.restore(prev.undo);
        Object.assign(this.edits, dbl.edits);
        this.refresh(dbl.label);
      }
      return;
    }
    const slot = d.p.slot;
    const had = Object.prototype.hasOwnProperty.call(this.edits, slot) ? { slot, a: this.edits[slot] } : { slot, a: undefined };
    const ed = editFromTap(sim, this.play(), c.sel, d.p);
    this.lastTap = { slot, t: now, undo: ed ? had : null };
    this.apply(ed);
  }

  cancel() {
    this.drag = null;
    this.c.dirty = true;
  }

  restore({ slot, a }) {
    if (a === undefined) delete this.edits[slot];
    else this.edits[slot] = a;
  }

  apply(ed) {
    if (!ed) return;
    this.edits[ed.slot] = ed.assign;
    this.refresh(ed.label);
  }

  refresh(label) {
    this.c.buildPreview();
    if (label) this.c.toast(label, 1);
    this.updateChip();
  }

  // ---------------------------------------------------------------- render
  // The stroke being drawn, in low-res pixels (ctx is already scaled).
  drawStroke(ctx, cam, los) {
    const d = this.drag;
    if (!d) return;
    const X = (x) => Math.round(cam.sx(x));
    const Y = (y) => Math.round(cam.sy(los + y));
    const px = X(d.p.x);
    const py = Y(d.p.y);
    PX.ring(ctx, px, py, 9, 5, '#ffd23f', 1);
    if (!d.moved || !d.pts.length) return;
    const pts = [{ x: px, y: py }, ...d.pts.map((q) => ({ x: X(q.x), y: Y(q.y) }))];
    PX.polyline(ctx, pts.map((q) => ({ x: q.x, y: q.y + 1 })), 'rgba(0,20,0,0.5)', { w: 2 });
    PX.polyline(ctx, pts, '#ffd23f', { w: 2 });
    const e = pts[pts.length - 1];
    PX.disc(ctx, e.x, e.y, 2, '#ffd23f');
  }
}
