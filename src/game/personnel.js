// Picks which players take the field for a formation, from the depth chart.

import { FORMATIONS, FRONTS, SLOT_DEPTH } from '../data/playbook.js';

const FALLBACK = { RB: ['TE', 'WR'], TE: ['OL', 'WR'], WR: ['RB', 'TE', 'CB'], OL: ['DL', 'TE'], DL: ['LB', 'OL'], LB: ['S', 'DL'], CB: ['S', 'WR'], S: ['CB', 'LB'], QB: ['RB'], K: ['P'], P: ['K'] };

export function rosterIndex(roster) {
  if (!roster._byId) {
    roster._byId = new Map(roster.players.map((p) => [p.id, p]));
  }
  return roster._byId;
}

function take(roster, pos, idx, used) {
  const byId = rosterIndex(roster);
  const list = roster.depth[pos] || [];
  for (let i = idx; i < list.length; i++) {
    const p = byId.get(list[i]);
    if (p && !used.has(p.id) && !p.injured) return p;
  }
  for (let i = 0; i < idx && i < list.length; i++) {
    const p = byId.get(list[i]);
    if (p && !used.has(p.id) && !p.injured) return p;
  }
  for (const alt of FALLBACK[pos] || []) {
    for (const id of roster.depth[alt] || []) {
      const p = byId.get(id);
      if (p && !used.has(p.id) && !p.injured) return p;
    }
  }
  return roster.players.find((p) => !used.has(p.id));
}

function fill(roster, slots) {
  const used = new Set();
  const out = {};
  for (const slot of slots) {
    const [pos, idx] = SLOT_DEPTH[slot] || ['OL', 0];
    const p = take(roster, pos, idx, used);
    used.add(p.id);
    out[slot] = p;
  }
  return out;
}

export function offenseLineup(roster, formationId) {
  return fill(roster, FORMATIONS[formationId].slots.map((s) => s.slot));
}

export function defenseLineup(roster, frontId) {
  return fill(roster, FRONTS[frontId].slots);
}

export function starter(roster, pos, idx = 0) {
  const byId = rosterIndex(roster);
  return byId.get((roster.depth[pos] || [])[idx]);
}
