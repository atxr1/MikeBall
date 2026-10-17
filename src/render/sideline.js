// The sidelines, laid out like an NFL field (Rule 1): a six-foot white
// border outside the field, the yellow coaches' line six feet behind it
// along each team area (between the 25s, with the dashed yellow lines
// running back from the 25s), benches 10+ yards back between the 30s, and
// everyone who's there on game day — the players not in the game (some with
// helmets off), coaches in headsets with their play sheets, trainers and
// equipment staff, the blue medical tent, coolers and cup tables, the
// kicking net; photographers and TV camera operators outside the team
// areas; and the chain crew with the rods and the down box at the line of
// scrimmage and the line to gain (visitors' sideline in the first half,
// home in the second).
//
// Everyone is generated from the game seed — body, skin, hair, outfit,
// where they stand, what they're doing — so no two look copied. Players
// and staff react when their team makes a play.
//
// Coordinates: d = yards outside the sideline, f = yard line measured
// from the home team's goal line. drawSideline* maps them to the current
// view (the view turns around with possession; the home bench is on the
// left of the screen when the home team has the ball).

import { FIELD_W, clamp } from '../core/util.js';
import { makeRng } from '../core/rng.js';
import { playerOutfit, personOutfit, drawRig, tone } from './rig.js';
import { drawShadow } from './pixelsprites.js';

export const APRON = 14; // yards from the sideline to the wall
const R = Math.round;

const KHAKI = ['#b9a27c', '#a8936f', '#c7b38f', '#8f8a7e'];
const DARK = ['#24262c', '#2e3138', '#1b1d22', '#3a3d45'];

function base(view) {
  return { view, crouch: 0, lean: 0, tx: 0, legs: [[0, 0], [0, 0]], arms: [[0, 0, 0], [0, 0, 0]], ball: -1, rot: 0, pivot: 'feet', sy: 10, lift: 0, prop: null, lie: null };
}

