// The frames desktop R is run on, for the correlation matrix's expected
// results. Each case is the gallery's demo chart in one view: this file works
// out that view's frame with the chart's own code (the core's frame, through
// `buildMatrix`), from the demo's own tables and settings, and writes it as a
// CSV file R can read with nothing but base R: one row per participant, the id
// and one column per variable of the grid, empty where the participant has no
// value.
//
// tools/r-matrix-statistics.R then reads the cases and the frames, runs
// gsm.bio's vendored statistics file on them, and writes what R answered.
// Nothing about a value type, a baseline or a filter is worked out a second
// time in R, and which participants a pair has in common is counted by R alone.
//
// Pure functions over text; tools/derive-matrix-statistics.mjs writes the files.

import vm from 'node:vm';
import { syncSettings } from '../src/correlation-matrix/configure.js';
import { matrixRequest } from '../src/correlation-matrix/statistic.js';
import { buildMatrix } from '../src/correlation-matrix/structureData.js';
import { listMeasures, listVisits } from '../src/shared/tables.js';
import { sha256 } from './vendor-lib.mjs';

export const MATRIX_STATISTICS = {
  directory: 'tests/fixtures/matrix-statistics',
  cases: 'tests/fixtures/matrix-statistics/cases.csv',
  record: 'tests/fixtures/matrix-statistics/SOURCE.json',
  expected: 'tests/fixtures/matrix-statistics-r.json',
  sources: {
    results: 'site/data/synthetic-study/synthetic_results.csv',
    participants: 'site/data/synthetic-study/synthetic_participants.csv',
    study: 'site/demo/synthetic-study.js',
    demo: 'site/demo/correlation-matrix.js'
  }
};

// What every case starts from: every biomarker at Baseline, as its result, with
// Pearson's coefficient, R's own minimum and no filter. It is what the demo
// opens on, stated here and not read from the demo, so the cases are the same
// cases whatever the demo page is changed to open on.
export const VIEW = Object.freeze({
  mode: 'biomarkers',
  visit: 'Baseline',
  biomarkers: null,
  measure: 'IL-6',
  visits: null,
  valueType: 'raw',
  method: 'pearson',
  minPairs: null,
  filters: {}
});

const SIX = ['CRP', 'IFN-gamma', 'IL-10', 'IL-2', 'IL-6', 'TNF-alpha'];

// One view of the demo. `view` is laid over the view every case starts from.
export const CASES = [
  {
    case: 'biomarkers-baseline',
    says: 'Every biomarker at Baseline, Pearson: the view the demo opens on, with the planted pair'
  },
  {
    case: 'biomarkers-baseline-spearman',
    says: 'Every biomarker at Baseline, Spearman: no interval in any cell',
    view: { method: 'spearman' }
  },
  {
    case: 'biomarkers-week-4-change',
    says: 'Every biomarker’s change from Baseline to Week 4: participants with no result at Week 4 leave gaps, and the pair counts differ',
    view: { visit: 'Week 4', valueType: 'change' }
  },
  {
    case: 'biomarkers-women',
    says: 'Every biomarker at Baseline, with the filter Sex set to F',
    view: { filters: { SEX: 'F' } }
  },
  {
    case: 'six-biomarkers',
    says: 'Six biomarkers at Baseline: as few as the small scatters are offered for',
    view: { biomarkers: SIX }
  },
  {
    case: 'visits-il-6',
    says: 'IL-6 across its five visits, as its result',
    view: { mode: 'visits' }
  },
  {
    case: 'visits-il-6-change',
    says: 'IL-6’s change from Baseline across the four later visits: the baseline visit is not a variable',
    view: { mode: 'visits', valueType: 'change' }
  },
  {
    case: 'visits-tnf-alpha-spearman',
    says: 'TNF-alpha across its five visits, Spearman',
    view: { mode: 'visits', measure: 'TNF-alpha', method: 'spearman' }
  },
  {
    case: 'week-12-minimum-183',
    says: 'Every biomarker at Week 12 with a minimum of 183 complete pairs set by the reader: R declines the cells with fewer and answers the rest',
    view: { visit: 'Week 12', minPairs: 183 }
  },
  {
    case: 'age-35',
    says: 'Every biomarker at Baseline among the four participants aged 35: no pair has enough complete pairs',
    view: { filters: { AGE: '35' } }
  }
];

