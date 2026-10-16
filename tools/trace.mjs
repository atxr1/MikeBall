// Prints a text trace of one simulated play for debugging.
// Usage: node tools/trace.mjs <offPlayId> <defPlayId> [seed]

import { generateLeague } from '../src/data/roster.js';
import { offPlay, defPlay } from '../src/data/playbook.js';
import { offenseLineup, defenseLineup } from '../src/game/personnel.js';
import { PlaySim } from '../src/sim/playsim.js';
import { makeRng } from '../src/core/rng.js';
import { MID_X } from '../src/core/util.js';

const [oid = 'iz_r', did = 'cov3_43', seed = '3'] = process.argv.slice(2);
const league = generateLeague(2026);
const o = offPlay(oid);
const d = defPlay(did);
const sim = new PlaySim({
  offPlay: o,
  defPlay: d,
  offLineup: offenseLineup(league.KC, o.formation),
  defLineup: defenseLineup(league.BUF, d.front),
  ballOn: 30,
  ballX: MID_X,
  rng: makeRng(Number(seed)),
});
const f = (v) => v.toFixed(1).padStart(5);
let last = -1;
while (!sim.done) {
  sim.step();
  const tick = Math.floor(sim.t * 4);
  if (tick !== last) {
    last = tick;
    const h = sim.ball.holder;
    const near = sim.defense
      .map((p) => ({ p, d: h ? Math.hypot(p.x - h.x, p.y - h.y) : 0 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map(({ p, d: dd }) => `${p.slot}@${f(p.x)},${f(p.y)} d${dd.toFixed(1)}${p.blk ? 'B' : ''}${p.stumbleT > 0 ? 'S' : ''}`)
      .join('  ');
    console.log(`t=${sim.t.toFixed(2)} ${sim.phase.padEnd(5)} ball=${sim.ball.state} ${h ? `${h.slot}@${f(h.x)},${f(h.y)} v=${Math.hypot(h.vx, h.vy).toFixed(1)}` : `(${f(sim.ball.x)},${f(sim.ball.y)})`}  | ${near}  blocks=${sim.blocks.length}`);
  }
}
for (const e of sim.events) console.log(`  ev ${e.t.toFixed(2)} ${e.k} ${e.who?.slot || ''} ${e.on?.slot || ''} ${e.why || ''}`);
console.log(sim.result.outcome, sim.result.kind, 'yards', sim.result.yards, 'spotY', sim.result.spotY.toFixed(1));
