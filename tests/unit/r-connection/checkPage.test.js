import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createConnection } from '../../../src/r/index.js';
import {
  TOLERANCE,
  compareValues,
  parseCsv,
  showNumber,
  withinTolerance
} from '../../../site/r-check/check.mjs';

// The R check page's own logic (#3): how it reads its tables and how it decides
// that what R in the browser returned equals what desktop R returned. The page
// compares numbers R produced with numbers R produced; it computes no statistic.

const read = (file) =>
  readFileSync(new URL(`../../../site/r-check/${file}`, import.meta.url), 'utf8');
const expected = JSON.parse(read('expected.json'));

describe('R check page: comparing two answers from R', () => {
  it('RCON-CHECK-001: two numbers agree when they differ by no more than 1 part in 10^8, and not beyond (#3)', () => {
    expect(TOLERANCE).toEqual({ relative: 1e-8 });
    expect(withinTolerance(0.0003748751105801242, 0.0003748751105801242)).toBe(true);
    // The last digits differ, as two builds of R may: still the same answer.
    expect(withinTolerance(36.150453795869844, 36.15045379586981)).toBe(true);
    expect(withinTolerance(1.412630891109537e-8, 1.4126308911e-8)).toBe(true);
    // A difference in the seventh significant digit is not, however small the number.
    expect(withinTolerance(36.150453795869844, 36.15046)).toBe(false);
    expect(withinTolerance(1.412630891109537e-8, 1.412632e-8)).toBe(false);
    // Zero equals only zero.
    expect(withinTolerance(0, 0)).toBe(true);
    expect(withinTolerance(0, 1e-13)).toBe(false);
    // Not numbers: never equal.
    expect(withinTolerance(Number.NaN, Number.NaN)).toBe(false);
    expect(withinTolerance(1, '1')).toBe(false);
  });

  it('RCON-CHECK-002: every member is compared: numbers by the tolerance, text and structure exactly (#3)', () => {
    const want = {
      method: 'Log-rank test',
      p_value: 1.412630891109537e-8,
      counts: { Placebo: 86, Active: 72 },
      groups: [{ group: 'Placebo', expected: 59.904462385871064 }],
      warnings: []
    };
    const same = compareValues(want, JSON.parse(JSON.stringify(want)));
    expect(same.map((row) => row.path)).toEqual([
      'method',
      'p_value',
      'counts.Placebo',
      'counts.Active',
      'groups[0].group',
      'groups[0].expected',
      'warnings'
    ]);
    expect(same.every((row) => row.ok)).toBe(true);
    expect(same.find((row) => row.path === 'p_value')).toEqual({
      path: 'p_value',
      expected: 1.412630891109537e-8,
      actual: 1.412630891109537e-8,
      difference: 0,
      ok: true
    });

    const failing = (actual) =>
      compareValues(want, actual)
        .filter((row) => !row.ok)
        .map((row) => row.path);
    expect(failing({ ...want, method: 'Log rank test' })).toEqual(['method']);
    expect(failing({ ...want, p_value: 1.5e-8 })).toEqual(['p_value']);
    expect(failing({ ...want, counts: { Placebo: 86, Active: 73 } })).toEqual(['counts.Active']);
    // A member missing from the answer, and one the answer adds, both fail.
    expect(failing({ ...want, counts: { Placebo: 86 } })).toEqual(['counts.Active']);
    expect(failing({ ...want, extra: 1 })).toEqual(['extra']);
    // A table with another number of rows fails as a whole.
    expect(failing({ ...want, groups: [] })).toEqual(['groups']);
    // A warning R raised in the browser but not on the desktop fails.
    expect(failing({ ...want, warnings: ['ties'] })).toEqual(['warnings']);
    expect(failing(null)).toEqual(['(whole value)']);
  });

  it('RCON-CHECK-003: a number is shown in full, so a difference in the last digit is visible (#3)', () => {
    expect(showNumber(0.0003748751105801242)).toBe('0.0003748751105801242');
    expect(showNumber(1.412630891109537e-8)).toBe('1.412630891109537e-8');
    // Two numbers one step apart print differently.
    expect(showNumber(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(showNumber(0.1 + 0.2)).not.toBe(showNumber(0.3));
    expect(showNumber(86)).toBe('86');
  });

  it('RCON-CHECK-004: a table is read from CSV with its numeric columns as numbers and blanks as missing (#3)', () => {
    expect(
      parseCsv('USUBJID,ARM,AVAL\n01-701-1015,Placebo,22\n01-701-1028,Active,\n', ['AVAL'])
    ).toEqual([
      { USUBJID: '01-701-1015', ARM: 'Placebo', AVAL: 22 },
      { USUBJID: '01-701-1028', ARM: 'Active', AVAL: null }
    ]);
    expect(() => parseCsv('A,B\n"x,y",1\n', ['B'])).toThrow(/quoted/);
  });
});

describe('R check page: the committed expected results', () => {
  it('RCON-CHECK-005: the expected results name the script, the R version and the survival version that made them (#3)', () => {
    expect(expected.made_by.script).toBe('tools/r-fixtures.R');
    expect(expected.made_by.r_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(expected.made_by.survival_version).toMatch(/^\d+\.\d+[.-]\d+$/);
    expect(expected.results.map((result) => result.name)).toEqual(['rank_sum', 'log_rank']);
    for (const result of expected.results) {
      expect(typeof result.value.method).toBe('string');
      expect(result.value.p_value).toBeGreaterThan(0);
      expect(result.value.p_value).toBeLessThan(1);
      expect(Object.keys(result.value.counts).length).toBeGreaterThan(1);
    }
  });

  it('RCON-CHECK-006: each expected result is a stored result on its committed table, which the precomputed form answers (#3)', async () => {
    const numeric = { 'alt-week-8.csv': ['AVAL'], 'days-on-study.csv': ['DAYS', 'DISCONTINUED'] };
    const connection = createConnection({ results: expected.results });
    for (const result of expected.results) {
      const data = parseCsv(read(`data/${result.file}`), numeric[result.file]);
      // The row count R recorded is the row count of the committed table.
      expect(data).toHaveLength(result.rows);
      const answer = await connection.run(result.name, {
        data,
        args: result.args,
        dataId: result.dataId
      });
      expect(answer).toEqual({ status: 'ok', value: result.value, form: 'precomputed' });
      expect(compareValues(result.value, answer.value).every((row) => row.ok)).toBe(true);
    }
  });
});
