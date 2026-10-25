// The front office tab in the season hub: the cap picture and the roster
// by contract. Money shows; ratings never do (badges only).

import { h, clear } from './dom.js';
import { badgeRow } from './emblems.js';
import { fillDetail } from './roster.js';
import { capSheet } from '../game/league.js';
import { releasePlayer, ROSTER_MAX, OFFSEASON_MAX, rosterProblems } from '../game/offseason.js';
import { fmtMoney } from '../game/contracts.js';
import { POS_NAME } from '../data/roster.js';

function capCard(gm, teamId) {
  const c = capSheet(gm, teamId);
  const pct = Math.max(0, Math.min(1, c.used / c.cap));
  return h('section', { class: 'cap-card' },
    h('div', { class: 'cap-row' },
      h('div', {}, h('small', {}, `${gm.year} cap space`), h('strong', { class: c.space < 0 ? 'over' : '' }, fmtMoney(c.space))),
      h('div', { class: 'cap-right' }, h('small', {}, 'Used'), h('span', {}, `${fmtMoney(c.used)} of ${fmtMoney(c.cap)}`)),
    ),
    h('div', { class: 'cap-bar', role: 'img', 'aria-label': `${Math.round(pct * 100)}% of the cap used` }, h('i', { style: { width: `${pct * 100}%` } })),
    h('p', { class: 'cap-note' },
      `${c.dead ? `${fmtMoney(c.dead)} dead money. ` : ''}${gm.year + 1}: ${fmtMoney(c.next)} committed against a ${fmtMoney(c.nextCap)} cap.`),
  );
}

function row(p, right, acts = null) {
  const detail = h('div', { class: 'p-detail', hidden: true });
  const btn = h('button', { class: 'p-row fo-row', 'aria-expanded': 'false' },
    h('span', { class: 'p-num' }, p.pos),
    p.portrait ? h('img', { class: 'px p-face', src: `assets/portraits/${p.id}.png`, width: 32, height: 32, alt: '' }) : h('span', { class: 'p-face' }),
    h('span', { class: 'p-name' }, h('strong', {}, `${p.first} ${p.last}`), h('small', {}, `${POS_NAME[p.pos] || p.pos} · ${p.age}`)),
    h('span', { class: 'fo-right' }, h('span', { class: 'p-badges', html: badgeRow(p, 18) }), right),
  );
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    if (!open && !detail.firstChild) fillDetail(detail, p);
    detail.hidden = open;
  });
  return h('div', { class: 'p-item' }, btn, detail, acts ? h('div', { class: 'p-acts' }, ...acts) : null);
}

export function frontOfficeTab(app, s) {
  const gm = app.gm;
  const wrap = h('div', { class: 'front-office' });
  if (!gm) return wrap;
  const roster = gm.rosters[s.userId];
  let view = app.foView || 'contracts';
  const bar = h('div', { class: 'segment', role: 'tablist' });
  const body = h('div', { class: 'fo-list' });
  let render = () => {
    app.foView = view;
    for (const b of bar.children) b.setAttribute('aria-selected', String(b.dataset.v === view));
    clear(body);
    const cap = (p) => (p.contract && p.contract.capHit) || 0;
    if (view === 'contracts') {
      const list = [...roster.players].sort((a, b) => cap(b) - cap(a));
      // in the offseason you can cut (guaranteed money left on the deal
      // stays on the cap as dead money)
      const cutting = s.phase === 'done' && s.off;
      const max = cutting && s.off.stage !== 'camp' ? OFFSEASON_MAX : ROSTER_MAX;
      const probs = cutting ? rosterProblems(gm, s.userId).filter((x) => !/53/.test(x) || s.off.stage === 'camp') : [];
      body.append(h('p', { class: 'stand-note' }, `${list.length}${cutting ? `/${max}` : ''} players.${probs.length ? ` To start the season: ${probs.join(', ')}.` : ''} Tap one for his contract.`));
      for (const p of list) {
        const acts = cutting ? [h('button', { class: 'act', onclick: () => {
          releasePlayer(gm, s.userId, p, 'Cut');
          if (app.saveAll) app.saveAll();
          render();
        } }, p.contract && p.contract.guaranteed ? `Cut (${fmtMoney(p.contract.guaranteed)} dead)` : 'Cut')] : null;
        body.append(row(p, h('small', { class: 'fo-money' }, fmtMoney(cap(p)), h('em', {}, p.contract ? `${p.contract.years} yr${p.contract.years === 1 ? '' : 's'}` : '')), acts));
      }
    } else {
      const list = roster.players.filter((p) => p.contract && p.contract.years <= 1).sort((a, b) => cap(b) - cap(a));
      body.append(h('p', { class: 'stand-note' }, list.length ? `Their deals run out after this season: ${list.length} players. Re-sign them in the offseason or let them walk.` : 'Nobody’s deal runs out this year.'));
      for (const p of list) body.append(row(p, h('small', { class: 'fo-money' }, fmtMoney(cap(p)), h('em', {}, `FA ${gm.year + 1}`))));
    }
  };
  for (const [v, label] of [['contracts', 'Contracts'], ['expiring', 'Expiring']]) {
    const b = h('button', { role: 'tab', 'data-v': v }, label);
    b.addEventListener('click', () => { view = v; render(); });
    bar.append(b);
  }
  const capBox = h('div');
  const renderAll = () => { clear(capBox); capBox.append(capCard(gm, s.userId)); };
  const baseRender = render;
  render = () => { renderAll(); baseRender(); };
  render();
  wrap.append(capBox, bar, body);
  return wrap;
}
