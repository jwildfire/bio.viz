import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CASES,
  GRID_CASES,
  GROUP_STATISTICS,
  OVER_TIME_CASES,
  deriveGroupStatistics,
  gridRequestOf,
  gridStateOf,
  overTimeRequestOf,
  readDemo,
  requestOf
} from '../../../scripts/group-statistics-lib.mjs';
import { createConnection } from '../../../src/r/index.js';
import { canonicalJson } from '../../../src/r/canonical.js';
import { syncSettings } from '../../../src/group-comparison/configure.js';
import { buildGrid, pairOf } from '../../../src/group-comparison/grid.js';
import { listMeasures } from '../../../src/group-comparison/structureData.js';
import { buildTiles } from '../../../src/group-comparison/tiles.js';
import {
  createStatisticDesk,
  describeGrid,
  gridRequest,
  gridScope
} from '../../../src/group-comparison/statistic.js';
import { participants, results } from '../core/study.js';

// The difference grid's one request (#86). The chart asks R once for every
// cell, and prints what comes back. The answers here are desktop R's, for rows
// the chart's own code derived (tests/fixtures/group-statistics-r.json,
// `grid`); no number was typed.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const text = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const sources = Object.fromEntries(
  Object.entries(GROUP_STATISTICS.sources).map(([name, file]) => [name, text(file)])
);
const demo = readDemo(sources);
const fromR = JSON.parse(text(GROUP_STATISTICS.expected));
const resultOf = (name) => fromR.grid.find((result) => result.case === name);
const caseOf = (name) => GRID_CASES.find((entry) => entry.case === name);
const answered = (name) => ({ status: 'ok', value: resultOf(name).value, form: 'precomputed' });

const VISITS = ['Baseline', 'Week 2', 'Week 4', 'Week 8', 'Week 12'];
const tables = { results, participants };
const settings = syncSettings({ baseline_visits: 'Baseline' });
const measures = listMeasures(results, settings);
const state = (overrides = {}) => ({
  measure: null,
  visits: VISITS,
  valueType: 'raw',
  groupBy: 'ARM',
  levels: null,
  colorBy: '',
  panelBy: '',
  mark: 'box',
  yScale: 'linear',
  tileSummary: 'median',
  filters: {},
  ...overrides
});
const request = (overrides = {}, parts = {}, config = settings) => {
  const drawn = state(overrides);
  const built = buildTiles(parts.tables || tables, config, drawn, parts.measures || measures);
  const pair = pairOf(
    built.groups.map((group) => group.level),
    parts.pair || null
  );
  return gridRequest({
    name: 'Analyze_DifferenceGrid',
    settings: config,
    state: drawn,
    grid: buildGrid(built, { pair, valueType: drawn.valueType }),
    ...(parts.unscheduled ? { unscheduled: true } : {})
  });
};

