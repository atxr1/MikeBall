// The offseason in the season hub: re-signing your own players, free
// agency, the draft, and getting to 53. Each step can be left to "the front
// office" (the same logic the CPU teams use). The engine is
// src/game/offseason.js; this is the screens and the glue.

import { h, clear } from './dom.js';
import { badgeRow, badgeSVG, teamMarkSVG } from './emblems.js';
import { fillDetail } from './roster.js';
import { openTalksSheet } from './talks.js';
import * as O from '../game/offseason.js';
import { resignAsk } from '../game/offseason.js';
import { marketBook, fmtMoney } from '../game/contracts.js';
import { allPlayers, capSheet } from '../game/league.js';
import { seasonStandings } from '../game/season.js';
import { makeRng, hashString } from '../core/rng.js';
import { TEAMS } from '../data/teams.js';
import { POS_LIST, POS_NAME } from '../data/roster.js';
import { DRILLS, DRILL_ICON } from '../data/draftclass.js';
import { TIER_LABEL } from '../game/badges.js';

// a fresh, saved-state-proof RNG for each offseason action
function rngFor(s) {
  s.off.n = (s.off.n || 0) + 1;
  return makeRng((s.seed ^ hashString(`${s.off.year}:${s.off.n}`)) >>> 0);
}

const STAGES = [['resign', 'Re-sign'], ['fa', 'Free agency'], ['draft', 'Draft'], ['camp', 'Camp and cuts']];

// ---- moving through it ------------------------------------------------------

export async function startOffseason(app) {
  const s = app.season;
  O.beginOffseason(s, app.gm, rngFor0(s));
  app.refreshPlayers();
  await app.saveAll();
  app.showSeason('news');
}

// (the first draw of the offseason, before s.off exists)
function rngFor0(s) {
  return makeRng((s.seed ^ hashString(`${s.year + 1}:begin`)) >>> 0);
}

async function toFreeAgency(app) {
  const s = app.season;
  const gm = app.gm;
  const rng = rngFor(s);
  for (const t of TEAMS) if (t.id !== s.userId) O.cpuResign(gm, t.id, rng);
  O.openFreeAgency(gm);
  s.off.stage = 'fa';
  s.off.faLog = [];
  app.refreshPlayers();
  await app.saveAll();
  app.showSeason('freeagents');
}

async function nextFaDay(app) {
  const s = app.season;
  const signed = O.faDay(s, app.gm, rngFor(s));
  for (const x of signed) s.off.faLog.push({ day: s.off.faDay, team: x.teamId, name: `${x.player.first} ${x.player.last}`, pos: x.player.pos, apy: x.contract.apy, years: x.contract.years });
  if (s.off.faDay >= O.FA_DAYS) s.off.stage = 'draft';
  await app.saveAll();
  app.showSeason(s.off.stage === 'draft' ? 'draft' : 'freeagents');
}

// CPU picks until it's the user's turn (or the draft's over)
function runDraftToUser(app) {
  const s = app.season;
  const rng = rngFor(s);
  let slot = O.onTheClock(s);
  while (slot && slot.teamId !== s.userId) {
    O.cpuPick(s, app.gm, rng);
    slot = O.onTheClock(s);
  }
}

async function finishDraftIfDone(app) {
  const s = app.season;
  if (O.onTheClock(s)) return;
  O.closeDraft(s, app.gm);
  const rng = rngFor(s);
  for (const t of TEAMS) if (t.id !== s.userId) O.cpuFinalize(app.gm, t.id, rng);
  s.off.stage = 'camp';
  app.refreshPlayers();
}

async function userPick(app, p) {
  const s = app.season;
  O.makePick(s, app.gm, s.userId, p);
  runDraftToUser(app);
  await finishDraftIfDone(app);
  app.refreshPlayers();
  await app.saveAll();
  app.showSeason(s.off.stage === 'camp' ? 'team' : 'draft');
}

