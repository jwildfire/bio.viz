# output requirements matrix

> Requirement matrix for getting results out of the browser: what every bio.viz chart does so that what it shows can leave the page and still say what it is. Written with the titles and footnotes ([bio.viz#66](https://github.com/jwildfire/bio.viz/issues/66)); parent requirement [obot.roadmap#361](https://github.com/jwildfire/obot.roadmap/issues/361). Design: [353_design.html](https://jwildfire.github.io/obot.roadmap/requirements/design/353_design.html), section Getting results out.

## Scope

Every chart's title, subtitle and footnotes: settings of text with named placeholders, filled from the view drawn, as text, with nothing evaluated, and drawn in the chart's own frame above and under what it draws, at every width. One footnote the chart writes last: the date drawn, the bio.viz version, and R's method and counts behind each statistic printed, with the R and gsm.bio versions of a stored result. The rules are written once, in `src/shared/titles.js`, and reached by a page as `BioViz.output`.

Not in scope here yet: the PNG and CSV downloads ([bio.viz#67](https://github.com/jwildfire/bio.viz/issues/67)) and the specification a chart is written to and rebuilt from ([bio.viz#68](https://github.com/jwildfire/bio.viz/issues/68)), which add their rows to this matrix.

## Source inventory

- Task [bio.viz#66](https://github.com/jwildfire/bio.viz/issues/66), What changes and Definition of done.
- Requirement [obot.roadmap#361](https://github.com/jwildfire/obot.roadmap/issues/361); design [353_design.html](https://jwildfire.github.io/obot.roadmap/requirements/design/353_design.html), Getting results out: titles and footnotes with named placeholders, and one footnote written automatically with the date, library version, method and counts.
- gsm.bio, `R/utils-widget.R`, `StoredResultsProvenance()`: the record a widget stores of which R computed its results (`r_version`, `gsm_bio_version`, `computed_at`).
- Developer guidelines, Artifacts and pages: every page holds at a 390-pixel viewport with no horizontal scroll.

## Requirements

| ID | Area | Requirement | Source | Evidence Type | Test/Evidence Link | Status | AI Review | Notes |
|---|---|---|---|---|---|---|---|---|
| EXP-TXT-001 | TXT | A placeholder, a name in braces, is replaced by the text of its value, once, left to right; a name the chart does not have is left as written; nothing in a template or a value is evaluated, so code-like text (`${…}`, `<script>`, `{{…}}`) is text. | bio.viz#66 What changes; Definition of done | unit | `tests/unit/output/titles.test.js` | drafted | Not reviewed by @jwildfire | A value is never read for placeholders of its own. |
| EXP-TXT-002 | TXT | Every chart takes `title`, `subtitle` and `footnotes`, null by default; a title or subtitle that is not text, or footnotes that are not text or a list of texts, are refused with a sentence naming the setting. | bio.viz#66 What changes | unit | `tests/unit/output/titles.test.js` | drafted | Not reviewed by @jwildfire | One footnote given as text is a list of one; empty texts are dropped. |
| EXP-TXT-003 | TXT | In the page, a title, subtitle or footnote holding code-like text is drawn as that text: no element is made of it, no script runs, and a placeholder inside it is filled as text. | bio.viz#66 Definition of done | browser | `tests/e2e/output.spec.js` | drafted | Not reviewed by @jwildfire | |
| EXP-AUTO-001 | AUTO | The chart's own footnote, always last, gives the date drawn (UTC), the bio.viz version, and for each statistic printed R's method and the counts R used, with which R computed it: R in this browser, or a stored result with its R and gsm.bio versions; while R is asked it says it is waiting, and it says when nothing was asked, when statistics are unavailable and when R reported an error. | bio.viz#66 What changes | unit | `tests/unit/output/titles.test.js` | drafted | Not reviewed by @jwildfire | Up to four counts are named by group; more are written as the least and the most, with how many. |
| EXP-AUTO-002 | AUTO | A connection given `computedBy`, which R computed its stored results, hands that record with every stored answer and with no other; a record that is not one is refused with a sentence. | bio.viz#66 What changes | unit | `tests/unit/output/titles.test.js` | drafted | Not reviewed by @jwildfire | gsm.bio's widget stores the record as `computed_by` beside the results. |
| EXP-AUTO-003 | AUTO | In the page the chart's own footnote says it is waiting while R is asked, and is written again when R answers; with no R it says statistics are unavailable, and a view that asks R nothing says so. | bio.viz#66 What changes | browser | `tests/e2e/output.spec.js` | drafted | Not reviewed by @jwildfire | |
| EXP-DRAW-001 | DRAW | The group comparison draws its title and subtitle above it and its footnotes under it, every placeholder filled from the view drawn, with its own footnote last naming the date, the version, R's method and counts and the R and gsm.bio versions of the stored result; it holds at 390px. | bio.viz#66 Definition of done | browser | `tests/e2e/output.spec.js` | drafted | Not reviewed by @jwildfire | |
| EXP-DRAW-002 | DRAW | The same for the association scatter. | bio.viz#66 Definition of done | browser | `tests/e2e/output.spec.js` | drafted | Not reviewed by @jwildfire | |
| EXP-DRAW-003 | DRAW | The same for the correlation matrix. | bio.viz#66 Definition of done | browser | `tests/e2e/output.spec.js` | drafted | Not reviewed by @jwildfire | |
| EXP-DRAW-004 | DRAW | The same for the biomarker screen. | bio.viz#66 Definition of done | browser | `tests/e2e/output.spec.js` | drafted | Not reviewed by @jwildfire | |
| EXP-DRAW-005 | DRAW | The same for the cross-tabulation. | bio.viz#66 Definition of done | browser | `tests/e2e/output.spec.js` | drafted | Not reviewed by @jwildfire | |
| EXP-DRAW-006 | DRAW | The same for the stratified survival chart. | bio.viz#66 Definition of done | browser | `tests/e2e/output.spec.js` | drafted | Not reviewed by @jwildfire | |
| EXP-SITE-001 | SITE | Each chart's demo on the gallery shows its title, subtitle and footnotes, every placeholder filled, with the chart's own footnote last; at 390px the page does not scroll sideways. | bio.viz#66 Definition of done | browser | `tests/e2e/output.spec.js` | drafted | Not reviewed by @jwildfire | One test per chart. |
