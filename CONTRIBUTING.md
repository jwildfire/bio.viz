# Contributing

bio.viz follows safety.viz's house rules; this file is that repository's CONTRIBUTING trimmed to what exists here. The obot program's standards — the issue contract, ways of working and developer guidelines in [jwildfire/obot.roadmap `docs/`](https://github.com/jwildfire/obot.roadmap/tree/main/docs) — apply in full.

## Setup

```sh
npm ci
npx playwright install chromium
```

## Commands

| Command                                      | Purpose                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run build`                              | esbuild `src/main.js` into versioned IIFE + ESM bundles under `dist/bio.viz-{version}/`          |
| `npm run build:check-dist`                   | Rebuild to a scratch directory and fail if committed `dist/` has drifted from `src/`             |
| `npm test`                                   | Vitest unit tests (`tests/unit/`)                                                                |
| `npm run test:e2e`                           | Playwright browser tests (`tests/e2e/`) against the committed bundle and the built site          |
| `npm run format` / `npm run format:check`    | Prettier write / check                                                                           |
| `npm run evidence` / `evidence:check`        | (Re)build `docs/evidence/<module>/evidence.json` from a fresh run / CI freshness guard           |
| `npm run evidence:update`                    | Rewrite the screenshot baselines; Linux only, run by the baseline workflow                       |
| `npm run requirements` / `:check`            | (Re)build `docs/requirements/<module>.json` requirement-text extracts / CI freshness guard       |
| `npm run fixtures` / `fixtures:check`        | Write the R fixtures in desktop R / check the committed ones against R                           |
| `npm run r-check:measure`                    | Run the live browser tests and record their megabytes and seconds for the R check page           |
| `npm run data:check` / `data:check-source`   | Hold the vendored synthetic study to its record / to gsm.bio at the recorded commit              |
| `npm run kit:check` / `kit:check-source`     | Hold the vendored safety.viz bundle to its record / to safety.viz at the recorded commit         |
| `npm run statistics:check` / `:check-source` | Hold the vendored gsm.bio statistics file to its record / to gsm.bio at the recorded commit      |
| `npm run styles:check` / `:check-source`     | Hold the copied safety.viz site styles to their record / to safety.viz at the recorded commit    |
| `npm run portfolio:check` / `:check-source`  | Hold the vendored portfolio manifest schema to its record / to safety.viz at the recorded commit |
| `npm run site`                               | Build the site into `_site/` (gitignored); fails on a broken internal link                       |

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
- `tests/e2e/<group>-<module>.spec.js` → `<module>`: a spec may carry a word before its module's name, so that one filter runs several modules' specs together
- everything else (`tests/e2e/site.spec.js`, `tests/unit/evidence.test.js`, `tests/unit/site/`, `tests/unit/no-absolute-paths.test.js`) is shared scaffold evidence, included in every module's `evidence.json`

`<module>` must match a `module` entry in `site/config.json` — that registry is the module universe, so plugging a new module in takes no pipeline edits: add the config entry, name the test paths as above, and its evidence set appears on the next `npm run evidence`.

Besides `module` and `records`, each `evidence.json` carries provenance in three top-level keys — `generatedAt`, `environment` (`{ os, node, playwright, chromium }` versions), and `run` (`{ id, url }` of the GitHub Actions run, `null` for local runs). The freshness guard (`npm run evidence:check`, run by CI) ignores provenance and compares only the record set and pass/fail statuses, keyed by test title — so do not rename a test without regenerating evidence.

The same run checks traceability, in every mode: it fails when a requirement row has no test named for it, and when a test names a requirement that is in no matrix.

### Screenshots

A browser test captures a screenshot with `captureEvidence(target, requirementId, slug)` from `tests/e2e/evidence.js`. The file is `docs/evidence/<module>/<requirementId>-<slug>.png`, and it is three things at once: the baseline the test compares against, the evidence, and the image the module's evidence page shows under that requirement. The module is the spec file's, by the rule above; `tests/e2e/site.spec.js` passes `{ module: 'core' }`, because the site's requirement rows are in the core matrix.

Baselines belong to the Linux runner continuous integration uses. Font rendering differs between systems, so a capture is compared with its baseline only there; on any other system `captureEvidence` writes a preview under `test-results/evidence-preview/` and asserts nothing. A new or changed capture therefore fails in continuous integration until its baseline is made on that runner:

1. Put the label `update-baselines` on the pull request (or run the workflow "Update evidence baselines" from the Actions tab against the branch). The workflow reruns the browser tests with `--update-snapshots` and uploads the refreshed `docs/evidence/` folder as the artifact `evidence-baselines`. It commits nothing: a commit pushed by a workflow starts no continuous-integration run, so the pull request's required check would never report.
2. Download the artifact into the branch and commit it: `gh run download <run id> -R jwildfire/bio.viz -n evidence-baselines -D docs/evidence`, then `git add docs/evidence`, commit and push.
3. Take the label off. The workflow runs once each time the label is put on, so to run it again after a push, take the label off and put it back.

A refresh rewrites only the pictures that differ from their baselines by more than the pixel tolerance, and a footnote that now names another version (`bio.viz 0.2.0`) changes too few pixels to pass it. So beside each picture `captureEvidence` keeps `<name>.drawn.json`, written whenever the picture is written: the versions of bio.viz the capture drew, read as text; the picture's sha256, so a picture swapped back from another commit is caught however few of its pixels differ; and, for a capture that shows other pictures (the gallery's page), the pictures it shows. Such a picture of pictures is checked for its own text and bytes, while the pictures it shows are each held by their own records: the site under test is built before a refresh rewrites them, so its copy of them always lags by one refresh. A run that does not rewrite a picture fails when the page now draws another version than the one kept, and a unit test (CORE-SITE-017) fails when any committed picture's record names a version other than the package's. After the version changes, or whenever a picture is stale, use the label `update-baselines-all` instead (or tick `all` when running the workflow by hand): it reruns the browser tests with `--update-snapshots=all`, which rewrites every picture and its record.

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

## safety.viz's bundle

What two charts share is written once, in `src/shared/`, and a chart imports nothing of another chart, with two exceptions: the correlation matrix opens the association scatter for a pair, and the biomarker screen opens the group comparison or the scatter for a row, so their entry files import those charts' public functions, the ones a page calls, and nothing under those charts' folders. The paging of a long list, the way back to a chart that opened another and the reading of participant-level numbers are shared parts too. `tests/unit/association-scatter/bundle.test.js`, `tests/unit/correlation-matrix/bundle.test.js` and `tests/unit/biomarker-screen/bundle.test.js` hold all of it.

A chart is built from safety.viz's kit, and safety.viz is loaded beside bio.viz on a page, never bundled into it. The site and the browser tests load one copy of safety.viz's script-tag bundle, `site/vendor/safety.viz/safety.viz.js`: the site publishes it at `vendor/safety.viz/safety.viz.js`, and a fixture page loads `/site/vendor/safety.viz/safety.viz.js` from the repository root the suite serves.

- `node tools/vendor-safety-viz.mjs` copies the file byte for byte from the head of safety.viz's `dev` branch and writes `SOURCE.json` beside it: the safety.viz commit and version, and the file's checksum and size. `--ref` names another branch or a commit, and `--unmerged "<why, and what to do later>"` records that the commit is not on `dev`.
- The copy in the repository is from safety.viz's `dev` branch at the commit its record names (`merged_to_dev: true`). To take in a later safety.viz, run the tool with no arguments, commit the result and rerun the tests.
- Every chart builds its filters through the kit's `reconcileFilters`, in `addFilterControls` (`src/shared/chartHost.js`), as safety.viz's charts do, so a filter spec means the same in both libraries: `start` sets what a filter opens on and All stays on offer, and only `all: false` removes All.
- Never edit that folder. `npm test` and the site build fail when the file and its record disagree (`npm run kit:check`), and `npm run kit:check-source`, which continuous integration runs, compares the file with safety.viz at the recorded commit.
- Nothing under `src/` imports safety.viz or Chart.js. A chart finds the kit on the page, as `SafetyViz.kit`, when it is made. `tests/unit/group-comparison/bundle.test.js` fails if either library gets into bio.viz's bundle.

## The chart list

`src/data/portfolio.json` lists every available chart in safety.viz's portfolio manifest format, version 2, so safety.viz's demo app can list bio.viz's charts and draw them beside its own. The bundle exports it as `BioViz.portfolio` and the site publishes it as `portfolio.json`. Each entry says the chart's export and title, that its library is `bio.viz`, the group it is listed under (`biomarkers`, declared in the list's `groups`), the tables its `init` takes (`results` from the labs and vitals domain, required, and `participants` from the subject-level domain, optional), and for each column setting the domain and default column it reads and whether the chart needs it. Unmapped settings are left out (`unmappedSettings: "omit"`), because a chart refuses `null` for the columns it needs.

- The format is safety.viz's and is never redefined here. `node tools/vendor-portfolio-schema.mjs` copies safety.viz's `src/data/schema/portfolio.json` byte for byte from the head of its `dev` branch to `src/data/schema/portfolio.json` and writes `SOURCE.json` beside it. Never edit that folder: `npm test` fails when the file and its record disagree, and `npm run portfolio:check-source`, which continuous integration runs, compares it with safety.viz at the recorded commit.
- `tests/unit/core/portfolio.test.js` validates the list against the copy and holds it to the charts: one entry for each available chart in `site/config.json` and no other, and in each entry exactly the chart's column settings (the keys of its `DEFAULT_SETTINGS` ending in `_col` or carrying `_col_`), each with the chart's default, required where the chart refuses `null` for it.
- A setting names a column only of a table the entry lists. A column setting of any other table, which today is the outcomes table of the biomarker screen's hazard-ratio rows ([#63](https://github.com/jwildfire/bio.viz/issues/63)), is listed with `column: null` and `required: false`, whatever the chart's default: a host has no such table to map, skips the setting, and the chart keeps its default for a page that hands it the table. The test learns which settings those are from `OUTCOME_DEFAULTS` in `src/shared/outcomes.js`, not from a list of names.
- Every column the list names is a column of its domain in safety.viz's standard set. The set is not written down here: the test reads `SafetyViz.portfolio.domains` out of the vendored safety.viz bundle (`site/vendor/safety.viz/`), the manifest a host checks a chart list against, so it moves when the bundle is copied again. safety.viz's app leaves a whole chart out when one setting names a column its domain does not have (`entryProblem` in its `src/app/libraries.js`), and this test fails first.
- The participant is read from each file by its own setting. `id_col` reads the results and `participant_id_col` the participant table, whose standard column is `USUBJID` in the subject-level domain. The chart's default for it is `null`, meaning `id_col`'s name. So when the two files call the participant differently the app maps each file's own name, and no setting reads a column from two domains.

## gsm.bio's statistics file, and the chart's expected results

R in the browser is given one file, gsm.bio's `inst/statistics/statistics.R`, and this repository keeps a copy of it at `site/vendor/gsm.bio/statistics.R`. The site publishes it at `vendor/gsm.bio/statistics.R`, where a demo page hands it to its connection as `sourceUrl`.

- `node tools/vendor-statistics.mjs` copies the file byte for byte from the head of gsm.bio's `dev` branch and writes `SOURCE.json` beside it: the gsm.bio commit, its version and licence, and the file's checksum and size. Never edit that folder. `npm test` and the site build fail when the file and its record disagree (`npm run statistics:check`), and `npm run statistics:check-source`, which continuous integration runs, compares the file with gsm.bio at the recorded commit.
- The file is sourced with base R alone. It names the survival package only inside its survival functions, so a page whose chart calls none of them installs no R package; the group comparison demo gives its connection `packages: []`.
- What the group comparison chart prints is held to desktop R running the same file. `node tools/derive-group-statistics.mjs` writes, for a list of cases, the rows the chart hands R: each case is one panel of the gallery's demo in one view, made with the chart's own code from the demo's own tables and settings, under `tests/fixtures/group-statistics/`. `Rscript tools/r-group-statistics.R` reads those rows, sources the vendored file, and writes what R answered to `tests/fixtures/group-statistics-r.json`, with the R version and the commit and checksum of the statistics file. Never type a number into that file or a row into that folder. `npm run fixtures` runs the R script with the other two, and `npm run fixtures:check` reruns it and compares.
- Rerun both, in that order, after copying the statistics file again or changing the demo's settings, the core's frame or what the chart sends R. The unit tests fail when the rows are not what the chart's code derives, and when the expected results were made from another copy of the statistics file than the one vendored.
- Each expected result is a stored result: R writes the function's name, its arguments and the identity of the rows beside the answer, by the recipe in [`docs/group-comparison.md`](docs/group-comparison.md#stored-results-from-r). The unit tests named `GC-STAT-023` hold that key to the one the chart asks with. gsm.bio's widget writes stored results by the same recipe, so a change to what the chart sends R is a change to that page first.
- The browser tests named `GC-STAT-034` to `GC-STAT-042` run the gallery's demo for real: R in the browser, from webR's public host. They hold every number to the committed desktop-R result within 1 part in 10^8, print both versions' answers and the megabytes and seconds of the first test, and write `test-results/group-comparison-measurements.json`. Like the `RCON-LIVE-*` tests they need the network, fail when R's host cannot be reached, and are not retried. Desktop R (4.3) and R in the browser (4.6) differ in one known case, `wilcox.test` with tied values in groups of fewer than 50, where the newer R computes an exact p-value and the older approximates: the tests check that a difference is that case, record both answers, and hold everything else equal. Do not widen the tolerance to pass it.
- `GC-OVW-019` is live too, with a browser of its own: it opens the demo on its trend tiles, sees that nothing is fetched for R, opens a biomarker over time and holds the p-value under every visit, unadjusted and adjusted, to desktop R, and then four of its visits, a panel each.
- One biomarker over time asks R once for a row of visits, through `Analyze_GroupDifferenceBy`. Its cases are the ones named `over-time-` in `scripts/group-statistics-lib.mjs`: the same two scripts write their long rows (a participant, a value, a group and a visit to a row) and R's answers, the member `over_time` of `tests/fixtures/group-statistics-r.json`, each beside what R gives for every visit asked about alone followed by `p.adjust()`. The unit tests named `GC-TIME-012` to `GC-TIME-014` hold the rows, the key and the p-values. The numbers its picture is drawn from are the member `over_time` of `tests/fixtures/group-comparison-r.json` (`GC-TIME-004`).
- A browser test that opens a page with R attached and is not one of those keeps R's hosts out of reach, so it stays on the machine: `blockR(page)` in `tests/e2e/group-comparison.spec.js`.
- The association scatter is held to desktop R by the same pattern, with its own files: `node tools/derive-association-statistics.mjs` writes the rows of each case under `tests/fixtures/association-statistics/`, `Rscript tools/r-association-statistics.R` writes `tests/fixtures/association-statistics-r.json` from them (`Analyze_Correlation` and `Analyze_Fit`), `npm run fixtures` and `npm run fixtures:check` run and check it with the others, the unit tests named `AS-STAT-013` hold R's keys to the chart's requests, and the browser tests named `AS-LIVE-*` run the gallery's demo against real R in the browser. The recipe for a stored result's key is in [`docs/association-scatter.md`](docs/association-scatter.md#stored-results-from-r).
- A logarithm is never written to a committed file. On a logarithmic axis the association scatter hands R the base-10 logarithm of a value, and `Math.log10` does not give the same last binary place in every JavaScript engine: Node and Chromium on one machine differ. So the committed rows are the values the chart drew, and the R script takes `log10()` of them itself, as a widget in R does. The browser's answer, on its own logarithms, agrees with desktop R's far inside the tolerance.
- R's own wording can differ between its versions as well as its numbers: R 4.3 warns `Cannot compute exact p-value with ties` from `cor.test` and R 4.6 `cannot compute exact p-value with ties`. `AS-LIVE-002` holds every number equal, checks that a difference is that sentence in another case, and records both.
- The correlation matrix is held to desktop R the same way: `node tools/derive-matrix-statistics.mjs` writes the frame of each case under `tests/fixtures/matrix-statistics/`, one row per participant with a column per variable of the grid and an empty cell for a value the participant does not have, and `Rscript tools/r-matrix-statistics.R` writes `tests/fixtures/matrix-statistics-r.json` from them (`Analyze_CorrelationMatrix`). The unit tests named `CM-STAT-009` hold R's keys to the chart's requests, and the function in that script is the recipe in [`docs/correlation-matrix.md`](docs/correlation-matrix.md#stored-results-from-r), character for character. The browser tests named `CM-LIVE-*` run the gallery's demo against real R in the browser and hold every cell's coefficient, interval and pair count to desktop R's; `CM-LIVE-006` runs real R on the fixture of thirty-six biomarkers and times grids of 66, 276 and 630 pairs. They write `test-results/correlation-matrix-measurements.json`.
- The two charts of one requirement run together: `npm run test:e2e -- association` runs `tests/e2e/association-scatter.spec.js` and `tests/e2e/association-correlation-matrix.spec.js`, the association scatter's tests and the correlation matrix's. The second file is named for that filter; its module is still `correlation-matrix`, by the routing rule under [Evidence pipeline](#evidence-pipeline). `npm run test:e2e -- correlation-matrix` runs the matrix's alone.
- The biomarker screen is held to desktop R the same way: `node tools/derive-screen-statistics.mjs` writes the frame of each case under `tests/fixtures/screen-statistics/`, one column per biomarker named by it, and `Rscript tools/r-screen-statistics.R` writes `tests/fixtures/screen-statistics-r.json` (`Analyze_Screen`). The unit tests named `BS-STAT-009` hold R's keys to the chart's requests and the recipe in [`docs/biomarker-screen.md`](docs/biomarker-screen.md#stored-results-from-r) to the script's, and `BS-STAT-012` holds a row's p-value to the group comparison's and the scatter's own expected results for that biomarker. The browser tests named `BS-LIVE-*` run the gallery's demo against real R in the browser; `npm run test:e2e -- screen` runs the chart's tests.

## Derived fixtures

Two fixtures are made from the vendored study by a recorded rule, each with a record beside it and a unit test that derives it again and compares: `scripts/derive-lib.mjs` holds the rules.

- `tests/e2e/fixtures/data/results-with-arm.csv`, written by `node tools/derive-results-with-arm.mjs`: the results of two biomarkers with the participant's arm carried on the rows, for the chart with no participant table.
- `tests/e2e/fixtures/data/results-many-biomarkers.csv`, written by `node tools/derive-many-biomarkers.mjs`: thirty-six biomarkers, three times the study's, for the group comparison chart's trend tiles, which draw every one. It is a part of the study written three times, twice with a letter added to each biomarker's name; the copies say nothing about any biomarker.

Rerun both when the vendored study changes.

## Drawing arithmetic, and R

A chart may describe the values it draws: how many, the quantiles and mean a box is drawn from, the outline of a violin. It may not compare one group with another: no test, estimate, interval, p-value or adjustment. It may choose which of R's tests to ask for, and print what R returns. That line is the same one the rest of this file draws around statistical inference.

What a chart does work out is held to desktop R. `tools/r-group-comparison.R` writes `tests/fixtures/group-comparison-r.json` from the vendored study with base R alone (`quantile(type = 7)`, `mean`, `sd`, `bw.nrd0`, a Gaussian kernel density), the unit tests named `GC-BOX-*`, `GC-VIOLIN-*`, `GC-TILE-003` and `GC-TIME-004` compare the chart's numbers with it, and `npm run fixtures:check` reruns the script. Never type a number into that file.

## The site

`npm run site` builds `_site/` from `site/` and the committed artifacts, with relative URLs throughout, so one build serves any path. Its pages:

| Page                     | Built from                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `index.html`             | the registry, with each module's counts                                                                                |
| `gallery/index.html`     | the registry (the charts, then the shared parts) and the synthetic study's source record                               |
| `<module>/evidence.html` | `docs/requirements/<module>.json`, `docs/evidence/<module>/evidence.json` and its PNG files                            |
| `<module>/api.html`      | the module's reference file in `docs/`                                                                                 |
| `<module>/index.html`    | a chart's live demo: `site/demo/<demo>` on the synthetic study, with safety.viz's bundle and gsm.bio's statistics file |
| `r-check/index.html`     | `site/r-check/`                                                                                                        |
| `portfolio.json`         | the chart list, `src/data/portfolio.json`, with the format it names at `schema/portfolio.json`                         |

### The site's styles

The site is laid out and styled as safety.viz's site is, so that a reader of one is at home on the other. It does that by loading safety.viz's own stylesheet, not by imitating it.

- `site/vendor/safety.viz-site/` holds two files of safety.viz's site, copied byte for byte from its `dev` branch: `site.css`, the stylesheet every page of that site loads, and `shell.html`, the page its header, navigation and footer are written in. `SOURCE.json` beside them names the safety.viz commit and each file's checksum. `node tools/vendor-site-styles.mjs` makes the copy again. Never edit that folder: `npm test` and the site build fail when a file and its record disagree (`npm run styles:check`), and `npm run styles:check-source`, which continuous integration runs, compares each file with safety.viz at the recorded commit.
- Every page loads that stylesheet first, published at `vendor/safety.viz-site/site.css` with its record, and then `site/site.css`. The shell is the pattern `site/shell.html` follows; it is not published.
- `site/site.css` is short, and holds only what safety.viz's site has no rule for: what keeps a page inside a 390px screen where safety.viz's lets a table or a code sample scroll (code wraps, a table restacks as a list, the Gallery list opens under the header), a few words this site's pages use, and the R check page. It defines no token and names no colour or typeface of its own: every one is a `var(--…)` of safety.viz's. Before adding a rule there, look for a class in the copied stylesheet that already does it and write that class in the page.
- A rule in `site/site.css` stops at the chart on a demo page. Name a class or an id of the site's, never a tag alone: a chart's controls and tables are made of the same tags the site's pages are, and a rule on `summary` or `th` reaches them. The one rule that is inherited, the page's wrapping of a long string anywhere, is switched off inside `#chart`.
- A chart does not wait for the page to leave it alone. The copied stylesheet styles every `table`, `th`, `td` and `h1` to `h4` by its tag, and so does safety.viz's demo app, which draws these charts too; no rule of the site's can undo that for a chart drawn somewhere else. So a table a chart makes states its own look: write `ownTable('<the table's selector>')` from `src/shared/chartHost.js` into the chart's styles, then the chart's own rules for that table after it, with a selector as specific, so they are the ones that hold. A heading a chart makes takes `ownHeading('<selector>')` the same way. A browser test named for a row holds each to the look it has on a page with no stylesheet (`tests/e2e/ownLook.js`): add one with any new table or heading.
- The pages are written in safety.viz's markup by `scripts/site-lib.mjs`: `site-header` and its `nav-group`, `tagline`, `page-tabs`, `gallery` and `card`, `facts`, `table.evidence`, `evidence-gallery`, `api-layout` and `api-toc`, `demo-page`. `tests/unit/site/siteStyles.test.js` builds one of every page and fails when a page writes a class that neither stylesheet styles, when `site/site.css` styles a class no page writes, defines a token or names a colour, or when `site/shell.html`'s header, footer or script has drifted from the copied shell's.
- After copying the styles again, run `npm test`, build the site and look at it beside safety.viz's: a test names what the shell must take from the new one, but a rule that changed under a class the pages already use is seen only by looking. Every site screenshot changes with the look, so ask for the baselines again with `update-baselines-all`.

