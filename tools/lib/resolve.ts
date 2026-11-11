/**
 * Resolution of the documentation of one product: which file shows each page in each version (line) and each language.
 *
 * A pure function: it receives the files of every line and the registry of languages and returns the resolved pages and
 * the issues found. It reads no disk and no repository, so it is tested with plain data (resolve.test.ts) and the same
 * code runs in the sync tool and in the validation of a plugin.
 *
 * The rules are the ones of docs/plans/docs-multiidioma-y-versiones.md:
 *
 * - A line inherits everything from the line it extends. The file of a page is the one of the most recent line of the chain
 *   that has it: the same path replaces, a new path adds, and a file with `hidden: true` removes the page from that line on.
 * - English is the source language. A translation is shown only when it is not older than the English file it translates;
 *   otherwise the English file is shown with a notice. A language may name a fallback language to try before English.
 * - Languages marked `required` must have every page, and an outdated translation counts as missing.
 *
 * @license GPL-3.0-or-later
 */

import {parse as parseYaml} from 'yaml';

/** The files of a line under `docs/`, by path relative to it (`en/guides/install.md`, `_assets/shot.png`). */
export type Tree = ReadonlyMap<string, string>;

export interface LineInput {
    /** Identifier of the line, e.g. `m405`. */
    id: string;
    /** Line it inherits from, or null for the base line. */
    extends: string | null;
    files: Tree;
}

export interface LanguageDef {
    code: string;
    /** The language every page is written in first. Exactly one. */
    source?: boolean;
    /** Every page must exist and be up to date in this language. */
    required?: boolean;
    /** Language to try before the source language, e.g. `pt` for `pt_br`. */
    fallback?: string;
}

export type Level = 'error' | 'warning';

export interface Issue {
    level: Level;
    code: string;
    line: string;
    path: string;
    message: string;
}

export interface PageFile {
    lang: string;
    /** Path of the page without language and extension, e.g. `guides/install`. */
    id: string;
    ext: '.md' | '.mdx';
    /** Line the file belongs to. */
    line: string;
    /** Path relative to `docs/`. */
    path: string;
    content: string;
    data: Record<string, unknown>;
}

export type PageStatus = 'source' | 'translated' | 'missing' | 'outdated';

export interface ResolvedPage {
    id: string;
    /** The language that was asked for. */
    lang: string;
    status: PageStatus;
    /** The file whose content is shown. */
    shown: PageFile;
    /** The source-language file the page is based on. */
    source: PageFile;
    /** Where the source page stands in this line. */
    provenance: 'added' | 'modified' | 'inherited';
    /** Line that holds the file of the source page. */
    provenanceFrom: string;
}

export interface ResolvedLine {
    id: string;
    /** Lines it inherits from, base first, ending in itself. */
    chain: string[];
    pages: ResolvedPage[];
    /** Pages removed in this line, by id. */
    hidden: string[];
    /** Language-independent files (`_assets/`), by path, with the line each comes from. */
    assets: Map<string, {line: string; content: string}>;
    /** Share of the pages that are shown in the language itself, by language code, from 0 to 1. */
    coverage: Record<string, number>;
}

export interface Resolution {
    lines: ResolvedLine[];
    issues: Issue[];
}

const PAGE = /^([A-Za-z][A-Za-z0-9_-]*)\/(.+)(\.mdx?)$/;
const ASSETS = '_assets/';
/** What may sit next to a page inside a language folder: its diagrams, images and tables. */
const MEDIA = /^[A-Za-z][A-Za-z0-9_-]*\/.+\.(?:svg|png|webp|jpe?g|gif|csv|puml)$/;

/** Reads the front matter of a page. */
export function parseFrontmatter(raw: string): {data: Record<string, unknown>; body: string; error?: string} {
    const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
    const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
    if (!match) {
        return {data: {}, body: text};
    }
    const body = text.slice(match[0].length);
    try {
        const data = parseYaml(match[1]);
        return {data: data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}, body};
    } catch (error) {
        // A front matter that is not valid YAML gives no data; the caller reports why.
        return {data: {}, body, error: (error instanceof Error ? error.message : String(error)).split('\n')[0]};
    }
}

const normalise = (content: string): string => content.replace(/^﻿/, '').replace(/\r\n/g, '\n').trimEnd();

