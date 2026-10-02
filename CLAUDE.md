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
```

Before a pull request: `npm run format:check`, `build:check-dist`, `test`, `test:e2e`, `evidence:check` and `requirements:check` all pass. CI runs the same.

## Rules that are easy to break

- After any change under `src/`, run `npm run build` and commit `dist/` with it.
- After adding, removing or renaming a test, run `npm run evidence` and commit `docs/evidence/`.
- Name a test by the requirement ID it evidences and the issue it belongs to: `'CORE-API-001: … (#1)'`. Unit tests for a module go in `tests/unit/<module>/`, browser tests in `tests/e2e/<module>.spec.js`.
- No statistical inference in JavaScript. A chart asks R through the connection and draws what comes back.
- No runtime dependencies in package.json. safety.viz and webR are loaded beside the bundle on a page, never bundled; webR is loaded on first use.
- Public or synthetic data only.
- Every page on the site holds at a 390px-wide viewport with no horizontal scroll; assert it in a browser test.
- The browser suite serves the repository root on port 8199 and refuses to reuse a server already there; set `PW_PORT` to run two worktrees side by side.

Code style is Prettier's (`.prettierrc.json`): single quotes, semicolons, 100 columns, no trailing commas. More in [CONTRIBUTING.md](CONTRIBUTING.md).

# Standards

The obot program's standards are mandatory here: the issue contract, ways of working and
developer guidelines in jwildfire/obot.roadmap `docs/` (on disk at ~/obot.roadmap/docs/
in a cloud environment). Work runs one requirement per session (`/requirement-session <hub requirement>`).
