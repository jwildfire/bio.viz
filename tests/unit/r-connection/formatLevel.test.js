import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatLevel } from '../../../src/r/index.js';

// One level of a by-level answer (#85): the group test R ran on the rows of
// one level of a column, a visit say, with its p-value as R computed it and as
// R adjusted it across the levels. The rows here are the ones desktop R
// returned (tests/fixtures/group-statistics-r.json); no number in them was
// typed.

const fromR = JSON.parse(
  readFileSync(new URL('../../fixtures/group-statistics-r.json', import.meta.url), 'utf8')
);
const rowsOf = (name) => fromR.over_time.find((result) => result.case === name).value.rows;
const rowOf = (name, by) => rowsOf(name).find((row) => row.by === by);

describe('formatLevel: one level of a by-level answer', () => {
  it('PVAL-LEVEL-001: a level’s p-value comes with its method, each group’s count and its label, in parts for a table; an adjusted one names the adjustment and how many levels it covered, beside the unadjusted one (#85)', () => {
    expect(formatLevel(rowOf('over-time-result', 'Baseline'))).toEqual({
      status: 'shown',
      text:
        'Baseline: Welch Two Sample t-test: p = 0.221 (Placebo n = 100, Treatment n = 100). ' +
        'Exploratory, unadjusted.',
      result:
        'Welch Two Sample t-test: p = 0.221 (Placebo n = 100, Treatment n = 100). ' +
        'Exploratory, unadjusted.',
      by: 'Baseline',
      groups: ['Placebo', 'Treatment'],
      n: [100, 100],
      method: 'Welch Two Sample t-test',
      p: 'p = 0.221',
      unadjusted: 'p = 0.221',
      adjustment: null,
      over: null,
      label: 'Exploratory, unadjusted.'
    });
    // Adjusted by R: the p-value printed is the adjusted one, the adjustment is
    // named, and the sentence gives both.
    expect(formatLevel(rowOf('over-time-age-40-to-43', 'Week 12'), 'visit')).toEqual({
      status: 'shown',
      text:
        'Week 12: Welch Two Sample t-test: p = 0.193 unadjusted, p = 0.579 adjusted across 3 ' +
        'visits (Placebo n = 5, Treatment n = 5). Exploratory, adjusted (Holm).',
      result:
        'Welch Two Sample t-test: p = 0.193 unadjusted, p = 0.579 adjusted across 3 visits ' +
        '(Placebo n = 5, Treatment n = 5). Exploratory, adjusted (Holm).',
      by: 'Week 12',
      groups: ['Placebo', 'Treatment'],
      n: [5, 5],
      method: 'Welch Two Sample t-test',
      p: 'p = 0.579',
      unadjusted: 'p = 0.193',
      adjustment: 'Holm',
      over: 3,
      label: 'Exploratory, adjusted (Holm).'
    });
    // What a level is called is the caller's: `level` unless it says.
    expect(formatLevel(rowOf('over-time-age-40-to-43', 'Week 12')).text).toContain(
      'adjusted across 3 levels'
    );
    expect(formatLevel(rowOf('over-time-result-bh', 'Baseline'))).toMatchObject({
      adjustment: 'Benjamini-Hochberg',
      over: 5,
      p: 'p = 0.221',
      label: 'Exploratory, adjusted (Benjamini-Hochberg).'
    });
    // However many groups: each is named with its count.
    expect(formatLevel(rowOf('over-time-anova', 'Baseline'))).toMatchObject({
      status: 'shown',
      groups: ['Placebo F', 'Placebo M', 'Treatment F', 'Treatment M'],
      n: [44, 56, 47, 53],
      method: 'One-way analysis of variance',
      p: 'p = 0.436',
      text:
        'Baseline: One-way analysis of variance: p = 0.436 (Placebo F n = 44, Placebo M n = 56, ' +
        'Treatment F n = 47, Treatment M n = 53). Exploratory, unadjusted.'
    });
    // Every row of every answer: the p-value printed is R's p_value, and the
    // unadjusted one R's p_unadjusted.
    for (const result of fromR.over_time) {
      for (const row of result.value.rows) {
        const formatted = formatLevel(row);
        if (row.status !== 'ok') continue;
        expect(formatted.status, `${result.case} ${row.by}`).toBe('shown');
        const printed = (p) =>
          p < 0.001 ? 'p < 0.001' : p.toFixed(3) === '1.000' ? 'p > 0.999' : `p = ${p.toFixed(3)}`;
        expect(formatted.p, `${result.case} ${row.by}`).toBe(printed(row.p_value));
        expect(formatted.unadjusted, `${result.case} ${row.by}`).toBe(printed(row.p_unadjusted));
        expect(formatted.over, `${result.case} ${row.by}`).toBe(
          row.adjustment === 'none' ? null : row.adjusted_over
        );
      }
    }
  });

  it('PVAL-LEVEL-002: a level R could not compute shows R’s words with each group’s count and no number; a row with no level, fewer than two groups named, no method, no counts, no unadjusted p-value or no number of levels adjusted across is refused (#85)', () => {
    expect(formatLevel(rowOf('over-time-age-57', 'Week 2'))).toEqual({
      status: 'withheld',
      text:
        'Week 2: Not computed: Treatment has 1. The minimum group size is 5. ' +
        'Counts: Placebo n = 6, Treatment n = 1.',
      result:
        'Not computed: Treatment has 1. The minimum group size is 5. ' +
        'Counts: Placebo n = 6, Treatment n = 1.',
      by: 'Week 2',
      groups: ['Placebo', 'Treatment'],
      n: [6, 1],
      method: null,
      p: null,
      unadjusted: null,
      adjustment: null,
      over: null,
      label: null
    });
    const good = rowOf('over-time-result-holm', 'Baseline');
    expect(formatLevel({ ...good, status: 'error', reason: 'gave no p-value' })).toMatchObject({
      status: 'error',
      result: 'R reported an error: gave no p-value (Placebo n = 100, Treatment n = 100).',
      p: null
    });
    const refusal = (row) => {
      const formatted = formatLevel(row);
      expect(formatted.status).toBe('refused');
      expect(formatted.p).toBe(null);
      expect(formatted.unadjusted).toBe(null);
      return formatted.result;
    };
    expect(refusal({ ...good, by: null })).toBe(
      'p-value not shown: the row does not name its level.'
    );
    expect(refusal({ ...good, by: '  ' })).toBe(
      'p-value not shown: the row does not name its level.'
    );
    const { group_2: second, ...oneGroup } = good;
    expect(second).toBe('Treatment');
    expect(refusal(oneGroup)).toBe('p-value not shown: the row does not name its groups.');
    expect(refusal({ ...good, group_2: '' })).toBe(
      'p-value not shown: the row does not name its groups.'
    );
    expect(refusal({ ...good, method: null })).toBe(
      'p-value not shown: the result does not name its method.'
    );
    expect(refusal({ ...good, n_2: null })).toBe(
      'p-value not shown: the result does not give the counts it used.'
    );
    expect(refusal({ ...good, p_value: 1.2 })).toBe(
      'p-value not shown: the result has no p-value between 0 and 1.'
    );
    expect(refusal({ ...good, p_unadjusted: null })).toBe(
      'p-value not shown: the row has no unadjusted p-value between 0 and 1.'
    );
    expect(refusal({ ...good, adjusted_over: null })).toBe(
      'p-value not shown: the row does not say how many levels its p-value was adjusted across.'
    );
    expect(refusal(null)).toBe('p-value not shown: the row does not name its level.');
    // Unadjusted, the number of levels is not needed: nothing was adjusted across them.
    expect(formatLevel({ ...good, adjustment: 'none', adjusted_over: null }).status).toBe('shown');
  });
});
