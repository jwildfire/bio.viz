import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MARKS,
  OPENING_VIEWS,
  TESTS,
  Y_SCALES,
  coreSettings,
  syncSettings
} from '../../../src/group-comparison/configure.js';
import { DEFAULT_SETTINGS as CORE_DEFAULTS } from '../../../src/core/index.js';
import { createConnection } from '../../../src/r/index.js';

// The chart's settings (#9), and the ones that choose what R is asked (#16).

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
    expect(refused({ visits: [{}] })).toMatch(/`visits` must be a name, or a list of names/);
    // An empty list is a selection of none, which the Visits control can be
    // emptied to (#71 review).
    expect(syncSettings({ visits: [] }).visits).toEqual([]);
    expect(refused({ groups: [{ label: 'Arm' }] })).toMatch(
      /`groups` holds something that is not a column name or \{ value_col, label \}/
    );
  });

  it('GC-CFG-004: the chart has no setting that chooses a confidence level, a minimum group size or a cut, and one that names an adjustment: the one R makes across the visits of one biomarker over time (#16, #85)', () => {
    const names = Object.keys(DEFAULT_SETTINGS);
    expect(names.filter((name) => /adjust/i.test(name))).toEqual(['visit_adjustment']);
    expect(names.join(' ')).not.toMatch(/method|cut|alpha|signif|conf|min_group/i);
    expect(refused({ adjust: 'BH' })).toMatch(/`adjust` is not a setting/);
    expect(refused({ conf_level: 0.9 })).toMatch(/`conf_level` is not a setting/);
    expect(refused({ min_group: 2 })).toMatch(/`min_group` is not a setting/);
  });

  it('GC-CFG-005: the test and the pairwise comparisons each have a setting, with a stated default, and a value neither can take is refused (#16)', () => {
    expect(TESTS).toEqual(['t', 'wilcoxon', 'anova', 'kruskal', 'none']);
    expect(Object.isFrozen(TESTS)).toBe(true);
    expect(DEFAULT_SETTINGS.test).toBe('t');
    expect(DEFAULT_SETTINGS.pairwise).toBe(false);
    expect(DEFAULT_SETTINGS.waiting_note).toBe(null);
    for (const test of TESTS) expect(syncSettings({ test }).test).toBe(test);
    expect(syncSettings({ pairwise: true }).pairwise).toBe(true);
    expect(refused({ test: 'welch' })).toBe(
      'bio.viz: `test` must be one of t, wilcoxon, anova, kruskal, none.'
    );
    expect(refused({ test: null })).toMatch(/`test` must be one of/);
    expect(refused({ pairwise: 'holm' })).toBe('bio.viz: `pairwise` must be true or false.');
    expect(refused({ waiting_note: 26 })).toBe(
      'bio.viz: `waiting_note` must be a sentence, or null for none.'
    );
    expect(syncSettings({ waiting_note: 'About 13 MB the first time.' }).waiting_note).toBe(
      'About 13 MB the first time.'
    );
  });
  it('GC-GRID-014: the opening view, the two groups the difference grid compares and the R function that answers it each have a setting with a stated default; a view that is not one of the two, a pair that is not two different groups, or a function that is not a name is refused with a message naming it (#86)', () => {
    expect(OPENING_VIEWS).toEqual(['tiles', 'grid']);
    expect(Object.isFrozen(OPENING_VIEWS)).toBe(true);
    expect(DEFAULT_SETTINGS.opening_view).toBe('tiles');
    expect(DEFAULT_SETTINGS.grid_groups).toBe(null);
    expect(DEFAULT_SETTINGS.statistic_grid).toBe('Analyze_DifferenceGrid');
    for (const view of OPENING_VIEWS)
      expect(syncSettings({ opening_view: view }).opening_view).toBe(view);
    expect(refused({ opening_view: 'heatmap' })).toBe(
      'bio.viz: `opening_view` must be one of tiles, grid.'
    );
    expect(refused({ opening_view: null })).toMatch(/`opening_view` must be one of/);
    // The pair, in the order given: the difference is the first minus the second.
    expect(syncSettings({ grid_groups: ['Treatment', 'Placebo'] }).grid_groups).toEqual([
      'Treatment',
      'Placebo'
    ]);
    // Levels that are numbers are named as the text they are drawn as.
    expect(syncSettings({ grid_groups: [2, 1] }).grid_groups).toEqual(['2', '1']);
    const pairSaid =
      'bio.viz: `grid_groups` must name two different groups, first and second, as the difference ' +
      'grid compares them (the first minus the second), or be null for the first two drawn.';
    for (const bad of [
      'Treatment',
      ['Treatment'],
      ['Treatment', 'Placebo', 'Other'],
      ['Treatment', 'Treatment'],
      ['1', 1],
      ['Treatment', null],
      ['Treatment', {}],
      ['Treatment', ''],
      {}
    ]) {
      expect(refused({ grid_groups: bad }), JSON.stringify(bad)).toBe(pairSaid);
    }
    expect(syncSettings({ statistic_grid: null }).statistic_grid).toBe(null);
    expect(syncSettings({ statistic_grid: 'My_Grid' }).statistic_grid).toBe('My_Grid');
    expect(refused({ statistic_grid: 5 })).toBe(
      'bio.viz: `statistic_grid` must be the name of an R function, or null for no difference grid.'
    );
    expect(refused({ statistic_grid: '' })).toMatch(/`statistic_grid` must be the name/);
    // The grid has no setting for a confidence level, a minimum group size or
    // the ends of its colour scale: the first two are R's, the last is fixed.
    expect(Object.keys(DEFAULT_SETTINGS).join(' ')).not.toMatch(
      /conf|min_group|shade|colou?r_scale|limits/i
    );
  });
});
