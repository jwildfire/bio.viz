// The rows desktop R is run on, for the association scatter's expected results.
// Each case is one panel of the gallery's demo chart in one view, with one
// thing asked of R, a coefficient or a fitted line: this file works out that
// panel's rows with the chart's own code (the core's frame, through
// `buildScatter`, and `rowsForR`), from the demo's own tables and settings, and
// writes them as a CSV file R can read with nothing but base R.
//
// tools/r-association-statistics.R then reads the cases and the rows, runs
// gsm.bio's vendored statistics file on them, and writes what R answered.
// Nothing about a value type, a baseline, a filter or a logarithmic axis is
// worked out a second time in R: the rows are the chart's, as it hands them
// over.
//
// Pure functions over text; tools/derive-association-statistics.mjs writes the
// files.

import vm from 'node:vm';
import { syncSettings } from '../src/association-scatter/configure.js';
import { correlationRequest, fitRequest } from '../src/association-scatter/statistic.js';
import { buildScatter } from '../src/association-scatter/structureData.js';
import { sha256 } from './vendor-lib.mjs';

export const ASSOCIATION_STATISTICS = {
  directory: 'tests/fixtures/association-statistics',
  cases: 'tests/fixtures/association-statistics/cases.csv',
  record: 'tests/fixtures/association-statistics/SOURCE.json',
  expected: 'tests/fixtures/association-statistics-r.json',
  sources: {
    results: 'site/data/synthetic-study/synthetic_results.csv',
    participants: 'site/data/synthetic-study/synthetic_participants.csv',
    study: 'site/demo/synthetic-study.js',
    demo: 'site/demo/association-scatter.js'
  }
};

const at = (measure, visit, value = 'raw') => ({ kind: 'measure', measure, value, visit });

// What every case starts from: the planted pair, TNF-alpha against IL-10 at
// Baseline, with no colour, no panels, both axes linear and no filter. Stated
// here, not read from what the demo opens on, so the cases are the same cases
// whatever view the demo page is changed to open on.
export const VIEW = Object.freeze({
  x: at('TNF-alpha', 'Baseline'),
  y: at('IL-10', 'Baseline'),
  colorBy: '',
  panelBy: '',
  xScale: 'linear',
  yScale: 'linear',
  filters: {}
});

// CRP and IFN-gamma are two of the study's biomarkers whose values are spread
// over a ratio scale: the pair the logarithmic axes are shown on.
const SKEWED = { x: at('CRP', 'Baseline'), y: at('IFN-gamma', 'Baseline') };
const AGE_AND_CHANGE = { x: { kind: 'column', col: 'AGE' }, y: at('IL-6', 'Week 4', 'change') };

