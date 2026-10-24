// The coach view: broadcast scoreboard on top, live field in the middle,
// play-calling sheet at the bottom. Drives the Game state machine.

import { Game, other } from '../game/rules.js';
import { makePlaySim } from '../game/autoplay.js';
import { cpuOffense, cpuDefense, cpuPat, cpuOnside, cpuTimeout } from '../game/cpu.js';
import { OFFENSE_PLAYS, DEFENSE_PLAYS, OFF_CATS, DEF_CATS, offPlay, FORMATIONS } from '../data/playbook.js';
import { myPlays } from './myplays.js';
import { fgDistance, maxFgRange, comfortableFgRange } from '../game/kicks.js';
import { makeRng } from '../core/rng.js';
import { MID_X, fmtClock, lerp } from '../core/util.js';
import { Camera } from '../render/camera.js';
import { drawField, drawGoalposts, drawFieldDecals, drawScrimmageLines } from '../render/field.js';
import { makeCrowd } from '../render/crowd.js';
import { makeSideline, drawSidelinePeople, sidelineTick } from '../render/sideline.js';
import { Effects } from '../render/effects.js';
import { ScoreShow } from '../render/scoreshow.js';
import { image, setImageLoadListener } from '../render/images.js';
import { teamArt } from '../data/realleague.js';
import { Y_SQUASH } from '../render/camera.js';
import { matchupUniforms } from '../render/pixelsprites.js';
import { clearRigCache, rigFrame } from '../render/rig.js';
import { drawSimPlayers, carrierMarker, clearOutfits } from '../render/simdraw.js';
import { PlayDrawing } from './drawing.js';
import { PassAim } from './passaim.js';
import { Scorebug, titleCard, fitPixelCanvas, preloadBroadcast, netArt, loadLayouts } from './broadcast.js';
import { broadcastFor } from '../data/broadcast.js';
import { playClockMethods } from './playclock.js';
import { presentationMethods } from './presentation.js';
import { kickMethods } from './coachkicks.js';
import { menuMethods } from './coachmenus.js';
import { stageMethods } from './coachstage.js';
import { replayUiMethods } from './coachreplay.js';
import { drawFieldArt, playCardSVG } from '../render/playart.js';
import { DT } from '../sim/playsim.js';
import { h, clear } from './dom.js';
import { teamMarkSVG } from './emblems.js';

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
      playoff: !!opts.playoff,
    });
    this.opts = opts;
    // who's carrying the game (Sunday afternoon on CBS/FOX, TNF on Prime...):
    // a season game brings its own window from the schedule
    this.broadcast = opts.broadcast || broadcastFor(opts.slot || 'sun_early', this.game.teams.home, this.game.teams.away);
    preloadBroadcast(this.broadcast.net);
    this.cam = new Camera();
    this.mode = 'idle';
    this.timers = [];
    this.scene = null;
    this.speed = 1;
    this.twoPoint = false;
    this.sel = null;
    this.cat = null;
    this.uniCache = new Map();
    clearRigCache(); // sprites from the last game's uniforms
    clearOutfits();
    this.fx = new Effects();
    this.show = new ScoreShow(this.game.teams.home);
    this.homePts = 0; // home score the stadium show has celebrated
    this.initStage();
    const gm = this.game;
    this.sideline = makeSideline(gm.teams, { home: this.uni('home'), away: this.uni('away') }, gm.rosters, opts.seed || 1);
    this.build();
    setImageLoadListener(() => { this.dirty = true; this.updateScorebug(); });
    loadLayouts().then(() => this.updateScorebug());
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
    if (home.stadium) image(`assets/stadiums/${home.stadium.id}_${this.broadcast.night ? 'night' : 'day'}.png`);
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
    this.el.tvLogo = h('img', { class: 'tv-logo', src: netArt(this.broadcast.net, 'logo_32.png'), alt: this.broadcast.netName, width: 32, height: 32 });
    this.el.tvLogo.addEventListener('error', () => this.el.tvLogo.remove());
    this.stage = h('div', { class: 'stage' }, this.canvas, this.el.ticker, this.el.toast, this.el.banner, this.el.tapHint, this.el.tvLogo);
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
      (this.el.bug = h('header', { class: 'bug' }, teamBlock('away'), teamBlock('home'),
        h('div', { class: 'bug-state' }, h('div', { class: 'bug-time' }, this.el.q, this.el.pc, this.el.clock), this.el.dd))),
      this.stage,
      this.el.sheet,
    );
    this.app.root.append(this.root);
    this.scorebug = new Scorebug(this.broadcast.net, g.teams.home, g.teams.away);
    this.el.bug.append(this.scorebug.canvas);
    this.drawing = new PlayDrawing(this);
    this.aim = new PassAim(this);
    this.aim.attach(this.canvas);
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
      this.crowd.night = this.broadcast.night;
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
          return this.dialog(g.freeKick ? 'Free kick' : 'Kickoff', g.freeKick ? 'After the safety, from your own 20. How do you want to kick it?' : 'How do you want to kick it?', [
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
    this.flagUp = false;
    this.stageFresh = true;
    this.wantSnap = false;
    this.reported = null;
    // where the last play left everyone (a no-huddle offense lines up from there)
    this.lastPlaySim = this.scene && this.scene.kind === 'sim' && this.scene.sim.done ? this.scene.sim : null;
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
      // against a no-huddle offense there's no time to change personnel
      const last = this.lastCpuDef;
      if (last && g.tempoFor(g.poss) === 'hurry' && this.lastSnapPoss === g.poss && last.front !== this.cpuPlay.front) this.cpuPlay = last;
      this.cpuBase = this.cpuPlay;
    } else {
      this.cpuBase = null;
      let p = cpuOffense(g, cpuSide);
      if (this.twoPoint && p.cat === 'special') p = offPlay('slants');
      this.cpuPlay = p;
      if (!this.twoPoint && p.cat === 'special') return this.cpuSpecial(p);
    }
    this.renderSheet(userOff);
    this.setSheetEnabled(true);
    // On defense there's nothing to press: the offense snaps it when it's
    // ready, and you change the call (or the rush lanes) until it does. The
    // play clock runs fast enough that the huddle takes a few seconds, not
    // forty (less against the hurry-up); it stops while you're drawing.
    this.el.go.textContent = 'Run play';
    this.el.go.hidden = !userOff;
    this.tryWait = 0;
    this.cpuLate = null; // (see tickPlayClock: decided at the snap point)
    this.cpuDecided = false;
    if (!userOff) {
      const left = Math.max(0, g.playClock - g.snapAt(cpuSide));
      this.defRate = Math.max(1, left / (g.tempoFor(cpuSide) === 'hurry' ? 3.5 : 8));
    }
  }

  renderSheet(userOff) {
    const g = this.game;
    const mine = myPlays(userOff ? 'O' : 'D');
    const cats = [...(userOff ? OFF_CATS : DEF_CATS), ...(mine.length && !this.twoPoint ? [{ id: 'mine', label: 'Mine' }] : [])];
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
    const plays = this.cat === 'mine' ? mine : (userOff ? OFFENSE_PLAYS : DEFENSE_PLAYS).filter((p) => p.cat === this.cat);
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
    this.centerSelectedCard();
    this.buildPreview();
  }

  // Scroll the card row so the selected play sits in the middle (only
  // possible while the row is showing; called again when it reappears).
  centerSelectedCard() {
    const row = this.el.cards;
    const sel = [...row.children].find((c) => c.getAttribute('aria-selected') === 'true');
    if (!sel || !row.clientWidth) return;
    row.scrollLeft = Math.max(0, sel.offsetLeft - row.offsetLeft - (row.clientWidth - sel.offsetWidth) / 2);
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
      const late = (g.quarter === 2 || g.quarter >= 4) && g.clock <= 10;
      if (fg && fgDistance(g.ballOn) <= (late ? maxFgRange(g.kicker(this.user)) - 2 : comfortableFgRange(g.kicker(this.user)))) return fg;
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
    if (userOff) this.matchDefense(mine);
    let o = userOff ? mine : this.cpuPlay;
    const d = userOff ? this.cpuPlay : mine;
    let artSide = userOff ? 'O' : 'D';
    const special = o.cat === 'special' && (o.special === 'punt' || o.special === 'fg');
    // a kick: the huddles stay put (the kicking unit lines up when the kick
    // scene starts); nobody jumps into some other formation meanwhile
    this.pre.setHoldHuddle(special);
    if (special) {
      artSide = null;
      if (this.pre.ctx && !this.stageFresh && this.scene && this.scene.kind === 'sim') {
        this.scene.artSide = null;
        this.dirty = true;
        return;
      }
      // something to stand the huddles up with: the personnel already out there
      o = this.liveO && this.liveO.cat !== 'special' && g.poss === this.lastSnapPoss ? this.liveO : offPlay('dive');
    }
    const sim = makePlaySim(g, o, d, makeRng(7));
    this.setSimScene(sim, artSide);
    this.stagePreview(sim);
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
      markSide: off === this.user ? 'O' : 'D',
      showLines: true,
    };
  }

  uni(side) {
    if (!this.uniCache.has(side)) {
      const m = matchupUniforms(this.game.teams.home, this.game.teams.away);
      this.uniCache.set('home', m.home);
      this.uniCache.set('away', m.away);
    }
    return this.uniCache.get(side);
  }

  // ------------------------------------------------------------------ snapping
  runSnap(o, d) {
    const g = this.game;
    let snapFoul = !this.twoPoint && o.cat !== 'special' && this.twelveMen() ? { key: 'subs' } : null;
    if (!this.twoPoint) {
      const s = g.snap(Math.min(g.playClock, g.snapAt(g.poss)));
      this.updateBug();
      if (s.stop) { this.mode = 'idle'; return this.advance(); }
      if (s.events.includes('twoMinute')) this.twoMinuteCard();
      const bx = g.ballX;
      if (o.special === 'punt') return this.runKick('punt', g.punt(), bx);
      if (o.special === 'fg') return this.runKick('fg', g.fieldGoal(), bx);
      const los0 = g.ballOn;
      const pen = snapFoul ? null : g.preSnapPenalty();
      if (pen && pen.live) snapFoul = { key: pen.key };
      else if (pen) {
        // stage it: the flinch, the flag, the whistle, the signal
        g.finishNext();
        this.lastSnapPoss = g.poss;
        this.lastSnapLos = los0;
        const sim = makePlaySim(g, o, d, null, { ballOn: los0, preFoul: { key: pen.key } });
        this.pre.snapped(sim, g.poss); // the same men are out there for the next call
        this.setSimScene(sim, null);
        this.scene.los = los0;
        this.preFoulPen = pen;
        this.flagUp = true;
        this.updateScorebug();
        this.acc = 0;
        this.playEnded = false;
        this.mode = 'play';
        return;
      }
    }
    this.liveO = o;
    this.liveD = d;
    this.setTicker(''); // last play's line goes away while this one runs
    if (g.poss === this.user) this.lastCpuDef = d;
    // Retro Bowl-style passing (Settings): you throw your own passes
    const manualPass = this.app.settings.passing === 'retro' && g.poss === this.user && o.cat === 'pass';
    const extra = { ...(this.twoPoint ? { noFouls: true } : snapFoul ? { snapFoul } : null), ...(manualPass ? { manualPass } : null) };
    const sim = makePlaySim(g, o, d, null, extra);
    this.aim.reset();
    if (manualPass) this.aim.hint();
    this.pre.snapped(sim, g.poss);
    this.lastSnapPoss = g.poss;
    this.lastSnapLos = g.ballOn;
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
    let hold = 0.75;
    if (sim.fouls.length && !this.flagUp) {
      // the flag's out: it goes up on the scoreboard right away
      this.flagUp = true;
      this.updateScorebug();
    }
    if (sim.done && !this.playEnded) {
      // the officials rule at the whistle; everyone reacts to the ruling
      this.ruled = this.preFoulPen || this.twoPoint ? null : this.ruleOnPlay(sim.result);
      const shown = this.ruled || sim.result;
      const c = this.celebrationFor(sim, shown);
      if (c) {
        sim.celebrate(c);
        if (c.kind === 'td') this.cheer(shown, this.game.offense); // the crowd reacts at the whistle
        hold = { td: 1.8, big: 1.35, first: 1.15, sack: 1.25, int: 1.3, takeaway: 1.2 }[c.kind] || 0.75;
      }
      // a flag: give the referee time to announce it
      if (sim.fouls.length) hold = Math.max(hold, 3.2);
    }
    if (sim.done) sim.settle(dt * this.speed);
    if (sim.done && !this.playEnded) {
      this.playEnded = true;
      this.after(hold, () => this.finishPlay());
    }
  }

  finishPlay() {
    const g = this.game;
    const r = this.scene.sim.result;
    let out;
    if (this.preFoulPen) {
      // a dead-ball foul: already enforced, the play never happened
      const pen = this.preFoulPen;
      this.preFoulPen = null;
      this.mode = 'idle';
      this.updateBug();
      this.setTicker(`Flag: ${pen.text}`);
      return this.penaltyBanner(pen, () => this.advance());
    }
    // the officials' ruling, made at the whistle (a close one may be wrong:
    // src/game/replay.js)
    const ruled = this.ruled || r;
    this.ruled = null;
    this.cheer(ruled, g.offense);
    if (this.twoPoint) {
      this.review = null;
      out = g.applyTwoPoint(r);
      this.twoPoint = false;
    } else {
      out = g.applyPlay(ruled, this.liveO, this.liveD);
    }
    this.syncHomeScore();
    this.mode = 'idle';
    this.updateBug();
    // the flag first, so it's never the part that gets cut off
    this.setTicker(out.penalty ? `Flag: ${out.penalty.text} — ${out.text.split(' — FLAG: ')[0]}` : out.text);
    if (out.flags && out.flags.includes('twoMinute')) this.twoMinuteCard();
    const head = out.headline;
    const next = () => this.afterRuling(out);
    if (out.penalty) this.penaltyBanner(out.penalty, next, out.kind !== 'penalty' || out.flagHeadline ? head : null);
    else if (head && head !== 'First down') this.banner(head, out.text, 2.1, next);
    else this.after(0.5, next);
  }

  onStageTap() {
    if (this.bannerThen) {
      this.bannerToken = null;
      this.bannerThen();
    }
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
      // the cards were hidden while the play ran: bring the pick into view
      if (calling) this.centerSelectedCard();
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
    else if (this.mode === 'idle' && this.scene?.kind === 'sim' && this.scene.sim.done && (this.scene.sim.post?.t ?? 0) < 4.5) {
      this.scene.sim.settle(dt * this.speed);
      this.dirty = true;
    }
    if (this.fx.update(dt)) this.dirty = true;
    if (sidelineTick(this.sideline, dt)) this.dirty = true;
    if (this.show.active) {
      this.show.update(dt, this.cam);
      this.dirty = true;
    }
    if ((this.mode === 'call' || this.mode === 'set') && this.pre.update(dt)) this.dirty = true;
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
      // throwing it yourself: look downfield at the receivers (and the target)
      const look = sim.opts.manualPass && sim.canUserThrow() ? this.aim.lookAt(sim) : null;
      if (look) { x = look.x; f = sc.los + look.y - 3; }
      this.cam.set(x, f + 3, 1.36);
    } else if (sc.kind === 'kick') {
      const p = sc.focus();
      this.cam.set(p.x, p.f + 3, 1.15);
    }
  }

  draw() {
    const sc = this.scene;
    if (!sc || !this.loCtx) return;
    rigFrame();
    const out = this.ctx;
    const k = this.artPx;
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.imageSmoothingEnabled = false;
    if (sc.kind === 'stadium' && this.drawStadium(out, sc)) return;
    const g = this.game;
    const ctx = this.loCtx;
    ctx.imageSmoothingEnabled = false;
    drawField(ctx, this.cam, { offTeam: sc.offTeam, defTeam: sc.defTeam, homeTeam: g.teams.home, los: sc.los, ltg: sc.ltg, showLines: false, crowd: this.crowd, t: this.crowdT || 0, sideline: this.sideline });
    out.drawImage(this.lo, 0, 0, this.lo.width * k, this.lo.height * k);
    drawFieldDecals(out, this.cam, k, g.teams.home, sc.offTeam);
    // Players and overlays: every coordinate is a whole low-res pixel, so
    // drawing at an integer scale keeps them pixel-exact without a buffer.
    out.setTransform(k, 0, 0, k, 0, 0);
    out.imageSmoothingEnabled = false;
    const topEnd = sc.offTeam && sc.offTeam.id !== g.teams.home.id ? 'S' : 'N';
    this.show.drawStatic(out, this.cam, topEnd);
    if (sc.showLines) drawScrimmageLines(out, this.cam, sc.los, sc.ltg);
    this.drawSidelines(out, sc);
    if (sc.kind === 'sim') this.drawSim(out, sc);
    else if (sc.kind === 'kick') {
      sc.draw(out, this.cam, sc.uniK, sc.uniR, carrierMarker);
      this.fx.pullList(sc, sc.fxEvents);
      this.fx.draw(out, this.cam);
    }
    drawGoalposts(out, this.cam);
    this.show.draw(out, this.cam);
    out.setTransform(1, 0, 0, 1, 0, 0);
  }

  // Benches, coaches, staff, cameras and the chain crew (src/render/sideline.js).
  drawSidelines(out, sc) {
    const g = this.game;
    const onField = this._onField || (this._onField = new Set());
    onField.clear();
    for (const p of (sc.kind === 'sim' ? sc.sim.players : sc.players || [])) onField.add(p.rec.id);
    drawSidelinePeople(out, this.cam, this.sideline, {
      homeBall: !sc.offTeam || sc.offTeam.id === g.teams.home.id,
      now: this.crowdT || 0,
      los: sc.los,
      ltg: sc.kind === 'sim' && !this.twoPoint ? g.ltg : null,
      down: g.down,
      // the play on screen's half (the last play of the second quarter stays
      // up through the halftime banner)
      half: (sc.kind === 'sim' && sc.sim.opts.half) || (g.quarter >= 3 ? 2 : 1),
      onField,
      unis: { home: this.uni('home'), away: this.uni('away') },
    });
  }

  drawSim(ctx, sc) {
    const cam = this.cam;
    if (this.mode === 'call' && sc.artSide) drawFieldArt(ctx, cam, sc.sim, sc.artSide, sc.los);
    const live = this.mode === 'play' || this.mode === 'idle';
    drawSimPlayers(ctx, cam, sc, live, this.stageOverride());
    if (this.mode === 'call' || this.mode === 'set') this.pre.drawLeaving(ctx, cam, sc.los, (team) => this.uni(team));
    if (live) {
      this.fx.pull(sc.sim, sc.los);
      this.fx.draw(ctx, cam);
      if (this.mode === 'play') this.aim.draw(ctx, cam, sc.los);
    }
    if (this.mode === 'call') this.drawing.drawStroke(ctx, cam, sc.los);
  }

}

Object.assign(CoachScreen.prototype, playClockMethods, presentationMethods, kickMethods, menuMethods, stageMethods, replayUiMethods);
