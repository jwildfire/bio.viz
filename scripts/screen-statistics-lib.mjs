// The frames desktop R is run on, for the biomarker screen's expected results.
// Each case is the gallery's demo chart in one view: this file works out that
// view's frame with the chart's own code (the core's frame, through
// `buildScreen`), from the demo's own tables and settings, and writes it as a
// CSV file R can read with nothing but base R: one row per participant, the
// id, one column per biomarker, and the column of groups or the variable
// correlated with, empty where the participant has no value.
//
// tools/r-screen-statistics.R then reads the cases and the frames, runs
// gsm.bio's vendored statistics file on them, and writes what R answered.
// Nothing about a value type, a baseline or a filter is worked out a second
// time in R, and who each row has is counted by R alone.
//
// Pure functions over text; tools/derive-screen-statistics.mjs writes the files.

import vm from 'node:vm';
import { syncSettings } from '../src/biomarker-screen/configure.js';
import { screenRequest } from '../src/biomarker-screen/statistic.js';
import { buildScreen, groupsOf } from '../src/biomarker-screen/structureData.js';
import { cutPoints } from '../src/core/cut.js';
import { flagOf, listEndpoints } from '../src/shared/outcomes.js';
import { listMeasures, listVisits } from '../src/shared/tables.js';
import { axisOf, settingOf } from '../src/shared/variables.js';
import { sha256 } from './vendor-lib.mjs';

export const SCREEN_STATISTICS = {
  directory: 'tests/fixtures/screen-statistics',
  cases: 'tests/fixtures/screen-statistics/cases.csv',
  record: 'tests/fixtures/screen-statistics/SOURCE.json',
  expected: 'tests/fixtures/screen-statistics-r.json',
  sources: {
    results: 'site/data/synthetic-study/synthetic_results.csv',
    participants: 'site/data/synthetic-study/synthetic_participants.csv',
    outcomes: 'site/data/synthetic-study/synthetic_outcomes.csv',
    study: 'site/demo/synthetic-study.js',
    demo: 'site/demo/biomarker-screen.js'
  }
};

// What every case starts from: the difference the study was planted with,
// every biomarker's change from Baseline to Week 4 between the arms, adjusted
// by Benjamini-Hochberg, with no filter. It is what the demo opens on, stated
// here and not read from the demo, so the cases are the same cases whatever
// the demo page is changed to open on.
export const VIEW = Object.freeze({
  comparison: 'difference',
  visit: 'Week 4',
  valueType: 'change',
  groupBy: 'ARM',
  levels: null,
  with: null,
  method: 'pearson',
  endpoint: 'EFS',
  adjustment: 'BH',
  filters: {}
});

const IL10 = { measure: 'IL-10', visit: 'Baseline' };
const CORRELATION = { comparison: 'correlation', visit: 'Baseline', valueType: 'raw', with: IL10 };
const HAZARD = { comparison: 'hazard', visit: 'Baseline', valueType: 'raw' };

