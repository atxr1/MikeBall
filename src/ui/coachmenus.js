// Dialogs, the in-game menu, the roster sheet and the end of the game for
// the coach view, mixed into CoachScreen.

import { other } from '../game/rules.js';
import { makePlaySim, cpuStep } from '../game/autoplay.js';
import { cpuOffense, cpuDefense } from '../game/cpu.js';
import { offPlay } from '../data/playbook.js';
import { h } from './dom.js';
import { openRoster } from './roster.js';
import { ready } from '../render/images.js';
import { openSettings } from './settings.js';

export const menuMethods = {
  dialog(title, text, buttons, { keepMode = false } = {}) {
    if (!keepMode) this.mode = 'idle';
    this.setSheetEnabled(false);
    const close = () => d.remove();
    const d = h('div', { class: 'sheet dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'sheet-panel dialog-panel' },
        h('strong', { class: 'dialog-title' }, title),
        text ? h('p', { class: 'dialog-text' }, text) : null,
        h('div', { class: 'dialog-buttons' }, ...buttons.map(([label, fn], i) =>
          h('button', { class: i === 0 ? 'go' : 'act', onclick: () => { close(); fn(); } }, label))),
      ),
    );
    this.root.append(d);
    return close;
  },

  openRoster() {
    // the depth chart is live while a play is being called: whoever's moved
    // up comes on (and the man he replaces goes off) before the next snap
    const live = this.mode === 'call';
    openRoster(this.root, this.game.teams[this.user], this.game.rosters[this.user], () => {
      if (live && this.mode === 'call') this.buildPreview();
    }, { editable: live, onChange: () => { if (this.mode === 'call') this.buildPreview(); } });
  },

  openMenu() {
    if (this.paused) return;
    this.paused = true;
    const wasEnabled = !this.el.go.disabled;
    const resume = () => { this.paused = false; if (wasEnabled && this.mode === 'call') this.setSheetEnabled(true); };
    this.dialog('Menu', null, [
      ['Resume', resume],
      ['Settings', () => openSettings(this.root, this.app, resume)],
      ['Sim to the end', () => { this.paused = false; this.simToEnd(); }],
      ['Quit to title', () => this.app.showTitle()],
    ], { keepMode: true });
  },

  simToEnd() {
    const g = this.game;
    // a play that ended but is still on screen (celebration) counts first;
    // a pre-snap foul being shown was already enforced
    this.timers = [];
    if (this.preFoulPen) this.preFoulPen = null;
    else if (this.mode === 'play' && this.playEnded && this.scene?.sim?.done) {
      const r = this.scene.sim.result;
      if (this.twoPoint) { g.applyTwoPoint(r); this.twoPoint = false; } else g.applyPlay(r, this.liveO, this.liveD);
    }
    if (this.twoPoint) {
      const sim = makePlaySim(g, cpuOffense(g, g.poss).cat === 'special' ? offPlay('slants') : cpuOffense(g, g.poss), cpuDefense(g, other(g.poss)), null, { noFouls: true });
      g.applyTwoPoint(sim.runToEnd());
      this.twoPoint = false;
    }
    let n = 0;
    while (!g.over && n++ < 4000) cpuStep(g);
    this.showFinal();
  },

  showFinal() {
    this.mode = 'final';
    this.updateBug();
    this.app.showFinal(this.game, this.opts);
  },
  // Pregame: slow pan across the home stadium. Returns false until the art
  // has loaded (the field is drawn instead).
  drawStadium(out, sc) {
    const img = ready(sc.url);
    if (!img) return false;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (!sc.edge) {
      // sample the sky (top row) and ground (bottom row) to fill around it
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = img.height;
      const cx = c.getContext('2d');
      cx.drawImage(img, img.width >> 1, 0, 1, img.height, 0, 0, 1, img.height);
      const d = cx.getImageData(0, 0, 1, img.height).data;
      const rgb = (i) => `rgb(${d[i]},${d[i + 1]},${d[i + 2]})`;
      sc.edge = { sky: rgb(0), ground: rgb((img.height - 1) * 4) };
    }
    const scale = Math.max(W / img.width, (H * 0.58) / img.height);
    const dw = Math.round(img.width * scale);
    const dh = Math.round(img.height * scale);
    const y = Math.round((H - dh) * 0.4);
    out.fillStyle = sc.edge.sky;
    out.fillRect(0, 0, W, y + 1);
    out.fillStyle = sc.edge.ground;
    out.fillRect(0, y + dh - 1, W, H - y - dh + 1);
    const u = Math.min(1, sc.t / sc.dur);
    const e = u * u * (3 - 2 * u);
    out.drawImage(img, Math.round(-(dw - W) * (0.08 + 0.84 * e)), y, dw, dh);
    return true;
  },
};
