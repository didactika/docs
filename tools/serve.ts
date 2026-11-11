/**
 * Serves the site as it will be deployed: it builds it, serves what it built and builds it again when the documentation of a product or
 * the site itself changes. It is what `docker compose up` runs, so what you see there is what Pages publishes (including the search,
 * which only exists in a built site).
 *
 * Every few seconds it synchronises the products (tools/sync.ts, which only writes what changed) and compares a fingerprint of the
 * content and of the code of the site with the one of the last build.
 *
 * @license GPL-3.0-or-later
 */

import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const every = Number(process.env.DOCS_EVERY ?? 5) * 1000;
const port = process.env.PORT ?? '4321';

/** The files that make up the site and are not generated, by path, size and time. */
function codeSignature(): string {
    const hash = createHash('sha256');
    const walk = (folder: string): void => {
        for (const entry of readdirSync(folder, {withFileTypes: true})) {
            const path = join(folder, entry.name);
            const rel = relative(root, path).replaceAll('\\', '/');
            if (/^src\/content\/docs\/[^/]+\/(?:plugins|packages)(?:\/|$)/.test(rel) || rel === 'src/data/products.generated.json') {
                continue;
            }
            if (entry.isDirectory()) {
                walk(path);
            } else {
                const stat = statSync(path);
                hash.update(`${rel}:${stat.size}:${Math.floor(stat.mtimeMs)}\n`);
            }
        }
    };
    walk(join(root, 'src'));
    for (const file of ['astro.config.ts', 'languages.json', 'roadmap.json', 'manifest.json']) {
        if (existsSync(join(root, file))) {
            hash.update(`${file}:${statSync(join(root, file)).mtimeMs}\n`);
        }
    }
    return hash.digest('hex');
}

const run = (script: string, args: string[]): number => spawnSync('node', [join(root, script), ...args], {cwd: root, stdio: 'inherit'}).status ?? 1;

function sync(): void {
    const status = spawnSync('node', [join(root, 'tools', 'sync.ts')], {cwd: root, encoding: 'utf8'});
    // Only a problem is worth the log of a loop that runs every few seconds.
    if (status.status !== 0 || process.env.DOCS_VERBOSE) {
        process.stdout.write(status.stdout + status.stderr);
    }
}

function build(): boolean {
    console.log(`[serve] building the site (${new Date().toLocaleTimeString()})`);
    const result = spawnSync('npx', ['astro', 'build'], {cwd: root, stdio: 'inherit', shell: process.platform === 'win32'});
    console.log(result.status === 0 ? '[serve] built' : '[serve] the build failed; the last good site stays');
    return result.status === 0;
}

const fingerprint = (): string => `${codeSignature()}|${existsSync(join(root, '.cache', 'sync.hash')) ? readFileSync(join(root, '.cache', 'sync.hash'), 'utf8') : ''}`;

run('tools/sync.ts', []);
let built = fingerprint();
build();

spawn('npx', ['astro', 'preview', '--host', '0.0.0.0', '--port', port], {cwd: root, stdio: 'inherit', shell: process.platform === 'win32'});
console.log(`[serve] http://localhost:${port}/  (the documentation is read again every ${every / 1000} s)`);

let building = false;
setInterval(() => {
    if (building) {
        return;
    }
    sync();
    const now = fingerprint();
    if (now !== built) {
        building = true;
        built = now;
        build();
        building = false;
    }
}, every);
