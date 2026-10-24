// Glue between the rules engine and the play sim, plus a CPU-vs-CPU driver
// used by tests, "sim to end", and (later) season simulation.

import { settleRuling } from './replay.js';
import { PlaySim } from '../sim/playsim.js';
import { quickPlay, foul } from './quicksim.js';
import { offenseLineup, defenseLineup, rosterIndex } from './personnel.js';
import { cpuOffense, cpuDefense, cpuPat, cpuOnside, cpuTimeout, cpuDelayRisk } from './cpu.js';
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

// A snap for a CPU-vs-CPU game: the full sim, or the quick resolver when
// the game is flagged quick (season mode's other games).
function runSnap(game, oPlay, dPlay, extra = null) {
  if (!game.quick) return makePlaySim(game, oPlay, dPlay, null, extra).runToEnd();
  const off = game.poss;
  const def = other(off);
  return quickPlay({
    offPlay: oPlay,
    defPlay: dPlay,
    offLineup: offenseLineup(game.rosters[off], oPlay.formation),
    defLineup: defenseLineup(game.rosters[def], dPlay.front),
    ballOn: game.ballOn,
    ballX: game.ballX,
    rng: game.rng,
    wantOOB: game.tempoFor(off) === 'hurry' && game.inLateWindow(),
    toGo: game.ltg >= 100 ? null : game.ltg - game.ballOn,
    rb2: backup(game.rosters[off], 'RB', 1),
  });
}

function backup(roster, pos, i) {
  const id = (roster.depth[pos] || [])[i];
  const p = id && rosterIndex(roster).get(id);
  return p && !p.injured ? p : null;
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
      const r = runSnap(game, play, cpuDefense(game, other(side)), { noFouls: true });
      if (r.quick) r.fouls = [];
      return game.applyTwoPoint(r);
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
      // late getting the play off (a loud road crowd, a busy call...)
      const last = (game.lastFormation ||= {});
      const risk = cpuDelayRisk(game, off, { formation: o.formation, prevFormation: last[off], defCat: d.cat, neutral: game.neutral });
      last[off] = o.formation;
      if (game.rng.chance(risk.p)) {
        const ev = game.tickBetweenPlays(game.playClock);
        if (ev.includes('endQuarter')) return { kind: 'endQuarter' };
        if (!ev.includes('twoMinute')) return { kind: 'penalty', pen: game.delayOfGame() };
      }
      const snap = game.snap();
      if (snap.stop) return { kind: 'endQuarter' };
      const pen = game.preSnapPenalty();
      if (pen && !pen.live) { game.finishNext(); return { kind: 'penalty', pen }; }
      const raw = runSnap(game, o, d, pen ? { snapFoul: { key: pen.key } } : null);
      // a live-ball foul at the snap the quick resolver doesn't stage
      if (raw.quick && pen) raw.fouls.push(foul(pen.key, null));
      // the officials' ruling, and replay if anyone looks at it
      const { result, charge, reversed } = settleRuling(game, raw, game.rng);
      const out = game.applyPlay(result, o, d);
      if (reversed) game.reversalRunoff();
      if (charge && out.kind !== 'penalty') game.chargeChallenge(charge.side, charge.won);
      return out;
    }
  }
}

export function simulateGame(game, maxSteps = 5000) {
  let n = 0;
  while (!game.over && n++ < maxSteps) cpuStep(game);
  return game;
}
