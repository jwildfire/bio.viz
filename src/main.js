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
 * The group comparison chart: one value across the levels of a category, as
 * boxes, violins or points. Built from safety.viz's kit, which the page loads
 * beside this bundle.
 */
export { groupComparison } from './group-comparison.js';
