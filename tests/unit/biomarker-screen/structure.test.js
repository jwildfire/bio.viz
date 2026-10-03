import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { syncSettings } from '../../../src/biomarker-screen/configure.js';
import { rowsOf } from '../../../src/biomarker-screen/statistic.js';
import {
  SORT_LABELS,
  axisRange,
  buildScreen,
  groupsOf,
  placeOf,
  screenRows,
  sortRows,
  variableName
} from '../../../src/biomarker-screen/structureData.js';
import { frame } from '../../../src/core/index.js';
import { pageCount, pageOf } from '../../../src/shared/paging.js';
import { listMeasures, listVisits } from '../../../src/shared/tables.js';
import { axisOf } from '../../../src/shared/variables.js';
import { participants, results, written } from '../core/study.js';

// What the biomarker screen draws (#36), worked out from the vendored
// synthetic study with no page: the rows, the frame R is handed, the two
// groups, the order of R's rows, the shared axis and the pages.

const fromR = JSON.parse(
  readFileSync(new URL('../../fixtures/screen-statistics-r.json', import.meta.url), 'utf8')
);
const answerOf = (name) => fromR.results.find((result) => result.case === name).value;
const settings = syncSettings({ baseline_visits: 'Baseline' });
const tables = { results, participants };
const offered = {
  measures: listMeasures(results, settings),
  visits: listVisits(results, settings).all
};
const BIOMARKERS = [
  'CRP',
  'D-dimer',
  'Ferritin',
  'IFN-gamma',
  'IL-1beta',
  'IL-2',
  'IL-6',
  'IL-8',
  'IL-10',
  'LDH',
  'TNF-alpha',
  'VEGF'
];
const IL10 = axisOf({ measure: 'IL-10', visit: 'Baseline' });
const VIEW = {
  comparison: 'difference',
  visit: 'Week 4',
  valueType: 'change',
  groupBy: 'ARM',
  levels: ['Placebo', 'Treatment'],
  with: null,
  method: 'pearson',
  adjustment: 'BH',
  filters: {}
};
const build = (view = {}, given = tables) =>
  buildScreen(given, settings, { ...VIEW, ...view }, offered);
const names = (model) => model.rows.map((row) => row.name);

