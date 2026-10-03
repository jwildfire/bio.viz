import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { syncSettings } from '../../../src/biomarker-screen/configure.js';
import {
  ADJUSTMENT_LABELS,
  COMPARISON_LABELS,
  createStatisticDesk,
  describeScreen,
  rowsOf,
  scopeText,
  screenRequest
} from '../../../src/biomarker-screen/statistic.js';
import { buildScreen } from '../../../src/biomarker-screen/structureData.js';
import { createConnection } from '../../../src/r/index.js';
import { NOT_STORED, WAITING } from '../../../src/shared/statisticLine.js';
import { listMeasures, listVisits } from '../../../src/shared/tables.js';
import { axisOf } from '../../../src/shared/variables.js';
import { participants, results } from '../core/study.js';

// The biomarker screen's statistics (#36): what R is asked, once per screen,
// and how what R answered is described, through the connection and the shared
// formatter, and never an answer for a frame other than the one drawn. Where a
// test needs a real answer, it is one desktop R gave:
// tests/fixtures/screen-statistics-r.json.

const fromR = JSON.parse(
  readFileSync(new URL('../../fixtures/screen-statistics-r.json', import.meta.url), 'utf8')
);
const answerOf = (name) => fromR.results.find((result) => result.case === name).value;
const ok = (value) => ({ status: 'ok', value, form: 'browser' });
const ARMS = ['Placebo', 'Treatment'];
const settings = syncSettings({ baseline_visits: 'Baseline' });
const tables = { results, participants };
const offered = {
  measures: listMeasures(results, settings),
  visits: listVisits(results, settings).all
};
const VIEW = {
  comparison: 'difference',
  visit: 'Week 4',
  valueType: 'change',
  groupBy: 'ARM',
  levels: ARMS,
  with: null,
  method: 'pearson',
  adjustment: 'BH',
  filters: {}
};
const ask = (view = {}, config = settings) => {
  const state = { ...VIEW, ...view };
  const model = buildScreen(tables, config, state, offered);
  return screenRequest({ name: config.statistic, settings: config, state, model });
};

describe('biomarker screen: what R is asked', () => {
  it('BS-STAT-001: one request for the whole screen: the function, the frame, the biomarkers, the comparison with its groups or its variable and method, and the adjustment; an identity that names the chart, the value type, the visit, the baseline, the variable and the filters (#36)', () => {
    const request = ask();
    expect(Object.keys(request)).toEqual(['name', 'data', 'args', 'dataId', 'rows']);
    expect(request.name).toBe('Analyze_Screen');
    expect(request.rows).toBe(187);
    expect(request.args).toEqual({
      chrCols: offered.measures,
      strComparison: 'difference',
      strGroupCol: 'ARM',
      chrGroups: ARMS,
      strPAdjust: 'BH'
    });
    expect(request.dataId).toEqual({
      chart: 'biomarker-screen',
      value_type: 'change',
      visit: 'Week 4',
      baseline_visits: ['Baseline'],
      baseline_stat: 'mean'
    });
    expect(ask({ adjustment: 'holm' }).args.strPAdjust).toBe('holm');
    expect(ask({ levels: ['Treatment', 'Placebo'] }).args.chrGroups).toEqual([
      'Treatment',
      'Placebo'
    ]);
    // A correlation sends its variable's column and its method, and names the
    // variable in the identity, where a difference sends neither.
    const against = ask({
      comparison: 'correlation',
      visit: 'Baseline',
      valueType: 'raw',
      with: axisOf({ measure: 'IL-10', visit: 'Baseline' }),
      method: 'spearman'
    });
    expect(against.args).toEqual({
      chrCols: offered.measures.filter((name) => name !== 'IL-10'),
      strComparison: 'correlation',
      strWithCol: 'IL-10 at Baseline',
      strCorMethod: 'spearman',
      strPAdjust: 'BH'
    });
    expect(against.dataId.with).toEqual({ measure: 'IL-10', value: 'raw', visit: 'Baseline' });
    expect('with' in request.dataId).toBe(false);
    expect('strCorMethod' in request.args).toBe(false);
    // A baseline value has no visit; a filter in force is in the identity, sorted.
    expect('visit' in ask({ valueType: 'baseline' }).dataId).toBe(false);
    expect(ask({ filters: { SEX: 'F', AGE: ['57', '35'], ARM: null } }).dataId.filters).toEqual({
      AGE: ['35', '57'],
      SEX: ['F']
    });
    expect(JSON.stringify(ask({}, syncSettings()).dataId)).not.toContain('null');
    // With gaps, a value a participant does not have is null.
    expect(request.data[0]['D-dimer']).toBe(null);
    expect(ask()).toEqual(request);
  });
});

