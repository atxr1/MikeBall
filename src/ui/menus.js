// Title / team select, matchup setup and the final box score.

import { h, clear, chevron } from './dom.js';
import { teamMarkSVG } from './emblems.js';
import { TEAMS, CONFERENCES, DIVISIONS } from '../data/teams.js';
import { openRoster } from './roster.js';
import { fmtClock } from '../core/util.js';
import { SLOTS, slotById, broadcastFor } from '../data/broadcast.js';
import { playerOfTheGame } from '../game/awards.js';
import { titleCard, fitPixelCanvas } from './broadcast.js';
import { openSettings } from './settings.js';
import { importSeason } from './season.js';

// mode: 'season' (pick a team for a new season, or carry on with the one
// saved) or 'game' (a one-off game).
export function titleScreen(app, mode = app.titleMode || 'season') {
  const s = app.settings;
  let conf = (TEAMS.find((t) => t.id === s.userId) || TEAMS[0]).conf;
  const grid = h('div', { class: 'divisions' });
  const confBar = h('div', { class: 'segment', role: 'tablist' });
  const modeBar = h('div', { class: 'segment mode-bar', role: 'tablist' });
  const seasonBox = h('div');
  const pickNote = h('p', { class: 'pick-note' });
  const pick = (t) => (mode === 'season' ? app.showSeasonSetup(t.id) : app.showSetup(t.id));

  const renderMode = () => {
    app.titleMode = mode;
    for (const x of modeBar.children) x.setAttribute('aria-selected', String(x.dataset.v === mode));
    clear(seasonBox);
    const sv = app.season;
    if (mode === 'season' && sv) {
      const t = TEAMS.find((x) => x.id === sv.userId);
      const where = sv.phase === 'done' ? `${sv.year} season over` : sv.phase === 'playoffs' ? `${sv.year} playoffs` : `${sv.year} season · Week ${sv.week}`;
      seasonBox.append(h('section', { class: 'season-card' },
        h('span', { html: teamMarkSVG(t, 44) }),
        h('div', { class: 'tile-text' }, h('small', {}, where), h('strong', {}, `${t.name} ${app.seasonRecord(sv)}`)),
        h('button', { class: 'go', onclick: () => app.showSeason() }, sv.phase === 'done' ? 'View' : 'Continue'),
      ));
    }
    if (mode === 'season') {
      // (a backup file, e.g. after the phone cleared the app's storage)
      seasonBox.append(h('button', { class: 'act load-season', onclick: () => importSeason(app, seasonBox.closest('.screen') || seasonBox) }, 'Load a saved season'));
    }
    pickNote.textContent = mode === 'season'
      ? (sv && sv.phase !== 'done' ? 'Or pick a team to start a new season (it replaces this one).' : sv ? `Pick your team for the ${sv.year + 1} season.` : 'Pick your team for the season.')
      : 'Pick your team for a single game.';
  };
  for (const [v, label] of [['season', 'Season'], ['game', 'Single game']]) {
    const b = h('button', { role: 'tab', 'data-v': v }, label);
    b.addEventListener('click', () => { mode = v; renderMode(); });
    modeBar.append(b);
  }

  const render = () => {
    clear(grid);
    for (const div of DIVISIONS) {
      const teams = TEAMS.filter((t) => t.conf === conf && t.div === div);
      grid.append(h('section', { class: 'division' },
        h('h2', {}, `${conf} ${div}`),
        h('div', { class: 'team-grid' }, ...teams.map((t) =>
          h('button', { class: `team-tile${t.id === s.userId ? ' current' : ''}`, onclick: () => pick(t) },
            h('span', { html: teamMarkSVG(t, 44) }),
            h('span', { class: 'tile-text' }, h('small', {}, t.city), h('strong', {}, t.name)),
          ))),
      ));
    }
  };
  for (const c of CONFERENCES) {
    const b = h('button', { role: 'tab', 'aria-selected': String(c === conf) }, c);
    b.addEventListener('click', () => {
      conf = c;
      for (const x of confBar.children) x.setAttribute('aria-selected', String(x === b));
      render();
    });
    confBar.append(b);
  }
  render();
  renderMode();
  const screen = h('div', { class: 'screen title-screen' },
    h('header', { class: 'title-head' },
      h('div', { class: 'title-row' },
        h('h1', { class: 'wordmark' }, 'MikeBall'),
        h('button', { class: 'act settings-btn', onclick: () => openSettings(screen, app) }, 'Settings'),
      ),
      h('p', { class: 'lede' }, 'Own it. Build it. Coach it. Pick the team that’s yours.'),
    ),
    modeBar,
    seasonBox,
    pickNote,
    confBar,
    grid,
  );
  return screen;
}

