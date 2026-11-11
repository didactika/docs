/**
 * Reads the documentation of one product from a git clone of its repository.
 *
 * A plugin has one line for `main` and one for each `MOODLE_*_STABLE` branch. The id of a line comes from `version.php`: the
 * `$plugin->release` ends in `-m<lowest Moodle version the line supports>` (1.1.1-m405), the rule release.yml already enforces.
 * The files of a line are the ones under `docs/` of its branch. `docs/docs.json`, read from the default branch, describes the
 * product itself.
 *
 * Nothing here decides what is shown: it only reads. The decisions are in resolve.ts.
 *
 * @license GPL-3.0-or-later
 */

import {execFileSync} from 'node:child_process';
import type {Issue, LineInput} from './resolve.ts';

export interface DocsJson {
    kind: 'plugin' | 'package';
    slug: string;
    title: Record<string, string>;
    summary: Record<string, string>;
    /** Corrections to what is deduced about the lines, by line id. */
    lines?: Record<string, {extends?: string | null; label?: string}>;
    directory?: {published?: boolean | 'auto'; url?: string | null};
    translations?: {source?: 'l10n' | 'repo'};
}

export interface SourceLine extends LineInput {
    /** Name of the branch the files come from. */
    branch: string;
    /** `Moodle 4.5 – 5.2`. */
    label: string;
    release: string;
    /** Lowest and highest Moodle version the line supports, as in `$plugin->supported` (405, 502). */
    low: number;
    high: number;
}

export interface SourceProduct {
    docs: DocsJson | null;
    /** The component of Moodle (`local_delegateaccount`), from the `version.php` of the default branch. */
    component: string | null;
    /** The icon of the plugin (`pix/icon.svg` of the default branch), when it has one. */
    iconSvg: string | null;
    /** When the code of the product last changed, in seconds, on any of its lines. 0 when it is not known. */
    updated: number;
    lines: SourceLine[];
    issues: Issue[];
}

const DEFAULT_BRANCH = 'main';
const LINE_BRANCH = /^(?:main|MOODLE_\d+_STABLE)$/;

const git = (repo: string, args: string[], encoding: 'utf8' | 'latin1' = 'utf8'): string =>
    execFileSync('git', ['-C', repo, ...args], {encoding, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});

const tryGit = (repo: string, args: string[], encoding: 'utf8' | 'latin1' = 'utf8'): string | undefined => {
    try {
        return git(repo, args, encoding);
    } catch {
        return undefined;
    }
};

/** `405` becomes `4.5`, `503` becomes `5.3`. */
export const moodleVersion = (code: number): string => `${Math.floor(code / 100)}.${code % 100}`;

/** `Moodle 5.3` for a line that supports one version, `Moodle 4.5 – 5.2` for a range. */
export const lineLabel = (low: number, high: number): string =>
    low === high ? `Moodle ${moodleVersion(low)}` : `Moodle ${moodleVersion(low)} – ${moodleVersion(high)}`;

/** Reads the identity of a line from the `version.php` of its branch. */
/** The component of a plugin, from its `version.php`. */
export const readComponent = (php: string): string | null => /\$plugin->component\s*=\s*['"]([^'"]+)['"]/.exec(php)?.[1] ?? null;

export function readVersionPhp(php: string): {id: string; release: string; low: number; high: number} | undefined {
    const release = /\$plugin->release\s*=\s*['"]([^'"]+)['"]/.exec(php)?.[1];
    const id = release ? /-m(\d+)$/.exec(release)?.[1] : undefined;
    const supported = /\$plugin->supported\s*=\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/.exec(php);
    if (!release || !id || !supported) {
        return undefined;
    }
    return {id: `m${id}`, release, low: Number(supported[1]), high: Number(supported[2])};
}

export interface ReadOptions {
    /** Reads a line from another ref than its own branch, to see what is not merged yet: `{main: 'docs/portal-503'}`. */
    refs?: Record<string, string>;
}

