// General Manager tests: contracts, the cap, the league save. Called from
// tests/run.mjs.

import { generateLeague } from '../src/data/roster.js';
import { capFor, minSalary, rookieDeal, marketBook, marketValue, ensureContracts, payroll } from '../src/game/contracts.js';
import { newLeagueState, serializeLeague, deserializeLeague, capSheet, allPlayers } from '../src/game/league.js';
import * as O from '../src/game/offseason.js';
import * as S from '../src/game/season.js';
import { openTalks, respond } from '../src/game/negotiate.js';
import { developPlayer } from '../src/game/progression.js';
import { makeDraftClass } from '../src/data/draftclass.js';
import { makeRng } from '../src/core/rng.js';

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

  runNegotiationTests(check);
  runProgressionTests(check, between);
  if (real) runOffseasonTests(check, between, real);
}

// A player with the given traits and a $10M ask, against fixed seeds.
function talkWith(traits, seed) {
  const p = { id: 't1', pos: 'WR', age: 27, exp: 5, traits: { loyalty: 5, greed: 5, competitor: 5, ego: 5, durability: 5, ...traits }, contract: { apy: 8e6 } };
  const rng = makeRng(seed);
  const talk = openTalks(p, { apy: 10e6, years: 3, guaranteed: 12e6 }, { own: true, winPct: 0.5, starter: true, year: 2027 }, rng);
  return { p, talk, rng };
}

function runNegotiationTests(check) {
  console.log('gm: negotiations');
  let accepts = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const { p, talk, rng } = talkWith({}, seed);
    if (respond(p, talk, { apy: 10e6, years: 3, guaranteed: 12e6 }, rng).result === 'accept') accepts++;
  }
  check('talks: meeting his ask always gets it done', accepts === 20);
  let counters = 0;
  let floorOk = true;
  for (let seed = 1; seed <= 20; seed++) {
    const { p, talk, rng } = talkWith({}, seed);
    const r = respond(p, talk, { apy: 7.5e6, years: 3, guaranteed: 6e6 }, rng);
    if (r.result === 'counter') counters++;
    if (r.counter && r.counter.apy < talk.floor) floorOk = false;
  }
  check('talks: a lowball gets a counter, never below his hidden floor', counters >= 18 && floorOk, `${counters}/20`);
  let walked = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const { p, talk, rng } = talkWith({ ego: 9, greed: 9 }, seed);
    let r;
    for (let i = 0; i < 8 && !talk.done; i++) r = respond(p, talk, { apy: 4e6, years: 3, guaranteed: 0 }, rng);
    if (r.result === 'walk' && talk.said.length <= 6) walked++;
  }
  check('talks: insult a proud, greedy player and he walks within a couple of rounds', walked === 20, `${walked}/20`);
  const loyal = talkWith({ loyalty: 10, greed: 2 }, 3).talk;
  const greedy = talkWith({ loyalty: 2, greed: 10 }, 3).talk;
  check('talks: a loyal player takes less from his own team than a greedy one', loyal.floor < greedy.floor && loyal.patience > greedy.patience, `${loyal.floor} vs ${greedy.floor}`);
  const { p, talk, rng } = talkWith({}, 7);
  respond(p, talk, { apy: 1, years: 3, guaranteed: 0 }, rng);
  check('talks: what he says comes out in plain money', talk.said.every((l) => !/NaN|undefined/.test(l.text)) && /\$10 million/.test(talk.said[0].text));
}

function runProgressionTests(check, between) {
  console.log('gm: development and aging');
  const cls = makeDraftClass(2027, 11);
  check('draft class: 258 prospects with combine badges and a big board', cls.length === 258 && cls.every((p) => p.combineBadges && p.board >= 1 && typeof p.dev === 'number'));
  const rng = makeRng(4);
  const young = [];
  const old = [];
  for (const p of cls.slice(0, 120)) {
    const a = JSON.parse(JSON.stringify(p));
    a.age = 22;
    young.push(developPlayer(a, rng));
    const b = JSON.parse(JSON.stringify(p));
    b.age = 33;
    old.push(developPlayer(b, rng));
  }
  const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  check('development: young players get better, 33-year-olds slow down', avg(young) > 1 && avg(old) < -1, `${avg(young).toFixed(2)} / ${avg(old).toFixed(2)}`);
}

