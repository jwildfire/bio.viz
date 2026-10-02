// What the association scatter draws, worked out from the tables: which
// variables an axis can take, the panels, the points of each panel, where the
// axes run, and which points a brushed region holds.
//
// Pure functions: no page and no chart. The rows of every panel come from the
// core's frame, with x and y as two variables, so a participant missing either
// is left out and counted by reason; nothing here derives a value type.
//
// Nothing here is a statistic. A point is drawn where its two values are; a
// logarithmic axis takes the base-10 logarithm of a value; the line y = x is
// two ends of a ruler. A coefficient, a fitted line, its band, an interval or
// a p-value is R's to compute and is asked for through the connection.

import { frame, visits as visitsInOrder } from '../core/frame.js';
import { label as variableLabel } from '../core/variable.js';
import { coreSettings } from '../shared/settings.js';
import { isBlank, keepFiltered, levelsOf, unitOf } from '../shared/tables.js';
import { axisOf, variableOf } from '../shared/variables.js';

// A variable is kept and written the same way by every chart that has one on an
// axis or in a grid, in src/shared/variables.js; this file has always exported
// these, and still does.
export { axisOf, sameAxis, settingOf, variableOf } from '../shared/variables.js';

// The value types worked out against a baseline at a visit.
const RELATIVE = new Set(['change', 'fold_change', 'percent_change']);

const isNumeric = (value) => {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
};

// ---- What an axis can take -----------------------------------------------------

/**
 * The participant-level numbers an axis can take: columns in which every value
 * that is written is a number, and that hold more than one different value.
 *
 * With a participant table: its columns, other than the id. Without one: the
 * columns carried on the results rows, other than the ones the settings map,
 * that hold one value for each participant. With both, the participant table's
 * columns come first and a column of the same name on the results rows is not
 * offered twice.
 *
 * The setting `numbers`, when given, is the list, and nothing is worked out.
 * @returns {Array<{value_col: string, label: string, table: string}>}
 */
export function numberColumns({ results, participants }, settings) {
  if (settings.numbers) return settings.numbers.map((spec) => ({ ...spec, table: 'given' }));
  const columns = [];
  const taken = new Set();
  const numbers = (values) => {
    const distinct = new Set();
    for (const value of values) {
      if (isBlank(value)) continue;
      if (!isNumeric(value)) return false;
      distinct.add(Number(value));
    }
    return distinct.size > 1;
  };

  if (participants && participants.length) {
    const idCol = settings.participant_id_col || settings.id_col;
    for (const name of Object.keys(participants[0])) {
      if (name === idCol) continue;
      taken.add(name);
      if (numbers(participants.map((row) => row[name]))) {
        columns.push({ value_col: name, label: name, table: 'participants' });
      }
    }
  }

  const mapped = new Set(
    [
      settings.id_col,
      settings.measure_col,
      settings.value_col,
      settings.visit_col,
      settings.visit_order_col,
      settings.unit_col,
      settings.studyday_col,
      settings.normal_col_high,
      settings.normal_col_low
    ].filter(Boolean)
  );
  for (const name of results.length ? Object.keys(results[0]) : []) {
    if (mapped.has(name) || taken.has(name)) continue;
    // One value for each participant, or it is not a participant-level column.
    const byParticipant = new Map();
    let constant = true;
    for (const row of results) {
      if (isBlank(row[name])) continue;
      const id = String(row[settings.id_col]);
      const value = String(row[name]);
      if (!byParticipant.has(id)) byParticipant.set(id, value);
      else if (byParticipant.get(id) !== value) {
        constant = false;
        break;
      }
    }
    if (constant && numbers(byParticipant.values())) {
      columns.push({ value_col: name, label: name, table: 'results' });
    }
  }
  return columns;
}

/**
 * Whether the tables can draw an axis: its biomarker and its visit are in the
 * results table, or its column is one of the numbers offered.
 */
export function axisOffered(axis, { measures, visits, numbers }) {
  if (!axis) return false;
  if (axis.kind === 'column') return numbers.some((entry) => entry.value_col === axis.col);
  if (!measures.includes(axis.measure)) return false;
  return axis.value === 'baseline' || visits.includes(axis.visit);
}

