// Badge tiers. Players only ever show these, never numbers.
//
// Each stat (speed, strength, skill) is ranked within the player's position
// group across the whole league. Franchise Altering goes only to the top 6
// players league-wide per stat, measured by how far above their position's
// average they are (z-score).

import { skillOf } from '../data/roster.js';

export const TIERS = ['bronze', 'silver', 'gold', 'diamond', 'master', 'franchise'];

export const TIER_LABEL = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  diamond: 'Diamond',
  master: 'Master',
  franchise: 'Franchise Altering',
};

export const STATS = ['speed', 'strength', 'skill'];
export const STAT_LABEL = { speed: 'Speed', strength: 'Strength', skill: 'Skill' };

// Percentile cut points (ascending) for bronze → master.
const CUTS = [0.4, 0.67, 0.87, 0.96]; // <40% bronze, <67% silver, <87% gold, <96% diamond, else master
export const FRANCHISE_PER_STAT = 6;

const GROUP = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', OL: 'OL', DL: 'DL', LB: 'LB', CB: 'CB', S: 'S', K: 'K', P: 'P' };

export function statValue(p, stat) {
  const a = p.attrs;
  if (stat === 'speed') return a.spd * 0.8 + a.acc * 0.2;
  if (stat === 'strength') return a.str;
  return skillOf(p);
}

export function tierFromPercentile(pct) {
  for (let i = 0; i < CUTS.length; i++) if (pct < CUTS[i]) return TIERS[i];
  return 'master';
}

// players: every player in the league. Writes p.badges = {speed, strength, skill}.
export function computeBadges(players) {
  const groups = {};
  for (const p of players) (groups[GROUP[p.pos]] ||= []).push(p);
  for (const p of players) p.badges = {};

  for (const stat of STATS) {
    const z = new Map();
    for (const g of Object.values(groups)) {
      const vals = g.map((p) => statValue(p, stat));
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length) || 1;
      const sorted = [...g].sort((a, b) => statValue(a, stat) - statValue(b, stat));
      sorted.forEach((p, i) => {
        const pct = sorted.length > 1 ? i / (sorted.length - 1) : 0.5;
        p.badges[stat] = tierFromPercentile(pct);
        z.set(p, (statValue(p, stat) - mean) / sd);
      });
    }
    // Kickers and punters can't take Franchise Altering speed/strength.
    const pool = players.filter((p) => stat === 'skill' || (p.pos !== 'K' && p.pos !== 'P'));
    pool.sort((a, b) => z.get(b) - z.get(a));
    for (let i = 0; i < Math.min(FRANCHISE_PER_STAT, pool.length); i++) pool[i].badges[stat] = 'franchise';
  }
}

export function tierIndex(tier) {
  return TIERS.indexOf(tier);
}
