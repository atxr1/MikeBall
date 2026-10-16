// Renders the app icons from an SVG. Usage: node tools/make-icons.mjs
// (needs `sharp`; only run by developers, never by the game itself)

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch {
  sharp = require('/opt/npm-tools/node_modules/sharp');
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0e1a2b"/>
  <g opacity="0.35" stroke="#ffffff" stroke-width="6">
    <line x1="0" y1="96" x2="512" y2="96"/><line x1="0" y1="416" x2="512" y2="416"/>
  </g>
  <rect x="0" y="300" width="512" height="18" fill="#ffd23f"/>
  <rect x="0" y="352" width="512" height="10" fill="#3d8bff"/>
  <g transform="translate(256 210) rotate(-32)">
    <ellipse rx="150" ry="88" fill="#8a4720"/>
    <ellipse rx="150" ry="88" fill="none" stroke="#5e2f12" stroke-width="10"/>
    <path d="M-112 -34 C-80 -60 -40 -70 0 -70" stroke="#f5efe6" stroke-width="12" fill="none" stroke-linecap="round" opacity="0"/>
    <line x1="-62" y1="0" x2="62" y2="0" stroke="#f5efe6" stroke-width="12" stroke-linecap="round"/>
    <g stroke="#f5efe6" stroke-width="10" stroke-linecap="round">
      <line x1="-40" y1="-16" x2="-40" y2="16"/><line x1="-14" y1="-16" x2="-14" y2="16"/>
      <line x1="14" y1="-16" x2="14" y2="16"/><line x1="40" y1="-16" x2="40" y2="16"/>
    </g>
  </g>
</svg>`;

mkdirSync('icons', { recursive: true });
const buf = Buffer.from(svg);
await sharp(buf).resize(512, 512).png().toFile('icons/icon-512.png');
await sharp(buf).resize(192, 192).png().toFile('icons/icon-192.png');
await sharp(buf).resize(180, 180).png().toFile('icons/apple-touch-icon.png');
console.log('icons written');
