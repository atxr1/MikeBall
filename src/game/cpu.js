// CPU coach: play calling, 4th downs, two-point tries, onside kicks, timeouts.

import { OFFENSE_PLAYS, DEFENSE_PLAYS, FORMATIONS, offPlay, defPlay } from '../data/playbook.js';
import { fgDistance, maxFgRange } from './kicks.js';

const RUNS = OFFENSE_PLAYS.filter((p) => p.cat === 'run');
const PASSES = OFFENSE_PLAYS.filter((p) => p.cat === 'pass');

export function cpuCanKneelOut(game, side) {
  const s = game.situation(side);
  if (!s.offense || s.diff <= 0 || s.quarter < 4) return false;
  if (s.down >= 4) return false;
  const snapsLeft = 4 - s.down; // keep 4th down to punt if needed
  const burn = snapsLeft * 41 - s.oppTimeouts * 41 + (s.clockRunning ? 0 : -40);
  return s.clock <= burn + 40;
}

export function cpuFourthDown(game, side) {
  const s = game.situation(side);
  const k = game.kicker(side);
  const range = maxFgRange(k) - 2;
  const fgd = fgDistance(s.ballOn);
  const late = s.quarter >= 4 && s.clock <= 300;
  if (late && s.diff < 0) {
    if (s.diff >= -3 && fgd <= range && s.clock <= 120) return 'fg';
    if (s.diff < -3 || s.clock <= 120) return 'go';
  }
  if (s.ballOn >= 60) {
    if (s.toGo <= 1 && game.rng.chance(0.55)) return 'go';
    if (fgd <= range) return 'fg';
    return s.toGo <= 4 ? 'go' : 'punt';
  }
  if (s.ballOn >= 45 && s.toGo <= 1 && game.rng.chance(0.45)) return 'go';
  return 'punt';
}

export function cpuPat(game, side) {
  const diff = game.score[side] - game.score[side === 'home' ? 'away' : 'home'];
  if (game.quarter >= 4 && [-2, -5, -10, 1, 5, 12].includes(diff)) return 'two';
  return game.rng.chance(0.03) ? 'two' : 'kick';
}

export function cpuOnside(game, side) {
  const diff = game.score[side] - game.score[side === 'home' ? 'away' : 'home'];
  return game.quarter >= 4 && game.clock <= 180 && diff < 0 && diff >= -16;
}

export function cpuTimeout(game, side) {
  if (game.timeouts[side] <= 0 || !game.clockRunning) return false;
  const s = game.situation(side);
  if (s.quarter < 2 || s.quarter === 3) return false;
  if (s.offense) {
    if (s.quarter === 2 && s.clock <= 70 && s.ballOn >= 35) return true;
    if (s.quarter >= 4 && s.diff <= 0 && s.clock <= 110) return true;
    return false;
  }
  if (s.quarter >= 4 && s.diff < 0 && s.diff >= -16 && s.clock <= 160) return true;
  return false;
}

function pickWeighted(rng, list, w) {
  return rng.weighted(list, w);
}

