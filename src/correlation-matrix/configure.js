// Settings of the correlation matrix: their defaults, and the check that turns
// what a caller wrote into what the chart reads. The column settings and the
// baseline settings are the core's, under the same names, and the rest are
// named as the other charts name them wherever they have the same thing.

import { BASELINE_STATS } from '../core/settings.js';
import { VALUE_TYPES } from '../core/variable.js';
import {
  checkShared,
  columnOrNull,
  fieldList,
  isPlainObject,
  isText,
  layOver,
  refuse,
  textList
} from '../shared/settings.js';

/**
 * What the grid's variables are: several biomarkers at one visit, or one
 * biomarker at several visits.
 */
export const MODES = Object.freeze(['biomarkers', 'visits']);

/** How the pairs are drawn: the grid, or a small scatter for each pair. */
export const VIEWS = Object.freeze(['grid', 'scatters']);

/** The coefficients R can be asked for, by the names `cor.test` gives them. */
export const METHODS = Object.freeze(['pearson', 'spearman']);

/** The most variables the small scatters are offered for. */
export const SCATTER_LIMIT = 6;

/**
 * Every setting of the chart, with its default.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  // Columns of the results table, and of the participant table.
  id_col: 'USUBJID',
  measure_col: 'TEST',
  value_col: 'STRESN',
  visit_col: 'VISIT',
  visit_order_col: 'VISITNUM',
  unit_col: 'STRESU',
  participant_id_col: null,
  // How a baseline is found (the core's rules).
  baseline_visits: null,
  baseline_stat: 'mean',
  // What the chart opens on.
  mode: 'biomarkers',
  visit: null,
  biomarkers: null,
  measure: null,
  visits: null,
  value_type: 'raw',
  view: 'grid',
  // The most variables drawn at a time.
  limit: 12,
  // What the controls offer.
  measures: null,
  max_levels: 12,
  filters: null,
  // The statistics.
  connection: null,
  statistic: 'Analyze_CorrelationMatrix',
  method: 'pearson',
  min_pairs: null,
  waiting_note: null,
  // The association scatter a cell opens.
  scatter: null
});

/**
 * The settings in full: the caller's over the defaults, checked. A setting that
 * is not known, or a value a setting cannot take, is refused with a message
 * naming it.
 * @param {object} [overrides] The caller's settings.
 * @returns {object} The settings the chart reads.
 */
export function syncSettings(overrides) {
  const settings = layOver(DEFAULT_SETTINGS, overrides, 'the correlation matrix');
  checkShared(settings, BASELINE_STATS);

  for (const key of ['visit_order_col', 'unit_col', 'participant_id_col']) {
    columnOrNull(settings, key);
  }
  for (const [key, what] of [
    ['visit', 'a visit'],
    ['measure', 'a biomarker']
  ]) {
    if (settings[key] !== null && !isText(settings[key])) {
      refuse(`\`${key}\` must be the name of ${what}, or null.`);
    }
  }
  if (!MODES.includes(settings.mode)) refuse(`\`mode\` must be one of ${MODES.join(', ')}.`);
  if (!VIEWS.includes(settings.view)) refuse(`\`view\` must be one of ${VIEWS.join(', ')}.`);
  if (!VALUE_TYPES.includes(settings.value_type)) {
    refuse(`\`value_type\` must be one of ${VALUE_TYPES.join(', ')}.`);
  }
  if (!METHODS.includes(settings.method)) {
    refuse(`\`method\` must be one of ${METHODS.join(', ')}.`);
  }
  if (!Number.isInteger(settings.max_levels) || settings.max_levels < 1) {
    refuse('`max_levels` must be a whole number, one or more.');
  }
  // A grid has pairs only from two variables up.
  if (!Number.isInteger(settings.limit) || settings.limit < 2) {
    refuse('`limit` must be a whole number, two or more.');
  }
  // The minimum is R's to apply, and R's to default: null sends R nothing.
  if (
    settings.min_pairs !== null &&
    !(
      typeof settings.min_pairs === 'number' &&
      Number.isFinite(settings.min_pairs) &&
      settings.min_pairs > 0
    )
  ) {
    refuse('`min_pairs` must be a number above zero, or null for R’s own minimum.');
  }
  if (settings.statistic !== null && !isText(settings.statistic)) {
    refuse('`statistic` must be the name of an R function, or null for no coefficients.');
  }
  if (settings.scatter !== null && !isPlainObject(settings.scatter)) {
    refuse('`scatter` must be an object of settings for the association scatter, or null.');
  }

  settings.baseline_visits = textList(settings.baseline_visits, 'baseline_visits');
  settings.biomarkers = textList(settings.biomarkers, 'biomarkers');
  settings.visits = textList(settings.visits, 'visits');
  settings.measures = textList(settings.measures, 'measures');
  settings.filters = fieldList(settings.filters, 'filters');
  return settings;
}