// One panel in one view, with one thing asked. `view` is laid over the view
// every case starts from; `panel` picks the panel when the view has several, by
// its title; `method` is the coefficient, or `fit` the fitted line.
export const CASES = [
  {
    case: 'pearson',
    says: 'Pearson’s coefficient of the planted pair, TNF-alpha against IL-10 at Baseline',
    method: 'pearson'
  },
  {
    case: 'spearman',
    says: 'Spearman’s coefficient of the planted pair',
    method: 'spearman'
  },
  {
    case: 'pearson-by-arm',
    says: 'Pearson’s coefficient of the planted pair, overall and within each arm: the view the demo opens on',
    view: { colorBy: 'ARM' },
    method: 'pearson'
  },
  {
    case: 'spearman-by-arm',
    says: 'Spearman’s coefficient of the planted pair, overall and within each arm',
    view: { colorBy: 'ARM' },
    method: 'spearman'
  },
  {
    case: 'pearson-women',
    says: 'Pearson’s coefficient of the planted pair by arm, with the filter Sex set to F',
    view: { colorBy: 'ARM', filters: { SEX: 'F' } },
    method: 'pearson'
  },
  {
    case: 'pearson-panel-women',
    says: 'Pearson’s coefficient of the planted pair in the panel for F, with panels by sex',
    view: { panelBy: 'SEX' },
    panel: 'F',
    method: 'pearson'
  },
  {
    case: 'pearson-age-57-by-arm',
    says: 'Pearson’s coefficient by arm among participants aged 57: one arm is below the minimum number of pairs',
    view: { colorBy: 'ARM', filters: { AGE: '57' } },
    method: 'pearson'
  },
  {
    case: 'pearson-age-35',
    says: 'Pearson’s coefficient among participants aged 35: fewer complete pairs than the minimum',
    view: { filters: { AGE: '35' } },
    method: 'pearson'
  },
  {
    case: 'pearson-skewed',
    says: 'Pearson’s coefficient of CRP against IFN-gamma at Baseline, both axes linear',
    view: SKEWED,
    method: 'pearson'
  },
  {
    case: 'pearson-log',
    says: 'Pearson’s coefficient of CRP against IFN-gamma at Baseline on two logarithmic axes: of the base-10 logarithms',
    view: { ...SKEWED, xScale: 'log', yScale: 'log' },
    method: 'pearson'
  },
  {
    case: 'pearson-log-x',
    says: 'Pearson’s coefficient of CRP against IFN-gamma at Baseline with the x axis alone logarithmic',
    view: { ...SKEWED, xScale: 'log' },
    method: 'pearson'
  },
  {
    case: 'spearman-skewed',
    says: 'Spearman’s coefficient of CRP against IFN-gamma at Baseline, both axes linear',
    view: SKEWED,
    method: 'spearman'
  },
  {
    case: 'spearman-log',
    says: 'Spearman’s coefficient of CRP against IFN-gamma at Baseline on two logarithmic axes, where the ranks are the same',
    view: { ...SKEWED, xScale: 'log', yScale: 'log' },
    method: 'spearman'
  },
  {
    case: 'pearson-age',
    says: 'Pearson’s coefficient of a participant-level number, age, against the change in IL-6 from Baseline to Week 4',
    view: AGE_AND_CHANGE,
    method: 'pearson'
  },
  {
    case: 'spearman-age',
    says: 'Spearman’s coefficient of age against the change in IL-6: ages are whole numbers, so there are ties',
    view: AGE_AND_CHANGE,
    method: 'spearman'
  },
  // The fitted line: R's points, its band, and for a linear fit its slope and
  // intercept.
  {
    case: 'linear',
    says: 'The linear fit of IL-10 on TNF-alpha at Baseline, the planted pair',
    fit: 'linear'
  },
  {
    case: 'smooth',
    says: 'The smooth of IL-10 on TNF-alpha at Baseline',
    fit: 'smooth'
  },
  {
    case: 'linear-by-arm',
    says: 'The linear fit of the planted pair, of every point and within each arm: the view the demo opens on',
    view: { colorBy: 'ARM' },
    fit: 'linear'
  },
  {
    case: 'smooth-by-arm',
    says: 'The smooth of the planted pair, of every point and within each arm',
    view: { colorBy: 'ARM' },
    fit: 'smooth'
  },
  {
    case: 'linear-panel-women',
    says: 'The linear fit of the planted pair in the panel for F, with panels by sex',
    view: { panelBy: 'SEX' },
    panel: 'F',
    fit: 'linear'
  },
  {
    case: 'linear-log',
    says: 'The linear fit of IFN-gamma on CRP at Baseline on two logarithmic axes: of the base-10 logarithms',
    view: { ...SKEWED, xScale: 'log', yScale: 'log' },
    fit: 'linear'
  },
  {
    case: 'linear-age-57-by-arm',
    says: 'The linear fit by arm among participants aged 57: one arm has too few pairs for a line',
    view: { colorBy: 'ARM', filters: { AGE: '57' } },
    fit: 'linear'
  },
  {
    case: 'smooth-age-57-by-arm',
    says: 'The smooth by arm among participants aged 57: one arm has too few pairs for a curve',
    view: { colorBy: 'ARM', filters: { AGE: '57' } },
    fit: 'smooth'
  },
  {
    case: 'linear-age-35',
    says: 'The linear fit among participants aged 35: fewer complete pairs than the minimum',
    view: { filters: { AGE: '35' } },
    fit: 'linear'
  }
];

/**
 * The demo page's tables and settings, read from the demo's own scripts: they
 * are run with no page, where they only say what the page would use. The
 * settings give the columns, the baseline and the groups offered; the view a
 * case is drawn in is the case's own.
 * @param {{study: string, demo: string, results: string, participants: string}} sources
 *   The text of the two scripts and of the two vendored tables.
 * @returns {{tables: object, settings: object}}
 */
export function readDemo(sources) {
  const window = {};
  const context = vm.createContext({ window });
  vm.runInContext(sources.study, context);
  vm.runInContext(sources.demo, context);
  const demo = window.BioVizDemo;
  const study = {
    results: demo.withDay(demo.parse(sources.results)),
    participants: demo.parse(sources.participants)
  };
  // Copied out of the script's own realm, so they are ordinary objects here.
  return JSON.parse(
    JSON.stringify({
      tables: demo.associationScatter.tables(study),
      settings: demo.associationScatter.settings
    })
  );
}

/** What the controls are set to in a case: the view every case starts from, with the case's over it. */
export function stateOf(entry) {
  return {
    ...VIEW,
    ...(entry.view || {}),
    method: entry.method || 'pearson',
    fit: entry.fit || 'none'
  };
}

