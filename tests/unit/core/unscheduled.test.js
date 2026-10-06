import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as core from '../../../src/core/index.js';
import { results } from './study.js';

// Unscheduled visits (#84): safety.viz's rule, under safety.viz's setting
// names, carried here because safety.viz's kit does not share it. The copy is
// held to safety.viz's own code, read out of the bundle vendored beside it.

const { UNSCHEDULED_DEFAULTS, isUnscheduledVisit, scheduledResults } = core;

const vendored = new URL('../../../site/vendor/safety.viz/', import.meta.url);
const bundle = readFileSync(new URL('safety.viz.js', vendored), 'utf8');
const record = JSON.parse(readFileSync(new URL('SOURCE.json', vendored), 'utf8'));

// safety.viz's own functions: the part of its bundle that was its file
// src/unscheduled-visits.js, from that file's marker to the next file's.
function safetyVizRule() {
  const from = bundle.indexOf('// src/unscheduled-visits.js');
  expect(from).toBeGreaterThan(0);
  const to = bundle.indexOf('\n  // src/', from + 1);
  const code = bundle.slice(from, to);
  expect(code).toContain('function isUnscheduledVisit(visit, settings)');
  // A file of three plain functions: nothing of a page is reached by running it.
  return new Function(`${code}\nreturn { parseUnscheduledPattern, isUnscheduledVisit };`)();
}

const VISITS = [
  'Screening',
  'Baseline',
  'Week 2',
  'Week 12',
  'Unscheduled',
  'Unscheduled 1',
  'UNSCHEDULED 3.01',
  'unscheduled visit',
  'Early Termination',
  'EARLY TERMINATION',
  'Early Term',
  'End of Treatment',
  'Follow-up',
  'Retest',
  '',
  '12',
  12
];

