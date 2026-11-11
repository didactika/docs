/**
 * What the portal does to the Markdown of a page on its way into the site.
 *
 * Two things, so that a page reads well on GitHub and on the portal without being written twice:
 *
 * - The alerts of GitHub (`> [!NOTE]`) become the asides of Starlight (`:::note`).
 * - A link to another page of the same product, `[text](page:guides/install)`, becomes the address of that page in the same version
 *   and language, so a link never leaves the version the reader is in. An anchor may follow: `page:guides/install#step-2`.
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
    return outsideFences(markdown, (text) =>
        text.replace(/\]\(page:([^)#\s]+)(#[^)\s]*)?\)/g, (_, id: string, anchor: string | undefined) => `](${base}${id === 'index' ? '/' : `/${id}/`}${anchor ?? ''})`),
    );
}

export function transformBody(markdown: string, base: string): string {
    return resolvePageLinks(alertsToAsides(markdown), base);
}
