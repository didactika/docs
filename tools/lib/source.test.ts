import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {lineLabel, moodleVersion, readComponent, readProduct, readVersionPhp} from './source.ts';

const versionPhp = (release: string, low: number, high: number): string =>
    `<?php\n$plugin->version = 2026110700;\n$plugin->release   = '${release}';\n$plugin->supported = [${low}, ${high}];\n`;

describe('version.php', () => {
    it('reads the line, the release and the supported range', () => {
        assert.deepEqual(readVersionPhp(versionPhp('1.1.1-m405', 405, 502)), {id: 'm405', release: '1.1.1-m405', low: 405, high: 502});
    });

    it('is not a line without the -m suffix or the range', () => {
        assert.equal(readVersionPhp(versionPhp('1.1.1', 405, 502)), undefined);
        assert.equal(readVersionPhp("<?php\n$plugin->release = '1.0.0-m405';\n"), undefined);
    });

    it('reads the component of the plugin', () => {
        assert.equal(readComponent("<?php\n$plugin->component = 'local_demo';\n"), 'local_demo');
        assert.equal(readComponent('<?php\n'), null);
    });

    it('writes the label of a line', () => {
        assert.equal(moodleVersion(405), '4.5');
        assert.equal(lineLabel(405, 502), 'Moodle 4.5 – 5.2');
        assert.equal(lineLabel(503, 503), 'Moodle 5.3');
    });
});

describe('a repository with two lines', () => {
    let repo: string;
    const git = (...args: string[]): string => execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
    const write = (path: string, content: string | Buffer): void => {
        mkdirSync(dirname(join(repo, path)), {recursive: true});
        writeFileSync(join(repo, path), content);
    };

    before(() => {
        repo = mkdtempSync(join(tmpdir(), 'docs-source-'));
        git('init', '-q', '-b', 'MOODLE_405_STABLE');
        git('config', 'user.name', 'Test');
        git('config', 'user.email', 'test@example.com');
        write('version.php', versionPhp('1.1.1-m405', 405, 502));
        write('docs/en/index.md', '---\ntitle: Home\n---\n');
        write('docs/es/index.md', '---\ntitle: Inicio\n---\n');
        write('docs/_assets/shot.png', Buffer.from('89504e470d0a1a0a00ff', 'hex'));
        git('add', '-A');
        git('commit', '-q', '-m', 'base');
        git('checkout', '-q', '-b', 'main');
        write('version.php', versionPhp('1.1.1-m503', 503, 503));
        write('docs/docs.json', JSON.stringify({kind: 'plugin', slug: 'local-demo', title: {en: 'Demo', es: 'Demo'}, summary: {en: 'A demo.', es: 'Una demo.'}}));
        write('docs/en/guides/new.md', '---\ntitle: New\n---\n');
        git('add', '-A');
        git('commit', '-q', '-m', 'next');
        git('checkout', '-q', '-b', 'feature/something');
        write('version.php', '<?php\n');
        git('add', '-A');
        git('commit', '-q', '-m', 'not a line');
        git('checkout', '-q', 'main');
    });

    after(() => rmSync(repo, {recursive: true, force: true}));

    it('finds the lines of main and of the stable branches only, oldest first', () => {
        const product = readProduct(repo);
        assert.deepEqual(product.lines.map((line) => [line.id, line.branch, line.extends]), [['m405', 'MOODLE_405_STABLE', null], ['m503', 'main', 'm405']]);
        assert.deepEqual(product.lines.map((line) => line.label), ['Moodle 4.5 – 5.2', 'Moodle 5.3']);
        assert.deepEqual(product.issues, []);
    });

    it('reads docs.json from the default branch and does not treat it as a page', () => {
        const product = readProduct(repo);
        assert.equal(product.docs?.slug, 'local-demo');
        assert.ok(![...product.lines[1].files.keys()].includes('docs.json'));
    });

    it('reads the files of each line from its own branch', () => {
        const [base, next] = readProduct(repo).lines;
        assert.deepEqual([...base.files.keys()].sort(), ['_assets/shot.png', 'en/index.md', 'es/index.md']);
        assert.ok(next.files.has('en/guides/new.md'));
        assert.ok(!base.files.has('en/guides/new.md'));
    });

    it('reads a line from another ref, to preview what is not merged yet', () => {
        git('checkout', '-q', '-b', 'preview', 'main');
        write('docs/en/index.md', '---\ntitle: Preview\n---\n');
        git('add', '-A');
        git('commit', '-q', '-m', 'preview');
        git('checkout', '-q', 'main');
        const preview = readProduct(repo, {refs: {main: 'preview'}});
        assert.equal(preview.lines[1].branch, 'main');
        assert.ok(preview.lines[1].files.get('en/index.md')!.includes('Preview'));
        assert.ok(!readProduct(repo).lines[1].files.get('en/index.md')!.includes('Preview'));
        assert.throws(() => readProduct(repo, {refs: {main: 'does-not-exist'}}), /is not a ref/);
        assert.throws(() => readProduct(repo, {refs: {feature: 'preview'}}), /is not a branch that is a line/);
    });

    it('keeps a binary asset byte for byte', () => {
        const asset = readProduct(repo).lines[0].files.get('_assets/shot.png')!;
        assert.equal(Buffer.from(asset, 'latin1').toString('hex'), '89504e470d0a1a0a00ff');
    });
});
