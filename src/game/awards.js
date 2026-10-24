// Awards from the game's own stats. Pure logic (no DOM).
//
//   playerOfTheGame(game)       best performance in a finished game, with a
//                               stat line ("27/34, 312 yds, 3 TD")
//   seasonAwards(season)        MVP, Offensive/Defensive Player of the Year,
//                               Offensive/Defensive Rookie of the Year, Coach
//                               of the Year, and AP-style All-Pro first and
//                               second teams, from season stat lines. Season
//                               mode feeds this at the end of each regular
//                               season; the real 2025 honors live in
//                               src/data/honors.js.
//
// A stat line looks like StatBook lines (src/game/stats.js): { id, name, pos,
// side|team, pass, rush, rec, def, kick, punt } plus, for seasons, { rookie,
// gp, ret: { kr, kry, pr, pry, td } } (returns and return yards).

const n = (v) => v || 0;

// How much a line did, by phase of the game.
export function offenseScore(l) {
  const p = l.pass || {};
  const r = l.rush || {};
  const c = l.rec || {};
  return n(p.yds) * 0.04 + n(p.td) * 4 - n(p.int) * 3 - n(p.sacked) * 0.5
    + n(r.yds) * 0.1 + n(r.td) * 6
    + n(c.yds) * 0.1 + n(c.rec) * 0.5 + n(c.td) * 6;
}

export function defenseScore(l) {
  const d = l.def || {};
  return n(d.tkl) + n(d.sacks) * 4 + n(d.int) * 5 + n(d.ff) * 3 + n(d.pbu) * 1.2;
}

export function kickScore(l) {
  const k = l.kick || {};
  return n(k.fgm) * 3 + n(k.xpm) - (n(k.fga) - n(k.fgm)) * 2 + (n(k.long) >= 50 ? 2 : 0);
}

function statLine(l) {
  const p = l.pass || {};
  const r = l.rush || {};
  const c = l.rec || {};
  const d = l.def || {};
  const k = l.kick || {};
  const parts = [];
  if (n(p.att) >= 5) parts.push(`${p.comp}/${p.att}, ${p.yds} yds, ${p.td} TD${p.int ? `, ${p.int} INT` : ''}`);
  if (n(r.att) >= 3 && (n(r.yds) >= 30 || n(r.td))) parts.push(`${r.att} car, ${r.yds} yds${r.td ? `, ${r.td} TD` : ''}`);
  if (n(c.rec) >= 2) parts.push(`${c.rec} rec, ${c.yds} yds${c.td ? `, ${c.td} TD` : ''}`);
  const dd = [];
  if (n(d.tkl)) dd.push(`${d.tkl} tkl`);
  if (n(d.sacks)) dd.push(`${d.sacks} sack${d.sacks > 1 ? 's' : ''}`);
  if (n(d.int)) dd.push(`${d.int} INT`);
  if (n(d.ff)) dd.push(`${d.ff} FF`);
  if (dd.length && !parts.length) parts.push(dd.join(', '));
  if (n(k.fga) && !parts.length) parts.push(`${k.fgm}/${k.fga} FG${k.long ? `, long ${k.long}` : ''}`);
  return parts.join('; ');
}

// Player of the Game: the best line in the box score, with a nudge for the
// winners (the trophy usually goes to the winning side).
export function playerOfTheGame(game) {
  const st = game.stats;
  const lines = [...st.players.values()];
  if (!lines.length) return null;
  const winner = game.score.home === game.score.away ? null : game.score.home > game.score.away ? 'home' : 'away';
  let best = null;
  let bestV = -1e9;
  for (const l of lines) {
    const v = (Math.max(offenseScore(l), defenseScore(l) * 1.6, kickScore(l) * 0.9)) * (l.side === winner ? 1.25 : 1);
    if (v > bestV) { bestV = v; best = l; }
  }
  if (!best) return null;
  return { line: best, side: best.side, team: game.teams[best.side], summary: statLine(best) };
}

// ---------------------------------------------------------------- seasons
// AP All-Pro format (2025): offense QB, RB, FB, all-purpose, 3 WR, TE, LT,
// LG, C, RG, RT; defense 3 edge, 2 interior, 2 LB, 2 CB, slot CB, 2 S;
// special teams K, P, KR, PR.
const AP_SLOTS = [
  ['QB', 1], ['RB', 1], ['FB', 1], ['All-purpose', 1], ['WR', 3], ['TE', 1],
  ['LT', 1], ['LG', 1], ['C', 1], ['RG', 1], ['RT', 1],
  ['Edge', 3], ['DT', 2], ['LB', 2], ['CB', 2], ['Slot CB', 1], ['S', 2],
  ['K', 1], ['P', 1], ['KR', 1], ['PR', 1],
];

