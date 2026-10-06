// Settings of the group comparison chart: their defaults, and the check that
// turns what a caller wrote into what the chart reads. The column settings and
// the baseline settings are the core's, under the same names, so one mapping
// drives the core, this chart and safety.viz's charts alike.

import { VALUE_TYPES } from '../core/variable.js';
import { BASELINE_STATS } from '../core/settings.js';
import { UNSCHEDULED_DEFAULTS, isUnscheduledVisit } from '../core/unscheduled.js';
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
import { checkGrouping, isCut } from '../shared/cut.js';
import { OPENING_VIEWS } from './grid.js';

// What every chart's settings share is in src/shared/settings.js; the two this
// file has always exported are still reached from here.
export { coreSettings, fieldSpec } from '../shared/settings.js';

/** The marks a value can be drawn as. */
export const MARKS = Object.freeze(['box', 'violin', 'points']);

export { OPENING_VIEWS } from './grid.js';

/** The scales of the value axis. */
export const Y_SCALES = Object.freeze(['linear', 'log']);

/** What a line of a trend tile is drawn through: each group's median, or its mean. */
export const TILE_SUMMARIES = Object.freeze(['median', 'mean']);

/**
 * What one biomarker over time is drawn as: a box per group at each visit, each
 * group's mean with one standard error either side, or its median with the
 * quartiles either side, the last two joined across the visits by a line.
 */
export const TIME_MARKS = Object.freeze(['box', 'mean_se', 'median_iqr']);

/**
 * The adjustments of the p-values across the visits of one biomarker over
 * time, by the names R's `p.adjust()` gives them: none, Holm's, or Benjamini
 * and Hochberg's. R makes the adjustment; the chart only names it.
 */
export const VISIT_ADJUSTMENTS = Object.freeze(['none', 'holm', 'BH']);

/**
 * The tests the statistics line can ask R for, by the names gsm.bio's
 * `Analyze_GroupDifference` gives them, and `none` for no test.
 */
