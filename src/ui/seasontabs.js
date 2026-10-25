// The season hub's tabs: schedule, scores, standings, leaders, playoffs and
// awards. Each renderer takes (app, season, standings) and returns a node.

import { h, clear, chevron } from './dom.js';
import { teamMarkSVG } from './emblems.js';
import { TEAMS, DIVISIONS } from '../data/teams.js';
import * as S from '../game/season.js';
import { broadcastForGame } from '../data/broadcast.js';
import { frontOfficeTab } from './frontoffice.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function dayLabel(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function recordText(s, id) {
  const st = S.seasonStandings(s, TEAMS);
  const r = st.rows[id];
  return `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}`;
}

const rec = (r) => `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}`;
const pct = (r) => (r.g ? (r.pct >= 1 ? '1.000' : r.pct.toFixed(3).replace(/^0/, '')) : '.000');
const mark = (app, id, size = 22) => h('span', { class: 'mk', html: teamMarkSVG(app.teamById(id), size) });

// a finished game as "W 24-17" from one club's side
function resultFor(g, id) {
  const us = g.home === id ? g.hs : g.as;
  const them = g.home === id ? g.as : g.hs;
  const wl = us > them ? 'W' : us < them ? 'L' : 'T';
  return { wl, text: `${wl} ${us}-${them}${g.ot ? ' OT' : ''}` };
}

// ---- schedule ---------------------------------------------------------------

function schedule(app, s) {
  const id = s.userId;
  const list = S.teamGames(s, id);
  const weeks = Math.max(S.REGULAR_WEEKS, ...list.map((g) => g.week));
  const rows = [];
  for (let w = 1; w <= weeks; w++) {
    const g = list.find((x) => x.week === w);
    const now = w === s.week && s.phase !== 'done';
    if (!g) {
      if (w <= S.REGULAR_WEEKS) rows.push(h('li', { class: `sched-row bye${now ? ' now' : ''}` }, h('span', { class: 'wk' }, String(w)), h('span', { class: 'opp-cell' }, 'Bye')));
      continue;
    }
    const home = g.home === id;
    const opp = home ? g.away : g.home;
    const b = broadcastForGame(g);
    let right;
    if (S.played(g)) {
      const r = resultFor(g, id);
      right = h('span', { class: `res res-${r.wl}` }, r.text);
    } else {
      right = h('span', { class: 'when' }, h('small', {}, dayLabel(g.date)), h('small', {}, `${b.label.split(' ').slice(1).join(' ')} ${b.netName}`));
    }
    rows.push(h('li', { class: `sched-row${now ? ' now' : ''}` },
      h('span', { class: 'wk' }, g.round != null ? ['WC', 'DIV', 'CONF', 'SB'][g.round] : String(w)),
      h('span', { class: 'opp-cell' }, h('span', { class: 'at' }, g.neutral || g.site ? 'vs' : home ? 'vs' : 'at'), mark(app, opp), h('strong', {}, app.teamById(opp).abbr)),
      right,
    ));
  }
  return h('ol', { class: 'sched' }, ...rows);
}

// ---- scores: any week's games ------------------------------------------------

function scores(app, s) {
  const last = Math.max(...s.games.map((g) => g.week));
  let w = Math.min(app.scoresWeek || s.lastWeek || s.week, last);
  if (!s.games.some((g) => g.week === w && S.played(g)) && w > 1 && !app.scoresWeek) w = Math.max(1, w - 1);
  const wrap = h('div', { class: 'scores' });
  const head = h('div', { class: 'week-pick' });
  const list = h('ul', { class: 'score-list' });
  const render = () => {
    app.scoresWeek = w;
    const mineFirst = (g) => (g.home === s.userId || g.away === s.userId ? 0 : 1);
    const games = s.games.filter((g) => g.week === w).sort((a, b) => mineFirst(a) - mineFirst(b) || a.date.localeCompare(b.date) || (a.slot > b.slot ? 1 : -1));
    const label = w <= S.REGULAR_WEEKS ? `Week ${w}` : S.roundName(games[0] || { round: w - 19, conf: '' }, s.year).replace(/^(AFC|NFC) /, '');
    clear(head);
    head.append(
      h('button', { class: 'icon-btn', 'aria-label': 'Previous week', disabled: w <= 1, onclick: () => { w--; render(); } }, chevron(-1)),
      h('strong', {}, label),
      h('button', { class: 'icon-btn', 'aria-label': 'Next week', disabled: w >= last, onclick: () => { w++; render(); } }, chevron(1)),
    );
    clear(list);
    if (!games.length) list.append(h('li', { class: 'empty' }, 'No games yet.'));
    for (const g of games) {
      const done = S.played(g);
      const b = broadcastForGame(g);
      const team = (id, pts, win) => h('div', { class: `sc-team${win ? ' win' : ''}${id === s.userId ? ' you' : ''}` }, mark(app, id, 20), h('span', {}, app.teamById(id).abbr), h('strong', {}, done ? String(pts) : ''));
      list.append(h('li', { class: 'score' },
        h('div', { class: 'sc-teams' }, team(g.away, g.as, done && g.as > g.hs), team(g.home, g.hs, done && g.hs > g.as)),
        h('div', { class: 'sc-info' },
          h('small', {}, done ? `Final${g.ot ? ' / OT' : ''}` : `${dayLabel(g.date)} · ${b.label.split(' ').slice(1).join(' ')}`),
          h('small', {}, g.site ? g.site : b.netName),
          done && g.potg ? h('small', { class: 'sc-potg' }, `${g.potg.name}: ${g.potg.summary}`) : null,
        ),
      ));
    }
  };
  render();
  wrap.append(head, list);
  return wrap;
}

