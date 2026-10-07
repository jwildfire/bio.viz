// The trend tiles: what the group comparison chart draws when no biomarker is
// chosen. One tile per biomarker; in a tile, one line per group through the
// group's median (or mean) at each visit, on the biomarker's own value axis.
//
// Pure functions: no page and no chart. Every point is worked out from the
// records the biomarker's own view draws at that visit, which come from the
// core's frame, one per participant.
//
// The numbers are descriptions of the values drawn, and nothing more: how many
// values a group has at a visit, their median and their mean, and the standard
// deviation of the results at the baseline visit, which only sets how far a
// tile's axis reaches. None of it compares one group with another: no test, no
// estimate of a difference, no interval, no p-value. Those are R's.

import { visits as visitsInOrder } from '../core/frame.js';
import { coreSettings } from '../shared/settings.js';
import { keepFiltered, levelsOf, unitOf } from '../shared/tables.js';
import { isCut } from '../shared/cut.js';
import { buildPanels } from './structureData.js';

// The room an axis leaves beyond its points at each end, as a part of what it spans.
const ROOM = 0.1;

const sum = (values) => values.reduce((total, value) => total + value, 0);

/**
 * The standard deviation of a sample, as R's `sd()` gives it: the square root
 * of the sum of squares about the mean over n − 1.
 * @param {number[]} values The sample.
 * @returns {number} The standard deviation, or NaN for fewer than two values.
 */
export function standardDeviation(values) {
  const n = values.length;
  if (n < 2) return NaN;
  const mean = sum(values) / n;
  return Math.sqrt(sum(values.map((value) => (value - mean) ** 2)) / (n - 1));
}

/**
 * What a tile's value axis is measured against: the standard deviation of the
 * results at the baseline visit, in the units of what the tile draws.
 *
 * - A result, a baseline value or a change from baseline is in the result's
 *   own units: the standard deviation itself.
 * - A fold change is a ratio to the baseline: the standard deviation over the
 *   mean. A percent change is a hundred times that.
 * - On a logarithmic axis a distance is a ratio, so the measure is the standard
 *   deviation of the base-10 logarithms of the results that are above zero. A
 *   change and a percent change are differences, not ratios, and have none.
 *
 * @param {number[]} values Each participant's result at the baseline visit.
 * @param {string} valueType The value type drawn.
 * @param {string} yScale `linear` or `log`.
 * @returns {{n: number, sd: number, mean: number, size: ?number}} How many
 *   values, their standard deviation and mean, and `size`, the measure in the
 *   axis's units (base-10 logarithms on a logarithmic axis), or null when there
 *   is none.
 */
export function yardstick(values, valueType, yScale) {
  const n = values.length;
  const sd = standardDeviation(values);
  const mean = n ? sum(values) / n : NaN;
  let size = null;
  if (yScale === 'log') {
    if (valueType !== 'change' && valueType !== 'percent_change') {
      size = standardDeviation(values.filter((value) => value > 0).map(Math.log10));
    }
  } else if (valueType === 'fold_change' || valueType === 'percent_change') {
    size = mean === 0 ? NaN : (sd / Math.abs(mean)) * (valueType === 'percent_change' ? 100 : 1);
  } else {
    size = sd;
  }
  return { n, sd, mean, size: Number.isFinite(size) ? size : null };
}

/**
 * A tile's value axis: from the least point drawn to the greatest, widened
 * about its middle until it spans `least`, then given a tenth of that as room
 * at each end. So lines that differ by less than `least` are drawn close to
 * flat, and a difference shows only when it is large beside it.
 *
 * @param {Array<?number>} points The values the lines go through.
 * @param {string} yScale `linear` or `log`. On a logarithmic axis the span and
 *   the room are of the base-10 logarithms: ratios.
 * @param {number} least The least the axis may span, in the axis's units; zero
 *   for no least.
 * @param {object} [options]
 * @param {number} [options.lowest] A value the axis is not widened below: zero,
 *   for results that cannot be negative. The axis is moved up, not cut short.
 * @returns {?{min: number, max: number, floored: boolean}} The axis's two
 *   ends, and whether it was widened to `least`; null with no point to draw.
 */
