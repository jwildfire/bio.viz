import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { syncSettings } from '../../../src/group-comparison/configure.js';
import {
  BAND,
  bandwidth,
  buildPanels,
  categoryColumns,
  density,
  filterColumns,
  jitter,
  listMeasures,
  listVisits,
  quantile,
  slots,
  summarize,
  tickLabel,
  unitOf,
  yTitle
} from '../../../src/group-comparison/structureData.js';
import { DROPPED } from '../../../src/core/index.js';
import { participants, results } from '../core/study.js';

// What the group comparison chart draws (#9), worked out from the vendored
// synthetic study and held to what desktop R says about the same cells
// (tests/fixtures/group-comparison-r.json, written by tools/r-group-comparison.R).

const fromR = JSON.parse(
  readFileSync(new URL('../../fixtures/group-comparison-r.json', import.meta.url), 'utf8')
);
const settings = syncSettings({ baseline_visits: 'Baseline' });
const state = (overrides = {}) => ({
  measure: 'IL-6',
  visits: ['Week 4'],
  valueType: 'change',
  groupBy: 'ARM',
  levels: null,
  colorBy: '',
  panelBy: '',
  mark: 'box',
  yScale: 'linear',
  filters: {},
  ...overrides
});
const tables = { results, participants };
const close = (got, expected, relative) =>
  expect(Math.abs(got - expected)).toBeLessThanOrEqual(relative * Math.max(1, Math.abs(expected)));

// The chart's cells for one of R's comparisons.
function cellsFor(comparison, mark = 'box') {
  const model = buildPanels(
    tables,
    settings,
    state({
      measure: comparison.measure,
      visits: [comparison.visit],
      valueType: comparison.value_type,
      groupBy: comparison.group_by,
      colorBy: comparison.color_by || '',
      yScale: comparison.y_scale,
      mark
    })
  );
  expect(model.panels).toHaveLength(1);
  return model.panels[0].cells;
}

describe('group comparison: the numbers a box is drawn from', () => {
  it('GC-BOX-001: a quantile is worked out by R’s default rule, type 7 (#9)', () => {
    // (n − 1)p falls between the 2nd and 3rd of five values, a quarter of the way.
    expect(quantile([1, 2, 4, 8, 16], 0.3)).toBe(2 + (4 - 2) * 0.2);
    expect(quantile([1, 2, 4, 8, 16], 0.5)).toBe(4);
    expect(quantile([1, 2, 4, 8], 0.5)).toBe(3);
    expect(quantile([7], 0.95)).toBe(7);
    expect(quantile([1, 2], 0)).toBe(1);
    expect(quantile([1, 2], 1)).toBe(2);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
    // By hand for 1, 2, 4, 8, 16: positions 0.2, 1, 2, 3 and 3.8 of the sorted values.
    const summary = summarize([8, 1, 16, 2, 4]);
    expect([summary.n, summary.min, summary.q25, summary.median, summary.q75, summary.max]).toEqual(
      [5, 1, 2, 4, 8, 16]
    );
    expect(summary.q5).toBeCloseTo(1 + (2 - 1) * 0.2, 12);
    expect(summary.q95).toBeCloseTo(8 + (16 - 8) * 0.8, 12);
    expect(summary.mean).toBeCloseTo(31 / 5, 12);
  });

  it('GC-BOX-002: on the synthetic study every box’s count, quantiles and mean equal R’s quantile(type = 7) and mean (#9)', () => {
    expect(fromR.made_by.script).toBe('tools/r-group-comparison.R');
    expect(fromR.comparisons).toHaveLength(5);
    let compared = 0;
    for (const comparison of fromR.comparisons) {
      const cells = cellsFor(comparison);
      expect(cells.map((cell) => [cell.level, cell.color])).toEqual(
        comparison.cells.map((cell) => [cell.level, cell.color])
      );
      cells.forEach((cell, index) => {
        const expected = comparison.cells[index];
        expect(cell.n, comparison.name).toBe(expected.n);
        expect(cell.stats.n).toBe(expected.n);
        for (const key of ['min', 'q5', 'q25', 'median', 'q75', 'q95', 'max', 'mean']) {
          close(cell.stats[key], expected[key], 1e-12);
          compared += 1;
        }
      });
    }
    // 12 cells, eight numbers each: nothing passed by comparing nothing.
    expect(compared).toBe(96);
    // The first comparison is the one the requirement names: 186 participants.
    expect(cellsFor(fromR.comparisons[0]).map((cell) => cell.n)).toEqual([95, 91]);
  });
});

