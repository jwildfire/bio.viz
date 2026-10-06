import { describe, it, expect } from 'vitest';
import { syncSettings } from '../../../src/group-comparison/configure.js';
import { buildPanels } from '../../../src/group-comparison/structureData.js';
import { buildTiles } from '../../../src/group-comparison/tiles.js';
import { frame } from '../../../src/core/index.js';
import { NOBODY_PASSES, keepFiltered } from '../../../src/shared/tables.js';
import { participants, results } from '../core/study.js';

// Filters that let nobody through (#29). The core's frame refuses a results
// table with no rows, as it should: a chart whose filters leave nobody must not
// hand it one. It draws nothing, and says why.

const settings = syncSettings({ baseline_visits: 'Baseline' });
const state = (overrides = {}) => ({
  measure: 'IL-6',
  visits: ['Week 4'],
  valueType: 'raw',
  groupBy: 'ARM',
  levels: null,
  colorBy: '',
  panelBy: '',
  mark: 'box',
  yScale: 'linear',
  filters: {},
  ...overrides
});
// The four participants aged 35 are all non-responders.
const NOBODY = { AGE: '35', RESPONSE: 'Responder' };

describe('group comparison: filters that let nobody through', () => {
  it('GC-FILTER-005: with no participant through the filters the chart asks the core for no frame and draws no panel and no tile, one biomarker or every biomarker, and the core still refuses a results table with no rows (#29)', () => {
    const tables = { results, participants };
    // The issue's case, and two filters with nobody in common.
    for (const filters of [{ SEX: 'Neither' }, NOBODY]) {
      expect(keepFiltered(tables, settings, filters).participants).toEqual([]);
      const model = buildPanels(tables, settings, state({ filters }));
      expect(model.filtered).toBe(0);
      expect(model.panels).toEqual([]);
      expect(model.extent).toBe(null);
      // Every view of it: several visits, a baseline value, a colour, panels, a log scale.
      for (const view of [
        { visits: ['Week 4', 'Week 12'] },
        { valueType: 'baseline' },
        { valueType: 'change' },
        { colorBy: 'SEX', panelBy: 'RESPONSE', yScale: 'log', mark: 'violin' },
        { groupBy: '' }
      ]) {
        const other = buildPanels(tables, settings, state({ filters, ...view }));
        expect(other.filtered, JSON.stringify(view)).toBe(0);
        expect(other.panels, JSON.stringify(view)).toEqual([]);
      }
      const built = buildTiles(
        tables,
        settings,
        state({ filters, visits: ['Baseline', 'Week 4'] }),
        ['CRP', 'IL-6', 'TNF-alpha']
      );
      expect(built.filtered).toBe(0);
      expect(built.groups).toEqual([]);
      expect(
        built.tiles.map((tile) => [tile.measure, tile.axis, tile.lines, tile.records])
      ).toEqual([
        ['CRP', null, [], []],
        ['IL-6', null, [], []],
        ['TNF-alpha', null, [], []]
      ]);
    }
    // Loosened, the same chart draws again.
    const four = buildPanels(tables, settings, state({ filters: { AGE: '35' } }));
    expect(four.filtered).toBe(4);
    expect(four.panels[0].records.length).toBeGreaterThan(0);
    // The core's refusal of a malformed table stays as it was.
    expect(() =>
      frame({ results: [], participants: [] }, { y: { measure: 'IL-6', visit: 'Week 4' } }, {})
    ).toThrow(/^bio\.viz: the results table has no column `USUBJID` \(`id_col`\)\.$/);
    // What every chart says of it, in one place.
    expect(NOBODY_PASSES).toBe('No participant passes the filters.');
  });

  it('GC-FILTER-005: with no kit on the page an empty selection lets everyone through, as it is not a filter in force (#29)', () => {
    const tables = { results, participants };
    for (const selection of ['', null, undefined]) {
      expect(keepFiltered(tables, settings, { SEX: selection }).participants).toHaveLength(200);
    }
    expect(keepFiltered(tables, settings, { SEX: 'F' }).participants).toHaveLength(91);
    expect(keepFiltered(tables, settings, { SEX: ['F', 'M'] }).participants).toHaveLength(200);
  });
});
