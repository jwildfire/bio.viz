// The rows desktop R is run on, for the group comparison chart's expected
// results. Each case is one panel of the gallery's demo chart in one view, with
// one test chosen: this file works out that panel's rows with the chart's own
// code (the core's frame, through `buildPanels`), from the demo's own tables and
// settings, and writes them as a CSV file R can read with nothing but base R.
//
// tools/r-group-statistics.R then reads the cases and the rows, runs gsm.bio's
// vendored statistics file on them, and writes what R answered. Nothing about a
// value type, a baseline or a filter is worked out a second time in R: the rows
// are the chart's.
//
// Pure functions over text; tools/derive-group-statistics.mjs writes the files.

import vm from 'node:vm';
import { syncSettings } from '../src/group-comparison/configure.js';
import { fitTest, statisticRequest } from '../src/group-comparison/statistic.js';
import { buildPanels } from '../src/group-comparison/structureData.js';
import { sha256 } from './vendor-lib.mjs';

export const GROUP_STATISTICS = {
  directory: 'tests/fixtures/group-statistics',
  cases: 'tests/fixtures/group-statistics/cases.csv',
  record: 'tests/fixtures/group-statistics/SOURCE.json',
  expected: 'tests/fixtures/group-statistics-r.json',
  sources: {
    results: 'site/data/synthetic-study/synthetic_results.csv',
    participants: 'site/data/synthetic-study/synthetic_participants.csv',
    study: 'site/demo/synthetic-study.js',
    demo: 'site/demo/group-comparison.js'
  }
};

// One panel in one view, with one test. `view` is laid over the view every case
// starts from (VIEW, below); `panel` picks the panel when the view has several,
// by its title.
export const CASES = [
  { case: 'welch', says: 'Welch t-test between the two arms', test: 't' },
  { case: 'wilcoxon', says: 'Wilcoxon rank-sum test between the two arms', test: 'wilcoxon' },
  {
    case: 'anova',
    says: 'One-way ANOVA across arm and sex, four groups',
    view: { groupBy: 'ARM_SEX' },
    test: 'anova'
  },
  {
    case: 'kruskal',
    says: 'Kruskal-Wallis test across arm and sex, four groups',
    view: { groupBy: 'ARM_SEX' },
    test: 'kruskal'
  },
  {
    case: 'anova-pairwise',
    says: 'One-way ANOVA with every pair compared by Welch t-test',
    view: { groupBy: 'ARM_SEX' },
    test: 'anova',
    pairwise: true
  },
  {
    case: 'kruskal-pairwise',
    says: 'Kruskal-Wallis test with every pair compared by Wilcoxon rank-sum test',
    view: { groupBy: 'ARM_SEX' },
    test: 'kruskal',
    pairwise: true
  },
  {
    case: 'welch-women',
    says: 'Welch t-test between the arms, with the filter Sex set to F',
    view: { filters: { SEX: 'F' } },
    test: 't'
  },
  {
    case: 'welch-age-57',
    says: 'Welch t-test between the arms among participants aged 57: one arm is below the minimum group size',
    view: { filters: { AGE: '57' } },
    test: 't'
  },
  {
    case: 'welch-week-12',
    says: 'Welch t-test between the arms at Week 12, one of two visit panels',
    view: { visits: ['Week 4', 'Week 12'] },
    panel: 'Week 12',
    test: 't'
  },
  {
    case: 'welch-colour',
    says: 'Welch t-test between the arms with a second grouping by sex in colour, which is not part of the test',
    view: { colorBy: 'SEX' },
    test: 't'
  },
  {
    case: 'wilcoxon-log',
    says: 'Wilcoxon rank-sum test between the arms on the result itself, on a logarithmic axis',
    view: { valueType: 'raw', yScale: 'log' },
    test: 'wilcoxon'
  },
  {
    case: 'anova-baseline',
    says: 'One-way ANOVA across arm and sex on the baseline value, which has no visit',
    view: { valueType: 'baseline', groupBy: 'ARM_SEX' },
    test: 'anova'
  },
  // IL-6 as the demo shows it when its tile is opened: the
  // result itself at every visit, one panel and one test per visit.
  ...['Baseline', 'Week 2', 'Week 4', 'Week 8', 'Week 12'].map((visit) => ({
    case: `result-${visit.toLowerCase().replace(' ', '-')}`,
    says: `Welch t-test between the arms on the result itself at ${visit}, one of five visit panels`,
    view: { valueType: 'raw', visits: ['Baseline', 'Week 2', 'Week 4', 'Week 8', 'Week 12'] },
    panel: visit,
    test: 't'
  })),
  {
    case: 'welch-panel-women',
    says: 'Welch t-test between the arms in the panel for F, with panels by sex',
    view: { panelBy: 'SEX' },
    panel: 'F',
    test: 't'
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
      tables: demo.groupComparison.tables(study),
      settings: demo.groupComparison.settings
    })
  );
}

