<!--
NEWS.md is the running release log and the draft of each release's notes.
Newest release first. Each section is a text-only, functionality-first account of
what a user can now do; the GitHub release publishes from the section here when the
release-candidate pull request (dev -> main) merges and is tagged.
-->

# bio.viz v0.1.0 (Upcoming)

**See it move:** the [annotated v0.1.0 demo](https://jwildfire.github.io/obot.roadmap/reports/biomarker-v0.1-demo/) has captures and try-it steps for everything below.

bio.viz is a chart library beside safety.viz for comparing groups and relating variables in biomarker data, and every test it shows is computed by R, in the browser or ahead of time. This first release has four charts, each drawn on a made-up study and checked against desktop R. It needs safety.viz v1.9.0 or later (until that is released, safety.viz `dev`): the charts are built from safety.viz's kit, which first ships in v1.9.0.

## What's new

- **Group comparison.** One biomarker across the groups of any category, as boxes, violins or points, with R's test of the groups under each panel. It opens on every biomarker at every visit. [Live demo](https://jwildfire.github.io/bio.viz/dev/group-comparison/), [obot.roadmap#355](https://github.com/jwildfire/obot.roadmap/issues/355), [obot.roadmap#356](https://github.com/jwildfire/obot.roadmap/issues/356), [#12](https://github.com/jwildfire/bio.viz/pull/12), [#18](https://github.com/jwildfire/bio.viz/pull/18), [#23](https://github.com/jwildfire/bio.viz/pull/23), [#35](https://github.com/jwildfire/bio.viz/pull/35)
- **Association scatter.** Two variables, one point per participant, with R's correlation and an optional fitted line from R. Drag across the points to list them. [Live demo](https://jwildfire.github.io/bio.viz/dev/association-scatter/), [obot.roadmap#357](https://github.com/jwildfire/obot.roadmap/issues/357), [#28](https://github.com/jwildfire/bio.viz/pull/28)
- **Correlation matrix.** R's coefficient for every pair of a set of biomarkers or visits, each cell with its own pair count and no p-value. A cell opens the pair in the scatter. [Live demo](https://jwildfire.github.io/bio.viz/dev/correlation-matrix/), [obot.roadmap#357](https://github.com/jwildfire/obot.roadmap/issues/357), [#33](https://github.com/jwildfire/bio.viz/pull/33)
- **Biomarker screen.** One comparison across every biomarker, with R's estimate and its p-values adjusted across the rows. A row opens that biomarker in the group comparison or the scatter. [Live demo](https://jwildfire.github.io/bio.viz/dev/biomarker-screen/), [obot.roadmap#358](https://github.com/jwildfire/obot.roadmap/issues/358), [#38](https://github.com/jwildfire/bio.viz/pull/38)
- **R in the browser, measured.** A chart asks R for a statistic with one call, answered from results stored with the page or by R started in the browser on first use. The R check page shows its answers beside desktop R's, and what starting R costs. [R check](https://jwildfire.github.io/bio.viz/dev/r-check/), [obot.roadmap#363](https://github.com/jwildfire/obot.roadmap/issues/363), [#5](https://github.com/jwildfire/bio.viz/pull/5), [#6](https://github.com/jwildfire/bio.viz/pull/6)
- **One way to name a variable.** A biomarker at a visit, as its result, its baseline, or its change, fold change or percent change from baseline, or a column, resolved to one row per participant for every chart. [API reference](https://jwildfire.github.io/bio.viz/dev/core/api.html), [obot.roadmap#355](https://github.com/jwildfire/obot.roadmap/issues/355), [#11](https://github.com/jwildfire/bio.viz/pull/11)
- **A chart list for safety.viz's demo app.** `BioViz.portfolio`, in safety.viz's manifest format, also published as [`portfolio.json`](https://jwildfire.github.io/bio.viz/dev/portfolio.json). [obot.roadmap#366](https://github.com/jwildfire/obot.roadmap/issues/366), [#42](https://github.com/jwildfire/bio.viz/pull/42)

## Also in this release

- **Built from safety.viz's kit,** loaded beside bio.viz on the page and never bundled: bio.viz needs safety.viz v1.9.0 or later (until that is released, safety.viz `dev`, which the site copies at a recorded commit). Filters follow safety.viz's rule. [obot.roadmap#354](https://github.com/jwildfire/obot.roadmap/issues/354), [#40](https://github.com/jwildfire/bio.viz/pull/40)
- **A gallery, an evidence page and an API reference** for every chart and shared part, on the [site](https://jwildfire.github.io/bio.viz/dev/gallery/). The synthetic study is copied from gsm.bio with a checksum per file. [#10](https://github.com/jwildfire/bio.viz/pull/10)
- **The house machinery:** committed bundles, requirement matrices with a test named for every row, evidence rebuilt from each run, and CI on every pull request. [#4](https://github.com/jwildfire/bio.viz/pull/4)

## Tests and provenance

371 unit and 231 browser tests pass, and each of the 484 requirement rows has a test named for it. R's answers in the browser are held to desktop R's within 1 part in 10^8.
