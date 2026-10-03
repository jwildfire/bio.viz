import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { syncSettings } from '../../../src/group-comparison/configure.js';
import { buildPanels } from '../../../src/group-comparison/structureData.js';
import { statisticRequest } from '../../../src/group-comparison/statistic.js';
import { cutNote } from '../../../src/shared/cut.js';
import { checkTables } from '../../../src/shared/chartHost.js';
import { cutPoints } from '../../../src/core/index.js';
import { createConnection } from '../../../src/r/index.js';
import { canonicalJson } from '../../../src/r/canonical.js';
import { participants, results } from '../core/study.js';

// A cut biomarker as the group comparison's category and panel (#43). The
// points and the groups are the core's cut rule, held to desktop R in
// tests/unit/core/cut.test.js; here, what the chart takes and says.

const fromR = JSON.parse(
  readFileSync(new URL('../../fixtures/cut-r.json', import.meta.url), 'utf8')
);
const cutCase = (name) => fromR.cases.find((entry) => entry.name === name);
// What desktop R answered for cut groups it made itself from the vendored study,
// with the key it wrote by the recipe (tools/r-group-statistics.R).
const statistics = JSON.parse(
  readFileSync(new URL('../../fixtures/group-statistics-r.json', import.meta.url), 'utf8')
);
const recipeOf = (name) => statistics.recipes.find((entry) => entry.case === name);
const crp = (cut) => ({ measure: 'CRP', visit: 'Baseline', cut });

const refused = (overrides) => {
  try {
    syncSettings(overrides);
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    return error.message;
  }
  throw new Error(`not refused: ${JSON.stringify(overrides)}`);
};

const state = (more) => ({
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
  ...more
});

