// playtest helper: do playoff games ever end tied? (quick and full sims)
import { readFileSync } from 'node:fs';
import { fromLeagueJson } from '../src/data/realleague.js';
import { setTeams, teamById, TEAMS } from '../src/data/teams.js';
import { Game } from '../src/game/rules.js';
import { simulateGame, cpuStep } from '../src/game/autoplay.js';
import { computeBadges } from '../src/game/badges.js';

const { teams, rosters } = fromLeagueJson(JSON.parse(readFileSync(new URL('../assets/data/league.json', import.meta.url))));
setTeams(teams);
computeBadges(Object.values(rosters).flatMap((r) => r.players));
const N = Number(process.argv[2] || 300);
const quick = process.argv[3] !== 'full';
const qLen = Number(process.argv[4] || 15);
let ties = 0, ots = 0, multi = 0, notOver = 0, maxQ = 0, userSide = process.argv[5] || 'none';
const ex = [];
for (let i = 0; i < N; i++) {
  const a = TEAMS[i % 32], b = TEAMS[(i * 7 + 3) % 32 === i % 32 ? (i + 1) % 32 : (i * 7 + 3) % 32];
  const g = new Game({ homeTeam: teamById(a.id), awayTeam: teamById(b.id), homeRoster: rosters[a.id], awayRoster: rosters[b.id], qLen, seed: 1000 + i, playoff: true, userSide });
  if (quick) g.quick = true;
  let n = 0;
  while (!g.over && n++ < 20000) cpuStep(g);
  if (!g.over) notOver++;
  if (g.quarter >= 5) ots++;
  if (g.quarter >= 6) multi++;
  maxQ = Math.max(maxQ, g.quarter);
  if (g.score.home === g.score.away) { ties++; ex.push(`${a.id}-${b.id} ${g.score.home}-${g.score.away} q${g.quarter}`); }
}
console.log(JSON.stringify({ N, quick, qLen, ties, ots, multi, notOver, maxQ, ex: ex.slice(0, 5) }));
