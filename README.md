# bio.viz

Chart.js charts for comparing groups and relating variables in biomarker data; every test computed by R. Runs beside [safety.viz](https://github.com/jwildfire/safety.viz), and needs safety.viz v1.9.0 or later (until that is released, safety.viz `dev`): the charts are built from safety.viz's kit, which first ships in v1.9.0.

- Site: <https://jwildfire.github.io/bio.viz/> (released) and <https://jwildfire.github.io/bio.viz/dev/> (the `dev` branch)
- Gallery: <https://jwildfire.github.io/bio.viz/dev/gallery/> — each chart and shared part with its evidence page (requirements, the tests that prove each, screenshots) and its API reference
- R check: <https://jwildfire.github.io/bio.viz/dev/r-check/> — two real tests run through R in the browser beside desktop R's answers, with what it costs in megabytes and seconds
- Design: <https://jwildfire.github.io/obot.roadmap/requirements/design/353_design.html>
- Release notes: [NEWS.md](NEWS.md)

## Status

Version 0.1.0 is the first release, [released on GitHub](https://github.com/jwildfire/bio.viz/releases/tag/v0.1.0) ([release notes](NEWS.md), [annotated demo](https://jwildfire.github.io/obot.roadmap/reports/biomarker-v0.1-demo/)); its site is the released one, <https://jwildfire.github.io/bio.viz/>. It measures what running R in the browser costs and has the first four charts: [group comparison](https://jwildfire.github.io/bio.viz/dev/group-comparison/), which draws the groups and prints R's test of them, [association scatter](https://jwildfire.github.io/bio.viz/dev/association-scatter/), which draws two variables against one another and prints R's correlation coefficient, [correlation matrix](https://jwildfire.github.io/bio.viz/dev/correlation-matrix/), a grid of R's coefficients over a set of biomarkers or visits whose cells open the scatter, and [biomarker screen](https://jwildfire.github.io/bio.viz/dev/biomarker-screen/), one row per biomarker with R's estimate and its p-values adjusted across the rows, whose rows open the group comparison or the scatter. On `dev`, for v0.2.0: a shared rule for cutting a biomarker into groups, and the [cross-tabulation](https://jwildfire.github.io/bio.viz/dev/cross-tab/), a two-way table with R's chi-square or Fisher's exact test. And the [stratified survival chart](https://jwildfire.github.io/bio.viz/dev/stratified-survival/): Kaplan–Meier curves by a cut biomarker or a column, with a cut line to drag, and R's log-rank test, medians and hazard ratio.

## How it fits together

- bio.viz draws; R computes. The library holds no statistical inference. A chart hands its table to R through one connection and draws the estimates, intervals, p-values and counts that come back.
- safety.viz is loaded beside bio.viz on a page and provides the shared parts (controls, filters, listings, its copy of Chart.js). It is never bundled into bio.viz.
- [gsm.bio](https://github.com/jwildfire/gsm.bio) is the R package: the statistics functions, a widget per chart and a static twin per chart.

## Using it

Vendor the committed bundle — no build step, no npm install:

```html
<script src="dist/bio.viz-0.1.0/bio.viz.js"></script>
<script>
  console.log(BioViz.version); // "0.1.0"
</script>
```

An ES module build is committed alongside:

```js
import { version, core, r } from './dist/bio.viz-0.1.0/bio.viz.esm.js';
```

## Asking R for a statistic

A chart reaches R through a connection. The same call is answered from results shipped with the page, or by R started in the browser the first time a result is needed; with neither, it says that statistics are unavailable.

```js
const connection = BioViz.r.createConnection({
  browser: { sourceUrl: 'statistics.R', packages: ['survival'] }
});

const result = await connection.run('rank_sum', {
  data: rows,
  args: { value: 'AVAL', group: 'ARM' }
});

if (result.status === 'ok') {
  console.log(BioViz.r.formatStatistic(result.value).text);
  // "Wilcoxon rank sum test with continuity correction: p < 0.001 (Placebo n = 70, Xanomeline High Dose n = 52). Exploratory, unadjusted."
}
```

R in the browser is [webR](https://docs.r-wasm.org/webr/latest/) 0.6.0, fetched from its public CDN on first use and never bundled. The full interface, including the format of stored results, is in [docs/r-connection.md](docs/r-connection.md), which the site publishes as the connection's [API reference](https://jwildfire.github.io/bio.viz/dev/r-connection/api.html).

## The group comparison chart

One value across the levels of a category, as boxes, violins or points, with the number in each group beneath, and under it R's test of the groups: a Welch t-test or a Wilcoxon rank-sum test between two, a one-way ANOVA or a Kruskal-Wallis test across more, with pairwise comparisons on request. safety.viz is loaded first: the chart is built from its kit. The test is asked of the connection the chart is given; with none, the line says that statistics are unavailable. With no biomarker named the chart opens on an overview of every biomarker at every visit, and a row of it opens one.

```html
<div id="chart"></div>
<script src="vendor/safety.viz/safety.viz.js"></script>
<script src="dist/bio.viz-0.1.0/bio.viz.js"></script>
<script>
  BioViz.groupComparison('#chart', {
    start_value: 'IL-6',
    visits: 'Week 4',
    value_type: 'change',
    baseline_visits: 'Baseline',
    group_by: 'ARM',
    // gsm.bio's statistics functions, run by R in the browser on first use.
    connection: BioViz.r.createConnection({
      browser: { sourceUrl: 'vendor/gsm.bio/statistics.R' }
    })
  }).init({ results, participants });
</script>
```

Only the results table is required. The settings, the controls and what the statistics line prints are in [docs/group-comparison.md](docs/group-comparison.md), published as the chart's [API reference](https://jwildfire.github.io/bio.viz/dev/group-comparison/api.html); its [live demo](https://jwildfire.github.io/bio.viz/dev/group-comparison/) runs on the synthetic study.

## The association scatter

Two variables against one another, one point per participant, and under it R's Pearson or Spearman coefficient with its interval and p-value, for everyone drawn and within each colour. A fitted line, R's linear fit or smooth with its band, is drawn from the points R returns.

```html
<script>
  BioViz.associationScatter('#chart', {
    x: { measure: 'TNF-alpha', visit: 'Baseline' },
    y: { measure: 'IL-10', visit: 'Baseline' },
    color_by: 'ARM',
    fit: 'linear',
    connection: BioViz.r.createConnection({
      browser: { sourceUrl: 'vendor/gsm.bio/statistics.R', packages: [] }
    })
  }).init({ results, participants });
</script>
```

The settings, what R is asked and how a logarithmic axis is handled are in [docs/association-scatter.md](docs/association-scatter.md), published as the chart's [API reference](https://jwildfire.github.io/bio.viz/dev/association-scatter/api.html); its [live demo](https://jwildfire.github.io/bio.viz/dev/association-scatter/) opens on the pair the synthetic study was planted with.

## The correlation matrix

Which of these biomarkers, or which visits of one biomarker, are related? A grid over a set of variables: below the diagonal each pair is a mark sized and coloured by R's Pearson or Spearman coefficient, above it the number, and every cell has its own pair count. It prints no p-value, by design. A click on a cell opens that pair in the association scatter, in place, with a way back.

```html
<script>
  BioViz.correlationMatrix('#chart', {
    baseline_visits: 'Baseline',
    connection: BioViz.r.createConnection({
      browser: { sourceUrl: 'vendor/gsm.bio/statistics.R', packages: [] }
    })
  }).init({ results, participants });
</script>
```

With nothing else named it opens on every biomarker at the first visit, twelve at a time. The settings, the limit and what was measured for it, what R is asked and what a phone shows are in [docs/correlation-matrix.md](docs/correlation-matrix.md), published as the chart's [API reference](https://jwildfire.github.io/bio.viz/dev/correlation-matrix/api.html); its [live demo](https://jwildfire.github.io/bio.viz/dev/correlation-matrix/) runs on the synthetic study, where one pair of the twelve biomarkers was planted with a correlation.

## The biomarker screen

Across every biomarker, where is the signal? One row per biomarker for a comparison chosen once, a standardised difference between two groups, a correlation with one variable, or, given an outcomes table, a hazard ratio for high against low on an endpoint, each biomarker cut at its median: R's estimate and its interval on one axis without units, and R's p-values beside it, unadjusted and adjusted across the rows by Benjamini-Hochberg or Holm. A click on a row opens that biomarker in the group comparison, the association scatter or the stratified survival chart, in place, with a way back.

```html
<script>
  BioViz.biomarkerScreen('#chart', {
    baseline_visits: 'Baseline',
    visit: 'Week 4',
    value_type: 'change',
    group_by: 'ARM',
    connection: BioViz.r.createConnection({
      browser: { sourceUrl: 'vendor/gsm.bio/statistics.R', packages: [] }
    })
  }).init({ results, participants });
</script>
```

The settings, the order of the rows, what R is asked and what a row opens are in [docs/biomarker-screen.md](docs/biomarker-screen.md), published as the chart's [API reference](https://jwildfire.github.io/bio.viz/dev/biomarker-screen/api.html); its [live demo](https://jwildfire.github.io/bio.viz/dev/biomarker-screen/) opens on the difference the synthetic study was planted with.

## The cross-tabulation

Is this category associated with that one? A two-way table of counts with its totals and its row or column percentages, beside stacked bars of the same numbers, and R's chi-square or Fisher's exact test of it, with R's own warning when an expected count is below 5. Either variable is a column, or a biomarker cut by the shared cut rule. A click on a count lists that cell's participants.

```html
<script>
  BioViz.crossTab('#chart', {
    row_by: 'RESPONSE',
    col_by: { measure: 'CRP', visit: 'Baseline', cut: 'median' },
    test: 'chisq',
    connection: BioViz.r.createConnection({
      browser: { sourceUrl: 'vendor/gsm.bio/statistics.R', packages: [] }
    })
  }).init({ results, participants });
</script>
```

The settings, what R is asked and the key a stored result is found by are in [docs/cross-tab.md](docs/cross-tab.md), published as the chart's [API reference](https://jwildfire.github.io/bio.viz/dev/cross-tab/api.html); its [live demo](https://jwildfire.github.io/bio.viz/dev/cross-tab/) opens on arm by response.

## The stratified survival chart

Do participants with high and low levels of this biomarker have different outcomes? Kaplan–Meier curves per group, from safety.viz's kit, with censor marks and an at-risk strip, above a histogram of the biomarker with its cut line. The line can be dragged: the curves follow at once, and R is asked again when it is let go. Under the curves, R's log-rank test, each group's median survival with its interval and, for two groups, the hazard ratio with its interval. It takes a third table, the outcomes, one row per participant and endpoint, with a time and a censor or event flag. R in the browser needs the survival package.

```html
<script>
  BioViz.stratifiedSurvival('#chart', {
    group_by: { measure: 'CRP', visit: 'Baseline', cut: 'median' },
    connection: BioViz.r.createConnection({
      browser: { sourceUrl: 'vendor/gsm.bio/statistics.R', packages: ['survival'] }
    })
  }).init({ results, participants, outcomes });
</script>
```

The settings, the outcomes table, moving the cut line and what R is asked are in [docs/stratified-survival.md](docs/stratified-survival.md), published as the chart's [API reference](https://jwildfire.github.io/bio.viz/dev/stratified-survival/api.html); its [live demo](https://jwildfire.github.io/bio.viz/dev/stratified-survival/) opens on event-free survival by CRP at Baseline cut at its median, where the synthetic study was planted with a survival effect.

## Naming a variable and getting one row per participant

Every chart takes its variables the same way and resolves them the same way, with `BioViz.core`:

```js
const { data, dropped } = BioViz.core.frame(
  { results, participants },
  {
    y: { measure: 'IL-6', visit: 'Week 4', value: 'change' },
    x: { col: 'ARM' }
  },
  { baseline_visits: ['Baseline'] }
);
// data: one record per participant, { USUBJID, y, x }, ready to draw and to hand to R
// dropped: who was left out, counted by reason
```

Only the results table is required. The value types, the settings and what is counted are in [docs/core.md](docs/core.md), published as the core's [API reference](https://jwildfire.github.io/bio.viz/dev/core/api.html).

## Example data

The demos and tests run on a made-up study of 200 participants, twelve biomarkers and five visits, with known effects planted in it so a test can assert an answer that is known in advance. It is made in gsm.bio and copied here unchanged, to [`site/data/synthetic-study/`](site/data/synthetic-study/), with a record of the gsm.bio commit and a checksum for each file. No real participant is in it.

## Developing

```sh
npm ci
npm run build
npm test
npm run test:e2e
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full command list, the test-naming convention and how a pull request merges.
