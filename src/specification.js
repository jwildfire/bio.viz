// Making a chart from its specification (#68): `BioViz.fromSpecification`. The
// specification is read as data by src/shared/specification.js, checked
// against the settings of the chart it names, and the chart is made with them.
// Nothing in it is evaluated.

import { DEFAULT_SETTINGS as GROUP_COMPARISON } from './group-comparison/configure.js';
import { DEFAULT_SETTINGS as ASSOCIATION_SCATTER } from './association-scatter/configure.js';
import { DEFAULT_SETTINGS as CORRELATION_MATRIX } from './correlation-matrix/configure.js';
import { DEFAULT_SETTINGS as BIOMARKER_SCREEN } from './biomarker-screen/configure.js';
import { DEFAULT_SETTINGS as CROSS_TAB } from './cross-tab/configure.js';
import { DEFAULT_SETTINGS as STRATIFIED_SURVIVAL } from './stratified-survival/configure.js';
import { groupComparison } from './group-comparison.js';
import { associationScatter } from './association-scatter.js';
import { correlationMatrix } from './correlation-matrix.js';
import { biomarkerScreen } from './biomarker-screen.js';
import { crossTab } from './cross-tab.js';
import { stratifiedSurvival } from './stratified-survival.js';
import { PAGE_SETTINGS, readSpecification } from './shared/specification.js';

// Each chart a specification may name: its settings' defaults, and the
// function that makes it.
const CHARTS = {
  'group-comparison': { defaults: GROUP_COMPARISON, make: groupComparison },
  'association-scatter': { defaults: ASSOCIATION_SCATTER, make: associationScatter },
  'correlation-matrix': { defaults: CORRELATION_MATRIX, make: correlationMatrix },
  'biomarker-screen': { defaults: BIOMARKER_SCREEN, make: biomarkerScreen },
  'cross-tab': { defaults: CROSS_TAB, make: crossTab },
  'stratified-survival': { defaults: STRATIFIED_SURVIVAL, make: stratifiedSurvival }
};
const DEFAULTS = Object.fromEntries(
  Object.entries(CHARTS).map(([name, entry]) => [name, entry.defaults])
);

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
  const { chart, settings } = readSpecification(specification, DEFAULTS);
  const given = page === null || page === undefined ? {} : page;
  const others = Object.keys(given).filter((key) => !PAGE_SETTINGS.includes(key));
  if (others.length) {
    throw new TypeError(
      `bio.viz: fromSpecification takes the page's ${PAGE_SETTINGS.join(' and ')} beside the ` +
        `specification, and \`${others[0]}\` is not one: give it in the specification's settings.`
    );
  }
  return CHARTS[chart].make(element, { ...settings, ...given });
}

/**
 * Reads a specification without making a chart: the chart it names and the
 * settings it would be made with, every check made.
 * @param {object|string} specification The specification, or its JSON text.
 * @returns {{chart: string, settings: object, version: ?string}}
 */
export const readChartSpecification = (specification) => readSpecification(specification, DEFAULTS);
