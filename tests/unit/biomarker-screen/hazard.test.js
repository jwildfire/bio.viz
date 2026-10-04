import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCREEN_STATISTICS, readDemo, requestOf } from '../../../scripts/screen-statistics-lib.mjs';
import { syncSettings } from '../../../src/biomarker-screen/configure.js';
import {
  COMPARISON_LABELS,
  ESTIMATE_NAMES,
  HAZARD_GROUPS,
  describeScreen,
  screenRequest
} from '../../../src/biomarker-screen/statistic.js';
import {
  axisRange,
  buildScreen,
  placeOf,
  screenRows,
  sortRows
} from '../../../src/biomarker-screen/structureData.js';
import { createConnection } from '../../../src/r/index.js';
import { canonicalJson } from '../../../src/r/canonical.js';
import { LEFT_OUT } from '../../../src/shared/outcomes.js';
import { listMeasures, listVisits } from '../../../src/shared/tables.js';
import { participants, readStudyTable, results } from '../core/study.js';

// The biomarker screen's hazard rows (#62): each biomarker cut at its median by
// R's Analyze_Screen, high against low, on an endpoint of the outcomes table.
// Desktop R's answers are in tests/fixtures/screen-statistics-r.json, written
// by tools/r-screen-statistics.R from frames the chart's own code wrote.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const text = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const sources = Object.fromEntries(
  Object.entries(SCREEN_STATISTICS.sources).map(([name, file]) => [name, text(file)])
);
const demo = readDemo(sources);
const fromR = JSON.parse(text(SCREEN_STATISTICS.expected));
const resultOf = (name) => fromR.results.find((result) => result.case === name);
const outcomes = readStudyTable('synthetic_outcomes.csv');
const ok = (value) => ({ status: 'ok', value });

const settings = syncSettings({ baseline_visits: 'Baseline' });
const offered = {
  measures: listMeasures(results, settings),
  visits: listVisits(results, settings).all,
  endpoints: [{ endpoint: 'EFS', label: 'Event-free survival (months)' }]
};
const state = (more = {}) => ({
  comparison: 'hazard',
  visit: 'Baseline',
  valueType: 'raw',
  groupBy: null,
  levels: [],
  with: null,
  method: 'pearson',
  endpoint: 'EFS',
  adjustment: 'BH',
  filters: {},
  ...more
});

