import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {addComponentImports, alertsToAsides, resolveAssetLinks, resolvePageLinks, transformBody, resolveRelativeLinks, takeHeading, firstParagraph} from './markdown.ts';

describe('alertsToAsides', () => {
    it('turns an alert of GitHub into an aside of Starlight', () => {
        assert.equal(alertsToAsides('> [!NOTE]\n> It never stores passwords.\n\nAfter.'), ':::note\nIt never stores passwords.\n:::\n\nAfter.');
    });

    it('keeps every quoted line of the alert, and the blank lines inside it', () => {
        assert.equal(alertsToAsides('> [!TIP]\n> First.\n>\n> Second.\n'), ':::tip\nFirst.\n\nSecond.\n:::\n');
    });

    it('maps each kind to the aside that is closest in weight', () => {
        const kinds = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'].map((kind) => alertsToAsides(`> [!${kind}]\n> x`).split('\n')[0]);
        assert.deepEqual(kinds, [':::note', ':::tip', ':::caution', ':::caution', ':::danger']);
    });

    it('leaves an ordinary quote alone', () => {
        assert.equal(alertsToAsides('> Just a quote.\n> Two lines.'), '> Just a quote.\n> Two lines.');
    });

    it('does not touch fenced code', () => {
        const code = '```md\n> [!NOTE]\n> Inside.\n```';
        assert.equal(alertsToAsides(code), code);
    });
});

describe('resolvePageLinks', () => {
    const base = '/en/plugins/local-demo/m503';

    it('points a page link into the same version and language', () => {
        assert.equal(resolvePageLinks('See [install](page:getting-started/installation).', base), 'See [install](/en/plugins/local-demo/m503/getting-started/installation/).');
    });

    it('keeps the anchor', () => {
        assert.equal(resolvePageLinks('[x](page:guides/a#step-2)', base), '[x](/en/plugins/local-demo/m503/guides/a/#step-2)');
    });

    it('links the index to the root of the product', () => {
        assert.equal(resolvePageLinks('[home](page:index)', base), '[home](/en/plugins/local-demo/m503/)');
    });

    it('points the href of a component at the page too', () => {
        assert.equal(resolvePageLinks('<Feature href="page:getting-started/quick-start" title="x" />', base), '<Feature href="/en/plugins/local-demo/m503/getting-started/quick-start/" title="x" />');
        assert.equal(resolvePageLinks("<Feature href='page:index#top' />", base), "<Feature href='/en/plugins/local-demo/m503/#top' />");
    });

    it('does not touch ordinary links or fenced code', () => {
        const text = '[a](https://example.org) and\n```\n[b](page:guides/a)\n```';
        assert.equal(resolvePageLinks(text, base), text);
    });
});

describe('resolveAssetLinks', () => {
    const base = '/docs-assets/plugins/local-demo/m405';

    it('points an image, a link and an attribute at the file of the version', () => {
        assert.equal(
            resolveAssetLinks('![A](asset:a.png) [b](asset:files/b.pdf) <Screenshot src="asset:c.png" />', base),
            `![A](${base}/a.png) [b](${base}/files/b.pdf) <Screenshot src="${base}/c.png" />`,
        );
    });

    it('does not touch fenced code', () => {
        const code = '```md\n![A](asset:a.png)\n```';
        assert.equal(resolveAssetLinks(code, base), code);
    });
});

describe('addComponentImports', () => {
    it('imports the components of Starlight a page uses, together and only those', () => {
        const out = addComponentImports('---\ntitle: A\n---\n\n<Steps>\n1. One\n</Steps>\n\n<CardGrid><Card title="x" /></CardGrid>\n');
        assert.ok(out.includes("import {Steps, Card, CardGrid} from '@astrojs/starlight/components';"));
        assert.ok(!out.includes('Tabs'));
    });

    it('puts the imports after the front matter, not before it', () => {
        const out = addComponentImports('---\ntitle: A\n---\n\n<Steps>x</Steps>\n');
        assert.ok(out.startsWith('---\ntitle: A\n---\n'));
        assert.ok(out.indexOf('import') > out.indexOf('title: A'));
    });

    it('imports the components of the site by their default export', () => {
        const out = addComponentImports('<MIcon name="home-rounded" /> <Screenshot src="a.png" alt="" /> <Path title="x" pages={[]} />');
        assert.ok(out.includes("import MIcon from '/src/components/MIcon.astro';"));
        assert.ok(out.includes("import Screenshot from '/src/components/Screenshot.astro';"));
        assert.ok(out.includes("import Path from '/src/components/Path.astro';"));
    });

    it('leaves a page that uses none as it is, and ignores a component named inside code', () => {
        const plain = '---\ntitle: A\n---\nText\n```mdx\n<Steps>\n```\n';
        assert.equal(addComponentImports(plain), plain);
    });
});

describe('transformBody', () => {
    it('does the alerts and the page links', () => {
        assert.equal(
            transformBody('> [!WARNING]\n> See [roles](page:getting-started/give-permission).', '/es/plugins/x/m405'),
            ':::caution\nSee [roles](/es/plugins/x/m405/getting-started/give-permission/).\n:::',
        );
    });

    it('resolves the assets when it is given where they are', () => {
        assert.equal(transformBody('![A](asset:a.png)', '/en/p/m1', '/docs-assets/p/m1'), '![A](/docs-assets/p/m1/a.png)');
    });
});

describe('the pages of a technical model', () => {
    const base = '/en/plugins/local-demo/m405';
    const assets = '/docs-assets/plugins/local-demo/m405';

    it('turns a link to another page into its address and a link to a diagram into its asset', () => {
        const out = resolveRelativeLinks('[card](../../design/use-cases/a/README.md#tests) ![d](./domain-model.svg) [t](traceability.csv)', 'technical/domain/index', 'en', base, assets);
        assert.equal(out, `[card](${base}/design/use-cases/a/#tests) ![d](${assets}/en/technical/domain/domain-model.svg) [t](${assets}/en/technical/domain/traceability.csv)`);
    });

    it('writes the address in lower case, as Starlight does with the name of a folder', () => {
        const out = resolveRelativeLinks('[card](./use-cases/createSchema/README.md)', 'technical/analysis/index', 'en', base, assets);
        assert.equal(out, `[card](${base}/technical/analysis/use-cases/createschema/)`);
    });

    it('leaves absolute links, anchors, schemes and code as they are', () => {
        const text = '[a](https://x.org) [b](#top) [c](/en/x/) [d](page:guides/x)\n```\n[e](./f.md)\n```\n';
        assert.equal(resolveRelativeLinks(text, 'technical/index', 'en', base, assets), text);
    });

    it('gives the README of a folder the address of the folder', () => {
        assert.equal(resolveRelativeLinks('[x](./use-cases/a/README.md)', 'technical/requirements/index', 'en', base, assets), `[x](${base}/technical/requirements/use-cases/a/)`);
    });

    it('takes the first heading as the title and out of the body', () => {
        assert.deepEqual(takeHeading('\n# UC-001 Create `delegations`\n\nText'), {title: 'UC-001 Create delegations', body: 'Text'});
        assert.deepEqual(takeHeading('Text first\n# Later'), {body: 'Text first\n# Later'});
    });

    it('describes a page by its first paragraph of prose', () => {
        assert.equal(firstParagraph('| a | b |\n| - | - |\n\nHow it is [built](x.md). Second sentence.'), 'How it is built. Second sentence.');
        assert.equal(firstParagraph('| a |\n'), undefined);
    });
});
