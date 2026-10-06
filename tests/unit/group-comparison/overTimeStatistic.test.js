import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CASES,
  GROUP_STATISTICS,
  OVER_TIME_CASES,
  deriveGroupStatistics,
  overTimeRequestOf,
  overTimeStateOf,
  readDemo,
  requestOf
} from '../../../scripts/group-statistics-lib.mjs';
import { createConnection } from '../../../src/r/index.js';
import { canonicalJson } from '../../../src/r/canonical.js';
import { syncSettings } from '../../../src/group-comparison/configure.js';
import { buildOverTime } from '../../../src/group-comparison/overTime.js';
import {
  createStatisticDesk,
  describeLevels,
  levelsScope,
  overTimeRequest
} from '../../../src/group-comparison/statistic.js';
import { participants, results } from '../core/study.js';

// The row of tests under one biomarker over time (#85). The chart asks R once
// for the test at every visit, and prints what comes back. The answers here are
// desktop R's, for rows the chart's own code derived
// (tests/fixtures/group-statistics-r.json, `over_time`); no number was typed.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const text = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const sources = Object.fromEntries(
  Object.entries(GROUP_STATISTICS.sources).map(([name, file]) => [name, text(file)])
);
const demo = readDemo(sources);
const fromR = JSON.parse(text(GROUP_STATISTICS.expected));
const resultOf = (name) => fromR.over_time.find((result) => result.case === name);
const caseOf = (name) => OVER_TIME_CASES.find((entry) => entry.case === name);
const answered = (name) => ({ status: 'ok', value: resultOf(name).value, form: 'precomputed' });

const VISITS = ['Baseline', 'Week 2', 'Week 4', 'Week 8', 'Week 12'];
const settings = syncSettings({ baseline_visits: 'Baseline' });
const state = (overrides = {}) => ({
  measure: 'IL-6',
  visits: VISITS,
  valueType: 'raw',
  groupBy: 'ARM',
  levels: null,
  colorBy: '',
  panelBy: '',
  mark: 'box',
  timeMark: 'box',
  yScale: 'linear',
  filters: {},
  ...overrides
});
const request = (overrides = {}, parts = {}, config = settings) => {
  const drawn = state(overrides);
  return overTimeRequest({
    name: 'Analyze_GroupDifferenceBy',
    test: 't',
    adjustment: 'none',
    settings: config,
    state: drawn,
    built: buildOverTime({ results, participants }, config, drawn),
    ...parts
  });
};

