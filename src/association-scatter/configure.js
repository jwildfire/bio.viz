// Settings of the association scatter: their defaults, and the check that
// turns what a caller wrote into what the chart reads. The column settings and
// the baseline settings are the core's, under the same names, and the rest are
// named as the group comparison chart names them wherever the two charts have
// the same thing.

import { BASELINE_STATS } from '../core/settings.js';
import {
  variableSetting,
  checkBack,
  checkShared,
  columnOrNull,
  fieldList,
  isPlainObject,
  isText,
  layOver,
  refuse,
  textList
} from '../shared/settings.js';
import { TITLE_DEFAULTS } from '../shared/titles.js';

/** The scales of an axis. */
export const SCALES = Object.freeze(['linear', 'log']);

/**
 * The lines that can be drawn over the points: `identity` is y = x and needs
 * no statistics; `linear` and `smooth` are R's.
 */
export const FITS = Object.freeze(['none', 'identity', 'linear', 'smooth']);

/** The coefficients R can be asked for, by the names `cor.test` gives them. */
export const METHODS = Object.freeze(['pearson', 'spearman']);

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
  // What the chart opens on: the variable on each axis.
  x: null,
  y: null,
  color_by: null,
  panel_by: null,
  x_scale: 'linear',
  y_scale: 'linear',
  fit: 'none',
  // What the controls offer.
  measures: null,
  numbers: null,
  groups: null,
  max_levels: 12,
  filters: null,
  // The listing of participants.
  details: null,
  page_size: 10,
  // The statistics line.
  connection: null,
  statistic: 'Analyze_Correlation',
  method: 'pearson',
  fit_statistic: 'Analyze_Fit',
  waiting_note: null,
  // A way back, when another chart opened this one.
  back: null,
  // safety.viz's participant profile.
  profile: true,
  profile_details: null,
  studyday_col: null,
  normal_col_high: null,
  normal_col_low: null,
  // The title, subtitle and footnotes, with placeholders (src/shared/titles.js).
  ...TITLE_DEFAULTS
});

/**
 * The settings in full: the caller's over the defaults, checked. A setting that
 * is not known, or a value a setting cannot take, is refused with a message
 * naming it.
 * @param {object} [overrides] The caller's settings.
 * @returns {object} The settings the chart reads.
 */
export function syncSettings(overrides) {
  const settings = layOver(DEFAULT_SETTINGS, overrides, 'the association scatter');
  checkShared(settings, BASELINE_STATS);

  for (const key of [
    'visit_order_col',
    'unit_col',
    'participant_id_col',
    'color_by',
    'panel_by',
    'studyday_col',
    'normal_col_high',
    'normal_col_low'
  ]) {
    columnOrNull(settings, key);
  }
  for (const key of ['x_scale', 'y_scale']) {
    if (!SCALES.includes(settings[key])) {
      refuse(`\`${key}\` must be one of ${SCALES.join(', ')}.`);
    }
  }
  if (!FITS.includes(settings.fit)) refuse(`\`fit\` must be one of ${FITS.join(', ')}.`);
  if (!METHODS.includes(settings.method)) {
    refuse(`\`method\` must be one of ${METHODS.join(', ')}.`);
  }
  for (const key of ['page_size', 'max_levels']) {
    if (!Number.isInteger(settings[key]) || settings[key] < 1) {
      refuse(`\`${key}\` must be a whole number, one or more.`);
    }
  }
  if (settings.statistic !== null && !isText(settings.statistic)) {
    refuse('`statistic` must be the name of an R function, or null for no statistics line.');
  }
  if (settings.fit_statistic !== null && !isText(settings.fit_statistic)) {
    refuse(
      '`fit_statistic` must be the name of an R function, or null for no linear or smooth line.'
    );
  }
  checkBack(settings);

  settings.x = variableSetting(settings.x, 'x');
  settings.y = variableSetting(settings.y, 'y');
  settings.baseline_visits = textList(settings.baseline_visits, 'baseline_visits');
  settings.measures = textList(settings.measures, 'measures');
  settings.numbers = fieldList(settings.numbers, 'numbers');
  settings.groups = fieldList(settings.groups, 'groups');
  settings.filters = fieldList(settings.filters, 'filters');
  settings.details = fieldList(settings.details, 'details');
  settings.profile_details = fieldList(settings.profile_details, 'profile_details');
  return settings;
}
