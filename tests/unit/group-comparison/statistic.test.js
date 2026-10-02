import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  NOT_STORED,
  NO_TEST_CHOSEN,
  TEST_LABELS,
  WAITING,
  createStatisticDesk,
  describeAnswer,
  fitTest,
  groupsOf,
  noTestText,
  plain,
  scopeText,
  sorted,
  statisticRequest,
  testsFor
} from '../../../src/group-comparison/statistic.js';
import { syncSettings } from '../../../src/group-comparison/configure.js';
import { createConnection } from '../../../src/r/index.js';

// The statistics line (#9, #16): which test R is asked for, what R is sent, and
// how what R answered is printed, through the connection and the shared
// formatters, and never an answer for rows other than the ones drawn.
//
// R here is a stand-in whose answers arrive when the test says so. Where a test
// needs a real answer, it is one desktop R gave: tests/fixtures/
// group-statistics-r.json, written by tools/r-group-statistics.R from gsm.bio's
// vendored statistics file. No number in these tests was typed.

const fromR = JSON.parse(
  readFileSync(new URL('../../fixtures/group-statistics-r.json', import.meta.url), 'utf8')
);
const answerOf = (name) => fromR.results.find((result) => result.case === name).value;
const ok = (value) => ({ status: 'ok', value, form: 'browser' });

