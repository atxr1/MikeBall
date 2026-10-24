// Builds src/data/schedule2026.js, the real 2026 NFL regular season.
//
//   node tools/build-schedule2026.mjs
//
// Sources: each club's week-by-week list as published by CBS Sports (24
// clubs, with kickoff windows and networks) and Fox News (8 clubs, weeks
// only), checked against the official home/away opponent lists (CBS Sports,
// "2026 NFL schedule: home and away opponents for all 32 teams"). The script
// refuses to write unless every week pairs up on both clubs' lists and every
// club hosts exactly the opponents the league announced.
//
// Week entries: '[@]OPP slot net [site|tag]'. Slots: Su1 Sunday 1:00,
// Su4 Sunday 4:05/4:25, Su8 Sunday night, Su9 Sunday 9:30 a.m.
// (international), Mo8, Th8, We8, Sa4, Sa8, Fr1/Fr3/Fr4/Fr8 (holiday
// Fridays), Th1/Th4 (Thanksgiving afternoon); '?' = not announced (the
// usual rules fill it in: CBS when the road team is AFC, FOX when NFC, the
// late window when the home team is in the Mountain or Pacific time zone).
//
// Then the asset pack's copy of the league schedule (assets/data/raw/
// schedule_2026.json, as of mid-October 2026) confirms every date and
// supplies the kickoff times the club lists didn't have or that have
// changed since (flexed games). It also writes src/data/league2025.js: last
// season's standings and this season's head coaches, from the same pack.
import { readFileSync, writeFileSync } from 'node:fs';
import { TEAMS } from '../src/data/teams.js';
import { SLOT_INFO } from '../src/data/broadcast.js';

const NAMES = {
  Bills: 'BUF', Dolphins: 'MIA', Patriots: 'NE', Jets: 'NYJ', Ravens: 'BAL', Bengals: 'CIN', Browns: 'CLE', Steelers: 'PIT',
  Texans: 'HOU', Colts: 'IND', Jaguars: 'JAX', Titans: 'TEN', Broncos: 'DEN', Chiefs: 'KC', Raiders: 'LV', Chargers: 'LAC',
  Cowboys: 'DAL', Giants: 'NYG', Eagles: 'PHI', Commanders: 'WAS', Bears: 'CHI', Lions: 'DET', Packers: 'GB', Vikings: 'MIN',
  Falcons: 'ATL', Panthers: 'CAR', Saints: 'NO', Buccaneers: 'TB', Cardinals: 'ARI', Rams: 'LAR', '49ers': 'SF', Seahawks: 'SEA',
};
const N = (s) => s.split(',').map((x) => NAMES[x.trim()]);
// The official lists: each club hosts these opponents in 2026.
const HOME = {
  BUF: N('Patriots, Dolphins, Jets, Chiefs, Chargers, Ravens, Bears, Lions'),
  MIA: N('Bills, Patriots, Jets, Chiefs, Chargers, Bengals, Bears, Lions'),
  NE: N('Bills, Dolphins, Jets, Broncos, Raiders, Steelers, Vikings, Packers'),
  NYJ: N('Patriots, Dolphins, Bills, Broncos, Raiders, Browns, Vikings, Packers'),
  BAL: N('Bengals, Browns, Steelers, Jaguars, Titans, Chargers, Saints, Buccaneers'),
  CIN: N('Ravens, Browns, Steelers, Jaguars, Titans, Chiefs, Saints, Buccaneers'),
  CLE: N('Steelers, Bengals, Ravens, Texans, Colts, Raiders, Falcons, Panthers'),
  PIT: N('Ravens, Bengals, Browns, Texans, Colts, Broncos, Falcons, Panthers'),
  HOU: N('Colts, Jaguars, Titans, Ravens, Bengals, Bills, Cowboys, Giants'),
  IND: N('Texans, Jaguars, Titans, Ravens, Bengals, Dolphins, Cowboys, Giants'),
  JAX: N('Texans, Colts, Titans, Browns, Steelers, Patriots, Commanders, Eagles'),
  TEN: N('Texans, Colts, Jaguars, Browns, Steelers, Jets, Commanders, Eagles'),
  DEN: N('Chiefs, Chargers, Raiders, Bills, Dolphins, Jaguars, Seahawks, Rams'),
  KC: N('Broncos, Chargers, Raiders, Patriots, Jets, Colts, 49ers, Cardinals'),
  LV: N('Chiefs, Chargers, Broncos, Bills, Dolphins, Titans, Rams, Seahawks'),
  LAC: N('Broncos, Chiefs, Raiders, Patriots, Jets, Texans, Cardinals, 49ers'),
  DAL: N('Giants, Eagles, Commanders, Cardinals, 49ers, Buccaneers, Jaguars, Titans, Ravens'),
  NYG: N('Commanders, Cowboys, Eagles, Cardinals, 49ers, Saints, Jaguars, Titans, Browns'),
  PHI: N('Giants, Cowboys, Commanders, Rams, Seahawks, Panthers, Texans, Colts, Steelers'),
  WAS: N('Cowboys, Eagles, Giants, Rams, Seahawks, Falcons, Texans, Colts, Bengals'),
  CHI: N('Lions, Packers, Vikings, Saints, Buccaneers, Eagles, Patriots, Jets, Jaguars'),
  DET: N('Bears, Packers, Vikings, Saints, Buccaneers, Giants, Patriots, Jets, Titans'),
  GB: N('Bears, Lions, Vikings, Falcons, Panthers, Cowboys, Bills, Dolphins, Texans'),
  MIN: N('Bears, Lions, Packers, Falcons, Panthers, Commanders, Bills, Dolphins, Colts'),
  ATL: N('Panthers, Saints, Buccaneers, Bears, Lions, 49ers, Ravens, Bengals, Chiefs'),
  CAR: N('Falcons, Saints, Buccaneers, Bears, Lions, Seahawks, Ravens, Bengals, Broncos'),
  NO: N('Falcons, Buccaneers, Panthers, Packers, Vikings, Cardinals, Browns, Steelers, Raiders'),
  TB: N('Falcons, Panthers, Saints, Packers, Vikings, Rams, Browns, Steelers, Chargers'),
  ARI: N('49ers, Rams, Seahawks, Eagles, Commanders, Lions, Broncos, Raiders, Jets'),
  LAR: N('49ers, Cardinals, Seahawks, Cowboys, Giants, Packers, Chiefs, Chargers, Bills'),
  SF: N('Cardinals, Rams, Seahawks, Eagles, Commanders, Vikings, Broncos, Raiders, Dolphins'),
  SEA: N('Rams, Cardinals, 49ers, Cowboys, Giants, Bears, Chiefs, Chargers, Patriots'),
};

