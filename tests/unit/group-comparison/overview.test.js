import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, syncSettings } from '../../../src/group-comparison/configure.js';
import {
  buildPanels,
  listVisits,
  visitsDrawn
} from '../../../src/group-comparison/structureData.js';
import { participants, results } from '../core/study.js';

// What the chart opens on (#17): no biomarker and every visit, unless the
// settings name some; and which visits one biomarker's view draws. The view of
// every biomarker itself, the trend tiles (#84), is in tiles.test.js.

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

  it('GC-OVW-002: `overview_limit` and `page`, the settings of the overview v0.2.0 paged, are still settings, checked as they were, so what was written for it is not refused (#17, #84)', () => {
    expect(DEFAULT_SETTINGS.overview_limit).toBe(12);
    expect(DEFAULT_SETTINGS.page).toBe(0);
    expect(syncSettings({ overview_limit: 5, page: 3 })).toMatchObject({
      overview_limit: 5,
      page: 3
    });
    for (const bad of [0, -1, 2.5, '12', null]) {
      expect(refused({ overview_limit: bad })).toBe(
        'bio.viz: `overview_limit` must be a whole number, one or more.'
      );
    }
    for (const bad of [-1, 1.5, '0', null]) {
      expect(refused({ page: bad })).toBe('bio.viz: `page` must be a whole number, from 0.');
    }
  });
});

describe('group comparison: the visits one biomarker’s view draws', () => {
  it('GC-OVW-007: a baseline value has no visit, so one biomarker has one panel; and for a change from baseline the one baseline visit is not a panel, where the change is the same for everyone (#17)', () => {
    const baseline = buildPanels(
      tables,
      settings,
      state({ measure: 'IL-6', valueType: 'baseline' })
    );
    expect(baseline.panels).toHaveLength(1);
    expect(baseline.panels[0].visit).toBe(null);
    expect(baseline.panels[0].records).toHaveLength(200);

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

    const change = buildPanels(tables, settings, state({ measure: 'IL-6', valueType: 'change' }));
    expect(change.panels.map((panel) => panel.visit)).toEqual(VISITS.slice(1));
    expect(change.visitsNotDrawn).toEqual(['Baseline']);
    expect(change.baselineVisits).toEqual(['Baseline']);
    expect(buildPanels(tables, settings, state({ measure: 'IL-6' })).visitsNotDrawn).toEqual([]);
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
});
