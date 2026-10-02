# Contributing

bio.viz follows safety.viz's house rules; this file is that repository's CONTRIBUTING trimmed to what exists here. The obot program's standards — the issue contract, ways of working and developer guidelines in [jwildfire/obot.roadmap `docs/`](https://github.com/jwildfire/obot.roadmap/tree/main/docs) — apply in full.

## Setup

```sh
npm ci
npx playwright install chromium
```

## Commands

| Command                                   | Purpose                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run build`                           | esbuild `src/main.js` into versioned IIFE + ESM bundles under `dist/bio.viz-{version}/`    |
| `npm run build:check-dist`                | Rebuild to a scratch directory and fail if committed `dist/` has drifted from `src/`       |
| `npm test`                                | Vitest unit tests (`tests/unit/`)                                                          |
| `npm run test:e2e`                        | Playwright browser tests (`tests/e2e/`) against the committed bundle and the built site    |
| `npm run format` / `npm run format:check` | Prettier write / check                                                                     |
| `npm run evidence` / `evidence:check`     | (Re)build `docs/evidence/<module>/evidence.json` from a fresh run / CI freshness guard     |
| `npm run requirements` / `:check`         | (Re)build `docs/requirements/<module>.json` requirement-text extracts / CI freshness guard |
| `npm run site`                            | Build the site into `_site/` (gitignored); fails on a broken internal link                 |

`dist/` is committed — after any change under `src/`, run `npm run build` and commit the regenerated bundle alongside it. CI's drift check fails the build otherwise. The browser fixtures load the bundle by its versioned path, and the same check fails if a fixture names a version other than the one in `package.json`.

## What does not belong here

- Statistical inference. Every test a chart prints is computed by R, in [gsm.bio](https://github.com/jwildfire/gsm.bio); bio.viz asks for it through the connection to R and draws the answer. Do not add a JavaScript implementation of a test, an interval or a p-value adjustment.
- A second copy of the p-value rules. A chart prints a test result through `BioViz.r.formatStatistic` and nowhere else.
- Runtime dependencies. safety.viz and webR are loaded beside the bio.viz bundle on a page and are never bundled into it; webR is loaded the first time a result is asked for. `package.json` has no `dependencies`, and a unit test keeps it that way.
- Private data. Fixtures and demo data are public or synthetic.

## How a pull request merges

Branch rulesets run the merge. An increment pull request targets `dev`, opens non-draft, and lands once the `Build, format, and test` check is green — nobody is asked to review it. A release candidate targets `main` and merges only on @jwildfire's approving review, which `main`'s ruleset requires.

One task issue, one branch named `<task-number>-<slug>` off `dev`, one pull request whose body carries the task's definition-of-done proof.

## Traceability convention

Test names are keyed to requirement IDs from the matrices in [`requirements/`](requirements/README.md) and reference the GitHub issue they belong to, in qcthat's `(#N)` style:

```js
test('CORE-API-001: a page that loads the committed bundle reads BioViz.version as the package version (#1)', …)
```

where `#N` is the bio.viz task issue for the work. The matrix's `Evidence Type` column routes each row: `unit` rows → Vitest, `browser` rows → Playwright.

Infrastructure tests that are not tied to a requirement row (the tests of the scripts themselves) omit the ID but still carry the `(#N)` issue reference.

Development is test-first: matrix row → failing test → minimal implementation.

## Evidence pipeline

Each module owns one evidence set: `docs/evidence/<module>/evidence.json`. `npm run evidence` runs Vitest and Playwright once each and routes every test record to its module by test-file path:

- `tests/unit/<module>/**` → `<module>`
- `tests/e2e/<module>.spec.js` → `<module>`
- everything else (`tests/e2e/site.spec.js`, `tests/unit/evidence.test.js`, `tests/unit/site/`, `tests/unit/no-absolute-paths.test.js`) is shared scaffold evidence, included in every module's `evidence.json`

`<module>` must match a `module` entry in `site/config.json` — that registry is the module universe, so plugging a new module in takes no pipeline edits: add the config entry, name the test paths as above, and its evidence set appears on the next `npm run evidence`.

Besides `module` and `records`, each `evidence.json` carries provenance in three top-level keys — `generatedAt`, `environment` (`{ os, node, playwright, chromium }` versions), and `run` (`{ id, url }` of the GitHub Actions run, `null` for local runs). The freshness guard (`npm run evidence:check`, run by CI) ignores provenance and compares only the record set and pass/fail statuses, keyed by test title — so do not rename a test without regenerating evidence.

Not carried over from safety.viz yet: evidence screenshots, their Linux-canonical baselines and the workflow that refreshes them. No test here captures a screenshot; they arrive with the first chart, along with the gallery, the per-module evidence page and the API reference.

## The site

`npm run site` builds `_site/` from `site/` and the committed artifacts, with relative URLs throughout, so one build serves any path. The Pages workflow writes it to the `gh-pages` branch:

| Trigger                         | Published to                         |
| ------------------------------- | ------------------------------------ |
| push to `main`                  | the branch root — the released site  |
| push to `dev`                   | `dev/`                               |
| pull request from a branch here | `pr/{N}/`, with a comment linking it |
| pull request closed             | `pr/{N}/` pages redirect to `dev/`   |

Every page must hold at a 390px-wide viewport with no horizontal scroll; `tests/e2e/site.spec.js` measures the home page, and a new page gets the same assertion.

## Chart definition of done

A chart is not done until it is on the site with a gallery card, a live demo against committed public or synthetic data, an evidence page green for every row of its matrix, an API reference, and its gsm.bio widget — the same gate safety.viz charts pass.
