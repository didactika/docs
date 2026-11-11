import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {parseFrontmatter, resolveProduct, type LanguageDef, type LineInput, type Resolution} from './resolve.ts';

const EN: LanguageDef = {code: 'en', source: true, required: true};
const ES: LanguageDef = {code: 'es', required: true, fallback: 'en'};
const ES_OPTIONAL: LanguageDef = {code: 'es'};

const page = (title: string, body = '', extra = ''): string => `---\ntitle: ${title}\n${extra}---\n${body}\n`;
const hidden = (reason?: string): string => `---\nhidden: true\n${reason ? `reason: ${reason}\n` : ''}---\n`;
const line = (id: string, parent: string | null, files: Record<string, string>): LineInput => ({id, extends: parent, files: new Map(Object.entries(files))});

const lineOf = (resolution: Resolution, id: string) => resolution.lines.find((candidate) => candidate.id === id)!;
const pageOf = (resolution: Resolution, lineId: string, pageId: string, lang = 'en') =>
    lineOf(resolution, lineId).pages.find((candidate) => candidate.id === pageId && candidate.lang === lang);
const codes = (resolution: Resolution): string[] => resolution.issues.map((issue) => `${issue.level}:${issue.code}`);

describe('parseFrontmatter', () => {
    it('reads the front matter and the body', () => {
        const {data, body} = parseFrontmatter('---\ntitle: Hello\norder: 3\nhidden: true\n---\nText\n');
        assert.deepEqual(data, {title: 'Hello', order: 3, hidden: true});
        assert.equal(body, 'Text\n');
    });

    it('accepts a byte order mark and Windows line ends', () => {
        const {data} = parseFrontmatter('﻿---\r\ntitle: Hello\r\n---\r\nText\r\n');
        assert.equal(data.title, 'Hello');
    });

    it('returns no data for a page without front matter', () => {
        assert.deepEqual(parseFrontmatter('Just text').data, {});
    });
});

describe('inheritance between lines', () => {
    const base = line('m405', null, {'en/index.md': page('Home'), 'en/reference/settings.md': page('Settings 4.5'), 'en/guides/legacy.md': page('Legacy')});
    const next = line('m503', 'm405', {
        'en/reference/settings.md': page('Settings 5.3'),
        'en/guides/permissions.md': page('Permissions'),
        'en/guides/legacy.md': hidden('The legacy dialog does not exist in Moodle 5.3.'),
    });
    const result = resolveProduct([base, next], [EN]);

    it('shows in the base line only what the base line has', () => {
        assert.deepEqual(lineOf(result, 'm405').pages.map((p) => p.id), ['guides/legacy', 'index', 'reference/settings']);
    });

    it('inherits a page the later line does not mention', () => {
        const index = pageOf(result, 'm503', 'index')!;
        assert.equal(index.shown.line, 'm405');
        assert.equal(index.provenance, 'inherited');
        assert.equal(index.provenanceFrom, 'm405');
    });

    it('replaces a page with the file of the later line', () => {
        const settings = pageOf(result, 'm503', 'reference/settings')!;
        assert.equal(settings.shown.data.title, 'Settings 5.3');
        assert.equal(settings.provenance, 'modified');
    });

    it('adds a page that the base line does not have', () => {
        assert.equal(pageOf(result, 'm503', 'guides/permissions')!.provenance, 'added');
        assert.equal(pageOf(result, 'm405', 'guides/permissions'), undefined);
    });

    it('hides a page with a marker, only from that line on', () => {
        assert.equal(pageOf(result, 'm503', 'guides/legacy'), undefined);
        assert.deepEqual(lineOf(result, 'm503').hidden, ['guides/legacy']);
        assert.ok(pageOf(result, 'm405', 'guides/legacy'));
    });

    it('lets a still later line bring a hidden page back', () => {
        const third = line('m600', 'm503', {'en/guides/legacy.md': page('Legacy again')});
        const again = resolveProduct([base, next, third], [EN]);
        assert.equal(pageOf(again, 'm600', 'guides/legacy')!.shown.data.title, 'Legacy again');
        assert.equal(pageOf(again, 'm600', 'guides/legacy')!.provenance, 'added');
    });

    it('passes the hidden marker on to the lines that inherit from it', () => {
        const third = line('m600', 'm503', {});
        assert.equal(pageOf(resolveProduct([base, next, third], [EN]), 'm600', 'guides/legacy'), undefined);
    });

    it('asks for a reason when a page is hidden', () => {
        const silent = line('m503', 'm405', {'en/guides/legacy.md': hidden()});
        assert.ok(codes(resolveProduct([base, silent], [EN])).includes('error:hidden-without-reason'));
    });

    it('inherits the assets and lets a later line replace one', () => {
        const withAssets = resolveProduct(
            [line('m405', null, {'en/index.md': page('Home'), '_assets/a.png': 'A', '_assets/b.png': 'B'}), line('m503', 'm405', {'_assets/b.png': 'B2'})],
            [EN],
        );
        const assets = lineOf(withAssets, 'm503').assets;
        assert.deepEqual([...assets].map(([path, asset]) => `${path}=${asset.content}@${asset.line}`), ['_assets/a.png=A@m405', '_assets/b.png=B2@m503']);
    });
});

