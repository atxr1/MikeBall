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
