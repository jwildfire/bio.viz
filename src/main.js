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
