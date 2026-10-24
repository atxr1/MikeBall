// Presentation mixed into CoachScreen: the scoreboard (DOM bug plus the
// network's pixel scorebug), banners and title cards, the pregame intro,
// what the players and the stadium do when someone scores or makes a play.

import { other } from '../game/rules.js';
import { MID_X } from '../core/util.js';
import { titleCard, fitPixelCanvas } from './broadcast.js';
import { h } from './dom.js';
import { sidelineReact } from '../render/sideline.js';

export const presentationMethods = {
  updateBug() {
    const g = this.game;
    for (const side of ['home', 'away']) {
      const e = this.el[side];
      e.score.textContent = String(g.score[side]);
      const n = g.timeouts[side];
      [...e.tos.children].forEach((i, k) => i.classList.toggle('used', k >= n));
      e.blk.classList.toggle('has-ball', g.poss === side && g.phase !== 'kickoff' && !g.over);
    }
    this.el.q.textContent = g.over ? 'Final' : g.quarterText();
    this.updateClocks();
    let dd = '';
    if (!g.over) {
      if (g.phase === 'kickoff') dd = g.freeKick ? 'Free kick' : 'Kickoff';
      else if (g.phase === 'pat' || this.twoPoint) dd = this.twoPoint ? 'Two-point try' : 'Extra point';
      else dd = `${g.downText()} at ${g.spotText()}`;
    }
    this.el.dd.textContent = dd;
    // what the TV bug shows is frozen here, so a kick's result (applied by
    // the rules engine at the snap) doesn't leak onto it before it happens
    let tvdd = '';
    if (!g.over) {
      if (g.phase === 'kickoff') tvdd = g.freeKick ? 'FREE KICK' : 'KICKOFF';
      else if (g.phase === 'pat' || this.twoPoint) tvdd = this.twoPoint ? '2-PT TRY' : 'PAT';
      else tvdd = g.downText().toUpperCase();
    }
    const side = (s) => ({ abbr: g.teams[s].abbr, score: g.score[s], to: g.timeouts[s] });
    this.bugShot = {
      away: side('away'),
      home: side('home'),
      poss: g.over || g.phase === 'kickoff' ? null : g.poss,
      period: g.over ? 'FINAL' : g.quarterText(),
      dd: tvdd,
    };
    this.updateScorebug();
  },

  // The network scorebug mirrors the DOM one (which stays for screen readers
  // and as the fallback until the art loads).
  updateScorebug() {
    const g = this.game;
    if (!this.scorebug || !this.bugShot) return;
    const showPc = (this.mode === 'call' || this.mode === 'set') && !this.noPlayClock();
    const ok = this.scorebug.update({
      ...this.bugShot,
      flag: !!this.flagUp,
      clock: g.over ? null : Math.ceil(g.clock),
      pc: showPc ? String(Math.max(0, Math.ceil(g.playClock))) : '',
    });
    if (ok && !this.el.bug.classList.contains('tv')) {
      this.el.bug.classList.add('tv');
      this.el.bug.setAttribute('aria-label', `${this.broadcast.netName} scoreboard`);
      fitPixelCanvas(this.scorebug.canvas, this.el.bug.clientWidth || 418);
    }
  },

  showIntro() {
    const g = this.game;
    const home = g.teams.home;
    const tod = this.broadcast.night ? 'night' : 'day';
    const url = home.art && home.stadium ? `assets/stadiums/${home.stadium.id}_${tod}.png` : null;
    this.scene = url
      ? { kind: 'stadium', url, t: 0, dur: 2.6, name: home.stadium.name }
      : { kind: 'field', los: 25, ltg: null, offTeam: g.teams.away, defTeam: g.teams.home, showLines: false };
    this.cam.set(MID_X, 50, 0.95, true);
    if (url) this.setTicker(home.stadium.name);
    this.setSheetEnabled(false);
    const recv = g.teams[g.firstReceiver];
    const b = this.broadcast;
    const text = `${g.teams.away.abbr} at ${g.teams.home.abbr}, ${b.title} on ${b.netName}. ${recv.city} won the toss and will receive.`;
    // give the network's kickoff card a moment to load
    let tries = 0;
    const show = () => {
      if (this.dead) return;
      if (!titleCard(b.net, 'Kickoff') && tries++ < 16) return this.after(0.05, show);
      this.banner(`${g.teams.away.abbr} at ${g.teams.home.abbr}`, text, 3, () => this.advance(), 'Kickoff');
    };
    show();
  },

  // The stadium's show for home points (fireworks, cannons...), fired when
  // the score actually changes, so a flag that wipes out a touchdown never
  // sets off the fireworks and each point is celebrated once.
  syncHomeScore() {
    const now = this.game.score.home;
    const pts = now - this.homePts;
    this.homePts = now;
    if (pts <= 0) return;
    this.show.trigger(pts);
    if (this.crowd) this.crowd.hype = 1;
    if (pts >= 6 && this.show.song) this.after(0.6, () => this.toast(`The crowd sings ${this.show.song.startsWith('the ') ? this.show.song : `“${this.show.song}”`}`, 2.2));
  },

  // What the players do after the whistle (see src/sim/celebrate.js).
  // r: the ruling on the field (what the players react to), the sim's
  // result unless the officials saw it differently.
  celebrationFor(sim, r = sim.result) {
    const g = this.game;
    if (!r) return null;
    const offSide = g.poss;
    if (r.td) {
      const side = r.defTD ? other(offSide) : offSide;
      const team = g.teams[side];
      const atLambeau = team.id === 'GB' && g.teams.home.id === 'GB';
      return { kind: 'td', leap: atLambeau && !this.twoPoint, salute: team.id === 'DEN' };
    }
    if (r.interception) return { kind: 'int', who: sim.interceptor };
    if (r.fumble && r.fumble.lost && sim.fumbled) return { kind: 'takeaway', who: sim.fumbled.recoveredBy };
    if (r.kind === 'sack' && sim.tackler) return { kind: 'sack', who: sim.tackler };
    if (r.incomplete || r.turnover || r.safety || this.twoPoint) return null;
    if (r.yards >= 20) return { kind: 'big' };
    if (g.ltg < 100 && this.scene.los + r.spotY >= g.ltg) return { kind: 'first' };
    return null;
  },

  // The home crowd gets loud when the home team makes a play.
  cheer(r, offSide) {
    // the sideline of the team that made the play goes wild
    const defSide = other(offSide);
    if (r.td && !r.turnover) sidelineReact(this.sideline, offSide, 1);
    else if (r.turnover) sidelineReact(this.sideline, defSide, 1);
    else if (r.kind === 'sack') sidelineReact(this.sideline, defSide, 0.7);
    else if (r.yards >= 15) sidelineReact(this.sideline, offSide, 0.6);
    if (!this.crowd) return;
    const homeO = offSide === 'home';
    let h = 0;
    if (r.td && !r.turnover) h = homeO ? 1 : 0;
    else if (r.turnover) h = homeO ? 0 : 1;
    else if (r.kind === 'sack') h = homeO ? 0 : 0.7;
    else if (r.yards >= 20) h = homeO ? 0.7 : 0;
    else if (r.yards >= 10) h = homeO ? 0.35 : 0;
    else if (!homeO && r.yards <= 0) h = 0.3;
    this.crowd.hype = Math.max(this.crowd.hype, h);
  },

  // ------------------------------------------------------------------ dialogs / banners
  banner(head, text, sec, then, cardKey = head) {
    const b = this.el.banner;
    const hd = b.querySelector('.banner-head');
    // the network's own title card when there is one for this moment
    const card = titleCard(this.broadcast.net, cardKey);
    hd.classList.toggle('tv-card', !!card);
    hd.classList.remove('flag');
    if (card) {
      hd.replaceChildren(card);
      fitPixelCanvas(card, Math.min(400, this.stage.clientWidth - 28));
      card.setAttribute('aria-label', head);
    } else hd.textContent = head;
    b.querySelector('.banner-text').textContent = text || '';
    b.hidden = false;
    b.classList.remove('in');
    void b.offsetWidth;
    b.classList.add('in');
    this.el.tapHint.hidden = false;
    this.bannerThen = () => {
      b.hidden = true;
      this.el.tapHint.hidden = true;
      this.bannerThen = null;
      then && then();
    };
    const token = (this.bannerToken = {});
    this.after(sec, () => { if (this.bannerToken === token && this.bannerThen) this.bannerThen(); });
  },

  // A flag: broadcast-style lower third with the foul, who, and how it's
  // enforced. pen: { name, on, player, text }.
  penaltyBanner(pen, then, after = null) {
    const g = this.game;
    const who = pen.player && pen.player.num != null ? ` #${pen.player.num}` : '';
    const team = pen.on && g.teams[pen.on] && pen.mode !== 'offset' ? g.teams[pen.on].abbr : '';
    const rest = (pen.text || '').split('. ').slice(1).join('. ');
    const text = `${pen.name}${team ? `, ${team}${who}` : ''}${rest ? `. ${rest}` : '.'}`;
    this.banner('Flag', text, 2.6, after ? () => this.banner(after, '', 1.4, then) : then, 'Flag');
    this.el.banner.querySelector('.banner-head').classList.add('flag');
  },

  // The network's two-minute warning card for a moment (no tap needed).
  twoMinuteCard() {
    const card = titleCard(this.broadcast.net, 'Two-minute warning');
    if (!card) return this.toast('Two-minute warning');
    const el = h('div', { class: 'card-flash', role: 'status', 'aria-label': 'Two-minute warning' }, card);
    this.stage.append(el);
    fitPixelCanvas(card, Math.min(340, this.stage.clientWidth - 40));
    setTimeout(() => el.remove(), 1800);
  },
};