// One view of the demo. `view` is laid over the view every case starts from.
export const CASES = [
  {
    case: 'difference-week-4-change',
    says: 'Every biomarker’s change from Baseline to Week 4, Placebo against Treatment, Benjamini-Hochberg: the view the demo opens on, with the planted difference'
  },
  {
    case: 'difference-week-4-change-holm',
    says: 'The same, adjusted by Holm',
    view: { adjustment: 'holm' }
  },
  {
    case: 'difference-baseline',
    says: 'Every biomarker at Baseline, as its result, Placebo against Treatment: before treatment, no planted difference',
    view: { visit: 'Baseline', valueType: 'raw' }
  },
  {
    case: 'difference-week-4-change-women',
    says: 'The opening view, with the filter Sex set to F',
    view: { filters: { SEX: 'F' } }
  },
  {
    case: 'difference-sex',
    says: 'Every biomarker’s change to Week 4, F against M',
    view: { groupBy: 'SEX' }
  },
  {
    case: 'difference-age-35',
    says: 'The opening view among the four participants aged 35: every row has a group too small',
    view: { filters: { AGE: '35' } }
  },
  {
    case: 'correlation-il-10',
    says: 'Every biomarker at Baseline against IL-10 at Baseline, Pearson, Benjamini-Hochberg: the planted correlation is TNF-alpha’s; IL-10 is not a row',
    view: CORRELATION
  },
  {
    case: 'correlation-il-10-holm',
    says: 'The same, adjusted by Holm',
    view: { ...CORRELATION, adjustment: 'holm' }
  },
  {
    case: 'correlation-il-10-spearman',
    says: 'The same with Spearman’s coefficient: no interval in any row',
    view: { ...CORRELATION, method: 'spearman' }
  },
  {
    case: 'hazard-baseline',
    says: 'Every biomarker at Baseline, as its result, cut at its median, hazard ratio of high against low on event-free survival, Benjamini-Hochberg: CRP was planted with the survival effect',
    view: HAZARD
  },
  {
    case: 'hazard-baseline-holm',
    says: 'The same, adjusted by Holm',
    view: { ...HAZARD, adjustment: 'holm' }
  },
  {
    case: 'hazard-baseline-women',
    says: 'The same, with the filter Sex set to F',
    view: { ...HAZARD, filters: { SEX: 'F' } }
  },
  {
    case: 'hazard-baseline-age-35',
    says: 'The same among the four participants aged 35: every row has a group too small',
    view: { ...HAZARD, filters: { AGE: '35' } }
  },
  {
    case: 'hazard-baseline-30-without-outcome',
    says: 'The hazard screen with the event-free survival rows of the thirty participants with the highest CRP at Baseline taken out: each biomarker is cut at the median of those with an outcome',
    view: HAZARD,
    outcomes: 'without-30'
  },
  {
    case: 'hazard-baseline-no-events-in-low-crp',
    says: 'The hazard screen with every participant at or below the median of CRP at Baseline censored: CRP’s Low half has no event, and its hazard ratio is not estimable',
    view: HAZARD,
    outcomes: 'no-events-in-low-crp'
  },
  {
    case: 'correlation-age',
    says: 'Every biomarker’s change to Week 4 against age, a participant-level number',
    view: { comparison: 'correlation', with: { col: 'AGE' } }
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
  const outcomes = demo.parse(sources.outcomes);
  // Copied out of the script's own realm, so they are ordinary objects here.
  return JSON.parse(
    JSON.stringify({
      tables: demo.biomarkerScreen.tables(study, outcomes),
      settings: demo.biomarkerScreen.settings
    })
  );
}

/**
 * What the controls are set to in a case, as the chart keeps it: the view every
 * case starts from with the case's over it, the two groups found as the chart
 * finds them, and the variable correlated with as the chart keeps a variable.
 */
export function stateOf(demo, entry) {
  const view = { ...VIEW, ...(entry.view || {}) };
  return {
    ...view,
    levels: groupsOf(demo.tables, view.groupBy, view.levels).levels,
    with: view.with ? axisOf(view.with) : null
  };
}

// CRP at Baseline for each participant with a result, by id.
function crpAtBaseline(tables) {
  return new Map(
    tables.results
      .filter((row) => row.TEST === 'CRP' && row.VISIT === 'Baseline')
      .map((row) => [row.USUBJID, Number(row.STRESN)])
  );
}

/**
 * The outcomes table a case is drawn on: the demo's, or the demo's changed as
 * the case says. Worked out from the demo's own tables, not typed.
 *   without-30            the rows of the thirty participants with the highest
 *                         CRP at Baseline taken out
 *   no-events-in-low-crp  every participant whose CRP at Baseline is at or
 *                         below its median censored, so CRP's Low half has no event
 */
export function outcomesFor(demo, entry) {
  const outcomes = demo.tables.outcomes;
  if (!entry.outcomes) return outcomes;
  const crp = crpAtBaseline(demo.tables);
  if (entry.outcomes === 'without-30') {
    const highest = new Set(
      [...crp]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([id]) => id)
    );
    return outcomes.filter((row) => !highest.has(row.USUBJID));
  }
  if (entry.outcomes === 'no-events-in-low-crp') {
    const [median] = cutPoints([...crp.values()], 'median').points;
    return outcomes.map((row) => (crp.get(row.USUBJID) <= median ? { ...row, CNSR: '1' } : row));
  }
  throw new Error(`${entry.case}: no outcomes rule ${entry.outcomes}.`);
}

// The case's frame: what the screen is of, and the rows R is handed.
function modelOf(demo, entry) {
  const config = syncSettings({ ...demo.settings, visit: null });
  const state = stateOf(demo, entry);
  const tables = { ...demo.tables, outcomes: outcomesFor(demo, entry) };
  const offered = {
    measures: listMeasures(tables.results, config),
    visits: listVisits(tables.results, config).all,
    endpoints: listEndpoints(tables.outcomes, config)
  };
  const model = buildScreen(tables, config, state, offered);
  if (model.message || !model.records.length) {
    throw new Error(`${entry.case}: the view has no screen (${model.message}).`);
  }
  return { config, state, model };
}