/**
 * The two axes the chart opens on. Each is the one the settings name, when the
 * tables can draw it. Otherwise: on x, the first biomarker at the first visit;
 * on y, the second biomarker at the first visit, or with one biomarker the
 * same biomarker at the second visit, or with one visit the first
 * participant-level number, or the same variable as x.
 *
 * @param {object} settings The chart's settings.
 * @param {{measures: string[], visits: string[], numbers: object[]}} offered
 *   What the tables have.
 * @returns {{x: ?object, y: ?object, missing: string[]}} The axes, and the
 *   names of the settings (`x`, `y`) that named something the tables lack.
 */
export function openingAxes(settings, offered) {
  const { measures, visits, numbers } = offered;
  const missing = [];
  const named = (key) => {
    if (!settings[key]) return null;
    const axis = axisOf(settings[key]);
    if (axisOffered(axis, offered)) return axis;
    missing.push(key);
    return null;
  };
  const at = (measure, visit) => ({ kind: 'measure', measure, value: 'raw', visit });
  const first =
    measures.length && visits.length
      ? at(measures[0], visits[0])
      : numbers.length
        ? { kind: 'column', col: numbers[0].value_col }
        : null;
  const x = named('x') || first;
  let y = named('y');
  if (!y && x) {
    if (measures.length > 1 && visits.length) y = at(measures[1], visits[0]);
    else if (measures.length && visits.length > 1) y = at(measures[0], visits[1]);
    else if (numbers.length) y = { kind: 'column', col: numbers[0].value_col };
    else y = x;
  }
  return { x, y, missing };
}

/**
 * An axis in words, with the unit a result, a baseline or a change is measured
 * in. A fold change has no unit and a percent change is in percent. A column
 * is named by its label.
 */
export function axisTitle(results, settings, axis, numbers = []) {
  if (axis.kind === 'column') {
    const found = numbers.find((entry) => entry.value_col === axis.col);
    return found ? found.label : axis.col;
  }
  const words = variableLabel(variableOf(axis));
  if (axis.value === 'fold_change') return words;
  if (axis.value === 'percent_change') return `${words} (%)`;
  const unit = unitOf(results, settings, axis.measure);
  return unit ? `${words} (${unit})` : words;
}

/**
 * Whether an axis is a change, a fold change or a percent change read at the
 * one baseline visit, where it is the same for every participant by
 * definition: no change, or a fold of one. There is nothing to relate there.
 */
export function flatAtBaseline(axis, results, settings) {
  if (axis.kind !== 'measure' || !RELATIVE.has(axis.value)) return false;
  const config = coreSettings(settings);
  const baseline = config.baseline_visits || visitsInOrder(results, config).slice(0, 1);
  return baseline.length === 1 && baseline[0] === axis.visit;
}

// ---- The points ----------------------------------------------------------------

/** What the frame calls each variable, as the chart's notes call it. */
export const VARIABLE_WORDS = Object.freeze({
  x: 'x axis',
  y: 'y axis',
  color: 'colour',
  panel: 'panel'
});

/**
 * Everything the chart draws.
 *
 * @param {{results: object[], participants: ?object[]}} tables The tables.
 * @param {object} settings The chart's settings (syncSettings).
 * @param {object} state What the controls are set to: `x`, `y`, `colorBy`,
 *   `panelBy`, `xScale`, `yScale`, `filters`.
 * @param {object} [options]
 * @param {Function} [options.filterMatches] safety.viz's test of one value
 *   against one filter's selection.
 * @returns {object} The panels, and what is common to them.
 */