describe('the difference grid: what R is asked', () => {
  it('GC-GRID-006: R is asked once for every cell: the long rows of the two groups compared, one per participant, biomarker and visit, and arguments that name the value, the group, the biomarker and the visit columns, the two groups first then second, the biomarkers in the grid’s order and the visits in visit order; no test, adjustment, confidence level or minimum group size is sent (#86)', () => {
    const asked = request();
    expect(asked.name).toBe('Analyze_DifferenceGrid');
    expect(asked.args).toEqual({
      strValueCol: 'y',
      strGroupCol: 'x',
      strBiomarkerCol: 'biomarker',
      strByCol: 'visit',
      chrGroups: ['Placebo', 'Treatment'],
      chrBiomarkers: measures,
      chrBy: VISITS
    });
    expect(Object.keys(asked.args)).toEqual([
      'strValueCol',
      'strGroupCol',
      'strBiomarkerCol',
      'strByCol',
      'chrGroups',
      'chrBiomarkers',
      'chrBy'
    ]);
    expect(Object.keys(asked.data[0])).toEqual(['USUBJID', 'y', 'x', 'visit', 'biomarker']);
    expect(asked.rows).toBe(11304);
    expect(asked.data).toHaveLength(11304);
    // A cell's rows are the rows the single-visit view of that biomarker at
    // that visit hands R: opening a cell shows the same participants.
    for (const [measure, visit] of [
      ['IL-6', 'Week 4'],
      ['CRP', 'Baseline'],
      ['VEGF', 'Week 12']
    ]) {
      const single = requestOf(demo, {
        case: `${measure} ${visit}`,
        view: { measure, valueType: 'raw', visits: [visit] },
        test: 't'
      });
      expect(
        asked.data
          .filter((row) => row.biomarker === measure && row.visit === visit)
          .map(({ visit: at, biomarker, ...row }) => row),
        `${measure} ${visit}`
      ).toEqual(single.data);
    }
    // The pair the other way round is the same rows and the other order.
    const reversed = request({}, { pair: ['Treatment', 'Placebo'] });
    expect(reversed.args.chrGroups).toEqual(['Treatment', 'Placebo']);
    expect(reversed.data).toEqual(asked.data);
    // A page of biomarkers: R is asked for those, and no others.
    const page = request({}, { measures: measures.slice(3, 6) });
    expect(page.args.chrBiomarkers).toEqual(measures.slice(3, 6));
    expect([...new Set(page.data.map((row) => row.biomarker))]).toEqual(measures.slice(3, 6));
    // The baseline visit of a change is not sent, and is not named.
    const change = request({ valueType: 'change' });
    expect(change.args.chrBy).toEqual(VISITS.slice(1));
    expect(change.data.some((row) => row.visit === 'Baseline')).toBe(false);
    for (const absent of ['strMethod', 'strPAdjust', 'bPairwise', 'nConfLevel', 'nMinGroup']) {
      expect(asked.args).not.toHaveProperty(absent);
    }
  });

  it('GC-GRID-007: the identity of the rows names the biomarkers of the page drawn, the value, the visits compared, the baseline, the column of groups, the two groups in the order compared and not sorted, the filters in force and a logarithmic scale; it has no colour, no panel and no page, and says unscheduled visits only when they are drawn (#86)', () => {
    expect(request().dataId).toEqual({
      chart: 'group-comparison',
      measures,
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
      'measures',
      'value_type',
      'visits',
      'baseline_visits',
      'baseline_stat',
      'group_by',
      'groups',
      'filters',
      'positive_only'
    ]);
    expect(Object.keys(request({}, { unscheduled: true }).dataId).slice(-1)).toEqual([
      'unscheduled_visits'
    ]);
    expect(request({}, { unscheduled: true }).dataId.unscheduled_visits).toBe(true);
    expect(request().dataId).not.toHaveProperty('unscheduled_visits');
    expect(request({ filters: { SEX: 'F' } }).dataId.filters).toEqual({ SEX: ['F'] });
    // The order of the two groups is the direction of the difference, so it is
    // kept: the other way round is another key.
    const reversed = request({}, { pair: ['Treatment', 'Placebo'] });
    expect(reversed.dataId.groups).toEqual(['Treatment', 'Placebo']);
    expect(canonicalJson(reversed.dataId)).not.toBe(canonicalJson(request().dataId));
    // A page is named by its biomarkers, not by a number.
    const page = request({}, { measures: measures.slice(0, 5) });
    expect(page.dataId.measures).toEqual(measures.slice(0, 5));
    for (const absent of ['measure', 'visit', 'page', 'color_by', 'panel_by', 'panel']) {
      expect(page.dataId, absent).not.toHaveProperty(absent);
    }
    // Colour by and Panel by are not applied, so they are not in the identity.
    expect(request({ colorBy: 'SEX', panelBy: 'SEX' }).dataId).toEqual(request().dataId);
    // No baseline visits set: the member is left out, not written as null.
    const bare = request({}, {}, syncSettings({}));
    expect(bare.dataId).not.toHaveProperty('baseline_visits');
    // A change: the visits compared, without the baseline visit.
    expect(request({ valueType: 'change' }).dataId.visits).toEqual(VISITS.slice(1));
    expect(request({ valueType: 'change' }).dataId.value_type).toBe('change');
  });

  it('GC-GRID-008: on a logarithmic scale the grid’s rows leave out a value of zero or less, as the tiles do, and hand R the values as they are, not their logarithms; the identity says so, and the sentence under the grid says which difference it is (#86)', () => {
    // Of results the study has none at zero or below: the same rows, another key.
    const linear = request();
    const log = request({ yScale: 'log' });
    expect(log.data).toEqual(linear.data);
    expect(log.dataId).toEqual({ ...linear.dataId, positive_only: true });
    // A change can be zero or negative: those rows are left out, and the rest
    // are the changes themselves.
    const change = request({ valueType: 'change' });
    const positive = request({ valueType: 'change', yScale: 'log' });
    expect(change.data.some((row) => row.y <= 0)).toBe(true);
    expect(positive.data.length).toBeGreaterThan(0);
    expect(positive.data).toEqual(change.data.filter((row) => row.y > 0));
    expect(positive.dataId.positive_only).toBe(true);
    const said = gridScope({
      pair: ['Placebo', 'Treatment'],
      group: 'Arm',
      value: 'result',
      positive: true
    });
    expect(said).toBe(
      'Each cell compares Placebo with Treatment, two levels of Arm, on the participants with a result of that biomarker at that visit. ' +
        'The scale is logarithmic: values of zero or less are left out, as they are from the tiles, and the difference is of the values as they are, not of their logarithms.'
    );
    // And R's answer for the logarithmic scale is its answer for the same rows.
    expect(resultOf('grid-log').value.rows).toEqual(resultOf('grid-result').value.rows);
    expect(resultOf('grid-log').dataId.positive_only).toBe(true);
  });
});

