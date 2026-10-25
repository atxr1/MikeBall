// Builds assets/data/league.json (the game-ready league) from the raw asset
// data in assets/data/raw/. Dev tool; the game only reads the output.
//
// Usage: node tools/build-league.mjs
//
// Real names, numbers, positions, depth charts, bios and appearance are kept.
// Ratings are model estimates from the asset pack and have systematic flaws
// (e.g. receivers slower than safeties, every receiver at elusiveness ~17),
// so each rating is re-mapped by rank within its position onto the
// distribution the play sim is tuned for (the generated league). Players
// keep their order; Jefferson is still the best route runner. Ratings that
// the pack left as flat placeholders for a position are filled from the
// player's overall quality instead.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { generateLeague, ATTRS, POS_LIST, SKILL_WEIGHTS } from '../src/data/roster.js';
import { hashString } from '../src/core/rng.js';

const RAW = 'assets/data/raw';
const teams = JSON.parse(readFileSync(`${RAW}/teams.json`, 'utf8'));
const uniforms = JSON.parse(readFileSync(`${RAW}/uniforms.json`, 'utf8'));
const roster = JSON.parse(readFileSync(`${RAW}/rosters.json`, 'utf8'));
const stadiums = JSON.parse(readFileSync(`${RAW}/stadiums.json`, 'utf8'));
const active = roster.players.filter((p) => !p.practice_squad);
const logoMeta = existsSync('assets/teams/logo_meta.json') ? JSON.parse(readFileSync('assets/teams/logo_meta.json', 'utf8')) : {};

// ------------------------------------------------------------ target distributions
const gen = Object.values(generateLeague(2026)).flatMap((r) => r.players);
const target = {};
for (const pos of POS_LIST) {
  target[pos] = {};
  const ps = gen.filter((p) => p.pos === pos);
  for (const k of ATTRS) target[pos][k] = ps.map((p) => p.attrs[k]).sort((a, b) => a - b);
}
const quantile = (arr, u) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(u * (arr.length - 1))))];

// ------------------------------------------------------------ calibrate
const byPos = {};
for (const p of active) (byPos[p.pos] ||= []).push(p);
const calibrated = new Map(active.map((p) => [p.id, {}]));
const report = [];

for (const [pos, ps] of Object.entries(byPos)) {
  const n = ps.length;
  // which raw attrs are placeholders for this position?
  const flat = new Set();
  for (const k of ATTRS) {
    const v = ps.map((p) => p.ratings[k]);
    const mean = v.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
    if (sd < 7.5 && mean < 35) flat.add(k);
  }
  // percentile rank helper (ties share the average rank)
  const pct = (k, getter) => {
    const vals = ps.map((p) => ({ p, v: getter(p) })).sort((a, b) => a.v - b.v);
    const out = new Map();
    let i = 0;
    while (i < vals.length) {
      let j = i;
      while (j + 1 < vals.length && vals[j + 1].v === vals[i].v) j++;
      const u = n > 1 ? (i + j) / 2 / (n - 1) : 0.5;
      for (let m = i; m <= j; m++) out.set(vals[m].p.id, u);
      i = j + 1;
    }
    return out;
  };
  // overall quality from the attrs that matter for the position and aren't flat
  const keyAttrs = Object.keys(SKILL_WEIGHTS[pos] || {}).concat(['spd', 'awr']).filter((k) => !flat.has(k));
  const pcts = Object.fromEntries(keyAttrs.map((k) => [k, pct(k, (p) => p.ratings[k])]));
  const quality = new Map(ps.map((p) => [p.id, keyAttrs.reduce((s, k) => s + pcts[k].get(p.id), 0) / Math.max(1, keyAttrs.length)]));
  for (const k of ATTRS) {
    const tgt = target[pos][k];
    let ranks;
    if (flat.has(k)) {
      // fill from overall quality plus a little per-player variety
      const jitter = (p) => ((hashString(p.id + k) % 1000) / 1000 - 0.5) * 0.5;
      ranks = pct(k, (p) => quality.get(p.id) + jitter(p));
    } else {
      ranks = pct(k, (p) => p.ratings[k] + (hashString(p.id + k) % 100) / 1000);
    }
    for (const p of ps) calibrated.get(p.id)[k] = quantile(tgt, ranks.get(p.id));
  }
  report.push(`${pos.padEnd(3)} n=${String(n).padStart(3)} filled: ${[...flat].join(' ') || '-'}`);
}

