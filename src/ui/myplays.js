// Your own plays: a play you've drawn on (routes, blocks, coverages,
// blitzes) can be saved under a name and called again from the "Mine" tab,
// on offense or defense. Kept in this browser's storage (localStorage) as
// the base play plus the drawing's edits (src/game/playedit.js), so they
// work in every game.

import { offPlay, defPlay } from '../data/playbook.js';
import { applyEdits } from '../game/playedit.js';
import { h } from './dom.js';

const KEY = 'mb.myPlays';
const MAX = 40;
let cache = null; // built play objects, stable between renders

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list) {
  cache = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

// side 'O' | 'D' → play objects for the call sheet. Each is the base play
// with the saved edits baked in; `custom` marks it, and its category stays
// the base play's (a saved pass is still a pass).
export function myPlays(side) {
  if (!cache) {
    cache = { O: [], D: [] };
    for (const s of read()) {
      const base = s.side === 'O' ? offPlay(s.base) : defPlay(s.base);
      if (!base) continue; // a play that's left the playbook
      const p = applyEdits(base, s.edits);
      cache[s.side === 'O' ? 'O' : 'D'].push({ ...p, id: s.id, name: s.name, baseId: s.base, custom: true });
    }
  }
  return cache[side];
}

// Save the play on the field: the base it started from plus every edit
// (a saved play edited again keeps its earlier edits).
export function saveMyPlay(side, play, edits, name) {
  const list = read();
  const baseId = play.custom ? play.baseId : play.id;
  const prior = play.custom ? (list.find((s) => s.id === play.id)?.edits || {}) : {};
  const entry = { id: `my-${Date.now().toString(36)}`, name, side, base: baseId, edits: { ...prior, ...edits } };
  list.push(entry);
  while (list.length > MAX) list.shift();
  return write(list) ? entry.id : null;
}

export function deleteMyPlay(id) {
  write(read().filter((s) => s.id !== id));
}

// A sheet asking for the play's name. done(name) on save.
export function askPlayName(host, suggestion, done, onCancel) {
  const input = h('input', { class: 'name-input', type: 'text', maxlength: '24', value: suggestion, 'aria-label': 'Play name', autocomplete: 'off', enterkeyhint: 'done' });
  const close = () => sheet.remove();
  const save = () => {
    const name = input.value.trim().slice(0, 24) || suggestion;
    close();
    done(name);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  const sheet = h('div', { class: 'sheet dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Save play' },
    h('div', { class: 'sheet-panel dialog-panel' },
      h('strong', { class: 'dialog-title' }, 'Save play'),
      h('p', { class: 'dialog-text' }, 'It’ll be in the Mine tab, in every game.'),
      input,
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'go', onclick: save }, 'Save'),
        h('button', { class: 'act', onclick: () => { close(); onCancel && onCancel(); } }, 'Cancel'),
      ),
    ),
  );
  host.append(sheet);
  input.focus();
  input.select();
}
