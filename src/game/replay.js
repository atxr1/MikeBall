// Officiating and instant replay. The play sim decides what really
// happened; the officials on the field rule on it, and on a close play
// (a toe at the sideline, a diving catch, the spot against the line to gain,
// the ball breaking the plane, a fumble as the runner goes down) they can
// get it wrong. Replay can fix it (NFL Rule 15):
//   - each team has two challenges, and a third once one of them succeeds;
//     a challenge needs a timeout in reserve and costs it if the ruling
//     stands; the red flag has to come before the next snap
//   - inside two minutes of either half and in overtime the replay official
//     (the booth) initiates every review instead
//   - scoring plays and turnovers are reviewed automatically
//   - a ruling is changed only on clear and obvious evidence
// No DOM; every draw comes from the seeded RNG passed in.

import { StatBook } from './stats.js';

// How often each kind of close play is ruled wrong on the field.
const MISS = { sideline: 0.14, dive: 0.1, spot: 0.1, goal: 0.18, fumble: 0.1 };
// Clear and obvious: how often replay catches a wrong ruling.
const OVERTURN = 0.85;

// ---------------------------------------------------------------- rulings

// The ruling on the field for a play: { ruled, close } where `ruled` is the
// result the officials signal (the same object when they got it right) and
// `close` describes a close call (null if there wasn't one): { kind, wrong,
// favors: 'O'|'D' (whose way the ruling went), call, lean }.
// ctx: { toGo, goal } in yards from the line of scrimmage.
export function onFieldRuling(r, ctx, rng) {
  if (!r || r.kind === 'kneel' || r.kind === 'spike' || r.defTD || r.safety) return { ruled: r, close: null };
  const rv = r.review || {};
  const caught = !r.incomplete && !!r.receiver && !r.interception;
  const near = (y) => Math.abs((r.spotY ?? 0) - y);

  // a pass at the sideline: did he get a foot down in bounds?
  if (rv.sideline && rv.ball && r.kind === 'pass' && !r.interception && (r.incomplete || near(r.catchY ?? 0) < 2.5)) {
    const wrong = rng.chance(MISS.sideline);
    if (!wrong) return { ruled: r, close: close('sideline', false, caught ? 'O' : 'D', rng) };
    const ruled = caught ? asIncomplete(r, 'out of bounds') : asCatchAt(r, rv.ball.y, true);
    return { ruled, close: close('sideline', true, caught ? 'D' : 'O', rng) };
  }
  // a diving catch: did he keep control when he hit the ground?
  if (rv.dive && caught && !r.td && near(r.catchY ?? 0) < 1.5) {
    const wrong = rng.chance(MISS.dive);
    if (!wrong) return { ruled: r, close: close('dive', false, 'O', rng) };
    return { ruled: asIncomplete(r, 'incomplete'), close: close('dive', true, 'D', rng) };
  }
  // in as he was being tackled at the goal line: did the ball break the plane?
  if (rv.tdContact && r.td && !r.turnover && ctx.goal != null) {
    const wrong = rng.chance(MISS.goal);
    if (!wrong) return { ruled: r, close: close('goal', false, 'O', rng) };
    return { ruled: asSpot(r, ctx.goal - 0.6), close: close('goal', true, 'D', rng) };
  }
  // the ball came out as he went down: fumble, or down by contact?
  if (r.fumble && r.fumble.lost && r.turnover) {
    const wrong = rng.chance(MISS.fumble);
    if (!wrong) return { ruled: r, close: close('fumble', false, 'D', rng) };
    return { ruled: asDown(r), close: close('fumble', true, 'O', rng) };
  }
  // the spot against the line to gain (the game rounds to whole yards, so
  // the line is at toGo - 0.5)
  if (!r.td && !r.turnover && !r.incomplete && ctx.toGo != null && ctx.toGo > 0 && Math.abs(r.spotY - (ctx.toGo - 0.5)) < 0.3) {
    const made = Math.round(r.spotY) >= ctx.toGo;
    const wrong = rng.chance(MISS.spot);
    if (!wrong) return { ruled: r, close: close('spot', false, made ? 'O' : 'D', rng) };
    return { ruled: asSpot(r, made ? ctx.toGo - 0.8 : ctx.toGo - 0.2), close: close('spot', true, made ? 'D' : 'O', rng) };
  }
  return { ruled: r, close: null };
}

