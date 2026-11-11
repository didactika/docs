/**
 * Brings the documentation of every product of manifest.json into the site.
 *
 * For each product it reads its repository (lib/source.ts), resolves every version and language (lib/resolve.ts) and writes the
 * pages Starlight builds:
 *
 *   src/content/docs/<language>/<plugins|packages>/<slug>/<line>/<page>   one tree for each version
 *   src/content/docs/<language>/<plugins|packages>/<slug>/<page>           the same as the newest version, the address without a version
 *   src/data/products.generated.json                                      what the components of the site need to know
 *
 * Everything it writes is generated and ignored by git; the pages are never edited here.
 *
 * Environment:
 *   DOCS_SOURCES   folder that holds a clone of each repository, named like it. Default: .cache/sources, cloned from GitHub.
 *   DOCS_NO_FETCH  use the clones as they are, without fetching.
 *   DOCS_MANIFEST  another manifest than manifest.json, for trying the site with a repository of examples.
 *
 * @license GPL-3.0-or-later
 */

import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {stringify} from 'yaml';
import {parseFrontmatter, resolveProduct, type Issue, type LanguageDef} from './lib/resolve.ts';
import {readProduct, type DocsJson} from './lib/source.ts';

interface Language extends LanguageDef {
    name: string;
    dir?: 'ltr' | 'rtl';
    enabled: boolean;
}

interface ManifestProduct {
    repo: string;
    kind: 'plugin' | 'package';
}

const root = resolve(import.meta.dirname, '..');
const sources = process.env.DOCS_SOURCES ? resolve(process.env.DOCS_SOURCES) : join(root, '.cache', 'sources');
const content = join(root, 'src', 'content', 'docs');
const KIND_DIR = {plugin: 'plugins', package: 'packages'} as const;

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const languages = readJson<Language[]>(join(root, 'languages.json')).filter((language) => language.enabled);
const manifest = readJson<{products: ManifestProduct[]}>(process.env.DOCS_MANIFEST ? resolve(process.env.DOCS_MANIFEST) : join(root, 'manifest.json'));

/** A text of the interface in a language; what that language does not have is taken from the source language. */
const sourceCode = languages.find((language) => language.source)!.code;
const dictionary = (code: string): Record<string, string> => {
    const path = join(root, 'src', 'i18n', `${code}.json`);
    return existsSync(path) ? readJson<Record<string, string>>(path) : {};
};
const ui = (code: string, key: string, values: Record<string, string> = {}): string => {
    const text = dictionary(code)[key] ?? dictionary(sourceCode)[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');
};

const localised = (texts: Record<string, string> | undefined, code: string, fallback: string): string => texts?.[code] ?? texts?.[sourceCode] ?? fallback;

function sourceOf(repo: string): string {
    const name = repo.split('/')[1];
    const folder = join(sources, name);
    if (!existsSync(folder)) {
        mkdirSync(sources, {recursive: true});
        execFileSync('git', ['clone', '--quiet', `https://github.com/${repo}.git`, folder], {stdio: 'inherit'});
    } else if (!process.env.DOCS_NO_FETCH) {
        execFileSync('git', ['-C', folder, 'fetch', '--quiet', '--all', '--prune'], {stdio: 'inherit'});
    }
    return folder;
}

function write(path: string, text: string): void {
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, text);
}

/** The front matter Starlight understands, made from the one authors write (title, summary, order). */
function frontmatter(data: Record<string, unknown>, extra: Record<string, unknown>): string {
    const { title, summary, description, order, hidden, reason, source, ...rest } = data;
    const out: Record<string, unknown> = {
        title: title ?? 'Untitled',
        description: summary ?? description,
        ...(order !== undefined ? {sidebar: {order}} : {}),
        ...rest,
        ...extra,
    };
    for (const key of Object.keys(out)) {
        if (out[key] === undefined) {
            delete out[key];
        }
    }
    return `---\n${stringify(out)}---\n`;
}

for (const dir of Object.values(KIND_DIR)) {
    for (const language of languages) {
        rmSync(join(content, language.code, dir), {recursive: true, force: true});
    }
}

const issues: Array<Issue & {product: string}> = [];
const products: Array<Record<string, unknown>> = [];

