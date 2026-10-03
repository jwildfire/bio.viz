// The statistics line of the association scatter: what the chart prints under a
// panel about the two variables it drew. The chart computes none of it. It
// chooses which coefficient to ask R for, hands R the panel's rows through the
// connection, and prints what comes back through the formatters every chart
// uses. The fitted line is asked for the same way and drawn from R's answer.
//
// The waiting state and the rule that an answer for rows no longer drawn is
// never shown are every chart's (src/shared/statisticLine.js).
//
// Everything in this file is pure: no page and no chart. What is asked of R is
// one function of the settings, the controls and the panel's rows
// (`correlationRequest`, `fitRequest`), so the same request can be written
// down ahead of time, by R, as a stored result.

import { formatEstimate, formatGroup, formatStatistic } from '../r/formatStatistic.js';
import {
  createDesk,
  failureOf,
  filtersInForce,
  filtersSaid,
  remarksOf,
  sentence,
  sorted
} from '../shared/statisticLine.js';
import { plotted, settingOf } from './structureData.js';

/** What the Method control calls each coefficient. */
export const METHOD_LABELS = Object.freeze({
  pearson: 'Pearson',
  spearman: 'Spearman'
});

/** What the Fitted line control calls each line. */
export const FIT_LABELS = Object.freeze({
  none: 'None',
  identity: 'Identity (y = x)',
  linear: 'Linear',
  smooth: 'Smooth'
});

/** The lines that are R's to compute. */
export const FITS_FROM_R = Object.freeze(['linear', 'smooth']);

// R names the coefficient `cor` or `rho` (`names(cor.test(…)$estimate)`). A
// reader is given the name it is usually written by; any other name R gives is
// printed as R gave it.
const COEFFICIENTS = { cor: 'Pearson’s r', rho: 'Spearman’s rho' };
const coefficient = (name) => (Object.hasOwn(COEFFICIENTS, name) ? COEFFICIENTS[name] : name);

// ---- What R is asked -----------------------------------------------------------

/**
 * The rows R is handed for one panel: one per participant, with the id, `x`
 * and `y` as the axes plot them, and `color` and `panel` when the view has
 * them. On a logarithmic axis the value handed over is its base-10 logarithm,
 * so what R computes is computed on the values as plotted.
 */
export function rowsForR(settings, state, panel) {
  return panel.records.map((record) => ({
    [settings.id_col]: record[settings.id_col],
    x: plotted(record.x, state.xScale),
    y: plotted(record.y, state.yScale),
    ...(state.colorBy ? { color: record.color } : {}),
    ...(state.panelBy ? { panel: record.panel } : {})
  }));
}

/**
 * The identity of one panel's rows: what was drawn, by the settings' own
 * names. A member that is not set is left out, never written as null, so the
 * same identity is easy to write from R. The scale is part of it: a result
 * computed on a logarithm never answers for the values themselves.
 */
export function viewId(settings, state, panel) {
  const filters = filtersInForce(state.filters);
  return {
    chart: 'association-scatter',
    x: settingOf(state.x),
    y: settingOf(state.y),
    ...(settings.baseline_visits ? { baseline_visits: [...settings.baseline_visits] } : {}),
    baseline_stat: settings.baseline_stat,
    ...(state.colorBy
      ? { color_by: state.colorBy, groups: sorted(panel.records.map((record) => record.color)) }
      : {}),
    ...(state.panelBy ? { panel_by: state.panelBy, panel: panel.panelLevel } : {}),
    ...(Object.keys(filters).length ? { filters } : {}),
    ...(state.xScale === 'log' ? { x_scale: 'log' } : {}),
    ...(state.yScale === 'log' ? { y_scale: 'log' } : {})
  };
}

/**
 * What the chart asks R for one panel's coefficient: the function, the rows,
 * the arguments and the identity of the rows.
 *
 * @param {object} parts
 * @param {string} parts.name The R function (the setting `statistic`).
 * @param {string} parts.method The coefficient: `pearson` or `spearman`.
 * @param {object} parts.settings The chart's settings.
 * @param {object} parts.state What the controls are set to.
 * @param {object} parts.panel The panel: its rows and its panel level.
 * @returns {{name: string, data: object[], args: object, dataId: object, rows: number}}
 */
export function correlationRequest({ name, method, settings, state, panel }) {
  return {
    name,
    data: rowsForR(settings, state, panel),
    args: {
      strXCol: 'x',
      strYCol: 'y',
      strMethod: method,
      // A coefficient within each colour, when there is a colour.
      ...(state.colorBy ? { strGroupCol: 'color' } : {})
    },
    dataId: viewId(settings, state, panel),
    rows: panel.records.length
  };
}

