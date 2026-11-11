/**
 * Draws the icon of Didactika Docs and every file that derives from it, in public/brand/.
 *
 * It is in the family of the icon of the design system: a rounded square, the open book of Didactika and a teal pill in the corner that
 * names what the site is ("UI" there, "DOC" here). Here the book stands on a page with a folded corner and lines of text, which is what
 * documentation looks like. The letters are drawn with strokes, not with a font, so the icon looks the same wherever it is rendered.
 *
 * Two drawings: the full icon for sizes where its details read (the Apple and Android icons), and a compact one for the tab of a
 * browser, where only the book on a teal tile survives at 16 pixels.
 *
 * Needs sharp. Run with `npm run brand` after changing the logo or the drawing.
 *
 * @license GPL-3.0-or-later
 */

import {readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const brand = join(root, 'public', 'brand');
const logo = `data:image/png;base64,${readFileSync(join(brand, 'didactika-logo.png')).toString('base64')}`;

const TEAL = '#0f766e';
const DEEP = '#00555a';

/** The book of Didactika, drawn in white by turning every colour of the logo into white and keeping its transparency. */
const whiteLogo = (x: number, y: number, size: number): string => `
  <defs><filter id="white" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0"/></filter></defs>
  <image href="${logo}" x="${x}" y="${y}" width="${size}" height="${size}" filter="url(#white)"/>`;

/** The full icon: the book on a page, and the pill that says DOC. */
const full = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect x="16" y="16" width="480" height="480" rx="120" fill="#fff"/>
  <rect x="16" y="16" width="480" height="480" rx="120" fill="none" stroke="${DEEP}" stroke-opacity=".14" stroke-width="8"/>
  <!-- The page, with its folded corner. -->
  <path d="M120 56 H328 L392 120 V456 H120 Z" fill="#f0fdfa" stroke="${DEEP}" stroke-width="12" stroke-linejoin="round"/>
  <path d="M328 56 V120 H392" fill="none" stroke="${DEEP}" stroke-width="12" stroke-linejoin="round" stroke-linecap="round"/>
  <!-- Lines of text. -->
  <rect x="160" y="136" width="128" height="16" rx="8" fill="${TEAL}"/>
  <rect x="160" y="168" width="196" height="16" rx="8" fill="${TEAL}" fill-opacity=".45"/>
  <image href="${logo}" x="140" y="196" width="232" height="232"/>
  <!-- The pill, with DOC drawn in strokes. -->
  <rect x="264" y="368" width="224" height="116" rx="58" fill="${TEAL}"/>
  <g fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">
    <path d="M312 404 V452 H325 A24 24 0 0 0 325 404 Z"/>
    <ellipse cx="383" cy="428" rx="19" ry="24"/>
    <path d="M444 411 A19 24 0 1 0 444 445"/>
  </g>
</svg>
`;

/** The compact icon: the white book on a teal tile, for the tab of a browser. */
const compact = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs><linearGradient id="tile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${TEAL}"/><stop offset="1" stop-color="${DEEP}"/></linearGradient></defs>
  <rect x="16" y="16" width="480" height="480" rx="120" fill="url(#tile)"/>
  ${whiteLogo(56, 56, 400)}
</svg>
`;

writeFileSync(join(brand, 'docs-icon.svg'), full);
writeFileSync(join(brand, 'favicon.svg'), compact);
writeFileSync(join(root, 'public', 'favicon.svg'), compact);

const png = (svg: string, size: number): Promise<Buffer> => sharp(Buffer.from(svg), {density: 384}).resize(size, size).png().toBuffer();

/** An .ico that holds PNG images, which every browser reads. */
function ico(images: Array<{size: number; data: Buffer}>): Buffer {
    const head = Buffer.alloc(6);
    head.writeUInt16LE(1, 2);
    head.writeUInt16LE(images.length, 4);
    const entries = Buffer.alloc(16 * images.length);
    let offset = head.length + entries.length;
    images.forEach(({size, data}, index) => {
        entries.writeUInt8(size, index * 16);
        entries.writeUInt8(size, index * 16 + 1);
        entries.writeUInt16LE(1, index * 16 + 4);
        entries.writeUInt16LE(32, index * 16 + 6);
        entries.writeUInt32LE(data.length, index * 16 + 8);
        entries.writeUInt32LE(offset, index * 16 + 12);
        offset += data.length;
    });
    return Buffer.concat([head, entries, ...images.map((image) => image.data)]);
}

const small = await Promise.all([16, 32, 48].map(async (size) => ({size, data: await png(compact, size)})));
writeFileSync(join(brand, 'favicon-16x16.png'), small[0].data);
writeFileSync(join(brand, 'favicon-32x32.png'), small[1].data);
writeFileSync(join(brand, 'favicon.ico'), ico(small));
writeFileSync(join(root, 'public', 'favicon.ico'), ico(small));
writeFileSync(join(root, 'public', 'favicon-16x16.png'), small[0].data);
writeFileSync(join(root, 'public', 'favicon-32x32.png'), small[1].data);

writeFileSync(join(brand, 'apple-touch-icon.png'), await png(full, 180));
writeFileSync(join(root, 'public', 'apple-touch-icon.png'), await png(full, 180));
writeFileSync(join(brand, 'android-chrome-192x192.png'), await png(full, 192));
writeFileSync(join(brand, 'android-chrome-512x512.png'), await png(full, 512));
console.log('brand: docs-icon.svg, favicon.svg, favicon.ico, favicon-16x16.png, favicon-32x32.png, apple-touch-icon.png, android-chrome-192x192.png, android-chrome-512x512.png');
