// Play clock and the snap, mixed into CoachScreen.
//
// Between plays the play clock (40 or 25 seconds, see rules.js) runs in real
// time while a play is called, and the game clock runs with it when it's
// running. On offense you snap it with Run play, or it's delay of game. On
// defense the CPU offense snaps it when its tempo says so, or as soon as you
// tap Ready. Either way the clock spins down to the snap point first, so a
// normal-tempo snap still uses most of the play clock.

import { other } from '../game/rules.js';
import { fmtClock } from '../core/util.js';

export const playClockMethods = {
  // Game clock plus the play clock, which shows while a play is being called.
  updateClocks() {
    const g = this.game;
    const clock = g.over ? '' : fmtClock(g.clock);
    if (this.el.clock.textContent !== clock) this.el.clock.textContent = clock;
    const show = (this.mode === 'call' || this.mode === 'set') && !this.noPlayClock();
    const pc = Math.max(0, Math.ceil(g.playClock));
    const txt = show ? `:${String(pc).padStart(2, '0')}` : '';
    if (this.el.pc.textContent !== txt) this.el.pc.textContent = txt;
    this.el.pc.classList.toggle('low', show && pc <= 5);
    this.updateScorebug();
  },

  // Tries (extra point / two-point) aren't timed here.
  noPlayClock() {
    return this.twoPoint || this.game.phase === 'pat';
  },

  // Between plays the play clock runs in real time while you call a play.
  // On offense you snap it (or get flagged for delay of game); on defense
  // the CPU offense snaps it when its tempo says so, or when you're ready.
  tickPlayClock(dt) {
    const g = this.game;
    if ((this.mode !== 'call' && this.mode !== 'set') || this.noPlayClock()) {
      if (this.el.pc.textContent) this.updateClocks(); // hide it after the snap
      return;
    }
    // paused while a banner, dialog or the roster is up, or a finger is drawing
    if (this.bannerThen || this.drawing.drag || this.root.querySelector('[aria-modal="true"]')) return;
    let sec = dt;
    if (this.mode === 'set') sec = Math.min(Math.max(0, g.playClock - this.snapTarget), this.setRate * dt);
    const ev = g.tickBetweenPlays(sec);
    this.updateClocks();
    if (ev.includes('endQuarter')) {
      this.setSheetEnabled(false);
      this.mode = 'idle';
      this.updateBug();
      return this.advance();
    }
    if (ev.includes('twoMinute')) {
      this.updateBug();
      this.twoMinuteCard();
      this.mode = 'call';
      this.setSheetEnabled(true);
      return;
    }
    const userOff = g.poss === this.user;
    if (ev.includes('delay')) {
      if (userOff && this.mode === 'call') return this.delayOfGame();
      return this.doSnap();
    }
    if (this.mode === 'set' && g.playClock <= this.snapTarget + 1e-6) return this.doSnap();
    if (this.mode === 'call' && !userOff && g.playClock <= g.snapAt(other(this.user))) {
      this.toast(`${g.teams[g.poss].abbr} snap it`, 1);
      this.doSnap();
    }
  },

  delayOfGame() {
    const g = this.game;
    this.setSheetEnabled(false);
    this.mode = 'idle';
    const pen = g.delayOfGame();
    this.updateBug();
    this.setTicker(`Flag: ${pen.text}`);
    this.banner('Delay of game', pen.text, 1.8, () => this.advance());
  },

  // Run play (offense) / Ready (defense): break the huddle and run the play
  // clock down to the snap.
  snap() {
    if (this.mode !== 'call' || this.paused || !this.sel || this.playDisabled(this.sel)) return;
    const g = this.game;
    this.setSheetEnabled(false);
    if (this.noPlayClock()) return this.doSnap();
    const target = Math.min(g.playClock, g.snapAt(g.poss));
    if (g.playClock - target < 0.05) return this.doSnap();
    this.snapTarget = target;
    this.setRate = Math.max(30, (g.playClock - target) / 0.5);
    this.mode = 'set';
    this.updateClocks();
  },

  doSnap() {
    if (this.mode !== 'call' && this.mode !== 'set') return;
    const g = this.game;
    this.setSheetEnabled(false);
    const userOff = g.poss === this.user;
    const mine = this.drawing.play();
    const o = userOff ? mine : this.cpuPlay;
    const d = userOff ? this.cpuPlay : mine;
    this.runSnap(o, d);
  },
};