// ---- What the line says ---------------------------------------------------------

/**
 * A line that holds one sentence and nothing R returned with it: waiting,
 * unavailable, nothing asked.
 * @param {string} state The state of the line.
 * @param {string} said The sentence.
 * @returns {object} A description, as `describeCorrelation` gives one.
 */
export const plain = (state, said) => ({ ...sentence(state, said), table: null });

// The coefficient within each level of the colour, as a small table: each
// level with its count, its coefficient with the interval R gave, and its
// p-value, under a caption that names the method and labels the p-values.
// Null when the result has no per-group rows.
function groupsTable(value, { color, name }) {
  const rows = Array.isArray(value.rows) ? value.rows.filter((row) => row && 'group' in row) : [];
  if (!rows.length) return null;
  const formatted = rows.map(formatGroup);
  const shown = formatted.filter((row) => row.status === 'shown');
  const methods = [...new Set(shown.map((row) => row.method))];
  const labels = [...new Set(shown.map((row) => row.label))];
  const levels = [...new Set(shown.map((row) => row.level).filter(Boolean))];
  const by = methods.length === 1 ? `, each by ${methods[0]}` : '';
  const head = name || 'Coefficient';
  return {
    caption: `Within each level of ${color}${by}.` + (labels.length ? ` ${labels.join(' ')}` : ''),
    head: [
      color,
      'n',
      levels.length === 1 ? `${head} (${levels[0]} confidence interval)` : head,
      'p'
    ],
    rows: formatted.map((row, index) => {
      const warned = typeof rows[index].warning === 'string' ? rows[index].warning : null;
      const within =
        row.bounds && levels.length === 1
          ? ` (${row.bounds})`
          : row.interval
            ? ` (${row.interval})`
            : '';
      return {
        status: row.status,
        head: row.group || '',
        // What R said of this level alone, and its method where the levels' differ.
        sub:
          [
            methods.length > 1 && row.status === 'shown' ? row.method : null,
            warned ? `R warned: ${warned}` : null
          ]
            .filter(Boolean)
            .join(' ') || null,
        cells:
          row.status === 'shown'
            ? [String(row.n), `${row.estimate}${within}`, row.p]
            : // A level with no coefficient says why in its place.
              [row.n === null ? '' : String(row.n), row.result, '']
      };
    })
  };
}

/**
 * What one answer from the connection reads as on the line.
 *
 * @param {object} result What `connection.run` resolved to.
 * @param {object} [context]
 * @param {string} [context.scope] What the coefficient covers, in a sentence.
 * @param {string} [context.color] The label of the colour column, when there is one.
 * @param {string} [context.scale] Which scale it was computed on, when an axis is logarithmic.
 * @returns {{state: string, text: string, estimates: string[], table: ?object,
 *   remarks: Array<{kind: string, text: string}>, scope: ?string}} `text` is
 *   the result itself; the rest is what R returned with it.
 */
export function describeCorrelation(result, context = {}) {
  if (!result || result.status !== 'ok') {
    const failure = failureOf(result);
    return plain(failure.state, failure.text);
  }
  const value = result.value && typeof result.value === 'object' ? result.value : {};
  const formatted = formatStatistic(value);
  const described = plain(formatted.status, formatted.text);
  if (formatted.status === 'shown') {
    const estimates = (Array.isArray(value.estimates) ? value.estimates : []).filter(Boolean);
    // The coefficient, with the interval R gave when it gave one.
    described.estimates = estimates.map(
      (row) => formatEstimate({ ...row, name: coefficient(row.name) }).text
    );
    if (context.color) {
      described.table = groupsTable(value, {
        color: context.color,
        name: estimates.length ? coefficient(estimates[0].name) : null
      });
    }
  }
  // What R said about its answer is printed with it, as R worded it; and which
  // scale it was computed on, every time an axis is logarithmic.
  described.remarks = [
    ...remarksOf(value),
    ...(context.scale ? [{ kind: 'scale', text: context.scale }] : [])
  ];
  described.scope = context.scope || null;
  return described;
}

// What a logarithmic axis means for each thing R is asked.
const ON_A_LOGARITHM = {
  pearson: 'Pearson’s coefficient is of the values as plotted, not of the values themselves.',
  spearman: 'Spearman’s coefficient is computed on ranks, which a logarithm does not change.',
  linear:
    'The line is fitted to the values as plotted, so it is straight on these axes, and its ' +
    'slope and intercept are of the logarithms.',
  smooth: 'The curve is fitted to the values as plotted.'
};

