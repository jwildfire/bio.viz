import { describe, it, expect } from 'vitest';
import {
  formatComparison,
  formatEstimate,
  formatMedian,
  formatStatistic
} from '../../../src/r/index.js';

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

// What gsm.bio's Analyze_GroupDifference returns (#16): a status, R's reason as
// a whole sentence, estimates with intervals, and pairwise rows.

describe('formatStatistic: what R declined, and what R could not do', () => {
  const tooSmall = {
    status: 'too_small',
    reason: 'Not computed: Treatment has 3. The minimum group size is 5.',
    test: 't',
    method: null,
    p_value: null,
    adjustment: 'none',
    counts: { Placebo: 95, Treatment: 3 }
  };

  it('PVAL-RULE-008: a reason that already says the result was not computed is printed as it is, and "not computed" is said once (#16)', () => {
    const formatted = formatStatistic(tooSmall);
    expect(formatted).toEqual({
      status: 'withheld',
      text: 'Not computed: Treatment has 3. The minimum group size is 5. Counts: Placebo n = 95, Treatment n = 3.'
    });
    expect(formatted.text.match(/not computed/gi)).toHaveLength(1);
    // The sentence the two halves used to make between them (#15).
    expect(
      formatStatistic({ ...tooSmall, method: 'Welch Two Sample t-test' }).text.match(
        /not computed/gi
      )
    ).toHaveLength(1);
    // With no counts the sentence stands alone, with its own full stop.
    expect(formatStatistic({ reason: tooSmall.reason }).text).toBe(tooSmall.reason);
    // No number, whatever else came with the reason.
    expect(formatStatistic({ ...tooSmall, p_value: 0.0312 }).text).not.toContain('0.031');
    // A reason in the formatter's own style is still led in by the method.
    expect(
      formatStatistic({ method: 'Welch Two Sample t-test', reason: 'too few participants' }).text
    ).toBe('Welch Two Sample t-test: not computed, too few participants.');
  });

  it('PVAL-RULE-009: a result R marked as an error is printed as R’s message, said to be an error, with no number (#16)', () => {
    const failed = {
      status: 'error',
      reason: "Column 'y' (strValueCol) is not numeric.",
      method: null,
      p_value: null,
      counts: null
    };
    expect(formatStatistic(failed)).toEqual({
      status: 'error',
      text: "R reported an error: Column 'y' (strValueCol) is not numeric."
    });
    // The counts are printed where R knew them.
    expect(
      formatStatistic({ ...failed, reason: 'not enough observations', counts: { A: 2, B: 9 } })
    ).toEqual({
      status: 'error',
      text: 'R reported an error: not enough observations (A n = 2, B n = 9).'
    });
    expect(formatStatistic({ status: 'error', p_value: 0.01, method, counts }).text).toBe(
      `R reported an error: no message ${countsText}.`
    );
  });

  it('PVAL-RULE-010: an adjustment R names by its p.adjust method is printed by its usual name, and any other name as given (#16)', () => {
    const label = (adjustment) =>
      formatStatistic({ method, p_value: 0.0312, counts, adjustment }).text.split('). ')[1];
    expect(label('holm')).toBe('Exploratory, adjusted (Holm).');
    expect(label('BH')).toBe('Exploratory, adjusted (Benjamini-Hochberg).');
    expect(label('fdr')).toBe('Exploratory, adjusted (Benjamini-Hochberg).');
    expect(label('BY')).toBe('Exploratory, adjusted (Benjamini-Yekutieli).');
    expect(label('bonferroni')).toBe('Exploratory, adjusted (Bonferroni).');
    expect(label('hochberg')).toBe('Exploratory, adjusted (Hochberg).');
    expect(label('hommel')).toBe('Exploratory, adjusted (Hommel).');
    expect(label('Dunnett')).toBe('Exploratory, adjusted (Dunnett).');
    expect(label('none')).toBe('Exploratory, unadjusted.');
    // A name is looked up, never run: one that is also a property of every object is a name.
    expect(label('constructor')).toBe('Exploratory, adjusted (constructor).');
  });
});

