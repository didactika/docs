/**
 * What every component of the site needs to know about the products and the languages, read once from what tools/sync.ts wrote.
 *
 * It reads the file with fs and not with an import, because the file is generated: it does not exist when the types are checked.
 */

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

export interface LineData {
    id: string;
    label: string;
    branch: string;
    release: string;
    extends: string | null;
    latest: boolean;
    coverage: Record<string, number>;
    pages: number;
    sections: string[];
    /** Page ids of the version, to link a page to the same page of another version only when it exists there. */
    pageIds: string[];
}

export interface DirectoryData {
    published: boolean | null;
    url: string | null;
    /** The release the directory offers for a branch of Moodle, as `{branch: '5.3', release: '1.1.0-m503'}`. */
    releases: Array<{branch: string; release: string}>;
}

export interface ProductData {
    slug: string;
    kind: 'plugin' | 'package';
    repo: string;
    component: string | null;
    title: Record<string, string>;
    summary: Record<string, string>;
    /** Address of the icon of the product, or null when it has none. */
    icon: string | null;
    directory: DirectoryData;
    lines: LineData[];
}

export interface LanguageData {
    code: string;
    name: string;
    dir: 'ltr' | 'rtl';
}

/** A product that is not documented yet, from roadmap.json, with what the Moodle directory says about it. */
export interface SoonData {
    component: string;
    repo: string;
    title: Record<string, string>;
    summary: Record<string, string>;
    published: boolean | null;
}

export interface SiteData {
    languages: LanguageData[];
    products: ProductData[];
    coming: SoonData[];
}

const file = join(process.cwd(), 'src', 'data', 'products.generated.json');

let cached: SiteData | undefined;

export function site(): SiteData {
    cached ??= existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as SiteData) : {languages: [], products: [], coming: []};
    return cached;
}

const dictionaries = import.meta.glob<Record<string, string>>('../i18n/*.json', {eager: true, import: 'default'});

const dictionary = (code: string): Record<string, string> => dictionaries[`../i18n/${code}.json`] ?? {};

/** A text of the interface in a language; what that language lacks is taken from English. */
export function t(lang: string, key: string, values: Record<string, string> = {}): string {
    const text = dictionary(lang)[key] ?? dictionary('en')[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');
}

/** A text of a product (title, summary) in a language, or in English when it has none in that language. */
export const localised = (texts: Record<string, string>, lang: string): string => texts[lang] ?? texts.en ?? '';

/**
 * The page inside its version (`guides/install`, or `index`), from the identifier Starlight gives the page: `en/plugins/<slug>/<line>/guides/install`,
 * or the same without the line for the address without a version.
 */
export function pageIdOf(routeId: string, slug: string, line?: string): string {
    const withoutLanguage = routeId.replace(/^[a-z]{2,3}(?:-[A-Za-z0-9]+)?\//, '');
    return withoutLanguage.replace(new RegExp(`^(?:plugins|packages)/${slug}(?:/${line ?? ''})?(?:/|$)`), '') || 'index';
}

export const productsOf =(kind: ProductData['kind']): ProductData[] => site().products.filter((product) => product.kind === kind);

export const latestLine = (product: ProductData): LineData => product.lines.find((line) => line.latest) ?? product.lines[product.lines.length - 1];

/** The address of a product in a language, and in one version of it when a line is given. */
export const productUrl = (lang: string, product: ProductData, line?: string): string =>
    `/${lang}/${product.kind === 'plugin' ? 'plugins' : 'packages'}/${product.slug}/${line ? `${line}/` : ''}`;
