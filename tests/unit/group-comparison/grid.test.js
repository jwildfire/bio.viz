import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { syncSettings } from '../../../src/group-comparison/configure.js';
import {
  NO_VISIT,
  OPENING_VIEWS,
  SHADE_FULL,
  buildGrid,
  choosePair,
  pairOf,
  shadeOf
} from '../../../src/group-comparison/grid.js';
import { buildPanels, listMeasures } from '../../../src/group-comparison/structureData.js';
import { buildTiles } from '../../../src/group-comparison/tiles.js';
import { participants, results } from '../core/study.js';

// The difference grid's layout (#86): which two groups, which cells, which
// rows R is handed, and the colour a cell takes from R's estimate. Nothing
// here is a statistic, and the tests say so of the source too.

const VISITS = ['Baseline', 'Week 2', 'Week 4', 'Week 8', 'Week 12'];
const tables = { results, participants };
const settings = syncSettings({ baseline_visits: 'Baseline' });
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
const gridOf = (overrides = {}, pair = ['Placebo', 'Treatment'], config = settings) => {
  const drawn = state(overrides);
  const built = buildTiles(tables, config, drawn, measures);
  return buildGrid(built, { pair, valueType: drawn.valueType });
};

describe('the difference grid: the two groups', () => {
  it('GC-GRID-001: the two groups compared are the pair asked for when both are drawn and they differ, and otherwise the first two groups drawn, in the order drawn; with fewer than two there is no pair; choosing the group the other place holds makes the two change places (#86)', () => {
    expect(OPENING_VIEWS).toEqual(['tiles', 'grid']);
    const four = ['Placebo F', 'Placebo M', 'Treatment F', 'Treatment M'];
    expect(pairOf(['Placebo', 'Treatment'])).toEqual(['Placebo', 'Treatment']);
    expect(pairOf(['Placebo', 'Treatment'], null)).toEqual(['Placebo', 'Treatment']);
    expect(pairOf(four)).toEqual(['Placebo F', 'Placebo M']);
    // The pair asked for, in the order asked: the order is the direction.
    expect(pairOf(four, ['Treatment F', 'Placebo F'])).toEqual(['Treatment F', 'Placebo F']);
    expect(pairOf(['Placebo', 'Treatment'], ['Treatment', 'Placebo'])).toEqual([
      'Treatment',
      'Placebo'
    ]);
    // A pair with a group that is not drawn, the same group twice, or not two.
    expect(pairOf(four, ['Treatment F', 'Nobody'])).toEqual(['Placebo F', 'Placebo M']);
    expect(pairOf(four, ['Treatment F', 'Treatment F'])).toEqual(['Placebo F', 'Placebo M']);
    expect(pairOf(four, ['Treatment F'])).toEqual(['Placebo F', 'Placebo M']);
    expect(pairOf(four, 'Treatment F')).toEqual(['Placebo F', 'Placebo M']);
    // Levels that are numbers are compared as the text they are drawn as.
    expect(pairOf([1, 2, 3], ['3', '1'])).toEqual(['3', '1']);
    // Fewer than two groups: nothing to take a difference of.
    expect(pairOf(['Placebo'])).toBeNull();
    expect(pairOf([])).toBeNull();
    expect(pairOf(null, ['Placebo', 'Treatment'])).toBeNull();

    const pair = ['Placebo F', 'Placebo M'];
    expect(choosePair(pair, 0, 'Treatment F')).toEqual(['Treatment F', 'Placebo M']);
    expect(choosePair(pair, 1, 'Treatment M')).toEqual(['Placebo F', 'Treatment M']);
    // The group the other place holds: the two change places.
    expect(choosePair(pair, 0, 'Placebo M')).toEqual(['Placebo M', 'Placebo F']);
    expect(choosePair(pair, 1, 'Placebo F')).toEqual(['Placebo M', 'Placebo F']);
    // The same group again changes nothing, and the pair given is not written to.
    expect(choosePair(pair, 0, 'Placebo F')).toEqual(pair);
    expect(pair).toEqual(['Placebo F', 'Placebo M']);
  });
});