describe('group comparison: the outline of a violin', () => {
  it('GC-VIOLIN-001: the smoothing width equals R’s bw.nrd0, and the outline equals a Gaussian kernel density worked out in R (#9)', () => {
    let compared = 0;
    for (const comparison of fromR.comparisons) {
      const cells = cellsFor(comparison, 'violin');
      cells.forEach((cell, index) => {
        const expected = comparison.cells[index];
        close(cell.density.bandwidth, expected.bandwidth, 1e-12);
        expect(cell.density.at).toHaveLength(64);
        cell.density.at.forEach((height, at) => close(height, expected.density_at[at], 1e-12));
        cell.density.density.forEach((value, at) => close(value, expected.density[at], 1e-10));
        compared += 64;
        // The outline stops at the data.
        close(cell.density.at[0], expected.min, 1e-12);
        close(cell.density.at[63], expected.max, 1e-12);
      });
    }
    expect(compared).toBe(12 * 64);
  });

  it('GC-VIOLIN-002: on a logarithmic axis the outline is worked out on the logarithm of the values (#9)', () => {
    const comparison = fromR.comparisons.find((entry) => entry.y_scale === 'log');
    const [first] = cellsFor(comparison, 'violin');
    const values = first.records.map((record) => record.y);
    close(first.density.bandwidth, bandwidth(values.map(Math.log10)), 1e-15);
    expect(first.density.bandwidth).not.toBeCloseTo(bandwidth(values), 3);
    // A box is drawn from the values themselves on either axis.
    close(first.stats.median, comparison.cells[0].median, 1e-12);
  });

  it('GC-VIOLIN-003: a cell with one value, or with every value the same, has no outline, and a box mark asks for none (#9)', () => {
    expect(density([4])).toBe(null);
    expect(density([4, 4, 4])).toBe(null);
    expect(Number.isNaN(bandwidth([4]))).toBe(true);
    expect(density([1, 2, 3], 5).at).toEqual([1, 1.5, 2, 2.5, 3]);
    expect(cellsFor(fromR.comparisons[0], 'box').every((cell) => cell.density === null)).toBe(true);
    expect(cellsFor(fromR.comparisons[0], 'points').every((cell) => cell.density === null)).toBe(
      true
    );
  });
});

