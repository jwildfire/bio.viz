import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { syncSettings } from '../../../src/correlation-matrix/configure.js';
import {
  COEFFICIENT_NAMES,
  METHOD_LABELS,
  cellText,
  createStatisticDesk,
  describeMatrix,
  matrixRequest,
  pairsOf,
  plain,
  scopeText
} from '../../../src/correlation-matrix/statistic.js';
import { buildMatrix, pairKey } from '../../../src/correlation-matrix/structureData.js';
import { createConnection } from '../../../src/r/index.js';
import { NOT_STORED, WAITING } from '../../../src/shared/statisticLine.js';
import { listMeasures, listVisits } from '../../../src/shared/tables.js';
import { participants, results } from '../core/study.js';

// The correlation matrix's statistics (#27): what R is asked, and how what R
// answered is described, through the connection and the shared formatter, with
// no p-value and never an answer for a frame other than the one drawn.
//
// Where a test needs a real answer, it is one desktop R gave:
// tests/fixtures/matrix-statistics-r.json, written by
// tools/r-matrix-statistics.R from gsm.bio's vendored statistics file. No
// number in these tests was typed but the ones a printed line is held to.

const fromR = JSON.parse(
  readFileSync(new URL('../../fixtures/matrix-statistics-r.json', import.meta.url), 'utf8')
);
const answerOf = (name) => fromR.results.find((result) => result.case === name).value;
const ok = (value) => ({ status: 'ok', value, form: 'browser' });
const NOTE =
  'R’s note: No p-values: a matrix reports each coefficient, its interval and its pair count. ' +
  'Use Analyze_Correlation() to test one pair.';

const settings = syncSettings({ baseline_visits: 'Baseline' });
const tables = { results, participants };
const offered = {
  measures: listMeasures(results, settings),
  visits: listVisits(results, settings).all
};
const VIEW = {
  mode: 'biomarkers',
  visit: 'Baseline',
  biomarkers: null,
  measure: 'IL-6',
  visits: null,
  valueType: 'raw',
  filters: {}
};
const ask = (view = {}, { method = 'pearson', minPairs = null, config = settings } = {}) => {
  const state = { ...VIEW, ...view };
  const model = buildMatrix(tables, config, state, offered);
  return matrixRequest({
    name: config.statistic,
    method,
    minPairs,
    settings: config,
    state,
    model
  });
};

