/**
 * Converts the screenshots of a folder to WebP, which weighs a fraction of a PNG and looks the same for a screen of an interface.
 * usage: node tools/to-webp.ts <folder with PNG files> <folder for the WebP files> [name...]
 *
 * @license GPL-3.0-or-later
 */

import {mkdirSync, readdirSync, statSync} from 'node:fs';
import {basename, join, resolve} from 'node:path';
import sharp from 'sharp';

const [from, to, ...only] = process.argv.slice(2);
if (!from || !to) {
    throw new Error('usage: node tools/to-webp.ts <folder with PNG files> <folder for the WebP files> [name...]');
}
mkdirSync(resolve(to), {recursive: true});

let before = 0;
let after = 0;
for (const file of readdirSync(resolve(from)).filter((name) => name.endsWith('.png'))) {
    const name = basename(file, '.png');
    if (only.length > 0 && !only.includes(name)) {
        continue;
    }
    const target = join(resolve(to), `${name}.webp`);
    await sharp(join(resolve(from), file)).webp({quality: 86, effort: 6}).toFile(target);
    before += statSync(join(resolve(from), file)).size;
    after += statSync(target).size;
    console.log(`${name}.webp`);
}
console.log(`${Math.round(before / 1024)} KB of PNG became ${Math.round(after / 1024)} KB of WebP`);