describe('biomarker screen: the rows', () => {
  it('BS-DATA-001: the rows are the biomarkers of the list, in its order, each at the one visit with the one value type; a baseline value has no visit (#36)', () => {
    expect(offered.measures).toEqual(BIOMARKERS);
    const opening = build();
    expect(names(opening)).toEqual(BIOMARKERS);
    expect(opening.heading).toBe(
      'Change from baseline at Week 4: Placebo against Treatment, standardised difference'
    );
    for (const row of opening.rows) {
      expect(row.axis).toEqual({
        kind: 'measure',
        measure: row.name,
        value: 'change',
        visit: 'Week 4'
      });
    }
    const baseline = build({ valueType: 'baseline' });
    expect(baseline.rows[0].axis).toEqual({
      kind: 'measure',
      measure: 'CRP',
      value: 'baseline',
      visit: null
    });
    expect(baseline.heading).toBe(
      'Baseline value: Placebo against Treatment, standardised difference'
    );
    // The setting `measures` is the list, in its order.
    const three = buildScreen(
      tables,
      syncSettings({ baseline_visits: 'Baseline', measures: ['TNF-alpha', 'IL-6', 'CRP'] }),
      VIEW,
      { ...offered, measures: ['TNF-alpha', 'IL-6', 'CRP'] }
    );
    expect(names(three)).toEqual(['TNF-alpha', 'IL-6', 'CRP']);
    // A variable by name, as a column and a reader see it.
    expect(variableName(axisOf({ col: 'AGE' }))).toBe('AGE');
    expect(variableName(IL10)).toBe('IL-10 at Baseline');
    expect(variableName(axisOf({ measure: 'IL-10', value: 'baseline' }))).toBe(
      'IL-10, baseline value'
    );
    expect(variableName(axisOf({ measure: 'IL-6', value: 'change', visit: 'Week 4' }))).toBe(
      'IL-6, change from baseline at Week 4'
    );
  });

  it('BS-DATA-002: for a correlation the fixed variable is not a row of its own, and with nothing to screen the chart says why (#36)', () => {
    const against = build({
      comparison: 'correlation',
      visit: 'Baseline',
      valueType: 'raw',
      with: IL10
    });
    expect(names(against)).toEqual(BIOMARKERS.filter((name) => name !== 'IL-10'));
    expect(against.left).toBe(
      'IL-10 at Baseline is the variable every row is correlated with, and is not a row of its own.'
    );
    expect(against.heading).toBe('Result at Baseline: correlation with IL-10 at Baseline');
    // The same biomarker at another visit, or as another value, is a row.
    expect(names(build({ comparison: 'correlation', with: IL10 }))).toEqual(BIOMARKERS);
    expect(names(build({ comparison: 'correlation', with: axisOf({ col: 'AGE' }) }))).toEqual(
      BIOMARKERS
    );
    for (const [view, said] of [
      [
        { visit: 'Baseline' },
        /^This value is a change at the baseline visit, where it is the same for everyone\. Choose a later visit to screen\.$/
      ],
      [{ groupBy: null }, /^Choose a column of groups: a difference compares two of them\.$/],
      [
        { levels: [] },
        /^The column of groups has fewer than two groups: a difference compares two\.$/
      ],
      [
        { comparison: 'correlation', with: null },
        /^Choose the variable every biomarker is correlated with\.$/
      ]
    ]) {
      const model = build(view);
      expect(model.message, JSON.stringify(view)).toMatch(said);
      expect(model.rows).toEqual([]);
      expect(model.records).toEqual([]);
    }
    expect(screenRows(settings, { ...VIEW }, { measures: [], visits: [] }).message).toBe(
      'No biomarker to screen.'
    );
  });

  it('BS-DATA-003: the frame is the core’s, one column per biomarker named by it with none required, and the column of groups or the fixed variable beside them; a participant with none is left out and counted; the filters choose first; two columns of one name are refused (#36)', () => {
    const opening = build();
    expect(opening).toMatchObject({ participants: 200, empty: 13, filtered: 200, extra: 'ARM' });
    expect(opening.records).toHaveLength(187);
    expect(Object.keys(opening.records[0])).toEqual(['USUBJID', ...BIOMARKERS, 'ARM']);
    // The core's own frame, asked for with nothing required.
    const made = frame(
      tables,
      {
        ...Object.fromEntries(
          BIOMARKERS.map((measure) => [measure, { measure, visit: 'Week 4', value: 'change' }])
        ),
        ARM: { col: 'ARM' }
      },
      { baseline_visits: ['Baseline'], required: [] }
    );
    expect(opening.records).toEqual(
      made.data.filter((record) => BIOMARKERS.some((name) => record[name] !== null))
    );
    // A gap is kept: the first participant has no D-dimer at Week 4.
    expect(written('BIO-001', 'D-dimer', 'Week 4')).toBe('');
    expect(opening.records[0]['D-dimer']).toBe(null);
    expect(opening.records[0].ARM).toBe('Placebo');
    // A correlation's fixed variable is a column, named for what it is.
    const against = build({
      comparison: 'correlation',
      visit: 'Baseline',
      valueType: 'raw',
      with: IL10
    });
    expect(Object.keys(against.records[0]).at(-1)).toBe('IL-10 at Baseline');
    expect(against.records[0]['IL-10 at Baseline']).toBe(
      Number(written('BIO-001', 'IL-10', 'Baseline'))
    );
    const age = build({ comparison: 'correlation', with: axisOf({ col: 'AGE' }) });
    expect(age.records[0].AGE).toBe(Number(participants[0].AGE));
    // The filters choose participants before the frame is made.
    const women = build({ filters: { SEX: 'F' } });
    expect(women.filtered).toBe(91);
    expect(women.records.length).toBeLessThanOrEqual(91);
    const nobody = build({ filters: { SEX: 'Neither' } });
    expect(nobody).toMatchObject({ filtered: 0, records: [] });
    // Two columns of one name would be one column: refused, in words.
    const clash = buildScreen(tables, settings, VIEW, { ...offered, measures: ['IL-6', 'ARM'] });
    expect(clash.message).toBe(
      'Two columns of the frame would be named ARM: rename the biomarker or the column.'
    );
    expect(clash.records).toEqual([]);
  });

  it('BS-DATA-004: a difference compares the two groups chosen when the column has both, and otherwise its first two, in order (#36)', () => {
    expect(groupsOf(tables, 'ARM', null)).toEqual({
      levels: ['Placebo', 'Treatment'],
      offered: ['Placebo', 'Treatment']
    });
    expect(groupsOf(tables, 'ARM', ['Treatment', 'Placebo']).levels).toEqual([
      'Treatment',
      'Placebo'
    ]);
    expect(groupsOf(tables, 'ARM', ['Treatment', 'Nobody']).levels).toEqual([
      'Placebo',
      'Treatment'
    ]);
    expect(groupsOf(tables, 'SEX', null).levels).toEqual(['F', 'M']);
    expect(groupsOf(tables, null, null)).toEqual({ levels: [], offered: [] });
    expect(build({ levels: ['Treatment', 'Placebo'] }).heading).toMatch(
      /: Treatment against Placebo,/
    );
  });
});

