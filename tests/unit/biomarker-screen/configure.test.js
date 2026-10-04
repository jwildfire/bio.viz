import { describe, it, expect } from 'vitest';
import {
  ADJUSTMENTS,
  COMPARISONS,
  DEFAULT_SETTINGS,
  METHODS,
  SORTS,
  syncSettings
} from '../../../src/biomarker-screen/configure.js';
import { DEFAULT_SETTINGS as SCATTER } from '../../../src/association-scatter/configure.js';
import { DEFAULT_SETTINGS as SURVIVAL } from '../../../src/stratified-survival/configure.js';
import { DEFAULT_SETTINGS as COMPARISON } from '../../../src/group-comparison/configure.js';
import { DEFAULT_SETTINGS as CORE_DEFAULTS } from '../../../src/core/index.js';
import { coreSettings } from '../../../src/shared/settings.js';
import { createConnection } from '../../../src/r/index.js';

// The biomarker screen's settings (#36).

const refused = (overrides) => {
  try {
    syncSettings(overrides);
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    return error.message;
  }
  throw new Error(`not refused: ${JSON.stringify(overrides)}`);
};

describe('biomarker screen: settings', () => {
  it('BS-CFG-001: every setting has a default; the column and baseline defaults are the core’s; the chart opens on every biomarker at the first visit, a difference between two groups, Benjamini-Hochberg, sorted by estimate, twenty to a page (#36)', () => {
    expect(syncSettings()).toEqual(DEFAULT_SETTINGS);
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
      comparison: 'difference',
      visit: null,
      value_type: 'raw',
      group_by: null,
      levels: null,
      with: null,
      method: 'pearson',
      adjustment: 'BH',
      sort: 'estimate',
      limit: 20,
      measures: null,
      statistic: 'Analyze_Screen',
      connection: null,
      group_comparison: null,
      association_scatter: null,
      stratified_survival: null,
      // The hazard rows read the outcomes table as the survival chart does.
      endpoint_col: 'PARAMCD',
      time_col: 'AVAL',
      censor_col: 'CNSR',
      event_col: null,
      endpoint: null
    });
    expect(COMPARISONS).toEqual(['difference', 'correlation', 'hazard']);
    expect(METHODS).toEqual(['pearson', 'spearman']);
    expect(ADJUSTMENTS).toEqual(['BH', 'holm']);
    expect(SORTS).toEqual(['estimate', 'name', 'adjusted']);
    // A setting this chart and a chart it opens both have is named the same,
    // with the same default: what it hands that chart is that chart's own.
    for (const other of [COMPARISON, SCATTER, SURVIVAL]) {
      const both = Object.keys(DEFAULT_SETTINGS).filter((key) => key in other);
      expect(both).toEqual(
        expect.arrayContaining(['id_col', 'unit_col', 'baseline_visits', 'measures', 'filters'])
      );
      for (const key of both.filter((name) => !['statistic', 'method'].includes(name))) {
        expect(DEFAULT_SETTINGS[key], key).toEqual(other[key]);
      }
    }
  });

  it('BS-CFG-002: a caller’s settings are laid over the defaults, and a setting that is not known, or a value a setting cannot take, is refused with a message naming it; two groups, and a variable as the core takes one (#36)', () => {
    const connection = createConnection();
    const settings = syncSettings({
      comparison: 'correlation',
      visit: 'Baseline',
      with: { measure: 'IL-10', visit: 'Baseline' },
      method: 'spearman',
      adjustment: 'holm',
      sort: 'adjusted',
      limit: 5,
      levels: ['Treatment', 'Placebo'],
      group_by: 'ARM',
      measures: 'IL-6',
      numbers: ['AGE'],
      filters: 'SEX',
      group_comparison: { mark: 'violin' },
      connection
    });
    expect(settings).toMatchObject({
      comparison: 'correlation',
      with: { measure: 'IL-10', value: 'raw', visit: 'Baseline' },
      method: 'spearman',
      adjustment: 'holm',
      sort: 'adjusted',
      limit: 5,
      levels: ['Treatment', 'Placebo'],
      measures: ['IL-6'],
      numbers: [{ value_col: 'AGE', label: 'AGE' }],
      filters: [{ value_col: 'SEX', label: 'SEX' }],
      group_comparison: { mark: 'violin' }
    });
    expect(syncSettings({ with: { col: 'AGE' } }).with).toEqual({ col: 'AGE' });
    expect(settings.connection).toBe(connection);
    expect(syncSettings(settings)).toEqual(settings);
    for (const [overrides, said] of [
      [{ forest: true }, /`forest` is not a setting of the biomarker screen/],
      [{ comparison: 'odds' }, /`comparison` must be one of difference, correlation, hazard\./],
      [{ event_col: 'EVENT', censor_col: 'CNSR' }, /Name exactly one of `censor_col`/],
      [{ endpoint: 3 }, /`endpoint` must be the name of an endpoint, or null/],
      [{ stratified_survival: 'curves' }, /`stratified_survival` must be an object of settings/],
      [{ method: 'kendall' }, /`method` must be one of pearson, spearman\./],
      [{ adjustment: 'bonferroni' }, /`adjustment` must be one of BH, holm\./],
      [{ sort: 'p' }, /`sort` must be one of estimate, name, adjusted\./],
      [{ limit: 0 }, /`limit` must be a whole number, one or more\./],
      [{ value_type: 'delta' }, /`value_type` must be one of /],
      [
        { levels: ['Placebo'] },
        /`levels` must name two groups, the first and the second, or be null\./
      ],
      [{ levels: ['A', 'B', 'C'] }, /`levels` must name two groups/],
      [{ with: 'IL-10' }, /`with` must be a variable/],
      [{ with: { measure: 'IL-10' } }, /must name its visit/],
      [{ visit: 4 }, /`visit` must be the name of a visit, or null\./],
      [{ group_by: '' }, /`group_by`/],
      [{ statistic: 7 }, /`statistic` must be the name of an R function, or null/],
      [{ group_comparison: 'violin' }, /`group_comparison` must be an object of settings/],
      [{ association_scatter: [] }, /`association_scatter` must be an object of settings/]
    ]) {
      const message = refused(overrides);
      expect(message, JSON.stringify(overrides)).toMatch(/^bio\.viz: /);
      expect(message, JSON.stringify(overrides)).toMatch(said);
    }
  });
});
