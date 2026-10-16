// The 32 teams. Everything here is editable data: Owner mode (milestone 5)
// lets the user change any name, city, abbreviation or color. No official
// logos are used; each team gets a generated monogram.
//
// colors.primary   main jersey / end zone color
// colors.secondary trim, numbers, stripes
// colors.helmet    helmet shell
// colors.pants     pants

const T = (abbr, city, name, conf, div, primary, secondary, helmet, pants) => ({
  id: abbr,
  abbr,
  city,
  name,
  conf,
  div,
  colors: { primary, secondary, helmet, pants },
  stadium: { name: `${city} Stadium`, roof: 'open', surface: 'grass' },
});

export const TEAMS = [
  T('BUF', 'Buffalo', 'Bills', 'AFC', 'East', '#00338D', '#C60C30', '#FFFFFF', '#FFFFFF'),
  T('MIA', 'Miami', 'Dolphins', 'AFC', 'East', '#008E97', '#FC4C02', '#FFFFFF', '#FFFFFF'),
  T('NE', 'New England', 'Patriots', 'AFC', 'East', '#002244', '#C60C30', '#B0B7BC', '#B0B7BC'),
  T('NYJ', 'New York', 'Jets', 'AFC', 'East', '#125740', '#FFFFFF', '#125740', '#FFFFFF'),

  T('BAL', 'Baltimore', 'Ravens', 'AFC', 'North', '#241773', '#9E7C0C', '#1B1B1B', '#FFFFFF'),
  T('CIN', 'Cincinnati', 'Bengals', 'AFC', 'North', '#FB4F14', '#101820', '#FB4F14', '#FFFFFF'),
  T('CLE', 'Cleveland', 'Browns', 'AFC', 'North', '#311D00', '#FF3C00', '#FF3C00', '#FFFFFF'),
  T('PIT', 'Pittsburgh', 'Steelers', 'AFC', 'North', '#101820', '#FFB612', '#101820', '#FFB612'),

  T('HOU', 'Houston', 'Texans', 'AFC', 'South', '#03202F', '#A71930', '#03202F', '#FFFFFF'),
  T('IND', 'Indianapolis', 'Colts', 'AFC', 'South', '#002C5F', '#A2AAAD', '#FFFFFF', '#FFFFFF'),
  T('JAX', 'Jacksonville', 'Jaguars', 'AFC', 'South', '#006778', '#D7A22A', '#101820', '#FFFFFF'),
  T('TEN', 'Tennessee', 'Titans', 'AFC', 'South', '#0C2340', '#4B92DB', '#0C2340', '#FFFFFF'),

  T('DEN', 'Denver', 'Broncos', 'AFC', 'West', '#FB4F14', '#002244', '#002244', '#FFFFFF'),
  T('KC', 'Kansas City', 'Chiefs', 'AFC', 'West', '#E31837', '#FFB81C', '#E31837', '#FFFFFF'),
  T('LV', 'Las Vegas', 'Raiders', 'AFC', 'West', '#101820', '#A5ACAF', '#A5ACAF', '#A5ACAF'),
  T('LAC', 'Los Angeles', 'Chargers', 'AFC', 'West', '#0080C6', '#FFC20E', '#FFFFFF', '#FFFFFF'),

  T('DAL', 'Dallas', 'Cowboys', 'NFC', 'East', '#003594', '#869397', '#B0B7BC', '#B0B7BC'),
  T('NYG', 'New York', 'Giants', 'NFC', 'East', '#0B2265', '#A71930', '#0B2265', '#A5ACAF'),
  T('PHI', 'Philadelphia', 'Eagles', 'NFC', 'East', '#004C54', '#A5ACAF', '#004C54', '#FFFFFF'),
  T('WAS', 'Washington', 'Commanders', 'NFC', 'East', '#5A1414', '#FFB612', '#5A1414', '#FFB612'),

  T('CHI', 'Chicago', 'Bears', 'NFC', 'North', '#0B162A', '#C83803', '#0B162A', '#FFFFFF'),
  T('DET', 'Detroit', 'Lions', 'NFC', 'North', '#0076B6', '#B0B7BC', '#B0B7BC', '#B0B7BC'),
  T('GB', 'Green Bay', 'Packers', 'NFC', 'North', '#203731', '#FFB612', '#FFB612', '#FFB612'),
  T('MIN', 'Minnesota', 'Vikings', 'NFC', 'North', '#4F2683', '#FFC62F', '#4F2683', '#FFFFFF'),

  T('ATL', 'Atlanta', 'Falcons', 'NFC', 'South', '#A71930', '#101820', '#101820', '#FFFFFF'),
  T('CAR', 'Carolina', 'Panthers', 'NFC', 'South', '#0085CA', '#101820', '#BFC0BF', '#BFC0BF'),
  T('NO', 'New Orleans', 'Saints', 'NFC', 'South', '#101820', '#D3BC8D', '#D3BC8D', '#D3BC8D'),
  T('TB', 'Tampa Bay', 'Buccaneers', 'NFC', 'South', '#D50A0A', '#34302B', '#4A4540', '#4A4540'),

  T('ARI', 'Arizona', 'Cardinals', 'NFC', 'West', '#97233F', '#FFB612', '#FFFFFF', '#FFFFFF'),
  T('LAR', 'Los Angeles', 'Rams', 'NFC', 'West', '#003594', '#FFA300', '#003594', '#FFFFFF'),
  T('SF', 'San Francisco', '49ers', 'NFC', 'West', '#AA0000', '#B3995D', '#B3995D', '#B3995D'),
  T('SEA', 'Seattle', 'Seahawks', 'NFC', 'West', '#002244', '#69BE28', '#002244', '#A5ACAF'),
];

export const DIVISIONS = ['East', 'North', 'South', 'West'];
export const CONFERENCES = ['AFC', 'NFC'];

export function teamById(id) {
  return TEAMS.find((t) => t.id === id);
}

export function fullName(team) {
  return `${team.city} ${team.name}`;
}