describe('one biomarker over time: what R is asked', () => {
  it('GC-TIME-008: R is asked once for the whole row of visits: the rows of every visit tested, one per participant and visit, each the row its own panel hands R with the visit named; the arguments name the column of visits, the visits in order and the adjustment (#85)', () => {
    const asked = request();
    expect(asked.name).toBe('Analyze_GroupDifferenceBy');
    expect(asked.args).toEqual({
      strValueCol: 'y',
      strGroupCol: 'x',
      strByCol: 'visit',
      strMethod: 't',
      chrBy: VISITS,
      strPAdjust: 'none'
    });
    expect(Object.keys(asked.data[0])).toEqual(['USUBJID', 'y', 'x', 'visit']);
    expect(asked.rows).toBe(943);
    expect(asked.data).toHaveLength(943);
    // In visit order, and each visit's rows are the rows of that visit's panel.
    expect([...new Set(asked.data.map((row) => row.visit))]).toEqual(VISITS);
    for (const visit of VISITS) {
      const single = requestOf(demo, {
        case: visit,
        view: { valueType: 'raw', visits: [visit] },
        test: 't'
      });
      expect(
        asked.data.filter((row) => row.visit === visit).map(({ visit: at, ...row }) => row),
        visit
      ).toEqual(single.data);
    }
    // One participant, one row a visit.
    const seen = new Set(asked.data.map((row) => `${row.USUBJID}\u0000${row.visit}`));
    expect(seen.size).toBe(asked.data.length);
    // The test and the adjustment are the ones chosen, as R names them.
    expect(request({}, { test: 'wilcoxon', adjustment: 'holm' }).args).toMatchObject({
      strMethod: 'wilcoxon',
      strPAdjust: 'holm'
    });
    expect(request({}, { adjustment: 'BH' }).args.strPAdjust).toBe('BH');
    // A column's groups are left to R; no pairwise comparison is asked for here.
    expect(asked.args).not.toHaveProperty('chrGroups');
    expect(asked.args).not.toHaveProperty('bPairwise');
  });

  it('GC-TIME-009: the identity of the rows names the biomarker, the value, the visits tested in order, the baseline, the groups, the filters in force and a logarithmic axis; it has no colour and no panel, whatever those controls hold, and says unscheduled visits only when they are drawn (#85)', () => {
    expect(request().dataId).toEqual({
      chart: 'group-comparison',
      measure: 'IL-6',
      value_type: 'raw',
      visits: VISITS,
      baseline_visits: ['Baseline'],
      baseline_stat: 'mean',
      group_by: 'ARM',
      groups: ['Placebo', 'Treatment']
    });
    // The members in the order written: one text for one view.
    expect(Object.keys(request({ filters: { SEX: 'F' }, yScale: 'log' }).dataId)).toEqual([
      'chart',
      'measure',
      'value_type',
      'visits',
      'baseline_visits',
      'baseline_stat',
      'group_by',
      'groups',
      'filters',
      'positive_only'
    ]);
    expect(request({ filters: { SEX: 'F' } }).dataId.filters).toEqual({ SEX: ['F'] });
    expect(request({ yScale: 'log' }).dataId.positive_only).toBe(true);
    // Colour by and Panel by are not applied, so they are not in the identity.
    const withBoth = request({ colorBy: 'SEX', panelBy: 'SEX' });
    expect(withBoth.dataId).toEqual(request().dataId);
    expect(withBoth.data).toEqual(request().data);
    // No baseline visit named in settings: none in the identity.
    expect(request({}, {}, syncSettings({})).dataId).not.toHaveProperty('baseline_visits');
    expect(request().dataId).not.toHaveProperty('unscheduled_visits');
    expect(request({}, { unscheduled: true }).dataId.unscheduled_visits).toBe(true);
    expect(Object.keys(request({}, { unscheduled: true }).dataId).at(-1)).toBe(
      'unscheduled_visits'
    );
    // Another view, another identity.
    const base = canonicalJson(request().dataId);
    for (const other of [
      { measure: 'CRP' },
      { valueType: 'change' },
      { groupBy: 'SEX' },
      { filters: { SEX: 'F' } },
      { yScale: 'log' }
    ]) {
      expect(canonicalJson(request(other).dataId), JSON.stringify(other)).not.toBe(base);
    }
    // And it is not the identity of any one panel, which names one `visit`.
    expect(request().dataId).not.toHaveProperty('visit');
  });

  it('GC-TIME-010: the baseline visit of a change is not sent: R is asked about the later visits alone, so it is never asked to test a value that is the same for everyone (#85)', () => {
    for (const valueType of ['change', 'fold_change', 'percent_change']) {
      const asked = request({ valueType });
      expect(asked.args.chrBy, valueType).toEqual(VISITS.slice(1));
      expect(asked.dataId.visits, valueType).toEqual(VISITS.slice(1));
      expect(
        asked.data.some((row) => row.visit === 'Baseline'),
        valueType
      ).toBe(false);
    }
    expect(request({ valueType: 'change' }).rows).toBe(743);
    // With several baseline visits a value at one of them varies, and is tested.
    const several = request(
      { valueType: 'change' },
      {},
      syncSettings({ baseline_visits: ['Baseline', 'Week 2'] })
    );
    expect(several.args.chrBy).toEqual(VISITS);
    expect(several.dataId.baseline_visits).toEqual(['Baseline', 'Week 2']);
  });

  it('GC-TIME-011: a cut’s groups are handed to R low to high, as for one panel, and the identity names the cut variable and keeps the groups sorted by code point (#85)', () => {
    const cut = { measure: 'CRP', visit: 'Baseline', value: 'raw', cut: 'tertiles' };
    const asked = request({ groupBy: cut });
    expect(asked.args.chrGroups).toHaveLength(3);
    const built = buildOverTime({ results, participants }, settings, state({ groupBy: cut }));
    expect(asked.args.chrGroups).toEqual(built.groups.map((group) => group.level));
    expect(asked.dataId.group_by).toEqual(cut);
    expect([...asked.dataId.groups].sort()).toEqual([...asked.args.chrGroups].sort());
    expect(new Set(asked.data.map((row) => row.x))).toEqual(new Set(asked.args.chrGroups));
  });
});

