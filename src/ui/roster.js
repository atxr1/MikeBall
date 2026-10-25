// Roster sheet: every player shown with badges only (no numeric ratings).

import { h, clear } from './dom.js';
import { badgeRow, badgeSVG, teamMarkSVG } from './emblems.js';
import { fmtMoney } from '../game/contracts.js';
import { TIER_LABEL, STAT_LABEL } from '../game/badges.js';
import { POS_LIST, POS_NAME, heightStr } from '../data/roster.js';
import { rosterIndex } from '../game/personnel.js';
import { honorsFor } from '../data/honors.js';

const GROUPS = [
  ['QB', ['QB']], ['RB', ['RB']], ['WR', ['WR']], ['TE', ['TE']], ['OL', ['OL']],
  ['DL', ['DL']], ['EDGE', ['EDGE']], ['LB', ['LB']], ['CB', ['CB']], ['S', ['S']], ['K/P', ['K', 'P']],
];

// What each depth spot plays: the formation slots it fills (playbook
// SLOT_DEPTH), so the coach knows what moving a player up does.
const SPOT_NAMES = {
  QB: ['Starter'],
  RB: ['Halfback', 'Fullback / 2nd back'],
  WR: ['X (split end)', 'Z (flanker)', 'Slot', '2nd slot'],
  TE: ['Y (tight end)', '2nd tight end', '3rd tight end'],
  OL: ['Left tackle', 'Right tackle', 'Center', 'Left guard', 'Right guard'],
  DL: ['Tackle / nose', 'Tackle', 'Nose (3-4)'],
  EDGE: ['Left end / OLB', 'Right end / OLB'],
  LB: ['Mike', 'Will', 'Sam'],
  CB: ['Corner', 'Corner', 'Nickel', 'Dime'],
  S: ['Free safety', 'Strong safety'],
  K: ['Kicker'],
  P: ['Punter'],
};

const GROUP_NAME = { EDGE: 'Edge rusher' };

