// Badges and team marks as crisp pixel-art images.
// Badges are the only way a player's ability is ever shown.

import { TIER_LABEL, STAT_LABEL } from '../game/badges.js';
import { badgeURL, teamMarkURL, BADGE_W, BADGE_H, MARK_W, MARK_H } from './pixelart.js';

export function injectDefs() {
  // Kept for compatibility; pixel emblems need no shared SVG defs.
}

// size: approximate CSS width; snapped to a whole-number pixel scale.
export function badgeSVG(tier, stat, size = 26) {
  const k = Math.max(1, Math.round(size / BADGE_W));
  const label = `${STAT_LABEL[stat] || stat}: ${TIER_LABEL[tier] || tier}`;
  return `<img class="px badge badge-${tier}" src="${badgeURL(tier, stat)}" width="${BADGE_W * k}" height="${BADGE_H * k}" alt="${label}" title="${label}">`;
}

export function badgeRow(p, size = 26) {
  return ['speed', 'strength', 'skill'].map((st) => badgeSVG(p.badges[st], st, size)).join('');
}

// Team logo: the real pixel logo when the asset pack is loaded (16/32/64 px
// art shown at its native size), otherwise the generated monogram.
export function teamMarkSVG(team, size = 44) {
  if (team.art) {
    const n = size >= 52 ? 64 : size >= 22 ? 32 : 16;
    return `<img class="px mark logo${team.logoDark ? ' logo-dark' : ''}" src="assets/teams/${team.id}/logo_${n}.png" width="${n}" height="${n}" alt="${team.city} ${team.name}">`;
  }
  const k = Math.max(1, Math.round(size / MARK_W));
  return `<img class="px mark" src="${teamMarkURL(team)}" width="${MARK_W * k}" height="${MARK_H * k}" alt="${team.city} ${team.name}">`;
}
