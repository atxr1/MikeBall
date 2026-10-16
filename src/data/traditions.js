// Real things that happen in the stadium when the home team scores. Only
// traditions we could source are here; every other stadium stays quiet
// (no made-up pyro).
//
//   fireworks  shells over the stadium, one per point scored
//   cannons    the pirate ship in the north end zone fires, one per point
//   muskets    the End Zone Militia fires a volley behind the end zone
//   horse      the live horse mascot gallops down the field
//   song       what the crowd sings after a touchdown
//
// Sources:
//   KC  Arrowhead fireworks after Chiefs scores — CBS Sports, SI, ESPN
//       ("Arrowhead Stadium ran out of touchdown fireworks", 2020 and 2022)
//   TB  Raymond James Stadium pirate ship cannons after scores, one shot per
//       point — Lonely Planet "Unique NFL traditions"; Sinclair "top gameday
//       fan traditions for every football fanbase"
//   NE  End Zone Militia fires muskets after touchdowns — same Sinclair list
//   DEN Thunder the Arabian horse gallops when the Broncos score — CBS News
//       Colorado, "33 seasons galloping the gridiron"
//   PHI "Fly, Eagles, Fly" after every touchdown; MIA fight song after every
//       touchdown; HOU "Football Time in Houston" after touchdowns — Sinclair
//   GB  Lambeau Leap (players, see src/sim/celebrate.js)

export const SCORE_SHOWS = {
  KC: { fireworks: true },
  TB: { cannons: true },
  NE: { muskets: true },
  DEN: { horse: { name: 'Thunder', coat: '#f4f1ea', rider: '#fb4f14' } },
  PHI: { song: 'Fly, Eagles, Fly' },
  MIA: { song: 'the Dolphins fight song' },
  HOU: { song: 'Football Time in Houston' },
};

export function scoreShowFor(team) {
  return (team && SCORE_SHOWS[team.id]) || null;
}
