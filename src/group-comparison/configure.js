// Settings of the group comparison chart: their defaults, and the check that
// turns what a caller wrote into what the chart reads. The column settings and
// the baseline settings are the core's, under the same names, so one mapping
// drives the core, this chart and safety.viz's charts alike.

import { VALUE_TYPES } from '../core/variable.js';
import { BASELINE_STATS } from '../core/settings.js';

/** The marks a value can be drawn as. */
export const MARKS = Object.freeze(['box', 'violin', 'points']);

/** The scales of the value axis. */
export const Y_SCALES = Object.freeze(['linear', 'log']);

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
  statistic: 'Analyze_GroupDifference',
  test: 't',
  pairwise: false,
  waiting_note: null,
  // safety.viz's participant profile.
  profile: true,
  profile_details: null,
  studyday_col: null,
  normal_col_high: null,
  normal_col_low: null
});

const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const refuse = (message) => {
  throw new TypeError(`bio.viz: ${message}`);
};

// A column name, or { value_col, label }, as { value_col, label }.
export function fieldSpec(value, setting) {
  if (isText(value)) return { value_col: value, label: value };
  if (isPlainObject(value) && isText(value.value_col)) {
    return {
      ...value,
      value_col: value.value_col,
      label: isText(value.label) ? value.label : value.value_col
    };
  }
  return refuse(
    `\`${setting}\` holds something that is not a column name or { value_col, label }.`
  );
}

function fieldList(value, setting) {
  if (value === null || value === undefined) return null;
  const list = Array.isArray(value) ? value : [value];
  return list.map((entry) => fieldSpec(entry, setting));
}

function textList(value, setting) {
  if (value === null || value === undefined) return null;
  const list = Array.isArray(value) ? value : [value];
  if (!list.length || !list.every((entry) => isText(entry) || typeof entry === 'number')) {
    refuse(`\`${setting}\` must be a name, or a list of names.`);
  }
  return [...new Set(list.map(String))];
}

const columnOrNull = (settings, key) => {
  if (settings[key] !== null && !isText(settings[key])) {
    refuse(`\`${key}\` must be the name of a column, or null.`);
  }
};

/**
 * The settings in full: the caller's over the defaults, checked. A setting that
 * is not known, or a value a setting cannot take, is refused with a message
 * naming it.
 * @param {object} [overrides] The caller's settings.
 * @returns {object} The settings the chart reads.
 */
export function syncSettings(overrides) {
  if (overrides !== undefined && overrides !== null && !isPlainObject(overrides)) {
    refuse('the group comparison chart takes its settings as an object.');
  }
  const given = overrides || {};
  for (const key of Object.keys(given)) {
    if (!(key in DEFAULT_SETTINGS)) {
      refuse(
        `\`${key}\` is not a setting of the group comparison chart. Its settings are ` +
          `${Object.keys(DEFAULT_SETTINGS).join(', ')}.`
      );
    }
  }
  const settings = { ...DEFAULT_SETTINGS };
  for (const [key, value] of Object.entries(given)) {
    if (value !== undefined) settings[key] = value;
  }

  for (const key of ['id_col', 'measure_col', 'value_col', 'visit_col']) {
    if (!isText(settings[key])) refuse(`\`${key}\` must be the name of a column.`);
  }
  for (const key of [
    'visit_order_col',
    'unit_col',
    'participant_id_col',
    'start_value',
    'group_by',
    'color_by',
    'panel_by',
    'studyday_col',
    'normal_col_high',
    'normal_col_low'
  ]) {
    columnOrNull(settings, key);
  }
  if (!VALUE_TYPES.includes(settings.value_type)) {
    refuse(`\`value_type\` must be one of ${VALUE_TYPES.join(', ')}.`);
  }
  if (!MARKS.includes(settings.mark)) refuse(`\`mark\` must be one of ${MARKS.join(', ')}.`);
  if (!Y_SCALES.includes(settings.y_scale)) {
    refuse(`\`y_scale\` must be one of ${Y_SCALES.join(', ')}.`);
  }
  if (!BASELINE_STATS.includes(settings.baseline_stat)) {
    refuse(`\`baseline_stat\` must be one of ${BASELINE_STATS.join(', ')}.`);
  }
  for (const key of ['page_size', 'max_levels']) {
    if (!Number.isInteger(settings[key]) || settings[key] < 1) {
      refuse(`\`${key}\` must be a whole number, one or more.`);
    }
  }
  if (typeof settings.profile !== 'boolean') refuse('`profile` must be true or false.');
  if (!TESTS.includes(settings.test)) refuse(`\`test\` must be one of ${TESTS.join(', ')}.`);
  if (typeof settings.pairwise !== 'boolean') refuse('`pairwise` must be true or false.');
  if (settings.waiting_note !== null && !isText(settings.waiting_note)) {
    refuse('`waiting_note` must be a sentence, or null for none.');
  }
  if (settings.statistic !== null && !isText(settings.statistic)) {
    refuse('`statistic` must be the name of an R function, or null for no statistics line.');
  }
  if (
    settings.connection !== null &&
    (typeof settings.connection !== 'object' || typeof settings.connection.run !== 'function')
  ) {
    refuse('`connection` must be a connection to R (BioViz.r.createConnection), or null.');
  }

  settings.baseline_visits = textList(settings.baseline_visits, 'baseline_visits');
  settings.visits = textList(settings.visits, 'visits');
  settings.levels = textList(settings.levels, 'levels');
  settings.measures = textList(settings.measures, 'measures');
  settings.groups = fieldList(settings.groups, 'groups');
  settings.filters = fieldList(settings.filters, 'filters');
  settings.details = fieldList(settings.details, 'details');
  settings.profile_details = fieldList(settings.profile_details, 'profile_details');
  return settings;
}

// The settings the core reads, taken from the chart's.
export function coreSettings(settings) {
  return {
    id_col: settings.id_col,
    measure_col: settings.measure_col,
    value_col: settings.value_col,
    visit_col: settings.visit_col,
    visit_order_col: settings.visit_order_col,
    participant_id_col: settings.participant_id_col,
    baseline_visits: settings.baseline_visits,
    baseline_stat: settings.baseline_stat
  };
}