describe('core: which visits are unscheduled', () => {
  it('CORE-VISIT-001: a visit is unscheduled when a list names it, and with no list when its name matches the pattern; a list decides alone, an empty one means no visit, and with neither no visit is unscheduled (#84)', () => {
    const byDefault = (visit) => isUnscheduledVisit(visit, UNSCHEDULED_DEFAULTS);
    expect(VISITS.filter(byDefault)).toEqual([
      'Unscheduled',
      'Unscheduled 1',
      'UNSCHEDULED 3.01',
      'unscheduled visit',
      'Early Termination',
      'EARLY TERMINATION'
    ]);
    // A list wins over the pattern: only what it names, matched by name.
    const listed = { ...UNSCHEDULED_DEFAULTS, unscheduled_visit_values: ['Retest', 12] };
    expect(VISITS.filter((visit) => isUnscheduledVisit(visit, listed))).toEqual([
      'Retest',
      '12',
      12
    ]);
    expect(isUnscheduledVisit('Unscheduled 1', listed)).toBe(false);
    expect(isUnscheduledVisit('retest', listed)).toBe(false);
    // An empty list is a list: no visit is unscheduled.
    const none = { ...UNSCHEDULED_DEFAULTS, unscheduled_visit_values: [] };
    expect(VISITS.filter((visit) => isUnscheduledVisit(visit, none))).toEqual([]);
    // A pattern is `/source/flags`, or a plain source, which is case sensitive.
    expect(isUnscheduledVisit('Retest 2', { unscheduled_visit_pattern: '/^retest/i' })).toBe(true);
    expect(isUnscheduledVisit('Retest 2', { unscheduled_visit_pattern: '^retest' })).toBe(false);
    expect(isUnscheduledVisit('Retest 2', { unscheduled_visit_pattern: '^Retest' })).toBe(true);
    // Neither: nothing is unscheduled.
    expect(isUnscheduledVisit('Unscheduled 1', {})).toBe(false);
    expect(isUnscheduledVisit('Unscheduled 1')).toBe(false);
    expect(
      isUnscheduledVisit('Unscheduled 1', {
        unscheduled_visit_pattern: null,
        unscheduled_visit_values: null
      })
    ).toBe(false);
  });

  it('CORE-VISIT-002: the settings carry safety.viz’s names and the defaults of its results over time chart, and the rule answers as safety.viz’s own does, read from the vendored bundle (#84)', () => {
    expect(UNSCHEDULED_DEFAULTS).toEqual({
      unscheduled_visits: false,
      unscheduled_visit_pattern: '/unscheduled|early termination/i',
      unscheduled_visit_values: null
    });
    expect(Object.isFrozen(UNSCHEDULED_DEFAULTS)).toBe(true);
    // safety.viz's results over time chart's defaults, in the bundle vendored
    // here: the three settings in a row, with unscheduled visits off.
    const theirs = bundle.match(
      /unscheduled_visits: false,\s*unscheduled_visit_pattern: "([^"]*)",\s*unscheduled_visit_values: null/
    );
    expect(theirs).not.toBe(null);
    expect(UNSCHEDULED_DEFAULTS.unscheduled_visit_pattern).toBe(theirs[1]);
    // Every default pattern in the bundle is that one: safety.viz has one rule.
    const everyPattern = [...bundle.matchAll(/unscheduled_visit_pattern: "([^"]*)"/g)].map(
      (found) => found[1]
    );
    expect(everyPattern.length).toBeGreaterThan(1);
    expect(new Set(everyPattern)).toEqual(new Set([theirs[1]]));
    // The copy says which safety.viz it was copied from: the vendored commit.
    const source = readFileSync(
      new URL('../../../src/core/unscheduled.js', import.meta.url),
      'utf8'
    );
    expect(source).toContain(`safety.viz commit ${record.commit}`);

    // The two rules side by side, on every visit under every kind of setting.
    const safetyViz = safetyVizRule();
    const cases = [
      UNSCHEDULED_DEFAULTS,
      { unscheduled_visit_pattern: '/unscheduled|early termination/i' },
      { unscheduled_visit_pattern: 'Unscheduled' },
      { unscheduled_visit_pattern: '/^week \\d+$/i' },
      { unscheduled_visit_pattern: '/TERM/' },
      { unscheduled_visit_pattern: '/unscheduled/gi' },
      { unscheduled_visit_pattern: '' },
      { unscheduled_visit_pattern: null, unscheduled_visit_values: null },
      { ...UNSCHEDULED_DEFAULTS, unscheduled_visit_values: [] },
      { ...UNSCHEDULED_DEFAULTS, unscheduled_visit_values: ['Week 2', 'Follow-up'] },
      { ...UNSCHEDULED_DEFAULTS, unscheduled_visit_values: [12] },
      {}
    ];
    let compared = 0;
    for (const settings of cases) {
      for (const visit of VISITS) {
        expect(isUnscheduledVisit(visit, settings), `${JSON.stringify(settings)} ${visit}`).toBe(
          safetyViz.isUnscheduledVisit(visit, settings)
        );
        compared += 1;
      }
    }
    expect(compared).toBe(cases.length * VISITS.length);
    // A pattern that is no regular expression fails in both the same way.
    const bad = { unscheduled_visit_pattern: '/(/' };
    expect(() => safetyViz.isUnscheduledVisit('Week 2', bad)).toThrow(SyntaxError);
    expect(() => isUnscheduledVisit('Week 2', bad)).toThrow(SyntaxError);
  });

  it('CORE-VISIT-003: `scheduledResults()` sets aside the rows at unscheduled visits and says which visits and how many rows; a table with none comes back as it is, and nothing given is changed (#84)', () => {
    // The synthetic study has no unscheduled visit: the same table comes back.
    const settings = { visit_col: 'VISIT', ...UNSCHEDULED_DEFAULTS };
    const untouched = scheduledResults(results, settings);
    expect(untouched.results).toBe(results);
    expect(untouched).toMatchObject({ visits: [], rows: 0 });

    const table = [
      { USUBJID: 'A', VISIT: 'Baseline', STRESN: '1' },
      { USUBJID: 'A', VISIT: 'Unscheduled 1', STRESN: '2' },
      { USUBJID: 'A', VISIT: 'Week 4', STRESN: '3' },
      { USUBJID: 'B', VISIT: 'Early Termination', STRESN: '4' },
      { USUBJID: 'B', VISIT: 'Unscheduled 1', STRESN: '5' },
      { USUBJID: 'B', VISIT: '', STRESN: '6' },
      { USUBJID: 'B', STRESN: '7' }
    ];
    const before = JSON.stringify(table);
    const found = scheduledResults(table, settings);
    expect(found.results.map((row) => row.STRESN)).toEqual(['1', '3', '6', '7']);
    // The rows kept are the table's own rows, in its order.
    expect(found.results[0]).toBe(table[0]);
    expect(found.visits).toEqual(['Unscheduled 1', 'Early Termination']);
    expect(found.rows).toBe(3);
    expect(JSON.stringify(table)).toBe(before);
    // A list decides alone, and the visit column is the settings' own.
    const renamed = table.map(({ VISIT, ...rest }) => ({ ...rest, AVISIT: VISIT }));
    const listed = scheduledResults(renamed, {
      visit_col: 'AVISIT',
      ...UNSCHEDULED_DEFAULTS,
      unscheduled_visit_values: ['Week 4']
    });
    expect(listed.visits).toEqual(['Week 4']);
    expect(listed.results.map((row) => row.STRESN)).toEqual(['1', '2', '4', '5', '6', '7']);
    // The switch is the caller's to read: the rule sets rows aside whatever it says.
    expect(scheduledResults(table, { ...settings, unscheduled_visits: true }).rows).toBe(3);
  });
});