for (const entry of manifest.products) {
    const product = readProduct(sourceOf(entry.repo));
    const label = entry.repo;
    issues.push(...product.issues.map((issue) => ({...issue, product: label})));

    const docs: DocsJson | null = product.docs;
    if (!docs) {
        issues.push({level: 'warning', code: 'no-docs-json', line: '', path: 'docs/docs.json', product: label, message: `${label} has no docs/docs.json on main. It is not published yet.`});
        continue;
    }
    if (product.lines.length === 0) {
        issues.push({level: 'error', code: 'no-lines', line: '', path: '', product: label, message: `${label} has no branch that is a line.`});
        continue;
    }

    const resolution = resolveProduct(product.lines, languages);
    issues.push(...resolution.issues.map((issue) => ({...issue, product: label})));

    const newest = product.lines[product.lines.length - 1];
    const kindDir = KIND_DIR[docs.kind];
    const branchOf = new Map(product.lines.map((line) => [line.id, line.branch]));

    for (const line of resolution.lines) {
        for (const page of line.pages) {
            const {data, body} = parseFrontmatter(page.shown.content);
            const note =
                page.status === 'missing' || page.status === 'outdated'
                    ? {content: ui(page.lang, page.status === 'missing' ? 'translationMissing' : 'translationOutdated', {language: languages.find((l) => l.code === page.lang)!.name})}
                    : undefined;
            const text =
                frontmatter(data, {
                    editUrl: `https://github.com/${entry.repo}/edit/${branchOf.get(page.shown.line)}/docs/${page.shown.path}`,
                    banner: note,
                    product: docs.slug,
                    line: line.id,
                    status: page.status,
                    provenance: page.provenance,
                    provenanceFrom: page.provenanceFrom,
                    shownLang: page.shown.lang,
                }) + body;
            const base = join(content, page.lang, kindDir, docs.slug);
            write(join(base, line.id, `${page.id}${page.shown.ext}`), text);
            if (line.id === newest.id) {
                write(join(base, `${page.id}${page.shown.ext}`), text);
            }
        }
    }

    products.push({
        slug: docs.slug,
        kind: docs.kind,
        repo: entry.repo,
        title: docs.title,
        summary: docs.summary,
        directory: docs.directory ?? {published: 'auto', url: null},
        translations: docs.translations ?? {source: 'l10n'},
        lines: resolution.lines.map((line) => {
            const info = product.lines.find((candidate) => candidate.id === line.id)!;
            return {id: line.id, label: info.label, branch: info.branch, release: info.release, extends: info.extends, latest: line.id === newest.id, coverage: line.coverage, pages: line.pages.filter((page) => page.lang === sourceCode).length};
        }),
    });
}

// One catalog page for each kind and language that has products.
for (const language of languages) {
    for (const [kind, dir] of Object.entries(KIND_DIR)) {
        const own = products.filter((product) => product.kind === kind);
        if (own.length === 0) {
            continue;
        }
        const rows = own.map((product) => {
            const title = localised(product.title as Record<string, string>, language.code, String(product.slug));
            const summary = localised(product.summary as Record<string, string>, language.code, '');
            return `| [${title}](/${language.code}/${dir}/${product.slug}/) | ${summary} |`;
        });
        write(
            join(content, language.code, dir, 'index.md'),
            `---\ntitle: ${ui(language.code, dir)}\ndescription: ${ui(language.code, `${dir}Description`)}\n---\n\n| ${ui(language.code, 'name')} | ${ui(language.code, 'summary')} |\n| --- | --- |\n${rows.join('\n')}\n`,
        );
    }
}

write(join(root, 'src', 'data', 'products.generated.json'), JSON.stringify({languages: languages.map(({code, name, dir}) => ({code, name, dir: dir ?? 'ltr'})), products}, null, 2) + '\n');

for (const issue of issues) {
    const where = [issue.line, issue.path].filter(Boolean).join(' ');
    (issue.level === 'error' ? console.error : console.warn)(`${issue.level.padEnd(7)} ${issue.product}${where ? ` [${where}]` : ''} ${issue.code}: ${issue.message}`);
}
const errors = issues.filter((issue) => issue.level === 'error').length;
console.log(`${products.length} product(s) synced, ${errors} error(s), ${issues.length - errors} warning(s).`);
process.exit(errors > 0 ? 1 : 0);
