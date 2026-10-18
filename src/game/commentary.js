// Play-by-play text.

import { MID_X } from '../core/util.js';

export function nm(p) {
  return p ? `${p.first[0]}. ${p.last}` : 'unknown';
}

function dirWord(spotX, ballX) {
  const d = spotX - ballX;
  if (Math.abs(d) < 2.5) return 'up the middle';
  if (Math.abs(d) < 9) return d < 0 ? 'left' : 'right';
  return d < 0 ? 'around left end' : 'around right end';
}

function passZone(r, ballX) {
  const depth = r.catchY != null ? r.catchY : r.airYards || 0;
  const side = r.spotX == null ? '' : r.spotX < ballX - 6 ? ' left' : r.spotX > ballX + 6 ? ' right' : ' middle';
  return `${depth >= 15 ? 'deep' : 'short'}${side}`;
}

function yds(n) {
  const a = Math.abs(n);
  if (a === 0) return 'no gain';
  return `${n < 0 ? 'a loss of ' : ''}${a} yard${a === 1 ? '' : 's'}`;
}

export function describe(r, ballX = MID_X) {
  const gain = r.yards;
  const tk = r.tackler ? ` (${nm(r.tackler)})` : '';
  switch (r.kind) {
    case 'kneel':
      return `${nm(r.passer || r.rusher)} kneels.`;
    case 'spike':
      return 'Spiked to stop the clock.';
    case 'sack':
      if (r.fumble) return `${nm(r.passer)} strip-sacked by ${nm(r.fumble.forcedBy)}! ${r.fumble.lost ? `Recovered by ${nm(r.fumble.recoveredBy)}.` : 'Offense recovers.'}`;
      return `${nm(r.passer)} sacked by ${nm(r.tackler)} for a loss of ${Math.abs(gain)}.`;
    case 'scramble':
      if (r.td) return `${nm(r.rusher)} scrambles in for the touchdown!`;
      return `${nm(r.rusher)} scrambles for ${yds(gain)}${r.slide ? ', slides' : ''}${r.outOfBounds ? ', out of bounds' : tk}.`;
    case 'run': {
      if (r.fumble && r.fumble.lost) return `${nm(r.rusher)} FUMBLES! Recovered by ${nm(r.fumble.recoveredBy)}.`;
      const base = `${nm(r.rusher)} ${dirWord(r.spotX, ballX)}`;
      if (r.td) return `${base}, TOUCHDOWN!`;
      if (r.safety) return `${base}, tackled in the end zone. SAFETY!`;
      return `${base} for ${yds(gain)}${r.outOfBounds ? ', out of bounds' : tk}.`;
    }
    default: {
      if (r.interception) {
        if (r.defTD) return `${nm(r.passer)} INTERCEPTED by ${nm(r.interceptor)} — returned for a TOUCHDOWN!`;
        if (r.touchback) return `${nm(r.passer)} intercepted by ${nm(r.interceptor)} in the end zone. Touchback.`;
        return `${nm(r.passer)} pass INTERCEPTED by ${nm(r.interceptor)}!`;
      }
      if (r.incomplete) {
        if (r.why === 'thrown away') return `${nm(r.passer)} throws it away.`;
        if (r.why === 'broken up') return `${nm(r.passer)} pass to ${nm(r.target)} broken up by ${nm(r.defender)}.`;
        if (r.why === 'dropped') return `${nm(r.passer)} pass dropped by ${nm(r.target)}.`;
        if (r.why === 'overthrown') return r.target ? `${nm(r.passer)} overthrows ${nm(r.target)}.` : `${nm(r.passer)} pass falls incomplete.`;
        return `${nm(r.passer)} pass ${r.target ? `to ${nm(r.target)} ` : ''}incomplete.`;
      }
      if (r.fumble && r.fumble.lost) return `${nm(r.passer)} to ${nm(r.receiver)}, FUMBLE! Recovered by ${nm(r.fumble.recoveredBy)}.`;
      const base = `${nm(r.passer)} pass ${passZone(r, ballX)} to ${nm(r.receiver)}`;
      if (r.td) return `${base} — TOUCHDOWN!`;
      return `${base} for ${yds(gain)}${r.outOfBounds ? ', out of bounds' : tk}.`;
    }
  }
}
