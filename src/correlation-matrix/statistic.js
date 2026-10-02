// The statistics of the correlation matrix: every coefficient in the grid, its
// interval and its pair count. The chart computes none of them. It hands R the
// frame through the connection, with the names of the grid's columns, and
// draws and prints what comes back through the formatters every chart uses.
//
// A grid prints no p-value, by design: gsm.bio's `Analyze_CorrelationMatrix`
// returns none, and nothing here reads or prints one.
//
// The waiting state and the rule that an answer for rows no longer drawn is
// never shown are every chart's (src/shared/statisticLine.js).
//
// Everything in this file is pure: no page and no chart. What is asked of R is
// one function of the settings, the controls and the frame (`matrixRequest`),
// so the same request can be written down ahead of time, by R, as a stored
// result.

import { formatPair } from '../r/formatStatistic.js';
import {
  createDesk,
  failureOf,
  filtersInForce,
  filtersSaid,
  remarksOf,
  sentence
} from '../shared/statisticLine.js';
import { settingOf } from '../shared/variables.js';
import { pairKey } from './structureData.js';

/** What the Method control calls each coefficient. */
export const METHOD_LABELS = Object.freeze({
  pearson: 'Pearson',
  spearman: 'Spearman'
});

/** What a coefficient is called beside its number, by the method asked for. */
export const COEFFICIENT_NAMES = Object.freeze({
  pearson: 'Pearson’s r',
  spearman: 'Spearman’s rho'
});

// ---- What R is asked ---------------------------------------------------------------

/**
 * What the chart asks R for the grid: the function, the frame, the arguments
 * and the identity of the frame. One request, whatever the number of cells.
 *
 * @param {object} parts
 * @param {string} parts.name The R function (the setting `statistic`).
 * @param {string} parts.method The coefficient: `pearson` or `spearman`.
 * @param {?number} parts.minPairs The fewest complete pairs a cell needs, or
 *   null to leave the minimum to R.
 * @param {object} parts.settings The chart's settings.
 * @param {object} parts.state What the controls are set to.
 * @param {object} parts.model The grid's variables and the frame (`buildMatrix`).
 * @returns {{name: string, data: object[], args: object, dataId: object, rows: number}}
 */
export function matrixRequest({ name, method, minPairs, settings, state, model }) {
  const filters = filtersInForce(state.filters);
  return {
    name,
    data: model.records,
    args: {
      chrCols: model.variables.map((entry) => entry.name),
      strMethod: method,
      // The minimum is R's: it is sent only when the reader set one.
      ...(minPairs === null || minPairs === undefined ? {} : { nMinPairs: minPairs })
    },
    dataId: {
      chart: 'correlation-matrix',
      // The grid's variables in order, each as the settings write a variable:
      // the first is the column `v1` of the frame, the second `v2`, and so on.
      variables: model.variables.map((entry) => settingOf(entry.axis)),
      ...(settings.baseline_visits ? { baseline_visits: [...settings.baseline_visits] } : {}),
      baseline_stat: settings.baseline_stat,
      ...(Object.keys(filters).length ? { filters } : {})
    },
    rows: model.records.length
  };
}

// ---- What the line and the cells say ----------------------------------------------

/**
 * A line that holds one sentence and nothing R returned with it.
 * @param {string} state The state of the line.
 * @param {string} said The sentence.
 * @returns {object} A description, as `describeMatrix` gives one.
 */
export const plain = (state, said) => ({ ...sentence(state, said), table: null, pairs: null });

/**
 * Every pair R returned, each formatted by the shared formatter, found by its
 * two variables' names in either order.
 * @param {object} value What R returned.
 * @returns {Map<string, {formatted: object, warning: ?string, order: number}>}
 *   `order` is the pair's place in R's rows.
 */
