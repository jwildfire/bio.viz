<!--
NEWS.md is the running release log and the draft of each release's notes.
Newest release first. Each section is a text-only, functionality-first account of
what a user can now do; the GitHub release publishes from the section here when the
release-candidate pull request (dev -> main) merges and is tagged.
-->

# bio.viz v0.2.0.9000 (Upcoming)

## Also in this release

- **The site is laid out and styled as safety.viz's is.** Every page of bio.viz's site now reads as a page of safety.viz's: the landing page, the gallery, each chart's live demo, evidence page and API reference, and the R check page. The header is safety.viz's, with a Gallery list that opens on every chart; the type, the colours, the gallery cards, a chart's three tabs, the panel of facts, the evidence table with its screenshots, the reference's list of sections beside it and the footer are safety.viz's too. The styles are safety.viz's own stylesheet, copied with a record of the commit it came from and loaded as it is, so the two sites cannot drift apart by retyping. The few rules that are bio.viz's own keep every page inside a phone's screen, where a table becomes a list and code wraps, and show a chart's picture whole, footnotes and all. Nothing about a chart changes. [Gallery](https://jwildfire.github.io/bio.viz/dev/gallery/), [obot.roadmap#369](https://github.com/jwildfire/obot.roadmap/issues/369), [#91](https://github.com/jwildfire/bio.viz/issues/91)

# bio.viz v0.2.0

**See it move:** the [annotated v0.2.0 demo](https://jwildfire.github.io/obot.roadmap/reports/biomarker-v0.2-demo/) has captures and try-it steps for everything below.

This release adds two charts, survival rows in the biomarker screen, and three ways to get a chart's results out of the browser. Every test is still R's, held to desktop R. It needs safety.viz v1.9.0 or later.

## What's new

- **Cross-tabulation.** A two-way table of counts, with totals and percentages, beside stacked bars of the same numbers. Either side can be a column or a biomarker cut at its median, tertiles, quartiles or typed points. R's chi-square or Fisher's exact test is printed under it, with R's warning when an expected count is small. A column's categories are in order of name, numbers as numbers (2 mg before 10 mg), the same in every browser language, and R is handed them in that order, so Fisher's odds ratio is of the table drawn and says which row is over which. A click on a count lists that cell's participants. [Live demo](https://jwildfire.github.io/bio.viz/cross-tab/), [obot.roadmap#359](https://github.com/jwildfire/obot.roadmap/issues/359), [#58](https://github.com/jwildfire/bio.viz/pull/58), [#78](https://github.com/jwildfire/bio.viz/issues/78)
- **Stratified survival.** Kaplan–Meier curves for each group, with censor marks and the number at risk, above a histogram showing where the cut falls. The cut line can be dragged, or moved from the keyboard, and R is asked again when it is let go. R's log-rank test, each group's median survival and, for two groups, the hazard ratio are printed under the curves. The hazard ratio names its two groups: for a cut it is the higher group's over the lower's, and for a column the legend's first group's over its second's. Experimental: the curves use safety.viz's estimator, which awaits its clinical review, and the chart, its gallery card and its demo say so. [Live demo](https://jwildfire.github.io/bio.viz/stratified-survival/), [obot.roadmap#360](https://github.com/jwildfire/obot.roadmap/issues/360), [#64](https://github.com/jwildfire/bio.viz/pull/64), [#78](https://github.com/jwildfire/bio.viz/issues/78)
- **Survival in the biomarker screen.** Given an outcomes table, the screen offers a hazard ratio for high against low on an endpoint, each biomarker cut at its median as gsm.bio cuts it. Each row has R's hazard ratio and interval on a logarithmic axis, and its log-rank p-values unadjusted and adjusted. A row opens the stratified survival chart at the same cut, with the same hazard ratio. [Live demo](https://jwildfire.github.io/bio.viz/biomarker-screen/), [obot.roadmap#360](https://github.com/jwildfire/obot.roadmap/issues/360), [#65](https://github.com/jwildfire/bio.viz/pull/65)
- **Titles and footnotes.** Every chart takes a title, a subtitle and footnotes, with placeholders such as `{measure}` or `{n}` filled from the view drawn. A placeholder is filled with text and nothing is ever run. Each chart adds a footnote of its own: the date drawn, the bio.viz version, and every method R used, with its counts and its adjustment of the p-values. [Gallery](https://jwildfire.github.io/bio.viz/gallery/), [obot.roadmap#361](https://github.com/jwildfire/obot.roadmap/issues/361), [#69](https://github.com/jwildfire/bio.viz/pull/69), [#73](https://github.com/jwildfire/bio.viz/pull/73)
- **Downloads.** Under its footnotes every chart offers its downloads. [API reference](https://jwildfire.github.io/bio.viz/output/api.html#downloads), [obot.roadmap#361](https://github.com/jwildfire/obot.roadmap/issues/361), [#70](https://github.com/jwildfire/bio.viz/pull/70), [#78](https://github.com/jwildfire/bio.viz/issues/78)
  - a PNG of the chart with its title and footnotes drawn in, carrying them in the file with the bio.viz version that made it;
  - the statistics R returned for the view, as CSV, wherever R was asked: the group comparison's overview asks R nothing, so it offers the other two;
  - the table the chart drew from, as CSV, the overview's with a row per participant, biomarker and visit.
- **Specifications.** Every chart writes its settings and filters as JSON data, and `BioViz.fromSpecification` makes the same chart again from them. Anything a chart does not have is refused with a sentence naming it, and what the data cannot draw is listed in `chart.notices`. The format has a JSON schema, published with the site, for gsm.bio's batch runner. [API reference](https://jwildfire.github.io/bio.viz/output/api.html#specifications), [obot.roadmap#361](https://github.com/jwildfire/obot.roadmap/issues/361), [#71](https://github.com/jwildfire/bio.viz/pull/71)

## Also in this release

- **A shared rule for cutting a biomarker into groups.** R's `quantile()` points and R's `cut()` groups, labelled with their bounds. The group comparison uses it for its groups and panels, and the cross-tabulation and the survival chart use it for theirs. [API reference](https://jwildfire.github.io/bio.viz/core/api.html#the-cut-rule), [obot.roadmap#359](https://github.com/jwildfire/obot.roadmap/issues/359), [#46](https://github.com/jwildfire/bio.viz/pull/46)
- **CSV that reads back.** Every CSV, the listing's export among them, is written by RFC 4180, so a heading with a comma stays one column, where the kit's CSV split it, as noted in [#39](https://github.com/jwildfire/bio.viz/issues/39) (the kit's own fix is [safety.viz#208](https://github.com/jwildfire/safety.viz/issues/208)). [obot.roadmap#361](https://github.com/jwildfire/obot.roadmap/issues/361), [#70](https://github.com/jwildfire/bio.viz/pull/70)
- **Which R computed a stored result.** A connection given gsm.bio's record of which R computed its stored results, `computedBy`, names the R and gsm.bio versions in each chart's footnote. [API reference](https://jwildfire.github.io/bio.viz/r-connection/api.html), [obot.roadmap#361](https://github.com/jwildfire/obot.roadmap/issues/361), [#66](https://github.com/jwildfire/bio.viz/issues/66), [#69](https://github.com/jwildfire/bio.viz/pull/69)
- **R's infinite numbers in stored answers.** A stored answer carries R's `Inf`, `-Inf` and `NaN` as the text `"Inf"`, `"-Inf"` and `"NaN"`, and a page reading it prints them as live R does: Fisher's odds ratio of a table with an empty cell is `infinite`, with its interval to `infinity`. An estimate stored with no number is said not to be shown, and why. [API reference](https://jwildfire.github.io/bio.viz/r-connection/api.html#stored-results), [#81](https://github.com/jwildfire/bio.viz/pull/81)

## Tests and provenance

457 unit and 361 browser tests pass, and each of the 690 requirement rows has a test named for it. R's answers in the browser are held to desktop R's within 1 part in 10^8.

# bio.viz v0.1.0

**See it move:** the [annotated v0.1.0 demo](https://jwildfire.github.io/obot.roadmap/reports/biomarker-v0.1-demo/) has captures and try-it steps for everything below.

bio.viz is a chart library beside safety.viz for comparing groups and relating variables in biomarker data, and every test it shows is computed by R, in the browser or ahead of time. This first release has four charts, each drawn on a made-up study and checked against desktop R. It needs safety.viz v1.9.0 or later (until that is released, safety.viz `dev`): the charts are built from safety.viz's kit, which first ships in v1.9.0.

## What's new

- **Group comparison.** One biomarker across the groups of any category, as boxes, violins or points, with R's test of the groups under each panel. It opens on every biomarker at every visit. [Live demo](https://jwildfire.github.io/bio.viz/group-comparison/), [obot.roadmap#355](https://github.com/jwildfire/obot.roadmap/issues/355), [obot.roadmap#356](https://github.com/jwildfire/obot.roadmap/issues/356), [#12](https://github.com/jwildfire/bio.viz/pull/12), [#18](https://github.com/jwildfire/bio.viz/pull/18), [#23](https://github.com/jwildfire/bio.viz/pull/23), [#35](https://github.com/jwildfire/bio.viz/pull/35)
- **Association scatter.** Two variables, one point per participant, with R's correlation and an optional fitted line from R. Drag across the points to list them. [Live demo](https://jwildfire.github.io/bio.viz/association-scatter/), [obot.roadmap#357](https://github.com/jwildfire/obot.roadmap/issues/357), [#28](https://github.com/jwildfire/bio.viz/pull/28)
- **Correlation matrix.** R's coefficient for every pair of a set of biomarkers or visits, each cell with its own pair count and no p-value. A cell opens the pair in the scatter. [Live demo](https://jwildfire.github.io/bio.viz/correlation-matrix/), [obot.roadmap#357](https://github.com/jwildfire/obot.roadmap/issues/357), [#33](https://github.com/jwildfire/bio.viz/pull/33)
- **Biomarker screen.** One comparison across every biomarker, with R's estimate and its p-values adjusted across the rows. A row opens that biomarker in the group comparison or the scatter. [Live demo](https://jwildfire.github.io/bio.viz/biomarker-screen/), [obot.roadmap#358](https://github.com/jwildfire/obot.roadmap/issues/358), [#38](https://github.com/jwildfire/bio.viz/pull/38)
- **R in the browser, measured.** A chart asks R for a statistic with one call, answered from results stored with the page or by R started in the browser on first use. The R check page shows its answers beside desktop R's, and what starting R costs. [R check](https://jwildfire.github.io/bio.viz/r-check/), [obot.roadmap#363](https://github.com/jwildfire/obot.roadmap/issues/363), [#5](https://github.com/jwildfire/bio.viz/pull/5), [#6](https://github.com/jwildfire/bio.viz/pull/6)
- **One way to name a variable.** A biomarker at a visit, as its result, its baseline, or its change, fold change or percent change from baseline, or a column, resolved to one row per participant for every chart. [API reference](https://jwildfire.github.io/bio.viz/core/api.html), [obot.roadmap#355](https://github.com/jwildfire/obot.roadmap/issues/355), [#11](https://github.com/jwildfire/bio.viz/pull/11)
- **A chart list for safety.viz's demo app.** `BioViz.portfolio`, in safety.viz's manifest format, also published as [`portfolio.json`](https://jwildfire.github.io/bio.viz/portfolio.json). [obot.roadmap#366](https://github.com/jwildfire/obot.roadmap/issues/366), [#42](https://github.com/jwildfire/bio.viz/pull/42)

## Also in this release

- **Built from safety.viz's kit,** loaded beside bio.viz on the page and never bundled: bio.viz needs safety.viz v1.9.0 or later (until that is released, safety.viz `dev`, which the site copies at a recorded commit). Filters follow safety.viz's rule. [obot.roadmap#354](https://github.com/jwildfire/obot.roadmap/issues/354), [#40](https://github.com/jwildfire/bio.viz/pull/40)
- **A gallery, an evidence page and an API reference** for every chart and shared part, on the [site](https://jwildfire.github.io/bio.viz/gallery/). The synthetic study is copied from gsm.bio with a checksum per file. [#10](https://github.com/jwildfire/bio.viz/pull/10)
- **The house machinery:** committed bundles, requirement matrices with a test named for every row, evidence rebuilt from each run, and CI on every pull request. [#4](https://github.com/jwildfire/bio.viz/pull/4)

## Tests and provenance

376 unit and 249 browser tests pass, and each of the 507 requirement rows has a test named for it. R's answers in the browser are held to desktop R's within 1 part in 10^8.