/** Local branches and the ones of `origin`, by branch name; `origin` wins because it is what is published. */
function branches(repo: string, overrides: Record<string, string> = {}): Map<string, string> {
    const refs = git(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes/origin']).split('\n').filter(Boolean);
    const found = new Map<string, string>();
    for (const ref of refs) {
        const remote = /^refs\/remotes\/origin\/(.+)$/.exec(ref);
        const local = /^refs\/heads\/(.+)$/.exec(ref);
        const name = (remote ?? local)?.[1];
        if (name && LINE_BRANCH.test(name) && (remote || !found.has(name))) {
            found.set(name, ref);
        }
    }
    for (const [name, ref] of Object.entries(overrides)) {
        if (!LINE_BRANCH.test(name)) {
            throw new Error(`${name} is not a branch that is a line (main or MOODLE_<version>_STABLE).`);
        }
        if (tryGit(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) === undefined) {
            throw new Error(`${ref}, given for ${name}, is not a ref of ${repo}.`);
        }
        found.set(name, ref);
    }
    return found;
}

/** The files under `docs/` of a ref, by path relative to `docs/`, without `docs.json`. */
function filesOf(repo: string, ref: string): Map<string, string> {
    const files = new Map<string, string>();
    const names = git(repo, ['ls-tree', '-r', '-z', '--name-only', ref, '--', 'docs']).split('\0').filter(Boolean);
    for (const name of names) {
        const path = name.slice('docs/'.length);
        if (path === 'docs.json') {
            continue;
        }
        // Binary files are kept as Latin-1 text, which is lossless, and written back the same way.
        const binary = !/\.(?:md|mdx|svg|txt|json|csv|puml)$/.test(path);
        files.set(path, git(repo, ['show', `${ref}:${name}`], binary ? 'latin1' : 'utf8'));
    }
    return files;
}

/** Reads the product documented by the repository in `repo`. */
export function readProduct(repo: string, options: ReadOptions = {}): SourceProduct {
    const issues: Issue[] = [];
    const found = branches(repo, options.refs);
    const defaultRef = found.get(DEFAULT_BRANCH);
    const docsRaw = defaultRef ? tryGit(repo, ['show', `${defaultRef}:docs/docs.json`]) : undefined;
    const docs = docsRaw ? (JSON.parse(docsRaw) as DocsJson) : null;

    const lines: SourceLine[] = [];
    for (const [branch, ref] of found) {
        const php = tryGit(repo, ['show', `${ref}:version.php`]);
        const identity = php ? readVersionPhp(php) : undefined;
        if (!identity) {
            issues.push({level: 'warning', code: 'no-line', line: branch, path: 'version.php', message: `${branch} has no version.php with a $plugin->release ending in -m<version> and a $plugin->supported range. It is not a line.`});
            continue;
        }
        const twin = lines.find((line) => line.id === identity.id);
        if (twin) {
            issues.push({level: 'error', code: 'duplicate-line', line: branch, path: 'version.php', message: `${branch} and ${twin.branch} are both the line ${identity.id}.`});
            continue;
        }
        lines.push({
            id: identity.id,
            extends: null,
            files: filesOf(repo, ref),
            branch,
            label: docs?.lines?.[identity.id]?.label ?? lineLabel(identity.low, identity.high),
            release: identity.release,
            low: identity.low,
            high: identity.high,
        });
    }

    // The oldest line is the base; each one inherits from the one before it unless docs.json says otherwise.
    lines.sort((a, b) => a.low - b.low || a.high - b.high);
    lines.forEach((line, index) => {
        const declared = docs?.lines?.[line.id];
        line.extends = declared && 'extends' in declared ? (declared.extends ?? null) : index === 0 ? null : lines[index - 1].id;
    });

    const defaultPhp = defaultRef ? tryGit(repo, ['show', `${defaultRef}:version.php`]) : undefined;
    const iconSvg = defaultRef ? (tryGit(repo, ['show', `${defaultRef}:pix/icon.svg`]) ?? null) : null;

    const updated = Math.max(0, ...[...found.values()].map((ref) => Number(tryGit(repo, ['log', '-1', '--format=%ct', ref])?.trim()) || 0));

    return {docs, component: defaultPhp ? readComponent(defaultPhp) : null, iconSvg, updated, lines, issues};
}
