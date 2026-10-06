import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { scheduledResults } from '../../../src/core/unscheduled.js';
import { canonicalJson } from '../../../src/r/canonical.js';
import { createConnection } from '../../../src/r/index.js';
import { DEFAULT_SETTINGS, syncSettings } from '../../../src/group-comparison/configure.js';
import { statisticRequest } from '../../../src/group-comparison/statistic.js';
import { buildPanels, listVisits } from '../../../src/group-comparison/structureData.js';
import { buildTiles } from '../../../src/group-comparison/tiles.js';
import { participants, results } from '../core/study.js';

// Unscheduled visits in the group comparison chart (#84): safety.viz's three
// settings, and what leaving such visits out does to what the chart draws and
// to what it asks R. The rule itself is the core's (tests/unit/core/
// unscheduled.test.js); the page is tested in a browser.

const fromR = JSON.parse(
  readFileSync(new URL('../../fixtures/group-statistics-r.json', import.meta.url), 'utf8')
);
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
  yScale: 'linear',
  tileSummary: 'median',
  filters: {},
  ...overrides
});
const refused = (overrides) => {
  try {
    syncSettings(overrides);
  } catch (error) {
    return error.message;
  }
  throw new Error(`not refused: ${JSON.stringify(overrides)}`);
};

// The study with rows of its own at unscheduled visits: an early one, numbered
// before Baseline, holding half of each Baseline result, and one between Week 2
// and Week 4 for the first forty participants.
const ids = [...new Set(results.map((row) => row.USUBJID))].slice(0, 40);
const added = [
  ...results
    .filter((row) => row.VISIT === 'Baseline')
    .map((row) => ({
      ...row,
      VISIT: 'Unscheduled 0',
      VISITNUM: '-1',
      STRESN: String(Number(row.STRESN) / 2)
    })),
  ...results
    .filter((row) => row.VISIT === 'Week 2' && ids.includes(row.USUBJID))
    .map((row) => ({ ...row, VISIT: 'Unscheduled 1', VISITNUM: '3' }))
];
const withUnscheduled = [...results, ...added];

