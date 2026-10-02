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

import { formatComparison, formatEstimate, formatStatistic } from '../r/formatStatistic.js';

export const WAITING = 'Statistics: waiting for R…';
export const NO_TEST_CHOSEN = 'Statistics: no test chosen.';
export const NOT_STORED =
  'Statistics are unavailable for this view: the page holds no stored result for it, and no R ' +
  'is attached to compute one.';

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

// By Unicode code point, the order R's `sort(x, method = "radix")` puts text
// in. An order both languages produce without a locale, so a list written by R
// is the list written here.
function byCodePoint(a, b) {
  const [first, second] = [[...a], [...b]];
  const shared = Math.min(first.length, second.length);
  for (let index = 0; index < shared; index += 1) {
    const difference = first[index].codePointAt(0) - second[index].codePointAt(0);
    if (difference !== 0) return difference;
  }
  return first.length - second.length;
}

/** Distinct values as text, sorted by code point. */
export const sorted = (values) => [...new Set(values.map(String))].sort(byCodePoint);

/** The groups a panel's rows hold: the distinct values of `x`, sorted by code point. */
export const groupsOf = (records) => sorted(records.map((record) => record.x));

// The filters in force, each as the list of values it lets through. A filter
// set to all is not in force and is left out.
function filtersInForce(filters) {
  const inForce = {};
  for (const [column, selection] of Object.entries(filters || {})) {
    if (selection === null || selection === undefined || selection === '') continue;
    const values = Array.isArray(selection) ? selection : [selection];
    if (values.length) inForce[column] = sorted(values);
  }
  return inForce;
}

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
 * @param {object} parts.panel The panel: its rows, its visit and its panel level.
 * @returns {{name: string, data: object[], args: object, dataId: object, rows: number}}
 */
export function statisticRequest({ name, test, pairwise, settings, state, panel }) {
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
    ...(state.yScale === 'log' ? { positive_only: true } : {})
  };
  return {
    name,
    data: panel.records,
    args: {
      strValueCol: 'y',
      strGroupCol: 'x',
      strMethod: test,
      // Pairs exist only among more than two groups.
      bPairwise: Boolean(pairwise) && groups.length > 2
    },
    dataId,
    rows: panel.records.length
  };
}

// ---- What the line says ---------------------------------------------------------

const texts = (value) =>
  (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]).filter(
    (entry) => typeof entry === 'string' && entry.trim() !== ''
  );

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
export const plain = (state, said) => ({
  state,
  text: said,
  estimates: [],
  pairs: null,
  remarks: [],
  scope: null
});

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
        .filter((row) => row && present(row.lower) && present(row.upper))
        .map((row) => formatEstimate(row).text);
      described.pairs = pairsOf(value);
    }
    // What R said about its answer is printed with it, as R worded it.
    described.remarks = [
      ...texts(value.warnings).map((said) => ({ kind: 'warning', text: `R warned: ${said}` })),
      ...texts(value.notes).map((said) => ({ kind: 'note', text: `R’s note: ${said}` }))
    ];
    described.scope = context.scope || null;
    return described;
  }
  if (result && result.status === 'unavailable') {
    return plain('unavailable', result.reason === 'not-precomputed' ? NOT_STORED : result.message);
  }
  const message = result && typeof result.message === 'string' ? result.message : 'no message';
  return plain('error', `R reported an error: ${message}`);
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
  const said = [
    `This test compares the levels of ${group} on the ${n} participant${n === 1 ? '' : 's'} ` +
      (panel ? `drawn in this panel (${panel}).` : 'drawn.')
  ];
  if (panel) {
    said.push('Each panel has a test of its own, and they are not adjusted for one another.');
  }
  if (color) {
    said.push(`Colour by ${color} is not part of it: each level of ${group} is tested whole.`);
  }
  if (filters.length) {
    said.push(
      `Filters: ${filters.map(({ label, values }) => `${label} is ${values.join(' or ')}`).join('; ')}.`
    );
  }
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
  let current = 0;
  // Whether R has answered: after that, starting it costs nothing more.
  let answered = false;
  const withNote = (said) => (note && !answered ? `${said} ${note}` : said);
  return {
    idle: withNote,
    begin() {
      current += 1;
      const round = current;
      // With several panels the note is said once, by the first that waits.
      let noted = false;
      return {
        ask({ name, data, args, dataId }, show, context) {
          show(plain('waiting', noted ? WAITING : withNote(WAITING)));
          noted = true;
          return connection.run(name, { data, args, dataId }).then((result) => {
            if (result && result.status === 'ok' && result.form !== 'precomputed') answered = true;
            if (round !== current) return false;
            show(describeAnswer(result, context), result);
            return true;
          });
        }
      };
    }
  };
}
