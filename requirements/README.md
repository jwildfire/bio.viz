# Requirement matrices

One Markdown matrix per module — the source of record for what that module must do. A module is a chart, or a shared part of the library with its own tests (the core, the connection to R). Each matrix is registered in [`site/config.json`](../site/config.json) under `modules`.

Tests are named by the requirement IDs in these matrices, so a test result can be read against the requirement it evidences: `npm run requirements` extracts each row's text into `docs/requirements/<module>.json`, and `npm run evidence` records which tests carry which IDs in `docs/evidence/<module>/evidence.json`.

| Matrix                                           | Module              | Rows |
| ------------------------------------------------ | ------------------- | ---: |
| [core.md](core.md)                               | core                |   76 |
| [r-connection.md](r-connection.md)               | r-connection        |   80 |
| [group-comparison.md](group-comparison.md)       | group-comparison    |  162 |
| [association-scatter.md](association-scatter.md) | association-scatter |   87 |
| [correlation-matrix.md](correlation-matrix.md)   | correlation-matrix  |   74 |
| [biomarker-screen.md](biomarker-screen.md)       | biomarker-screen    |   78 |
| [cross-tab.md](cross-tab.md)                     | cross-tab           |   31 |
| [stratified-survival.md](stratified-survival.md) | stratified-survival |   38 |

Row counts are the rows the extractor recognizes; `npm run requirements:check` prints the current count.

## How a matrix is read

The extractor ([`scripts/requirements-lib.mjs`](../scripts/requirements-lib.mjs)) walks every Markdown table row in the file and keeps the ones whose first cell is a requirement ID — `<PREFIX>-<AREA>-<NUM>` with an optional `A`–`D` suffix, matched by `/^[A-Z]{2,4}-[A-Z]+-\d+[A-D]?$/`. The third cell is the requirement text. Header rows, separator rows and any prose around the table are skipped structurally, so a matrix can carry whatever context it needs.

Worth knowing before editing:

- The ID column is the contract. A row whose ID does not match the pattern is invisible to the extractor.
- Split rows (`CORE-API-001A` / `001B`) resolve individually. A test tagged with the un-suffixed base ID matches neither.
- Text is compared verbatim. `npm run requirements:check` fails when a committed extract no longer matches its matrix, so a wording edit must be regenerated and committed.
- A matrix file that no module registers fails `npm run requirements:check`, as does a registered matrix that is missing or has no recognizable rows. The check never passes by comparing nothing.
- Every row needs a test. `npm run evidence` and `npm run evidence:check` fail when a row has no test named for it, and when a test names an ID that is in no matrix.

## Adding or changing requirements

The matrix and the code that satisfies it live in the same repository, so they belong in the same pull request:

1. Edit `requirements/<matrix>.md` — add rows with the module's ID prefix, or amend existing text.
2. Run `npm run requirements` to regenerate `docs/requirements/<module>.json`.
3. Name the tests that evidence the rows by their IDs, then run `npm run evidence` to regenerate the evidence set.
4. Commit the matrix edit, the regenerated extract and evidence set, the implementation and its tests together.

A new module needs no script changes: add its entry to [`site/config.json`](../site/config.json) with a `matrix` filename, drop the matrix here, put its unit tests under `tests/unit/<module>/` and its browser tests in `tests/e2e/<module>.spec.js`. The entry also says whether the module is a chart or a shared part and names its API reference; [CONTRIBUTING.md](../CONTRIBUTING.md) has the whole entry. The module's evidence page on the site then lists every row of the matrix with the tests named for it.

The `Status` and `AI Review` columns record review provenance. A row drafted by an agent says so, and is not approved by @jwildfire until its status says he reviewed it.

## Provenance

The matrix format, the extractor and the checks are carried over from [safety.viz](https://github.com/jwildfire/safety.viz/tree/dev/requirements), whose matrices were harvested from the original renderer wikis. bio.viz's charts are new, so its matrices are written from each chart's requirement on the [obot roadmap](https://jwildfire.github.io/obot.roadmap/) and its design page.
