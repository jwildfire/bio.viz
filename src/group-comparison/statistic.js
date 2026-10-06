// The statistics line: what the chart prints under a panel about the groups it
// drew. The chart computes none of it. It chooses which test to ask R for,
// hands R the panel's rows through the connection, and prints what comes back
// through the formatters every chart uses.
//
// Two rules are kept here, because a wrong number under a chart is worse than
// none:
//
//   - The line says it is waiting from the moment a result is asked for until
//     that result arrives.
//   - A result is shown only if nothing has been drawn since it was asked for.
//     Every render begins a new round, and an answer to an earlier round is
//     dropped when it arrives, however late.
//
// Everything in this file is pure: no page and no chart. What is asked of R is
// one function of the settings, the controls and the panel's rows
// (`statisticRequest`), so the same request can be written down ahead of time,
// by R, as a stored result.

import {
  formatComparison,
  formatEstimate,
  formatLevel,
  formatStatistic
} from '../r/formatStatistic.js';
import { isCut } from '../shared/cut.js';
import {
  createDesk,
  failureOf,
  filtersInForce,
  filtersSaid,
  remarksOf,
  sentence,
  sorted
} from '../shared/statisticLine.js';

// The waiting state and the rule that a stale answer is never shown are every
// chart's, in src/shared/statisticLine.js; what this file has always exported
// of them is still reached from here.
export { NOT_STORED, WAITING, sorted } from '../shared/statisticLine.js';

export const NO_TEST_CHOSEN = 'Statistics: no test chosen.';

// ---- Which test ----------------------------------------------------------------

/** What the Test control calls each test. */
export const TEST_LABELS = Object.freeze({
  t: 'Welch t-test',
  wilcoxon: 'Wilcoxon rank-sum test',
  anova: 'One-way ANOVA',
  kruskal: 'Kruskal-Wallis test',
  none: 'None'
});

/**
 * The tests that fit a number of groups: the two-group tests for two, the
 * several-group tests for more, and none for fewer than two.
 * @param {number} groups How many groups are drawn.
 * @returns {string[]} Names of tests, as R's `strMethod` takes them.
 */
export function testsFor(groups) {
  if (groups === 2) return ['t', 'wilcoxon'];
  if (groups > 2) return ['anova', 'kruskal'];
  return [];
}

// Each test's counterpart of the same kind for the other number of groups: the
// two that compare means, and the two that compare ranks.
const COUNTERPART = { t: 'anova', anova: 't', wilcoxon: 'kruskal', kruskal: 'wilcoxon' };

/**
 * The test to ask for: the one chosen when it fits the number of groups drawn,
 * and otherwise its counterpart of the same kind. `none` stays `none`. With
 * fewer than two groups no test fits, and the answer is null.
 * @param {string} test The test chosen: `t`, `wilcoxon`, `anova`, `kruskal` or `none`.
 * @param {number} groups How many groups are drawn.
 * @returns {?string} The test to ask for, `none`, or null.
 */
export function fitTest(test, groups) {
  if (test === 'none') return 'none';
  const offered = testsFor(groups);
  if (!offered.length) return null;
  return offered.includes(test) ? test : COUNTERPART[test];
}

// ---- What R is asked -----------------------------------------------------------

/** The groups a panel's rows hold: the distinct values of `x`, sorted by code point. */
export const groupsOf = (records) => sorted(records.map((record) => record.x));

/**
 * What the chart asks R for one panel: the function, the rows, the arguments
 * and the identity of the rows. A member of the identity that is not set is
 * left out, never written as null, so the same identity is easy to write from
 * R.
 *
 * @param {object} parts
 * @param {string} parts.name The R function (the setting `statistic`).
 * @param {string} parts.test The test: `t`, `wilcoxon`, `anova` or `kruskal`.
 * @param {boolean} parts.pairwise Whether pairwise comparisons are switched on.
 * @param {object} parts.settings The chart's settings.
 * @param {object} parts.state What the controls are set to.
 * @param {object} parts.panel The panel: its rows, its visit and its panel level, and,
 *   when the groups are a cut's, its cells, which hold them low to high.
 * @param {boolean} [parts.unscheduled] Whether the rows were framed with
 *   unscheduled visits among the results: they are switched on, and the results
 *   have some. The identity then says so, because a baseline found among them
 *   need not be the one found without them; otherwise it is as it was before
 *   the chart knew of unscheduled visits.
 * @returns {{name: string, data: object[], args: object, dataId: object, rows: number}}
 */
