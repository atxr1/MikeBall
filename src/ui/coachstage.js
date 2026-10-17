// The pre-snap stage in the coach view (src/ui/presnap.js), mixed into
// CoachScreen: huddles, players jogging to new spots when the call changes,
// substitutes running on and off, the umpire holding the ball when the
// offense substitutes, and the snap waiting until the offense is set.

import { other } from '../game/rules.js';
import { cpuMatchDefense } from '../game/cpu.js';
import { PreSnap } from './presnap.js';

const ELIGIBLE_SLOTS = new Set(['X', 'Z', 'SL', 'SL2', 'Y', 'Y2', 'Y3', 'RB', 'FB']);

export const stageMethods = {
  initStage() {
    this.pre = new PreSnap();
    this.stageFresh = false;
  },

  // A new preview sim for the call: start the stage on the first one of
  // this call, follow it on later ones (the coach changed the play).
  stagePreview(sim) {
    const g = this.game;
    if (this.stageFresh || !this.pre.ctx) {
      this.stageFresh = false;
      const tempo = g.tempoFor(g.poss);
      const twoMinute = (g.quarter === 2 || g.quarter >= 4) && g.clock <= 120;
      const same = this.lastSnapPoss === g.poss && this.lastPlaySim;
      const prevPos = new Map();
      if (same) for (const p of this.lastPlaySim.players) prevPos.set(p.rec.id, { x: p.x, y: p.y });
      this.pre.begin(sim, {
        offTeam: g.poss,
        homeSide: g.poss === 'home' ? -1 : 1,
        hurry: tempo === 'hurry' && !!same,
        prevPos,
        prevCrew: same ? this.lastPlaySim.crew : null,
        twoMinute,
        fg: false,
        prevLos: this.lastSnapLos ?? g.ballOn,
        los: g.ballOn,
      });
    } else this.pre.sync(sim);
    this.reportEligible(sim);
  },

  // A player with an ineligible number (anything outside 0–49 and 80–89,
  // Rule 5-1-2) lined up at an eligible spot reports to the referee
  // (5-3-1), every play.
  reportEligible(sim) {
    if (!this.reported) this.reported = new Set();
    for (const p of sim.offense) {
      const n = +p.rec.num;
      const ineligible = !(n < 50 || (n >= 80 && n <= 89));
      if (!ineligible || !ELIGIBLE_SLOTS.has(p.slot) || this.reported.has(p.rec.id)) continue;
      this.reported.add(p.rec.id);
      this.toast(`No. ${p.rec.num} reporting as eligible`, 2);
    }
  },

  // When the user changes his offensive call, the CPU defense may change
  // its personnel to match.
  matchDefense(o) {
    const g = this.game;
    if (g.poss !== this.user || !this.cpuBase) return;
    this.cpuPlay = cpuMatchDefense(g, other(this.user), o, this.cpuBase);
  },

  stageOverride() {
    if ((this.mode !== 'call' && this.mode !== 'set') || !this.pre.ctx) return null;
    const g = this.game;
    return (p) => this.pre.override(p, p.side === 'O' ? g.poss : other(g.poss));
  },

  // At the snap: anyone from the defense still on his way off makes twelve
  // on the field — a live-ball foul (Rule 5-1-1): the play runs, flagged.
  twelveMen() {
    return this.pre.ctx ? this.pre.extraDefenders() > 0 : false;
  },
};
