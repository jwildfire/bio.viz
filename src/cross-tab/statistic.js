// The statistics line of the cross-tabulation: R's chi-square or Fisher's exact
// test of the table drawn. The chart computes none of it. It chooses which test
// to ask R for, hands R one row per participant through the connection, and
// prints what comes back through the formatters every chart uses. Whether an
// expected count is too small for chi-square is R's to say, and R says it in
// its notes, which the line prints as R wrote them.
//
// What is asked of R is one function of the settings, the controls and the
// table (`contingencyRequest`), so the same request can be written down ahead
// of time, by R, as a stored result (tools/r-cross-tab.R holds the recipe).
//
// Pure functions: no page and no chart.

import { formatEstimate, formatStatistic } from '../r/formatStatistic.js';
import { isCut } from '../shared/cut.js';
import {
  createDesk,
  failureOf,
  filtersInForce,
  filtersSaid,
  remarksOf,
  sentence
} from '../shared/statisticLine.js';

export { NOT_STORED, WAITING } from '../shared/statisticLine.js';

/** What the Test control calls each test. */
export const TEST_LABELS = Object.freeze({
  chisq: 'Chi-square test',
  fisher: "Fisher's exact test",
  none: 'None'
});

/** The line when no test is chosen. */
export const NO_TEST_CHOSEN = 'Statistics: no test chosen.';

/** The line when the table is not two-way: a test needs two categories each way. */
export const NOT_TWO_WAY =
  'Statistics: no test. A test of a two-way table needs two or more categories each way.';

// Whether a variable of the table is a cut biomarker that reads a baseline.
const readsBaseline = (by) =>
  isCut(by) && typeof by.measure === 'string' && by.value !== undefined && by.value !== 'raw';

/**
 * What the chart asks R for the table drawn: the function, the rows, the
 * arguments and the identity of the rows. A member of the identity that is not
 * set is left out, never written as null, so the same identity is easy to write
 * from R.
 *
 * @param {object} parts
 * @param {string} parts.name The R function (the setting `statistic`).
 * @param {string} parts.test The test: `chisq` or `fisher`.
 * @param {object} parts.settings The chart's settings.
 * @param {object} parts.state What the controls are set to.
 * @param {object} parts.model The table, as `buildTable` gives it.
 * @returns {{name: string, data: object[], args: object, dataId: object, rows: number}}
 */
export function contingencyRequest({ name, test, settings, state, model }) {
  const filters = filtersInForce(state.filters);
  // The baseline settings say what the rows are only when a cut biomarker
  // reads a baseline: its value is a baseline, or a change from one.
  const baseline = [state.rowBy, state.colBy].some(readsBaseline);
  return {
    name,
    data: model.records,
    args: {
      strRowCol: 'row',
      strColCol: 'col',
      strMethod: test,
      // The categories in the order the table draws them: a cut's low to
      // high, a column's by name with numbers as numbers, the same in every
      // browser language. Fisher's odds ratio is of the table in this order.
      chrRowGroups: [...model.rowLevels],
      chrColGroups: [...model.colLevels]
    },
    dataId: {
      chart: 'cross-tab',
      row_by: state.rowBy,
      col_by: state.colBy,
      ...(baseline && settings.baseline_visits
        ? { baseline_visits: [...settings.baseline_visits] }
        : {}),
      ...(baseline ? { baseline_stat: settings.baseline_stat } : {}),
      ...(Object.keys(filters).length ? { filters } : {})
    },
    rows: model.records.length
  };
}

const present = (value) => value !== undefined && value !== null;

// R names a category in its reason by the column the chart handed it, `row`
// or `col`: "Not computed: col = > 10 has 2." The table's own names for its
// variables are put in their place, and nothing else of R's words changes.
function named(value, names) {
  if (!names || typeof value.reason !== 'string') return value;
  const reason = value.reason.replace(
    /(^Not computed: |; )(row|col) = /g,
    (_, before, field) => `${before}${names[field] || field} = `
  );
  return { ...value, reason };
}

// Which way round Fisher's odds ratio is. R's fisher.test(), which gsm.bio's
// Analyze_Contingency runs, estimates the odds ratio of the two-by-two table
// with its rows and columns in the order it was handed them (its conditional
// maximum-likelihood estimate): the odds of the first column against the
// second in the first row, over the same odds in the second row. The chart
// hands R the table's own order, and names the groups the ratio is of.
function oriented(row, groups) {
  const rows = groups && Array.isArray(groups.rows) ? groups.rows : [];
  const cols = groups && Array.isArray(groups.cols) ? groups.cols : [];
  if (row.name !== 'odds ratio' || row.group || rows.length !== 2 || cols.length !== 2) return row;
  return {
    ...row,
    group: `${rows[0]} / ${rows[1]}, odds of ${cols[0]} against ${cols[1]}`
  };
}

/**
 * What one answer from the connection reads as on the line: R's result with
 * its method and counts, the estimate R gave an interval for (Fisher's odds
 * ratio, for two-by-two, named by which row is over which and the odds of
 * which column), and what R said about its answer.
 *
 * @param {object} result What `connection.run` resolved to.
 * @param {object} [context]
 * @param {string} [context.scope] What the test covers, in a sentence.
 * @param {{row: string, col: string}} [context.names] The table's names for its
 *   two variables, put where R's reason names the columns `row` and `col`.
 * @param {{rows: string[], cols: string[]}} [context.groups] The categories R
 *   was handed (`chrRowGroups`, `chrColGroups`), which name the odds ratio.
 * @returns {{state: string, text: string, estimates: string[],
 *   remarks: Array<{kind: string, text: string}>, scope: ?string}}
 */
export function describeAnswer(result, context = {}) {
  if (result && result.status === 'ok') {
    const value = named(
      result.value && typeof result.value === 'object' ? result.value : {},
      context.names
    );
    const formatted = formatStatistic(value);
    const described = sentence(formatted.status, formatted.text);
    if (formatted.status === 'shown') {
      described.estimates = (Array.isArray(value.estimates) ? value.estimates : [])
        .filter((row) => row && present(row.lower) && present(row.upper))
        .map((row) => formatEstimate(oriented(row, context.groups)).text);
    }
    // What R said about its answer, the small-expected warning among it, is
    // printed with it as R worded it.
    described.remarks = remarksOf(value);
    described.scope = context.scope || null;
    return described;
  }
  const failure = failureOf(result);
  return sentence(failure.state, failure.text);
}

/**
 * What the test covers, in plain words: the participants in the table, and
 * the filters in force.
 * @param {object} parts
 * @param {number} parts.n How many participants the table holds.
 * @param {Array<{label: string, values: string[]}>} [parts.filters] The filters in force.
 * @returns {string} One or more sentences.
 */
export function scopeText({ n, filters = [] }) {
  const said = [`This test is of the ${n} participant${n === 1 ? '' : 's'} in the table.`];
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
