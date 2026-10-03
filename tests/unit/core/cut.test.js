import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CUTS,
  cutGroup,
  cutLabels,
  cutPoints,
  frame,
  label,
  variable
} from '../../../src/core/index.js';
import { participants, results } from './study.js';

// The shared cut rule (#43, obot.roadmap#359): a continuous variable cut into
// groups at its median, tertiles or quartiles, or at typed points. The points
// are R's quantile(type = 7) and the groups R's cut(right = TRUE), so the
// expected results are desktop R's, written by tools/r-cut.R into
// tests/fixtures/cut-r.json. Nothing here is typed in.

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/cut-r.json', import.meta.url), 'utf8')
);
const cases = fixture.cases;
const studyCases = cases.filter((entry) => entry.variable !== null);

const refused = (spec) => {
  try {
    variable(spec);
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    return error.message;
  }
  throw new Error(`not refused: ${JSON.stringify(spec)}`);
};

// A study case's values as the core's frame resolves them, for the
// participants its filter keeps, in the participant table's order.
const framed = (entry) => {
  const kept = participants.filter((row) =>
    Object.entries(entry.filters || {}).every(([column, values]) => values.includes(row[column]))
  );
  // The frame takes the cut variable as written and resolves it to its number:
  // a cut is a step after the frame, across participants.
  const made = frame({ results, participants: kept }, { v: entry.variable }, { required: [] });
  return made.data.map((record) => [record.USUBJID, record.v]);
};

