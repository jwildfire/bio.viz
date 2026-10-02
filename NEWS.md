<!--
NEWS.md is the running release log and the draft of each release's notes.
Newest release first. Each section is a text-only, functionality-first account of
what a user can now do; the GitHub release publishes from the section here when the
release-candidate pull request (dev -> main) merges and is tagged.
-->

# bio.viz v0.1.0 (Upcoming)

bio.viz is a second chart library beside safety.viz, for comparing groups and relating variables in biomarker data. Every statistical test it shows is computed by R; the library holds no inference code of its own. This first release has no charts. It sets the repository up and measures what running R in the browser costs.

## What's new

- The library builds and reports its version. `npm run build` writes a script-tag bundle (global `BioViz`) and an ES module bundle to `dist/bio.viz-0.1.0/`, both committed, and `BioViz.version` reads the package version. Nothing is bundled into them: safety.viz and R are loaded beside bio.viz on a page.
- The house machinery from safety.viz is in place: unit tests, browser tests against the committed bundle, requirement matrices with tests named by requirement, an evidence set rebuilt from each test run, and a check that the committed bundle matches the source. Continuous integration runs all of it on every pull request.
- A chart can ask R for a statistic. `BioViz.r.createConnection` makes a connection with one call, `run(name, { data, args })`, which always answers: with what R returned, with a statement that statistics are unavailable and why, or with R's own error message. Two forms sit behind it. Results worked out ahead of time and shipped with the page are answered without loading anything. Otherwise R itself is started in the browser the first time a result is needed, from webR 0.6.0 on its public CDN or from wherever a deployment serves its own copy, and is never part of the bundle. The R functions come from a file of R source the connection is given.
- One rule for printing a p-value. `BioViz.r.formatStatistic` prints it with the method's name and the counts used, labelled exploratory and unadjusted unless an adjustment is named, with no stars and no verdict. Without a method or counts it prints no number and says what is missing; where R declined to compute, it prints R's reason.
- A site with a dev build. The released site is published at <https://jwildfire.github.io/bio.viz/> and the current `dev` branch at <https://jwildfire.github.io/bio.viz/dev/>. Its home page names the library, its version, and the version reported by the bundle that page loaded.
