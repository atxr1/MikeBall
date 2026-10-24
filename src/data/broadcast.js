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

// A scheduled game's TV window as a code: day, Eastern kickoff time, and
// whether it's under the lights (offset: days from that week's Sunday).
export const SLOT_INFO = {
  We1: { day: 'Wed', time: '1:00 PM', night: false, offset: -4 },
  We4: { day: 'Wed', time: '4:30 PM', night: false, offset: -4 },
  We8: { day: 'Wed', time: '8:20 PM', night: true, offset: -4 },
  Th1: { day: 'Thu', time: '1:00 PM', night: false, offset: -3 },
  Th4: { day: 'Thu', time: '4:30 PM', night: false, offset: -3 },
  Th8: { day: 'Thu', time: '8:15 PM', night: true, offset: -3 },
  Fr1: { day: 'Fri', time: '1:00 PM', night: false, offset: -2 },
  Fr3: { day: 'Fri', time: '3:00 PM', night: false, offset: -2 },
  Fr4: { day: 'Fri', time: '4:30 PM', night: false, offset: -2 },
  Fr8: { day: 'Fri', time: '8:15 PM', night: true, offset: -2 },
  Sa1: { day: 'Sat', time: '1:00 PM', night: false, offset: -1 },
  Sa4: { day: 'Sat', time: '4:30 PM', night: false, offset: -1 },
  Sa8: { day: 'Sat', time: '8:20 PM', night: true, offset: -1 },
  Su9: { day: 'Sun', time: '9:30 AM', night: false, offset: 0 },
  Su1: { day: 'Sun', time: '1:00 PM', night: false, offset: 0 },
  Su4: { day: 'Sun', time: '4:25 PM', night: false, offset: 0 },
  Su8: { day: 'Sun', time: '8:20 PM', night: true, offset: 0 },
  Mo8: { day: 'Mon', time: '8:15 PM', night: true, offset: 1 },
};
export const DAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const TAG_TITLES = {
  KICKOFF: 'Kickoff Game',
  THXEVE: 'Thanksgiving Eve',
  THX: 'Thanksgiving',
  BF: 'Black Friday',
  XEVE: 'Christmas Eve',
  XMAS: 'Christmas Day',
  NYE: "New Year's Eve",
};
const SLOT_TITLES = {
  Su8: ['snf', 'Sunday Night Football'],
  Mo8: ['mnf', 'Monday Night Football'],
  Th8: ['tnf', 'Thursday Night Football'],
  Sa1: ['sat', 'Saturday'],
  Sa4: ['sat', 'Saturday'],
  Sa8: ['sat', 'Saturday Night'],
  Su9: ['international', 'Sunday morning'],
};

// The broadcast for a game on the season schedule ({slot, net, site, tag}).
export function broadcastForGame(game) {
  const info = SLOT_INFO[game.slot] || SLOT_INFO.Su1;
  const [slot, title] = SLOT_TITLES[game.slot] || ['sun_early', info.day === 'Sun' ? 'Sunday afternoon' : DAY_NAMES[info.day]];
  const net = NETWORKS[game.net] ? game.net : 'cbs';
  return {
    slot: game.tag === 'THX' ? 'thanksgiving' : game.tag === 'XMAS' ? 'christmas' : game.tag === 'BF' ? 'black_friday' : game.site ? 'international' : slot,
    title: game.round != null ? (game.round === 3 ? 'the Super Bowl' : `the ${game.conf} ${['Wild Card round', 'Divisional round', 'Championship'][game.round]}`)
      : TAG_TITLES[game.tag] || (game.site ? `Live from ${game.site}` : title),
    label: `${info.day} ${game.time || info.time}`,
    net,
    netName: NETWORKS[net].name,
    night: info.night,
    site: game.site || null,
  };
}

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