describe('group comparison: panels and cells', () => {
  it('GC-DATA-001: one panel holds one cell per level of the group, each with the participants the frame resolved there (#9)', () => {
    const model = buildPanels(tables, settings, state());
    expect(model.panels).toHaveLength(1);
    const [panel] = model.panels;
    expect(model.levels).toEqual(['Placebo', 'Treatment']);
    expect(panel.cells.map((cell) => [cell.level, cell.x, cell.n])).toEqual([
      ['Placebo', 0, 95],
      ['Treatment', 1, 91]
    ]);
    expect(panel.records).toHaveLength(186);
    expect(panel.participants).toBe(200);
    expect(panel.dropped).toEqual([
      { reason: DROPPED.NO_RESULT, variable: 'y', n: 13 },
      { reason: DROPPED.MISSING_RESULT, variable: 'y', n: 1 }
    ]);
    // The records are the frame's: the id, and one field per variable.
    expect(panel.cells[0].records[0]).toEqual({ USUBJID: 'BIO-001', y: 5.9 - 6.927, x: 'Placebo' });
    expect(panel.variable).toEqual({ measure: 'IL-6', visit: 'Week 4', value: 'change' });
    expect(model.baselineVisits).toEqual(['Baseline']);
  });

  it('GC-DATA-002: the number of participants in each group is written beneath it, and with a colour the number in each colour (#9)', () => {
    const plain = buildPanels(tables, settings, state()).panels[0];
    expect(plain.ticks).toEqual([
      ['Placebo', 'n = 95'],
      ['Treatment', 'n = 91']
    ]);
    const coloured = buildPanels(tables, settings, state({ colorBy: 'SEX', valueType: 'raw' }));
    expect(coloured.panels[0].ticks).toEqual([
      ['Placebo', 'n = 95', '42 · 53'],
      ['Treatment', 'n = 91', '42 · 49']
    ]);
    expect(tickLabel('A', [{ n: 3 }])).toEqual(['A', 'n = 3']);
    expect(tickLabel('A', [{ n: 3 }, { n: 0 }])).toEqual(['A', 'n = 3', '3 · 0']);
  });

  it('GC-DATA-003: a second grouping by colour splits each level into side-by-side cells that share its place on the axis (#9)', () => {
    const model = buildPanels(tables, settings, state({ colorBy: 'SEX', valueType: 'raw' }));
    expect(model.colors).toEqual(['F', 'M']);
    const cells = model.panels[0].cells;
    expect(cells.map((cell) => [cell.level, cell.color, cell.n])).toEqual([
      ['Placebo', 'F', 42],
      ['Placebo', 'M', 53],
      ['Treatment', 'F', 42],
      ['Treatment', 'M', 49]
    ]);
    // Two slots of 0.4 about each level's place, each mark 0.8 of its slot wide.
    const two = slots(2);
    [-0.2, 0.2].forEach((offset, index) => expect(two.offsets[index]).toBeCloseTo(offset, 12));
    expect(two.halfWidth).toBeCloseTo(0.16, 12);
    expect(slots(1).offsets).toEqual([0]);
    expect(slots(1).halfWidth).toBeCloseTo(BAND * 0.4, 12);
    [-0.2, 0.2, 0.8, 1.2].forEach((x, index) => expect(cells[index].x).toBeCloseTo(x, 12));
    expect(cells[0].x + cells[0].halfWidth).toBeLessThan(cells[1].x - cells[1].halfWidth);
  });

  it('GC-DATA-004: panels by one further variable give one panel per level of it, all on one value axis (#9)', () => {
    const model = buildPanels(tables, settings, state({ panelBy: 'SEX' }));
    expect(model.panelLevels).toEqual(['F', 'M']);
    expect(model.panels.map((panel) => panel.title)).toEqual(['F', 'M']);
    expect(model.panels.map((panel) => panel.cells.map((cell) => cell.n))).toEqual([
      [42, 42],
      [53, 49]
    ]);
    expect(model.panels[0].records.every((record) => record.panel === 'F')).toBe(true);
    // One extent for every panel, so the panels can be read against each other.
    const every = model.panels.flatMap((panel) => panel.records.map((record) => record.y));
    expect(model.extent).toEqual([Math.min(...every), Math.max(...every)]);
  });

  it('GC-DATA-005: with more than one visit chosen each visit is a panel, crossed with the panel variable when there is one (#9)', () => {
    const two = buildPanels(tables, settings, state({ visits: ['Week 4', 'Week 12'] }));
    expect(two.panels.map((panel) => panel.title)).toEqual(['Week 4', 'Week 12']);
    expect(two.panels.map((panel) => panel.variable.visit)).toEqual(['Week 4', 'Week 12']);
    expect(two.panels[0].records).toHaveLength(186);
    const crossed = buildPanels(
      tables,
      settings,
      state({ visits: ['Week 4', 'Week 12'], panelBy: 'SEX' })
    );
    expect(crossed.panels.map((panel) => panel.title)).toEqual([
      'Week 4 · F',
      'Week 4 · M',
      'Week 12 · F',
      'Week 12 · M'
    ]);
    // One visit: the panel is not named for it. A baseline value has no visit at all.
    expect(buildPanels(tables, settings, state()).panels[0].title).toBe('');
    const baseline = buildPanels(tables, settings, state({ valueType: 'baseline', visits: [] }));
    expect(baseline.panels).toHaveLength(1);
    expect(baseline.panels[0].variable).toEqual({ measure: 'IL-6', value: 'baseline' });
    expect(baseline.panels[0].records).toHaveLength(200);
  });

  it('GC-DATA-006: the levels chosen are the levels drawn; a level left out takes its participants with it (#9)', () => {
    const model = buildPanels(
      tables,
      settings,
      state({ groupBy: 'RESPONSE', levels: ['Responder'] })
    );
    expect(model.levels).toEqual(['Non-responder', 'Responder']);
    expect(model.shownLevels).toEqual(['Responder']);
    expect(model.panels[0].cells.map((cell) => cell.level)).toEqual(['Responder']);
    expect(model.panels[0].records.every((record) => record.x === 'Responder')).toBe(true);
    expect(model.panels[0].records).toHaveLength(model.panels[0].cells[0].n);
  });

  it('GC-DATA-007: on a logarithmic axis a value of zero or less is left out and counted (#9)', () => {
    const linear = buildPanels(tables, settings, state());
    const log = buildPanels(tables, settings, state({ yScale: 'log' }));
    const negative = linear.panels[0].records.filter((record) => record.y <= 0).length;
    expect(negative).toBeGreaterThan(0);
    expect(log.panels[0].nonPositive).toBe(negative);
    expect(log.panels[0].records).toHaveLength(186 - negative);
    expect(log.panels[0].records.every((record) => record.y > 0)).toBe(true);
    expect(linear.panels[0].nonPositive).toBe(0);
    expect(log.extent[0]).toBeGreaterThan(0);
  });

  it('GC-DATA-008: a filter chooses participants: the ones filtered out are not drawn, and are not counted as missing a result (#9)', () => {
    const model = buildPanels(tables, settings, state({ filters: { SEX: 'F', RESPONSE: null } }));
    const women = participants.filter((row) => row.SEX === 'F').length;
    expect(model.filtered).toBe(women);
    expect(model.panels[0].participants).toBe(women);
    expect(model.panels[0].cells.map((cell) => cell.n)).toEqual([42, 42]);
    expect(model.panels[0].dropped.every((entry) => entry.variable === 'y')).toBe(true);
    // A selection of several values, as safety.viz's multiple filter gives it.
    const both = buildPanels(tables, settings, state({ filters: { SEX: ['F', 'M'] } }));
    expect(both.panels[0].records).toHaveLength(186);
    // The test of a value against a selection can be safety.viz's own.
    const calls = [];
    buildPanels(tables, settings, state({ filters: { SEX: 'F' } }), {
      filterMatches: (value, selection) => {
        calls.push([value, selection]);
        return value === selection;
      }
    });
    expect(calls).toHaveLength(participants.length);
  });

  it('GC-DATA-009: with the results table alone a group comes from a column carried on the results rows (#9)', () => {
    const arm = Object.fromEntries(participants.map((row) => [row.USUBJID, row.ARM]));
    const carried = results.map((row) => ({ ...row, ARM: arm[row.USUBJID] }));
    const alone = buildPanels({ results: carried, participants: null }, settings, state());
    const withTable = buildPanels(tables, settings, state());
    expect(alone.filtered).toBe(null);
    expect(alone.panels[0].cells.map((cell) => [cell.level, cell.n])).toEqual([
      ['Placebo', 95],
      ['Treatment', 91]
    ]);
    expect(alone.panels[0].cells.map((cell) => cell.stats)).toEqual(
      withTable.panels[0].cells.map((cell) => cell.stats)
    );
  });
});

