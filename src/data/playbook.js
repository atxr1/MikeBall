// Base playbook: formations, route tree, offensive and defensive plays.
//
// Offense alignment coordinates: `dx` is yards left(-)/right(+) of the ball,
// `y` is yards relative to the line of scrimmage (negative = backfield).
// `wide: 'L'|'R'` puts a receiver on the numbers; `slotSide` puts him between
// the tackle and the wide receiver on that side.
//
// Route points are [outward, depth] relative to where the receiver lines up,
// where outward = toward his own sideline. `end: 'continue'` keeps running in
// the last direction; `end: 'sit'` settles in the open spot.

const OL = [
  { slot: 'LT', pos: 'OL', dx: -3.9, y: -0.9 },
  { slot: 'LG', pos: 'OL', dx: -1.95, y: -0.85 },
  { slot: 'C', pos: 'OL', dx: 0, y: -0.75 },
  { slot: 'RG', pos: 'OL', dx: 1.95, y: -0.85 },
  { slot: 'RT', pos: 'OL', dx: 3.9, y: -0.9 },
];

export const OL_SLOTS = ['LT', 'LG', 'C', 'RG', 'RT'];

export const FORMATIONS = {
  gun_doubles: {
    name: 'Shotgun Doubles',
    slots: [...OL,
      { slot: 'QB', pos: 'QB', dx: 0, y: -5 },
      { slot: 'RB', pos: 'RB', dx: -1.7, y: -5 },
      { slot: 'X', pos: 'WR', wide: 'L', y: -0.9 },
      { slot: 'SL', pos: 'WR', slotSide: 'L', y: -1.7 },
      { slot: 'Y', pos: 'TE', dx: 5.8, y: -0.95 },
      { slot: 'Z', pos: 'WR', wide: 'R', y: -1.7 },
    ],
  },
  gun_trips: {
    name: 'Shotgun Trips Right',
    slots: [...OL,
      { slot: 'QB', pos: 'QB', dx: 0, y: -5 },
      { slot: 'RB', pos: 'RB', dx: -1.7, y: -5 },
      { slot: 'X', pos: 'WR', wide: 'L', y: -0.9 },
      { slot: 'Y', pos: 'TE', dx: 5.8, y: -0.95 },
      { slot: 'SL', pos: 'WR', slotSide: 'R', y: -1.7 },
      { slot: 'Z', pos: 'WR', wide: 'R', y: -1.7 },
    ],
  },
  gun_spread: {
    name: 'Shotgun Spread',
    slots: [...OL,
      { slot: 'QB', pos: 'QB', dx: 0, y: -5 },
      { slot: 'RB', pos: 'RB', dx: 1.7, y: -5 },
      { slot: 'X', pos: 'WR', wide: 'L', y: -0.9 },
      { slot: 'SL2', pos: 'WR', slotSide: 'L', y: -1.7 },
      { slot: 'SL', pos: 'WR', slotSide: 'R', y: -1.7 },
      { slot: 'Z', pos: 'WR', wide: 'R', y: -0.9 },
    ],
  },
  singleback: {
    name: 'Singleback Ace',
    slots: [...OL,
      { slot: 'QB', pos: 'QB', dx: 0, y: -1.25 },
      { slot: 'RB', pos: 'RB', dx: 0, y: -6.8 },
      { slot: 'Y', pos: 'TE', dx: 5.8, y: -0.95 },
      { slot: 'Y2', pos: 'TE', dx: -5.8, y: -0.95 },
      { slot: 'X', pos: 'WR', wide: 'L', y: -1.7 },
      { slot: 'Z', pos: 'WR', wide: 'R', y: -1.7 },
    ],
  },
  i_form: {
    name: 'I-Form Pro',
    slots: [...OL,
      { slot: 'QB', pos: 'QB', dx: 0, y: -1.25 },
      { slot: 'FB', pos: 'RB', dx: 0, y: -4.3 },
      { slot: 'RB', pos: 'RB', dx: 0, y: -7.2 },
      { slot: 'Y', pos: 'TE', dx: 5.8, y: -0.95 },
      { slot: 'X', pos: 'WR', wide: 'L', y: -0.9 },
      { slot: 'Z', pos: 'WR', wide: 'R', y: -1.7 },
    ],
  },
  pistol: {
    name: 'Pistol',
    slots: [...OL,
      { slot: 'QB', pos: 'QB', dx: 0, y: -4 },
      { slot: 'RB', pos: 'RB', dx: 0, y: -7 },
      { slot: 'Y', pos: 'TE', dx: -5.8, y: -0.95 },
      { slot: 'X', pos: 'WR', wide: 'L', y: -1.7 },
      { slot: 'SL', pos: 'WR', slotSide: 'R', y: -1.7 },
      { slot: 'Z', pos: 'WR', wide: 'R', y: -0.9 },
    ],
  },
  jumbo: {
    name: 'Goal Line Jumbo',
    slots: [...OL,
      { slot: 'QB', pos: 'QB', dx: 0, y: -1.25 },
      { slot: 'FB', pos: 'RB', dx: 0, y: -4.3 },
      { slot: 'RB', pos: 'RB', dx: 0, y: -7.2 },
      { slot: 'Y', pos: 'TE', dx: 5.8, y: -0.95 },
      { slot: 'Y2', pos: 'TE', dx: -5.8, y: -0.95 },
      { slot: 'Y3', pos: 'TE', dx: 7.3, y: -1.8 },
    ],
  },
};