describe('correlation matrix: what R is asked', () => {
  it('CM-STAT-001: one request for the whole grid: the function, the frame, the names of its columns and the method; a minimum only when the reader set one; and an identity that names the chart, the variables in order, the baseline settings and the filters in force (#27)', () => {
    const request = ask();
    expect(Object.keys(request)).toEqual(['name', 'data', 'args', 'dataId', 'rows']);
    expect(request.name).toBe('Analyze_CorrelationMatrix');
    expect(request.rows).toBe(200);
    expect(request.data).toHaveLength(200);
    expect(Object.keys(request.data[0])).toEqual([
      'USUBJID',
      ...Array.from({ length: 12 }, (_, index) => `v${index + 1}`)
    ]);
    // The arguments: the frame's columns in the grid's order, and the method.
    // No minimum, no confidence level, no adjustment: those are R's.
    expect(request.args).toEqual({
      chrCols: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12'],
      strMethod: 'pearson'
    });
    expect(request.dataId).toEqual({
      chart: 'correlation-matrix',
      variables: offered.measures.map((measure) => ({ measure, value: 'raw', visit: 'Baseline' })),
      baseline_visits: ['Baseline'],
      baseline_stat: 'mean'
    });
    // A minimum the reader set is handed to R as it was set, and only then.
    expect(ask({}, { minPairs: 183 }).args).toEqual({ ...request.args, nMinPairs: 183 });
    expect('nMinPairs' in ask({}, { minPairs: null }).args).toBe(false);
    expect('nMinPairs' in ask({}, { minPairs: undefined }).args).toBe(false);
    expect(ask({}, { method: 'spearman' }).args.strMethod).toBe('spearman');
    // The minimum and the method are arguments, not part of what the frame is.
    expect(ask({}, { method: 'spearman', minPairs: 20 }).dataId).toEqual(request.dataId);

    // Across visits the variables say so themselves: there is no member for the mode.
    const across = ask({ mode: 'visits', valueType: 'change' });
    expect(across.args.chrCols).toEqual(['v1', 'v2', 'v3', 'v4']);
    expect(across.dataId.variables).toEqual(
      ['Week 2', 'Week 4', 'Week 8', 'Week 12'].map((visit) => ({
        measure: 'IL-6',
        value: 'change',
        visit
      }))
    );
    expect('mode' in across.dataId).toBe(false);
    // A baseline value is written without a visit.
    expect(ask({ valueType: 'baseline' }).dataId.variables[0]).toEqual({
      measure: 'CRP',
      value: 'baseline'
    });
    // A filter in force is in the identity, by its column, as sorted text; one
    // that lets everyone through is not. A member that is not set is left out.
    const filtered = ask({ filters: { SEX: 'F', ARM: null, AGE: ['57', '35'] } });
    expect(filtered.dataId.filters).toEqual({ AGE: ['35', '57'], SEX: ['F'] });
    expect('filters' in request.dataId).toBe(false);
    const unnamed = ask({}, { config: syncSettings() });
    expect('baseline_visits' in unnamed.dataId).toBe(false);
    expect(JSON.stringify(unnamed.dataId)).not.toContain('null');
    // Other variables, another identity; the same view, the same request.
    expect(ask({ visit: 'Week 4' }).dataId).not.toEqual(request.dataId);
    expect(ask({ biomarkers: ['IL-6', 'IL-10', 'CRP'] }).dataId.variables).toHaveLength(3);
    expect(ask()).toEqual(request);
    // With gaps, a value a participant does not have is null, which R reads as missing.
    const gaps = ask({ visit: 'Week 4', valueType: 'change' });
    expect(gaps.rows).toBe(187);
    expect(gaps.data[0].v2).toBe(null);
  });
});

