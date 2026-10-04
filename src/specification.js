// Making a chart from its specification (#68): `BioViz.fromSpecification`. The
// specification is read as data by src/shared/specification.js, checked
// against the settings of the chart it names, and the chart is made with them.
// Nothing in it is evaluated.

import * as groupComparisonSettings from './group-comparison/configure.js';
import * as associationScatterSettings from './association-scatter/configure.js';
import * as correlationMatrixSettings from './correlation-matrix/configure.js';
import * as biomarkerScreenSettings from './biomarker-screen/configure.js';
import * as crossTabSettings from './cross-tab/configure.js';
import * as stratifiedSurvivalSettings from './stratified-survival/configure.js';
import { groupComparison } from './group-comparison.js';
import { associationScatter } from './association-scatter.js';
import { correlationMatrix } from './correlation-matrix.js';
import { biomarkerScreen } from './biomarker-screen.js';
import { crossTab } from './cross-tab.js';
import { stratifiedSurvival } from './stratified-survival.js';
import { PAGE_SETTINGS, readSpecification } from './shared/specification.js';

// Each chart a specification may name: its settings' defaults, and the
// function that makes it.
// The one list of charts a specification may name: the schema is written from
// it too (tools/write-specification-schema.mjs).
const CHARTS = {
  'group-comparison': { ...groupComparisonSettings, make: groupComparison },
  'association-scatter': { ...associationScatterSettings, make: associationScatter },
  'correlation-matrix': { ...correlationMatrixSettings, make: correlationMatrix },
  'biomarker-screen': { ...biomarkerScreenSettings, make: biomarkerScreen },
  'cross-tab': { ...crossTabSettings, make: crossTab },
  'stratified-survival': { ...stratifiedSurvivalSettings, make: stratifiedSurvival }
};

/** Each chart a specification may name, and its settings' defaults. */
export const CHART_SETTINGS = Object.freeze(
  Object.fromEntries(Object.entries(CHARTS).map(([name, entry]) => [name, entry.DEFAULT_SETTINGS]))
);

// Read, and every setting checked as the chart checks it, on a copy.
function readChecked(specification) {
  const read = readSpecification(specification, CHART_SETTINGS);
  CHARTS[read.chart].syncSettings(JSON.parse(JSON.stringify(read.settings)));
  return read;
}

/**
 * Makes the chart a specification names, with its settings and filters, in an
 * element. The tables are given to `init` on the chart returned, as for any
 * chart. A setting the specification holds that the chart does not have, a
 * filter operator it does not know, or anything in it that is not data, is
 * refused with a sentence that names it.
 *
 * @param {string|HTMLElement} element The element, or a CSS selector for it.
 * @param {object|string} specification The specification, or its JSON text.
 * @param {object} [page] What the page gives that a specification never holds:
 *   `connection`, the connection to R, and `back`, a way back.
 * @returns {object} The chart.
 */
export function fromSpecification(element, specification, page = {}) {
  const read = readChecked(specification);
  const { chart, settings } = read;
  const given = page === null || page === undefined ? {} : page;
  const others = Object.keys(given).filter((key) => !PAGE_SETTINGS.includes(key));
  if (others.length) {
    throw new TypeError(
      `bio.viz: fromSpecification takes the page's ${PAGE_SETTINGS.join(' and ')} beside the ` +
        `specification, and \`${others[0]}\` is not one: give it in the specification's settings.`
    );
  }
  const made = CHARTS[chart].make(element, { ...settings, ...given });
  // What the specification asked for, held to what the chart draws once it has
  // its tables (chart.notices).
  made.requested = { settings: read.settings, filters: read.filters };
  return made;
}

/**
 * Reads a specification without making a chart: the chart it names and the
 * settings it would be made with, every check made.
 * @param {object|string} specification The specification, or its JSON text.
 * @returns {{chart: string, settings: object, version: ?string}}
 */
export const readChartSpecification = (specification) => {
  const { chart, settings, version } = readChecked(specification);
  return { chart, settings, version };
};