// Which depth-chart spot fills each formation slot.
export const SLOT_DEPTH = {
  QB: ['QB', 0], RB: ['RB', 0], FB: ['RB', 1],
  X: ['WR', 0], Z: ['WR', 1], SL: ['WR', 2], SL2: ['WR', 3],
  Y: ['TE', 0], Y2: ['TE', 1], Y3: ['TE', 2],
  LT: ['OL', 0], RT: ['OL', 1], C: ['OL', 2], LG: ['OL', 3], RG: ['OL', 4],
  DE_L: ['DL', 0], DE_R: ['DL', 1], DT_L: ['DL', 2], DT_R: ['DL', 3], NT: ['DL', 4],
  MIKE: ['LB', 0], WILL: ['LB', 1], SAM: ['LB', 2],
  ILB_L: ['LB', 0], ILB_R: ['LB', 1], OLB_R: ['LB', 2], OLB_L: ['DL', 4],
  CB_L: ['CB', 0], CB_R: ['CB', 1], NB: ['CB', 2], DB: ['CB', 3],
  FS: ['S', 0], SS: ['S', 1],
};

export const ROUTES = {
  go: { name: 'Go', pts: [[0.4, 8], [0.8, 30]], end: 'continue' },
  fade: { name: 'Fade', pts: [[1.8, 8], [3, 30]], end: 'continue' },
  seam: { name: 'Seam', pts: [[0, 6], [-0.6, 30]], end: 'continue' },
  slant: { name: 'Slant', pts: [[0, 1.8], [-5, 7]], end: 'continue' },
  qout: { name: 'Quick Out', pts: [[0, 5], [4, 5.3]], end: 'continue' },
  out: { name: 'Out', pts: [[0, 10], [5, 10.3]], end: 'continue' },
  deepout: { name: 'Deep Out', pts: [[0, 12], [6, 12.3]], end: 'continue' },
  in: { name: 'In', pts: [[0, 10], [-7, 10.3]], end: 'continue' },
  dig: { name: 'Dig', pts: [[0, 14], [-8, 14.5]], end: 'continue' },
  curl: { name: 'Curl', pts: [[0, 11], [-0.8, 9.2]], end: 'sit' },
  hitch: { name: 'Hitch', pts: [[0, 6], [-0.2, 5.2]], end: 'sit' },
  stick: { name: 'Stick', pts: [[0, 6], [-1, 6]], end: 'sit' },
  comeback: { name: 'Comeback', pts: [[0, 15], [2.2, 12.5]], end: 'sit' },
  post: { name: 'Post', pts: [[0, 11], [-6, 26]], end: 'continue' },
  corner: { name: 'Corner', pts: [[0, 10], [6, 20]], end: 'continue' },
  drag: { name: 'Drag', pts: [[-1.2, 2], [-14, 3]], end: 'continue' },
  shallow: { name: 'Shallow', pts: [[-1.5, 3], [-14, 5]], end: 'continue' },
  cross: { name: 'Deep Cross', pts: [[0, 8], [-16, 15]], end: 'continue' },
  flat: { name: 'Flat', pts: [[3, 1], [8, 2.5]], end: 'continue' },
  swing: { name: 'Swing', pts: [[3, -1], [7, 0.5]], end: 'continue' },
  wheel: { name: 'Wheel', pts: [[3, 0], [6, 3], [6.5, 25]], end: 'continue' },
  screen: { name: 'Screen', pts: [[3, -1.6], [6, -1.4]], end: 'sit' },
};

