/**
 * What the portal does to the Markdown of a page on its way into the site, so that a page reads well on GitHub and on the portal
 * without being written twice:
 *
 * - The alerts of GitHub (`> [!NOTE]`) become the asides of Starlight (`:::note`).
 * - A link to another page of the same product, `[text](page:guides/install)`, becomes the address of that page in the same version
 *   and language, so a link never leaves the version the reader is in. An anchor may follow: `page:guides/install#step-2`.
 * - A file of the documentation, `asset:shot.png` (in the `_assets` folder), becomes its address in the version the reader is in.
 * - A page written in MDX uses the components of the site without importing them: the imports it needs are added.
 *
 * Fenced code is left as it is.
 *
 * @license GPL-3.0-or-later
 */

const ASIDES: Record<string, string> = {NOTE: 'note', TIP: 'tip', IMPORTANT: 'caution', WARNING: 'caution', CAUTION: 'danger'};

/** Applies `change` to the text outside fenced code blocks and keeps the code as it is. */
function outsideFences(markdown: string, change: (text: string) => string): string {
    const parts = markdown.split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$)/m);
    return parts.map((part, index) => (index % 2 === 1 ? part : change(part))).join('');
}

/** `> [!WARNING]` and the quoted lines that follow become `:::caution` … `:::`. */
export function alertsToAsides(markdown: string): string {
    return outsideFences(markdown, (text) => {
        const lines = text.split('\n');
        const out: string[] = [];
        for (let index = 0; index < lines.length; index++) {
            const alert = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/.exec(lines[index]);
            if (!alert) {
                out.push(lines[index]);
                continue;
            }
            const body: string[] = [];
            while (index + 1 < lines.length && /^>/.test(lines[index + 1])) {
                body.push(lines[++index].replace(/^>\s?/, ''));
            }
            out.push(`:::${ASIDES[alert[1]]}`, ...body, ':::');
        }
        return out.join('\n');
    });
}

