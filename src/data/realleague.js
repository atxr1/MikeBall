// Turns assets/data/league.json (built by tools/build-league.mjs) into the
// game's team and roster objects. Pure data; runs in the browser and Node.

import { POS_LIST } from './roster.js';

// Returns { teams: [...], rosters: { [teamId]: { teamId, players, depth } } }
export function fromLeagueJson(json) {
  const teams = [];
  const rosters = {};
  for (const t of json.teams) {
    const home = t.uniforms.home;
    teams.push({
      id: t.id,
      abbr: t.abbr,
      city: t.city,
      name: t.name,
      conf: t.conf,
      div: t.div,
      colors: {
        primary: t.colors.primary,
        secondary: t.colors.secondary,
        tertiary: t.colors.tertiary || null,
        helmet: home.helmet,
        pants: home.pants,
      },
      uniforms: t.uniforms,
      stadium: t.stadium,
      front: t.front,
      logoDark: !!t.logoDark,
      helmetLogo: !!t.helmetLogo,
      art: true,
    });
    const players = t.players.map((p) => ({
      id: p.id,
      teamId: t.id,
      first: p.first,
      last: p.last,
      pos: p.pos,
      posDetail: p.posDetail,
      num: p.num,
      age: p.age,
      exp: p.exp,
      college: p.college,
      height: p.height,
      weight: p.weight,
      attrs: { ...p.attrs },
      traits: { ...p.traits },
      skinTone: p.skinTone,
      injured: p.injured || null,
      portrait: !!p.portrait,
      born: p.born || null,
      draft: p.draft || null,
      contract: p.contract ? { ...p.contract } : null,
      badges: null,
    }));
    const ids = new Set(players.map((p) => p.id));
    const depth = {};
    for (const pos of [...POS_LIST, 'EDGE']) depth[pos] = (t.depth[pos] || []).filter((id) => ids.has(id));
    rosters[t.id] = { teamId: t.id, players, depth };
  }
  return { teams, rosters };
}

export const ASSET_ROOT = 'assets';

export function teamArt(team, file) {
  return team && team.art ? `${ASSET_ROOT}/teams/${team.id}/${file}` : null;
}
