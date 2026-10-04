// What the biomarker screen draws, worked out from the tables: which biomarkers
// are its rows, the frame R is handed, the order of the rows R returned, and
// where on the one shared axis a row's estimate and its interval are drawn.
//
// Pure functions: no page and no chart. The frame comes from the core: one row
// per participant, one column per biomarker at the screen's visit with its
// value type, none of them required, so a participant missing some biomarkers
// is kept with a gap and R counts who each row has; and beside them the column
// of groups, for a difference, or the one variable every biomarker is
// correlated with. A participant with none of the biomarkers is left out, and
// counted.
//
// Nothing here is a statistic. The rows are ordered by numbers R returned, or
// by name; no estimate, interval, p-value or adjustment is worked out here, and
// no key to sort by that R did not return.

import { frame, visits as visitsInOrder } from '../core/frame.js';
import { flagOf, outcomesOf } from '../shared/outcomes.js';
import { coreSettings } from '../shared/settings.js';
import { columnLevels, keepFiltered, naturally } from '../shared/tables.js';
import { axisOf, sameAxis, variableOf } from '../shared/variables.js';

// The value types worked out against a baseline at a visit.
const RELATIVE = new Set(['change', 'fold_change', 'percent_change']);

const VALUE_WORDS = {
  raw: 'Result',
  baseline: 'Baseline value',
  change: 'Change from baseline',
  fold_change: 'Fold change from baseline',
  percent_change: 'Percent change from baseline'
};

/**
 * A variable by name, as a column of the frame is named and as R's notes and a
 * reader see it: a participant-level column by its name, a biomarker by its
 * name and visit, with its value type where it is not the result.
 * @param {object} axis A variable as the chart keeps it (`axisOf`).
 * @returns {string} Its name.
 */
export function variableName(axis) {
  if (axis.kind === 'column') return axis.col;
  if (axis.value === 'baseline') return `${axis.measure}, baseline value`;
  if (axis.value === 'raw') return `${axis.measure} at ${axis.visit}`;
  return `${axis.measure}, ${VALUE_WORDS[axis.value].toLowerCase()} at ${axis.visit}`;
}

/**
 * The two groups a difference compares, first and second: the ones chosen when
 * the column has both, and otherwise the column's first two, in order.
 * @param {object} tables The tables.
 * @param {?string} column The column of groups.
 * @param {?string[]} chosen The two chosen, or null.
 * @returns {{levels: string[], offered: string[]}} `levels` is empty when the
 *   column has fewer than two.
 */
export function groupsOf(tables, column, chosen) {
  const offered = column ? columnLevels(tables, column) : [];
  if (chosen && chosen.length === 2 && chosen.every((level) => offered.includes(level))) {
    return { levels: [...chosen], offered };
  }
  return { levels: offered.length >= 2 ? offered.slice(0, 2) : [], offered };
}

// ---- The rows of the screen ------------------------------------------------------

/**
 * The biomarkers the screen has rows for, in the Biomarker list's order, each at
 * the one visit with the one value type, and what is said of them. A
 * biomarker that is the variable every row is correlated with is not a row of
 * its own: its coefficient with itself is one.
 *
 * @param {object} settings The chart's settings (syncSettings).
 * @param {object} state What the controls are set to: `comparison`, `visit`,
 *   `valueType`, `groupBy`, `levels`, `with`.
 * @param {{measures: string[], visits: string[], endpoints?: Array<{endpoint:
 *   string, label: string}>}} offered What the tables have.
 * @param {object[]} [results] The results table, for the baseline visit when
 *   settings name none.
 * @returns {{rows: Array<{name: string, axis: object}>, heading: string,
 *   left: ?string, message: ?string}} `rows` are named by the biomarker,
 *   which is the frame's column; `left` says which biomarker is not a row and
 *   why; `message` says why there is nothing to screen.
 */
export function screenRows(settings, state, offered, results = []) {
  const value = state.valueType;
  const config = coreSettings(settings);
  const baseline = RELATIVE.has(value)
    ? config.baseline_visits || visitsInOrder(results, config).slice(0, 1)
    : [];
  const at = value === 'baseline' ? '' : ` at ${state.visit}`;
  const words = `${VALUE_WORDS[value]}${at}`;
  const endpoint = (offered.endpoints || []).find((entry) => entry.endpoint === state.endpoint);
  const heading =
    state.comparison === 'difference'
      ? `${words}: ${state.levels.length === 2 ? `${state.levels[0]} against ${state.levels[1]}` : 'two groups'}, standardised difference`
      : state.comparison === 'hazard'
        ? `${words}: hazard ratio, high against low, on ${endpoint ? endpoint.label : 'an endpoint'}`
        : `${words}: correlation with ${state.with ? variableName(state.with) : 'a variable'}`;
  const none = (message) => ({ rows: [], heading, left: null, message });
  if (baseline.length === 1 && baseline[0] === state.visit) {
    return none(
      'This value is a change at the baseline visit, where it is the same for everyone. ' +
        'Choose a later visit to screen.'
    );
  }
  if (state.comparison === 'difference') {
    if (!state.groupBy)
      return none('Choose a column of groups: a difference compares two of them.');
    if (state.levels.length !== 2) {
      return none('The column of groups has fewer than two groups: a difference compares two.');
    }
  } else if (state.comparison === 'hazard') {
    if (!endpoint)
      return none('Choose an endpoint: a hazard ratio is of an endpoint of the outcomes table.');
  } else if (!state.with) {
    return none('Choose the variable every biomarker is correlated with.');
  }
  let left = null;
  const rows = [];
  for (const measure of offered.measures) {
    const axis = axisOf({ measure, value, visit: value === 'baseline' ? null : state.visit });
    if (state.comparison === 'correlation' && sameAxis(axis, state.with)) {
      left = `${variableName(axis)} is the variable every row is correlated with, and is not a row of its own.`;
      continue;
    }
    rows.push({ name: measure, axis });
  }
  if (!rows.length) return { rows, heading, left, message: 'No biomarker to screen.' };
  return { rows, heading, left, message: null };
}