describe('formatEstimate: an estimate and its interval', () => {
  const difference = {
    name: 'Difference in means',
    group: 'Placebo - Treatment',
    estimate: 1.2350450049999998,
    lower: 0.8440141032,
    upper: 1.626075907,
    level: 0.95
  };

  it('PVAL-EST-001: an estimate is printed with its name, what it is an estimate of, and its interval with the level R gave, to four significant figures (#16)', () => {
    expect(formatEstimate(difference)).toEqual({
      status: 'shown',
      text: 'Difference in means (Placebo - Treatment): 1.235, 95% confidence interval 0.844 to 1.626.'
    });
    // A level that is not a whole percent is printed as it is.
    expect(formatEstimate({ ...difference, level: 0.975 }).text).toContain(
      '97.5% confidence interval'
    );
    // An estimate R gave no interval for is printed without one.
    expect(
      formatEstimate({
        name: 'Mean',
        group: 'Placebo',
        estimate: 0.024726315,
        lower: null,
        upper: null,
        level: null
      })
    ).toEqual({ status: 'shown', text: 'Mean (Placebo): 0.02473.' });
    expect(formatEstimate({ name: 'Median', estimate: -12 }).text).toBe('Median: -12.');
    // Nothing is computed: the estimate handed in is not changed.
    const frozen = Object.freeze({ ...difference });
    expect(formatEstimate(frozen)).toEqual(formatEstimate(difference));
  });

  it('PVAL-EST-002: an estimate with no name or no number, or with half an interval, is refused and nothing is printed in its place (#16)', () => {
    expect(formatEstimate({ ...difference, name: '' })).toEqual({
      status: 'refused',
      text: 'Estimate not shown: it has no name.'
    });
    for (const bad of [undefined, null, Number.NaN, Infinity, '1.2']) {
      expect(formatEstimate({ ...difference, estimate: bad })).toEqual({
        status: 'refused',
        text: 'Estimate not shown: Difference in means is not a number.'
      });
    }
    for (const half of [{ lower: null }, { upper: undefined }, { level: null }, { level: 95 }]) {
      const formatted = formatEstimate({ ...difference, ...half });
      expect(formatted).toEqual({
        status: 'refused',
        text: 'Estimate not shown: the interval of Difference in means is incomplete.'
      });
      expect(formatted.text).not.toMatch(/\d/);
    }
    expect(formatEstimate(undefined).status).toBe('refused');
  });
});

describe('formatComparison: one pair of groups from a result’s rows', () => {
  const pair = {
    group_1: 'Placebo F',
    group_2: 'Treatment F',
    n_1: 42,
    n_2: 42,
    counts: 84,
    method: 'Welch Two Sample t-test',
    p_unadjusted: 0.0001635767,
    p_value: 0.00049073,
    adjustment: 'holm',
    status: 'ok',
    reason: null,
    warning: null
  };

  it('PVAL-ROW-001: a pair’s p-value comes with its method, the two groups’ counts and its adjustment label, by the rules a whole result is held to (#16)', () => {
    expect(formatComparison(pair)).toEqual({
      status: 'shown',
      text: 'Placebo F and Treatment F: Welch Two Sample t-test: p < 0.001 (Placebo F n = 42, Treatment F n = 42). Exploratory, adjusted (Holm).',
      result:
        'Welch Two Sample t-test: p < 0.001 (Placebo F n = 42, Treatment F n = 42). Exploratory, adjusted (Holm).',
      groups: ['Placebo F', 'Treatment F'],
      n: [42, 42],
      method: 'Welch Two Sample t-test',
      p: 'p < 0.001',
      adjustment: 'Holm',
      label: 'Exploratory, adjusted (Holm).'
    });
    // The adjusted p-value is the one printed, never the unadjusted one.
    expect(formatComparison({ ...pair, p_value: 0.0312, p_unadjusted: 0.0052 }).p).toBe(
      'p = 0.031'
    );
    expect(formatComparison({ ...pair, p_value: 1 }).p).toBe('p > 0.999');
    const unadjusted = formatComparison({ ...pair, adjustment: 'none' });
    expect(unadjusted.label).toBe('Exploratory, unadjusted.');
    expect(unadjusted.adjustment).toBe(null);
    for (const p of [0, 1e-12, 0.049, 0.05, 1]) {
      const { text } = formatComparison({ ...pair, p_value: p });
      expect(text).not.toContain('*');
      expect(text.toLowerCase()).not.toContain('significan');
    }
  });

  it('PVAL-ROW-002: a pair with no method, no counts or no groups is refused, and one R could not compute shows R’s words and no number (#16)', () => {
    const noMethod = formatComparison({ ...pair, method: null });
    expect(noMethod.status).toBe('refused');
    expect(noMethod.p).toBe(null);
    expect(noMethod.text).toBe(
      'Placebo F and Treatment F: p-value not shown: the result does not name its method.'
    );
    const noCounts = formatComparison({ ...pair, n_2: null });
    expect(noCounts.status).toBe('refused');
    expect(noCounts.n).toBe(null);
    expect(noCounts.p).toBe(null);
    const noGroups = formatComparison({ ...pair, group_2: null });
    expect(noGroups).toEqual({
      status: 'refused',
      text: 'p-value not shown: the comparison does not name its two groups.',
      result: 'p-value not shown: the comparison does not name its two groups.',
      groups: null,
      n: null,
      method: null,
      p: null,
      adjustment: null,
      label: null
    });
    const failed = formatComparison({
      ...pair,
      status: 'error',
      reason: 'not enough observations',
      method: null,
      p_value: null
    });
    expect(failed.status).toBe('error');
    expect(failed.p).toBe(null);
    expect(failed.text).toBe(
      'Placebo F and Treatment F: R reported an error: not enough observations (Placebo F n = 42, Treatment F n = 42).'
    );
    expect(failed.result).toBe(
      'R reported an error: not enough observations (Placebo F n = 42, Treatment F n = 42).'
    );
    expect(formatComparison(undefined).status).toBe('refused');
  });
});