describe('biomarker screen: how R’s answer is described', () => {
  it('BS-STAT-002: the method, how many rows R computed of how many, and the adjustment across how many; R’s notes; R’s reason where no row could be computed; R’s error; and a result with no method, or rows not adjusted as one family, is refused (#36)', () => {
    const shown = describeScreen(ok(answerOf('difference-week-4-change')), {
      groups: ARMS,
      scope: scopeText({ n: 187 })
    });
    expect(shown).toMatchObject({
      state: 'shown',
      text:
        'Welch Two Sample t-test, one row per biomarker: 12 of 12 computed. The adjusted ' +
        'p-values are adjusted by Benjamini-Hochberg across the 12 biomarkers that have a p-value.',
      over: 12,
      adjustment: 'Benjamini-Hochberg',
      scope:
        '187 participants are in the frame. A row is of the ones who have its biomarker, so ' +
        'each row has its own counts.'
    });
    expect(shown.rows).toHaveLength(12);
    // Four notes since gsm.bio 514cbc3: the fourth says the interval pools the
    // variances and the p-value does not (#49).
    expect(shown.remarks.map((remark) => remark.kind)).toEqual(['note', 'note', 'note', 'note']);
    expect(shown.remarks[3].text).toMatch(
      /^R’s note: The interval is the pooled-variance \(Student\) interval for Hedges' g, while the p-value is Welch's/
    );
    expect(shown.remarks[0].text).toBe(
      "R’s note: Each row's estimate: Standardised difference (Hedges' g), Placebo - Treatment."
    );
    const holm = describeScreen(ok(answerOf('correlation-il-10-holm')));
    expect(holm.text).toMatch(/adjusted by Holm across the 11 biomarkers that have a p-value\.$/);
    const spearman = describeScreen(ok(answerOf('correlation-il-10-spearman')));
    expect(spearman.remarks[0]).toEqual({
      kind: 'warning',
      text: 'R warned: Cannot compute exact p-value with ties'
    });
    // No row could be computed: R's reason, and each row's own.
    const none = describeScreen(ok(answerOf('difference-age-35')), { groups: ARMS });
    expect(none).toMatchObject({
      state: 'withheld',
      text: 'Not computed: every biomarker has a group below the minimum size. Each row gives its reason.'
    });
    expect(none.rows.every((row) => row.formatted.status === 'withheld')).toBe(true);
    expect(
      describeScreen(ok({ status: 'error', reason: 'chrCols must name one or more columns.' }))
    ).toMatchObject({
      state: 'error',
      text: 'R reported an error: chrCols must name one or more columns.'
    });
    expect(
      describeScreen(ok({ ...answerOf('difference-week-4-change'), method: null }))
    ).toMatchObject({
      state: 'refused',
      text: 'Rows not shown: the result does not name its method.'
    });
    const mixed = answerOf('difference-week-4-change');
    const twoFamilies = {
      ...mixed,
      rows: mixed.rows.map((row, index) => ({ ...row, adjusted_over: index ? 12 : 11 }))
    };
    expect(describeScreen(ok(twoFamilies), { groups: ARMS })).toMatchObject({
      state: 'refused',
      text: 'Rows not shown: the rows were not adjusted as one family.',
      rows: null
    });
    // Nothing is computed in a description: the answer is left as it was.
    const before = JSON.stringify(mixed);
    describeScreen(ok(mixed), { groups: ARMS });
    expect(JSON.stringify(mixed)).toBe(before);
    expect(COMPARISON_LABELS).toEqual({
      difference: 'Difference between two groups',
      correlation: 'Correlation with one variable'
    });
    expect(ADJUSTMENT_LABELS).toEqual({ BH: 'Benjamini-Hochberg', holm: 'Holm' });
  });

  it('BS-STAT-002: with no R the line says statistics are unavailable, with stored results a view not stored says so, and the desk never shows an answer to the question before (#36)', async () => {
    const request = ask();
    expect(describeScreen(await createConnection().run(request.name, request))).toMatchObject({
      state: 'unavailable',
      text: 'Statistics are unavailable: no R is attached to this chart.',
      rows: null
    });
    expect(
      describeScreen(await createConnection({ results: [] }).run(request.name, request))
    ).toMatchObject({ state: 'unavailable', text: NOT_STORED, rows: null });
    const pending = [];
    const desk = createStatisticDesk({
      connection: {
        run: (name, given) => new Promise((resolve) => pending.push({ given, resolve }))
      }
    });
    const written = [];
    desk.begin().ask(request, (description) => written.push(['first', description.state]), {});
    const women = ask({ filters: { SEX: 'F' } });
    desk.begin().ask(women, (description) => written.push(['second', description.state]), {
      groups: ARMS
    });
    pending[0].resolve(ok(answerOf('difference-week-4-change')));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(written).toEqual([
      ['first', 'waiting'],
      ['second', 'waiting']
    ]);
    pending[1].resolve(ok(answerOf('difference-week-4-change-women')));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(written.at(-1)).toEqual(['second', 'shown']);
    expect(written[1][0]).toBe('second');
    expect(WAITING).toBe('Statistics: waiting for R…');
  });

  it('BS-STAT-003: each row is the shared formatter’s, R’s numbers are kept for the dot, the line and the order only where R computed the row, and a row is in the adjustment when R says it is (#36)', () => {
    const rows = rowsOf(answerOf('difference-week-4-change'), ARMS);
    const il6 = rows.find((row) => row.biomarker === 'IL-6');
    const fromRow = answerOf('difference-week-4-change').rows.find(
      (row) => row.biomarker === 'IL-6'
    );
    expect(il6).toMatchObject({
      estimate: fromRow.estimate,
      lower: fromRow.lower,
      upper: fromRow.upper,
      raw: fromRow.p_unadjusted,
      adjusted: fromRow.p_value,
      n: 186,
      groupCounts: [95, 91],
      inAdjustment: true,
      order: 6
    });
    expect(il6.formatted.status).toBe('shown');
    expect(il6.formatted.text).toMatch(
      /^IL-6: 0\.9133, 95% confidence interval 0\.6111 to 1\.213\./
    );
    const small = rowsOf(answerOf('difference-age-35'), ARMS)[0];
    expect(small).toMatchObject({
      estimate: null,
      raw: null,
      adjusted: null,
      inAdjustment: false,
      reason: 'Not computed: Placebo has 2; Treatment has 2. The minimum group size is 5.'
    });
    // A row whose number the formatter refuses keeps none of R's numbers for drawing.
    const broken = rowsOf({ rows: [{ ...fromRow, method: null }] }, ARMS)[0];
    expect(broken.formatted.status).toBe('refused');
    expect([broken.estimate, broken.lower, broken.upper, broken.adjusted]).toEqual([
      null,
      null,
      null,
      null
    ]);
    // No p-value is printed without its method, counts and label.
    for (const row of rows) {
      expect(row.formatted.text).toMatch(
        /Welch Two Sample t-test: p [<=>] .* \(Placebo n = \d+, Treatment n = \d+\)\. Exploratory, adjusted \(Benjamini-Hochberg\)\.$/
      );
      expect(row.formatted.text).not.toMatch(/\*|significan/i);
    }
    expect(rowsOf(undefined)).toEqual([]);
  });
});