// --- Offensive plays -------------------------------------------------------

function olAssign(a) {
  const out = {};
  for (const s of OL_SLOTS) out[s] = { ...a };
  return out;
}

function run(id, name, formation, dir, assign, extra = {}) {
  return { id, name, cat: 'run', formation, dir, assign: { ...olAssign({ t: 'zone', dir }), ...assign }, ...extra };
}

function pass(id, name, formation, drop, progression, assign, extra = {}) {
  return { id, name, cat: 'pass', formation, drop, progression, assign: { ...olAssign({ t: 'passpro' }), QB: { t: 'pass', drop }, ...assign }, ...extra };
}

const R = (r, side) => ({ t: 'route', r, side });
const BLOCK = { t: 'stalk' };
const PP = { t: 'passpro' };

export const OFFENSE_PLAYS = [
  // RUN
  run('iz_r', 'Inside Zone', 'singleback', 1, {
    QB: { t: 'handoff' },
    RB: { t: 'carry', path: [[1.2, -4.6], [2.6, -0.5], [2.8, 3]], handT: 0.45 },
    Y: { t: 'zone', dir: 1 }, Y2: { t: 'zone', dir: 1 }, X: BLOCK, Z: BLOCK,
  }),
  run('oz_l', 'Outside Zone Left', 'singleback', -1, {
    QB: { t: 'handoff' },
    RB: { t: 'carry', path: [[-2.5, -5.8], [-6.5, -1.8], [-8.5, 2.5]], handT: 0.5 },
    Y: { t: 'zone', dir: -1 }, Y2: { t: 'zone', dir: -1 }, X: BLOCK, Z: BLOCK,
  }),
  run('power_r', 'Power Right', 'i_form', 1, {
    QB: { t: 'handoff' },
    RB: { t: 'carry', path: [[0.4, -5.6], [2.4, -0.8], [2.6, 3]], handT: 0.55 },
    FB: { t: 'lead', to: [4.4, -0.2] },
    LG: { t: 'pull', path: [[-1.95, -2.2], [3.2, -1.8], [3.4, 1.0]] },
    Y: { t: 'zone', dir: 1 }, X: BLOCK, Z: BLOCK,
  }),
  run('toss_l', 'Toss Left', 'i_form', -1, {
    QB: { t: 'handoff', pitch: true },
    RB: { t: 'carry', path: [[-3, -7.2], [-8.5, -4.6], [-11, 1]], handT: 0.3, pitch: true },
    FB: { t: 'lead', to: [-7.5, -1] },
    Y: { t: 'zone', dir: -1 }, X: BLOCK, Z: BLOCK,
  }),
  run('dive', 'HB Dive', 'i_form', 1, {
    QB: { t: 'handoff' },
    RB: { t: 'carry', path: [[0.9, -4.2], [1, 0.4], [1, 3]], handT: 0.4 },
    FB: { t: 'lead', to: [1.2, 0.6] },
    Y: { t: 'zone', dir: 1 }, X: BLOCK, Z: BLOCK,
  }),
  run('counter', 'Counter', 'gun_doubles', 1, {
    QB: { t: 'handoff' },
    RB: { t: 'carry', path: [[-2.3, -4.7], [-0.4, -4.4], [2.6, -0.6], [2.8, 3]], handT: 0.7 },
    LG: { t: 'pull', path: [[-1.95, -2.2], [3.0, -1.9], [3.3, 1.0]] },
    Y: { t: 'zone', dir: 1 }, X: BLOCK, Z: BLOCK, SL: BLOCK,
  }),
  run('draw', 'HB Draw', 'gun_doubles', 0, {
    QB: { t: 'handoff', fakeDrop: true },
    RB: { t: 'carry', path: [[-0.6, -4.4], [0, -0.4], [0.2, 3]], handT: 1.0 },
    LT: { t: 'draw' }, LG: { t: 'draw' }, C: { t: 'draw' }, RG: { t: 'draw' }, RT: { t: 'draw' },
    Y: { t: 'draw' }, X: R('go'), Z: R('go'), SL: R('seam'),
  }),
  run('qb_sneak', 'QB Sneak', 'jumbo', 0, {
    QB: { t: 'carry', path: [[0, 0.3], [0, 3]], handT: 0, self: true },
    RB: { t: 'lead', to: [0.3, -0.6] }, FB: { t: 'lead', to: [-0.3, -0.4] },
    Y: { t: 'zone', dir: 0 }, Y2: { t: 'zone', dir: 0 }, Y3: { t: 'zone', dir: 0 },
  }, { shortYardage: true }),
  run('gl_dive', 'Goal Line Dive', 'jumbo', 1, {
    QB: { t: 'handoff' },
    RB: { t: 'carry', path: [[0.9, -4.6], [1.6, 0.2], [1.8, 3]], handT: 0.45 },
    FB: { t: 'lead', to: [2.0, 0.2] },
    Y: { t: 'zone', dir: 1 }, Y2: { t: 'zone', dir: 1 }, Y3: { t: 'zone', dir: 1 },
  }, { shortYardage: true }),

  // PASS
  pass('four_verts', 'Four Verticals', 'gun_spread', 5, ['SL', 'SL2', 'Z', 'X', 'RB'], {
    X: R('go'), SL2: R('seam'), SL: R('seam'), Z: R('go'), RB: { t: 'chkrel', r: 'flat', side: 'R' },
  }, { depth: 'deep' }),
  pass('mesh', 'Mesh', 'gun_doubles', 3, ['Y', 'SL', 'RB', 'Z', 'X'], {
    X: R('go'), SL: R('drag'), Y: R('shallow'), Z: R('corner'), RB: R('swing', 'L'),
  }, { depth: 'short' }),
  pass('smash', 'Smash', 'gun_doubles', 5, ['SL', 'X', 'Y', 'Z', 'RB'], {
    X: R('hitch'), SL: R('corner'), Y: R('corner'), Z: R('hitch'), RB: PP,
  }, { depth: 'mid' }),
  pass('slants', 'Slants', 'gun_trips', 3, ['SL', 'Z', 'X', 'Y'], {
    X: R('slant'), Y: R('flat'), SL: R('slant'), Z: R('slant'), RB: PP,
  }, { depth: 'short' }),
  pass('stick', 'Stick', 'gun_trips', 3, ['Y', 'SL', 'X', 'Z', 'RB'], {
    X: R('slant'), Y: R('stick'), SL: R('flat'), Z: R('go'), RB: { t: 'chkrel', r: 'flat', side: 'L' },
  }, { depth: 'short' }),
  pass('quick_outs', 'Quick Outs', 'gun_doubles', 3, ['SL', 'Y', 'X', 'Z', 'RB'], {
    X: R('qout'), SL: R('qout'), Y: R('qout'), Z: R('qout'), RB: { t: 'chkrel', r: 'flat', side: 'L' },
  }, { depth: 'short' }),
  pass('curl_flat', 'Curl Flat', 'singleback', 5, ['Z', 'Y', 'X', 'RB'], {
    X: R('curl'), Z: R('curl'), Y: R('flat'), Y2: PP, RB: { t: 'chkrel', r: 'flat', side: 'L' },
  }, { depth: 'mid' }),
  pass('dagger', 'Dagger', 'gun_trips', 5, ['Z', 'SL', 'X', 'Y'], {
    X: R('post'), Y: R('qout'), SL: R('seam'), Z: R('dig'), RB: PP,
  }, { depth: 'mid' }),
  pass('flood', 'Flood', 'pistol', 5, ['SL', 'RB', 'Y', 'X', 'Z'], {
    X: R('post'), Y: R('shallow'), SL: R('deepout'), Z: R('go'), RB: R('flat', 'R'),
  }, { depth: 'mid' }),
  pass('y_cross', 'Y Cross', 'pistol', 5, ['Y', 'X', 'Z', 'SL', 'RB'], {
    X: R('post'), Y: R('cross'), SL: R('flat'), Z: R('comeback'), RB: { t: 'chkrel', r: 'flat', side: 'L' },
  }, { depth: 'mid' }),
  pass('te_seams', 'TE Seams', 'singleback', 5, ['Y', 'Y2', 'X', 'Z', 'RB'], {
    X: R('dig'), Y: R('seam'), Y2: R('seam'), Z: R('go'), RB: { t: 'chkrel', r: 'flat', side: 'R' },
  }, { depth: 'deep' }),
  pass('pa_shot', 'PA Deep Shot', 'i_form', 7, ['X', 'Y', 'Z', 'FB'], {
    X: R('post'), Y: R('cross'), Z: R('dig'), FB: R('flat', 'R'),
    RB: { t: 'pafake', path: [[0.6, -4.8], [1.4, -2.5]] },
  }, { pa: true, depth: 'deep' }),
  pass('hb_screen', 'HB Screen', 'gun_doubles', 5, ['RB'], {
    X: R('go'), SL: R('seam'), Y: R('seam'), Z: R('go'), RB: R('screen', 'R'),
    LT: { t: 'screenOL', dir: 1 }, LG: { t: 'screenOL', dir: 1 }, C: { t: 'screenOL', dir: 1 },
    RG: { t: 'screenOL', dir: 1 }, RT: { t: 'screenOL', dir: 1 },
  }, { screen: 1.35, depth: 'short' }),
  pass('hail_mary', 'Hail Mary', 'gun_spread', 7, ['SL', 'Z', 'X', 'SL2'], {
    X: R('fade'), SL2: R('go'), SL: R('go'), Z: R('fade'), RB: PP,
  }, { hailMary: true, depth: 'deep' }),

  // SPECIAL
  { id: 'punt', name: 'Punt', cat: 'special', special: 'punt', formation: 'punt' },
  { id: 'fg', name: 'Field Goal', cat: 'special', special: 'fg', formation: 'fg' },
  { id: 'kneel', name: 'QB Kneel', cat: 'special', special: 'kneel', formation: 'jumbo', assign: { ...olAssign(PP), QB: { t: 'kneel' }, RB: PP, FB: PP, Y: PP, Y2: PP, Y3: PP } },
  { id: 'spike', name: 'Spike Ball', cat: 'special', special: 'spike', formation: 'gun_doubles', assign: { ...olAssign(PP), QB: { t: 'spike' }, RB: PP, X: PP, SL: PP, Y: PP, Z: PP } },
];