// Which season lines can fill an AP slot, and how they're ranked. `lines`
// carry pos (QB/RB/WR/TE/OL/DL/LB/CB/S/K/P), slot (OL: LT/LG/C/RG/RT, RB:
// RB/FB, DL: EDGE/DT, CB: slot when he played the nickel), and grade (0-100,
// season-long blocking or coverage grade for linemen and DBs).
function candidates(lines, slot) {
  const by = (fn) => lines.filter(fn);
  switch (slot) {
    case 'QB': return [by((l) => l.pos === 'QB'), (l) => offenseScore(l) + n(l.wins) * 3];
    case 'RB': return [by((l) => l.pos === 'RB' && l.slot !== 'FB'), offenseScore];
    case 'FB': return [by((l) => l.slot === 'FB'), (l) => n(l.grade) + offenseScore(l) * 0.3];
    case 'All-purpose': return [by((l) => ['RB', 'WR', 'TE'].includes(l.pos)), (l) => offenseScore(l) + (n(l.ret && l.ret.kry) + n(l.ret && l.ret.pry)) * 0.06];
    case 'WR': return [by((l) => l.pos === 'WR'), offenseScore];
    case 'TE': return [by((l) => l.pos === 'TE'), (l) => offenseScore(l) + n(l.grade) * 0.2];
    case 'LT': case 'LG': case 'C': case 'RG': case 'RT':
      return [by((l) => l.pos === 'OL' && l.slot === slot), (l) => n(l.grade) + n(l.gp) * 0.5];
    case 'Edge': return [by((l) => l.pos === 'DL' && l.slot === 'EDGE' || (l.pos === 'LB' && l.slot === 'EDGE')), (l) => defenseScore(l) + n(l.def && l.def.sacks) * 3];
    case 'DT': return [by((l) => l.pos === 'DL' && l.slot !== 'EDGE'), (l) => defenseScore(l) + n(l.grade) * 0.3];
    case 'LB': return [by((l) => l.pos === 'LB' && l.slot !== 'EDGE'), defenseScore];
    case 'CB': return [by((l) => l.pos === 'CB' && l.slot !== 'slot'), (l) => defenseScore(l) + n(l.grade) * 0.4];
    case 'Slot CB': return [by((l) => l.pos === 'CB' && l.slot === 'slot'), (l) => defenseScore(l) + n(l.grade) * 0.4];
    case 'S': return [by((l) => l.pos === 'S'), (l) => defenseScore(l) + n(l.grade) * 0.3];
    case 'K': return [by((l) => l.pos === 'K'), kickScore];
    case 'P': return [by((l) => l.pos === 'P'), (l) => (l.punt && l.punt.n ? l.punt.yds / l.punt.n : 0)];
    case 'KR': return [by((l) => l.ret && l.ret.kr >= 8), (l) => l.ret.kry / l.ret.kr * 4 + l.ret.kry * 0.02 + n(l.ret.td) * 6];
    case 'PR': return [by((l) => l.ret && l.ret.pr >= 8), (l) => l.ret.pry / l.ret.pr * 4 + l.ret.pry * 0.03 + n(l.ret.td) * 6];
    default: return [[], () => 0];
  }
}

// season: { lines: [...], teams: [{ id, wins, losses, coach, lastWins }] }
export function seasonAwards(season) {
  const lines = season.lines.filter((l) => n(l.gp) >= 8 || l.pos === 'K' || l.pos === 'P');
  const winsOf = new Map(season.teams.map((t) => [t.id, t.wins]));
  for (const l of lines) l.wins = winsOf.get(l.team) || 0;
  const top = (list, fn) => list.slice().sort((a, b) => fn(b) - fn(a))[0] || null;
  const off = lines.filter((l) => ['QB', 'RB', 'WR', 'TE'].includes(l.pos));
  const def = lines.filter((l) => ['DL', 'LB', 'CB', 'S'].includes(l.pos));
  const mvpScore = (l) => offenseScore(l) * (l.pos === 'QB' ? 1.15 : 0.9) + n(l.wins) * 6;
  const awards = {
    MVP: top(off, mvpScore),
    OPOY: null,
    DPOY: top(def, defenseScore),
    OROY: top(off.filter((l) => l.rookie), offenseScore),
    DROY: top(def.filter((l) => l.rookie), defenseScore),
    COY: top(season.teams, (t) => (t.wins - n(t.lastWins)) * 2 + t.wins),
  };
  // the OPOY usually goes to the best non-MVP offensive season
  awards.OPOY = top(off.filter((l) => l !== awards.MVP), offenseScore);

  const allPro = { first: [], second: [] };
  const used = { first: new Set(), second: new Set() };
  for (const [slot, count] of AP_SLOTS) {
    const [pool, fn] = candidates(lines, slot);
    const ranked = pool.slice().sort((a, b) => fn(b) - fn(a));
    // first team takes the best; second team the next best not already on it
    let i = 0;
    for (const team of ['first', 'second']) {
      let got = 0;
      while (got < count && i < ranked.length) {
        const l = ranked[i++];
        if (slot === 'All-purpose' && used[team].has(l.id)) continue;
        allPro[team].push({ slot, line: l });
        used[team].add(l.id);
        got++;
      }
    }
  }
  return { awards, allPro };
}
