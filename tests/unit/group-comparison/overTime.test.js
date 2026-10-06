import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_SETTINGS,
  TIME_MARKS,
  VISIT_ADJUSTMENTS,
  syncSettings
} from '../../../src/group-comparison/configure.js';
import { LEVELS, hasOverTime, levelOf } from '../../../src/group-comparison/level.js';
import { buildOverTime, markOf, timeDomain } from '../../../src/group-comparison/overTime.js';
import { buildPanels, measureVisits } from '../../../src/group-comparison/structureData.js';
import { participants, results } from '../core/study.js';

// One biomarker over time (#85): the level between the trend tiles and the
// single-visit view. One picture, visit along the bottom, the groups side by
// side at each visit. Everything here is what the chart draws from, worked out
// from the vendored synthetic study and held to desktop R; the page itself is
// tested in a browser.

const fromR = JSON.parse(
  readFileSync(new URL('../../fixtures/group-comparison-r.json', import.meta.url), 'utf8')
);
const rCells = (measure, valueType) =>
  fromR.over_time.find((entry) => entry.measure === measure)[valueType];

const settings = syncSettings({ baseline_visits: 'Baseline' });
const tables = { results, participants };
const VISITS = ['Baseline', 'Week 2', 'Week 4', 'Week 8', 'Week 12'];
const state = (overrides = {}) => ({
  measure: 'IL-6',
  visits: VISITS,
  valueType: 'raw',
  groupBy: 'ARM',
  levels: null,
  colorBy: '',
  panelBy: '',
  mark: 'box',
  timeMark: 'box',
  yScale: 'linear',
  filters: {},
  ...overrides
});
const overTime = (overrides = {}, config = settings, given = tables) =>
  buildOverTime(given, config, state(overrides));

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

describe('group comparison: which level is drawn', () => {
  it('GC-LVL-001: with no biomarker chosen the chart draws every biomarker; with one chosen and every visit it has, that biomarker over time; with one chosen and some of its visits, a panel per visit (#84, #85)', () => {
    expect(LEVELS).toEqual({ BIOMARKERS: 'biomarkers', OVER_TIME: 'over-time', VISITS: 'visits' });
    expect(Object.isFrozen(LEVELS)).toBe(true);
    expect(levelOf({ measure: null }, VISITS)).toBe('biomarkers');
    expect(levelOf({ measure: undefined })).toBe('biomarkers');
    expect(levelOf({})).toBe('biomarkers');
    // The visits chosen do not decide whether the tiles are drawn.
    expect(levelOf({ measure: null, visits: ['Week 4'] }, VISITS)).toBe('biomarkers');
    // A biomarker and every visit it has: the picture over time.
    expect(levelOf({ measure: 'IL-6', visits: VISITS, valueType: 'raw' }, VISITS)).toBe(
      'over-time'
    );
    // Visits the biomarker lacks, chosen for another biomarker, change nothing.
    expect(
      levelOf({ measure: 'IL-6', visits: [...VISITS, 'Week 16'], valueType: 'change' }, VISITS)
    ).toBe('over-time');
    // One of its visits, or a few: a panel per visit.
    expect(levelOf({ measure: 'IL-6', visits: ['Week 4'], valueType: 'raw' }, VISITS)).toBe(
      'visits'
    );
    expect(levelOf({ measure: 'IL-6', visits: VISITS.slice(0, 4), valueType: 'raw' }, VISITS)).toBe(
      'visits'
    );
    expect(levelOf({ measure: 'IL-6', visits: [], valueType: 'raw' }, VISITS)).toBe('visits');
  });

  it('GC-LVL-002: a biomarker with one visit, and a baseline value, which has no visit, have no picture over time: they are drawn as a single view (#85)', () => {
    expect(hasOverTime({ measure: 'IL-6', valueType: 'raw' }, VISITS)).toBe(true);
    expect(hasOverTime({ measure: 'IL-6', valueType: 'raw' }, ['Week 4'])).toBe(false);
    expect(hasOverTime({ measure: 'IL-6', valueType: 'baseline' }, VISITS)).toBe(false);
    expect(hasOverTime({ measure: null, valueType: 'raw' }, VISITS)).toBe(false);
    expect(levelOf({ measure: 'IL-6', visits: ['Week 4'], valueType: 'raw' }, ['Week 4'])).toBe(
      'visits'
    );
    expect(levelOf({ measure: 'IL-6', visits: VISITS, valueType: 'baseline' }, VISITS)).toBe(
      'visits'
    );
    expect(levelOf({ measure: 'IL-6', visits: VISITS, valueType: 'raw' }, [])).toBe('visits');
    expect(levelOf({ measure: 'IL-6', visits: VISITS, valueType: 'raw' })).toBe('visits');
  });
});

