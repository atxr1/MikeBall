// Game rules state machine: downs, clock, scoring, kicks, penalties, overtime
// (kickoffs, punts and field goals in ./kicking.js, flags in ./penalties.js).
// No DOM. The coach screen drives it like this:
//
//   game.next === 'call'      -> both sides pick plays, then:
//     game.snap()             -> may end the quarter before the play
//     game.preSnapPenalty()   -> may flag before the play
//     (run the PlaySim)       -> game.applyPlay(result, offPlay, defPlay)
//   game.next === 'pat'       -> game.extraPoint() or a 2-pt play + game.applyTwoPoint()
//   game.next === 'kickoff'   -> game.kickoff(onside)
//   game.next === 'endQuarter'-> game.endQuarter()
//   game.next === 'final'

import { makeRng } from '../core/rng.js';
import { HASH_L, HASH_R, MID_X, clamp, ordinal, fmtClock, fieldLabel } from '../core/util.js';
import * as K from './kicks.js';
import { StatBook } from './stats.js';
import { describe, nm } from './commentary.js';
import { starter, rosterIndex } from './personnel.js';
import { penaltyMethods } from './penalties.js';
import { kickingMethods } from './kicking.js';

export const other = (s) => (s === 'home' ? 'away' : 'home');
const TEMPO_RUNOFF = { hurry: 13, normal: 36, milk: 39 };

export class Game {
  constructor({ homeTeam, awayTeam, homeRoster, awayRoster, userSide = 'home', qLen = 8, seed = 1 }) {
    this.teams = { home: homeTeam, away: awayTeam };
    this.rosters = { home: homeRoster, away: awayRoster };
    this.userSide = userSide;
    this.qLen = qLen;
    this.seed = seed;
    this.rng = makeRng(seed);
    this.score = { home: 0, away: 0 };
    this.qScores = { home: [0, 0, 0, 0], away: [0, 0, 0, 0] };
    this.quarter = 1;
    this.clock = qLen * 60;
    this.timeouts = { home: 3, away: 3 };
    this.challenges = { home: 2, away: 2 };
    this.poss = 'home';
    this.ballOn = 25;
    this.ballX = MID_X;
    this.down = 1;
    this.ltg = 35;
    this.clockRunning = false;
    this.shortRunoff = false;
    this.warned = false;
    // Play clock (NFL Rule 4-6): 40 s from the end of a play, 25 s after an
    // administrative stoppage (change of possession, timeout, two-minute
    // warning, new period, penalty, a score).
    this.playClock = 25;
    this.pcStart = 25;
    this.pcRunoff = 0;
    this.pcShort = false;
    this.log = [];
    this.stats = new StatBook();
    this.ot = null;
    this.over = false;
    this.top = { home: 0, away: 0 };
    this.drive = null;
    this.patSide = null;
    this.freeKick = false;
    // Coin toss: the winner receives; the other team receives the second half.
    this.firstReceiver = this.rng.chance(0.5) ? 'home' : 'away';
    this.kickingSide = other(this.firstReceiver);
    this.coinTossWinner = this.firstReceiver;
    this.phase = 'kickoff';
    this.next = 'kickoff';
  }

  // ------------------------------------------------------------ queries
  get offense() { return this.poss; }
  get defense() { return other(this.poss); }
  toGo() { return Math.max(0, this.ltg - this.ballOn); }
  goalToGo() { return this.ltg >= 100; }
  team(side) { return this.teams[side]; }

  downText() {
    const tg = this.goalToGo() ? 'Goal' : this.toGo() < 1 ? 'Inches' : Math.round(this.toGo());
    return `${ordinal(this.down)} & ${tg}`;
  }

  spotText() {
    const o = this.teams[this.poss].abbr;
    const d = this.teams[this.defense].abbr;
    return fieldLabel(this.ballOn, o, d);
  }

  quarterText() {
    return this.quarter <= 4 ? `Q${this.quarter}` : 'OT';
  }

  inLateWindow() {
    return (this.quarter === 2 && this.clock <= 120) || (this.quarter >= 4 && this.clock <= 300);
  }

  situation(side) {
    const opp = other(side);
    return {
      offense: this.poss === side,
      down: this.down,
      toGo: this.toGo(),
      ballOn: this.ballOn,
      goalToGo: this.goalToGo(),
      quarter: this.quarter,
      clock: this.clock,
      diff: this.score[side] - this.score[opp],
      timeouts: this.timeouts[side],
      oppTimeouts: this.timeouts[opp],
      clockRunning: this.clockRunning,
      fgDistance: K.fgDistance(this.ballOn),
    };
  }

