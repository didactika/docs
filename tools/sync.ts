/**
 * Brings the documentation of every product of manifest.json into the site.
 *
 * For each product it reads its repository (lib/source.ts), resolves every version and language (lib/resolve.ts) and writes what the
 * site is built from:
 *
 *   src/content/docs/<language>/<plugins|packages>/<slug>/<line>/<page>   one tree for each version
 *   src/content/docs/<language>/<plugins|packages>/<slug>/<page>           the same as the newest version, the address without a version
 *   public/docs-assets/<plugins|packages>/<slug>/<line>/...                the images and files of each version
 *   public/product-icons/<slug>.svg                                        the icon of the product
 *   src/data/products.generated.json                                       what the components of the site need to know
 *
 * Everything it writes is generated and ignored by git; the pages are never edited here.
 *
 * Environment:
 *   DOCS_SOURCES   folder that holds a clone of each repository, named like it. Default: .cache/sources, cloned from GitHub.
 *   DOCS_NO_FETCH  use the clones as they are, without fetching.
 *   DOCS_OFFLINE   do not ask the Moodle directory whether the plugins are published: use the last answer, or "unknown".
 *   DOCS_MANIFEST  another manifest than manifest.json, for trying the site with a repository of examples.
 *   DOCS_REFS      JSON that reads a line from another ref than its branch, to preview what is not merged yet:
 *                  {"didactika/moodle-local_x": {"main": "docs/portal", "MOODLE_405_STABLE": "docs/portal-405"}}
 *                  The same JSON in preview.refs.json (ignored by git) is read when the variable is not set.
 *
 * @license GPL-3.0-or-later
 */

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {stringify} from 'yaml';
import {branchesOf, checkDirectory, directoryPage, type Cache, type DirectoryAnswer} from './lib/directory.ts';
import {addComponentImports, firstParagraph, resolveRelativeLinks, takeHeading, transformBody} from './lib/markdown.ts';
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

interface RoadmapItem {
    component: string;
    repo: string;
    title: Record<string, string>;
    summary: Record<string, string>;
}

const root = resolve(import.meta.dirname, '..');
const sources = process.env.DOCS_SOURCES ? resolve(process.env.DOCS_SOURCES) : join(root, '.cache', 'sources');
const content = join(root, 'src', 'content', 'docs');
const publicDir = join(root, 'public');
const KIND_DIR = {plugin: 'plugins', package: 'packages'} as const;

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const languages = readJson<Language[]>(join(root, 'languages.json')).filter((language) => language.enabled);
const manifest = readJson<{products: ManifestProduct[]}>(process.env.DOCS_MANIFEST ? resolve(process.env.DOCS_MANIFEST) : join(root, 'manifest.json'));
const roadmap = existsSync(join(root, 'roadmap.json')) ? readJson<RoadmapItem[]>(join(root, 'roadmap.json')) : [];

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

// Everything written in this run. A file that is already as it should be is not touched, so a watcher does not rebuild for nothing, and
// the files of an earlier run that were not written again are deleted at the end.
const written = new Set<string>();
const fingerprint = createHash('sha256');

function write(path: string, data: string | Buffer): void {
    written.add(path);
    fingerprint.update(path).update(data);
    const same = existsSync(path) && readFileSync(path).equals(typeof data === 'string' ? Buffer.from(data) : data);
    if (same) {
        return;
    }
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, data);
}

/** Deletes what an earlier run generated and this one did not, and the folders that are left empty. */
function removeStale(folder: string): void {
    if (!existsSync(folder)) {
        return;
    }
    for (const entry of readdirSync(folder, {withFileTypes: true})) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) {
            removeStale(path);
        } else if (!written.has(path)) {
            rmSync(path);
        }
    }
    if (readdirSync(folder).length === 0) {
        rmdirSync(folder);
    }
}

// Refs to preview instead of the branches of a line: from DOCS_REFS, or from preview.refs.json (see preview.refs.example.json).
const previewFile = join(root, 'preview.refs.json');
const previews = (process.env.DOCS_REFS ? JSON.parse(process.env.DOCS_REFS) : existsSync(previewFile) ? JSON.parse(readFileSync(previewFile, 'utf8')) : {}) as Record<string, Record<string, string>>;

