import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { syncSettings } from '../../../src/association-scatter/configure.js';
import {
  FITS_FROM_R,
  FIT_LABELS,
  METHOD_LABELS,
  correlationRequest,
  createStatisticDesk,
  describeCorrelation,
  describeFit,
  fitCurves,
  fitRequest,
  fitScopeText,
  plain,
  rowsForR,
  scaleText,
  scopeText,
  viewId
} from '../../../src/association-scatter/statistic.js';
import { buildScatter } from '../../../src/association-scatter/structureData.js';
import { createConnection } from '../../../src/r/index.js';
import { canonicalJson } from '../../../src/r/canonical.js';
import { NOT_STORED, WAITING } from '../../../src/shared/statisticLine.js';
import { participants, results } from '../core/study.js';

// The association scatter's statistics line and fitted line (#26): what R is
// asked, what R is sent, and how what R answered is printed and drawn, through
// the connection and the shared formatters, and never an answer for rows other
// than the ones drawn.
//
// R here is a stand-in whose answers arrive when the test says so. Where a test
// needs a real answer, it is one desktop R gave:
// tests/fixtures/association-statistics-r.json, written by
// tools/r-association-statistics.R from gsm.bio's vendored statistics file. No
// number in these tests was typed but the ones a printed line is held to.

const fromR = JSON.parse(
  readFileSync(new URL('../../fixtures/association-statistics-r.json', import.meta.url), 'utf8')
);
const answerOf = (name) => fromR.results.find((result) => result.case === name).value;
const ok = (value) => ({ status: 'ok', value, form: 'browser' });

const settings = syncSettings({ baseline_visits: 'Baseline' });
const tables = { results, participants };
const at = (measure, visit, value = 'raw') => ({ kind: 'measure', measure, value, visit });
const PLANTED = {
  x: at('TNF-alpha', 'Baseline'),
  y: at('IL-10', 'Baseline'),
  colorBy: '',
  panelBy: '',
  xScale: 'linear',
  yScale: 'linear',
  filters: {}
};
const SKEWED = { x: at('CRP', 'Baseline'), y: at('IFN-gamma', 'Baseline') };
const panelsOf = (view = {}) => {
  const state = { ...PLANTED, ...view };
  return { state, panels: buildScatter(tables, settings, state).panels };
};
const ask = (view = {}, method = 'pearson', panel = 0) => {
  const { state, panels } = panelsOf(view);
  return correlationRequest({
    name: settings.statistic,
    method,
    settings,
    state,
    panel: panels[panel]
  });
};
const askFit = (view = {}, fit = 'linear', panel = 0) => {
  const { state, panels } = panelsOf(view);
  return fitRequest({ name: settings.fit_statistic, fit, settings, state, panel: panels[panel] });
};

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
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const deskOn = (engine, note) =>
  createStatisticDesk({ connection: createConnection({ browser: { engine } }), note });

