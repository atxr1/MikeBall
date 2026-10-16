// Kicking plays: kickoffs, punts, field goals and extra points.
// Outcomes are resolved here; the renderer animates them from the returned
// `anim` description. Field positions are in the receiving team's frame
// (ballOn 0 = their own goal line) unless noted.

import { clamp } from '../core/util.js';

export function fgDistance(ballOn) {
  return Math.round(100 - ballOn + 17);
}

export function fgMakeProb(kicker, distance) {
  const a = kicker.attrs;
  const maxRange = 52 + a.kpw * 0.12;
  const p = 0.995
    - Math.max(0, distance - 25) * 0.005
    - Math.max(0, distance - 40) * 0.022
    - Math.max(0, distance - (maxRange - 6)) * 0.07
    + (a.kac - 80) * 0.004;
  return clamp(p, 0.01, 0.99);
}

export function maxFgRange(kicker) {
  return Math.floor(52 + kicker.attrs.kpw * 0.12);
}

export function fieldGoal(kicker, ballOn, rng) {
  const distance = fgDistance(ballOn);
  if (rng.chance(0.01)) return { good: false, blocked: true, distance };
  const good = rng.chance(fgMakeProb(kicker, distance));
  const miss = good ? null : rng.pick(['wide left', 'wide right', 'short', 'wide right', 'wide left']);
  return { good, blocked: false, distance, miss };
}

export function extraPoint(kicker, rng) {
  const good = rng.chance(fgMakeProb(kicker, 33));
  return { good, distance: 33, miss: good ? null : rng.pick(['wide left', 'wide right']) };
}

// Returns { type, ballOn (receiving team frame), returnYds, landing, td, fumble }
export function kickoff(kicker, returner, rng, { onside = false, fromYard = 35 } = {}) {
  const a = kicker.attrs;
  if (onside) {
    const recovered = rng.chance(0.12);
    const spot = fromYard + rng.int(10, 13); // kicking-team frame
    return {
      type: recovered ? 'onside_recovered' : 'onside_failed',
      kickingRecovers: recovered,
      ballOn: recovered ? spot : 100 - spot,
      landing: 100 - spot,
      returnYds: 0,
    };
  }
  const distance = 60 + (a.kpw - 78) * 0.35 + rng.normal(0, 4) + (fromYard - 35) * -1;
  const landing = clamp(100 - fromYard - distance, -9, 40); // yards from receiving goal line
  if (fromYard === 35 && (landing < -3 || rng.chance(0.18 + Math.max(0, -landing) * 0.12))) {
    return { type: 'touchback', ballOn: 35, landing, returnYds: 0 };
  }
  if (rng.chance(0.004)) return { type: 'fumble', kickingRecovers: true, ballOn: clamp(100 - (landing + 20), 1, 99), landing, returnYds: 20 };
  const r = returner.attrs;
  let ret = 22 + (r.spd - 85) * 0.5 + (r.elu - 70) * 0.15 + rng.normal(0, 7);
  if (rng.chance(0.035)) ret += rng.int(15, 45);
  ret = Math.max(5, ret);
  let ballOn = landing + ret;
  if (ballOn >= 100 || rng.chance(0.003)) return { type: 'td', ballOn: 100, landing, returnYds: Math.round(100 - landing), td: true };
  ballOn = clamp(Math.round(ballOn), 1, 99);
  return { type: 'return', ballOn, landing, returnYds: Math.round(ballOn - landing) };
}

// ballOn: punting team's frame. Returns new ballOn in the receiving team's frame.
export function punt(punter, returner, ballOn, rng) {
  const a = punter.attrs;
  if (rng.chance(0.004)) {
    const spot = clamp(ballOn - 8, 1, 99);
    return { type: 'blocked', ballOn: 100 - spot, gross: 0, returnYds: 0, landing: spot };
  }
  const gross = clamp(rng.normal(45.5 + (a.kpw - 78) * 0.25, 5.5), 28, 70);
  const landing = ballOn + gross; // punting team frame
  if (landing >= 100) {
    // Some punts are downed inside the 5 instead of reaching the end zone.
    if (landing < 104 && rng.chance(0.35)) {
      const spot = clamp(rng.int(95, 99), 1, 99);
      return { type: 'downed', ballOn: 100 - spot, gross: Math.round(spot - ballOn), returnYds: 0, landing: spot };
    }
    return { type: 'touchback', ballOn: 20, gross: Math.round(100 - ballOn), returnYds: 0, landing: 100 };
  }
  const fairP = landing > 88 ? 0.65 : 0.35;
  if (rng.chance(0.008)) {
    return { type: 'muff', kickingRecovers: true, ballOn: clamp(Math.round(landing), 1, 99), gross: Math.round(gross), returnYds: 0, landing };
  }
  if (rng.chance(fairP)) return { type: 'fair', ballOn: clamp(Math.round(100 - landing), 1, 99), gross: Math.round(gross), returnYds: 0, landing };
  const r = returner.attrs;
  let ret = Math.max(0, rng.normal(8.5 + (r.spd - 85) * 0.25 + (r.elu - 70) * 0.1, 5));
  if (rng.chance(0.025)) ret += rng.int(15, 50);
  const spot = 100 - landing + ret;
  if (spot >= 100) return { type: 'td', ballOn: 100, gross: Math.round(gross), returnYds: Math.round(ret), landing, td: true };
  return { type: 'return', ballOn: clamp(Math.round(spot), 1, 99), gross: Math.round(gross), returnYds: Math.round(ret), landing };
}