// What the Moodle directory said the last time, so a build without network keeps showing it.
const cacheFile = join(root, '.cache', 'directory.json');
const directoryCache: Cache = existsSync(cacheFile) ? readJson<Cache>(cacheFile) : {};

async function directoryOf(component: string | null, branches: string[], forced: boolean | 'auto' | undefined): Promise<DirectoryAnswer> {
    if (typeof forced === 'boolean') {
        return {published: forced, releases: [], checked: null};
    }
    if (!component) {
        return {published: null, releases: [], checked: null};
    }
    // The directory is asked at most every six hours, so a loop that synchronises often does not call it every time.
    const known = directoryCache[component];
    const fresh = known?.checked !== null && known?.checked !== undefined && Date.now() - Date.parse(known.checked) < 6 * 3600 * 1000;
    const answer = process.env.DOCS_OFFLINE || fresh ? (known ?? {published: null, releases: [], checked: null}) : await checkDirectory(component, branches, known);
    directoryCache[component] = answer;
    return answer;
}

/** The front matter Starlight understands, made from the one authors write (title, summary, order). */
function frontmatter(data: Record<string, unknown>, extra: Record<string, unknown>): string {
    const {title, summary, description, order, hidden: _hidden, reason: _reason, source: _source, ...rest} = data;
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

/** The folders the pages of a version are in, in the order the navigation shows them: the usual ones first, then the rest. */
const USUAL_SECTIONS = ['getting-started', 'concepts', 'guides', 'reference', 'technical'];
const sectionsOf = (ids: string[]): string[] =>
    [...new Set(ids.filter((id) => id.includes('/')).map((id) => id.split('/')[0]))].sort((a, b) => {
        const rank = (name: string): number => (USUAL_SECTIONS.includes(name) ? USUAL_SECTIONS.indexOf(name) : USUAL_SECTIONS.length);
        return rank(a) - rank(b) || a.localeCompare(b);
    });

const isText = (path: string): boolean => /\.(?:md|mdx|svg|txt|json|csv|puml)$/.test(path);

const issues: Array<Issue & {product: string}> = [];
const products: Array<Record<string, unknown>> = [];
const documented = new Set<string>();

for (const entry of manifest.products) {
    const product = readProduct(sourceOf(entry.repo), {refs: previews[entry.repo]});
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
    if (product.component) {
        documented.add(product.component);
    }

    for (const line of resolution.lines) {
        const assetBase = `/docs-assets/${kindDir}/${docs.slug}/${line.id}`;
        for (const [path, asset] of line.assets) {
            write(join(publicDir, 'docs-assets', kindDir, docs.slug, line.id, path.replace(/^_assets\//, '')), Buffer.from(asset.content, isText(path) ? 'utf8' : 'latin1'));
        }

        for (const page of line.pages) {
            const parsed = parseFrontmatter(page.shown.content);
            // A page that starts with a heading (a README, a card of a technical model) is titled by it.
            const heading = takeHeading(parsed.body);
            const data: Record<string, unknown> = {...parsed.data, ...(heading.title ? {title: heading.title} : {})};
            if (!data.description) {
                const described = firstParagraph(heading.body);
                if (described) {
                    data.description = described;
                }
            }
            // The keys the tools of a technical model put in the front matter are theirs; one of them (id) would rename the page.
            for (const key of ['id', 'name', 'actor', 'package', 'origin', 'sourceOfTruth', 'requirement', 'includes', 'extends']) {
                delete data[key];
            }
            const body = heading.body;
            const rewrite = (text: string, to: string): string => resolveRelativeLinks(transformBody(text, to, assetBase), page.id, page.shown.lang, to, assetBase);
            const note =
                page.status === 'missing' || page.status === 'outdated'
                    ? {content: ui(page.lang, page.status === 'missing' ? 'translationMissing' : 'translationOutdated', {language: languages.find((l) => l.code === page.lang)!.name})}
                    : undefined;
            const extra = {
                editUrl: `https://github.com/${entry.repo}/edit/${branchOf.get(page.shown.line)}/docs/${page.shown.path}`,
                banner: note,
                product: docs.slug,
                line: line.id,
                status: page.status,
                provenance: page.provenance,
                provenanceFrom: page.provenanceFrom,
                shownLang: page.shown.lang,
            };
            const base = join(content, page.lang, kindDir, docs.slug);
            const address = `/${page.lang}/${kindDir}/${docs.slug}`;
            const finish = (text: string): string => (page.shown.ext === '.mdx' ? addComponentImports(text) : text);
            write(join(base, line.id, `${page.id}${page.shown.ext}`), finish(frontmatter(data, extra) + rewrite(body, `${address}/${line.id}`)));
            // The address without a version shows the newest one, its links stay in that address and the search does not index it twice.
            if (line.id === newest.id) {
                write(join(base, `${page.id}${page.shown.ext}`), finish(frontmatter(data, {...extra, pagefind: false}) + rewrite(body, address)));
            }
        }
    }

    let icon: string | null = null;
    if (product.iconSvg) {
        icon = `/product-icons/${docs.slug}.svg`;
        write(join(publicDir, 'product-icons', `${docs.slug}.svg`), product.iconSvg);
    }

    const answer = await directoryOf(product.component, branchesOf(product.lines), docs.directory?.published);

    products.push({
        slug: docs.slug,
        kind: docs.kind,
        repo: entry.repo,
        component: product.component,
        title: docs.title,
        summary: docs.summary,
        icon,
        directory: {published: answer.published, url: answer.published ? (docs.directory?.url ?? (product.component ? directoryPage(product.component) : null)) : null, releases: answer.releases},
        translations: docs.translations ?? {source: 'l10n'},
        updated: product.updated,
        lines: resolution.lines.map((line) => {
            const info = product.lines.find((candidate) => candidate.id === line.id)!;
            const ids = line.pages.filter((page) => page.lang === sourceCode).map((page) => page.id);
            return {id: line.id, label: info.label, branch: info.branch, release: info.release, extends: info.extends, latest: line.id === newest.id, coverage: line.coverage, pages: ids.length, sections: sectionsOf(ids), pageIds: ids};
        }),
    });
}

// The products that are not documented yet, with what the Moodle directory says about each.
const coming: Array<Record<string, unknown>> = [];
for (const item of roadmap.filter((candidate) => !documented.has(candidate.component))) {
    const answer = await directoryOf(item.component, ['4.5', '5.3'], undefined);
    coming.push({...item, published: answer.published});
}

for (const language of languages) {
    for (const dir of Object.values(KIND_DIR)) {
        removeStale(join(content, language.code, dir));
    }
}
removeStale(join(publicDir, 'docs-assets'));
removeStale(join(publicDir, 'product-icons'));

mkdirSync(dirname(cacheFile), {recursive: true});
writeFileSync(cacheFile, JSON.stringify(directoryCache, null, 2) + '\n');

write(join(root, 'src', 'data', 'products.generated.json'), JSON.stringify({languages: languages.map(({code, name, dir}) => ({code, name, dir: dir ?? 'ltr'})), products, coming}, null, 2) + '\n');

// A short fingerprint of everything written, so a loop that serves the site knows when to build it again.
writeFileSync(join(root, '.cache', 'sync.hash'), fingerprint.digest('hex').slice(0, 16));

for (const issue of issues) {
    const where = [issue.line, issue.path].filter(Boolean).join(' ');
    (issue.level === 'error' ? console.error : console.warn)(`${issue.level.padEnd(7)} ${issue.product}${where ? ` [${where}]` : ''} ${issue.code}: ${issue.message}`);
}
const errors = issues.filter((issue) => issue.level === 'error').length;
const published = products.filter((product) => (product.directory as {published: boolean | null}).published).length;
console.log(`${products.length} product(s) synced (${published} in the Moodle directory), ${coming.length} coming, ${errors} error(s), ${issues.length - errors} warning(s).`);
process.exit(errors > 0 ? 1 : 0);