export function tileAxis(points, yScale, least, options = {}) {
  const log = yScale === 'log';
  const values = points.filter((value) => Number.isFinite(value) && (!log || value > 0));
  if (!values.length) return null;
  const to = log ? Math.log10 : (value) => value;
  const from = log ? (value) => 10 ** value : (value) => value;
  let low = to(Math.min(...values));
  let high = to(Math.max(...values));
  const floored = least > 0 && high - low < least;
  if (floored) {
    const middle = (low + high) / 2;
    low = middle - least / 2;
    high = middle + least / 2;
  }
  const bounded = !log && Number.isFinite(options.lowest);
  if (bounded && low < options.lowest) {
    high += options.lowest - low;
    low = options.lowest;
  }
  // With every point the same and no least, a little room about the one value.
  const room = (high - low) * ROOM || (log ? Math.log10(1.05) : Math.abs(high) * 0.05 || 1);
  const min = bounded ? Math.max(options.lowest, low - room) : low - room;
  return { min: from(min), max: from(high + room), floored };
}

/**
 * The unit a tile's range is printed in: the biomarker's own for a result, a
 * baseline or a change; percent for a percent change; none for a fold change.
 */
export function axisUnit(results, settings, measure, valueType) {
  if (valueType === 'fold_change') return null;
  if (valueType === 'percent_change') return '%';
  return unitOf(results, settings, measure);
}

/**
 * A tile's value axis in words, printed under the tile: its two ends and the
 * unit. On a linear axis both ends are written to the decimals the axis's span
 * calls for, about three figures of it, so `59 to 184 ng/mL` and
 * `0.25 to 0.53 mg/L`; on a logarithmic axis each end is written to three
 * significant figures, because its ends may be far apart.
 * @param {{min: number, max: number}} axis The axis's two ends.
 * @param {?string} unit The unit, or null for none.
 * @param {string} yScale `linear` or `log`.
 * @returns {string}
 */
export function rangeText({ min, max }, unit, yScale) {
  const span = max - min;
  const decimals = span > 0 ? Math.min(8, Math.max(0, 2 - Math.ceil(Math.log10(span)))) : 2;
  const said = (value) => {
    if (yScale === 'log') return String(Number(value.toPrecision(3)));
    const text = value.toFixed(decimals);
    // Nought is written without a sign.
    return Number(text) === 0 ? (0).toFixed(decimals) : text;
  };
  return `${said(min)} to ${said(max)}${unit ? ` ${unit}` : ''}`;
}

// Where no change is, for a value worked out against a baseline: the line a
// tile draws across itself there.
const REFERENCE = { change: 0, percent_change: 0, fold_change: 1 };

/**
 * The trend tiles.
 *
 * Each biomarker is framed on its own rows of the results table, so the work
 * grows with the table and not with the table times the number of biomarkers;
 * what a tile draws is what `buildPanels` gives for that biomarker with the
 * same controls. The baseline visit is found once, on the whole table the
 * filters leave, as the biomarker's own view finds it, so a biomarker first
 * measured later does not take a later baseline.
 *
 * @param {{results: object[], participants: ?object[]}} tables The tables.
 * @param {object} settings The chart's settings (syncSettings).
 * @param {object} state What the controls are set to, as `buildPanels` takes
 *   them, with `tileSummary`, `median` or `mean`. Its `measure` is not read,
 *   and its `colorBy`, `panelBy` and `mark` are not applied.
 * @param {string[]} measures The biomarkers to draw, in order.
 * @param {object} [options] As `buildPanels` takes them.
 * @returns {{tiles: object[], groups: Array<{level: string, index: number}>,
 *   filtered: ?number, baselineVisits: ?string[], cuts: object}} The tiles; the
 *   groups drawn, each with its place among all the groups, which is its
 *   colour; how many participants the filters keep, or null with no participant
 *   table; the baseline visits; and how a cut variable was cut.
 */
