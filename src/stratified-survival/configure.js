// Settings of the stratified survival chart: their defaults, and the check that
// turns what a caller wrote into what the chart reads. The column settings and
// the baseline settings are the core's, under the same names; the outcomes
// table's columns are ADaM's time-to-event names by default; the rest are named
// as the other charts name them wherever they have the same thing.

import { BASELINE_STATS } from '../core/settings.js';
import { checkGrouping, isCut } from '../shared/cut.js';
import {
  OUTCOME_DEFAULTS,
  checkOutcomeSettings,
  flagOf,
  flaggedSettings
} from '../shared/outcomes.js';
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
  // Columns of the outcomes table: one row per participant and endpoint, with
  // the time and a flag, either way round: censored (ADaM's CNSR, 1 =
  // censored) or an event (1 = event). Exactly one of the two is named. And
  // the endpoint the chart opens on: null means the first.
  outcome_id_col: OUTCOME_DEFAULTS.outcome_id_col,
  endpoint_col: OUTCOME_DEFAULTS.endpoint_col,
  endpoint_label_col: OUTCOME_DEFAULTS.endpoint_label_col,
  time_col: OUTCOME_DEFAULTS.time_col,
  censor_col: OUTCOME_DEFAULTS.censor_col,
  event_col: OUTCOME_DEFAULTS.event_col,
  endpoint: OUTCOME_DEFAULTS.endpoint,
  // The groups, a column or a cut variable. Null means the first category column.
  group_by: null,
  // Cut variables the Group control offers beside the columns.
  cuts: null,
  // The times the at-risk strip counts at. Null means the axis's ticks.
  at_risk_times: null,
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
  statistic: 'Analyze_Survival',
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
  const settings = layOver(
    DEFAULT_SETTINGS,
    flaggedSettings(overrides),
    'the stratified survival chart'
  );
  checkShared(settings, BASELINE_STATS);
  checkBack(settings);
  checkOutcomeSettings(settings);

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
  // The groups: a column, or a biomarker or a number cut into groups by the
  // shared cut rule.
  if (isCut(settings.group_by)) checkGrouping(settings, 'group_by');
  else columnOrNull(settings, 'group_by');
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
  if (settings.at_risk_times !== null) {
    const times = settings.at_risk_times;
    if (
      !Array.isArray(times) ||
      !times.length ||
      !times.every((time) => typeof time === 'number' && Number.isFinite(time) && time >= 0) ||
      times.some((time, index) => index > 0 && !(time > times[index - 1]))
    ) {
      refuse('`at_risk_times` must be a list of times, none below 0, in ascending order, or null.');
    }
    settings.at_risk_times = [...times];
  }
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

// The flag column of the outcomes table, and which way round it is read: the
// shared reading's (src/shared/outcomes.js), named here as this chart has
// always named it.
export { flagOf };
