// Shared math helpers and field constants (yards).

export const FIELD_W = 160 / 3; // 53.33 yd sideline to sideline
export const HASH_L = 23.583; // NFL hash marks: 70'9" from each sideline
export const HASH_R = FIELD_W - HASH_L;
export const MID_X = FIELD_W / 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const sign = (v) => (v < 0 ? -1 : 1);
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const easeOut = (t) => 1 - (1 - t) * (1 - t);

export function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ordinal(n) {
  return ['', '1st', '2nd', '3rd', '4th'][n] || `${n}th`;
}

// Field position label from the offense's perspective. ballOn: 0 = own goal
// line, 100 = opponent goal line.
export function fieldLabel(ballOn, ownAbbr, oppAbbr) {
  const b = Math.round(ballOn);
  if (b === 50) return 'MID';
  return b < 50 ? `${ownAbbr} ${b}` : `${oppAbbr} ${100 - b}`;
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// Relative luminance, used to pick readable text on team colors.
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastText(hex) {
  return luminance(hex) > 0.45 ? '#0b0f17' : '#ffffff';
}

export function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const f = (v) => clamp(Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt), 0, 255);
  return `#${[f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