export function setupScreen(app, userId) {
  const s = app.settings;
  const user = TEAMS.find((t) => t.id === userId);
  let oppId = s.oppId && s.oppId !== userId ? s.oppId : null;
  let home = s.userHome !== false;
  let qLen = s.qLen || 8;
  let slot = s.slot || 'sun_early';
  let renderSlotNote = () => {};

  const oppGrid = h('div', { class: 'opp-grid' });
  const oppLabel = h('p', { class: 'opp-label' });
  const renderOpp = () => {
    clear(oppGrid);
    const rnd = h('button', { class: `opp${oppId == null ? ' on' : ''}`, 'aria-pressed': String(oppId == null), onclick: () => { oppId = null; renderOpp(); } },
      h('span', { class: 'opp-rand' }, '?'));
    oppGrid.append(rnd);
    for (const t of TEAMS) {
      if (t.id === userId) continue;
      oppGrid.append(h('button', { class: `opp${t.id === oppId ? ' on' : ''}`, 'aria-pressed': String(t.id === oppId), 'aria-label': `${t.city} ${t.name}`, onclick: () => { oppId = t.id; renderOpp(); } },
        h('span', { html: teamMarkSVG(t, 38) })));
    }
    const o = TEAMS.find((t) => t.id === oppId);
    oppLabel.textContent = o ? `${o.city} ${o.name}` : 'Random opponent';
    renderSlotNote();
  };
  renderOpp();

  const seg = (opts, get, set) => {
    const wrap = h('div', { class: 'segment', role: 'radiogroup' });
    for (const [val, label] of opts) {
      const b = h('button', { role: 'radio', 'aria-checked': String(get() === val) }, label);
      b.addEventListener('click', () => {
        set(val);
        for (const x of wrap.children) x.setAttribute('aria-checked', String(x === b));
      });
      wrap.append(b);
    }
    return wrap;
  };

  // TV window: decides the network (scorebug, title cards) and day or night
  const slotNote = h('p', { class: 'slot-note' });
  renderSlotNote = () => {
    const opp = TEAMS.find((t) => t.id === oppId);
    const sl = slotById(slot);
    if (!opp) { slotNote.textContent = sl.title; return; }
    const b = broadcastFor(slot, home ? user : opp, home ? opp : user);
    slotNote.textContent = `${b.title} on ${b.netName}${b.night ? ', under the lights' : ''}`;
  };
  const slotGrid = h('div', { class: 'segment wrap', role: 'radiogroup' });
  for (const sl of SLOTS) {
    const b = h('button', { role: 'radio', 'aria-checked': String(sl.id === slot) }, sl.label);
    b.addEventListener('click', () => {
      slot = sl.id;
      for (const x of slotGrid.children) x.setAttribute('aria-checked', String(x === b));
      renderSlotNote();
    });
    slotGrid.append(b);
  }
  renderSlotNote();

  const start = () => {
    const opp = oppId || app.randomOpponent(userId);
    app.settings = { ...s, userId, oppId, userHome: home, qLen, slot };
    app.saveSettings();
    app.startGame({ userId, oppId: opp, userHome: home, qLen, slot });
  };

  return h('div', { class: 'screen setup-screen' },
    h('header', { class: 'setup-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back to teams', onclick: () => app.showTitle() }, chevron(-1)),
      h('span', { html: teamMarkSVG(user, 52) }),
      h('div', {}, h('small', {}, user.city), h('strong', { class: 'setup-team' }, user.name)),
    ),
    h('section', { class: 'setup-block' },
      h('h2', {}, 'Opponent'),
      oppLabel,
      oppGrid,
    ),
    h('section', { class: 'setup-block' },
      h('h2', {}, 'Where'),
      seg([[true, 'Home'], [false, 'Away']], () => home, (v) => { home = v; renderSlotNote(); }),
    ),
    h('section', { class: 'setup-block' },
      h('h2', {}, 'TV slot'),
      slotNote,
      slotGrid,
    ),
    h('section', { class: 'setup-block' },
      h('h2', {}, 'Quarter length'),
      seg([[5, '5 min'], [8, '8 min'], [12, '12 min'], [15, '15 min']], () => qLen, (v) => { qLen = v; }),
    ),
    h('div', { class: 'setup-actions' },
      h('button', { class: 'act', onclick: () => openRoster(app.root, user, app.league[userId], null, { editable: true }) }, 'Depth chart'),
      h('button', { class: 'go', onclick: start }, 'Kick off'),
    ),
  );
}