export function statisticRequest({
  name,
  test,
  pairwise,
  settings,
  state,
  panel,
  unscheduled = false
}) {
  const groups = groupsOf(panel.records);
  const filters = filtersInForce(state.filters);
  const dataId = {
    chart: 'group-comparison',
    measure: state.measure,
    value_type: state.valueType,
    ...(panel.visit === null || panel.visit === undefined ? {} : { visit: panel.visit }),
    ...(settings.baseline_visits ? { baseline_visits: [...settings.baseline_visits] } : {}),
    baseline_stat: settings.baseline_stat,
    ...(state.groupBy ? { group_by: state.groupBy } : {}),
    groups,
    ...(state.colorBy ? { color_by: state.colorBy } : {}),
    ...(state.panelBy ? { panel_by: state.panelBy, panel: panel.panelLevel } : {}),
    ...(Object.keys(filters).length ? { filters } : {}),
    ...(state.yScale === 'log' ? { positive_only: true } : {}),
    ...(unscheduled ? { unscheduled_visits: true } : {})
  };
  const args = {
    strValueCol: 'y',
    strGroupCol: 'x',
    strMethod: test,
    // Pairs exist only among more than two groups.
    bPairwise: Boolean(pairwise) && groups.length > 2
  };
  // A cut's groups are handed to R low to high, the order they are drawn in, so
  // R names them in that order. A column's are left to R, which sorts them as
  // the identity does.
  if (isCut(state.groupBy)) {
    args.chrGroups = [...new Set(panel.cells.filter((cell) => cell.n).map((cell) => cell.level))];
  }
  return {
    name,
    data: panel.records,
    args,
    dataId,
    rows: panel.records.length
  };
}

/**
 * What the chart asks R under one biomarker over time: the group test at every
 * visit, in one request. The rows are long, one per participant and visit,
 * each the row the single-visit view hands R for that visit with the visit
 * named in `visit`; R answers a row per visit, and makes the adjustment across
 * them that the chart names. The baseline visit of a change is not sent: it is
 * drawn and not tested.
 *
 * A member of the identity that is not set is left out, never written as null.
 * It has no colour and no panel: the picture takes neither.
 *
 * @param {object} parts
 * @param {string} parts.name The R function (the setting `statistic_by_visit`).
 * @param {string} parts.test The test: `t`, `wilcoxon`, `anova` or `kruskal`.
 * @param {string} parts.adjustment How R adjusts the p-values across the
 *   visits, by `p.adjust()`'s name for it: `none`, `holm` or `BH`.
 * @param {object} parts.settings The chart's settings.
 * @param {object} parts.state What the controls are set to.
 * @param {object} parts.built The picture, as `buildOverTime` gives it.
 * @param {boolean} [parts.unscheduled] Whether the rows were framed with
 *   unscheduled visits among the results, as `statisticRequest` takes it.
 * @returns {{name: string, data: object[], args: object, dataId: object, rows: number}}
 */
export function overTimeRequest({
  name,
  test,
  adjustment,
  settings,
  state,
  built,
  unscheduled = false
}) {
  const tested = built.columns.filter((column) => column.tested);
  const visits = tested.map((column) => column.visit);
  const data = tested.flatMap((column) =>
    column.panel.records.map((record) => ({ ...record, visit: column.visit }))
  );
  const filters = filtersInForce(state.filters);
  const dataId = {
    chart: 'group-comparison',
    measure: state.measure,
    value_type: state.valueType,
    visits,
    ...(settings.baseline_visits ? { baseline_visits: [...settings.baseline_visits] } : {}),
    baseline_stat: settings.baseline_stat,
    ...(state.groupBy ? { group_by: state.groupBy } : {}),
    groups: groupsOf(data),
    ...(Object.keys(filters).length ? { filters } : {}),
    ...(state.yScale === 'log' ? { positive_only: true } : {}),
    ...(unscheduled ? { unscheduled_visits: true } : {})
  };
  const args = {
    strValueCol: 'y',
    strGroupCol: 'x',
    strByCol: 'visit',
    strMethod: test,
    // The visits in visit order: R would sort their names otherwise.
    chrBy: visits,
    strPAdjust: adjustment
  };
  // As for one panel: a cut's groups are handed to R low to high, and a
  // column's are left to R, which takes every group in the rows, the same at
  // every visit, and sorts them as the identity does.
  if (isCut(state.groupBy)) args.chrGroups = built.groups.map((group) => group.level);
  return { name, data, args, dataId, rows: data.length };
}

// ---- What the line says ---------------------------------------------------------

const present = (value) => value !== undefined && value !== null;

