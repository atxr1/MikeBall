// Plays CPU-vs-CPU games with the real league and reports league-wide box
// score averages per team-game, for tuning the quick resolver against the
// full sim and the NFL.
// Usage: node tools/leaguesim.mjs [games] [--full] [--q 15]
import { readFileSync } from 'node:fs';
import { fromLeagueJson } from '../src/data/realleague.js';
import { setTeams, teamById, TEAMS } from '../src/data/teams.js';
import { computeBadges } from '../src/game/badges.js';
import { Game } from '../src/game/rules.js';
import { simulateGame } from '../src/game/autoplay.js';
import { makeRng } from '../src/core/rng.js';

const args = process.argv.slice(2);
const N = Number(args.find((a) => /^\d+$/.test(a)) || 64);
const full = args.includes('--full');
const qi = args.indexOf('--q');
const qLen = qi >= 0 ? Number(args[qi + 1]) : 15;
const { teams, rosters } = fromLeagueJson(JSON.parse(readFileSync(new URL('../assets/data/league.json', import.meta.url))));
setTeams(teams);
computeBadges(Object.values(rosters).flatMap((r) => r.players));
const rng = makeRng(11);
const T = { pts: 0, plays: 0, yards: 0, passYds: 0, rushYds: 0, first: 0, to: 0, pen: 0, penYds: 0, sacks: 0, third: 0, thirdC: 0 };
const P = { att: 0, comp: 0, yds: 0, td: 0, int: 0, sacked: 0, ratt: 0, ryds: 0, rtd: 0, fga: 0, fgm: 0, xpa: 0, xpm: 0, punts: 0 };
let ties = 0, ot = 0, homeW = 0;
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  const h = rng.pick(TEAMS);
  let a = rng.pick(TEAMS);
  if (a === h) a = TEAMS[(TEAMS.indexOf(h) + 1) % TEAMS.length];
  const g = new Game({ homeTeam: teamById(h.id), awayTeam: teamById(a.id), homeRoster: rosters[h.id], awayRoster: rosters[a.id], userSide: 'none', qLen, seed: 1000 + i });
  g.quick = !full;
  simulateGame(g, 20000);
  if (g.score.home === g.score.away) ties++;
  if (g.score.home > g.score.away) homeW++;
  if (g.quarter >= 5) ot++;
  for (const s of ['home', 'away']) {
    const t = g.stats.team[s];
    T.pts += g.score[s]; T.plays += t.plays; T.yards += t.yards; T.passYds += t.passYds; T.rushYds += t.rushYds;
    T.first += t.firstDowns; T.to += t.turnovers; T.pen += t.penalties; T.penYds += t.penYds; T.sacks += t.sacks;
    T.third += t.thirdAtt; T.thirdC += t.thirdConv;
  }
  for (const l of g.stats.players.values()) {
    P.att += l.pass.att; P.comp += l.pass.comp; P.yds += l.pass.yds; P.td += l.pass.td; P.int += l.pass.int; P.sacked += l.pass.sacked;
    P.ratt += l.rush.att; P.ryds += l.rush.yds; P.rtd += l.rush.td;
    P.fga += l.kick.fga; P.fgm += l.kick.fgm; P.xpa += l.kick.xpa; P.xpm += l.kick.xpm; P.punts += l.punt.n;
  }
}
const tg = N * 2;
const f = (x, d = 1) => (x / tg).toFixed(d);
console.log(`${N} games (${full ? 'full sim' : 'quick'}, ${qLen}-min quarters), ${((performance.now() - t0) / N).toFixed(1)} ms/game`);
console.log(`per team: ${f(T.pts)} pts, ${f(T.plays)} plays, ${f(T.yards)} yds (${f(T.passYds)} pass, ${f(T.rushYds)} rush), ${f(T.first)} 1st downs, ${f(T.to, 2)} TO, ${f(T.pen)} pen for ${f(T.penYds)}, ${f(T.sacks)} sacks, 3rd down ${(T.thirdC / T.third * 100).toFixed(0)}%`);
console.log(`passing: ${(P.comp / P.att * 100).toFixed(1)}% , ${(P.yds / P.att).toFixed(2)} ypa, ${f(P.att)} att, TD ${(P.td / P.att * 100).toFixed(1)}%, INT ${(P.int / P.att * 100).toFixed(1)}%, sack ${(P.sacked / (P.att + P.sacked) * 100).toFixed(1)}%`);
console.log(`rushing: ${f(P.ratt)} att, ${(P.ryds / P.ratt).toFixed(2)} ypc, ${f(P.rtd, 2)} TD`);
console.log(`kicking: FG ${(P.fgm / P.fga * 100).toFixed(0)}% (${f(P.fga, 2)} att), XP ${(P.xpm / P.xpa * 100).toFixed(0)}%, ${f(P.punts, 1)} punts`);
console.log(`home won ${(homeW / N * 100).toFixed(0)}%, ties ${ties}, overtime ${ot}`);