describe('biomarker screen: the hazard rows', () => {
  it('BS-HAZ-001: for a hazard ratio the frame holds, beside every biomarker, each participant’s time and flag for the endpoint as the outcomes table reads it, censored or event; a participant with no outcome to use is kept with a gap and counted by reason (#62)', () => {
    const model = buildScreen({ results, participants, outcomes }, settings, state(), offered);
    expect(model.heading).toBe(
      'Result at Baseline: hazard ratio, high against low, on Event-free survival (months)'
    );
    expect(model.outcomeFields).toEqual(['time', 'censor']);
    expect(Object.keys(model.records[0])).toEqual([
      'USUBJID',
      ...offered.measures,
      'time',
      'censor'
    ]);
    const first = outcomes.find((row) => row.USUBJID === model.records[0].USUBJID);
    expect(model.records[0].time).toBe(Number(first.AVAL));
    expect(model.records[0].censor).toBe(Number(first.CNSR));
    expect(model.outcomeGaps).toEqual([]);
    // Read the other way round: an event flag, under its own name.
    const events = outcomes.map(({ CNSR, ...row }) => ({
      ...row,
      EVENT: String(1 - Number(CNSR))
    }));
    const evented = syncSettings({ baseline_visits: 'Baseline', event_col: 'EVENT' });
    const flipped = buildScreen(
      { results, participants, outcomes: events },
      evented,
      state(),
      offered
    );
    expect(flipped.outcomeFields).toEqual(['time', 'event']);
    expect(flipped.records[0].event).toBe(1 - model.records[0].censor);
    expect(
      screenRequest({ name: 'Analyze_Screen', settings: evented, state: state(), model: flipped })
        .args
    ).toMatchObject({ strTimeCol: 'time', strEventCol: 'event' });
    // Two participants with no outcome: kept, with a gap, and counted.
    const fewer = outcomes.slice(2);
    const gapped = buildScreen(
      { results, participants, outcomes: fewer },
      settings,
      state(),
      offered
    );
    expect(gapped.records).toHaveLength(model.records.length);
    expect(gapped.records.filter((record) => record.time === null)).toHaveLength(2);
    expect(gapped.outcomeGaps).toEqual([{ reason: LEFT_OUT.NO_OUTCOME, n: 2 }]);
    // With no endpoint there is nothing to screen.
    expect(
      screenRows(settings, state({ endpoint: null }), { ...offered, endpoints: [] }).message
    ).toMatch(/Choose an endpoint/);
  });

  it('BS-HAZ-002: R is asked once per screen for its hazard comparison, with the time and the flag, and the endpoint in the identity of the frame; for every hazard case the key is the one desktop R wrote, and R’s stored answer is found (#62)', async () => {
    const hazards = fromR.results.filter((result) => result.case.startsWith('hazard'));
    expect(hazards.map((result) => result.case)).toEqual([
      'hazard-baseline',
      'hazard-baseline-holm',
      'hazard-baseline-women',
      'hazard-baseline-age-35'
    ]);
    const connection = createConnection({
      results: hazards.map(({ name, args, dataId, rows, value }) => ({
        name,
        args,
        dataId,
        rows,
        value
      }))
    });
    for (const result of hazards) {
      const request = requestOf(demo, { case: result.case, view: viewOf(result) });
      expect(canonicalJson(request.args), result.case).toBe(canonicalJson(result.args));
      expect(canonicalJson(request.dataId), result.case).toBe(canonicalJson(result.dataId));
      expect(request.args).toMatchObject({
        strComparison: 'hazard',
        strTimeCol: 'time',
        strCensorCol: 'censor'
      });
      expect(request.dataId.endpoint).toBe('EFS');
      expect(await connection.run(request.name, request), result.case).toEqual({
        status: 'ok',
        value: result.value,
        form: 'precomputed'
      });
    }
  });

  it('BS-HAZ-003: each row is R’s hazard ratio of High against Low with its interval, its log-rank p-values unadjusted and adjusted, and High’s and Low’s counts; sorted by R’s estimate CRP, the planted biomarker, is the top row; a row R could not compute gives R’s reason (#62)', () => {
    const described = describeScreen(ok(resultOf('hazard-baseline').value), {
      groups: [...HAZARD_GROUPS]
    });
    expect(described.state).toBe('shown');
    expect(described.text).toMatch(/^Log-rank test, one row per biomarker: 12 of 12 computed\./);
    const sorted = sortRows(described.rows, 'estimate');
    expect(sorted[0].biomarker).toBe('CRP');
    const crp = resultOf('hazard-baseline').value.rows.find((row) => row.biomarker === 'CRP');
    expect(sorted[0].estimate).toBe(crp.estimate);
    expect(sorted[0].formatted.text).toMatch(
      /^CRP: 3\.523, 95% confidence interval 2\.43 to 5\.107\. Log-rank test: p < 0\.001 unadjusted, p < 0\.001 adjusted across 12 biomarkers \(High n = 100, Low n = 100\)\./
    );
    expect(sorted[0].groupCounts).toEqual([100, 100]);
    expect(HAZARD_GROUPS).toEqual(['High', 'Low']);
    expect(COMPARISON_LABELS.hazard).toBe('Hazard ratio, high against low');
    expect(ESTIMATE_NAMES.hazard).toBe('Hazard ratio, High / Low');
    // Every group too small: R's reason, and each row's own.
    const small = describeScreen(ok(resultOf('hazard-baseline-age-35').value), {
      groups: [...HAZARD_GROUPS]
    });
    expect(small.state).toBe('withheld');
    expect(small.rows[0].reason).toBe(
      'Not computed: High has 2; Low has 2. The minimum group size is 5.'
    );
    // A hazard ratio R does not estimate is a row with R's reason and no number.
    const notEstimable = describeScreen(
      ok({
        ...resultOf('hazard-baseline').value,
        rows: resultOf('hazard-baseline').value.rows.map((row, index) =>
          index === 0
            ? {
                ...row,
                status: 'error',
                reason:
                  'Not computed: the hazard ratio is not estimable: Low has no events, so the Cox model’s estimate is infinite.',
                estimate: null,
                lower: null,
                upper: null,
                p_unadjusted: null,
                p_value: null,
                adjusted_over: null,
                method: null
              }
            : row
        )
      }),
      { groups: [...HAZARD_GROUPS] }
    );
    const first = notEstimable.rows[0];
    expect(first.estimate).toBe(null);
    expect(first.reason).toMatch(/^Not computed: the hazard ratio is not estimable: /);
  });

  it('BS-HAZ-004: hazard ratios share one logarithmic axis, at powers of two from a half to two at least, with 1, no difference, marked; a ratio sits where its logarithm puts it (#62)', () => {
    const rows = describeScreen(ok(resultOf('hazard-baseline').value), {
      groups: [...HAZARD_GROUPS]
    }).rows;
    const range = axisRange(rows, 'hazard');
    expect(range.log).toBe(true);
    expect(range.reference).toBe(1);
    expect(range.ticks[0]).toBeLessThanOrEqual(0.5);
    expect(range.ticks.at(-1)).toBeGreaterThanOrEqual(
      Math.max(...rows.map((row) => row.upper ?? 0))
    );
    range.ticks.slice(1).forEach((tick, i) => expect(tick).toBe(range.ticks[i] * 2));
    expect(range.ticks).toContain(1);
    // On an axis from a half to two, a half is at the left, 1 in the middle, 2 at the right.
    const narrow = axisRange([{ estimate: 1.2, lower: 0.9, upper: 1.6 }], 'hazard');
    expect([narrow.min, narrow.max]).toEqual([0.5, 2]);
    expect([0.5, 1, 2].map((value) => placeOf(value, narrow))).toEqual([0, 50, 100]);
    // A difference's and a coefficient's axes are as they were.
    expect(axisRange([{ estimate: 0.3, lower: 0.1, upper: 0.5 }], 'difference').log).toBe(
      undefined
    );
  });
});

// A hazard case's view, as the fixture's library states its cases.
function viewOf(result) {
  const filters = result.dataId.filters
    ? Object.fromEntries(
        Object.entries(result.dataId.filters).map(([column, values]) => [column, values[0]])
      )
    : {};
  return {
    comparison: 'hazard',
    visit: 'Baseline',
    valueType: 'raw',
    adjustment: result.args.strPAdjust,
    filters
  };
}
