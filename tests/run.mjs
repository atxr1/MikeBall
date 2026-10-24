// Node test runner: `node tests/run.mjs`
// Checks the sim stays in sane ranges and the rules engine plays full games.

import { generateLeague } from '../src/data/roster.js';
import { TEAMS } from '../src/data/teams.js';
import { computeBadges, TIERS } from '../src/game/badges.js';
import { Game } from '../src/game/rules.js';
import { simulateGame } from '../src/game/autoplay.js';
import { runBalance } from '../tools/balance.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { fromLeagueJson } from '../src/data/realleague.js';
import { defenseLineup, offenseLineup } from '../src/game/personnel.js';
import { PlaySim } from '../src/sim/playsim.js';
import { OFFENSE_PLAYS, DEFENSE_PLAYS } from '../src/data/playbook.js';
import { makeRng } from '../src/core/rng.js';
import { applyEdits, editFromStroke, editFromTap, editFromDoubleTap } from '../src/game/playedit.js';
import { broadcastFor } from '../src/data/broadcast.js';
import { playerOfTheGame, seasonAwards } from '../src/game/awards.js';
import { resolveHonors, honorsFor } from '../src/data/honors.js';
import { catchOdds, tackleOdds, proximity } from '../src/sim/odds.js';
import { fieldGoal, extraPoint, kickoff } from '../src/game/kicks.js';
import { PreSnap } from '../src/ui/presnap.js';
import { onFieldRuling, settleRuling } from '../src/game/replay.js';
import { cpuFourthDown } from '../src/game/cpu.js';
import { makePlaySim } from '../src/game/autoplay.js';
import { cpuMatchDefense } from '../src/game/cpu.js';
import { offPlay, defPlay } from '../src/data/playbook.js';
import { protectionPairs } from '../src/sim/blocking.js';

