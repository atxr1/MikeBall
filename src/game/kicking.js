// Kickoffs, punts and field goals, mixed into Game (src/game/rules.js). The
// kicks themselves are modeled in ./kicks.js; this applies the result to
// the game: possession, the score, the clock, the log and stats.

import { clamp, fieldLabel } from '../core/util.js';
import * as K from './kicks.js';
import { nm } from './commentary.js';

const other = (s) => (s === 'home' ? 'away' : 'home');

export const kickingMethods = {
  kickoff(onside = false) {
    const kSide = this.kickingSide;
    const rSide = other(kSide);
    const k = this.kicker(kSide);
    const ret = this.returner(rSide);
    const fromYard = this.freeKick ? 20 : 35;
    const res = K.kickoff(k, ret, this.rng, { onside, fromYard });
    const kicksOff = this.freeKick ? 'free kicks' : 'kicks off';
    this.freeKick = false;
    let text;
    let headline = null;
    const tk = this.teams[kSide].abbr;
    const tr = this.teams[rSide].abbr;
    this.poss = rSide;
    if (res.type === 'touchback') {
      text = res.rolled ? `${nm(k)}'s kick rolls into the end zone. Touchback, ${tr} ball at the 20.` : `${nm(k)} ${kicksOff}. Touchback, ${tr} ball at the 35.`;
      this.setPossession(rSide, res.ballOn);
    } else if (res.type === 'short' || res.type === 'oob') {
      text = res.type === 'short' ? `${nm(k)}'s kick lands short of the landing zone. ${tr} ball at the 40.` : `${nm(k)} ${kicksOff} out of bounds. ${tr} ball at the 40.`;
      this.setPossession(rSide, 40);
    } else if (res.type === 'onside_recovered') {
      text = `ONSIDE KICK — recovered by ${tk}!`;
      headline = 'Onside kick recovered!';
      this.setPossession(kSide, res.ballOn);
    } else if (res.type === 'onside_failed') {
      text = `Onside kick recovered by ${tr}.`;
      this.setPossession(rSide, res.ballOn);
    } else if (res.type === 'fumble') {
      text = `${nm(ret)} fumbles the return! Recovered by ${tk}.`;
      headline = 'Fumble!';
      this.runClock(5);
      this.setPossession(kSide, 100 - res.ballOn);
    } else if (res.type === 'td') {
      text = `${nm(ret)} returns the kick ${res.returnYds} yards for a TOUCHDOWN!`;
      headline = 'Kick return touchdown!';
      this.runClock(11);
      this.setPossession(rSide, 99);
      this.addScore(rSide, 6);
      this.addLog(text, 'score');
      if (!this.otScore(rSide, 'td')) this.startPat(rSide);
      this.finishNext();
      return { text, headline, kind: 'kickoff', res, kSide, rSide, from: fromYard, returner: ret, next: this.next };
    } else {
      const end = res.runEnd ?? res.ballOn;
      text = end >= 100 ? `${nm(k)} ${kicksOff}, ${nm(ret)} returns it all the way —` : `${nm(k)} ${kicksOff}, ${nm(ret)} returns it ${res.returnYds} yards to the ${fieldLabel(end, tr, tk)}.`;
      this.runClock(clamp(4 + res.returnYds * 0.12, 4, 9));
      if (res.foul) text += ` ${this.returnFoulText(res, rSide, kSide)}`;
      this.setPossession(rSide, res.ballOn);
    }
    this.addLog(text, 'kick');
    this.finishNext();
    return { text, headline, kind: 'kickoff', res, kSide, rSide, from: fromYard, returner: ret, next: this.next };
  },

  punt() {
    this.untimed = false; // (an untimed down is played once)
    const side = this.poss;
    const opp = other(side);
    const p = this.punter(side);
    const ret = this.returner(opp);
    const startBall = this.ballOn;
    const res = K.punt(p, ret, startBall, this.rng, this.kickCtx(side));
    const l = this.stats.line(p, side);
    l.punt.n++;
    l.punt.yds += res.gross;
    this.stats.team[side].plays++;
    this.runClock(res.type === 'return' ? 8 + res.returnYds * 0.1 : 6);
    const tr = this.teams[opp].abbr;
    const tk = this.teams[side].abbr;
    let text;
    let headline = null;
    if (res.type === 'blocked') {
      text = 'PUNT BLOCKED!';
      headline = 'Blocked!';
      this.changePossession(res.ballOn);
    } else if (res.type === 'touchback') {
      text = `${nm(p)} punts ${res.gross} yards into the end zone. Touchback.`;
      this.changePossession(20);
    } else if (res.type === 'downed') {
      text = `${nm(p)} punts ${res.gross} yards, downed at the ${tr} ${res.landing >= 100 ? 1 : 100 - res.landing}.`;
      this.changePossession(res.ballOn);
    } else if (res.type === 'oob') {
      text = `${nm(p)} punts ${res.gross} yards, out of bounds at the ${fieldLabel(res.ballOn, tr, tk)}.`;
      this.changePossession(res.ballOn);
    } else if (res.type === 'fair') {
      text = `${nm(p)} punts ${res.gross} yards, fair catch by ${nm(ret)}.`;
      this.changePossession(res.ballOn);
    } else if (res.type === 'muff') {
      text = `${nm(p)} punts ${res.gross} yards — MUFFED! ${tk} recovers.`;
      headline = 'Muffed punt!';
      this.ballOn = clamp(res.ballOn, 1, 99);
      this.down = 1;
      this.ltg = Math.min(this.ballOn + 10, 100);
      this.clockRunning = false;
    } else if (res.type === 'td') {
      text = `${nm(ret)} returns the punt ${res.returnYds} yards for a TOUCHDOWN!`;
      headline = 'Punt return touchdown!';
      this.changePossession(99);
      this.addScore(opp, 6);
      this.addLog(text, 'score');
      if (!this.otScore(opp, 'td')) this.startPat(opp);
      this.finishNext();
      return { text, headline, kind: 'punt', res, side, next: this.next, startBall };
    } else {
      text = (res.runEnd ?? 0) >= 100 ? `${nm(p)} punts ${res.gross} yards, ${nm(ret)} takes it all the way —` : `${nm(p)} punts ${res.gross} yards, ${nm(ret)} returns ${res.returnYds}.`;
      if (res.foul) text += ` ${this.returnFoulText(res, opp, side)}`;
      this.changePossession(res.ballOn);
    }
    this.addLog(text, 'kick');
    this.finishNext();
    return { text, headline, kind: 'punt', res, side, next: this.next, startBall };
  },

  // A flag on a return (src/game/kicks.js withReturnFoul): the text, and the
  // penalty on the books. rSide returned it, kSide kicked.
  returnFoulText(res, rSide, kSide) {
    const f = res.foul;
    const on = f.on === 'R' ? rSide : kSide;
    this.stats.team[on].penalties++;
    this.stats.team[on].penYds += f.yards;
    const tr = this.teams[rSide].abbr;
    const tk = this.teams[kSide].abbr;
    const where = `ball at the ${fieldLabel(res.ballOn, tr, tk)}`;
    f.side = on;
    const t = f.on === 'R'
      ? `FLAG: ${f.name}, ${tr}. ${f.yards < 10 ? 'Half the distance' : '10 yards'} from ${f.kickEnd ? 'the end of the kick' : 'the spot of the foul'}${(res.runEnd ?? 0) >= 100 ? ': the touchdown comes back' : ''}, ${where}.`
      : `FLAG: ${f.name}, ${tk}. ${f.yards} yards from the end of the run, ${where}.`;
    f.text = t.replace(/^FLAG: /, '');
    return t;
  },

  fieldGoal() {
    this.untimed = false;
    const side = this.poss;
    const k = this.kicker(side);
    const startBall = this.ballOn;
    const res = K.fieldGoal(k, startBall, this.rng, this.kickCtx(side));
    const l = this.stats.line(k, side);
    l.kick.fga++;
    this.stats.team[side].plays++;
    this.runClock(4);
    let text;
    let headline;
    if (res.good) {
      l.kick.fgm++;
      l.kick.long = Math.max(l.kick.long, res.distance);
      text = `${nm(k)} ${res.distance}-yard field goal is GOOD.`;
      headline = 'Field goal!';
      this.addScore(side, 3);
      this.addLog(text, 'score');
      if (!this.otScore(side, 'fg')) {
        this.kickingSide = side;
        this.phase = 'kickoff';
      }
    } else {
      text = res.blocked ? `${nm(k)} ${res.distance}-yard attempt is BLOCKED!` : `${nm(k)} ${res.distance}-yard field goal is NO GOOD (${res.miss}).`;
      headline = res.blocked ? 'Blocked!' : 'No good';
      this.addLog(text, 'kick');
      const kickSpot = startBall - 7;
      this.changePossession(Math.max(20, 100 - kickSpot));
    }
    this.finishNext();
    return { text, headline, kind: 'fg', res, side, next: this.next, startBall, anim: { type: 'fg', distance: res.distance, good: res.good, miss: res.miss, angle: res.angle, op: res.op, doink: res.doink } };
  },
};