/** `page:` links, written as the address of the page inside `base` (`/en/plugins/local-demo/m503`). */
export function resolvePageLinks(markdown: string, base: string): string {
    const address = (id: string, anchor: string | undefined): string => {
        const clean = id === 'index' ? '' : id.replace(/\/index$/, '');
        return `${base}${clean ? `/${clean}/` : '/'}${anchor ?? ''}`;
    };
    return outsideFences(markdown, (text) =>
        text
            // A link of Markdown: [text](page:guides/install#step-2)
            .replace(/\]\(page:([^)#\s]+)(#[^)\s]*)?\)/g, (_, id: string, anchor: string | undefined) => `](${address(id, anchor)})`)
            // An attribute of a component: href="page:guides/install"
            .replace(/(=\s*)(["'])page:([^"'#\s]+)(#[^"'\s]*)?\2/g, (_, equals: string, quote: string, id: string, anchor: string | undefined) => `${equals}${quote}${address(id, anchor)}${quote}`),
    );
}

/** `asset:name.png` becomes `<assetBase>/name.png`, in an image, a link or an attribute of a component. */
export function resolveAssetLinks(markdown: string, assetBase: string): string {
    return outsideFences(markdown, (text) => text.replace(/asset:([A-Za-z0-9_./-]+)/g, (_, path: string) => `${assetBase}/${path}`));
}

/** The components an MDX page may use without importing them, where each comes from, and whether it is a default export. */
const COMPONENTS: Array<{names: string[]; from: string; named: boolean}> = [
    {names: ['Steps', 'Card', 'CardGrid', 'LinkCard', 'Tabs', 'TabItem', 'Badge', 'FileTree'], from: '@astrojs/starlight/components', named: true},
    {names: ['MIcon'], from: '/src/components/MIcon.astro', named: false},
    {names: ['Screenshot'], from: '/src/components/Screenshot.astro', named: false},
    {names: ['FeatureGrid'], from: '/src/components/FeatureGrid.astro', named: false},
    {names: ['Feature'], from: '/src/components/Feature.astro', named: false},
    {names: ['Path'], from: '/src/components/Path.astro', named: false},
];

/** Adds, before the content of an MDX page, the imports of the components it uses. */
export function addComponentImports(mdx: string): string {
    const imports: string[] = [];
    outsideFences(mdx, (text) => {
        for (const {names, from, named} of COMPONENTS) {
            const used = names.filter((name) => new RegExp(`<${name}[\\s/>]`).test(text));
            if (used.length === 0) {
                continue;
            }
            // A component of the site is imported by itself; the ones of Starlight, together.
            imports.push(...(named ? [`import {${used.join(', ')}} from '${from}';`] : used.map((name) => `import ${name} from '${from}';`)));
        }
        return text;
    });
    if (imports.length === 0) {
        return mdx;
    }
    // The imports go after the front matter, where MDX reads them.
    const front = /^---\n[\s\S]*?\n---\n/.exec(mdx)?.[0] ?? '';
    return `${front}\n${imports.join('\n')}\n${mdx.slice(front.length)}`;
}

/**
 * The links of a page that point at a file next to it (`../design/README.md`, `./domain-model.svg`), as the tools that write the
 * documentation of a technical model produce them. A page becomes the address of that page in the same version and language, and a
 * diagram or a table becomes its address among the assets of the version.
 *
 * `pageId` is the page inside its version (`technical/domain/index`), which says where its folder is.
 */
export function resolveRelativeLinks(markdown: string, pageId: string, lang: string, base: string, assetBase: string): string {
    const folder = pageId.includes('/') ? pageId.slice(0, pageId.lastIndexOf('/')).split('/') : [];
    return outsideFences(markdown, (text) =>
        text.replace(/\]\(([^)\s]+)\)/g, (whole: string, target: string) => {
            if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(target)) {
                return whole;
            }
            const [file, anchor] = [target.split('#')[0], target.includes('#') ? `#${target.split('#').slice(1).join('#')}` : ''];
            const parts = [...folder];
            for (const part of file.split('/')) {
                if (part === '..') {
                    if (parts.length === 0) {
                        return whole;
                    }
                    parts.pop();
                } else if (part !== '.' && part !== '') {
                    parts.push(part);
                }
            }
            const path = parts.join('/');
            if (/\.mdx?$/.test(path)) {
                const id = path.replace(/\.mdx?$/, '').replace(/(^|\/)README$/, '$1index').replace(/(^|\/)index$/, '').toLowerCase(); // Starlight writes every address in lower case (createSchema is createschema)
                return `](${base}${id ? `/${id}` : ''}/${anchor})`;
            }
            return `](${assetBase}/${lang}/${path}${anchor})`;
        }),
    );
}

/**
 * The first heading of a page, when the page starts with one. It is the title of the page and is taken out of the body, because the
 * portal draws the title itself; the pages of a technical model (a use-case card, a README) have it and no front matter title, or
 * one that does not tell the three cards of a use case apart.
 */
export function takeHeading(body: string): {title?: string; body: string} {
    const match = /^\s*#\s+(.+?)\s*\n/.exec(body.replace(/\r\n/g, '\n'));
    if (!match) {
        return {body};
    }
    return {title: match[1].replace(/`/g, ''), body: body.replace(/\r\n/g, '\n').slice(match[0].length).replace(/^\n+/, '')};
}

/** A short description for a page that has none: its first paragraph of prose, without Markdown, cut at a sentence. */
export function firstParagraph(body: string, limit = 180): string | undefined {
    for (const block of body.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
        const text = block.trim();
        if (text === '' || /^(?:[|#>!<\-*+`:]|\d+\.|---)/.test(text)) {
            continue;
        }
        const plain = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').replace(/\s+/g, ' ');
        if (plain.length <= limit) {
            return plain;
        }
        const cut = plain.slice(0, limit);
        const stop = cut.lastIndexOf('. ');
        return stop > 60 ? cut.slice(0, stop + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
    }
    return undefined;
}

export function transformBody(markdown: string, base: string, assetBase?: string): string {
    const linked = resolvePageLinks(alertsToAsides(markdown), base);
    return assetBase ? resolveAssetLinks(linked, assetBase) : linked;
}