describe('one biomarker over time: the rows R is run on, and the key R wrote', () => {
  it('GC-TIME-012: deriving each case’s long rows again, with the chart’s own code from the demo’s own tables and settings, gives the committed files (#85)', () => {
    const { files, record } = deriveGroupStatistics(sources);
    const own = OVER_TIME_CASES.filter((entry) => !entry.rows).map((entry) => `${entry.case}.csv`);
    // After them come the difference grid's files (#86), held by GC-GRID-009.
    expect(files.map((entry) => entry.file).slice(0, CASES.length + own.length + 2)).toEqual([
      ...CASES.map((entry) => `${entry.case}.csv`),
      'cases.csv',
      ...own,
      'over-time-cases.csv'
    ]);
    for (const { file, text: derived } of files) {
      expect(text(`${GROUP_STATISTICS.directory}/${file}`), file).toBe(derived);
    }
    expect(readdirSync(path.join(ROOT, GROUP_STATISTICS.directory)).sort()).toEqual(
      [...files.map((entry) => entry.file), 'SOURCE.json'].sort()
    );
    const committed = JSON.parse(text(GROUP_STATISTICS.record));
    expect(committed.over_time_cases).toEqual(record.over_time_cases);
    expect(committed.over_time_cases.map((entry) => entry.case)).toEqual(
      OVER_TIME_CASES.map((entry) => entry.case)
    );
    // The rows are long: the id, the value, the group and the visit.
    const lines = text(`${GROUP_STATISTICS.directory}/over-time-change.csv`).trimEnd().split('\n');
    expect(lines[0]).toBe('USUBJID,y,x,visit');
    expect(lines).toHaveLength(744);
    expect(lines.some((line) => line.endsWith(',Baseline'))).toBe(false);
    // Every case is the picture over time: a biomarker with every visit it has.
    for (const entry of OVER_TIME_CASES) {
      expect(overTimeStateOf(demo, entry).visits, entry.case).toEqual(VISITS);
    }
  });

  it('GC-TIME-013: for every case the function, the arguments, the identity and the row count R wrote by the recipe are the ones the chart asks with, and handed to a connection as stored results each answer is found by the chart’s request and by no other view’s (#85)', async () => {
    expect(fromR.over_time.map((result) => result.case)).toEqual(
      OVER_TIME_CASES.map((entry) => entry.case)
    );
    for (const entry of OVER_TIME_CASES) {
      const asked = overTimeRequestOf(demo, entry);
      const written = resultOf(entry.case);
      expect(written.name, entry.case).toBe(asked.name);
      expect(written.args, entry.case).toEqual(asked.args);
      expect(written.dataId, entry.case).toEqual(asked.dataId);
      expect(written.rows, entry.case).toBe(asked.rows);
      expect(canonicalJson(written.dataId), entry.case).toBe(canonicalJson(asked.dataId));
      expect(canonicalJson(written.args), entry.case).toBe(canonicalJson(asked.args));
    }
    const connection = createConnection({
      results: fromR.over_time.map(({ name, args, dataId, rows, value }) => ({
        name,
        args,
        dataId,
        rows,
        value
      }))
    });
    const run = ({ name, data, args, dataId }) => connection.run(name, { data, args, dataId });
    for (const entry of OVER_TIME_CASES) {
      expect(await run(overTimeRequestOf(demo, entry)), entry.case).toEqual({
        status: 'ok',
        value: resultOf(entry.case).value,
        form: 'precomputed'
      });
    }
    // The same rows under another adjustment are another answer.
    const none = await run(overTimeRequestOf(demo, caseOf('over-time-result')));
    const holm = await run(overTimeRequestOf(demo, caseOf('over-time-result-holm')));
    expect(none.value.rows[1].p_value).not.toBe(holm.value.rows[1].p_value);
    // A view none was stored for is unavailable, never another view's numbers:
    // another biomarker, another adjustment of a stored view, and any one panel.
    const others = [
      overTimeRequestOf(demo, {
        case: 'another adjustment',
        view: { valueType: 'raw', groupBy: 'ARM_SEX' },
        test: 'anova',
        adjustment: 'BH'
      }),
      overTimeRequestOf(demo, {
        case: 'another value',
        view: { valueType: 'percent_change' },
        test: 't',
        adjustment: 'none'
      }),
      requestOf(demo, { case: 'one panel', view: { valueType: 'raw' }, test: 't' })
    ];
    for (const other of others) {
      const answer = await run(other);
      expect(answer.status).toBe('unavailable');
      expect(answer.reason).toBe('not-precomputed');
    }
  });

  it('GC-TIME-014: each visit’s p-value in R’s one answer is the one R gives when that visit is asked alone, and the adjusted one is what R’s p.adjust() makes of those across the visits that have one (#85)', () => {
    for (const result of fromR.over_time) {
      const { visits, p_unadjusted: alone, p_value: adjusted } = result.separately;
      expect(
        result.value.rows.map((row) => row.by),
        result.case
      ).toEqual(visits);
      expect(visits, result.case).toEqual(result.args.chrBy);
      result.value.rows.forEach((row, index) => {
        const label = `${result.case} ${row.by}`;
        expect(row.p_unadjusted, label).toBe(alone[index]);
        expect(row.p_value, label).toBe(adjusted[index]);
        expect(row.adjustment, label).toBe(result.args.strPAdjust);
        // A visit with no p-value is not a test, and is left out of the adjustment.
        if (alone[index] === null) {
          expect(row.status, label).not.toBe('ok');
          expect(row.adjusted_over, label).toBe(null);
        } else {
          expect(row.adjusted_over, label).toBe(alone.filter((p) => p !== null).length);
        }
      });
    }
    // The single-visit view's own answer, from the released fixture: the same number.
    const single = (visit) =>
      fromR.results.find(
        (result) => result.case === `result-${visit.toLowerCase().replace(' ', '-')}`
      ).value;
    resultOf('over-time-result').value.rows.forEach((row) => {
      expect(row.p_value, row.by).toBe(single(row.by).p_value);
      expect([row.n_1, row.n_2], row.by).toEqual(Object.values(single(row.by).counts));
      expect(row.method, row.by).toBe(single(row.by).method);
    });
    // Unadjusted, the two p-values of a row are the same; adjusted, never smaller.
    for (const row of resultOf('over-time-result').value.rows) {
      expect(row.p_value).toBe(row.p_unadjusted);
    }
    for (const row of resultOf('over-time-result-holm').value.rows) {
      expect(row.p_value).toBeGreaterThanOrEqual(row.p_unadjusted);
    }
  });
});