// ------------------------------------------------------------------ build
// teams: { home, away } team records; unis: { home, away } uniforms;
// rosters: { home, away }.
export function makeSideline(teams, unis, rosters, seed) {
  const rng = makeRng((seed ^ 0x51de) >>> 0);
  const people = [];
  const props = [];
  const take = (n) => rng.int(0, n - 1);
  for (const team of ['home', 'away']) {
    const t = teams[team];
    const c = t.colors;
    const polo = [c.primary, c.secondary, '#f2f2ee', '#1d2026', c.primary];
    // coaches' area: the head coach near the 50, coordinators and
    // assistants around him
    const staffAt = (kind, f, d, o = {}) => {
      const shirt = o.shirt || rng.pick(polo);
      const outfit = personOutfit({
        key: `${team}-${kind}-${people.length}`,
        skin: take(6), hair: take(7),
        shirt: { a: shirt, collar: shirt === '#f2f2ee' ? c.primary : '#f2f2ee', badge: shirt === c.primary ? '#f2f2ee' : c.primary },
        pants: o.pants || rng.pick(rng.chance(0.5) ? KHAKI : DARK),
        shoes: rng.pick(['#1b1d22', '#f0f0ea', '#3a3d45']),
        cap: o.cap === false ? null : rng.chance(0.75) ? rng.pick([c.primary, '#1d2026', c.secondary]) : null,
        headset: !!o.headset,
      });
      people.push({ team, kind, outfit, f, d, seed: rng.int(0, 1e9), face: o.face ?? 'field', prop: o.prop || null });
    };
    staffAt('hc', 50 + rng.float(-6, 6), 2.6 + rng.float(0, 0.8), { headset: true, prop: { k: 'sheet', hand: 1 }, cap: undefined });
    for (let i = 0; i < 4; i++) staffAt('coach', 50 + rng.float(-14, 14), 2.6 + rng.float(0, 1.2), { headset: rng.chance(0.7), prop: rng.chance(0.5) ? { k: 'sheet', hand: rng.int(0, 1) } : rng.chance(0.4) ? { k: 'tablet', hand: 1 } : null });
    // trainers, equipment staff
    for (let i = 0; i < 7; i++) staffAt('staff', rng.float(28, 72), rng.float(5, 9.5), { prop: rng.chance(0.25) ? { k: 'tablet', hand: 1 } : null });
    // players not in the game: standing along the coaches' line, some with
    // helmets off, a few sitting on the bench
    const sideRoster = (rosters[team] && rosters[team].players) || [];
    for (const p of sideRoster) {
      const sitting = rng.chance(0.18);
      const f = sitting ? rng.float(36, 64) : rng.float(30, 70);
      const d = sitting ? 11.2 : rng.float(4.6, 8.5);
      const bare = rng.chance(0.35);
      people.push({ team, kind: 'player', rec: p, bare, sitting, f, d, seed: rng.int(0, 1e9), face: 'field', uni: team });
    }
    // props in the team area
    props.push({ team, k: 'bench', f0: 37, f1: 47, d: 11.6 }, { team, k: 'bench', f0: 53, f1: 63, d: 11.6 });
    props.push({ team, k: 'tent', f: rng.pick([31, 69]), d: 12.5 });
    props.push({ team, k: 'cooler', f: rng.float(44, 48), d: 9.6 }, { team, k: 'cooler', f: rng.float(52, 56), d: 9.6 });
    props.push({ team, k: 'table', f: rng.float(40, 60), d: 10.2 });
    props.push({ team, k: 'net', f: rng.pick([28, 72]), d: 10.5 });
    // photographers and camera crews outside the team area
    for (let i = 0; i < 9; i++) {
      const end = rng.chance(0.5);
      const f = end ? rng.float(2, 22) : rng.float(78, 98);
      const kind = rng.chance(0.25) ? 'tvcam' : rng.chance(0.15) ? 'mic' : 'photo';
      const outfit = personOutfit({
        key: `${team}-${kind}-${i}`,
        skin: take(6), hair: take(7),
        shirt: { a: kind === 'photo' ? rng.pick(['#c8b48a', '#d9c49a', '#b8a479']) : rng.pick(DARK), collar: rng.pick(DARK) },
        sleeve: rng.pick(DARK),
        pants: rng.pick(DARK),
        cap: rng.chance(0.6) ? rng.pick(DARK) : null,
      });
      people.push({ team: null, side: team, kind, outfit, f, d: kind === 'photo' ? rng.float(2.4, 4.5) : rng.float(3.2, 5.5), seed: rng.int(0, 1e9), face: 'field', kneel: kind === 'photo' && rng.chance(0.5), prop: { k: kind === 'mic' ? 'mic' : 'camera', hand: 1 } });
    }
  }
  // the chain crew (visitors' side): two rod men and the box man
  for (const role of ['rear', 'front', 'box']) {
    const outfit = personOutfit({
      key: `chain-${role}`,
      skin: take(6), hair: take(7),
      shirt: { a: '#f2f2ee', b: '#e2601f', collar: '#e2601f' },
      sleeve: '#f2f2ee',
      pants: '#1d2026',
      cap: '#1d2026',
    });
    people.push({ team: null, side: 'away', kind: 'chain', role, outfit, f: 50, d: 2.4, seed: rng.int(0, 1e9), face: 'field' });
  }
  return { people, props, teams, excite: { home: 0, away: 0 }, outfits: new Map(), onField: new Set() };
}

// ------------------------------------------------------------------ view
// Where on screen (sim x, view f) a sideline spot is. homeBall: the home
// team has the ball (offense frame = home frame, home bench on the left).
function place(team, d, f, homeBall) {
  const left = (team === 'home') === homeBall;
  return { x: left ? -d : FIELD_W + d, f: homeBall ? f : 100 - f, left };
}

