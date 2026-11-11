import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {branchesOf, checkDirectory, directoryPage} from './directory.ts';

/** A directory that has the plugin for the branches given and answers 404 for the others. */
const directory = (has: Record<string, string>, failing = false): typeof fetch =>
    (async (input: string | URL | Request) => {
        if (failing) {
            throw new Error('offline');
        }
        const branch = new URL(String(input)).searchParams.get('branch') ?? '';
        return has[branch]
            ? new Response(JSON.stringify({status: 'OK', pluginfo: {component: 'local_demo', version: {release: has[branch]}}}), {status: 200})
            : new Response('', {status: 404});
    }) as typeof fetch;

describe('branchesOf', () => {
    it('names the two ends of each range once', () => {
        assert.deepEqual(branchesOf([{low: 405, high: 502}, {low: 503, high: 503}]), ['4.5', '5.2', '5.3']);
    });
});

describe('checkDirectory', () => {
    it('is published when a branch has a release, and lists the releases', async () => {
        const answer = await checkDirectory('local_demo', ['4.5', '5.3'], undefined, directory({'4.5': '1.0.0-m405', '5.3': '1.0.0-m503'}));
        assert.equal(answer.published, true);
        assert.deepEqual(answer.releases, [{branch: '4.5', release: '1.0.0-m405'}, {branch: '5.3', release: '1.0.0-m503'}]);
        assert.ok(answer.checked);
    });

    it('is published even when only one of its branches has a release', async () => {
        assert.equal((await checkDirectory('local_demo', ['4.5', '5.3'], undefined, directory({'5.3': '1.0.0-m503'}))).published, true);
    });

    it('is not published when no branch has a release', async () => {
        const answer = await checkDirectory('local_demo', ['4.5', '5.3'], undefined, directory({}));
        assert.equal(answer.published, false);
        assert.deepEqual(answer.releases, []);
    });

    it('keeps the last answer when the directory cannot be reached', async () => {
        const previous = {published: true, releases: [{branch: '5.3', release: '1.0.0-m503'}], checked: '2026-11-10T00:00:00.000Z'};
        assert.deepEqual(await checkDirectory('local_demo', ['5.3'], previous, directory({}, true)), previous);
    });

    it('says it does not know when there is no last answer either', async () => {
        assert.deepEqual(await checkDirectory('local_demo', ['5.3'], undefined, directory({}, true)), {published: null, releases: [], checked: null});
    });
});

it('links the page of a plugin in the directory', () => {
    assert.equal(directoryPage('local_demo'), 'https://moodle.org/plugins/local_demo');
});
