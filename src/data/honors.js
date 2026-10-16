// Real honors from the 2025 season, shown on players as "reigning" honors
// until the game's own seasons start handing them out (src/game/awards.js).
//
// Sources: AP 2025 All-Pro Team (announced Jan. 10, 2026; Wikipedia "2025
// All-Pro Team", AP via ABC7); 2026 NFL Honors winners (ABC30, Feb. 2026).
// Teams are the 2025 teams; players are matched by name, so a player who
// changed teams since keeps his honor.

export const HONORS_YEAR = 2025;

export const AWARDS = [
  ['MVP', 'Most Valuable Player', 'Matthew Stafford', 'LAR'],
  ['OPOY', 'Offensive Player of the Year', 'Jaxon Smith-Njigba', 'SEA'],
  ['DPOY', 'Defensive Player of the Year', 'Myles Garrett', 'CLE'],
  ['OROY', 'Offensive Rookie of the Year', 'Tetairoa McMillan', 'CAR'],
  ['DROY', 'Defensive Rookie of the Year', 'Carson Schwesinger', 'CLE'],
  ['CPOY', 'Comeback Player of the Year', 'Christian McCaffrey', 'SF'],
  ['POTY', 'Protector of the Year', 'Joe Thuney', 'CHI'],
];

export const COACH_OF_THE_YEAR = ['Mike Vrabel', 'NE'];

// [AP position, first team..., ] then second team
export const ALL_PRO = {
  first: [
    ['QB', 'Matthew Stafford', 'LAR'], ['RB', 'Bijan Robinson', 'ATL'], ['FB', 'Kyle Juszczyk', 'SF'],
    ['All-purpose', 'Christian McCaffrey', 'SF'],
    ['WR', 'Puka Nacua', 'LAR'], ['WR', 'Jaxon Smith-Njigba', 'SEA'], ['WR', "Ja'Marr Chase", 'CIN'],
    ['TE', 'Trey McBride', 'ARI'],
    ['LT', 'Garett Bolles', 'DEN'], ['LG', 'Joe Thuney', 'CHI'], ['C', 'Creed Humphrey', 'KC'],
    ['RG', 'Quinn Meinerz', 'DEN'], ['RT', 'Penei Sewell', 'DET'],
    ['Edge', 'Myles Garrett', 'CLE'], ['Edge', 'Micah Parsons', 'GB'], ['Edge', 'Will Anderson Jr.', 'HOU'],
    ['DT', 'Jeffery Simmons', 'TEN'], ['DT', 'Zach Allen', 'DEN'],
    ['LB', 'Jordyn Brooks', 'MIA'], ['LB', 'Jack Campbell', 'DET'],
    ['CB', 'Derek Stingley Jr.', 'HOU'], ['CB', 'Quinyon Mitchell', 'PHI'], ['Slot CB', 'Cooper DeJean', 'PHI'],
    ['S', 'Kyle Hamilton', 'BAL'], ['S', 'Kevin Byard', 'CHI'],
    ['K', 'Will Reichard', 'MIN'], ['P', 'Jordan Stout', 'BAL'], ['KR', 'Ray Davis', 'BUF'],
    ['PR', 'Chimere Dike', 'TEN'], ['ST', 'Devon Key', 'DEN'], ['LS', 'Ross Matiscik', 'JAX'],
  ],
  second: [
    ['QB', 'Drake Maye', 'NE'], ['RB', 'James Cook', 'BUF'], ['FB', 'Patrick Ricard', 'BAL'],
    ['All-purpose', 'Bijan Robinson', 'ATL'],
    ['WR', 'George Pickens', 'DAL'], ['WR', 'Chris Olave', 'NO'], ['WR', 'Amon-Ra St. Brown', 'DET'],
    ['TE', 'Kyle Pitts', 'ATL'],
    ['LT', 'Trent Williams', 'SF'], ['LG', 'Quenton Nelson', 'IND'], ['C', 'Aaron Brewer', 'MIA'],
    ['RG', 'Chris Lindstrom', 'ATL'], ['RT', 'Darnell Wright', 'CHI'],
    ['Edge', 'Aidan Hutchinson', 'DET'], ['Edge', 'Danielle Hunter', 'HOU'], ['Edge', 'Brian Burns', 'NYG'],
    ['DT', 'Leonard Williams', 'SEA'], ['DT', 'Cameron Heyward', 'PIT'],
    ['LB', 'Ernest Jones IV', 'SEA'], ['LB', 'Devin Lloyd', 'JAX'],
    ['CB', 'Devon Witherspoon', 'SEA'], ['CB', 'Patrick Surtain II', 'DEN'], ['Slot CB', 'Derwin James', 'LAC'],
    ['S', 'Jessie Bates', 'ATL'], ['S', 'Talanoa Hufanga', 'DEN'], ['S', 'Xavier McKinney', 'GB'],
    ['K', 'Brandon Aubrey', 'DAL'], ['P', 'Michael Dickson', 'SEA'], ['KR', 'KaVontae Turpin', 'DAL'],
    ['PR', 'Marcus Jones', 'NE'], ['ST', "Del'Shawn Phillips", 'LAC'], ['LS', 'Andrew DePaola', 'MIN'],
  ],
};

const SUFFIX = /\b(jr|sr|ii|iii|iv|v)\b/g;
const ALIAS = { 'pat surtain': 'patrick surtain' };

export function nameKey(first, last) {
  const k = `${first} ${last}`.toLowerCase().replace(/[.'’]/g, '').replace(SUFFIX, '').replace(/\s+/g, ' ').trim();
  return ALIAS[k] || k;
}

let byId = new Map();

// Match the honorees to the league's players once at boot (name first; when
// two players share a name, the one on the honored team).
export function resolveHonors(players) {
  byId = new Map();
  const byName = new Map();
  for (const p of players) {
    const k = nameKey(p.first || '', p.last || '');
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(p);
  }
  const give = (name, team, honor) => {
    const parts = name.split(' ');
    const cands = byName.get(nameKey(parts[0], parts.slice(1).join(' '))) || [];
    const p = cands.length === 1 ? cands[0] : cands.find((c) => c.teamId === team);
    if (!p) return false;
    if (!byId.has(p.id)) byId.set(p.id, []);
    byId.get(p.id).push(honor);
    return true;
  };
  let matched = 0;
  for (const [short, long, name, team] of AWARDS) matched += give(name, team, { kind: 'award', short, label: `${HONORS_YEAR} ${long}` });
  for (const [pos, name, team] of ALL_PRO.first) matched += give(name, team, { kind: 'allpro', team: 1, short: 'ALL-PRO', label: `${HONORS_YEAR} First-Team All-Pro (${pos})` });
  for (const [pos, name, team] of ALL_PRO.second) matched += give(name, team, { kind: 'allpro', team: 2, short: '2ND-TEAM ALL-PRO', label: `${HONORS_YEAR} Second-Team All-Pro (${pos})` });
  for (const list of byId.values()) list.sort((a, b) => (a.kind === b.kind ? a.team - b.team || 0 : a.kind === 'award' ? -1 : 1));
  return matched;
}

// Honors for a player record: awards first, then All-Pro.
export function honorsFor(p) {
  return (p && byId.get(p.id)) || [];
}
