// What the correlation matrix draws, worked out from the tables: which
// variables the grid has, the frame R is handed, where each pair's cell is, and
// what a coefficient R returned looks like as a mark.
//
// Pure functions: no page and no chart. The frame comes from the core, with one
// variable per column of the grid and none of them required, so a participant
// missing some of the variables is kept with a gap: which participants a pair
// has in common is R's to count. A participant with none of the values is left
// out, and counted.
//
// Nothing here is a statistic. A mark's width and colour are read off the
// coefficient R returned; no coefficient is worked out here, not for a colour,
// not for a size and not for an order.

import { frame, visits as visitsInOrder } from '../core/frame.js';
import { coreSettings } from '../shared/settings.js';
import { keepFiltered, unitOf } from '../shared/tables.js';
import { variableOf } from '../shared/variables.js';

// The value types worked out against a baseline at a visit.
const RELATIVE = new Set(['change', 'fold_change', 'percent_change']);

const VALUE_WORDS = {
  raw: 'Result',
  baseline: 'Baseline value',
  change: 'Change from baseline',
  fold_change: 'Fold change from baseline',
  percent_change: 'Percent change from baseline'
};

// ---- The variables of the grid ---------------------------------------------------

/**
 * The variables the grid draws, in order, and what is said of them.
 *
 * Across biomarkers at one visit, they are the biomarkers chosen, in the
 * Biomarkers control's order. Across the visits of one biomarker, they are the
 * visits chosen, in visit order; for a change, a fold change or a percent
 * change the one baseline visit is left out, because there the value is the
 * same for everyone. No more than `limit` are drawn: the first of those chosen.
 *
 * @param {object} settings The chart's settings (syncSettings).
 * @param {object} state What the controls are set to: `mode`, `visit`,
 *   `biomarkers`, `measure`, `visits`, `valueType`.
 * @param {{measures: string[], visits: string[]}} offered What the tables have.
 * @param {object[]} [results] The results table, for the baseline visit when
 *   settings name none.
 * @returns {{variables: Array<{name: string, label: string, axis: object}>,
 *   chosen: number, of: string, heading: string, notDrawn: string[],
 *   message: ?string}} `variables` are named `v1`, `v2`, … as R is handed
 *   them; `chosen` is how many were chosen, of which `variables` are the first;
 *   `of` is what they are, in words; `message` says why there is no grid.
 */
export function matrixVariables(settings, state, offered, results = []) {
  const value = state.valueType;
  const config = coreSettings(settings);
  const baseline = RELATIVE.has(value)
    ? config.baseline_visits || visitsInOrder(results, config).slice(0, 1)
    : [];
  const flat = (visit) => baseline.length === 1 && baseline[0] === visit;
  const none = (of, heading, message, chosen = 0, notDrawn = []) => ({
    variables: [],
    chosen,
    of,
    heading,
    notDrawn,
    message
  });
  const named = (list) =>
    list.map((entry, index) => ({ name: `v${index + 1}`, label: entry.label, axis: entry.axis }));

  if (state.mode === 'visits') {
    const heading = `${state.measure}: ${VALUE_WORDS[value].toLowerCase()}, visit against visit`;
    if (value === 'baseline') {
      return none(
        'visits',
        heading,
        'A baseline value has no visit, so there is nothing to relate across visits. Choose ' +
          'another value, or relate biomarkers at one visit.'
      );
    }
    const chosen = state.visits
      ? offered.visits.filter((visit) => state.visits.includes(visit))
      : offered.visits;
    const drawn = chosen.filter((visit) => !flat(visit));
    return {
      variables: named(
        drawn.slice(0, settings.limit).map((visit) => ({
          label: visit,
          axis: { kind: 'measure', measure: state.measure, value, visit }
        }))
      ),
      chosen: drawn.length,
      of: 'visits',
      heading,
      notDrawn: chosen.filter(flat),
      message: drawn.length < 2 ? 'Choose two or more visits: a grid relates one to another.' : null
    };
  }

  const at = value === 'baseline' ? '' : ` at ${state.visit}`;
  const heading = `${VALUE_WORDS[value]}${at}, biomarker against biomarker`;
  if (flat(state.visit)) {
    return none(
      'biomarkers',
      heading,
      'This value is a change at the baseline visit, where it is the same for everyone. ' +
        'Choose a later visit to draw.',
      0,
      [state.visit]
    );
  }
  const chosen = state.biomarkers
    ? offered.measures.filter((measure) => state.biomarkers.includes(measure))
    : offered.measures;
  return {
    variables: named(
      chosen.slice(0, settings.limit).map((measure) => ({
        label: measure,
        axis: {
          kind: 'measure',
          measure,
          value,
          visit: value === 'baseline' ? null : state.visit
        }
      }))
    ),
    chosen: chosen.length,
    of: 'biomarkers',
    heading,
    notDrawn: [],
    message:
      chosen.length < 2 ? 'Choose two or more biomarkers: a grid relates one to another.' : null
  };
}

