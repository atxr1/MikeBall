// The negotiation sheet: you, a player and his agent, a few rounds of
// offers. What he says depends on who he is (src/game/negotiate.js).

import { h, clear } from './dom.js';
import { badgeRow } from './emblems.js';
import { openTalks, respond } from '../game/negotiate.js';
import { fmtMoney, minSalary } from '../game/contracts.js';
import { capSheet } from '../game/league.js';
import { POS_NAME } from '../data/roster.js';

// ask: his asking contract; ctx: { own, winPct, starter, year, teamId };
// onDeal(contract) when he agrees; onClose() when the sheet closes.
export function openTalksSheet(host, gm, p, ask, ctx, rng, { onDeal, onClose } = {}) {
  const talk = openTalks(p, ask, ctx, rng);
  const offer = { apy: Math.round((talk.ask.apy * 0.9) / 50_000) * 50_000, years: talk.years, guaranteed: Math.round((talk.ask.guaranteed || 0) * 0.85) };
  const min = minSalary(p.exp || 0, ctx.year);
  const chat = h('div', { class: 'talk-chat', 'aria-live': 'polite' });
  const room = h('p', { class: 'talk-room' });
  const vals = { apy: h('strong'), years: h('strong'), guaranteed: h('strong') };
  const sendBtn = h('button', { class: 'go' }, 'Make offer');
  const askBtn = h('button', { class: 'act' }, 'Meet his ask');

  const renderChat = () => {
    clear(chat);
    for (const line of talk.said) chat.append(h('p', { class: `talk-line ${line.who}` }, line.text));
    chat.scrollTop = chat.scrollHeight;
  };
  const renderOffer = () => {
    offer.apy = Math.max(min, offer.apy);
    offer.years = Math.min(5, Math.max(1, offer.years));
    offer.guaranteed = Math.min(offer.apy * offer.years, Math.max(0, offer.guaranteed));
    vals.apy.textContent = fmtMoney(offer.apy);
    vals.years.textContent = `${offer.years} yr${offer.years === 1 ? '' : 's'}`;
    vals.guaranteed.textContent = fmtMoney(offer.guaranteed);
    const space = capSheet(gm, ctx.teamId).space + (ctx.own && p.contract ? p.contract.capHit || 0 : 0);
    room.textContent = `Cap space: ${fmtMoney(space)}${offer.apy > space ? ' (not enough for this offer)' : ''}`;
    sendBtn.disabled = talk.done || offer.apy > space;
    askBtn.disabled = talk.done || talk.ask.apy > space;
  };
  const step = (key, amt) => h('div', { class: 'talk-step' },
    h('button', { class: 'icon-btn', 'aria-label': `Less ${key}`, onclick: () => { offer[key] -= amt; renderOffer(); } }, '–'),
    vals[key],
    h('button', { class: 'icon-btn', 'aria-label': `More ${key}`, onclick: () => { offer[key] += amt; renderOffer(); } }, '+'),
  );
  const finish = (res) => {
    renderChat();
    renderOffer();
    if (res.result === 'accept') {
      const deal = { type: 'veteran', apy: offer.apy, years: offer.years, guaranteed: offer.guaranteed };
      if (onDeal) onDeal(deal);
      sendBtn.textContent = 'Signed';
    }
    if (res.result === 'walk') sendBtn.textContent = 'He walked';
  };
  sendBtn.addEventListener('click', () => finish(respond(p, talk, { ...offer }, rng)));
  askBtn.addEventListener('click', () => {
    Object.assign(offer, { apy: talk.ask.apy, years: talk.ask.years || talk.years, guaranteed: talk.ask.guaranteed || 0 });
    finish(respond(p, talk, { ...offer }, rng));
  });

  const close = () => { sheet.remove(); if (onClose) onClose(talk); };
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Contract talks with ${p.first} ${p.last}` },
    h('div', { class: 'sheet-panel talk-panel' },
      h('header', { class: 'sheet-head' },
        p.portrait ? h('img', { class: 'px p-face', src: `assets/portraits/${p.id}.png`, width: 32, height: 32, alt: '' }) : null,
        h('div', { class: 'sheet-title' }, h('strong', {}, `${p.first} ${p.last}`), h('small', {}, `${POS_NAME[p.pos] || p.pos}, ${p.age}${ctx.own ? ' · your player' : ' · free agent'}`)),
        h('span', { class: 'p-badges', html: badgeRow(p, 18) }),
        h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕'),
      ),
      chat,
      h('div', { class: 'talk-offer' },
        h('div', { class: 'talk-field' }, h('small', {}, 'Per year'), step('apy', p.contract && p.contract.apy > 15e6 ? 1_000_000 : 250_000)),
        h('div', { class: 'talk-field' }, h('small', {}, 'Years'), step('years', 1)),
        h('div', { class: 'talk-field' }, h('small', {}, 'Guaranteed'), step('guaranteed', 1_000_000)),
      ),
      room,
      h('div', { class: 'dialog-buttons talk-buttons' }, sendBtn, askBtn),
    ),
  );
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  host.append(sheet);
  renderChat();
  renderOffer();
  return close;
}