describe('group comparison: the settings of the picture over time', () => {
  it('GC-TIME-001: what the picture is drawn as, the adjustment across the visits and the R function that answers a row of visits each have a setting with a stated default, and a value none can take is refused by name (#85)', () => {
    expect(TIME_MARKS).toEqual(['box', 'mean_se', 'median_iqr']);
    expect(VISIT_ADJUSTMENTS).toEqual(['none', 'holm', 'BH']);
    expect(Object.isFrozen(TIME_MARKS)).toBe(true);
    expect(Object.isFrozen(VISIT_ADJUSTMENTS)).toBe(true);
    expect(DEFAULT_SETTINGS.time_mark).toBe('box');
    expect(DEFAULT_SETTINGS.visit_adjustment).toBe('none');
    expect(DEFAULT_SETTINGS.statistic_by_visit).toBe('Analyze_GroupDifferenceBy');
    for (const mark of TIME_MARKS) expect(syncSettings({ time_mark: mark }).time_mark).toBe(mark);
    for (const adjustment of VISIT_ADJUSTMENTS) {
      expect(syncSettings({ visit_adjustment: adjustment }).visit_adjustment).toBe(adjustment);
    }
    expect(syncSettings({ statistic_by_visit: null }).statistic_by_visit).toBe(null);
    expect(syncSettings({ statistic_by_visit: 'My_By' }).statistic_by_visit).toBe('My_By');
    expect(refused({ time_mark: 'violin' })).toBe(
      'bio.viz: `time_mark` must be one of box, mean_se, median_iqr.'
    );
    expect(refused({ visit_adjustment: 'bonferroni' })).toBe(
      'bio.viz: `visit_adjustment` must be one of none, holm, BH: the name R’s p.adjust() ' +
        'gives the adjustment of the p-values across the visits.'
    );
    expect(refused({ visit_adjustment: true })).toMatch(/`visit_adjustment` must be one of/);
    expect(refused({ statistic_by_visit: 3 })).toBe(
      'bio.viz: `statistic_by_visit` must be the name of an R function, or null for no test ' +
        'under the visits.'
    );
  });
});