async function autoDraft(app, all) {
  const s = app.season;
  const rng = rngFor(s);
  let slot = O.onTheClock(s);
  while (slot) {
    if (slot.teamId === s.userId && !all) break;
    O.cpuPick(s, app.gm, rng);
    slot = O.onTheClock(s);
    if (slot && slot.teamId === s.userId && !all) break;
  }
  await finishDraftIfDone(app);
  app.refreshPlayers();
  await app.saveAll();
  app.showSeason(s.off.stage === 'camp' ? 'team' : 'draft');
}

// The whole offseason on autopilot: the user's team handled the way the
// CPU's are, then straight to next season's setup.
export async function autoOffseason(app) {
  const s = app.season;
  const gm = app.gm;
  if (!s.off) O.beginOffseason(s, gm, rngFor0(s));
  let rng = rngFor(s);
  if (s.off.stage === 'resign') {
    for (const t of TEAMS) O.cpuResign(gm, t.id, rng);
    O.openFreeAgency(gm);
    s.off.stage = 'fa';
    s.off.faLog = [];
  }
  while (s.off.stage === 'fa') {
    O.faDay(s, gm, rngFor(s));
    if (s.off.faDay >= O.FA_DAYS) s.off.stage = 'draft';
  }
  rng = rngFor(s);
  while (O.onTheClock(s)) O.cpuPick(s, gm, rng);
  await finishDraftIfDone(app);
  O.cpuFinalize(gm, s.userId, rngFor(s));
  app.refreshPlayers();
  await app.saveAll();
  app.showSeasonSetup(s.userId);
}

// ---- the stage card (where the hub's next game would be) -----------------------

export function offseasonCard(app, s) {
  const off = s.off;
  const steps = h('ol', { class: 'off-steps' }, ...STAGES.map(([id, label]) => {
    const i = STAGES.findIndex((x) => x[0] === off.stage);
    const j = STAGES.findIndex((x) => x[0] === id);
    return h('li', { class: j < i ? 'done' : j === i ? 'now' : '' }, label);
  }));
  const gm = app.gm;
  let note;
  let actions;
  if (off.stage === 'resign') {
    const left = O.expiring(gm, s.userId).length;
    note = left ? `${left} of your players’ contracts are up. Talk to the ones you want back; the rest walk into free agency.` : 'Everyone you wanted is signed.';
    actions = [h('button', { class: 'go', onclick: () => toFreeAgency(app) }, 'On to free agency')];
  } else if (off.stage === 'fa') {
    note = `Day ${off.faDay + 1} of ${O.FA_DAYS}. Talk to free agents; other teams make their offers when the day ends.`;
    actions = [h('button', { class: 'go', onclick: () => nextFaDay(app) }, off.faDay + 1 >= O.FA_DAYS ? 'End free agency' : 'Next day')];
  } else if (off.stage === 'draft') {
    const slot = O.onTheClock(s);
    const mine = slot && slot.teamId === s.userId;
    note = slot ? (mine ? `You’re on the clock: round ${slot.round}, pick ${slot.inRound} (No. ${slot.overall}).` : `Round ${slot.round}, pick ${slot.inRound}: ${app.teamById(slot.teamId).name} are up.`) : 'The draft is over.';
    actions = mine
      ? [h('button', { class: 'act', onclick: () => autoDraft(app, false) }, 'Auto-pick')]
      : [h('button', { class: 'go', onclick: () => { runDraftToUser(app); finishDraftIfDone(app).then(() => app.saveAll()).then(() => app.showSeason(s.off.stage === 'camp' ? 'team' : 'draft')); } }, 'To my pick')];
    actions.push(h('button', { class: 'act', onclick: () => autoDraft(app, true) }, 'Auto-draft the rest'));
  } else {
    const probs = O.rosterProblems(gm, s.userId);
    const n = gm.rosters[s.userId].players.length;
    note = probs.length ? `To start the season: ${probs.join(', ')}.`
      : n < O.ROSTER_MAX ? `${n} players: ${O.ROSTER_MAX - n} open spot${O.ROSTER_MAX - n === 1 ? '' : 's'}. Sign free agents, let the front office fill them, or start as you are.`
        : 'Your 53 are set. Ready for the new season.';
    actions = [
      h('button', { class: 'go', disabled: probs.length > 0, onclick: () => app.showSeasonSetup(s.userId) }, `Start ${off.year}`),
      h('button', { class: 'act', onclick: async () => { O.cpuFinalize(gm, s.userId, rngFor(s)); app.refreshPlayers(); await app.saveAll(); app.showSeason('team'); } }, 'Set my 53 for me'),
    ];
  }
  return h('section', { class: 'hub-next off-card' },
    h('p', { class: 'next-when' }, `${off.year} offseason`),
    steps,
    h('p', { class: 'next-note' }, note),
    h('div', { class: 'next-actions' }, ...actions),
  );
}