export function cpuOffense(game, side) {
  const rng = game.rng;
  const s = game.situation(side);
  if (cpuCanKneelOut(game, side)) return offPlay('kneel');
  if (s.quarter === 2 && s.clock <= 25 && s.diff >= 0 && s.ballOn < 55) return offPlay('kneel');
  if (s.down === 4) {
    const d = cpuFourthDown(game, side);
    if (d === 'punt') return offPlay('punt');
    if (d === 'fg') return offPlay('fg');
  }
  const twoMin = (s.quarter === 2 && s.clock <= 120) || (s.quarter >= 4 && s.diff < 0 && s.clock <= 240);
  if (twoMin && s.clock <= 30 && s.timeouts === 0 && s.clockRunning && s.down < 4) return offPlay('spike');
  // Last play of the half: field goal or Hail Mary.
  if (twoMin && s.clock <= 8) {
    if (fgDistance(s.ballOn) <= maxFgRange(game.kicker(side)) - 1 && (s.quarter === 2 || (s.diff >= -3 && s.diff <= 0))) return offPlay('fg');
    if (s.ballOn >= 40) return offPlay('hail_mary');
  }

  let passP;
  const tg = s.toGo;
  if (s.down === 1) passP = 0.5;
  else if (s.down === 2) passP = tg > 7 ? 0.62 : tg <= 3 ? 0.35 : 0.5;
  else passP = tg >= 5 ? 0.88 : tg >= 3 ? 0.6 : 0.35;
  if (twoMin) passP = Math.max(passP, 0.85);
  if (s.quarter >= 4 && s.diff > 0 && s.clock <= 360) passP *= 0.55;
  if (s.ballOn >= 97) passP = Math.min(passP, 0.45);

  if (rng.chance(passP)) {
    const want = tg >= 12 ? 'deep' : tg >= 7 ? 'mid' : 'short';
    return pickWeighted(rng, PASSES.filter((p) => !p.hailMary), (p) => {
      let w = p.depth === want ? 3 : 1;
      if (twoMin && p.depth === 'short' && s.clock > 60) w *= 0.7;
      if (s.ballOn >= 92 && p.depth === 'deep') w *= 0.2;
      return w;
    });
  }
  return pickWeighted(rng, RUNS, (p) => {
    if (tg <= 1 && p.shortYardage) return 4;
    if (p.shortYardage) return s.ballOn >= 95 ? 2 : 0.15;
    if (p.id === 'draw') return s.down >= 2 && tg >= 7 ? 2 : 0.6;
    return 1;
  });
}

export function cpuDefense(game, side) {
  const rng = game.rng;
  const s = game.situation(side); // from the defense's perspective
  const oppBall = s.ballOn; // ballOn is the offense's field position
  const tg = s.toGo;
  const pool = (ids) => ids.map((id) => defPlay(id));
  if (tg <= 1 || oppBall >= 97) return rng.pick(pool(oppBall >= 95 ? ['goal_line', 'goal_line', 'run_commit'] : ['run_commit', '34_base', 'goal_line', 'mike_blitz']));
  if (s.quarter >= 4 && s.diff > 0 && s.diff <= 8 && s.clock <= 40 && oppBall < 60) return rng.pick(pool(['prevent', 'cov4']));
  if (s.down === 3 && tg >= 7) return rng.pick(pool(['cov3_nickel', 'cov4', '2man', 'fire_zone', 'nickel_blitz', 'press_dime', 'cov0']));
  if (tg <= 3) return rng.pick(pool(['run_commit', '34_base', 'cov1_43', 'mike_blitz', 'cov3_43']));
  return rng.pick(pool(['cov1_43', 'cov2_43', 'tampa2', 'cov3_43', 'cov3_nickel', 'cov4', 'cov1_nickel', 'mike_blitz', 'fire_zone', '2man', 'edge_34']));
}

// Matching personnel: when the offense brings in a third receiver the CPU
// defense goes to nickel (or dime), and back to base when it goes heavy.
// current: the defense the CPU called before the offense substituted.
const NICKEL_FOR = {
  cov1_43: 'cov1_nickel', cov2_43: 'cov4', tampa2: 'cov3_nickel', cov3_43: 'cov3_nickel',
  mike_blitz: 'nickel_blitz', run_commit: 'cov1_nickel', '34_base': 'cov3_nickel', edge_34: 'fire_zone', goal_line: 'cov1_nickel',
};
const BASE_FOR = {
  cov1_nickel: 'cov1_43', '2man': 'cov1_43', press_dime: 'cov1_43', cov3_nickel: 'cov3_43', cov4: 'cov2_43',
  prevent: 'cov2_43', fire_zone: 'mike_blitz', nickel_blitz: 'mike_blitz', cov0: 'mike_blitz',
};

export function receiversIn(play) {
  const f = FORMATIONS[play.formation];
  if (!f || play.cat === 'special') return 2;
  return f.slots.filter((s) => s.pos === 'WR').length;
}

export function cpuMatchDefense(game, side, oPlay, current) {
  if (!oPlay || oPlay.cat === 'special' || !current) return current;
  const wr = receiversIn(oPlay);
  const light = current.front === 'nickel' || current.front === 'dime';
  if (wr >= 3 && !light && NICKEL_FOR[current.id]) return defPlay(NICKEL_FOR[current.id]);
  if (wr <= 1 && light && BASE_FOR[current.id]) return defPlay(BASE_FOR[current.id]);
  return current;
}