function slowEngine() {
  const calls = [];
  return {
    calls,
    engine: {
      start: async () => {},
      call: (name, request) =>
        new Promise((resolve, reject) => calls.push({ name, ...request, resolve, reject }))
    }
  };
}
const request = (rows) => ({
  name: 'Analyze_GroupDifference',
  data: rows,
  args: { strValueCol: 'y', strGroupCol: 'x', strMethod: 't', bPairwise: false },
  dataId: { rows: rows.length }
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const deskOn = (engine, note) =>
  createStatisticDesk({ connection: createConnection({ browser: { engine } }), note });

describe('group comparison: the statistics line', () => {
  it('GC-STAT-001: with no R attached the line reads exactly what the connection answers (#9)', async () => {
    const desk = createStatisticDesk({ connection: createConnection() });
    const shown = [];
    const wasShown = await desk
      .begin()
      .ask(request([{ y: 1, x: 'A' }]), (line) => shown.push(line));
    expect(wasShown).toBe(true);
    expect(shown).toEqual([
      plain('waiting', WAITING),
      plain('unavailable', 'Statistics are unavailable: no R is attached to this chart.')
    ]);
  });

  it('GC-STAT-002: the line says it is waiting from the moment a result is asked for until it arrives (#9)', async () => {
    const { engine, calls } = slowEngine();
    const desk = deskOn(engine);
    const shown = [];
    const asked = desk.begin().ask(request([{ y: 1, x: 'A' }]), (line) => shown.push(line));
    // At once, before R has been reached.
    expect(shown).toEqual([plain('waiting', 'Statistics: waiting for R…')]);
    await settle();
    expect(shown).toHaveLength(1);
    expect(calls).toHaveLength(1);
    calls[0].resolve(answerOf('wilcoxon'));
    expect(await asked).toBe(true);
    expect(shown[1].state).toBe('shown');
    expect(shown[1].text).toBe(
      'Wilcoxon rank sum test with continuity correction: p < 0.001 (Placebo n = 95, Treatment n = 91). Exploratory, unadjusted.'
    );
  });

  it('GC-STAT-003: the request carries the rows that were drawn, the names of their fields and what the rows are (#9)', async () => {
    const { engine, calls } = slowEngine();
    const desk = deskOn(engine);
    const rows = [
      { USUBJID: 'BIO-001', y: -1.027, x: 'Placebo' },
      { USUBJID: 'BIO-002', y: 0.4, x: 'Treatment' }
    ];
    desk.begin().ask(request(rows), () => {});
    await settle();
    expect(calls[0].name).toBe('Analyze_GroupDifference');
    expect(calls[0].data).toEqual(rows);
    expect(calls[0].args).toEqual({
      strValueCol: 'y',
      strGroupCol: 'x',
      strMethod: 't',
      bPairwise: false
    });
  });

  it('GC-STAT-004: an answer that arrives after the chart has been drawn again is never shown (#9)', async () => {
    const { engine, calls } = slowEngine();
    const desk = deskOn(engine);
    const line = [];
    const show = (entry) => line.push(entry);

    // Drawn once, on 186 rows; then a filter changes and it is drawn again on 84.
    const first = desk.begin().ask(request(new Array(186).fill({ y: 1, x: 'A' })), show);
    await settle();
    const second = desk.begin().ask(request(new Array(84).fill({ y: 1, x: 'A' })), show);
    await settle();
    expect(calls.map((call) => call.data.length)).toEqual([186, 84]);
    // The line went back to waiting the moment the second drawing asked.
    expect(line.map((entry) => entry.state)).toEqual(['waiting', 'waiting']);

    // The second answer arrives first, and is shown.
    calls[1].resolve(answerOf('welch-women'));
    expect(await second).toBe(true);
    expect(line[line.length - 1].text).toContain('(Placebo n = 42, Treatment n = 42)');

    // The first arrives late, and is dropped: the line still reads the second.
    calls[0].resolve(answerOf('welch'));
    expect(await first).toBe(false);
    expect(line).toHaveLength(3);
    expect(line[line.length - 1].text).toContain('(Placebo n = 42, Treatment n = 42)');
  });

  it('GC-STAT-004: an answer still on its way when the chart is drawn again is dropped even if no other arrives (#9)', async () => {
    const { engine, calls } = slowEngine();
    const desk = deskOn(engine);
    const line = [];
    const first = desk.begin().ask(request([{ y: 1, x: 'A' }]), (entry) => line.push(entry));
    await settle();
    desk.begin();
    calls[0].resolve(answerOf('welch'));
    expect(await first).toBe(false);
    expect(line).toEqual([plain('waiting', WAITING)]);
  });

  it('GC-STAT-005: what R declined to compute, what the formatter refuses and what R reports as an error are each printed as such (#9)', async () => {
    expect(
      describeAnswer(
        ok({
          status: 'too_small',
          reason: 'fewer than 5 participants in Treatment',
          method: 'Welch Two Sample t-test',
          p_value: null,
          counts: { Placebo: 95, Treatment: 3 }
        })
      )
    ).toEqual(
      plain(
        'withheld',
        'Welch Two Sample t-test: not computed, fewer than 5 participants in Treatment (Placebo n = 95, Treatment n = 3).'
      )
    );
    // A p-value with no method is never printed.
    expect(describeAnswer(ok({ p_value: 0.01 }))).toEqual(
      plain('refused', 'p-value not shown: the result does not name its method.')
    );
    expect(describeAnswer({ status: 'error', message: 'object not found' })).toEqual(
      plain('error', 'R reported an error: object not found')
    );

    const { engine, calls } = slowEngine();
    const desk = deskOn(engine);
    const line = [];
    const asked = desk.begin().ask(request([{ y: 1, x: 'A' }]), (entry) => line.push(entry));
    await settle();
    calls[0].reject(new Error("Column 'y' (strValueCol) is not numeric."));
    expect(await asked).toBe(true);
    expect(line[1]).toEqual(
      plain('error', "R reported an error: Column 'y' (strValueCol) is not numeric.")
    );
  });
});

describe('group comparison: which test R is asked for', () => {
  it('GC-STAT-009: the tests offered are the ones that fit the number of groups drawn, and a test that does not fit gives way to its counterpart of the same kind (#16)', () => {
    expect(testsFor(2)).toEqual(['t', 'wilcoxon']);
    expect(testsFor(3)).toEqual(['anova', 'kruskal']);
    expect(testsFor(12)).toEqual(['anova', 'kruskal']);
    expect(testsFor(1)).toEqual([]);
    expect(testsFor(0)).toEqual([]);

    // The test chosen, where it fits.
    expect(fitTest('t', 2)).toBe('t');
    expect(fitTest('wilcoxon', 2)).toBe('wilcoxon');
    expect(fitTest('anova', 4)).toBe('anova');
    expect(fitTest('kruskal', 4)).toBe('kruskal');
    // Its counterpart, where it does not: means with means, ranks with ranks.
    expect(fitTest('t', 4)).toBe('anova');
    expect(fitTest('anova', 2)).toBe('t');
    expect(fitTest('wilcoxon', 3)).toBe('kruskal');
    expect(fitTest('kruskal', 2)).toBe('wilcoxon');
    // No test stays no test, and fewer than two groups have none to offer.
    expect(fitTest('none', 2)).toBe('none');
    expect(fitTest('none', 5)).toBe('none');
    for (const test of ['t', 'wilcoxon', 'anova', 'kruskal']) {
      expect(fitTest(test, 1)).toBe(null);
      expect(fitTest(test, 0)).toBe(null);
    }
    // Whatever is asked for is offered: R is never sent a test it would refuse
    // for the number of groups.
    for (const groups of [2, 3, 7]) {
      for (const test of ['t', 'wilcoxon', 'anova', 'kruskal']) {
        expect(testsFor(groups)).toContain(fitTest(test, groups));
      }
    }
    expect(TEST_LABELS).toEqual({
      t: 'Welch t-test',
      wilcoxon: 'Wilcoxon rank-sum test',
      anova: 'One-way ANOVA',
      kruskal: 'Kruskal-Wallis test',
      none: 'None'
    });
  });

  it('GC-STAT-017: with fewer than two groups to compare the line says why there is no test (#16)', () => {
    expect(noTestText(null, false)).toBe(
      'Statistics: no test. A test compares two or more groups, and no column makes a group.'
    );
    expect(noTestText(['Placebo'], false)).toBe(
      'Statistics: no test. A test compares two or more groups, and only Placebo has values.'
    );
    expect(noTestText(['Placebo'], true)).toBe(
      'Statistics: no test in this panel. A test compares two or more groups, and only Placebo has values here.'
    );
    expect(noTestText([], true)).toBe(
      'Statistics: no test in this panel. A test compares two or more groups, and none is drawn.'
    );
    expect(NO_TEST_CHOSEN).toBe('Statistics: no test chosen.');
  });
});

// One panel of the chart, as buildPanels makes it, cut down to what the
// request reads.
const panelOf = (records, { visit = 'Week 4', panelLevel = null } = {}) => ({
  records,
  visit,
  panelLevel
});
const rows = (...groups) =>
  groups.flatMap(([group, n]) =>
    Array.from({ length: n }, (unused, index) => ({
      USUBJID: `${group}-${index}`,
      y: index,
      x: group
    }))
  );
const view = {
  measure: 'IL-6',
  visits: ['Week 4'],
  valueType: 'change',
  groupBy: 'ARM',
  levels: null,
  colorBy: '',
  panelBy: '',
  mark: 'box',
  yScale: 'linear',
  test: 't',
  pairwise: false,
  filters: { ARM: null, SEX: null }
};
const settings = syncSettings({ baseline_visits: 'Baseline' });
const ask = (overrides = {}, panel = panelOf(rows(['Placebo', 6], ['Treatment', 5])), given = {}) =>
  statisticRequest({
    name: 'Analyze_GroupDifference',
    test: 't',
    pairwise: false,
    settings,
    state: { ...view, ...overrides },
    panel,
    ...given
  });

describe('group comparison: what R is asked', () => {
  it('GC-STAT-010: the request is the function, the panel’s rows, and four arguments: the two column names, the test and whether to compare every pair (#16)', () => {
    const panel = panelOf(rows(['Placebo', 6], ['Treatment', 5]));
    const asked = ask({}, panel);
    expect(Object.keys(asked)).toEqual(['name', 'data', 'args', 'dataId', 'rows']);
    expect(asked.name).toBe('Analyze_GroupDifference');
    // The rows themselves, not a copy that could differ.
    expect(asked.data).toBe(panel.records);
    expect(asked.rows).toBe(11);
    expect(asked.args).toEqual({
      strValueCol: 'y',
      strGroupCol: 'x',
      strMethod: 't',
      bPairwise: false
    });
    for (const test of ['t', 'wilcoxon', 'anova', 'kruskal']) {
      expect(ask({}, panel, { test }).args.strMethod).toBe(test);
    }
    // Nothing else is sent: the adjustment, the confidence level and the
    // minimum group size are R's own defaults.
    expect(Object.keys(asked.args)).toEqual([
      'strValueCol',
      'strGroupCol',
      'strMethod',
      'bPairwise'
    ]);

    // Pairs are asked for only when the switch is on and the rows hold more
    // than two groups: among two there is one pair, which is the test itself.
    const three = panelOf(rows(['A', 5], ['B', 5], ['C', 5]));
    expect(ask({}, three, { test: 'anova', pairwise: true }).args.bPairwise).toBe(true);
    expect(ask({}, three, { test: 'anova', pairwise: false }).args.bPairwise).toBe(false);
    expect(ask({}, panel, { test: 't', pairwise: true }).args.bPairwise).toBe(false);
    // The function is the one named in the setting.
    expect(ask({}, panel, { name: 'My_Test' }).name).toBe('My_Test');
  });

  it('GC-STAT-011: the identity of a panel’s rows states what was drawn, by the settings’ names, and leaves out what is not set (#16)', () => {
    expect(ask().dataId).toEqual({
      chart: 'group-comparison',
      measure: 'IL-6',
      value_type: 'change',
      visit: 'Week 4',
      baseline_visits: ['Baseline'],
      baseline_stat: 'mean',
      group_by: 'ARM',
      groups: ['Placebo', 'Treatment']
    });
    // Everything a view can have.
    const full = ask(
      {
        colorBy: 'SEX',
        panelBy: 'RESPONSE',
        yScale: 'log',
        filters: { SEX: 'F', AGE: ['57', '35'], ARM: null, RESPONSE: '' }
      },
      panelOf(rows(['Treatment', 5], ['Placebo', 6]), { panelLevel: 'Responder' })
    );
    expect(full.dataId).toEqual({
      chart: 'group-comparison',
      measure: 'IL-6',
      value_type: 'change',
      visit: 'Week 4',
      baseline_visits: ['Baseline'],
      baseline_stat: 'mean',
      group_by: 'ARM',
      groups: ['Placebo', 'Treatment'],
      color_by: 'SEX',
      panel_by: 'RESPONSE',
      panel: 'Responder',
      filters: { SEX: ['F'], AGE: ['35', '57'] },
      positive_only: true
    });
    // Nothing is written as null: a member that is not set is not there.
    const baseline = statisticRequest({
      name: 'Analyze_GroupDifference',
      test: 't',
      pairwise: false,
      settings: syncSettings({}),
      state: { ...view, valueType: 'baseline' },
      panel: panelOf(rows(['Placebo', 6], ['Treatment', 5]), { visit: null })
    }).dataId;
    expect(Object.keys(baseline)).toEqual([
      'chart',
      'measure',
      'value_type',
      'baseline_stat',
      'group_by',
      'groups'
    ]);
    expect(JSON.stringify([ask().dataId, full.dataId, baseline])).not.toContain('null');
  });

  it('GC-STAT-011: the groups are the ones in the rows, and text is sorted by code point, the order R’s radix sort gives (#16)', () => {
    expect(groupsOf(rows(['b', 1], ['B', 1], ['a', 1], ['Dose 10', 1], ['Dose 2', 1]))).toEqual([
      'B',
      'Dose 10',
      'Dose 2',
      'a',
      'b'
    ]);
    expect(sorted(['é', 'z', 'Z', 'e', '10', '9', 9])).toEqual(['10', '9', 'Z', 'e', 'z', 'é']);
    // By code point, not by UTF-16 unit: a character above the BMP sorts after one below it.
    expect(sorted(['\u{1F600}', 'Ａ'])).toEqual(['Ａ', '\u{1F600}']);
    // A level drawn elsewhere and absent from this panel is not one of its groups.
    expect(ask({}, panelOf(rows(['Treatment', 5]))).dataId.groups).toEqual(['Treatment']);
  });

  it('GC-STAT-011: a change to anything that changes the rows changes their identity (#16)', () => {
    const opening = JSON.stringify(ask().dataId);
    const changed = [
      ask({ measure: 'CRP' }),
      ask({ valueType: 'raw' }),
      ask({}, panelOf(rows(['Placebo', 6], ['Treatment', 5]), { visit: 'Week 12' })),
      ask({ groupBy: 'SEX' }),
      ask({}, panelOf(rows(['Placebo', 6], ['Other', 5]))),
      ask({ colorBy: 'SEX' }),
      ask({ panelBy: 'SEX' }, panelOf(rows(['Placebo', 6], ['Treatment', 5]), { panelLevel: 'F' })),
      ask({ filters: { SEX: 'F' } }),
      ask({ yScale: 'log' }),
      statisticRequest({
        name: 'Analyze_GroupDifference',
        test: 't',
        pairwise: false,
        settings: syncSettings({ baseline_visits: 'Baseline', baseline_stat: 'min' }),
        state: view,
        panel: panelOf(rows(['Placebo', 6], ['Treatment', 5]))
      }),
      statisticRequest({
        name: 'Analyze_GroupDifference',
        test: 't',
        pairwise: false,
        settings: syncSettings({ baseline_visits: ['Baseline', 'Week 2'] }),
        state: view,
        panel: panelOf(rows(['Placebo', 6], ['Treatment', 5]))
      })
    ].map((asked) => JSON.stringify(asked.dataId));
    for (const identity of changed) expect(identity).not.toBe(opening);
    expect(new Set(changed).size).toBe(changed.length);
    // The two panels of a view differ in their panel and nothing else.
    const panels = ['F', 'M'].map(
      (panelLevel) =>
        ask({ panelBy: 'SEX' }, panelOf(rows(['Placebo', 6], ['Treatment', 5]), { panelLevel }))
          .dataId
    );
    expect(panels[0]).toEqual({ ...panels[1], panel: 'F' });
    // What does not change the rows does not change it: how they are drawn.
    expect(JSON.stringify(ask({ mark: 'violin' }).dataId)).toBe(opening);
  });
});

describe('group comparison: how R’s answer is printed', () => {
  it('GC-STAT-012: the result is printed with its method and counts, labelled exploratory and unadjusted, for each of the four tests (#16)', () => {
    const printed = (name) => describeAnswer(ok(answerOf(name)));
    expect(printed('welch').text).toBe(
      'Welch Two Sample t-test: p < 0.001 (Placebo n = 95, Treatment n = 91). Exploratory, unadjusted.'
    );
    expect(printed('wilcoxon').text).toBe(
      'Wilcoxon rank sum test with continuity correction: p < 0.001 (Placebo n = 95, Treatment n = 91). Exploratory, unadjusted.'
    );
    expect(printed('anova').text).toBe(
      'One-way analysis of variance: p < 0.001 (Placebo F n = 42, Placebo M n = 53, Treatment F n = 42, Treatment M n = 49). Exploratory, unadjusted.'
    );
    expect(printed('kruskal').text).toBe(
      'Kruskal-Wallis rank sum test: p < 0.001 (Placebo F n = 42, Placebo M n = 53, Treatment F n = 42, Treatment M n = 49). Exploratory, unadjusted.'
    );
    // A p-value that is not small is printed to three decimals.
    expect(printed('anova-baseline').text).toBe(
      'One-way analysis of variance: p = 0.436 (Placebo F n = 44, Placebo M n = 56, Treatment F n = 47, Treatment M n = 53). Exploratory, unadjusted.'
    );
    for (const result of fromR.results) {
      const described = describeAnswer(ok(result.value), { scope: 'This test.' });
      const everything = JSON.stringify(described);
      expect(everything).not.toContain('*');
      expect(everything.toLowerCase()).not.toContain('significan');
      expect(described.state).toBe(result.value.status === 'ok' ? 'shown' : 'withheld');
    }
  });

  it('GC-STAT-013: for two groups the difference in means is printed with its interval, from R’s estimates, with what it is the difference of (#16)', () => {
    expect(describeAnswer(ok(answerOf('welch'))).estimates).toEqual([
      'Difference in means (Placebo - Treatment): 1.235, 95% confidence interval 0.844 to 1.626.'
    ]);
    // Whichever test was asked for, it is the estimate R returned with it.
    expect(describeAnswer(ok(answerOf('wilcoxon'))).estimates).toEqual([
      'Difference in means (Placebo - Treatment): 1.235, 95% confidence interval 0.844 to 1.626.'
    ]);
    expect(describeAnswer(ok(answerOf('welch-women'))).estimates).toEqual([
      'Difference in means (Placebo - Treatment): 1.098, 95% confidence interval 0.5471 to 1.649.'
    ]);
    // With more than two groups R gives no difference, and none is printed.
    expect(describeAnswer(ok(answerOf('anova'))).estimates).toEqual([]);
    expect(describeAnswer(ok(answerOf('kruskal-pairwise'))).estimates).toEqual([]);
    // The numbers are R's: the estimate R returned is the one printed.
    const { estimates } = answerOf('welch');
    expect(estimates.map((row) => row.name)).toEqual(['Mean', 'Mean', 'Difference in means']);
    expect(Number(estimates[2].estimate.toPrecision(4))).toBe(1.235);
  });

  it('GC-STAT-014: pairwise comparisons are printed as a table of each pair, its two counts and its adjusted p-value, under a caption naming the method and the adjustment (#16)', () => {
    const { pairs } = describeAnswer(ok(answerOf('anova-pairwise')));
    expect(pairs).toEqual({
      caption:
        'Pairwise comparisons, each by Welch Two Sample t-test. Exploratory, adjusted (Holm).',
      head: ['Pair', 'n', 'p, adjusted (Holm)'],
      rows: [
        ['Placebo F and Placebo M', '42, 53', 'p > 0.999'],
        ['Placebo F and Treatment F', '42, 42', 'p < 0.001'],
        ['Placebo F and Treatment M', '42, 49', 'p < 0.001'],
        ['Placebo M and Treatment F', '53, 42', 'p < 0.001'],
        ['Placebo M and Treatment M', '53, 49', 'p < 0.001'],
        ['Treatment F and Treatment M', '42, 49', 'p > 0.999']
      ].map(([pair, n, p]) => ({ status: 'shown', pair, n, p, method: null }))
    });
    // The whole-chart result above the table is not adjusted, and says so.
    expect(describeAnswer(ok(answerOf('anova-pairwise'))).text).toMatch(
      /\. Exploratory, unadjusted\.$/
    );

    // Where R used more than one method among the pairs, each pair names its own.
    const ranks = describeAnswer(ok(answerOf('kruskal-pairwise'))).pairs;
    expect(ranks.caption).toBe(
      'Pairwise comparisons, each by the test named with it. Exploratory, adjusted (Holm).'
    );
    expect(ranks.rows.map((row) => [row.pair, row.p, row.method])).toEqual([
      ['Placebo F and Placebo M', 'p > 0.999', 'Wilcoxon rank sum test with continuity correction'],
      [
        'Placebo F and Treatment F',
        'p = 0.006',
        'Wilcoxon rank sum test with continuity correction'
      ],
      ['Placebo F and Treatment M', 'p < 0.001', 'Wilcoxon rank sum exact test'],
      [
        'Placebo M and Treatment F',
        'p = 0.002',
        'Wilcoxon rank sum test with continuity correction'
      ],
      [
        'Placebo M and Treatment M',
        'p < 0.001',
        'Wilcoxon rank sum test with continuity correction'
      ],
      [
        'Treatment F and Treatment M',
        'p > 0.999',
        'Wilcoxon rank sum test with continuity correction'
      ]
    ]);
    // The p-value printed is the adjusted one R returned for the pair.
    const second = answerOf('kruskal-pairwise').rows[1];
    expect(second.p_value.toFixed(3)).toBe('0.006');
    expect(second.p_unadjusted.toFixed(3)).toBe('0.002');

    // No pairs, no table.
    expect(describeAnswer(ok(answerOf('anova'))).pairs).toBe(null);
    expect(describeAnswer(ok(answerOf('welch'))).pairs).toBe(null);

    // A pair R could not compute says why where its p-value would be.
    const broken = structuredClone(answerOf('anova-pairwise'));
    Object.assign(broken.rows[0], {
      status: 'error',
      reason: 'not enough observations',
      method: null,
      p_value: null
    });
    const table = describeAnswer(ok(broken)).pairs;
    expect(table.rows[0]).toEqual({
      status: 'error',
      pair: 'Placebo F and Placebo M',
      n: '42, 53',
      p: 'R reported an error: not enough observations (Placebo F n = 42, Placebo M n = 53).',
      method: null
    });
    expect(table.rows[1].p).toBe('p < 0.001');
  });

  it('GC-STAT-015: R’s warnings and notes are printed with the result, as R worded them (#16)', () => {
    expect(describeAnswer(ok(answerOf('welch'))).remarks).toEqual([]);
    expect(describeAnswer(ok(answerOf('wilcoxon'))).remarks).toEqual([
      {
        kind: 'note',
        text: 'R’s note: The difference in means and its interval are from t.test() (Welch), whatever the test.'
      }
    ]);
    expect(describeAnswer(ok(answerOf('kruskal-pairwise'))).remarks).toEqual([
      { kind: 'warning', text: 'R warned: cannot compute exact p-value with ties' },
      {
        kind: 'note',
        text: "R’s note: Pairwise: each pair is compared with wilcox.test(); p_value is adjusted across the pairs by p.adjust(method = 'holm'); the intervals are not adjusted."
      }
    ]);
    // Every warning and note R gave is there, for every result R gave.
    for (const { value } of fromR.results) {
      const { remarks } = describeAnswer(ok(value));
      expect(remarks.map((remark) => remark.text)).toEqual([
        ...value.warnings.map((said) => `R warned: ${said}`),
        ...value.notes.map((said) => `R’s note: ${said}`)
      ]);
    }
    // A warning that came with a result R withheld is printed too.
    expect(
      describeAnswer(ok({ ...answerOf('welch-age-57'), warnings: ['NaNs produced'] })).remarks
    ).toEqual([{ kind: 'warning', text: 'R warned: NaNs produced' }]);
  });

  it('GC-STAT-016: a group below the minimum size prints R’s reason once and no number, and a result R marked as an error prints R’s message (#16)', () => {
    const small = describeAnswer(ok(answerOf('welch-age-57')));
    expect(small.state).toBe('withheld');
    expect(small.text).toBe(
      'Not computed: Treatment has 1. The minimum group size is 5. Counts: Placebo n = 7, Treatment n = 1.'
    );
    // R's reason, word for word, and "not computed" once (#15).
    expect(small.text.startsWith(answerOf('welch-age-57').reason)).toBe(true);
    expect(small.text.match(/not computed/gi)).toHaveLength(1);
    expect(small.text).not.toMatch(/p [=<>]/);
    expect(small.estimates).toEqual([]);
    expect(small.pairs).toBe(null);

    const failed = describeAnswer(
      ok({
        status: 'error',
        reason: "Column 'y' (strValueCol) is not numeric.",
        test: 't',
        method: null,
        estimates: [],
        p_value: null,
        counts: null,
        warnings: [],
        notes: [],
        rows: []
      })
    );
    expect(failed.state).toBe('error');
    expect(failed.text).toBe("R reported an error: Column 'y' (strValueCol) is not numeric.");
    expect(failed.text.match(/error/gi)).toHaveLength(1);
  });

  it('GC-STAT-018: what one test covers is said under it: the rows, that each panel has its own, that a colour is not part of it, and the filters in force (#16)', () => {
    expect(scopeText({ group: 'Arm', n: 186 })).toBe(
      'This test compares the levels of Arm on the 186 participants drawn.'
    );
    expect(scopeText({ group: 'Arm', n: 84, panel: 'F' })).toBe(
      'This test compares the levels of Arm on the 84 participants drawn in this panel (F). ' +
        'Each panel has a test of its own, and they are not adjusted for one another.'
    );
    expect(scopeText({ group: 'Arm', n: 186, color: 'Sex' })).toBe(
      'This test compares the levels of Arm on the 186 participants drawn. ' +
        'Colour by Sex is not part of it: each level of Arm is tested whole.'
    );
    expect(
      scopeText({
        group: 'Arm',
        n: 1,
        panel: 'Week 12 · F',
        color: 'Response',
        filters: [
          { label: 'Sex', values: ['F'] },
          { label: 'Age', values: ['35', '57'] }
        ]
      })
    ).toBe(
      'This test compares the levels of Arm on the 1 participant drawn in this panel (Week 12 · F). ' +
        'Each panel has a test of its own, and they are not adjusted for one another. ' +
        'Colour by Response is not part of it: each level of Arm is tested whole. ' +
        'Filters: Sex is F; Age is 35 or 57.'
    );
    // It is printed with an answer from R, and with nothing else.
    expect(describeAnswer(ok(answerOf('welch')), { scope: 'This test.' }).scope).toBe('This test.');
    expect(describeAnswer(ok(answerOf('welch-age-57')), { scope: 'This test.' }).scope).toBe(
      'This test.'
    );
    expect(
      describeAnswer({ status: 'unavailable', message: 'No R.' }, { scope: 'This test.' }).scope
    ).toBe(null);
  });

  it('GC-STAT-019: the waiting text carries the page’s note on what starting R costs until R has answered once, and not after (#16)', async () => {
    const note = 'The first test starts R in this browser: about 13 MB to download, once.';
    const { engine, calls } = slowEngine();
    const desk = deskOn(engine, note);
    const line = [];
    const show = (entry) => line.push(entry);
    expect(desk.idle(NO_TEST_CHOSEN)).toBe(`Statistics: no test chosen. ${note}`);

    const first = desk.begin().ask(request([{ y: 1, x: 'A' }]), show);
    expect(line[0]).toEqual(plain('waiting', `Statistics: waiting for R… ${note}`));
    await settle();
    // Asked again before R has answered: R is still starting.
    const second = desk.begin().ask(request([{ y: 1, x: 'A' }]), show);
    expect(line[1].text).toBe(`Statistics: waiting for R… ${note}`);
    await settle();
    calls[0].resolve(answerOf('welch'));
    calls[1].resolve(answerOf('welch'));
    await Promise.all([first, second]);

    // R has answered: the next wait says only that it is waiting.
    desk.begin().ask(request([{ y: 1, x: 'A' }]), show);
    expect(line[line.length - 1]).toEqual(plain('waiting', WAITING));
    expect(desk.idle(NO_TEST_CHOSEN)).toBe('Statistics: no test chosen.');

    // An answer from the page's stored results starts no R, and the note stays.
    const stored = createStatisticDesk({
      connection: createConnection({
        results: [{ name: 'f', dataId: 'opening', value: answerOf('welch') }],
        browser: { engine: slowEngine().engine }
      }),
      note
    });
    await stored.begin().ask({ name: 'f', data: [], args: {}, dataId: 'opening' }, () => {});
    expect(stored.idle(WAITING)).toBe(`Statistics: waiting for R… ${note}`);
    // Several panels asking in one drawing: the first that waits says the
    // note, and the rest say only that they are waiting (#17).
    const several = deskOn(slowEngine().engine, note);
    const round = several.begin();
    const lines = [[], [], []];
    lines.forEach((shown) => round.ask(request([{ y: 1, x: 'A' }]), (entry) => shown.push(entry)));
    expect(lines.map((shown) => shown[0].text)).toEqual([
      `Statistics: waiting for R… ${note}`,
      WAITING,
      WAITING
    ]);
    // With no note the texts are the plain ones.
    expect(deskOn(slowEngine().engine).idle(WAITING)).toBe(WAITING);
  });

  it('GC-STAT-020: a view with no stored result reads that statistics are unavailable for it, in the chart’s words (#16)', () => {
    expect(
      describeAnswer({
        status: 'unavailable',
        reason: 'not-precomputed',
        message:
          'Statistics are unavailable: no stored result for Analyze_GroupDifference with these arguments on the data {"chart":"group-comparison"}.'
      })
    ).toEqual(plain('unavailable', NOT_STORED));
    expect(NOT_STORED).toBe(
      'Statistics are unavailable for this view: the page holds no stored result for it, and no R is attached to compute one.'
    );
    // Any other reason is printed as the connection worded it.
    expect(
      describeAnswer({
        status: 'unavailable',
        reason: 'load-failed',
        message: 'Statistics are unavailable: R could not be started (offline).'
      }).text
    ).toBe('Statistics are unavailable: R could not be started (offline).');
  });
});
