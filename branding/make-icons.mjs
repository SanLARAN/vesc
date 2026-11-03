// Regenerates the PWA icons from the vector source below.
//
//   npm i --no-save sharp && node branding/make-icons.mjs
//
// Writes public/icon.svg (favicon / "any" icon) and branding/icons/*.png.b64 —
// base64 PNGs that vite.config.ts emits into the build as icon-192.png,
// icon-512.png, icon-maskable-512.png and apple-touch-icon.png.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const CX = 256;
const CY = 272;
const R = 150;
const pt = (deg) => {
  const a = (deg * Math.PI) / 180;
  return `${(CX + R * Math.cos(a)).toFixed(2)} ${(CY + R * Math.sin(a)).toFixed(2)}`;
};
const arc = (from, to) => `M ${pt(from)} A ${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${pt(to)}`;
const VALUE_END = 135 + 0.78 * 270;

function svg({ rounded }) {
  const [tx, ty] = pt(VALUE_END).split(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%">
      <stop offset="0" stop-color="#24170c"/>
      <stop offset="0.55" stop-color="#0b0a0a"/>
      <stop offset="1" stop-color="#040506"/>
    </radialGradient>
    <linearGradient id="arc" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#ff6a00"/>
      <stop offset="1" stop-color="#ffb35e"/>
    </linearGradient>
    <filter id="glow" x="-25%" y="-25%" width="150%" height="150%">
      <feGaussianBlur stdDeviation="11"/>
    </filter>
  </defs>
  <rect width="512" height="512"${rounded ? ' rx="112"' : ''} fill="url(#bg)"/>
  ${rounded ? '<rect x="1.5" y="1.5" width="509" height="509" rx="110.5" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="3"/>' : ''}
  <path d="${arc(135, 405)}" fill="none" stroke="#1d2026" stroke-width="28" stroke-linecap="round"/>
  <path d="${arc(135, VALUE_END)}" fill="none" stroke="#ff7a1a" stroke-opacity="0.55" stroke-width="34" stroke-linecap="round" filter="url(#glow)"/>
  <path d="${arc(135, VALUE_END)}" fill="none" stroke="url(#arc)" stroke-width="28" stroke-linecap="round"/>
  <circle cx="${tx}" cy="${ty}" r="7" fill="#fff4e8"/>
  <path d="M276 186 L204 292 H250 L236 358 L308 250 H262 Z" fill="#ff8a2a" fill-opacity="0.35" filter="url(#glow)"/>
  <path d="M276 186 L204 292 H250 L236 358 L308 250 H262 Z" fill="#f6f6f7" stroke="#f6f6f7" stroke-width="6" stroke-linejoin="round"/>
</svg>
`;
}

const root = process.cwd();
const rounded = svg({ rounded: true });
const square = svg({ rounded: false });
writeFileSync(resolve(root, 'public/icon.svg'), rounded);

const png = async (source, size) => (await sharp(Buffer.from(source), { density: 72 * (size / 512) * 2 }).resize(size, size).png({ compressionLevel: 9, palette: true, quality: 92, dither: 0.6 }).toBuffer()).toString('base64');
const out = {
  'icon-192.png': await png(rounded, 192),
  'icon-512.png': await png(rounded, 512),
  'icon-maskable-512.png': await png(square, 512),
  'apple-touch-icon.png': await png(square, 180),
};
mkdirSync(resolve(root, 'branding/icons'), { recursive: true });
for (const [name, b64] of Object.entries(out)) writeFileSync(resolve(root, `branding/icons/${name}.b64`), b64 + '\n');
console.log(Object.entries(out).map(([k, v]) => `${k}: ${Math.round((v.length * 3) / 4 / 1024)} KB`).join('\n'));
