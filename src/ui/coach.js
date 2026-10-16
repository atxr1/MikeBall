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
import { drawField, drawGoalposts, drawFieldDecals, drawScrimmageLines } from '../render/field.js';
import { makeCrowd } from '../render/crowd.js';
import { Effects } from '../render/effects.js';
import { ready, image, setImageLoadListener } from '../render/images.js';
import { teamArt } from '../data/realleague.js';
import { Y_SQUASH } from '../render/camera.js';
import { uniform, clearSpriteCache } from '../render/pixelsprites.js';
import { drawSimPlayers, carrierMarker } from '../render/simdraw.js';
import { PlayDrawing } from './drawing.js';
import { playClockMethods } from './playclock.js';
import { drawFieldArt, playCardSVG } from '../render/playart.js';
import { DT } from '../sim/playsim.js';
import { h, clear } from './dom.js';
import { teamMarkSVG } from './emblems.js';
import { openRoster } from './roster.js';
import { KickScene } from './kickscene.js';

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
    clearSpriteCache(); // sprites from the last game's uniforms
    this.fx = new Effects();
    this.build();
    setImageLoadListener(() => { this.dirty = true; });
    this.preloadArt();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    this.showIntro();
  }

  preloadArt() {
    const home = this.game.teams.home;
    for (const side of ['home', 'away']) {
      const decal = this.uni(side).decal;
      if (decal) image(decal);
    }
    if (!home.art) return;
    image(teamArt(home, 'endzone.png'));
    image(teamArt(home, 'midfield_96.png'));
    if (home.stadium) image(`assets/stadiums/${home.stadium.id}_day.png`);
  }

  destroy() {
    this.dead = true;
    setImageLoadListener(null);
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
    this.el.pc = h('span', { class: 'bug-pc', 'aria-label': 'Play clock' });
    this.el.dd = h('span', { class: 'bug-dd' }, '');
    this.el.ticker = h('p', { class: 'ticker', 'aria-live': 'polite' }, '');

    this.canvas = h('canvas', { class: 'field', 'aria-label': 'Football field' });
    this.el.banner = h('div', { class: 'banner', hidden: true }, h('strong', { class: 'banner-head' }), h('p', { class: 'banner-text' }));
    this.el.toast = h('div', { class: 'toast', hidden: true });
    this.el.tapHint = h('p', { class: 'tap-hint', hidden: true }, 'Tap to continue');
    this.stage = h('div', { class: 'stage' }, this.canvas, this.el.ticker, this.el.toast, this.el.banner, this.el.tapHint);
    this.stage.addEventListener('pointerdown', (e) => { this.tapStart = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    this.stage.addEventListener('pointerup', (e) => {
      const s0 = this.tapStart;
      this.tapStart = null;
      if (!s0 || Math.hypot(e.clientX - s0.x, e.clientY - s0.y) > 12 || performance.now() - s0.t > 450) return;
      this.onStageTap();
    });

    this.el.tabs = h('div', { class: 'tabs', role: 'tablist' });
    this.el.cards = h('div', { class: 'cards', role: 'listbox', 'aria-label': 'Plays' });
    this.el.timeout = h('button', { class: 'act', onclick: () => this.userTimeout() }, 'Timeout');
    this.el.rosterBtn = h('button', { class: 'act', onclick: () => this.openRoster() }, 'Roster');
    this.el.menuBtn = h('button', { class: 'act', onclick: () => this.openMenu() }, 'Menu');
    this.el.go = h('button', { class: 'go', onclick: () => this.snap() }, 'Run play');
    this.el.sheet = h('section', { class: 'callsheet' },
      h('div', { class: 'callhead' }, this.el.tabs),
      this.el.cards,
      h('div', { class: 'actions' }, this.el.timeout, this.el.rosterBtn, this.el.menuBtn, this.el.go),
    );

    this.root = h('div', { class: 'coach' },
      h('header', { class: 'bug' }, teamBlock('away'), teamBlock('home'),
        h('div', { class: 'bug-state' }, h('div', { class: 'bug-time' }, this.el.q, this.el.pc, this.el.clock), this.el.dd)),
      this.stage,
      this.el.sheet,
    );
    this.app.root.append(this.root);
    this.drawing = new PlayDrawing(this);
    this.ctx = this.canvas.getContext('2d');
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.stage);
    this.resize();
    this.updateBug();
  }

  // The field is drawn into a low-res buffer (one "art pixel" = several
  // device pixels) and scaled up with nearest-neighbor for the pixel look.
  resize() {
    const r = this.stage.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const dw = Math.max(1, Math.round(r.width * dpr));
    const dh = Math.max(1, Math.round(r.height * dpr));
    this.dpr = dpr;
    this.artPx = Math.max(1, Math.round(dpr));
    const lw = Math.ceil(dw / this.artPx);
    const lh = Math.ceil(dh / this.artPx);
    const first = !this.lo;
    if (first) this.lo = document.createElement('canvas');
    const oldH = this.lo.height;
    // Assigning width/height clears a canvas, so only do it on a real change.
    if (this.canvas.width !== dw || this.canvas.height !== dh) {
      this.canvas.width = dw;
      this.canvas.height = dh;
      this.canvas.style.width = `${r.width}px`;
      this.canvas.style.height = `${r.height}px`;
    }
    if (this.lo.width !== lw || this.lo.height !== lh) {
      this.lo.width = lw;
      this.lo.height = lh;
    }
    this.loCtx = this.lo.getContext('2d');
    this.cam.resize(lw, lh);
    if (!this.crowd || this.crowd.w !== lw) {
      const g = this.game;
      const hype = this.crowd ? this.crowd.hype : 0;
      this.crowd = makeCrowd(g.teams.home, g.teams.away, lw, this.opts.seed || 1);
      this.crowdReady = false;
      this.crowd.hype = hype;
    }
    // The stage grows/shrinks at the bottom (playbook hides during plays):
    // shift the camera so the field doesn't jump, then let it ease back.
    if (!first && oldH !== lh && this.cam.s > 0) this.cam.f -= (lh - oldH) / (2 * this.cam.s * Y_SQUASH);
    // ResizeObserver runs before paint: redraw now so no blank frame shows.
    this.dirty = false;
    this.draw();
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
    this.updateClocks();
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
    // a timeout also saves you from a delay of game, so it's allowed with the clock stopped
    this.el.timeout.disabled = !on || this.game.timeouts[this.user] <= 0 || this.twoPoint || this.game.phase === 'pat';
  }

  showIntro() {
    const g = this.game;
    const home = g.teams.home;
    const url = home.art && home.stadium ? `assets/stadiums/${home.stadium.id}_day.png` : null;
    this.scene = url
      ? { kind: 'stadium', url, t: 0, dur: 2.6, name: home.stadium.name }
      : { kind: 'field', los: 25, ltg: null, offTeam: g.teams.away, defTeam: g.teams.home, showLines: false };
    this.cam.set(MID_X, 50, 0.95, true);
    if (url) this.setTicker(home.stadium.name);
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
    this.drawing.clear();
    if (this.cat === 'special') this.sel = null;
    const userOff = g.poss === this.user;
    const cpuSide = other(this.user);
    if (!this.twoPoint && g.phase !== 'pat' && cpuTimeout(g, cpuSide)) {
      g.useTimeout(cpuSide);
      this.toast(`Timeout, ${g.teams[cpuSide].abbr}`);
    }
    this.updateBug();
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
    this.el.go.textContent = userOff ? 'Run play' : 'Ready';
  }

  renderSheet(userOff) {
    const g = this.game;
    const cats = userOff ? OFF_CATS : DEF_CATS;
    if (!this.cat || !cats.find((c) => c.id === this.cat) || this.lastRole !== userOff) {
      this.cat = this.suggestCat(userOff);
    }
    this.lastRole = userOff;
    clear(this.el.tabs);
    for (const c of cats) {
      if (this.twoPoint && c.id === 'special') continue;
      const b = h('button', { class: 'tab', role: 'tab', 'aria-selected': String(c.id === this.cat) }, c.label);
      b.addEventListener('click', () => { this.cat = c.id; this.renderSheet(userOff); });
      this.el.tabs.append(b);
    }
    const plays = (userOff ? OFFENSE_PLAYS : DEFENSE_PLAYS).filter((p) => p.cat === this.cat);
    if (!this.sel || !plays.includes(this.sel) || this.playDisabled(this.sel)) this.sel = this.suggestPlay(plays, userOff);
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
    this.drawing.sync(this.sel);
    const mine = this.drawing.play();
    let o = userOff ? mine : this.cpuPlay;
    const d = userOff ? this.cpuPlay : mine;
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
    this.dirty = true;
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
  runSnap(o, d) {
    const g = this.game;
    if (!this.twoPoint) {
      const s = g.snap(Math.min(g.playClock, g.snapAt(g.poss)));
      this.updateBug();
      if (s.stop) { this.mode = 'idle'; return this.advance(); }
      if (s.events.includes('twoMinute')) this.toast('Two-minute warning');
      const bx = g.ballX;
      if (o.special === 'punt') return this.runKick('punt', g.punt(), bx);
      if (o.special === 'fg') return this.runKick('fg', g.fieldGoal(), bx);
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
      this.toast(p.special === 'punt' ? `${t.name} punt` : `${t.name} field goal try`);
      this.mode = 'idle';
      this.after(0.9, () => this.runSnap(p, null));
      return;
    }
    // Kneel or spike: defense call doesn't matter.
    this.toast(p.special === 'kneel' ? `${t.name} take a knee` : `${t.name} spike it`);
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
    if (sim.done) sim.settle(dt * this.speed);
    if (sim.done && !this.playEnded) {
      this.playEnded = true;
      this.after(0.75, () => this.finishPlay());
    }
  }

  finishPlay() {
    const g = this.game;
    const r = this.scene.sim.result;
    let out;
    this.cheer(r, g.offense);
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
    if (head && head !== 'First down') this.banner(head, out.text, 2.1, () => this.advance());
    else {
      if (head === 'First down') this.toast('First down');
      this.after(0.5, () => this.advance());
    }
  }

  // The home crowd gets loud when the home team makes a play.
  cheer(r, offSide) {
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
    this.setTicker(out.text);
  }

  kickRng() {
    if (!this._krng) this._krng = makeRng(this.opts.seed ^ 0x5eed);
    return this._krng;
  }

  updateKick(dt) {
    const sc = this.scene;
    sc.update(dt * this.speed);
    if (sc.done && !sc.reported) {
      sc.reported = true;
      const out = sc.out;
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

  dialog(title, text, buttons, { keepMode = false } = {}) {
    if (!keepMode) this.mode = 'idle';
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
    if (this.paused) return;
    this.paused = true;
    const wasEnabled = !this.el.go.disabled;
    this.dialog('Menu', null, [
      ['Resume', () => { this.paused = false; if (wasEnabled && this.mode === 'call') this.setSheetEnabled(true); }],
      ['Sim to the end', () => { this.paused = false; this.simToEnd(); }],
      ['Quit to title', () => this.app.showTitle()],
    ], { keepMode: true });
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
    if (this.paused) return;
    if (this.timers.length) {
      const due = [];
      for (const t of this.timers) { t.t -= dt; if (t.t <= 0) due.push(t); }
      if (due.length) {
        this.timers = this.timers.filter((t) => t.t > 0);
        for (const t of due) t.fn();
      }
    }
    const calling = this.mode === 'call';
    if (calling !== this.showingSheet) {
      this.showingSheet = calling;
      this.root.classList.toggle('live', !calling);
    }
    this.drawing.updateChip();
    if (this.scene && this.scene.kind === 'stadium' && this.scene.t < this.scene.dur) {
      this.scene.t += dt;
      this.dirty = true;
    }
    this.crowdT = (this.crowdT || 0) + dt;
    if (this.crowd && !this.crowdReady) this.crowdReady = this.crowd.prebuild();
    if (this.crowd && this.crowd.hype > 0) {
      this.crowd.hype = Math.max(0, this.crowd.hype - dt * 0.22);
      this.dirty = true;
    }
    if (this.mode === 'play' && this.scene.kind === 'sim') this.updatePlay(dt);
    else if (this.mode === 'idle' && this.scene?.kind === 'sim' && this.scene.sim.done && (this.scene.sim.post?.t ?? 0) < 2.5) {
      this.scene.sim.settle(dt * this.speed);
      this.dirty = true;
    }
    if (this.fx.update(dt)) this.dirty = true;
    this.tickPlayClock(dt);
    if (this.mode === 'kick' && this.scene.kind === 'kick') this.updateKick(dt);
    this.updateCamera();
    const moved = this.cam.update(dt, this.mode === 'play' ? 5 : 3.5);
    const live = this.mode === 'play' || this.mode === 'kick';
    if (live || moved || this.dirty) {
      this.dirty = false;
      this.draw();
    }
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
      const p = sc.focus();
      this.cam.set(p.x, p.f + 3, 1.15);
    }
  }

  draw() {
    const sc = this.scene;
    if (!sc || !this.loCtx) return;
    const out = this.ctx;
    const k = this.artPx;
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.imageSmoothingEnabled = false;
    if (sc.kind === 'stadium' && this.drawStadium(out, sc)) return;
    const g = this.game;
    const ctx = this.loCtx;
    ctx.imageSmoothingEnabled = false;
    drawField(ctx, this.cam, { offTeam: sc.offTeam, defTeam: sc.defTeam, homeTeam: g.teams.home, los: sc.los, ltg: sc.ltg, showLines: false, crowd: this.crowd, t: this.crowdT || 0 });
    out.drawImage(this.lo, 0, 0, this.lo.width * k, this.lo.height * k);
    drawFieldDecals(out, this.cam, k, g.teams.home, sc.offTeam);
    // Players and overlays: every coordinate is a whole low-res pixel, so
    // drawing at an integer scale keeps them pixel-exact without a buffer.
    out.setTransform(k, 0, 0, k, 0, 0);
    out.imageSmoothingEnabled = false;
    if (sc.showLines) drawScrimmageLines(out, this.cam, sc.los, sc.ltg);
    if (sc.kind === 'sim') this.drawSim(out, sc);
    else if (sc.kind === 'kick') {
      sc.draw(out, this.cam, sc.uniK, sc.uniR, carrierMarker);
      this.fx.pullList(sc, sc.fxEvents);
      this.fx.draw(out, this.cam);
    }
    drawGoalposts(out, this.cam);
    out.setTransform(1, 0, 0, 1, 0, 0);
  }

  // Pregame: slow pan across the home stadium. Returns false until the art
  // has loaded (the field is drawn instead).
  drawStadium(out, sc) {
    const img = ready(sc.url);
    if (!img) return false;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (!sc.edge) {
      // sample the sky (top row) and ground (bottom row) to fill around it
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = img.height;
      const cx = c.getContext('2d');
      cx.drawImage(img, img.width >> 1, 0, 1, img.height, 0, 0, 1, img.height);
      const d = cx.getImageData(0, 0, 1, img.height).data;
      const rgb = (i) => `rgb(${d[i]},${d[i + 1]},${d[i + 2]})`;
      sc.edge = { sky: rgb(0), ground: rgb((img.height - 1) * 4) };
    }
    const scale = Math.max(W / img.width, (H * 0.58) / img.height);
    const dw = Math.round(img.width * scale);
    const dh = Math.round(img.height * scale);
    const y = Math.round((H - dh) * 0.4);
    out.fillStyle = sc.edge.sky;
    out.fillRect(0, 0, W, y + 1);
    out.fillStyle = sc.edge.ground;
    out.fillRect(0, y + dh - 1, W, H - y - dh + 1);
    const u = Math.min(1, sc.t / sc.dur);
    const e = u * u * (3 - 2 * u);
    out.drawImage(img, Math.round(-(dw - W) * (0.08 + 0.84 * e)), y, dw, dh);
    return true;
  }

  drawSim(ctx, sc) {
    const cam = this.cam;
    if (this.mode === 'call' && sc.artSide) drawFieldArt(ctx, cam, sc.sim, sc.artSide, sc.los);
    const live = this.mode === 'play' || this.mode === 'idle';
    drawSimPlayers(ctx, cam, sc, live);
    if (live) {
      this.fx.pull(sc.sim, sc.los);
      this.fx.draw(ctx, cam);
    }
    if (this.mode === 'call') this.drawing.drawStroke(ctx, cam, sc.los);
  }

}

Object.assign(CoachScreen.prototype, playClockMethods);