// ---- standings ----------------------------------------------------------------

function standingsTab(app, s, st) {
  const user = app.teamById(s.userId);
  let conf = app.standConf || user.conf;
  let view = app.standView || 'div';
  const wrap = h('div', { class: 'standings' });
  // tiebreaker marks once they start to matter
  const notes = s.phase !== 'regular' || s.week > 12;
  const confBar = h('div', { class: 'segment', role: 'tablist' });
  const viewBar = h('div', { class: 'segment', role: 'tablist' });
  const body = h('div');
  const table = (ids, opts = {}) => h('table', { class: 'stand' },
    h('thead', {}, h('tr', {}, h('th', {}, opts.title || ''), h('th', {}, 'W-L'), h('th', {}, 'Pct'), h('th', {}, opts.div ? 'Div' : 'Conf'), h('th', {}, 'Strk'))),
    h('tbody', {}, ...ids.map((id, i) => {
      const r = st.rows[id];
      const seed = opts.seeds ? (i < 7 ? String(i + 1) : '') : null;
      return h('tr', { class: `${id === s.userId ? 'you' : ''}${opts.cut && i === 6 ? ' cut' : ''}` },
        h('th', {}, seed != null ? h('span', { class: 'seed' }, seed) : null, mark(app, id, 18), app.teamById(id).abbr, r.tieNote && notes ? h('sup', { title: 'won a tiebreaker' }, '*') : null),
        h('td', {}, rec(r)), h('td', {}, pct(r)), h('td', {}, rec(opts.div ? r.divRec : r.confRec)), h('td', {}, r.streak || '-'));
    })),
  );
  const render = () => {
    app.standConf = conf;
    app.standView = view;
    for (const b of confBar.children) b.setAttribute('aria-selected', String(b.dataset.v === conf));
    for (const b of viewBar.children) b.setAttribute('aria-selected', String(b.dataset.v === view));
    clear(body);
    if (view === 'div') {
      for (const div of DIVISIONS) body.append(h('h3', { class: 'stand-head' }, `${conf} ${div}`), table(st.divisions[conf][div], { div: true, notes: true }));
    } else {
      const started = Object.values(st.rows).some((r) => r.g);
      body.append(h('p', { class: 'stand-note' }, !started ? 'The race starts after week 1. Division winners are seeded 1-4, the best three others 5-7.' : s.phase === 'regular' ? 'If the season ended today: division winners are seeded 1-4, the best three others 5-7.' : 'Final seeds.'));
      if (started) body.append(table(st.seeds[conf], { seeds: true, cut: true, notes: true, title: conf }));
    }
    if (notes) body.append(h('p', { class: 'stand-note' }, '* won a tiebreaker (NFL rules: head-to-head, division and conference records, common games, strength of victory...)'));
  };
  for (const c of ['AFC', 'NFC']) {
    const b = h('button', { role: 'tab', 'data-v': c }, c);
    b.addEventListener('click', () => { conf = c; render(); });
    confBar.append(b);
  }
  for (const [v, label] of [['div', 'Divisions'], ['conf', 'Playoff race']]) {
    const b = h('button', { role: 'tab', 'data-v': v }, label);
    b.addEventListener('click', () => { view = v; render(); });
    viewBar.append(b);
  }
  render();
  wrap.append(confBar, viewBar, body);
  return wrap;
}

// ---- leaders ------------------------------------------------------------------

