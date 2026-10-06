# bio.viz

Chart.js charts for biomarker data, beside safety.viz. Every statistical test is computed by R; this library holds no inference code.

## Commands

```sh
npm ci                        # install
npm run build                 # src/ -> dist/bio.viz-{version}/ (IIFE global BioViz + ESM); dist/ is committed
npm run build:check-dist      # fails if committed dist/ differs from a fresh build
npm test                      # Vitest unit tests (tests/unit/)
npm run test:e2e              # Playwright browser tests (tests/e2e/); builds the site first
npm run format:check          # Prettier (npm run format to fix)
npm run requirements          # requirements/*.md -> docs/requirements/<module>.json (:check to verify)
npm run specification         # every chart's settings -> src/data/specification.schema.json (:check to verify)
npm run evidence              # run both suites -> docs/evidence/<module>/evidence.json (:check to verify)
npm run site                  # build the site into _site/ (gitignored)
npm run fixtures:check        # desktop R re-derives every committed expected result (needs R)
npm run data:check            # the vendored synthetic study matches its record (:check-source asks gsm.bio)
npm run kit:check             # the vendored safety.viz bundle matches its record (:check-source asks safety.viz)
npm run statistics:check      # the vendored gsm.bio statistics file matches its record (:check-source asks gsm.bio)
```

Before a pull request: `npm run format:check`, `build:check-dist`, `test`, `test:e2e`, `evidence:check` and `requirements:check` all pass. CI runs the same.

## Rules that are easy to break