/**
 * Which scale a statistic was computed on, said every time an axis is
 * logarithmic: R is handed the base-10 logarithm of that axis's values, the
 * values as plotted. Null when both axes are linear.
 *
 * @param {object} parts
 * @param {string} parts.xScale `linear` or `log`.
 * @param {string} parts.yScale `linear` or `log`.
 * @param {string} parts.x The x variable in words.
 * @param {string} parts.y The y variable in words.
 * @param {string} parts.method What was asked: `pearson`, `spearman`, `linear` or `smooth`.
 * @returns {?string} One or two sentences.
 */
export function scaleText({ xScale, yScale, x, y, method }) {
  const logged = [xScale === 'log' ? x : null, yScale === 'log' ? y : null].filter(Boolean);
  if (!logged.length) return null;
  const which =
    logged.length === 2
      ? 'Both axes are logarithmic'
      : `The ${xScale === 'log' ? 'x' : 'y'} axis is logarithmic`;
  const given = logged.map((name) => `the base-10 logarithm of ${name}`).join(' and ');
  return `${which}: R was given ${given}. ${ON_A_LOGARITHM[method] || ''}`.trim();
}

/**
 * What one coefficient covers, in plain words: which rows, that each panel has
 * its own, that a colour adds a coefficient for each of its levels, and the
 * filters in force.
 *
 * @param {object} parts
 * @param {number} parts.n How many participants the panel's rows hold.
 * @param {string} [parts.panel] The panel's title, when there are several.
 * @param {string} [parts.color] The label of the colour column, when there is one.
 * @param {Array<{label: string, values: string[]}>} [parts.filters] The filters in force.
 * @returns {string} One or more sentences.
 */
export function scopeText({ n, panel, color, filters = [] }) {
  const said = [
    `This coefficient is of the ${n} participant${n === 1 ? '' : 's'} ` +
      (panel ? `drawn in this panel (${panel}).` : 'drawn.')
  ];
  if (panel) {
    said.push(
      'Each panel has a coefficient of its own, and they are not adjusted for one another.'
    );
  }
  if (color) {
    said.push(
      `It takes every level of ${color} together; the table gives each level its own, and ` +
        'they are not adjusted for one another.'
    );
  }
  if (filters.length) said.push(filtersSaid(filters));
  return said.join(' ');
}

// ---- The fitted line --------------------------------------------------------------

/**
 * What the chart asks R for one panel's fitted line: the function, the rows,
 * the arguments and the identity of the rows. The rows and their identity are
 * the ones the coefficient is asked with, so on a logarithmic axis the line is
 * fitted to the values as plotted.
 *
 * @param {object} parts
 * @param {string} parts.name The R function (the setting `fit_statistic`).
 * @param {string} parts.fit The line: `linear` or `smooth`.
 * @param {object} parts.settings The chart's settings.
 * @param {object} parts.state What the controls are set to.
 * @param {object} parts.panel The panel: its rows and its panel level.
 * @returns {{name: string, data: object[], args: object, dataId: object, rows: number}}
 */
export function fitRequest({ name, fit, settings, state, panel }) {
  return {
    name,
    data: rowsForR(settings, state, panel),
    args: {
      strXCol: 'x',
      strYCol: 'y',
      strMethod: fit,
      // A line within each colour as well, when there is a colour.
      ...(state.colorBy ? { strGroupCol: 'color' } : {})
    },
    dataId: viewId(settings, state, panel),
    rows: panel.records.length
  };
}

const FIT_WORDS = { linear: 'linear fit', smooth: 'smooth' };
const present = (value) => value !== undefined && value !== null;
const isCount = (value) => Number.isInteger(value) && value >= 0;

// The fit of each level of the colour, as R returned it: the first row of the
// level's line carries that fit's own answer, and its coefficients are in
// `estimates` under the level's name.
function fitsByGroup(value) {
  const rows = Array.isArray(value.rows) ? value.rows.filter(Boolean) : [];
  const estimates = Array.isArray(value.estimates) ? value.estimates.filter(Boolean) : [];
  const groups = [...new Set(rows.map((row) => row.group).filter(present))];
  return groups.map((group) => ({
    group,
    answer: rows.find((row) => row.group === group),
    estimate: (name) => estimates.find((row) => row.group === group && row.name === name) || {}
  }));
}

