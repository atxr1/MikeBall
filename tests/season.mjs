// Season mode tests: schedules, tiebreakers, the bracket, the quick play
// resolver and whole seasons. Called from tests/run.mjs.

import { TEAMS } from '../src/data/teams.js';
import { realSchedule2026, matchups, firstSunday, playoffDates } from '../src/game/schedule.js';
import { buildSchedule } from '../src/game/weeks.js';
import { standings, buildTable, order, newBracket, advance, winnerOf } from '../src/game/standings.js';
import { broadcastForGame } from '../src/data/broadcast.js';
import { STANDINGS_2025 } from '../src/data/league2025.js';
import { Game } from '../src/game/rules.js';
import { simulateGame } from '../src/game/autoplay.js';
import * as S from '../src/game/season.js';

const INFO = TEAMS.map((t) => ({ id: t.id, conf: t.conf, div: t.div }));
const confOf = Object.fromEntries(TEAMS.map((t) => [t.id, t.conf]));
const divOf = Object.fromEntries(TEAMS.map((t) => [t.id, `${t.conf}${t.div}`]));

// every club 17 games and one bye, nobody twice in a week
function shapeErrors(games, byeLo = 5, byeHi = 14) {
  const errs = [];
  for (const t of TEAMS) {
    const mine = games.filter((g) => g.home === t.id || g.away === t.id);
    const weeks = mine.map((g) => g.week);
    if (mine.length !== 17) errs.push(`${t.id} ${mine.length} games`);
    if (new Set(weeks).size !== weeks.length) errs.push(`${t.id} twice in a week`);
    const bye = [...Array(18).keys()].map((i) => i + 1).filter((w) => !weeks.includes(w));
    if (bye.length !== 1 || bye[0] < byeLo || bye[0] > byeHi) errs.push(`${t.id} bye ${bye}`);
  }
  return errs;
}

