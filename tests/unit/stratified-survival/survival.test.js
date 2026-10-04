import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_SETTINGS,
  flagOf,
  syncSettings
} from '../../../src/stratified-survival/configure.js';
import {
  LEFT_OUT,
  atRisk,
  buildSurvival,
  histogramOf,
  listEndpoints,
  timeTicks
} from '../../../src/stratified-survival/structureData.js';
import {
  ONE_GROUP,
  describeAnswer,
  scopeText,
  survivalRequest
} from '../../../src/stratified-survival/statistic.js';
import { dropPoint } from '../../../src/stratified-survival/drag.js';
import { createConnection } from '../../../src/r/index.js';
import { canonicalJson } from '../../../src/r/canonical.js';
import { participants, readStudyTable, results } from '../core/study.js';
import { kit } from './kit.js';

// The stratified survival chart (#61): each participant's group and outcome,
// each group's Kaplan-Meier curve from safety.viz's kit, and what the chart asks
// R. Desktop R's answers, the curves survival::survfit() gives and the key a
// stored result is found by are written by tools/r-survival.R into
// tests/fixtures/stratified-survival-r.json. Nothing here is typed in.

const fromR = JSON.parse(
  readFileSync(new URL('../../fixtures/stratified-survival-r.json', import.meta.url), 'utf8')
);
const caseOf = (name) => fromR.cases.find((entry) => entry.case === name);
const outcomes = readStudyTable('synthetic_outcomes.csv');
const base = { baseline_visits: 'Baseline' };
// The outcomes table read the other way round, as one case brings it.
const settingsOf = (entry) =>
  syncSettings('strEventCol' in entry.args ? { ...base, event_col: 'EVENT' } : base);
const tablesOf = (entry) => ({
  results: (entry.tables && entry.tables.results) || results,
  participants: (entry.tables && entry.tables.participants) || participants,
  outcomes: (entry.tables && entry.tables.outcomes) || outcomes
});
const stateOf = (entry) => ({
  endpoint: entry.dataId.endpoint,
  groupBy: entry.dataId.group_by,
  filters: Object.fromEntries(
    Object.entries(entry.dataId.filters || {}).map(([column, values]) => [column, values[0]])
  )
});
const modelOf = (entry) =>
  buildSurvival(tablesOf(entry), settingsOf(entry), stateOf(entry), {
    kmEstimate: kit.kmEstimate
  });

const refused = (overrides) => {
  try {
    syncSettings(overrides);
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    return error.message;
  }
  throw new Error(`not refused: ${JSON.stringify(overrides)}`);
};