// The slope and intercept within each level of the colour, as a small table:
// each level with its count, its slope and its intercept with the intervals R
// gave, and the p-value of the test that its slope is zero. A level R could not
// fit says why in place of its numbers.
function fitTable(value, color) {
  const fits = fitsByGroup(value);
  if (!fits.length) return null;
  const formatted = fits.map(({ group, answer, estimate }) => {
    const of = (name) =>
      formatGroup({
        group,
        counts: answer.counts,
        method: answer.method,
        p_value: answer.p_value,
        adjustment: answer.adjustment,
        status: answer.status,
        reason: answer.reason,
        estimate: estimate(name).estimate,
        lower: estimate(name).lower,
        upper: estimate(name).upper,
        level: estimate(name).level
      });
    return { slope: of('Slope'), intercept: of('Intercept'), warning: answer.warning };
  });
  const shown = formatted.filter((row) => row.slope.status === 'shown');
  const methods = [...new Set(shown.map((row) => row.slope.method))];
  const labels = [...new Set(shown.map((row) => row.slope.label))];
  const levels = [...new Set(shown.map((row) => row.slope.level).filter(Boolean))];
  const interval = levels.length === 1 ? ` (${levels[0]} confidence interval)` : '';
  const cell = (part) => `${part.estimate}${part.bounds ? ` (${part.bounds})` : ''}`;
  return {
    caption:
      `The line within each level of ${color}` +
      (methods.length === 1 ? `, each by ${methods[0]}` : '') +
      `.${labels.length ? ` ${labels.join(' ')}` : ''}`,
    head: [color, 'n', `Slope${interval}`, `Intercept${interval}`, 'p, slope'],
    rows: formatted.map(({ slope, intercept, warning }) => ({
      status: slope.status,
      head: slope.group || '',
      sub: typeof warning === 'string' ? `R warned: ${warning}` : null,
      cells:
        slope.status === 'shown' && intercept.status === 'shown'
          ? [String(slope.n), cell(slope), cell(intercept), slope.p]
          : [slope.n === null ? '' : String(slope.n), slope.result, '', '']
    }))
  };
}

/**
 * What one answer about a fitted line reads as under the coefficient: for a
 * linear fit, the test that its slope is zero with its method and counts, the
 * slope and the intercept with the intervals R gave, and R-squared; for a
 * smooth, its method and counts, and that a smooth has no test. With no answer
 * from R the line is not drawn, and this says why.
 *
 * @param {object} result What `connection.run` resolved to.
 * @param {object} [context]
 * @param {string} [context.fit] The line asked for: `linear` or `smooth`.
 * @param {string} [context.color] The label of the colour column, when there is one.
 * @param {string} [context.scope] What the line covers, in a sentence.
 * @param {string} [context.scale] Which scale it was fitted on, when an axis is logarithmic.
 * @returns {object} A description, as `describeCorrelation` gives one.
 */
export function describeFit(result, context = {}) {
  const words = FIT_WORDS[context.fit] || 'fitted line';
  if (!result || result.status !== 'ok') {
    const failure = failureOf(result);
    return plain(failure.state, `The ${words} is not drawn. ${failure.text}`);
  }
  const value = result.value && typeof result.value === 'object' ? result.value : {};
  const smooth = context.fit === 'smooth' && (value.status === undefined || value.status === 'ok');
  let described;
  if (smooth) {
    // A smooth has no test, so there is no p-value to print: its method and
    // the pairs it used are said without one.
    const method = typeof value.method === 'string' ? value.method : 'Smooth';
    described = isCount(value.counts)
      ? plain('shown', `${method}: the curve and its band are R’s (n = ${value.counts}).`)
      : plain('refused', 'Smooth not shown: the result does not give the counts it used.');
  } else {
    const formatted = formatStatistic(value);
    described = plain(formatted.status, formatted.text);
  }
  // No line from R, and why: too few pairs, or what R reported.
  if (described.state !== 'shown') described.text = `The ${words} is not drawn. ${described.text}`;
  if (described.state === 'shown') {
    const estimates = (Array.isArray(value.estimates) ? value.estimates : []).filter(Boolean);
    // The line of every point together: its slope and its intercept, with the
    // intervals R gave, and R-squared from R's own table.
    const overall = estimates.filter((row) => !present(row.group));
    const slopeFirst = [...overall].sort(
      (a, b) => Number(b.name === 'Slope') - Number(a.name === 'Slope')
    );
    const rSquared = (Array.isArray(value.statistic) ? value.statistic : []).find(
      (row) => row && row.name === 'r.squared'
    );
    described.estimates = [
      ...slopeFirst.map((row) => formatEstimate(row).text),
      ...(rSquared ? [formatEstimate({ name: 'R-squared', estimate: rSquared.value }).text] : [])
    ];
    if (context.color && !smooth) described.table = fitTable(value, context.color);
  }
  // A level of the colour R drew no curve for says why: the table says it for
  // a linear fit, and here for a smooth, which has no table.
  const withheld =
    smooth && context.color
      ? fitsByGroup(value)
          .filter(({ answer }) => answer.status && answer.status !== 'ok')
          .map(({ group, answer }) => ({
            kind: 'withheld',
            text: formatGroup({ ...answer, group }).text
          }))
      : [];
  described.remarks = [
    ...withheld,
    ...remarksOf(value),
    ...(context.scale ? [{ kind: 'scale', text: context.scale }] : [])
  ];
  described.scope = context.scope || null;
  return described;
}