// ------------------------------------------------------------ depth charts
const val = (p) => {
  const w = SKILL_WEIGHTS[p.pos] || {};
  const a = calibrated.get(p.id);
  let s = 0;
  for (const k in w) s += w[k] * a[k];
  return s + a.spd * 0.15;
};
const byDepth = (a, b) => a.depth - b.depth || val(b) - val(a);

function d1is34(ps) {
  const d1 = (pos, det) => ps.filter((p) => p.pos === pos && p.pos_detail === det && p.depth === 1).length;
  return d1('DL', 'NT') > 0 || d1('DL', 'DT') < 2;
}

function depthChart(ps) {
  const used = new Set();
  const take = (list) => list.filter((p) => !used.has(p.id)).map((p) => (used.add(p.id), p.id));
  const of = (pos, ...details) => ps.filter((p) => p.pos === pos && (!details.length || details.includes(p.pos_detail)));
  const d1 = (list) => list.filter((p) => p.depth === 1);
  const rest = (pos) => ps.filter((p) => p.pos === pos).sort(byDepth);
  const raw = (p, k) => p.ratings[k];
  const D = {};

  D.QB = take(of('QB').sort(byDepth));
  // RB index 1 is the fullback slot
  const rbs = of('RB', 'RB').sort(byDepth);
  const fb = of('RB', 'FB').sort(byDepth);
  D.RB = take([rbs[0], fb[0] || rbs[1]].filter(Boolean)).concat(take(rest('RB')));
  D.WR = take(of('WR').sort(byDepth));
  D.TE = take(of('TE').sort(byDepth));
  // OL order matches the formation slots: LT, RT, C, LG, RG; long snappers last
  const first = (d) => d1(of('OL', d)).sort(byDepth)[0];
  D.OL = take([first('LT'), first('RT'), first('C'), first('LG'), first('RG')].filter(Boolean))
    .concat(take(ps.filter((p) => p.pos === 'OL' && p.pos_detail !== 'LS').sort(byDepth)))
    .concat(take(ps.filter((p) => p.pos === 'OL')));
  // EDGE: the pass rushers (4-3 ends, or 3-4 outside linebackers).
  // DL: interior first (4-3 tackles, or 3-4 ends), then the nose, then the
  // rest of the line. A 3-4 team has a starting nose or fewer than two
  // starting tackles. Rushing OLBs appear in EDGE and LB, never in DL.
  const is34 = d1is34(ps);
  const prs = (a, b) => raw(b, 'prs') - raw(a, 'prs');
  const ends = of('DL', 'DE', 'EDGE');
  const tackles = of('DL', 'DT');
  const noses = of('DL', 'NT');
  let edgeIds;
  let dlOrder;
  if (is34) {
    const olbs = of('LB', 'OLB').sort((a, b) => a.depth - b.depth || prs(a, b));
    edgeIds = olbs.slice(0, 2).concat(olbs.slice(2).sort(prs), ends.sort(prs));
    dlOrder = d1(ends.concat(tackles)).sort((a, b) => raw(b, 'rsd') + raw(b, 'prs') - raw(a, 'rsd') - raw(a, 'prs'))
      .concat(d1(noses), ps.filter((p) => p.pos === 'DL').sort(byDepth));
  } else {
    edgeIds = d1(ends).sort(prs).concat(ends.filter((p) => p.depth !== 1).sort(byDepth));
    dlOrder = d1(tackles).sort((a, b) => raw(b, 'rsd') - raw(a, 'rsd'))
      .concat(d1(noses), tackles.filter((p) => p.depth !== 1).sort(byDepth), noses.sort(byDepth), ends.sort(byDepth));
  }
  const uniq = (list) => [...new Set(list.map((p) => p.id))];
  D.EDGE = uniq(edgeIds);
  D.DL = uniq(dlOrder.filter((p) => p.pos === 'DL'));
  // LB: middle linebackers first, then cover OLBs, pass-rush OLBs last
  const rushers = new Set(is34 ? D.EDGE.slice(0, 2) : []);
  const lbOrder = (p) => (p.pos_detail === 'MLB' ? 0 : p.pos_detail === 'ILB' ? 1 : rushers.has(p.id) ? 3 : 2);
  D.LB = ps.filter((p) => p.pos === 'LB').sort((a, b) => a.depth - b.depth || lbOrder(a) - lbOrder(b) || val(b) - val(a)).map((p) => p.id);
  D.CB = take(d1(of('CB', 'CB')).sort(byDepth)).concat(take(d1(of('CB', 'NCB')))).concat(take(rest('CB')));
  D.S = take([d1(of('S', 'FS'))[0], d1(of('S', 'SS'))[0]].filter(Boolean)).concat(take(rest('S')));
  D.K = take(of('K').sort(byDepth));
  D.P = take(of('P').sort(byDepth));
  return D;
}

