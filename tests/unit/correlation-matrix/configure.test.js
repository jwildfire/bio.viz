import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS as SCATTER } from '../../../src/association-scatter/configure.js';
import {
  DEFAULT_SETTINGS,
  METHODS,
  MODES,
  SCATTER_LIMIT,
  VIEWS,
  syncSettings
} from '../../../src/correlation-matrix/configure.js';
import { DEFAULT_SETTINGS as CORE_DEFAULTS } from '../../../src/core/index.js';
import { coreSettings } from '../../../src/shared/settings.js';
import { createConnection } from '../../../src/r/index.js';

// The correlation matrix's settings (#27).

const refused = (overrides) => {
  try {
    syncSettings(overrides);
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    return error.message;
  }
  throw new Error(`not refused: ${JSON.stringify(overrides)}`);
};

describe('correlation matrix: settings', () => {
  it('CM-CFG-001: every setting has a default; the column and baseline defaults are the core’s; the chart opens on every biomarker at the first visit, twelve at a time, with Pearson and R’s own minimum (#27)', () => {
    expect(syncSettings()).toEqual(DEFAULT_SETTINGS);
    expect(syncSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    for (const key of Object.keys(CORE_DEFAULTS).filter((name) => name !== 'required')) {
      expect(DEFAULT_SETTINGS[key], key).toEqual(CORE_DEFAULTS[key]);
    }
    expect(coreSettings(syncSettings({ baseline_visits: 'Baseline' }))).toEqual({
      ...CORE_DEFAULTS,
      baseline_visits: ['Baseline'],
      required: undefined
    });
    expect(DEFAULT_SETTINGS).toMatchObject({
      // Nothing named: every biomarker the limit allows, at the first visit.
      mode: 'biomarkers',
      visit: null,
      biomarkers: null,
      measure: null,
      visits: null,
      value_type: 'raw',
      view: 'grid',
      limit: 12,
      connection: null,
      statistic: 'Analyze_CorrelationMatrix',
      method: 'pearson',
      // The minimum is R's: none is set here.
      min_pairs: null,
      scatter: null
    });
    expect(MODES).toEqual(['biomarkers', 'visits']);
    expect(VIEWS).toEqual(['grid', 'scatters']);
    expect(METHODS).toEqual(['pearson', 'spearman']);
    expect(SCATTER_LIMIT).toBe(6);
    // A setting this chart and the association scatter both have is named the
    // same in both, with the same default: what the grid hands the scatter it
    // opens is the scatter's own settings.
    const both = Object.keys(DEFAULT_SETTINGS).filter((key) => key in SCATTER);
    expect(both).toEqual(
      expect.arrayContaining([
        'id_col',
        'measure_col',
        'value_col',
        'visit_col',
        'visit_order_col',
        'unit_col',
        'participant_id_col',
        'baseline_visits',
        'baseline_stat',
        'measures',
        'max_levels',
        'filters',
        'connection',
        'method',
        'waiting_note'
      ])
    );
    for (const key of both.filter((name) => name !== 'statistic')) {
      expect(DEFAULT_SETTINGS[key], key).toEqual(SCATTER[key]);
    }
  });

  it('CM-CFG-002: a caller’s settings are laid over the defaults, a list given as one name is a list of one, and a setting that is not known, or a value a setting cannot take, is refused with a message naming it (#27)', () => {
    const connection = createConnection();
    const settings = syncSettings({
      mode: 'visits',
      measure: 'IL-6',
      visits: 'Week 4',
      biomarkers: ['IL-6', 'CRP'],
      value_type: 'change',
      view: 'scatters',
      limit: 24,
      method: 'spearman',
      min_pairs: 20,
      baseline_visits: 'Baseline',
      filters: ['SEX', { value_col: 'AGE', label: 'Age' }],
      scatter: { color_by: 'ARM' },
      connection
    });
    expect(settings).toMatchObject({
      mode: 'visits',
      measure: 'IL-6',
      visits: ['Week 4'],
      biomarkers: ['IL-6', 'CRP'],
      value_type: 'change',
      view: 'scatters',
      limit: 24,
      method: 'spearman',
      min_pairs: 20,
      baseline_visits: ['Baseline'],
      scatter: { color_by: 'ARM' }
    });
    expect(settings.filters).toEqual([
      { value_col: 'SEX', label: 'SEX' },
      { value_col: 'AGE', label: 'Age' }
    ]);
    expect(settings.connection).toBe(connection);
    // What the chart reads can be given back to it.
    expect(syncSettings(settings)).toEqual(settings);

    for (const [overrides, said] of [
      [{ cluster: true }, /`cluster` is not a setting of the correlation matrix/],
      [{ p_values: true }, /`p_values` is not a setting of the correlation matrix/],
      [{ mode: 'pairs' }, /`mode` must be one of biomarkers, visits\./],
      [{ view: 'heatmap' }, /`view` must be one of grid, scatters\./],
      [
        { value_type: 'delta' },
        /`value_type` must be one of raw, baseline, change, fold_change, percent_change\./
      ],
      [{ method: 'kendall' }, /`method` must be one of pearson, spearman\./],
      [{ limit: 1 }, /`limit` must be a whole number, two or more\./],
      [{ limit: 12.5 }, /`limit` must be a whole number, two or more\./],
      [{ limit: '12' }, /`limit` must be a whole number, two or more\./],
      [{ max_levels: 0 }, /`max_levels` must be a whole number, one or more\./],
      [{ min_pairs: 0 }, /`min_pairs` must be a number above zero, or null for R’s own minimum\./],
      [{ min_pairs: '5' }, /`min_pairs` must be a number above zero/],
      [{ min_pairs: Number.NaN }, /`min_pairs` must be a number above zero/],
      [{ statistic: 7 }, /`statistic` must be the name of an R function, or null/],
      [{ scatter: 'ARM' }, /`scatter` must be an object of settings for the association scatter/],
      [{ visit: 4 }, /`visit` must be the name of a visit, or null\./],
      [{ measure: ['IL-6'] }, /`measure` must be the name of a biomarker, or null\./],
      [{ biomarkers: [{}] }, /`biomarkers` must be a name, or a list of names\./],
      // An empty list is a selection of none (#71 review): a list of things that
      // are not names is not.
      [{ visits: [{}] }, /`visits` must be a name, or a list of names\./],
      [{ baseline_stat: 'median' }, /`baseline_stat`/],
      [{ id_col: '' }, /`id_col`/]
    ]) {
      const message = refused(overrides);
      expect(message, JSON.stringify(overrides)).toMatch(/^bio\.viz: /);
      expect(message, JSON.stringify(overrides)).toMatch(said);
    }
    // No coefficients at all is a setting: the function's name is null.
    expect(syncSettings({ statistic: null }).statistic).toBe(null);
  });
});