/** Orders the lines so every one comes after the line it extends, and checks the chain. */
function chainsOf(lines: LineInput[], issues: Issue[]): Map<string, string[]> {
    const byId = new Map(lines.map((line) => [line.id, line]));
    const chains = new Map<string, string[]>();
    for (const line of lines) {
        const chain: string[] = [];
        const seen = new Set<string>();
        let current: LineInput | undefined = line;
        let broken = false;
        while (current) {
            if (seen.has(current.id)) {
                issues.push({level: 'error', code: 'line-cycle', line: line.id, path: '', message: `The line ${line.id} inherits from itself through ${current.id}.`});
                broken = true;
                break;
            }
            seen.add(current.id);
            chain.unshift(current.id);
            if (current.extends === null) {
                break;
            }
            const parent = byId.get(current.extends);
            if (!parent) {
                issues.push({level: 'error', code: 'unknown-line', line: line.id, path: '', message: `The line ${current.id} extends ${current.extends}, which does not exist.`});
                broken = true;
                break;
            }
            current = parent;
        }
        chains.set(line.id, broken ? [line.id] : chain);
    }
    return chains;
}

/** Resolves every line of a product. */
export function resolveProduct(lines: LineInput[], languages: LanguageDef[]): Resolution {
    const issues: Issue[] = [];
    const sources = languages.filter((language) => language.source);
    if (sources.length !== 1) {
        throw new Error(`Exactly one language must be the source, found ${sources.length}.`);
    }
    const source = sources[0].code;
    const known = new Map(languages.map((language) => [language.code, language]));

    // The pages of each line, by `lang/id`.
    const pagesOf = new Map<string, Map<string, PageFile>>();
    const assetsOf = new Map<string, Map<string, string>>();
    for (const line of lines) {
        const pages = new Map<string, PageFile>();
        const assets = new Map<string, string>();
        for (const [path, content] of line.files) {
            if (path.startsWith(ASSETS)) {
                assets.set(path, content);
                continue;
            }
            const match = PAGE.exec(path);
            if (!match) {
                // The diagrams and tables that a page of the technical documentation shows sit next to it.
                if (MEDIA.test(path)) {
                    assets.set(path, content);
                }
                continue;
            }
            const [, lang, rawId, ext] = match;
            // The README of a folder is its index, as on GitHub.
            const id = rawId.replace(/(^|\/)README$/, '$1index');
            if (!known.has(lang)) {
                issues.push({level: 'warning', code: 'unknown-language', line: line.id, path, message: `${path} is in the language ${lang}, which is not in the registry of languages. It is ignored.`});
                continue;
            }
            const key = `${lang}/${id}`;
            if (pages.has(key)) {
                issues.push({level: 'error', code: 'duplicate-page', line: line.id, path, message: `${key} exists as .md and .mdx in the same line.`});
                continue;
            }
            const parsed = parseFrontmatter(content);
            if (parsed.error) {
                issues.push({level: 'error', code: 'invalid-frontmatter', line: line.id, path, message: `The front matter of ${path} is not valid YAML: ${parsed.error} A value with a colon must be in quotes.`});
            }
            pages.set(key, {lang, id, ext: ext as '.md' | '.mdx', line: line.id, path, content, data: parsed.data});
        }
        pagesOf.set(line.id, pages);
        assetsOf.set(line.id, assets);
    }

    const chains = chainsOf(lines, issues);
    const resolved: ResolvedLine[] = [];

    for (const line of lines) {
        const chain = chains.get(line.id)!;
        const indexOf = new Map(chain.map((id, index) => [id, index]));

        /** The file of the most recent line of the chain that has `lang/id`, optionally stopping before a line. */
        const latest = (lang: string, id: string, before: number = chain.length): PageFile | undefined => {
            for (let i = Math.min(before, chain.length) - 1; i >= 0; i--) {
                const file = pagesOf.get(chain[i])?.get(`${lang}/${id}`);
                if (file) {
                    return file;
                }
            }
            return undefined;
        };

        const ids = new Set<string>();
        const otherIds = new Set<string>();
        for (const lineId of chain) {
            for (const file of pagesOf.get(lineId)!.values()) {
                (file.lang === source ? ids : otherIds).add(file.id);
            }
        }

        for (const id of otherIds) {
            if (!ids.has(id)) {
                for (const file of pagesOf.get(line.id)!.values()) {
                    if (file.id === id && file.line === line.id) {
                        issues.push({level: 'error', code: 'orphan-translation', line: line.id, path: file.path, message: `${file.path} has no page in ${source}. The ${source} page is the source of every page.`});
                    }
                }
            }
        }

        const hidden: string[] = [];
        const pages: ResolvedPage[] = [];
        for (const id of [...ids].sort()) {
            const sourceFile = latest(source, id)!;
            if (sourceFile.data.hidden === true) {
                hidden.push(id);
                if (!sourceFile.data.reason && sourceFile.line === line.id) {
                    issues.push({level: 'error', code: 'hidden-without-reason', line: line.id, path: sourceFile.path, message: `${sourceFile.path} hides a page and gives no reason.`});
                }
                continue;
            }
            const sourceIndex = indexOf.get(sourceFile.line)!;
            const earlier = latest(source, id, sourceIndex);
            // A page that an earlier line hid and this line brings back did not exist before: it is added, not modified.
            const provenance: ResolvedPage['provenance'] = sourceFile.line !== line.id ? 'inherited' : earlier && earlier.data.hidden !== true ? 'modified' : 'added';

            for (const language of languages) {
                if (language.code === source) {
                    pages.push({id, lang: source, status: 'source', shown: sourceFile, source: sourceFile, provenance, provenanceFrom: sourceFile.line});
                    continue;
                }
                // Try the language itself and then its fallbacks, before the source language.
                const order: string[] = [];
                for (let code: string | undefined = language.code; code && code !== source && !order.includes(code); code = known.get(code)?.fallback) {
                    order.push(code);
                }
                let shown: PageFile | undefined;
                let outdated = false;
                for (const code of order) {
                    const file = latest(code, id);
                    if (!file) {
                        continue;
                    }
                    if (file.data.hidden === true) {
                        issues.push({level: 'warning', code: 'hidden-in-translation', line: line.id, path: file.path, message: `${file.path} is marked hidden. Pages are hidden in the ${source} file only.`});
                        continue;
                    }
                    if (indexOf.get(file.line)! >= sourceIndex) {
                        shown = file;
                        break;
                    }
                    outdated = true;
                }
                const status: PageStatus = shown ? 'translated' : outdated ? 'outdated' : 'missing';
                pages.push({id, lang: language.code, status, shown: shown ?? sourceFile, source: sourceFile, provenance, provenanceFrom: sourceFile.line});
                if (language.required && !shown) {
                    issues.push({
                        level: 'error',
                        code: outdated ? 'outdated-translation' : 'missing-translation',
                        line: line.id,
                        path: `${language.code}/${id}`,
                        message: outdated
                            ? `${language.code}/${id} is older than the ${source} page of ${sourceFile.line}. ${language.code} is required.`
                            : `${language.code}/${id} does not exist. ${language.code} is required.`,
                    });
                }
            }
        }

        // Files of this line that say what the line would inherit anyway.
        for (const file of pagesOf.get(line.id)!.values()) {
            const before = indexOf.get(line.id)!;
            const inherited = latest(file.lang, file.id, before);
            if (inherited && file.data.hidden !== true && inherited.data.hidden !== true && normalise(inherited.content) === normalise(file.content)) {
                issues.push({level: 'warning', code: 'redundant-override', line: line.id, path: file.path, message: `${file.path} is identical to the one of ${inherited.line}. Delete it to inherit it.`});
            }
        }

        const assets = new Map<string, {line: string; content: string}>();
        for (const lineId of chain) {
            for (const [path, content] of assetsOf.get(lineId)!) {
                assets.set(path, {line: lineId, content});
            }
        }

        const coverage: Record<string, number> = {};
        for (const language of languages) {
            const own = pages.filter((page) => page.lang === language.code);
            coverage[language.code] = own.length === 0 ? 1 : own.filter((page) => page.status === 'source' || page.status === 'translated').length / own.length;
        }

        resolved.push({id: line.id, chain, pages, hidden, assets, coverage});
    }

    return {lines: resolved, issues};
}
