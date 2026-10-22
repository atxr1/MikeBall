// Penalties, mixed into Game (src/game/rules.js): pre-snap fouls, the
// accept/decline choice for fouls that happened on a play (src/sim/fouls.js),
// enforcement (half the distance to the goal, automatic first downs, spot
// fouls, the end of the play), double fouls, the clock after a foul and the
// 10-second runoff, delay of game, and where the umpire lines up.

import { ordinal } from '../core/util.js';

const other = (s) => (s === 'home' ? 'away' : 'home');

export const penaltyMethods = {
  // Since 2010 the umpire lines up in the offensive backfield (inside the 5
  // too, since 2015), except in the last two minutes of the first half and
  // the last five of the second.
  umpireOnDefense() {
    return (this.quarter === 2 && this.clock <= 120) || (this.quarter >= 4 && this.clock <= 300);
  },

  // Rule 4-3-2: after a foul the clock starts again as if it hadn't
  // happened — except late in each half, where it waits for the snap, and
  // after an offense's foul before the snap in the fourth quarter or
  // overtime (4-3-2(e), so it can't burn clock with false starts). After
  // the two-minute warning a defensive foul before the snap lets the
  // offense choose; a team that's ahead takes the running clock.
  clockAfterFoul(wasRunning, preSnapBy = null) {
    if (preSnapBy === this.poss && this.quarter >= 4) { this.clockRunning = false; return; }
    if (preSnapBy && preSnapBy !== this.poss && this.inLateWindow() && this.score[this.poss] > this.score[preSnapBy]) {
      this.clockRunning = wasRunning;
      return;
    }
    this.clockRunning = wasRunning && !this.inLateWindow();
  },

  // Rule 4-7-1: inside the last two minutes of a half, an offensive foul
  // between plays that stops a running clock (false start, delay of game)
  // costs 10 more seconds. Fouls during a play don't (the 10 seconds after
  // any offensive foul is the college rule). Returns the runoff.
  // (The offense could take a timeout instead; not modeled.)
  // The clock then starts on the ready-for-play signal. Call it after
  // clockAfterFoul.
  runoff(side, wasRunning) {
    if (side !== this.poss || !wasRunning) return 0;
    if (!((this.quarter === 2 || this.quarter === 4) && this.clock <= 120)) return 0;
    const sec = Math.min(10, this.clock);
    this.runClock(sec);
    this.clockRunning = this.clock > 0;
    return sec;
  },

  delayOfGame() {
    const was = this.clockRunning;
    const pen = { name: 'Delay of game', key: 'delay', on: this.poss, yards: 5, signal: 'delay' };
    this.enforce(pen);
    this.clockAfterFoul(was, this.poss);
    const ro = this.runoff(this.poss, was);
    if (ro) pen.text += ` ${ro}-second runoff.`;
    this.finishNext();
    return pen;
  },

  // Pre-snap fouls. Returns null or a penalty. A false start, encroachment
  // or neutral zone infraction kills the play (enforced here); offside is
  // called at the snap and the play goes on (live: true, a free play for
  // the offense; the sim flags it and the offense takes the better of the
  // two).
  preSnapPenalty() {
    const r = this.rng;
    let pen = null;
    if (r.chance(0.015)) pen = { name: 'False start', key: 'falseStart', on: this.poss, yards: 5, signal: 'falseStart' };
    else if (r.chance(0.0025)) return { name: 'Illegal formation', key: 'formation', on: this.poss, yards: 5, signal: 'falseStart', live: true };
    else if (r.chance(0.011)) {
      const k = r.pick(['offside', 'offside', 'offside', 'encroach', 'neutral']);
      pen = { name: { offside: 'Offside', encroach: 'Encroachment', neutral: 'Neutral zone infraction' }[k], key: k, on: this.defense, yards: 5, signal: 'offside' };
    }
    if (!pen) return null;
    if (pen.key === 'offside') return { ...pen, live: true };
    const was = this.clockRunning;
    this.enforce(pen);
    this.clockAfterFoul(was, pen.on);
    const ro = this.runoff(pen.on, was);
    if (ro) pen.text += ` ${ro}-second runoff.`;
    return pen;
  },

  enforce(pen) {
    this.pcShort = true;
    const team = this.teams[pen.on].abbr;
    this.stats.team[pen.on].penalties++;
    if (pen.on === this.poss && pen.lossOfDown) {
      // Rule 8-2-1: 10 yards from the previous spot, or at the spot of the
      // foul if that's farther back, and loss of down; thrown from his own
      // end zone, a safety
      const spotBack = Math.max(0, Math.round(-(pen.spotY || 0)));
      if (this.ballOn - spotBack <= 0) {
        pen.safety = true;
        pen.text = `${pen.name}, ${team}, in the end zone. Safety.`;
        this.addLog(`FLAG: ${pen.text}`, 'penalty');
        return;
      }
      const y = spotBack > pen.yards ? spotBack : Math.min(pen.yards, Math.floor(this.ballOn / 2));
      this.ballOn -= y;
      this.stats.team[pen.on].penYds += y;
      this.down++;
      const where = spotBack > pen.yards ? 'At the spot of the foul' : y < pen.yards ? 'Half the distance to the goal' : `${y} yards`;
      if (this.down > 4) {
        pen.downs = true;
        pen.text = `${pen.name}, ${team}. ${where} and loss of down: turnover on downs.`;
      } else pen.text = `${pen.name}, ${team}. ${where} and loss of down, ${ordinal(this.down)} down.`;
      this.addLog(`FLAG: ${pen.text}`, 'penalty');
      return;
    }
    if (pen.on === this.poss) {
      const half = Math.floor(this.ballOn / 2);
      const y = Math.min(pen.yards, half);
      this.ballOn -= y;
      this.stats.team[pen.on].penYds += y;
      pen.text = y < pen.yards ? `${pen.name}, ${team}. Half the distance to the goal, replay ${ordinal(this.down)} down.` : `${pen.name}, ${team}. ${y} yards, replay ${ordinal(this.down)} down.`;
    } else {
      let newBall;
      let halfway = false;
      if (pen.spot != null) newBall = Math.min(99, this.ballOn + pen.spot);
      else {
        const half = Math.floor((100 - this.ballOn) / 2);
        halfway = half < pen.yards;
        newBall = this.ballOn + Math.min(pen.yards, half);
      }
      this.stats.team[pen.on].penYds += newBall - this.ballOn;
      this.ballOn = newBall;
      const dist = halfway ? 'Half the distance to the goal' : pen.spot != null ? 'Spot foul' : `${pen.yards} yards`;
      if (pen.auto1st || this.ballOn >= this.ltg) {
        this.down = 1;
        this.ltg = Math.min(this.ballOn + 10, 100);
        pen.text = `${pen.name}, ${team}. ${dist}, ${pen.auto1st ? 'automatic first down' : 'first down'}.`;
      } else pen.text = `${pen.name}, ${team}. ${dist}, replay ${ordinal(this.down)} down.`;
    }
    this.addLog(`FLAG: ${pen.text}`, 'penalty');
  },

  // Which flag (if any) the other team takes, from the fouls that happened
  // on the play (src/sim/fouls.js). Returns null, or a penalty with
  // mode 'replace' (the play doesn't count), 'after' (added to the end of
  // the play), 'offset' (fouls by both teams: replay the down) or
  // 'declined'. A dead-ball foul after the whistle rides along as `late`
  // (enforced after the replay) or comes back as mode 'after'.
  choosePenalty(r) {
    const all = (r.fouls || []).filter((f) => !f.dead);
    if (!all.length) return null;
    // dead-ball fouls after the whistle are enforced on their own, after
    // whatever happened on the play (Rule 14-1)
    const late = all.find((f) => f.deadBall);
    const res = this.choosePlayFoul(r, all.filter((f) => !f.deadBall));
    if (!late || r.td || r.safety || r.turnover) return res;
    const lp = { name: late.name, on: other(this.poss), yards: late.yards, auto1st: true, player: late.player, signal: late.signal, key: late.key };
    if (res && (res.mode === 'replace' || res.mode === 'offset' || res.mode === 'after')) return { ...res, late: lp };
    return { mode: 'after', ...lp, deadBall: true, declinedLive: res && res.mode === 'declined' ? res : null };
  },

  choosePlayFoul(r, fouls) {
    if (!fouls.length) return null;
    const off = this.poss;
    const def = other(off);
    const onO = fouls.filter((f) => f.on === 'O');
    const onD = fouls.filter((f) => f.on === 'D');
    const yardsOf = (f) => (f.spotFoul ? f.spotY || 0 : f.yards);
    const top = (list) => list.slice().sort((a, b) => yardsOf(b) - yardsOf(a))[0];
    if (onO.length && onD.length) {
      // Rule 14-5: fouls by both teams offset — unless one is a 15-yarder
      // and the other only 5, when just the 15 is enforced
      const fo = top(onO);
      const fd = top(onD);
      if (fd.yards === 15 && fo.yards === 5) return this.choosePlayFoul(r, [fd]);
      if (fo.yards === 15 && fd.yards === 5) return this.choosePlayFoul(r, [fo]);
      return { mode: 'offset', name: 'Offsetting fouls', on: null, yards: 0, fouls };
    }
    if (onD.length) {
      // the offense picks: the play, or the flag
      const f = top(onD);
      const pen = { name: f.name, on: def, yards: f.yards, auto1st: f.auto1st, player: f.player, signal: f.signal, key: f.key };
      if (f.spotFoul) pen.spot = Math.max(1, f.spotY || 1);
      if (r.td && !r.defTD) return { mode: 'declined', ...pen };
      // a personal foul after a gain is marked from the end of the run; on
      // a play that ended behind the line, from the previous spot
      if (f.afterPlay && !r.incomplete && !r.turnover && !r.safety && r.yards > 0) return { mode: 'after', ...pen };
      if (r.turnover || r.safety || r.defTD) return { mode: 'replace', ...pen };
      const penGain = pen.spot != null ? pen.spot : pen.yards;
      const playGain = r.incomplete ? 0 : r.yards;
      const playFirst = !r.incomplete && this.ballOn + playGain >= this.ltg;
      if (penGain >= playGain || (pen.auto1st && !playFirst)) return { mode: 'replace', ...pen };
      return { mode: 'declined', ...pen };
    }
    // a foul on the offense: the defense picks
    const f = top(onO);
    const pen = { name: f.name, on: off, yards: f.yards, player: f.player, signal: f.signal, key: f.key };
    if (r.turnover || r.safety) return { mode: 'declined', ...pen };
    // intentional grounding costs the down as well as the yards: always
    // taken (the play itself was an incompletion)
    if (f.lossOfDown) return { mode: 'replace', ...pen, lossOfDown: true, spotY: f.spotY ?? 0 };
    if (r.td) return { mode: 'replace', ...pen };
    const gain = r.incomplete ? 0 : r.yards;
    if (this.down >= 3 && !(this.ballOn + gain >= this.ltg)) return { mode: 'declined', ...pen }; // they'd rather have the next down
    if (gain <= -pen.yards) return { mode: 'declined', ...pen };
    return { mode: 'replace', ...pen };
  },
};
