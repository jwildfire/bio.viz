# Contributing

bio.viz follows safety.viz's house rules; this file is that repository's CONTRIBUTING trimmed to what exists here. The obot program's standards — the issue contract, ways of working and developer guidelines in [jwildfire/obot.roadmap `docs/`](https://github.com/jwildfire/obot.roadmap/tree/main/docs) — apply in full.

## Setup

```sh
npm ci
npx playwright install chromium
```

## Commands

| Command                                    | Purpose                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `npm run build`                            | esbuild `src/main.js` into versioned IIFE + ESM bundles under `dist/bio.viz-{version}/`     |
| `npm run build:check-dist`                 | Rebuild to a scratch directory and fail if committed `dist/` has drifted from `src/`        |
| `npm test`                                 | Vitest unit tests (`tests/unit/`)                                                           |
| `npm run test:e2e`                         | Playwright browser tests (`tests/e2e/`) against the committed bundle and the built site     |
| `npm run format` / `npm run format:check`  | Prettier write / check                                                                      |
| `npm run evidence` / `evidence:check`      | (Re)build `docs/evidence/<module>/evidence.json` from a fresh run / CI freshness guard      |
| `npm run evidence:update`                  | Rewrite the screenshot baselines; Linux only, run by the baseline workflow                  |
| `npm run requirements` / `:check`          | (Re)build `docs/requirements/<module>.json` requirement-text extracts / CI freshness guard  |
| `npm run fixtures` / `fixtures:check`      | Write the R check page's expected results in desktop R / check the committed ones against R |
| `npm run r-check:measure`                  | Run the live browser tests and record their megabytes and seconds for the R check page      |
| `npm run data:check` / `data:check-source` | Hold the vendored synthetic study to its record / to gsm.bio at the recorded commit         |
| `npm run site`                             | Build the site into `_site/` (gitignored); fails on a broken internal link                  |

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

The same run checks traceability, in every mode: it fails when a requirement row has no test named for it, and when a test names a requirement that is in no matrix.

### Screenshots

A browser test captures a screenshot with `captureEvidence(target, requirementId, slug)` from `tests/e2e/evidence.js`. The file is `docs/evidence/<module>/<requirementId>-<slug>.png`, and it is three things at once: the baseline the test compares against, the evidence, and the image the module's evidence page shows under that requirement. The module is the spec file's name; `tests/e2e/site.spec.js` passes `{ module: 'core' }`, because the site's requirement rows are in the core matrix.

Baselines belong to the Linux runner continuous integration uses. Font rendering differs between systems, so a capture is compared with its baseline only there; on any other system `captureEvidence` writes a preview under `test-results/evidence-preview/` and asserts nothing. A new or changed capture therefore fails in continuous integration until its baseline is made on that runner:

1. Put the label `update-baselines` on the pull request (or run the workflow "Update evidence baselines" from the Actions tab against the branch). The workflow reruns the browser tests with `--update-snapshots` and uploads the refreshed `docs/evidence/` folder as the artifact `evidence-baselines`. It commits nothing: a commit pushed by a workflow starts no continuous-integration run, so the pull request's required check would never report.
2. Download the artifact into the branch and commit it: `gh run download <run id> -R jwildfire/bio.viz -n evidence-baselines -D docs/evidence`, then `git add docs/evidence`, commit and push.
3. Take the label off. While it is on, every push reruns the workflow.

The run that makes a module's first baseline exits 1, because the test that looks for a screenshot on the evidence page ran against a page built before the baseline existed; the artifact is uploaded all the same, and the next run is clean.

Keep captures to things that hold still: one part of a page (a locator), not a whole page that carries a date or a count of tests.

## The R check page

`site/r-check/` is a page that runs the connection against real R: two tests, each shown beside the answer desktop R gives, and the megabytes and seconds that starting R in a browser costs.

- The R both sides run is `site/r-check/statistics.R`. The tables are in `site/r-check/data/`, cut from public data by `tools/cut-r-check-fixture.mjs`; `data/SOURCE.md` says from where and under what licence.
- The expected results, `site/r-check/expected.json`, are written by `tools/r-fixtures.R` in desktop R and record the R and survival versions that made them. Never edit a number in that file: run `npm run fixtures`. `npm run fixtures:check` reruns the script and compares; with no R installed it says in capitals that nothing was checked and exits 0, and with `--require-r`, which is what CI runs after installing R, it fails instead.
- The browser tests named `RCON-LIVE-*` run the page for real. They need the network, because they load webR and the survival package from their public hosts. They fail when those cannot be reached; they do not skip and are not retried. `npm run test:e2e -- r-connection` runs them.
- The megabytes a page load costs cannot be seen from inside the page, because R's files are fetched by a worker. The live tests count them from outside, through the browser, print them, and write `test-results/r-check-measurements.json`. `R_CHECK_MACHINE="…" R_CHECK_NETWORK="…" npm run r-check:measure` also writes `site/r-check/measured.json`, the figures the page shows; commit it when the page's cost changes.