// ---- tabs ---------------------------------------------------------------------

function playerRow(p, right, onTap) {
  const detail = h('div', { class: 'p-detail', hidden: true });
  const btn = h('button', { class: 'p-row fo-row', 'aria-expanded': 'false' },
    h('span', { class: 'p-num' }, p.pos),
    p.portrait ? h('img', { class: 'px p-face', src: `assets/portraits/${p.id}.png`, width: 32, height: 32, alt: '' }) : h('span', { class: 'p-face' }),
    h('span', { class: 'p-name' }, h('strong', {}, `${p.first} ${p.last}`), h('small', {}, `${POS_NAME[p.pos] || p.pos} · ${p.age}`)),
    h('span', { class: 'fo-right' }, p.badges ? h('span', { class: 'p-badges', html: badgeRow(p, 18) }) : null, right),
  );
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    if (!open && !detail.firstChild && p.badges) fillDetail(detail, p);
    detail.hidden = open;
  });
  return h('div', { class: 'p-item' }, btn, detail, onTap ? h('div', { class: 'p-acts' }, ...onTap) : null);
}

// News: who retired, who got better, the moves.
function newsTab(app, s) {
  const off = s.off;
  const wrap = h('div', { class: 'news' });
  if (!off) return wrap;
  const mineRet = off.retired.filter((r) => r.team === s.userId);
  const bigRet = off.retired.filter((r) => r.team !== s.userId).slice(0, 12);
  wrap.append(h('h3', { class: 'stand-head' }, 'Your camp report'));
  const up = off.improved.filter((x) => x.gain > 0).slice(0, 8);
  const down = off.improved.filter((x) => x.gain < 0).slice(-6).reverse();
  wrap.append(h('ul', { class: 'news-list' },
    ...up.map((x) => h('li', {}, h('span', { class: 'up' }, '▲'), `${x.name} (${x.pos}) came on this offseason`)),
    ...down.map((x) => h('li', {}, h('span', { class: 'down' }, '▼'), `${x.name} (${x.pos}) is slowing down`)),
    ...mineRet.map((x) => h('li', {}, `${x.name} (${x.pos}, ${x.age}) retired`)),
  ));
  if (!up.length && !down.length && !mineRet.length) wrap.append(h('p', { class: 'stand-note' }, 'Nothing much changed.'));
  wrap.append(h('h3', { class: 'stand-head' }, 'Retirements around the league'), h('ul', { class: 'news-list' }, ...bigRet.map((x) => h('li', {}, `${x.name} (${app.teamById(x.team).abbr} ${x.pos}, ${x.age})`))));
  const moves = app.gm.moves.filter((m) => m.year === off.year).slice(-25).reverse();
  if (moves.length) wrap.append(h('h3', { class: 'stand-head' }, 'Moves'), h('ul', { class: 'news-list' }, ...moves.map((m) => h('li', {}, `${app.teamById(m.team).abbr}: ${m.text}`))));
  return wrap;
}

