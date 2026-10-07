// One biomarker over time: what the chart draws when a biomarker is chosen
// with every visit it has. One picture, visit along the bottom in visit order,
// and at each visit the groups side by side, as boxes, as means with their
// standard errors, or as medians with their quartiles.
//
// Pure functions: no page and no chart. Each visit's rows are the ones the
// single-visit view draws for that visit, one per participant from the core's
// frame, so a click from a visit here to that visit alone shows the same
// participants. Nothing is pooled across visits.
//
// The numbers are descriptions of the values drawn and nothing more: how many,
// the quantiles, the mean, and the standard deviation and standard error of the
// mean. None of it compares one group with another. The test under each visit
// is R's, asked for in one request (`overTimeRequest` in ./statistic.js).

import { buildPanels, slots, visitsDrawn } from './structureData.js';
import { standardDeviation } from './tiles.js';

// How much of its span the value axis leaves free at each end.
const ROOM = 0.08;

/**
 * What a form draws of one cell: where its mark is centred and how far it
 * reaches either way. A box is centred on the median and its whiskers end at
 * the 5th and 95th percentiles; a mean has one standard error either side,
 * and none when the group is one participant; a median has the quartiles.
 * @param {object} cell One group at one visit, as `buildOverTime` gives it.
 * @param {string} mark `box`, `mean_se` or `median_iqr`.
 * @returns {?{centre: number, lower: number, upper: number}} Null when the
 *   cell has nobody.
 */
export function markOf(cell, mark) {
  if (!cell || !cell.n) return null;
  const { stats } = cell;
  if (mark === 'mean_se') {
    const reach = cell.se === null ? 0 : cell.se;
    return { centre: stats.mean, lower: stats.mean - reach, upper: stats.mean + reach };
  }
  if (mark === 'median_iqr') return { centre: stats.median, lower: stats.q25, upper: stats.q75 };
  return { centre: stats.median, lower: stats.q5, upper: stats.q95 };
}

/**
 * The value axis of the picture: from the lowest to the highest end of any
 * mark drawn, with a little room. On a logarithmic axis the room is a ratio,
 * so the lower end stays above zero.
 * @param {object} built What `buildOverTime` gave.
 * @param {string} mark `box`, `mean_se` or `median_iqr`.
 * @param {string} yScale `linear` or `log`.
 * @returns {?number[]} `[min, max]`, or null when nothing is drawn.
 */
export function timeDomain(built, mark, yScale) {
  const marks = built.columns.flatMap((column) =>
    column.cells.map((cell) => markOf(cell, mark)).filter(Boolean)
  );
  if (!marks.length) return null;
  // A box's mean is marked too, and is within its whiskers but for a skew.
  const reach = (made, end) => (yScale === 'log' && !(made[end] > 0) ? made.centre : made[end]);
  const least = Math.min(...marks.map((made) => reach(made, 'lower')));
  const greatest = Math.max(...marks.map((made) => reach(made, 'upper')));
  if (yScale === 'log') {
    const factor = greatest > least ? (greatest / least) ** ROOM : 1 + ROOM;
    return [least / factor, greatest * factor];
  }
  const room = (greatest - least) * ROOM || Math.abs(greatest) * ROOM || 1;
  return [least - room, greatest + room];
}

/**
 * One biomarker over time.
 *
 * @param {{results: object[], participants: ?object[]}} tables The tables.
 * @param {object} settings The chart's settings (syncSettings).
 * @param {object} state What the controls are set to, as `buildPanels` takes
 *   them. Its `colorBy`, `panelBy` and `mark` are not applied: the picture
 *   takes no second grouping and no panels.
 * @param {object} [options] As `buildPanels` takes them.
 * @returns {{model: object, visits: string[], groups: Array<{level: string,
 *   index: number}>, halfWidth: number, columns: object[], tested: string[],
 *   untested: string[], baselineVisits: ?string[], filtered: ?number,
 *   cuts: object, noRows: boolean}} `model` is `buildPanels`' own, a panel per
 *   visit. `groups` are the groups drawn, each with its place among all the
 *   groups, which is its colour. A column is one visit: `{ visit, at, tested,
 *   panel, cells }`, `at` its place along the bottom, and a cell one group
 *   there: `{ level, index, x, halfWidth, n, stats, sd, se, records }`. `tested`
 *   are the visits R is asked about, and `untested` the baseline visit of a
 *   change, which is drawn and not tested.
 */
export function buildOverTime(tables, settings, state, options = {}) {
  const model = buildPanels(
    tables,
    settings,
    { ...state, colorBy: '', panelBy: '', mark: 'box' },
    { ...options, keepBaseline: true }
  );
  // A group's place among them all is its colour, so a level left out does not
  // hand its colour to the next, as on the trend tiles.
  const groups = model.shownLevels.map((level) => ({ level, index: model.levels.indexOf(level) }));
  const { offsets, halfWidth } = slots(Math.max(groups.length, 1));
  const visits = model.panels.map((panel) => panel.visit);
  const tested = visitsDrawn(visits, state.valueType, model.baselineVisits);
  const columns = model.panels.map((panel, at) => ({
    visit: panel.visit,
    at,
    tested: tested.includes(panel.visit),
    panel,
    cells: groups.map((group, slot) => {
      const cell = panel.cells.find((candidate) => candidate.level === group.level);
      const values = cell.records.map((record) => record.y);
      const deviation = standardDeviation(values);
      const sd = Number.isFinite(deviation) ? deviation : null;
      return {
        level: group.level,
        index: group.index,
        x: at + offsets[slot],
        halfWidth,
        n: cell.n,
        stats: cell.stats,
        sd,
        se: sd === null ? null : sd / Math.sqrt(cell.n),
        records: cell.records
      };
    })
  }));
  return {
    model,
    visits,
    groups,
    halfWidth,
    columns,
    tested,
    untested: visits.filter((visit) => !tested.includes(visit)),
    baselineVisits: model.baselineVisits,
    filtered: model.filtered,
    cuts: model.cuts,
    noRows: Boolean(model.noRows)
  };
}
