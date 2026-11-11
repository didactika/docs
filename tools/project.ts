/**
 * Collects from GitHub what the footer says about Didactika, so no list of people has to be kept by hand, and writes it to
 * src/data/project.generated.json (not committed):
 *
 * - the organisation: name, website, avatar and the addresses of its repositories and people;
 * - the co-founders, who are the only people named here, with the name each one has on GitHub;
 * - the collaborators: everyone who contributed to a public repository of the organisation;
 * - the funding: what the FUNDING.yml of this repository, or of the `.github` repository of the organisation, says (it is also what
 *   GitHub uses for its Sponsor button).
 *
 * It runs before every build and the Pages workflow builds every day, so the site follows GitHub. When GitHub does not answer, the file of
 * the last build is kept and the build does not fail because of it. DOCS_NO_FETCH=1 skips it (the Docker preview).
 *
 * usage: node tools/project.ts
 *
 * @license GPL-3.0-or-later
 */

import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';

export interface Person {
    login: string;
    name: string | null;
    url: string;
    avatar: string;
    contributions: number;
}

export interface Funding {
    platform: string;
    url: string;
}

export interface Project {
    at: string | null;
    organisation: {login: string; name: string; website: string | null; avatar: string | null; url: string; repositoriesUrl: string; peopleUrl: string};
    founders: Person[];
    contributors: Person[];
    funding: Funding | null;
}

/** The co-founders of Didactika. Everyone else is a collaborator and comes from GitHub. */
export const COFOUNDERS = ['E2RD0', 'hector-ae21'];
const ORG = 'didactika';

interface ApiUser {
    login: string;
    name?: string | null;
    html_url: string;
    avatar_url: string;
    type: string;
    contributions?: number;
}
interface ApiRepo {
    name: string;
    fork: boolean;
    archived: boolean;
}

const run = (command: string): string => {
    try {
        return execSync(command, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
    } catch {
        return '';
    }
};

const token = (): string => process.env.GH_TOKEN || process.env.GITHUB_TOKEN || run('gh auth token');

const github = async <T>(path: string): Promise<T> => {
    const headers: Record<string, string> = {Accept: 'application/vnd.github+json', 'User-Agent': 'didactika-docs'};
    const key = token();
    if (key) {
        headers.Authorization = `Bearer ${key}`;
    }
    const response = await fetch(`https://api.github.com${path}`, {headers});
    if (!response.ok) {
        throw new Error(`${response.status} ${path}`);
    }
    return response.json() as Promise<T>;
};

/** The first way to support the project that a FUNDING.yml names. */
const PLATFORMS: Array<[string, string, (handle: string) => string]> = [
    ['ko_fi', 'Ko-fi', (handle) => `https://ko-fi.com/${handle}`],
    ['patreon', 'Patreon', (handle) => `https://www.patreon.com/${handle}`],
    ['open_collective', 'Open Collective', (handle) => `https://opencollective.com/${handle}`],
    ['buy_me_a_coffee', 'Buy Me a Coffee', (handle) => `https://buymeacoffee.com/${handle}`],
    ['liberapay', 'Liberapay', (handle) => `https://liberapay.com/${handle}`],
    ['github', 'GitHub Sponsors', (handle) => `https://github.com/sponsors/${handle}`],
];

export function parseFunding(yaml: string): Funding | null {
    for (const [key, platform, url] of PLATFORMS) {
        const hit = yaml.match(new RegExp(`^\\s*${key}\\s*:\\s*\\[?\\s*["']?([^"'\\]\\s,]+)`, 'm'));
        if (hit?.[1]) {
            return {platform, url: url(hit[1])};
        }
    }
    return null;
}

const fundingOf = async (repo: string, path: string): Promise<Funding | null> => {
    const file = await github<{content: string; encoding: string}>(`/repos/${ORG}/${repo}/contents/${path}`).catch(() => null);
    return file ? parseFunding(Buffer.from(file.content, file.encoding as BufferEncoding).toString('utf8')) : null;
};

const empty = (): Project => ({
    at: null,
    organisation: {login: ORG, name: 'Didactika', website: 'https://didactika.org', avatar: null, url: `https://github.com/${ORG}`, repositoriesUrl: `https://github.com/orgs/${ORG}/repositories`, peopleUrl: `https://github.com/orgs/${ORG}/people`},
    founders: [],
    contributors: [],
    funding: {platform: 'Ko-fi', url: `https://ko-fi.com/${ORG}`},
});

export async function collect(): Promise<Project> {
    const org = await github<{login: string; name: string | null; blog: string | null; avatar_url: string; html_url: string}>(`/orgs/${ORG}`);
    const repos = (await github<ApiRepo[]>(`/orgs/${ORG}/repos?type=public&per_page=100`)).filter((repo) => !repo.fork && !repo.archived);

    const founders: Person[] = [];
    for (const login of COFOUNDERS) {
        const user = await github<ApiUser>(`/users/${login}`);
        founders.push({login: user.login, name: user.name ?? null, url: user.html_url, avatar: user.avatar_url, contributions: 0});
    }

    const totals = new Map<string, Person>();
    for (const repo of repos) {
        const users = await github<ApiUser[]>(`/repos/${ORG}/${repo.name}/contributors?per_page=100`).catch(() => [] as ApiUser[]);
        for (const user of users) {
            if (user.type !== 'User') {
                continue;
            }
            const known = totals.get(user.login) ?? {login: user.login, name: null, url: user.html_url, avatar: user.avatar_url, contributions: 0};
            known.contributions += user.contributions ?? 0;
            totals.set(user.login, known);
        }
    }

    const funding = (await fundingOf('docs', '.github/FUNDING.yml')) ?? (await fundingOf('.github', '.github/FUNDING.yml')) ?? (await fundingOf('.github', 'FUNDING.yml')) ?? empty().funding;

    return {
        at: new Date().toISOString(),
        organisation: {...empty().organisation, login: org.login, name: org.name ?? org.login, website: org.blog || null, avatar: org.avatar_url, url: org.html_url},
        founders,
        contributors: [...totals.values()].sort((a, b) => b.contributions - a.contributions),
        funding,
    };
}

if (import.meta.main) {
    const root = resolve(import.meta.dirname, '..');
    const out = join(root, 'src', 'data', 'project.generated.json');
    mkdirSync(dirname(out), {recursive: true});
    if (process.env.DOCS_NO_FETCH) {
        if (!existsSync(out)) {
            writeFileSync(out, JSON.stringify(empty(), null, 1) + '\n');
        }
        console.log('project: not fetched (DOCS_NO_FETCH)');
    } else {
        try {
            const project = await collect();
            writeFileSync(out, JSON.stringify(project, null, 1) + '\n');
            console.log(`project: ${project.founders.length} founders, ${project.contributors.length} collaborators${project.funding ? `, funding on ${project.funding.platform}` : ''}`);
        } catch (error) {
            if (!existsSync(out)) {
                writeFileSync(out, JSON.stringify(empty(), null, 1) + '\n');
            }
            console.log(`project: kept the last data (${error instanceof Error ? error.message : String(error)})`);
        }
    }
    JSON.parse(readFileSync(out, 'utf8'));
}