/**
 * What the chart asks R in a case: the request for the case's screen, made by
 * the chart's own functions.
 * @returns {{name: string, data: object[], args: object, dataId: object, rows: number}}
 */
export function requestOf(demo, entry) {
  const { config, state, model } = modelOf(demo, entry);
  return screenRequest({ name: config.statistic, settings: config, state, model });
}

/** The rows of the screen in a case, in order: the biomarkers, as R is handed them. */
export const rowsOfCase = (demo, entry) => modelOf(demo, entry).model.rows.map((row) => row.name);

const cell = (value, where) => {
  const written = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(written)) {
    throw new Error(`${where}: "${written}" cannot be written to a CSV file without quoting.`);
  }
  return written;
};

const csv = (columns, rows, where) =>
  [
    columns.map((column) => cell(column, where)).join(','),
    ...rows.map((row) => row.map((value) => cell(value, where)).join(','))
  ].join('\n') + '\n';

// A list in one cell: its values joined by a bar, which none of them may hold.
const list = (values) => {
  for (const value of values || []) {
    if (/[|;=]/.test(String(value))) throw new Error(`"${value}" cannot be written in a list.`);
  }
  return (values || []).join('|');
};

/**
 * Every file of the fixture, as text: one CSV frame per case, the list of
 * cases R reads, and a record of what they were derived from. A number is
 * written as the shortest text that reads back as exactly that number, and a
 * value a participant does not have as an empty cell.
 * @param {object} sources The text of the demo's scripts and tables.
 * @returns {{files: Array<{file: string, text: string}>, record: object}}
 */
export function deriveScreenStatistics(sources) {
  const demo = readDemo(sources);
  const files = [];
  // What R is told of a case is what an R user knows of a view: the settings
  // and the controls, by the chart's own names. The request the chart makes is
  // not in the file. R writes the key from this by the recipe in
  // docs/biomarker-screen.md, and the unit tests hold it to the chart's.
  const cases = CASES.map((entry) => {
    const { config, state, model } = modelOf(demo, entry);
    const hazard = state.comparison === 'hazard';
    const columns = [
      config.id_col,
      ...model.rows.map((row) => row.name),
      ...(hazard ? model.outcomeFields : [model.extra])
    ];
    const file = `${entry.case}.csv`;
    files.push({
      file,
      text: csv(
        columns,
        model.records.map((record) => columns.map((column) => record[column])),
        file
      )
    });
    const fixed = state.with ? settingOf(state.with) : {};
    return [
      entry.case,
      file,
      config.statistic,
      state.comparison,
      state.valueType,
      state.valueType === 'baseline' ? '' : state.visit,
      list(model.rows.map((row) => row.name)),
      state.comparison === 'difference' ? state.groupBy : '',
      state.comparison === 'difference' ? list(state.levels) : '',
      fixed.measure ?? '',
      fixed.value ?? '',
      fixed.visit ?? '',
      fixed.col ?? '',
      state.comparison === 'correlation' ? model.extra : '',
      state.method,
      hazard ? state.endpoint : '',
      hazard ? flagOf(config).field : '',
      state.adjustment,
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
        'comparison',
        'value_type',
        'visit',
        'biomarkers',
        'group_by',
        'groups',
        'with_measure',
        'with_value',
        'with_visit',
        'with_col',
        'with_name',
        'method',
        'endpoint',
        'flag',
        'adjustment',
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
      fixture: SCREEN_STATISTICS.directory,
      derived_by: 'tools/derive-screen-statistics.mjs',
      rule:
        "Each case is the gallery's biomarker screen demo in one view. Its file is the frame " +
        'the chart hands R for that view: one row per participant, the id, one column per ' +
        'biomarker of the screen at its visit with its value type, and the column of groups, ' +
        'the variable correlated with, or for a hazard ratio the time and the flag of the ' +
        "endpoint, made by the core's frame from the vendored synthetic " +
        'study with the demo page’s own settings. A participant with some of the biomarkers is ' +
        'kept, with an empty cell for each value they do not have.',
      derived_from: Object.values(SCREEN_STATISTICS.sources).map((file) => ({ file })),
      cases: CASES.map(({ case: name, says }) => ({ case: name, says })),
      files: files.map(({ file, text }) => ({ file, sha256: sha256(Buffer.from(text)) }))
    }
  };
}