// ------------------------------------------------------------ uniforms
function kit(u) {
  const stripe = u.helmet.stripe && u.helmet.stripe.pattern !== 'none' ? u.helmet.stripe.colors[0] : null;
  const sleeve = u.jersey.sleeve_stripe && u.jersey.sleeve_stripe.pattern !== 'none' ? u.jersey.sleeve_stripe.colors[0] : null;
  const pantsStripe = u.pants.stripe && u.pants.stripe.pattern !== 'none' ? u.pants.stripe.colors : null;
  return {
    jersey: u.jersey.base,
    num: u.jersey.numbers,
    numOutline: u.jersey.number_outline || null,
    trim: sleeve || u.jersey.numbers,
    collar: u.jersey.collar || null,
    helmet: u.helmet.shell,
    mask: u.helmet.facemask,
    stripe,
    pants: u.pants.base,
    pantsStripe: pantsStripe ? pantsStripe[Math.floor(pantsStripe.length / 2)] : null,
    socks: u.socks.base,
    cleats: u.cleats || '#101820',
  };
}

// ------------------------------------------------------------ assemble
const portraitIndex = JSON.parse(readFileSync(`${RAW}/portrait_index.json`, 'utf8'));
const portraits = new Set((Array.isArray(portraitIndex) ? portraitIndex : portraitIndex.portraits || []).map((x) => x.player_id));
const out = {
  version: 1,
  as_of: roster.as_of,
  note: 'Built by tools/build-league.mjs. Ratings are calibrated estimates; never show them in the UI.',
  teams: teams.map((t) => {
    const ps = active.filter((p) => p.team === t.id);
    const st = stadiums.find((s) => s.id === t.stadium_id);
    return {
      id: t.id,
      abbr: t.abbr,
      city: t.city,
      name: t.name,
      conf: t.conference,
      div: t.division,
      colors: t.colors,
      logoDark: !!(logoMeta[t.id] && logoMeta[t.id].dark),
      helmetLogo: existsSync(`assets/teams/${t.id}/helmet_5x4.png`),
      uniforms: { home: kit(uniforms[t.id].home), away: kit(uniforms[t.id].away) },
      stadium: st ? { id: st.id, name: st.name, roof: st.roof, surface: st.surface } : null,
      front: d1is34(ps) ? '34' : '43',
      depth: depthChart(ps),
      players: ps.map((p) => ({
        id: p.id,
        first: p.first,
        last: p.last,
        pos: p.pos,
        posDetail: p.pos_detail,
        num: p.number,
        age: p.age,
        exp: p.experience,
        college: p.college,
        height: p.height_in,
        weight: p.weight_lb,
        attrs: calibrated.get(p.id),
        traits: p.traits,
        skinTone: p.appearance.skin_tone,
        injured: p.injury && (p.injury.status === 'out' || p.injury.status === 'ir') ? p.injury.status : null,
        born: p.birthdate || null,
        draft: p.draft ? { year: p.draft.year, round: p.draft.round, pick: p.draft.pick } : null,
        // contract terms are the pack's estimates (as of its date): money per
        // year, this year's cap hit, years left including this one, the
        // guaranteed money still owed, and the year he hits free agency
        contract: p.contract ? { type: p.contract.type, apy: p.contract.apy, capHit: p.contract.cap_hit, years: p.contract.years_left, guaranteed: p.contract.guaranteed_remaining, fa: p.contract.free_agent_year } : null,
        portrait: portraits.has(p.id) || existsSync(`assets/portraits/${p.id}.png`) ? 1 : 0,
      })),
    };
  }),
};
writeFileSync('assets/data/league.json', JSON.stringify(out));
console.log(report.join('\n'));
console.log(`wrote assets/data/league.json: ${out.teams.length} teams, ${active.length} players, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
