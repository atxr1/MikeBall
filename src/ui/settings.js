// Settings: a sheet that opens from the title screen or the in-game menu.
// Choices are saved with the rest of the app's settings (localStorage) and
// take effect from the next snap.

import { h } from './dom.js';

// app.settings.passing: 'coach' (default) or 'retro'
const PASSING = [
  {
    val: 'coach',
    label: 'Coach',
    note: 'You call the plays; your quarterback reads the field and throws on his own.',
  },
  {
    val: 'retro',
    label: 'Retro Bowl',
    note: 'You throw your own passes. After the snap, pull back anywhere on the field to aim (the target goes the opposite way, like a slingshot) and let go to throw. Whoever gets to the spot goes up for it; your passer’s accuracy still counts.',
  },
];

export function openSettings(host, app, onClose) {
  const note = h('p', { class: 'setting-note' });
  const seg = h('div', { class: 'segment', role: 'radiogroup', 'aria-label': 'Passing' });
  const render = () => {
    const cur = app.settings.passing === 'retro' ? 'retro' : 'coach';
    for (const b of seg.children) b.setAttribute('aria-checked', String(b.dataset.val === cur));
    note.textContent = PASSING.find((p) => p.val === cur).note;
  };
  for (const p of PASSING) {
    const b = h('button', { role: 'radio', 'data-val': String(p.val) }, p.label);
    b.addEventListener('click', () => {
      app.settings.passing = p.val;
      app.saveSettings();
      render();
    });
    seg.append(b);
  }
  render();

  const close = () => {
    sheet.remove();
    onClose && onClose();
  };
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' },
    h('div', { class: 'sheet-panel settings-panel' },
      h('header', { class: 'sheet-head' },
        h('div', { class: 'sheet-title' }, h('strong', {}, 'Settings'), h('small', {}, 'Changes take effect at the next snap.')),
        h('button', { class: 'icon-btn', 'aria-label': 'Close settings', onclick: close }, '✕'),
      ),
      h('section', { class: 'setting' },
        h('h2', {}, 'Passing'),
        seg,
        note,
      ),
    ),
  );
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  host.append(sheet);
  return close;
}
