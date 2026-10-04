// Settings of the cross-tabulation: their defaults, and the check that turns
// what a caller wrote into what the chart reads. The column settings and the
// baseline settings are the core's, under the same names, and the rest are
// named as the other charts name them wherever they have the same thing.

import { BASELINE_STATS } from '../core/settings.js';
import { checkGrouping, isCut } from '../shared/cut.js';
import {
  checkBack,
  checkShared,
  columnOrNull,
  fieldList,
  isText,
  layOver,
  refuse,
  textList
} from '../shared/settings.js';
import { DOWNLOAD_DEFAULTS, TITLE_DEFAULTS } from '../shared/titles.js';

/** What the percentages are of: each row's total, each column's, or none. */
export const PERCENTS = Object.freeze(['row', 'col', 'none']);

/** The tests the statistics line can ask R for, by the names gsm.bio gives them, and none. */
export const TESTS = Object.freeze(['chisq', 'fisher', 'none']);

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
  // What the chart opens on: the table's two variables, each a column or a cut
  // variable, and what the percentages are of.
  row_by: null,
  col_by: null,
  percent: 'row',
  // Cut variables the Rows and Columns controls offer beside the columns.
  cuts: null,
  // What the controls offer.
  measures: null,
  groups: null,
  max_levels: 12,
  filters: null,
  // The listing of participants.
  details: null,
  page_size: 10,
  // The statistics line.
  connection: null,
  statistic: 'Analyze_Contingency',
  test: 'chisq',
  waiting_note: null,
  // A way back, when another chart opened this one in its place.
  back: null,
  // safety.viz's participant profile.
  profile: true,
  profile_details: null,
  studyday_col: null,
  normal_col_high: null,
  normal_col_low: null,
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
  const settings = layOver(DEFAULT_SETTINGS, overrides, 'the cross-tabulation');
  checkShared(settings, BASELINE_STATS);
  checkBack(settings);

  for (const key of [
    'visit_order_col',
    'unit_col',
    'participant_id_col',
    'studyday_col',
    'normal_col_high',
    'normal_col_low'
  ]) {
    columnOrNull(settings, key);
  }
  // The rows and the columns: a column, or a biomarker or a number cut into
  // groups by the shared cut rule.
  for (const key of ['row_by', 'col_by']) {
    if (isCut(settings[key])) checkGrouping(settings, key);
    else columnOrNull(settings, key);
  }
  if (settings.cuts !== null) {
    if (!Array.isArray(settings.cuts)) refuse('`cuts` must be a list of cut variables, or null.');
    settings.cuts = settings.cuts.map((spec, index) => {
      const holder = { [`cuts[${index}]`]: spec };
      if (!isCut(spec)) {
        refuse(
          `\`cuts[${index}]\` must be a cut variable: { measure, visit, cut } or { col, type: 'number', cut }.`
        );
      }
      checkGrouping(holder, `cuts[${index}]`);
      return holder[`cuts[${index}]`];
    });
  }
  if (!PERCENTS.includes(settings.percent)) {
    refuse(`\`percent\` must be one of ${PERCENTS.join(', ')}.`);
  }
  if (!TESTS.includes(settings.test)) refuse(`\`test\` must be one of ${TESTS.join(', ')}.`);
  for (const key of ['page_size', 'max_levels']) {
    if (!Number.isInteger(settings[key]) || settings[key] < 1) {
      refuse(`\`${key}\` must be a whole number, one or more.`);
    }
  }
  if (settings.statistic !== null && !isText(settings.statistic)) {
    refuse('`statistic` must be the name of an R function, or null for no statistics line.');
  }

  settings.baseline_visits = textList(settings.baseline_visits, 'baseline_visits');
  settings.measures = textList(settings.measures, 'measures');
  settings.groups = fieldList(settings.groups, 'groups');
  settings.filters = fieldList(settings.filters, 'filters');
  settings.details = fieldList(settings.details, 'details');
  settings.profile_details = fieldList(settings.profile_details, 'profile_details');
  return settings;
}
