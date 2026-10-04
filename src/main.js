// bio.viz public entry point. Everything a page or a widget can reach is a
// named export here: esbuild exposes the named exports on the global `BioViz`
// in the IIFE bundle and as module exports in the ESM bundle.
//
// The library holds no statistical inference: every test is computed by R and
// reaches a chart through the connection to R in src/r/. safety.viz and webR
// are loaded beside this bundle on a page and are never bundled into it.

/* global __BIO_VIZ_VERSION__ */

/**
 * The library version, equal to the `version` field of package.json. The value
 * is fixed when the bundle is built (see scripts/build-lib.mjs).
 * @type {string}
 */
export const version = __BIO_VIZ_VERSION__;

/**
 * The connection to R and the p-value formatter: `BioViz.r.createConnection`
 * and `BioViz.r.formatStatistic`.
 */
export * as r from './r/index.js';

/**
 * The two steps every chart shares before anything is drawn: a variable named
 * once, and named variables resolved to one row per participant.
 * `BioViz.core.variable`, `BioViz.core.frame` and `BioViz.core.label`.
 */
export * as core from './core/index.js';

/**
 * What every chart does to get its results out: a title, subtitle or footnote
 * template's placeholders filled as text, and the footnote each chart writes
 * last. `BioViz.output.fillText`, `BioViz.output.automaticFootnote`.
 */
export * as output from './output.js';

/**
 * The group comparison chart: one value across the levels of a category, as
 * boxes, violins or points. Built from safety.viz's kit, which the page loads
 * beside this bundle.
 */
export { groupComparison } from './group-comparison.js';

/**
 * The association scatter: two variables against one another, one point per
 * participant, with R's correlation coefficient beneath. Built from
 * safety.viz's kit, which the page loads beside this bundle.
 */
export { associationScatter } from './association-scatter.js';

/**
 * The correlation matrix: every pair among a set of variables as a grid, with
 * R's coefficient in each cell, and the way into the association scatter.
 * Built from safety.viz's kit, which the page loads beside this bundle.
 */
export { correlationMatrix } from './correlation-matrix.js';

/**
 * The biomarker screen: one row per biomarker for a comparison chosen once,
 * with R's estimates and p-values, unadjusted and adjusted across the rows, and
 * the way into the group comparison and the association scatter. Built from
 * safety.viz's kit, which the page loads beside this bundle.
 */
export { biomarkerScreen } from './biomarker-screen.js';

/**
 * The cross-tabulation: a two-way table of counts with its totals and
 * percentages, beside stacked bars of the same numbers, and R's chi-square or
 * Fisher's exact test of it. Either variable is a column or a cut biomarker.
 * Built from safety.viz's kit, which the page loads beside this bundle.
 */
export { crossTab } from './cross-tab.js';
export { stratifiedSurvival } from './stratified-survival.js';

/**
 * The chart list: every chart above, in safety.viz's portfolio manifest format
 * (version 2), with the tables it takes and the column each of its column
 * settings reads, so safety.viz's demo app can list and draw bio.viz's charts
 * beside its own. The site publishes the same list as `portfolio.json`.
 */
export { default as portfolio } from './data/portfolio.json';
