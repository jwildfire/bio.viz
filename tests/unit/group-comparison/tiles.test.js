import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_SETTINGS,
  TILE_SUMMARIES,
  syncSettings
} from '../../../src/group-comparison/configure.js';
import {
  buildPanels,
  columnLevels,
  listMeasures
} from '../../../src/group-comparison/structureData.js';
import {
  axisUnit,
  buildTiles,
  rangeText,
  standardDeviation,
  tileAxis,
  yardstick
} from '../../../src/group-comparison/tiles.js';
import { participants, results } from '../core/study.js';

// The trend tiles (#84): what the chart opens on when no biomarker is chosen.
// One tile per biomarker, a line per group through the group's median at each
// visit, on the biomarker's own value axis. Everything here is what the chart
// draws from, worked out from the vendored synthetic study; the page itself is
// tested in a browser.

const fromR = JSON.parse(
  readFileSync(new URL('../../fixtures/group-comparison-r.json', import.meta.url), 'utf8')
);
const rTile = (measure) => fromR.tiles.find((tile) => tile.measure === measure);

const settings = syncSettings({ baseline_visits: 'Baseline' });
const tables = { results, participants };
const VISITS = ['Baseline', 'Week 2', 'Week 4', 'Week 8', 'Week 12'];
// What the controls are set to as the chart opens: no biomarker, every visit.
const state = (overrides = {}) => ({
  measure: null,
  visits: VISITS,
  valueType: 'raw',
  groupBy: 'ARM',
  levels: null,
  colorBy: '',
  panelBy: '',
  mark: 'box',
  yScale: 'linear',
  tileSummary: 'median',
  filters: {},
  ...overrides
});
const measures = listMeasures(results, settings);
const tiles = (overrides = {}, list = measures, config = settings) =>
  buildTiles(tables, config, state(overrides), list);
const tileOf = (built, measure) => built.tiles.find((tile) => tile.measure === measure);

const close = (actual, expected, tolerance, label) => {
  const scale = Math.max(Math.abs(expected), 1e-300);
  expect(Math.abs(actual - expected) / scale, label).toBeLessThanOrEqual(tolerance);
};
const refused = (overrides) => {
  try {
    syncSettings(overrides);
  } catch (error) {
    return error.message;
  }
  throw new Error(`not refused: ${JSON.stringify(overrides)}`);
};

