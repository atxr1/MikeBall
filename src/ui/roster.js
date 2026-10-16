// Roster sheet: every player shown with badges only (no numeric ratings).

import { h, clear } from './dom.js';
import { badgeRow, badgeSVG, teamMarkSVG } from './emblems.js';
import { TIER_LABEL, STAT_LABEL } from '../game/badges.js';
import { POS_LIST, POS_NAME, heightStr } from '../data/roster.js';
import { rosterIndex } from '../game/personnel.js';

const GROUPS = [
  ['QB', ['QB']], ['RB', ['RB']], ['WR', ['WR']], ['TE', ['TE']], ['OL', ['OL']],
  ['DL', ['DL']], ['LB', ['LB']], ['CB', ['CB']], ['S', ['S']], ['K/P', ['K', 'P']],
];

export function openRoster(host, team, roster, onClose) {
  const byId = rosterIndex(roster);
  let group = 'QB';
  const list = h('div', { class: 'roster-list' });
  const chips = h('div', { class: 'chips', role: 'tablist' });

  const renderList = () => {
    clear(list);
    const positions = GROUPS.find((g) => g[0] === group)[1];
    for (const pos of positions) {
      const ids = roster.depth[pos] || [];
      ids.forEach((id, i) => {
        const p = byId.get(id);
        if (!p) return;
        const detail = h('div', { class: 'p-detail', hidden: true });
        const row = h('button', { class: 'p-row', 'aria-expanded': 'false' },
          h('span', { class: 'p-num' }, String(p.num)),
          h('span', { class: 'p-name' }, h('strong', {}, `${p.first} ${p.last}`), h('small', {}, `${POS_NAME[p.pos]}${i === 0 ? ', starter' : `, depth ${i + 1}`}`)),
          h('span', { class: 'p-badges', html: badgeRow(p, 24) }),
        );
        row.addEventListener('click', () => {
          const open = row.getAttribute('aria-expanded') === 'true';
          row.setAttribute('aria-expanded', String(!open));
          if (!open && !detail.firstChild) fillDetail(detail, p);
          detail.hidden = open;
        });
        list.append(h('div', { class: 'p-item' }, row, detail));
      });
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
        h('div', { class: 'sheet-title' }, h('strong', {}, `${team.city} ${team.name}`), h('small', {}, 'Roster and badges')),
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

function legend() {
  const tiers = ['bronze', 'silver', 'gold', 'diamond', 'master', 'franchise'];
  return h('div', { class: 'legend' },
    ...tiers.map((t) => h('span', { class: 'legend-item' }, h('span', { html: badgeSVG(t, 'skill', 18) }), TIER_LABEL[t])));
}

function fillDetail(el, p) {
  const stats = ['speed', 'strength', 'skill'];
  el.append(
    h('div', { class: 'p-bio' },
      h('span', {}, `Age ${p.age}`),
      h('span', {}, heightStr(p.height)),
      h('span', {}, `${p.weight} lb`),
      h('span', {}, p.exp === 0 ? 'Rookie' : `${p.exp} yr pro`),
      h('span', {}, p.college),
    ),
    h('div', { class: 'p-big' }, ...stats.map((s) =>
      h('div', { class: `p-stat tier-${p.badges[s]}` },
        h('span', { html: badgeSVG(p.badges[s], s, 44) }),
        h('strong', {}, STAT_LABEL[s]),
        h('small', {}, TIER_LABEL[p.badges[s]]),
      ))),
  );
}

export { POS_LIST };
