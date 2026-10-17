// Kicks for the coach view, mixed into CoachScreen: kickoffs, extra
// points, two-point tries, punts and field goals staged as 22-man scenes
// (src/ui/kickscene.js) once the rules engine has decided the result.

import { other } from '../game/rules.js';
import { setupTwoPoint } from '../game/autoplay.js';
import { makeRng } from '../core/rng.js';
import { MID_X } from '../core/util.js';
import { KickScene } from './kickscene.js';

export const kickMethods = {
  doKickoff(onside) {
    const g = this.game;
    const out = g.kickoff(onside);
    this.runKick('kickoff', out);
  },

  doExtraPoint() {
    const out = this.game.extraPoint();
    this.runKick('pat', out);
  },

  startTwoPoint() {
    const g = this.game;
    setupTwoPoint(g);
    this.twoPoint = true;
    this.updateBug();
    this.enterCall();
  },

  runKick(type, out, bx = MID_X) {
    const g = this.game;
    this.mode = 'kick';
    this.setSheetEnabled(false);
    let kSide;
    if (type === 'kickoff') kSide = out.kSide;
    else kSide = out.side;
    const rSide = other(kSide);
    const sc = new KickScene({ type, out, game: g, kSide, rSide, rng: this.kickRng(), ballX: type === 'pat' ? MID_X : bx });
    sc.offTeam = g.teams[kSide];
    sc.defTeam = g.teams[rSide];
    sc.ltg = null;
    sc.showLines = type !== 'kickoff';
    sc.uniK = this.uni(kSide);
    sc.uniR = this.uni(rSide);
    this.scene = sc;
    const f0 = sc.focus();
    this.cam.set(f0.x, f0.f + 6, 1.15, true);
    this.dirty = true;
    this.setTicker(''); // the result shows once the kick has played out
  },

  kickRng() {
    if (!this._krng) this._krng = makeRng(this.opts.seed ^ 0x5eed);
    return this._krng;
  },

  updateKick(dt) {
    const sc = this.scene;
    sc.update(dt * this.speed);
    if (sc.done && !sc.reported) {
      sc.reported = true;
      const out = sc.out;
      this.setTicker(out.text);
      this.syncHomeScore();
      this.updateBug();
      this.mode = 'idle';
      const head = out.headline;
      if (this.crowd) {
        const homeKick = sc.offTeam === this.game.teams.home;
        const good = out.good || out.res?.good;
        const td = out.res?.td || /touchdown/i.test(head || '');
        if ((sc.type === 'fg' || sc.type === 'pat') && good && homeKick) this.crowd.hype = Math.max(this.crowd.hype, 0.6);
        if (td) this.crowd.hype = Math.max(this.crowd.hype, homeKick ? 0 : 1);
      }
      if (sc.type === 'fg' && out.res?.good) this.banner('Field goal', out.text, 1.8, () => this.advance());
      else if (sc.type === 'pat') this.banner(out.good ? 'Good' : 'No good', out.text, 1.4, () => this.advance());
      else if (head) this.banner(head, out.text, 2, () => this.advance());
      else this.after(0.6, () => this.advance());
    }
  },
};
