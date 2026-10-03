import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, syncSettings } from '../../../src/group-comparison/configure.js';
import {
  buildOverview,
  buildPanels,
  columnLevels,
  listMeasures,
  listVisits,
  overviewCount,
  overviewPage,
  visitsDrawn
} from '../../../src/group-comparison/structureData.js';
import { participants, results } from '../core/study.js';

// The overview (#17): every biomarker at every visit, a row per biomarker and a
// panel per visit, worked out from the vendored synthetic study. Everything
// here is what the chart draws from; the page itself is tested in a browser.

const settings = syncSettings({ baseline_visits: 'Baseline' });
const tables = { results, participants };
const VISITS = ['Baseline', 'Week 2', 'Week 4', 'Week 8', 'Week 12'];
// What the controls are set to as the chart opens: no biomarker, every visit.
const state = (overrides = {}) => ({
  measure: null,
  page: 0,
  visits: VISITS,
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
const measures = listMeasures(results, settings);
const overview = (overrides = {}, list = measures, config = settings) =>
  buildOverview(tables, config, state(overrides), list);

const refused = (overrides) => {
  try {
    syncSettings(overrides);
  } catch (error) {
    return error.message;
  }
  throw new Error(`not refused: ${JSON.stringify(overrides)}`);
};

describe('group comparison: what the chart opens on', () => {
  it('GC-OVW-001: with no visit named the chart opens on every visit, in visit order, and with no biomarker named on none of them alone (#17)', () => {
    // The changed defaults: neither setting names anything.
    expect(DEFAULT_SETTINGS.start_value).toBe(null);
    expect(DEFAULT_SETTINGS.visits).toBe(null);
    expect(listVisits(results, settings)).toEqual({ all: VISITS, start: VISITS });
    expect(listVisits(results, syncSettings({})).start).toEqual(VISITS);
    // It used to be the first visit after the baseline. Whatever the baseline
    // visits are, no visit named is every visit.
    expect(
      listVisits(results, syncSettings({ baseline_visits: ['Baseline', 'Week 2'] })).start
    ).toEqual(VISITS);
    // Visits that are named are the ones it opens on, as before.
    expect(listVisits(results, syncSettings({ visits: 'Week 4' })).start).toEqual(['Week 4']);
    expect(
      listVisits(results, syncSettings({ visits: ['Week 12', 'Week 4', 'Week 99'] })).start
    ).toEqual(['Week 12', 'Week 4']);
    // Named visits the table has none of: every visit, not nothing.
    expect(listVisits(results, syncSettings({ visits: ['Week 99'] })).start).toEqual(VISITS);
  });

  it('GC-OVW-002: the most biomarkers the overview draws at a time is a setting, twelve by default, and a value it cannot take is refused (#17)', () => {
    expect(DEFAULT_SETTINGS.overview_limit).toBe(12);
    expect(syncSettings({ overview_limit: 5 }).overview_limit).toBe(5);
    for (const bad of [0, -1, 2.5, '12', null]) {
      expect(refused({ overview_limit: bad })).toBe(
        'bio.viz: `overview_limit` must be a whole number, one or more.'
      );
    }
  });
});

describe('group comparison: the overview', () => {
  it('GC-OVW-003: the overview has one row per biomarker, in the Biomarker control’s order, and in each row one panel per visit, in visit order (#17)', () => {
    const rows = overview();
    expect(rows.map((row) => row.measure)).toEqual(measures);
    expect(measures).toHaveLength(12);
    expect(measures.slice(0, 3)).toEqual(['CRP', 'D-dimer', 'Ferritin']);
    for (const row of rows) {
      expect(
        row.model.panels.map((panel) => panel.visit),
        row.measure
      ).toEqual(VISITS);
      expect(row.model.panels.map((panel) => panel.title)).toEqual(VISITS);
    }
    // The order is the control's: the setting `measures`, when it gives one.
    const ordered = syncSettings({
      baseline_visits: 'Baseline',
      measures: ['VEGF', 'IL-6', 'CRP']
    });
    const listed = listMeasures(results, ordered);
    expect(listed).toEqual(['VEGF', 'IL-6', 'CRP']);
    expect(overview({}, listed, ordered).map((row) => row.measure)).toEqual([
      'VEGF',
      'IL-6',
      'CRP'
    ]);
    // The visits chosen are the panels of every row.
    const two = overview({ visits: ['Week 4', 'Week 12'] });
    for (const row of two) {
      expect(row.model.panels.map((panel) => panel.visit)).toEqual(['Week 4', 'Week 12']);
    }
    // A row is named for its biomarker and the unit its values are in.
    expect(rows.find((row) => row.measure === 'IL-6').title).toBe('IL-6 (pg/mL)');
    expect(overview({ valueType: 'change' }).find((row) => row.measure === 'IL-6').title).toBe(
      'IL-6, change from baseline (pg/mL)'
    );
  });

  it('GC-OVW-004: every panel of the overview is what that biomarker’s own view draws at that visit: one record per participant, and nothing pooled across visits or biomarkers (#17)', () => {
    const rows = overview();
    for (const row of rows) {
      // The single-biomarker view of the same biomarker, with the same controls.
      const alone = buildPanels(tables, settings, state({ measure: row.measure }));
      expect(
        row.model.panels.map((panel) => panel.records),
        row.measure
      ).toEqual(alone.panels.map((panel) => panel.records));
      expect(row.model.panels.map((panel) => panel.ticks)).toEqual(
        alone.panels.map((panel) => panel.ticks)
      );
      for (const panel of row.model.panels) {
        // One record per participant, each at its own visit.
        const ids = panel.records.map((record) => record.USUBJID);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBeLessThanOrEqual(200);
        expect(Object.keys(panel.records[0])).toEqual(['USUBJID', 'y', 'x']);
        // The number in each group is the number of its participants drawn.
        const perGroup = panel.cells.map((cell) => cell.n);
        expect(perGroup.reduce((total, n) => total + n, 0)).toBe(ids.length);
        expect(panel.ticks.map((tick) => tick[1])).toEqual(perGroup.map((n) => `n = ${n}`));
      }
    }
    // IL-6 at Baseline: all 200 participants, 100 in each arm.
    const il6 = rows.find((row) => row.measure === 'IL-6').model;
    expect(il6.panels[0].ticks).toEqual([
      ['Placebo', 'n = 100'],
      ['Treatment', 'n = 100']
    ]);
    expect(il6.panels.map((panel) => panel.records.length)).toEqual([200, 185, 186, 188, 184]);
    // A value drawn in one biomarker's row is a result of that biomarker.
    const byId = new Map(
      results
        .filter((result) => result.TEST === 'IL-6' && result.VISIT === 'Week 4')
        .map((result) => [result.USUBJID, Number(result.STRESN)])
    );
    for (const record of il6.panels[2].records) expect(record.y).toBe(byId.get(record.USUBJID));
  });

  it('GC-OVW-005: each biomarker has its own value axis, shared across its visits (#17)', () => {
    const rows = overview();
    const extents = rows.map((row) => row.model.extent);
    for (const [index, row] of rows.entries()) {
      const values = row.model.panels.flatMap((panel) => panel.records.map((record) => record.y));
      expect(extents[index]).toEqual([Math.min(...values), Math.max(...values)]);
    }
    // Biomarkers are on different scales, so their axes differ.
    expect(new Set(extents.map((extent) => extent.join())).size).toBe(rows.length);
    const [ldh, crp] = ['LDH', 'CRP'].map((name) => rows.find((row) => row.measure === name));
    expect(ldh.model.extent[1]).toBeGreaterThan(10 * crp.model.extent[1]);
  });

  it('GC-OVW-006: the group, the levels, the colour, the scale and the filters apply to every row; panels by a further variable do not, because the panels are the visits (#17)', () => {
    const bySex = overview({ groupBy: 'SEX' });
    for (const row of bySex) expect(row.model.shownLevels).toEqual(['F', 'M']);

    const oneLevel = overview({ levels: ['Treatment'] });
    for (const row of oneLevel) {
      expect(row.model.shownLevels).toEqual(['Treatment']);
      expect(
        row.model.panels.every((panel) => panel.records.every((r) => r.x === 'Treatment'))
      ).toBe(true);
    }

    const coloured = overview({ colorBy: 'SEX' });
    for (const row of coloured) {
      expect(row.model.colors).toEqual(['F', 'M']);
      expect(row.model.panels[0].cells.map((cell) => [cell.level, cell.color])).toEqual([
        ['Placebo', 'F'],
        ['Placebo', 'M'],
        ['Treatment', 'F'],
        ['Treatment', 'M']
      ]);
    }

    const women = overview({ filters: { SEX: 'F' } });
    for (const row of women) {
      expect(row.model.filtered).toBe(91);
      expect(row.model.panels[0].records).toHaveLength(91);
    }

    // On a logarithmic scale a value of zero or less is left out, row by row.
    const logged = overview({ yScale: 'log', valueType: 'change' });
    for (const row of logged) {
      expect(row.model.panels.every((panel) => panel.records.every((r) => r.y > 0))).toBe(true);
    }

    // Panel by: not applied. The same rows with it set as without.
    const panelled = overview({ panelBy: 'SEX' });
    const plain = overview();
    expect(panelled.map((row) => row.model.panels.map((panel) => panel.key))).toEqual(
      plain.map((row) => row.model.panels.map((panel) => panel.key))
    );
    expect(panelled[0].model.panelLevels).toEqual([null]);
    // The same variable does make panels once a biomarker is alone.
    expect(
      buildPanels(tables, settings, state({ measure: 'IL-6', panelBy: 'SEX' })).panels
    ).toHaveLength(10);
  });

  it('GC-OVW-007: a baseline value has no visit, so each biomarker has one panel; and for a change from baseline the one baseline visit is not drawn, where the change is the same for everyone (#17)', () => {
    const baseline = overview({ valueType: 'baseline' });
    for (const row of baseline) {
      expect(row.model.panels).toHaveLength(1);
      expect(row.model.panels[0].visit).toBe(null);
      expect(row.model.panels[0].records).toHaveLength(200);
    }
    expect(baseline.find((row) => row.measure === 'IL-6').title).toBe('IL-6 at baseline (pg/mL)');

    // A change from the one baseline visit, at that visit, is nought for
    // everyone: there is nothing in it to draw or to compare.
    expect(visitsDrawn(VISITS, 'change', ['Baseline'])).toEqual(VISITS.slice(1));
    expect(visitsDrawn(VISITS, 'fold_change', ['Baseline'])).toEqual(VISITS.slice(1));
    expect(visitsDrawn(VISITS, 'percent_change', ['Baseline'])).toEqual(VISITS.slice(1));
    // The result itself is drawn at every visit, the baseline visit among them.
    expect(visitsDrawn(VISITS, 'raw', ['Baseline'])).toEqual(VISITS);
    // With several baseline visits a value at one of them is measured against
    // the baseline over all of them, and differs between participants.
    expect(visitsDrawn(VISITS, 'change', ['Baseline', 'Week 2'])).toEqual(VISITS);
    expect(visitsDrawn(['Week 4'], 'change', ['Baseline'])).toEqual(['Week 4']);

    const change = overview({ valueType: 'change' });
    for (const row of change) {
      expect(row.model.panels.map((panel) => panel.visit)).toEqual(VISITS.slice(1));
      expect(row.model.visitsNotDrawn).toEqual(['Baseline']);
      expect(row.model.baselineVisits).toEqual(['Baseline']);
    }
    expect(overview()[0].model.visitsNotDrawn).toEqual([]);
    // With no baseline visit named it is the first visit, and the same holds.
    const unnamed = buildPanels(
      tables,
      syncSettings({}),
      state({ measure: 'IL-6', valueType: 'change' })
    );
    expect(unnamed.panels.map((panel) => panel.visit)).toEqual(VISITS.slice(1));
    // Were it drawn, every value in it would be the same.
    const several = syncSettings({ baseline_visits: ['Baseline', 'Week 2'] });
    const kept = buildPanels(tables, several, state({ measure: 'IL-6', valueType: 'change' }));
    expect(kept.panels.map((panel) => panel.visit)).toEqual(VISITS);
    expect(new Set(kept.panels[0].records.map((record) => record.y)).size).toBeGreaterThan(1);
    // The baseline visit alone, of a change: no panel at all.
    const only = buildPanels(
      tables,
      settings,
      state({ measure: 'IL-6', valueType: 'change', visits: ['Baseline'] })
    );
    expect(only.panels).toEqual([]);
    expect(only.visitsNotDrawn).toEqual(['Baseline']);
    expect(only.baselineVisits).toEqual(['Baseline']);
  });

  it('GC-OVW-008: a page of the overview holds at most the limit, in the control’s order, and says how many it shows of how many (#17)', () => {
    const many = Array.from({ length: 30 }, (unused, index) => `Biomarker ${index + 1}`);
    expect(overviewPage(many, 12)).toEqual({
      measures: many.slice(0, 12),
      page: 0,
      pages: 3,
      from: 1,
      to: 12,
      total: 30
    });
    expect(overviewPage(many, 12, 1).measures).toEqual(many.slice(12, 24));
    expect(overviewPage(many, 12, 2)).toMatchObject({ measures: many.slice(24), from: 25, to: 30 });
    // Every biomarker is on exactly one page.
    expect([0, 1, 2].flatMap((page) => overviewPage(many, 12, page).measures)).toEqual(many);
    // A page that does not exist is the nearest that does.
    expect(overviewPage(many, 12, 9).page).toBe(2);
    expect(overviewPage(many, 12, -4).page).toBe(0);
    expect(overviewPage(many, 12, 'two').page).toBe(0);
    // The twelve of the synthetic study are one page at the default limit.
    expect(overviewPage(measures, DEFAULT_SETTINGS.overview_limit)).toMatchObject({
      measures,
      pages: 1,
      from: 1,
      to: 12,
      total: 12
    });
    expect(overviewPage([], 12)).toEqual({
      measures: [],
      page: 0,
      pages: 1,
      from: 0,
      to: 0,
      total: 0
    });

    expect(overviewCount(overviewPage(measures, 12))).toBe('All 12 biomarkers are shown.');
    expect(overviewCount(overviewPage(many, 12))).toBe(
      '12 of 30 biomarkers shown: 1 to 12, in the Biomarker control’s order.'
    );
    expect(overviewCount(overviewPage(many, 12, 2))).toBe(
      '6 of 30 biomarkers shown: 25 to 30, in the Biomarker control’s order.'
    );
    expect(overviewCount(overviewPage(many.slice(0, 13), 12, 1))).toBe(
      '1 of 13 biomarkers shown: the 13th, in the Biomarker control’s order.'
    );
    expect(overviewCount(overviewPage(['IL-6'], 12))).toBe('The one biomarker is shown.');
    expect(overviewCount(overviewPage([], 12))).toBe('No biomarker to show.');
    // Only the page's biomarkers are worked out.
    expect(overview({}, overviewPage(measures, 5, 1).measures).map((row) => row.measure)).toEqual(
      measures.slice(5, 10)
    );
  });

  it('GC-OVW-009: the levels the overview offers are the group column’s own, from the table that holds it (#17)', () => {
    expect(columnLevels(tables, 'ARM')).toEqual(['Placebo', 'Treatment']);
    expect(columnLevels(tables, 'RESPONSE')).toEqual(['Non-responder', 'Responder']);
    // A column the participant table does not have is read from the results rows.
    const carried = results
      .slice(0, 50)
      .map((row, index) => ({ ...row, SITE: index % 2 ? 'B' : 'A' }));
    expect(columnLevels({ results: carried, participants }, 'SITE')).toEqual(['A', 'B']);
    expect(columnLevels({ results: carried, participants: null }, 'SITE')).toEqual(['A', 'B']);
  });
});