describe('biomarker screen: the order, the axis and the pages', () => {
  it('BS-DATA-005: the rows are ordered by R’s estimate, largest first, by name, or by R’s adjusted p-value, smallest first; uncomputed rows last; ties in R’s order (#36)', () => {
    expect(SORT_LABELS).toEqual({
      estimate: 'Estimate, largest first',
      name: 'Biomarker name',
      adjusted: 'Adjusted p-value, smallest first'
    });
    const rows = rowsOf(answerOf('difference-week-4-change'), ['Placebo', 'Treatment']);
    const byEstimate = sortRows(rows, 'estimate');
    expect(byEstimate[0].biomarker).toBe('IL-6');
    for (let index = 1; index < byEstimate.length; index += 1) {
      expect(byEstimate[index].estimate).toBeLessThanOrEqual(byEstimate[index - 1].estimate);
    }
    expect(sortRows(rows, 'name').map((row) => row.biomarker)).toEqual(BIOMARKERS);
    const byAdjusted = sortRows(rows, 'adjusted');
    expect(byAdjusted[0].biomarker).toBe('IL-6');
    for (let index = 1; index < byAdjusted.length; index += 1) {
      const [before, after] = [byAdjusted[index - 1], byAdjusted[index]];
      expect(after.adjusted).toBeGreaterThanOrEqual(before.adjusted);
      // Equal adjusted p-values keep R's order.
      if (after.adjusted === before.adjusted) expect(after.order).toBeGreaterThan(before.order);
    }
    // The order is of R's own numbers: the values sorted are the rows' own.
    expect(byEstimate.map((row) => row.estimate)).toEqual(
      answerOf('difference-week-4-change')
        .rows.map((row) => row.estimate)
        .sort((a, b) => b - a)
    );
    // A row R gave no number for comes after those it did, in R's order.
    const mixed = [
      { biomarker: 'A', estimate: null, adjusted: null, order: 0 },
      { biomarker: 'B', estimate: 0.1, adjusted: 0.5, order: 1 },
      { biomarker: 'C', estimate: null, adjusted: null, order: 2 },
      { biomarker: 'D', estimate: 0.3, adjusted: 0.5, order: 3 }
    ];
    expect(sortRows(mixed, 'estimate').map((row) => row.biomarker)).toEqual(['D', 'B', 'A', 'C']);
    expect(sortRows(mixed, 'adjusted').map((row) => row.biomarker)).toEqual(['B', 'D', 'A', 'C']);
    // Sorting leaves R's rows as they were.
    expect(rows.map((row) => row.biomarker)).toEqual(BIOMARKERS);
  });

  it('BS-DATA-006: every row is on one axis without units, symmetric about nought and holding every interval for a difference, from −1 to 1 for a coefficient (#36)', () => {
    const rows = rowsOf(answerOf('difference-week-4-change'), ['Placebo', 'Treatment']);
    const range = axisRange(rows, 'difference');
    expect(range).toEqual({ min: -2, max: 2, ticks: [-2, -1, 0, 1, 2] });
    for (const row of rows) {
      for (const value of [row.estimate, row.lower, row.upper]) {
        expect(value).toBeGreaterThanOrEqual(range.min);
        expect(value).toBeLessThanOrEqual(range.max);
      }
    }
    expect(axisRange([], 'difference')).toEqual({ min: -0.5, max: 0.5, ticks: [-0.5, 0, 0.5] });
    expect(axisRange([{ estimate: 2.2, lower: 1.5, upper: 3.1 }], 'difference')).toEqual({
      min: -4,
      max: 4,
      ticks: [-4, -2, 0, 2, 4]
    });
    expect(axisRange(rows, 'correlation')).toEqual({
      min: -1,
      max: 1,
      ticks: [-1, -0.5, 0, 0.5, 1]
    });
    expect(placeOf(0, range)).toBe(50);
    expect(placeOf(-2, range)).toBe(0);
    expect(placeOf(2, range)).toBe(100);
    expect(placeOf(9, range)).toBe(100);
  });

  it('BS-LIMIT-001: with more rows than the limit the rows are paged, and the note says how many of how many, in what order and how many to a page (#36)', () => {
    const items = Array.from({ length: 45 }, (_, index) => index);
    expect(pageOf(items, 20)).toMatchObject({ page: 0, pages: 3, from: 1, to: 20, total: 45 });
    expect(pageOf(items, 20, 2)).toMatchObject({ items: items.slice(40), from: 41, to: 45 });
    expect(pageOf(items, 20, 9).page).toBe(2);
    expect(pageOf(items, 20, -1).page).toBe(0);
    const order = 'by estimate, largest first; 20 to a page';
    expect(pageCount(pageOf(items, 20, 1), order)).toBe(
      '20 of 45 biomarkers shown: 21 to 40, by estimate, largest first; 20 to a page.'
    );
    expect(pageCount(pageOf(items.slice(0, 12), 20), order)).toBe('All 12 biomarkers are shown.');
    expect(pageCount(pageOf([], 20), order)).toBe('No biomarker to show.');
    expect(settings.limit).toBe(20);
  });
});