// Your expiring players (re-signing) or the open market (free agency).
function marketTab(app, s) {
  const off = s.off;
  const gm = app.gm;
  const wrap = h('div', { class: 'market' });
  if (!off) return wrap;
  const host = () => wrap.closest('.screen') || document.body;
  const book = marketBook(allPlayers(gm));
  const st = seasonStandings(s, TEAMS);
  const winPct = st.rows[s.userId].pct;
  const sheet = capSheet(gm, s.userId);
  wrap.append(h('p', { class: 'stand-note' }, `Cap space ${fmtMoney(sheet.space)} · roster ${gm.rosters[s.userId].players.length}/${off.stage === 'camp' ? O.ROSTER_MAX : O.OFFSEASON_MAX}`));
  const talk = (p, own) => {
    const r = gm.rosters[s.userId];
    const edge = (r.depth.EDGE || []).slice(0, 2).includes(p.id);
    const ask = own ? resignAsk(p, book, gm.year, edge) : { ...p.ask };
    const starter = O.teamNeed(r, p.pos, book) > 0.6;
    openTalksSheet(host(), gm, p, ask, { own, winPct, starter, year: gm.year, teamId: s.userId }, rngFor(s), {
      onDeal: async (deal) => {
        O.signPlayer(gm, s.userId, p, deal, own ? 're-signed' : 'signed');
        if (!own && off.faLog) off.faLog.push({ day: off.faDay + 1, team: s.userId, name: `${p.first} ${p.last}`, pos: p.pos, apy: deal.apy, years: deal.years });
        await app.saveAll();
      },
      onClose: () => app.showSeason(own ? 'news' : 'freeagents'),
    });
  };
  if (off.stage === 'resign') {
    const list = O.expiring(gm, s.userId).sort((a, b) => (b.contract?.apy || 0) - (a.contract?.apy || 0));
    const canTag = !O.tagUsed(gm, s.userId);
    wrap.append(h('h3', { class: 'stand-head' }, 'Your expiring contracts'));
    wrap.append(h('p', { class: 'stand-note' }, canTag
      ? 'The franchise tag keeps one player for a year whether he likes it or not: the top-five salary at his position, all of it guaranteed.'
      : 'You’ve used your franchise tag this year.'));
    if (!list.length) wrap.append(h('p', { class: 'stand-note' }, 'None left to sign.'));
    for (const p of list) {
      const ask = resignAsk(p, book, gm.year);
      const tag = O.tagValue(gm, p);
      const acts = [
        h('button', { class: 'act', onclick: () => talk(p, true) }, 'Talk'),
        h('button', { class: 'act', onclick: async () => { O.releasePlayer(gm, s.userId, p, 'Let go'); await app.saveAll(); app.showSeason('freeagents'); } }, 'Let him go'),
      ];
      if (canTag) {
        acts.splice(1, 0, h('button', {
          class: 'act',
          disabled: tag > sheet.space,
          onclick: async () => { O.franchiseTag(gm, s.userId, p); await app.saveAll(); app.showSeason('freeagents'); },
        }, `Tag (${fmtMoney(tag)})`));
      }
      wrap.append(playerRow(p, h('small', { class: 'fo-money' }, `asks ${fmtMoney(ask.apy)}`, h('em', {}, `${ask.years} yr`)), acts));
    }
    const tagged = gm.rosters[s.userId].players.filter((p) => p.contract && p.contract.type === 'tag' && p.contract.signed === gm.year);
    for (const p of tagged) wrap.append(h('p', { class: 'stand-note' }, `Tagged: ${p.first} ${p.last} (${p.pos}), 1 yr, ${fmtMoney(p.contract.apy)}.`));
    return wrap;
  }
  // free agency: the best available, by position
  let pos = app.faPos || 'All';
  const chips = h('div', { class: 'chips', role: 'tablist' });
  const list = h('div');
  const render = () => {
    app.faPos = pos;
    for (const b of chips.children) b.setAttribute('aria-selected', String(b.dataset.v === pos));
    clear(list);
    const pool = gm.fa.filter((p) => p.ask && (pos === 'All' || p.pos === pos))
      .sort((a, b) => b.ask.apy - a.ask.apy).slice(0, 40);
    if (!pool.length) list.append(h('p', { class: 'stand-note' }, 'Nobody left here.'));
    for (const p of pool) {
      list.append(playerRow(p, h('small', { class: 'fo-money' }, `asks ${fmtMoney(p.ask.apy)}`, h('em', {}, `${p.ask.years} yr`)),
        [h('button', { class: 'act', onclick: () => talk(p, false) }, 'Make an offer')]));
    }
  };
  for (const v of ['All', ...POS_LIST]) {
    const b = h('button', { class: 'chip', role: 'tab', 'data-v': v }, v);
    b.addEventListener('click', () => { pos = v; render(); });
    chips.append(b);
  }
  render();
  const signings = (off.faLog || []).slice(-12).reverse();
  wrap.append(chips, list);
  if (signings.length) wrap.append(h('h3', { class: 'stand-head' }, 'Latest signings'), h('ul', { class: 'news-list' }, ...signings.map((x) => h('li', {}, `${app.teamById(x.team).abbr} signed ${x.name} (${x.pos}): ${x.years} yr, ${fmtMoney(x.apy)}`))));
  return wrap;
}

