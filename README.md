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

## Seeing it while you work

```bash
docker compose up        # then open http://localhost:4321/
docker compose logs -f site
docker compose down
```

The site runs in a container with the development server of Astro. The products are read from clones on your machine (the folder above this repository by default, or `DOCS_SOURCES_DIR`), not from GitHub, so what you have committed locally shows up before it is pushed. The documentation is read again every few seconds and the page reloads by itself.

To see branches that are not merged yet, copy `preview.refs.example.json` to `preview.refs.json` and list there, for each product, the branch to read for each line. Anything the synchronisation finds wrong in the documentation is in the log.

## Writing a page

A page is `docs/<language>/<path>.md` in the repository of the product, with a front matter of `title`, `summary` and `order`. A value with a colon must be in quotes (`summary: "Two things: a and b"`); the build says which page breaks it.

- **Alerts:** write the ones of GitHub (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`). They read well on GitHub and become asides on the site.
- **Links to other pages of the product:** `[text](page:guides/install)` or `[text](page:guides/install#step-2)`. The link stays in the version and language the reader is in.
- **Hide a page** a later version inherits: a file at the same path with `hidden: true` and a `reason`.

## Adding a product

1. In its repository, add `docs/docs.json` on `main`, and the pages under `docs/en/` and `docs/es/`.
2. Add it to `manifest.json`.
3. Run the build. It reports every missing translation and every file that should not be there.

## Licence

GPL-3.0-or-later, as Moodle.

## Technical documentation

The technical documentation of a product (domain model, requirements, use cases, analysis, design, code map) lives in `docs/<language>/technical/` of its repository and is written with the **rup-flow Pro** skill ([where to get it](https://www.agensi.io/skills/rup-flow-pro-complete-rup-workflow-both-ways)). The portal shows it as the "Technical documentation" section of the product: the `README.md` of a folder is its index, the diagrams (`.svg`) and tables (`.csv`) next to a page are published with it, and links between files keep working. The colours of the diagrams are `rup/didactika.theme.json`; copy it into the `theme` key of the `rup.config.json` of the product.

## Publishing

The site is built and deployed by `.github/workflows/pages.yml` to <https://docs.didactika.org/> on every push to `main`, every day, and when a product repository sends the event `docs-changed`. A product repository sends it with the reusable workflow `docs-notify` of `didactika/.github`, which needs the organisation secret `DOCS_DISPATCH_TOKEN` (a fine-grained token with "Contents: read and write" on this repository).

Turning it on once, by an administrator:

```bash
gh repo edit didactika/docs --visibility public --accept-visibility-change-consequences
gh api -X POST repos/didactika/docs/pages -f build_type=workflow
gh api -X PUT repos/didactika/docs/pages -f cname=docs.didactika.org -F https_enforced=true
```

and a `CNAME` record `docs` that points to `didactika.github.io` in the DNS of didactika.org.
