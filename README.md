# bio.viz

Chart.js charts for comparing groups and relating variables in biomarker data; every test computed by R. Runs beside [safety.viz](https://github.com/jwildfire/safety.viz).

- Site: <https://jwildfire.github.io/bio.viz/> (released) and <https://jwildfire.github.io/bio.viz/dev/> (the `dev` branch)
- Gallery: <https://jwildfire.github.io/bio.viz/dev/gallery/> — each chart and shared part with its evidence page (requirements, the tests that prove each, screenshots) and its API reference
- R check: <https://jwildfire.github.io/bio.viz/dev/r-check/> — two real tests run through R in the browser beside desktop R's answers, with what it costs in megabytes and seconds
- Design: <https://jwildfire.github.io/obot.roadmap/requirements/design/353_design.html>
- Release notes: [NEWS.md](NEWS.md)

## Status

Version 0.1.0 is in progress. It sets the repository up, measures what running R in the browser costs, and has the first chart: [group comparison](https://jwildfire.github.io/bio.viz/dev/group-comparison/), which draws but does not yet test. The others follow: association scatter, correlation matrix, cross-tabulation, stratified survival and a biomarker screen.

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
  // "Wilcoxon rank-sum test: p = 0.031 (Placebo n = 86, Active n = 84). Exploratory, unadjusted."
}
```

R in the browser is [webR](https://docs.r-wasm.org/webr/latest/) 0.6.0, fetched from its public CDN on first use and never bundled. The full interface, including the format of stored results, is in [docs/r-connection.md](docs/r-connection.md), which the site publishes as the connection's [API reference](https://jwildfire.github.io/bio.viz/dev/r-connection/api.html).

## The group comparison chart

One value across the levels of a category, as boxes, violins or points, with the number in each group beneath. safety.viz is loaded first: the chart is built from its kit.

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
    group_by: 'ARM'
  }).init({ results, participants });
</script>
```

Only the results table is required. The settings, the controls and what the statistics line prints are in [docs/group-comparison.md](docs/group-comparison.md), published as the chart's [API reference](https://jwildfire.github.io/bio.viz/dev/group-comparison/api.html); its [live demo](https://jwildfire.github.io/bio.viz/dev/group-comparison/) runs on the synthetic study.

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