describe('languages', () => {
    it('shows the translation of the line when it is up to date', () => {
        const result = resolveProduct([line('m405', null, {'en/index.md': page('Home'), 'es/index.md': page('Inicio')})], [EN, ES]);
        const index = pageOf(result, 'm405', 'index', 'es')!;
        assert.equal(index.status, 'translated');
        assert.equal(index.shown.data.title, 'Inicio');
        assert.deepEqual(result.issues, []);
    });

    it('inherits a translation together with its source', () => {
        const result = resolveProduct(
            [line('m405', null, {'en/index.md': page('Home'), 'es/index.md': page('Inicio')}), line('m503', 'm405', {})],
            [EN, ES],
        );
        assert.equal(pageOf(result, 'm503', 'index', 'es')!.status, 'translated');
    });

    it('does not show a translation older than the source that a later line rewrote', () => {
        const result = resolveProduct(
            [line('m405', null, {'en/index.md': page('Home'), 'es/index.md': page('Inicio')}), line('m503', 'm405', {'en/index.md': page('Home 5.3')})],
            [EN, ES],
        );
        const index = pageOf(result, 'm503', 'index', 'es')!;
        assert.equal(index.status, 'outdated');
        assert.equal(index.shown.lang, 'en');
        assert.equal(index.shown.line, 'm503');
        assert.ok(codes(result).includes('error:outdated-translation'));
        // The base line is still fine.
        assert.equal(pageOf(result, 'm405', 'index', 'es')!.status, 'translated');
    });

    it('shows the translation again once the later line translates its own page', () => {
        const result = resolveProduct(
            [
                line('m405', null, {'en/index.md': page('Home'), 'es/index.md': page('Inicio')}),
                line('m503', 'm405', {'en/index.md': page('Home 5.3'), 'es/index.md': page('Inicio 5.3')}),
            ],
            [EN, ES],
        );
        assert.equal(pageOf(result, 'm503', 'index', 'es')!.shown.data.title, 'Inicio 5.3');
        assert.deepEqual(result.issues, []);
    });

    it('fails a missing page in a required language', () => {
        const result = resolveProduct([line('m405', null, {'en/index.md': page('Home')})], [EN, ES]);
        assert.equal(pageOf(result, 'm405', 'index', 'es')!.status, 'missing');
        assert.ok(codes(result).includes('error:missing-translation'));
    });

    it('falls back to the source language without failing when the language is not required', () => {
        const result = resolveProduct([line('m405', null, {'en/index.md': page('Home')})], [EN, ES_OPTIONAL]);
        const index = pageOf(result, 'm405', 'index', 'es')!;
        assert.equal(index.status, 'missing');
        assert.equal(index.shown.lang, 'en');
        assert.deepEqual(result.issues, []);
    });

    it('tries the fallback language before the source language', () => {
        const brazilian: LanguageDef = {code: 'pt_br', fallback: 'pt'};
        const result = resolveProduct(
            [line('m405', null, {'en/index.md': page('Home'), 'pt/index.md': page('Início')})],
            [EN, {code: 'pt'}, brazilian],
        );
        const index = pageOf(result, 'm405', 'index', 'pt_br')!;
        assert.equal(index.status, 'translated');
        assert.equal(index.shown.lang, 'pt');
    });

    it('rejects a page that exists only in a language that is not the source', () => {
        const result = resolveProduct([line('m405', null, {'en/index.md': page('Home'), 'es/extra.md': page('Extra')})], [EN, ES_OPTIONAL]);
        assert.ok(codes(result).includes('error:orphan-translation'));
    });

    it('ignores a folder whose language is not in the registry', () => {
        const result = resolveProduct([line('m405', null, {'en/index.md': page('Home'), 'fr/index.md': page('Accueil')})], [EN]);
        assert.ok(codes(result).includes('warning:unknown-language'));
        assert.equal(lineOf(result, 'm405').pages.length, 1);
    });

    it('hides the translations of a hidden page', () => {
        const result = resolveProduct(
            [line('m405', null, {'en/old.md': page('Old'), 'es/old.md': page('Viejo')}), line('m503', 'm405', {'en/old.md': hidden('Gone.')})],
            [EN, ES],
        );
        assert.equal(pageOf(result, 'm503', 'old', 'es'), undefined);
        assert.equal(pageOf(result, 'm405', 'old', 'es')!.status, 'translated');
    });

    it('warns when a translation is marked hidden', () => {
        const result = resolveProduct([line('m405', null, {'en/a.md': page('A'), 'es/a.md': hidden('No.')})], [EN, ES_OPTIONAL]);
        assert.ok(codes(result).includes('warning:hidden-in-translation'));
    });

    it('measures the coverage of each language', () => {
        const result = resolveProduct(
            [line('m405', null, {'en/a.md': page('A'), 'en/b.md': page('B'), 'es/a.md': page('A es')})],
            [EN, ES_OPTIONAL],
        );
        assert.deepEqual(lineOf(result, 'm405').coverage, {en: 1, es: 0.5});
    });

    it('needs exactly one source language', () => {
        assert.throws(() => resolveProduct([line('m405', null, {})], [{code: 'en'}]), /Exactly one language/);
        assert.throws(() => resolveProduct([line('m405', null, {})], [EN, {code: 'es', source: true}]), /Exactly one language/);
    });
});