export function buildScatter({ results, participants }, settings, state, options = {}) {
  const config = coreSettings(settings);
  // The filters choose participants; the results of the others are set aside
  // before the frame is made, so they are not counted as missing from it.
  const { participants: kept, results: rows } = keepFiltered(
    { results, participants },
    settings,
    state.filters,
    options.filterMatches
  );
  const empty = {
    panels: [],
    colors: [null],
    panelLevels: [null],
    participants: kept ? kept.length : 0,
    drawn: 0,
    dropped: [],
    unused: [],
    nonPositive: { x: 0, y: 0 },
    baselineVisits: null,
    extent: null,
    filtered: kept ? kept.length : null
  };
  // A frame of nobody: the filters let no participant through.
  if (!rows.length) return empty;

  const made = frame(
    { results: rows, participants: kept || undefined },
    {
      x: variableOf(state.x),
      y: variableOf(state.y),
      ...(state.colorBy ? { color: { col: state.colorBy } } : {}),
      ...(state.panelBy ? { panel: { col: state.panelBy } } : {})
    },
    config
  );

  // A logarithmic axis has no place for zero or less. Counted for x first, so
  // a participant is left out once.
  const nonPositive = { x: 0, y: 0 };
  const data = made.data.filter((record) => {
    if (state.xScale === 'log' && !(record.x > 0)) {
      nonPositive.x += 1;
      return false;
    }
    if (state.yScale === 'log' && !(record.y > 0)) {
      nonPositive.y += 1;
      return false;
    }
    return true;
  });

  const colors = state.colorBy ? levelsOf(data.map((record) => record.color)) : [null];
  const panelLevels = state.panelBy ? levelsOf(data.map((record) => record.panel)) : [null];
  const panels = panelLevels.map((panelLevel) => {
    const records = data.filter(
      (record) => panelLevel === null || String(record.panel) === panelLevel
    );
    return {
      key: panelLevel ?? '',
      title: panelLevel ?? '',
      panelLevel,
      records,
      // How many of the panel's points each colour has, in the colours' order.
      counts: colors.map(
        (color) =>
          records.filter((record) => color === null || String(record.color) === color).length
      )
    };
  });

  const extent = data.length
    ? {
        x: [
          Math.min(...data.map((record) => record.x)),
          Math.max(...data.map((record) => record.x))
        ],
        y: [
          Math.min(...data.map((record) => record.y)),
          Math.max(...data.map((record) => record.y))
        ]
      }
    : null;

  return {
    panels,
    colors,
    panelLevels,
    participants: made.participants,
    drawn: data.length,
    dropped: made.dropped,
    unused: made.unused,
    nonPositive,
    baselineVisits: made.baseline_visits,
    extent,
    filtered: kept ? kept.length : null
  };
}

// ---- Where things are drawn ------------------------------------------------------

/**
 * A value as an axis plots it: the value itself on a linear axis, and its
 * base-10 logarithm on a logarithmic one. Arithmetic on one value, and the
 * scale the chart says a statistic was computed on.
 */
export const plotted = (value, scale) => (scale === 'log' ? Math.log10(value) : value);

/**
 * An axis: the extent of what is drawn, with a little room. On a logarithmic
 * axis the room is a ratio, so the lower end stays above zero.
 * @param {number[]} extent The least and greatest value drawn.
 * @param {string} scale `linear` or `log`.
 * @returns {number[]} The ends of the axis.
 */
export function domainOf([least, greatest], scale) {
  if (scale === 'log') {
    const factor = greatest > least ? (greatest / least) ** 0.05 : 1.05;
    return [least / factor, greatest * factor];
  }
  const room = (greatest - least) * 0.05 || Math.abs(greatest) * 0.05 || 1;
  return [least - room, greatest + room];
}

/**
 * The line y = x across the axes: the two ends of the stretch of it that lies
 * inside both, or null when no part of it does. It is a straight line whenever
 * the two axes have the same scale; with one logarithmic and one linear it is
 * a curve, given as `points` along it.
 *
 * @param {number[]} xDomain The ends of the x axis.
 * @param {number[]} yDomain The ends of the y axis.
 * @param {{x: string, y: string}} scales Each axis's scale.
 * @returns {?Array<{x: number, y: number}>} The line's points, two or more.
 */
export function identityLine(xDomain, yDomain, scales = { x: 'linear', y: 'linear' }) {
  const from = Math.max(xDomain[0], yDomain[0]);
  const to = Math.min(xDomain[1], yDomain[1]);
  if (!(to > from)) return null;
  if (scales.x === scales.y) {
    return [
      { x: from, y: from },
      { x: to, y: to }
    ];
  }
  // Evenly spaced along the logarithmic axis's own scale, so the curve is
  // smooth where it bends. Here `from` is above zero: one axis is logarithmic.
  const steps = 48;
  return Array.from({ length: steps + 1 }, (_, index) => {
    const at = from * (to / from) ** (index / steps);
    return { x: at, y: at };
  });
}

/**
 * The participants of a panel inside a brushed region: the ones whose point is
 * within it on both axes, the edges included.
 * @param {object[]} records The panel's rows.
 * @param {{x: number[], y: number[]}} region The region's ends on each axis, in
 *   the values' own units.
 * @returns {object[]} The rows inside it, in the panel's order.
 */
export function brushed(records, region) {
  const [x0, x1] = [Math.min(...region.x), Math.max(...region.x)];
  const [y0, y1] = [Math.min(...region.y), Math.max(...region.y)];
  return records.filter(
    (record) => record.x >= x0 && record.x <= x1 && record.y >= y0 && record.y <= y1
  );
}
