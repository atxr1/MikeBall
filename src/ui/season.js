// Season mode screens: starting a season, the hub between games, and the
// glue that plays or sims the user's game and moves the league along.
//
// The season itself lives in src/game/season.js; this keeps one save in
// localStorage ('mikeball:season') and writes it after everything that
// changes it, so closing the app never loses a week.

import { h, clear } from './dom.js';
import { teamMarkSVG } from './emblems.js';
import { TEAMS } from '../data/teams.js';
import * as S from '../game/season.js';
import { broadcastForGame } from '../data/broadcast.js';
import { openRoster } from './roster.js';
import { load, save } from '../core/storage.js';
import { tabRenderers, recordText, dayLabel } from './seasontabs.js';

const KEY = 'season';

export function loadSeason() {
  return S.migrate(load(KEY, null), TEAMS);
}

export function saveSeason(app) {
  if (!app.season) return false;
  const ok = save(KEY, app.season);
  if (!ok) app.saveFailed = true;
  return ok;
}

const teamOf = (app, id) => app.teamById(id);

// the user's depth chart rides along in the save
function applyDepth(app) {
  const s = app.season;
  const roster = app.league[s.userId];
  if (!s.depth || !roster) return;
  const ids = new Set(roster.players.map((p) => p.id));
  for (const [pos, list] of Object.entries(s.depth)) {
    if (!Array.isArray(list) || !roster.depth[pos]) continue;
    const keep = list.filter((id) => ids.has(id));
    const rest = roster.depth[pos].filter((id) => !keep.includes(id));
    roster.depth[pos] = [...keep, ...rest];
  }
}

export function resumeSeason(app) {
  app.season = loadSeason();
  if (!app.season) return false;
  applyDepth(app);
  return true;
}

// season: the one the setup screen built and showed (same seed, so the
// schedule you saw is the schedule you get)
export function beginSeason(app, season, qLen) {
  app.season = season;
  season.qLen = qLen;
  const userId = season.userId;
  // the depth chart as set on the way in rides along with the save
  app.season.depth = JSON.parse(JSON.stringify(app.league[userId].depth));
  saveSeason(app);
  app.showSeason('schedule');
}

// ---- playing a week -------------------------------------------------------

export function playUserGame(app) {
  const s = app.season;
  const g = s.phase === 'playoffs' ? S.currentRound(s).find((x) => x.home === s.userId || x.away === s.userId) : S.userGame(s);
  if (!g || S.played(g)) return;
  const userHome = g.home === s.userId;
  app.startGame({
    userId: s.userId,
    oppId: userHome ? g.away : g.home,
    userHome,
    qLen: s.qLen,
    seed: S.gameSeed(s, g),
    broadcast: broadcastForGame(g),
    playoff: S.isPlayoff(g),
    season: { gameId: g.id },
    seasonLabel: S.roundName(g, s.year),
    introCard: S.isPlayoff(g) ? [['wild_card', 'divisional', 'conference_final', 'championship'][g.round], S.roundName(g, s.year).toUpperCase()] : null,
  });
}

// The user's game is over (played or simmed): into the season, then the
// rest of the week, then on to the next one.
export function recordUserGame(app, game, opts) {
  const s = app.season;
  if (!s || !opts || !opts.season) return;
  const g = s.games.find((x) => x.id === opts.season.gameId);
  if (!g || S.played(g)) return;
  S.recordGame(s, g, game, app.league);
  finishWeek(app);
}

function finishWeek(app) {
  const s = app.season;
  s.lastWeek = s.week;
  app.scoresWeek = null;
  S.simWeek(s, app.league, app.teamById, { includeUser: false });
  S.nextWeek(s, app.league, TEAMS);
  saveSeason(app);
}

export function simUserGame(app) {
  const s = app.season;
  S.simWeek(s, app.league, app.teamById, { includeUser: true });
  finishWeek(app);
  app.showSeason('scores');
}

// sim straight on to a point: the end of the regular season, or the end.
// A week at a time, so the screen can say how far along it is.
function simAhead(app, until, host) {
  const s = app.season;
  const note = h('div', { class: 'sheet dialog', role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'sheet-panel dialog-panel' }, h('p', { class: 'dialog-title' }, 'Simming…'), h('p', { class: 'dialog-text' }, '')));
  if (host) host.append(note);
  let guard = 0;
  const step = () => {
    const done = guard++ >= 40 || s.phase === 'done' || (until === 'playoffs' && s.phase !== 'regular');
    if (done) {
      note.remove();
      app.scoresWeek = null;
      saveSeason(app);
      app.showSeason(s.phase === 'regular' ? 'scores' : 'playoffs');
      return;
    }
    note.querySelector('.dialog-text').textContent = s.phase === 'regular' ? `Week ${s.week}` : S.roundName(S.currentRound(s)[0] || { round: 0, conf: '' }, s.year).replace(/^(AFC|NFC) /, '');
    S.simWeek(s, app.league, app.teamById, { includeUser: true });
    s.lastWeek = s.week;
    S.nextWeek(s, app.league, TEAMS);
    setTimeout(step, 16);
  };
  setTimeout(step, 30);
}