Three things differ from safety.viz's site on purpose, each a rule in `site/site.css` with its reason beside it: a picture on a gallery card or under Visual evidence is shown whole where safety.viz's is cropped to fill its frame, because a chart's picture here carries its footnotes at the bottom; on a phone a table is a list and code wraps, because this site lets nothing run past the right edge; and the evidence table's two columns are set, three fifths and two fifths, where safety.viz's are fitted to what the table holds, because a row's picture is evidence here and must not move when a test is added to another row.

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
  "demo": "group-comparison.js",
  "hero": "GC-DRAW-001-boxes-by-arm.png",
  "api": {
    "doc": "group-comparison.md",
    "surface": ["groupComparison"],
    "source": ["src/group-comparison.js"],
    "settings": "src/group-comparison/configure.js"
  }
}
```

- A chart also names `demo`, its demo script in `site/demo/`, and may name `hero`, one of its evidence screenshots, shown on its gallery card once that screenshot is committed. Its `api.settings` is the source file that exports its `DEFAULT_SETTINGS`: the build fails when the reference file has no table row for one of them.
- `kind` is `chart` or `shared`. A chart whose `status` is `available` is listed in the gallery under Charts; a shared part (the core, the connection to R) under Shared parts. The build refuses an entry without it.
- `matrix` is the module's requirement matrix in `requirements/`. Its unit tests go in `tests/unit/<module>/` and its browser tests in `tests/e2e/<module>.spec.js` (or `<group>-<module>.spec.js`); its evidence page then lists every row with the tests named for it.
- `api.doc` is the module's reference file in `docs/`. `api.surface` lists the top-level exports of the bundle the file documents; one that is a namespace (`r`) stands for every member of it. `api.data` lists exports that are data rather than namespaces (the core's `portfolio`): each is documented under one heading of its own, and its fields are not held to the file one by one. `api.source` lists the files or folders those exports are written in.
- A chart whose `status` is `available` also gets an entry in the chart list, `src/data/portfolio.json` (see [The chart list](#the-chart-list)), with its `module` as the key and its `title`. `npm test` fails until it has one, and fails when an entry names a chart that is not available.

### The API reference

A module's API reference page is its reference file, rendered. The file is the only description of the interface, so write it for someone calling the module: a heading in code for each export (``## `createConnection(options)` ``), then what it takes and answers.

The site build, and `npm test`, hold the file to the code and fail when:

- the bundle exports something no module lists in `api.surface` or `api.data`, or a listed export has no heading in the reference file;
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

Every page must hold at a 390px-wide viewport with no horizontal scroll; `tests/e2e/site.spec.js` measures the home page, the gallery and every module's evidence page and API reference, and the header on one of every kind of page with its Gallery list open, and a new page gets the same assertion. A table, in a reference file or on an evidence page, is restacked as a list on a narrow screen rather than scrolled sideways.

## Chart definition of done

A chart is not done until it is on the site with a gallery card, a live demo against committed public or synthetic data, an evidence page green for every row of its matrix, an API reference, and its gsm.bio widget — the same gate safety.viz charts pass. The gallery card, the live demo page, the evidence page and the API reference all come from the chart's registry entry.