describe('association scatter: what R is asked', () => {
  it('AS-STAT-001: R is asked for one panel with the function named in settings, the panel’s rows by the names of their fields, and the two columns and the coefficient; a colour adds the column a coefficient is given within (#26)', () => {
    const request = ask();
    expect(request.name).toBe('Analyze_Correlation');
    expect(request.args).toEqual({ strXCol: 'x', strYCol: 'y', strMethod: 'pearson' });
    expect(request.rows).toBe(200);
    expect(request.data).toHaveLength(200);
    expect(Object.keys(request.data[0])).toEqual(['USUBJID', 'x', 'y']);
    // The rows are the points drawn, value for value.
    const [panel] = panelsOf().panels;
    expect(request.data).toEqual(panel.records);
    expect(ask({}, 'spearman').args.strMethod).toBe('spearman');

    const coloured = ask({ colorBy: 'ARM' });
    expect(coloured.args).toEqual({
      strXCol: 'x',
      strYCol: 'y',
      strMethod: 'pearson',
      strGroupCol: 'color'
    });
    expect(Object.keys(coloured.data[0])).toEqual(['USUBJID', 'x', 'y', 'color']);
    // A panel variable is carried on the rows, and is not an argument: each
    // panel asks for itself, on its own rows.
    const women = ask({ panelBy: 'SEX' }, 'pearson', 0);
    const men = ask({ panelBy: 'SEX' }, 'pearson', 1);
    expect(Object.keys(women.data[0])).toEqual(['USUBJID', 'x', 'y', 'panel']);
    expect([women.rows, men.rows]).toEqual([91, 109]);
    expect(women.data.every((row) => row.panel === 'F')).toBe(true);
    expect(women.args).toEqual(request.args);
    // Nothing else is sent: no confidence level, no minimum, no group list.
    for (const made of [request, coloured, women]) {
      expect(Object.keys(made).sort()).toEqual(['args', 'data', 'dataId', 'name', 'rows']);
      expect(Object.keys(made.args).join(' ')).not.toMatch(/Conf|Min|Groups|Points/);
    }
    // Another function of the same arguments can be named.
    const named = syncSettings({ statistic: 'My_Correlation' });
    const { state, panels } = panelsOf();
    expect(
      correlationRequest({
        name: named.statistic,
        method: 'pearson',
        settings: named,
        state,
        panel: panels[0]
      }).name
    ).toBe('My_Correlation');
    expect(METHOD_LABELS).toEqual({ pearson: 'Pearson', spearman: 'Spearman' });
  });

  it('AS-STAT-002: the identity of a panel’s rows states what was drawn by the settings’ own names, a member that is not set is left out, and no two views share one (#26)', () => {
    expect(ask().dataId).toEqual({
      chart: 'association-scatter',
      x: { measure: 'TNF-alpha', value: 'raw', visit: 'Baseline' },
      y: { measure: 'IL-10', value: 'raw', visit: 'Baseline' },
      baseline_visits: ['Baseline'],
      baseline_stat: 'mean'
    });
    const full = ask(
      {
        x: { kind: 'column', col: 'AGE' },
        y: at('IL-6', null, 'baseline'),
        colorBy: 'ARM',
        panelBy: 'SEX',
        xScale: 'log',
        yScale: 'log',
        filters: { RESPONSE: ['Responder', 'Non-responder'], SEX: null }
      },
      'pearson',
      1
    );
    expect(full.dataId).toEqual({
      chart: 'association-scatter',
      x: { col: 'AGE' },
      y: { measure: 'IL-6', value: 'baseline' },
      baseline_visits: ['Baseline'],
      baseline_stat: 'mean',
      color_by: 'ARM',
      groups: ['Placebo', 'Treatment'],
      panel_by: 'SEX',
      panel: 'M',
      // A filter set to all is not in force; the values are sorted by code point.
      filters: { RESPONSE: ['Non-responder', 'Responder'] },
      x_scale: 'log',
      y_scale: 'log'
    });
    expect(JSON.stringify(full.dataId)).not.toContain('null');
    // With no baseline visit named the member is left out.
    const { state, panels } = panelsOf();
    expect(viewId(syncSettings(), state, panels[0])).not.toHaveProperty('baseline_visits');
    // The method is an argument, not part of the identity of the rows.
    expect(ask({}, 'spearman').dataId).toEqual(ask({}, 'pearson').dataId);

    // Every one of these is a different view, and so a different key.
    const views = [
      {},
      { x: at('TNF-alpha', 'Week 4') },
      { y: at('IL-10', 'Week 4') },
      { x: at('TNF-alpha', 'Baseline', 'percent_change'), y: at('IL-10', 'Week 4') },
      { x: at('IL-10', 'Baseline'), y: at('TNF-alpha', 'Baseline') },
      { x: { kind: 'column', col: 'AGE' } },
      { colorBy: 'ARM' },
      { colorBy: 'SEX' },
      { filters: { SEX: 'F' } },
      { xScale: 'log' },
      { yScale: 'log' },
      { xScale: 'log', yScale: 'log' }
    ];
    const keys = views.map((view) => canonicalJson(ask(view).dataId));
    expect(new Set(keys).size).toBe(views.length);
    const panelKeys = [0, 1].map((panel) =>
      canonicalJson(ask({ panelBy: 'SEX' }, 'pearson', panel).dataId)
    );
    expect(new Set([...keys, ...panelKeys]).size).toBe(views.length + 2);
    // The same participants under another identity: the filter Sex = F and the
    // panel for F hold the same rows, and are not the same view.
    const filtered = ask({ filters: { SEX: 'F' } });
    const panel = ask({ panelBy: 'SEX' }, 'pearson', 0);
    expect(filtered.data.map((row) => row.USUBJID)).toEqual(panel.data.map((row) => row.USUBJID));
    expect(canonicalJson(filtered.dataId)).not.toBe(canonicalJson(panel.dataId));
  });

  it('AS-STAT-003: on a logarithmic axis R is handed the base-10 logarithm of that axis’s values, the values as plotted, and the scale is part of the rows’ identity (#26)', () => {
    const linear = ask(SKEWED);
    const logged = ask({ ...SKEWED, xScale: 'log', yScale: 'log' });
    const xOnly = ask({ ...SKEWED, xScale: 'log' });
    expect(logged.rows).toBe(linear.rows);
    linear.data.forEach((row, index) => {
      expect(logged.data[index].USUBJID).toBe(row.USUBJID);
      expect(logged.data[index].x).toBe(Math.log10(row.x));
      expect(logged.data[index].y).toBe(Math.log10(row.y));
      expect(xOnly.data[index].x).toBe(Math.log10(row.x));
      expect(xOnly.data[index].y).toBe(row.y);
    });
    // The points drawn keep the values themselves: the logarithm is for R.
    const { state, panels } = panelsOf({ ...SKEWED, xScale: 'log', yScale: 'log' });
    expect(panels[0].records.map((record) => record.x)).toEqual(linear.data.map((row) => row.x));
    expect(rowsForR(settings, state, panels[0])).toEqual(logged.data);
    // The scale is in the identity, each axis by its own member, left out when linear.
    expect(linear.dataId).not.toHaveProperty('x_scale');
    expect(linear.dataId).not.toHaveProperty('y_scale');
    expect(logged.dataId).toMatchObject({ x_scale: 'log', y_scale: 'log' });
    expect(xOnly.dataId.x_scale).toBe('log');
    expect(xOnly.dataId).not.toHaveProperty('y_scale');
    // The arguments are the same on either scale: there is no log argument.
    expect(logged.args).toEqual(linear.args);
    // So a result stored for one scale never answers the other, in either method.
    return (async () => {
      const store = (request, value) => ({
        name: request.name,
        args: request.args,
        dataId: request.dataId,
        rows: request.rows,
        value
      });
      const connection = createConnection({
        results: [store(linear, answerOf('pearson-skewed')), store(logged, answerOf('pearson-log'))]
      });
      const run = ({ name, data, args, dataId }) => connection.run(name, { data, args, dataId });
      expect((await run(linear)).value.estimates[0].estimate).toBe(
        answerOf('pearson-skewed').estimates[0].estimate
      );
      expect((await run(logged)).value.estimates[0].estimate).toBe(
        answerOf('pearson-log').estimates[0].estimate
      );
      expect(answerOf('pearson-log').estimates[0].estimate).not.toBe(
        answerOf('pearson-skewed').estimates[0].estimate
      );
      for (const other of [xOnly, ask({ ...SKEWED, yScale: 'log' })]) {
        const answer = await run(other);
        expect(answer.status).toBe('unavailable');
        expect(answer.reason).toBe('not-precomputed');
      }
      expect((await run(ask({ ...SKEWED, xScale: 'log', yScale: 'log' }, 'spearman'))).status).toBe(
        'unavailable'
      );
    })();
  });
});

