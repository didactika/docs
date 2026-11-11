// The collaborators of the footer: the people who contributed to any repository of the organisation (rendered when the site was built) plus the
// public members of the organisation on GitHub, read when the page opens and kept for half an hour so a visit does not spend the limit GitHub puts
// on anonymous requests. If the members cannot be read, the footer keeps what the build rendered.
/** A person of the footer: a GitHub login with the address of the profile and of the avatar. */
interface Person { login: string; url: string; avatar: string }
interface GitHubUser { login: string; html_url: string; avatar_url: string }
interface Cached { org: string; at: number; list: Person[] }

const KEY = 'd-people';
const TTL = 30 * 60 * 1000;
const entities: Record<string, string> = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'};
const esc = (s: unknown): string => String(s).replace(/[&<>"]/g, (c) => entities[c]);

const members = async(org: string): Promise<Person[]> => {
    try {
        const cached = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Cached | null;
        if (cached && cached.org === org && Date.now() - cached.at < TTL) { return cached.list; }
    } catch (error) { /* no storage: ask every time */ }
    const response = await fetch(`https://api.github.com/orgs/${org}/public_members?per_page=100`, {headers: {Accept: 'application/vnd.github+json'}});
    if (!response.ok) { throw new Error(String(response.status)); }
    const list = ((await response.json()) as GitHubUser[]).map((u) => ({login: u.login, url: u.html_url, avatar: u.avatar_url}));
    try { sessionStorage.setItem(KEY, JSON.stringify({org, at: Date.now(), list})); } catch (error) { /* optional */ }
    return list;
};

document.querySelectorAll<HTMLElement>('[data-people]').forEach(async(box) => {
    const stack = box.querySelector<HTMLElement>('[data-people-list]');
    if (!stack) { return; }
    const skip = (box.dataset.exclude || '').toLowerCase().split(',').filter(Boolean);
    const max = Number(box.dataset.max) || 8;
    let seed: Person[] = [];
    try { seed = JSON.parse(box.dataset.seed || '[]') as Person[]; } catch (error) { /* nothing rendered by the build */ }
    try {
        const live = await members(box.dataset.org ?? '');
        const known = new Set(seed.map((p) => p.login.toLowerCase()));
        const people = [...seed, ...live.filter((p) => !known.has(p.login.toLowerCase()))].filter((p) => p.avatar && !skip.includes(p.login.toLowerCase()));
        stack.innerHTML = people.slice(0, max).map((p) => `<a href="${esc(p.url)}" title="${esc(p.login)}" aria-label="${esc(p.login)}"><img src="${esc(p.avatar)}${p.avatar.includes('?') ? '&' : '?'}s=64" alt="" width="32" height="32" loading="lazy"></a>`).join('')
            + (people.length > max ? `<a class="more" href="${esc(box.dataset.all)}" title="${esc(box.dataset.more)}">+${people.length - max}</a>` : '');
        box.classList.toggle('has-people', people.length > 0);
    } catch (error) {
        /* the members are not available: what the build rendered stays */
    }
});
