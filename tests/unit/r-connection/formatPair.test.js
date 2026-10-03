import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatPair } from '../../../src/r/index.js';

// One pair's result from a correlation matrix's rows (#27): the coefficient of
// two of a grid's variables, with its interval and its count, and no p-value.
// The rows here are the ones desktop R returned
// (tests/fixtures/matrix-statistics-r.json); no number in them was typed.

const fromR = JSON.parse(
  readFileSync(new URL('../../fixtures/matrix-statistics-r.json', import.meta.url), 'utf8')
);
const rowsOf = (name) => fromR.results.find((result) => result.case === name).value.rows;
const planted = rowsOf('biomarkers-baseline').find((row) => row.x === 'v9' && row.y === 'v11');

describe('formatPair: one pair’s result from a correlation matrix’s rows', () => {
  it('PVAL-PAIR-001: a pair’s estimate comes with its interval at the level R gave and its count, in parts for a cell and a table, and with no p-value even where a row carries one (#27)', () => {
    expect(planted).toMatchObject({ x: 'v9', y: 'v11', counts: 200, status: 'ok' });
    expect(formatPair(planted)).toEqual({
      status: 'shown',
      text: '0.6384, 95% confidence interval 0.5482 to 0.7139 (n = 200).',
      pair: ['v9', 'v11'],
      n: 200,
      estimate: '0.6384',
      interval: '95% confidence interval 0.5482 to 0.7139',
      bounds: '0.5482 to 0.7139',
      level: '95%'
    });
    // The numbers are R's, to four significant figures, and nothing else.
    for (const row of rowsOf('biomarkers-baseline')) {
      const formatted = formatPair(row);
      expect(formatted.status).toBe('shown');
      expect(Number(formatted.estimate)).toBe(Number(row.estimate.toPrecision(4)));
      expect(formatted.bounds).toBe(
        `${Number(row.lower.toPrecision(4))} to ${Number(row.upper.toPrecision(4))}`
      );
      expect(formatted.n).toBe(row.counts);
    }
    // Where R gave no interval, as for Spearman's rho, none is printed or made up.
    const [rank] = rowsOf('biomarkers-baseline-spearman');
    expect([rank.lower, rank.upper, rank.level]).toEqual([null, null, null]);
    const ranked = formatPair(rank);
    expect(ranked).toMatchObject({ status: 'shown', interval: null, bounds: null, level: null });
    expect(ranked.text).toBe(`${ranked.estimate} (n = 200).`);
    expect(ranked.text).not.toMatch(/interval/);
    // R's rows hold no p-value. One on a row is neither read nor printed,
    // whatever it is, and nothing says a verdict.
    expect(rowsOf('biomarkers-baseline').some((row) => 'p_value' in row)).toBe(false);
    for (const p of [0, 1e-12, 0.049, 0.5, 1, 'not a number']) {
      const withP = formatPair({ ...planted, p_value: p, method: 'A test', adjustment: 'holm' });
      expect(withP).toEqual(formatPair(planted));
      expect(JSON.stringify(withP)).not.toMatch(/p [=<>]|p_value|\*|significan|adjust/i);
    }
    expect(Object.keys(formatPair(planted))).not.toContain('p');
    // It computes nothing: the row is left as it was, and the same row reads the same.
    const before = JSON.stringify(planted);
    expect(formatPair(planted)).toEqual(formatPair(planted));
    expect(JSON.stringify(planted)).toBe(before);
  });

  it('PVAL-PAIR-002: a pair with no two variables, no count, no estimate or half an interval is refused, and one R could not compute shows R’s words with its count and no number (#27)', () => {
    const nothing = { estimate: null, interval: null, bounds: null, level: null };
    expect(formatPair({ ...planted, y: null })).toEqual({
      status: 'refused',
      text: 'Estimate not shown: the row does not name its two variables.',
      pair: null,
      n: 200,
      ...nothing
    });
    for (const [change, said] of [
      [{ x: '' }, 'the row does not name its two variables'],
      [{ counts: null }, 'the pair does not give the number of complete pairs it used'],
      [{ counts: 12.5 }, 'the pair does not give the number of complete pairs it used'],
      [{ estimate: null }, 'the pair’s estimate is not a number'],
      [{ estimate: 'high' }, 'the pair’s estimate is not a number'],
      [{ estimate: Number.NaN }, 'the pair’s estimate is not a number'],
      [{ lower: null }, 'the interval of the pair’s estimate is incomplete'],
      [{ upper: undefined }, 'the interval of the pair’s estimate is incomplete'],
      [{ level: null }, 'the interval of the pair’s estimate is incomplete'],
      [{ level: 95 }, 'the interval of the pair’s estimate is incomplete']
    ]) {
      const formatted = formatPair({ ...planted, ...change });
      expect(formatted.status, JSON.stringify(change)).toBe('refused');
      expect(formatted.text).toBe(`Estimate not shown: ${said}.`);
      expect(formatted).toMatchObject(nothing);
      // No number of R's is printed in a refusal.
      expect(formatted.text).not.toMatch(/0\.\d/);
    }
    // A pair with too few complete pairs: R's reason, as R worded it, and its count.
    const small = rowsOf('week-12-minimum-183').find((row) => row.status === 'too_small');
    expect(small).toMatchObject({
      counts: 178,
      estimate: null,
      reason: 'Not computed: 178 complete pairs. The minimum is 183.'
    });
    expect(formatPair(small)).toEqual({
      status: 'withheld',
      text: 'Not computed: 178 complete pairs. The minimum is 183. Counts: n = 178.',
      pair: [small.x, small.y],
      n: 178,
      ...nothing
    });
    // A reason that does not say so itself is said to be one.
    expect(formatPair({ ...small, reason: 'the two columns are constant' }).text).toBe(
      'Not computed, the two columns are constant (n = 178).'
    );
    // A reason wins over a number that came with it: no number is printed.
    expect(formatPair({ ...planted, reason: 'Not computed: told not to.' })).toMatchObject({
      status: 'withheld',
      estimate: null
    });
    // R's own error is said to be one.
    expect(formatPair({ ...small, status: 'error', reason: 'object not found' })).toMatchObject({
      status: 'error',
      text: 'R reported an error: object not found (n = 178).',
      estimate: null
    });
    expect(formatPair({ x: 'a', y: 'b', status: 'error' }).text).toBe(
      'R reported an error: no message.'
    );
    expect(formatPair(undefined).status).toBe('refused');
    expect(formatPair('a row').status).toBe('refused');
  });
});
