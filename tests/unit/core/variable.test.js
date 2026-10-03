import { describe, it, expect } from 'vitest';
import { VALUE_TYPES, label, variable } from '../../../src/core/index.js';

// A variable (#8): written one way wherever one is taken, checked where it is
// written, and refused with a message that names what is wrong.

describe('core: a variable', () => {
  it('CORE-VAR-001: a biomarker at a visit and a column are each written one way and returned in full (#8)', () => {
    expect(variable({ measure: 'IL-6', visit: 'Week 4', value: 'change' })).toEqual({
      kind: 'measure',
      measure: 'IL-6',
      visit: 'Week 4',
      value: 'change'
    });
    // With no value type, the result as it was measured.
    expect(variable({ measure: 'TNF-alpha', visit: 'Baseline' })).toEqual({
      kind: 'measure',
      measure: 'TNF-alpha',
      visit: 'Baseline',
      value: 'raw'
    });
    // A baseline value is read at the baseline visits, so it names no visit.
    expect(variable({ measure: 'CRP', value: 'baseline' })).toEqual({
      kind: 'measure',
      measure: 'CRP',
      visit: null,
      value: 'baseline'
    });
    expect(variable({ col: 'ARM' })).toEqual({ kind: 'column', col: 'ARM', type: null });
    expect(variable({ col: 'AGE', type: 'number' })).toEqual({
      kind: 'column',
      col: 'AGE',
      type: 'number'
    });
  });

  it('CORE-VAR-001: the five value types are raw, baseline, change, fold change and percent change (#8)', () => {
    expect(VALUE_TYPES).toEqual(['raw', 'baseline', 'change', 'fold_change', 'percent_change']);
    for (const value of VALUE_TYPES.filter((type) => type !== 'baseline')) {
      expect(variable({ measure: 'IL-6', visit: 'Week 4', value }).value).toBe(value);
    }
  });

  it('CORE-VAR-001: a variable that was returned can be handed back, and cannot be changed (#8)', () => {
    for (const spec of [
      { measure: 'IL-6', visit: 'Week 4', value: 'fold_change' },
      { measure: 'IL-6', value: 'baseline' },
      { col: 'ARM' },
      { col: 'AGE', type: 'number' }
    ]) {
      const read = variable(spec);
      expect(variable(read)).toEqual(read);
      expect(Object.isFrozen(read)).toBe(true);
    }
  });

  it('CORE-VAR-002: a malformed variable is refused with a message naming what is wrong (#8)', () => {
    const refused = (spec) => {
      try {
        variable(spec);
      } catch (error) {
        expect(error).toBeInstanceOf(TypeError);
        return error.message;
      }
      throw new Error(`not refused: ${JSON.stringify(spec)}`);
    };
    expect(refused('ARM')).toMatch(/^bio\.viz: a variable must be an object/);
    expect(refused(null)).toMatch(/must be an object/);
    expect(refused(['ARM'])).toMatch(/must be an object/);
    expect(refused({})).toMatch(
      /must name a biomarker \(`measure`\) or a column \(`col`\), and it names neither/
    );
    expect(refused({ measure: 'IL-6', col: 'ARM', visit: 'Week 4' })).toMatch(/it names both/);
    expect(refused({ measure: '', visit: 'Week 4' })).toMatch(
      /`measure` must be the name of a biomarker/
    );
    expect(refused({ measure: 6, visit: 'Week 4' })).toMatch(/`measure` must be the name/);
    expect(refused({ col: ' ' })).toMatch(/`col` must be the name of a column/);
    expect(refused({ measure: 'IL-6' })).toMatch(
      /must name its visit: `visit` is missing or empty/
    );
    expect(refused({ measure: 'IL-6', visit: 4 })).toMatch(/must name its visit/);
    expect(refused({ measure: 'IL-6', visit: 'Week 4', value: 'delta' })).toMatch(
      /`value` must be one of raw, baseline, change, fold_change, percent_change, and it is "delta"/
    );
    expect(refused({ measure: 'IL-6', visit: 'Week 4', value: 'baseline' })).toMatch(
      /is a baseline value, which is read at the baseline visits named in settings: it takes no `visit`/
    );
    expect(refused({ col: 'ARM', visit: 'Week 4' })).toMatch(
      /is a column, and a column takes no `visit`/
    );
    expect(refused({ col: 'ARM', value: 'change' })).toMatch(/a column takes no `value`/);
    expect(refused({ col: 'AGE', type: 'date' })).toMatch(/`type` can only be 'number'/);
    expect(refused({ measure: 'IL-6', visit: 'Week 4', type: 'number' })).toMatch(
      /is a biomarker, which is always a number: it takes no `type`/
    );
    expect(refused({ measure: 'IL-6', visit: 'Week 4', scale: 'log' })).toMatch(
      /has a key that is not known: scale/
    );
    // The message quotes the variable as it was written.
    expect(refused({ measure: 'IL-6', visit: 'Week 4', value: 'delta' })).toContain(
      '{"measure":"IL-6","visit":"Week 4","value":"delta"}'
    );
  });

  it('CORE-VAR-003: a variable that asks for a cut is no longer refused: it is returned with its cut, for the shared cut rule (#8, #43)', () => {
    expect(variable({ measure: 'CRP', visit: 'Baseline', cut: 'median' }).cut).toBe('median');
    expect(
      variable({ measure: 'CRP', visit: 'Baseline', value: 'change', cut: [2, 5] }).cut
    ).toEqual([2, 5]);
    expect(variable({ col: 'AGE', type: 'number', cut: 'tertiles' }).cut).toBe('tertiles');
    // A column cut must be read as a number (CUT-SPEC-002).
    expect(() => variable({ col: 'AGE', cut: 'tertiles' })).toThrow(/must be read as a number/);
  });

  it('CORE-VAR-009: a variable is named in words for an axis or a legend (#8)', () => {
    expect(label({ col: 'ARM' })).toBe('ARM');
    expect(label({ measure: 'IL-6', visit: 'Week 4' })).toBe('IL-6 at Week 4');
    expect(label({ measure: 'IL-6', value: 'baseline' })).toBe('IL-6 at baseline');
    expect(label({ measure: 'IL-6', visit: 'Week 4', value: 'change' })).toBe(
      'IL-6 at Week 4, change from baseline'
    );
    expect(label({ measure: 'IL-6', visit: 'Week 4', value: 'fold_change' })).toBe(
      'IL-6 at Week 4, fold change from baseline'
    );
    expect(label({ measure: 'IL-6', visit: 'Week 4', value: 'percent_change' })).toBe(
      'IL-6 at Week 4, percent change from baseline'
    );
    expect(() => label({ measure: 'IL-6' })).toThrow(/must name its visit/);
  });
});