describe('stratified survival: settings', () => {
  it('SS-CFG-001: every setting has a default; the outcomes table is read by its time and one flag, censored or event, never both; the groups are a column or a cut variable (#61)', () => {
    expect(syncSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({
      endpoint_col: 'PARAMCD',
      time_col: 'AVAL',
      censor_col: 'CNSR',
      event_col: null,
      statistic: 'Analyze_Survival'
    });
    expect(flagOf(syncSettings())).toEqual({ col: 'CNSR', field: 'censor' });
    // Naming an event column reads the table the other way round.
    const events = syncSettings({ event_col: 'EVENT' });
    expect(events.censor_col).toBe(null);
    expect(flagOf(events)).toEqual({ col: 'EVENT', field: 'event' });
    expect(refused({ censor_col: 'CNSR', event_col: 'EVENT' })).toMatch(
      /Name exactly one of `censor_col` .* and `event_col`/
    );
    expect(refused({ censor_col: null })).toMatch(/Name exactly one of/);
    expect(
      syncSettings({ group_by: { measure: 'CRP', visit: 'Baseline', cut: 'median' } }).group_by
    ).toEqual({ measure: 'CRP', visit: 'Baseline', value: 'raw', cut: 'median' });
    expect(refused({ group_by: { measure: 'CRP', visit: 'Baseline' } })).toMatch(
      /`group_by` is a variable with no cut/
    );
    expect(refused({ at_risk_times: [0, 12, 6] })).toMatch(/`at_risk_times` must be a list/);
    expect(refused({ time_col: '' })).toBe('bio.viz: `time_col` must be the name of a column.');
    expect(refused({ alpha: 0.05 })).toMatch(
      /`alpha` is not a setting of the stratified survival chart/
    );
  });
});

describe('stratified survival: who is drawn, and each curve', () => {
  it('SS-DATA-001: each participant drawn is in desktop R’s group, with R’s time and event, for every case (#61)', () => {
    expect(fromR.cases.length).toBeGreaterThanOrEqual(8);
    for (const entry of fromR.cases) {
      const model = modelOf(entry);
      expect(
        model.records.map((record) => [record.USUBJID, record.group, record.time, record.event]),
        entry.case
      ).toEqual(
        entry.ids.map((id, i) => [id, entry.group_of[i], entry.time_of[i], entry.event_of[i]])
      );
      expect([...model.levels].sort(), entry.case).toEqual([...entry.groups].sort());
      if (entry.points) {
        expect(model.cut.points, entry.case).toEqual(entry.points);
        expect(model.values.length, entry.case).toBe(entry.n_values);
      }
    }
  });

  it('SS-CURVE-001: each group’s curve is safety.viz’s kmEstimate, and its steps are R’s survfit() estimate: the same event times, numbers at risk, events and survival, and the same censored times (#61)', () => {
    for (const entry of fromR.cases) {
      const model = modelOf(entry);
      for (const curve of entry.curves) {
        const ours = model.curves.find((found) => found.level === curve.group);
        const where = `${entry.case} ${curve.group}`;
        expect(ours, where).toBeDefined();
        const steps = curve.time
          .map((time, i) => ({
            time,
            atRisk: curve.n_risk[i],
            events: curve.n_event[i],
            surv: curve.surv[i]
          }))
          .filter((step) => step.events > 0);
        expect(
          ours.estimate.points.map((point) => [point.time, point.atRisk, point.events]),
          where
        ).toEqual(steps.map((step) => [step.time, step.atRisk, step.events]));
        ours.estimate.points.forEach((point, i) =>
          expect(point.surv, `${where} at ${point.time}`).toBeCloseTo(steps[i].surv, 12)
        );
        expect(
          ours.estimate.censorTimes.map((mark) => [mark.time, mark.count]),
          where
        ).toEqual(
          curve.time.map((time, i) => [time, curve.n_censor[i]]).filter(([, count]) => count > 0)
        );
      }
    }
  });

  it('SS-DATA-002: the outcomes table is read either way round: a flag of events gives the same participants, groups and curves as ADaM’s CNSR (#61)', () => {
    const censored = modelOf(caseOf('crp-median'));
    const evented = modelOf(caseOf('crp-median-event-flag'));
    expect(evented.records.map((record) => [record.USUBJID, record.group, record.event])).toEqual(
      censored.records.map((record) => [record.USUBJID, record.group, record.event])
    );
    expect(evented.curves.map((curve) => curve.estimate.points)).toEqual(
      censored.curves.map((curve) => curve.estimate.points)
    );
    // The flag goes to R as the table gives it, under its own name.
    expect(evented.records[0].flag).toBe(1 - censored.records[0].flag);
  });

  it('SS-DATA-003: a participant with a group and no usable outcome is left out and counted by reason: no row, more than one, a time or flag that is missing or not a number, a flag that is not 0 or 1, a time below 0 (#61)', () => {
    const settings = syncSettings({ group_by: 'ARM' });
    const row = (id, time, flag) => ({ USUBJID: id, PARAMCD: 'EFS', AVAL: time, CNSR: flag });
    const ids = participants.slice(0, 7).map((person) => person.USUBJID);
    const odd = [
      row(ids[0], '3', '0'),
      row(ids[1], '4', '1'),
      row(ids[1], '5', '1'),
      row(ids[2], '', '0'),
      row(ids[3], '6', 'x'),
      row(ids[4], '7', '2'),
      row(ids[5], '-1', '0')
    ];
    const kept = participants.filter((person) => ids.includes(person.USUBJID));
    const model = buildSurvival(
      {
        results: results.filter((result) => ids.includes(result.USUBJID)),
        participants: kept,
        outcomes: odd
      },
      settings,
      { endpoint: 'EFS', groupBy: 'ARM', filters: {} },
      { kmEstimate: kit.kmEstimate }
    );
    expect(model.records.map((record) => record.USUBJID)).toEqual([ids[0]]);
    expect(model.dropped).toEqual([
      { reason: LEFT_OUT.SEVERAL_OUTCOMES, n: 1 },
      { reason: LEFT_OUT.MISSING_OUTCOME, n: 2 },
      { reason: LEFT_OUT.NOT_A_FLAG, n: 1 },
      { reason: LEFT_OUT.NEGATIVE_TIME, n: 1 },
      { reason: LEFT_OUT.NO_OUTCOME, n: 1 }
    ]);
    expect(listEndpoints(outcomes, settings)).toEqual([
      { endpoint: 'EFS', label: 'Event-free survival (months)' }
    ]);
  });

  it('SS-RISK-001: the at-risk strip counts, at each time of the axis, the participants of a group whose time is at or after it, and those are the ones a cell lists (#61)', () => {
    expect(timeTicks(24)).toEqual([0, 5, 10, 15, 20]);
    expect(timeTicks(12)).toEqual([0, 2.5, 5, 7.5, 10, 12.5].filter((t) => t <= 12));
    expect(timeTicks(0)).toEqual([0]);
    const entry = caseOf('crp-median');
    const model = modelOf(entry);
    expect(model.times).toEqual(timeTicks(model.last));
    for (const curve of model.curves) {
      curve.risk.forEach((cell) => {
        const listed = atRisk(model, curve.level, cell.time);
        expect(listed.length, `${curve.level} at ${cell.time}`).toBe(cell.atRisk);
        const inR = entry.ids.filter(
          (id, i) => entry.group_of[i] === curve.level && entry.time_of[i] >= cell.time
        );
        expect(listed.map((record) => record.USUBJID)).toEqual(inR);
      });
    }
  });

  it('SS-CUT-001: for a cut variable the histogram holds every value the points were worked out on, and a cut line dropped becomes a typed point as its label writes it (#61)', () => {
    const model = modelOf(caseOf('crp-median'));
    expect(model.bars.reduce((total, bar) => total + bar.n, 0)).toBe(model.values.length);
    expect(model.bars[0].from).toBe(Math.min(...model.values));
    expect(model.bars.at(-1).to).toBe(Math.max(...model.values));
    expect(histogramOf([])).toEqual([]);
    expect(histogramOf([2, 2])).toEqual([{ from: 2, to: 2, n: 2 }]);
    // A dropped line is a point written to four significant digits.
    expect(dropPoint(4.0123456)).toBe(4.012);
    expect(dropPoint(3.99996)).toBe(4);
    expect(dropPoint(0.000123456)).toBe(0.0001235);
  });
});

describe('stratified survival: what R is asked, and what the line says', () => {
  it('SS-STAT-001: R is asked once per view, with one row per participant drawn, and the function, the arguments, the identity and the row count desktop R’s recipe writes; the flag goes under the name the table reads it by (#61)', () => {
    for (const entry of fromR.cases) {
      const settings = settingsOf(entry);
      const model = modelOf(entry);
      const request = survivalRequest({
        name: settings.statistic,
        settings,
        state: stateOf(entry),
        model
      });
      expect(request.name, entry.case).toBe(entry.name);
      expect(canonicalJson(request.args), entry.case).toBe(canonicalJson(entry.args));
      expect(canonicalJson(request.dataId), entry.case).toBe(canonicalJson(entry.dataId));
      expect(request.rows, entry.case).toBe(entry.rows);
      expect(Object.keys(request.data[0]), entry.case).toEqual([
        'USUBJID',
        'time',
        'group',
        'strEventCol' in entry.args ? 'event' : 'censor'
      ]);
    }
  });

  it('SS-STAT-002: handed to a connection as stored results, each of R’s answers is found by the chart’s request for its view (#61)', async () => {
    const connection = createConnection({
      results: fromR.cases.map(({ name, args, dataId, rows, value }) => ({
        name,
        args,
        dataId,
        rows,
        value
      }))
    });
    for (const entry of fromR.cases) {
      const settings = settingsOf(entry);
      const request = survivalRequest({
        name: settings.statistic,
        settings,
        state: stateOf(entry),
        model: modelOf(entry)
      });
      expect(await connection.run(request.name, request), entry.case).toEqual({
        status: 'ok',
        value: entry.value,
        form: 'precomputed'
      });
    }
  });

  it('SS-STAT-003: R’s log-rank test is printed with its method and counts, each group’s median with its log-log interval, a median R did not reach as not reached, and, for two groups, the hazard ratio with its interval (#61)', () => {
    const median = describeAnswer({ status: 'ok', value: caseOf('crp-median').value });
    expect(median.state).toBe('shown');
    expect(median.text).toBe(
      'Log-rank test: p < 0.001 (> 2.783 n = 100, ≤ 2.783 n = 100). Exploratory, unadjusted.'
    );
    // A cut's groups go to R high to low: the hazard ratio is high over low,
    // as the biomarker screen's is.
    expect(median.estimates).toEqual([
      'Median (> 2.783): 8.28, 95% confidence interval 5.24 to 9.71.',
      'Median (≤ 2.783): 23.32, 95% confidence interval 17.32 to not reached.',
      'Hazard ratio (> 2.783 / ≤ 2.783): 3.523, 95% confidence interval 2.43 to 5.107.'
    ]);
    // Three groups: medians, and no hazard ratio.
    const tertiles = describeAnswer({ status: 'ok', value: caseOf('crp-tertiles').value });
    expect(tertiles.estimates).toHaveLength(3);
    expect(tertiles.estimates.every((line) => line.startsWith('Median ('))).toBe(true);
    expect(
      scopeText({
        n: 91,
        endpoint: 'Event-free survival (months)',
        filters: [{ label: 'Sex', values: ['F'] }]
      })
    ).toBe(
      'This test is of the 91 participants drawn, on Event-free survival (months). Filters: Sex is F.'
    );
    expect(ONE_GROUP).toMatch(/^Statistics: no test\./);
  });

  it('SS-STAT-004: a hazard ratio R does not estimate is not printed, and R’s note says why, as R wrote it (#61)', () => {
    const value = caseOf('no-events-in-one-arm').value;
    const described = describeAnswer({ status: 'ok', value });
    expect(described.state).toBe('shown');
    expect(described.estimates.some((line) => line.startsWith('Hazard ratio'))).toBe(false);
    expect(described.estimates).toContain(
      'Median (Late): not reached, 95% confidence interval not reached.'
    );
    const note = value.notes.find((said) => said.startsWith('The hazard ratio is not estimable'));
    expect(note).toMatch(/Late has no events/);
    expect(described.remarks).toContainEqual({ kind: 'note', text: `R’s note: ${note}` });
  });

  it('SS-STAT-005: a group below R’s minimum size prints R’s reason and counts, and no number (#61)', () => {
    const value = caseOf('crp-at-10').value;
    expect(value.status).toBe('too_small');
    const described = describeAnswer({ status: 'ok', value });
    expect(described.state).toBe('withheld');
    expect(described.text.startsWith(value.reason)).toBe(true);
    expect(described.text).not.toMatch(/p [=<]/);
  });
});
