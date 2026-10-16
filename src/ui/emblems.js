// Badge emblems and team marks, drawn as inline SVG.
// Badges are the only way a player's ability is ever shown.

import { TIER_LABEL, STAT_LABEL } from '../game/badges.js';
import { contrastText } from '../core/util.js';

const SHIELD = 'M20 2.5 L36.5 8.4 V21.6 C36.5 31.4 29.4 38.4 20 41.6 C10.6 38.4 3.5 31.4 3.5 21.6 V8.4 Z';
const INNER = 'M20 6.2 L33.2 10.9 V21.8 C33.2 29.6 27.6 35.3 20 38 C12.4 35.3 6.8 29.6 6.8 21.8 V10.9 Z';

const GLYPH = {
  speed: '<path d="M12.5 15.5 L19 22 L12.5 28.5 M20.5 15.5 L27 22 L20.5 28.5" fill="none" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>',
  strength: '<path d="M12 22 H28 M14.4 17 V27 M25.6 17 V27 M10.6 19.2 V24.8 M29.4 19.2 V24.8" fill="none" stroke-width="3.2" stroke-linecap="round"/>',
  skill: '<circle cx="20" cy="22" r="7.2" fill="none" stroke-width="2.6"/><circle cx="20" cy="22" r="2.6" stroke="none"/><path d="M20 11.6 V14.2 M20 29.8 V32.4 M9.6 22 H12.2 M27.8 22 H30.4" stroke-width="2.2" stroke-linecap="round"/>',
};

const STYLE = {
  bronze: { fill: 'url(#mb-bronze)', rim: '#4a2810', inner: 'rgba(255,214,170,0.35)', glyph: '#fff1e0', shadow: '#5b300f' },
  silver: { fill: 'url(#mb-silver)', rim: '#4e5660', inner: 'rgba(255,255,255,0.65)', glyph: '#2c343d', shadow: null },
  gold: { fill: 'url(#mb-gold)', rim: '#6a4706', inner: 'rgba(255,248,200,0.6)', glyph: '#553800', shadow: null },
  diamond: { fill: 'url(#mb-diamond)', rim: '#d9f2ff', inner: 'rgba(255,255,255,0.55)', glyph: '#ffffff', shadow: '#1f5fb8' },
  master: { fill: 'url(#mb-master)', rim: 'url(#mb-master-rim)', inner: 'rgba(160,168,180,0.35)', glyph: '#d3d8e0', shadow: '#000000' },
  franchise: { fill: 'url(#mb-franchise)', rim: '#c04dff', inner: '#ff2e4d', glyph: '#ffffff', shadow: '#5c0018' },
};