describe('one biomarker over time: what R’s answer reads as', () => {
  it('GC-TIME-015: each visit’s result is R’s, in parts: its p-value as R returned it with the method and each group’s count, and the line names the method once, how many visits were tested, and the adjustment with how many visits it covered (#85)', () => {
    const plain = describeLevels(answered('over-time-result'), { scope: 'What it covers.' });
    expect(plain.state).toBe('shown');
    expect(plain.text).toBe(
      'Welch Two Sample t-test at each visit, on the participants drawn there: 5 visits tested. ' +
        'Exploratory, unadjusted.'
    );
    expect(plain.levels.map((level) => [level.by, level.p])).toEqual([
      ['Baseline', 'p = 0.221'],
      ['Week 2', 'p < 0.001'],
      ['Week 4', 'p < 0.001'],
      ['Week 8', 'p < 0.001'],
      ['Week 12', 'p < 0.001']
    ]);
    expect(plain.levels[0].n).toEqual([100, 100]);
    expect(plain.details).toEqual([]);
    expect(plain.scope).toBe('What it covers.');
    expect(plain.estimates).toEqual([]);
    expect(plain.pairs).toBe(null);
    // R's notes are printed as R worded them.
    expect(plain.remarks.map((remark) => remark.kind)).toEqual(['note', 'note']);
    expect(plain.remarks[1].text).toBe(
      "R’s note: p_value is not adjusted across the levels: it is each level's own p-value. " +
        '5 of the 5 levels have one.'
    );

    const holm = describeLevels(answered('over-time-age-40-to-43'));
    expect(holm.text).toBe(
      'Welch Two Sample t-test at each visit, on the participants drawn there: 3 visits tested. ' +
        'Exploratory, adjusted (Holm) across 3 visits.'
    );
    expect(holm.levels.map((level) => [level.by, level.status, level.p])).toEqual([
      ['Baseline', 'shown', 'p > 0.999'],
      ['Week 2', 'withheld', null],
      ['Week 4', 'shown', 'p > 0.999'],
      ['Week 8', 'withheld', null],
      ['Week 12', 'shown', 'p = 0.579']
    ]);
    // A visit R did not compute says why beneath, as R worded it, with its counts.
    expect(holm.details).toEqual([
      'Week 2: Not computed: Placebo has 4. The minimum group size is 5. Counts: Placebo n = 4, Treatment n = 6.',
      'Week 8: Not computed: Placebo has 3. The minimum group size is 5. Counts: Placebo n = 3, Treatment n = 5.'
    ]);
    const bh = describeLevels(answered('over-time-change-wilcoxon'));
    expect(bh.text).toBe(
      'Wilcoxon rank sum test with continuity correction at each visit, on the participants ' +
        'drawn there: 4 visits tested. Exploratory, adjusted (Benjamini-Hochberg) across 4 visits.'
    );
    // More than two groups: the same parts.
    const anova = describeLevels(answered('over-time-anova'));
    expect(anova.text).toMatch(/^One-way analysis of variance at each visit/);
    expect(anova.levels[0]).toMatchObject({ p: 'p = 0.436', n: [44, 56, 47, 53] });
  });

  it('GC-TIME-016: when no visit could be tested the line gives R’s reason for the whole request once and each visit’s beneath; where the visits’ tests differ in name each visit’s sentence is given; and an answer that is not a row of visits, no R and an R error are each said as such (#85)', () => {
    const small = describeLevels(answered('over-time-age-57'));
    expect(small.state).toBe('withheld');
    expect(small.text).toBe(
      'Not computed: every level has a group below the minimum size. Each row gives its reason. ' +
        'Counts: Baseline n = 9, Week 2 n = 7, Week 4 n = 8, Week 8 n = 8, Week 12 n = 9.'
    );
    expect(small.levels.every((level) => level.status === 'withheld')).toBe(true);
    expect(small.details).toHaveLength(5);
    expect(small.details[0]).toBe(
      'Baseline: Not computed: Treatment has 2. The minimum group size is 5. Counts: Placebo n = 7, Treatment n = 2.'
    );
    // Two visits whose tests R named differently: each is given in full.
    const value = structuredClone(resultOf('over-time-change').value);
    value.rows[0].method = 'Wilcoxon rank sum exact test';
    const mixed = describeLevels({ status: 'ok', value });
    expect(mixed.text).toMatch(/^A test at each visit, named with it beneath, on the participants/);
    expect(mixed.details).toHaveLength(4);
    expect(mixed.details[0]).toMatch(/^Week 2: Wilcoxon rank sum exact test: p < 0\.001 \(/);
    // No R attached, a view not stored, and an R error.
    expect(describeLevels({ status: 'unavailable', message: 'No R is attached.' })).toMatchObject({
      state: 'unavailable',
      text: 'No R is attached.',
      levels: null,
      details: []
    });
    expect(describeLevels({ status: 'unavailable', reason: 'not-precomputed' }).text).toMatch(
      /^Statistics are unavailable for this view/
    );
    expect(describeLevels({ status: 'error', message: 'boom' })).toMatchObject({
      state: 'error',
      text: 'R reported an error: boom',
      levels: null
    });
    // R ran and refused the whole request: its reason, and no row.
    expect(
      describeLevels({
        status: 'ok',
        value: { status: 'error', reason: 'Column visit was not found.', rows: [] }
      })
    ).toMatchObject({
      state: 'error',
      text: 'R reported an error: Column visit was not found.',
      levels: null
    });
    // An answer with no row for any visit is not read as a result.
    expect(describeLevels(answered('over-time-result')).levels).toHaveLength(5);
    expect(
      describeLevels({
        status: 'ok',
        value: { status: 'ok', method: 'x', p_value: 0.5, counts: 3 }
      })
    ).toMatchObject({ state: 'refused', levels: null });
  });

  it('GC-TIME-017: the desk asks once for the row of visits, says it is waiting until R answers, reads the answer as a row of results, and drops an answer that arrives after the chart was drawn again (#85)', async () => {
    const calls = [];
    let release;
    const connection = {
      run(name, request) {
        calls.push({ name, ...request });
        return new Promise((resolve) => {
          release = () => resolve(answered('over-time-result'));
        });
      }
    };
    const desk = createStatisticDesk({ connection });
    const shown = [];
    const asked = overTimeRequestOf(demo, caseOf('over-time-result'));
    const first = desk
      .begin()
      .ask(asked, (description) => shown.push(description), { levels: true, scope: 'Scope.' });
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('Analyze_GroupDifferenceBy');
    expect(calls[0].data).toHaveLength(943);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ state: 'waiting', text: 'Statistics: waiting for R…' });
    release();
    expect(await first).toBe(true);
    expect(shown[1].levels).toHaveLength(5);
    expect(shown[1].scope).toBe('Scope.');
    // Asked again, and drawn again before R answers: the late answer is dropped.
    const late = desk
      .begin()
      .ask(asked, (description) => shown.push(description), { levels: true });
    desk.begin();
    release();
    expect(await late).toBe(false);
    expect(shown).toHaveLength(3);
    expect(shown[2].state).toBe('waiting');
  });

  it('GC-TIME-018: what the tests cover is said in plain words: a test of its own at each visit, the baseline visit of a change that is not tested and why, and the filters in force (#85)', () => {
    expect(levelsScope({ group: 'Arm' })).toBe(
      'Each visit has a test of its own, of the levels of Arm on the participants drawn at that visit.'
    );
    expect(
      levelsScope({
        group: 'Arm',
        untested: ['Baseline'],
        value: 'change from baseline',
        filters: [{ label: 'Sex', values: ['F'] }]
      })
    ).toBe(
      'Each visit has a test of its own, of the levels of Arm on the participants drawn at that visit. ' +
        'Baseline is not tested: it is the baseline visit, where the change from baseline is the same for everyone. ' +
        'Filters: Sex is F.'
    );
  });
});