export function runSeasonTests(check, between, real) {
  console.log('season: schedules');
  const s26 = realSchedule2026();
  check('2026: 272 games, every club 17 and a bye in weeks 5-14', s26.games.length === 272 && shapeErrors(s26.games).length === 0, shapeErrors(s26.games).slice(0, 3).join('; '));
  const hosted = (games, id) => games.filter((g) => g.home === id).length;
  check('2026: AFC clubs host 8, NFC clubs 9 (the NFC has the 17th game at home in even years)', TEAMS.every((t) => hosted(s26.games, t.id) === (t.conf === 'AFC' ? 8 : 9)));
  check('2026: week 18 is all division games', s26.games.filter((g) => g.week === 18).every((g) => divOf[g.home] === divOf[g.away]) && s26.games.filter((g) => g.week === 18).length === 16);
  check('2026: the champion (SEA) opens at home on Wednesday, Sept. 9', (() => { const g = s26.games.find((x) => x.tag === 'KICKOFF'); return g && g.home === 'SEA' && g.date === '2026-09-09'; })());
  const thx = s26.games.filter((g) => g.date === '2026-11-26');
  check('2026: Thanksgiving is Nov. 26, at Detroit, Dallas and one night game', thx.length === 3 && thx.some((g) => g.home === 'DET') && thx.some((g) => g.home === 'DAL'));
  check('2026: three Christmas games on Friday, Dec. 25', s26.games.filter((g) => g.date === '2026-12-25').length === 3);
  check('2026: week 1 Sunday is Sept. 13; the Super Bowl Feb. 14, 2027', firstSunday(2026) === '2026-09-13' && playoffDates('2026-09-13').superBowl === '2027-02-14');
  const ko = broadcastForGame(s26.games.find((x) => x.tag === 'KICKOFF'));
  const mel = broadcastForGame(s26.games.find((x) => x.site === 'Melbourne'));
  check('broadcasts: the opener is NBC at night; Melbourne is Netflix at 8:35', ko.net === 'nbc' && ko.night && mel.net === 'netflix' && /8:35 PM/.test(mel.label));

  // the formula reproduces the league's 2026 matchups from 2025's finishes
  const places = Object.fromEntries(Object.entries(STANDINGS_2025).map(([id, r]) => [id, r.divRank]));
  const gen = matchups(2026, places);
  const pairKey = (g) => [g.home, g.away].sort().join('-');
  const count = (list) => list.reduce((m, g) => m.set(pairKey(g), (m.get(pairKey(g)) || 0) + 1), new Map());
  const A = count(gen);
  const B = count(s26.games);
  const same = [...B].every(([k, n]) => A.get(k) === n) && A.size === B.size;
  check('formula: 2026 matchups from 2025 standings match the real schedule', same);
  const exactHome = gen.filter((g) => g.kind === 'place' || g.kind === 'seventeen').every((g) => s26.games.some((x) => x.home === g.home && x.away === g.away));
  check('formula: same-place games and the 17th game have the real hosts', exactHome);

  const g27 = buildSchedule(2027, { places, champion: 'PHI', generate: true }, 7);
  const g27b = buildSchedule(2027, { places, champion: 'PHI', generate: true }, 7);
  const e27 = shapeErrors(g27.games);
  check('2027 (generated): 17 games and a bye in weeks 5-14 for everyone', e27.length === 0, e27.slice(0, 3).join('; '));
  check('2027: week 18 all division games; Detroit and Dallas host on Thanksgiving', g27.games.filter((g) => g.week === 18).every((g) => g.kind === 'div') && ['DET', 'DAL'].every((h) => g27.games.some((g) => g.week === 12 && g.home === h && g.tag === 'THX')));
  check('2027: the champion hosts the opener', g27.games.some((g) => g.week === 1 && g.home === 'PHI' && g.tag === 'KICKOFF'));
  const b2b = TEAMS.some((t) => {
    const mine = g27.games.filter((g) => g.home === t.id || g.away === t.id).sort((a, b) => a.week - b.week);
    return mine.some((g, i) => i && mine[i - 1].week === g.week - 1 && [mine[i - 1].home, mine[i - 1].away].includes(g.home === t.id ? g.away : g.home));
  });
  check('2027: nobody plays the same team in back-to-back weeks', !b2b);
  check('2027: the same seed gives the same schedule', JSON.stringify(g27.games) === JSON.stringify(g27b.games));
  check('2027: AFC clubs host 9 in odd years', TEAMS.every((t) => hosted(g27.games, t.id) === (t.conf === 'AFC' ? 9 : 8)));
  check('2027: Super Bowl date (Feb. 13, 2028) from the calendar', playoffDates(firstSunday(2027)).superBowl === '2028-02-13');

  console.log('season: standings and tiebreakers');
  const R = (home, away, hs, as) => ({ home, away, hs, as, week: 1 });
  // head-to-head
  let ctx = buildTable([R('BUF', 'MIA', 24, 10), R('MIA', 'NYJ', 20, 17), R('KC', 'BUF', 30, 20), R('NYJ', 'CHI', 3, 6)], INFO);
  check('division tie: head-to-head first', order(ctx, ['MIA', 'BUF'], 'div')[0] === 'BUF' && ctx.rows.BUF.tieNote === 'h2h');
  // split head-to-head: division record
  ctx = buildTable([R('BUF', 'MIA', 24, 10), R('MIA', 'BUF', 20, 17), R('BUF', 'NYJ', 21, 7), R('KC', 'BUF', 30, 20), R('MIA', 'KC', 23, 13), R('NE', 'MIA', 27, 20)], INFO);
  check('division tie: a split goes to division record', order(ctx, ['MIA', 'BUF'], 'div')[0] === 'BUF' && ctx.rows.BUF.tieNote === 'div');
  // wild card, different divisions, no meeting: conference record
  ctx = buildTable([R('BUF', 'KC', 24, 10), R('BUF', 'DAL', 24, 10), R('NE', 'BUF', 24, 10), R('BAL', 'CIN', 24, 10), R('BAL', 'PIT', 24, 10), R('DAL', 'BAL', 24, 10)], INFO);
  check('wild card tie: conference record when they did not meet', order(ctx, ['BUF', 'BAL'], 'wc')[0] === 'BAL' && ctx.rows.BAL.tieNote === 'conf');
  // three clubs, one swept the others
  ctx = buildTable([R('BUF', 'BAL', 24, 10), R('HOU', 'BUF', 10, 24), R('NYG', 'BUF', 24, 10), R('PHI', 'BUF', 24, 10),
    R('BAL', 'DAL', 24, 10), R('BAL', 'WAS', 24, 10), R('BAL', 'GB', 10, 24), R('HOU', 'CHI', 24, 10), R('HOU', 'DET', 24, 10), R('HOU', 'MIN', 10, 24)], INFO);
  check('wild card, three clubs: a head-to-head sweep wins it', order(ctx, ['BAL', 'HOU', 'BUF'], 'wc')[0] === 'BUF');
  // two from the same division in a wild-card race use the division steps
  ctx = buildTable([R('BUF', 'MIA', 24, 10), R('MIA', 'BUF', 24, 10), R('BUF', 'NYJ', 24, 10), R('NE', 'MIA', 24, 10)], INFO);
  check('wild card, same division: division tiebreakers', order(ctx, ['MIA', 'BUF'], 'wc')[0] === 'BUF');

  // seeds: a division winner is seeded over a better wild card
  const res = [];
  for (const g of s26.games) {
    // a made-up season: the higher-listed club in TEAMS order wins, except
    // the AFC West, which loses everything
    const aw = (id) => confOf[id] === 'AFC' && divOf[id] === 'AFCWest';
    const homeWins = aw(g.away) || (!aw(g.home) && TEAMS.findIndex((t) => t.id === g.home) < TEAMS.findIndex((t) => t.id === g.away));
    res.push({ ...g, hs: homeWins ? 24 : 10, as: homeWins ? 10 : 24 });
  }
  const st = standings(res, INFO, 'test');
  const afcWestWinner = st.divisions.AFC.West[0];
  check('seeds: four division winners take 1-4, even a losing one', st.seeds.AFC.slice(0, 4).includes(afcWestWinner) && st.rows[afcWestWinner].w < st.rows[st.seeds.AFC[4]].w);
  check('seeds: seven per conference, no repeats', ['AFC', 'NFC'].every((c) => new Set(st.seeds[c].slice(0, 7)).size === 7));
  const b = newBracket(st.seeds, 2026);
  const s = b.seeds.AFC;
  check('bracket: wild card 2-7, 3-6, 4-5 at the higher seed; the 1 seed rests', b.rounds[0].filter((g) => g.conf === 'AFC').map((g) => `${g.home}-${g.away}`).join() === [`${s[1]}-${s[6]}`, `${s[2]}-${s[5]}`, `${s[3]}-${s[4]}`].join() && !b.rounds[0].some((g) => g.home === s[0] || g.away === s[0]));
  // lower seeds win every wild-card game: the 1 seed draws the 7
  for (const g of b.rounds[0]) { g.hs = 10; g.as = 20; }
  advance(b);
  check('bracket: re-seeded divisional round, the 1 seed gets the lowest left', b.rounds[1].some((g) => g.home === s[0] && g.away === s[6]) && b.rounds[1].some((g) => g.home === s[4] && g.away === s[5]));
  for (const g of b.rounds[1]) { g.hs = 20; g.as = 10; }
  advance(b);
  for (const g of b.rounds[2]) { g.hs = 20; g.as = 10; }
  advance(b);
  check('bracket: the Super Bowl at a neutral site, AFC designated home in LXI', b.rounds[3].length === 1 && b.rounds[3][0].neutral && b.rounds[3][0].home === winnerOf(b.rounds[2].find((g) => g.conf === 'AFC')));
  b.rounds[3][0].hs = 31; b.rounds[3][0].as = 17;
  advance(b);
  check('bracket: a champion', b.champion === b.rounds[3][0].home);

  console.log('season: playoff overtime');
  if (real) {
    const { teams, rosters } = real;
    const mk = (playoff) => new Game({ homeTeam: teams[0], awayTeam: teams[1], homeRoster: rosters[teams[0].id], awayRoster: rosters[teams[1].id], userSide: 'none', qLen: 15, seed: 3, playoff });
    const reg = mk(false);
    reg.quarter = 5; reg.clock = 0; reg.score = { home: 20, away: 20 }; reg.ot = { stage: 'sudden' };
    reg.endQuarter();
    check('regular season: overtime can end in a tie', reg.over);
    const po = mk(true);
    po.score = { home: 20, away: 20 }; po.quarter = 4; po.clock = 0;
    po.endQuarter();
    check('playoffs: a 15-minute overtime with three timeouts each', po.quarter === 5 && po.clock === 900 && po.timeouts.home === 3 && !po.warningPeriod());
    po.clock = 0; po.ot.stage = 'sudden';
    po.endQuarter();
    check('playoffs: still tied, a second period (with a two-minute warning)', po.quarter === 6 && !po.over && po.clock === 900 && po.warningPeriod() && po.quarterText() === '2OT');
    po.clock = 0; po.timeouts = { home: 0, away: 1 };
    po.endQuarter();
    check('playoffs: the third period starts with a kickoff and fresh timeouts', po.quarter === 7 && po.phase === 'kickoff' && po.timeouts.home === 3);
    let ties = 0;
    let done = true;
    for (let i = 0; i < 24; i++) {
      const g = new Game({ homeTeam: teams[i], awayTeam: teams[31 - i], homeRoster: rosters[teams[i].id], awayRoster: rosters[teams[31 - i].id], userSide: 'none', qLen: 4, seed: 70 + i, playoff: true });
      g.quick = true;
      simulateGame(g, 20000);
      if (!g.over) done = false;
      if (g.score.home === g.score.away) ties++;
    }
    check('playoffs: no ties', ties === 0 && done, `${ties} ties`);

    console.log('season: the quick play resolver');
    const T = { att: 0, comp: 0, yds: 0, sacked: 0, int: 0, ratt: 0, ryds: 0, pts: 0, n: 0 };
    for (let i = 0; i < 60; i++) {
      const h = teams[i % 32];
      const a = teams[(i * 5 + 7) % 32];
      if (h === a) continue;
      const g = new Game({ homeTeam: h, awayTeam: a, homeRoster: rosters[h.id], awayRoster: rosters[a.id], userSide: 'none', qLen: 15, seed: 900 + i });
      g.quick = true;
      simulateGame(g, 20000);
      T.pts += g.score.home + g.score.away;
      T.n += 2;
      for (const l of g.stats.players.values()) {
        T.att += l.pass.att; T.comp += l.pass.comp; T.yds += l.pass.yds; T.sacked += l.pass.sacked; T.int += l.pass.int;
        T.ratt += l.rush.att; T.ryds += l.rush.yds;
      }
    }
    check('quick: completions 58-72%', between(T.comp / T.att, 0.58, 0.72), (T.comp / T.att * 100).toFixed(1));
    check('quick: 6-8.5 yards an attempt', between(T.yds / T.att, 6, 8.5), (T.yds / T.att).toFixed(2));
    check('quick: sacks on 4-9% of dropbacks', between(T.sacked / (T.att + T.sacked), 0.04, 0.09), (T.sacked / (T.att + T.sacked) * 100).toFixed(1));
    check('quick: interceptions on 1-3.5% of throws', between(T.int / T.att, 0.01, 0.035), (T.int / T.att * 100).toFixed(1));
    check('quick: 3.6-5 yards a carry', between(T.ryds / T.ratt, 3.6, 5), (T.ryds / T.ratt).toFixed(2));
    check('quick: 16-28 points a team', between(T.pts / T.n, 16, 28), (T.pts / T.n).toFixed(1));

    console.log('season: a whole season');
    const byId = (id) => teams.find((t) => t.id === id);
    const run = (seed, stopWeek = 99) => {
      const ss = S.newSeason({ year: 2026, userId: 'KC', seed, qLen: 4 });
      let guard = 0;
      while (ss.phase !== 'done' && ss.week < stopWeek && guard++ < 40) {
        S.simWeek(ss, rosters, byId, { includeUser: true });
        S.nextWeek(ss, rosters, teams);
      }
      return ss;
    };
    const t0 = Date.now();
    const full = run(5);
    const ms = Date.now() - t0;
    check('season: plays through to a champion', full.phase === 'done' && !!full.champion && full.games.filter((g) => g.round == null).every(S.played));
    check('season: 13 playoff games, the last a Super Bowl at SoFi', full.games.filter((g) => g.round != null).length === 13 && full.games.some((g) => g.round === 3 && g.site === 'Inglewood' && S.roundName(g, 2026) === 'Super Bowl LXI'));
    check('season: awards and All-Pro teams', full.awards && full.awards.awards.MVP && full.awards.allPro.first.length >= 25);
    const leadersOk = S.leaders(full, 'passYds', 5).length === 5 && S.leaders(full, 'sacks', 5).length === 5;
    check('season: league leaders', leadersOk);
    check('season: quick enough (a whole season in under 8 s)', ms < 8000, `${ms} ms`);
    // save, load and carry on: the same result as never stopping
    const half = run(5, 9);
    const saved = JSON.parse(JSON.stringify(half));
    let guard = 0;
    while (saved.phase !== 'done' && guard++ < 40) { S.simWeek(saved, rosters, byId, { includeUser: true }); S.nextWeek(saved, rosters, teams); }
    check('season: saved mid-season and resumed, same champion and scores', saved.champion === full.champion && JSON.stringify(saved.games.map((g) => [g.hs, g.as])) === JSON.stringify(full.games.map((g) => [g.hs, g.as])));
    const next = S.newSeason({ year: 2027, userId: 'KC', seed: 5, qLen: 4, prev: full });
    check('season: next year built from this one (champion opens at home)', next.games.length === 272 && next.games.some((g) => g.tag === 'KICKOFF' && g.home === full.champion) && next.lastChampion === full.champion);
  }
}