// The case's panel in its view: what is drawn, and which panel of it.
function panelOf({ tables, settings }, entry) {
  const config = syncSettings(settings);
  const state = stateOf(entry);
  const model = buildScatter(tables, config, state);
  const panel =
    entry.panel === undefined
      ? model.panels[0]
      : model.panels.find((candidate) => candidate.title === entry.panel);
  if (!panel || (entry.panel === undefined && model.panels.length !== 1)) {
    throw new Error(`${entry.case}: the view does not have the panel the case names.`);
  }
  return { config, state, panel };
}

/**
 * What the chart asks R in a case: the request for the case's panel, made by
 * the chart's own functions.
 * @returns {{name: string, data: object[], args: object, dataId: object, rows: number}}
 */
export function requestOf(demo, entry) {
  const { config, state, panel } = panelOf(demo, entry);
  return entry.fit
    ? fitRequest({ name: config.fit_statistic, fit: entry.fit, settings: config, state, panel })
    : correlationRequest({
        name: config.statistic,
        method: state.method,
        settings: config,
        state,
        panel
      });
}

const cell = (value, where) => {
  const written = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(written)) {
    throw new Error(`${where}: "${written}" cannot be written to a CSV file without quoting.`);
  }
  return written;
};

const csv = (columns, rows, where) =>
  [columns.join(','), ...rows.map((row) => row.map((value) => cell(value, where)).join(','))].join(
    '\n'
  ) + '\n';

// A list in one cell: its values joined by a bar.
const list = (values) => (values || []).join('|');

// An axis in four cells: a biomarker's name, value type and visit, or a column's name.
const axisCells = (axis) =>
  axis.kind === 'column'
    ? ['', '', '', axis.col]
    : [axis.measure, axis.value, axis.value === 'baseline' ? '' : axis.visit, ''];

/**
 * Every file of the fixture, as text: one CSV of rows per case, the list of
 * cases R reads, and a record of what they were derived from. A number is
 * written as the shortest text that reads back as exactly that number.
 * @param {object} sources The text of the demo's scripts and tables.
 * @returns {{files: Array<{file: string, text: string}>, record: object}}
 */
export function deriveAssociationStatistics(sources) {
  const demo = readDemo(sources);
  const files = [];
  // What R is told of a case is what an R user knows of a view: the settings
  // and the controls, by the chart's own names. The request the chart makes is
  // not in the file. R writes the key from this by the recipe in
  // docs/association-scatter.md, and the unit tests hold it to the chart's.
  const cases = CASES.map((entry) => {
    const { config, state, panel } = panelOf(demo, entry);
    const request = requestOf(demo, entry);
    const columns = Object.keys(request.data[0]);
    const file = `${entry.case}.csv`;
    files.push({
      file,
      text: csv(
        columns,
        request.data.map((record) => columns.map((column) => record[column])),
        file
      )
    });
    return [
      entry.case,
      file,
      entry.fit ? config.fit_statistic : config.statistic,
      entry.fit ? 'fit' : 'coefficient',
      entry.fit || state.method,
      ...axisCells(state.x),
      ...axisCells(state.y),
      list(config.baseline_visits),
      config.baseline_stat,
      state.colorBy,
      state.panelBy,
      panel.panelLevel,
      Object.entries(state.filters)
        .map(([column, selection]) => `${column}=${list([].concat(selection))}`)
        .join(';'),
      state.xScale,
      state.yScale
    ];
  });
  files.push({
    file: 'cases.csv',
    text: csv(
      [
        'case',
        'file',
        'statistic',
        'kind',
        'method',
        'x_measure',
        'x_value',
        'x_visit',
        'x_col',
        'y_measure',
        'y_value',
        'y_visit',
        'y_col',
        'baseline_visits',
        'baseline_stat',
        'color_by',
        'panel_by',
        'panel',
        'filters',
        'x_scale',
        'y_scale'
      ],
      cases,
      'cases.csv'
    )
  });
  return {
    files,
    record: {
      fixture: ASSOCIATION_STATISTICS.directory,
      derived_by: 'tools/derive-association-statistics.mjs',
      rule:
        "Each case is one panel of the gallery's association scatter demo in one view. Its rows " +
        "are the rows the chart hands R for that panel: one per participant, made by the core's " +
        'frame from the vendored synthetic study with the demo page’s own settings, with x and ' +
        'y as the axes plot them, so on a logarithmic axis the base-10 logarithm of the value.',
      derived_from: Object.values(ASSOCIATION_STATISTICS.sources).map((file) => ({ file })),
      cases: CASES.map(({ case: name, says }) => ({ case: name, says })),
      files: files.map(({ file, text }) => ({ file, sha256: sha256(Buffer.from(text)) }))
    }
  };
}