/**
 * How many variables the grid shows, of how many chosen, in words, and how to
 * bring others in when there are more than it draws at a time.
 * @param {{variables: object[], chosen: number, of: string}} drawn As `matrixVariables` gives it.
 * @param {number} limit The most variables drawn at a time.
 * @returns {string} One or two sentences.
 */
export function shownCount({ variables, chosen, of }, limit) {
  const shown = variables.length;
  const control = of === 'visits' ? 'Visits' : 'Biomarkers';
  if (shown >= chosen) return `All ${chosen} ${of} chosen are shown.`;
  return (
    `${shown} of ${chosen} ${of} shown: the first ${shown} of those chosen, in the ${control} ` +
    `control’s order. The grid draws at most ${limit} at a time: untick ${of} under ${control} ` +
    'to bring others in.'
  );
}

/**
 * The unit the grid's values are in, when every variable has the same one; a
 * fold change has none and a percent change is in percent.
 */
export function unitOfGrid(results, settings, variables) {
  if (!variables.length) return null;
  const [{ axis }] = variables;
  if (axis.value === 'fold_change') return null;
  if (axis.value === 'percent_change') return '%';
  const units = new Set(variables.map((entry) => unitOf(results, settings, entry.axis.measure)));
  return units.size === 1 ? [...units][0] : null;
}

// ---- The frame --------------------------------------------------------------------

/**
 * Everything the chart draws and hands to R.
 *
 * @param {{results: object[], participants: ?object[]}} tables The tables.
 * @param {object} settings The chart's settings (syncSettings).
 * @param {object} state What the controls are set to.
 * @param {{measures: string[], visits: string[]}} offered What the tables have.
 * @param {object} [options]
 * @param {Function} [options.filterMatches] safety.viz's test of one value
 *   against one filter's selection.
 * @returns {object} The grid's variables and the frame: `records` holds one
 *   row per participant who has at least one of the grid's values, with the id
 *   and one field per variable, null where the participant has no value;
 *   `participants` is how many were looked at and `empty` how many of them had
 *   none of the values.
 */
export function buildMatrix({ results, participants }, settings, state, offered, options = {}) {
  // The filters choose participants; the results of the others are set aside
  // before the frame is made.
  const { participants: kept, results: rows } = keepFiltered(
    { results, participants },
    settings,
    state.filters,
    options.filterMatches
  );
  const drawn = matrixVariables(settings, state, offered, results);
  const model = {
    ...drawn,
    records: [],
    participants: kept ? kept.length : 0,
    empty: 0,
    unused: [],
    baselineVisits: null,
    filtered: kept ? kept.length : null
  };
  if (!rows.length || drawn.variables.length < 2) return model;

  const made = frame(
    { results: rows, participants: kept || undefined },
    Object.fromEntries(drawn.variables.map((entry) => [entry.name, variableOf(entry.axis)])),
    // None is required: a participant with some of the values is in the frame.
    { ...coreSettings(settings), required: [] }
  );
  // A participant with none of the grid's values has nothing to give any pair:
  // they are left out of the frame, and counted.
  const records = made.data.filter((record) =>
    drawn.variables.some((entry) => record[entry.name] !== null)
  );
  return {
    ...model,
    records,
    participants: made.participants,
    empty: made.data.length - records.length,
    unused: made.unused,
    baselineVisits: made.baseline_visits
  };
}