/**
 * The demo page's tables and settings, read from the demo's own scripts: they
 * are run with no page, where they only say what the page would use.
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
      tables: demo.correlationMatrix.tables(study),
      settings: demo.correlationMatrix.settings
    })
  );
}

/** What the controls are set to in a case: the view every case starts from, with the case's over it. */
export const stateOf = (entry) => ({ ...VIEW, ...(entry.view || {}) });

// The case's frame: what the grid is of, and the rows R is handed.
function modelOf({ tables, settings }, entry) {
  const config = syncSettings(settings);
  const state = stateOf(entry);
  const offered = {
    measures: listMeasures(tables.results, config),
    visits: listVisits(tables.results, config).all
  };
  const model = buildMatrix(tables, config, state, offered);
  if (model.variables.length < 2 || !model.records.length) {
    throw new Error(`${entry.case}: the view has no grid.`);
  }
  return { config, state, model };
}

/**
 * What the chart asks R in a case: the request for the case's grid, made by the
 * chart's own functions.
 * @returns {{name: string, data: object[], args: object, dataId: object, rows: number}}
 */
export function requestOf(demo, entry) {
  const { config, state, model } = modelOf(demo, entry);
  return matrixRequest({
    name: config.statistic,
    method: state.method,
    minPairs: state.minPairs,
    settings: config,
    state,
    model
  });
}

/** The grid's variables in a case, in order: each with the name R is handed it by and its label. */
export const variablesOf = (demo, entry) =>
  modelOf(demo, entry).model.variables.map(({ name, label }) => ({ name, label }));

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
 * Every file of the fixture, as text: one CSV frame per case, the list of
 * cases R reads, and a record of what they were derived from. A number is
 * written as the shortest text that reads back as exactly that number, and a
 * value a participant does not have as an empty cell.
 * @param {object} sources The text of the demo's scripts and tables.
 * @returns {{files: Array<{file: string, text: string}>, record: object}}
 */
export function deriveMatrixStatistics(sources) {
  const demo = readDemo(sources);
  const files = [];
  // What R is told of a case is what an R user knows of a view: the settings
  // and the controls, by the chart's own names. The request the chart makes is
  // not in the file. R writes the key from this by the recipe in
  // docs/correlation-matrix.md, and the unit tests hold it to the chart's.
  const cases = CASES.map((entry) => {
    const { config, state, model } = modelOf(demo, entry);
    const columns = [config.id_col, ...model.variables.map((variable) => variable.name)];
    const file = `${entry.case}.csv`;
    files.push({
      file,
      text: csv(
        columns,
        model.records.map((record) => columns.map((column) => record[column])),
        file
      )
    });
    return [
      entry.case,
      file,
      config.statistic,
      state.method,
      state.minPairs,
      state.mode,
      state.valueType,
      // Across biomarkers: the visit they are read at, and the biomarkers.
      // Across visits: the biomarker, and the visits.
      state.mode === 'biomarkers' && state.valueType !== 'baseline' ? state.visit : '',
      state.mode === 'visits' ? state.measure : '',
      list(model.variables.map((variable) => variable.label)),
      list(config.baseline_visits),
      config.baseline_stat,
      Object.entries(state.filters)
        .map(([column, selection]) => `${column}=${list([].concat(selection))}`)
        .join(';')
    ];
  });
  files.push({
    file: 'cases.csv',
    text: csv(
      [
        'case',
        'file',
        'statistic',
        'method',
        'min_pairs',
        'mode',
        'value_type',
        'visit',
        'measure',
        'variables',
        'baseline_visits',
        'baseline_stat',
        'filters'
      ],
      cases,
      'cases.csv'
    )
  });
  return {
    files,
    record: {
      fixture: MATRIX_STATISTICS.directory,
      derived_by: 'tools/derive-matrix-statistics.mjs',
      rule:
        "Each case is the gallery's correlation matrix demo in one view. Its file is the frame " +
        'the chart hands R for that view: one row per participant, the id and one column per ' +
        "variable of the grid (v1, v2, …), made by the core's frame from the vendored " +
        'synthetic study with the demo page’s own settings. A participant with some of the ' +
        'values is kept, with an empty cell for each value they do not have.',
      derived_from: Object.values(MATRIX_STATISTICS.sources).map((file) => ({ file })),
      cases: CASES.map(({ case: name, says }) => ({ case: name, says })),
      files: files.map(({ file, text }) => ({ file, sha256: sha256(Buffer.from(text)) }))
    }
  };
}
