// TV windows and who carries them, following the 2026 NFL media deals
// (Sports Video Group, "NFL broadcast schedule roundup", May 2026):
//
//   Sunday afternoon  CBS when the road team is from the AFC, FOX when it's
//                     from the NFC (the long-standing package split)
//   Sunday Night      NBC (also Peacock)
//   Monday Night      ESPN (some simulcast on ABC)
//   Thursday Night    Prime Video
//   Thanksgiving      Lions game on CBS, Cowboys game on FOX, the night game
//                     on NBC
//   Black Friday      Prime Video
//   Christmas Day     Netflix (the 1:00 and 4:30 games)
//   International     NFL Network (London, Madrid and Paris games)
//
// Pure data/logic: no DOM.

export const NETWORKS = {
  cbs: { name: 'CBS' },
  fox: { name: 'FOX' },
  nbc: { name: 'NBC' },
  espn: { name: 'ESPN' },
  abc: { name: 'ABC' },
  prime: { name: 'Prime Video' },
  nfl_network: { name: 'NFL Network' },
  netflix: { name: 'Netflix' },
};

export const SLOTS = [
  { id: 'sun_early', label: 'Sunday 1:00', title: 'Sunday afternoon', night: false },
  { id: 'sun_late', label: 'Sunday 4:25', title: 'Sunday afternoon', night: false },
  { id: 'snf', label: 'Sunday Night', title: 'Sunday Night Football', night: true },
  { id: 'mnf', label: 'Monday Night', title: 'Monday Night Football', night: true },
  { id: 'tnf', label: 'Thursday Night', title: 'Thursday Night Football', night: true },
  { id: 'thanksgiving', label: 'Thanksgiving', title: 'Thanksgiving', night: null },
  { id: 'black_friday', label: 'Black Friday', title: 'Black Friday', night: false },
  { id: 'christmas', label: 'Christmas', title: 'Christmas Day', night: false },
  { id: 'international', label: 'International', title: 'International Series', night: false },
];

export function slotById(id) {
  return SLOTS.find((s) => s.id === id) || SLOTS[0];
}

// Which network carries this game, and whether it's under the lights.
export function broadcastFor(slotId, home, away) {
  const slot = slotById(slotId);
  let net;
  let night = slot.night;
  switch (slot.id) {
    case 'snf': net = 'nbc'; break;
    case 'mnf': net = 'espn'; break;
    case 'tnf':
    case 'black_friday': net = 'prime'; break;
    case 'christmas': net = 'netflix'; break;
    case 'international': net = 'nfl_network'; break;
    case 'thanksgiving':
      if (home.id === 'DET') { net = 'cbs'; night = false; } else if (home.id === 'DAL') { net = 'fox'; night = false; } else { net = 'nbc'; night = true; }
      break;
    default:
      net = away.conf === 'NFC' ? 'fox' : 'cbs';
  }
  return { slot: slot.id, title: slot.title, label: slot.label, net, netName: NETWORKS[net].name, night: !!night };
}