describe('group comparison: the trend tiles', () => {
  it('GC-TILE-001: one tile per biomarker, in the Biomarker control’s order, named for it with the unit of its values; in each a line per group, with a point at each visit chosen, in visit order (#84)', () => {
    const built = tiles();
    expect(built.tiles.map((tile) => tile.measure)).toEqual(measures);
    expect(measures).toHaveLength(12);
    expect(measures.slice(0, 3)).toEqual(['CRP', 'D-dimer', 'Ferritin']);
    // The groups, each with its place in the key, which is its colour.
    expect(built.groups).toEqual([
      { level: 'Placebo', index: 0 },
      { level: 'Treatment', index: 1 }
    ]);
    for (const tile of built.tiles) {
      expect(tile.visits, tile.measure).toEqual(VISITS);
      expect(tile.lines.map((line) => [line.level, line.index])).toEqual([
        ['Placebo', 0],
        ['Treatment', 1]
      ]);
      for (const line of tile.lines) {
        expect(line.points.map((point) => point.visit)).toEqual(VISITS);
      }
    }
    expect(tileOf(built, 'IL-6').unit).toBe('pg/mL');
    expect(tileOf(built, 'CRP').unit).toBe('mg/L');
    // The order is the control's: the setting `measures`, when it gives one.
    const ordered = syncSettings({
      baseline_visits: 'Baseline',
      measures: ['VEGF', 'IL-6', 'CRP']
    });
    const listed = listMeasures(results, ordered);
    expect(tiles({}, listed, ordered).tiles.map((tile) => tile.measure)).toEqual([
      'VEGF',
      'IL-6',
      'CRP'
    ]);
    // The visits chosen are the points of every line.
    for (const tile of tiles({ visits: ['Week 4', 'Week 12'] }).tiles) {
      expect(tile.visits).toEqual(['Week 4', 'Week 12']);
      expect(tile.lines[0].points.map((point) => point.visit)).toEqual(['Week 4', 'Week 12']);
    }
    // A fold change has no unit, and a percent change is in percent.
    expect(axisUnit(results, settings, 'IL-6', 'raw')).toBe('pg/mL');
    expect(axisUnit(results, settings, 'IL-6', 'change')).toBe('pg/mL');
    expect(axisUnit(results, settings, 'IL-6', 'baseline')).toBe('pg/mL');
    expect(axisUnit(results, settings, 'IL-6', 'fold_change')).toBe(null);
    expect(axisUnit(results, settings, 'IL-6', 'percent_change')).toBe('%');
  });

  it('GC-TILE-002: a point describes the records that biomarker’s own view draws for that group at that visit, one per participant from the core’s frame: their number, their median and their mean; nothing is pooled across visits or biomarkers (#84)', () => {
    const built = tiles();
    const median = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      const middle = sorted.length / 2;
      return sorted.length % 2
        ? sorted[Math.floor(middle)]
        : (sorted[middle - 1] + sorted[middle]) / 2;
    };
    let compared = 0;
    for (const tile of built.tiles) {
      // The single-biomarker view of the same biomarker, with the same controls.
      const alone = buildPanels(tables, settings, state({ measure: tile.measure }));
      expect(alone.panels.map((panel) => panel.visit)).toEqual(VISITS);
      for (const line of tile.lines) {
        line.points.forEach((point, at) => {
          const records = alone.panels[at].records.filter((record) => record.x === line.level);
          const ids = records.map((record) => record.USUBJID);
          expect(new Set(ids).size).toBe(ids.length);
          const values = records.map((record) => record.y);
          expect(point.n, `${tile.measure} ${line.level} ${point.visit}`).toBe(values.length);
          close(point.median, median(values), 1e-12);
          close(point.mean, values.reduce((sum, value) => sum + value, 0) / values.length, 1e-12);
          // What is drawn is the summary chosen: the median, as the chart opens.
          expect(point.value).toBe(point.median);
          compared += 1;
        });
      }
    }
    // Twelve biomarkers, two arms, five visits: nothing passed by comparing nothing.
    expect(compared).toBe(120);
    // With the switch on means, the same points draw their mean.
    for (const tile of tiles({ tileSummary: 'mean' }).tiles) {
      for (const line of tile.lines) {
        for (const point of line.points) expect(point.value).toBe(point.mean);
      }
    }
    // IL-6: every participant with a result at each visit, by arm.
    const il6 = tileOf(built, 'IL-6');
    expect(il6.lines.map((line) => line.points.map((point) => point.n))).toEqual([
      [100, 92, 95, 93, 92],
      [100, 93, 91, 95, 92]
    ]);
    // The records behind the tiles: one per participant, biomarker and visit.
    expect(il6.records).toHaveLength(200 + 185 + 186 + 188 + 184);
    expect(Object.keys(il6.records[0]).sort()).toEqual(['USUBJID', 'visit', 'x', 'y']);
  });

  it('GC-TILE-003: on the synthetic study every tile’s medians, means and counts, by arm at every visit, for the result and for the change from baseline, equal desktop R’s median(), mean() and length() (#84)', () => {
    expect(fromR.made_by.script).toBe('tools/r-group-comparison.R');
    expect(fromR.tiles.map((tile) => tile.measure).sort()).toEqual([...measures].sort());
    let compared = 0;
    for (const [valueType, key] of [
      ['raw', 'raw'],
      ['change', 'change']
    ]) {
      const built = tiles({ valueType });
      for (const tile of built.tiles) {
        const expected = rTile(tile.measure)[key];
        // Two arms at five visits, the baseline visit of a change among them.
        expect(expected).toHaveLength(10);
        for (const line of tile.lines) {
          for (const point of line.points) {
            const r = expected.find(
              (entry) => entry.visit === point.visit && entry.level === line.level
            );
            const label = `${tile.measure} ${valueType} ${line.level} ${point.visit}`;
            expect(point.n, label).toBe(r.n);
            if (r.median === 0) expect(point.median, label).toBe(0);
            else close(point.median, r.median, 1e-12, label);
            if (r.mean === 0) expect(point.mean, label).toBe(0);
            else close(point.mean, r.mean, 1e-12, label);
            compared += 3;
          }
        }
      }
    }
    // 12 biomarkers, 2 value types, 2 arms, 5 visits, 3 numbers each.
    expect(compared).toBe(720);
    // The planted biomarker: IL-6's arms part after the baseline visit.
    const il6 = tileOf(tiles({ valueType: 'change' }), 'IL-6');
    expect(il6.lines[0].points[0].median).toBe(0);
    expect(il6.lines[1].points[2].median).toBeLessThan(il6.lines[0].points[2].median);
  });

  it('GC-TILE-004: each biomarker has its own value axis: from the least point drawn to the greatest, widened about its middle until it spans the set multiple of the standard deviation of the results at the baseline visit, with a little room; the standard deviation is desktop R’s sd() (#84)', () => {
    expect(DEFAULT_SETTINGS.tile_min_spread).toBe(1.25);
    // R's sd(): the square root of the sum of squares about the mean over n − 1.
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138089935299395, 12);
    expect(standardDeviation([3])).toBeNaN();
    expect(standardDeviation([])).toBeNaN();
    expect(standardDeviation([5, 5, 5])).toBe(0);

    const built = tiles();
    for (const tile of built.tiles) {
      const r = rTile(tile.measure).baseline;
      expect(tile.baseline.n, tile.measure).toBe(r.n);
      expect(tile.baseline.visits).toEqual(['Baseline']);
      close(tile.baseline.sd, r.sd, 1e-12, tile.measure);
      close(tile.baseline.mean, r.mean, 1e-12, tile.measure);
      // The least the axis may span, in its own units.
      close(tile.least, 1.25 * r.sd, 1e-12, tile.measure);
      const drawn = tile.lines.flatMap((line) => line.points.map((point) => point.value));
      const [least, greatest] = [Math.min(...drawn), Math.max(...drawn)];
      const span = Math.max(greatest - least, tile.least);
      expect(tile.axis.floored, tile.measure).toBe(greatest - least < tile.least);
      // The points sit about the middle of the axis, with a tenth of the span as room.
      close(tile.axis.max - tile.axis.min, span * 1.2, 1e-9, tile.measure);
      close((tile.axis.max + tile.axis.min) / 2, (greatest + least) / 2, 1e-9, tile.measure);
      expect(tile.axis.max - tile.axis.min).toBeGreaterThanOrEqual(1.25 * r.sd);
      for (const value of drawn) {
        expect(value).toBeGreaterThan(tile.axis.min);
        expect(value).toBeLessThan(tile.axis.max);
      }
    }
    // On the synthetic study the planted biomarker's medians part by nearly the
    // least the axis spans, so its lines fill its tile; no other's part by half
    // of it, so theirs stay near flat. That is what the least is for.
    const filled = (tile) => {
      const drawn = tile.lines.flatMap((line) => line.points.map((point) => point.value));
      return (Math.max(...drawn) - Math.min(...drawn)) / tile.least;
    };
    expect(filled(tileOf(built, 'IL-6'))).toBeGreaterThan(0.9);
    for (const tile of built.tiles.filter((entry) => entry.measure !== 'IL-6')) {
      expect(filled(tile), tile.measure).toBeLessThan(0.5);
    }
    // At one standard deviation only the planted biomarker reaches past it.
    const atOne = tiles({}, measures, syncSettings({ ...settings, tile_min_spread: 1 }));
    expect(atOne.tiles.filter((tile) => !tile.axis.floored).map((tile) => tile.measure)).toEqual([
      'IL-6'
    ]);
    // Biomarkers are on different scales, so their axes differ.
    expect(new Set(built.tiles.map((tile) => `${tile.axis.min} ${tile.axis.max}`)).size).toBe(12);
    const [ldh, crp] = ['LDH', 'CRP'].map((name) => tileOf(built, name));
    expect(ldh.axis.max).toBeGreaterThan(10 * crp.axis.max);

    // The multiple is a setting: none at all leaves the axis at the points.
    const tight = tiles({}, measures, syncSettings({ ...settings, tile_min_spread: 0 }));
    for (const tile of tight.tiles) {
      expect(tile.axis.floored).toBe(false);
      const drawn = tile.lines.flatMap((line) => line.points.map((point) => point.value));
      close(tile.axis.max - tile.axis.min, (Math.max(...drawn) - Math.min(...drawn)) * 1.2, 1e-9);
    }
    const loose = tiles({}, measures, syncSettings({ ...settings, tile_min_spread: 4 }));
    for (const tile of loose.tiles) {
      expect(tile.axis.floored).toBe(true);
      // Four standard deviations and its room. A result that cannot be negative
      // is not drawn below zero: its axis is moved up, and has less room below.
      const four = 4 * rTile(tile.measure).baseline.sd;
      const span = tile.axis.max - tile.axis.min;
      expect(tile.axis.min, tile.measure).toBeGreaterThanOrEqual(0);
      if (tile.axis.min > 0) close(span, four * 1.2, 1e-9, tile.measure);
      else {
        expect(span).toBeGreaterThanOrEqual(four * 1.1 * (1 - 1e-9));
        expect(span).toBeLessThanOrEqual(four * 1.2 * (1 + 1e-9));
      }
    }
    expect(loose.tiles.some((tile) => tile.axis.min === 0)).toBe(true);

    // The axis itself, from the points and the least it may span.
    expect(tileAxis([4, 6], 'linear', 0)).toEqual({ min: 3.8, max: 6.2, floored: false });
    expect(tileAxis([4, 6], 'linear', 1.5)).toEqual({ min: 3.8, max: 6.2, floored: false });
    const widened = tileAxis([4.9, 5.1], 'linear', 2);
    expect(widened.floored).toBe(true);
    close(widened.min, 5 - 1 - 0.2, 1e-12);
    close(widened.max, 5 + 1 + 0.2, 1e-12);
    // One point, or every point the same, with no floor: a little room about it.
    expect(tileAxis([5], 'linear', 0)).toEqual({ min: 4.75, max: 5.25, floored: false });
    expect(tileAxis([0, 0], 'linear', 0)).toEqual({ min: -1, max: 1, floored: false });
    // Nothing to draw: no axis.
    expect(tileAxis([], 'linear', 2)).toBe(null);
    expect(tileAxis([null, NaN], 'linear', 2)).toBe(null);

    // The axis in words, as printed under a tile: its two ends, to the decimals
    // its span calls for, and the unit.
    expect(rangeText({ min: 59.14, max: 183.75 }, 'ng/mL', 'linear')).toBe('59 to 184 ng/mL');
    expect(rangeText({ min: 1.126, max: 4.498 }, 'mg/L', 'linear')).toBe('1.1 to 4.5 mg/L');
    expect(rangeText({ min: 0.2525, max: 0.533 }, 'mg/L', 'linear')).toBe('0.25 to 0.53 mg/L');
    expect(rangeText({ min: -1.72, max: 1.65 }, 'mg/L', 'linear')).toBe('-1.7 to 1.6 mg/L');
    expect(rangeText({ min: -0.004, max: 0.9 }, null, 'linear')).toBe('0.00 to 0.90');
    expect(rangeText({ min: 0.8, max: 1.2 }, '%', 'linear')).toBe('0.80 to 1.20 %');
    expect(rangeText({ min: 0.0123456, max: 1234.56 }, 'pg/mL', 'log')).toBe(
      '0.0123 to 1230 pg/mL'
    );
    for (const tile of built.tiles) {
      expect(tile.range, tile.measure).toBe(rangeText(tile.axis, tile.unit, 'linear'));
    }
    expect(tileOf(built, 'IL-6').range).toMatch(/^\d\.\d to \d\.\d pg\/mL$/);
  });

  it('GC-TILE-005: the least an axis may span is in the units of what is drawn: the standard deviation itself for a result, a baseline or a change, over the mean for a fold change and a hundred times that for a percent change, and on a logarithmic axis a ratio from the standard deviation of the logarithms; where there is no such number the axis is left at its points (#84)', () => {
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    const sd = standardDeviation(values);
    for (const valueType of ['raw', 'baseline', 'change']) {
      expect(yardstick(values, valueType, 'linear')).toEqual({ n: 8, sd, mean: 5, size: sd });
    }
    expect(yardstick(values, 'fold_change', 'linear').size).toBeCloseTo(sd / 5, 14);
    expect(yardstick(values, 'percent_change', 'linear').size).toBeCloseTo((100 * sd) / 5, 12);
    // A logarithmic axis: the standard deviation of the base-10 logarithms.
    const logged = standardDeviation(values.map(Math.log10));
    expect(yardstick(values, 'raw', 'log').size).toBeCloseTo(logged, 14);
    expect(yardstick(values, 'fold_change', 'log').size).toBeCloseTo(logged, 14);
    expect(yardstick(values, 'baseline', 'log').size).toBeCloseTo(logged, 14);
    // Values of zero or less have no logarithm, and are not part of it.
    expect(yardstick([...values, 0, -3], 'raw', 'log').size).toBeCloseTo(logged, 14);
    // A difference is not a ratio: on a logarithmic axis it has no floor.
    expect(yardstick(values, 'change', 'log').size).toBe(null);
    expect(yardstick(values, 'percent_change', 'log').size).toBe(null);
    // Fewer than two values, or a mean of zero under a ratio: no number.
    expect(yardstick([3], 'raw', 'linear').size).toBe(null);
    expect(yardstick([], 'raw', 'linear')).toEqual({ n: 0, sd: NaN, mean: NaN, size: null });
    expect(yardstick([-1, 1], 'fold_change', 'linear').size).toBe(null);

    // On the synthetic study the logarithms' standard deviation is desktop R's.
    const logTiles = tiles({ yScale: 'log' });
    for (const tile of logTiles.tiles) {
      const r = rTile(tile.measure).baseline;
      close(tile.least, 1.25 * r.sd_log10, 1e-9, tile.measure);
      // The axis's ends are a ratio apart of at least ten to that power.
      expect(Math.log10(tile.axis.max / tile.axis.min)).toBeGreaterThanOrEqual(tile.least);
      expect(tile.axis.min).toBeGreaterThan(0);
    }
    const ratio = tileAxis([10, 10], 'log', 1);
    close(ratio.min, 10 / 10 ** 0.6, 1e-12);
    close(ratio.max, 10 * 10 ** 0.6, 1e-12);
    // A fold change: the floor is the baseline's standard deviation over its mean.
    const folds = tiles({ valueType: 'fold_change' });
    const il6 = tileOf(folds, 'IL-6');
    const r = rTile('IL-6').baseline;
    close(il6.least, (1.25 * r.sd) / r.mean, 1e-12);
    close(tileOf(tiles({ valueType: 'percent_change' }), 'IL-6').least, il6.least * 100, 1e-12);
    // A result that cannot be negative: the axis is not widened below zero.
    const floored = tileAxis([0.2, 0.4], 'linear', 4, { lowest: 0 });
    expect(floored.min).toBe(0);
    close(floored.max, 4.4, 1e-12);
    for (const tile of tiles({}, measures, syncSettings({ ...settings, tile_min_spread: 12 }))
      .tiles) {
      expect(tile.axis.min, tile.measure).toBeGreaterThanOrEqual(0);
    }
  });

  it('GC-TILE-006: the settings of the tiles: `tile_summary`, the median or the mean, the median by default, and `tile_min_spread`, a number of zero or more, 1.25 by default; a value neither can take is refused (#84)', () => {
    expect(TILE_SUMMARIES).toEqual(['median', 'mean']);
    expect(DEFAULT_SETTINGS.tile_summary).toBe('median');
    expect(DEFAULT_SETTINGS.tile_min_spread).toBe(1.25);
    expect(syncSettings({ tile_summary: 'mean' }).tile_summary).toBe('mean');
    expect(syncSettings({ tile_min_spread: 0 }).tile_min_spread).toBe(0);
    expect(syncSettings({ tile_min_spread: 2 }).tile_min_spread).toBe(2);
    for (const bad of ['average', 'Median', null, 1, true]) {
      expect(refused({ tile_summary: bad })).toBe(
        'bio.viz: `tile_summary` must be one of median, mean.'
      );
    }
    for (const bad of [-1, '1.25', null, NaN, Infinity, true]) {
      expect(refused({ tile_min_spread: bad })).toBe(
        'bio.viz: `tile_min_spread` must be a number, zero or more: how many standard deviations ' +
          'of the results at the baseline visit a tile’s value axis spans at the least.'
      );
    }
  });

  it('GC-TILE-007: for a change from baseline a tile keeps the baseline visit, where every line starts at no change; a baseline value has no visit, so each line is one point (#84)', () => {
    const change = tiles({ valueType: 'change' });
    for (const tile of change.tiles) {
      expect(tile.visits, tile.measure).toEqual(VISITS);
      for (const line of tile.lines) {
        expect(line.points[0]).toMatchObject({ visit: 'Baseline', median: 0, mean: 0 });
        expect(line.points[0].n).toBeGreaterThan(0);
      }
      // No change is a value the axis has a place for.
      expect(tile.axis.min).toBeLessThan(0);
      expect(tile.axis.max).toBeGreaterThan(0);
      expect(tile.reference).toBe(0);
    }
    // A fold change starts at one, and a percent change at nought.
    const fold = tileOf(tiles({ valueType: 'fold_change' }), 'IL-6');
    expect(fold.lines.map((line) => line.points[0].median)).toEqual([1, 1]);
    expect(fold.reference).toBe(1);
    expect(tileOf(tiles({ valueType: 'percent_change' }), 'IL-6').reference).toBe(0);
    // The result itself has no such line.
    expect(tileOf(tiles(), 'IL-6').reference).toBe(null);
    // The one-biomarker view still leaves the one baseline visit out of a change.
    expect(
      buildPanels(tables, settings, state({ measure: 'IL-6', valueType: 'change' })).panels.map(
        (panel) => panel.visit
      )
    ).toEqual(VISITS.slice(1));

    const baseline = tiles({ valueType: 'baseline' });
    for (const tile of baseline.tiles) {
      expect(tile.visits).toEqual([null]);
      for (const line of tile.lines) {
        expect(line.points).toHaveLength(1);
        expect(line.points[0].n).toBe(100);
      }
    }
  });

  it('GC-OVW-006: the group, the levels, the value, the scale, the visits and the filters apply to every tile; a second grouping by colour, panels by a further variable and the mark do not (#17, #84)', () => {
    const bySex = tiles({ groupBy: 'SEX' });
    expect(bySex.groups.map((group) => group.level)).toEqual(['F', 'M']);
    for (const tile of bySex.tiles) {
      expect(tile.lines.map((line) => line.level)).toEqual(['F', 'M']);
    }

    // A level left out is not drawn, and the one left keeps its colour.
    const oneLevel = tiles({ levels: ['Treatment'] });
    expect(oneLevel.groups).toEqual([{ level: 'Treatment', index: 1 }]);
    for (const tile of oneLevel.tiles) {
      expect(tile.lines.map((line) => [line.level, line.index])).toEqual([['Treatment', 1]]);
      expect(tile.records.every((record) => record.x === 'Treatment')).toBe(true);
      // The baseline's standard deviation is of the participants drawn.
      expect(tile.baseline.n).toBe(100);
    }

    const women = tiles({ filters: { SEX: 'F' } });
    expect(women.filtered).toBe(91);
    for (const tile of women.tiles) {
      expect(tile.lines.reduce((total, line) => total + line.points[0].n, 0)).toBe(91);
      expect(tile.baseline.n).toBe(91);
    }

    // On a logarithmic scale a value of zero or less is left out, tile by tile.
    const logged = tiles({ yScale: 'log', valueType: 'change' });
    for (const tile of logged.tiles) {
      expect(tile.records.every((record) => record.y > 0)).toBe(true);
    }

    // Colour by, Panel by and Draw as: not applied. The same tiles with each
    // set as without.
    const plain = JSON.stringify(tiles().tiles);
    expect(JSON.stringify(tiles({ colorBy: 'SEX' }).tiles)).toBe(plain);
    expect(JSON.stringify(tiles({ panelBy: 'SEX' }).tiles)).toBe(plain);
    expect(JSON.stringify(tiles({ mark: 'violin' }).tiles)).toBe(plain);
    expect(JSON.stringify(tiles({ mark: 'points' }).tiles)).toBe(plain);
    // The same variables do apply once a biomarker is alone.
    expect(
      buildPanels(tables, settings, state({ measure: 'IL-6', panelBy: 'SEX' })).panels
    ).toHaveLength(10);

    // With no column to group by, everyone is one line.
    const everyone = tiles({ groupBy: '' });
    expect(everyone.groups).toEqual([{ level: 'All participants', index: 0 }]);
    expect(tileOf(everyone, 'IL-6').lines[0].points.map((point) => point.n)).toEqual([
      200, 185, 186, 188, 184
    ]);

    // A cut biomarker makes the groups of every tile, low to high, the same
    // groups in each: the cut is of the participants, not of the tile's biomarker.
    const cut = tiles({ groupBy: { measure: 'CRP', visit: 'Baseline', cut: 'median' } });
    expect(cut.groups).toHaveLength(2);
    for (const tile of cut.tiles) {
      expect(tile.lines.map((line) => line.level)).toEqual(cut.groups.map((group) => group.level));
      expect(tile.lines.map((line) => line.points[0].n)).toEqual([100, 100]);
    }
  });

  it('GC-OVW-009: the levels the tiles offer are the group column’s own, from the table that holds it (#17, #84)', () => {
    expect(columnLevels(tables, 'ARM')).toEqual(['Placebo', 'Treatment']);
    expect(columnLevels(tables, 'RESPONSE')).toEqual(['Non-responder', 'Responder']);
    // A column the participant table does not have is read from the results rows.
    const carried = results
      .slice(0, 50)
      .map((row, index) => ({ ...row, SITE: index % 2 ? 'B' : 'A' }));
    expect(columnLevels({ results: carried, participants }, 'SITE')).toEqual(['A', 'B']);
    expect(columnLevels({ results: carried, participants: null }, 'SITE')).toEqual(['A', 'B']);
  });

  it('GC-OVW-020: every visit chosen keeps its place along every tile, so the tiles line up; where a group has no value at a visit it has no point there, and its line runs on to its next value (#52, #84)', () => {
    // IL-6 has no result at Week 2; the other biomarkers do.
    const holed = {
      results: results.filter((row) => !(row.TEST === 'IL-6' && row.VISIT === 'Week 2')),
      participants
    };
    const built = buildTiles(holed, settings, state(), measures);
    const il6 = tileOf(built, 'IL-6');
    expect(il6.visits).toEqual(VISITS);
    expect(il6.visits).toEqual(tileOf(built, 'IL-8').visits);
    for (const line of il6.lines) {
      expect(line.points.map((point) => point.visit)).toEqual(VISITS);
      expect(line.points[1]).toEqual({
        visit: 'Week 2',
        n: 0,
        median: null,
        mean: null,
        value: null
      });
      expect(line.points[2].n).toBeGreaterThan(0);
    }
    // A biomarker with no result at all: a tile with no axis and nothing to draw.
    const none = buildTiles(
      {
        results: results.filter((row) => row.TEST !== 'VEGF' || row.VISIT === 'Nowhere'),
        participants
      },
      settings,
      state(),
      measures
    );
    const vegf = tileOf(none, 'VEGF');
    expect(vegf.axis).toBe(null);
    expect(vegf.records).toEqual([]);
  });
});
