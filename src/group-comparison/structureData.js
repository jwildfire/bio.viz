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
import { coreSettings } from './configure.js';

const isBlank = (value) =>
  value === undefined ||
  value === null ||
  (typeof value === 'number' && Number.isNaN(value)) ||
  (typeof value === 'string' && value.trim() === '');

const naturally = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

/** Distinct values that are not blank, as text, sorted by name with numbers as numbers. */
export function levelsOf(values) {
  return [...new Set(values.filter((value) => !isBlank(value)).map(String))].sort(naturally);
}

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
  return ((hash >>> 0) / 4294967295) * 2 - 1;
}

// ---- What the controls offer -------------------------------------------------

/**
 * The biomarkers the Measure control offers: the configured list in its order,
 * keeping the ones the table has, or every biomarker in the table by name.
 */
export function listMeasures(results, settings) {
  const present = levelsOf(results.map((row) => row[settings.measure_col]));
  if (!settings.measures) return present;
  const listed = settings.measures.filter((measure) => present.includes(measure));
  return listed.length ? listed : present;
}

/**
 * The unit of a biomarker's results, when the table has a unit column and the
 * biomarker has one unit; otherwise null.
 */
export function unitOf(results, settings, measure) {
  if (!settings.unit_col) return null;
  const units = levelsOf(
    results
      .filter((row) => String(row[settings.measure_col]) === measure)
      .map((row) => row[settings.unit_col])
  );
  return units.length === 1 ? units[0] : null;
}

/**
 * The columns that can make a group, a colour or a panel: columns that hold a
 * category, which is to say at most `max_levels` different values.
 *
 * With a participant table: its columns, other than the id. Without one: the
 * columns carried on the results rows, other than the ones the settings map
 * (id, biomarker, result, visit, visit order, unit), that hold one value for
 * each participant. With both, the participant table's columns come first and a
 * column of the same name on the results rows is not offered twice.
 *
 * The setting `groups`, when given, is the list, and nothing is worked out.
 * @returns {Array<{value_col: string, label: string, table: string}>}
 */
export function categoryColumns({ results, participants }, settings) {
  if (settings.groups) {
    return settings.groups.map((spec) => ({ ...spec, table: 'given' }));
  }
  const columns = [];
  const taken = new Set();
  const offer = (name, table) => {
    taken.add(name);
    columns.push({ value_col: name, label: name, table });
  };
  const fewEnough = (values) => {
    const levels = new Set();
    for (const value of values) {
      if (isBlank(value)) continue;
      levels.add(String(value));
      if (levels.size > settings.max_levels) return false;
    }
    return levels.size > 0;
  };

  if (participants && participants.length) {
    const idCol = settings.participant_id_col || settings.id_col;
    for (const name of Object.keys(participants[0])) {
      if (name === idCol) continue;
      if (fewEnough(participants.map((row) => row[name]))) offer(name, 'participants');
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
    if (constant && fewEnough(byParticipant.values())) offer(name, 'results');
  }
  return columns;
}

/**
 * The filters the chart shows. There are filters only when there is a
 * participant table: they choose participants. The setting `filters`, when
 * given, is the list (kept to the columns the participant table has); otherwise
 * every category column of the participant table is a filter.
 * @returns {Array<{value_col: string, label: string}>}
 */
export function filterColumns({ participants }, settings, categories) {
  if (!participants || !participants.length) return [];
  if (settings.filters) {
    return settings.filters.filter((spec) => spec.value_col in participants[0]);
  }
  return categories
    .filter((column) => column.table === 'participants')
    .map(({ value_col, label }) => ({ value_col, label }));
}

// ---- The panels ---------------------------------------------------------------

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
  const filterMatches =
    options.filterMatches ||
    ((value, selection) =>
      selection === null ||
      selection === undefined ||
      (Array.isArray(selection)
        ? selection.map(String).includes(String(value))
        : String(selection) === String(value)));
  const config = coreSettings(settings);
  const idCol = settings.id_col;

  // The filters choose participants; the results of the others are set aside
  // before the frame is made, so they are not counted as missing from it.
  let kept = participants || null;
  let rows = results;
  if (kept) {
    const participantIdCol = settings.participant_id_col || idCol;
    kept = kept.filter((row) =>
      Object.entries(state.filters || {}).every(([column, selection]) =>
        filterMatches(row[column], selection)
      )
    );
    const ids = new Set(kept.map((row) => String(row[participantIdCol])));
    rows = results.filter((row) => ids.has(String(row[idCol])));
  }

  const needsVisit = state.valueType !== 'baseline';
  const visitList = needsVisit ? state.visits : [null];
  const yOf = (visit) =>
    needsVisit
      ? { measure: state.measure, visit, value: state.valueType }
      : { measure: state.measure, value: 'baseline' };
  const variablesFor = (visit) => ({
    y: yOf(visit),
    x: { col: state.groupBy },
    ...(state.colorBy ? { color: { col: state.colorBy } } : {}),
    ...(state.panelBy ? { panel: { col: state.panelBy } } : {})
  });

  const framed = visitList.map((visit) => {
    const made = frame(
      { results: rows, participants: kept || undefined },
      variablesFor(visit),
      config
    );
    // A logarithmic axis has no place for zero or less.
    const positive =
      state.yScale === 'log' ? made.data.filter((record) => record.y > 0) : made.data;
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
    baselineVisits: framed.length ? framed[0].made.baseline_visits : null,
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

/**
 * The visits the Visit control offers, and the ones it opens on: the visits in
 * the setting `visits` that the table has, or the first visit after the
 * baseline visits, or the first visit when there is no later one.
 */
export function listVisits(results, settings) {
  const config = coreSettings(settings);
  const all = visitsInOrder(results, config);
  const baseline = settings.baseline_visits || all.slice(0, 1);
  const asked = (settings.visits || []).filter((visit) => all.includes(visit));
  const later = all.filter((visit) => !baseline.includes(visit));
  const start = asked.length ? asked : later.length ? later.slice(0, 1) : all.slice(0, 1);
  return { all, start };
}
