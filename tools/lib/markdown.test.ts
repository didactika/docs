import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {alertsToAsides, resolvePageLinks, transformBody} from './markdown.ts';

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

    it('does not touch ordinary links or fenced code', () => {
        const text = '[a](https://example.org) and\n```\n[b](page:guides/a)\n```';
        assert.equal(resolvePageLinks(text, base), text);
    });
});

describe('transformBody', () => {
    it('does both', () => {
        assert.equal(transformBody('> [!WARNING]\n> See [roles](page:getting-started/give-permission).', '/es/plugins/x/m405'), ':::caution\nSee [roles](/es/plugins/x/m405/getting-started/give-permission/).\n:::');
    });
});