describe('correlation matrix: how R’s answer is described', () => {
  it('CM-STAT-002: the method as R names it and how many pairs it returned; R’s notes and warnings as R worded them; R’s reason where no pair has enough; R’s error as an error; and a result with no method is refused (#27)', () => {
    const shown = describeMatrix(ok(answerOf('biomarkers-baseline')), {
      variables: 12,
      scope: scopeText({ n: 200 })
    });
    expect(shown.state).toBe('shown');
    expect(shown.text).toBe(
      "Pearson's product-moment correlation, pair by pair: 66 pairs of 12 variables, each on " +
        'the participants who have both of its values.'
    );
    expect(shown.remarks).toEqual([{ kind: 'note', text: NOTE }]);
    expect(shown.scope).toBe(
      '200 participants are in the frame. A cell is of the ones who have both of its values, so ' +
        'each cell has its own count, and the cells are not adjusted for one another.'
    );
    expect(shown.pairs.size).toBe(66);
    expect(shown.table).toBe(null);
    expect(shown.estimates).toEqual([]);
    expect(scopeText({ n: 1 })).toMatch(/^1 participant is in the frame\./);
    expect(scopeText({ n: 91, filters: [{ label: 'Sex', values: ['F'] }] })).toMatch(
      /not adjusted for one another\. Filters: Sex is F\.$/
    );

    const ranked = describeMatrix(ok(answerOf('biomarkers-baseline-spearman')), { variables: 12 });
    expect(ranked.text).toMatch(/^Spearman's rank correlation rho, pair by pair: 66 pairs of 12 /);
    expect(ranked.remarks).toEqual([
      { kind: 'warning', text: 'R warned: Cannot compute exact p-value with ties' },
      { kind: 'note', text: NOTE },
      {
        kind: 'note',
        text: "R’s note: cor.test() gives no confidence interval for Spearman's rho, so none is reported."
      }
    ]);
    // A grid where some cells fall under the minimum is still a grid.
    const some = describeMatrix(ok(answerOf('week-12-minimum-183')), { variables: 12 });
    expect(some.state).toBe('shown');
    expect([...some.pairs.values()].filter((pair) => pair.reason)).toHaveLength(51);
    // One where every cell does is R's reason, and the pairs still carry their counts.
    const none = describeMatrix(ok(answerOf('age-35')), { variables: 12 });
    expect(none.state).toBe('withheld');
    expect(none.text).toBe('Not computed: no pair of columns has 5 complete pairs.');
    expect(none.pairs.size).toBe(66);
    expect([...none.pairs.values()].every((pair) => pair.estimate === null)).toBe(true);
    expect([...none.pairs.values()][0].formatted.text).toBe(
      'Not computed: 4 complete pairs. The minimum is 5. Counts: n = 4.'
    );

    expect(describeMatrix(ok({ status: 'error', reason: 'object not found' }))).toMatchObject({
      state: 'error',
      text: 'R reported an error: object not found',
      pairs: null
    });
    expect(
      describeMatrix(ok({ ...answerOf('biomarkers-baseline'), method: null }), { variables: 12 })
    ).toMatchObject({
      state: 'refused',
      text: 'Coefficients not shown: the result does not name its method.',
      pairs: null
    });
    expect(describeMatrix({ status: 'error', message: 'boom' })).toMatchObject({
      state: 'error',
      text: 'R reported an error: boom',
      pairs: null
    });
    // Nothing is counted or computed in a description: the answer is left as it was.
    const before = JSON.stringify(answerOf('biomarkers-baseline'));
    describeMatrix(ok(answerOf('biomarkers-baseline')), { variables: 12 });
    expect(JSON.stringify(answerOf('biomarkers-baseline'))).toBe(before);
    expect(METHOD_LABELS).toEqual({ pearson: 'Pearson', spearman: 'Spearman' });
    expect(COEFFICIENT_NAMES).toEqual({ pearson: 'Pearson’s r', spearman: 'Spearman’s rho' });
  });

  it('CM-STAT-002: with no R the line says statistics are unavailable, with stored results a view not stored says so, and the desk waits and never shows an answer to the question before (#27)', async () => {
    const request = ask();
    const none = await createConnection().run(request.name, request);
    expect(describeMatrix(none)).toMatchObject({
      state: 'unavailable',
      text: 'Statistics are unavailable: no R is attached to this chart.',
      pairs: null
    });
    const notStored = await createConnection({ results: [] }).run(request.name, request);
    expect(describeMatrix(notStored)).toMatchObject({ state: 'unavailable', text: NOT_STORED });
    expect(plain('waiting', WAITING)).toMatchObject({ state: 'waiting', pairs: null, table: null });

    // A stand-in for R whose answers arrive when the test says.
    const pending = [];
    const connection = {
      run: (name, given) => new Promise((resolve) => pending.push({ name, given, resolve }))
    };
    const desk = createStatisticDesk({ connection, note: 'It starts R.' });
    const written = [];
    const first = desk.begin();
    first.ask(request, (description) => written.push(['first', description.state]), {
      variables: 12
    });
    expect(written).toEqual([['first', 'waiting']]);
    // The chart is drawn again before R answered: a new round, a new question.
    const second = desk.begin();
    const women = ask({ filters: { SEX: 'F' } });
    const seen = [];
    second.ask(
      women,
      (description) => {
        written.push(['second', description.state]);
        seen.push(description);
      },
      { variables: 12 }
    );
    expect(seen[0].text).toBe(`${WAITING} It starts R.`);
    expect(pending).toHaveLength(2);
    expect(pending[1].given.data).toHaveLength(91);
    expect(Object.keys(pending[1].given)).toEqual(['data', 'args', 'dataId']);
    // The first answer arrives late: it is dropped, and nothing is written for it.
    pending[0].resolve(ok(answerOf('biomarkers-baseline')));
    await Promise.resolve();
    await Promise.resolve();
    expect(written).toEqual([
      ['first', 'waiting'],
      ['second', 'waiting']
    ]);
    pending[1].resolve(ok(answerOf('biomarkers-women')));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(written.at(-1)).toEqual(['second', 'shown']);
    expect(written.filter(([round]) => round === 'first')).toEqual([['first', 'waiting']]);
    expect(seen.at(-1).pairs.get(pairKey('v9', 'v11')).formatted.n).toBe(91);
  });

  it('CM-STAT-003: a cell’s sentence is the shared formatter’s: the pair by its labels, the coefficient by the method’s name, the interval R gave or none, and the count; a p-value on a row is neither read nor printed (#27)', () => {
    const pairs = pairsOf(answerOf('biomarkers-baseline'));
    expect(pairs.size).toBe(66);
    // The planted pair, found by its two variables in either order.
    const planted = pairs.get(pairKey('v11', 'v9'));
    expect(planted).toBe(pairs.get(pairKey('v9', 'v11')));
    expect(planted).toMatchObject({
      x: 'v9',
      y: 'v11',
      estimate: 0.6383822572068255,
      reason: null,
      warning: null
    });
    // The order is R's: the place of the row in what R returned.
    const rows = answerOf('biomarkers-baseline').rows;
    expect([...pairs.values()].map((pair) => pair.order)).toEqual(rows.map((_, index) => index));
    expect([...pairs.values()].map((pair) => pair.estimate)).toEqual(
      rows.map((row) => row.estimate)
    );
    const labels = { row: 'TNF-alpha', column: 'IL-10' };
    expect(cellText(planted, labels, COEFFICIENT_NAMES.pearson)).toBe(
      'TNF-alpha and IL-10: Pearson’s r 0.6384, 95% confidence interval 0.5482 to 0.7139 (n = 200).'
    );
    // Spearman: no interval, none made up, and R's warning for the pair as R worded it.
    const ranked = pairsOf(answerOf('biomarkers-baseline-spearman')).get(pairKey('v9', 'v11'));
    expect(cellText(ranked, labels, COEFFICIENT_NAMES.spearman)).toBe(
      'TNF-alpha and IL-10: Spearman’s rho 0.6327 (n = 200). R warned: Cannot compute exact ' +
        'p-value with ties.'
    );
    // Too few complete pairs: R's reason, the count, and no number.
    const small = pairsOf(answerOf('week-12-minimum-183')).get(pairKey('v1', 'v2'));
    expect(small).toMatchObject({
      estimate: null,
      reason: 'Not computed: 178 complete pairs. The minimum is 183.'
    });
    expect(cellText(small, { row: 'D-dimer', column: 'CRP' }, COEFFICIENT_NAMES.pearson)).toBe(
      'D-dimer and CRP: Not computed: 178 complete pairs. The minimum is 183. Counts: n = 178.'
    );
    // Before R has answered a cell says only what pair it is.
    expect(cellText(null, labels, COEFFICIENT_NAMES.pearson)).toBe('TNF-alpha and IL-10.');

    // No p-value: R's rows carry none, and one that did would not be read.
    for (const result of fromR.results) {
      expect(result.value.p_value, result.case).toBe(null);
      for (const row of result.value.rows) expect('p_value' in row, result.case).toBe(false);
    }
    const withP = {
      ...answerOf('biomarkers-baseline'),
      p_value: 0.0001,
      rows: rows.map((row) => ({ ...row, p_value: 0.0001, method: 'A test' }))
    };
    const described = describeMatrix(ok(withP), { variables: 12, scope: scopeText({ n: 200 }) });
    const everything = JSON.stringify([
      described.text,
      described.scope,
      [...described.pairs.values()].map((pair) => [
        pair.formatted,
        cellText(pair, labels, COEFFICIENT_NAMES.pearson)
      ])
    ]);
    expect(everything).not.toMatch(/p [=<>]|p_value|0\.0001|significan|\*/i);
    expect(everything).toContain('0.6384');
    // A row that does not name its two variables is no pair.
    expect(pairsOf({ rows: [{ x: 'v1' }, null, { x: 'v1', y: 'v2', counts: 3 }] }).size).toBe(1);
    expect(pairsOf(undefined).size).toBe(0);
  });
});