// The pairwise comparisons of a result, as a small table: each pair with its
// two counts and its p-value, under a caption that names the method and says
// how the p-values were adjusted. Null when the result has no pairs.
function pairsOf(value) {
  const rows = Array.isArray(value.rows) ? value.rows.filter((row) => 'group_1' in row) : [];
  if (!rows.length) return null;
  const formatted = rows.map(formatComparison);
  const shown = formatted.filter((row) => row.status === 'shown');
  const methods = [...new Set(shown.map((row) => row.method))];
  const labels = [...new Set(shown.map((row) => row.label))];
  const adjustments = [...new Set(shown.map((row) => row.adjustment))];
  const by =
    methods.length === 1
      ? `, each by ${methods[0]}`
      : methods.length > 1
        ? ', each by the test named with it'
        : '';
  return {
    caption: `Pairwise comparisons${by}.${labels.length ? ` ${labels.join(' ')}` : ''}`,
    head: [
      'Pair',
      'n',
      adjustments.length === 1 && adjustments[0] ? `p, adjusted (${adjustments[0]})` : 'p'
    ],
    rows: formatted.map((row) => ({
      status: row.status,
      pair: row.groups ? `${row.groups[0]} and ${row.groups[1]}` : '',
      n: row.n ? `${row.n[0]}, ${row.n[1]}` : '',
      // A pair with no p-value says why in its place.
      p: row.status === 'shown' ? row.p : row.result,
      method: methods.length > 1 && row.status === 'shown' ? row.method : null
    }))
  };
}

/**
 * A line that holds one sentence and nothing R returned with it: waiting, no
 * test chosen, unavailable.
 * @param {string} state The state of the line.
 * @param {string} said The sentence.
 * @returns {object} A description, as `describeAnswer` gives one.
 */
export const plain = (state, said) => ({ ...sentence(state, said), pairs: null });

/**
 * What one answer from the connection reads as on the line.
 *
 * @param {object} result What `connection.run` resolved to.
 * @param {object} [context]
 * @param {string} [context.scope] What the test covers, in a sentence.
 * @returns {{state: string, text: string, estimates: string[], pairs: ?object,
 *   remarks: Array<{kind: string, text: string}>, scope: ?string}} `text` is
 *   the result itself; the rest is what R returned with it.
 */
export function describeAnswer(result, context = {}) {
  if (result && result.status === 'ok') {
    const value = result.value && typeof result.value === 'object' ? result.value : {};
    const formatted = formatStatistic(value);
    const described = plain(formatted.status, formatted.text);
    if (formatted.status === 'shown') {
      // The estimates R gave an interval for: the difference in means.
      described.estimates = (Array.isArray(value.estimates) ? value.estimates : [])
        // An estimate R gave any part of an interval for is printed, or said
        // not to be shown and why; it never vanishes. The means carry none.
        .filter((row) => row && (present(row.lower) || present(row.upper)))
        .map((row) => formatEstimate(row).text);
      described.pairs = pairsOf(value);
    }
    // What R said about its answer is printed with it, as R worded it.
    described.remarks = remarksOf(value);
    described.scope = context.scope || null;
    return described;
  }
  const failure = failureOf(result);
  return plain(failure.state, failure.text);
}

/**
 * What the answer for a row of visits reads as: each visit's result in parts,
 * for the row of tests under the picture, and the sentence, R's remarks and
 * the scope for the line beneath.
 *
 * Every part is R's, through `formatLevel`: a visit's p-value is the one R
 * returned as `p_value`, adjusted across the visits when R says it adjusted,
 * and the adjustment and the number of visits it covered are R's too. Nothing
 * is worked out here.
 *
 * @param {object} result What `connection.run` resolved to.
 * @param {object} [context]
 * @param {string} [context.scope] What the tests cover, in a sentence.
 * @returns {{state: string, text: string, estimates: string[], pairs: null,
 *   details: string[], remarks: Array<{kind: string, text: string}>,
 *   scope: ?string, levels: ?object[]}} `levels` is one entry per visit R
 *   answered, as `formatLevel` gives it, or null when R answered no row;
 *   `details` are the sentences for the visits that have no p-value, each led
 *   by its visit, and, where the visits' tests differ in name, every visit's.
 */
export function describeLevels(result, context = {}) {
  if (!(result && result.status === 'ok')) {
    const failure = failureOf(result);
    return { ...plain(failure.state, failure.text), details: [], levels: null };
  }
  const value = result.value && typeof result.value === 'object' ? result.value : {};
  const rows = Array.isArray(value.rows)
    ? value.rows.filter((row) => row && typeof row === 'object' && 'by' in row)
    : [];
  const whole = formatStatistic(value);
  if (!rows.length) {
    // R answered no row: what it said of the whole request, or a refusal.
    const said =
      whole.status === 'shown'
        ? plain('refused', 'p-values not shown: the result has no row for any visit.')
        : plain(whole.status, whole.text);
    return { ...said, details: [], remarks: remarksOf(value), levels: null };
  }
  const levels = rows.map((row) => formatLevel(row, 'visit'));
  const shown = levels.filter((level) => level.status === 'shown');
  const methods = [...new Set(shown.map((level) => level.method))];
  const count = (visits) => (visits === 1 ? '1 visit' : `${visits} visits`);
  let state = 'shown';
  let text;
  if (!shown.length) {
    // No visit has a p-value: R's word for the whole request, said once.
    state = whole.status === 'shown' ? 'withheld' : whole.status;
    text = whole.status === 'shown' ? 'No visit has a p-value.' : whole.text;
  } else {
    const lead =
      methods.length === 1
        ? `${methods[0]} at each visit`
        : 'A test at each visit, named with it beneath';
    // R writes one adjustment on every row, and how many visits it covered.
    const [{ label, adjustment, over }] = shown;
    const labelled = adjustment ? `${label.replace(/\.$/, '')} across ${count(over)}.` : label;
    text = `${lead}, on the participants drawn there: ${count(shown.length)} tested. ${labelled}`;
  }
  return {
    ...plain(state, text),
    // A visit with no p-value says why, as R worded it; and where the visits'
    // tests differ in name, each visit's whole sentence is given.
    details: levels
      .filter((level) => level.status !== 'shown' || methods.length > 1)
      .map((level) => level.text),
    remarks: remarksOf(value),
    scope: context.scope || null,
    levels
  };
}