  kicker(side) { return starter(this.rosters[side], 'K'); }
  punter(side) { return starter(this.rosters[side], 'P'); }
  returner(side) {
    const r = this.rosters[side];
    const cands = [starter(r, 'WR', 3), starter(r, 'RB', 1), starter(r, 'CB', 2), starter(r, 'WR', 2)].filter(Boolean);
    return cands.sort((a, b) => b.attrs.spd + b.attrs.elu * 0.3 - (a.attrs.spd + a.attrs.elu * 0.3))[0];
  }

  // Who's on the field for a kick, for the kick odds (src/game/kicks.js).
  kickCtx(side) {
    const opp = other(side);
    const avg = (list, k) => (list.length ? list.reduce((t, p) => t + p.attrs[k], 0) / list.length : 70);
    const rushers = [0, 1, 2].map((i) => starter(this.rosters[opp], 'DL', i)).concat([0, 1].map((i) => starter(this.rosters[opp], 'EDGE', i))).filter(Boolean);
    const line = [0, 1, 2, 3, 4].map((i) => starter(this.rosters[side], 'OL', i)).filter(Boolean);
    const cover = [starter(this.rosters[side], 'CB', 2), starter(this.rosters[side], 'CB', 3), starter(this.rosters[side], 'WR', 4), starter(this.rosters[side], 'S', 2)].filter(Boolean);
    const jam = [starter(this.rosters[opp], 'CB', 2), starter(this.rosters[opp], 'CB', 3)].filter(Boolean);
    const diff = Math.abs(this.score.home - this.score.away);
    const late = this.quarter >= 4 && this.clock <= 120 ? 1 : this.quarter >= 4 && this.clock <= 300 ? 0.5 : 0;
    return {
      ballX: this.ballX,
      rush: avg(rushers, 'prs'),
      pro: avg(line, 'pbk'),
      holder: this.punter(side),
      clutch: diff <= 3 ? late : diff <= 7 ? late * 0.4 : 0,
      gunner: cover.sort((a, b) => b.attrs.spd - a.attrs.spd)[0] || null,
      jammer: jam.sort((a, b) => b.attrs.mcv - a.attrs.mcv)[0] || null,
    };
  }

  tempoFor(side) {
    const diff = this.score[side] - this.score[other(side)];
    if (this.quarter === 2 && this.clock <= 120) return 'hurry';
    if (this.quarter >= 4) {
      if (diff < 0 && this.clock <= 330) return 'hurry';
      if (diff > 0 && this.clock <= 420) return 'milk';
    }
    return 'normal';
  }

  // ------------------------------------------------------------ logging / scoring
  addLog(text, kind = 'play', extra = {}) {
    const entry = { q: this.quarter, clock: this.clock, side: this.poss, text, kind, ...extra };
    this.log.push(entry);
    return entry;
  }

  addScore(side, pts) {
    this.pcShort = true;
    this.score[side] += pts;
    const qi = Math.min(this.quarter, 5) - 1;
    while (this.qScores[side].length <= qi) { this.qScores.home.push(0); this.qScores.away.push(0); }
    this.qScores[side][qi] += pts;
  }

  addTop(sec) {
    if (sec > 0) {
      this.top[this.poss] += sec;
      this.stats.team[this.poss].top += sec;
    }
  }

