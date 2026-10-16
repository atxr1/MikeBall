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
import { defenseLineup } from '../src/game/personnel.js';

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

if (existsSync('assets/data/league.json')) {
  console.log('real league (assets/data/league.json)');
  const { teams, rosters } = fromLeagueJson(JSON.parse(readFileSync('assets/data/league.json', 'utf8')));
  const rp = Object.values(rosters).flatMap((r) => r.players);
  check('32 real teams', teams.length === 32 && Object.keys(rosters).length === 32);
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
