// Glue between the rules engine and the play sim, plus a CPU-vs-CPU driver
// used by tests, "sim to end", and (later) season simulation.

import { PlaySim } from '../sim/playsim.js';
import { offenseLineup, defenseLineup } from './personnel.js';
import { cpuOffense, cpuDefense, cpuPat, cpuOnside, cpuTimeout } from './cpu.js';
import { offPlay } from '../data/playbook.js';
import { other } from './rules.js';
import { MID_X } from '../core/util.js';

export function makePlaySim(game, oPlay, dPlay, rng, extra = null) {
  const off = game.poss;
  const def = other(off);
  return new PlaySim({
    offPlay: oPlay,
    defPlay: dPlay,
    offLineup: offenseLineup(game.rosters[off], oPlay.formation),
    defLineup: defenseLineup(game.rosters[def], dPlay.front),
    ballOn: game.ballOn,
    ballX: game.ballX,
    rng: rng || game.rng.fork(),
    wantOOB: game.tempoFor(off) === 'hurry' && game.inLateWindow(),
    toGo: game.ltg >= 100 ? null : game.ltg - game.ballOn,
    umpireDefense: game.umpireOnDefense ? game.umpireOnDefense() : false,
    // the home bench is on the left of the screen when the home team has the
    // ball (the view turns around with possession)
    homeSide: off === 'home' ? -1 : 1,
    // the chain crew (and the down judge) switch sidelines at halftime
    half: game.quarter >= 3 ? 2 : 1,
    ...(extra || {}),
  });
}

export function setupTwoPoint(game) {
  game.ballOn = 98;
  game.ballX = MID_X;
  game.down = 1;
  game.ltg = 100;
}

// One CPU step for whatever the game needs next. Returns a short record.
export function cpuStep(game) {
  switch (game.next) {
    case 'final':
      return null;
    case 'endQuarter':
      return game.endQuarter();
    case 'kickoff':
      return game.kickoff(cpuOnside(game, game.kickingSide));
    case 'pat': {
      const side = game.patSide;
      if (cpuPat(game, side) === 'kick') return game.extraPoint();
      setupTwoPoint(game);
      const o = cpuOffense(game, side);
      const play = o.cat === 'special' ? offPlay('slants') : o;
      const sim = makePlaySim(game, play, cpuDefense(game, other(side)), null, { noFouls: true });
      return game.applyTwoPoint(sim.runToEnd());
    }
    case 'call':
    default: {
      for (const s of ['home', 'away']) if (cpuTimeout(game, s)) game.useTimeout(s);
      const off = game.poss;
      const o = cpuOffense(game, off);
      if (o.special === 'punt' || o.special === 'fg') {
        const snap = game.snap();
        if (snap.stop) return { kind: 'endQuarter' };
        return o.special === 'punt' ? game.punt() : game.fieldGoal();
      }
      const d = cpuDefense(game, other(off));
      const snap = game.snap();
      if (snap.stop) return { kind: 'endQuarter' };
      const pen = game.preSnapPenalty();
      if (pen && !pen.live) { game.finishNext(); return { kind: 'penalty', pen }; }
      const sim = makePlaySim(game, o, d, null, pen ? { snapFoul: { key: pen.key } } : null);
      return game.applyPlay(sim.runToEnd(), o, d);
    }
  }
}

export function simulateGame(game, maxSteps = 5000) {
  let n = 0;
  while (!game.over && n++ < maxSteps) cpuStep(game);
  return game;
}
