// What the group comparison chart draws, worked out from the tables: which
// columns can be a group, the panels, the cells of each panel (one per level of
// the group and of the colour), and the numbers that describe each cell.
//
// Pure functions: no page and no chart. The rows of every cell come from the
// core's frame; nothing here derives a value type.
//
// The numbers are descriptions of the values being drawn, and nothing more: how
// many, the quantiles a box is drawn at, the mean, and the outline of a violin.
// None of it compares one group with another. A test, an estimate, an interval
// or a p-value is R's to compute and is asked for through the connection.

import { frame, visits as visitsInOrder } from '../core/frame.js';
import { label as variableLabel } from '../core/variable.js';
import { coreSettings } from '../shared/settings.js';
import { keepFiltered, levelsOf, unitOf } from '../shared/tables.js';

// What the controls offer is read from the tables the same way by every chart,
// in src/shared/tables.js; this file has always exported it, and still does.
export {
  categoryColumns,
  columnLevels,
  filterColumns,
  levelsOf,
  listMeasures,
  listVisits,
  unitOf
} from '../shared/tables.js';

// ---- The numbers that describe a cell ----------------------------------------

/**
 * The p-quantile of a sorted sample, by linear interpolation between the two
 * nearest order statistics at position (n − 1)p: R's `quantile(type = 7)`, its
 * default, and the rule safety.viz's box plots use.
 * @param {number[]} sorted The sample, in ascending order.
 * @param {number} p A probability from 0 to 1.
 * @returns {number} The quantile, or NaN for an empty sample.
 */
export function quantile(sorted, p) {
  if (!sorted.length) return NaN;
  const position = (sorted.length - 1) * p;
  const below = Math.floor(position);
  const above = Math.ceil(position);
  if (below === above) return sorted[below];
  return sorted[below] + (sorted[above] - sorted[below]) * (position - below);
}

const sum = (values) => values.reduce((total, value) => total + value, 0);

/**
 * What a box is drawn from: the count, the 5th, 25th, 50th, 75th and 95th
 * percentiles (the whiskers, the box and the median line of safety.viz's box),
 * the mean (its marker), and the least and greatest values.
 * @param {number[]} values The cell's values.
 * @returns {object} `{ n, min, q5, q25, median, q75, q95, max, mean }`.
 */
export function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted.length ? sorted[0] : NaN,
    q5: quantile(sorted, 0.05),
    q25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q75: quantile(sorted, 0.75),
    q95: quantile(sorted, 0.95),
    max: sorted.length ? sorted[sorted.length - 1] : NaN,
    mean: sorted.length ? sum(sorted) / sorted.length : NaN
  };
}

/**
 * The smoothing width of a violin: R's `bw.nrd0`, its default for `density()`.
 * 0.9 times the lesser of the standard deviation and the interquartile range
 * over 1.34, times n to the power −1/5.
 * @param {number[]} values The cell's values, two or more.
 * @returns {number} The bandwidth, or NaN for fewer than two values.
 */
export function bandwidth(values) {
  const n = values.length;
  if (n < 2) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sum(sorted) / n;
  const deviation = Math.sqrt(sum(sorted.map((value) => (value - mean) ** 2)) / (n - 1));
  const spread = (quantile(sorted, 0.75) - quantile(sorted, 0.25)) / 1.34;
  let lesser = Math.min(deviation, spread);
  if (lesser === 0) lesser = deviation || Math.abs(sorted[0]) || 1;
  return 0.9 * lesser * n ** -0.2;
}

/**
 * The outline of a violin: a Gaussian kernel density of the values, at equally
 * spaced heights from the least value to the greatest. The outline stops at the
 * data: it does not run past the least or the greatest value.
 * @param {number[]} values The cell's values.
 * @param {number} [points=64] How many heights the density is worked out at.
 * @returns {?{bandwidth: number, at: number[], density: number[]}} The outline,
 *   or null when there are fewer than two values or they are all the same.
 */