describe('group comparison: what the controls offer', () => {
  it('GC-CTRL-001: with participant data the columns offered as a group are the participant table’s categories (#9)', () => {
    expect(categoryColumns(tables, settings)).toEqual([
      { value_col: 'ARM', label: 'ARM', table: 'participants' },
      { value_col: 'SEX', label: 'SEX', table: 'participants' },
      { value_col: 'RESPONSE', label: 'RESPONSE', table: 'participants' }
    ]);
    // AGE and BMIBL hold more values than a category has, and the id is not a group.
    const few = categoryColumns(tables, syncSettings({ max_levels: 2 })).map((c) => c.value_col);
    expect(few).toEqual(['ARM', 'SEX', 'RESPONSE']);
    const many = categoryColumns(tables, syncSettings({ max_levels: 60 })).map((c) => c.value_col);
    expect(many).toContain('AGE');
    expect(many).not.toContain('USUBJID');
  });

  it('GC-CTRL-002: with the results table alone the columns offered are the ones carried on its rows that hold one value per participant (#9)', () => {
    const byId = Object.fromEntries(participants.map((row) => [row.USUBJID, row]));
    const carried = results.map((row) => ({
      ...row,
      ARM: byId[row.USUBJID].ARM,
      SEX: byId[row.USUBJID].SEX
    }));
    expect(categoryColumns({ results: carried, participants: null }, settings)).toEqual([
      { value_col: 'ARM', label: 'ARM', table: 'results' },
      { value_col: 'SEX', label: 'SEX', table: 'results' }
    ]);
    // The synthetic results as vendored carry no such column: the visit, the
    // biomarker and the unit are mapped, or change within a participant.
    expect(categoryColumns({ results, participants: null }, settings)).toEqual([]);
    // With both tables a column of the same name is offered once, from the participant table.
    expect(
      categoryColumns({ results: carried, participants }, settings).map((c) => c.table)
    ).toEqual(['participants', 'participants', 'participants']);
    // A list given in settings is the list.
    expect(
      categoryColumns(tables, syncSettings({ groups: ['SEX', { value_col: 'ARM', label: 'Arm' }] }))
    ).toEqual([
      { value_col: 'SEX', label: 'SEX', table: 'given' },
      { value_col: 'ARM', label: 'Arm', table: 'given' }
    ]);
  });

  it('GC-CTRL-003: filters are the participant table’s categories, and there are none without a participant table (#9)', () => {
    const categories = categoryColumns(tables, settings);
    expect(filterColumns(tables, settings, categories)).toEqual([
      { value_col: 'ARM', label: 'ARM' },
      { value_col: 'SEX', label: 'SEX' },
      { value_col: 'RESPONSE', label: 'RESPONSE' }
    ]);
    expect(filterColumns({ results, participants: null }, settings, categories)).toEqual([]);
    expect(filterColumns({ results, participants: [] }, settings, categories)).toEqual([]);
    // Filters named in settings are the filters, kept to the columns the table has.
    const named = syncSettings({ filters: ['SEX', 'SITE', { value_col: 'ARM', label: 'Arm' }] });
    expect(filterColumns(tables, named, categories)).toEqual([
      { value_col: 'SEX', label: 'SEX' },
      { value_col: 'ARM', label: 'Arm' }
    ]);
    expect(filterColumns(tables, syncSettings({ filters: [] }), categories)).toEqual([]);
  });

  it('GC-CTRL-004: the biomarkers, the visits and the visit the chart opens on are read from the table (#9)', () => {
    expect(listMeasures(results, settings)).toHaveLength(12);
    expect(listMeasures(results, settings).slice(0, 3)).toEqual(['CRP', 'D-dimer', 'Ferritin']);
    expect(listMeasures(results, syncSettings({ measures: ['IL-6', 'ALT', 'CRP'] }))).toEqual([
      'IL-6',
      'CRP'
    ]);
    expect(listMeasures(results, syncSettings({ measures: ['ALT'] }))).toHaveLength(12);
    // Opens on the first visit after the baseline.
    expect(listVisits(results, settings)).toEqual({
      all: ['Baseline', 'Week 2', 'Week 4', 'Week 8', 'Week 12'],
      start: ['Week 2']
    });
    expect(
      listVisits(results, syncSettings({ visits: ['Week 12', 'Week 4', 'Week 99'] })).start
    ).toEqual(['Week 12', 'Week 4']);
    expect(
      listVisits(results, syncSettings({ baseline_visits: ['Baseline', 'Week 2'] })).start
    ).toEqual(['Week 4']);
    const one = results.filter((row) => row.VISIT === 'Baseline');
    expect(listVisits(one, settings).start).toEqual(['Baseline']);
  });

  it('GC-DATA-010: the value axis is named for the variable, with the unit its values are in (#9)', () => {
    expect(unitOf(results, settings, 'IL-6')).toBe('pg/mL');
    expect(yTitle(results, settings, state())).toBe('IL-6 at Week 4, change from baseline (pg/mL)');
    expect(yTitle(results, settings, state({ valueType: 'raw' }))).toBe('IL-6 at Week 4 (pg/mL)');
    expect(yTitle(results, settings, state({ valueType: 'baseline' }))).toBe(
      'IL-6 at baseline (pg/mL)'
    );
    // A ratio has no unit, and a percent change is in percent.
    expect(yTitle(results, settings, state({ valueType: 'fold_change' }))).toBe(
      'IL-6 at Week 4, fold change from baseline'
    );
    expect(yTitle(results, settings, state({ valueType: 'percent_change' }))).toBe(
      'IL-6 at Week 4, percent change from baseline (%)'
    );
    // With several visits each panel names its own, and the axis names the rest.
    expect(yTitle(results, settings, state({ visits: ['Week 4', 'Week 8'] }))).toBe(
      'IL-6, change from baseline (pg/mL)'
    );
    expect(yTitle(results, syncSettings({ unit_col: null }), state({ valueType: 'raw' }))).toBe(
      'IL-6 at Week 4'
    );
  });

  it('GC-DATA-011: a point’s place across its slot is fixed by the participant’s id (#9)', () => {
    const ids = participants.map((row) => row.USUBJID);
    const places = ids.map(jitter);
    expect(places).toEqual(ids.map(jitter));
    expect(Math.min(...places)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...places)).toBeLessThanOrEqual(1);
    // Spread across the slot, not piled on one side.
    expect(places.filter((place) => place < 0).length).toBeGreaterThan(60);
    expect(places.filter((place) => place > 0).length).toBeGreaterThan(60);
    expect(new Set(places).size).toBe(200);
  });
});