export const TESTS = Object.freeze(['t', 'wilcoxon', 'anova', 'kruskal', 'none']);

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
  start_value: null,
  visits: null,
  value_type: 'raw',
  group_by: null,
  levels: null,
  color_by: null,
  panel_by: null,
  mark: 'box',
  y_scale: 'linear',
  // One biomarker over time, drawn when a biomarker is chosen with every visit
  // it has: what the picture is drawn as.
  time_mark: 'box',
  // What the controls offer.
  measures: null,
  groups: null,
  max_levels: 12,
  filters: null,
  // Unscheduled visits, under safety.viz's names and defaults: left out of the
  // chart at every level until switched on (src/core/unscheduled.js).
  ...UNSCHEDULED_DEFAULTS,
  // The trend tiles, drawn when no biomarker is chosen: what a line goes
  // through, and the least a tile's value axis spans, in standard deviations
  // of the results at the baseline visit.
  tile_summary: 'median',
  tile_min_spread: 1.25,
  // Which form the opening view takes, with no biomarker chosen: the trend
  // tiles, or the difference grid, a row per biomarker and a column per visit,
  // each cell the standardised difference between two groups.
  opening_view: 'tiles',
  // The two groups the grid compares, first and second: the difference is the
  // first minus the second. Null means the first two groups drawn.
  grid_groups: null,
  // How many biomarkers a page of the grid holds, and the page it opens on,
  // counted from zero: R is asked for the page drawn. The tiles draw every
  // biomarker and read neither. They are the settings of the paged overview
  // v0.2.0 drew, so a specification written for it is read as it was.
  overview_limit: 12,
  page: 0,
  // The listing of participants.
  details: null,
  page_size: 10,
  // The statistics line.
  connection: null,
  statistic: 'Analyze_GroupDifference',
  test: 't',
  pairwise: false,
  // Under one biomarker over time: the R function that answers the test at
  // every visit in one request, and how R adjusts the p-values across them.
  statistic_by_visit: 'Analyze_GroupDifferenceBy',
  visit_adjustment: 'none',
  // For the difference grid: the R function that answers every cell in one
  // request. Null means no grid is offered.
  statistic_grid: 'Analyze_DifferenceGrid',
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
  const settings = layOver(DEFAULT_SETTINGS, overrides, 'the group comparison chart');
  checkShared(settings, BASELINE_STATS);
  checkBack(settings);

  for (const key of [
    'visit_order_col',
    'unit_col',
    'participant_id_col',
    'start_value',
    'color_by',
    'studyday_col',
    'normal_col_high',
    'normal_col_low'
  ]) {
    columnOrNull(settings, key);
  }
  // The group and the panels: a column, or a biomarker or a number cut into
  // groups by the shared cut rule.
  for (const key of ['group_by', 'panel_by']) {
    if (isCut(settings[key])) checkGrouping(settings, key);
    else columnOrNull(settings, key);
  }
  if (!VALUE_TYPES.includes(settings.value_type)) {
    refuse(`\`value_type\` must be one of ${VALUE_TYPES.join(', ')}.`);
  }
  if (!MARKS.includes(settings.mark)) refuse(`\`mark\` must be one of ${MARKS.join(', ')}.`);
  if (!TIME_MARKS.includes(settings.time_mark)) {
    refuse(`\`time_mark\` must be one of ${TIME_MARKS.join(', ')}.`);
  }
  if (!Y_SCALES.includes(settings.y_scale)) {
    refuse(`\`y_scale\` must be one of ${Y_SCALES.join(', ')}.`);
  }
  for (const key of ['page_size', 'max_levels', 'overview_limit']) {
    if (!Number.isInteger(settings[key]) || settings[key] < 1) {
      refuse(`\`${key}\` must be a whole number, one or more.`);
    }
  }
  if (!Number.isInteger(settings.page) || settings.page < 0) {
    refuse('`page` must be a whole number, from 0.');
  }
  if (!OPENING_VIEWS.includes(settings.opening_view)) {
    refuse(`\`opening_view\` must be one of ${OPENING_VIEWS.join(', ')}.`);
  }
  if (settings.grid_groups !== null) {
    const pair = settings.grid_groups;
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !pair.every((group) => isText(group) || typeof group === 'number') ||
      String(pair[0]) === String(pair[1])
    ) {
      refuse(
        '`grid_groups` must name two different groups, first and second, as the difference ' +
          'grid compares them (the first minus the second), or be null for the first two drawn.'
      );
    }
  }
  if (settings.statistic_grid !== null && !isText(settings.statistic_grid)) {
    refuse('`statistic_grid` must be the name of an R function, or null for no difference grid.');
  }
  if (!TILE_SUMMARIES.includes(settings.tile_summary)) {
    refuse(`\`tile_summary\` must be one of ${TILE_SUMMARIES.join(', ')}.`);
  }
  if (
    typeof settings.tile_min_spread !== 'number' ||
    !Number.isFinite(settings.tile_min_spread) ||
    settings.tile_min_spread < 0
  ) {
    refuse(
      '`tile_min_spread` must be a number, zero or more: how many standard deviations of the ' +
        'results at the baseline visit a tile’s value axis spans at the least.'
    );
  }
  if (typeof settings.unscheduled_visits !== 'boolean') {
    refuse('`unscheduled_visits` must be true or false.');
  }
  if (settings.unscheduled_visit_pattern !== null) {
    if (!isText(settings.unscheduled_visit_pattern)) {
      refuse(
        '`unscheduled_visit_pattern` must be a regular expression written as text, ' +
          '`/source/flags` or a plain source, or null for none.'
      );
    }
    try {
      isUnscheduledVisit('', { unscheduled_visit_pattern: settings.unscheduled_visit_pattern });
    } catch (error) {
      refuse(
        `\`unscheduled_visit_pattern\` is not a regular expression a browser reads: ${error.message}.`
      );
    }
  }
  if (!TESTS.includes(settings.test)) refuse(`\`test\` must be one of ${TESTS.join(', ')}.`);
  if (typeof settings.pairwise !== 'boolean') refuse('`pairwise` must be true or false.');
  if (settings.statistic !== null && !isText(settings.statistic)) {
    refuse('`statistic` must be the name of an R function, or null for no statistics line.');
  }
  if (settings.statistic_by_visit !== null && !isText(settings.statistic_by_visit)) {
    refuse(
      '`statistic_by_visit` must be the name of an R function, or null for no test under the visits.'
    );
  }
  if (!VISIT_ADJUSTMENTS.includes(settings.visit_adjustment)) {
    refuse(
      `\`visit_adjustment\` must be one of ${VISIT_ADJUSTMENTS.join(', ')}: the name R’s ` +
        'p.adjust() gives the adjustment of the p-values across the visits.'
    );
  }

  settings.baseline_visits = textList(settings.baseline_visits, 'baseline_visits');
  settings.visits = textList(settings.visits, 'visits', { empty: true });
  settings.levels = textList(settings.levels, 'levels', { empty: true });
  if (settings.grid_groups !== null) settings.grid_groups = settings.grid_groups.map(String);
  // A list of none is a list: it names no visit, and the pattern is not read.
  settings.unscheduled_visit_values = textList(
    settings.unscheduled_visit_values,
    'unscheduled_visit_values',
    { empty: true }
  );
  settings.measures = textList(settings.measures, 'measures');
  settings.groups = fieldList(settings.groups, 'groups');
  settings.filters = fieldList(settings.filters, 'filters');
  settings.details = fieldList(settings.details, 'details');
  settings.profile_details = fieldList(settings.profile_details, 'profile_details');
  return settings;
}
