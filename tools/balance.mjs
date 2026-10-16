// League-average outcome report for the play sim.
// Usage: node tools/balance.mjs [plays]

import { generateLeague } from '../src/data/roster.js';
import { OFFENSE_PLAYS, DEFENSE_PLAYS } from '../src/data/playbook.js';
import { offenseLineup, defenseLineup } from '../src/game/personnel.js';
import { simulatePlay } from '../src/sim/playsim.js';
import { makeRng } from '../src/core/rng.js';
import { HASH_L, HASH_R, MID_X } from '../src/core/util.js';

export function runBalance(n = 2000, seed = 7) {
  const league = generateLeague(2026);
  const ids = Object.keys(league);
  const rng = makeRng(seed);
  const offPlays = OFFENSE_PLAYS.filter((p) => p.cat === 'run' || p.cat === 'pass');
  const s = {
    run: { n: 0, yds: 0, td: 0, neg: 0, big: 0, fum: 0 },
    pass: { att: 0, comp: 0, yds: 0, sacks: 0, sackYds: 0, int: 0, td: 0, drop: 0, scr: 0, scrYds: 0, dropbacks: 0, away: 0 },
    byPlay: {},
    time: 0,
  };
  for (let i = 0; i < n; i++) {
    const oId = rng.pick(ids);
    let dId = rng.pick(ids);
    if (dId === oId) dId = ids[(ids.indexOf(oId) + 1) % ids.length];
    const off = rng.pick(offPlays);
    const def = rng.pick(DEFENSE_PLAYS);
    const ballOn = rng.int(15, 80);
    const ballX = rng.pick([HASH_L, MID_X, HASH_R]);
    const r = simulatePlay({
      offPlay: off,
      defPlay: def,
      offLineup: offenseLineup(league[oId], off.formation),
      defLineup: defenseLineup(league[dId], def.front),
      ballOn,
      ballX,
      rng: rng.fork(),
    });
    s.time += r.elapsed;
    for (const [k, v] of Object.entries(r.evCounts || {})) (s.ev ||= {})[k] = ((s.ev ||= {})[k] || 0) + v;
    const bp = (s.byPlay[off.id] ||= { n: 0, yds: 0, ok: 0 });
    bp.n++;
    const gained = r.turnover ? 0 : r.td ? 100 - ballOn : r.yards;
    if (off.cat === 'run') {
      s.run.n++;
      s.run.yds += gained;
      if (r.td) s.run.td++;
      if (gained < 0) s.run.neg++;
      if (gained >= 15) s.run.big++;
      if (r.fumble?.lost) s.run.fum++;
      bp.yds += gained;
    } else {
      s.pass.dropbacks++;
      if (r.kind === 'sack') { s.pass.sacks++; s.pass.sackYds += gained; bp.yds += gained; continue; }
      if (r.kind === 'scramble') { s.pass.scr++; s.pass.scrYds += gained; bp.yds += gained; continue; }
      s.pass.att++;
      if (r.why === 'thrown away') s.pass.away++;
      if (r.why === 'dropped') s.pass.drop++;
      if (r.incomplete) (s.why ||= {})[r.why] = ((s.why ||= {})[r.why] || 0) + 1;
      if (r.interception) s.pass.int++;
      else if (!r.incomplete) {
        s.pass.comp++;
        s.pass.yds += gained;
        s.pass.yac = (s.pass.yac || 0) + (gained - Math.round(r.catchY || 0));
        bp.yac = (bp.yac || 0) + (gained - Math.round(r.catchY || 0));
        bp.air = (bp.air || 0) + Math.round(r.catchY || 0);
        bp.ok++;
        if (r.td) s.pass.td++;
      }
      bp.yds += gained;
    }
  }
  return s;
}

function pct(a, b) {
  return b ? `${((100 * a) / b).toFixed(1)}%` : '-';
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const n = Number(process.argv[2] || 2000);
  const t0 = Date.now();
  const s = runBalance(n);
  const R = s.run;
  const P = s.pass;
  console.log(`plays: ${n}  (${((Date.now() - t0) / 1000).toFixed(1)}s, avg play ${(s.time / n).toFixed(1)}s)`);
  console.log(`RUN   ${R.n} carries  ${(R.yds / R.n).toFixed(2)} ypc  neg ${pct(R.neg, R.n)}  15+ ${pct(R.big, R.n)}  TD ${R.td}  fum lost ${R.fum}`);
  console.log(`PASS  ${P.comp}/${P.att} ${pct(P.comp, P.att)}  ${(P.yds / P.att).toFixed(2)} ypa  ${(P.yds / Math.max(1, P.comp)).toFixed(1)} ypc  INT ${pct(P.int, P.att)}  TD ${P.td}  drops ${P.drop}  away ${P.away}`);
  console.log(`      sacks ${pct(P.sacks, P.dropbacks)} of dropbacks (avg ${(P.sackYds / Math.max(1, P.sacks)).toFixed(1)})  scrambles ${pct(P.scr, P.dropbacks)} (${(P.scrYds / Math.max(1, P.scr)).toFixed(1)} avg)`);
  console.log('      incompletions:', JSON.stringify(s.why));
  console.log(`      avg YAC ${(P.yac / Math.max(1, P.comp)).toFixed(1)}   events:`, JSON.stringify(s.ev));
  console.log('\nby play:');
  for (const [id, b] of Object.entries(s.byPlay).sort()) console.log(`  ${id.padEnd(12)} n=${String(b.n).padStart(4)}  avg ${(b.yds / b.n).toFixed(2)}${b.ok ? `  comp ${b.ok}/${b.n}  air ${(b.air / b.ok).toFixed(1)} yac ${(b.yac / b.ok).toFixed(1)}` : ''}`);
}