// Week 1 to 18 for each club. A neutral-site game is listed as a home game
// for the club the league designated as host.
const L = {
  ARI: '@LAC Su4 cbs|SEA Su4 fox|@SF Su4 fox|@NYG Su1 cbs|DET Su4 fox|@LAR Su4 fox|DEN Su4 cbs|@DAL Su1 fox|@SEA Su4 fox|LAR Su4 cbs|@KC Su1 cbs|WAS Su4 fox|PHI Su4 fox|BYE|NYJ Su4 fox|@NO Su1 fox|LV Su4 cbs|SF ?',
  ATL: '@PIT Su1 fox|CAR Su1 fox|@GB Th8 prime|@NO Mo8 espn|BAL Su8 nbc|CHI Su1 fox|SF Su1 fox|@TB Su1 fox|CIN Su9 nfl_network Madrid|KC Su1 cbs|BYE|@MIN Su1 fox|DET Su1 cbs|@CLE Su1 cbs|@WAS Su1 fox|TB ?|NO Su1 fox|@CAR ?',
  BAL: '@IND Su1 cbs|NO Su1 cbs|@DAL Su4 cbs Rio_de_Janeiro|TEN Su1 cbs|@ATL Su8 nbc|@CLE Su1 fox|CIN Su1 cbs|@BUF Su1 cbs|JAX Th8 prime|LAC Mo8 espn|@CAR Su1 fox|@HOU Su1 cbs|BYE|TB Su1 fox|@PIT Su1 cbs|CLE Su1 cbs|@CIN Th8 prime NYE|PIT ?',
  BUF: '@HOU Su1 cbs|DET Th8 prime|LAC Su1 fox|NE Su1 cbs|@LAR Mo8 espn|@LV Su4 cbs|BYE|BAL Su1 cbs|@MIN Mo8 espn|@NYJ Su1 cbs|MIA Su1 fox|KC Th8 nbc THX|@NE Su4 cbs|@GB Su8 nbc|CHI Sa8 cbs|@DEN Fr4 netflix XMAS|@MIA Su1 cbs|NYJ ?',
  CAR: 'CHI Su1 fox|@ATL Su1 fox|@CLE Su1 fox|DET Su8 nbc|BYE|@PHI Su1 cbs|TB Su1 fox|@GB Th8 prime|DEN Su1 cbs|@NO Su1 fox|BAL Su1 fox|@TB Mo8 espn|@MIN Su4 cbs|NO Su1 cbs|CIN Su1 fox|@PIT ?|SEA Su1 fox|ATL ?',
  CHI: '@CAR Su1 fox|MIN Su1 fox|PHI Mo8 espn|NYJ Su1 fox|@GB Su4 fox|@ATL Su1 fox|NE Th8 prime|@SEA Mo8 espn|TB Su8 nbc|BYE|NO Su1 fox|@DET Th1 cbs THX|JAX Su1 fox|@MIA Su1 fox|@BUF Sa8 cbs|GB Fr1 netflix XMAS|DET Su4 fox|@MIN ?',
  CIN: 'TB Su1 fox|@HOU Su1 cbs|@PIT Su1 cbs|JAX Su1 cbs|@MIA Su1 fox|BYE|@BAL Su1 cbs|TEN Su1 cbs|@ATL Su9 nfl_network Madrid|PIT Su8 nbc|@WAS Mo8 espn|NO Su1 cbs|@CLE Su1 cbs|KC Su4 fox|@CAR Su1 fox|@IND ?|BAL Th8 prime NYE|CLE ?',
  CLE: '@JAX Su1 cbs|@TB Su1 cbs|CAR Su1 fox|PIT Th8 prime|@NYJ Su1 cbs|BAL Su1 fox|@TEN Su1 cbs|@PIT Su1 cbs|@NO Su1 cbs|HOU Su1 fox|BYE|LV Su1 fox|CIN Su1 cbs|ATL Su1 cbs|@NYG Su1 cbs|@BAL Su1 cbs|IND Su1 fox|@CIN ?',
  DAL: '@NYG Su8 nbc|WAS Su4 fox|BAL Su4 cbs Rio_de_Janeiro|@HOU Su1 fox|TB Th8 prime|@GB Su8 nbc|@PHI Mo8 espn|ARI Su1 fox|@IND Su1 fox|SF Su4 fox|TEN Su1 fox|PHI Th4 fox THX|@SEA Mo8 espn|BYE|@LAR Su4 cbs|JAX Su8 nbc|NYG Su1 fox|@WAS ?',
  DEN: '@KC Mo8 espn|JAX Su4 cbs|LAR Su8 nbc|@SF Su4 cbs|@LAC Su4 cbs|SEA Th8 prime|@ARI Su4 cbs|KC Su4 cbs|@CAR Su1 cbs|BYE|LV Su4 cbs|@PIT Fr3 prime BF|MIA Su4 fox|@NYJ Su1 cbs|@LV Su4 cbs|BUF Fr4 netflix XMAS|@NE ?|LAC ?',
  DET: 'NO Su1 fox|@BUF Th8 prime|NYJ Su1 fox|@CAR Su8 nbc|@ARI Su4 fox|BYE|GB Su4 fox|MIN Su1 fox|@MIA Su1 fox|NE Su9 fox Munich|TB Su1 cbs|CHI Th1 cbs THX|@ATL Su1 cbs|TEN Su1 fox|@MIN Su8 nbc|NYG Mo8 espn|@CHI Su4 fox|@GB ?',
  GB: '@MIN Su4 cbs|@NYJ Su1 fox|ATL Th8 prime|@TB Su1 fox|CHI Su4 fox|DAL Su8 nbc|@DET Su4 fox|CAR Th8 prime|@NE Su4 fox|MIN Su1 fox|BYE|@LAR We8 netflix THXEVE|@NO Su1 fox|BUF Su8 nbc|MIA Su1 fox|@CHI Fr1 netflix XMAS|HOU Mo8 espn|DET ?',
  HOU: 'BUF Su1 cbs|CIN Su1 cbs|@IND Su1 cbs|DAL Su1 fox|@TEN Su1 cbs|@JAX Su9 nfl_network London|NYG Su1 fox|BYE|@LAC Su4 cbs|@CLE Su1 fox|IND Th8 prime|BAL Su1 cbs|@PIT Su8 nbc|@WAS Su1 cbs|JAX Su1 cbs|@PHI Th8 prime XEVE|@GB Mo8 espn|TEN ?',
  IND: 'BAL Su1 cbs|@KC Su8 nbc|HOU Su1 cbs|@WAS Su9 nfl_network London|@PIT Su1 cbs|TEN Su1 fox|@MIN Su1 cbs|@JAX Su1 cbs|DAL Su1 fox|MIA Su1 cbs|@HOU Th8 prime|NYG Su1 fox|BYE|@PHI Su1 fox|@TEN Su1 cbs|CIN ?|@CLE Su1 fox|JAX ?',
  JAX: 'CLE Su1 cbs|@DEN Su4 cbs|NE Su1 cbs|@CIN Su1 cbs|PHI Su9 nfl_network London|HOU Su9 nfl_network London|BYE|IND Su1 cbs|@BAL Th8 prime|@TEN Su1 fox|@NYG Su1 cbs|TEN Su4 cbs|@CHI Su1 fox|PIT Mo8 espn|@HOU Su1 cbs|@DAL Su8 nbc|WAS ?|@IND ?',
  KC: 'DEN Mo8 espn|IND Su8 nbc|@MIA Su1 cbs|@LV Su4 cbs|BYE|LAC Su4 cbs|@SEA Su8 nbc|@DEN Su4 cbs|NYJ Su1 cbs|@ATL Su1 cbs|ARI Su1 cbs|@BUF Th8 nbc THX|@LAR Th8 prime|@CIN Su4 fox|NE Mo8 espn|SF Su4 cbs|@LAC ?|LV ?',
  LV: 'MIA Su4 fox|@LAC Su4 cbs|@NO Su4 cbs|KC Su4 cbs|@NE Su1 cbs|BUF Su4 cbs|LAR Su4 fox|@NYJ Su1 fox|@SF Su4 cbs|SEA Su4 cbs|@DEN Su4 cbs|@CLE Su1 fox|BYE|LAC Su4 cbs|DEN Su4 cbs|TEN Su4 fox|@ARI Su4 cbs|@KC ?',
  LAC: 'ARI Su4 cbs|LV Su4 cbs|@BUF Su1 fox|@SEA Su4 cbs|DEN Su4 cbs|@KC Su4 cbs|BYE|@LAR Su4 fox|HOU Su4 cbs|@BAL Mo8 espn|NYJ Su4 fox|NE Su8 nbc|@TB Su1 cbs|@LV Su4 cbs|SF Th8 prime|@MIA Su1 fox|KC ?|@DEN ?',
  LAR: 'SF Th8 netflix Melbourne|NYG Mo8 espn|@DEN Su8 nbc|@PHI Su1 fox|BUF Mo8 espn|ARI Su4 fox|@LV Su4 fox|LAC Su4 fox|@WAS Su1 fox|@ARI Su4 cbs|BYE|GB We8 netflix THXEVE|KC Th8 prime|@SF Su4 fox|DAL Su4 cbs|@SEA Fr8 fox XMAS|@TB ?|SEA ?',
  MIA: '@LV Su4 fox|@SF Su4 fox|KC Su1 cbs|@MIN Su4 fox|CIN Su1 fox|BYE|@NYJ Su1 cbs|NE Su4 cbs|DET Su1 fox|@IND Su1 cbs|@BUF Su1 fox|NYJ Su1 cbs|@DEN Su4 fox|CHI Su1 fox|@GB Su1 fox|LAC Su1 fox|BUF Su1 cbs|@NE ?',
  MIN: 'GB Su4 cbs|@CHI Su1 fox|@TB Su4 fox|MIA Su4 fox|@NO Su1 fox|BYE|IND Su1 cbs|@DET Su1 fox|BUF Mo8 espn|@GB Su1 fox|@SF Su8 nbc Mexico_City|ATL Su1 fox|CAR Su4 cbs|@NE Th8 prime|DET Su8 nbc|WAS ?|@NYJ Su1 cbs|CHI ?',
  NE: '@SEA We8 nbc KICKOFF|PIT Su1 cbs|@JAX Su1 cbs|@BUF Su1 cbs|LV Su1 cbs|NYJ Su1 cbs|@CHI Th8 prime|@MIA Su4 cbs|GB Su4 fox|@DET Su9 fox Munich|BYE|@LAC Su8 nbc|BUF Su4 cbs|MIN Th8 prime|@KC Mo8 espn|@NYJ Su1 cbs|DEN ?|MIA ?',
  NO: '@DET Su1 fox|@BAL Su1 cbs|LV Su4 cbs|ATL Mo8 espn|MIN Su1 fox|@NYG Su1 fox|PIT Su9 nfl_network Paris|BYE|CLE Su1 cbs|CAR Su1 fox|@CHI Su1 fox|@CIN Su1 cbs|GB Su1 fox|@CAR Su1 cbs|@TB Su1 fox|ARI Su1 fox|@ATL Su1 fox|TB ?',
  NYG: 'DAL Su8 nbc|@LAR Mo8 espn|TEN Su1 cbs|ARI Su1 cbs|@WAS Su1 fox|NO Su1 fox|@HOU Su1 fox|BYE|@PHI Su1 fox|WAS Th8 prime|JAX Su1 cbs|@IND Su1 fox|SF Su1 fox|@SEA Su4 fox|CLE Su1 cbs|@DET Mo8 espn|@DAL Su1 fox|PHI ?',
  NYJ: '@TEN ?|GB ?|@DET ?|@CHI ?|CLE ?|@NE ?|MIA ?|LV ?|@KC ?|BUF ?|@LAC ?|@MIA ?|BYE|DEN ?|@ARI ?|NE ?|MIN ?|@BUF ?',
  PHI: 'WAS ?|@TEN ?|@CHI Mo8 espn|LAR ?|@JAX Su9 nfl_network London|CAR ?|DAL Mo8 espn|@WAS ?|NYG ?|BYE|PIT ?|@DAL Th4 fox THX|@ARI ?|IND ?|SEA Sa4 fox|HOU Th8 prime XEVE|@SF ?|@NYG ?',
  PIT: 'ATL ?|@NE ?|CIN ?|@CLE Th8 prime|IND ?|@TB ?|@NO Su9 nfl_network Paris|CLE ?|BYE|@CIN Su8 nbc|@PHI ?|DEN Fr3 prime BF|HOU ?|@JAX Mo8 espn|BAL ?|CAR ?|@TEN ?|@BAL ?',
  SF: '@LAR Th8 netflix Melbourne|MIA ?|ARI ?|DEN ?|@SEA ?|WAS Mo8 espn|@ATL ?|BYE|LV ?|@DAL ?|MIN Su8 nbc Mexico_City|SEA ?|@NYG ?|LAR ?|@LAC Th8 prime|@KC ?|PHI ?|@ARI ?',
  SEA: 'NE We8 nbc KICKOFF|@ARI ?|@WAS ?|LAC ?|SF ?|@DEN Th8 prime|KC ?|CHI Mo8 espn|ARI ?|@LV ?|BYE|@SF ?|DAL Mo8 espn|NYG ?|@PHI Sa4 fox|LAR Fr8 fox XMAS|@CAR ?|@LAR ?',
  TB: '@CIN ?|CLE ?|MIN ?|GB ?|@DAL Th8 prime|PIT ?|@CAR ?|ATL ?|@CHI Su8 nbc|BYE|@DET ?|CAR Mo8 espn|LAC ?|@BAL ?|NO ?|@ATL ?|LAR ?|@NO ?',
  TEN: 'NYJ ?|PHI ?|@NYG ?|@BAL ?|HOU ?|@IND ?|CLE ?|@CIN ?|BYE|JAX ?|@DAL ?|@JAX ?|WAS ?|@DET ?|IND ?|@LV ?|PIT ?|@HOU ?',
  WAS: '@PHI ?|@DAL ?|SEA ?|IND Su9 nfl_network London|NYG ?|@SF Mo8 espn|BYE|PHI ?|LAR ?|@NYG Th8 prime|CIN Mo8 espn|@ARI ?|@TEN ?|HOU ?|ATL ?|@MIN ?|@JAX ?|DAL ?',
};

