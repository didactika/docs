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
    const address = (id: string, anchor: string | undefined): string => `${base}${id === 'index' ? '/' : `/${id}/`}${anchor ?? ''}`;
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

export function transformBody(markdown: string, base: string, assetBase?: string): string {
    const linked = resolvePageLinks(alertsToAsides(markdown), base);
    return assetBase ? resolveAssetLinks(linked, assetBase) : linked;
}