describe('group comparison: a cut biomarker', () => {
  it('GC-CUT-005: `group_by` and `panel_by` take a column or a cut variable, written as the core writes one; a variable with no cut, a malformed cut, or a cut of what the tables do not have, is refused with a sentence (#43, #46)', () => {
    expect(syncSettings({ group_by: crp('median') }).group_by).toEqual({
      measure: 'CRP',
      visit: 'Baseline',
      value: 'raw',
      cut: 'median'
    });
    expect(
      syncSettings({ panel_by: { col: 'AGE', type: 'number', cut: [40, 60] } }).panel_by
    ).toEqual({ col: 'AGE', type: 'number', cut: [40, 60] });
    expect(
      syncSettings({ group_by: { measure: 'CRP', value: 'baseline', cut: 'tertiles' } }).group_by
    ).toEqual({ measure: 'CRP', value: 'baseline', cut: 'tertiles' });
    // Written back, it reads the same: settings can be laid over settings.
    const once = syncSettings({ group_by: crp([2, 5]) });
    expect(syncSettings(once).group_by).toEqual(once.group_by);
    expect(syncSettings({ group_by: 'ARM' }).group_by).toBe('ARM');

    expect(refused({ group_by: { measure: 'CRP', visit: 'Baseline' } })).toBe(
      'bio.viz: `group_by` is a variable with no cut. A biomarker or a number makes groups only ' +
        "when it is cut: add `cut: 'median'`, 'tertiles', 'quartiles' or the cut points."
    );
    expect(refused({ panel_by: crp('deciles') })).toMatch(
      /`cut` must be 'median', 'tertiles', 'quartiles' or a list of cut points/
    );
    expect(refused({ group_by: { col: 'AGE', cut: 'median' } })).toMatch(
      /must be read as a number: add `type: 'number'`/
    );
    // The colour is a column only.
    expect(refused({ color_by: crp('median') })).toMatch(/`color_by` must be the name of a column/);

    // A cut of something the tables do not have is refused when they are read.
    const tables = { results, participants };
    const read = (overrides) => () => checkTables(tables, syncSettings(overrides));
    expect(read({ group_by: { measure: 'Troponin', visit: 'Baseline', cut: 'median' } })).toThrow(
      new TypeError(
        'bio.viz: `group_by` cuts the biomarker Troponin, which the results table does not have.'
      )
    );
    expect(read({ panel_by: { col: 'WEIGHT', type: 'number', cut: [60] } })).toThrow(
      new TypeError(
        'bio.viz: `panel_by` cuts the column WEIGHT, which neither the results table nor the ' +
          'participant table has.'
      )
    );
    expect(
      read({ group_by: crp('median'), panel_by: { col: 'AGE', type: 'number', cut: [50] } })
    ).not.toThrow();
  });

  it('GC-CUT-004: the footnote says the points, how many values they were worked out on, and when repeated points collapsed or points written alike merged groups (#43, #46)', () => {
    const median = cutCase('CRP at Baseline, cut at the median');
    expect(cutNote(crp('median'), cutPoints(median.values, 'median'))).toBe(
      'CRP at Baseline is cut at its median, 2.783, worked out on the 200 participants with a value.'
    );
    const ties = cutCase('Ties make the quartiles repeat a point, which collapses');
    expect(
      cutNote(
        { col: 'SCORE', type: 'number', cut: 'quartiles' },
        cutPoints(ties.values, 'quartiles')
      )
    ).toBe(
      'SCORE is cut at its quartiles, 1, 1 and 1.25, worked out on the 8 participants with a ' +
        'value. The points repeat, so they make 3 groups, not 4.'
    );
    const same = cutCase('Every value the same: one point, and an empty upper group');
    expect(
      cutNote({ col: 'SCORE', type: 'number', cut: 'tertiles' }, cutPoints(same.values, 'tertiles'))
    ).toBe(
      'SCORE is cut at its tertiles, 2.5 and 2.5, worked out on the 4 participants with a value. ' +
        'The points repeat, so they make 2 groups, not 3.'
    );
    const alike = cutCase(
      'Distinct quantile points written alike make groups with the same label, which merge'
    );
    expect(
      cutNote(
        { col: 'SCORE', type: 'number', cut: 'quartiles' },
        cutPoints(alike.values, 'quartiles')
      )
    ).toBe(
      'SCORE is cut at its quartiles, 2.793, 2.793 and 2.793, worked out on the 5 participants ' +
        'with a value. The points differ only past four significant digits, so groups with the ' +
        'same bounds are one, as R’s cut() makes them: 3 groups, not 4.'
    );
    expect(cutNote(crp([2, 5]), cutPoints(median.values, [2, 5]))).toBe(
      'CRP at Baseline is cut at 2 and 5.'
    );
    expect(cutNote(crp('median'), cutPoints([null, null], 'median'))).toBe(
      'CRP at Baseline has no value to cut, so it makes no groups.'
    );
  });

  it('GC-CUT-001: the panels’ groups are the cut’s, low to high, each participant in the group R puts them in (#43)', () => {
    const settings = syncSettings({ baseline_visits: 'Baseline' });
    for (const name of [
      'CRP at Baseline, cut at the median',
      'CRP at Baseline, cut at the tertiles',
      'CRP at Baseline, cut at the quartiles',
      'CRP at Baseline, cut at 2 and 5'
    ]) {
      const entry = cutCase(name);
      const model = buildPanels(
        { results, participants },
        settings,
        state({ groupBy: entry.variable })
      );
      expect(model.levels, name).toEqual(
        entry.labels.filter((_, index) => entry.drawn.counts[index])
      );
      expect(
        model.panels[0].cells.map((cell) => cell.n),
        name
      ).toEqual(entry.drawn.counts.filter(Boolean));
      expect(model.cuts.x.points, name).toEqual(entry.points);
      // Each participant drawn is in R's group.
      const groupOf = Object.fromEntries(entry.ids.map((id, index) => [id, entry.groups[index]]));
      for (const record of model.panels[0].records) expect(record.x).toBe(groupOf[record.USUBJID]);
    }
  });

  it('GC-CUT-007: R is asked with the cut variable as written in the identity of the rows, and the groups by their labels (#43)', () => {
    const settings = syncSettings({ baseline_visits: 'Baseline' });
    const groupBy = syncSettings({ group_by: crp('median') }).group_by;
    const model = buildPanels({ results, participants }, settings, state({ groupBy }));
    const request = statisticRequest({
      name: 'Analyze_GroupDifference',
      test: 't',
      pairwise: false,
      settings,
      state: state({ groupBy }),
      panel: model.panels[0]
    });
    expect(request.dataId.group_by).toEqual({
      measure: 'CRP',
      visit: 'Baseline',
      value: 'raw',
      cut: 'median'
    });
    expect(request.dataId.groups).toEqual(['> 2.783', '≤ 2.783']);
    expect(request.args.strGroupCol).toBe('x');
  });

  it('GC-CUT-009: R is handed a cut’s groups low to high, so its result names them in that order, while the identity of the rows keeps them sorted by code point; a column’s groups are left to R (#43, #46)', async () => {
    const settings = syncSettings({ baseline_visits: 'Baseline' });
    for (const [name, cut, order] of [
      ['cut-median', 'median', ['≤ 2.783', '> 2.783']],
      ['cut-too-small', [10], ['≤ 10', '> 10']]
    ]) {
      const recipe = recipeOf(name);
      expect(recipe, `${name} is in the fixture`).toBeTruthy();
      const groupBy = syncSettings({ group_by: crp(cut) }).group_by;
      const model = buildPanels({ results, participants }, settings, state({ groupBy }));
      const [panel] = model.panels;
      // The chart's rows are the ones R made, each in R's group.
      expect(
        panel.records.map((record) => record.USUBJID),
        name
      ).toEqual(recipe.ids);
      expect(
        panel.records.map((record) => record.x),
        name
      ).toEqual(recipe.groups);
      const request = statisticRequest({
        name: 'Analyze_GroupDifference',
        test: 't',
        pairwise: false,
        settings,
        state: state({ groupBy }),
        panel
      });
      expect(request.args.chrGroups, name).toEqual(order);
      expect(request.dataId.groups, name).toEqual([...order].reverse());
      // The key is the one R wrote, so R's stored answer is found.
      expect(canonicalJson(request.args), name).toBe(canonicalJson(recipe.args));
      expect(canonicalJson(request.dataId), name).toBe(canonicalJson(recipe.dataId));
      expect(request.rows, name).toBe(recipe.rows);
      const connection = createConnection({ results: [recipe] });
      expect(await connection.run(request.name, request), name).toEqual({
        status: 'ok',
        value: recipe.value,
        form: 'precomputed'
      });
    }
    // R's estimate is of the lower group minus the higher.
    const difference = recipeOf('cut-median').value.estimates.find(
      (entry) => entry.name === 'Difference in means'
    );
    expect(difference.group).toBe('≤ 2.783 - > 2.783');
    // A column's groups are not named: R sorts them, as it did in v0.1.0.
    const byArm = buildPanels({ results, participants }, settings, state());
    const plain = statisticRequest({
      name: 'Analyze_GroupDifference',
      test: 't',
      pairwise: false,
      settings,
      state: state(),
      panel: byArm.panels[0]
    });
    expect('chrGroups' in plain.args).toBe(false);
  });
});