// A yes/no sheet for the things that can't be undone.
export function confirmBox(host, title, text, yes, onYes) {
  const close = () => sheet.remove();
  const sheet = h('div', { class: 'sheet dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-panel dialog-panel' },
      h('p', { class: 'dialog-title' }, title),
      h('p', { class: 'dialog-text' }, text),
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'go', onclick: () => { close(); onYes(); } }, yes),
        h('button', { class: 'act', onclick: close }, 'Cancel'),
      ),
    ),
  );
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  host.append(sheet);
}

// ---- files: a season goes out as JSON and comes back the same way --------

// On iPhone the share sheet ("Save to Files") is the dependable way out,
// including from the home-screen app; elsewhere, a download.
async function exportSeason(app, host) {
  const s = app.season;
  const name = `mikeball-${s.year}-${s.userId}-week${s.week}.json`;
  const json = JSON.stringify(s);
  try {
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'MikeBall season' });
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return; // closed the share sheet
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  // (iOS may still be asking "Download?"; don't pull the file out from under it)
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast(host, 'Season saved to your downloads.');
}

function importSeason(app, host) {
  const input = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  // (a cancelled picker sends no event; tidy up after a while either way)
  const drop = setTimeout(() => input.remove(), 120000);
  input.addEventListener('change', async () => {
    clearTimeout(drop);
    const f = input.files && input.files[0];
    input.remove();
    if (!f) return;
    let s = null;
    try {
      s = S.migrate(JSON.parse(await f.text()), TEAMS);
    } catch { s = null; }
    if (!s) { toast(host, 'That file isn’t a MikeBall season.'); return; }
    const t = teamOf(app, s.userId);
    confirmBox(host, 'Load this season?', `${s.year} ${t.name}, ${s.phase === 'regular' ? `week ${s.week}` : s.phase === 'playoffs' ? 'the playoffs' : 'finished'}. It replaces the season on this phone.`, 'Load it', () => {
      app.season = s;
      applyDepth(app);
      saveSeason(app);
      app.showSeason();
    });
  });
  document.body.append(input);
  input.click();
}

function toast(host, text) {
  const t = h('p', { class: 'hub-toast', role: 'status' }, text);
  host.append(t);
  setTimeout(() => t.remove(), 2600);
}

// ---- screens --------------------------------------------------------------