/**
 * The lines R returned for a panel, as points on the chart's axes: the line of
 * every point together, and one for each level of the colour when R was asked
 * for them. Each is R's own points, joined by straight segments, with R's band
 * between `lower` and `upper`. Nothing is worked out but where a point sits: on
 * a logarithmic axis R's values are logarithms, and are put back on the axis's
 * own scale.
 *
 * @param {object} result What `connection.run` resolved to.
 * @param {object} state What the controls are set to: `xScale`, `yScale`.
 * @returns {?Array<{group: ?string, curve: Array<{x: number, y: number}>,
 *   lower: Array<{x: number, y: number}>, upper: Array<{x: number, y: number}>}>}
 *   The lines, the overall one (`group` null) first; null when R returned none.
 */
export function fitCurves(result, state) {
  if (!result || result.status !== 'ok' || !result.value) return null;
  const rows = Array.isArray(result.value.rows) ? result.value.rows : [];
  const isPoint = (row) =>
    row && [row.x, row.fit, row.lower, row.upper].every((part) => typeof part === 'number');
  const placed = (value, scale) => (scale === 'log' ? 10 ** value : value);
  const lines = new Map();
  for (const row of rows.filter(isPoint)) {
    const group = present(row.group) ? String(row.group) : null;
    if (!lines.has(group)) lines.set(group, { group, curve: [], lower: [], upper: [] });
    const line = lines.get(group);
    const x = placed(row.x, state.xScale);
    line.curve.push({ x, y: placed(row.fit, state.yScale) });
    line.lower.push({ x, y: placed(row.lower, state.yScale) });
    line.upper.push({ x, y: placed(row.upper, state.yScale) });
  }
  return lines.size ? [...lines.values()] : null;
}

/**
 * What a fitted line covers, in plain words.
 * @param {object} parts
 * @param {string} parts.fit `linear` or `smooth`.
 * @param {number} parts.n How many participants the panel's rows hold.
 * @param {string} [parts.panel] The panel's title, when there are several.
 * @param {string} [parts.color] The label of the colour column, when there is one.
 * @returns {string} One or more sentences.
 */
export function fitScopeText({ fit, n, panel, color }) {
  const words = FIT_WORDS[fit] || 'fitted line';
  const whom =
    `the ${n} participant${n === 1 ? '' : 's'} ` +
    (panel ? `drawn in this panel (${panel})` : 'drawn');
  if (!color) {
    return `The line is R’s ${words} of y on x for ${whom}, with R’s band about it.`;
  }
  return (
    `Each level of ${color} has R’s ${words} of y on x in its colour, with R’s band about it. ` +
    `The dashed line is the ${words} of ${whom} together, drawn without its band.`
  );
}

/**
 * The desk the chart asks R through: the waiting state, and the rule that an
 * answer for rows no longer drawn is never shown.
 * @param {object} parts
 * @param {{run: Function}} parts.connection The connection to R.
 * @param {?string} [parts.note] A sentence added to the waiting text until R
 *   has answered once: what starting R costs on this page.
 * @returns {{begin: Function, idle: Function}} As `createDesk` gives it.
 */
export function createStatisticDesk({ connection, note = null }) {
  const isFit = (context) => Boolean(context && context.kind === 'fit');
  return createDesk({
    connection,
    note,
    describe: (result, context) =>
      isFit(context) ? describeFit(result, context) : describeCorrelation(result, context),
    waiting: (said, context) =>
      plain('waiting', isFit(context) ? said.replace(/^Statistics/, 'Fitted line') : said)
  });
}
