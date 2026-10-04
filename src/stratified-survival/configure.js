// Settings of the stratified survival chart: their defaults, and the check that
// turns what a caller wrote into what the chart reads. The column settings and
// the baseline settings are the core's, under the same names; the outcomes
// table's columns are ADaM's time-to-event names by default; the rest are named
// as the other charts name them wherever they have the same thing.

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
  // censored) or an event (1 = event). Exactly one of the two is named.
  outcome_id_col: null,
  endpoint_col: 'PARAMCD',
  endpoint_label_col: 'PARAM',
  time_col: 'AVAL',
  censor_col: 'CNSR',
  event_col: null,
  // What the chart opens on: the endpoint, and the groups, a column or a cut
  // variable. Null means the first endpoint, and the first category column.
  endpoint: null,
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
  normal_col_low: null
});

/**
 * The settings in full: the caller's over the defaults, checked. A setting that
 * is not known, or a value a setting cannot take, is refused with a message
 * naming it.
 * @param {object} [overrides] The caller's settings.
 * @returns {object} The settings the chart reads.
 */
export function syncSettings(overrides) {
  const given = overrides || {};
  // Naming an event column, and not the censor column, is the outcomes table
  // read the other way round: the censor column's default does not stay.
  const flagged =
    given.event_col !== undefined && given.event_col !== null && !('censor_col' in given)
      ? { ...given, censor_col: null }
      : given;
  const settings = layOver(DEFAULT_SETTINGS, flagged, 'the stratified survival chart');
  checkShared(settings, BASELINE_STATS);
  checkBack(settings);

  for (const key of [
    'visit_order_col',
    'unit_col',
    'participant_id_col',
    'outcome_id_col',
    'endpoint_label_col',
    'censor_col',
    'event_col',
    'studyday_col',
    'normal_col_high',
    'normal_col_low'
  ]) {
    columnOrNull(settings, key);
  }
  for (const key of ['endpoint_col', 'time_col']) {
    if (!isText(settings[key])) refuse(`\`${key}\` must be the name of a column.`);
  }
  if ((settings.censor_col === null) === (settings.event_col === null)) {
    refuse(
      'Name exactly one of `censor_col` (1 = censored, as ADaM’s CNSR) and `event_col` ' +
        '(1 = event); give the other as null.'
    );
  }
  if (settings.endpoint !== null && !isText(settings.endpoint)) {
    refuse('`endpoint` must be the name of an endpoint, or null for the first.');
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

/**
 * The flag column of the outcomes table, and which way round it is read.
 * @param {object} settings The chart's settings.
 * @returns {{col: string, field: 'censor'|'event'}} The column, and the name
 *   of the field the chart's rows and R's carry it under.
 */
export function flagOf(settings) {
  return settings.censor_col !== null
    ? { col: settings.censor_col, field: 'censor' }
    : { col: settings.event_col, field: 'event' };
}
