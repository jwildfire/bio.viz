// The statistics of the biomarker screen: every row's estimate, its interval,
// its counts and its p-value, unadjusted and adjusted across the rows. The chart
// computes none of them. It hands R the frame through the connection, once per
// screen, and prints what gsm.bio's `Analyze_Screen` returns through the shared
// formatter, which holds every p-value to the rules: with its method and its
// counts, labelled exploratory, the adjustment named, no star and no verdict.
//
// The waiting state and the rule that an answer for rows no longer drawn is
// never shown are every chart's (src/shared/statisticLine.js).
//
// Everything in this file is pure: no page and no chart. What is asked of R is
// one function of the settings, the controls and the frame (`screenRequest`),
// so the same request can be written down ahead of time, by R, as a stored
// result.

import { formatScreenRow } from '../r/formatStatistic.js';
import {
  createDesk,
  failureOf,
  filtersInForce,
  filtersSaid,
  remarksOf,
  sentence
} from '../shared/statisticLine.js';
import { flagOf } from '../shared/outcomes.js';
import { settingOf } from '../shared/variables.js';

/** What the Compare control calls each comparison. */
export const COMPARISON_LABELS = Object.freeze({
  difference: 'Difference between two groups',
  correlation: 'Correlation with one variable',
  hazard: 'Hazard ratio, high against low'
});

/**
 * The two groups of a hazard row, as R's Analyze_Screen names them: each
 * biomarker cut at its median, a value on the median low. The hazard ratio is
 * High's hazard over Low's.
 */
export const HAZARD_GROUPS = Object.freeze(['High', 'Low']);

/** What the Method control calls each coefficient. */
export const METHOD_LABELS = Object.freeze({ pearson: 'Pearson', spearman: 'Spearman' });

/** What the Adjustment control calls each adjustment. */
export const ADJUSTMENT_LABELS = Object.freeze({ BH: 'Benjamini-Hochberg', holm: 'Holm' });

/** What a row's estimate is called, by the comparison. */
export const ESTIMATE_NAMES = Object.freeze({
  difference: 'Standardised difference (Hedges’ g)',
  correlation: { pearson: 'Pearson’s r', spearman: 'Spearman’s rho' },
  hazard: 'Hazard ratio, High / Low'
});

// ---- What R is asked ---------------------------------------------------------------

/**
 * What the chart asks R for the screen: the function, the frame, the arguments
 * and the identity of the frame. One request, whatever the number of rows.
 *
 * @param {object} parts
 * @param {string} parts.name The R function (the setting `statistic`).
 * @param {object} parts.settings The chart's settings.
 * @param {object} parts.state What the controls are set to.
 * @param {object} parts.model The screen's rows and the frame (`buildScreen`).
 * @returns {{name: string, data: object[], args: object, dataId: object, rows: number}}
 */
export function screenRequest({ name, settings, state, model }) {
  const filters = filtersInForce(state.filters);
  const difference = state.comparison === 'difference';
  const hazard = state.comparison === 'hazard';
  const flag = hazard ? flagOf(settings).field : null;
  const of = () => {
    if (difference) return { strGroupCol: state.groupBy, chrGroups: [...state.levels] };
    if (hazard) {
      return {
        strTimeCol: 'time',
        ...(flag === 'censor' ? { strCensorCol: 'censor' } : { strEventCol: 'event' })
      };
    }
    return { strWithCol: model.extra, strCorMethod: state.method };
  };
  return {
    name,
    data: model.records,
    args: {
      chrCols: model.rows.map((row) => row.name),
      strComparison: state.comparison,
      ...of(),
      strPAdjust: state.adjustment
    },
    dataId: {
      chart: 'biomarker-screen',
      value_type: state.valueType,
      ...(state.valueType === 'baseline' ? {} : { visit: state.visit }),
      ...(settings.baseline_visits ? { baseline_visits: [...settings.baseline_visits] } : {}),
      baseline_stat: settings.baseline_stat,
      // What the column correlated with is: its name in the frame is a label.
      ...(state.comparison === 'correlation' ? { with: settingOf(state.with) } : {}),
      // What the rows' outcome is: the endpoint of the outcomes table.
      ...(hazard ? { endpoint: state.endpoint } : {}),
      ...(Object.keys(filters).length ? { filters } : {})
    },
    rows: model.records.length
  };
}

// ---- What the line and the rows say ----------------------------------------------

/**
 * A line that holds one sentence and nothing R returned with it.
 * @param {string} state The state of the line.
 * @param {string} said The sentence.
 * @returns {object} A description, as `describeScreen` gives one.
 */
export const plain = (state, said) => ({ ...sentence(state, said), table: null, rows: null });

/**
 * Every row R returned, in R's order, each formatted by the shared formatter,
 * with R's own numbers kept beside it for the mark, the line and the order.
 * @param {object} value What R returned.
 * @param {?string[]} groups For a difference, the two groups.
 * @returns {Array<{biomarker: string, formatted: object, estimate: ?number,
 *   lower: ?number, upper: ?number, raw: ?number, adjusted: ?number,
 *   n: ?number, groupCounts: ?number[],
 *   inAdjustment: boolean, reason: ?string, warning: ?string, order: number}>}
 */