// New season: pick a quarter length and see the schedule, then go.
export function seasonSetupScreen(app, userId) {
  const user = teamOf(app, userId);
  let qLen = app.settings.qLen || 8;
  const prev = app.season && app.season.phase === 'done' ? app.season : null;
  const year = prev ? prev.year + 1 : 2026;
  // built once: the schedule shown here is the one Start uses
  const season = S.newSeason({ year, userId, seed: (Date.now() ^ 0x2545f491) >>> 0, qLen, prev });
  const list = S.teamGames(season, userId);
  const rows = [];
  for (let w = 1; w <= S.REGULAR_WEEKS; w++) {
    const g = list.find((x) => x.week === w);
    if (!g) { rows.push(h('li', { class: 'sched-row bye' }, h('span', { class: 'wk' }, String(w)), h('span', { class: 'opp-cell' }, 'Bye'))); continue; }
    const home = g.home === userId;
    const opp = teamOf(app, home ? g.away : g.home);
    const b = broadcastForGame(g);
    rows.push(h('li', { class: 'sched-row' },
      h('span', { class: 'wk' }, String(w)),
      h('span', { class: 'opp-cell' }, h('span', { class: 'at' }, g.site ? 'vs' : home ? 'vs' : 'at'), h('span', { html: teamMarkSVG(opp, 22) }), h('strong', {}, opp.abbr)),
      h('span', { class: 'when' }, h('small', {}, dayLabel(g.date)), h('small', {}, `${b.label.split(' ').slice(1).join(' ')} ${b.netName}`)),
    ));
  }
  const seg = h('div', { class: 'segment', role: 'radiogroup', 'aria-label': 'Quarter length' });
  for (const [v, label] of [[5, '5 min'], [8, '8 min'], [12, '12 min'], [15, '15 min']]) {
    const b = h('button', { role: 'radio', 'aria-checked': String(v === qLen) }, label);
    b.addEventListener('click', () => {
      qLen = v;
      for (const x of seg.children) x.setAttribute('aria-checked', String(x === b));
    });
    seg.append(b);
  }
  return h('div', { class: 'screen setup-screen season-setup' },
    h('header', { class: 'setup-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back to teams', onclick: () => app.showTitle('season') }, '‹'),
      h('span', { html: teamMarkSVG(user, 52) }),
      h('div', {}, h('small', {}, `${year} season`), h('strong', { class: 'setup-team' }, user.name)),
    ),
    prev ? h('p', { class: 'lede' }, `Last season: ${recordText(prev, userId)}. The schedule follows from how everyone finished.`) : h('p', { class: 'lede' }, 'The real 2026 schedule: 17 games, a bye, and the playoffs if you earn them.'),
    h('section', { class: 'setup-block' },
      h('h2', {}, 'Quarter length'),
      h('p', { class: 'opp-label' }, 'For your games. The rest of the league plays full 15-minute quarters, and your numbers count at full-game pace.'),
      seg,
    ),
    h('section', { class: 'setup-block' },
      h('h2', {}, 'Your schedule'),
      h('ol', { class: 'sched' }, ...rows),
    ),
    h('div', { class: 'setup-actions' },
      h('button', { class: 'act', onclick: () => openRoster(app.root, user, app.league[userId], null, { editable: true }) }, 'Depth chart'),
      h('button', { class: 'go', onclick: (e) => {
        const go = () => { app.settings.qLen = qLen; app.saveSettings(); beginSeason(app, season, qLen); };
        const cur = app.season;
        if (cur && cur.phase !== 'done') confirmBox(e.target.closest('.screen'), 'New season?', `This replaces your ${cur.year} season with the ${teamOf(app, cur.userId).name}.`, 'Start over', go);
        else go();
      } }, 'Start season'),
    ),
  );
}

// The hub: this week's game, and the tabs to look around the league.
export function seasonHub(app, tab = null) {
  const s = app.season;
  const user = teamOf(app, s.userId);
  const st = S.seasonStandings(s, TEAMS);
  const row = st.rows[s.userId];
  const tabs = [['schedule', 'Schedule'], ['scores', 'Scores'], ['standings', 'Standings'], ['leaders', 'Leaders']];
  if (s.phase !== 'regular') tabs.push(['playoffs', 'Playoffs']);
  if (s.awards) tabs.push(['awards', 'Awards']);
  let cur = tabs.some(([id]) => id === tab) ? tab : app.seasonTab && tabs.some(([id]) => id === app.seasonTab) ? app.seasonTab : 'schedule';
  const body = h('div', { class: 'hub-body' });
  const bar = h('div', { class: 'chips hub-tabs', role: 'tablist' });
  const render = () => {
    app.seasonTab = cur;
    for (const b of bar.children) b.setAttribute('aria-selected', String(b.dataset.id === cur));
    clear(body);
    body.append(tabRenderers[cur](app, s, st));
  };
  for (const [id, label] of tabs) {
    const b = h('button', { class: 'chip', role: 'tab', 'data-id': id }, label);
    b.addEventListener('click', () => { cur = id; render(); });
    bar.append(b);
  }

  const screen = h('div', { class: 'screen hub-screen' },
    h('header', { class: 'hub-head' },
      h('span', { html: teamMarkSVG(user, 52) }),
      h('div', { class: 'hub-team' },
        h('small', {}, `${s.year} season`),
        h('strong', {}, user.name),
        h('span', { class: 'hub-rec' }, `${row.w}-${row.l}${row.t ? `-${row.t}` : ''}`, h('small', {}, row.g ? ` ${ordinalPlace(row.divRank)} in the ${user.conf} ${user.div}` : ` ${user.conf} ${user.div}`)),
      ),
      h('button', { class: 'act hub-menu', onclick: () => openHubMenu(app, screen) }, 'Menu'),
    ),
    nextCard(app, s, st),
    bar,
    body,
  );
  render();
  if (app.saveFailed) { toast(screen, 'Couldn’t save on this device. Use Menu › Save to file.'); app.saveFailed = false; }
  return screen;
}

function ordinalPlace(n) {
  return ['1st', '2nd', '3rd', '4th'][n - 1] || `${n}th`;
}

