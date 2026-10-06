// The difference grid: the second form of the chart's opening view. One row
// per biomarker and one column per visit, each cell the standardised
// difference in means between two groups, which R computes for every cell in
// one request (gsm.bio's Analyze_DifferenceGrid).
//
// Pure, and nothing here is a statistic: this file lays out which cells there
// are, gathers the rows R is handed, and reads a cell's colour off the
// estimate R returned, as the correlation matrix reads a mark off R's
// coefficient. No difference, interval or limit is worked out from the values.

import { visitsDrawn } from './structureData.js';

/** The two forms of the opening view, by the names the setting `opening_view` takes. */
export const OPENING_VIEWS = Object.freeze(['tiles', 'grid']);

/**
 * The size of a standardised difference at which a cell's colour is as deep as
 * it gets: a difference of one pooled standard deviation. A fixed end, not one
 * found in the answers, so a colour means the same in every grid.
 */
export const SHADE_FULL = 1;

/** What a visit's column is headed when the value has no visit. */
export const NO_VISIT = 'Baseline value';

/**
 * The two groups the grid compares, first and second: the estimate is the
 * first minus the second. They are the pair asked for when both are among the
 * groups drawn and they differ; otherwise the first two groups drawn, in the
 * order they are drawn in.
 * @param {string[]} groups The groups drawn, in order.
 * @param {?string[]} [wanted] The pair asked for (the setting `grid_groups`,
 *   or what the reader chose).
 * @returns {?string[]} The pair, or null when fewer than two groups are drawn.
 */
export function pairOf(groups, wanted = null) {
  const drawn = (groups || []).map(String);
  if (drawn.length < 2) return null;
  if (Array.isArray(wanted) && wanted.length === 2) {
    const [first, second] = wanted.map(String);
    if (first !== second && drawn.includes(first) && drawn.includes(second)) {
      return [first, second];
    }
  }
  return [drawn[0], drawn[1]];
}

/**
 * The pair after the reader chooses one of its two groups: the other keeps its
 * place, and when the group chosen is the one the other holds, the two change
 * places, so the pair is always of two different groups.
 * @param {string[]} pair The pair now, first and second.
 * @param {number} place Which of the two was chosen: 0 or 1.
 * @param {string} group The group chosen for it.
 * @returns {string[]} The pair to compare.
 */
export function choosePair(pair, place, group) {
  const next = [...pair];
  if (next[1 - place] === group) next[1 - place] = next[place];
  next[place] = group;
  return next;
}

/**
 * The grid, laid out from the trend tiles' own frames: what a tile draws for a
 * biomarker is what its row of the grid compares, so a cell's rows are the
 * rows the single-visit view of that biomarker at that visit hands R, for the
 * two groups compared.
 *
 * The baseline visit of a change, a fold change or a percent change from one
 * baseline visit has a column and no cell to compute: there the value is the
 * same for everyone. Its rows are not sent to R.
 *
 * @param {object} built The tiles, as `buildTiles` gives them, for the
 *   biomarkers the grid draws.
 * @param {object} parts
 * @param {?string[]} parts.pair The two groups compared, first and second, or
 *   null when there are not two.
 * @param {string} parts.valueType The value type.
 * @returns {{pair: ?string[], biomarkers: string[],
 *   columns: Array<{visit: string, tested: boolean}>, visits: string[],
 *   untested: string[], rows: object[], data: object[]}} `columns` are the
 *   visits in visit order, each saying whether its cells are compared;
 *   `visits` the ones that are, and `untested` the ones that are not; `rows`
 *   one per biomarker, each with a cell per column holding the two groups'
 *   counts; and `data` the long rows R is handed, one per participant,
 *   biomarker and visit, with the biomarker in `biomarker` and the visit in
 *   `visit`.
 */
export function buildGrid(built, { pair, valueType }) {
  const tiles = built.tiles || [];
  const named = (visit) => visit ?? NO_VISIT;
  // Every tile is framed on the same visits: the ones chosen, in visit order.
  const every = tiles.length ? tiles[0].visits.map(named) : [];
  const compared = visitsDrawn(every, valueType, built.baselineVisits);
  const columns = every.map((visit) => ({ visit, tested: compared.includes(visit) }));
  const visits = columns.filter((column) => column.tested).map((column) => column.visit);
  const of = pair ? new Set(pair) : new Set();
  const data = [];
  const rows = tiles.map((tile) => {
    const counts = new Map(visits.map((visit) => [visit, [0, 0]]));
    for (const record of tile.records) {
      const visit = named(record.visit);
      if (!of.has(String(record.x)) || !counts.has(visit)) continue;
      counts.get(visit)[String(record.x) === pair[0] ? 0 : 1] += 1;
      data.push({ ...record, visit, biomarker: tile.measure });
    }
    return {
      measure: tile.measure,
      cells: columns.map((column) => ({
        visit: column.visit,
        tested: column.tested,
        n: column.tested ? counts.get(column.visit) : null
      }))
    };
  });
  return {
    pair,
    biomarkers: tiles.map((tile) => tile.measure),
    columns,
    visits,
    untested: columns.filter((column) => !column.tested).map((column) => column.visit),
    rows,
    data
  };
}

/**
 * What an estimate looks like as a cell: which side of nought it is on, how
 * deep its colour is, and the colour. The colour runs from a neutral grey at
 * nought to orange for a difference below it and blue for one above, the two
 * hues the correlation matrix gives a negative and a positive coefficient, and
 * is as deep as it gets at `SHADE_FULL`. It never gets so deep that the dark
 * figure printed on it is hard to read, and the figure carries the sign and
 * the size without it.
 *
 * @param {number} estimate The estimate R returned.
 * @returns {{side: 'below'|'above'|'none', depth: number, color: string}}
 *   `depth` runs from 0 to 1.
 */
export function shadeOf(estimate) {
  const depth = Math.min(1, Math.abs(estimate) / SHADE_FULL);
  const lightness = Math.round(96 - 24 * depth);
  if (estimate === 0) return { side: 'none', depth: 0, color: 'hsl(0, 0%, 96%)' };
  const below = estimate < 0;
  return {
    side: below ? 'below' : 'above',
    depth,
    // Hue and lightness alone would jump from grey to a tint at nought: the
    // saturation grows with the depth too, so the middle is neutral.
    color: `hsl(${below ? 18 : 217}, ${Math.round((below ? 82 : 78) * Math.min(1, depth * 4))}%, ${lightness}%)`
  };
}