// ---- The frame --------------------------------------------------------------------

/**
 * Everything the chart hands to R, and what it says of who is in it.
 *
 * @param {{results: object[], participants: ?object[], outcomes?: ?object[]}} tables
 *   The tables; the outcomes table for a hazard ratio.
 * @param {object} settings The chart's settings (syncSettings).
 * @param {object} state What the controls are set to.
 * @param {{measures: string[], visits: string[], endpoints?: object[]}} offered
 *   What the tables have.
 * @param {object} [options]
 * @param {Function} [options.filterMatches] safety.viz's test of one value
 *   against one filter's selection.
 * @returns {object} The rows of the screen and the frame: `records` holds one
 *   record per participant who has at least one biomarker, with the id, one
 *   field per biomarker, and the column of groups or the variable correlated
 *   with, or for a hazard ratio the time and the flag (`censor` or `event`),
 *   null where the participant has no value; `participants` is how many
 *   were looked at, `empty` how many had none of the biomarkers, and `filtered`
 *   how many passed the filters, or null with no participant table.
 */
export function buildScreen(
  { results, participants, outcomes = null },
  settings,
  state,
  offered,
  options = {}
) {
  const { participants: kept, results: rows } = keepFiltered(
    { results, participants },
    settings,
    state.filters,
    options.filterMatches
  );
  const drawn = screenRows(settings, state, offered, results);
  const hazard = state.comparison === 'hazard';
  const extra =
    state.comparison === 'difference'
      ? { name: state.groupBy, variable: state.groupBy ? { col: state.groupBy } : null }
      : hazard
        ? { name: null, variable: null }
        : {
            name: state.with ? variableName(state.with) : null,
            variable: state.with ? variableOf(state.with) : null
          };
  // For a hazard ratio, the outcome beside the biomarkers: the time and the
  // flag, under the name the outcomes table reads it by.
  const outcomeFields = hazard ? ['time', flagOf(settings).field] : [];
  const model = {
    ...drawn,
    extra: extra.name,
    outcomeFields,
    outcomeGaps: [],
    records: [],
    participants: kept ? kept.length : 0,
    empty: 0,
    dropped: [],
    unused: [],
    baselineVisits: null,
    filtered: kept ? kept.length : null
  };
  if (drawn.message || !rows.length) return model;
  // A column of the frame is named by its biomarker; one named as another
  // column would be two columns of one name.
  const names = [
    settings.id_col,
    ...drawn.rows.map((row) => row.name),
    ...(hazard ? outcomeFields : [extra.name])
  ];
  const twice = names.find((name, index) => names.indexOf(name) !== index);
  if (twice !== undefined) {
    return {
      ...model,
      rows: [],
      message: `Two columns of the frame would be named ${twice}: rename the biomarker or the column.`
    };
  }

  // The frame names its fields internally, so a biomarker named any way at all,
  // a space at either end included, is framed; each field is then named by its
  // biomarker as written, which is how R is handed it.
  const fields = drawn.rows.map((row, index) => ({ key: `v${index + 1}`, name: row.name }));
  const extraKey = 'v0';
  const made = frame(
    { results: rows, participants: kept || undefined },
    {
      ...Object.fromEntries(
        fields.map((field, index) => [field.key, variableOf(drawn.rows[index].axis)])
      ),
      ...(extra.variable ? { [extraKey]: extra.variable } : {})
    },
    // None is required: a participant with some of the biomarkers is in the
    // frame, and R counts who each row has.
    { ...coreSettings(settings), required: [] }
  );
  // Each participant's outcome for the endpoint, or nothing where there is none
  // to use: R leaves them out of every row, and counts them.
  const outcomeOf = hazard ? outcomesOf(outcomes || [], settings, state.endpoint) : null;
  const named = made.data.map((record) => {
    const row = {
      [settings.id_col]: record[settings.id_col],
      ...Object.fromEntries(fields.map((field) => [field.name, record[field.key]]))
    };
    if (!hazard) return { ...row, [extra.name]: record[extraKey] };
    const outcome = outcomeOf(record[settings.id_col]);
    return {
      ...row,
      time: outcome.reason ? null : outcome.time,
      [outcomeFields[1]]: outcome.reason ? null : outcome.flag
    };
  });
  // A participant with none of the biomarkers gives no row anything: they are
  // left out of the frame, and counted.
  const records = named.filter((record) => drawn.rows.some((row) => record[row.name] !== null));
  // Who of the frame has no outcome to use, by reason: counted after the frame
  // is made, so a participant left out of it is not counted again.
  const gaps = new Map();
  if (hazard) {
    for (const record of records) {
      const outcome = outcomeOf(record[settings.id_col]);
      if (outcome.reason) gaps.set(outcome.reason, (gaps.get(outcome.reason) || 0) + 1);
    }
  }
  return {
    ...model,
    records,
    participants: made.participants,
    empty: named.length - records.length,
    // With no biomarker required, who is left out is who the participant table
    // does not have.
    dropped: made.dropped,
    unused: made.unused,
    outcomeGaps: [...gaps].map(([reason, n]) => ({ reason, n })),
    baselineVisits: made.baseline_visits
  };
}

