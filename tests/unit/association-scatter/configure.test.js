import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  FITS,
  METHODS,
  SCALES,
  syncSettings
} from '../../../src/association-scatter/configure.js';
import { DEFAULT_SETTINGS as CORE_DEFAULTS } from '../../../src/core/index.js';
import { DEFAULT_SETTINGS as GROUP_COMPARISON } from '../../../src/group-comparison/configure.js';
import { coreSettings } from '../../../src/shared/settings.js';
import { createConnection } from '../../../src/r/index.js';

// The association scatter's settings (#26).

const refused = (overrides) => {
  try {
    syncSettings(overrides);
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    return error.message;
  }
  throw new Error(`not refused: ${JSON.stringify(overrides)}`);
};

describe('association scatter: settings', () => {
  it('AS-CFG-001: every setting has a default, and the column and baseline defaults are the core’s (#26)', () => {
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
      x: null,
      y: null,
      color_by: null,
      panel_by: null,
      x_scale: 'linear',
      y_scale: 'linear',
      fit: 'none',
      method: 'pearson',
      statistic: 'Analyze_Correlation',
      fit_statistic: 'Analyze_Fit',
      connection: null,
      back: null
    });
    expect(SCALES).toEqual(['linear', 'log']);
    expect(FITS).toEqual(['none', 'identity', 'linear', 'smooth']);
    expect(METHODS).toEqual(['pearson', 'spearman']);
    // A setting the two charts both have is named the same in both, with the
    // same default: one mapping drives either chart.
    const both = Object.keys(DEFAULT_SETTINGS).filter((key) => key in GROUP_COMPARISON);
    expect(both).toEqual(
      expect.arrayContaining([
        'id_col',
        'unit_col',
        'baseline_visits',
        'color_by',
        'panel_by',
        'y_scale',
        'measures',
        'groups',
        'filters',
        'details',
        'connection',
        'waiting_note',
        'profile',
        'studyday_col'
      ])
    );
    for (const key of both.filter((name) => name !== 'statistic')) {
      expect(DEFAULT_SETTINGS[key], key).toEqual(GROUP_COMPARISON[key]);
    }
  });

  it('AS-CFG-002: an axis is a variable as the core takes one: a biomarker at a visit with a value type, or a participant-level column read as a number (#26)', () => {
    const settings = syncSettings({
      x: { measure: 'TNF-alpha', visit: 'Baseline' },
      y: { measure: 'IL-6', visit: 'Week 4', value: 'change' }
    });
    // The value type is written out; a result itself is `raw`.
    expect(settings.x).toEqual({ measure: 'TNF-alpha', value: 'raw', visit: 'Baseline' });
    expect(settings.y).toEqual({ measure: 'IL-6', value: 'change', visit: 'Week 4' });
    // A baseline value has no visit, and a column has neither.
    expect(syncSettings({ x: { measure: 'IL-6', value: 'baseline' } }).x).toEqual({
      measure: 'IL-6',
      value: 'baseline'
    });
    expect(syncSettings({ x: { col: 'AGE' } }).x).toEqual({ col: 'AGE' });
    expect(syncSettings({ x: { col: 'AGE', type: 'number' } }).x).toEqual({ col: 'AGE' });
    // What the chart reads can be given back to it.
    expect(syncSettings(settings)).toEqual(settings);

    // A malformed variable is refused where it was written, in the core's words.
    expect(refused({ x: 'TNF-alpha' })).toMatch(/`x` must be a variable/);
    expect(refused({ y: { measure: 'IL-6' } })).toMatch(/must name its visit/);
    expect(refused({ y: { measure: 'IL-6', visit: 'Week 4', value: 'delta' } })).toMatch(
      /`value` must be one of raw, baseline, change, fold_change, percent_change/
    );
    expect(refused({ x: { measure: 'IL-6', col: 'AGE' } })).toMatch(/names both/);
    expect(refused({ x: { col: 'AGE', visit: 'Week 4' } })).toMatch(/a column takes no `visit`/);
    // An axis is a number, so it is not cut: a cut makes groups (#43).
    expect(refused({ x: { measure: 'CRP', visit: 'Baseline', cut: 'median' } })).toBe(
      'bio.viz: `x` is read as a number, so it takes no `cut`: a cut makes groups. Leave `cut` out.'
    );
  });

  it('AS-CFG-003: a caller’s settings are laid over the defaults, and a setting that is not known, or a value a setting cannot take, is refused with a message naming it (#26)', () => {
    const connection = createConnection();
    const back = { label: 'Back to the matrix', action: () => {} };
    const settings = syncSettings({
      color_by: 'ARM',
      x_scale: 'log',
      fit: 'identity',
      method: 'spearman',
      baseline_visits: ['Baseline'],
      groups: ['ARM', { value_col: 'SEX', label: 'Sex' }],
      numbers: 'AGE',
      filters: 'SEX',
      details: [{ value_col: 'AGE' }],
      connection,
      back,
      profile: false,
      waiting_note: undefined
    });
    expect(settings.groups).toEqual([
      { value_col: 'ARM', label: 'ARM' },
      { value_col: 'SEX', label: 'Sex' }
    ]);
    expect(settings.numbers).toEqual([{ value_col: 'AGE', label: 'AGE' }]);
    expect(settings.filters).toEqual([{ value_col: 'SEX', label: 'SEX' }]);
    expect(settings.details).toEqual([{ value_col: 'AGE', label: 'AGE' }]);
    expect(settings.connection).toBe(connection);
    expect(settings.back).toBe(back);
    expect(settings).toMatchObject({ x_scale: 'log', fit: 'identity', method: 'spearman' });
    expect(settings.waiting_note).toBe(null);

    expect(refused({ start_value: 'IL-6' })).toMatch(
      /^bio\.viz: `start_value` is not a setting of the association scatter\. Its settings are id_col, /
    );
    expect(refused('TNF-alpha')).toBe(
      'bio.viz: the association scatter takes its settings as an object.'
    );
    const cannot = [
      [{ x_scale: 'sqrt' }, '`x_scale` must be one of linear, log.'],
      [{ y_scale: 'log10' }, '`y_scale` must be one of linear, log.'],
      [{ fit: 'quadratic' }, '`fit` must be one of none, identity, linear, smooth.'],
      [{ method: 'kendall' }, '`method` must be one of pearson, spearman.'],
      [{ id_col: '' }, '`id_col` must be the name of a column.'],
      [{ color_by: 5 }, '`color_by` must be the name of a column, or null.'],
      [{ page_size: 0 }, '`page_size` must be a whole number, one or more.'],
      [{ max_levels: 2.5 }, '`max_levels` must be a whole number, one or more.'],
      [{ baseline_stat: 'median' }, '`baseline_stat` must be one of mean, min, max, first.'],
      [{ profile: 'yes' }, '`profile` must be true or false.'],
      [
        { statistic: 5 },
        '`statistic` must be the name of an R function, or null for no statistics line.'
      ],
      [
        { fit_statistic: '' },
        '`fit_statistic` must be the name of an R function, or null for no linear or smooth line.'
      ],
      [
        { connection: {} },
        '`connection` must be a connection to R (BioViz.r.createConnection), or null.'
      ],
      [
        { back: { label: 'Back' } },
        '`back` must be { label, action }, a sentence and a function, or null for none.'
      ],
      [{ waiting_note: 7 }, '`waiting_note` must be a sentence, or null for none.'],
      [
        { numbers: [5] },
        '`numbers` holds something that is not a column name or { value_col, label }.'
      ]
    ];
    for (const [given, message] of cannot) {
      expect(refused(given), JSON.stringify(given)).toBe(`bio.viz: ${message}`);
    }
  });

  it('AS-CFG-004: the chart has no setting that chooses a confidence level, a minimum number of pairs, an adjustment or how smooth a smooth is (#26)', () => {
    // max_levels is how many values a column may hold and still be a category:
    // it is the only setting whose name could be read as one of these.
    const names = Object.keys(DEFAULT_SETTINGS).filter((key) => key !== 'max_levels');
    expect(names.join(' ')).not.toMatch(/conf|level|alpha|min_|minimum|adjust|span|degree|points/i);
    for (const key of ['nConfLevel', 'nMinGroup', 'nPoints', 'conf_level', 'min_pairs', 'span']) {
      expect(refused({ [key]: 0.9 })).toMatch(/is not a setting of the association scatter/);
    }
  });
});
