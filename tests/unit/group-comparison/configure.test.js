import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MARKS,
  Y_SCALES,
  coreSettings,
  syncSettings
} from '../../../src/group-comparison/configure.js';
import { DEFAULT_SETTINGS as CORE_DEFAULTS } from '../../../src/core/index.js';
import { createConnection } from '../../../src/r/index.js';

// The chart's settings (#9).

const refused = (overrides) => {
  try {
    syncSettings(overrides);
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    return error.message;
  }
  throw new Error(`not refused: ${JSON.stringify(overrides)}`);
};

describe('group comparison: settings', () => {
  it('GC-CFG-001: every setting has a default, and the column and baseline defaults are the core’s (#9)', () => {
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
    expect(DEFAULT_SETTINGS.mark).toBe('box');
    expect(DEFAULT_SETTINGS.y_scale).toBe('linear');
    expect(DEFAULT_SETTINGS.value_type).toBe('raw');
    expect(DEFAULT_SETTINGS.statistic).toBe('Analyze_GroupDifference');
    expect(DEFAULT_SETTINGS.connection).toBe(null);
    expect(MARKS).toEqual(['box', 'violin', 'points']);
    expect(Y_SCALES).toEqual(['linear', 'log']);
  });

  it('GC-CFG-002: a caller’s settings are laid over the defaults, and names and lists are read the same way however they are written (#9)', () => {
    const connection = createConnection();
    const settings = syncSettings({
      start_value: 'IL-6',
      visits: 'Week 4',
      value_type: 'change',
      baseline_visits: ['Baseline'],
      group_by: 'ARM',
      levels: ['Placebo', 'Treatment'],
      groups: ['ARM', { value_col: 'SEX', label: 'Sex' }],
      filters: 'SEX',
      details: [{ value_col: 'AGE' }],
      mark: 'violin',
      y_scale: 'log',
      connection,
      profile: false
    });
    expect(settings.visits).toEqual(['Week 4']);
    expect(settings.baseline_visits).toEqual(['Baseline']);
    expect(settings.groups).toEqual([
      { value_col: 'ARM', label: 'ARM' },
      { value_col: 'SEX', label: 'Sex' }
    ]);
    expect(settings.filters).toEqual([{ value_col: 'SEX', label: 'SEX' }]);
    expect(settings.details).toEqual([{ value_col: 'AGE', label: 'AGE' }]);
    expect(settings.connection).toBe(connection);
    expect(settings.mark).toBe('violin');
    expect(settings.id_col).toBe('USUBJID');
    // An undefined value leaves the default in place.
    expect(syncSettings({ mark: undefined }).mark).toBe('box');
  });

  it('GC-CFG-003: a setting that is not known, or a value a setting cannot take, is refused with a message naming it (#9)', () => {
    expect(refused({ group: 'ARM' })).toMatch(
      /^bio\.viz: `group` is not a setting of the group comparison chart\. Its settings are id_col, /
    );
    expect(refused('ARM')).toMatch(/takes its settings as an object/);
    expect(refused({ mark: 'bar' })).toMatch(/`mark` must be one of box, violin, points/);
    expect(refused({ y_scale: 'sqrt' })).toMatch(/`y_scale` must be one of linear, log/);
    expect(refused({ value_type: 'delta' })).toMatch(/`value_type` must be one of raw, baseline/);
    expect(refused({ baseline_stat: 'median' })).toMatch(/`baseline_stat` must be one of mean/);
    expect(refused({ id_col: '' })).toMatch(/`id_col` must be the name of a column/);
    expect(refused({ group_by: 3 })).toMatch(/`group_by` must be the name of a column, or null/);
    expect(refused({ page_size: 0 })).toMatch(/`page_size` must be a whole number, one or more/);
    expect(refused({ max_levels: 2.5 })).toMatch(/`max_levels` must be a whole number/);
    expect(refused({ profile: 'yes' })).toMatch(/`profile` must be true or false/);
    expect(refused({ statistic: 5 })).toMatch(/`statistic` must be the name of an R function/);
    expect(refused({ connection: {} })).toMatch(/`connection` must be a connection to R/);
    expect(refused({ visits: [] })).toMatch(/`visits` must be a name, or a list of names/);
    expect(refused({ groups: [{ label: 'Arm' }] })).toMatch(
      /`groups` holds something that is not a column name or \{ value_col, label \}/
    );
  });

  it('GC-CFG-004: the chart has no setting that chooses a test, an adjustment or a cut (#9)', () => {
    const names = Object.keys(DEFAULT_SETTINGS).join(' ');
    expect(names).not.toMatch(/test|pairwise|adjust|method|cut|alpha|signif/i);
    expect(refused({ test: 'wilcoxon' })).toMatch(/`test` is not a setting/);
    expect(refused({ pairwise: true })).toMatch(/`pairwise` is not a setting/);
  });
});
