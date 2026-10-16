// Node test runner: `node tests/run.mjs`
// Checks the sim stays in sane ranges and the rules engine plays full games.

import { generateLeague } from '../src/data/roster.js';
import { TEAMS } from '../src/data/teams.js';
import { computeBadges, TIERS } from '../src/game/badges.js';
import { Game } from '../src/game/rules.js';
import { simulateGame } from '../src/game/autoplay.js';
import { runBalance } from '../tools/balance.mjs';

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