let failed = 0;
let passed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${detail}`); }
}
const between = (v, a, b) => v >= a && v <= b;

console.log('rosters & badges');
const league = generateLeague(2026);
const all = Object.values(league).flatMap((r) => r.players);
check('32 teams', Object.keys(league).length === 32);
check('53-man rosters', Object.values(league).every((r) => r.players.length === 53));
computeBadges(all);
for (const stat of ['speed', 'strength', 'skill']) {
  const fa = all.filter((p) => p.badges[stat] === 'franchise').length;
  check(`franchise ${stat} count is 5-6`, fa >= 5 && fa <= 6, `got ${fa}`);
}
check('every player has 3 valid badges', all.every((p) => ['speed', 'strength', 'skill'].every((s) => TIERS.includes(p.badges[s]))));
const jersey = Object.values(league).every((r) => new Set(r.players.map((p) => p.num)).size === r.players.length);
check('unique jersey numbers per team', jersey);

console.log('play sim balance (1500 plays)');
const s = runBalance(1500, 99);
const ypc = s.run.yds / s.run.n;
const comp = s.pass.comp / s.pass.att;
const sackRate = s.pass.sacks / s.pass.dropbacks;
const intRate = s.pass.int / s.pass.att;
check('yards per carry 3.0-6.0', between(ypc, 3.0, 6.0), ypc.toFixed(2));
check('completion 50-72%', between(comp, 0.5, 0.72), (comp * 100).toFixed(1));
check('sack rate 3-12%', between(sackRate, 0.03, 0.12), (sackRate * 100).toFixed(1));
check('INT rate 1-5%', between(intRate, 0.01, 0.05), (intRate * 100).toFixed(1));

console.log('player AI');
{
  // protection: linemen pair with the rushers in order across; with more
  // rushers than linemen the widest goes unblocked (a back's man)
  const at = (xs) => xs.map((x) => ({ x }));
  const B = at([22.8, 24.7, 26.7, 28.6, 30.6]);
  const R5 = at([20.4, 23.2, 26.7, 30.1, 33.0]);
  const p5 = protectionPairs(B, R5, 26.7);
  check('five linemen take a 3-4 front\'s five rushers in order (the edge rushers too)', p5.length === 5 && p5.every(([b, r]) => B.indexOf(b) === R5.indexOf(r)));
  const R6 = at([18.0, 22.0, 25.0, 28.0, 31.0, 34.5]);
  const p6 = protectionPairs(B, R6, 26.7);
  check('six rushers: the widest is left for the back', p6.length === 5 && !p6.some(([, r]) => r === R6[0]), p6.map(([, r]) => r.x).join(','));
  // the passer projects each receiver where he really goes: settle,
  // continue and sit route ends
  const real = existsSync('assets/data/league.json') ? fromLeagueJson(JSON.parse(readFileSync('assets/data/league.json', 'utf8'))) : null;
  const L = real ? real.rosters : league;
  const lid = Object.keys(L);
  let worst = 0;
  for (const [pid, slot] of [['curl_flat', 'Y'], ['quick_outs', 'SL'], ['four_verts', 'X'], ['mesh', 'SL'], ['curl_flat', 'X']]) {
    const o = offPlay(pid);
    for (let k = 0; k < 4; k++) {
      const sim = new PlaySim({ offPlay: o, defPlay: defPlay('cov3_43'), offLineup: offenseLineup(L[lid[k]], o.formation), defLineup: defenseLineup(L[lid[k + 9]], '43'), ballOn: 30, ballX: [20, 26.67, 33.3, 26.67][k], rng: makeRng(70 + k), noFouls: true });
      sim.opts.manualPass = true;
      const r = sim.bySlot[slot];
      while (sim.t < 1.6) sim.step();
      const P = sim.routeAhead(r, 0.6);
      while (sim.t < 2.2) sim.step();
      worst = Math.max(worst, Math.hypot(P.x - r.x, P.y - r.y));
    }
  }
  check('the passer\'s projection of a route matches where the receiver runs (within 1.5 yd)', worst < 1.5, worst.toFixed(2));

  // near the goal line: routes end along the end line, the passer projects
  // the same, and nobody without the ball runs out the back
  let worstEZ = 0;
  let outBack = 0;
  for (const ballOn of [96, 98]) {
    for (const [pid, slot] of [['four_verts', 'X'], ['smash', 'SL'], ['dagger', 'X'], ['mesh', 'Z']]) {
      const o = offPlay(pid);
      for (let k = 0; k < 3; k++) {
        const sim = new PlaySim({ offPlay: o, defPlay: defPlay('cov3_43'), offLineup: offenseLineup(L[lid[k]], o.formation), defLineup: defenseLineup(L[lid[k + 9]], '43'), ballOn, ballX: [20, 26.67, 33.3][k], rng: makeRng(80 + k), noFouls: true });
        sim.opts.manualPass = true;
        const r = sim.bySlot[slot];
        const look = (t) => { while (sim.t < t && !sim.done) { sim.step(); for (const p of sim.players) if (p.y > sim.endY + 0.3 && p !== sim.ball.holder) outBack++; } };
        look(1.8);
        const P = sim.routeAhead(r, 0.6);
        look(2.4);
        if (!sim.done) worstEZ = Math.max(worstEZ, Math.hypot(P.x - r.x, P.y - r.y));
        look(4.5);
      }
    }
  }
  check('in the end zone the passer\'s projection still holds (within 2 yd)', worstEZ < 2, worstEZ.toFixed(2));
  check('nobody runs out the back of the end zone', outBack === 0, outBack);
}

console.log('full CPU games');
const pts = [];
let ties = 0;
let ok = true;
for (let i = 0; i < 16; i++) {
  const h = TEAMS[i * 2];
  const a = TEAMS[i * 2 + 1];
  const g = new Game({ homeTeam: h, awayTeam: a, homeRoster: league[h.id], awayRoster: league[a.id], userSide: null, qLen: 15, seed: 1000 + i });
  simulateGame(g);
  if (!g.over) ok = false;
  const sumQ = (side) => g.qScores[side].reduce((x, y) => x + y, 0);
  if (sumQ('home') !== g.score.home || sumQ('away') !== g.score.away) ok = false;
  pts.push(g.score.home, g.score.away);
  if (g.score.home === g.score.away) ties++;
}
const avg = pts.reduce((x, y) => x + y, 0) / pts.length;
check('all games finish with consistent quarter scores', ok);
check('avg points per team 10-45 (15-min quarters)', between(avg, 10, 45), avg.toFixed(1));
console.log(`  (avg ${avg.toFixed(1)} pts/team, ties ${ties}, scores ${pts.join(' ')})`);

console.log('play clock');
{
  const mk = () => new Game({ homeTeam: TEAMS[0], awayTeam: TEAMS[1], homeRoster: league[TEAMS[0].id], awayRoster: league[TEAMS[1].id], userSide: 'home', qLen: 15, seed: 5 });
  const g = mk();
  g.phase = 'play';
  g.poss = 'home';
  g.ballOn = 30;
  g.ltg = 40;
  g.finishNext();
  check('40-second clock after a play', g.playClock === 40);
  g.clockRunning = true;
  const c0 = g.clock;
  g.snap();
  check('normal tempo runs 36 seconds off a running clock', Math.abs(c0 - g.clock - 36) < 1e-6, `${c0 - g.clock}`);
  g.finishNext();
  g.useTimeout('away');
  check('25-second clock after a timeout, game clock stopped', g.playClock === 25 && !g.clockRunning);
  g.resetPlayClock(40);
  const ev = g.tickBetweenPlays(40);
  check('delay of game when the play clock hits zero', ev.includes('delay'));
  const before = g.ballOn;
  g.delayOfGame();
  check('delay of game: 5 yards back, 25-second clock', g.ballOn === before - 5 && g.playClock === 25 && g.down === 1);
  g.quarter = 2;
  g.clock = 125;
  g.clockRunning = true;
  g.resetPlayClock(40);
  const ev2 = g.tickBetweenPlays(10);
  check('two-minute warning stops the clock between plays', ev2.includes('twoMinute') && g.clock === 120 && !g.clockRunning && g.playClock === 25);
  g.changePossession(50);
  g.finishNext();
  check('25-second clock after a change of possession', g.playClock === 25);
}

console.log('play drawing');
{
  const T0 = TEAMS[2].id;
  const T1 = TEAMS[3].id;
  const off = (id) => OFFENSE_PLAYS.find((p) => p.id === id);
  const def = (id) => DEFENSE_PLAYS.find((p) => p.id === id);
  const mk = (o, d, seed = 3) => new PlaySim({ offPlay: o, defPlay: d, offLineup: offenseLineup(league[T0], o.formation), defLineup: defenseLineup(league[T1], d.front), ballOn: 40, ballX: 26.67, rng: makeRng(seed) });
  const o = off('slants');
  const d = def('cov3_43') || DEFENSE_PLAYS.find((p) => p.cat === 'zone');
  let sim = mk(o, d);
  const x = sim.bySlot.X;
  const stroke = [{ x: x.x, y: 4 }, { x: x.x, y: 9 }, { x: x.x + 6, y: 12 }];
  const r1 = editFromStroke(sim, o, x, stroke);
  check('drawing from a receiver makes a custom route', r1 && r1.assign.r === 'custom' && r1.assign.pts.length >= 2, JSON.stringify(r1));
  sim = mk(applyEdits(o, { [r1.slot]: r1.assign }), d);
  const last = sim.bySlot.X.pts[sim.bySlot.X.pts.length - 1];
  check('the sim runs the drawn route', Math.abs(last.x - (x.x + 6)) < 0.6 && Math.abs(last.y - 12) < 0.6, JSON.stringify(last));
  const lt = sim.bySlot.LT;
  const foe = sim.defense.find((q) => q.pos === 'LB');
  const r2 = editFromStroke(sim, o, lt, [{ x: (lt.x + foe.x) / 2, y: 1 }, { x: foe.x, y: foe.y }]);
  sim = mk(applyEdits(o, { [r1.slot]: r1.assign, [r2.slot]: r2.assign }), d);
  check('drawing a lineman onto a defender assigns that block', r2 && r2.assign.target === foe.slot && sim.bySlot.LT.target === sim.defBySlot[foe.slot]);
  const tap = editFromTap(sim, o, o, sim.bySlot.Z);
  check('tapping a receiver switches him to blocking', tap && tap.assign.t === 'passpro');
  const tap2 = editFromTap(sim, applyEdits(o, { Z: tap.assign }), o, sim.bySlot.Z);
  check('tapping again puts his route back', tap2 && tap2.assign.t === 'route' && tap2.assign.r === o.assign.Z.r);
  // a saved play (edits baked in, stored as JSON) edited again keeps its first edits
  const saved = { ...applyEdits(o, JSON.parse(JSON.stringify({ [r1.slot]: r1.assign }))), id: 'my-test', custom: true };
  const again = applyEdits(saved, { [r2.slot]: r2.assign });
  const s2 = mk(again, d);
  check('a saved play edited again keeps its drawn route in the reads', again.editedSlots.includes(r1.slot) && again.editedSlots.includes(r2.slot) && s2.progression.includes(s2.bySlot.X));
  // defense
  const cb = sim.defense.find((q) => q.slot === 'CB_L');
  const target = sim.bySlot.SL || sim.bySlot.Y;
  const r3 = editFromStroke(sim, d, cb, [{ x: (cb.x + target.x) / 2, y: 3 }, { x: target.x, y: target.y }]);
  const lb = sim.defense.find((q) => q.slot === 'MIKE');
  const r4 = editFromStroke(sim, d, lb, [{ x: lb.x + 4, y: 7 }, { x: lb.x + 8, y: 9 }]);
  const de = sim.defense.find((q) => q.slot === 'DE_L');
  const r5 = editFromStroke(sim, d, de, [{ x: de.x + 2, y: 0.5 }, { x: de.x + 3, y: -1 }]);
  const ed = applyEdits(d, { [r3.slot]: r3.assign, [r4.slot]: r4.assign, [r5.slot]: r5.assign });
  sim = mk(o, ed);
  check('drawing a DB to a receiver locks man coverage on him', r3.assign.t === 'man' && sim.defBySlot.CB_L.target === sim.bySlot[target.slot]);
  check('drawing a backer into open field sets a zone there', r4.assign.t === 'zone' && Math.abs(sim.defBySlot.MIKE.assign.zone.x - (lb.x + 8)) < 0.2);
  check('drawing a lineman sets his rush lane', r5.assign.t === 'rush' && r5.assign.gapX != null);
  const res = sim.runToEnd();
  check('an edited play runs to the end', !!res && sim.done);
  // run play: double-tap the fullback to give him the ball
  const pw = off('power_r');
  sim = mk(pw, d);
  const dbl = editFromDoubleTap(sim, pw, sim.bySlot.FB);
  sim = mk(applyEdits(pw, dbl.edits), d, 9);
  sim.runToEnd();
  check('double-tapping the fullback hands him the ball', dbl && sim.carrier && sim.carrier.slot === 'FB', sim.carrier && sim.carrier.slot);
}

console.log('celebrations');
{
  const o = OFFENSE_PLAYS.find((p) => p.id === 'four_verts');
  const d = DEFENSE_PLAYS.find((p) => p.id === 'cov1_43');
  let sim = null;
  for (let seed = 1; seed < 400; seed++) {
    const s2 = new PlaySim({ offPlay: o, defPlay: d, offLineup: offenseLineup(league[TEAMS[4].id], o.formation), defLineup: defenseLineup(league[TEAMS[5].id], d.front), ballOn: 90, ballX: 26.67, rng: makeRng(seed) });
    s2.runToEnd();
    if (s2.result.td && !s2.result.defTD) { sim = s2; break; }
  }
  check('found a touchdown to celebrate', !!sim);
  if (sim) {
    const before = JSON.stringify(sim.result);
    const rngState = sim.rng.state;
    sim.celebrate({ kind: 'td', leap: true });
    let err = null;
    try { for (let i = 0; i < 240; i++) sim.settle(1 / 60); } catch (e) { err = e; }
    check('celebrations run without touching the result or the RNG', !err && JSON.stringify(sim.result) === before && sim.rng.state === rngState, err && err.message);
    check('the Lambeau Leap ends with the scorer in the stands', sim.players.some((p) => p.hidden));
  }
}

console.log('broadcasts and awards');
{
  const T = (id, conf) => ({ id, conf });
  check('Sunday afternoon: CBS for an AFC road team, FOX for an NFC road team',
    broadcastFor('sun_early', T('KC', 'AFC'), T('BUF', 'AFC')).net === 'cbs' && broadcastFor('sun_late', T('KC', 'AFC'), T('DAL', 'NFC')).net === 'fox');
  check('TNF on Prime, Christmas on Netflix, SNF on NBC at night',
    broadcastFor('tnf', T('KC', 'AFC'), T('BUF', 'AFC')).net === 'prime' && broadcastFor('christmas', T('CHI', 'NFC'), T('GB', 'NFC')).net === 'netflix'
    && broadcastFor('snf', T('KC', 'AFC'), T('BUF', 'AFC')).night);
  check('Thanksgiving: Lions on CBS, Cowboys on FOX, night game on NBC',
    broadcastFor('thanksgiving', T('DET', 'NFC'), T('CHI', 'NFC')).net === 'cbs' && broadcastFor('thanksgiving', T('DAL', 'NFC'), T('PHI', 'NFC')).net === 'fox'
    && broadcastFor('thanksgiving', T('BUF', 'AFC'), T('KC', 'AFC')).night);
  const h = TEAMS[6];
  const a = TEAMS[7];
  const g = new Game({ homeTeam: h, awayTeam: a, homeRoster: league[h.id], awayRoster: league[a.id], userSide: null, qLen: 8, seed: 77 });
  simulateGame(g);
  const pg = playerOfTheGame(g);
  check('Player of the Game picked with a stat line', !!pg && !!pg.line && typeof pg.summary === 'string', pg && pg.summary);
  const mk = (id, pos, extra) => ({ id, pos, team: 'A', gp: 17, pass: {}, rush: {}, rec: {}, def: {}, kick: {}, punt: {}, ...extra });
  const lines = [
    mk('q1', 'QB', { pass: { yds: 4800, td: 38, int: 8 } }), mk('q2', 'QB', { pass: { yds: 3900, td: 25, int: 12 } }),
    ...[1, 2, 3, 4, 5, 6, 7].map((i) => mk(`w${i}`, 'WR', { rec: { rec: 80 + i, yds: 900 + i * 60, td: i } })),
    mk('r1', 'RB', { rush: { yds: 1500, td: 14 }, rookie: true }), mk('d1', 'DL', { slot: 'EDGE', def: { tkl: 50, sacks: 17 } }),
  ];
  const sa = seasonAwards({ lines, teams: [{ id: 'A', wins: 12, lastWins: 5 }] });
  check('season awards: MVP, OPOY, DPOY and rookie of the year', sa.awards.MVP && sa.awards.MVP.id === 'q1' && sa.awards.DPOY.id === 'd1' && sa.awards.OROY.id === 'r1' && sa.awards.OPOY && sa.awards.OPOY.id !== 'q1');
  check('All-Pro: three first-team and three second-team receivers', sa.allPro.first.filter((x) => x.slot === 'WR').length === 3 && sa.allPro.second.filter((x) => x.slot === 'WR').length === 3);
}

console.log('catch, tackle and kick odds');
{
  // a fake sim with a receiver and defenders placed by hand
  const mk = (pos, x, y, face = 0, extra = {}) => ({ pos, x, y, vx: 0, vy: 0, face, down: false, blk: null, rec: { height: 73, weight: 205 }, a: { cth: 80, str: 55, mcv: 72, zcv: 72, bsk: 66, tkl: 70, elu: 70, agi: 80, car: 70, awr: 70 }, ballReact: 0.2, seeBall: 0.2, ...extra });
  const r = mk('WR', 20, 12, Math.PI / 2, { side: 'O' });
  const ball = { x: 20, y: 12, z: 1.4, fx: 20, fy: -6, t0: 0, speed: 24 };
  const sim = (defs) => ({ defense: defs, t: 1, phase: 'air' });
  const open = catchOdds(sim([]), r, ball).p;
  check('a wide-open, well-thrown ball is caught about 95% of the time', between(open, 0.93, 0.98), open.toFixed(3));
  const two = catchOdds(sim([mk('CB', 20.6, 11.2, -Math.PI / 2), mk('S', 22.5, 13.8, -Math.PI / 2)]), r, ball).p;
  check('a defender a yard away and another three away cut it to roughly a quarter', between(two, 0.15, 0.4), two.toFixed(3));
  const front = catchOdds(sim([mk('CB', 20, 10.6, -Math.PI / 2)]), r, ball).p;
  const behind = catchOdds(sim([mk('CB', 20, 13.4, -Math.PI / 2)]), r, ball).p;
  check('a defender in front of the receiver matters more than one trailing him', front < behind, `${front.toFixed(2)} vs ${behind.toFixed(2)}`);
  check('proximity fades with distance', proximity(0.5) > proximity(1) && proximity(1) > proximity(3) && proximity(6) < 0.02);
  const h = mk('RB', 20, 10, Math.PI / 2, { side: 'O', vx: 0, vy: 6 });
  const tsim = { defense: [], offense: [], qb: null, phase: 'run' };
  const side = tackleOdds(tsim, mk('LB', 21, 10, Math.PI, { side: 'D', vx: -5 }), h).p;
  const chase = tackleOdds(tsim, mk('LB', 20, 9, Math.PI / 2, { side: 'D', vy: 6 }), h).p;
  check('a tackle from the side beats an arm tackle from behind', side > chase, `${side.toFixed(2)} vs ${chase.toFixed(2)}`);
  const rng = makeRng(4);
  const k = { attrs: { kpw: 80, kac: 82, awr: 70 } };
  let m30 = 0;
  let m55 = 0;
  let pat = 0;
  for (let i = 0; i < 3000; i++) {
    if (fieldGoal(k, 100 - 13, rng).good) m30++;
    if (fieldGoal(k, 100 - 38, rng).good) m55++;
    if (extraPoint(k, rng).good) pat++;
  }
  check('field goals: 30 yards ~94%, 55 yards much less, extra points ~94%', between(m30 / 3000, 0.88, 0.99) && m55 / 3000 < m30 / 3000 - 0.1 && between(pat / 3000, 0.9, 0.98), `${m30 / 30}% ${m55 / 30}% ${pat / 30}%`);
  // 2025 kickoffs: aimed into the landing zone, most returned; touchbacks
  // from the end zone come out to the 35, short kicks give the ball at the 40
  const ret = { attrs: { spd: 90, elu: 75 } };
  const ko = { touchback: 0, short: 0, ret: 0, start: 0 };
  for (let i = 0; i < 4000; i++) {
    const r = kickoff(k, ret, rng);
    if (r.type === 'touchback') ko.touchback++;
    else if (r.type === 'short' || r.type === 'oob') ko.short++;
    else if (r.type === 'return') ko.ret++;
    ko.start += r.ballOn;
  }
  check('kickoffs: most are returned, some touchbacks, few short of the landing zone', ko.ret / 4000 > 0.6 && between(ko.touchback / 4000, 0.06, 0.32) && ko.short / 4000 < 0.04 && between(ko.start / 4000, 26, 35), `ret ${ko.ret / 40}% tb ${ko.touchback / 40}% short ${ko.short / 40}% start ${(ko.start / 4000).toFixed(1)}`);
}

console.log('Retro Bowl-style passing (optional)');
{
  const ids = Object.keys(league);
  const mk = (seed, manual) => new PlaySim({ offPlay: offPlay('curl_flat'), defPlay: defPlay('cov3_43'), offLineup: offenseLineup(league[ids[0]], offPlay('curl_flat').formation), defLineup: defenseLineup(league[ids[1]], '43'), ballOn: 35, ballX: 26.67, rng: makeRng(seed), manualPass: manual, noFouls: true });
  // left alone, he doesn't throw it on his own
  let selfThrows = 0;
  for (let i = 0; i < 20; i++) {
    const sim = mk(100 + i, true);
    while (!sim.done && sim.t < 5) sim.step();
    if (sim.events.some((e) => e.k === 'throw')) selfThrows++;
  }
  check('with manual passing the quarterback waits for your throw', selfThrows === 0, `${selfThrows} threw`);
  // aim at a receiver's spot: the ball goes there and he goes for it
  let onTarget = 0;
  let toHim = 0;
  for (let i = 0; i < 20; i++) {
    const sim = mk(200 + i, true);
    while (!sim.done && !sim.canUserThrow()) sim.step();
    while (!sim.done && sim.t < 1.7) sim.step();
    if (!sim.canUserThrow()) continue;
    const r = sim.bySlot.X || sim.progression[0];
    const L = sim.leadPoint(sim.qb, r);
    sim.userThrow(L.x, L.y);
    while (!sim.done && sim.ball.state !== 'air') sim.step();
    if (sim.ball.state === 'air' || sim.done) {
      if (Math.hypot(sim.ball.tx - L.x, sim.ball.ty - L.y) < 3) onTarget++;
      if (sim.ball.target === r) toHim++;
    }
  }
  check('a throw goes where you aimed it, to the man who will be there', onTarget >= 15 && toHim >= 15, `${onTarget} on target, ${toHim} to him`);
  check('without the setting, the sim ignores aimed throws', mk(5, false).userThrow(20, 10) === false);
}

console.log('close calls and replay');
{
  const g = new Game({ homeTeam: TEAMS[0], awayTeam: TEAMS[1], homeRoster: league[TEAMS[0].id], awayRoster: league[TEAMS[1].id], userSide: null, qLen: 15, seed: 21 });
  g.next = 'call'; g.phase = 'play'; g.poss = 'home'; g.ballOn = 40; g.down = 3; g.ltg = 46; g.quarter = 1; g.clock = 600;
  const rec = league[TEAMS[0].id].players.find((p) => p.pos === 'WR');
  const qb = league[TEAMS[0].id].players.find((p) => p.pos === 'QB');
  const catchR = { outcome: 'oob', kind: 'pass', yards: 12, spotY: 12.2, incomplete: false, receiver: rec, target: rec, passer: qb, catchY: 12, review: { sideline: true, ball: { x: -0.3, y: 12 } }, fouls: [] };
  let wrong = 0;
  let close = 0;
  for (let i = 0; i < 400; i++) {
    const c = onFieldRuling(catchR, { toGo: 6, goal: 60 }, makeRng(i + 1));
    if (c.close) close++;
    if (c.close && c.close.wrong) {
      wrong++;
      if (!c.ruled.incomplete || c.ruled.receiver) throw new Error('a sideline catch ruled wrong should be incomplete');
    }
  }
  check('a catch at the sideline is a close call, sometimes ruled wrong', close === 400 && between(wrong / 400, 0.06, 0.25), `${wrong} wrong of ${close}`);
  // a spot an inch either side of the line to gain
  const spotR = { outcome: 'tackle', kind: 'run', yards: 6, spotY: 5.6, incomplete: false, rusher: rec, review: {}, fouls: [] };
  const sc = onFieldRuling(spotR, { toGo: 6, goal: 60 }, makeRng(3));
  check('the spot at the line to gain is a close call', sc.close && sc.close.kind === 'spot');
  // a review that reverses the ruling puts the game back first
  const snap = g.snapshot();
  g.applyPlay({ ...spotR, spotY: 5.2, yards: 5, review: null }, offPlay('dive'), defPlay('cov3_43'));
  const after = g.down;
  g.restore(snap);
  g.applyPlay(spotR, offPlay('dive'), defPlay('cov3_43'));
  check('a reversed spot is applied from the state before the play', after === 4 && g.down === 1 && g.ballOn === 46, `down ${after} -> ${g.down}, ball ${g.ballOn}`);
  check('the stat book survives the rewind', typeof g.stats.line === 'function' && g.stats.team.home.plays === 1);
  // challenges: a lost one costs a timeout; a won one earns a third
  g.chargeChallenge('home', false);
  check('a challenge that fails costs a timeout', g.timeouts.home === 2 && g.challenges.home === 1);
  g.chargeChallenge('home', true);
  check('winning one earns a third challenge', g.challenges.home === 1 && g.timeouts.home === 2);
  g.quarter = 4; g.clock = 100;
  check('no coach\'s challenges inside two minutes: the booth reviews', !g.canChallenge('away') && g.inBoothWindow());
  // CPU games settle rulings without stalling
  const s = settleRuling(g, spotR, makeRng(5));
  check('CPU games settle each ruling', s.result && (s.charge === null || typeof s.charge.won === 'boolean'));
  // turnovers (and scores) are the booth's: never a coach's challenge
  g.quarter = 1; g.clock = 600;
  const lost = { outcome: 'fumble_lost', kind: 'run', yards: 0, spotY: 3, incomplete: false, turnover: true, rusher: rec, fumble: { lost: true }, review: {}, fouls: [] };
  let charged = 0;
  let seen = 0;
  for (let i = 0; i < 200; i++) {
    const ruled = onFieldRuling(lost, { toGo: g.ltg - g.ballOn, goal: 100 - g.ballOn }, makeRng(100 + i)).ruled;
    if (!ruled.turnover) continue; // ruled down by contact: that one the defense has to challenge
    seen++;
    if (settleRuling(g, lost, makeRng(100 + i)).charge) charged++;
  }
  check('a ruling of a turnover is reviewed by the booth, never challenged', seen > 100 && charged === 0, `${charged} of ${seen}`);
  // a sideline ball caught in the end zone and ruled a catch is a touchdown
  const ez = { ...catchR, incomplete: true, receiver: null, review: { sideline: true, ball: { x: -0.2, y: 61 } } };
  let td = false;
  for (let i = 0; i < 200 && !td; i++) { const c = onFieldRuling(ez, { toGo: 6, goal: 60 }, makeRng(300 + i)); if (c.close && c.close.wrong) td = c.ruled.td === true; }
  check('a catch ruled in the end zone is a touchdown', td);
}

console.log('fouls and penalties');
{
  const g = new Game({ homeTeam: TEAMS[0], awayTeam: TEAMS[1], homeRoster: league[TEAMS[0].id], awayRoster: league[TEAMS[1].id], userSide: null, qLen: 15, seed: 8 });
  g.next = 'call'; g.phase = 'play'; g.poss = 'home'; g.ballOn = 40; g.down = 2; g.ltg = 48;
  const hold = { key: 'holdO', name: 'Offensive holding', on: 'O', yards: 10 };
  check('offensive holding on a loss of 12 is declined', g.choosePenalty({ fouls: [hold], yards: -12, incomplete: false }).mode === 'declined');
  check('offensive holding on a 9-yard gain is accepted', g.choosePenalty({ fouls: [hold], yards: 9, incomplete: false }).mode === 'replace');
  const dpi = { key: 'dpi', name: 'Defensive pass interference', on: 'D', yards: 0, spotFoul: true, auto1st: true, spotY: 22 };
  check('pass interference on an incompletion is accepted at the spot', g.choosePenalty({ fouls: [dpi], incomplete: true, yards: 0 }).spot === 22);
  const rtp = { key: 'rtp', name: 'Roughing the passer', on: 'D', yards: 15, auto1st: true, afterPlay: true };
  check('roughing on a completion adds 15 to the end of the play', g.choosePenalty({ fouls: [rtp], incomplete: false, yards: 12 }).mode === 'after');
  const twelve = { key: 'subs', name: 'Too many men on the field', on: 'D', yards: 5 };
  check('12 men on the field is a live-ball foul: the offense keeps a bigger gain', g.choosePenalty({ fouls: [twelve], incomplete: false, yards: 14 }).mode === 'declined' && g.choosePenalty({ fouls: [twelve], incomplete: true, yards: 0 }).mode === 'replace');
  check('holding against roughing: 10 vs 15 offset', g.choosePenalty({ fouls: [hold, rtp], incomplete: false, yards: 6 }).mode === 'offset');
  const ur = { key: 'ur', name: 'Unnecessary roughness', on: 'D', yards: 15, auto1st: true, afterPlay: true, deadBall: true };
  check('a late hit after a loss is still marked from the end of the play', g.choosePenalty({ fouls: [ur], incomplete: false, yards: -3 }).mode === 'after');
  check('a late hit after holding: the holding is enforced, then the late hit', g.choosePenalty({ fouls: [hold, ur], incomplete: false, yards: 6 }).late?.key === 'ur');
  check('a late hit after a safety does not wipe out the safety', g.choosePenalty({ fouls: [ur], incomplete: false, yards: -2, safety: true }) === null);
  {
    const g2 = new Game({ homeTeam: TEAMS[0], awayTeam: TEAMS[1], homeRoster: league[TEAMS[0].id], awayRoster: league[TEAMS[1].id], userSide: null, qLen: 15, seed: 8 });
    g2.next = 'call'; g2.phase = 'play'; g2.poss = 'home'; g2.ballOn = 50; g2.down = 2; g2.ltg = 58; g2.quarter = 4; g2.clock = 90; g2.clockRunning = true;
    g2.rng = { chance: () => true, pick: (a) => a[0] }; // force the false start
    const pen = g2.preSnapPenalty();
    check('a false start inside two minutes costs 10 seconds, and the clock starts on the ready signal', pen.key === 'falseStart' && /10-second runoff/.test(pen.text) && g2.clock === 80 && g2.clockRunning, `${pen.text} ${g2.clock} ${g2.clockRunning}`);
  }
  {
    // intentional grounding: 10 yards (or the spot) and loss of down
    const mk = () => {
      const g3 = new Game({ homeTeam: TEAMS[0], awayTeam: TEAMS[1], homeRoster: league[TEAMS[0].id], awayRoster: league[TEAMS[1].id], userSide: null, qLen: 15, seed: 8 });
      g3.next = 'call'; g3.phase = 'play'; g3.poss = 'home'; g3.quarter = 1; g3.clock = 600;
      return g3;
    };
    const grd = (spotY) => ({ key: 'grounding', name: 'Intentional grounding', on: 'O', yards: 10, lossOfDown: true, spotY, signal: 'grounding' });
    const thrown = (spotY) => ({ outcome: 'incomplete', kind: 'pass', yards: 0, spotY: 0, incomplete: true, why: 'thrown away', elapsed: 3, review: {}, fouls: [grd(spotY)] });
    let ga = mk(); ga.ballOn = 40; ga.down = 2; ga.ltg = 50;
    ga.applyPlay(thrown(-6), offPlay('dagger'), defPlay('cov3_43'));
    check('intentional grounding: 10 yards from the previous spot and loss of down', ga.ballOn === 30 && ga.down === 3, `${ga.ballOn} ${ga.down}`);
    ga = mk(); ga.ballOn = 40; ga.down = 1; ga.ltg = 50;
    ga.applyPlay(thrown(-14), offPlay('dagger'), defPlay('cov3_43'));
    check('grounding 14 yards behind the line is marked at the spot', ga.ballOn === 26 && ga.down === 2, `${ga.ballOn} ${ga.down}`);
    ga = mk(); ga.ballOn = 40; ga.down = 4; ga.ltg = 45;
    const o4 = ga.applyPlay(thrown(-7), offPlay('dagger'), defPlay('cov3_43'));
    check('grounding on fourth down turns the ball over', ga.poss === 'away' && /turnover on downs/.test(o4.text), o4.text);
    ga = mk(); ga.ballOn = 4; ga.down = 2; ga.ltg = 14;
    ga.applyPlay(thrown(-6), offPlay('dagger'), defPlay('cov3_43'));
    check('grounding from his own end zone is a safety', ga.score.away === 2 && ga.next === 'kickoff', `${ga.score.away} ${ga.next}`);
    ga = mk(); ga.ballOn = 5; ga.down = 2; ga.ltg = 15;
    ga.applyPlay(thrown(-4.6), offPlay('dagger'), defPlay('cov3_43'));
    // (4.6 yards back isn't more than 10, so it's half the distance from
    // the previous spot)
    check('grounding at his own half-yard line is not a safety', ga.score.away === 0 && ga.ballOn === 3 && ga.down === 3, `${ga.score.away} ${ga.ballOn} ${ga.down}`);
    ga = mk(); ga.ballOn = 40; ga.down = 2; ga.ltg = 50;
    const hold = { key: 'holdO', name: 'Offensive holding', on: 'O', yards: 10, signal: 'holding' };
    ga.applyPlay({ ...thrown(-6), fouls: [hold, grd(-6)] }, offPlay('dagger'), defPlay('cov3_43'));
    check('holding and grounding on one play: the defense takes the loss of down', ga.ballOn === 30 && ga.down === 3, `${ga.ballOn} ${ga.down}`);
    // a half can't end on an accepted defensive foul: an untimed down
    ga = mk(); ga.quarter = 2; ga.clock = 3; ga.ballOn = 60; ga.down = 1; ga.ltg = 70; ga.clockRunning = true;
    const holdD = { key: 'holdD', name: 'Defensive holding', on: 'D', yards: 5, auto1st: true, signal: 'holding' };
    ga.applyPlay({ outcome: 'incomplete', kind: 'pass', yards: 0, spotY: 0, incomplete: true, elapsed: 4, review: {}, fouls: [holdD] }, offPlay('dagger'), defPlay('cov3_43'));
    const untimed = ga.next === 'call' && ga.clock === 0 && ga.ballOn === 65;
    ga.applyPlay({ outcome: 'tackle', kind: 'run', yards: 3, spotY: 3, elapsed: 4, review: {}, fouls: [] }, offPlay('dive'), defPlay('cov3_43'));
    check('a defensive foul on the last play of a half gives an untimed down, then the half ends', untimed && ga.next === 'endQuarter', `${untimed} ${ga.next}`);
    // ...also when the untimed down is a field goal
    ga = mk(); ga.quarter = 4; ga.clock = 3; ga.ballOn = 70; ga.down = 4; ga.ltg = 80; ga.clockRunning = true;
    ga.applyPlay({ outcome: 'incomplete', kind: 'pass', yards: 0, spotY: 0, incomplete: true, elapsed: 4, review: {}, fouls: [holdD] }, offPlay('dagger'), defPlay('cov3_43'));
    ga.fieldGoal();
    check('an untimed field goal ends the half', ga.next === 'endQuarter' || ga.next === 'final', ga.next);
    // and a personal foul after a completion on the last play
    ga = mk(); ga.quarter = 2; ga.clock = 3; ga.ballOn = 40; ga.down = 1; ga.ltg = 50; ga.clockRunning = true;
    const rtp = { key: 'rtp', name: 'Roughing the passer', on: 'D', yards: 15, auto1st: true, afterPlay: true, signal: 'rtp' };
    ga.applyPlay({ outcome: 'tackle', kind: 'pass', yards: 12, spotY: 12, elapsed: 5, review: {}, passer: { first: 'Test', last: 'Passer' }, receiver: { first: 'Test', last: 'Receiver' }, fouls: [rtp] }, offPlay('dagger'), defPlay('cov3_43'));
    check('roughing the passer on the last play: untimed down', ga.next === 'call' && ga.clock === 0 && !ga.clockRunning, `${ga.next} ${ga.clock} ${ga.clockRunning}`);
    ga = mk(); ga.quarter = 5; ga.clock = 125; ga.clockRunning = true; ga.ot = { stage: 'first', first: 'home', second: 'away' };
    const otOut = ga.applyPlay({ outcome: 'tackle', kind: 'run', yards: 3, spotY: 3, elapsed: 4, review: {}, fouls: [] }, offPlay('dive'), defPlay('cov3_43'));
    check('overtime has a two-minute warning', otOut.flags.includes('twoMinute') && !ga.clockRunning, `${otOut.flags} ${ga.clockRunning}`);
    // behind by 7 in overtime, a field goal can't help: the CPU goes for it
    ga = mk(); ga.quarter = 5; ga.clock = 352; ga.poss = 'home'; ga.score = { home: 9, away: 16 }; ga.ballOn = 62; ga.down = 4; ga.ltg = 65;
    ga.ot = { stage: 'second', first: 'away', second: 'home' };
    const dec7 = cpuFourthDown(ga, 'home');
    ga.score = { home: 13, away: 16 };
    const dec3 = cpuFourthDown(ga, 'home');
    check('in overtime the CPU only kicks a field goal that ties or wins', dec7 === 'go' && dec3 === 'fg', `${dec7} ${dec3}`);
  }
  // fouls come out of plays at about NFL rates
  let flags = 0;
  const rng = makeRng(12);
  const ids = Object.keys(league);
  for (let i = 0; i < 600; i++) {
    const o = OFFENSE_PLAYS.filter((p) => p.cat !== 'special')[i % 20];
    const d = DEFENSE_PLAYS[i % DEFENSE_PLAYS.length];
    const r = new PlaySim({ offPlay: o, defPlay: d, offLineup: offenseLineup(league[ids[i % 32]], o.formation), defLineup: defenseLineup(league[ids[(i + 5) % 32]], d.front), ballOn: 35, ballX: 26.67, rng: rng.fork() }).runToEnd();
    flags += r.fouls.length;
  }
  check('live-ball flags on roughly 2-8% of plays', between(flags / 600, 0.02, 0.08), `${((flags / 600) * 100).toFixed(1)}%`);
}

console.log('pre-snap: lining up and substitutions');
{
  const g = new Game({ homeTeam: TEAMS[2], awayTeam: TEAMS[3], homeRoster: league[TEAMS[2].id], awayRoster: league[TEAMS[3].id], userSide: 'home', qLen: 15, seed: 9 });
  g.next = 'call'; g.phase = 'play'; g.poss = 'home'; g.ballOn = 30; g.down = 1; g.ltg = 40; g.quarter = 1; g.clock = 600;
  const pre = new PreSnap();
  const sim1 = makePlaySim(g, offPlay('dive'), defPlay('cov3_43'), makeRng(1));
  pre.begin(sim1, { offTeam: 'home', homeSide: -1, hurry: false, twoMinute: false, fg: false, prevLos: 30, los: 30 });
  check('players start in the huddle, not on their spots', !pre.ready());
  for (let i = 0; i < 600; i++) pre.update(1 / 60);
  check('they break the huddle and get set', pre.ready());
  pre.snapped(sim1, 'home');
  // next play: a three-receiver set brings on a receiver for the fullback
  const sim2 = makePlaySim(g, offPlay('slants'), defPlay('cov3_43'), makeRng(1));
  pre.begin(sim2, { offTeam: 'home', homeSide: -1, hurry: false, twoMinute: false, fg: false, prevLos: 30, los: 30 });
  check('an offensive substitution: the umpire holds the ball for the defense', pre.hold && !pre.hold.released);
  check('the players being replaced run off', pre.leaving.length > 0);
  for (let i = 0; i < 900; i++) pre.update(1 / 60);
  check('once the defense has matched, the snap can go', pre.ready());
  pre.snapped(sim2, 'home');
  const sim3 = makePlaySim(g, offPlay('dive'), defPlay('cov3_43'), makeRng(1));
  pre.begin(sim3, { offTeam: 'home', homeSide: -1, hurry: false, twoMinute: true, fg: false, prevLos: 30, los: 30 });
  check('inside the two-minute warning the umpire does not hold the ball', !pre.hold);
  {
    // after a play: they walk back to the huddle from where it ended
    const pre2 = new PreSnap();
    const sim5 = makePlaySim(g, offPlay('dive'), defPlay('cov3_43'), makeRng(1));
    const prevPos = new Map(sim5.players.map((p) => [p.rec.id, { x: p.x + 3, y: p.y + 6 }]));
    pre2.begin(sim5, { offTeam: 'home', homeSide: -1, hurry: false, twoMinute: false, fg: false, prevPos, prevLos: 30, los: 30 });
    const qb = sim5.qb;
    const a = pre2.actors.get(pre2.key('home', qb.rec));
    const startOK = Math.abs(a.x - (qb.x + 3)) < 1e-6 && Math.abs(a.y - (qb.y + 6)) < 1e-6;
    let maxStep = 0;
    let px = a.x;
    let py = a.y;
    for (let i = 0; i < 900; i++) { pre2.update(1 / 60); maxStep = Math.max(maxStep, Math.hypot(a.x - px, a.y - py)); px = a.x; py = a.y; }
    check('after a play nobody pops into the huddle: they walk back, then line up', startOK && maxStep < 0.2 && pre2.ready(), `start ${startOK} step ${maxStep.toFixed(2)}`);
    // changing the call: the officials stay where they are
    const u = sim5.crew.by.U;
    u.x += 2.5;
    const sim6 = makePlaySim(g, offPlay('slants'), defPlay('cov3_43'), makeRng(1));
    pre2.sync(sim6);
    check('changing the play doesn\'t move the officials', Math.abs(sim6.crew.by.U.x - u.x) < 1e-6);
    // a kick call: the huddles hold, and the kick doesn't wait on them
    const pre3 = new PreSnap();
    pre3.begin(makePlaySim(g, offPlay('dive'), defPlay('cov3_43'), makeRng(1)), { offTeam: 'home', homeSide: -1, hurry: false, twoMinute: false, fg: false, prevLos: 30, los: 30 });
    pre3.holdHuddle = true;
    for (let i = 0; i < 300; i++) pre3.update(1 / 60);
    check('on a kick call the huddles stay put and the snap can go', [...pre3.actors.values()].every((a) => a.state !== 'set') && pre3.ready());
    // a substitute coming on after a play that ended with him elsewhere
    // (a flag before the snap) doesn't get stuck between bench and huddle
    const pre4 = new PreSnap();
    const s1 = makePlaySim(g, offPlay('dive'), defPlay('cov3_43'), makeRng(1));
    pre4.begin(s1, { offTeam: 'home', homeSide: -1, hurry: false, twoMinute: false, fg: false, prevLos: 30, los: 30 });
    pre4.snapped(s1, 'home');
    const sF = makePlaySim(g, offPlay('slants'), defPlay('cov3_43'), makeRng(1));
    const s3 = makePlaySim(g, offPlay('slants'), defPlay('cov3_43'), makeRng(2));
    pre4.begin(s3, { offTeam: 'home', homeSide: -1, hurry: false, twoMinute: false, fg: false, prevPos: new Map(sF.players.map((p) => [p.rec.id, { x: p.x, y: p.y }])), prevLos: 30, los: 25 });
    for (let i = 0; i < 60 * 20; i++) pre4.update(1 / 60);
    check('substitutes and walk-backs together still get set', pre4.ready());
  }
  check('the CPU defense goes to nickel against three receivers', cpuMatchDefense(g, 'away', offPlay('slants'), defPlay('cov3_43')).front === 'nickel');
  check('and back to base against a heavy set', cpuMatchDefense(g, 'away', offPlay('gl_dive'), defPlay('cov3_nickel')).front === '43');
  const crew = sim3.crew;
  check('seven officials on the field, down judge on the visitors\' sideline', crew.list.length === 7 && crew.by.DJ.x > 53);
  g.quarter = 3;
  const sim4 = makePlaySim(g, offPlay('dive'), defPlay('cov3_43'), makeRng(1));
  check('the chains and the down judge move to the home sideline for the second half', sim4.crew.by.DJ.x < 0);
  g.quarter = 1;
}

if (existsSync('assets/data/league.json')) {
  console.log('real league (assets/data/league.json)');
  const { teams, rosters } = fromLeagueJson(JSON.parse(readFileSync('assets/data/league.json', 'utf8')));
  const rp = Object.values(rosters).flatMap((r) => r.players);
  check('32 real teams', teams.length === 32 && Object.keys(rosters).length === 32);
  const matched = resolveHonors(Object.values(rosters).flatMap((r) => r.players));
  const staff = Object.values(rosters).flatMap((r) => r.players).find((p) => p.first === 'Matthew' && p.last === 'Stafford');
  check('real 2025 honors land on the right players (Stafford: MVP and All-Pro)', matched >= 60 && honorsFor(staff).some((x) => x.short === 'MVP') && honorsFor(staff).some((x) => x.kind === 'allpro'), `matched ${matched}`);
  check('every real team can field all starters', Object.values(rosters).every((r) => ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P'].every((pos) => (r.depth[pos] || []).length >= ({ OL: 5, DL: 4, WR: 3, LB: 3, CB: 2, S: 2 }[pos] || 1))));
  check('real ratings all 0-100', rp.every((p) => Object.values(p.attrs).every((v) => Number.isInteger(v) && v >= 0 && v <= 100)));
  computeBadges(rp);
  for (const stat of ['speed', 'strength', 'skill']) {
    const fa = rp.filter((p) => p.badges[stat] === 'franchise').length;
    check(`real franchise ${stat} count is 5-6`, fa >= 5 && fa <= 6, `got ${fa}`);
  }
  const front34 = teams.filter((t) => t.front === '34');
  const okEnds = front34.every((t) => {
    const L = defenseLineup(rosters[t.id], '34');
    return L.DE_L.pos === 'DL' && L.DE_R.pos === 'DL' && L.NT.pos === 'DL';
  });
  check('3-4 fronts start defensive linemen at end and nose', okEnds);
  check('DL depth lists hold only linemen', Object.values(rosters).every((r) => r.depth.DL.every((id) => r.players.find((p) => p.id === id).pos === 'DL')));
  check('every 4-man front starts two pass rushers', teams.every((t) => { const L = defenseLineup(rosters[t.id], '43'); return rosters[t.id].depth.EDGE.slice(0, 2).includes(L.DE_L.id); }));
  const rs = runBalance(1500, 99, rosters);
  const rypc = rs.run.yds / rs.run.n;
  const rcomp = rs.pass.comp / rs.pass.att;
  check('real: yards per carry 3.0-6.0', between(rypc, 3.0, 6.0), rypc.toFixed(2));
  check('real: completion 50-72%', between(rcomp, 0.5, 0.72), (rcomp * 100).toFixed(1));
  const rpts = [];
  let rok = true;
  const byId = Object.fromEntries(teams.map((t) => [t.id, t]));
  const ids = teams.map((t) => t.id);
  for (let i = 0; i < 12; i++) {
    const h = byId[ids[i * 2]];
    const a = byId[ids[i * 2 + 1]];
    const g = new Game({ homeTeam: h, awayTeam: a, homeRoster: rosters[h.id], awayRoster: rosters[a.id], userSide: null, qLen: 15, seed: 500 + i });
    simulateGame(g);
    if (!g.over) rok = false;
    rpts.push(g.score.home, g.score.away);
  }
  const ravg = rpts.reduce((x, y) => x + y, 0) / rpts.length;
  check('real: all games finish', rok);
  check('real: avg points per team 10-45', between(ravg, 10, 45), ravg.toFixed(1));
  console.log(`  (avg ${ravg.toFixed(1)} pts/team)`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