// ---- The order of the rows ----------------------------------------------------------

/** What the Sort control calls each order. */
export const SORT_LABELS = Object.freeze({
  estimate: 'Estimate, largest first',
  name: 'Biomarker name',
  adjusted: 'Adjusted p-value, smallest first'
});

/**
 * The rows R returned, in the order chosen: by R's estimate, largest first; by
 * the biomarker's name; or by R's adjusted p-value, smallest first. A row R
 * gave no number for goes after those it did, and rows that tie keep R's
 * order. Nothing is computed: each order is of a number R returned, or of a name.
 * @param {Array<{biomarker: string, estimate: ?number, adjusted: ?number,
 *   order: number}>} rows The rows, as `rowsOf` gives them.
 * @param {string} sort `estimate`, `name` or `adjusted`.
 * @returns {Array} The same rows, in that order.
 */
export function sortRows(rows, sort) {
  const by = (key, descending) => (a, b) => {
    const [x, y] = [a[key], b[key]];
    if (x === null && y === null) return a.order - b.order;
    if (x === null) return 1;
    if (y === null) return -1;
    if (x === y) return a.order - b.order;
    return descending ? (x < y ? 1 : -1) : x < y ? -1 : 1;
  };
  const compare =
    sort === 'name'
      ? (a, b) => naturally(a.biomarker, b.biomarker) || a.order - b.order
      : sort === 'adjusted'
        ? by('adjusted', false)
        : by('estimate', true);
  return [...rows].sort(compare);
}

// ---- The shared axis ---------------------------------------------------------------

/**
 * The one axis every row is drawn on: from the least to the greatest of the
 * estimates and interval ends R returned, with nought always on it, and room at
 * either end. It is unit-free: a standardised difference, a coefficient, or a
 * hazard ratio, which is drawn on a logarithmic axis around 1.
 * @param {Array<{estimate: ?number, lower: ?number, upper: ?number}>} rows The rows.
 * @param {string} comparison `difference`, `correlation` or `hazard`.
 * @returns {{min: number, max: number, ticks: number[], log?: boolean,
 *   reference?: number}} The ends, and where the axis is labelled; for a hazard
 *   ratio the axis is logarithmic, and its reference line is at 1, not 0.
 */
export function axisRange(rows, comparison) {
  const values = rows
    .flatMap((row) => [row.estimate, row.lower, row.upper])
    .filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (comparison === 'hazard') {
    // A ratio, on a logarithmic axis, with 1, no difference, always on it:
    // from the power of two at or below the least ratio to the one at or
    // above the greatest, at least a half to two.
    const positive = values.filter((value) => value > 0);
    const least = Math.min(1, ...positive);
    const most = Math.max(1, ...positive);
    let min = 0.5;
    while (min > least) min /= 2;
    let max = 2;
    while (max < most) max *= 2;
    const ticks = [];
    for (let at = min; at <= max; at *= 2) ticks.push(at);
    return { min, max, ticks, log: true, reference: 1 };
  }
  if (comparison === 'correlation') {
    // A coefficient is from −1 to 1; the axis is the whole of that.
    return { min: -1, max: 1, ticks: [-1, -0.5, 0, 0.5, 1] };
  }
  const reach = Math.max(0.5, ...values.map((value) => Math.abs(value)));
  // A step of a half, a whole or two, so the labels are few and round.
  const step = reach <= 1 ? 0.5 : reach <= 2.5 ? 1 : 2;
  const end = Math.ceil(reach / step) * step;
  const ticks = [];
  for (let at = -end; at <= end + 1e-9; at += step) ticks.push(Number(at.toFixed(2)));
  return { min: -end, max: end, ticks };
}

/**
 * Where a value sits along the axis, as a percentage of its width.
 * @param {number} value The value.
 * @param {{min: number, max: number}} range The axis.
 * @returns {number} From 0 at the axis's left end to 100 at its right.
 */
export const placeOf = (value, { min, max, log = false }) => {
  const at = log
    ? (Math.log2(value) - Math.log2(min)) / (Math.log2(max) - Math.log2(min))
    : (value - min) / (max - min);
  return Math.min(100, Math.max(0, at * 100));
};
