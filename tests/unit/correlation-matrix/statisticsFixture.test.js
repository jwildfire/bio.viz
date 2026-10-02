import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CASES,
  MATRIX_STATISTICS,
  VIEW,
  deriveMatrixStatistics,
  readDemo,
  requestOf,
  stateOf,
  variablesOf
} from '../../../scripts/matrix-statistics-lib.mjs';
import { STATISTICS, readRecord, sha256 } from '../../../scripts/vendor-lib.mjs';
import { createConnection } from '../../../src/r/index.js';
import { canonicalJson } from '../../../src/r/canonical.js';

// The expected results of the correlation matrix (#27), and the frames they
// were computed on. The frames are derived by the chart's own code and
// committed, so R reads them and works nothing out a second time; deriving them
// again here must give the committed files. What R wrote with each answer (the
// function, the arguments, the identity of the frame) is held to what the chart
// asks, so a stored result written by the recipe is one the chart finds.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (file) => readFileSync(path.join(ROOT, file));
const text = (file) => read(file).toString('utf8');
const sources = Object.fromEntries(
  Object.entries(MATRIX_STATISTICS.sources).map(([name, file]) => [name, text(file)])
);
const demo = readDemo(sources);
const fromR = JSON.parse(text(MATRIX_STATISTICS.expected));
const resultOf = (name) => fromR.results.find((result) => result.case === name);
const caseOf = (name) => CASES.find((entry) => entry.case === name);
const stored = (results) =>
  results.map(({ name, args, dataId, rows, value }) => ({ name, args, dataId, rows, value }));
const frameOf = (name) =>
  text(`${MATRIX_STATISTICS.directory}/${name}.csv`)
    .trimEnd()
    .split('\n')
    .map((line) => line.split(','));

describe('the frames R is run on', () => {
  it('CM-STAT-010: deriving each case’s frame again, with the chart’s own code from the demo’s own tables and settings, gives the committed files (#27)', () => {
    const { files, record } = deriveMatrixStatistics(sources);
    expect(files.map((entry) => entry.file)).toEqual([
      ...CASES.map((entry) => `${entry.case}.csv`),
      'cases.csv'
    ]);
    for (const { file, text: derived } of files) {
      expect(text(`${MATRIX_STATISTICS.directory}/${file}`), file).toBe(derived);
    }
    // The folder holds those files and their record, and nothing left over.
    expect(readdirSync(path.join(ROOT, MATRIX_STATISTICS.directory)).sort()).toEqual(
      [...files.map((entry) => entry.file), 'SOURCE.json'].sort()
    );
    const committed = JSON.parse(text(MATRIX_STATISTICS.record));
    expect(committed.files).toEqual(record.files);
    expect(committed.cases).toEqual(record.cases);
    // The record names what the frames were derived from, by checksum.
    expect(committed.derived_from).toEqual(
      Object.values(MATRIX_STATISTICS.sources).map((file) => ({ file, sha256: sha256(read(file)) }))
    );
  });

  it('CM-STAT-010: a frame is the chart’s: one row per participant, the id and one column per variable of the grid, a gap an empty cell, and the demo’s settings read from the demo’s own script (#27)', () => {
    // The demo names neither a mode, a visit nor a biomarker: it opens on
    // every biomarker the limit allows at the first visit.
    expect(demo.settings.baseline_visits).toBe('Baseline');
    for (const key of ['mode', 'visit', 'biomarkers', 'measure', 'visits', 'limit', 'min_pairs']) {
      expect(key in demo.settings, key).toBe(false);
    }
    // The view every case starts from is stated with the cases.
    expect(VIEW).toMatchObject({
      mode: 'biomarkers',
      visit: 'Baseline',
      biomarkers: null,
      valueType: 'raw',
      method: 'pearson',
      minPairs: null,
      filters: {}
    });
    expect(demo.tables.participants).toHaveLength(200);

    const opening = requestOf(demo, caseOf('biomarkers-baseline'));
    const columns = ['USUBJID', ...Array.from({ length: 12 }, (_, index) => `v${index + 1}`)];
    expect(Object.keys(opening.data[0])).toEqual(columns);
    const [header, ...lines] = frameOf('biomarkers-baseline');
    expect(header).toEqual(columns);
    expect(lines).toHaveLength(200);
    // A number is written as the text that reads back as exactly that number.
    lines.forEach((cells, index) => {
      expect([cells[0], ...cells.slice(1).map(Number)]).toEqual(
        columns.map((column) => opening.data[index][column])
      );
    });
    // A value a participant does not have is an empty cell, and null in what R is handed.
    const gaps = requestOf(demo, caseOf('biomarkers-week-4-change'));
    const [, ...changed] = frameOf('biomarkers-week-4-change');
    expect(changed).toHaveLength(187);
    expect(changed[0][2]).toBe('');
    expect(gaps.data[0].v2).toBe(null);
    changed.forEach((cells, index) => {
      cells.slice(1).forEach((cell, at) => {
        const value = gaps.data[index][columns[at + 1]];
        expect(cell === '' ? null : Number(cell)).toBe(value);
      });
    });
    // No row of a frame is empty: a participant with none of the values is left out.
    for (const entry of CASES) {
      const [, ...rows] = frameOf(entry.case);
      expect(
        rows.every((cells) => cells.slice(1).some((cell) => cell !== '')),
        entry.case
      ).toBe(true);
    }
    // The grid's variables in each mode, by the names R is handed them under.
    expect(variablesOf(demo, caseOf('six-biomarkers'))).toEqual(
      ['CRP', 'IFN-gamma', 'IL-2', 'IL-6', 'IL-10', 'TNF-alpha'].map((label, index) => ({
        name: `v${index + 1}`,
        label
      }))
    );
    expect(variablesOf(demo, caseOf('visits-il-6-change')).map((entry) => entry.label)).toEqual([
      'Week 2',
      'Week 4',
      'Week 8',
      'Week 12'
    ]);
    expect(stateOf(caseOf('week-12-minimum-183'))).toMatchObject({
      visit: 'Week 12',
      minPairs: 183
    });
  });
});