  runClock(sec) {
    const before = this.clock;
    this.clock = Math.max(0, this.clock - sec);
    this.addTop(before - this.clock);
    if ((this.quarter === 2 || this.quarter === 4) && !this.warned && before > 120 && this.clock <= 120) {
      this.warned = true;
      this.clockRunning = false;
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ play clock / snap
  resetPlayClock(sec) {
    this.playClock = sec;
    this.pcStart = sec;
    this.pcRunoff = 0;
  }

  // Play-clock reading when `side` snaps the ball at its tempo: hurry-up
  // offenses snap early, teams milking the clock snap at the last second.
  snapAt(side) {
    return Math.max(1, this.pcStart - TEMPO_RUNOFF[this.tempoFor(side)]);
  }

  // Let `sec` seconds pass between plays. The play clock always runs; the
  // game clock runs with it when it's running. Returns events:
  // 'twoMinute', 'endQuarter', 'delay' (play clock hit zero).
  tickBetweenPlays(sec) {
    const events = [];
    sec = Math.max(0, Math.min(sec, this.playClock));
    this.playClock -= sec;
    if (this.clockRunning && sec > 0) {
      // after going out of bounds the clock restarts when the ball is set,
      // so only part of the play clock runs off the game clock
      const run = this.shortRunoff ? Math.max(0, Math.min(sec, 9 - this.pcRunoff)) : sec;
      if (run > 0) {
        this.pcRunoff += run;
        const before = this.clock;
        const after = before - run;
        if ((this.quarter === 2 || this.quarter === 4) && !this.warned && before > 120 && after <= 120) {
          this.addTop(before - 120);
          this.clock = 120;
          this.warned = true;
          this.clockRunning = false;
          this.resetPlayClock(25);
          events.push('twoMinute');
          this.addLog('Two-minute warning.', 'info');
        } else if (after <= 0) {
          this.addTop(before);
          this.clock = 0;
          this.clockRunning = false;
          this.next = 'endQuarter';
          events.push('endQuarter');
        } else {
          this.clock = after;
          this.addTop(run);
        }
      }
    }
    if (this.playClock <= 0 && !events.length) events.push('delay');
    return events;
  }

  // The snap: runs the play clock (and the game clock, if running) down to
  // `at`, by default the offense's tempo. Returns {stop, events}.
  snap(at = this.snapAt(this.poss)) {
    const events = [];
    if (this.playClock > at) {
      const ev = this.tickBetweenPlays(this.playClock - at);
      if (ev.includes('endQuarter')) return { stop: true, events: ['endQuarter'] };
      if (ev.includes('twoMinute')) events.push('twoMinute');
    }
    this.shortRunoff = false;
    return { stop: false, events };
  }

  // Play clock ran out before the snap: 5 yards, replay the down.
  useTimeout(side) {
    if (this.timeouts[side] <= 0 || this.over) return false;
    this.timeouts[side]--;
    this.clockRunning = false;
    this.resetPlayClock(25);
    this.addLog(`Timeout ${this.teams[side].abbr} (${this.timeouts[side]} left).`, 'info', { side });
    return true;
  }

  // ------------------------------------------------------------ plays
  // r: PlaySim result. Returns an outcome summary for the UI.
  applyPlay(r, offPlay, defPlay) {
    const off = this.poss;
    const def = other(off);
    const startBall = this.ballOn;
    const ballXBefore = this.ballX;
    const playTime = r.kind === 'kneel' ? 1.5 : r.kind === 'spike' ? 1 : r.elapsed * 1.4 + 1.2;
    const warned = this.runClock(playTime);
    const out = { text: describe(r, ballXBefore), kind: 'play', yards: 0, flags: [] };

    // Penalties that wipe out the play (or are added to the end of it)
    const pen = this.choosePenalty(r);
    if (pen && (pen.mode === 'replace' || pen.mode === 'offset')) {
      if (pen.mode === 'offset') {
        pen.text = `Offsetting fouls. Replay ${ordinal(this.down)} down.`;
        this.pcShort = true;
        this.addLog(`FLAG: ${pen.text}`, 'penalty');
      } else this.enforce(pen);
      if (pen.late) {
        // and the late hit after the whistle, from there
        this.enforce(pen.late);
        pen.text += ` ${pen.late.text}`;
      }
      // the clock does what it would have done after the play (Rule 4-3-2)
      const wouldRun = !r.incomplete && !r.outOfBounds && !r.turnover && !r.td && !r.safety && !warned;
      this.clockAfterFoul(wouldRun);
      if (pen.on === this.poss && !r.incomplete) {
        const ro = this.runoff(pen.on, wouldRun);
        if (ro) pen.text += ` ${ro}-second runoff.`;
      }
      out.penalty = pen;
      out.text = `${out.text} — FLAG: ${pen.text}`;
      out.kind = 'penalty';
      out.headline = 'Flag';
      this.finishNext();
      return out;
    }
    const dec = pen && pen.mode === 'declined' ? pen : pen && pen.declinedLive;
    if (dec) {
      out.declined = dec;
      out.text = `${out.text} ${dec.name} on ${this.teams[dec.on].abbr}, declined.`;
      this.addLog(`FLAG: ${dec.name} on ${this.teams[dec.on].abbr}, declined.`, 'penalty');
    }

    this.recordStats(r, off, def);
    const gain = r.yards;
    let entryText = out.text;

    if (r.turnover) {
      this.stats.team[off].turnovers++;
      const absSpot = startBall + r.spotY;
      if (r.defTD) {
        out.kind = 'defTD';
        out.headline = 'Pick six!';
        if (r.fumble) out.headline = 'Scoop and score!';
        this.poss = def;
        this.addScore(def, 6);
        this.addLog(entryText, 'score');
        this.clockRunning = false;
        if (this.otScore(def, 'td')) return this.finishOut(out);
        this.startPat(def);
        return this.finishOut(out);
      }
      out.kind = 'turnover';
      out.headline = r.interception ? 'Intercepted!' : 'Fumble!';
      let newBall = r.touchback ? 20 : clamp(Math.round(100 - absSpot), 1, 99);
      this.addLog(entryText, 'turnover');
      this.changePossession(newBall, clamp(r.spotX, HASH_L, HASH_R));
      return this.finishOut(out);
    }

    if (r.safety) {
      out.kind = 'safety';
      out.headline = 'Safety!';
      this.addScore(def, 2);
      this.addLog(entryText, 'score');
      this.clockRunning = false;
      if (this.otScore(def, 'safety')) return this.finishOut(out);
      this.kickingSide = off;
      this.freeKick = true;
      this.phase = 'kickoff';
      this.next = 'kickoff';
      return this.finishOut(out);
    }

    if (r.td) {
      this.stats.team[off].yards += 100 - startBall;
      this.ballOn = 100;
      out.kind = 'td';
      out.headline = 'Touchdown!';
      this.addScore(off, 6);
      this.addLog(entryText, 'score');
      this.clockRunning = false;
      if (this.otScore(off, 'td')) return this.finishOut(out);
      this.startPat(off);
      return this.finishOut(out);
    }

    // Normal play
    let newBall = clamp(startBall + Math.round(r.spotY), 1, 99);
    this.stats.team[off].yards += newBall - startBall;
    if (pen && pen.mode === 'after') {
      // 15 more from the end of the play, and a fresh set of downs
      const y = Math.min(pen.yards, Math.floor((100 - newBall) / 2));
      newBall = Math.min(99, newBall + y);
      this.stats.team[def].penalties++;
      this.stats.team[def].penYds += y;
      const dist = y < pen.yards ? 'Half the distance to the goal' : `${y} yards`;
      pen.text = `${pen.name}, ${this.teams[def].abbr}. ${dist} from the end of the play, automatic first down.`;
      out.penalty = pen;
      out.text = `${out.text} — FLAG: ${pen.text}`;
      this.addLog(`FLAG: ${pen.text}`, 'penalty');
      this.pcShort = true;
    }
    out.yards = newBall - startBall;
    if (!r.incomplete) this.ballX = clamp(r.spotX, HASH_L, HASH_R);
    this.ballOn = newBall;
    const thirdDown = this.down === 3;
    if (thirdDown) this.stats.team[off].thirdAtt++;
    if (this.ballOn >= this.ltg || (pen && pen.mode === 'after')) {
      this.down = 1;
      this.ltg = Math.min(this.ballOn + 10, 100);
      out.kind = 'firstDown';
      out.headline = 'First down';
      this.stats.team[off].firstDowns++;
      if (thirdDown) this.stats.team[off].thirdConv++;
    } else if (this.down >= 4) {
      out.kind = 'downs';
      out.headline = 'Turnover on downs';
      this.addLog(entryText, 'turnover');
      this.changePossession(100 - this.ballOn, this.ballX);
      return this.finishOut(out);
    } else {
      this.down++;
    }

    // Clock status after the play
    if (r.incomplete) this.clockRunning = false;
    else if (pen && pen.mode === 'after') this.clockAfterFoul(!r.outOfBounds && !warned);
    else if (r.outOfBounds) {
      if (this.inLateWindow()) this.clockRunning = false;
      else { this.clockRunning = true; this.shortRunoff = true; }
    } else this.clockRunning = !warned;
    if (warned) {
      out.flags.push('twoMinute');
      this.pcShort = true;
    }

    this.addLog(entryText, 'play');
    return this.finishOut(out);
  }

  finishOut(out) {
    this.finishNext();
    out.next = this.next;
    return out;
  }

  finishNext() {
    this.resetPlayClock(this.pcShort ? 25 : 40);
    this.pcShort = false;
    if (this.over) this.next = 'final';
    else if (this.phase === 'pat') this.next = 'pat';
    else if (this.clock <= 0) this.next = 'endQuarter';
    else if (this.phase === 'kickoff') this.next = 'kickoff';
    else this.next = 'call';
  }

  recordStats(r, off, def) {
    const S = this.stats;
    const T = S.team[off];
    T.plays++;
    if (r.kind === 'run' || r.kind === 'scramble' || r.kind === 'kneel') {
      const l = S.line(r.rusher || r.passer, off);
      if (l) {
        l.rush.att++;
        l.rush.yds += r.td ? 100 - this.ballOn : r.yards;
        if (r.td) l.rush.td++;
        l.rush.long = Math.max(l.rush.long, r.yards);
      }
      T.rushYds += r.td ? 100 - this.ballOn : r.yards;
    } else if (r.kind === 'pass' || r.kind === 'spike') {
      const qb = S.line(r.passer, off);
      if (qb) qb.pass.att++;
      if (r.target && r.kind === 'pass') S.line(r.target, off).rec.tgt++;
      if (r.interception) {
        if (qb) qb.pass.int++;
        const d = S.line(r.interceptor, def);
        if (d) d.def.int++;
      } else if (!r.incomplete && r.receiver) {
        const y = r.td ? 100 - this.ballOn : r.yards;
        if (qb) { qb.pass.comp++; qb.pass.yds += y; qb.pass.long = Math.max(qb.pass.long, y); if (r.td) qb.pass.td++; }
        const rc = S.line(r.receiver, off);
        rc.rec.rec++;
        rc.rec.yds += y;
        rc.rec.long = Math.max(rc.rec.long, y);
        if (r.td) rc.rec.td++;
        T.passYds += y;
      } else if (r.why === 'broken up' && r.defender) {
        S.line(r.defender, def).def.pbu++;
      }
    } else if (r.kind === 'sack') {
      const qb = S.line(r.passer, off);
      if (qb) qb.pass.sacked++;
      const t = S.line(r.tackler, def);
      if (t) t.def.sacks++;
      S.team[def].sacks++;
      T.passYds += r.yards;
    }
    if (r.tackler && r.kind !== 'sack') {
      const tl = S.line(r.tackler, r.turnover ? off : def);
      if (tl) tl.def.tkl++;
    }
    if (r.fumble?.forcedBy) {
      const f = S.line(r.fumble.forcedBy, def);
      if (f) f.def.ff++;
    }
  }

  changePossession(newBallOn, ballX = MID_X) {
    const prev = this.poss;
    this.poss = other(prev);
    this.ballOn = clamp(Math.round(newBallOn), 1, 99);
    this.ballX = ballX;
    this.down = 1;
    this.ltg = Math.min(this.ballOn + 10, 100);
    this.clockRunning = false;
    this.pcShort = true;
    this.phase = 'play';
    this.otPossession(this.poss);
  }

  startPat(side) {
    this.poss = side;
    this.patSide = side;
    this.phase = 'pat';
    this.ballOn = 85;
    this.ballX = MID_X;
    // Skip the try when it can't change the result at the end of regulation.
    const diff = Math.abs(this.score.home - this.score.away);
    if (this.quarter >= 4 && this.clock <= 0 && diff > 2) {
      this.phase = 'kickoff';
      this.kickingSide = side;
    }
  }

  // ------------------------------------------------------------ special teams
  extraPoint() {
    const side = this.patSide;
    const k = this.kicker(side);
    const res = K.extraPoint(k, this.rng, this.kickCtx(side));
    const l = this.stats.line(k, side);
    l.kick.xpa++;
    const text = res.good ? `${nm(k)} extra point is GOOD.` : res.blocked ? `${nm(k)} extra point is BLOCKED.` : `${nm(k)} extra point is NO GOOD (${res.miss}).`;
    if (res.good) { l.kick.xpm++; this.addScore(side, 1); }
    this.addLog(text, 'score');
    this.afterTry(side);
    return { text, side, good: res.good, kind: 'pat', headline: res.good ? 'Good!' : 'No good', next: this.next, anim: { type: 'fg', distance: 33, good: res.good, miss: res.miss, angle: res.angle, op: res.op, doink: res.doink }, res };
  }

  // r: PlaySim result run from the 2.
  applyTwoPoint(r) {
    const side = this.patSide;
    const good = r.td && !r.turnover;
    let text = good ? `Two-point try is GOOD! ${describe(r)}` : `Two-point try fails. ${describe(r)}`;
    if (good) this.addScore(side, 2);
    if (r.defTD) {
      this.addScore(other(side), 2);
      text = 'Two-point try returned by the defense for 2!';
    }
    this.addLog(text, 'score');
    this.afterTry(side);
    return { text, good, kind: 'twoPoint', headline: good ? 'Two-point try good!' : 'No good', next: this.next };
  }

  afterTry(side) {
    this.patSide = null;
    if (this.otAfterTry(side)) { this.finishNext(); return; }
    this.kickingSide = side;
    this.phase = 'kickoff';
    this.finishNext();
  }

  setPossession(side, ballOn) {
    this.poss = side;
    this.ballOn = clamp(Math.round(ballOn), 1, 99);
    this.ballX = MID_X;
    this.down = 1;
    this.ltg = Math.min(this.ballOn + 10, 100);
    this.clockRunning = false;
    this.pcShort = true;
    this.phase = 'play';
    this.otPossession(side);
  }

  // ------------------------------------------------------------ periods
  endQuarter() {
    const q = this.quarter;
    this.pcShort = true;
    if (q === 1 || q === 3) {
      this.quarter++;
      this.clock = this.qLen * 60;
      this.clockRunning = false;
      this.shortRunoff = false;
      this.addLog(`End of ${ordinal(q)} quarter.`, 'info');
      this.finishNext();
      return { kind: 'quarter', text: `End of the ${ordinal(q)} quarter` };
    }
    if (q === 2) {
      this.quarter = 3;
      this.clock = this.qLen * 60;
      this.timeouts = { home: 3, away: 3 };
      this.warned = false;
      this.kickingSide = this.firstReceiver;
      this.phase = 'kickoff';
      this.patSide = null;
      this.addLog('Halftime.', 'info');
      this.finishNext();
      return { kind: 'half', text: 'Halftime' };
    }
    if (q === 4) {
      if (this.score.home !== this.score.away) return this.finish();
      this.quarter = 5;
      this.clock = 600;
      this.timeouts = { home: 2, away: 2 };
      this.warned = true;
      const recv = this.rng.chance(0.5) ? 'home' : 'away';
      this.kickingSide = other(recv);
      this.phase = 'kickoff';
      this.ot = { stage: 'first', first: recv, second: other(recv) };
      this.addLog(`Overtime! ${this.teams[recv].abbr} wins the toss and will receive.`, 'info');
      this.finishNext();
      return { kind: 'ot', text: 'Overtime' };
    }
    return this.finish();
  }

  finish() {
    this.over = true;
    this.next = 'final';
    this.phase = 'final';
    const h = this.score.home;
    const a = this.score.away;
    const text = h === a ? 'Final — tie game' : `Final — ${this.teams[h > a ? 'home' : 'away'].city} wins`;
    this.addLog(text, 'info');
    return { kind: 'final', text };
  }

  // ------------------------------------------------------------ overtime
  // Called after points are added. Returns true if the game ended.
  otScore(side, how) {
    const ot = this.ot;
    if (!ot) return false;
    const lead = this.score[side] - this.score[other(side)];
    if (ot.stage === 'sudden') { this.finish(); return true; }
    if (ot.stage === 'first') {
      if (side !== ot.first) { this.finish(); return true; } // defense scored on the opening drive
      return false;
    }
    // stage 'second': team B has the ball
    if (side !== ot.second) { this.finish(); return true; }
    if (lead > 0) { this.finish(); return true; }
    if (how === 'fg') {
      if (lead === 0) { ot.stage = 'sudden'; this.kickingSide = side; this.phase = 'kickoff'; return false; }
      this.finish();
      return true;
    }
    return false; // TD that ties or trails: go to the try
  }

  otAfterTry(side) {
    const ot = this.ot;
    if (!ot || ot.stage !== 'second' || side !== ot.second) return false;
    const lead = this.score[side] - this.score[other(side)];
    if (lead !== 0) { this.finish(); return true; }
    ot.stage = 'sudden';
    return false;
  }

  otPossession(newPoss) {
    const ot = this.ot;
    if (!ot || this.over) return;
    if (ot.stage === 'first' && newPoss === ot.second) {
      if (ot.started) ot.stage = 'second';
      else ot.started = true;
      return;
    }
    if (ot.stage === 'first' && newPoss === ot.first) { ot.started = true; return; }
    if (ot.stage === 'second' && newPoss === ot.first) {
      if (this.score.home !== this.score.away) this.finish();
      else ot.stage = 'sudden';
    }
  }
}

Object.assign(Game.prototype, penaltyMethods, kickingMethods);