const CONF = Object.fromEntries(TEAMS.map((t) => [t.id, t.conf]));
const WEST = new Set(['DEN', 'LV', 'LAC', 'ARI', 'LAR', 'SF', 'SEA']);
const TAGS = new Set(['KICKOFF', 'THX', 'THXEVE', 'BF', 'XMAS', 'XEVE', 'NYE']);

const errors = [];
const weeks = {};
for (const [t, line] of Object.entries(L)) {
  const parts = line.split('|').map((s) => s.trim());
  if (parts.length !== 18) errors.push(`${t}: ${parts.length} weeks`);
  weeks[t] = parts.map((p) => {
    if (p === 'BYE') return null;
    const [o, slot, net, extra] = p.split(' ');
    const away = o.startsWith('@');
    const opp = away ? o.slice(1) : o;
    if (!HOME[opp]) errors.push(`${t}: unknown opponent ${o}`);
    return {
      opp, home: away ? opp : t, away: away ? t : opp,
      slot: slot === '?' ? null : slot, net: net || null,
      site: extra && !TAGS.has(extra) ? extra.replace(/_/g, ' ') : null,
      tag: extra && TAGS.has(extra) ? extra : null,
    };
  });
}

const games = [];
for (const t of Object.keys(L)) {
  weeks[t].forEach((g, i) => {
    if (!g) return;
    const o = weeks[g.opp][i];
    if (!o || o.opp !== t) { errors.push(`week ${i + 1}: ${t} lists ${g.opp}, ${g.opp} lists ${o ? o.opp : 'a bye'}`); return; }
    if (o.home !== g.home) errors.push(`week ${i + 1}: ${t} and ${g.opp} disagree on who's home`);
    if (g.home !== t) return; // record each game once, from the host's list
    const slot = g.slot || o.slot;
    const net = g.net || o.net;
    games.push({
      w: i + 1, away: g.away, home: g.home,
      slot: slot || (WEST.has(g.home) ? 'Su4' : 'Su1'),
      net: net || (CONF[g.away] === 'AFC' ? 'cbs' : 'fox'),
      netKnown: !!net,
      site: g.site || o.site, tag: g.tag || o.tag,
    });
  });
}
for (const t of Object.keys(L)) {
  const mine = games.filter((g) => g.home === t || g.away === t);
  const hosted = games.filter((g) => g.home === t).map((g) => g.away).sort();
  if (mine.length !== 17) errors.push(`${t}: ${mine.length} games`);
  if (hosted.join() !== [...HOME[t]].sort().join()) errors.push(`${t}: hosts ${hosted.join()} but the league says ${[...HOME[t]].sort().join()}`);
}
if (games.length !== 272) errors.push(`${games.length} games, not 272`);