describe('files and lines', () => {
    it('rejects the same page as .md and .mdx in one line', () => {
        const result = resolveProduct([line('m405', null, {'en/a.md': page('A'), 'en/a.mdx': page('A')})], [EN]);
        assert.ok(codes(result).includes('error:duplicate-page'));
    });

    it('warns about a file identical to the one it would inherit', () => {
        const result = resolveProduct(
            [line('m405', null, {'en/a.md': page('A', 'same')}), line('m503', 'm405', {'en/a.md': page('A', 'same').replace(/\n/g, '\r\n')})],
            [EN],
        );
        const warning = result.issues.find((issue) => issue.code === 'redundant-override')!;
        assert.equal(warning.level, 'warning');
        assert.equal(warning.line, 'm503');
        assert.equal(warning.path, 'en/a.md');
    });

    it('does not warn when the later file differs', () => {
        const result = resolveProduct([line('m405', null, {'en/a.md': page('A')}), line('m503', 'm405', {'en/a.md': page('A', 'more')})], [EN]);
        assert.deepEqual(result.issues, []);
    });

    it('reports a line that extends one that does not exist', () => {
        const result = resolveProduct([line('m503', 'm405', {'en/a.md': page('A')})], [EN]);
        assert.ok(codes(result).includes('error:unknown-line'));
    });

    it('reports lines that inherit from each other in a circle', () => {
        const result = resolveProduct([line('a', 'b', {'en/a.md': page('A')}), line('b', 'a', {})], [EN]);
        assert.ok(codes(result).includes('error:line-cycle'));
    });

    it('follows a chain of three lines in order', () => {
        const result = resolveProduct(
            [line('m405', null, {'en/a.md': page('A1')}), line('m503', 'm405', {}), line('m600', 'm503', {'en/a.md': page('A3')})],
            [EN],
        );
        assert.deepEqual(lineOf(result, 'm600').chain, ['m405', 'm503', 'm600']);
        assert.equal(pageOf(result, 'm503', 'a')!.shown.data.title, 'A1');
        assert.equal(pageOf(result, 'm600', 'a')!.shown.data.title, 'A3');
    });
});