function close(kind, wrong, favors, rng) {
  // what the TV replay seems to show: usually right, not always
  const u = rng.next();
  const lean = wrong ? (u < 0.7 ? 'against' : u < 0.9 ? 'unclear' : 'with') : (u < 0.55 ? 'with' : u < 0.85 ? 'unclear' : 'against');
  return { kind, wrong, favors, lean };
}

// ---------------------------------------------------------------- variants
function base(r) {
  return { ...r, review: null, firstDown: false };
}

function asIncomplete(r, why) {
  return { ...base(r), kind: 'pass', incomplete: true, why, receiver: null, yards: 0, spotY: 0, td: false, outOfBounds: false, fumble: null, turnover: false, tackler: null, catchY: null };
}

function asCatchAt(r, y, oob) {
  return { ...base(r), kind: 'pass', incomplete: false, why: null, receiver: r.target, yards: Math.round(y), spotY: y, td: false, outOfBounds: oob, tackler: null, catchY: y };
}

function asSpot(r, y) {
  return { ...base(r), td: false, yards: Math.round(y), spotY: y, outOfBounds: false };
}

function asDown(r) {
  // down by contact where the ball came out: the offense keeps it there
  const y = r.fumble && r.spotY != null ? r.spotY : 0;
  return { ...base(r), turnover: false, fumble: null, interception: false, touchback: false, yards: Math.round(y), spotY: y, outOfBounds: false };
}

// ---------------------------------------------------------------- words
const CALL = {
  sideline: { O: 'Ruled a catch at the sideline.', D: 'Ruled incomplete: out of bounds.' },
  dive: { O: 'Ruled a catch.', D: 'Ruled incomplete: the ball came loose when he hit the ground.' },
  goal: { O: 'Ruled a touchdown.', D: 'Ruled down short of the goal line.' },
  fumble: { O: 'Ruled down by contact.', D: 'Ruled a fumble, recovered by the defense.' },
  spot: { O: 'Spotted for a first down.', D: 'Spotted short of the line to gain.' },
};
const LEAN = {
  sideline: {
    O: { against: 'On the replay his second foot may have come down on the white.', with: 'The replay shows both feet in.', unclear: 'From this angle it’s hard to see his feet.' },
    D: { against: 'On the replay his second foot looks to come down in bounds.', with: 'The replay shows his foot on the line.', unclear: 'From this angle it’s hard to see his feet.' },
  },
  dive: {
    D: { against: 'The replay suggests he had control all the way to the ground.', with: 'The ball clearly moves when he lands.', unclear: 'His body blocks the camera at the moment he lands.' },
  },
  goal: {
    D: { against: 'The replay shows the ball breaking the plane before his knee hit.', with: 'His knee is down before the ball gets to the line.', unclear: 'There’s a pile at the goal line; hard to see the ball.' },
  },
  fumble: {
    O: { against: 'The replay shows the ball coming out before his knee touched.', with: 'His knee is down before the ball comes out.', unclear: 'It’s bang-bang: knee and ball at the same moment.' },
  },
  spot: {
    O: { against: 'The replay suggests his knee was down short of the line.', with: 'The ball looks to reach the line to gain.', unclear: 'There’s no good angle on the spot.' },
    D: { against: 'The replay suggests the ball reached the line to gain.', with: 'His knee is down short of the line.', unclear: 'There’s no good angle on the spot.' },
  },
};

export function callText(c) {
  return CALL[c.kind][c.favors];
}

export function leanText(c) {
  const k = LEAN[c.kind] && LEAN[c.kind][c.favors];
  return k ? k[c.lean] : '';
}

