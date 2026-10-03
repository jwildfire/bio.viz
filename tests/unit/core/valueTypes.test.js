import { describe, it, expect } from 'vitest';
import { DROPPED, frame } from '../../../src/core/index.js';
import { participants, results, written } from './study.js';

// The five value types (#8), each held to values worked out here, by hand, from
// the rows of the vendored synthetic study. Nothing below calls the code under
// test to get an expected value: `written` reads STRESN off the one row for a
// participant, biomarker and visit, and the arithmetic is spelled out.

const ids = participants.map((row) => row.USUBJID);
const SETTINGS = { baseline_visits: ['Baseline'] };

// One field, `y`, for one variable; returned as id -> value.
function valuesOf(spec, settings = SETTINGS) {
  const { data } = frame({ results }, { y: spec }, settings);
  return Object.fromEntries(data.map((row) => [row.USUBJID, row.y]));
}

// What a value type should give for everyone, from the file's own text.
function byHand(measure, visit, compute) {
  const expected = {};
  for (const id of ids) {
    const at = written(id, measure, visit);
    const baseline = written(id, measure, 'Baseline');
    if (at === undefined || at === '' || baseline === undefined || baseline === '') continue;
    expected[id] = compute(Number(at), Number(baseline));
  }
  return expected;
}

describe('core: value types on the synthetic study', () => {
  it('CORE-VAR-004: raw is the result as the table holds it at the visit (#8)', () => {
    const got = valuesOf({ measure: 'IL-6', visit: 'Week 4', value: 'raw' });
    // The first participant's row reads BIO-001,Week 4,4,IL-6,pg/mL,5.9.
    expect(written('BIO-001', 'IL-6', 'Week 4')).toBe('5.9');
    expect(got['BIO-001']).toBe(5.9);
    expect(got).toEqual(byHand('IL-6', 'Week 4', (at) => at));
    expect(Object.keys(got)).toHaveLength(186);
    // A biomarker whose name is not an identifier is found by its name as written.
    expect(valuesOf({ measure: 'TNF-alpha', visit: 'Baseline' })['BIO-001']).toBe(
      Number(written('BIO-001', 'TNF-alpha', 'Baseline'))
    );
  });

  it('CORE-VAR-005: baseline is the result at the baseline visit named in settings (#8)', () => {
    const got = valuesOf({ measure: 'IL-6', value: 'baseline' });
    expect(written('BIO-001', 'IL-6', 'Baseline')).toBe('6.927');
    expect(got['BIO-001']).toBe(6.927);
    const expected = Object.fromEntries(
      ids.map((id) => [id, Number(written(id, 'IL-6', 'Baseline'))])
    );
    expect(got).toEqual(expected);
    expect(Object.keys(got)).toHaveLength(200);
  });

  it('CORE-VAR-005: with no baseline visit named, the first visit in visit order is the baseline (#8)', () => {
    const named = frame({ results }, { y: { measure: 'IL-6', value: 'baseline' } }, SETTINGS);
    const unnamed = frame({ results }, { y: { measure: 'IL-6', value: 'baseline' } });
    expect(unnamed.baseline_visits).toEqual(['Baseline']);
    expect(unnamed.data).toEqual(named.data);
    // The order is VISITNUM's, not the alphabet's or the table's: with the rows
    // reversed, and Week 12 sorting before Week 2 by name, it is still Baseline.
    const reversed = frame(
      { results: [...results].reverse() },
      { y: { measure: 'IL-6', value: 'baseline' } }
    );
    expect(reversed.baseline_visits).toEqual(['Baseline']);
    // Without the order column the visits are ordered by name, numbers as numbers.
    const unordered = results
      .filter((row) => row.VISIT !== 'Baseline')
      .map(({ VISITNUM, ...row }) => row);
    expect(unordered.some((row) => 'VISITNUM' in row)).toBe(false);
    expect(
      frame({ results: unordered }, { y: { measure: 'IL-6', value: 'baseline' } }).baseline_visits
    ).toEqual(['Week 2']);
  });

  it('CORE-VAR-005: several baseline visits are brought to one value by their mean, or by the statistic named (#8)', () => {
    const spec = { measure: 'IL-6', value: 'baseline' };
    const visits = { baseline_visits: ['Baseline', 'Week 2'] };
    // BIO-001: 6.927 at Baseline and 5.473 at Week 2.
    expect(written('BIO-001', 'IL-6', 'Week 2')).toBe('5.473');
    expect(valuesOf(spec, visits)['BIO-001']).toBe((6.927 + 5.473) / 2);
    expect(valuesOf(spec, { ...visits, baseline_stat: 'mean' })['BIO-001']).toBe(
      (6.927 + 5.473) / 2
    );
    expect(valuesOf(spec, { ...visits, baseline_stat: 'min' })['BIO-001']).toBe(5.473);
    expect(valuesOf(spec, { ...visits, baseline_stat: 'max' })['BIO-001']).toBe(6.927);
    expect(valuesOf(spec, { ...visits, baseline_stat: 'first' })['BIO-001']).toBe(6.927);
    // First is the first visit as named in settings, whatever the table's order.
    expect(
      valuesOf(spec, { baseline_visits: ['Week 2', 'Baseline'], baseline_stat: 'first' })['BIO-001']
    ).toBe(5.473);

    // A participant with a result at only one of the baseline visits keeps that one.
    const oneOnly = ids.find((id) => {
      const second = written(id, 'IL-6', 'Week 2');
      return second === undefined || second === '';
    });
    expect(oneOnly).toBeDefined();
    expect(valuesOf(spec, visits)[oneOnly]).toBe(Number(written(oneOnly, 'IL-6', 'Baseline')));
  });

  it('CORE-VAR-006: change is the result at the visit minus the baseline (#8)', () => {
    const got = valuesOf({ measure: 'IL-6', visit: 'Week 4', value: 'change' });
    expect(got['BIO-001']).toBe(5.9 - 6.927);
    expect(got['BIO-001']).toBeCloseTo(-1.027, 12);
    expect(got).toEqual(byHand('IL-6', 'Week 4', (at, baseline) => at - baseline));
    expect(Object.keys(got)).toHaveLength(186);
  });

  it('CORE-VAR-007: fold change is the result at the visit divided by the baseline (#8)', () => {
    const got = valuesOf({ measure: 'IL-6', visit: 'Week 4', value: 'fold_change' });
    expect(got['BIO-001']).toBe(5.9 / 6.927);
    expect(got['BIO-001']).toBeCloseTo(0.85174, 5);
    expect(got).toEqual(byHand('IL-6', 'Week 4', (at, baseline) => at / baseline));
  });

  it('CORE-VAR-008: percent change is one hundred times the change divided by the baseline (#8)', () => {
    const got = valuesOf({ measure: 'IL-6', visit: 'Week 4', value: 'percent_change' });
    expect(got['BIO-001']).toBe((100 * (5.9 - 6.927)) / 6.927);
    expect(got['BIO-001']).toBeCloseTo(-14.826, 4);
    expect(got).toEqual(
      byHand('IL-6', 'Week 4', (at, baseline) => (100 * (at - baseline)) / baseline)
    );
  });

  it('CORE-VAR-007, CORE-VAR-008: a baseline of zero, or below it, gives no fold or percent change, and the participant is counted (#8)', () => {
    const rows = [
      { USUBJID: 'A', VISIT: 'Baseline', VISITNUM: 0, TEST: 'X', STRESN: 2 },
      { USUBJID: 'A', VISIT: 'Week 4', VISITNUM: 4, TEST: 'X', STRESN: 3 },
      { USUBJID: 'B', VISIT: 'Baseline', VISITNUM: 0, TEST: 'X', STRESN: 0 },
      { USUBJID: 'B', VISIT: 'Week 4', VISITNUM: 4, TEST: 'X', STRESN: 3 },
      { USUBJID: 'C', VISIT: 'Baseline', VISITNUM: 0, TEST: 'X', STRESN: -2 },
      { USUBJID: 'C', VISIT: 'Week 4', VISITNUM: 4, TEST: 'X', STRESN: 3 },
      { USUBJID: 'D', VISIT: 'Baseline', VISITNUM: 0, TEST: 'X', STRESN: 4 },
      { USUBJID: 'D', VISIT: 'Week 4', VISITNUM: 4, TEST: 'X', STRESN: 0 }
    ];
    for (const [value, expected] of [
      ['fold_change', [1.5, 0]],
      ['percent_change', [50, -100]]
    ]) {
      const got = frame({ results: rows }, { y: { measure: 'X', visit: 'Week 4', value } });
      expect(got.data).toEqual([
        { USUBJID: 'A', y: expected[0] },
        { USUBJID: 'D', y: expected[1] }
      ]);
      expect(got.dropped).toEqual([
        { reason: DROPPED.ZERO_BASELINE, variable: 'y', n: 1 },
        { reason: DROPPED.NEGATIVE_BASELINE, variable: 'y', n: 1 }
      ]);
    }
    // Change is a difference, and a difference from zero or from below it is still one.
    const change = frame(
      { results: rows },
      { y: { measure: 'X', visit: 'Week 4', value: 'change' } }
    );
    expect(change.data.map((row) => row.y)).toEqual([1, 3, 5, -4]);
    expect(change.dropped).toEqual([]);
  });

  it('CORE-VAR-006: a participant with no baseline result has no change, fold change or percent change, and is counted (#8)', () => {
    const rows = [
      { USUBJID: 'A', VISIT: 'Screening', VISITNUM: -1, TEST: 'X', STRESN: 2 },
      { USUBJID: 'A', VISIT: 'Week 4', VISITNUM: 4, TEST: 'X', STRESN: 3 },
      { USUBJID: 'B', VISIT: 'Week 4', VISITNUM: 4, TEST: 'X', STRESN: 3 },
      { USUBJID: 'C', VISIT: 'Screening', VISITNUM: -1, TEST: 'X', STRESN: 'NA' },
      { USUBJID: 'C', VISIT: 'Week 4', VISITNUM: 4, TEST: 'X', STRESN: 3 }
    ];
    for (const value of ['change', 'fold_change', 'percent_change', 'baseline']) {
      const spec =
        value === 'baseline' ? { measure: 'X', value } : { measure: 'X', visit: 'Week 4', value };
      const got = frame({ results: rows }, { y: spec }, { baseline_visits: 'Screening' });
      expect(got.baseline_visits).toEqual(['Screening']);
      expect(got.data.map((row) => row.USUBJID)).toEqual(['A']);
      expect(got.dropped).toEqual([
        { reason: DROPPED.NO_BASELINE, variable: 'y', n: 1 },
        { reason: DROPPED.MISSING_BASELINE, variable: 'y', n: 1 }
      ]);
    }
  });
});