describe('the difference grid: the rows R is run on, and the key R wrote', () => {
  it('GC-GRID-009: deriving each case’s long rows again, with the chart’s own code from the demo’s own tables and settings, gives the committed files, and a case that shares another’s rows asks about exactly those rows (#86)', () => {
    const { files, record } = deriveGroupStatistics(sources);
    const own = (cases) => cases.filter((entry) => !entry.rows).map((entry) => `${entry.case}.csv`);
    expect(files.map((entry) => entry.file)).toEqual([
      ...CASES.map((entry) => `${entry.case}.csv`),
      'cases.csv',
      ...own(OVER_TIME_CASES),
      'over-time-cases.csv',
      ...own(GRID_CASES),
      'grid-cases.csv'
    ]);
    for (const { file, text: derived } of files) {
      expect(text(`${GROUP_STATISTICS.directory}/${file}`), file).toBe(derived);
    }
    expect(readdirSync(path.join(ROOT, GROUP_STATISTICS.directory)).sort()).toEqual(
      [...files.map((entry) => entry.file), 'SOURCE.json'].sort()
    );
    const committed = JSON.parse(text(GROUP_STATISTICS.record));
    expect(committed.grid_cases).toEqual(record.grid_cases);
    expect(committed.grid_cases.map((entry) => entry.case)).toEqual(
      GRID_CASES.map((entry) => entry.case)
    );
    expect(GRID_CASES).toHaveLength(9);
    // The rows are long: the id, the value, the group, the visit and the biomarker.
    const lines = text(`${GROUP_STATISTICS.directory}/grid-change.csv`).trimEnd().split('\n');
    expect(lines[0]).toBe('USUBJID,y,x,visit,biomarker');
    expect(lines).toHaveLength(1 + gridRequestOf(demo, caseOf('grid-change')).rows);
    // What a case is drawn as is the opening view: no biomarker, every visit.
    expect(gridStateOf(demo, caseOf('grid-result'))).toMatchObject({
      measure: null,
      visits: VISITS,
      valueType: 'raw',
      groupBy: 'ARM'
    });
    for (const entry of GRID_CASES.filter((each) => each.rows)) {
      expect(gridRequestOf(demo, entry).data, entry.case).toEqual(
        gridRequestOf(demo, caseOf(entry.rows)).data
      );
    }
  });

  it('GC-GRID-010: for every case the function, the arguments, the identity and the row count R wrote by the recipe are the ones the chart asks with; handed to a connection as stored results each answer is found by the chart’s request and by no other view’s; and the recipe printed in the reference is the one the script runs (#86)', async () => {
    expect(fromR.grid.map((result) => result.case)).toEqual(GRID_CASES.map((entry) => entry.case));
    for (const entry of GRID_CASES) {
      const asked = gridRequestOf(demo, entry);
      const written = resultOf(entry.case);
      expect(written.name, entry.case).toBe('Analyze_DifferenceGrid');
      expect(written.name, entry.case).toBe(asked.name);
      expect(written.args, entry.case).toEqual(asked.args);
      expect(written.dataId, entry.case).toEqual(asked.dataId);
      expect(written.rows, entry.case).toBe(asked.rows);
      expect(canonicalJson(written.dataId), entry.case).toBe(canonicalJson(asked.dataId));
      expect(canonicalJson(written.args), entry.case).toBe(canonicalJson(asked.args));
    }
    const connection = createConnection({
      results: fromR.grid.map(({ name, args, dataId, rows, value }) => ({
        name,
        args,
        dataId,
        rows,
        value
      }))
    });
    const run = ({ name, data, args, dataId }) => connection.run(name, { data, args, dataId });
    for (const entry of GRID_CASES) {
      expect(await run(gridRequestOf(demo, entry)), entry.case).toEqual({
        status: 'ok',
        value: resultOf(entry.case).value,
        form: 'precomputed'
      });
    }
    // The same rows the other way round are another answer.
    const one = await run(gridRequestOf(demo, caseOf('grid-result')));
    const other = await run(gridRequestOf(demo, caseOf('grid-result-reversed')));
    expect(one.value.rows[6].estimate).not.toBe(other.value.rows[6].estimate);
    // A view none was stored for is unavailable, never another view's numbers:
    // another value, another pair, a page of fewer biomarkers, and the two
    // other requests the chart makes.
    const others = [
      gridRequestOf(demo, { case: 'another value', view: { valueType: 'percent_change' } }),
      gridRequestOf(demo, {
        case: 'another pair',
        view: { valueType: 'raw', groupBy: 'ARM_SEX' },
        groups: ['Placebo F', 'Placebo M']
      }),
      request({}, { measures: measures.slice(0, 5) }),
      overTimeRequestOf(demo, {
        case: 'one biomarker over time',
        view: { valueType: 'raw' },
        test: 't',
        adjustment: 'none'
      }),
      requestOf(demo, { case: 'one panel', view: { valueType: 'raw' }, test: 't' })
    ];
    for (const asked of others) {
      const answer = await run(asked);
      expect(answer.status).toBe('unavailable');
      expect(answer.reason).toBe('not-precomputed');
    }
    // The recipe in the reference is the function the script runs, to the letter.
    const functionOf = (source) => {
      const from = source.indexOf('group_comparison_grid_key <- function(dfRows, lView) {');
      expect(from).toBeGreaterThan(-1);
      return source.slice(from, source.indexOf('\n}\n', from) + 3);
    };
    expect(functionOf(text('docs/group-comparison.md'))).toBe(
      functionOf(text('tools/r-group-statistics.R'))
    );
  });

  it('GC-GRID-011: each cell’s estimate in R’s one answer is the one R gives when that cell’s rows are asked about alone; the pair the other way round gives the same sizes with the other sign and each group’s count in the other place; and no row of any answer holds a p-value (#86)', () => {
    for (const result of fromR.grid) {
      const { rows } = result.value;
      const alone = result.separately;
      expect(
        rows.map((row) => row.biomarker),
        result.case
      ).toEqual(alone.biomarker);
      expect(
        rows.map((row) => row.by),
        result.case
      ).toEqual(alone.by);
      // In the order asked: biomarker by biomarker, and the visits within each.
      expect(rows.map((row) => `${row.biomarker}|${row.by}`)).toEqual(
        result.args.chrBiomarkers.flatMap((biomarker) =>
          result.args.chrBy.map((by) => `${biomarker}|${by}`)
        )
      );
      rows.forEach((row, index) => {
        expect(row.estimate, `${result.case} ${row.biomarker} ${row.by}`).toBe(
          alone.estimate[index]
        );
        expect(Object.keys(row)).toEqual([
          'biomarker',
          'by',
          'counts',
          'n_1',
          'n_2',
          'dropped',
          'estimate',
          'lower',
          'upper',
          'level',
          'status',
          'reason',
          'warning'
        ]);
        if (row.status === 'ok') {
          expect(Number.isFinite(row.estimate)).toBe(true);
          expect(row.lower).toBeLessThan(row.estimate);
          expect(row.upper).toBeGreaterThan(row.estimate);
          expect(row.level).toBe(0.95);
        } else {
          expect(['too_small', 'error']).toContain(row.status);
          expect([row.estimate, row.lower, row.upper, row.level]).toEqual([null, null, null, null]);
          expect(row.reason).toMatch(/\S/);
        }
      });
      // The first note names which way round the estimate is.
      const [first, second] = result.args.chrGroups;
      expect(result.value.notes[0]).toContain(`${first} - ${second}`);
      expect(result.value.p_value ?? null).toBeNull();
    }
    const forward = resultOf('grid-result').value.rows;
    const backward = resultOf('grid-result-reversed').value.rows;
    expect(forward).toHaveLength(60);
    forward.forEach((row, index) => {
      const mirror = backward[index];
      expect(Math.abs(mirror.estimate + row.estimate)).toBeLessThan(1e-12);
      expect([mirror.n_1, mirror.n_2]).toEqual([row.n_2, row.n_1]);
    });
  });
});