// A whole 2026 season, then the CPU's whole offseason for all 32 teams.
function runOffseasonTests(check, between, real) {
  console.log('gm: a whole offseason');
  const { teams, rosters } = real;
  const byId = (id) => teams.find((t) => t.id === id);
  const s = S.newSeason({ year: 2026, userId: 'KC', seed: 21, qLen: 4 });
  let guard = 0;
  while (s.phase !== 'done' && guard++ < 40) { S.simWeek(s, rosters, byId, { includeUser: true }); S.nextWeek(s, rosters, teams); }
  const gm = newLeagueState(rosters, 2026);
  const before = Object.fromEntries(allPlayers(gm).map((p) => [p.id, p.age]));
  const rng = makeRng(77);
  const off = O.beginOffseason(s, gm, rng, teams);
  const sb = s.games.find((g) => g.round === 3);
  const loser = sb.hs > sb.as ? sb.away : sb.home;
  check('draft order: 32 teams, the champion last and the Super Bowl loser 31st', off.order.length === 32 && off.order[31] === s.champion && off.order[30] === loser);
  const survivors = allPlayers(gm);
  check('a new league year: everyone a year older, some retired', gm.year === 2027 && survivors.every((p) => before[p.id] == null || p.age === before[p.id] + 1) && between(off.retired.length, 30, 160), `${off.retired.length} retired`);
  check('the camp report leaves out the players who retired', off.improved.every((x) => !off.retired.some((r) => r.id === x.id)));
  const exp = survivors.filter((p) => p.expiring).length;
  check('contracts tick down: a quarter to a third of the league is up', between(exp / survivors.length, 0.2, 0.4), `${exp}`);
  for (const t of teams) O.cpuResign(gm, t.id, rng);
  const tags = allPlayers(gm).filter((p) => p.contract && p.contract.type === 'tag');
  const perTeam = {};
  for (const p of tags) perTeam[p.teamId] = (perTeam[p.teamId] || 0) + 1;
  check('franchise tags: a few around the league, never two on a team', between(tags.length, 1, 16) && Object.values(perTeam).every((n) => n === 1), `${tags.length} tags`);
  const tagOk = tags.every((p) => p.contract.guaranteed === p.contract.apy && p.contract.years === 1 && p.contract.apy >= O.tagValue(gm, { ...p, contract: null }) * 0.8);
  check('franchise tags: one year, fully guaranteed, top-five money', tagOk);
  O.openFreeAgency(gm);
  const fa0 = gm.fa.length;
  check('free agency opens with everyone not re-signed on the market', fa0 > 150 && gm.fa.every((p) => p.ask && p.ask.apy > 0) && !allPlayers(gm).some((p) => p.expiring), `${fa0}`);
  for (let d = 0; d < O.FA_DAYS; d++) O.faDay(s, gm, rng, [], teams);
  const signedFa = fa0 - gm.fa.length;
  check('free agency: a few hundred sign over five days', signedFa > 100, `${signedFa}`);
  check('free agency: no team spends past the cap', teams.every((t) => capSheet(gm, t.id).space > -1));
  off.stage = 'draft';
  let picks = 0;
  while (O.onTheClock(s) && picks < 300) { O.cpuPick(s, gm, rng); picks++; }
  const perPick = {};
  for (const d of off.drafted) perPick[d.teamId] = (perPick[d.teamId] || 0) + 1;
  check('the draft: 224 picks, seven a team', picks === 224 && Object.values(perPick).every((n) => n === 7) && new Set(off.drafted.map((d) => d.id)).size === 224);
  const top = off.drafted.slice(0, 32).map((d) => off.class.find((p) => p.id === d.id));
  const late = off.drafted.slice(-32).map((d) => off.class.find((p) => p.id === d.id));
  const mean = (xs) => xs.reduce((a, p) => a + p.draftValue, 0) / xs.length;
  check('the draft: first-rounders are better prospects than seventh-rounders', mean(top) > mean(late) + 0.2, `${mean(top).toFixed(2)} vs ${mean(late).toFixed(2)}`);
  check('the draft: rookies get the rookie scale', top.every((p) => p.contract && p.contract.type === 'rookie' && p.contract.years === 4));
  O.closeDraft(s, gm);
  for (const t of teams) O.cpuFinalize(gm, t.id, rng);
  const probs = teams.map((t) => [t.id, O.rosterProblems(gm, t.id)]).filter(([, p]) => p.length);
  check('camp: every team gets to 53 or fewer, set at every position, under the cap', probs.length === 0, probs.slice(0, 3).map(([id, p]) => `${id}: ${p.join(', ')}`).join('; '));
  const sizes = teams.map((t) => gm.rosters[t.id].players.length);
  check('camp: rosters end up full (50-53)', sizes.every((n) => between(n, 50, 53)), `${Math.min(...sizes)}-${Math.max(...sizes)}`);
  const ids = teams.map((t) => t.id);
  const back = deserializeLeague(JSON.parse(JSON.stringify(serializeLeague(gm))), ids);
  check('league save after the offseason: rosters and the moves come back', back && ids.every((id) => back.rosters[id].players.length === gm.rosters[id].players.length) && back.moves.length === Math.min(400, gm.moves.length) && back.year === 2027);
  const next = S.newSeason({ year: 2027, userId: 'KC', seed: 22, qLen: 4, prev: s });
  check('the 2027 season builds on top of it', next.games.length === 272);
}