describe('the formatter in the README', () => {
  it('PVAL-FMT-005: the README’s example prints what formatStatistic prints for desktop R’s own Wilcoxon answer, R’s method name as R wrote it (#49)', async () => {
    const { readFileSync } = await import('node:fs');
    const read = (file) => readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
    const expected = JSON.parse(read('site/r-check/expected.json'));
    const rankSum = expected.results.find((result) => result.name === 'rank_sum');
    const printed = formatStatistic(rankSum.value).text;
    expect(printed).toMatch(/^Wilcoxon rank sum test with continuity correction: p /);
    expect(read('README.md')).toContain(`// "${printed}"`);
    // The comment in the source names a method as R names it.
    expect(read('src/r/formatStatistic.js')).toContain(
      'e.g. "Wilcoxon rank sum test with continuity correction"'
    );
  });
});

// A median survival time R returned (#61): R gives none, or no bound, where the
// curve or its band did not fall to one half, and says so in its note.
describe('formatMedian: a median survival time', () => {
  const median = {
    name: 'Median',
    group: '> 2.783',
    estimate: 8.28,
    lower: 5.24,
    upper: 9.71,
    level: 0.95
  };

  it('PVAL-MED-001: a median is printed with what it is a median of and its interval, to four significant figures, and a median or bound R did not reach reads not reached (#61)', () => {
    expect(formatMedian(median)).toEqual({
      status: 'shown',
      text: 'Median (> 2.783): 8.28, 95% confidence interval 5.24 to 9.71.'
    });
    expect(formatMedian({ ...median, upper: null }).text).toBe(
      'Median (> 2.783): 8.28, 95% confidence interval 5.24 to not reached.'
    );
    expect(formatMedian({ ...median, estimate: null, upper: null, lower: 19.63 }).text).toBe(
      'Median (> 2.783): not reached, 95% confidence interval 19.63 to not reached.'
    );
    expect(formatMedian({ ...median, estimate: null, lower: null, upper: null }).text).toBe(
      'Median (> 2.783): not reached, 95% confidence interval not reached.'
    );
    // Nothing is computed: the median handed in is not changed.
    const frozen = Object.freeze({ ...median });
    expect(formatMedian(frozen)).toEqual(formatMedian(median));
  });

  it('PVAL-MED-002: a median with no name, a value that is neither a number nor missing, or no level for its interval, is refused, and no number is printed in its place (#61)', () => {
    expect(formatMedian({ ...median, name: '' })).toEqual({
      status: 'refused',
      text: 'Estimate not shown: it has no name.'
    });
    expect(formatMedian({ ...median, estimate: 'eight' }).status).toBe('refused');
    expect(formatMedian({ ...median, lower: Number.NaN }).status).toBe('refused');
    expect(formatMedian({ ...median, level: null })).toEqual({
      status: 'refused',
      text: 'Estimate not shown: the interval of Median has no level.'
    });
  });
});