export function finalScreen(app, game, opts) {
  const T = game.teams;
  const st = game.stats;
  const sides = ['away', 'home'];
  const qCount = Math.max(4, game.qScores.home.length);
  const qHead = Array.from({ length: qCount }, (_, i) => (i < 4 ? String(i + 1) : 'OT'));

  const lineScore = h('table', { class: 'linescore' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), ...qHead.map((q) => h('th', {}, q)), h('th', {}, 'T'))),
    h('tbody', {}, ...sides.map((s) => h('tr', {},
      h('th', {}, h('span', { html: teamMarkSVG(T[s], 16) }), T[s].abbr),
      ...qHead.map((_, i) => h('td', {}, String(game.qScores[s][i] || 0))),
      h('td', { class: 'total' }, String(game.score[s])),
    ))),
  );

  // time of possession rounded so the two add up to the game's length
  const topAll = Math.round(st.team.home.top + st.team.away.top);
  const topShown = { home: Math.round(st.team.home.top) };
  topShown.away = topAll - topShown.home;
  const rows = [
    ['Total yards', (s) => st.team[s].yards],
    ['Passing', (s) => st.team[s].passYds],
    ['Rushing', (s) => st.team[s].rushYds],
    ['First downs', (s) => st.team[s].firstDowns],
    ['Third downs', (s) => `${st.team[s].thirdConv}/${st.team[s].thirdAtt}`],
    ['Turnovers', (s) => st.team[s].turnovers],
    ['Sacks', (s) => st.team[s].sacks],
    ['Penalties', (s) => `${st.team[s].penalties}-${st.team[s].penYds}`],
    ['Possession', (s) => fmtClock(topShown[s])],
  ];
  const teamStats = h('table', { class: 'teamstats' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, T.away.abbr), h('th', {}, T.home.abbr))),
    h('tbody', {}, ...rows.map(([label, fn]) => h('tr', {}, h('th', {}, label), h('td', {}, String(fn('away'))), h('td', {}, String(fn('home')))))),
  );

  const leaders = sides.map((s) => {
    const L = st.leaders(s);
    const line = (label, l, fmt) => (l ? h('li', {}, h('span', {}, label), h('strong', {}, `#${l.num} ${l.name}`), h('small', {}, fmt(l))) : null);
    return h('section', { class: 'leaders' },
      h('h3', {}, T[s].name),
      h('ul', {},
        line('Passing', L.passing, (l) => `${l.pass.comp}/${l.pass.att}, ${l.pass.yds} yds, ${l.pass.td} TD, ${l.pass.int} INT`),
        line('Rushing', L.rushing, (l) => `${l.rush.att} car, ${l.rush.yds} yds, ${l.rush.td} TD`),
        line('Receiving', L.receiving, (l) => `${l.rec.rec} rec, ${l.rec.yds} yds, ${l.rec.td} TD`),
        line('Defense', L.defense, (l) => `${l.def.tkl} tkl, ${l.def.sacks} sk, ${l.def.int} INT`),
      ),
    );
  });

  const user = game.userSide;
  const opp = user === 'home' ? 'away' : 'home';
  const us = game.score[user];
  const them = game.score[opp];
  const verdict = `${opts.seasonLabel ? `${opts.seasonLabel} · ` : ''}${us > them ? 'You won' : us < them ? 'You lost' : 'A tie'}`;

  return h('div', { class: 'screen final-screen' },
    h('header', { class: 'final-head' },
      h('p', { class: 'final-verdict' }, verdict),
      h('p', { class: 'final-score' },
        h('span', {}, `${T.away.abbr} ${game.score.away}`),
        h('span', { class: 'final-sep' }, ''),
        h('span', {}, `${T.home.abbr} ${game.score.home}`)),
    ),
    finalCard(game, opts),
    opts.season ? h('div', { class: 'setup-actions final-top' }, h('button', { class: 'go', onclick: () => app.showSeason('scores') }, 'Continue')) : null,
    lineScore,
    potg(game),
    h('h2', {}, 'Team stats'),
    teamStats,
    h('h2', {}, 'Leaders'),
    ...leaders,
    opts.season
      ? h('div', { class: 'setup-actions' }, h('button', { class: 'go', onclick: () => app.showSeason('scores') }, 'Continue'))
      : h('div', { class: 'setup-actions' },
        h('button', { class: 'act', onclick: () => app.showTitle() }, 'Change team'),
        h('button', { class: 'go', onclick: () => app.startGame({ ...opts, seed: undefined }) }, 'Rematch'),
      ),
  );
}

// The network's "Final" card over the box score.
function finalCard(game, opts) {
  const b = opts.broadcast || broadcastFor(opts.slot || 'sun_early', game.teams.home, game.teams.away);
  const card = titleCard(b.net, 'Final');
  if (!card) return null;
  card.setAttribute('aria-label', `Final, ${b.title} on ${b.netName}`);
  const wrap = h('div', { class: 'final-card' }, card);
  requestAnimationFrame(() => fitPixelCanvas(card, Math.min(400, wrap.clientWidth || 400)));
  return wrap;
}

// Player of the Game, from the box score.
function potg(game) {
  const pg = playerOfTheGame(game);
  if (!pg) return null;
  const l = pg.line;
  const rec = game.rosters[pg.side].players.find((p) => p.id === l.id);
  return h('section', { class: 'potg' },
    h('h2', {}, 'Player of the Game'),
    h('div', { class: 'potg-row' },
      rec && rec.portrait ? h('img', { class: 'px potg-face', src: `assets/portraits/${rec.id}.png`, width: 32, height: 32, alt: '' }) : h('span', { class: 'potg-mark', html: teamMarkSVG(pg.team, 40) }),
      h('div', {},
        h('strong', {}, `#${l.num} ${rec ? `${rec.first} ${rec.last}` : l.name}`),
        h('small', {}, `${pg.team.abbr} ${l.pos}`),
        h('p', {}, pg.summary || ''),
      ),
    ),
  );
}
