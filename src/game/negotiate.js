// Contract talks with a player who has a personality.
//
// Every player carries five hidden traits (1-10): loyalty, greed,
// competitor, ego, durability. In a negotiation they decide:
//   - what he asks for (greed up, loyalty to his own team down)
//   - the least he'll really take (his floor, hidden): lower from a team he
//     loves or one that wins (if he's a competitor), higher if he's greedy
//     or proud and won't be a starter
//   - how many rounds he'll put up with (patience), and how a lowball lands
//     (insulting a proud or greedy player costs more patience)
//   - how far he comes down when he counters
//   - what he says
//
//   talk = { ask, floor, patience, mood, said: [{ who, text }], done }
//   respond(talk, offer) -> { result: 'accept' | 'counter' | 'walk', text }
//
// Pure logic: no DOM; draws from the seeded RNG passed in.

import { clamp } from '../core/util.js';
import { askYears, minSalary } from './contracts.js';

const T = (p, k) => ((p.traits && p.traits[k]) || 5);

// ctx: { own (his current team), winPct (0-1), starter (he'd start there),
// year }
export function openTalks(p, ask, ctx, rng) {
  const greed = T(p, 'greed');
  const loyal = T(p, 'loyalty');
  const comp = T(p, 'competitor');
  const ego = T(p, 'ego');
  let floorK = 0.9 + (greed - 5) * 0.012 - (ctx.own ? (loyal - 5) * 0.012 : 0) - (comp - 5) * 0.012 * (ctx.winPct - 0.5) * 2;
  if (!ctx.starter) floorK += (ego - 5) * 0.008;
  floorK = clamp(floorK + rng.normal(0, 0.02), 0.78, 0.99);
  const patience = clamp(Math.round(4 + (loyal - 5) * 0.3 * (ctx.own ? 1 : 0) - (ego - 5) * 0.25 - (greed - 5) * 0.15 + rng.normal(0, 0.7)), 2, 6);
  const talk = {
    pid: p.id,
    ask: { ...ask },
    floor: Math.max(minSalary(p.exp || 0, ctx.year), Math.round((ask.apy * floorK) / 50_000) * 50_000),
    years: ask.years || askYears(p),
    patience,
    mood: ctx.own && loyal >= 7 ? 'warm' : greed >= 8 || ego >= 8 ? 'cold' : 'neutral',
    said: [],
    done: false,
    own: !!ctx.own,
  };
  talk.said.push({ who: 'him', text: opener(p, talk, ctx) });
  return talk;
}

function money(n) {
  // one decimal ($15.9 million), two under a million ($0.89 million)
  const s = (n / 1e6).toFixed(n >= 1e8 ? 0 : n < 1e6 ? 2 : 1);
  return `$${s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s} million`;
}

function opener(p, talk, ctx) {
  const a = talk.ask;
  const wants = `${money(a.apy)} a year for ${a.years} year${a.years === 1 ? '' : 's'}${a.guaranteed ? `, ${money(a.guaranteed)} of it guaranteed` : ''}`;
  if (ctx.own && T(p, 'loyalty') >= 8) return `I want to finish my career here. Get me to ${wants} and we're good.`;
  if (T(p, 'greed') >= 8) return `My agent's number is ${wants}. I know what I'm worth.`;
  if (T(p, 'ego') >= 8) return `I'm one of the best at what I do. Pay me like it: ${wants}.`;
  if (T(p, 'competitor') >= 8 && ctx.winPct >= 0.6) return `I want a ring, and you can win. Still, ${wants} is fair.`;
  if (T(p, 'competitor') >= 8 && ctx.winPct < 0.4) return `I want to play for a winner. Convince me: ${wants}.`;
  return `We're looking for ${wants}.`;
}

// What an offer's worth to him, against what he asked: money per year,
// how close the length is to what he wants, and the guarantees.
function worth(p, offer, talk) {
  const want = talk.years;
  const lenFit = 1 - Math.min(0.12, Math.abs((offer.years || want) - want) * 0.04);
  const gShare = (offer.guaranteed || 0) / Math.max(1, offer.apy * (offer.years || 1));
  const askShare = (talk.ask.guaranteed || 0) / Math.max(1, talk.ask.apy * talk.ask.years);
  const gFit = 1 + clamp(gShare - askShare, -0.3, 0.3) * 0.25;
  return offer.apy * lenFit * gFit;
}

export function respond(p, talk, offer, rng) {
  if (talk.done) return { result: talk.result || 'walk', text: '' };
  const v = worth(p, offer, talk);
  talk.said.push({ who: 'you', text: `${money(offer.apy)} a year, ${offer.years} year${offer.years === 1 ? '' : 's'}, ${money(offer.guaranteed || 0)} guaranteed.` });
  const askV = worth(p, talk.ask, talk);
  const end = (result, text) => {
    talk.done = true;
    talk.result = result;
    talk.said.push({ who: 'him', text });
    return { result, text };
  };
  if (v >= askV * 0.995) return end('accept', pick(rng, [
    'Deal. Let’s get to work.',
    'That’s what I wanted to hear. Where do I sign?',
    T(p, 'loyalty') >= 7 && talk.own ? 'Happy to be staying. Let’s go win.' : 'You’ve got yourself a player.',
  ]));
  if (v >= talk.floor) {
    // close enough: he takes it, the nearer the ask the likelier
    const near = (v - talk.floor) / Math.max(1, askV - talk.floor);
    if (rng.chance(0.35 + near * 0.6)) return end('accept', pick(rng, ['I can live with that. Done.', 'Not quite what I wanted, but I’m in.', 'Fine. Let’s make it happen.']));
  }
  // too low: patience runs down, faster if it's an insult
  const insult = v < talk.floor * 0.8;
  talk.patience -= insult ? (T(p, 'ego') >= 7 || T(p, 'greed') >= 7 ? 3 : 2) : 1;
  if (talk.patience <= 0) {
    return end('walk', talk.own
      ? pick(rng, ['We’re done here. I’ll see what the market says.', 'I gave you every chance. I’m testing free agency.'])
      : pick(rng, ['Thanks, but we’re going another way.', 'My agent says we’re done talking.']));
  }
  // he comes down some (less if he's greedy), never below his floor
  const give = clamp(0.35 - (T(p, 'greed') - 5) * 0.04, 0.12, 0.55);
  const nextApy = Math.max(talk.floor, Math.round((talk.ask.apy - (talk.ask.apy - offer.apy) * give) / 50_000) * 50_000);
  talk.ask = { ...talk.ask, apy: Math.min(talk.ask.apy, nextApy) };
  const text = insult
    ? pick(rng, ['Is that a joke? Come back with a real offer.', 'That’s insulting. Try again.', 'You’re not even in the ballpark.'])
    : talk.patience <= 1
      ? `Last chance. ${money(talk.ask.apy)} a year and I sign today.`
      : pick(rng, [`Closer. I could do ${money(talk.ask.apy)} a year.`, `Meet me at ${money(talk.ask.apy)} and we can talk.`, `Not there yet. ${money(talk.ask.apy)} a year gets it done.`]);
  talk.said.push({ who: 'him', text });
  return { result: 'counter', text, counter: { ...talk.ask } };
}

function pick(rng, list) {
  return list[Math.floor(rng.next() * list.length)];
}
