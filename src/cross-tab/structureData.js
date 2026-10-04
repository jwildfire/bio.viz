// What the cross-tabulation draws, worked out from the tables: the categories
// of the rows and of the columns, the two-way table of counts with its totals,
// and its row and column percentages.
//
// Pure functions: no page and no chart. Who is in the table comes from the
// core's frame; a cut variable's groups from the shared cut rule.
//
// The numbers are descriptions of the table, and nothing more: counts, totals
// and percentages. None of them tests anything. The test, chi-square or
// Fisher's exact, is R's, and is asked for through the connection.

import { frame } from '../core/frame.js';
import { cutOf, groupLabel, isCut } from '../shared/cut.js';
import { coreSettings } from '../shared/settings.js';
import { categoriesOf, keepFiltered } from '../shared/tables.js';

const grouping = (by) => (isCut(by) ? by : { col: by });

/**
 * Everything the table is: who is in it, the categories each way, the counts
 * with their totals and percentages, and, for a cut variable, how it was cut.
 *
 * @param {{results: object[], participants: ?object[]}} tables The tables.
 * @param {object} settings The chart's settings (syncSettings).
 * @param {object} state What the controls are set to: `rowBy`, `colBy` (each
 *   a column's name or a cut variable) and `filters`.
 * @param {object} [options]
 * @param {Function} [options.filterMatches] safety.viz's test of one value
 *   against one filter's selection.
 * @returns {object} `{ records, rowLevels, colLevels, counts, rowTotals,
 *   colTotals, total, percents: { row, col }, cuts, participants, dropped,
 *   unused, filtered }`. `records` holds one per participant in the table: the
 *   id, `row` and `col`, each as text.
 */
export function buildTable({ results, participants }, settings, state, options = {}) {
  const config = coreSettings(settings);
  const { participants: kept, results: rows } = keepFiltered(
    { results, participants },
    settings,
    state.filters,
    options.filterMatches
  );
  const empty = {
    records: [],
    rowLevels: [],
    colLevels: [],
    counts: [],
    rowTotals: [],
    colTotals: [],
    total: 0,
    percents: { row: [], col: [] },
    cuts: {},
    cutValues: { row: null, col: null },
    participants: kept ? kept.length : 0,
    dropped: [],
    unused: [],
    filtered: kept ? kept.length : null
  };
  // Nobody left: the filters let no participant through, or those they let
  // through have no results. The core is not handed a table of no rows.
  if (!rows.length || !state.rowBy || !state.colBy) return empty;

  // A cut variable's points are worked out on the participants the filters
  // keep who have a value of it.
  const cuts = {};
  for (const [field, by] of [
    ['row', state.rowBy],
    ['col', state.colBy]
  ]) {
    if (isCut(by)) cuts[field] = cutOf({ results: rows, participants: kept }, by, settings);
  }
  const made = frame(
    { results: rows, participants: kept || undefined },
    { row: grouping(state.rowBy), col: grouping(state.colBy) },
    config
  );
  // The value each cut was made from, by participant, for the table download
  // (#70 review); R is handed the categories alone.
  const cutValues = { row: null, col: null };
  for (const field of ['row', 'col']) if (cuts[field]) cutValues[field] = {};
  const records = made.data.map((record) => {
    const out = { [config.id_col]: record[config.id_col] };
    for (const field of ['row', 'col']) {
      out[field] = cuts[field] ? groupLabel(record[field], cuts[field]) : String(record[field]);
      if (cuts[field]) cutValues[field][record[config.id_col]] = record[field];
    }
    return out;
  });
  // The categories each way: a cut's low to high, a column's by name with
  // numbers as numbers, the same in every browser language, those with someone
  // in the table. R is handed them in this order, so Fisher's odds ratio is of
  // the table drawn.
  const levelsFor = (field) =>
    cuts[field]
      ? cuts[field].labels.filter((label) => records.some((record) => record[field] === label))
      : categoriesOf(records.map((record) => record[field]));
  const rowLevels = levelsFor('row');
  const colLevels = levelsFor('col');
  const counts = rowLevels.map((row) =>
    colLevels.map(
      (col) => records.filter((record) => record.row === row && record.col === col).length
    )
  );
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  const rowTotals = counts.map(sum);
  const colTotals = colLevels.map((_, j) => sum(counts.map((row) => row[j])));
  return {
    ...empty,
    records,
    cutValues,
    rowLevels,
    colLevels,
    counts,
    rowTotals,
    colTotals,
    total: sum(rowTotals),
    percents: {
      row: counts.map((row, i) => row.map((n) => (100 * n) / rowTotals[i])),
      col: counts.map((row) => row.map((n, j) => (100 * n) / colTotals[j]))
    },
    cuts,
    participants: made.participants,
    dropped: made.dropped,
    unused: made.unused
  };
}

/**
 * A percentage as the table writes it: one decimal place, as a percentage, as
 * R's `sprintf("%.1f%%", x)` prints it. Both round the number's exact binary
 * value; they differ only where it is exactly halfway, which R rounds to the
 * even digit and `toFixed` up. At one decimal that is a quarter (6.25, 6.75),
 * the only halfway values a binary number holds exactly.
 * @param {number} value A percentage from 0 to 100.
 * @returns {string} `34.0%`; `6.2%` for 6.25.
 */
export function percentText(value) {
  const quarters = value * 4;
  if (Number.isInteger(quarters) && quarters % 2 !== 0) {
    // Exactly halfway: the tenths, n + 0.5 exactly, to the even one.
    const tenths = Math.floor(value * 10);
    const even = tenths % 2 === 0 ? tenths : tenths + 1;
    return `${(even / 10).toFixed(1)}%`;
  }
  return `${value.toFixed(1)}%`;
}