/**
 * The participants who have both values of a pair, as points for a small
 * scatter: the row's variable up the side and the column's along the bottom.
 * Positions only; nothing is fitted or summarised.
 */
export function pointsOf(records, column, row) {
  return records
    .filter((record) => record[column.name] !== null && record[row.name] !== null)
    .map((record) => ({ x: record[column.name], y: record[row.name] }));
}

// ---- The grid ---------------------------------------------------------------------

/** The key a pair is found by, whichever of its two variables is named first. */
export const pairKey = (a, b) => [a, b].sort().join('\u0000');

/**
 * The cells of the grid, row by row. A cell on the diagonal is a variable with
 * itself and holds nothing. Above the diagonal a pair is given as its number;
 * below it, as a mark.
 * @param {Array<{name: string, label: string}>} variables The grid's variables.
 * @returns {Array<Array<{row: number, column: number, side: string, key: ?string}>>}
 */
export function cellsOf(variables) {
  return variables.map((row, i) =>
    variables.map((column, j) => ({
      row: i,
      column: j,
      side: i === j ? 'diagonal' : j > i ? 'number' : 'mark',
      key: i === j ? null : pairKey(row.name, column.name)
    }))
  );
}

/**
 * What a coefficient looks like as a mark: how wide, of the cell's width, what
 * colour, and whether filled or a ring. Both the width and the darkness grow
 * with the coefficient's size, so the mark reads without its colour; the sign
 * is the colour and, without colour, the shape: a positive coefficient is a
 * filled disc and a negative one a ring.
 *
 * @param {number} estimate The coefficient R returned, from −1 to 1.
 * @returns {{sign: string, size: number, color: string}} `size` is a
 *   percentage of the cell's width.
 */
export function markOf(estimate) {
  const strength = Math.min(1, Math.abs(estimate));
  const lightness = Math.round(86 - 54 * strength);
  const negative = estimate < 0;
  return {
    sign: negative ? 'negative' : 'positive',
    size: Math.round(14 + 78 * strength),
    color: negative ? `hsl(18, 82%, ${lightness}%)` : `hsl(217, 78%, ${lightness}%)`
  };
}

/**
 * A coefficient as a cell prints it: to two decimals, with a true minus sign,
 * and nought never written as minus nought.
 */
export function numberOf(estimate) {
  const fixed = estimate.toFixed(2);
  return (fixed === '-0.00' ? '0.00' : fixed).replace('-', '−');
}

/** The narrowest a cell is drawn, in pixels; narrower, the grid scrolls inside the chart. */
export const CELL_LEAST = 18;

/** The narrowest cell that holds a number, in pixels. */
export const NUMBERS_FROM = 34;

/**
 * How wide a cell is, in pixels, for a grid of so many variables in so much
 * room: as wide as the room allows, between a least width it is still a target
 * at and a greatest it need not pass. Below `NUMBERS_FROM` pixels a cell is too
 * small to hold a number, and both sides of the diagonal are marks.
 * @param {number} room The width the cells have between them, in pixels.
 * @param {number} count How many variables the grid has.
 * @param {number} [greatest=72] The widest a cell is drawn.
 * @returns {number} The cell's width.
 */
export function cellSize(room, count, greatest = 72) {
  return Math.max(CELL_LEAST, Math.min(greatest, Math.floor(room / count)));
}