// What every case starts from: IL-6, change from Baseline to Week 4, by arm,
// with no filter. Stated here, not read from what the demo opens on, so the
// cases are the same cases whatever view the demo page is changed to open on.
export const VIEW = Object.freeze({
  measure: 'IL-6',
  visits: ['Week 4'],
  valueType: 'change',
  groupBy: 'ARM',
  levels: null,
  colorBy: '',
  panelBy: '',
  mark: 'box',
  yScale: 'linear',
  filters: {}
});

/** What the controls are set to in a case: the view every case starts from, with the case's over it. */
export function stateOf(entry) {
  return { ...VIEW, ...(entry.view || {}), test: entry.test, pairwise: Boolean(entry.pairwise) };
}

// The case's panel in its view: what is drawn, and which panel of it.
function panelOf({ tables, settings }, entry) {
  const config = syncSettings(settings);
  const state = stateOf(entry);
  const model = buildPanels(tables, config, state);
  const panel =
    entry.panel === undefined
      ? model.panels[0]
      : model.panels.find((candidate) => candidate.title === entry.panel);
  if (!panel || (entry.panel === undefined && model.panels.length !== 1)) {
    throw new Error(`${entry.case}: the view does not have the panel the case names.`);
  }
  const test = fitTest(state.test, model.shownLevels.length);
  if (test !== entry.test) {
    throw new Error(
      `${entry.case}: ${entry.test} does not fit ${model.shownLevels.length} groups.`
    );
  }
  return { config, state, panel, test };
}

/**
 * What the chart asks R in a case: the request for the case's panel, made by
 * the chart's own functions.
 * @returns {{name: string, data: object[], args: object, dataId: object, rows: number}}
 */
export function requestOf(demo, entry) {
  const { config, state, panel, test } = panelOf(demo, entry);
  return statisticRequest({
    name: config.statistic,
    test,
    pairwise: state.pairwise,
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

/**
 * Every file of the fixture, as text: one CSV of rows per case, the list of
 * cases R reads, and a record of what they were derived from. A number is
 * written as the shortest text that reads back as exactly that number.
 * @param {object} sources The text of the demo's scripts and tables.
 * @returns {{files: Array<{file: string, text: string}>, record: object}}
 */
export function deriveGroupStatistics(sources) {
  const demo = readDemo(sources);
  const files = [];
  // What R is told of a case is what an R user knows of a view: the settings
  // and the controls, by the chart's own names. The request the chart makes is
  // not in the file. R writes the key from this by the recipe in
  // docs/group-comparison.md, and the unit tests hold it to the chart's.
  const cases = CASES.map((entry) => {
    const { config, state, panel } = panelOf(demo, entry);
    const columns = Object.keys(panel.records[0]);
    const file = `${entry.case}.csv`;
    files.push({
      file,
      text: csv(
        columns,
        panel.records.map((record) => columns.map((column) => record[column])),
        file
      )
    });
    return [
      entry.case,
      file,
      config.statistic,
      state.test,
      state.pairwise ? 'TRUE' : 'FALSE',
      state.measure,
      state.valueType,
      panel.visit,
      list(config.baseline_visits),
      config.baseline_stat,
      state.groupBy,
      state.colorBy,
      state.panelBy,
      panel.panelLevel,
      Object.entries(state.filters)
        .map(([column, selection]) => `${column}=${list([].concat(selection))}`)
        .join(';'),
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
        'test',
        'pairwise',
        'measure',
        'value_type',
        'visit',
        'baseline_visits',
        'baseline_stat',
        'group_by',
        'color_by',
        'panel_by',
        'panel',
        'filters',
        'y_scale'
      ],
      cases,
      'cases.csv'
    )
  });
  return {
    files,
    record: {
      fixture: GROUP_STATISTICS.directory,
      derived_by: 'tools/derive-group-statistics.mjs',
      rule:
        "Each case is one panel of the gallery's group comparison demo in one view. Its rows are " +
        "the rows the chart hands R for that panel: one per participant, made by the core's " +
        'frame from the vendored synthetic study with the demo page’s own settings.',
      derived_from: Object.values(GROUP_STATISTICS.sources).map((file) => ({ file })),
      cases: CASES.map(({ case: name, says }) => ({ case: name, says })),
      files: files.map(({ file, text }) => ({ file, sha256: sha256(Buffer.from(text)) }))
    }
  };
}