// ---------------------------------------------------------------- reviews

// Decided by the replay: true if the ruling is reversed.
export function reviewOverturns(c, rng) {
  return !!(c && c.wrong && rng.chance(OVERTURN));
}

// Would the CPU coach throw the flag? His staff upstairs sees the replay.
export function cpuWantsChallenge(game, side, c, rng) {
  if (!c || !game.canChallenge(side)) return false;
  let p = c.wrong ? (c.lean === 'against' ? 0.65 : 0.3) : (c.lean === 'against' ? 0.2 : 0.03);
  // a timeout is worth more late in the half
  if (game.timeouts[side] <= 1 || (game.quarter === 2 || game.quarter === 4) && game.clock < 300) p *= 0.6;
  return rng.chance(p);
}

// Who would review this one: 'booth' (last two minutes of a half, overtime),
// or null (a coach has to challenge it).
export function boothReviews(game) {
  return game.inBoothWindow();
}

// The context a ruling needs, from the game before the play is applied.
export function rulingCtx(game) {
  return { toGo: game.ltg >= 100 ? null : game.ltg - game.ballOn, goal: 100 - game.ballOn };
}

// For games played without the coach screen (CPU vs CPU, sim to the end):
// the ruling, any review, and the result that counts. Returns { result,
// charge }: charge ({ side, won }) is a challenge to charge once the play
// has been applied.
export function settleRuling(game, r, rng) {
  const { ruled, close: c } = onFieldRuling(r, rulingCtx(game), rng);
  if (!c) return { result: r, charge: null };
  const wronged = c.favors === 'O' ? game.defense : game.offense;
  if (boothReviews(game)) return { result: reviewOverturns(c, rng) ? r : ruled, charge: null };
  if (!cpuWantsChallenge(game, wronged, c, rng)) return { result: ruled, charge: null };
  const won = reviewOverturns(c, rng);
  return { result: won ? r : ruled, charge: { side: wronged, won } };
}

// ---------------------------------------------------------------- Game
export const replayMethods = {
  inBoothWindow() {
    return this.quarter >= 5 || ((this.quarter === 2 || this.quarter === 4) && this.clock <= 120);
  },

  canChallenge(side) {
    return !this.inBoothWindow() && this.challenges[side] > 0 && this.timeouts[side] > 0;
  },

  // A challenge thrown: one fewer left; a third once one succeeds; a
  // timeout charged if the ruling stands.
  chargeChallenge(side, won) {
    this.challenges[side] = Math.max(0, this.challenges[side] - 1);
    if (!this.challengeWins) this.challengeWins = { home: 0, away: 0 };
    if (won) {
      this.challengeWins[side]++;
      if (this.challengeWins[side] === 1) this.challenges[side]++;
    } else {
      this.timeouts[side] = Math.max(0, this.timeouts[side] - 1);
    }
    this.clockRunning = false;
    this.addLog(`${this.teams[side].abbr} challenge: ${won ? 'the ruling is reversed' : `the ruling stands, timeout charged (${this.timeouts[side]} left)`}.`, 'info', { side });
  },

  // Everything about the game state, to put back if a review reverses the
  // ruling the game moved on with.
  snapshot() {
    const keep = {};
    for (const [k, v] of Object.entries(this)) {
      if (k === 'teams' || k === 'rosters' || k === 'rng' || k === 'log' || k === 'stats') continue;
      keep[k] = v;
    }
    return {
      data: structuredClone(keep),
      stats: { players: structuredClone(this.stats.players), team: structuredClone(this.stats.team) },
      rng: this.rng.state,
      log: this.log.length,
    };
  },

  restore(s) {
    Object.assign(this, structuredClone(s.data));
    const st = Object.create(StatBook.prototype);
    st.players = structuredClone(s.stats.players);
    st.team = structuredClone(s.stats.team);
    this.stats = st;
    this.rng.state = s.rng;
    this.log.length = s.log;
  },
};