// What's next: the user's game this week (or round), a bye, or the end.
function nextCard(app, s, st) {
  if (s.phase === 'done') {
    const champ = teamOf(app, s.champion);
    const sb = s.games.find((g) => g.round === 3);
    return h('section', { class: 'hub-next champ' },
      h('p', { class: 'next-when' }, S.superBowlName(s.year)),
      h('div', { class: 'next-match' }, h('span', { html: teamMarkSVG(champ, 44) }),
        h('div', {}, h('strong', {}, `${champ.city} ${champ.name}`), h('small', {}, sb ? `${sb.as > sb.hs ? `${teamOf(app, sb.away).abbr} ${sb.as}, ${teamOf(app, sb.home).abbr} ${sb.hs}` : `${teamOf(app, sb.home).abbr} ${sb.hs}, ${teamOf(app, sb.away).abbr} ${sb.as}`}${sb.ot ? ' (OT)' : ''}` : ''))),
      h('p', { class: 'next-note' }, s.champion === s.userId ? 'Champions. Your team, your trophy.' : 'Champions. Next year it’s your turn.'),
      h('div', { class: 'next-actions' }, h('button', { class: 'go', onclick: () => app.showSeasonSetup(s.userId) }, `Start ${s.year + 1}`)),
    );
  }
  const playoffs = s.phase === 'playoffs';
  const g = playoffs ? S.currentRound(s).find((x) => x.home === s.userId || x.away === s.userId) : S.userGame(s);
  const label = playoffs ? S.roundName(S.currentRound(s)[0] || { round: 0, conf: '' }, s.year).replace(/^(AFC|NFC) /, '') : `Week ${s.week}`;
  if (!g) {
    const out = playoffs && !S.userAlive(s);
    return h('section', { class: 'hub-next' },
      h('p', { class: 'next-when' }, label),
      h('p', { class: 'next-note' }, out ? (s.bracket && [...s.bracket.seeds.AFC, ...s.bracket.seeds.NFC].includes(s.userId) ? 'Your season is over. Watch the rest of the playoffs.' : 'You missed the playoffs. Watch how it ends.') : playoffs ? 'You have the week off: the top seed’s bye.' : 'Bye week.'),
      h('div', { class: 'next-actions' },
        h('button', { class: 'go', onclick: () => { simUserGame(app); } }, playoffs ? 'Sim round' : 'Sim week'),
        playoffs && out ? h('button', { class: 'act', onclick: (e) => simAhead(app, 'end', e.target.closest('.screen')) }, 'Sim to the end') : null,
      ),
    );
  }
  const home = g.home === s.userId;
  const opp = teamOf(app, home ? g.away : g.home);
  const b = broadcastForGame(g);
  const r = st.rows[opp.id];
  return h('section', { class: 'hub-next' },
    h('p', { class: 'next-when' }, `${label} · ${dayLabel(g.date)}`),
    h('div', { class: 'next-match' },
      h('span', { html: teamMarkSVG(opp, 44) }),
      h('div', {},
        h('strong', {}, `${g.neutral || g.site ? 'vs' : home ? 'vs' : 'at'} ${opp.city} ${opp.name}`),
        h('small', {}, `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}${g.site ? ` · ${g.site}` : ''}`),
      ),
    ),
    h('p', { class: 'next-note' }, `${b.title === 'Sunday afternoon' ? '' : `${b.title} · `}${b.label} ET · ${b.netName}`),
    h('div', { class: 'next-actions' },
      h('button', { class: 'go', onclick: () => playUserGame(app) }, 'Play'),
      h('button', { class: 'act', onclick: () => simUserGame(app) }, 'Sim'),
    ),
  );
}

function openHubMenu(app, host) {
  const s = app.season;
  const close = () => sheet.remove();
  const item = (label, fn, cls = 'act') => h('button', { class: cls, onclick: () => { close(); fn(); } }, label);
  const sheet = h('div', { class: 'sheet dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Season menu' },
    h('div', { class: 'sheet-panel dialog-panel' },
      h('p', { class: 'dialog-title' }, 'Season'),
      h('div', { class: 'dialog-buttons' },
        item('Depth chart', () => openRoster(app.root, teamOf(app, s.userId), app.league[s.userId], null, { editable: true, onChange: () => { s.depth = JSON.parse(JSON.stringify(app.league[s.userId].depth)); saveSeason(app); } })),
        s.phase === 'regular' ? item('Sim to the playoffs', () => confirmBox(host, 'Sim ahead?', 'Every game left in the regular season is simmed, yours too.', 'Sim it', () => simAhead(app, 'playoffs', host))) : null,
        item('Save to file', () => exportSeason(app, host)),
        item('Load from file', () => importSeason(app, host)),
        item('Main menu', () => app.showTitle()),
        item('Close', () => {}),
      ),
    ),
  );
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  host.append(sheet);
}