// The draft: the board, with combine badges; your pick when you're up.
function draftTab(app, s) {
  const off = s.off;
  const wrap = h('div', { class: 'draft' });
  if (!off) return wrap;
  const slot = O.onTheClock(s);
  const mine = slot && slot.teamId === s.userId && off.stage === 'draft';
  let pos = app.draftPos || 'All';
  const chips = h('div', { class: 'chips', role: 'tablist' });
  const list = h('div');
  const combine = (p) => h('span', { class: 'combine' }, ...DRILLS.filter((d) => p.combineBadges && p.combineBadges[d.id]).map((d) =>
    h('span', { class: 'drill', title: `${d.label}: ${TIER_LABEL[p.combineBadges[d.id]]}` }, h('span', { html: badgeSVG(p.combineBadges[d.id], DRILL_ICON[d.id], 16) }), h('small', {}, d.label.split(' ')[0]))));
  const render = () => {
    app.draftPos = pos;
    for (const b of chips.children) b.setAttribute('aria-selected', String(b.dataset.v === pos));
    clear(list);
    const pool = O.available(s).filter((p) => pos === 'All' || p.pos === pos).slice(0, 50);
    for (const p of pool) {
      const row = h('div', { class: 'p-item prospect' },
        h('div', { class: 'p-row fo-row' },
          h('span', { class: 'p-num' }, String(p.board)),
          h('span', { class: 'p-face' }),
          h('span', { class: 'p-name' }, h('strong', {}, `${p.first} ${p.last}`), h('small', {}, `${p.pos} · ${p.college} · ${Math.floor(p.height / 12)}'${p.height % 12}" ${p.weight}`)),
          mine ? h('button', { class: 'go draft-btn', onclick: () => userPick(app, p) }, 'Draft') : null,
        ),
        combine(p),
      );
      list.append(row);
    }
  };
  for (const v of ['All', ...POS_LIST]) {
    const b = h('button', { class: 'chip', role: 'tab', 'data-v': v }, v);
    b.addEventListener('click', () => { pos = v; render(); });
    chips.append(b);
  }
  render();
  wrap.append(h('p', { class: 'stand-note' }, 'The scouts’ big board. Their ability is a mystery; the combine is all you see (badges ranked within each position).'), chips, list);
  const mineDrafted = off.drafted.filter((d) => d.teamId === s.userId);
  if (mineDrafted.length) wrap.append(h('h3', { class: 'stand-head' }, 'Your picks'), h('ul', { class: 'news-list' }, ...mineDrafted.map((d) => h('li', {}, `Round ${d.round} (No. ${d.overall}): ${d.name}, ${d.pos}`))));
  const recent = off.drafted.slice(-10).reverse();
  if (recent.length) wrap.append(h('h3', { class: 'stand-head' }, 'Latest picks'), h('ul', { class: 'news-list' }, ...recent.map((d) => h('li', {}, `${d.overall}. ${app.teamById(d.teamId).abbr}: ${d.name}, ${d.pos}`))));
  return wrap;
}

export const offseasonTabs = { news: newsTab, freeagents: marketTab, draft: draftTab };

export { teamMarkSVG };