describe('the difference grid: its cells and the rows R is handed', () => {
  it('GC-GRID-002: the grid has one row per biomarker in the Biomarker control’s order and one column per visit chosen, in visit order; a cell’s rows are the rows that biomarker’s own panel draws at that visit for the two groups compared, each with its visit and its biomarker named, and no other group’s rows are among them (#86)', () => {
    const grid = gridOf();
    expect(grid.pair).toEqual(['Placebo', 'Treatment']);
    expect(grid.biomarkers).toEqual(measures);
    expect(grid.biomarkers).toHaveLength(12);
    expect(grid.columns).toEqual(VISITS.map((visit) => ({ visit, tested: true })));
    expect(grid.visits).toEqual(VISITS);
    expect(grid.untested).toEqual([]);
    expect(grid.rows.map((row) => row.measure)).toEqual(measures);
    expect(Object.keys(grid.data[0])).toEqual(['USUBJID', 'y', 'x', 'visit', 'biomarker']);
    // Biomarker by biomarker, in the grid's order.
    expect([...new Set(grid.data.map((row) => row.biomarker))]).toEqual(measures);
    // One participant, one row a biomarker and visit.
    const seen = new Set(
      grid.data.map((row) => `${row.USUBJID}\u0000${row.biomarker}\u0000${row.visit}`)
    );
    expect(seen.size).toBe(grid.data.length);
    let cells = 0;
    for (const row of grid.rows) {
      expect(row.cells.map((cell) => cell.visit)).toEqual(VISITS);
      for (const cell of row.cells) {
        // The panel the single-visit view draws for this biomarker at this visit.
        const [panel] = buildPanels(
          tables,
          settings,
          state({ measure: row.measure, visits: [cell.visit] })
        ).panels;
        const own = grid.data
          .filter((record) => record.biomarker === row.measure && record.visit === cell.visit)
          .map(({ visit, biomarker, ...record }) => record);
        expect(own, `${row.measure} ${cell.visit}`).toEqual(panel.records);
        expect(cell.n, `${row.measure} ${cell.visit}`).toEqual([
          own.filter((record) => record.x === 'Placebo').length,
          own.filter((record) => record.x === 'Treatment').length
        ]);
        cells += 1;
      }
    }
    expect(cells).toBe(60);

    // With four groups drawn, only the two compared are sent, and the counts
    // are theirs in the order compared.
    const withSex = {
      results,
      participants: participants.map((row) => ({ ...row, ARM_SEX: `${row.ARM} ${row.SEX}` }))
    };
    const drawn = state({ groupBy: 'ARM_SEX' });
    const built = buildTiles(withSex, settings, drawn, measures);
    expect(built.groups.map((group) => group.level)).toEqual([
      'Placebo F',
      'Placebo M',
      'Treatment F',
      'Treatment M'
    ]);
    const pair = ['Treatment F', 'Placebo F'];
    const two = buildGrid(built, { pair, valueType: 'raw' });
    expect([...new Set(two.data.map((row) => row.x))].sort()).toEqual(['Placebo F', 'Treatment F']);
    const [il6] = buildPanels(
      withSex,
      settings,
      state({ measure: 'IL-6', visits: ['Week 4'], groupBy: 'ARM_SEX' })
    ).panels;
    const cell = two.rows
      .find((row) => row.measure === 'IL-6')
      .cells.find((entry) => entry.visit === 'Week 4');
    expect(cell.n).toEqual(
      pair.map((group) => il6.records.filter((record) => record.x === group).length)
    );
    // With no pair there is a layout and no row for R.
    const none = buildGrid(built, { pair: null, valueType: 'raw' });
    expect(none.pair).toBeNull();
    expect(none.data).toEqual([]);
    expect(none.rows).toHaveLength(12);
  });

  it('GC-GRID-003: for a change, a fold change or a percent change from one baseline visit the baseline visit has a column and no cell, and its rows are not handed to R; with several baseline visits every visit is compared; a baseline value, which has no visit, is one column; and only the visits chosen are columns (#86)', () => {
    for (const valueType of ['change', 'fold_change', 'percent_change']) {
      const grid = gridOf({ valueType });
      expect(grid.columns, valueType).toEqual(
        VISITS.map((visit) => ({ visit, tested: visit !== 'Baseline' }))
      );
      expect(grid.visits).toEqual(VISITS.slice(1));
      expect(grid.untested).toEqual(['Baseline']);
      expect(grid.data.some((row) => row.visit === 'Baseline')).toBe(false);
      for (const row of grid.rows) {
        expect(row.cells[0]).toEqual({ visit: 'Baseline', tested: false, n: null });
        expect(row.cells.slice(1).every((cell) => cell.tested && cell.n.length === 2)).toBe(true);
      }
    }
    // Two baseline visits: a value at one of them varies, so it is compared.
    const two = syncSettings({ baseline_visits: ['Baseline', 'Week 2'] });
    const several = gridOf({ valueType: 'change' }, ['Placebo', 'Treatment'], two);
    expect(several.visits).toEqual(VISITS);
    expect(several.untested).toEqual([]);
    // The visits chosen, and no others.
    const chosen = gridOf({ valueType: 'change', visits: ['Week 4', 'Week 12'] });
    expect(chosen.columns).toEqual([
      { visit: 'Week 4', tested: true },
      { visit: 'Week 12', tested: true }
    ]);
    expect([...new Set(chosen.data.map((row) => row.visit))]).toEqual(['Week 4', 'Week 12']);
    // A baseline value has no visit: one column, named for what it is.
    const baseline = gridOf({ valueType: 'baseline' });
    expect(NO_VISIT).toBe('Baseline value');
    expect(baseline.columns).toEqual([{ visit: 'Baseline value', tested: true }]);
    expect(baseline.visits).toEqual(['Baseline value']);
    expect(new Set(baseline.data.map((row) => row.visit))).toEqual(new Set(['Baseline value']));
    expect(baseline.data).toHaveLength(2400);
  });
});

