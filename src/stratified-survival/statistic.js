// The statistics line of the stratified survival chart: R's log-rank test of
// the groups drawn, each group's median survival with its log-log interval,
// and, for two groups, the hazard ratio with its interval. The chart computes
// none of it. It hands R one row per participant drawn through the connection,
// in one call per view to gsm.bio's Analyze_Survival, and prints what comes back
// through the formatters every chart uses. Where R does not estimate the hazard
// ratio, R's note says why, and the line prints it as R wrote it.
//
// What is asked of R is one function of the settings, the controls and the
// participants drawn (`survivalRequest`), so the same request can be written
// down ahead of time, by R, as a stored result (tools/r-survival.R holds the
// recipe).
//
// Pure functions: no page and no chart.

import { formatEstimate, formatMedian, formatStatistic } from '../r/formatStatistic.js';
import { isCut } from '../shared/cut.js';
import {
  createDesk,
  failureOf,
  filtersInForce,
  filtersSaid,
  remarksOf,
  sentence,
  sorted
} from '../shared/statisticLine.js';
import { flagOf } from '../shared/outcomes.js';

export { NOT_STORED, WAITING } from '../shared/statisticLine.js';

/** The line when fewer than two groups are drawn: the log-rank test compares two or more. */
export const ONE_GROUP =
  'Statistics: no test. The log-rank test compares two or more groups, and one is drawn.';

// The groups as R is handed them: a cut's high to low, so the hazard ratio of
// two is the higher group's hazard over the lower's, as the biomarker screen's
// "High / Low" is; a column's by code point, the same in every browser language.
const keyOrder = (by, levels) => (isCut(by) ? [...levels].reverse() : sorted(levels));

// Whether the groups are a cut biomarker that reads a baseline.
const readsBaseline = (by) =>
  isCut(by) && typeof by.measure === 'string' && by.value !== undefined && by.value !== 'raw';

/**
 * What the chart asks R for the view drawn: the function, the rows, the
 * arguments and the identity of the rows. A member of the identity that is not
 * set is left out, never written as null, so the same identity is easy to write
 * from R.
 *
 * @param {object} parts
 * @param {string} parts.name The R function (the setting `statistic`).
 * @param {object} parts.settings The chart's settings.
 * @param {object} parts.state What the controls are set to, with `groupBy` the
 *   column's name or the cut variable drawn.
 * @param {object} parts.model The view, as `buildSurvival` gives it.
 * @returns {{name: string, data: object[], args: object, dataId: object, rows: number}}
 */
export function survivalRequest({ name, settings, state, model }) {
  const filters = filtersInForce(state.filters);
  const { field } = flagOf(settings);
  const baseline = readsBaseline(state.groupBy);
  return {
    name,
    data: model.records.map((record) => ({
      [settings.id_col]: record[settings.id_col],
      time: record.time,
      group: record.group,
      [field]: record.flag
    })),
    args: {
      strTimeCol: 'time',
      strGroupCol: 'group',
      ...(field === 'censor' ? { strCensorCol: 'censor' } : { strEventCol: 'event' }),
      chrGroups: keyOrder(state.groupBy, model.levels)
    },
    dataId: {
      chart: 'stratified-survival',
      endpoint: state.endpoint,
      group_by: state.groupBy,
      ...(baseline && settings.baseline_visits
        ? { baseline_visits: [...settings.baseline_visits] }
        : {}),
      ...(baseline ? { baseline_stat: settings.baseline_stat } : {}),
      ...(Object.keys(filters).length ? { filters } : {})
    },
    rows: model.records.length
  };
}

/**
 * What one answer from the connection reads as on the line: R's log-rank
 * result with its method and counts, each group's median with its interval,
 * the hazard ratio with its interval where R gave one, and what R said about
 * its answer, its note on a hazard ratio it did not estimate among it.
 *
 * @param {object} result What `connection.run` resolved to.
 * @param {object} [context]
 * @param {string} [context.scope] What the test covers, in a sentence.
 * @returns {{state: string, text: string, estimates: string[],
 *   remarks: Array<{kind: string, text: string}>, scope: ?string}}
 */
export function describeAnswer(result, context = {}) {
  if (result && result.status === 'ok') {
    const value = result.value && typeof result.value === 'object' ? result.value : {};
    const formatted = formatStatistic(value);
    const described = sentence(formatted.status, formatted.text);
    if (formatted.status === 'shown') {
      described.estimates = (Array.isArray(value.estimates) ? value.estimates : [])
        .filter((row) => row && typeof row === 'object')
        .map((row) => (row.name === 'Median' ? formatMedian(row) : formatEstimate(row)).text);
    }
    described.remarks = remarksOf(value);
    described.scope = context.scope || null;
    return described;
  }
  const failure = failureOf(result);
  return sentence(failure.state, failure.text);
}

/**
 * What the test covers, in plain words: the participants drawn, the endpoint,
 * and the filters in force.
 * @param {object} parts
 * @param {number} parts.n How many participants are drawn.
 * @param {string} parts.endpoint The endpoint, in words.
 * @param {Array<{label: string, values: string[]}>} [parts.filters] The filters in force.
 * @returns {string} One or more sentences.
 */
export function scopeText({ n, endpoint, filters = [] }) {
  const said = [`This test is of the ${n} participant${n === 1 ? '' : 's'} drawn, on ${endpoint}.`];
  if (filters.length) said.push(filtersSaid(filters));
  return said.join(' ');
}

/**
 * @param {object} parts
 * @param {{run: Function}} parts.connection The connection to R.
 * @param {?string} [parts.note] A sentence added to the waiting text until R
 *   has answered once on this connection: what starting R costs on this page.
 * @returns {{begin: Function, idle: Function, retire: Function}} The desk every
 *   chart's line is asked through (src/shared/statisticLine.js).
 */
export function createStatisticDesk({ connection, note = null }) {
  return createDesk({ connection, note, describe: describeAnswer });
}