// the pack: dates must agree; kickoff times fill in and update
const raw = (f) => JSON.parse(readFileSync(new URL(`../assets/data/raw/${f}`, import.meta.url)));
const pack = raw('schedule_2026.json');
const PG = new Map(pack.games.map((g) => [`${g.week}:${g.away}@${g.home}`, g]));
const SUN1 = Date.UTC(2026, 8, 13);
const DAY = 86400000;
const changes = [];
for (const g of games) {
  const p = PG.get(`${g.w}:${g.away}@${g.home}`);
  if (!p) { errors.push(`week ${g.w} ${g.away}@${g.home} isn't in the pack`); continue; }
  const off = Math.round((Date.parse(`${p.date}T00:00:00Z`) - (SUN1 + (g.w - 1) * 7 * DAY)) / DAY);
  if (SLOT_INFO[g.slot].offset !== off && p.confidence === 'high') errors.push(`week ${g.w} ${g.away}@${g.home}: lists say ${g.slot}, pack says ${p.date}`);
  if (p.confidence !== 'high') continue;
  const [hh, mm] = p.kickoff_et.split(':').map(Number);
  const day = { '-4': 'We', '-3': 'Th', '-2': 'Fr', '-1': 'Sa', 0: 'Su', 1: 'Mo' }[off];
  const code = `${day}${hh < 11 ? 9 : hh < 14 ? 1 : hh < 16 ? 3 : hh < 19 ? 4 : 8}`;
  if (!SLOT_INFO[code]) { errors.push(`week ${g.w} ${g.away}@${g.home}: no slot for ${p.date} ${p.kickoff_et}`); continue; }
  if (code !== g.slot) {
    changes.push(`week ${g.w} ${g.away}@${g.home}: ${g.slot} -> ${code}`);
    const nightChange = /8$/.test(code) !== /8$/.test(g.slot);
    g.slot = code;
    if (!g.netKnown || nightChange) {
      g.net = { Su8: 'nbc', Mo8: 'espn', Th8: 'prime' }[code] || (CONF[g.away] === 'AFC' ? 'cbs' : 'fox');
    }
  }
  const h12 = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
  if (h12 !== SLOT_INFO[g.slot].time && !(g.slot === 'Su4' && (h12 === '4:05 PM' || h12 === '4:25 PM'))) g.time = `${hh}:${String(mm).padStart(2, '0')}`;
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const ORDER = ['We8', 'Th8', 'Th1', 'Th4', 'Fr3', 'Fr1', 'Fr4', 'Fr8', 'Sa4', 'Sa8', 'Su9', 'Su1', 'Su4', 'Su8', 'Mo8'];
games.sort((a, b) => a.w - b.w || ORDER.indexOf(a.slot) - ORDER.indexOf(b.slot) || a.home.localeCompare(b.home));
const byWeek = [];
for (const g of games) {
  (byWeek[g.w - 1] ||= []).push([`${g.away}@${g.home}`, g.slot, g.net, g.site && g.site.replace(/ /g, '_'), g.tag, g.time && `@${g.time}`].filter(Boolean).join(' '));
}
const body = byWeek.map((w, i) => `    // Week ${i + 1}\n    ${JSON.stringify(w).replace(/","/g, '", "')},`).join('\n');
const out = `// The real 2026 NFL regular season, 272 games. Generated by
// tools/build-schedule2026.mjs (see it for sources); edit that, not this.
//
// Each game: 'AWAY@HOME slot network [site] [tag]'. Slots are day + hour
// (Su1 Sunday 1:00, Su4 Sunday late window, Su8 Sunday night, Su9 Sunday
// morning abroad, Mo8, Th8, We8, Sa4, Sa8, Fr1/Fr3/Fr4/Fr8, Th1/Th4). A
// site is a neutral or international venue; the listed home team hosts.
// Tags: KICKOFF, THXEVE, THX, BF, XEVE, XMAS, NYE. '@20:35' is a kickoff
// (Eastern, 24-hour) that isn't the window's usual one.
// Pure data: no DOM.

export const SCHEDULE_2026 = {
  year: 2026,
  sunday1: '2026-09-13',
  weeks: [
${body}
  ],
};
`;
writeFileSync(new URL('../src/data/schedule2026.js', import.meta.url), out);
console.log(changes.join('\n'));
console.log(`wrote ${games.length} games (${changes.length} windows updated from the pack)`);

// last season and this season's coaches
const st = raw('standings_2025.json');
const coaches = raw('coaches.json');
const champ = st.find((x) => x.playoff_result === 'super_bowl_champion');
const lines = st.map((x) => `  ${x.team}: { w: ${x.w}, l: ${x.l}, t: ${x.t}, divRank: ${x.division_rank}, seed: ${x.conference_seed ?? 'null'}, result: '${x.playoff_result}' },`);
const league = `// The 2025 season's final standings and the 2026 head coaches, from the
// asset pack (assets/data/raw/standings_2025.json, coaches.json). Generated
// by tools/build-schedule2026.mjs. Season mode uses last season for the
// prime-time draw, the defending champion's opener and Coach of the Year.
// Pure data: no DOM.

export const LAST_SEASON = 2025;
export const CHAMPION_2025 = '${champ.team}';

export const STANDINGS_2025 = {
${lines.join('\n')}
};

export const COACHES = {
${coaches.map((c) => `  ${c.team}: ${JSON.stringify(c.head_coach)},`).join('\n')}
};
`;
writeFileSync(new URL('../src/data/league2025.js', import.meta.url), league);
console.log(`wrote src/data/league2025.js (champion ${champ.team})`);