describe('what desktop R answered, and the key it wrote', () => {
  it('CM-STAT-011: the expected results name the script, the R version and the vendored statistics file that made them, hold one result per case in both modes and both methods, and no p-value (#27)', () => {
    const vendored = readRecord(path.join(ROOT, STATISTICS.directory));
    expect(fromR.made_by.script).toBe('tools/r-matrix-statistics.R');
    expect(fromR.made_by.r_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(fromR.made_by.platform).not.toBe('');
    expect(fromR.made_by.statistics_file).toBe('site/vendor/gsm.bio/statistics.R');
    // The copy of gsm.bio's statistics that is vendored now, not an earlier one.
    expect(fromR.made_by.statistics_commit).toBe(vendored.commit);
    expect(fromR.made_by.statistics_sha256).toBe(vendored.files[0].sha256);
    expect(fromR.made_by.statistics_sha256).toBe(
      sha256(read(`${STATISTICS.directory}/statistics.R`))
    );
    // The vendored file defines the function the chart asks for, with the
    // arguments the chart sends and a minimum of its own.
    const statistics = text(`${STATISTICS.directory}/statistics.R`);
    expect(statistics).toMatch(
      /^Analyze_CorrelationMatrix <- function\(dfData, chrCols, strMethod = "pearson", nConfLevel = 0\.95,\s*nMinPairs = nMinGroupDefault\)/m
    );
    expect(statistics).toMatch(/^nMinGroupDefault <- 5L?$/m);
    // The script sources that file and nothing else that computes.
    const script = text('tools/r-matrix-statistics.R');
    expect(script).toContain('source(file.path(vendored, "statistics.R"))');
    expect(script).not.toMatch(/\bcor\(|cor\.test\(|library\(|require\(/);

    expect(fromR.results.map((result) => result.case)).toEqual(CASES.map((entry) => entry.case));
    for (const entry of CASES) {
      const { name, value } = resultOf(entry.case);
      const state = stateOf(entry);
      expect(name, entry.case).toBe('Analyze_CorrelationMatrix');
      expect(value.test, entry.case).toBe(state.method);
      // One row per pair of the grid's variables.
      const count = variablesOf(demo, entry).length;
      expect(value.rows, entry.case).toHaveLength((count * (count - 1)) / 2);
      // No p-value, in the result or in any row of it.
      expect(value.p_value, entry.case).toBe(null);
      for (const row of value.rows) {
        expect(Object.keys(row), entry.case).toEqual([
          'x',
          'y',
          'counts',
          'estimate',
          'lower',
          'upper',
          'level',
          'status',
          'reason',
          'warning'
        ]);
      }
      expect(value.notes[0], entry.case).toMatch(/^No p-values: /);
    }
    // Both modes and both methods.
    const modes = CASES.map((entry) => `${stateOf(entry).mode} ${stateOf(entry).method}`);
    expect(new Set(modes)).toEqual(
      new Set(['biomarkers pearson', 'biomarkers spearman', 'visits pearson', 'visits spearman'])
    );
    // Spearman: a coefficient in every cell and an interval in none.
    for (const row of resultOf('biomarkers-baseline-spearman').value.rows) {
      expect(typeof row.estimate).toBe('number');
      expect([row.lower, row.upper, row.level]).toEqual([null, null, null]);
    }
    // With gaps, the cells' counts differ, and each is the complete pairs of its two columns.
    const gaps = resultOf('biomarkers-week-4-change');
    const counts = gaps.value.rows.map((row) => row.counts);
    expect(new Set(counts).size).toBeGreaterThan(1);
    const { data } = requestOf(demo, caseOf('biomarkers-week-4-change'));
    for (const row of gaps.value.rows) {
      const both = data.filter((record) => record[row.x] !== null && record[row.y] !== null);
      expect(row.counts, `${row.x} ${row.y}`).toBe(both.length);
    }
    expect(Math.max(...counts)).toBeLessThanOrEqual(187);
    // A minimum some cells fall under: R declines those and answers the rest.
    const some = resultOf('week-12-minimum-183');
    expect(some.args.nMinPairs).toBe(183);
    expect(some.value.status).toBe('ok');
    const declined = some.value.rows.filter((row) => row.status === 'too_small');
    expect(declined).toHaveLength(51);
    for (const row of some.value.rows) {
      if (row.counts < 183) {
        expect(row).toMatchObject({
          status: 'too_small',
          estimate: null,
          lower: null,
          upper: null,
          reason: `Not computed: ${row.counts} complete pairs. The minimum is 183.`
        });
      } else {
        expect(row.status).toBe('ok');
        expect(typeof row.estimate).toBe('number');
      }
    }
    // And a view where every cell does.
    const none = resultOf('age-35');
    expect('nMinPairs' in none.args).toBe(false);
    expect(none.value.status).toBe('too_small');
    expect(none.value.reason).toBe('Not computed: no pair of columns has 5 complete pairs.');
    expect(none.value.rows.every((row) => row.estimate === null && row.counts === 4)).toBe(true);
  });

  it('CM-STAT-009: for every case the function, the arguments, the identity and the row count R wrote by the recipe are the ones the chart asks with, and the recipe in the reference is the script’s (#27)', () => {
    for (const entry of CASES) {
      const asked = requestOf(demo, entry);
      const written = resultOf(entry.case);
      expect(written.name, entry.case).toBe(asked.name);
      expect(written.args, entry.case).toEqual(asked.args);
      expect(written.dataId, entry.case).toEqual(asked.dataId);
      expect(written.rows, entry.case).toBe(asked.rows);
      // As the connection compares them: the same canonical text.
      expect(canonicalJson(written.dataId), entry.case).toBe(canonicalJson(asked.dataId));
      expect(canonicalJson(written.args), entry.case).toBe(canonicalJson(asked.args));
    }
    // The function a reader copies from the reference is the one that wrote these.
    const code = (source) =>
      source
        .split('\n')
        .map((line) => line.replace(/\s+#.*$/, '').trimEnd())
        .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
        .join('\n');
    const recipe = (source) =>
      code(source.slice(source.indexOf('correlation_matrix_key <- function'))).split('\n}\n')[0];
    const inScript = recipe(text('tools/r-matrix-statistics.R'));
    expect(inScript).toContain('lDataId <- list(chart = "correlation-matrix"');
    expect(recipe(text('docs/correlation-matrix.md'))).toBe(inScript);
  });

  it('CM-STAT-009: handed to a connection as stored results, each of R’s answers is found by the chart’s request for its view, and by no other view’s (#27)', async () => {
    const connection = createConnection({ results: stored(fromR.results) });
    const run = ({ name, data, args, dataId }) => connection.run(name, { data, args, dataId });
    for (const result of fromR.results) {
      expect(await run(requestOf(demo, caseOf(result.case))), result.case).toEqual({
        status: 'ok',
        value: result.value,
        form: 'precomputed'
      });
    }
    // A view that was not stored is unavailable. It is never answered with a
    // neighbouring view's numbers, however near it is.
    const others = [
      { case: 'another visit', view: { visit: 'Week 8' } },
      { case: 'another value', view: { valueType: 'baseline' } },
      { case: 'other biomarkers', view: { biomarkers: ['CRP', 'IL-6', 'IL-10'] } },
      { case: 'another filter', view: { filters: { RESPONSE: 'Responder' } } },
      { case: 'another biomarker across visits', view: { mode: 'visits', measure: 'CRP' } },
      { case: 'another minimum', view: { visit: 'Week 12', minPairs: 150 } },
      { case: 'a minimum where none was stored', view: { minPairs: 5 } },
      { case: 'the other method', view: { mode: 'visits', method: 'spearman' } }
    ];
    for (const entry of others) {
      const answer = await run(requestOf(demo, entry));
      expect(answer.status, entry.case).toBe('unavailable');
      expect(answer.reason, entry.case).toBe('not-precomputed');
      expect(answer, entry.case).not.toHaveProperty('value');
    }
    // A stored result whose row count is not the frame's is refused.
    const whole = requestOf(demo, CASES[0]);
    expect((await run({ ...whole, data: whole.data.slice(1) })).status).toBe('unavailable');
  });

  it('CM-STAT-012: in desktop R’s grid of every biomarker at Baseline the planted pair’s cell, TNF-alpha with IL-10, holds 0.6 inside its interval, on all 200 participants (#27)', () => {
    const entry = caseOf('biomarkers-baseline');
    const variables = variablesOf(demo, entry);
    const nameOf = (label) => variables.find((variable) => variable.label === label).name;
    const [tnf, il10] = [nameOf('TNF-alpha'), nameOf('IL-10')];
    expect([il10, tnf]).toEqual(['v9', 'v11']);
    const { value } = resultOf('biomarkers-baseline');
    const cells = value.rows.filter(
      (row) => [row.x, row.y].includes(tnf) && [row.x, row.y].includes(il10)
    );
    // One row for the pair: the grid's two cells are the one answer.
    expect(cells).toHaveLength(1);
    const [cell] = cells;
    expect(cell.status).toBe('ok');
    expect(cell.counts).toBe(200);
    expect(cell.level).toBe(0.95);
    expect(cell.lower).toBeLessThan(0.6);
    expect(cell.upper).toBeGreaterThan(0.6);
    expect(cell.lower).toBeLessThan(cell.estimate);
    expect(cell.estimate).toBeLessThan(cell.upper);
    // It is the one pair the study was planted with: no other cell's interval
    // lies wholly above 0.3.
    const strong = value.rows.filter((row) => row.lower > 0.3);
    expect(strong).toEqual([cell]);
    // The same pair on the same 200 rows is the association scatter's coefficient.
    const scatter = JSON.parse(text('tests/fixtures/association-statistics-r.json')).results.find(
      (result) => result.case === 'pearson'
    ).value.estimates[0];
    expect(cell.estimate).toBe(scatter.estimate);
    expect([cell.lower, cell.upper]).toEqual([scatter.lower, scatter.upper]);
  });
});