describe('the difference grid: what is printed', () => {
  it('GC-GRID-012: R’s answer becomes a cell for every row, each with the estimate as printed and the number its colour is read from, and one line that names the estimate and which way round it is, counts the cells computed and not, and says that no cell is a test; no p-value is in any of it (#86)', async () => {
    const scope = gridScope({ pair: ['Placebo', 'Treatment'], group: 'Arm', value: 'result' });
    const shown = describeGrid(answered('grid-result'), {
      grid: true,
      groups: ['Placebo', 'Treatment'],
      scope
    });
    expect(shown.state).toBe('shown');
    expect(shown.text).toBe(
      "Standardised difference (Hedges' g), Placebo minus Treatment, in each cell: 60 cells computed. " +
        'A description of each difference with its interval and its counts: no cell is a test, and the grid has no p-value.'
    );
    expect(shown.scope).toBe(scope);
    expect(shown.details).toEqual([]);
    expect(shown.cells).toHaveLength(60);
    const rows = resultOf('grid-result').value.rows;
    shown.cells.forEach((cell, index) => {
      // The number is R's, untouched; the figure is that number printed.
      expect(cell.number).toBe(rows[index].estimate);
      expect(cell.short).toBe(rows[index].estimate.toFixed(2).replace('-', '−'));
      expect([cell.biomarker, cell.by]).toEqual([rows[index].biomarker, rows[index].by]);
      expect(cell.status).toBe('shown');
    });
    // R's own notes are passed on as R wrote them.
    expect(JSON.stringify(shown.remarks)).toContain('Placebo - Treatment');
    // The desk waits, then describes the answer as a grid's when it is told the
    // answer is one; and an answer that arrives after the grid was drawn again
    // is dropped.
    const stored = createConnection({
      results: fromR.grid.map(({ name, args, dataId, rows: count, value }) => ({
        name,
        args,
        dataId,
        rows: count,
        value
      }))
    });
    const desk = createStatisticDesk({ connection: stored });
    const said = [];
    const asked = gridRequestOf(demo, caseOf('grid-result'));
    const context = { grid: true, groups: ['Placebo', 'Treatment'], scope };
    expect(await desk.begin().ask(asked, (description) => said.push(description), context)).toBe(
      true
    );
    expect(said[0]).toMatchObject({ state: 'waiting', text: 'Statistics: waiting for R…' });
    expect(said[0].cells ?? null).toBeNull();
    expect(said[1].cells).toHaveLength(60);
    expect(said[1].text).toBe(shown.text);
    const late = desk.begin().ask(asked, (description) => said.push(description), context);
    desk.begin();
    expect(await late).toBe(false);
    expect(said).toHaveLength(3);
    expect(said[2].state).toBe('waiting');

    // Some cells computed and some not: both are counted, and each cell R did
    // not compute gives R's reason with the counts.
    const some = describeGrid(answered('grid-age-40-to-43'), {
      grid: true,
      groups: ['Placebo', 'Treatment']
    });
    expect(some.state).toBe('shown');
    expect(some.text).toContain('in each cell: 34 cells computed, 26 cells not.');
    expect(some.details).toHaveLength(26);
    expect(some.details[0]).toBe(
      'CRP at Week 2: Not computed: Placebo has 4. The minimum group size is 5. Counts: Placebo n = 4, Treatment n = 6.'
    );
    expect(some.cells.filter((cell) => cell.status === 'withheld')).toHaveLength(26);
    expect(some.cells.filter((cell) => cell.number === null)).toHaveLength(26);

    // No cell computed: R's reason for the whole grid, and a cell for each row
    // with R's reason for it.
    const none = describeGrid(answered('grid-age-57'), {
      grid: true,
      groups: ['Placebo', 'Treatment']
    });
    expect(none.state).toBe('withheld');
    expect(none.text).toBe(
      'Not computed: every cell has a group below the minimum size. Each row gives its reason.'
    );
    expect(none.cells).toHaveLength(60);
    expect(none.cells.every((cell) => cell.status === 'withheld' && cell.short === null)).toBe(
      true
    );
    for (const said of [shown, some, none]) {
      expect(`${said.text} ${said.details.join(' ')}`).not.toMatch(/\bp\s*[=<>]|Exploratory/);
    }
  });

  it('GC-GRID-013: with no answer there is no cell: no R attached and no stored result say statistics are unavailable, R’s error is R’s message, and an answer with no row for any cell is refused; none of them is given a number (#86)', async () => {
    const asked = gridRequestOf(demo, caseOf('grid-result'));
    const context = { grid: true, groups: ['Placebo', 'Treatment'] };
    const none = await createConnection().run(asked.name, asked);
    const unavailable = describeGrid(none, context);
    expect(unavailable.state).toBe('unavailable');
    expect(unavailable.text).toBe('Statistics are unavailable: no R is attached to this chart.');
    expect(unavailable.cells).toBeNull();
    const notStored = await createConnection({ results: [] }).run(asked.name, asked);
    const missing = describeGrid(notStored, context);
    expect(missing.state).toBe('unavailable');
    expect(missing.text).toContain('the page holds no stored result for it');
    expect(missing.cells).toBeNull();
    const failed = describeGrid({ status: 'error', message: 'could not find function' }, context);
    expect(failed).toMatchObject({
      state: 'error',
      text: 'R reported an error: could not find function',
      cells: null
    });
    // R's own error for the whole answer, and an answer that holds no cell.
    expect(
      describeGrid(
        {
          status: 'ok',
          value: { status: 'error', reason: 'the group column is missing', rows: [] }
        },
        context
      )
    ).toMatchObject({
      state: 'error',
      text: 'R reported an error: the group column is missing',
      cells: null
    });
    expect(
      describeGrid({ status: 'ok', value: { status: 'ok', rows: [] } }, context)
    ).toMatchObject({
      state: 'refused',
      text: 'Differences not shown: the result has no row for any cell.',
      cells: null
    });
    // A baseline visit with no cell is named in what the cells cover.
    expect(
      gridScope({
        pair: ['Treatment F', 'Placebo F'],
        group: 'Arm and sex',
        untested: ['Baseline'],
        value: 'change from baseline',
        filters: [{ label: 'Age', values: ['40', '41'] }]
      })
    ).toBe(
      'Each cell compares Treatment F with Placebo F, two levels of Arm and sex, on the participants with a change from baseline of that biomarker at that visit. ' +
        'Baseline has no cell: it is the baseline visit, where the change from baseline is the same for everyone. ' +
        'Filters: Age is 40 or 41.'
    );
  });
});