/**
 * What the tests under one biomarker over time cover, in plain words.
 * @param {object} parts
 * @param {string} parts.group The label of the column the groups come from.
 * @param {string[]} [parts.untested] The baseline visit of a change, which is
 *   drawn and not tested.
 * @param {string} [parts.value] The value type in words, for that sentence.
 * @param {Array<{label: string, values: string[]}>} [parts.filters] The filters in force.
 * @returns {string} One or more sentences.
 */
export function levelsScope({ group, untested = [], value = 'value', filters = [] }) {
  const named = group.includes(',') ? `${group},` : group;
  const said = [
    `Each visit has a test of its own, of the levels of ${named} on the participants drawn at that visit.`
  ];
  if (untested.length) {
    said.push(
      `${untested.join(', ')} is not tested: it is the baseline visit, where the ${value} is the same for everyone.`
    );
  }
  if (filters.length) said.push(filtersSaid(filters));
  return said.join(' ');
}

/**
 * Why a panel has no test: a test compares two or more groups.
 * @param {?string[]} groups The groups the panel's rows hold, or null when no
 *   column makes a group.
 * @param {boolean} several Whether the chart has several panels.
 * @returns {string} A sentence for the line.
 */
export function noTestText(groups, several) {
  const lead = `Statistics: no test${several ? ' in this panel' : ''}. A test compares two or more groups, and `;
  if (!groups) return `${lead}no column makes a group.`;
  if (groups.length === 1) return `${lead}only ${groups[0]} has values${several ? ' here' : ''}.`;
  return `${lead}none is drawn.`;
}

/**
 * What one test covers, in plain words: which rows, that a colour is not part
 * of it, that each panel has its own, and the filters in force.
 *
 * @param {object} parts
 * @param {string} parts.group The label of the column the groups come from.
 * @param {number} parts.n How many participants the panel's rows hold.
 * @param {string} [parts.panel] The panel's title, when there are several.
 * @param {string} [parts.color] The label of the colour column, when there is one.
 * @param {Array<{label: string, values: string[]}>} [parts.filters] The filters in force.
 * @returns {string} One or more sentences.
 */
export function scopeText({ group, n, panel, color, filters = [] }) {
  // A name that holds a comma, as a cut variable's does, is closed by one.
  const named = group.includes(',') ? `${group},` : group;
  const said = [
    `This test compares the levels of ${named} on the ${n} participant${n === 1 ? '' : 's'} ` +
      (panel ? `drawn in this panel (${panel}).` : 'drawn.')
  ];
  if (panel) {
    said.push('Each panel has a test of its own, and they are not adjusted for one another.');
  }
  if (color) {
    said.push(`Colour by ${color} is not part of it: each level of ${named} is tested whole.`);
  }
  if (filters.length) said.push(filtersSaid(filters));
  return said.join(' ');
}

/**
 * @param {object} parts
 * @param {{run: Function}} parts.connection The connection to R.
 * @param {?string} [parts.note] A sentence added to the waiting text until R
 *   has answered once: what starting R costs on this page.
 * @returns {{begin: Function, idle: Function}} `begin()` starts a round and
 *   ends every earlier one; the round's `ask(request, show, context)` asks R
 *   and calls `show(description)` at once with the waiting state, and again
 *   with the answer if the round is still the current one. It resolves to
 *   whether the answer was shown. `idle(text)` is `text` with the note, for a
 *   line that is not asking.
 */
export function createStatisticDesk({ connection, note = null }) {
  return createDesk({
    connection,
    note,
    // An answer for a row of visits reads as a row of results, one per visit.
    describe: (result, context) =>
      context && context.levels ? describeLevels(result, context) : describeAnswer(result, context),
    waiting: (said) => plain('waiting', said)
  });
}
