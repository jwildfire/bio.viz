# bio.viz

Chart.js charts for comparing groups and relating variables in biomarker data; every test computed by R. Runs beside [safety.viz](https://github.com/jwildfire/safety.viz).

- Site: <https://jwildfire.github.io/bio.viz/> (released) and <https://jwildfire.github.io/bio.viz/dev/> (the `dev` branch)
- Design: <https://jwildfire.github.io/obot.roadmap/requirements/design/353_design.html>
- Release notes: [NEWS.md](NEWS.md)

## Status

Version 0.1.0 is in progress and has no charts yet. It sets the repository up and measures what running R in the browser costs. The charts follow: group comparison, association scatter, correlation matrix, cross-tabulation, stratified survival and a biomarker screen.

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
import { version } from './dist/bio.viz-0.1.0/bio.viz.esm.js';
```

## Developing

```sh
npm ci
npm run build
npm test
npm run test:e2e
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full command list, the test-naming convention and how a pull request merges.