// Ground: white border, coaches' line, team-area lines, the broken limit
// line, benches, tent.
// Drawn into the low-res field buffer.
export function drawSidelineGround(ctx, cam, sl, homeBall) {
  const X = (x) => Math.round(cam.sx(x));
  const Y = (f) => Math.round(cam.sy(f));
  const [f0, f1] = cam.fRange();
  // the six-foot solid white border around the field
  ctx.fillStyle = '#eef1ea';
  const b = 2;
  ctx.fillRect(X(-b), Y(112), X(0) - X(-b), Y(-12) - Y(112));
  ctx.fillRect(X(FIELD_W), Y(112), X(FIELD_W + b) - X(FIELD_W), Y(-12) - Y(112));
  ctx.fillRect(X(-b), Y(112), X(FIELD_W + b) - X(-b), Y(110) - Y(112));
  ctx.fillRect(X(-b), Y(-10), X(FIELD_W + b) - X(-b), Y(-12) - Y(-10));
  // coaches' area: solid yellow line six feet behind the border, between
  // the 25s; dashed yellow lines back from the 25s around the team area
  ctx.fillStyle = '#f2c52b';
  for (const team of ['home', 'away']) {
    const a = place(team, 4, 25, homeBall);
    const bb = place(team, 4, 75, homeBall);
    const x = X(a.x);
    const ya = Y(a.f);
    const yb = Y(bb.f);
    ctx.fillRect(x, Math.min(ya, yb), 1, Math.abs(yb - ya));
    for (const fl of [25, 75]) {
      const p0 = place(team, 2, fl, homeBall);
      const p1 = place(team, APRON - 0.5, fl, homeBall);
      const y = Y(p0.f);
      const xa = Math.min(X(p0.x), X(p1.x));
      const xb = Math.max(X(p0.x), X(p1.x));
      for (let xx = xa; xx < xb; xx += 3) ctx.fillRect(xx, y, 2, 1);
    }
  }
  // the broken white limit line six feet outside the border, everywhere
  // but in front of the team areas
  ctx.fillStyle = '#eef1ea';
  for (const team of ['home', 'away']) {
    for (const [fa, fb] of [[-14, 25], [75, 114]]) {
      const ya = Y(place(team, 4, fa, homeBall).f);
      const yb = Y(place(team, 4, fb, homeBall).f);
      const x = X(place(team, 4, fa, homeBall).x);
      // only the part on screen, keeping the dash phase steady as it scrolls
      const top = Math.min(ya, yb);
      const y0 = top + Math.max(0, Math.floor((-2 - top) / 3) * 3);
      const y1 = Math.min(Math.max(ya, yb), ctx.canvas.height + 2);
      for (let yy = y0; yy < y1; yy += 3) ctx.fillRect(x, yy, 1, 2);
    }
  }
  for (const f of [-14, 114]) {
    const y = Y(f);
    if (y < -1 || y > ctx.canvas.height) continue;
    for (let xx = X(-4); xx < X(FIELD_W + 4); xx += 3) ctx.fillRect(xx, y, 2, 1);
  }
  // props on the ground
  for (const pr of sl.props) {
    const fm = pr.f ?? (pr.f0 + pr.f1) / 2;
    const p = place(pr.team, pr.d, fm, homeBall);
    if (p.f < f0 - 6 || p.f > f1 + 6) continue;
    const x = X(p.x);
    const y = Y(p.f);
    const team = pr.team === 'home' ? sl.teams.home : sl.teams.away;
    if (pr.k === 'bench') {
      const ya = Y(place(pr.team, pr.d, pr.f0, homeBall).f);
      const yb = Y(place(pr.team, pr.d, pr.f1, homeBall).f);
      const w = Math.max(3, R(cam.s * 0.8));
      const top = Math.min(ya, yb);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x - (w >> 1) + 1, top + 1, w, Math.abs(yb - ya));
      ctx.fillStyle = tone(team.colors.primary, -0.15);
      ctx.fillRect(x - (w >> 1), top, w, Math.abs(yb - ya));
      ctx.fillStyle = tone(team.colors.primary, 0.25);
      ctx.fillRect(x - (w >> 1), top, w, 1);
    } else if (pr.k === 'tent') {
      const w = R(cam.s * 3);
      const h = R(cam.s * 2.2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x - (w >> 1) + 2, y - h + 2, w, h);
      ctx.fillStyle = '#2f63c8';
      ctx.fillRect(x - (w >> 1), y - h, w, h);
      ctx.fillStyle = '#4c82e8';
      ctx.fillRect(x - (w >> 1), y - h, w, 2);
      ctx.fillStyle = '#1f438c';
      ctx.fillRect(x - (w >> 1), y - 2, w, 2);
      ctx.fillStyle = '#e9eef8';
      ctx.fillRect(x - 3, y - h + 4, 7, 2); // the logo patch
    } else if (pr.k === 'cooler') {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x - 2, y, 6, 2);
      ctx.fillStyle = '#ff7a12';
      ctx.fillRect(x - 3, y - 6, 6, 6);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 3, y - 7, 6, 1);
      ctx.fillStyle = '#c95a00';
      ctx.fillRect(x + 2, y - 6, 1, 6);
    } else if (pr.k === 'table') {
      ctx.fillStyle = '#e6e2d8';
      ctx.fillRect(x - 3, y - 12, 7, 12);
      ctx.fillStyle = '#9fd04a';
      for (let i = 0; i < 6; i++) ctx.fillRect(x - 2 + (i % 3) * 2, y - 11 + Math.floor(i / 3) * 4, 1, 1);
    } else if (pr.k === 'net') {
      const w = R(cam.s * 2);
      const h = R(cam.s * 2.4);
      ctx.fillStyle = '#16181c';
      ctx.fillRect(x - (w >> 1), y - h, 1, h);
      ctx.fillRect(x + (w >> 1), y - h, 1, h);
      ctx.fillRect(x - (w >> 1), y - h, w + 1, 1);
      ctx.fillStyle = 'rgba(20,22,26,0.45)';
      for (let yy = y - h + 2; yy < y; yy += 2) ctx.fillRect(x - (w >> 1) + 1, yy, w - 1, 1);
    }
  }
}

