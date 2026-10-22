// Player-AI diagnostics: how each play works, not just what it gains.
// Usage: node tools/aidiag.mjs [playsEach] [playId...]
//   runs:   yards spread, where the runner is first hit, who tackles,
//           defenders unblocked at the mesh
//   passes: time to throw, who gets the ball and on what route, completion
//           by target, why passes fall incomplete, sack timing and depth
// Uses the real league (assets/data/league.json) when it's there.

import { readFileSync, existsSync } from 'node:fs';
import { generateLeague } from '../src/data/roster.js';
import { setTeams } from '../src/data/teams.js';
import { fromLeagueJson } from '../src/data/realleague.js';
import { OFFENSE_PLAYS, DEFENSE_PLAYS } from '../src/data/playbook.js';
import { offenseLineup, defenseLineup } from '../src/game/personnel.js';
import { PlaySim } from '../src/sim/playsim.js';
import { makeRng } from '../src/core/rng.js';
import { HASH_L, HASH_R, MID_X, dist } from '../src/core/util.js';

const args = process.argv.slice(2);
const each = Number(args[0]) || 120;
const only = args.slice(1);

let league;
if (existsSync('assets/data/league.json')) {
  const real = fromLeagueJson(JSON.parse(readFileSync('assets/data/league.json', 'utf8')));
  setTeams(real.teams);
  league = real.rosters;
} else league = generateLeague(2026);
const ids = Object.keys(league);
const rng = makeRng(11);
const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');

const plays = OFFENSE_PLAYS.filter((p) => (p.cat === 'run' || p.cat === 'pass') && (!only.length || only.includes(p.id)));
for (const play of plays) {
  const S = { yds: [], hitY: [], tackler: {}, unblocked: [], ttt: [], tgt: {}, why: {}, sackT: [], sackY: [], scr: [], comp: 0, att: 0, sacks: 0 };
  for (let i = 0; i < each; i++) {
    const oId = ids[i % ids.length];
    const dId = ids[(i * 7 + 3) % ids.length];
    const def = DEFENSE_PLAYS[i % DEFENSE_PLAYS.length];
    const sim = new PlaySim({
      offPlay: play, defPlay: def,
      offLineup: offenseLineup(league[oId], play.formation),
      defLineup: defenseLineup(league[dId], def.front),
      ballOn: 20 + (i % 50), ballX: [HASH_L, MID_X, HASH_R][i % 3], rng: rng.fork(), toGo: 10, noFouls: true,
    });
    let firstHit = null;
    let unb = null;
    while (!sim.done && sim.t < 40) {
      sim.step();
      const c = sim.carrier;
      if (play.cat === 'run' && c && unb == null && sim.t - (sim.runT || 0) > 0.15) {
        // defenders free within 3 yards of the runner's path to the line
        let n = 0;
        for (const d of sim.defense) if (!d.blk && !d.down && d.y < 4 && dist(d.x, d.y, c.x, Math.max(c.y, 0)) < 3.5) n++;
        unb = n;
      }
      if (c && firstHit == null && sim.wrap) firstHit = c.y;
    }
    const r = sim.result;
    if (!r) { S.stalls = (S.stalls || 0) + 1; continue; }
    if (sim.t > 9) S.long = (S.long || 0) + 1;
    const gained = r.turnover ? 0 : r.td ? 100 - (20 + (i % 50)) : r.yards;
    S.yds.push(gained);
    if (firstHit != null) S.hitY.push(firstHit);
    if (unb != null) S.unblocked.push(unb);
    if (r.tackler) {
      const t = sim.players.find((p) => p.rec === r.tackler);
      if (t) S.tackler[t.pos] = (S.tackler[t.pos] || 0) + 1;
    }
    if (play.cat === 'pass') {
      if (r.kind === 'sack') { S.sacks++; S.sackT.push(sim.t); S.sackY.push(gained); continue; }
      if (r.kind === 'scramble') { S.scr.push(gained); continue; }
      const th = sim.events.find((e) => e.k === 'throw' || e.k === 'throwaway');
      if (th) S.ttt.push(th.t);
      S.att++;
      const t = th && th.to ? th.to.slot : th ? 'away' : '-';
      const T = (S.tgt[t] ||= { n: 0, c: 0 });
      T.n++;
      if (!r.incomplete && !r.interception) { S.comp++; T.c++; } else if (r.interception) S.why.INT = (S.why.INT || 0) + 1;
      else S.why[r.why] = (S.why[r.why] || 0) + 1;
    }
  }
  const neg = S.yds.filter((y) => y < 0).length;
  const big = S.yds.filter((y) => y >= 10).length;
  if (S.stalls) console.log(`${play.id}: ${S.stalls} plays never ended`);
  if (S.long) console.log(`${play.id}: ${S.long} plays ran past 9 seconds`);
  let line = `${play.id.padEnd(11)} avg ${f1(avg(S.yds)).padStart(5)}  med ${String(med(S.yds)).padStart(3)}  neg ${pct(neg, S.yds.length).padStart(4)}  10+ ${pct(big, S.yds.length).padStart(4)}`;
  if (play.cat === 'run') {
    line += `  hit@ ${f1(med(S.hitY))}  free@mesh ${f1(avg(S.unblocked))}  tackled by ${JSON.stringify(S.tackler)}`;
  } else {
    const tg = Object.entries(S.tgt).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `${k} ${v.c}/${v.n}`).join(' ');
    line += `  comp ${pct(S.comp, S.att)}  ttt ${f1(med(S.ttt))}s  sacks ${S.sacks} @${f1(med(S.sackT))}s ${f1(avg(S.sackY))}y  scr ${S.scr.length} ${f1(avg(S.scr))}y\n             targets: ${tg}\n             misses: ${JSON.stringify(S.why)}`;
  }
  console.log(line);
}
