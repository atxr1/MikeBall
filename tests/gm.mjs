// General Manager tests: contracts, the cap, the league save. Called from
// tests/run.mjs.

import { generateLeague } from '../src/data/roster.js';
import { capFor, minSalary, rookieDeal, marketBook, marketValue, ensureContracts, payroll } from '../src/game/contracts.js';
import { newLeagueState, serializeLeague, deserializeLeague, capSheet } from '../src/game/league.js';

export function runGmTests(check, between, real) {
  console.log('gm: contracts and the cap');
  check('cap: $301.2M in 2026, growing after', capFor(2026) === 301_200_000 && capFor(2027) > capFor(2026));
  check('minimums rise with experience', minSalary(0, 2026) === 885_000 && minSalary(7, 2026) > minSalary(1, 2026));
  const r1 = rookieDeal(1, 2026);
  const r32 = rookieDeal(32, 2026);
  const r200 = rookieDeal(200, 2026);
  check('rookie scale: the first pick about $11M, the 32nd about $3.4M, late rounds near the minimum', between(r1.apy, 10.5e6, 11.5e6) && between(r32.apy, 3.2e6, 3.6e6) && r200.apy < 1.2e6 && r1.years === 4);

  if (real) {
    const { rosters } = real;
    const all = Object.values(rosters).flatMap((r) => r.players);
    check('the real league comes with contracts', all.every((p) => p.contract && p.contract.apy > 0 && p.contract.years >= 1));
    const book = marketBook(all);
    const qbs = all.filter((p) => p.pos === 'QB').map((p) => marketValue(p, book, 2026)).sort((a, b) => b - a);
    check('market: the best quarterbacks are worth $45-60M, a backup a few million', between(qbs[0], 45e6, 61e6) && qbs[60] < 6e6);
    const avg = all.reduce((s, p) => s + marketValue(p, book, 2026), 0) / 32;
    check('market: a whole roster at market rates comes in under the cap', between(avg, 0.75 * capFor(2026), capFor(2026)), `${(avg / 1e6).toFixed(0)}M`);
    const gm = newLeagueState(rosters, 2026);
    const sheet = capSheet(gm, 'KC');
    check('cap sheet: KC has room under the 2026 cap', sheet.space > 0 && sheet.used === payroll(rosters.KC));
    const ids = Object.keys(rosters);
    const back = deserializeLeague(JSON.parse(JSON.stringify(serializeLeague(gm))), ids);
    const same = ids.every((id) => back.rosters[id].players.length === rosters[id].players.length && JSON.stringify(back.rosters[id].depth) === JSON.stringify(rosters[id].depth));
    const p0 = rosters.KC.players[0];
    const q0 = back.rosters.KC.players.find((p) => p.id === p0.id);
    check('league save: every roster, depth chart and contract comes back', same && q0 && JSON.stringify(q0.contract) === JSON.stringify(p0.contract) && JSON.stringify(q0.attrs) === JSON.stringify(p0.attrs));
    check('league save: a save for other teams is refused', deserializeLeague(serializeLeague(gm), [...ids, 'XYZ']) === null);
  }
  const gen = generateLeague(2026);
  ensureContracts(gen, 2026);
  const gp = Object.values(gen).flatMap((r) => r.players);
  check('the generated league gets market contracts', gp.every((p) => p.contract && p.contract.apy >= minSalary(0, 2026) && p.contract.years >= 1));
}