// People: drawn on the device canvas at art-pixel scale, behind the
// players. state: { homeBall, los, ltg, down, now, half, onField:Set(ids),
// unis: { home, away } }. The chain crew works the visitors' sideline in
// the first half and the home sideline in the second.
export function drawSidelinePeople(ctx, cam, sl, state) {
  const { homeBall, now } = state;
  const items = sl._items || (sl._items = []);
  items.length = 0;
  for (const p of sl.people) {
    if (p.rec && state.onField.has(p.rec.id)) continue;
    let f = p.f;
    let d = p.d;
    if (p.kind === 'chain') {
      // the rods at the start of the series and the line to gain; the box
      // at the ball
      if (state.ltg == null || state.ltg >= 100) {
        if (p.role !== 'box') continue;
      }
      const losH = homeBall ? state.los : 100 - state.los;
      const ltgH = state.ltg == null ? null : homeBall ? state.ltg : 100 - state.ltg;
      if (p.role === 'box') f = losH;
      else if (p.role === 'front') f = ltgH;
      else f = ltgH - (homeBall ? 10 : -10);
    }
    const team = p.kind === 'chain' ? (state.half === 2 ? 'home' : 'away') : p.team || p.side;
    const pl = place(team, d, f, homeBall);
    const x = cam.sx(pl.x);
    const y = cam.sy(pl.f);
    if (x < -20 || x > cam.w + 20 || y < -6 || y > cam.h + 34) continue;
    items.push([p, x, y, pl.left]);
  }
  items.sort((a, b) => a[2] - b[2]);
  for (const [p, x, y, left] of items) {
    const e = poseOf(p, sl, now, left, state);
    drawShadow(ctx, x, y, 8);
    if (p.kind === 'chain') drawChainGear(ctx, x, y, p, state.down, cam);
    drawRig(ctx, outfitOf(p, sl, state), e, x, y - (e.lift || 0), p.kind === 'player' && !p.sitting ? p.rec.num : null, p);
  }
}

function outfitOf(p, sl, state) {
  if (p.outfit) return p.outfit;
  const k = `${p.team}|${p.rec.id}|${p.bare ? 1 : 0}`;
  let o = sl.outfits.get(k);
  if (!o) {
    o = playerOutfit(state.unis[p.team], p.rec.skinTone || 0);
    if (p.bare) {
      o = { ...o, key: `${o.key}|bare`, helmet: false, c: { ...o.c, head: { cap: null, hair: ['#2a1d14', '#3b2a1c', '#14110f', '#5a3d22', '#1b1612'][(p.seed >>> 3) % 5], headset: false } } };
    }
    sl.outfits.set(k, o);
  }
  return o;
}

