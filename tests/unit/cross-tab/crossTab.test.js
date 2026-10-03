import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_SETTINGS,
  PERCENTS,
  TESTS,
  syncSettings
} from '../../../src/cross-tab/configure.js';
import { buildTable } from '../../../src/cross-tab/structureData.js';
import { contingencyRequest, describeAnswer, scopeText } from '../../../src/cross-tab/statistic.js';
import { createConnection } from '../../../src/r/index.js';
import { canonicalJson } from '../../../src/r/canonical.js';
import { participants, results } from '../core/study.js';

// The cross-tabulation (#44, obot.roadmap#359): a two-way table of counts with
// its totals and percentages, and R's chi-square or Fisher's exact test of it.
// What desktop R makes of each case is in tests/fixtures/cross-tab-r.json,
// written by tools/r-cross-tab.R from the vendored study; nothing here is typed.

const fromR = JSON.parse(
  readFileSync(new URL('../../fixtures/cross-tab-r.json', import.meta.url), 'utf8')
);
const caseOf = (name) => fromR.cases.find((entry) => entry.case === name);
// The baseline visit named, as the demo and the R recipe name it.
const settings = syncSettings({ baseline_visits: 'Baseline' });

const refused = (overrides) => {
  try {
    syncSettings(overrides);
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    return error.message;
  }
  throw new Error(`not refused: ${JSON.stringify(overrides)}`);
};

// The view a case is of, as the chart's controls hold it.
const stateOf = (entry) => ({
  rowBy: entry.dataId.row_by,
  colBy: entry.dataId.col_by,
  percent: 'row',
  test: entry.args.strMethod,
  filters: Object.fromEntries(
    Object.entries(entry.dataId.filters || {}).map(([column, values]) => [column, values[0]])
  )
});
const modelOf = (entry) => buildTable({ results, participants }, settings, stateOf(entry));

describe('cross-tabulation: settings', () => {
  it('CT-CFG-001: every setting has a default; the rows and the columns are each a column or a cut variable; the percentages, the test and the statistic are checked (#44)', () => {
    expect(syncSettings()).toEqual(DEFAULT_SETTINGS);
    expect(PERCENTS).toEqual(['row', 'col', 'none']);
    expect(TESTS).toEqual(['chisq', 'fisher', 'none']);
    expect(DEFAULT_SETTINGS).toMatchObject({
      row_by: null,
      col_by: null,
      percent: 'row',
      test: 'chisq',
      statistic: 'Analyze_Contingency'
    });
    expect(syncSettings({ row_by: 'ARM' }).row_by).toBe('ARM');
    expect(
      syncSettings({ col_by: { measure: 'CRP', visit: 'Baseline', cut: 'median' } }).col_by
    ).toEqual({ measure: 'CRP', visit: 'Baseline', value: 'raw', cut: 'median' });
    expect(refused({ percent: 'cell' })).toBe('bio.viz: `percent` must be one of row, col, none.');
    expect(refused({ test: 'mcnemar' })).toBe(
      'bio.viz: `test` must be one of chisq, fisher, none.'
    );
    expect(refused({ row_by: { measure: 'CRP', visit: 'Baseline' } })).toMatch(
      /`row_by` is a variable with no cut/
    );
    expect(refused({ alpha: 0.05 })).toMatch(/`alpha` is not a setting of the cross-tabulation/);
  });
});

describe('cross-tabulation: the table', () => {
  it('CT-DATA-001: the counts, the row and column totals and the grand total are desktop R’s table() of the same participants, for every case (#44)', () => {
    expect(fromR.cases.length).toBeGreaterThanOrEqual(6);
    for (const entry of fromR.cases) {
      const model = modelOf(entry);
      expect(model.rowLevels, entry.case).toEqual(entry.row_levels);
      expect(model.colLevels, entry.case).toEqual(entry.col_levels);
      expect(model.counts, entry.case).toEqual(entry.counts);
      expect(model.rowTotals, entry.case).toEqual(entry.row_totals);
      expect(model.colTotals, entry.case).toEqual(entry.col_totals);
      expect(model.total, entry.case).toBe(entry.total);
    }
  });

  it('CT-DATA-002: the row and the column percentages are each count of its row’s or its column’s total, as desktop R works them out (#44)', () => {
    for (const entry of fromR.cases) {
      const model = modelOf(entry);
      model.percents.row.forEach((row, i) =>
        row.forEach((value, j) =>
          expect(value, entry.case).toBeCloseTo(entry.row_percent[i][j], 12)
        )
      );
      model.percents.col.forEach((row, i) =>
        row.forEach((value, j) =>
          expect(value, entry.case).toBeCloseTo(entry.col_percent[i][j], 12)
        )
      );
    }
  });

  it('CT-DATA-003: a biomarker cut by the shared cut rule makes the rows or the columns, low to high, worked out on the participants the filters keep (#44)', () => {
    const median = modelOf(caseOf('response-by-crp-median-chisq'));
    expect(median.colLevels).toEqual(['≤ 2.783', '> 2.783']);
    expect(median.cuts.col.points).toHaveLength(1);
    expect(median.cuts.col.points[0]).toBeCloseTo(2.783, 12);
    expect(median.cuts.row).toBe(undefined);
    const typed = modelOf(caseOf('response-by-crp-typed-chisq'));
    expect(typed.colLevels).toEqual(['≤ 8', '> 8']);
    // The women alone: 91 participants pass the filter.
    const women = modelOf(caseOf('arm-by-response-women-chisq'));
    expect(women.filtered).toBe(91);
    expect(women.total).toBe(91);
  });
});