export function buildTiles(tables, settings, state, measures, options = {}) {
  const config = coreSettings(settings);
  const summary = state.tileSummary === 'mean' ? 'mean' : 'median';
  const { results: left, participants: kept } = keepFiltered(
    tables,
    settings,
    state.filters,
    options.filterMatches
  );
  const baselineVisits =
    config.baseline_visits || (left.length ? visitsInOrder(left, config).slice(0, 1) : []);
  const fixed = baselineVisits.length ? { ...settings, baseline_visits: baselineVisits } : settings;

  const byMeasure = new Map();
  for (const row of tables.results) {
    const name = String(row[config.measure_col]);
    if (!byMeasure.has(name)) byMeasure.set(name, []);
    byMeasure.get(name).push(row);
  }
  // A cut biomarker that makes the groups is read from its own rows.
  const cutMeasure =
    isCut(state.groupBy) && typeof state.groupBy.measure === 'string'
      ? state.groupBy.measure
      : null;
  const cutRows = cutMeasure === null ? [] : byMeasure.get(cutMeasure) || [];

  const built = measures.map((measure) => {
    const own = byMeasure.get(String(measure)) || [];
    const framed = {
      results: cutRows.length && cutMeasure !== String(measure) ? [...own, ...cutRows] : own,
      participants: tables.participants
    };
    const drawn = { ...state, measure, colorBy: '', panelBy: '', mark: 'box' };
    const model = buildPanels(framed, fixed, drawn, {
      ...options,
      everyVisit: true,
      keepBaseline: true
    });
    // Each participant's baseline value, as the core works it out: the measure
    // the axis is held to. Every value counts, whatever the scale.
    const atBaseline = buildPanels(
      framed,
      fixed,
      { ...drawn, valueType: 'baseline', yScale: 'linear' },
      options
    );
    const baselineValues = atBaseline.panels.flatMap((panel) =>
      panel.records.map((record) => record.y)
    );
    return { measure, model, measured: yardstick(baselineValues, state.valueType, state.yScale) };
  });

  // The groups, in one order for every tile: a cut's low to high, a column's by
  // name. A group's place among them all is its colour, so a level left out
  // does not hand its colour to the next.
  const cut = built.map((entry) => entry.model.cuts && entry.model.cuts.x).find(Boolean);
  const present = (key) => new Set(built.flatMap((entry) => entry.model[key]));
  const every = cut
    ? cut.labels.filter((label) => present('levels').has(label))
    : levelsOf([...present('levels')]);
  const shownLevels = present('shownLevels');
  const groups = every
    .map((level, index) => ({ level, index }))
    .filter((group) => shownLevels.has(group.level));

  const raw = state.valueType === 'raw' || state.valueType === 'baseline';
  const tiles = built.map(({ measure, model, measured }) => {
    const lines = groups
      .filter((group) => model.shownLevels.includes(group.level))
      .map((group) => ({
        ...group,
        points: model.panels.map((panel) => {
          const cell = panel.cells.find((candidate) => candidate.level === group.level);
          const n = cell ? cell.n : 0;
          const median = n ? cell.stats.median : null;
          const mean = n ? cell.stats.mean : null;
          return { visit: panel.visit, n, median, mean, value: summary === 'mean' ? mean : median };
        })
      }));
    const records = model.panels.flatMap((panel) =>
      panel.records.map((record) => ({ ...record, visit: panel.visit }))
    );
    const least = measured.size === null ? 0 : settings.tile_min_spread * measured.size;
    // A result is not drawn below zero when none of its values is.
    const lowest =
      raw && records.length && records.every((record) => record.y >= 0) ? { lowest: 0 } : {};
    const unit = axisUnit(tables.results, settings, measure, state.valueType);
    const axis = tileAxis(
      lines.flatMap((line) => line.points.map((point) => point.value)),
      state.yScale,
      least,
      lowest
    );
    return {
      measure,
      unit,
      visits: model.panels.map((panel) => panel.visit),
      lines,
      records,
      baseline: {
        visits: baselineVisits.length ? baselineVisits : null,
        n: measured.n,
        sd: measured.sd,
        mean: measured.mean
      },
      least,
      axis,
      // The axis in words, printed under the tile.
      range: axis ? rangeText(axis, unit, state.yScale) : null,
      reference: state.valueType in REFERENCE ? REFERENCE[state.valueType] : null
    };
  });

  return {
    tiles,
    groups,
    filtered: kept ? kept.length : null,
    baselineVisits: baselineVisits.length ? baselineVisits : null,
    cuts: built.length ? built[0].model.cuts || {} : {}
  };
}
