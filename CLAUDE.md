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
npm run fixtures:check        # desktop R re-derives the R check page's expected results (needs R)
npm run data:check            # the vendored synthetic study matches its record (:check-source asks gsm.bio)
```

Before a pull request: `npm run format:check`, `build:check-dist`, `test`, `test:e2e`, `evidence:check` and `requirements:check` all pass. CI runs the same.

## Rules that are easy to break

- After any change under `src/`, run `npm run build` and commit `dist/` with it.
- After adding, removing or renaming a test, run `npm run evidence` and commit `docs/evidence/`.
- Name a test by the requirement ID it evidences and the issue it belongs to: `'CORE-API-001: … (#1)'`. Unit tests for a module go in `tests/unit/<module>/`, browser tests in `tests/e2e/<module>.spec.js`.
- No statistical inference in JavaScript. A chart asks R through the connection and draws what comes back.
- No runtime dependencies in package.json. safety.viz and webR are loaded beside the bundle on a page, never bundled; webR is loaded on first use.
- The only file that knows webR's API is `src/r/webREngine.js`. Unit and browser tests of the connection use a stub engine or the stand-in at `tests/e2e/fixtures/fake-webr/`; they never reach the network.
- The `RCON-LIVE-*` browser tests run real R from webR's public CDN and need the network. They fail when it is unreachable; do not make them skip or retry.
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
