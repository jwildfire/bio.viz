# core requirements matrix

> Requirement matrix for the bio.viz **core**: the library's entry point, its two committed bundles, and the site page that names the build. Written with the repository setup ([bio.viz#1](https://github.com/jwildfire/bio.viz/issues/1); parent requirement [obot.roadmap#363](https://github.com/jwildfire/obot.roadmap/issues/363), design [353_design.html](https://jwildfire.github.io/obot.roadmap/requirements/design/353_design.html), section Repositories).

## Scope

What a page or a widget can rely on before any chart exists: the bundles are where the build says they are, they report the version they were built from, and nothing else is bundled into them. No chart and no statistics are in scope here; each chart and the connection to R gets its own matrix.

## Source inventory

- Task [bio.viz#1](https://github.com/jwildfire/bio.viz/issues/1), What changes and Definition of done.
- Design [353_design.html](https://jwildfire.github.io/obot.roadmap/requirements/design/353_design.html), Repositories: committed bundles; safety.viz needed on the page, not in the bundle. Statistics engine: webR loaded the first time a test is asked for.
- Developer guidelines, Artifacts and pages: every page holds at a 390-pixel viewport with no horizontal scroll.

## Requirements

| ID | Area | Requirement | Source | Evidence Type | Test/Evidence Link | Status | AI Review | Notes |
|---|---|---|---|---|---|---|---|---|
| CORE-BUILD-001 | BUILD | The build writes a script-tag bundle to `dist/bio.viz-{version}/bio.viz.js` that defines the global `BioViz`. | bio.viz#1 What changes | unit | `tests/unit/core/main.test.js` | drafted | Not reviewed by @jwildfire | Read from the committed bundle, so a missing or stale build fails the test. |
| CORE-BUILD-002 | BUILD | The build writes an ES module bundle to `dist/bio.viz-{version}/bio.viz.esm.js` with the same exports as the script-tag bundle. | bio.viz#1 What changes | unit | `tests/unit/core/main.test.js` | drafted | Not reviewed by @jwildfire | |
| CORE-API-001 | API | `version` equals the `version` field of package.json: in the source, in both committed bundles, and as `BioViz.version` on a page that loads the script-tag bundle. | bio.viz#1 Definition of done | unit, browser | `tests/unit/core/main.test.js`, `tests/e2e/core.spec.js` | drafted | Not reviewed by @jwildfire | |
| CORE-DEP-001 | DEP | package.json declares no runtime dependencies: safety.viz and webR are loaded beside the bundle on a page and are never bundled into it. | bio.viz#1 What changes; design, Repositories and Statistics engine | unit | `tests/unit/core/main.test.js` | drafted | Not reviewed by @jwildfire | |
| CORE-SITE-001 | SITE | The site's home page names the library and its version, and shows the version reported by the bundle that page loaded. | bio.viz#1 Definition of done | browser | `tests/e2e/site.spec.js` | drafted | Not reviewed by @jwildfire | |
| CORE-SITE-002 | SITE | The site's home page holds at a 390-pixel-wide viewport with no horizontal scroll. | Developer guidelines, Artifacts and pages | browser | `tests/e2e/site.spec.js` | drafted | Not reviewed by @jwildfire | |