## The synthetic study

Every demo and most chart tests run on one made-up study of 200 participants, made in [gsm.bio](https://github.com/jwildfire/gsm.bio) and copied here: `site/data/synthetic-study/synthetic_results.csv`, `synthetic_participants.csv` and `synthetic_outcomes.csv`. The site publishes the folder at `data/synthetic-study/`, so a demo page reads `../data/synthetic-study/…`; a unit test reads the folder from disk, and a browser test fetches `/site/data/synthetic-study/…` from the repository root the suite serves.

- Nothing here retypes, regenerates or reshapes the study. `node tools/vendor-synthetic-study.mjs` copies the three files byte for byte from the head of gsm.bio's `dev` branch and writes `SOURCE.json` beside them: the gsm.bio commit, and each file's checksum, size, columns and row count. Rerun it when gsm.bio's study changes, and commit the result.
- Never edit a file in that folder, the record included. `npm test` fails when a file and its record disagree (`npm run data:check` says the same from the command line), and `npm run data:check-source`, which continuous integration runs, fetches the recorded commit's files from gsm.bio and fails when a vendored file differs from them.

## The site

`npm run site` builds `_site/` from `site/` and the committed artifacts, with relative URLs throughout, so one build serves any path. Its pages:

| Page                     | Built from                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `index.html`             | the registry, with each module's counts                                                     |
| `gallery/index.html`     | the registry (the charts, then the shared parts) and the synthetic study's source record    |
| `<module>/evidence.html` | `docs/requirements/<module>.json`, `docs/evidence/<module>/evidence.json` and its PNG files |
| `<module>/api.html`      | the module's reference file in `docs/`                                                      |
| `r-check/index.html`     | `site/r-check/`                                                                             |

### Registering a module

A module is one entry in `site/config.json`, and that entry is all the site, the requirement extractor and the evidence pipeline need:

```json
{
  "module": "group-comparison",
  "title": "Group comparison",
  "kind": "chart",
  "status": "available",
  "blurb": "One sentence a statistician would recognise.",
  "matrix": "group-comparison.md",
  "api": {
    "doc": "group-comparison.md",
    "surface": ["groupComparison"],
    "source": ["src/group-comparison"]
  }
}
```

- `kind` is `chart` or `shared`. A chart whose `status` is `available` is listed in the gallery under Charts; a shared part (the core, the connection to R) under Shared parts. The build refuses an entry without it.
- `matrix` is the module's requirement matrix in `requirements/`. Its unit tests go in `tests/unit/<module>/` and its browser tests in `tests/e2e/<module>.spec.js`; its evidence page then lists every row with the tests named for it.
- `api.doc` is the module's reference file in `docs/`. `api.surface` lists the top-level exports of the bundle the file documents; one that is a namespace (`r`) stands for every member of it. `api.source` lists the files or folders those exports are written in.

### The API reference

A module's API reference page is its reference file, rendered. The file is the only description of the interface, so write it for someone calling the module: a heading in code for each export (``## `createConnection(options)` ``), then what it takes and answers.

The site build, and `npm test`, hold the file to the code and fail when:

- the bundle exports something no module lists in `api.surface`, or a listed export has no heading in the reference file;
- the file documents a call, `name(…)`, in a heading, and the bundle exports no `name`;
- a `@param` in the JSDoc comment above an export is not named in that export's section (a nested one, `options.browser.baseUrl`, by its path after the first name: `browser.baseUrl`);
- an exported constant's value is not given in its section.

What the checks cannot see is a sentence that has stopped being true. A change to what a function does still needs its reference read.

The Pages workflow writes the site to the `gh-pages` branch:

| Trigger                         | Published to                         |
| ------------------------------- | ------------------------------------ |
| push to `main`                  | the branch root — the released site  |
| push to `dev`                   | `dev/`                               |
| pull request from a branch here | `pr/{N}/`, with a comment linking it |
| pull request closed             | `pr/{N}/` pages redirect to `dev/`   |

Every page must hold at a 390px-wide viewport with no horizontal scroll; `tests/e2e/site.spec.js` measures the home page, the gallery and every module's evidence page and API reference, and a new page gets the same assertion. A table in a reference file is restacked as a list on a narrow screen rather than scrolled sideways.

## Chart definition of done

A chart is not done until it is on the site with a gallery card, a live demo against committed public or synthetic data, an evidence page green for every row of its matrix, an API reference, and its gsm.bio widget — the same gate safety.viz charts pass. The gallery card, the evidence page and the API reference come from the chart's registry entry; the live demo page is the chart's own to add.
