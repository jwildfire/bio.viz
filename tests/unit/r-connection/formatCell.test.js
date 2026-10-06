import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatCell } from '../../../src/r/index.js';

// One cell of a difference grid (#86): the standardised difference in means
// between two groups for one biomarker on the rows of one level of a column,
// with its interval and each group's count, and no p-value. The rows here are
// the ones desktop R returned (tests/fixtures/group-statistics-r.json); no
// number in them was typed.

const fromR = JSON.parse(
  readFileSync(new URL('../../fixtures/group-statistics-r.json', import.meta.url), 'utf8')
);
const answerOf = (name) => fromR.grid.find((result) => result.case === name).value;
const rowOf = (name, biomarker, by) =>
  answerOf(name).rows.find((row) => row.biomarker === biomarker && row.by === by);
const METHOD = 'Standardised difference (Hedges’ g)'.replace('’', "'");
const of = (groups = ['Placebo', 'Treatment']) => ({ groups, method: METHOD });

describe('formatCell: one cell of a difference grid', () => {
  it('PVAL-CELL-001: a cell’s estimate comes with what it is an estimate of, which way round it is, its interval at the level R gave and each group’s count, in parts for a cell and a table, and has no p-value (#86)', () => {
    expect(answerOf('grid-result').method).toBe(METHOD);
    const row = rowOf('grid-result', 'IL-6', 'Week 4');
    expect(formatCell(row, of())).toEqual({
      status: 'shown',
      text:
        "IL-6 at Week 4: Standardised difference (Hedges' g), Placebo minus Treatment: 0.9795, " +
        '95% confidence interval 0.675 to 1.282 (Placebo n = 95, Treatment n = 91).',
      result:
        "Standardised difference (Hedges' g), Placebo minus Treatment: 0.9795, " +
        '95% confidence interval 0.675 to 1.282 (Placebo n = 95, Treatment n = 91).',
      biomarker: 'IL-6',
      by: 'Week 4',
      groups: ['Placebo', 'Treatment'],
      n: [95, 91],
      estimate: '0.9795',
      short: '0.98',
      interval: '95% confidence interval 0.675 to 1.282',
      bounds: '0.675 to 1.282',
      level: '95%'
    });
    // The other way round is another answer of R's, named the other way round:
    // the groups are the ones the request named, first then second.
    const reversed = formatCell(rowOf('grid-result-reversed', 'IL-6', 'Week 4'), {
      groups: ['Treatment', 'Placebo'],
      method: METHOD
    });
    expect(reversed.result).toBe(
      "Standardised difference (Hedges' g), Treatment minus Placebo: -0.9795, " +
        '95% confidence interval -1.282 to -0.675 (Treatment n = 91, Placebo n = 95).'
    );
    // In a cell: two decimal places and a true minus sign.
    expect(reversed.short).toBe('−0.98');
    expect(reversed.n).toEqual([91, 95]);
    // Every cell R computed is printed, each with its counts, and none with a
    // p-value: the word is in no sentence.
    for (const result of fromR.grid) {
      const groups = result.args.chrGroups;
      for (const given of result.value.rows) {
        const cell = formatCell(given, { groups, method: result.value.method });
        const where = `${result.case} ${given.biomarker} ${given.by}`;
        expect(cell.text, where).not.toMatch(/\bp\s*[=<>]|p-value|Exploratory/);
        if (given.status !== 'ok') continue;
        expect(cell.status, where).toBe('shown');
        expect(cell.text, where).toContain(`${groups[0]} n = ${given.n_1}, ${groups[1]} n = `);
        expect(cell.short, where).toBe(
          (given.estimate.toFixed(2) === '-0.00' ? '0.00' : given.estimate.toFixed(2)).replace(
            '-',
            '−'
          )
        );
        expect(cell.short, where).toMatch(/^−?\d+\.\d\d$/);
      }
    }
    // A value that rounds to nought is nought, without a sign.
    expect(formatCell({ ...row, estimate: -0.004 }, of()).short).toBe('0.00');
    expect(formatCell({ ...row, estimate: 0.004 }, of()).short).toBe('0.00');
    // An answer with no interval is printed without one, not refused.
    const bare = formatCell({ ...row, lower: null, upper: null, level: null }, of());
    expect(bare.status).toBe('shown');
    expect(bare.interval).toBeNull();
    expect(bare.result).toBe(
      "Standardised difference (Hedges' g), Placebo minus Treatment: 0.9795 (Placebo n = 95, Treatment n = 91)."
    );
  });

  it('PVAL-CELL-002: a cell R could not compute shows R’s words with each group’s count and no number; a row with no biomarker or level, a cell whose two groups or whose estimate’s name were not given, one with no counts, an estimate that is not a number or half an interval is refused (#86)', () => {
    const small = rowOf('grid-age-57', 'CRP', 'Baseline');
    expect(small.status).toBe('too_small');
    expect(formatCell(small, of())).toEqual({
      status: 'withheld',
      text:
        'CRP at Baseline: Not computed: Treatment has 2. The minimum group size is 5. ' +
        'Counts: Placebo n = 7, Treatment n = 2.',
      result:
        'Not computed: Treatment has 2. The minimum group size is 5. ' +
        'Counts: Placebo n = 7, Treatment n = 2.',
      biomarker: 'CRP',
      by: 'Baseline',
      groups: ['Placebo', 'Treatment'],
      n: [7, 2],
      estimate: null,
      short: null,
      interval: null,
      bounds: null,
      level: null
    });
    // R's error for a cell is R's message, with the counts.
    const failed = formatCell(
      { ...small, status: 'error', reason: 'the values are constant' },
      of()
    );
    expect(failed.status).toBe('error');
    expect(failed.result).toBe(
      'R reported an error: the values are constant (Placebo n = 7, Treatment n = 2).'
    );
    expect(failed.short).toBeNull();

    const good = rowOf('grid-result', 'CRP', 'Baseline');
    const refused = [
      [{ ...good, biomarker: undefined }, of(), 'the row does not name its biomarker'],
      [{ ...good, by: null }, of(), 'the row does not name its level'],
      [good, { method: METHOD }, 'the two groups compared are not named'],
      [good, { groups: ['Placebo'], method: METHOD }, 'the two groups compared are not named'],
      [good, { groups: ['Placebo', 'Treatment'] }, 'the answer does not name the estimate'],
      [{ ...good, n_2: undefined }, of(), 'the row does not give each group’s count'],
      [{ ...good, estimate: 'large' }, of(), 'the estimate is not a number'],
      [{ ...good, estimate: null }, of(), 'the estimate is not a number'],
      [{ ...good, upper: null }, of(), 'the interval of the estimate is incomplete'],
      [{ ...good, level: 95 }, of(), 'the interval of the estimate is incomplete']
    ];
    for (const [given, named, why] of refused) {
      const cell = formatCell(given, named);
      expect(cell.status, why).toBe('refused');
      expect(cell.result, why).toBe(`Cell not shown: ${why}.`);
      // No number stands in for the one that is missing.
      expect([cell.estimate, cell.short, cell.interval, cell.bounds, cell.level], why).toEqual([
        null,
        null,
        null,
        null,
        null
      ]);
    }
    expect(formatCell(undefined).status).toBe('refused');
    expect(formatCell(null, of()).status).toBe('refused');
  });
});