// The relative luminance of a colour written hsl(h, s%, l%), and the contrast
// of two luminances, by the Web Content Accessibility Guidelines' rule.
function luminance(hsl) {
  const [h, s, l] = hsl.match(/[\d.]+/g).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    const value = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}
const contrast = (one, other) => (Math.max(one, other) + 0.05) / (Math.min(one, other) + 0.05);
// The ink a cell's figure is printed in: #1f2933.
const INK = luminance('hsl(210, 24%, 16%)');

describe('the difference grid: a cell’s colour', () => {
  it('GC-GRID-004: a cell’s colour is read off the estimate R returned: neutral at nought, orange below and blue above, deeper the further from nought and deepest at one pooled standard deviation and beyond; the ends are fixed, the two sides mirror one another in depth, and the figure printed on any of them keeps a contrast of 4.5 to 1 or more (#86)', () => {
    expect(SHADE_FULL).toBe(1);
    expect(shadeOf(0)).toEqual({ side: 'none', depth: 0, color: 'hsl(0, 0%, 96%)' });
    expect(shadeOf(0.5)).toEqual({ side: 'above', depth: 0.5, color: 'hsl(217, 78%, 84%)' });
    expect(shadeOf(-0.5)).toEqual({ side: 'below', depth: 0.5, color: 'hsl(18, 82%, 84%)' });
    expect(shadeOf(1).color).toBe('hsl(217, 78%, 72%)');
    expect(shadeOf(-1).color).toBe('hsl(18, 82%, 72%)');
    // Beyond the end the colour is the end's: the figure says how far beyond.
    expect(shadeOf(2.7)).toEqual({ ...shadeOf(1), depth: 1 });
    expect(shadeOf(-40).color).toBe(shadeOf(-1).color);
    // Close to nought the colour is close to neutral: a tint, not a jump.
    expect(shadeOf(0.01).color).toBe('hsl(217, 3%, 96%)');
    expect(shadeOf(-0.01).color).toBe('hsl(18, 3%, 96%)');
    let last = { above: 96, below: 96 };
    for (let step = 1; step <= 150; step += 1) {
      const estimate = step / 100;
      const above = shadeOf(estimate);
      const below = shadeOf(-estimate);
      expect(above.side).toBe('above');
      expect(below.side).toBe('below');
      expect(above.depth).toBe(below.depth);
      expect(above.depth).toBe(Math.min(1, estimate));
      const light = (shade) => Number(shade.color.match(/([\d.]+)%\)$/)[1]);
      // Never lighter for a greater difference, and the two sides alike.
      expect(light(above)).toBeLessThanOrEqual(last.above);
      expect(light(below)).toBe(light(above));
      last = { above: light(above), below: light(below) };
      for (const shade of [above, below]) {
        expect(contrast(luminance(shade.color), INK), shade.color).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(luminance(shadeOf(0).color), INK)).toBeGreaterThanOrEqual(4.5);
  });

  it('GC-GRID-005: nothing of the difference is worked out in JavaScript: the grid’s source takes no mean, no standard deviation, no pooling and no interval, sets no limit from the answers, and holds no minimum group size or confidence level (#86)', () => {
    const source = readFileSync(
      new URL('../../../src/group-comparison/grid.js', import.meta.url),
      'utf8'
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const absent of [
      /Math\.sqrt|Math\.pow|\*\*/,
      /\bmean\b|\bsd\b|variance|pooled|hedges|cohen/i,
      /Math\.max\(/,
      /reduce\(/,
      /nMinGroup|nConfLevel|0\.95|1\.96/,
      /p_value|pValue/
    ]) {
      expect(code, String(absent)).not.toMatch(absent);
    }
    // The one piece of arithmetic on an estimate is its place on the fixed scale.
    expect(code.match(/Math\.abs\(estimate\)/g)).toHaveLength(1);
    // And the chart sends R no confidence level and no minimum group size.
    const statistic = readFileSync(
      new URL('../../../src/group-comparison/statistic.js', import.meta.url),
      'utf8'
    );
    const request = statistic.slice(
      statistic.indexOf('export function gridRequest'),
      statistic.indexOf('export function', statistic.indexOf('export function gridRequest') + 10)
    );
    expect(request).toContain('chrGroups');
    expect(request).not.toMatch(/nConfLevel|nMinGroup|strMethod|strPAdjust/);
  });
});
