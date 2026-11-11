/**
 * Checks that every Material icon the site uses exists in the set, before the build finds out one page at a time.
 * Run with `npm run icons`. An icon is any `name-rounded` written in src/ or in the pages of a product.
 *
 * @license GPL-3.0-or-later
 */

import {readdirSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const set = JSON.parse(readFileSync(join(root, 'node_modules', '@iconify-json', 'material-symbols', 'icons.json'), 'utf8')) as {
    icons: Record<string, unknown>;
    aliases?: Record<string, unknown>;
};

function* files(folder: string): Generator<string> {
    for (const entry of readdirSync(folder, {withFileTypes: true})) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) {
            if (!['node_modules', 'content', 'data', 'assets'].includes(entry.name)) {
                yield* files(path);
            }
        } else if (/\.(?:astro|ts|css|mdx?)$/.test(entry.name)) {
            yield path;
        }
    }
}

const missing = new Map<string, string>();
for (const file of files(join(root, 'src'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(/['"]([a-z0-9]+(?:-[a-z0-9]+)*-rounded)['"]/g)) {
        const name = match[1];
        if (!(name in set.icons) && !(set.aliases && name in set.aliases)) {
            missing.set(name, file.slice(root.length + 1));
        }
    }
}

for (const [name, file] of missing) {
    console.error(`missing  ${name}  (${file})`);
}
console.log(missing.size === 0 ? 'Every Material icon exists.' : `${missing.size} icon(s) do not exist.`);
process.exit(missing.size === 0 ? 0 : 1);