describe('group comparison: one biomarker over time', () => {
  it('GC-TIME-002: one column per visit the biomarker has values at, in visit order, and in each a cell per group drawn, side by side, in the group’s colour; a second grouping and panels are not applied (#85)', () => {
    const built = overTime();
    expect(built.visits).toEqual(VISITS);
    expect(built.visits).toEqual(measureVisits(results, settings, 'IL-6'));
    expect(built.groups).toEqual([
      { level: 'Placebo', index: 0 },
      { level: 'Treatment', index: 1 }
    ]);
    expect(built.columns.map((column) => column.visit)).toEqual(VISITS);
    built.columns.forEach((column, at) => {
      expect(column.at).toBe(at);
      expect(column.cells.map((cell) => cell.level)).toEqual(['Placebo', 'Treatment']);
      // Side by side about the visit's place, the first group to the left.
      const [first, second] = column.cells;
      expect(first.x).toBeLessThan(at);
      expect(second.x).toBeGreaterThan(at);
      expect(first.x + second.x).toBeCloseTo(2 * at, 12);
      expect(second.x - first.x).toBeGreaterThanOrEqual(2 * built.halfWidth);
      expect(Math.abs(second.x + built.halfWidth - at)).toBeLessThan(0.5);
    });
    // The counts of the study: IL-6 by arm at each visit.
    expect(built.columns.map((column) => column.cells.map((cell) => cell.n))).toEqual([
      [100, 100],
      [92, 93],
      [95, 91],
      [93, 95],
      [92, 92]
    ]);
    // Colour by and Panel by are not applied: the picture is the same with each set.
    const withBoth = overTime({ colorBy: 'SEX', panelBy: 'SEX', mark: 'violin' });
    expect(withBoth.columns.map((column) => column.cells.map((cell) => cell.stats))).toEqual(
      built.columns.map((column) => column.cells.map((cell) => cell.stats))
    );
    expect(withBoth.model.colors).toEqual([null]);
    expect(withBoth.model.panelLevels).toEqual([null]);
    // A level left out keeps the others' colours: Treatment is still the second.
    const one = overTime({ levels: ['Treatment'] });
    expect(one.groups).toEqual([{ level: 'Treatment', index: 1 }]);
    expect(one.columns[0].cells.map((cell) => [cell.level, cell.x])).toEqual([['Treatment', 0]]);
    // With no column to group by everyone is one group.
    const everyone = overTime({ groupBy: '' });
    expect(everyone.groups).toEqual([{ level: 'All participants', index: 0 }]);
    expect(everyone.columns[2].cells[0].n).toBe(186);
  });

  it('GC-TIME-003: a cell describes the records the single-visit view draws for that group at that visit, one per participant: nothing is pooled across visits (#85)', () => {
    const built = overTime({ valueType: 'change' });
    for (const column of built.columns.slice(1)) {
      const single = buildPanels(
        tables,
        settings,
        state({ visits: [column.visit], valueType: 'change' })
      );
      expect(single.panels).toHaveLength(1);
      const [panel] = single.panels;
      expect(column.panel.records).toEqual(panel.records);
      column.cells.forEach((cell, index) => {
        expect(cell.records).toEqual(panel.cells[index].records);
        expect(cell.stats).toEqual(panel.cells[index].stats);
        expect(cell.n).toBe(panel.cells[index].n);
      });
    }
    // The filters choose participants, as in every view.
    const women = overTime({ filters: { SEX: 'F' } });
    expect(women.filtered).toBe(91);
    for (const column of women.columns) {
      for (const cell of column.cells) {
        expect(cell.n).toBeLessThan(60);
        expect(cell.records.every((record) => record.x === cell.level)).toBe(true);
      }
    }
  });

  it('GC-TIME-004: on the synthetic study every cell’s count, quantiles, mean, standard deviation and standard error, by arm at every visit, for the result and for the change from baseline, equal what desktop R gives (#85)', () => {
    for (const measure of ['IL-6', 'CRP']) {
      for (const valueType of ['raw', 'change']) {
        const built = overTime({ measure, valueType });
        const expected = rCells(measure, valueType);
        const cells = built.columns.flatMap((column) =>
          column.cells.map((cell) => ({ visit: column.visit, ...cell }))
        );
        expect(cells).toHaveLength(expected.length);
        expect(expected).toHaveLength(10);
        cells.forEach((cell, index) => {
          const r = expected[index];
          const label = `${measure} ${valueType} ${r.visit} ${r.level}`;
          expect([cell.visit, cell.level], label).toEqual([r.visit, r.level]);
          expect(cell.n, label).toBe(r.n);
          for (const key of ['q5', 'q25', 'median', 'q75', 'q95', 'mean']) {
            if (r[key] === 0) expect(cell.stats[key], `${label} ${key}`).toBeCloseTo(0, 12);
            else close(cell.stats[key], r[key], 1e-12, `${label} ${key}`);
          }
          if (r.sd === 0) {
            expect(cell.sd, label).toBe(0);
            expect(cell.se, label).toBe(0);
          } else {
            close(cell.sd, r.sd, 1e-12, `${label} sd`);
            close(cell.se, r.se, 1e-12, `${label} se`);
          }
        });
      }
    }
  });

  it('GC-TIME-005: each form is drawn from the cell’s own numbers: a box from its quartiles with whiskers at the 5th and 95th percentiles, a mean with one standard error either side, a median with the quartiles either side; a group of one has a mean and no standard error (#85)', () => {
    const [, column] = overTime().columns;
    const [cell] = column.cells;
    const r = rCells('IL-6', 'raw').find(
      (entry) => entry.visit === 'Week 2' && entry.level === 'Placebo'
    );
    const box = markOf(cell, 'box');
    close(box.centre, r.median, 1e-12, 'box centre');
    close(box.lower, r.q5, 1e-12, 'box lower');
    close(box.upper, r.q95, 1e-12, 'box upper');
    const mean = markOf(cell, 'mean_se');
    close(mean.centre, r.mean, 1e-12, 'mean');
    close(mean.lower, r.mean - r.se, 1e-12, 'mean - se');
    close(mean.upper, r.mean + r.se, 1e-12, 'mean + se');
    const median = markOf(cell, 'median_iqr');
    close(median.centre, r.median, 1e-12, 'median');
    close(median.lower, r.q25, 1e-12, 'q25');
    close(median.upper, r.q75, 1e-12, 'q75');
    // Nobody: no mark. One participant: a point with no bar.
    expect(markOf({ n: 0, stats: {}, sd: null, se: null }, 'mean_se')).toBe(null);
    const alone = buildOverTime(
      {
        results: [
          { USUBJID: 'a', TEST: 'X', VISIT: 'V1', VISITNUM: 1, STRESN: 4, ARM: 'A' },
          { USUBJID: 'b', TEST: 'X', VISIT: 'V1', VISITNUM: 1, STRESN: 6, ARM: 'B' },
          { USUBJID: 'c', TEST: 'X', VISIT: 'V1', VISITNUM: 1, STRESN: 8, ARM: 'B' },
          { USUBJID: 'a', TEST: 'X', VISIT: 'V2', VISITNUM: 2, STRESN: 5, ARM: 'A' },
          { USUBJID: 'b', TEST: 'X', VISIT: 'V2', VISITNUM: 2, STRESN: 7, ARM: 'B' }
        ],
        participants: null
      },
      syncSettings({}),
      state({ measure: 'X', visits: ['V1', 'V2'] })
    );
    const [lone, pair] = alone.columns[0].cells;
    expect([lone.n, lone.sd, lone.se]).toEqual([1, null, null]);
    expect(markOf(lone, 'mean_se')).toEqual({ centre: 4, lower: 4, upper: 4 });
    expect(pair.n).toBe(2);
    expect(pair.sd).toBeCloseTo(Math.SQRT2, 12);
    expect(pair.se).toBeCloseTo(1, 12);
    // A group with nobody at a visit keeps its place there, with no mark.
    const short = buildOverTime(
      {
        results: [
          { USUBJID: 'a', TEST: 'X', VISIT: 'V1', VISITNUM: 1, STRESN: 4, ARM: 'A' },
          { USUBJID: 'b', TEST: 'X', VISIT: 'V1', VISITNUM: 1, STRESN: 6, ARM: 'B' },
          { USUBJID: 'b', TEST: 'X', VISIT: 'V2', VISITNUM: 2, STRESN: 7, ARM: 'B' }
        ],
        participants: null
      },
      syncSettings({}),
      state({ measure: 'X', visits: ['V1', 'V2'] })
    );
    expect(short.columns[1].cells.map((entry) => [entry.level, entry.n])).toEqual([
      ['A', 0],
      ['B', 1]
    ]);
    expect(markOf(short.columns[1].cells[0], 'box')).toBe(null);
  });

  it('GC-TIME-006: the value axis covers what the form draws, with a little room: the whiskers’ ends for boxes, the standard errors’ for means, the quartiles for medians; on a logarithmic axis the room is a ratio (#85)', () => {
    const built = overTime();
    const ends = (mark) => {
      const marks = built.columns.flatMap((column) =>
        column.cells.map((cell) => markOf(cell, mark)).filter(Boolean)
      );
      return [
        Math.min(...marks.map((made) => made.lower)),
        Math.max(...marks.map((made) => made.upper))
      ];
    };
    for (const mark of TIME_MARKS) {
      const [least, greatest] = ends(mark);
      const [low, high] = timeDomain(built, mark, 'linear');
      expect(low, mark).toBeLessThan(least);
      expect(high, mark).toBeGreaterThan(greatest);
      expect(least - low, mark).toBeCloseTo((greatest - least) * 0.08, 10);
      expect(high - greatest, mark).toBeCloseTo((greatest - least) * 0.08, 10);
    }
    // Means with their standard errors span less than the boxes' whiskers do.
    const span = (mark) => {
      const [low, high] = timeDomain(built, mark, 'linear');
      return high - low;
    };
    expect(span('mean_se')).toBeLessThan(span('median_iqr'));
    expect(span('median_iqr')).toBeLessThan(span('box'));
    const logged = overTime({ yScale: 'log' });
    const [low, high] = timeDomain(logged, 'box', 'log');
    expect(low).toBeGreaterThan(0);
    const [least, greatest] = [
      Math.min(...logged.columns.flatMap((column) => column.cells.map((cell) => cell.stats.q5))),
      Math.max(...logged.columns.flatMap((column) => column.cells.map((cell) => cell.stats.q95)))
    ];
    expect(least / low).toBeCloseTo(high / greatest, 10);
    // Every value the same: still an axis with room.
    const flat = buildOverTime(
      {
        results: [
          { USUBJID: 'a', TEST: 'X', VISIT: 'V1', VISITNUM: 1, STRESN: 4, ARM: 'A' },
          { USUBJID: 'b', TEST: 'X', VISIT: 'V2', VISITNUM: 2, STRESN: 4, ARM: 'A' }
        ],
        participants: null
      },
      syncSettings({}),
      state({ measure: 'X', visits: ['V1', 'V2'] })
    );
    const [flatLow, flatHigh] = timeDomain(flat, 'box', 'linear');
    expect(flatLow).toBeLessThan(4);
    expect(flatHigh).toBeGreaterThan(4);
    // Nothing to draw: no axis.
    expect(timeDomain(overTime({ filters: { SEX: 'nobody' } }), 'box', 'linear')).toBe(null);
  });

  it('GC-TIME-007: for a change, a fold change or a percent change from one baseline visit, that visit is drawn, where every line starts, and is not tested: it is not among the visits R is asked about. With several baseline visits, and for the result itself, every visit is tested (#85)', () => {
    const raw = overTime();
    expect(raw.tested).toEqual(VISITS);
    expect(raw.untested).toEqual([]);
    expect(raw.columns.every((column) => column.tested)).toBe(true);
    for (const valueType of ['change', 'fold_change', 'percent_change']) {
      const built = overTime({ valueType });
      expect(built.visits, valueType).toEqual(VISITS);
      expect(built.tested, valueType).toEqual(VISITS.slice(1));
      expect(built.untested, valueType).toEqual(['Baseline']);
      expect(
        built.columns.map((column) => column.tested),
        valueType
      ).toEqual([false, true, true, true, true]);
      expect(built.baselineVisits, valueType).toEqual(['Baseline']);
      // The baseline visit is drawn: there the value is the same for everyone.
      const [baseline] = built.columns;
      const same = valueType === 'fold_change' ? 1 : 0;
      expect(baseline.cells.every((cell) => cell.n > 0 && cell.stats.median === same)).toBe(true);
    }
    const several = buildOverTime(
      tables,
      syncSettings({ baseline_visits: ['Baseline', 'Week 2'] }),
      state({ valueType: 'change' })
    );
    expect(several.tested).toEqual(VISITS);
    expect(several.untested).toEqual([]);
  });
});
