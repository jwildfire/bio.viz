// Settings of the biomarker screen: their defaults, and the check that turns
// what a caller wrote into what the chart reads. The column settings and the
// baseline settings are the core's, under the same names, and the rest are
// named as the other charts name them wherever they have the same thing.

import { BASELINE_STATS } from '../core/settings.js';
import { VALUE_TYPES } from '../core/variable.js';
import { OUTCOME_DEFAULTS, checkOutcomeSettings, flaggedSettings } from '../shared/outcomes.js';
import {
  checkShared,
  columnOrNull,
  fieldList,
  isPlainObject,
  isText,
  layOver,
  refuse,
  textList,
  variableSetting
} from '../shared/settings.js';
import { DOWNLOAD_DEFAULTS, TITLE_DEFAULTS } from '../shared/titles.js';

/**
 * What a row of the screen is: a difference between two groups, a correlation
 * with one variable, or a hazard ratio for high against low on an endpoint.
 */
export const COMPARISONS = Object.freeze(['difference', 'correlation', 'hazard']);

/** The coefficients a correlation can be, by the names `cor.test` gives them. */
export const METHODS = Object.freeze(['pearson', 'spearman']);

/** The adjustments across the rows, by the names `p.adjust` gives them. */
export const ADJUSTMENTS = Object.freeze(['BH', 'holm']);

/** How the rows are ordered: by R's estimate, by name, or by R's adjusted p-value. */
export const SORTS = Object.freeze(['estimate', 'name', 'adjusted']);

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
  // What the chart opens on: every biomarker, at one visit, with one value type.
  comparison: 'difference',
  visit: null,
  value_type: 'raw',
  // A difference: the column of groups, and the two groups, first minus second.
  group_by: null,
  levels: null,
  // A correlation: the variable every biomarker is correlated with.
  with: null,
  method: 'pearson',
  // A hazard ratio: the outcomes table's columns, read either way round, and
  // the endpoint the rows are of. Each biomarker is cut at its median, high
  // against low, as R's Analyze_Screen cuts it.
  outcome_id_col: OUTCOME_DEFAULTS.outcome_id_col,
  endpoint_col: OUTCOME_DEFAULTS.endpoint_col,
  endpoint_label_col: OUTCOME_DEFAULTS.endpoint_label_col,
  time_col: OUTCOME_DEFAULTS.time_col,
  censor_col: OUTCOME_DEFAULTS.censor_col,
  event_col: OUTCOME_DEFAULTS.event_col,
  endpoint: OUTCOME_DEFAULTS.endpoint,
  // Across the rows.
  adjustment: 'BH',
  sort: 'estimate',
  // The most rows on a page.
  limit: 20,
  // What the controls offer.
  measures: null,
  groups: null,
  numbers: null,
  max_levels: 12,
  filters: null,
  // The statistics.
  connection: null,
  statistic: 'Analyze_Screen',
  waiting_note: null,
  // The charts a row opens, and settings laid under what the screen carries across.
  group_comparison: null,
  association_scatter: null,
  stratified_survival: null,
  // The title, subtitle and footnotes, with placeholders (src/shared/titles.js).
  ...TITLE_DEFAULTS,
  // The downloads under the chart, and the PNG's resolution (src/shared/png.js).
  ...DOWNLOAD_DEFAULTS
});

/**
 * The settings in full: the caller's over the defaults, checked. A setting that
 * is not known, or a value a setting cannot take, is refused with a message
 * naming it.
 * @param {object} [overrides] The caller's settings.
 * @returns {object} The settings the chart reads.
 */
export function syncSettings(overrides) {
  const settings = layOver(DEFAULT_SETTINGS, flaggedSettings(overrides), 'the biomarker screen');
  checkShared(settings, BASELINE_STATS);
  checkOutcomeSettings(settings);

  for (const key of ['visit_order_col', 'unit_col', 'participant_id_col', 'group_by']) {
    columnOrNull(settings, key);
  }
  if (settings.visit !== null && !isText(settings.visit)) {
    refuse('`visit` must be the name of a visit, or null.');
  }
  if (!COMPARISONS.includes(settings.comparison)) {
    refuse(`\`comparison\` must be one of ${COMPARISONS.join(', ')}.`);
  }
  if (!VALUE_TYPES.includes(settings.value_type)) {
    refuse(`\`value_type\` must be one of ${VALUE_TYPES.join(', ')}.`);
  }
  if (!METHODS.includes(settings.method)) {
    refuse(`\`method\` must be one of ${METHODS.join(', ')}.`);
  }
  if (!ADJUSTMENTS.includes(settings.adjustment)) {
    refuse(`\`adjustment\` must be one of ${ADJUSTMENTS.join(', ')}.`);
  }
  if (!SORTS.includes(settings.sort)) refuse(`\`sort\` must be one of ${SORTS.join(', ')}.`);
  if (!Number.isInteger(settings.limit) || settings.limit < 1) {
    refuse('`limit` must be a whole number, one or more.');
  }
  if (!Number.isInteger(settings.max_levels) || settings.max_levels < 1) {
    refuse('`max_levels` must be a whole number, one or more.');
  }
  if (settings.statistic !== null && !isText(settings.statistic)) {
    refuse('`statistic` must be the name of an R function, or null for no statistics.');
  }
  for (const key of ['group_comparison', 'association_scatter', 'stratified_survival']) {
    if (settings[key] !== null && !isPlainObject(settings[key])) {
      refuse(`\`${key}\` must be an object of settings for the chart a row opens, or null.`);
    }
  }

  settings.levels = textList(settings.levels, 'levels');
  if (settings.levels && settings.levels.length !== 2) {
    refuse('`levels` must name two groups, the first and the second, or be null.');
  }
  settings.with = variableSetting(settings.with, 'with');
  settings.baseline_visits = textList(settings.baseline_visits, 'baseline_visits');
  settings.measures = textList(settings.measures, 'measures');
  settings.groups = fieldList(settings.groups, 'groups');
  settings.numbers = fieldList(settings.numbers, 'numbers');
  settings.filters = fieldList(settings.filters, 'filters');
  return settings;
}
