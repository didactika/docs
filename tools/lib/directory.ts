/**
 * Whether a plugin is in the Moodle plugins directory, asked to the same service Moodle itself uses to look for updates:
 *
 *   https://download.moodle.org/api/1.3/pluginfo.php?plugin=<component>&format=json&minversion=0&branch=<X.Y>
 *
 * It answers 200 with the release the directory offers for a branch of Moodle, and 404 when there is none. A plugin is published when any
 * of the branches it supports has a release. When the directory cannot be reached the last answer is kept, and when there is none the
 * answer is "unknown" (null), never a guess.
 *
 * @license GPL-3.0-or-later
 */

export interface DirectoryAnswer {
    published: boolean | null;
    releases: Array<{branch: string; release: string}>;
    /** When the directory was asked, in ISO format. */
    checked: string | null;
}

export type Cache = Record<string, DirectoryAnswer>;

const ENDPOINT = 'https://download.moodle.org/api/1.3/pluginfo.php';

export const directoryPage = (component: string): string => `https://moodle.org/plugins/${component}`;

/** The branches of Moodle to ask for, from the range a line supports (405 and 502 give 4.5 and 5.2). */
export function branchesOf(ranges: Array<{low: number; high: number}>): string[] {
    const name = (code: number): string => `${Math.floor(code / 100)}.${code % 100}`;
    return [...new Set(ranges.flatMap((range) => [name(range.low), name(range.high)]))];
}

/** Asks the directory about one branch: the release, `null` when there is none, and an error when it could not be asked. */
async function ask(component: string, branch: string, fetcher: typeof fetch): Promise<string | null> {
    const url = `${ENDPOINT}?plugin=${encodeURIComponent(component)}&format=json&minversion=0&branch=${branch}`;
    const response = await fetcher(url, {signal: AbortSignal.timeout(10_000)});
    if (response.status === 404) {
        return null;
    }
    if (!response.ok) {
        throw new Error(`The directory answered ${response.status}.`);
    }
    // The release is inside `pluginfo.version`; a plugin that answers without one is still published.
    const body = (await response.json()) as {pluginfo?: {version?: {release?: string}}};
    return body.pluginfo ? (body.pluginfo.version?.release ?? '') : null;
}

/**
 * The answer of the directory for a plugin. `previous` is what was known before and is returned, unchanged, when the directory
 * cannot be reached.
 */
export async function checkDirectory(component: string, branches: string[], previous?: DirectoryAnswer, fetcher: typeof fetch = fetch): Promise<DirectoryAnswer> {
    try {
        const releases: DirectoryAnswer['releases'] = [];
        for (const branch of branches) {
            const release = await ask(component, branch, fetcher);
            if (release !== null) {
                releases.push({branch, release});
            }
        }
        return {published: releases.length > 0, releases, checked: new Date().toISOString()};
    } catch {
        return previous ?? {published: null, releases: [], checked: null};
    }
}
