import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatGroup } from '../../../src/r/index.js';

// One group's result from a result's rows (#26): a coefficient within one
// colour of the association scatter, printed by the rules a whole result is
// held to. The rows here are the ones desktop R returned
// (tests/fixtures/association-statistics-r.json); no number in them was typed.

const fromR = JSON.parse(
  readFileSync(new URL('../../fixtures/association-statistics-r.json', import.meta.url), 'utf8')
);
const rowsOf = (name) => fromR.results.find((result) => result.case === name).value.rows;
const [placebo, treatment] = rowsOf('pearson-by-arm');

describe('formatGroup: one group’s result from a result’s rows', () => {
  it('PVAL-GRP-001: a group’s estimate comes with its interval at the level R gave, and its p-value with its method, the group’s count and its label, by the rules a whole result is held to (#26)', () => {
    expect(placebo.group).toBe('Placebo');
    expect(formatGroup(placebo)).toEqual({
      status: 'shown',
      text:
        "Placebo: 0.5918, 95% confidence interval 0.4474 to 0.7061. Pearson's product-moment " +
        'correlation: p < 0.001 (n = 100). Exploratory, unadjusted.',
      result:
        "0.5918, 95% confidence interval 0.4474 to 0.7061. Pearson's product-moment " +
        'correlation: p < 0.001 (n = 100). Exploratory, unadjusted.',
      group: 'Placebo',
      n: 100,
      estimate: '0.5918',
      interval: '95% confidence interval 0.4474 to 0.7061',
      bounds: '0.4474 to 0.7061',
      level: '95%',
      method: "Pearson's product-moment correlation",
      p: 'p < 0.001',
      adjustment: null,
      label: 'Exploratory, unadjusted.'
    });
    // The numbers are R's, to four significant figures, and nothing else.
    expect(Number(formatGroup(treatment).estimate)).toBe(Number(treatment.estimate.toPrecision(4)));
    expect(formatGroup(treatment).bounds).toBe(
      `${Number(treatment.lower.toPrecision(4))} to ${Number(treatment.upper.toPrecision(4))}`
    );
    // Where R gave no interval, as for Spearman's rho, none is printed or made up.
    const [rank] = rowsOf('spearman-by-arm');
    expect([rank.lower, rank.upper, rank.level]).toEqual([null, null, null]);
    const ranked = formatGroup(rank);
    expect(ranked.status).toBe('shown');
    expect(ranked).toMatchObject({ interval: null, bounds: null, level: null });
    expect(ranked.text).toBe(
      `Placebo: ${ranked.estimate}. Spearman's rank correlation rho: p < 0.001 (n = 100). ` +
        'Exploratory, unadjusted.'
    );
    expect(ranked.text).not.toMatch(/interval/);
    // An ordinary p-value, an adjusted one, and never a star or a verdict.
    expect(formatGroup({ ...placebo, p_value: 0.0312 }).p).toBe('p = 0.031');
    const adjusted = formatGroup({ ...placebo, p_value: 0.0312, adjustment: 'holm' });
    expect(adjusted.adjustment).toBe('Holm');
    expect(adjusted.label).toBe('Exploratory, adjusted (Holm).');
    for (const p of [0, 1e-12, 0.049, 0.05, 1]) {
      const { text } = formatGroup({ ...placebo, p_value: p });
      expect(text).not.toContain('*');
      expect(text.toLowerCase()).not.toContain('significan');
    }
    // It computes nothing: the row is left as it was, and the same row reads the same.
    const before = JSON.stringify(placebo);
    expect(formatGroup(placebo)).toEqual(formatGroup(placebo));
    expect(JSON.stringify(placebo)).toBe(before);
  });

  it('PVAL-GRP-002: a group with no name, no method, no count, no estimate or half an interval is refused, and one R could not compute shows R’s words and no number (#26)', () => {
    const none = {
      estimate: null,
      interval: null,
      bounds: null,
      level: null,
      method: null,
      p: null,
      adjustment: null,
      label: null
    };
    expect(formatGroup({ ...placebo, group: null })).toEqual({
      status: 'refused',
      text: 'p-value not shown: the row does not name its group.',
      result: 'p-value not shown: the row does not name its group.',
      group: null,
      n: 100,
      ...none
    });
    const refusals = [
      [{ method: null }, 'Placebo: p-value not shown: the result does not name its method.'],
      [
        { counts: null },
        'Placebo: p-value not shown: the result does not give the counts it used.'
      ],
      [{ p_value: 1.2 }, 'Placebo: p-value not shown: the result has no p-value between 0 and 1.'],
      [{ estimate: null }, 'Placebo: Estimate not shown: the group’s estimate is not a number.'],
      [
        { upper: null },
        'Placebo: Estimate not shown: the interval of the group’s estimate is incomplete.'
      ],
      [
        { level: 95 },
        'Placebo: Estimate not shown: the interval of the group’s estimate is incomplete.'
      ]
    ];
    for (const [change, text] of refusals) {
      const formatted = formatGroup({ ...placebo, ...change });
      expect(formatted.status, JSON.stringify(change)).toBe('refused');
      expect(formatted.text).toBe(text);
      expect(formatted).toMatchObject(none);
      expect(formatted.text).not.toMatch(/\d\.\d/);
    }
    // Too few pairs in a group: R's reason, as R worded it, once, and its count.
    const small = rowsOf('pearson-age-57-by-arm').find((row) => row.status === 'too_small');
    expect(small).toMatchObject({ group: 'Treatment', counts: 2, estimate: null, p_value: null });
    const withheld = formatGroup(small);
    expect(withheld).toEqual({
      status: 'withheld',
      text: `Treatment: ${small.reason} Counts: n = 2.`,
      result: `${small.reason} Counts: n = 2.`,
      group: 'Treatment',
      n: 2,
      ...none
    });
    expect(withheld.text.match(/not computed/gi)).toHaveLength(1);
    expect(withheld.text).not.toMatch(/p [=<>]/);
    const failed = formatGroup({
      ...placebo,
      status: 'error',
      reason: 'not enough finite observations',
      method: null,
      p_value: null,
      estimate: null
    });
    expect(failed.status).toBe('error');
    expect(failed.text).toBe(
      'Placebo: R reported an error: not enough finite observations (n = 100).'
    );
    expect(formatGroup(undefined).status).toBe('refused');
  });
});
