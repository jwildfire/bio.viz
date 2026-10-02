import { describe, it, expect } from 'vitest';
import { formatStatistic } from '../../../src/r/index.js';

// How a p-value is shown (#2): the design's rules, applied by one function
// whichever chart prints the number. The function formats what R returned; it
// computes nothing.

const counts = { Placebo: 86, 'Xanomeline High Dose': 84 };
const method = 'Wilcoxon rank-sum test';
const countsText = '(Placebo n = 86, Xanomeline High Dose n = 84)';

describe('formatStatistic: the formatted text', () => {
  it('PVAL-FMT-001: an ordinary p-value is shown to three decimals with its method and counts (#2)', () => {
    expect(formatStatistic({ method, p_value: 0.0312, counts })).toEqual({
      status: 'shown',
      text: `Wilcoxon rank-sum test: p = 0.031 ${countsText}. Exploratory, unadjusted.`
    });
    expect(formatStatistic({ method, p_value: 0.25, counts }).text).toContain('p = 0.250 ');
    expect(formatStatistic({ method, p_value: 0.001, counts }).text).toContain('p = 0.001 ');
  });

  it('PVAL-FMT-002: a small p-value is shown as p < 0.001, never as zero (#2)', () => {
    expect(formatStatistic({ method, p_value: 0.00004, counts })).toEqual({
      status: 'shown',
      text: `Wilcoxon rank-sum test: p < 0.001 ${countsText}. Exploratory, unadjusted.`
    });
    expect(formatStatistic({ method, p_value: 0.0009999, counts }).text).toContain('p < 0.001 ');
    expect(formatStatistic({ method, p_value: 0, counts }).text).toContain('p < 0.001 ');
    expect(formatStatistic({ method, p_value: 3.2e-12, counts }).text).not.toMatch(/e-|0\.000/);
  });

  it('PVAL-FMT-003: a p-value that would print as 1.000 is shown as p > 0.999 (#2)', () => {
    expect(formatStatistic({ method, p_value: 0.9997, counts }).text).toContain('p > 0.999 ');
    expect(formatStatistic({ method, p_value: 1, counts }).text).toContain('p > 0.999 ');
    expect(formatStatistic({ method, p_value: 0.9995, counts }).text).toContain('p > 0.999 ');
    expect(formatStatistic({ method, p_value: 0.9994, counts }).text).toContain('p = 0.999 ');
  });

  it('PVAL-FMT-004: counts are printed for each group, or as one total (#2)', () => {
    expect(formatStatistic({ method, p_value: 0.2, counts: 170 }).text).toBe(
      'Wilcoxon rank-sum test: p = 0.200 (n = 170). Exploratory, unadjusted.'
    );
    expect(formatStatistic({ method, p_value: 0.2, counts: { n: 170 } }).text).toContain(
      '(n = 170)'
    );
  });
});

describe('formatStatistic: the rules', () => {
  it('PVAL-RULE-001: a p-value with no method named is refused, and no number is printed (#2)', () => {
    for (const missing of [undefined, null, '', '   ', 42]) {
      const result = formatStatistic({ method: missing, p_value: 0.0312, counts });
      expect(result).toEqual({
        status: 'refused',
        text: 'p-value not shown: the result does not name its method.'
      });
    }
  });

  it('PVAL-RULE-002: a p-value with no counts is refused, and no number is printed (#2)', () => {
    for (const missing of [undefined, null, {}, [], 'many', -1, 1.5, { Placebo: 'some' }]) {
      const result = formatStatistic({ method, p_value: 0.0312, counts: missing });
      expect(result).toEqual({
        status: 'refused',
        text: 'p-value not shown: the result does not give the counts it used.'
      });
    }
  });

  it('PVAL-RULE-003: a result is labelled exploratory and unadjusted unless an adjustment is named (#2)', () => {
    expect(formatStatistic({ method, p_value: 0.0312, counts }).text).toMatch(
      /\. Exploratory, unadjusted\.$/
    );
    expect(formatStatistic({ method, p_value: 0.0312, counts, adjustment: 'Holm' }).text).toBe(
      `Wilcoxon rank-sum test: p = 0.031 ${countsText}. Exploratory, adjusted (Holm).`
    );
    // R's p.adjust calls no adjustment "none".
    expect(formatStatistic({ method, p_value: 0.0312, counts, adjustment: 'none' }).text).toMatch(
      /\. Exploratory, unadjusted\.$/
    );
  });

  it('PVAL-RULE-004: no stars and never the word significant, however small the p-value (#2)', () => {
    for (const p of [0, 1e-300, 0.00001, 0.0009, 0.001, 0.009, 0.01, 0.049, 0.05, 0.051, 0.5, 1]) {
      for (const adjustment of [undefined, 'Holm', 'Benjamini-Hochberg']) {
        const { text } = formatStatistic({ method, p_value: p, counts, adjustment });
        expect(text).not.toContain('*');
        expect(text.toLowerCase()).not.toContain('significan');
      }
    }
  });

  it('PVAL-RULE-005: a group too small to test shows the reason in place of a number (#2)', () => {
    const tooSmall = {
      method,
      reason: 'fewer than 5 participants in Placebo',
      counts: { Placebo: 3, 'Xanomeline High Dose': 84 }
    };
    expect(formatStatistic(tooSmall)).toEqual({
      status: 'withheld',
      text: 'Wilcoxon rank-sum test: not computed, fewer than 5 participants in Placebo (Placebo n = 3, Xanomeline High Dose n = 84).'
    });
    // A reason outranks a number that came with it.
    expect(formatStatistic({ ...tooSmall, p_value: 0.0312 }).text).not.toContain('0.031');
    // The reason is still shown when R sent nothing else.
    expect(formatStatistic({ reason: 'fewer than 5 participants in Placebo' })).toEqual({
      status: 'withheld',
      text: 'Not computed, fewer than 5 participants in Placebo.'
    });
  });

  it('PVAL-RULE-006: a p-value that is not a number between 0 and 1 is refused, not repaired (#2)', () => {
    for (const bad of [undefined, null, Number.NaN, -0.01, 1.01, '0.03', Infinity]) {
      expect(formatStatistic({ method, p_value: bad, counts })).toEqual({
        status: 'refused',
        text: 'p-value not shown: the result has no p-value between 0 and 1.'
      });
    }
    expect(formatStatistic(undefined).status).toBe('refused');
    expect(formatStatistic('p = 0.03').status).toBe('refused');
  });

  it('PVAL-RULE-007: the same result always formats to the same text, and the result is not changed (#2)', () => {
    const statistic = Object.freeze({ method, p_value: 0.0312, counts: Object.freeze(counts) });
    const first = formatStatistic(statistic);
    expect(formatStatistic(statistic)).toEqual(first);
    expect(statistic.p_value).toBe(0.0312);
  });
});
