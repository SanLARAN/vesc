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

// Strict monochrome mark: black square, white square frame, white bolt (FW / electric drive).
// `inset` shrinks the artwork for the maskable icon so it stays well inside the safe zone.
function svg({ inset }) {
  const s = inset ? 0.86 : 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#000000"/>
  <g transform="translate(256 256) scale(${s}) translate(-256 -256)">
    <rect x="119" y="119" width="274" height="274" fill="none" stroke="#ffffff" stroke-width="14"/>
    <path d="M276 170 L204 276 H250 L236 342 L308 234 H262 Z" fill="#ffffff" stroke="#ffffff" stroke-width="6" stroke-linejoin="miter"/>
    <rect x="119" y="119" width="30" height="30" fill="#ff8a2a"/>
  </g>
</svg>
`;
}

const root = process.cwd();
const full = svg({ inset: false });
const safe = svg({ inset: true });
writeFileSync(resolve(root, 'public/icon.svg'), full);

const png = async (source, size) => (await sharp(Buffer.from(source), { density: 72 * (size / 512) * 2 }).resize(size, size).png({ compressionLevel: 9, palette: true, quality: 92, dither: 0.6 }).toBuffer()).toString('base64');
const out = {
  'icon-192.png': await png(full, 192),
  'icon-512.png': await png(full, 512),
  'icon-maskable-512.png': await png(safe, 512),
  'apple-touch-icon.png': await png(full, 180),
};
mkdirSync(resolve(root, 'branding/icons'), { recursive: true });
for (const [name, b64] of Object.entries(out)) writeFileSync(resolve(root, `branding/icons/${name}.b64`), b64 + '\n');
console.log(Object.entries(out).map(([k, v]) => `${k}: ${Math.round((v.length * 3) / 4 / 1024)} KB`).join('\n'));