describe('cross-tabulation: what R is asked, and what the line says', () => {
  it('CT-STAT-001: R is asked once per table, with the function, the arguments, the identity and the row count desktop R’s recipe writes, and one row per participant (#44)', () => {
    for (const entry of fromR.cases) {
      const model = modelOf(entry);
      const request = contingencyRequest({
        name: settings.statistic,
        test: entry.args.strMethod,
        settings,
        state: stateOf(entry),
        model
      });
      expect(request.name, entry.case).toBe(entry.name);
      expect(request.args, entry.case).toEqual(entry.args);
      expect(canonicalJson(request.dataId), entry.case).toBe(canonicalJson(entry.dataId));
      expect(request.rows, entry.case).toBe(entry.rows);
      expect(request.data).toHaveLength(entry.rows);
      expect(Object.keys(request.data[0])).toEqual([settings.id_col, 'row', 'col']);
    }
    // The baseline settings are named only where a cut biomarker reads a
    // baseline, so a table of columns, or of a result itself, is keyed without
    // them.
    const named = (entry) => 'baseline_visits' in entry.dataId || 'baseline_stat' in entry.dataId;
    expect(fromR.cases.filter(named).map((entry) => entry.case)).toEqual([
      'arm-by-crp-change-median-chisq'
    ]);
    expect(caseOf('arm-by-crp-change-median-chisq').dataId.baseline_visits).toEqual(['Baseline']);
  });

  it('CT-STAT-002: R’s chi-square and Fisher results are printed with their method and counts, labelled exploratory and unadjusted, and Fisher’s odds ratio with its interval (#44)', () => {
    const chisq = describeAnswer({ status: 'ok', value: caseOf('arm-by-response-chisq').value });
    expect(chisq.state).toBe('shown');
    expect(chisq.text).toBe(
      "Pearson's Chi-squared test with Yates' continuity correction: p = 0.464 (n = 200). " +
        'Exploratory, unadjusted.'
    );
    const fisher = describeAnswer({ status: 'ok', value: caseOf('arm-by-response-fisher').value });
    expect(fisher.text).toBe(
      "Fisher's Exact Test for Count Data: p = 0.464 (n = 200). Exploratory, unadjusted."
    );
    expect(fisher.estimates).toEqual([
      'odds ratio: 1.292, 95% confidence interval 0.6994 to 2.398.'
    ]);
    expect(scopeText({ n: 91, filters: [{ label: 'Sex', values: ['F'] }] })).toBe(
      'This test is of the 91 participants in the table. Filters: Sex is F.'
    );
  });

  it('CT-STAT-003: the small-expected warning is R’s, printed with the result when R gives it and not otherwise (#44)', () => {
    const small = describeAnswer({
      status: 'ok',
      value: caseOf('response-by-crp-typed-chisq').value
    });
    expect(small.remarks).toEqual([
      { kind: 'warning', text: 'R warned: Chi-squared approximation may be incorrect' },
      {
        kind: 'note',
        text: "R’s note: 1 of 4 expected counts are below 5, so the chi-squared approximation may be poor. Fisher's exact test does not rely on it."
      }
    ]);
    for (const name of ['arm-by-response-chisq', 'response-by-crp-median-chisq']) {
      expect(describeAnswer({ status: 'ok', value: caseOf(name).value }).remarks, name).toEqual([]);
    }
  });

  it('CT-STAT-004: handed to a connection as stored results, each of R’s answers is found by the chart’s request for its table (#44)', async () => {
    const connection = createConnection({
      results: fromR.cases.map(({ name, args, dataId, rows, value }) => ({
        name,
        args,
        dataId,
        rows,
        value
      }))
    });
    for (const entry of fromR.cases) {
      const request = contingencyRequest({
        name: settings.statistic,
        test: entry.args.strMethod,
        settings,
        state: stateOf(entry),
        model: modelOf(entry)
      });
      expect(await connection.run(request.name, request), entry.case).toEqual({
        status: 'ok',
        value: entry.value,
        form: 'precomputed'
      });
    }
  });
});
