import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatScreenRow } from '../../../src/r/index.js';

// One row of a biomarker screen (#36): a biomarker's estimate with its interval
// and its p-value twice, unadjusted and adjusted across the rows. The rows here
// are the ones desktop R returned (tests/fixtures/screen-statistics-r.json); no
// number in them was typed.

const fromR = JSON.parse(
  readFileSync(new URL('../../fixtures/screen-statistics-r.json', import.meta.url), 'utf8')
);
const rowsOf = (name) => fromR.results.find((result) => result.case === name).value.rows;
const ARMS = ['Placebo', 'Treatment'];
const il6 = rowsOf('difference-week-4-change').find((row) => row.biomarker === 'IL-6');

describe('formatScreenRow: one row of a biomarker screen', () => {
  it('PVAL-SCREEN-001: a row’s estimate comes with its interval, its unadjusted p-value with its method and each group’s count, and its adjusted p-value with the adjustment by name and how many rows it covered, in parts for a table (#36)', () => {
    expect(formatScreenRow(il6, ARMS)).toEqual({
      status: 'shown',
      text:
        'IL-6: 0.9133, 95% confidence interval 0.6111 to 1.213. Welch Two Sample t-test: ' +
        'p < 0.001 unadjusted, p < 0.001 adjusted across 12 biomarkers (Placebo n = 95, ' +
        'Treatment n = 91). Exploratory, adjusted (Benjamini-Hochberg).',
      result:
        '0.9133, 95% confidence interval 0.6111 to 1.213. Welch Two Sample t-test: p < 0.001 ' +
        'unadjusted, p < 0.001 adjusted across 12 biomarkers (Placebo n = 95, Treatment n = 91). ' +
        'Exploratory, adjusted (Benjamini-Hochberg).',
      biomarker: 'IL-6',
      n: 'Placebo n = 95, Treatment n = 91',
      estimate: '0.9133',
      interval: '95% confidence interval 0.6111 to 1.213',
      bounds: '0.6111 to 1.213',
      level: '95%',
      method: 'Welch Two Sample t-test',
      p: 'p < 0.001',
      adjusted: 'p < 0.001',
      adjustment: 'Benjamini-Hochberg',
      over: 12,
      label: 'Exploratory, adjusted (Benjamini-Hochberg).'
    });
    // Every row's numbers are R's, to four significant figures, and both p-values are R's.
    for (const row of rowsOf('difference-week-4-change')) {
      const formatted = formatScreenRow(row, ARMS);
      expect(formatted.status).toBe('shown');
      expect(Number(formatted.estimate)).toBe(Number(row.estimate.toPrecision(4)));
      expect(formatted.p).toMatch(/^p (=|<|>) /);
      expect(formatted.over).toBe(row.adjusted_over);
    }
    const crp = rowsOf('difference-week-4-change').find((row) => row.biomarker === 'CRP');
    expect(formatScreenRow(crp, ARMS)).toMatchObject({ p: 'p = 0.530', adjusted: 'p = 0.636' });
    // Holm by name.
    const holm = rowsOf('difference-week-4-change-holm').find((row) => row.biomarker === 'CRP');
    expect(formatScreenRow(holm, ARMS)).toMatchObject({
      adjustment: 'Holm',
      adjusted: 'p > 0.999',
      label: 'Exploratory, adjusted (Holm).'
    });
    // A correlation: one count, the coefficient, and for Spearman no interval.
    const tnf = rowsOf('correlation-il-10').find((row) => row.biomarker === 'TNF-alpha');
    expect(formatScreenRow(tnf)).toMatchObject({
      text:
        "TNF-alpha: 0.6384, 95% confidence interval 0.5482 to 0.7139. Pearson's product-moment " +
        'correlation: p < 0.001 unadjusted, p < 0.001 adjusted across 11 biomarkers (n = 200). ' +
        'Exploratory, adjusted (Benjamini-Hochberg).',
      n: 'n = 200'
    });
    const rank = rowsOf('correlation-il-10-spearman').find((row) => row.biomarker === 'TNF-alpha');
    expect(formatScreenRow(rank)).toMatchObject({ interval: null, bounds: null, level: null });
    expect(formatScreenRow(rank).text).not.toMatch(/interval/);
    // Never a star or a verdict, however small.
    for (const p of [0, 1e-12, 0.049, 0.05, 1]) {
      const { text } = formatScreenRow({ ...il6, p_unadjusted: p, p_value: p }, ARMS);
      expect(text).not.toContain('*');
      expect(text.toLowerCase()).not.toContain('significan');
    }
    // It computes nothing: the row is left as it was, and the same row reads the same.
    const before = JSON.stringify(il6);
    expect(formatScreenRow(il6, ARMS)).toEqual(formatScreenRow(il6, ARMS));
    expect(JSON.stringify(il6)).toBe(before);
  });

  it('PVAL-SCREEN-002: a row with something missing is refused, and one R could not compute shows R’s words with its counts and no number (#36)', () => {
    for (const [change, said] of [
      [{ biomarker: null }, 'p-value not shown: the row does not name its biomarker.'],
      [{ method: null }, 'p-value not shown: the result does not name its method.'],
      [
        { n_1: null, counts: null },
        'p-value not shown: the result does not give the counts it used.'
      ],
      [{ p_unadjusted: null }, 'p-value not shown: the result has no p-value between 0 and 1.'],
      [
        { adjustment: 'none' },
        'Row not shown: the row does not name the adjustment of its p-value.'
      ],
      [
        { adjusted_over: null },
        'Row not shown: the row does not say how many rows its p-value was adjusted across.'
      ],
      [{ p_value: 2 }, 'Row not shown: the adjusted p-value is not a number between 0 and 1.'],
      [{ estimate: null }, 'Row not shown: the estimate is not a number.'],
      [{ upper: null }, 'Row not shown: the interval of the estimate is incomplete.']
    ]) {
      const formatted = formatScreenRow({ ...il6, ...change }, ARMS);
      expect(formatted.status, JSON.stringify(change)).toBe('refused');
      expect(formatted.result).toBe(said);
      expect(formatted).toMatchObject({ estimate: null, p: null, adjusted: null });
      expect(formatted.text).not.toMatch(/0\.\d/);
    }
    // A row with a group too small: R's reason, as R worded it, and the counts.
    const [small] = rowsOf('difference-age-35');
    expect(small).toMatchObject({ status: 'too_small', adjusted_over: null, p_value: null });
    expect(formatScreenRow(small, ARMS)).toMatchObject({
      status: 'withheld',
      text:
        'CRP: Not computed: Placebo has 2; Treatment has 2. The minimum group size is 5. ' +
        'Counts: Placebo n = 2, Treatment n = 2.',
      estimate: null,
      p: null,
      adjusted: null
    });
    // R's own error is said to be one.
    expect(
      formatScreenRow({ ...small, status: 'error', reason: 'the values do not vary' }, ARMS)
    ).toMatchObject({ status: 'error', estimate: null });
    expect(formatScreenRow(undefined).status).toBe('refused');
  });
});
