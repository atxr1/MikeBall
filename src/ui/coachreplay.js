// Close calls and instant replay in the coach view, mixed into CoachScreen
// (the rules are in src/game/replay.js). After a close play goes against
// you, you get the ruling and what the TV replay seems to show, and decide
// whether to throw the red flag; the CPU coach decides for his side; inside
// two minutes of a half and in overtime the booth takes a look itself. A
// reversed ruling puts the game back to before the play and applies what
// really happened.

import { other } from '../game/rules.js';
import { onFieldRuling, rulingCtx, callText, leanText, reviewOverturns, cpuWantsChallenge } from '../game/replay.js';

export const replayUiMethods = {
  // The officials rule on the play the sim just finished; returns the
  // result to apply. Remembers a close call for afterRuling().
  ruleOnPlay(r) {
    const g = this.game;
    this.review = null;
    const call = onFieldRuling(r, rulingCtx(g), g.rng);
    if (call.close) {
      this.review = { close: call.close, truth: r, snap: g.snapshot(), off: g.poss, o: this.liveO, d: this.liveD };
    }
    return call.ruled;
  },

  // After the play's banners: a review, or on to the next snap.
  afterRuling(out) {
    const rv = this.review;
    this.review = null;
    const g = this.game;
    // a flag that wiped out the play makes the ruling moot
    if (!rv || (out && out.kind === 'penalty') || g.over) return this.advance();
    const c = rv.close;
    const wronged = c.favors === 'O' ? other(rv.off) : rv.off;
    if (g.inBoothWindow()) {
      // the booth looks at close ones itself; it stops the game when it has
      // something to look at
      if (c.wrong || c.lean === 'against') return this.runReview(rv, 'booth');
      return this.advance();
    }
    if (wronged === this.user) {
      if (!g.canChallenge(this.user)) return this.advance();
      const left = g.challenges[this.user];
      return this.dialog('Close call', `${callText(c)} ${leanText(c)} A challenge costs a timeout if the ruling stands.`, [
        [`Challenge (${left} left)`, () => this.runReview(rv, this.user)],
        ['Let it go', () => this.advance()],
      ]);
    }
    if (cpuWantsChallenge(g, wronged, c, g.rng)) {
      this.toast(`${g.teams[wronged].abbr} throws the red flag`, 1.8);
      return this.runReview(rv, wronged);
    }
    return this.advance();
  },

  runReview(rv, by) {
    const g = this.game;
    this.mode = 'idle';
    this.setSheetEnabled(false);
    const booth = by === 'booth';
    const won = reviewOverturns(rv.close, g.rng);
    const head = booth ? 'Replay review' : `${g.teams[by].abbr} challenge`;
    const why = booth ? 'The replay official is taking a look.' : 'The referee goes under the hood.';
    this.banner(head, why, 2.4, () => {
      let text;
      let out = null;
      if (won) {
        g.restore(rv.snap);
        out = g.applyPlay(rv.truth, rv.o, rv.d);
        if (!booth) g.chargeChallenge(by, true);
        this.syncHomeScore();
        const extra = out.headline && !out.text.includes(out.headline.replace('!', '')) ? ` ${out.headline.replace(/!$/, '')}.` : '';
        text = `After review, the ruling on the field is reversed. ${out.text}${extra}`;
        this.setTicker(`Reversed: ${out.text}`);
      } else {
        if (!booth) g.chargeChallenge(by, false);
        text = rv.close.wrong ? 'After review, the ruling on the field stands.' : 'After review, the ruling on the field is confirmed.';
        if (!booth) text += ` ${g.teams[by].abbr} is charged a timeout.`;
      }
      this.updateBug();
      if (out && out.flags && out.flags.includes('twoMinute')) this.twoMinuteCard();
      this.banner(won ? 'Reversed' : rv.close.wrong ? 'Ruling stands' : 'Confirmed', text, 2.6, () => this.advance());
    });
  },
};
