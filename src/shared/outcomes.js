// The outcomes table, as every chart that reads one reads it: one row per
// participant and endpoint, with the time and a flag, as ADaM's time-to-event
// datasets hold them. The flag is read either way round: censored (ADaM's
// CNSR, 1 = censored) or an event (1 = event), as gsm.bio's `Analyze_Survival`
// and `Analyze_Screen` take `strCensorCol` or `strEventCol`. The stratified
// survival chart and the biomarker screen's hazard rows read it here, once.
//
// Pure functions: no page and no chart.

import { columnOrNull, isText, refuse } from './settings.js';
import { isBlank, levelsOf } from './tables.js';

/** The settings of the outcomes table, with their defaults. */
export const OUTCOME_DEFAULTS = Object.freeze({
  outcome_id_col: null,
  endpoint_col: 'PARAMCD',
  endpoint_label_col: 'PARAM',
  time_col: 'AVAL',
  censor_col: 'CNSR',
  event_col: null,
  endpoint: null
});

/** Why a participant has no usable outcome for the endpoint, as a chart says it. */
export const LEFT_OUT = Object.freeze({
  NO_OUTCOME: 'No outcome for the endpoint',
  SEVERAL_OUTCOMES: 'More than one outcome row for the endpoint',
  MISSING_OUTCOME: 'Time or flag is missing or not a number',
  NOT_A_FLAG: 'Flag is not 0 or 1',
  NEGATIVE_TIME: 'Time is negative'
});

/**
 * A caller's settings, with the censor column's default set aside when an
 * event column is named and the censor column is not: the outcomes table read
 * the other way round.
 * @param {?object} given The caller's settings.
 * @returns {object} The settings to lay over the defaults.
 */
export function flaggedSettings(given) {
  const settings = given || {};
  return settings.event_col !== undefined &&
    settings.event_col !== null &&
    !('censor_col' in settings)
    ? { ...settings, censor_col: null }
    : settings;
}

/**
 * A chart's settings with a caller's laid over them, as `setSettings` and
 * `setData` lay them: naming an event column, and not the censor column,
 * reads the outcomes table the other way round, as it does when a chart is made.
 * @param {object} current The chart's settings.
 * @param {object} given The caller's.
 * @returns {object} The settings to check.
 */
export function laidOver(current, given) {
  return { ...current, ...flaggedSettings(given) };
}

/**
 * Checks the settings of the outcomes table, laid over the defaults: the
 * columns, exactly one flag, and the endpoint.
 * @param {object} settings The settings.
 */
export function checkOutcomeSettings(settings) {
  for (const key of ['outcome_id_col', 'endpoint_label_col', 'censor_col', 'event_col']) {
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
}

/**
 * The flag column of the outcomes table, and which way round it is read.
 * @param {object} settings The chart's settings.
 * @returns {{col: string, field: 'censor'|'event'}} The column, and the name of
 *   the field a chart's rows and R's carry it under.
 */
export function flagOf(settings) {
  return settings.censor_col !== null
    ? { col: settings.censor_col, field: 'censor' }
    : { col: settings.event_col, field: 'event' };
}

/**
 * Checks that an outcomes table has the columns the settings name: the
 * endpoint, the participant's id, the time and the flag. A column that is
 * missing is refused with a `TypeError` that names it.
 * @param {object[]} outcomes The outcomes table.
 * @param {object} settings The chart's settings.
 */
export function checkOutcomes(outcomes, settings) {
  if (!outcomes.length) return;
  const flag = flagOf(settings);
  const needed = [
    ['endpoint_col', settings.endpoint_col],
    [
      settings.outcome_id_col ? 'outcome_id_col' : 'id_col',
      settings.outcome_id_col || settings.id_col
    ],
    ['time_col', settings.time_col],
    [flag.field === 'censor' ? 'censor_col' : 'event_col', flag.col]
  ];
  for (const [key, column] of needed) {
    if (!outcomes.some((row) => column in row)) {
      refuse(`the outcomes table has no column \`${column}\` (\`${key}\`).`);
    }
  }
}

/**
 * The endpoints of an outcomes table, by name with numbers as numbers, each
 * with its label where the table has one.
 * @param {object[]} outcomes The outcomes table.
 * @param {object} settings The chart's settings.
 * @returns {Array<{endpoint: string, label: string}>}
 */
export function listEndpoints(outcomes, settings) {
  return levelsOf(outcomes.map((row) => row[settings.endpoint_col])).map((endpoint) => {
    const labelled = settings.endpoint_label_col
      ? outcomes.find(
          (row) =>
            String(row[settings.endpoint_col]) === endpoint &&
            !isBlank(row[settings.endpoint_label_col])
        )
      : null;
    return {
      endpoint,
      label: labelled ? String(labelled[settings.endpoint_label_col]) : endpoint
    };
  });
}

/** Why a row of the outcomes table is not used, as a chart says it. */
export const OUTCOME_UNUSED = Object.freeze({
  NO_PARTICIPANT: 'Outcome row for no such participant'
});

const numberOf = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  // A flag may be logical, as R's Analyze_Survival takes one.
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === 'TRUE' || value === 'true') return 1;
  if (value === 'FALSE' || value === 'false') return 0;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * Each participant's outcome for one endpoint: the time, the flag as the table
 * gives it, and whether it is an event; or why there is none to use.
 * @param {object[]} outcomes The outcomes table.
 * @param {object} settings The chart's settings.
 * @param {string} endpoint The endpoint.
 * @param {?Set<string>} [known] The participants the tables have, by id: a
 *   row for anyone else, or with no id, is not used, and counted as
 *   `strangers` on the function returned.
 * @returns {((id: string) => ({time: number, flag: number, event: boolean}|{reason: string}))
 *   & {strangers: number}} The outcome of a participant, by id.
 */
export function outcomesOf(outcomes, settings, endpoint, known = null) {
  const idCol = settings.outcome_id_col || settings.id_col;
  const flag = flagOf(settings);
  const byId = new Map();
  let strangers = 0;
  for (const row of outcomes) {
    if (String(row[settings.endpoint_col]) !== endpoint) continue;
    if (isBlank(row[idCol]) || (known && !known.has(String(row[idCol])))) {
      strangers += 1;
      continue;
    }
    const id = String(row[idCol]);
    byId.set(id, [...(byId.get(id) || []), row]);
  }
  const outcomeOf = (id) => {
    const found = byId.get(String(id)) || [];
    if (!found.length) return { reason: LEFT_OUT.NO_OUTCOME };
    if (found.length > 1) return { reason: LEFT_OUT.SEVERAL_OUTCOMES };
    const time = numberOf(found[0][settings.time_col]);
    const flagged = numberOf(found[0][flag.col]);
    if (time === null || flagged === null) return { reason: LEFT_OUT.MISSING_OUTCOME };
    if (flagged !== 0 && flagged !== 1) return { reason: LEFT_OUT.NOT_A_FLAG };
    if (time < 0) return { reason: LEFT_OUT.NEGATIVE_TIME };
    return {
      time,
      flag: flagged,
      event: flag.field === 'censor' ? flagged === 0 : flagged === 1
    };
  };
  outcomeOf.strangers = strangers;
  return outcomeOf;
}