export function rowsOf(value, groups = null) {
  const rows = Array.isArray(value && value.rows) ? value.rows : [];
  const number = (given) => (typeof given === 'number' && Number.isFinite(given) ? given : null);
  const words = (given) => (typeof given === 'string' && given.trim() !== '' ? given : null);
  return rows
    .filter((row) => row && typeof row.biomarker === 'string')
    .map((row, order) => {
      const formatted = formatScreenRow(row, groups);
      const shown = formatted.status === 'shown';
      return {
        biomarker: row.biomarker,
        formatted,
        // R's numbers, for drawing and ordering, and only for a row R computed.
        estimate: shown ? number(row.estimate) : null,
        lower: shown ? number(row.lower) : null,
        upper: shown ? number(row.upper) : null,
        raw: shown ? number(row.p_unadjusted) : null,
        adjusted: shown ? number(row.p_value) : null,
        // The counts R used: in each group for a difference, and in all.
        n: Number.isInteger(row.counts) ? row.counts : null,
        groupCounts:
          Number.isInteger(row.n_1) && Number.isInteger(row.n_2) ? [row.n_1, row.n_2] : null,
        // R says which rows it adjusted across: those it gave a number of rows for.
        inAdjustment: Number.isInteger(row.adjusted_over),
        reason: words(row.reason),
        warning: words(row.warning),
        order
      };
    });
}

/**
 * What one answer from the connection reads as under the screen, and the rows
 * it holds.
 *
 * @param {object} result What `connection.run` resolved to.
 * @param {object} [context]
 * @param {?string[]} [context.groups] For a difference, the two groups.
 * @param {string} [context.scope] What the screen covers, in a sentence.
 * @returns {{state: string, text: string, estimates: string[], table: null,
 *   remarks: Array<{kind: string, text: string}>, scope: ?string,
 *   rows: ?Array, over: ?number, adjustment: ?string}} `rows` is null unless R
 *   returned them; `over` is how many rows R adjusted across.
 */
export function describeScreen(result, context = {}) {
  if (!result || result.status !== 'ok') {
    const failure = failureOf(result);
    return plain(failure.state, failure.text);
  }
  const value = result.value && typeof result.value === 'object' ? result.value : {};
  const reason = typeof value.reason === 'string' && value.reason.trim() ? value.reason : null;
  const rows = rowsOf(value, context.groups || null);
  const shown = rows.filter((row) => row.formatted.status === 'shown');
  const overs = [...new Set(rows.map((row) => row.formatted.over).filter((over) => over !== null))];
  const names = [
    ...new Set(rows.map((row) => row.formatted.adjustment).filter((name) => name !== null))
  ];
  let described;
  if (value.status === 'error') {
    described = plain('error', `R reported an error: ${reason || 'no message'}`);
    described.rows = rows.length ? rows : null;
  } else if (reason) {
    // No row could be computed: R's reason, as R worded it, and each row's own.
    described = plain('withheld', reason);
    described.rows = rows;
  } else if (typeof value.method !== 'string' || value.method.trim() === '') {
    described = plain('refused', 'Rows not shown: the result does not name its method.');
  } else if (overs.length > 1 || names.length > 1) {
    described = plain('refused', 'Rows not shown: the rows were not adjusted as one family.');
  } else {
    const over = overs[0] ?? 0;
    const across =
      over && names.length
        ? ` The adjusted p-values are adjusted by ${names[0]} across the ${over} ` +
          `biomarker${over === 1 ? '' : 's'} that have a p-value.`
        : '';
    described = plain(
      'shown',
      `${value.method}, one row per biomarker: ${shown.length} of ${rows.length} computed.${across}`
    );
    described.rows = rows;
    described.over = over;
    described.adjustment = names[0] ?? null;
  }
  // What R said about its answer is printed with it, as R worded it.
  described.remarks = remarksOf(value);
  described.scope = context.scope || null;
  return described;
}

/**
 * What the screen covers, in plain words: the participants in the frame, that
 * a row is of the ones who have a value for it, and the filters in force.
 * @param {object} parts
 * @param {number} parts.n How many participants are in the frame.
 * @param {Array<{label: string, values: string[]}>} [parts.filters] The filters in force.
 * @returns {string} One or more sentences.
 */
export function scopeText({ n, filters = [] }) {
  const said = [
    `${n} participant${n === 1 ? ' is' : 's are'} in the frame. A row is of the ones who have ` +
      'its biomarker, so each row has its own counts.'
  ];
  if (filters.length) said.push(filtersSaid(filters));
  return said.join(' ');
}

/**
 * The desk the chart asks R through: the waiting state, and the rule that an
 * answer for rows no longer drawn is never shown.
 * @param {object} parts
 * @param {{run: Function}} parts.connection The connection to R.
 * @param {?string} [parts.note] A sentence added to the waiting text until R
 *   has answered once: what starting R costs on this page.
 * @returns {{begin: Function, idle: Function}} As `createDesk` gives it.
 */
export function createStatisticDesk({ connection, note = null }) {
  return createDesk({
    connection,
    note,
    describe: describeScreen,
    waiting: (said) => plain('waiting', said)
  });
}