describe('group comparison: unscheduled visits', () => {
  it('GC-UNS-001: the chart has safety.viz’s three settings of unscheduled visits, under its names and with its defaults, and a value none can take is refused by name (#84)', () => {
    expect(DEFAULT_SETTINGS.unscheduled_visits).toBe(false);
    expect(DEFAULT_SETTINGS.unscheduled_visit_pattern).toBe('/unscheduled|early termination/i');
    expect(DEFAULT_SETTINGS.unscheduled_visit_values).toBe(null);
    const read = syncSettings({
      unscheduled_visits: true,
      unscheduled_visit_pattern: 'Retest',
      unscheduled_visit_values: 'Week 12'
    });
    expect(read.unscheduled_visits).toBe(true);
    expect(read.unscheduled_visit_pattern).toBe('Retest');
    // A single name is a list of one, and a list of none stays a list.
    expect(read.unscheduled_visit_values).toEqual(['Week 12']);
    expect(syncSettings({ unscheduled_visit_values: [] }).unscheduled_visit_values).toEqual([]);
    expect(
      syncSettings({ unscheduled_visit_values: ['A', 'B', 'A'] }).unscheduled_visit_values
    ).toEqual(['A', 'B']);
    expect(syncSettings({ unscheduled_visit_pattern: null }).unscheduled_visit_pattern).toBe(null);
    for (const bad of ['yes', 1, null]) {
      expect(refused({ unscheduled_visits: bad })).toBe(
        'bio.viz: `unscheduled_visits` must be true or false.'
      );
    }
    for (const bad of [5, '', '  ', /unscheduled/i, ['unscheduled']]) {
      expect(refused({ unscheduled_visit_pattern: bad })).toBe(
        'bio.viz: `unscheduled_visit_pattern` must be a regular expression written as text, ' +
          '`/source/flags` or a plain source, or null for none.'
      );
    }
    expect(refused({ unscheduled_visit_pattern: '/(/' })).toMatch(
      /^bio\.viz: `unscheduled_visit_pattern` is not a regular expression a browser reads: .+\.$/
    );
    expect(refused({ unscheduled_visit_values: [{}] })).toBe(
      'bio.viz: `unscheduled_visit_values` must be a name, or a list of names.'
    );
  });

  it('GC-UNS-002: with unscheduled visits left out their rows are set aside before anything is framed: they are in no tile and no panel and are not the baseline, R is asked what it is asked of the table without them, and the identity says `unscheduled_visits: true` only when they are drawn and the results have some (#84)', async () => {
    const settings = syncSettings({});
    const found = scheduledResults(withUnscheduled, settings);
    expect(found.visits).toEqual(['Unscheduled 0', 'Unscheduled 1']);
    expect(found.rows).toBe(added.length);
    // What is left is the study, row for row.
    expect(found.results).toEqual(results);
    const scheduled = { results: found.results, participants };
    const everything = { results: withUnscheduled, participants };
    expect(listVisits(scheduled.results, settings).all).toEqual(VISITS);
    expect(listVisits(everything.results, settings).all).toEqual([
      'Unscheduled 0',
      'Baseline',
      'Week 2',
      'Unscheduled 1',
      'Week 4',
      'Week 8',
      'Week 12'
    ]);

    // The tiles and one biomarker's panels, of the scheduled rows: what the
    // study itself gives, whatever was added.
    const tiles = (tables, visits) =>
      buildTiles(tables, settings, state({ measure: null, visits, valueType: 'change' }), ['IL-6']);
    expect(JSON.stringify(tiles(scheduled, VISITS))).toBe(
      JSON.stringify(tiles({ results, participants }, VISITS))
    );
    expect(tiles(scheduled, VISITS).baselineVisits).toEqual(['Baseline']);
    // Drawn, the first visit of all is the baseline of a change, and it differs.
    const all = listVisits(everything.results, settings).all;
    expect(tiles(everything, all).baselineVisits).toEqual(['Unscheduled 0']);
    expect(tiles(everything, all).tiles[0].visits).toEqual(all);

    const week4 = state({ visits: ['Week 4'], valueType: 'change' });
    const left = buildPanels(scheduled, settings, week4);
    const plain = buildPanels({ results, participants }, settings, week4);
    expect(left.panels[0].records).toEqual(plain.panels[0].records);
    const drawn = buildPanels(everything, settings, week4);
    expect(drawn.baselineVisits).toEqual(['Unscheduled 0']);
    expect(drawn.panels[0].records.map((record) => record.y)).not.toEqual(
      plain.panels[0].records.map((record) => record.y)
    );

    // What R is asked. Left out, or with none in the results: as released.
    const request = (panel, unscheduled) =>
      statisticRequest({
        name: 'Analyze_GroupDifference',
        test: 't',
        pairwise: false,
        settings,
        state: week4,
        panel,
        ...(unscheduled === undefined ? {} : { unscheduled })
      });
    const asked = request(left.panels[0]);
    expect(asked).toEqual(request(plain.panels[0]));
    expect(asked).toEqual(request(left.panels[0], false));
    expect(asked.dataId).toEqual({
      chart: 'group-comparison',
      measure: 'IL-6',
      value_type: 'change',
      visit: 'Week 4',
      baseline_stat: 'mean',
      group_by: 'ARM',
      groups: ['Placebo', 'Treatment']
    });
    // Drawn: one member more, and nothing else of the key moves.
    const withThem = request(drawn.panels[0], true);
    expect(withThem.dataId).toEqual({ ...asked.dataId, unscheduled_visits: true });
    expect(withThem.args).toEqual(asked.args);
    // So an answer stored for the scheduled rows is never printed for the others.
    const stored = { ...asked, value: { p_value: 0.5 } };
    delete stored.data;
    const connection = createConnection({ results: [stored] });
    expect((await connection.run(asked.name, asked)).status).toBe('ok');
    expect((await connection.run(withThem.name, withThem)).status).toBe('unavailable');

    // The key desktop R writes by the recipe for a view with them drawn is the
    // chart's: the demo's rows of IL-6's change to Week 4, by arm.
    const recipe = fromR.recipes.find((entry) => entry.case === 'unscheduled-visits');
    expect(recipe, 'the recipe case is in the fixture').toBeTruthy();
    expect(recipe.dataId.unscheduled_visits).toBe(true);
    const named = syncSettings({ baseline_visits: 'Baseline' });
    const demo = buildPanels({ results, participants }, named, week4).panels[0];
    const ours = statisticRequest({
      name: 'Analyze_GroupDifference',
      test: 't',
      pairwise: false,
      settings: named,
      state: week4,
      panel: demo,
      unscheduled: true
    });
    expect(canonicalJson(recipe.dataId)).toBe(canonicalJson(ours.dataId));
    expect(recipe.args).toEqual(ours.args);
    expect(recipe.rows).toBe(ours.rows);
    // And it is the released key of the same rows, with the one member more.
    const welch = fromR.results.find((entry) => entry.case === 'welch');
    expect(recipe.dataId).toEqual({ ...welch.dataId, unscheduled_visits: true });
  });
});