- After any change under `src/`, run `npm run build` and commit `dist/` with it.
- After adding, removing or renaming a test, run `npm run evidence` and commit `docs/evidence/`.
- After adding, removing or renaming a chart's setting, run `npm run specification` and commit `src/data/specification.schema.json`, the schema of a chart's specification, written from every chart's settings; `npm test` fails when it is stale. A specification is data: never let one hold, or be read as, anything that runs.
- Name a test by the requirement ID it evidences and the issue it belongs to: `'CORE-API-001: … (#1)'`. Unit tests for a module go in `tests/unit/<module>/`, browser tests in `tests/e2e/<module>.spec.js`, or `tests/e2e/<group>-<module>.spec.js` where one filter should run several modules' specs: the correlation matrix's are `association-correlation-matrix.spec.js`, so `npm run test:e2e -- association` runs both charts of that requirement.
- No statistical inference in JavaScript. A chart chooses which R function and arguments to ask for, asks R through the connection, and prints what comes back through `src/r/formatStatistic.js`. No test, estimate, interval, adjustment or minimum group size is worked out or defaulted in JavaScript.
- `src/core/` is pure: no page, no chart, no network, nothing imported from outside it. A chart takes its variables through `core.variable` and its rows through `core.frame`; do not resolve a variable anywhere else.
- A chart is built from `SafetyViz.kit`, found on the page when the chart is made. Nothing under `src/` imports safety.viz or Chart.js. Never edit `site/vendor/safety.viz/`: it is safety.viz's bundle, copied by `node tools/vendor-safety-viz.mjs`.
- A chart may describe the values it draws (counts, quantiles, a mean, a density outline) and nothing more. Those numbers are held to desktop R by `tests/fixtures/group-comparison-r.json`, which `Rscript tools/r-group-comparison.R` writes; never type a number into it.
- No runtime dependencies in package.json. safety.viz and webR are loaded beside the bundle on a page, never bundled; webR is loaded on first use.
- The only file that knows webR's API is `src/r/webREngine.js`. Unit and browser tests of the connection use a stub engine or the stand-in at `tests/e2e/fixtures/fake-webr/`; they never reach the network.
- The `RCON-LIVE-*` browser tests, the group comparison chart's `GC-STAT-034` to `GC-STAT-042` and `GC-OVW-019`, the association scatter's `AS-LIVE-*`, the correlation matrix's `CM-LIVE-*`, the biomarker screen's `BS-LIVE-*`, the cross-tabulation's `CT-LIVE-*` and the stratified survival chart's `SS-LIVE-*` (which also installs the survival package) run real R from webR's public CDN and need the network. They fail when it is unreachable; do not make them skip or retry. Every other test that opens a page with R attached keeps R's hosts out of reach (`blockR`).
- Never edit `site/vendor/gsm.bio/`: it is gsm.bio's statistics file, copied by `node tools/vendor-statistics.mjs`. After copying it again, run `npm run fixtures`: the expected results name the copy they were made from.
- Never type a number into `tests/fixtures/group-statistics-r.json`, or a row into `tests/fixtures/group-statistics/`. The rows are written by `node tools/derive-group-statistics.mjs` from the demo's own settings with the chart's own code, and the results by `Rscript tools/r-group-statistics.R` from those rows. Rerun both, in that order, when the demo's settings, the core's frame or what the chart sends R changes.
- What the chart sends R (`statisticRequest` in `src/group-comparison/statistic.js`) is a contract with gsm.bio's widget, which writes stored results under the same key. Changing a member of `args` or `dataId` breaks pages already saved: change `docs/group-comparison.md` and the R recipe in `tools/r-group-statistics.R` with it.
- The group comparison chart's defaults open the trend tiles: `start_value: null` is every biomarker and `visits: null` every visit the chart draws. A test, a fixture or a demo of one biomarker at one visit names both; do not lean on the defaults. The tiles ask R for nothing and print no statistic: keep it that way, and test it with R's hosts recorded, not only blocked. Which level is drawn is decided in `src/group-comparison/level.js` and nowhere else.
- A trend tile's numbers (a group's median and mean at a visit, the standard deviation at baseline that sets how far its axis reaches) describe the values drawn and compare no group with another. They are held to desktop R by the `tiles` member of `tests/fixtures/group-comparison-r.json`; never type a number into it.
- Unscheduled visits are left out of the group comparison chart at every level unless switched on, by safety.viz's rule under safety.viz's setting names. The rule is the core's (`src/core/unscheduled.js`), a copy of safety.viz's held to safety.viz's own code in the vendored bundle by `CORE-VISIT-002`; do not change it apart from safety.viz. The chart sets the rows aside once, in `readVisits`, and draws everything from `chart.drawTables`: do not frame from `chart.tables`. The identity of the rows R is handed says `unscheduled_visits: true` only when they are drawn and the results have some.
- Never type into `tests/fixtures/group-comparison-specifications-0.2.0.json`: it is what the released chart wrote, read from the git tag by `node tools/write-released-specifications.mjs`.
- The association scatter is held to R the same way: `node tools/derive-association-statistics.mjs` writes `tests/fixtures/association-statistics/`, `Rscript tools/r-association-statistics.R` writes `tests/fixtures/association-statistics-r.json`, and `correlationRequest` and `fitRequest` in `src/association-scatter/statistic.js` are the contract, with `docs/association-scatter.md` and the R recipe in that script. The fixture rows are the values drawn; for a logarithmic axis the R script takes `log10()` itself, because `Math.log10` is not the same to the last binary place in every engine. Never write a logarithm into a committed file.
- The correlation matrix is held to R the same way: `node tools/derive-matrix-statistics.mjs` writes `tests/fixtures/matrix-statistics/`, `Rscript tools/r-matrix-statistics.R` writes `tests/fixtures/matrix-statistics-r.json`, and `matrixRequest` in `src/correlation-matrix/statistic.js` is the contract, with `docs/correlation-matrix.md` and the R recipe in that script, which a unit test holds equal to the one in the reference.
- The correlation matrix prints no p-value, anywhere, and computes no coefficient: a mark's width and colour and a cell's number are read off the coefficient R returned (`markOf`, `numberOf`), nothing is ordered by a coefficient, and the minimum pairs for a cell is sent to R only when the reader set one. Its cells are filled only from R's answer for the frame on screen, and returning from the scatter a cell opened draws nothing again and asks R nothing.
- The biomarker screen is held to R the same way: `node tools/derive-screen-statistics.mjs` writes `tests/fixtures/screen-statistics/`, `Rscript tools/r-screen-statistics.R` writes `tests/fixtures/screen-statistics-r.json`, and `screenRequest` in `src/biomarker-screen/statistic.js` is the contract, with `docs/biomarker-screen.md` and the R recipe in that script. It asks R once per screen and computes nothing: the rows are ordered by R's own estimate or adjusted p-value, or by name, with no key R did not return; sorting and paging ask R nothing.
- What two charts share is written once, in `src/shared/`: the statistics line's rounds and waiting state, the reading of the tables, the settings checks, and the kit's shell, filters, listing, download and participant rail. A chart imports nothing of another chart, with two exceptions, each of a public function a page calls, to open another chart in place: `src/correlation-matrix.js` imports `associationScatter`, and `src/biomarker-screen.js` imports `groupComparison`, `associationScatter` and `stratifiedSurvival`; neither imports anything under another chart's folder. What two charts share of an outcomes table is `src/shared/outcomes.js`.
- Never type a number into `site/r-check/expected.json`. It is written by `npm run fixtures` (desktop R) and checked by `npm run fixtures:check`.
- Never edit `site/data/synthetic-study/`. It is gsm.bio's study, copied byte for byte by `node tools/vendor-synthetic-study.mjs`, with a checksum per file in `SOURCE.json`.
- A module's API reference page is its reference file in `docs/`, rendered. After changing an export, a parameter or a constant, change that file; `npm run site` and `npm test` fail when they disagree.
- Every requirement row needs a test named for it, and a test may name only a row that exists; `npm run evidence` fails otherwise.
- Screenshot baselines (`docs/evidence/<module>/*.png`) are made only on the Linux CI runner: label the pull request `update-baselines`, download the `evidence-baselines` artifact, commit it. After a version change, use `update-baselines-all`, which rewrites every picture and its `.drawn.json` record of the versions it draws: pixel tolerance does not see a footnote's version. Never commit a capture from another system.
- Public or synthetic data only.
- Every page on the site holds at a 390px-wide viewport with no horizontal scroll; assert it in a browser test.
- The browser suite serves the repository root on port 8199 and refuses to reuse a server already there; set `PW_PORT` to run two worktrees side by side.

Code style is Prettier's (`.prettierrc.json`): single quotes, semicolons, 100 columns, no trailing commas. More in [CONTRIBUTING.md](CONTRIBUTING.md).

# Standards

The obot program's standards are mandatory here: the issue contract, ways of working and
developer guidelines in jwildfire/obot.roadmap `docs/` (on disk at ~/obot.roadmap/docs/
in a cloud environment). Work runs one requirement per session (`/requirement-session <hub requirement>`).
