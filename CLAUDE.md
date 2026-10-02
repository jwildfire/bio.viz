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
- Name a test by the requirement ID it evidences and the issue it belongs to: `'CORE-API-001: … (#1)'`. Unit tests for a module go in `tests/unit/<module>/`, browser tests in `tests/e2e/<module>.spec.js`.
- No statistical inference in JavaScript. A chart chooses which R function and arguments to ask for, asks R through the connection, and prints what comes back through `src/r/formatStatistic.js`. No test, estimate, interval, adjustment or minimum group size is worked out or defaulted in JavaScript.
- `src/core/` is pure: no page, no chart, no network, nothing imported from outside it. A chart takes its variables through `core.variable` and its rows through `core.frame`; do not resolve a variable anywhere else.
- A chart is built from `SafetyViz.kit`, found on the page when the chart is made. Nothing under `src/` imports safety.viz or Chart.js. Never edit `site/vendor/safety.viz/`: it is safety.viz's bundle, copied by `node tools/vendor-safety-viz.mjs`.
- A chart may describe the values it draws (counts, quantiles, a mean, a density outline) and nothing more. Those numbers are held to desktop R by `tests/fixtures/group-comparison-r.json`, which `Rscript tools/r-group-comparison.R` writes; never type a number into it.
- No runtime dependencies in package.json. safety.viz and webR are loaded beside the bundle on a page, never bundled; webR is loaded on first use.
- The only file that knows webR's API is `src/r/webREngine.js`. Unit and browser tests of the connection use a stub engine or the stand-in at `tests/e2e/fixtures/fake-webr/`; they never reach the network.
- The `RCON-LIVE-*` browser tests, the group comparison chart's `GC-STAT-034` to `GC-STAT-042` and `GC-OVW-019`, and the association scatter's `AS-LIVE-*` run real R from webR's public CDN and need the network. They fail when it is unreachable; do not make them skip or retry. Every other test that opens a page with R attached keeps R's hosts out of reach (`blockR`).
- Never edit `site/vendor/gsm.bio/`: it is gsm.bio's statistics file, copied by `node tools/vendor-statistics.mjs`. After copying it again, run `npm run fixtures`: the expected results name the copy they were made from.
- Never type a number into `tests/fixtures/group-statistics-r.json`, or a row into `tests/fixtures/group-statistics/`. The rows are written by `node tools/derive-group-statistics.mjs` from the demo's own settings with the chart's own code, and the results by `Rscript tools/r-group-statistics.R` from those rows. Rerun both, in that order, when the demo's settings, the core's frame or what the chart sends R changes.
- What the chart sends R (`statisticRequest` in `src/group-comparison/statistic.js`) is a contract with gsm.bio's widget, which writes stored results under the same key. Changing a member of `args` or `dataId` breaks pages already saved: change `docs/group-comparison.md` and the R recipe in `tools/r-group-statistics.R` with it.
- The group comparison chart's defaults open the overview: `start_value: null` is every biomarker and `visits: null` every visit. A test, a fixture or a demo of one biomarker at one visit names both; do not lean on the defaults. The overview asks R for nothing: keep it that way, and test it with R's hosts recorded, not only blocked.
- The association scatter is held to R the same way: `node tools/derive-association-statistics.mjs` writes `tests/fixtures/association-statistics/`, `Rscript tools/r-association-statistics.R` writes `tests/fixtures/association-statistics-r.json`, and `correlationRequest` and `fitRequest` in `src/association-scatter/statistic.js` are the contract, with `docs/association-scatter.md` and the R recipe in that script. The fixture rows are the values drawn; for a logarithmic axis the R script takes `log10()` itself, because `Math.log10` is not the same to the last binary place in every engine. Never write a logarithm into a committed file.
- What two charts share is written once, in `src/shared/`: the statistics line's rounds and waiting state, the reading of the tables, the settings checks, and the kit's shell, filters, listing, download and participant rail. A chart imports nothing of another chart.
- Never type a number into `site/r-check/expected.json`. It is written by `npm run fixtures` (desktop R) and checked by `npm run fixtures:check`.
- Never edit `site/data/synthetic-study/`. It is gsm.bio's study, copied byte for byte by `node tools/vendor-synthetic-study.mjs`, with a checksum per file in `SOURCE.json`.
- A module's API reference page is its reference file in `docs/`, rendered. After changing an export, a parameter or a constant, change that file; `npm run site` and `npm test` fail when they disagree.
- Every requirement row needs a test named for it, and a test may name only a row that exists; `npm run evidence` fails otherwise.
- Screenshot baselines (`docs/evidence/<module>/*.png`) are made only on the Linux CI runner: label the pull request `update-baselines`, download the `evidence-baselines` artifact, commit it. Never commit a capture from another system.
- Public or synthetic data only.
- Every page on the site holds at a 390px-wide viewport with no horizontal scroll; assert it in a browser test.
- The browser suite serves the repository root on port 8199 and refuses to reuse a server already there; set `PW_PORT` to run two worktrees side by side.

Code style is Prettier's (`.prettierrc.json`): single quotes, semicolons, 100 columns, no trailing commas. More in [CONTRIBUTING.md](CONTRIBUTING.md).

# Standards

The obot program's standards are mandatory here: the issue contract, ways of working and
developer guidelines in jwildfire/obot.roadmap `docs/` (on disk at ~/obot.roadmap/docs/
in a cloud environment). Work runs one requirement per session (`/requirement-session <hub requirement>`).
