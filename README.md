# Didactika Docs

The documentation portal of Didactika: the Moodle plugins and the npm packages, by version and language. It is published at <https://docs.didactika.org/> (GitHub Pages, from `main`).

This repository holds the site, not the documentation. **The documentation of a product lives in the `docs/` folder of its own repository**, next to the code it describes, and is read from there on every build.

## How it works

```
manifest.json            the products that are published
languages.json           the languages of the documentation (data, not code)
tools/lib/resolve.ts     which file shows each page in each version and language (pure, tested)
tools/lib/source.ts      reads a product from a git clone: its lines (branches), docs.json and docs/
tools/sync.ts            resolves every product and writes the pages Starlight builds
src/                     the Starlight site, with the colours and the brand of Didactika
```

`npm run build` runs `tools/sync.ts`, which clones or fetches each repository of `manifest.json`, resolves it and writes `src/content/docs/<language>/<plugins|packages>/<slug>/…`. Those folders and `src/data/products.generated.json` are generated and ignored by git.

### Versions

A plugin has one **line** for `main` and one for each `MOODLE_*_STABLE` branch. The id of a line is read from `version.php` (`$plugin->release` ends in `-m405`), and its label from `$plugin->supported` ("Moodle 4.5 – 5.2"). The oldest line is the base, and each line inherits from the one before it.

For a page of a line, the file shown is the one of the most recent line of its chain that has it:

| In the later line | Result |
| --- | --- |
| nothing | the page is inherited |
| a file at the same path | it replaces the inherited one |
| a file at a new path | the page is added |
| a file with `hidden: true` and a `reason` | the page is removed from that line on |

A later line keeps only what differs; a file identical to the one it would inherit is reported as `redundant-override`.

### Languages

English is the source and every page is written in it first. A page is `docs/<language>/<path>.md`, and `docs/_assets/` holds what every language shares. **English and Spanish are required**: a page missing in Spanish, or whose Spanish version is older than the English one of a later line, fails the build.

A language is an entry in `languages.json` and a texts file in `src/i18n/`. Nothing else changes. A language that is not `required` falls back to English with a notice, one page at a time.

## Commands

```bash
npm ci
npm test            # the resolution of versions and languages, and the reader of repositories
npm run typecheck
npm run build       # sync + the site; the job `build` of CI runs the three
npm run dev
```

Node 22.23 or later is required. To try the site with clones you already have, without fetching them:

```bash
DOCS_SOURCES=/path/to/clones DOCS_NO_FETCH=1 npm run build
```

## Adding a product

1. In its repository, add `docs/docs.json` on `main`, and the pages under `docs/en/` and `docs/es/`.
2. Add it to `manifest.json`.
3. Run the build. It reports every missing translation and every file that should not be there.

## Licence

GPL-3.0-or-later, as Moodle.
