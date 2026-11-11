import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {defineConfig} from 'astro/config';
import starlight from '@astrojs/starlight';
import type {StarlightUserConfig} from '@astrojs/starlight/types';

interface Language {
    code: string;
    name: string;
    dir?: 'ltr' | 'rtl';
    enabled: boolean;
}

interface Product {
    slug: string;
    kind: 'plugin' | 'package';
    title: Record<string, string>;
    lines: Array<{id: string; label: string; latest: boolean; sections: string[]}>;
}

const json = <T>(path: string, fallback: T): T => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback);

// The languages are data (languages.json): adding one is an entry there, not a change here.
const languages = json<Language[]>('./languages.json', []).filter((language) => language.enabled);
const locales = Object.fromEntries(languages.map((language) => [language.code, {label: language.name, lang: language.code, dir: language.dir ?? 'ltr'}]));

// The products come from tools/sync.ts, which runs before every build.
const products = json<{products: Product[]}>('./src/data/products.generated.json', {products: []}).products;
const translated = (texts: Record<string, string>) => Object.fromEntries(languages.map((language) => [language.code, texts[language.code] ?? texts.en]));

// A text of the interface in each language (src/i18n/<language>.json); what a language lacks is taken from English.
const dictionaries = Object.fromEntries(languages.map((language) => [language.code, json<Record<string, string>>(join('./src/i18n', `${language.code}.json`), {})]));
const uiText = (key: string, fallback: string): Record<string, string> => Object.fromEntries(languages.map((language) => [language.code, dictionaries[language.code][key] ?? dictionaries.en?.[key] ?? fallback]));
const titleCase = (name: string): string => name.replace(/-/g, ' ').replace(/^./, (first) => first.toUpperCase());

const kinds = [
    {kind: 'plugin', label: 'Plugins', es: 'Plugins', dir: 'plugins'},
    {kind: 'package', label: 'Packages', es: 'Paquetes', dir: 'packages'},
] as const;

const sidebar: NonNullable<StarlightUserConfig['sidebar']> = kinds
    .filter(({kind}) => products.some((product) => product.kind === kind))
    .map(({kind, label, es, dir}) => ({
        label,
        translations: {es},
        items: products
            .filter((product) => product.kind === kind)
            .map((product) => ({
                label: product.title.en,
                translations: translated(product.title),
                collapsed: true,
                // One group for each version, newest first, so the navigation stays in the version the reader is in.
                items: [...product.lines].reverse().map((line) => ({
                    label: line.label,
                    collapsed: !line.latest,
                    items: [
                        {label: uiText('overview', 'Overview').en, translations: uiText('overview', 'Overview'), slug: `${dir}/${product.slug}/${line.id}`},
                        ...line.sections.map((section) => ({
                            label: uiText(`section.${section}`, titleCase(section)).en,
                            translations: uiText(`section.${section}`, titleCase(section)),
                            items: [{autogenerate: {directory: `${dir}/${product.slug}/${line.id}/${section}`}}],
                        })),
                    ],
                })),
            })),
    }));

export default defineConfig({
    site: 'https://docs.didactika.org',
    trailingSlash: 'always',
    build: {format: 'directory'},
    // In Docker the files change on the other side of a mount, where the system does not tell the watcher; polling does the same job.
    vite: {server: {watch: {usePolling: process.env.DOCS_POLL === '1'}}},
    integrations: [
        starlight({
            title: {en: 'Didactika Docs', es: 'Documentación de Didactika'},
            description: 'The documentation of the Moodle plugins and the npm packages of Didactika.',
            defaultLocale: 'en',
            locales,
            // The header, the title of a page, the navigation and the foot are drawn by the components of Didactika (src/components).
            components: {
                Header: './src/components/Header.astro',
                PageTitle: './src/components/PageTitle.astro',
                Sidebar: './src/components/Sidebar.astro',
                Footer: './src/components/Footer.astro',
            },
            favicon: '/brand/favicon.ico',
            head: [
                {
                    tag: 'script',
                    content: "(function(){var a=new URLSearchParams(location.search).get('mode');if(a==='dark'||a==='light'){try{localStorage.setItem('starlight-theme',a);}catch(e){}document.documentElement.dataset.theme=a;}})();",
                },
                {tag: 'link', attrs: {rel: 'icon', href: '/brand/favicon.svg', type: 'image/svg+xml'}},
                {tag: 'link', attrs: {rel: 'icon', href: '/brand/favicon-32x32.png', sizes: '32x32', type: 'image/png'}},
                {tag: 'link', attrs: {rel: 'icon', href: '/brand/favicon-16x16.png', sizes: '16x16', type: 'image/png'}},
                {tag: 'link', attrs: {rel: 'apple-touch-icon', href: '/brand/apple-touch-icon.png'}},
                {tag: 'meta', attrs: {property: 'og:image', content: 'https://docs.didactika.org/brand/og-image.png'}},
            ],
            social: [{icon: 'github', label: 'GitHub', href: 'https://github.com/didactika'}],
            customCss: ['./src/styles/didactika.css'],
            sidebar,
        }),
    ],
});