// editable: drag the grip on a row to move him up or down the depth chart.
// onChange() runs after each move.
export function openRoster(host, team, roster, onClose, { editable = false, onChange = null, live = false } = {}) {
  const byId = rosterIndex(roster);
  let group = 'QB';
  const list = h('div', { class: 'roster-list' });
  const chips = h('div', { class: 'chips', role: 'tablist' });

  const move = (pos, from, to) => {
    const ids = roster.depth[pos];
    if (!ids || from === to || to < 0 || to >= ids.length) return;
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id);
    renderList();
    onChange && onChange(pos);
  };

  const renderList = () => {
    clear(list);
    const positions = GROUPS.find((g) => g[0] === group)[1];
    for (const pos of positions) {
      const ids = roster.depth[pos] || [];
      if (positions.length > 1) list.append(h('h3', { class: 'depth-head' }, POS_NAME[pos]));
      const box = h('div', { class: 'depth-box' });
      let k = 0; // healthy players so far: the injured don't take a spot
      ids.forEach((id, i) => {
        const p = byId.get(id);
        if (!p) return;
        const hurt = !!p.injured;
        const spot = hurt ? null : (SPOT_NAMES[pos] || [])[k];
        const role = hurt ? (p.injured === 'ir' ? 'Injured reserve' : 'Injured: out') : spot ? spot : k === 0 ? 'Starter' : `Reserve ${k + 1 - (SPOT_NAMES[pos] || []).length}`;
        if (!hurt) k++;
        const detail = h('div', { class: 'p-detail', hidden: true });
        const row = h('button', { class: 'p-row', 'aria-expanded': 'false' },
          h('span', { class: 'p-num' }, String(p.num)),
          p.portrait ? h('img', { class: 'px p-face', src: `assets/portraits/${p.id}.png`, width: 32, height: 32, alt: '' }) : h('span', { class: 'p-face' }),
          h('span', { class: 'p-name' }, h('strong', {}, `${p.first} ${p.last}`), h('small', {}, `${GROUP_NAME[pos] && p.pos !== pos ? `${POS_NAME[p.pos]} · ` : ''}${role}`), honorChips(p)),
          h('span', { class: 'p-badges', html: badgeRow(p, 24) }),
        );
        row.addEventListener('click', () => {
          if (row.dataset.dragged) { delete row.dataset.dragged; return; }
          const open = row.getAttribute('aria-expanded') === 'true';
          row.setAttribute('aria-expanded', String(!open));
          if (!open && !detail.firstChild) fillDetail(detail, p);
          detail.hidden = open;
        });
        const item = h('div', { class: `p-item${spot ? ' on-field' : ''}${hurt ? ' hurt' : ''}`, 'data-i': String(i) });
        if (editable) {
          const grip = h('span', { class: 'grip', role: 'button', tabindex: '0', 'aria-label': `Move ${p.first} ${p.last} on the depth chart (arrow keys)` }, h('i'), h('i'), h('i'));
          grip.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp') { e.preventDefault(); move(pos, i, i - 1); }
            if (e.key === 'ArrowDown') { e.preventDefault(); move(pos, i, i + 1); }
          });
          dragRow(grip, item, box, (to) => move(pos, i, to));
          item.append(h('div', { class: 'p-line' }, row, grip), detail);
        } else item.append(row, detail);
        box.append(item);
      });
      list.append(box);
    }
  };

  for (const [label] of GROUPS) {
    const b = h('button', { class: 'chip', role: 'tab', 'aria-selected': String(label === group) }, label);
    b.addEventListener('click', () => {
      group = label;
      for (const c of chips.children) c.setAttribute('aria-selected', String(c === b));
      renderList();
    });
    chips.append(b);
  }

  const close = () => {
    sheet.remove();
    onClose && onClose();
  };
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${team.name} roster` },
    h('div', { class: 'sheet-panel' },
      h('header', { class: 'sheet-head' },
        h('span', { html: teamMarkSVG(team, 34) }),
        h('div', { class: 'sheet-title' }, h('strong', {}, `${team.city} ${team.name}`), h('small', {}, editable ? `Depth chart: drag to reorder.${live ? ' Changes take effect at the next snap.' : ''}` : 'Roster and badges')),
        h('button', { class: 'icon-btn', 'aria-label': 'Close roster', onclick: close }, '✕'),
      ),
      legend(),
      chips,
      list,
    ),
  );
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  host.append(sheet);
  renderList();
  return close;
}

// Drag a row by its grip within its box; drop(index) with where it landed
// (its spot on the depth chart). Near the top or bottom of the list, the
// list scrolls along. A cancelled touch (a system gesture) puts it back.
function dragRow(grip, item, box, drop) {
  let start = null;
  let raf = 0;
  const scroller = () => box.closest('.roster-list');
  const layout = () => {
    if (!start) return;
    const dy = start.py - start.y + (scroller().scrollTop - start.scroll0);
    item.style.transform = `translateY(${dy}px)`;
    // which slot is under the middle of the dragged row
    const r0 = start.rects[start.i];
    // in list coordinates: everything measured at the start, plus how far it's scrolled
    const mid = r0.top + r0.height / 2 + dy;
    let to = start.i;
    for (let k = 0; k < start.rects.length; k++) {
      const r = start.rects[k];
      if (mid > r.top && mid < r.bottom) to = k;
    }
    if (mid < start.rects[0].top) to = 0;
    if (mid > start.rects[start.rects.length - 1].bottom) to = start.rects.length - 1;
    start.to = to;
    const h0 = r0.height;
    start.rows.forEach((r, k) => {
      if (r === item) return;
      let shift = 0;
      if (to > start.i && k > start.i && k <= to) shift = -h0;
      if (to < start.i && k < start.i && k >= to) shift = h0;
      r.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  };
  const autoScroll = () => {
    if (!start) return;
    const sc = scroller();
    const r = sc.getBoundingClientRect();
    const edge = 48;
    let v = 0;
    if (start.py < r.top + edge) v = -Math.ceil((r.top + edge - start.py) / 6);
    else if (start.py > r.bottom - edge) v = Math.ceil((start.py - (r.bottom - edge)) / 6);
    if (v) { sc.scrollTop += v; layout(); }
    raf = requestAnimationFrame(autoScroll);
  };
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const rows = [...box.children];
    const sc = scroller();
    start = { y: e.clientY, py: e.clientY, rows, rects: rows.map((r) => r.getBoundingClientRect()), i: rows.indexOf(item), to: rows.indexOf(item), scroll0: sc.scrollTop };
    // rects are measured before scrolling; keep them in list coordinates
    item.classList.add('dragging');
    raf = requestAnimationFrame(autoScroll);
  });
  grip.addEventListener('pointermove', (e) => {
    if (!start) return;
    start.py = e.clientY;
    layout();
  });
  const end = (commit) => {
    if (!start) return;
    const { to, i, rows } = start;
    start = null;
    cancelAnimationFrame(raf);
    item.classList.remove('dragging');
    for (const r of rows) r.style.transform = '';
    if (commit && to !== i) drop(Number(rows[to].dataset.i));
  };
  grip.addEventListener('pointerup', () => end(true));
  grip.addEventListener('pointercancel', () => end(false));
}

function legend() {
  const tiers = ['bronze', 'silver', 'gold', 'diamond', 'master', 'franchise'];
  return h('div', { class: 'legend' },
    ...tiers.map((t) => h('span', { class: 'legend-item' }, h('span', { html: badgeSVG(t, 'skill', 18) }), TIER_LABEL[t])));
}

// Real honors from last season (All-Pro, MVP...), as small chips.
function honorChips(p) {
  const list = honorsFor(p);
  if (!list.length) return null;
  return h('span', { class: 'p-honors' }, ...list.slice(0, 2).map((x) =>
    h('span', { class: `honor ${x.kind === 'award' ? 'award' : x.team === 1 ? 'ap1' : 'ap2'}`, title: x.label }, x.kind === 'award' ? `${x.short}` : x.team === 1 ? 'ALL-PRO' : '2ND-TEAM AP')));
}

export function contractLine(p) {
  const c = p.contract;
  if (!c || !c.apy) return null;
  const yrs = c.years === 1 ? 'final year' : `${c.years} years left`;
  return `${fmtMoney(c.apy)} a year, ${yrs}${c.guaranteed ? `, ${fmtMoney(c.guaranteed)} guaranteed` : ''}${c.type === 'rookie' ? ' (rookie deal)' : c.type === 'tag' ? ' (franchise tag)' : ''}`;
}

export function fillDetail(el, p) {
  const stats = ['speed', 'strength', 'skill'];
  const honors = honorsFor(p);
  if (honors.length) el.append(h('ul', { class: 'p-honor-list' }, ...honors.map((x) => h('li', {}, x.label))));
  const deal = contractLine(p);
  el.append(
    h('div', { class: 'p-bio' },
      h('span', {}, `Age ${p.age}`),
      h('span', {}, heightStr(p.height)),
      h('span', {}, `${p.weight} lb`),
      h('span', {}, p.exp === 0 ? 'Rookie' : `${p.exp} yr pro`),
      h('span', {}, p.college),
    ),
    deal ? h('p', { class: 'p-contract' }, deal) : null,
    h('div', { class: 'p-big' }, ...stats.map((s) =>
      h('div', { class: `p-stat tier-${p.badges[s]}` },
        h('span', { html: badgeSVG(p.badges[s], s, 44) }),
        h('strong', {}, STAT_LABEL[s]),
        h('small', {}, TIER_LABEL[p.badges[s]]),
      ))),
  );
}

export { POS_LIST };