// One shared <defs> block so every badge can reference the same gradients.
export function injectDefs() {
  if (document.getElementById('mb-defs')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `<svg id="mb-defs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
    <linearGradient id="mb-bronze" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#f6c08e"/><stop offset="0.5" stop-color="#b8692f"/><stop offset="1" stop-color="#6b3a17"/></linearGradient>
    <linearGradient id="mb-silver" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#c9d1d9"/><stop offset="1" stop-color="#7d8893"/></linearGradient>
    <linearGradient id="mb-gold" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#fff4b5"/><stop offset="0.45" stop-color="#f2c230"/><stop offset="1" stop-color="#a86f0c"/></linearGradient>
    <linearGradient id="mb-diamond" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="rgba(214,244,255,0.85)"/><stop offset="0.5" stop-color="rgba(96,186,255,0.62)"/><stop offset="1" stop-color="rgba(28,96,214,0.82)"/></linearGradient>
    <linearGradient id="mb-master" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#555a64"/><stop offset="0.5" stop-color="#1a1c22"/><stop offset="1" stop-color="#050608"/></linearGradient>
    <linearGradient id="mb-master-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e2e6ec"/><stop offset="0.5" stop-color="#6b7280"/><stop offset="1" stop-color="#c3c8d0"/></linearGradient>
    <linearGradient id="mb-franchise" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff1e3c"/><stop offset="0.38" stop-color="#8b0020"/><stop offset="0.72" stop-color="#3d0066"/><stop offset="1" stop-color="#8a2bff"/></linearGradient>
    <linearGradient id="mb-shine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgba(255,255,255,0)"/><stop offset="0.5" stop-color="rgba(255,255,255,0.55)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></linearGradient>
    <clipPath id="mb-clip"><path d="${SHIELD}"/></clipPath>
  </defs></svg>`;
  document.body.prepend(wrap.firstChild);
}

export function badgeSVG(tier, stat, size = 30) {
  const s = STYLE[tier] || STYLE.bronze;
  const glyph = GLYPH[stat] || GLYPH.skill;
  const shadow = s.shadow ? `<g transform="translate(0 1.1)" stroke="${s.shadow}" fill="${s.shadow}" opacity="0.55">${glyph}</g>` : '';
  let extra = '';
  if (tier === 'diamond') {
    extra = '<path d="M20 6.2 L26 20 L20 38 M20 6.2 L14 20 L20 38 M6.8 14 L33.2 14" stroke="rgba(255,255,255,0.45)" stroke-width="0.8" fill="none"/>';
  } else if (tier === 'master') {
    extra = '<path d="M6.8 12 L33.2 30 M33.2 12 L6.8 30" stroke="rgba(255,255,255,0.06)" stroke-width="5"/>';
  } else if (tier === 'franchise') {
    extra = '<g clip-path="url(#mb-clip)"><rect class="mb-shine" x="-30" y="0" width="22" height="44" fill="url(#mb-shine)" transform="skewX(-18)"/></g>'
      + '<path d="M20 0.4 L22.2 4.2 L20 3.3 L17.8 4.2 Z" fill="#ffd0d8"/>';
  }
  const rimW = tier === 'franchise' ? 2.6 : 2;
  const innerStroke = tier === 'franchise' ? `<path d="${INNER}" fill="none" stroke="${s.inner}" stroke-width="1.4"/>` : `<path d="${INNER}" fill="none" stroke="${s.inner}" stroke-width="1"/>`;
  const label = `${STAT_LABEL[stat] || stat}: ${TIER_LABEL[tier] || tier}`;
  return `<svg class="badge badge-${tier}" viewBox="0 0 40 44" width="${size}" height="${Math.round(size * 1.1)}" role="img" aria-label="${label}"><title>${label}</title>
    <path d="${SHIELD}" fill="${s.fill}" stroke="${s.rim}" stroke-width="${rimW}" stroke-linejoin="round"/>
    ${innerStroke}${extra}
    ${shadow}<g stroke="${s.glyph}" fill="${s.glyph}">${glyph}</g>
  </svg>`;
}

export function badgeRow(p, size = 26) {
  return ['speed', 'strength', 'skill'].map((st) => badgeSVG(p.badges[st], st, size)).join('');
}

export function teamMarkSVG(team, size = 40) {
  const c = team.colors;
  const fg = c.secondary.toUpperCase() === c.primary.toUpperCase() ? contrastText(c.primary) : c.secondary;
  const txt = contrastText(c.primary) === '#ffffff' && luminanceDiff(c.primary, fg) < 0.2 ? '#ffffff' : fg;
  const fs = team.abbr.length >= 3 ? 15 : 18;
  return `<svg class="mark" viewBox="0 0 40 40" width="${size}" height="${size}" role="img" aria-label="${team.city} ${team.name}">
    <rect x="1.5" y="1.5" width="37" height="37" rx="10" fill="${c.primary}" stroke="${fg}" stroke-width="2.4"/>
    <path d="M6 30 L34 30" stroke="${fg}" stroke-width="1.6" opacity="0.6"/>
    <text x="20" y="25.5" text-anchor="middle" font-family="'Big Shoulders Display', system-ui, sans-serif" font-weight="900" font-size="${fs}" fill="${txt}">${team.abbr}</text>
  </svg>`;
}

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
}

function luminanceDiff(a, b) {
  return Math.abs(lum(a) - lum(b));
}