describe('core: the cut rule', () => {
  it('CUT-SPEC-001: a biomarker or a number column may carry a cut: the median, the tertiles, the quartiles, or typed points in ascending order (#43)', () => {
    expect(CUTS).toEqual(['median', 'tertiles', 'quartiles']);
    for (const cut of CUTS) {
      expect(variable({ measure: 'CRP', visit: 'Baseline', cut })).toEqual({
        kind: 'measure',
        measure: 'CRP',
        visit: 'Baseline',
        value: 'raw',
        cut
      });
    }
    expect(variable({ measure: 'CRP', value: 'baseline', cut: [2, 5] })).toEqual({
      kind: 'measure',
      measure: 'CRP',
      visit: null,
      value: 'baseline',
      cut: [2, 5]
    });
    expect(variable({ col: 'AGE', type: 'number', cut: 'quartiles' })).toEqual({
      kind: 'column',
      col: 'AGE',
      type: 'number',
      cut: 'quartiles'
    });
    // A variable it returned can be handed back to it, and one with no cut has
    // no `cut` key at all.
    const read = variable({ measure: 'CRP', visit: 'Baseline', cut: [1, 3.5] });
    expect(variable(read)).toEqual(read);
    expect(Object.isFrozen(read.cut)).toBe(true);
    expect('cut' in variable({ measure: 'CRP', visit: 'Baseline' })).toBe(false);
    // In words, the cut is said after the variable.
    expect(label({ measure: 'CRP', visit: 'Baseline', cut: 'median' })).toBe(
      'CRP at Baseline, cut at the median'
    );
    expect(label({ measure: 'CRP', visit: 'Baseline', cut: 'tertiles' })).toBe(
      'CRP at Baseline, cut at the tertiles'
    );
    expect(label({ col: 'AGE', type: 'number', cut: [40, 60] })).toBe('AGE, cut at 40 and 60');
    expect(label({ measure: 'CRP', value: 'baseline', cut: [1, 2, 3] })).toBe(
      'CRP at baseline, cut at 1, 2 and 3'
    );
  });

  it('CUT-SPEC-002: a malformed cut is refused with a sentence that names it (#43)', () => {
    const crp = { measure: 'CRP', visit: 'Baseline' };
    expect(refused({ ...crp, cut: 'deciles' })).toBe(
      'bio.viz: the variable {"measure":"CRP","visit":"Baseline","cut":"deciles"}: `cut` must be ' +
        "'median', 'tertiles', 'quartiles' or a list of cut points in ascending order, and it is " +
        '"deciles".'
    );
    expect(refused({ ...crp, cut: [] })).toMatch(
      /`cut` is an empty list: give one cut point or more/
    );
    expect(refused({ ...crp, cut: [5, 2] })).toMatch(
      /the cut points must be in ascending order, each greater than the one before: 5 then 2/
    );
    expect(refused({ ...crp, cut: [2, 2] })).toMatch(
      /the cut points must be in ascending order, each greater than the one before: 2 then 2/
    );
    expect(refused({ ...crp, cut: [1, 'high'] })).toMatch(
      /a cut point must be a finite number, and "high" is not one/
    );
    expect(refused({ ...crp, cut: [1, Infinity] })).toMatch(/a cut point must be a finite number/);
    expect(refused({ ...crp, cut: 2 })).toMatch(/`cut` must be 'median', 'tertiles', 'quartiles'/);
    // A point that is not a number is named as it is, not as JSON writes it.
    expect(refused({ ...crp, cut: [1, NaN] })).toMatch(
      /a cut point must be a finite number, and NaN is not one\.$/
    );
    expect(refused({ ...crp, cut: [1, Infinity] })).toMatch(/and Infinity is not one\.$/);
    expect(refused({ ...crp, cut: [-Infinity, 1] })).toMatch(/and -Infinity is not one\.$/);
    // Typed points that write the same bound ask for groups no label could tell
    // apart.
    expect(refused({ ...crp, cut: [2.7928, 2.793, 2.7932] })).toMatch(
      /the cut points 2\.7928 and 2\.793 are both written 2\.793 to four significant digits, so the groups they make could not be told apart: give points that differ in their first four significant digits\.$/
    );
    expect(refused({ ...crp, cut: [1, 1.00001] })).toMatch(
      /the cut points 1 and 1\.00001 are both written 1 to four/
    );
    expect(variable({ ...crp, cut: [2.792, 2.793] }).cut).toEqual([2.792, 2.793]);
    expect(refused({ col: 'AGE', cut: 'median' })).toBe(
      'bio.viz: the variable {"col":"AGE","cut":"median"} cuts a column, so it must be read as a ' +
        "number: add `type: 'number'`."
    );
  });

  it('CUT-PTS-001: the cut points are R’s quantile(type = 7) on the values, missing ones left out, and typed points are used as written (#43)', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
    for (const entry of cases) {
      const made = cutPoints(entry.values, entry.cut);
      expect(made.n, entry.name).toBe(entry.n);
      // Every number to the last binary place: the same arithmetic as R's.
      expect(made.asked, entry.name).toEqual(entry.asked);
      expect(made.points, entry.name).toEqual(entry.points);
      expect(made.cut, entry.name).toEqual(entry.cut);
    }
  });

  it('CUT-PTS-002: a repeated cut point collapses, and the result says the points repeated (#43)', () => {
    const repeated = cases.filter((entry) => entry.repeated);
    expect(repeated.map((entry) => entry.name)).toEqual([
      'Ties make the quartiles repeat a point, which collapses',
      'Every value the same: one point, and an empty upper group'
    ]);
    for (const entry of cases) {
      const made = cutPoints(entry.values, entry.cut);
      expect(made.repeated, entry.name).toBe(entry.repeated);
      expect(made.points.length, entry.name).toBe(new Set(made.asked).size);
    }
    // With no value there is nothing to cut at: no points and no groups.
    expect(cutPoints([null, NaN, undefined], 'median')).toEqual({
      cut: 'median',
      n: 0,
      asked: [],
      points: [],
      repeated: false,
      merged: false,
      labels: []
    });
  });

  it('CUT-GRP-001: each participant is in the group R’s cut(right = TRUE) puts them in: a value equal to a cut point falls in the lower group, and a missing value in none (#43)', () => {
    for (const entry of cases) {
      const made = cutPoints(entry.values, entry.cut);
      const groups = entry.values.map((value) => {
        const index = cutGroup(value, made.points);
        return index === null ? null : made.labels[index];
      });
      expect(groups, entry.name).toEqual(entry.groups);
      expect(
        made.labels.map((group) => groups.filter((found) => found === group).length),
        entry.name
      ).toEqual(entry.counts);
    }
    // The cases hold values equal to a cut point, repeated points and missing values.
    const equal = cases.filter((entry) =>
      entry.values.some((value) => value !== null && entry.points.includes(value))
    );
    expect(equal.length).toBeGreaterThanOrEqual(3);
    expect(cases.some((entry) => entry.values.includes(null))).toBe(true);
    expect(cutGroup(3, [3])).toBe(0);
    expect(cutGroup(3.0000001, [3])).toBe(1);
    expect(cutGroup(null, [3])).toBe(null);
  });

  it('CUT-LBL-001: groups are ordered low to high and labelled with their bounds, each written to four significant digits as R’s signif() writes it (#43)', () => {
    for (const entry of cases) {
      expect(cutLabels(entry.points), entry.name).toEqual(entry.labels);
      expect(cutPoints(entry.values, entry.cut).labels, entry.name).toEqual(entry.labels);
    }
    expect(cutLabels([2.783])).toEqual(['≤ 2.783', '> 2.783']);
    expect(cutLabels([1, 2])).toEqual(['≤ 1', '> 1, ≤ 2', '> 2']);
    // R rounds a tie to even: 2.0625 to four digits is 2.062.
    expect(cutLabels([2.0625])).toEqual(['≤ 2.062', '> 2.062']);
    expect(cutLabels([])).toEqual([]);
  });

  it('CUT-LBL-002: a bound however small or large is written in full with no trailing zero, as R’s format(scientific = FALSE) writes it (#43, #46)', () => {
    const far = [
      'A point that is rounding noise next to zero is written in full, with no trailing zero',
      'Very small and very large typed points are written in full, as R writes them'
    ];
    for (const name of far) {
      const entry = cases.find((found) => found.name === name);
      expect(entry, name).toBeDefined();
      expect(cutLabels(entry.points), name).toEqual(entry.labels);
    }
    // R's own words for them, as tools/r-cut.R recorded them.
    const noise = cases.find((found) => found.name === far[0]);
    expect(noise.points[0]).toBe(1.1102230246251565e-16);
    expect(noise.labels[0]).toBe('≤ 0.000000000000000111');
    expect(cases.find((found) => found.name === far[1]).labels.at(-1)).toBe(
      '> 3382000000000000000000'
    );
    expect(cutLabels([1e-7])).toEqual(['≤ 0.0000001', '> 0.0000001']);
    expect(cutLabels([-1.2e-7, 0])).toEqual(['≤ -0.00000012', '> -0.00000012, ≤ 0', '> 0']);
    expect(cutLabels([0.5, 12.5])).toEqual(['≤ 0.5', '> 0.5, ≤ 12.5', '> 12.5']);
    // Nothing a double holds is refused for its size.
    for (const point of [1e-150, 1e-300, Number.MIN_VALUE, 1e300, Number.MAX_VALUE]) {
      expect(() => cutLabels([point]), String(point)).not.toThrow();
    }
  });

  it('CUT-GRP-002: distinct points written alike make groups with the same label, which are one group, as R’s cut() merges levels with the same label, and the result says they merged (#43, #46)', () => {
    const merged = cases.filter((entry) => entry.merged);
    expect(merged.map((entry) => entry.name)).toEqual([
      'Distinct quantile points written alike make groups with the same label, which merge'
    ]);
    for (const entry of cases) {
      expect(cutPoints(entry.values, entry.cut).merged, entry.name).toBe(entry.merged);
    }
    const [entry] = merged;
    const made = cutPoints(entry.values, entry.cut);
    expect(made.points).toEqual([2.7928000000000002, 2.7930000000000001, 2.7932000000000001]);
    expect(made.labels).toEqual(['≤ 2.793', '> 2.793, ≤ 2.793', '> 2.793']);
    expect(entry.labels).toEqual(made.labels);
    expect(entry.counts).toEqual([2, 2, 1]);
    // The two groups between the three points are one: the second.
    expect(made.points.map((point) => cutGroup(point + 1e-9, made.points))).toEqual([1, 1, 2]);
  });

  it('CUT-STUDY-001: on the synthetic study, the frame’s values of the cut variable, for the participants the filters keep, are R’s, and so are the points and the groups (#43)', () => {
    expect(studyCases.map((entry) => entry.name)).toEqual([
      'CRP at Baseline, cut at the median',
      'CRP at Baseline, cut at the tertiles',
      'CRP at Baseline, cut at the quartiles',
      'CRP at Baseline, cut at 2 and 5',
      'IL-6 at baseline, cut at the median, for women',
      'Age, cut at the quartiles: whole years, so values equal to a cut point'
    ]);
    for (const entry of studyCases) {
      const rows = framed(entry);
      expect(
        rows.map(([id]) => id),
        entry.name
      ).toEqual(entry.ids);
      const values = rows.map(([, value]) => value);
      expect(values, entry.name).toEqual(entry.values);
      const made = cutPoints(values, variable(entry.variable).cut);
      expect(made.points, entry.name).toEqual(entry.points);
      expect(
        values.map((value) => {
          const index = cutGroup(value, made.points);
          return index === null ? null : made.labels[index];
        }),
        entry.name
      ).toEqual(entry.groups);
    }
  });

  it('CUT-DOC-001: the R recipe in the core’s reference is, line for line, the one tools/r-cut.R runs to make the expected results (#43)', () => {
    const reference = readFileSync(new URL('../../../docs/core.md', import.meta.url), 'utf8');
    const script = readFileSync(new URL('../../../tools/r-cut.R', import.meta.url), 'utf8');
    const section = reference.slice(reference.indexOf('## The cut rule'));
    const recipe = section.match(/```r\n([\s\S]*?)```/)[1];
    expect(recipe).toContain('stats::quantile(x, CUT_PROBS[[cut]], type = 7');
    expect(recipe).toContain('cut(x, breaks = c(-Inf, points, Inf), right = TRUE');
    expect(script).toContain(recipe);
  });
});