// --- Defense ---------------------------------------------------------------

export const FRONTS = {
  '43': { name: '4-3', slots: ['DE_L', 'DT_L', 'DT_R', 'DE_R', 'WILL', 'MIKE', 'SAM', 'CB_L', 'CB_R', 'FS', 'SS'] },
  nickel: { name: 'Nickel', slots: ['DE_L', 'DT_L', 'DT_R', 'DE_R', 'WILL', 'MIKE', 'CB_L', 'CB_R', 'NB', 'FS', 'SS'] },
  dime: { name: 'Dime', slots: ['DE_L', 'DT_L', 'DT_R', 'DE_R', 'MIKE', 'CB_L', 'CB_R', 'NB', 'DB', 'FS', 'SS'] },
  '34': { name: '3-4', slots: ['DE_L', 'NT', 'DE_R', 'OLB_L', 'ILB_L', 'ILB_R', 'OLB_R', 'CB_L', 'CB_R', 'FS', 'SS'] },
  goal: { name: 'Goal Line', slots: ['DE_L', 'DT_L', 'NT', 'DT_R', 'DE_R', 'WILL', 'MIKE', 'SAM', 'CB_L', 'CB_R', 'SS'] },
};

// Zone landmarks: absolute x across the field, y = depth past the LOS.
// S/W suffix zones (flatS, hookW...) resolve to the strong or weak side.
export const ZONES = {
  deep3L: { x: 9.5, y: 16, rx: 9, ry: 9, deep: true },
  deep3M: { x: 26.67, y: 18, rx: 9, ry: 10, deep: true },
  deep3R: { x: 43.8, y: 16, rx: 9, ry: 9, deep: true },
  deepHalfL: { x: 15, y: 17, rx: 13, ry: 10, deep: true },
  deepHalfR: { x: 38.3, y: 17, rx: 13, ry: 10, deep: true },
  deepFree: { x: 26.67, y: 17, rx: 16, ry: 10, deep: true },
  q1: { x: 8, y: 14, rx: 7, ry: 9, deep: true },
  q2: { x: 20.5, y: 15, rx: 6.5, ry: 9, deep: true },
  q3: { x: 32.8, y: 15, rx: 6.5, ry: 9, deep: true },
  q4: { x: 45.3, y: 14, rx: 7, ry: 9, deep: true },
  flatL: { x: 7, y: 5, rx: 6, ry: 4.5 },
  flatR: { x: 46.3, y: 5, rx: 6, ry: 4.5 },
  curlL: { x: 14, y: 10, rx: 5, ry: 4.5 },
  curlR: { x: 39.3, y: 10, rx: 5, ry: 4.5 },
  hookL: { x: 20.5, y: 8, rx: 4.5, ry: 4 },
  hookM: { x: 26.67, y: 8.5, rx: 4.5, ry: 4 },
  hookR: { x: 32.8, y: 8, rx: 4.5, ry: 4 },
  tampaMid: { x: 26.67, y: 13, rx: 4.5, ry: 6 },
};