export function density(values, points = 64) {
  const width = bandwidth(values);
  const least = Math.min(...values);
  const greatest = Math.max(...values);
  if (!Number.isFinite(width) || !(greatest > least)) return null;
  const at = Array.from(
    { length: points },
    (_, index) => least + ((greatest - least) * index) / (points - 1)
  );
  const scale = 1 / (values.length * width * Math.sqrt(2 * Math.PI));
  return {
    bandwidth: width,
    at,
    density: at.map(
      (height) =>
        scale * sum(values.map((value) => Math.exp(-0.5 * ((height - value) / width) ** 2)))
    )
  };
}

/**
 * Where a participant's point sits across its slot, from −1 to 1: a fixed
 * fraction worked out from the participant's id, so a point stays where it is
 * from one drawing to the next.
 * @param {string} id The participant's id.
 * @returns {number} A number from −1 to 1.
 */
export function jitter(id) {
  let hash = 2166136261;
  for (const character of String(id)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  // Mixed once more, so ids that differ only in their last digits do not land
  // side by side.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return ((hash >>> 0) / 4294967295) * 2 - 1;
}

// ---- The panels ---------------------------------------------------------------

// The value types worked out against a baseline at a visit.
const RELATIVE = new Set(['change', 'fold_change', 'percent_change']);

/**
 * The visits that are drawn, of the visits chosen. For a change, a fold change
 * or a percent change from baseline, the baseline visit itself is left out when
 * it is the only baseline visit: there every participant's value is the same by
 * definition (no change, a fold of one), and there is nothing to compare. With
 * several baseline visits a participant's value at one of them is measured
 * against their baseline over all of them, and every visit is drawn.
 * @param {string[]} visits The visits chosen.
 * @param {string} valueType The value type.
 * @param {string[]} baselineVisits The baseline visits.
 * @returns {string[]} The visits to draw, in the order chosen.
 */
export function visitsDrawn(visits, valueType, baselineVisits) {
  if (!RELATIVE.has(valueType) || !baselineVisits || baselineVisits.length !== 1) return visits;
  return visits.filter((visit) => visit !== baselineVisits[0]);
}

/** The one group everyone is in when no column makes a group. */
export const EVERYONE = 'All participants';

// The width of the x axis that one level's marks take, the rest being the gap
// to the next level; the colours of a level share it in equal slots.
export const BAND = 0.8;

/**
 * Where each colour's marks sit about a level's place on the x axis, and how
 * wide they are.
 * @param {number} colours How many colours there are (one when there is no colour).
 * @returns {{offsets: number[], halfWidth: number}}
 */
export function slots(colours) {
  const slot = BAND / colours;
  return {
    offsets: Array.from({ length: colours }, (_, index) => -BAND / 2 + slot * (index + 0.5)),
    halfWidth: slot * 0.4
  };
}

/**
 * The words under a level on the x axis: the level, the number of participants
 * drawn there, and, when there is a colour, the number in each colour.
 * @returns {string[]} One entry per line.
 */
export function tickLabel(level, cells) {
  const total = sum(cells.map((cell) => cell.n));
  const lines = [String(level), `n = ${total}`];
  if (cells.length > 1) lines.push(cells.map((cell) => cell.n).join(' · '));
  return lines;
}

/**
 * Everything the chart draws.
 *
 * @param {{results: object[], participants: ?object[]}} tables The tables.
 * @param {object} settings The chart's settings (syncSettings).
 * @param {object} state What the controls are set to: `measure`, `visits`,
 *   `valueType`, `groupBy`, `levels`, `colorBy`, `panelBy`, `mark`, `yScale`,
 *   `filters`.
 * @param {object} [options]
 * @param {Function} [options.filterMatches] safety.viz's test of one value
 *   against one filter's selection.
 * @returns {object} The panels, and what is common to them.
 */
export function buildPanels({ results, participants }, settings, state, options = {}) {
  const config = coreSettings(settings);
  // The filters choose participants; the results of the others are set aside
  // before the frame is made, so they are not counted as missing from it.
  const { participants: kept, results: rows } = keepFiltered(
    { results, participants },
    settings,
    state.filters,
    options.filterMatches
  );

  const needsVisit = state.valueType !== 'baseline';
  // Nobody left to draw: the filters let no participant through, or those they
  // let through have no results. The core is not handed a table of no rows,
  // which it refuses as malformed; there are no panels, and the chart says why.
  if (!rows.length) {
    return {
      panels: [],
      levels: [],
      shownLevels: [],
      colors: [null],
      panelLevels: [null],
      halfWidth: slots(1).halfWidth,
      baselineVisits: null,
      visitsNotDrawn: [],
      extent: null,
      filtered: kept ? kept.length : null,
      // No row to frame, as against rows that frame to no panel.
      noRows: true
    };
  }
  // A change at the one baseline visit is the same for everyone, so that visit
  // is not drawn: there is nothing in it to compare.
  const baselineVisits = RELATIVE.has(state.valueType)
    ? config.baseline_visits || visitsInOrder(rows, config).slice(0, 1)
    : [];
  const drawnVisits = visitsDrawn(state.visits, state.valueType, baselineVisits);
  const visitList = needsVisit ? drawnVisits : [null];
  const yOf = (visit) =>
    needsVisit
      ? { measure: state.measure, visit, value: state.valueType }
      : { measure: state.measure, value: 'baseline' };
  const variablesFor = (visit) => ({
    y: yOf(visit),
    ...(state.groupBy ? { x: { col: state.groupBy } } : {}),
    ...(state.colorBy ? { color: { col: state.colorBy } } : {}),
    ...(state.panelBy ? { panel: { col: state.panelBy } } : {})
  });

  const framed = visitList.map((visit) => {
    const made = frame(
      { results: rows, participants: kept || undefined },
      variablesFor(visit),
      config
    );
    // With no column to group by, everyone is one group.
    const all = state.groupBy ? made.data : made.data.map((record) => ({ ...record, x: EVERYONE }));
    // A logarithmic axis has no place for zero or less.
    const positive = state.yScale === 'log' ? all.filter((record) => record.y > 0) : all;
    return { visit, made, data: positive, nonPositive: made.data.length - positive.length };
  });

  const everyRecord = framed.flatMap((entry) => entry.data);
  const levels = levelsOf(everyRecord.map((record) => record.x));
  const shownLevels = state.levels
    ? levels.filter((level) => state.levels.includes(level))
    : levels;
  const colors = state.colorBy ? levelsOf(everyRecord.map((record) => record.color)) : [null];
  const panelLevels = state.panelBy ? levelsOf(everyRecord.map((record) => record.panel)) : [null];
  const { offsets, halfWidth } = slots(colors.length);
  const logged = state.yScale === 'log';

  const panels = [];
  for (const { visit, made, data, nonPositive } of framed) {
    for (const panelLevel of panelLevels) {
      const inPanel = data.filter(
        (record) =>
          shownLevels.includes(String(record.x)) &&
          (panelLevel === null || String(record.panel) === panelLevel)
      );
      const cells = [];
      shownLevels.forEach((level, levelIndex) => {
        colors.forEach((color, colorIndex) => {
          const records = inPanel.filter(
            (record) =>
              String(record.x) === level && (color === null || String(record.color) === color)
          );
          const values = records.map((record) => record.y);
          // A violin's outline is worked out on the scale the axis shows.
          const outline =
            state.mark === 'violin' && values.length
              ? density(logged ? values.map(Math.log10) : values)
              : null;
          cells.push({
            level,
            levelIndex,
            color,
            colorIndex,
            x: levelIndex + offsets[colorIndex],
            halfWidth,
            records,
            n: records.length,
            stats: summarize(values),
            density: outline && {
              bandwidth: outline.bandwidth,
              at: logged ? outline.at.map((height) => 10 ** height) : outline.at,
              density: outline.density
            }
          });
        });
      });
      const title = [needsVisit && visitList.length > 1 ? visit : null, panelLevel]
        .filter((part) => part !== null)
        .join(' · ');
      panels.push({
        key: `${visit ?? 'baseline'}\u0000${panelLevel ?? ''}`,
        title,
        visit,
        panelLevel,
        variable: yOf(visit),
        records: inPanel,
        cells,
        ticks: shownLevels.map((level) =>
          tickLabel(
            level,
            cells.filter((cell) => cell.level === level)
          )
        ),
        participants: made.participants,
        dropped: made.dropped,
        unused: made.unused,
        nonPositive
      });
    }
  }

  const values = panels.flatMap((panel) => panel.records.map((record) => record.y));
  return {
    panels,
    levels,
    shownLevels,
    colors,
    panelLevels,
    halfWidth,
    baselineVisits: framed.length
      ? framed[0].made.baseline_visits
      : baselineVisits.length
        ? baselineVisits
        : null,
    // The baseline visit that was chosen and not drawn, when there is one.
    visitsNotDrawn: needsVisit ? state.visits.filter((visit) => !drawnVisits.includes(visit)) : [],
    extent: values.length ? [Math.min(...values), Math.max(...values)] : null,
    filtered: kept ? kept.length : null
  };
}

const VALUE_WORDS = {
  raw: '',
  change: ', change from baseline',
  fold_change: ', fold change from baseline',
  percent_change: ', percent change from baseline'
};

/**
 * The y axis title: the variable in words, with the unit a result, a baseline
 * or a change is measured in. A fold change has no unit and a percent change is
 * in percent.
 */
export function yTitle(results, settings, state) {
  const { measure, valueType, visits } = state;
  let words;
  if (valueType === 'baseline') words = variableLabel({ measure, value: 'baseline' });
  else if (visits.length === 1) {
    words = variableLabel({ measure, visit: visits[0], value: valueType });
  } else {
    // Each panel names its own visit.
    words = `${measure}${VALUE_WORDS[valueType]}`;
  }
  if (valueType === 'fold_change') return words;
  if (valueType === 'percent_change') return `${words} (%)`;
  const unit = unitOf(results, settings, measure);
  return unit ? `${words} (${unit})` : words;
}

// ---- The overview ---------------------------------------------------------------

/**
 * The biomarkers one page of the overview draws: at most `limit` of them, in
 * the Biomarker control's order. A page that does not exist is brought back to
 * the nearest that does.
 * @param {string[]} measures Every biomarker the control offers, in its order.
 * @param {number} limit The most biomarkers drawn at a time.
 * @param {number} [page=0] The page asked for, counted from zero.
 * @returns {{measures: string[], page: number, pages: number, from: number,
 *   to: number, total: number}} The page's biomarkers, which page it is of how
 *   many, and the first and last of them counted from one.
 */
export function overviewPage(measures, limit, page = 0) {
  const total = measures.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const at = Math.min(Math.max(0, Math.trunc(Number(page)) || 0), pages - 1);
  const shown = measures.slice(at * limit, (at + 1) * limit);
  return {
    measures: shown,
    page: at,
    pages,
    from: total ? at * limit + 1 : 0,
    to: at * limit + shown.length,
    total
  };
}

/**
 * How many biomarkers a page of the overview shows, of how many, in words.
 * @param {{from: number, to: number, total: number, pages: number}} page A page, as `overviewPage` gives it.
 * @returns {string} A sentence.
 */
export function overviewCount({ from, to, total, pages }) {
  if (!total) return 'No biomarker to show.';
  if (pages === 1) {
    return total === 1 ? 'The one biomarker is shown.' : `All ${total} biomarkers are shown.`;
  }
  const which = from === to ? `the ${ordinal(from)}` : `${from} to ${to}`;
  return `${to - from + 1} of ${total} biomarkers shown: ${which}, in the Biomarker control’s order.`;
}

const ordinal = (n) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
  return `${n}${suffix}`;
};

/**
 * The overview: one row per biomarker of the page, each row one panel per visit
 * drawn. A row is what the single-biomarker view of that biomarker would draw,
 * without panels by a further variable: the same frames from the core, one
 * record per participant in every panel, and one value axis for the row.
 * Nothing is pooled across visits or across biomarkers.
 *
 * @param {{results: object[], participants: ?object[]}} tables The tables.
 * @param {object} settings The chart's settings (syncSettings).
 * @param {object} state What the controls are set to. Its `measure` is not
 *   read, and its `panelBy` is not applied: the panels are the visits.
 * @param {string[]} measures The biomarkers to draw, in order.
 * @param {object} [options] As `buildPanels` takes them.
 * @returns {Array<{measure: string, title: string, model: object}>} One entry
 *   per biomarker: its name, the name of its value axis, and its panels.
 */
export function buildOverview(tables, settings, state, measures, options = {}) {
  return measures.map((measure) => {
    const row = { ...state, measure, panelBy: '' };
    return {
      measure,
      title: yTitle(tables.results, settings, { ...row, visits: [] }),
      model: buildPanels(tables, settings, row, options)
    };
  });
}