export function pairsOf(value) {
  const rows = Array.isArray(value && value.rows) ? value.rows : [];
  const pairs = new Map();
  rows.forEach((row, order) => {
    if (!row || typeof row.x !== 'string' || typeof row.y !== 'string') return;
    pairs.set(pairKey(row.x, row.y), {
      x: row.x,
      y: row.y,
      formatted: formatPair(row),
      // The coefficient itself, for the mark: R's number, and nothing else.
      estimate: typeof row.estimate === 'number' ? row.estimate : null,
      // R's reason for a pair it computed nothing for, as R worded it.
      reason: typeof row.reason === 'string' && row.reason.trim() !== '' ? row.reason : null,
      warning: typeof row.warning === 'string' && row.warning.trim() !== '' ? row.warning : null,
      order
    });
  });
  return pairs;
}

/**
 * What one answer from the connection reads as under the grid, and the pairs
 * it holds for the cells.
 *
 * @param {object} result What `connection.run` resolved to.
 * @param {object} [context]
 * @param {string} [context.scope] What the grid covers, in a sentence.
 * @param {number} [context.variables] How many variables the grid has.
 * @returns {{state: string, text: string, estimates: string[], table: null,
 *   remarks: Array<{kind: string, text: string}>, scope: ?string,
 *   pairs: ?Map}} `pairs` is null unless R returned the grid.
 */
export function describeMatrix(result, context = {}) {
  if (!result || result.status !== 'ok') {
    const failure = failureOf(result);
    return plain(failure.state, failure.text);
  }
  const value = result.value && typeof result.value === 'object' ? result.value : {};
  const reason = typeof value.reason === 'string' && value.reason.trim() ? value.reason : null;
  let described;
  if (value.status === 'error') {
    described = plain('error', `R reported an error: ${reason || 'no message'}`);
  } else if (reason) {
    // No pair has enough complete pairs: R's reason, as R worded it.
    described = plain('withheld', reason);
    described.pairs = pairsOf(value);
  } else if (typeof value.method !== 'string' || value.method.trim() === '') {
    described = plain('refused', 'Coefficients not shown: the result does not name its method.');
  } else {
    const pairs = pairsOf(value);
    described = plain(
      'shown',
      `${value.method}, pair by pair: ${pairs.size} pair${pairs.size === 1 ? '' : 's'} of ` +
        `${context.variables} variables, each on the participants who have both of its values.`
    );
    described.pairs = pairs;
  }
  // What R said about its answer is printed with it, as R worded it.
  described.remarks = remarksOf(value);
  described.scope = context.scope || null;
  return described;
}

/**
 * What a cell says: the pair by its labels, the coefficient by its name with
 * the interval R gave, and the number of complete pairs; or R's reason where it
 * computed none.
 * @param {object} pair One entry of `pairsOf`.
 * @param {{row: string, column: string}} labels The two variables' labels.
 * @param {string} name What the coefficient is called: `Pearson’s r`.
 * @returns {string} A sentence.
 */
export function cellText(pair, labels, name) {
  const lead = `${labels.row} and ${labels.column}`;
  if (!pair) return `${lead}.`;
  const { formatted, warning } = pair;
  const said =
    formatted.status === 'shown'
      ? `${lead}: ${name} ${formatted.text}`
      : `${lead}: ${formatted.text}`;
  return warning ? `${said} R warned: ${warning}.` : said;
}

/**
 * What the grid covers, in plain words: the participants in the frame, that a
 * cell has its own count, and the filters in force.
 * @param {object} parts
 * @param {number} parts.n How many participants are in the frame.
 * @param {Array<{label: string, values: string[]}>} [parts.filters] The filters in force.
 * @returns {string} One or more sentences.
 */
export function scopeText({ n, filters = [] }) {
  const said = [
    `${n} participant${n === 1 ? ' is' : 's are'} in the frame. A cell is of the ones who have ` +
      'both of its values, so each cell has its own count, and the cells are not adjusted for ' +
      'one another.'
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
    describe: describeMatrix,
    waiting: (said) => plain('waiting', said)
  });
}