describe('association scatter: what the line says', () => {
  it('AS-STAT-004: the result is printed through the shared formatter with its method and counts, labelled exploratory and unadjusted, and the coefficient with the interval R gave; no star and never the word significant (#26)', () => {
    const described = describeCorrelation(ok(answerOf('pearson')), {
      scope: 'This coefficient is of the 200 participants drawn.'
    });
    expect(described).toEqual({
      state: 'shown',
      text: "Pearson's product-moment correlation: p < 0.001 (n = 200). Exploratory, unadjusted.",
      estimates: ['Pearson’s r: 0.6384, 95% confidence interval 0.5482 to 0.7139.'],
      table: null,
      remarks: [],
      scope: 'This coefficient is of the 200 participants drawn.'
    });
    // The numbers printed are R's, to four significant figures, and nothing else.
    const [estimate] = answerOf('pearson').estimates;
    expect(described.estimates[0]).toBe(
      `Pearson’s r: ${Number(estimate.estimate.toPrecision(4))}, 95% confidence interval ` +
        `${Number(estimate.lower.toPrecision(4))} to ${Number(estimate.upper.toPrecision(4))}.`
    );
    // An ordinary p-value is printed to three decimals.
    expect(describeCorrelation(ok(answerOf('pearson-skewed'))).text).toBe(
      "Pearson's product-moment correlation: p = 0.315 (n = 200). Exploratory, unadjusted."
    );
    for (const result of fromR.results.filter((entry) => entry.name === 'Analyze_Correlation')) {
      const line = describeCorrelation(ok(result.value), { color: 'Arm' });
      const said = JSON.stringify(line);
      expect(said, result.case).not.toContain('*');
      expect(said.toLowerCase(), result.case).not.toContain('significan');
      if (line.state === 'shown') {
        expect(line.text, result.case).toMatch(/\(n = \d+\)\. Exploratory, unadjusted\.$/);
        expect(line.text, result.case).toContain(result.value.method);
      }
    }
  });

  it('AS-STAT-005: Spearman’s coefficient is printed with no interval, because R gives none, and R’s note says so; none is made up (#26)', () => {
    const value = answerOf('spearman');
    expect(value.estimates[0]).toMatchObject({
      name: 'rho',
      lower: null,
      upper: null,
      level: null
    });
    const described = describeCorrelation(ok(value));
    expect(described.text).toBe(
      "Spearman's rank correlation rho: p < 0.001 (n = 200). Exploratory, unadjusted."
    );
    expect(described.estimates).toEqual([
      `Spearman’s rho: ${Number(value.estimates[0].estimate.toPrecision(4))}.`
    ]);
    expect(JSON.stringify(described)).not.toMatch(/confidence interval \d/);
    expect(described.remarks).toEqual([
      { kind: 'warning', text: 'R warned: Cannot compute exact p-value with ties' },
      {
        kind: 'note',
        text: "R’s note: cor.test() gives no confidence interval for Spearman's rho, so none is reported."
      }
    ]);
  });

  it('AS-STAT-006: with a colour the coefficient within each level is printed from R’s rows as a small table, each with its count, its interval and its p-value under a caption naming the method; a level with too few pairs prints R’s reason in its row (#26)', () => {
    const described = describeCorrelation(ok(answerOf('pearson-by-arm')), { color: 'Arm' });
    // The coefficient of every point together is the same as with no colour.
    expect(described.text).toBe(describeCorrelation(ok(answerOf('pearson'))).text);
    expect(described.estimates).toEqual(describeCorrelation(ok(answerOf('pearson'))).estimates);
    expect(described.table).toEqual({
      caption:
        "Within each level of Arm, each by Pearson's product-moment correlation. Exploratory, unadjusted.",
      head: ['Arm', 'n', 'Pearson’s r (95% confidence interval)', 'p'],
      rows: [
        {
          status: 'shown',
          head: 'Placebo',
          sub: null,
          cells: ['100', '0.5918 (0.4474 to 0.7061)', 'p < 0.001']
        },
        {
          status: 'shown',
          head: 'Treatment',
          sub: null,
          cells: ['100', '0.6737 (0.5501 to 0.7684)', 'p < 0.001']
        }
      ]
    });
    // One row per row R returned, in R's order, each number R's own.
    const rows = answerOf('pearson-by-arm').rows;
    expect(described.table.rows.map((row) => row.head)).toEqual(rows.map((row) => row.group));
    rows.forEach((row, index) => {
      expect(described.table.rows[index].cells[1]).toBe(
        `${Number(row.estimate.toPrecision(4))} (${Number(row.lower.toPrecision(4))} to ` +
          `${Number(row.upper.toPrecision(4))})`
      );
    });
    // Spearman: no interval in the header or in a cell, and a warning R raised
    // for one level is said on that level's row.
    const ranked = describeCorrelation(ok(answerOf('spearman-by-arm')), { color: 'Arm' });
    expect(ranked.table.head).toEqual(['Arm', 'n', 'Spearman’s rho', 'p']);
    expect(ranked.table.rows.map((row) => row.cells[1])).toEqual(
      answerOf('spearman-by-arm').rows.map((row) => String(Number(row.estimate.toPrecision(4))))
    );
    expect(ranked.table.rows.map((row) => row.sub)).toEqual([
      'R warned: Cannot compute exact p-value with ties',
      null
    ]);
    // Too few pairs in one level: R's reason in its row, once, and no number.
    const small = describeCorrelation(ok(answerOf('pearson-age-57-by-arm')), { color: 'Arm' });
    expect(small.state).toBe('shown');
    expect(small.table.rows[1]).toEqual({
      status: 'withheld',
      head: 'Treatment',
      sub: null,
      cells: ['2', 'Not computed: 2 complete pairs. The minimum is 5. Counts: n = 2.', '']
    });
    expect(small.table.rows[0].status).toBe('shown');
    // With no colour there is no table, whatever R returned.
    expect(describeCorrelation(ok(answerOf('pearson-by-arm'))).table).toBe(null);
  });

  it('AS-STAT-007: too few pairs prints R’s reason, once, and no number (#26)', () => {
    const value = answerOf('pearson-age-35');
    expect(value).toMatchObject({ status: 'too_small', p_value: null, counts: 4, estimates: [] });
    const described = describeCorrelation(ok(value), { color: 'Arm', scope: 'Of the 4 drawn.' });
    expect(described.state).toBe('withheld');
    expect(described.text).toBe(`${value.reason} Counts: n = 4.`);
    expect(described.text.startsWith('Not computed: 4 complete pairs. The minimum is 5.')).toBe(
      true
    );
    expect(described.text.match(/not computed/gi)).toHaveLength(1);
    expect(described.text).not.toMatch(/p [=<>]/);
    expect(described.estimates).toEqual([]);
    expect(described.table).toBe(null);
    expect(described.scope).toBe('Of the 4 drawn.');
  });

  it('AS-STAT-008: what R warned and noted is printed as R worded it, and an answer that is not R’s result reads as what it is: unavailable, not stored, an error (#26)', () => {
    expect(
      describeCorrelation(ok(answerOf('spearman-age'))).remarks.map((said) => said.kind)
    ).toEqual(['warning', 'note']);
    expect(
      describeCorrelation({
        status: 'unavailable',
        reason: 'no-r-attached',
        message: 'Statistics are unavailable: no R is attached to this chart.'
      })
    ).toEqual(plain('unavailable', 'Statistics are unavailable: no R is attached to this chart.'));
    expect(
      describeCorrelation({ status: 'unavailable', reason: 'not-precomputed', message: 'x' })
    ).toEqual(plain('unavailable', NOT_STORED));
    expect(describeCorrelation({ status: 'error', message: 'object not found' })).toEqual(
      plain('error', 'R reported an error: object not found')
    );
    // R ran and marked its answer an error: its own message, said to be one.
    const failed = describeCorrelation(
      ok({
        status: 'error',
        reason: "Column 'x' (strXCol) is not numeric.",
        test: 'pearson',
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
    expect(failed.text).toBe("R reported an error: Column 'x' (strXCol) is not numeric.");
    // What the formatter refuses is refused here too: a p-value with no method.
    expect(describeCorrelation(ok({ ...answerOf('pearson'), method: null })).state).toBe('refused');
  });

  it('AS-STAT-009: the line says it is waiting from the moment a result is asked for until it arrives, with the page’s note until R has answered once, and an answer that arrives after the chart has been drawn again is never shown (#26)', async () => {
    const { engine, calls } = slowEngine();
    const note = 'The first statistic starts R in this browser.';
    const desk = deskOn(engine, note);
    const shown = [];
    const first = desk.begin();
    const asked = first.ask(ask(), (line) => shown.push(line), {});
    expect(shown).toEqual([plain('waiting', `${WAITING} ${note}`)]);
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('Analyze_Correlation');
    expect(calls[0].data).toHaveLength(200);

    // The chart is drawn again before R answers: a new round, for other rows.
    const second = desk.begin();
    const later = [];
    const again = second.ask(ask({ filters: { SEX: 'F' } }), (line) => later.push(line), {});
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1].data).toHaveLength(91);
    // The first answer arrives now, late. It is dropped.
    calls[0].resolve(answerOf('pearson'));
    expect(await asked).toBe(false);
    expect(shown).toHaveLength(1);
    expect(later).toHaveLength(1);
    // The answer for the rows on screen is shown.
    calls[1].resolve(answerOf('pearson-women'));
    expect(await again).toBe(true);
    expect(later[1].text).toContain('(n = 91)');
    expect(JSON.stringify(later)).not.toContain('n = 200');
    // R has answered: the note is not said again. A fitted line waits in its own words.
    const third = desk.begin();
    const next = [];
    third.ask(ask(), (line) => next.push(line), {});
    third.ask(askFit(), (line) => next.push(line), { kind: 'fit', fit: 'linear' });
    expect(next).toEqual([
      plain('waiting', WAITING),
      plain('waiting', 'Fitted line: waiting for R…')
    ]);
    expect(desk.idle('Statistics: none.')).toBe('Statistics: none.');
  });

  it('AS-STAT-010: what a coefficient covers is said under it, and every time an axis is logarithmic the line says which scale the statistic was computed on (#26)', () => {
    expect(scopeText({ n: 200 })).toBe('This coefficient is of the 200 participants drawn.');
    expect(scopeText({ n: 1 })).toBe('This coefficient is of the 1 participant drawn.');
    expect(
      scopeText({
        n: 91,
        panel: 'F',
        color: 'Arm',
        filters: [{ label: 'Response', values: ['Responder'] }]
      })
    ).toBe(
      'This coefficient is of the 91 participants drawn in this panel (F). Each panel has a ' +
        'coefficient of its own, and they are not adjusted for one another. It takes every level ' +
        'of Arm together; the table gives each level its own, and they are not adjusted for one ' +
        'another. Filters: Response is Responder.'
    );

    const axes = { x: 'CRP at Baseline (mg/L)', y: 'IFN-gamma at Baseline (pg/mL)' };
    const said = (xScale, yScale, method) => scaleText({ xScale, yScale, method, ...axes });
    // Both axes linear: nothing to say.
    for (const method of ['pearson', 'spearman', 'linear', 'smooth']) {
      expect(said('linear', 'linear', method)).toBe(null);
    }
    expect(said('log', 'linear', 'pearson')).toBe(
      'The x axis is logarithmic: R was given the base-10 logarithm of CRP at Baseline (mg/L). ' +
        'Pearson’s coefficient is of the values as plotted, not of the values themselves.'
    );
    expect(said('linear', 'log', 'pearson')).toBe(
      'The y axis is logarithmic: R was given the base-10 logarithm of IFN-gamma at Baseline ' +
        '(pg/mL). Pearson’s coefficient is of the values as plotted, not of the values themselves.'
    );
    expect(said('log', 'log', 'spearman')).toBe(
      'Both axes are logarithmic: R was given the base-10 logarithm of CRP at Baseline (mg/L) ' +
        'and the base-10 logarithm of IFN-gamma at Baseline (pg/mL). Spearman’s coefficient is ' +
        'computed on ranks, which a logarithm does not change.'
    );
    expect(said('log', 'log', 'linear')).toMatch(
      /^Both axes are logarithmic: R was given .* The line is fitted to the values as plotted, so it is straight on these axes, and its slope and intercept are of the logarithms\.$/
    );
    expect(said('log', 'linear', 'smooth')).toMatch(
      /The curve is fitted to the values as plotted\.$/
    );
    // It is printed with the result, whatever R answered.
    const scale = said('log', 'log', 'pearson');
    expect(describeCorrelation(ok(answerOf('pearson-log')), { scale }).remarks).toEqual([
      { kind: 'scale', text: scale }
    ]);
    expect(describeCorrelation(ok(answerOf('pearson-age-35')), { scale }).remarks).toEqual([
      { kind: 'scale', text: scale }
    ]);
    expect(describeCorrelation(ok(answerOf('pearson'))).remarks).toEqual([]);
  });
});

describe('association scatter: the fitted line', () => {
  it('AS-FIT-001: R is asked for a panel’s line with the function named in settings, the rows and the identity the coefficient is asked with, and the two columns and the kind of line; a colour adds the column a line is fitted within (#26)', () => {
    const request = askFit();
    expect(request.name).toBe('Analyze_Fit');
    expect(request.args).toEqual({ strXCol: 'x', strYCol: 'y', strMethod: 'linear' });
    expect(request.data).toEqual(ask().data);
    expect(request.dataId).toEqual(ask().dataId);
    expect(request.rows).toBe(200);
    expect(askFit({}, 'smooth').args.strMethod).toBe('smooth');
    expect(askFit({ colorBy: 'ARM' }).args).toEqual({
      strXCol: 'x',
      strYCol: 'y',
      strMethod: 'linear',
      strGroupCol: 'color'
    });
    // On a logarithmic axis the line is fitted to the values as plotted.
    const logged = askFit({ ...SKEWED, xScale: 'log', yScale: 'log' });
    expect(logged.data).toEqual(ask({ ...SKEWED, xScale: 'log', yScale: 'log' }).data);
    expect(logged.dataId).toMatchObject({ x_scale: 'log', y_scale: 'log' });
    // No confidence level, no minimum, no number of points and no span is sent.
    expect(Object.keys(askFit({ colorBy: 'ARM' }).args).join(' ')).not.toMatch(
      /Conf|Min|Points|Span|Groups/
    );
    // The identity line is not R's: it is never one of the lines asked for.
    expect(FITS_FROM_R).toEqual(['linear', 'smooth']);
    expect(Object.keys(FIT_LABELS)).toEqual(['none', 'identity', 'linear', 'smooth']);
  });

  it('AS-FIT-002: a linear fit prints the test of its slope with its method and counts, the slope and the intercept with the intervals R gave, and R-squared; with a colour, each level’s slope and intercept in a small table (#26)', () => {
    const value = answerOf('linear');
    const described = describeFit(ok(value), { fit: 'linear', scope: 'The line is R’s.' });
    expect(described).toMatchObject({
      state: 'shown',
      text: 'Linear regression: p < 0.001 (n = 200). Exploratory, unadjusted.',
      estimates: [
        'Slope: 0.3275, 95% confidence interval 0.2721 to 0.3828.',
        'Intercept: 2.028, 95% confidence interval 1.356 to 2.7.',
        'R-squared: 0.4075.'
      ],
      table: null,
      scope: 'The line is R’s.'
    });
    // Each number is R's own, to four significant figures.
    const slope = value.estimates.find((row) => row.name === 'Slope');
    expect(described.estimates[0]).toBe(
      `Slope: ${Number(slope.estimate.toPrecision(4))}, 95% confidence interval ` +
        `${Number(slope.lower.toPrecision(4))} to ${Number(slope.upper.toPrecision(4))}.`
    );
    // What R noted of its own answer is printed as R worded it.
    expect(described.remarks).toEqual(
      value.notes.map((note) => ({ kind: 'note', text: `R’s note: ${note}` }))
    );
    expect(value.notes.join(' ')).toContain('not a prediction band');

    const coloured = describeFit(ok(answerOf('linear-by-arm')), { fit: 'linear', color: 'Arm' });
    // The line of every point together is the one with no colour.
    expect(coloured.text).toBe(described.text);
    expect(coloured.estimates).toEqual(described.estimates);
    expect(coloured.table).toEqual({
      caption:
        'The line within each level of Arm, each by Linear regression. Exploratory, unadjusted.',
      head: [
        'Arm',
        'n',
        'Slope (95% confidence interval)',
        'Intercept (95% confidence interval)',
        'p, slope'
      ],
      rows: [
        {
          status: 'shown',
          head: 'Placebo',
          sub: null,
          cells: ['100', '0.3034 (0.2205 to 0.3862)', '2.333 (1.305 to 3.361)', 'p < 0.001']
        },
        {
          status: 'shown',
          head: 'Treatment',
          sub: null,
          cells: ['100', '0.3474 (0.271 to 0.4238)', '1.785 (0.8783 to 2.692)', 'p < 0.001']
        }
      ]
    });
    // A level with too few pairs says why in its row; too few in all, in the line's place.
    const small = describeFit(ok(answerOf('linear-age-57-by-arm')), {
      fit: 'linear',
      color: 'Arm'
    });
    expect(small.table.rows[1]).toEqual({
      status: 'withheld',
      head: 'Treatment',
      sub: null,
      cells: ['2', 'Not computed: 2 complete pairs. The minimum is 5. Counts: n = 2.', '', '']
    });
    const none = describeFit(ok(answerOf('linear-age-35')), { fit: 'linear' });
    expect(none.state).toBe('withheld');
    expect(none.text).toBe(
      'The linear fit is not drawn. Not computed: 4 complete pairs. The minimum is 5. Counts: n = 4.'
    );
    expect(none.estimates).toEqual([]);
    expect(JSON.stringify(coloured) + JSON.stringify(described)).not.toMatch(/\*|significan/i);
  });

  it('AS-FIT-003: a smooth prints its method and the pairs it used and no p-value, because a smooth has no test, with R’s notes; a level R drew no curve for says why (#26)', () => {
    const value = answerOf('smooth');
    expect(value.p_value).toBe(null);
    expect(value.estimates).toEqual([]);
    const described = describeFit(ok(value), { fit: 'smooth' });
    expect(described.state).toBe('shown');
    expect(described.text).toBe(
      'Local polynomial regression (loess): the curve and its band are R’s (n = 200).'
    );
    expect(described.text).not.toMatch(/p [=<>]/);
    expect(described.estimates).toEqual([]);
    expect(described.table).toBe(null);
    expect(described.remarks[0]).toEqual({
      kind: 'note',
      text: 'R’s note: A smooth has no slope, no intercept and no test, so none is reported.'
    });
    const small = describeFit(ok(answerOf('smooth-age-57-by-arm')), {
      fit: 'smooth',
      color: 'Arm'
    });
    expect(small.remarks[0]).toEqual({
      kind: 'withheld',
      text: 'Treatment: Not computed: 2 complete pairs. The minimum is 5. Counts: n = 2.'
    });
    expect(small.table).toBe(null);
    expect(fitScopeText({ fit: 'smooth', n: 200 })).toBe(
      'The line is R’s smooth of y on x for the 200 participants drawn, with R’s band about it.'
    );
    expect(fitScopeText({ fit: 'linear', n: 91, panel: 'F', color: 'Arm' })).toBe(
      'Each level of Arm has R’s linear fit of y on x in its colour, with R’s band about it. ' +
        'The dashed line is the linear fit of the 91 participants drawn in this panel (F) ' +
        'together, drawn without its band.'
    );
  });

  it('AS-FIT-004: the lines drawn are exactly the points R returned, joined: nothing of a line, a curve or a band is worked out here, and with no answer from R there is no line (#26)', () => {
    const linear = { xScale: 'linear', yScale: 'linear' };
    for (const name of ['linear', 'smooth', 'linear-by-arm', 'smooth-by-arm']) {
      const value = answerOf(name);
      const lines = fitCurves(ok(value), linear);
      const groups = [...new Set(value.rows.map((row) => row.group))];
      // The line of every point together first, then each level's, in R's order.
      expect(
        lines.map((line) => line.group),
        name
      ).toEqual(groups);
      for (const line of lines) {
        const rows = value.rows.filter((row) => row.group === line.group);
        expect(line.curve, name).toEqual(rows.map((row) => ({ x: row.x, y: row.fit })));
        expect(line.lower, name).toEqual(rows.map((row) => ({ x: row.x, y: row.lower })));
        expect(line.upper, name).toEqual(rows.map((row) => ({ x: row.x, y: row.upper })));
        expect(line.curve).toHaveLength(50);
      }
    }
    // A level R could not fit has no line: only the rows that are points are drawn.
    const small = answerOf('linear-age-57-by-arm');
    expect(small.rows.filter((row) => row.x === null).map((row) => row.group)).toEqual([
      'Treatment'
    ]);
    expect(fitCurves(ok(small), linear).map((line) => line.group)).toEqual([null, 'Placebo']);
    expect(fitCurves(ok(answerOf('linear-age-35')), linear)).toBe(null);
    // On logarithmic axes R's points are logarithms, and each is put back on
    // the axis's own scale: a position, and nothing else.
    const logged = answerOf('linear-log');
    const [line] = fitCurves(ok(logged), { xScale: 'log', yScale: 'log' });
    logged.rows.forEach((row, index) => {
      expect(line.curve[index]).toEqual({ x: 10 ** row.x, y: 10 ** row.fit });
      expect(line.lower[index].y).toBe(10 ** row.lower);
      expect(line.upper[index].y).toBe(10 ** row.upper);
    });
    // No answer, no line: unavailable, an error, nothing.
    expect(fitCurves({ status: 'unavailable', reason: 'no-r-attached', message: '' }, linear)).toBe(
      null
    );
    expect(fitCurves({ status: 'error', message: 'x' }, linear)).toBe(null);
    expect(fitCurves(undefined, linear)).toBe(null);
    // And with no R the chart says the line is not drawn, and why.
    expect(
      describeFit(
        {
          status: 'unavailable',
          reason: 'no-r-attached',
          message: 'Statistics are unavailable: no R is attached to this chart.'
        },
        { fit: 'linear' }
      )
    ).toEqual(
      plain(
        'unavailable',
        'The linear fit is not drawn. Statistics are unavailable: no R is attached to this chart.'
      )
    );
    expect(
      describeFit(
        { status: 'unavailable', reason: 'not-precomputed', message: '' },
        { fit: 'smooth' }
      ).text
    ).toBe(`The smooth is not drawn. ${NOT_STORED}`);
  });
});
