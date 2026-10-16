// The coach view: broadcast scoreboard on top, live field in the middle,
// play-calling sheet at the bottom. Drives the Game state machine.

import { Game, other } from '../game/rules.js';
import { makePlaySim, setupTwoPoint, cpuStep } from '../game/autoplay.js';
import { cpuOffense, cpuDefense, cpuPat, cpuOnside, cpuTimeout } from '../game/cpu.js';
import { OFFENSE_PLAYS, DEFENSE_PLAYS, OFF_CATS, DEF_CATS, offPlay, FORMATIONS } from '../data/playbook.js';
import { fgDistance, maxFgRange } from '../game/kicks.js';
import { makeRng } from '../core/rng.js';
import { MID_X, fmtClock, clamp, lerp } from '../core/util.js';
import { Camera } from '../render/camera.js';
import { drawField } from '../render/field.js';
import { drawPlayer, drawBall, uniform } from '../render/sprites.js';
import { drawFieldArt, playCardSVG } from '../render/playart.js';
import { DT } from '../sim/playsim.js';
import { h, clear } from './dom.js';
import { teamMarkSVG } from './emblems.js';
import { openRoster } from './roster.js';

export class CoachScreen {
  constructor(app, opts) {
    this.app = app;
    const { league, userId, oppId, userHome, qLen, seed } = opts;
    const homeId = userHome ? userId : oppId;
    const awayId = userHome ? oppId : userId;
    this.user = userHome ? 'home' : 'away';
    this.game = new Game({
      homeTeam: app.teamById(homeId),
      awayTeam: app.teamById(awayId),
      homeRoster: league[homeId],
      awayRoster: league[awayId],
      userSide: this.user,
      qLen,
      seed,
    });
    this.opts = opts;
    this.cam = new Camera();
    this.mode = 'idle';
    this.timers = [];
    this.scene = null;
    this.speed = 1;
    this.twoPoint = false;
    this.sel = null;
    this.cat = null;
    this.uniCache = new Map();
    this.tmp = { x: 0, f: 0, vx: 0, vy: 0, face: 0, anim: 0, down: false, num: 0, skin: 0, juke: 0, lean: 0, diveT: 0 };
    this.build();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    this.showIntro();
  }

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.ro && this.ro.disconnect();
    this.root.remove();
  }

  // ------------------------------------------------------------------ DOM
  build() {
    const g = this.game;
    this.el = {};
    const teamBlock = (side) => {
      const t = g.teams[side];
      const score = h('span', { class: 'bug-score' }, '0');
      const tos = h('span', { class: 'bug-tos', 'aria-label': 'Timeouts left' }, h('i'), h('i'), h('i'));
      const poss = h('span', { class: 'bug-poss', 'aria-hidden': 'true' });
      const blk = h('div', { class: `bug-team bug-${side}`, style: { '--tc': t.colors.primary } },
        h('span', { class: 'bug-mark', html: teamMarkSVG(t, 30) }),
        h('span', { class: 'bug-abbr' }, t.abbr, poss),
        score,
        tos,
      );
      this.el[side] = { score, tos, poss, blk };
      return blk;
    };
    this.el.q = h('span', { class: 'bug-q' }, 'Q1');
    this.el.clock = h('span', { class: 'bug-clock' }, fmtClock(g.clock));
    this.el.dd = h('span', { class: 'bug-dd' }, '');
    this.el.ticker = h('p', { class: 'ticker', 'aria-live': 'polite' }, '');

    this.canvas = h('canvas', { class: 'field', 'aria-label': 'Football field' });
    this.el.banner = h('div', { class: 'banner', hidden: true }, h('strong', { class: 'banner-head' }), h('p', { class: 'banner-text' }));
    this.el.toast = h('div', { class: 'toast', hidden: true });
    this.el.tapHint = h('p', { class: 'tap-hint', hidden: true }, 'Tap to continue');
    this.stage = h('div', { class: 'stage' }, this.canvas, this.el.toast, this.el.banner, this.el.tapHint);
    this.stage.addEventListener('pointerup', () => this.onStageTap());

    this.el.role = h('p', { class: 'role' });
    this.el.tabs = h('div', { class: 'tabs', role: 'tablist' });
    this.el.cards = h('div', { class: 'cards', role: 'listbox', 'aria-label': 'Plays' });
    this.el.timeout = h('button', { class: 'act', onclick: () => this.userTimeout() }, 'Timeout');
    this.el.rosterBtn = h('button', { class: 'act', onclick: () => this.openRoster() }, 'Roster');
    this.el.menuBtn = h('button', { class: 'act', onclick: () => this.openMenu() }, 'Menu');
    this.el.go = h('button', { class: 'go', onclick: () => this.snap() }, 'Run play');
    this.el.sheet = h('section', { class: 'callsheet' },
      h('div', { class: 'callhead' }, this.el.role, this.el.tabs),
      this.el.cards,
      h('div', { class: 'actions' }, this.el.timeout, this.el.rosterBtn, this.el.menuBtn, this.el.go),
    );

    this.root = h('div', { class: 'coach' },
      h('header', { class: 'bug' }, teamBlock('away'), teamBlock('home'),
        h('div', { class: 'bug-state' }, h('div', { class: 'bug-time' }, this.el.q, this.el.clock), this.el.dd)),
      this.el.ticker,
      this.stage,
      this.el.sheet,
    );
    this.app.root.append(this.root);
    this.ctx = this.canvas.getContext('2d');
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.stage);
    this.resize();
    this.updateBug();
  }

  resize() {
    const r = this.stage.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.dpr = dpr;
    this.cam.resize(r.width, r.height);
  }

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
    this.el.clock.textContent = g.over ? '' : fmtClock(g.clock);
    let dd = '';
    if (!g.over) {
      if (g.phase === 'kickoff') dd = 'Kickoff';
      else if (g.phase === 'pat' || this.twoPoint) dd = this.twoPoint ? 'Two-point try' : 'Extra point';
      else dd = `${g.downText()} at ${g.spotText()}`;
    }
    this.el.dd.textContent = dd;
  }

  setTicker(text) {
    this.el.ticker.textContent = text || '';
  }

  toast(text, sec = 1.6) {
    const t = this.el.toast;
    t.textContent = text;
    t.hidden = false;
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => { t.hidden = true; }, sec * 1000);
  }

  // ------------------------------------------------------------------ flow
  after(sec, fn) {
    this.timers.push({ t: sec, fn });
  }

  setSheetEnabled(on) {
    this.el.sheet.classList.toggle('locked', !on);
    this.el.go.disabled = !on;
    this.el.timeout.disabled = !on || this.game.timeouts[this.user] <= 0 || !this.game.clockRunning;
  }

  showIntro() {
    const g = this.game;
    this.scene = { kind: 'field', los: 25, ltg: null, offTeam: g.teams.away, defTeam: g.teams.home, showLines: false };
    this.cam.set(MID_X, 50, 0.95, true);
    this.setSheetEnabled(false);
    const recv = g.teams[g.firstReceiver];
    this.banner(`${g.teams.away.abbr} at ${g.teams.home.abbr}`, `${recv.city} won the toss and will receive.`, 2.6, () => this.advance());
  }

  advance() {
    if (this.dead) return;
    const g = this.game;
    this.updateBug();
    if (g.over || g.next === 'final') return this.showFinal();
    switch (g.next) {
      case 'endQuarter': {
        const r = g.endQuarter();
        this.updateBug();
        if (r.kind === 'final') return this.showFinal();
        this.setTicker(r.text);
        return this.banner(r.kind === 'half' ? 'Halftime' : r.kind === 'ot' ? 'Overtime' : r.text, r.kind === 'ot' ? g.log[g.log.length - 1].text : '', 2, () => this.advance());
      }
      case 'kickoff':
        if (g.kickingSide === this.user) {
          return this.dialog('Kickoff', 'How do you want to kick it?', [
            ['Kick deep', () => this.doKickoff(false)],
            ['Onside kick', () => this.doKickoff(true)],
          ]);
        }
        return this.doKickoff(cpuOnside(g, g.kickingSide));
      case 'pat':
        if (g.patSide === this.user) {
          return this.dialog('Touchdown!', 'Kick the extra point or go for two?', [
            ['Extra point', () => this.doExtraPoint()],
            ['Go for two', () => this.startTwoPoint()],
          ]);
        }
        if (cpuPat(g, g.patSide) === 'kick') return this.doExtraPoint();
        return this.startTwoPoint();
      case 'call':
      default:
        return this.enterCall();
    }
  }

  // ------------------------------------------------------------------ calling plays
  enterCall() {
    const g = this.game;
    this.mode = 'call';
    this.updateBug();
    const userOff = g.poss === this.user;
    const cpuSide = other(this.user);
    if (userOff) {
      this.cpuPlay = cpuDefense(g, cpuSide);
    } else {
      let p = cpuOffense(g, cpuSide);
      if (this.twoPoint && p.cat === 'special') p = offPlay('slants');
      this.cpuPlay = p;
      if (!this.twoPoint && p.cat === 'special') return this.cpuSpecial(p);
    }
    this.renderSheet(userOff);
    this.setSheetEnabled(true);
  }

  renderSheet(userOff) {
    const g = this.game;
    const cats = userOff ? OFF_CATS : DEF_CATS;
    if (!this.cat || !cats.find((c) => c.id === this.cat) || this.lastRole !== userOff) {
      this.cat = this.suggestCat(userOff);
    }
    this.lastRole = userOff;
    this.el.role.textContent = userOff
      ? (this.twoPoint ? 'Two-point try. Call a play.' : `You have the ball. ${g.downText()}.`)
      : (this.twoPoint ? 'Stop the two-point try.' : `You're on defense. ${g.downText()}.`);
    clear(this.el.tabs);
    for (const c of cats) {
      if (this.twoPoint && c.id === 'special') continue;
      const b = h('button', { class: 'tab', role: 'tab', 'aria-selected': String(c.id === this.cat) }, c.label);
      b.addEventListener('click', () => { this.cat = c.id; this.renderSheet(userOff); });
      this.el.tabs.append(b);
    }
    const plays = (userOff ? OFFENSE_PLAYS : DEFENSE_PLAYS).filter((p) => p.cat === this.cat);
    if (!this.sel || !plays.includes(this.sel)) this.sel = this.suggestPlay(plays, userOff);
    clear(this.el.cards);
    for (const p of plays) {
      const disabled = this.playDisabled(p);
      const card = h('button', { class: 'card', role: 'option', 'aria-selected': String(p === this.sel), disabled },
        h('span', { class: 'card-art', html: playCardSVG(p, userOff ? 'O' : 'D') }),
        h('span', { class: 'card-name' }, p.name),
        h('span', { class: 'card-sub' }, this.cardSub(p, userOff)),
      );
      card.addEventListener('click', () => {
        this.sel = p;
        for (const c of this.el.cards.children) c.setAttribute('aria-selected', String(c === card));
        this.buildPreview();
      });
      this.el.cards.append(card);
    }
    const selCard = [...this.el.cards.children].find((c) => c.getAttribute('aria-selected') === 'true');
    if (selCard) selCard.scrollIntoView({ inline: 'center', block: 'nearest' });
    this.buildPreview();
  }

  cardSub(p, userOff) {
    if (p.special === 'fg') {
      const d = fgDistance(this.game.ballOn);
      return `${d}-yard try`;
    }
    if (p.special) return p.special === 'punt' ? 'Flip the field' : p.special === 'kneel' ? 'Run the clock' : 'Stop the clock';
    if (userOff) return FORMATIONS[p.formation].name;
    return { '43': '4-3', nickel: 'Nickel', dime: 'Dime', '34': '3-4', goal: 'Goal line' }[p.front];
  }

  playDisabled(p) {
    const g = this.game;
    if (p.special === 'fg') return fgDistance(g.ballOn) > maxFgRange(g.kicker(this.user)) + 8;
    if (p.special === 'punt') return g.ballOn > 95;
    if (p.special === 'spike') return g.down >= 4 || !g.clockRunning;
    return false;
  }

  suggestCat(userOff) {
    const g = this.game;
    if (!userOff) {
      if (g.toGo() <= 1 || g.ballOn >= 96) return 'run';
      return g.down === 3 && g.toGo() >= 7 ? 'man' : 'zone';
    }
    if (this.twoPoint) return 'pass';
    if (g.down === 4 && !(g.toGo() <= 2 && g.ballOn >= 40)) return 'special';
    return g.down === 3 && g.toGo() >= 5 ? 'pass' : g.toGo() <= 2 ? 'run' : 'pass';
  }

  suggestPlay(plays, userOff) {
    const g = this.game;
    if (userOff && this.cat === 'special') {
      const fg = plays.find((p) => p.special === 'fg');
      if (fg && fgDistance(g.ballOn) <= maxFgRange(g.kicker(this.user)) - 2) return fg;
      return plays.find((p) => p.special === 'punt') || plays[0];
    }
    if (!userOff && this.cat === 'zone') return plays.find((p) => p.id === 'cov3_43') || plays[0];
    return plays.find((p) => !this.playDisabled(p)) || plays[0];
  }

  buildPreview() {
    const g = this.game;
    const userOff = g.poss === this.user;
    let o = userOff ? this.sel : this.cpuPlay;
    const d = userOff ? this.cpuPlay : this.sel;
    let artSide = userOff ? 'O' : 'D';
    if (o.cat === 'special' && (o.special === 'punt' || o.special === 'fg')) {
      o = offPlay('kneel');
      artSide = null;
    }
    const sim = makePlaySim(g, o, d, makeRng(7));
    this.setSimScene(sim, artSide);
    this.cam.set(lerp(g.ballX, MID_X, 0.6), g.ballOn + 6, 1.42, !this.previewShown);
    this.previewShown = true;
  }

  setSimScene(sim, artSide) {
    const g = this.game;
    const off = g.poss;
    const def = other(off);
    this.scene = {
      kind: 'sim',
      sim,
      artSide,
      los: g.ballOn,
      ltg: this.twoPoint || g.ltg >= 100 ? null : g.ltg,
      offSide: off,
      offTeam: g.teams[off],
      defTeam: g.teams[def],
      offUni: this.uni(off),
      defUni: this.uni(def),
      showLines: true,
    };
  }

  uni(side) {
    if (!this.uniCache.has(side)) this.uniCache.set(side, uniform(this.game.teams[side], side === 'home'));
    return this.uniCache.get(side);
  }

  // ------------------------------------------------------------------ snapping
  snap() {
    if (this.mode !== 'call') return;
    const g = this.game;
    const cpu = other(this.user);
    this.setSheetEnabled(false);
    if (!this.twoPoint && cpuTimeout(g, cpu)) {
      g.useTimeout(cpu);
      this.toast(`Timeout, ${g.teams[cpu].abbr}`);
    }
    const userOff = g.poss === this.user;
    const o = userOff ? this.sel : this.cpuPlay;
    const d = userOff ? this.cpuPlay : this.sel;
    this.runSnap(o, d);
  }

  runSnap(o, d) {
    const g = this.game;
    if (!this.twoPoint) {
      const s = g.snap();
      this.updateBug();
      if (s.stop) { this.mode = 'idle'; return this.advance(); }
      if (s.events.includes('twoMinute')) this.toast('Two-minute warning');
      if (o.special === 'punt') return this.runKick('punt', g.punt());
      if (o.special === 'fg') return this.runKick('fg', g.fieldGoal());
      const pen = g.preSnapPenalty();
      if (pen) {
        g.finishNext();
        this.updateBug();
        this.setTicker(`Flag: ${pen.text}`);
        this.mode = 'idle';
        return this.banner('Flag', pen.text, 1.8, () => this.advance());
      }
    }
    this.liveO = o;
    this.liveD = d;
    const sim = makePlaySim(g, o, d);
    this.setSimScene(sim, null);
    this.acc = 0;
    this.playEnded = false;
    this.mode = 'play';
  }

  cpuSpecial(p) {
    const g = this.game;
    this.setSheetEnabled(false);
    clear(this.el.cards);
    clear(this.el.tabs);
    const t = g.teams[g.poss];
    if (p.special === 'punt' || p.special === 'fg') {
      this.el.role.textContent = p.special === 'punt' ? `${t.name} are punting.` : `${t.name} are trying a field goal.`;
      this.mode = 'idle';
      this.after(0.9, () => this.runSnap(p, null));
      return;
    }
    // Kneel or spike: defense call doesn't matter.
    this.el.role.textContent = p.special === 'kneel' ? `${t.name} are taking a knee.` : `${t.name} are spiking it.`;
    const d = cpuDefense(g, this.user);
    this.mode = 'idle';
    this.after(0.7, () => this.runSnap(p, d));
  }

  userTimeout() {
    const g = this.game;
    if (this.mode !== 'call') return;
    if (g.useTimeout(this.user)) {
      this.updateBug();
      this.toast(`Timeout. ${g.timeouts[this.user]} left.`);
      this.setSheetEnabled(true);
    }
  }

  // ------------------------------------------------------------------ live play
  updatePlay(dt) {
    const sim = this.scene.sim;
    this.acc += dt * this.speed;
    let n = 0;
    while (this.acc >= DT && !sim.done && n++ < 8) {
      sim.step();
      this.acc -= DT;
    }
    if (sim.done && !this.playEnded) {
      this.playEnded = true;
      this.after(0.75, () => this.finishPlay());
    }
  }

  finishPlay() {
    const g = this.game;
    const r = this.scene.sim.result;
    let out;
    if (this.twoPoint) {
      out = g.applyTwoPoint(r);
      this.twoPoint = false;
    } else {
      out = g.applyPlay(r, this.liveO, this.liveD);
    }
    this.mode = 'idle';
    this.updateBug();
    this.setTicker(out.text);
    if (out.flags && out.flags.includes('twoMinute')) this.toast('Two-minute warning');
    const head = out.headline;
    if (head && head !== 'FIRST DOWN') this.banner(titleCase(head), out.text, 2.1, () => this.advance());
    else {
      if (head === 'FIRST DOWN') this.toast('First down');
      this.after(0.5, () => this.advance());
    }
  }

  // ------------------------------------------------------------------ kicks
  doKickoff(onside) {
    const g = this.game;
    const out = g.kickoff(onside);
    this.runKick('kickoff', out);
  }

  doExtraPoint() {
    const out = this.game.extraPoint();
    this.runKick('pat', out);
  }

  startTwoPoint() {
    const g = this.game;
    setupTwoPoint(g);
    this.twoPoint = true;
    this.updateBug();
    this.enterCall();
  }

  runKick(type, out) {
    const g = this.game;
    this.mode = 'kick';
    this.setSheetEnabled(false);
    const res = out.res || out.anim || {};
    let kSide;
    let rSide;
    let from;
    let to;
    let ret = null;
    let fx = MID_X;
    let tx = MID_X;
    let peak = 12;
    if (type === 'kickoff') {
      kSide = out.kSide;
      rSide = out.rSide;
      from = res.type && res.type.startsWith('onside') ? 35 : 35;
      to = 100 - (res.landing ?? 0);
      peak = res.type && res.type.startsWith('onside') ? 1.5 : 16;
      tx = MID_X + (this.kickRng().next() - 0.5) * 16;
      if (res.type === 'return' || res.type === 'td') ret = { to: 100 - res.ballOn };
    } else if (type === 'punt') {
      kSide = out.side;
      rSide = other(kSide);
      from = out.startBall - 14;
      to = res.type === 'touchback' ? 106 : res.type === 'blocked' ? out.startBall - 11 : res.landing;
      peak = res.type === 'blocked' ? 2 : 19;
      tx = MID_X + (this.kickRng().next() - 0.5) * 20;
      if (res.type === 'return' || res.type === 'td') ret = { to: 100 - res.ballOn };
    } else {
      kSide = type === 'pat' ? this.lastPatSide(out) : out.side;
      rSide = other(kSide);
      const start = type === 'pat' ? 85 : out.startBall;
      from = start - 7;
      const a = out.anim || {};
      const good = a.good;
      const miss = a.miss || '';
      to = miss === 'short' ? 107 : 112;
      tx = MID_X + (good ? (this.kickRng().next() - 0.5) * 2.5 : miss.includes('left') ? -4.4 : miss.includes('right') ? 4.4 : 0);
      fx = type === 'pat' ? MID_X : g.ballX;
      peak = 7 + (to - from) * 0.08;
      if (out.res && out.res.blocked) { to = from + 2; peak = 1; }
    }
    const dist = Math.abs(to - from);
    const flight = clamp(0.7 + dist * 0.028, 0.8, 2.6);
    this.scene = {
      kind: 'kick',
      type,
      t: 0,
      flight,
      from: { x: fx, f: from },
      to: { x: tx, f: to },
      peak,
      ret,
      retDur: ret ? clamp(Math.abs(ret.to - to) / 9.5, 0.5, 4) : 0,
      kicker: { team: g.teams[kSide], uni: this.uni(kSide), num: (type === 'punt' ? g.punter(kSide) : g.kicker(kSide)).num },
      returner: ret ? { uni: this.uni(rSide), num: g.returner(rSide).num, skin: g.returner(rSide).skinTone } : null,
      offTeam: g.teams[kSide],
      defTeam: g.teams[rSide],
      los: from + (type === 'punt' ? 14 : 7),
      ltg: null,
      showLines: false,
      out,
    };
    this.cam.set(fx, from + 8, 1.05, true);
    this.setTicker(out.text);
  }

  lastPatSide(out) {
    // extraPoint() clears patSide; the kicking side is who kicks off next.
    return this.game.kickingSide || this.game.poss;
  }

  kickRng() {
    if (!this._krng) this._krng = makeRng(this.opts.seed ^ 0x5eed);
    return this._krng;
  }

  updateKick(dt) {
    const sc = this.scene;
    sc.t += dt * this.speed;
    if (!sc.doneT && sc.t >= sc.flight + sc.retDur + 0.4) {
      sc.doneT = true;
      const out = sc.out;
      this.updateBug();
      this.mode = 'idle';
      const head = out.headline;
      const showHead = head && !(sc.type === 'pat' && out.good) && head !== 'FIELD GOAL' ? head : null;
      if (sc.type === 'fg' && out.res?.good) this.banner('Field goal', out.text, 1.8, () => this.advance());
      else if (sc.type === 'pat') this.banner(out.good ? 'Good' : 'No good', out.text, 1.4, () => this.advance());
      else if (showHead) this.banner(titleCase(showHead), out.text, 2, () => this.advance());
      else this.after(0.9, () => this.advance());
    }
  }

  // ------------------------------------------------------------------ dialogs / banners
  banner(head, text, sec, then) {
    const b = this.el.banner;
    b.querySelector('.banner-head').textContent = head;
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
  }

  onStageTap() {
    if (this.bannerThen) {
      this.bannerToken = null;
      this.bannerThen();
    }
  }

  dialog(title, text, buttons) {
    this.mode = 'idle';
    this.setSheetEnabled(false);
    const close = () => d.remove();
    const d = h('div', { class: 'sheet dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'sheet-panel dialog-panel' },
        h('strong', { class: 'dialog-title' }, title),
        text ? h('p', { class: 'dialog-text' }, text) : null,
        h('div', { class: 'dialog-buttons' }, ...buttons.map(([label, fn], i) =>
          h('button', { class: i === 0 ? 'go' : 'act', onclick: () => { close(); fn(); } }, label))),
      ),
    );
    this.root.append(d);
    return close;
  }

  openRoster() {
    openRoster(this.root, this.game.teams[this.user], this.game.rosters[this.user]);
  }

  openMenu() {
    const wasCall = this.mode === 'call';
    this.dialog('Menu', null, [
      ['Resume', () => { if (wasCall) { this.mode = 'call'; this.setSheetEnabled(true); } }],
      ['Sim to the end', () => this.simToEnd()],
      ['Quit to title', () => this.app.showTitle()],
    ]);
  }

  simToEnd() {
    const g = this.game;
    if (this.twoPoint) {
      const sim = makePlaySim(g, cpuOffense(g, g.poss).cat === 'special' ? offPlay('slants') : cpuOffense(g, g.poss), cpuDefense(g, other(g.poss)));
      g.applyTwoPoint(sim.runToEnd());
      this.twoPoint = false;
    }
    let n = 0;
    while (!g.over && n++ < 4000) cpuStep(g);
    this.showFinal();
  }

  showFinal() {
    this.mode = 'final';
    this.updateBug();
    this.app.showFinal(this.game, this.opts);
  }

  // ------------------------------------------------------------------ frame loop
  loop(ts) {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (ts - (this.lastTs || ts)) / 1000) * (this.app.timeScale || 1);
    this.lastTs = ts;
    if (this.timers.length) {
      const due = [];
      for (const t of this.timers) { t.t -= dt; if (t.t <= 0) due.push(t); }
      if (due.length) {
        this.timers = this.timers.filter((t) => t.t > 0);
        for (const t of due) t.fn();
      }
    }
    if (this.mode === 'play' && this.scene.kind === 'sim') this.updatePlay(dt);
    if (this.mode === 'kick' && this.scene.kind === 'kick') this.updateKick(dt);
    this.updateCamera();
    this.cam.update(dt, this.mode === 'play' ? 5 : 3.5);
    this.draw();
  }

  updateCamera() {
    const sc = this.scene;
    if (!sc) return;
    if (sc.kind === 'sim' && this.mode === 'play') {
      const sim = sc.sim;
      const b = sim.ball;
      let x = b.x;
      let f = sc.los + b.y;
      if (b.state === 'air') { x = lerp(b.x, b.tx, 0.4); f = sc.los + lerp(b.y, b.ty, 0.4); }
      this.cam.set(x, f + 3, 1.36);
    } else if (sc.kind === 'kick') {
      const p = this.kickBall(sc);
      this.cam.set(p.x, p.f + 4, 1.05);
    }
  }

  kickBall(sc) {
    const u = clamp(sc.t / sc.flight, 0, 1);
    if (sc.t <= sc.flight || !sc.ret) {
      return { x: lerp(sc.from.x, sc.to.x, u), f: lerp(sc.from.f, sc.to.f, u), z: 4 * sc.peak * u * (1 - u) + 1, u };
    }
    const v = clamp((sc.t - sc.flight) / sc.retDur, 0, 1);
    return { x: sc.to.x + Math.sin(v * 3) * 2, f: lerp(sc.to.f, sc.ret.to, v), z: 1.1, u: 1, v };
  }

  draw() {
    const ctx = this.ctx;
    const sc = this.scene;
    if (!sc) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const g = this.game;
    drawField(ctx, this.cam, { offTeam: sc.offTeam, defTeam: sc.defTeam, homeTeam: g.teams.home, los: sc.los, ltg: sc.ltg, showLines: sc.showLines });
    if (sc.kind === 'sim') this.drawSim(ctx, sc);
    else if (sc.kind === 'kick') this.drawKick(ctx, sc);
  }

  drawSim(ctx, sc) {
    const sim = sc.sim;
    if (this.mode === 'call' && sc.artSide) drawFieldArt(ctx, this.cam, sim, sc.artSide, sc.los);
    const list = sim.players.slice().sort((a, b) => b.y - a.y);
    const live = this.mode === 'play' || this.mode === 'idle';
    for (const p of list) {
      const e = this.tmp;
      e.x = p.x;
      e.f = sc.los + p.y;
      e.vx = p.vx;
      e.vy = p.vy;
      e.face = p.face;
      e.anim = p.anim;
      e.down = p.down;
      e.num = p.rec.num;
      e.skin = p.rec.skinTone;
      e.juke = p.juke;
      e.diveT = 0;
      e.lean = p.blk ? 0.12 : 0;
      const holder = live && sim.ball.holder === p && sim.phase === 'run';
      drawPlayer(ctx, this.cam, e, p.side === 'O' ? sc.offUni : sc.defUni, {
        stance: !live || sim.t < 0.05,
        marker: holder ? '#FFD23F' : null,
      });
    }
    const b = sim.ball;
    const ang = b.state === 'air' ? Math.atan2(-(b.ty - b.fy), b.tx - b.fx) : 0;
    drawBall(ctx, this.cam, { x: b.x, f: sc.los + b.y, z: b.z, ang });
  }

  drawKick(ctx, sc) {
    const p = this.kickBall(sc);
    const e = this.tmp;
    // kicker
    e.x = sc.from.x;
    e.f = sc.from.f - 0.8;
    e.vx = 0;
    e.vy = sc.t < 0.4 ? 3 : 0;
    e.face = Math.PI / 2;
    e.anim = sc.t * 6;
    e.down = false;
    e.num = sc.kicker.num;
    e.skin = 1;
    e.juke = 0;
    e.lean = 0;
    e.diveT = 0;
    drawPlayer(ctx, this.cam, e, sc.kicker.uni, {});
    if (sc.returner && sc.t > sc.flight * 0.4) {
      const running = sc.t > sc.flight;
      e.x = running ? p.x : sc.to.x;
      e.f = running ? p.f : sc.to.f + 0.5;
      e.vx = 0;
      e.vy = running ? -8 : 0;
      e.face = -Math.PI / 2;
      e.anim = sc.t * 8;
      e.num = sc.returner.num;
      e.skin = sc.returner.skin;
      drawPlayer(ctx, this.cam, e, sc.returner.uni, { marker: running ? '#FFD23F' : null });
    }
    if (!(sc.returner && sc.t > sc.flight)) drawBall(ctx, this.cam, { x: p.x, f: p.f, z: p.z, ang: sc.t * 9 });
  }
}

function titleCase(s) {
  if (!s) return s;
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