// What each person is doing: watching the field, reacting to a play,
// kneeling with a camera, signalling... from their seed and the moment.
function poseOf(p, sl, now, left, state) {
  const e = base(left ? 'E' : 'W');
  const sv = p.seed;
  const r = (k) => ((sv >>> k) & 255) / 255;
  const excite = p.team ? sl.excite[p.team] : 0;
  // most face the field; some talk to each other, some watch the board
  if (r(2) < 0.18 && p.kind !== 'chain' && p.kind !== 'photo') e.view = r(5) < 0.5 ? 'S' : 'N';
  if (p.kind === 'player') {
    if (p.sitting) {
      e.crouch = 5;
      e.legs[0] = [2, -2];
      e.legs[1] = [3, -2];
      e.arms[0] = [2, 2, 0];
      e.arms[1] = [3, 2, 0];
      return e;
    }
    if (excite > 0.35 && r(1) < excite) {
      // jumping, arms up, helmets in the air
      e.view = 'S';
      e.arms[0] = [-2, -12, 0];
      e.arms[1] = [2, -12, 0];
      e.lift = R(Math.abs(Math.sin(now * (7 + r(3) * 5) + r(4) * 6)) * 4 * excite);
      return e;
    }
    // weight shifts, hands on hips or on the helmet
    const w = Math.sin(now * (0.5 + r(6)) + r(7) * 6);
    e.tx = Math.abs(w) > 0.8 ? (w > 0 ? 1 : -1) : 0;
    if (r(8) < 0.4) { e.arms[0] = [2, -3, 0]; e.arms[1] = [-2, -3, 0]; }
    return e;
  }
  if (p.kind === 'hc' || p.kind === 'coach') {
    e.prop = p.prop;
    if (p.prop) e.arms[p.prop.hand] = [3, -6, 0];
    if (excite > 0.5 && r(1) < 0.6) { e.view = 'S'; e.arms[0] = [-3, -11, 0]; e.arms[1] = [3, -11, 0]; e.prop = null; return e; }
    // pacing the coaches' box
    const pace = Math.sin(now * 0.4 + r(3) * 6);
    if (Math.abs(pace) > 0.6) e.tx = pace > 0 ? 1 : 0;
    return e;
  }
  if (p.kind === 'photo') {
    e.prop = p.prop;
    e.arms[1] = [5, -8, 0];
    e.arms[0] = [4, -7, 0];
    if (p.kneel) { e.crouch = 5; e.legs[0] = [-2, 0]; e.legs[1] = [2, -1]; }
    return e;
  }
  if (p.kind === 'tvcam') {
    e.prop = p.prop;
    e.arms[1] = [1, -10, 0];
    e.arms[0] = [3, -8, 0];
    return e;
  }
  if (p.kind === 'mic') {
    e.prop = p.prop;
    e.arms[1] = [5, -7, 0];
    return e;
  }
  if (p.kind === 'chain') {
    e.view = left ? 'E' : 'W';
    e.arms[1] = [2, -9, 0];
    e.arms[0] = [2, -8, 0];
    return e;
  }
  // staff: arms folded, a tablet, a towel over the shoulder
  if (p.prop) { e.prop = p.prop; e.arms[p.prop.hand] = [3, -5, 0]; }
  else if (r(9) < 0.5) { e.arms[0] = [4, -5, 0]; e.arms[1] = [4, -6, 0]; }
  return e;
}

// The chain gang's gear: orange rods with markers on top, the down box
// showing the down.
function drawChainGear(ctx, x, y, p, down, cam) {
  const X = R(x);
  const Y = R(y);
  const h = 26;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(X + 3, Y - h, 1, h);
  ctx.fillStyle = '#ff6a13';
  if (p.role === 'box') {
    ctx.fillRect(X + 1, Y - h - 6, 6, 7);
    ctx.fillStyle = '#121212';
    const d = String(down || 1);
    // a tiny digit
    const g = { 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'], 3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'] }[d] || [];
    g.forEach((row, ry) => [...row].forEach((ch, rx) => { if (ch === '#') ctx.fillRect(X + 2 + rx, Y - h - 5 + ry, 1, 1); }));
  } else {
    ctx.fillRect(X + 1, Y - h - 4, 5, 5);
    ctx.fillStyle = '#ffa14d';
    ctx.fillRect(X + 1, Y - h - 4, 5, 1);
  }
}

// After a play: the team that made it goes wild on its sideline.
export function sidelineReact(sl, team, amount) {
  if (!sl || !team) return;
  sl.excite[team] = Math.max(sl.excite[team], amount);
}

export function sidelineTick(sl, dt) {
  if (!sl) return false;
  let on = false;
  for (const t of ['home', 'away']) {
    if (sl.excite[t] > 0) { sl.excite[t] = Math.max(0, sl.excite[t] - dt * 0.25); on = true; }
  }
  return on;
}

export { clamp };