const RUSH = { t: 'rush' };
const MAN = { t: 'man' };
const Z = (z) => ({ t: 'zone', z });
const BLITZ = (gap) => ({ t: 'blitz', gap });

function d(id, name, cat, front, shell, assign, extra = {}) {
  const base = {};
  for (const s of FRONTS[front].slots) {
    if (s.startsWith('DE') || s.startsWith('DT') || s === 'NT') base[s] = RUSH;
  }
  return { id, name, cat, front, shell, assign: { ...base, ...assign }, ...extra };
}

export const DEFENSE_PLAYS = [
  // MAN
  d('cov1_43', 'Cover 1', 'man', '43', 1, {
    CB_L: MAN, CB_R: MAN, SS: MAN, SAM: MAN, WILL: MAN, MIKE: Z('hookM'), FS: Z('deepFree'),
  }),
  d('cov1_nickel', 'Nickel Cover 1', 'man', 'nickel', 1, {
    CB_L: MAN, CB_R: MAN, NB: MAN, SS: MAN, WILL: MAN, MIKE: Z('hookM'), FS: Z('deepFree'),
  }),
  d('2man', '2-Man Under', 'man', 'nickel', 2, {
    CB_L: MAN, CB_R: MAN, NB: MAN, MIKE: MAN, WILL: MAN, FS: Z('deepHalfL'), SS: Z('deepHalfR'),
  }),
  d('press_dime', 'Dime Press Man', 'man', 'dime', 1, {
    CB_L: { t: 'man', press: true }, CB_R: { t: 'man', press: true }, NB: { t: 'man', press: true },
    DB: MAN, SS: MAN, MIKE: { t: 'spy' }, FS: Z('deepFree'),
  }),

  // ZONE
  d('cov2_43', 'Cover 2', 'zone', '43', 2, {
    CB_L: Z('flatL'), CB_R: Z('flatR'), WILL: Z('hookL'), MIKE: Z('hookM'), SAM: Z('hookR'),
    FS: Z('deepHalfL'), SS: Z('deepHalfR'),
  }),
  d('tampa2', 'Tampa 2', 'zone', '43', 2, {
    CB_L: Z('flatL'), CB_R: Z('flatR'), WILL: Z('curlL'), MIKE: Z('tampaMid'), SAM: Z('curlR'),
    FS: Z('deepHalfL'), SS: Z('deepHalfR'),
  }),
  d('cov3_43', 'Cover 3', 'zone', '43', 1, {
    CB_L: Z('deep3L'), CB_R: Z('deep3R'), FS: Z('deep3M'),
    SS: Z('flatS'), SAM: Z('hookS'), MIKE: Z('hookW'), WILL: Z('flatW'),
  }),
  d('cov3_nickel', 'Cover 3 Sky', 'zone', 'nickel', 1, {
    CB_L: Z('deep3L'), CB_R: Z('deep3R'), FS: Z('deep3M'),
    NB: Z('flatS'), SS: Z('hookS'), MIKE: Z('hookW'), WILL: Z('flatW'),
  }),
  d('cov4', 'Cover 4', 'zone', 'nickel', 2, {
    CB_L: Z('q1'), CB_R: Z('q4'), FS: Z('q2'), SS: Z('q3'),
    NB: Z('flatS'), MIKE: Z('hookM'), WILL: Z('flatW'),
  }),
  d('prevent', 'Prevent', 'zone', 'dime', 2, {
    DT_R: { t: 'spy' },
    CB_L: Z('q1'), CB_R: Z('q4'), FS: Z('q2'), SS: Z('q3'),
    NB: Z('curlS'), DB: Z('curlW'), MIKE: Z('hookM'),
  }, { soft: true }),

  // BLITZ
  d('fire_zone', 'Fire Zone 3', 'blitz', 'nickel', 1, {
    DE_R: Z('hookM'), NB: BLITZ('edgeS'), MIKE: BLITZ('A'),
    CB_L: Z('deep3L'), CB_R: Z('deep3R'), FS: Z('deep3M'), SS: Z('flatS'), WILL: Z('flatW'),
  }),
  d('mike_blitz', 'Mike Blitz', 'blitz', '43', 1, {
    MIKE: BLITZ('A'), CB_L: MAN, CB_R: MAN, SS: MAN, SAM: MAN, WILL: MAN, FS: Z('deepFree'),
  }),
  d('nickel_blitz', 'Nickel Blitz', 'blitz', 'nickel', 1, {
    NB: BLITZ('edgeS'), CB_L: MAN, CB_R: MAN, SS: MAN, MIKE: MAN, WILL: MAN, FS: Z('deepFree'),
  }),
  d('cov0', 'Cover 0 Blitz', 'blitz', 'nickel', 0, {
    MIKE: BLITZ('A'), WILL: BLITZ('B'),
    CB_L: { t: 'man', press: true }, CB_R: { t: 'man', press: true }, NB: MAN, FS: MAN, SS: MAN,
  }),
  d('edge_34', '3-4 Edge Blitz', 'blitz', '34', 1, {
    OLB_L: BLITZ('edgeL'), OLB_R: BLITZ('edgeR'), ILB_R: BLITZ('B'),
    CB_L: Z('deep3L'), CB_R: Z('deep3R'), FS: Z('deep3M'), SS: Z('flatS'), ILB_L: Z('hookW'),
  }),

  // RUN
  d('run_commit', 'Run Commit', 'run', '43', 1, {
    CB_L: MAN, CB_R: MAN, SAM: MAN, MIKE: { t: 'fit' }, WILL: { t: 'fit' }, SS: { t: 'fit' }, FS: Z('deepFree'),
  }),
  d('goal_line', 'Goal Line', 'run', 'goal', 0, {
    MIKE: { t: 'fit' }, WILL: MAN, SAM: MAN, CB_L: MAN, CB_R: MAN, SS: MAN,
  }),
  d('34_base', '3-4 Cover 3', 'run', '34', 1, {
    OLB_L: RUSH, OLB_R: RUSH, ILB_L: { t: 'fit' }, ILB_R: Z('hookS'),
    CB_L: Z('deep3L'), CB_R: Z('deep3R'), FS: Z('deep3M'), SS: Z('flatS'),
  }),
];

export const OFF_CATS = [
  { id: 'run', label: 'Run' },
  { id: 'pass', label: 'Pass' },
  { id: 'special', label: 'Special' },
];

export const DEF_CATS = [
  { id: 'man', label: 'Man' },
  { id: 'zone', label: 'Zone' },
  { id: 'blitz', label: 'Blitz' },
  { id: 'run', label: 'Run D' },
];

export function offPlay(id) {
  return OFFENSE_PLAYS.find((p) => p.id === id);
}

export function defPlay(id) {
  return DEFENSE_PLAYS.find((p) => p.id === id);
}
