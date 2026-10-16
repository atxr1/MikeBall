// World <-> screen mapping. World: x across the field (0..53.33 yd), f = yards
// from the offense's own goal line (offense moves up the screen).

import { FIELD_W, clamp, lerp } from '../core/util.js';

export const Y_SQUASH = 0.86; // slight three-quarter tilt

export class Camera {
  constructor() {
    this.x = FIELD_W / 2;
    this.f = 30;
    this.zoom = 1.3;
    this.tx = this.x;
    this.tf = this.f;
    this.tzoom = this.zoom;
    this.w = 400;
    this.h = 400;
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
  }

  get s() {
    return (this.w / 56) * this.zoom;
  }

  set(x, f, zoom, snap = false) {
    this.tx = x;
    this.tf = f;
    if (zoom) this.tzoom = zoom;
    if (snap) {
      this.x = this.tx;
      this.f = this.tf;
      this.zoom = this.tzoom;
    }
  }

  update(dt, rate = 4) {
    const k = 1 - Math.exp(-rate * dt);
    this.zoom = lerp(this.zoom, this.tzoom, k);
    // keep the field edges from scrolling too far past the sidelines
    const halfW = this.w / 2 / this.s;
    const minX = Math.min(FIELD_W / 2, halfW - 2);
    const maxX = Math.max(FIELD_W / 2, FIELD_W - halfW + 2);
    this.x = lerp(this.x, clamp(this.tx, minX, maxX), k);
    this.f = lerp(this.f, this.tf, k);
  }

  sx(x) {
    return this.w / 2 + (x - this.x) * this.s;
  }

  sy(f) {
    return this.h / 2 - (f - this.f) * this.s * Y_SQUASH;
  }

  // visible f range
  fRange() {
    const half = this.h / 2 / (this.s * Y_SQUASH);
    return [this.f - half - 3, this.f + half + 3];
  }

  toWorld(px, py) {
    return { x: this.x + (px - this.w / 2) / this.s, f: this.f - (py - this.h / 2) / (this.s * Y_SQUASH) };
  }
}