function leadersTab(app, s) {
  let cat = app.leaderCat || 'passYds';
  const wrap = h('div', { class: 'leaders-tab' });
  const chips = h('div', { class: 'chips', role: 'tablist' });
  const list = h('ol', { class: 'lead-list' });
  const render = () => {
    app.leaderCat = cat;
    for (const b of chips.children) b.setAttribute('aria-selected', String(b.dataset.v === cat));
    clear(list);
    const top = S.leaders(s, cat, 10);
    if (!top.length) list.append(h('li', { class: 'empty' }, 'No games played yet.'));
    top.forEach(({ l, v }, i) => list.append(h('li', { class: l.team === s.userId ? 'you' : '' },
      h('span', { class: 'rk' }, String(i + 1)),
      mark(app, l.team, 20),
      h('span', { class: 'nm' }, h('strong', {}, l.name), h('small', {}, `${app.teamById(l.team).abbr} ${l.pos}`)),
      h('span', { class: 'val' }, String(v)),
    )));
  };
  for (const c of S.LEADER_CATS) {
    const b = h('button', { class: 'chip', role: 'tab', 'data-v': c.id }, c.label);
    b.addEventListener('click', () => { cat = c.id; render(); });
    chips.append(b);
  }
  render();
  wrap.append(chips, list);
  return wrap;
}

// ---- playoffs -------------------------------------------------------------------

function playoffsTab(app, s) {
  const b = s.bracket;
  const wrap = h('div', { class: 'bracket' });
  if (!b) return wrap;
  const seedOf = (id) => {
    for (const c of ['AFC', 'NFC']) { const i = b.seeds[c].indexOf(id); if (i >= 0) return i + 1; }
    return '';
  };
  const game = (g) => {
    const done = g.hs != null;
    const line = (id, pts, win) => h('div', { class: `bk-team${win ? ' win' : ''}${id === s.userId ? ' you' : ''}` }, h('span', { class: 'seed' }, String(seedOf(id))), mark(app, id, 18), h('span', {}, app.teamById(id).abbr), h('strong', {}, done ? String(pts) : ''));
    return h('div', { class: 'bk-game' }, line(g.away, g.as, done && g.as > g.hs), line(g.home, g.hs, done && g.hs > g.as));
  };
  const names = ['Wild Card', 'Divisional', 'Championship'];
  for (const conf of ['AFC', 'NFC']) {
    wrap.append(h('h3', { class: 'stand-head' }, conf));
    const cols = h('div', { class: 'bk-cols' });
    for (let r = 0; r < 3; r++) {
      const list = b.rounds[r].filter((g) => g.conf === conf);
      const tbd = list.length ? [] : Array.from({ length: [3, 2, 1][r] }, () => h('div', { class: 'bk-tbd' }, 'TBD'));
      cols.append(h('div', { class: 'bk-col' }, h('small', {}, names[r]),
        r === 0 ? h('div', { class: 'bk-bye' }, h('span', { class: 'seed' }, '1'), mark(app, b.seeds[conf][0], 18), h('span', {}, `${app.teamById(b.seeds[conf][0]).abbr} bye`)) : null,
        ...list.map(game), ...tbd));
    }
    wrap.append(cols);
  }
  const sb = b.rounds[3][0];
  wrap.append(h('h3', { class: 'stand-head' }, S.superBowlName(s.year)), sb ? game(sb) : h('p', { class: 'stand-note' }, `${S.superBowlSite(s.year)}, two weeks after the conference championships.`));
  return wrap;
}

// ---- awards ---------------------------------------------------------------------

const AWARD_NAMES = {
  MVP: 'Most Valuable Player',
  OPOY: 'Offensive Player of the Year',
  DPOY: 'Defensive Player of the Year',
  OROY: 'Offensive Rookie of the Year',
  DROY: 'Defensive Rookie of the Year',
  COY: 'Coach of the Year',
};

function awardsTab(app, s) {
  const a = s.awards;
  const wrap = h('div', { class: 'awards' });
  if (!a) return wrap;
  wrap.append(h('p', { class: 'stand-note' }, `The ${s.year} regular season's honors, as the voters would see them.`));
  const list = h('ul', { class: 'award-list' });
  for (const [k, name] of Object.entries(AWARD_NAMES)) {
    const v = a.awards[k];
    if (!v) continue;
    list.append(h('li', { class: v.team === s.userId ? 'you' : '' },
      h('small', {}, name),
      h('div', {}, mark(app, v.team, 22), h('strong', {}, k === 'COY' ? (v.coach === 'You' ? 'You' : v.coach) : v.name), h('span', {}, k === 'COY' ? `${app.teamById(v.team).abbr}, ${v.wins} wins` : `${app.teamById(v.team).abbr} ${v.pos}`)),
    ));
  }
  wrap.append(list);
  for (const team of ['first', 'second']) {
    wrap.append(h('h3', { class: 'stand-head' }, `All-Pro ${team} team`));
    wrap.append(h('ul', { class: 'allpro' }, ...a.allPro[team].map((x) => h('li', { class: x.team === s.userId ? 'you' : '' }, h('span', { class: 'ap-slot' }, x.slot), mark(app, x.team, 18), h('span', {}, x.name)))));
  }
  return wrap;
}

export const tabRenderers = {
  team: frontOfficeTab,
  schedule,
  scores,
  standings: standingsTab,
  leaders: leadersTab,
  playoffs: playoffsTab,
  awards: awardsTab,
};
