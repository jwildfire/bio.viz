import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CASES,
  SCREEN_STATISTICS,
  VIEW,
  deriveScreenStatistics,
  readDemo,
  requestOf,
  rowsOfCase,
  stateOf
} from '../../../scripts/screen-statistics-lib.mjs';
import { STATISTICS, readRecord, sha256 } from '../../../scripts/vendor-lib.mjs';
import { createConnection } from '../../../src/r/index.js';
import { canonicalJson } from '../../../src/r/canonical.js';

// The expected results of the biomarker screen (#36), and the frames they were
// computed on. The frames are derived by the chart's own code and committed, so
// R reads them and works nothing out a second time; deriving them again here
// must give the committed files. What R wrote with each answer is held to what
// the chart asks, so a stored result written by the recipe is one the chart finds.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (file) => readFileSync(path.join(ROOT, file));
const text = (file) => read(file).toString('utf8');
const sources = Object.fromEntries(
  Object.entries(SCREEN_STATISTICS.sources).map(([name, file]) => [name, text(file)])
);
const demo = readDemo(sources);
const fromR = JSON.parse(text(SCREEN_STATISTICS.expected));
const resultOf = (name) => fromR.results.find((result) => result.case === name);
const caseOf = (name) => CASES.find((entry) => entry.case === name);
const stored = (results) =>
  results.map(({ name, args, dataId, rows, value }) => ({ name, args, dataId, rows, value }));
const top = (name) =>
  [...resultOf(name).value.rows].sort(
    (a, b) => (b.estimate ?? -Infinity) - (a.estimate ?? -Infinity)
  )[0];

describe('the frames R is run on', () => {
  it('BS-STAT-010: deriving each case’s frame again, with the chart’s own code from the demo’s own tables and settings, gives the committed files (#36)', () => {
    const { files, record } = deriveScreenStatistics(sources);
    expect(files.map((entry) => entry.file)).toEqual([
      ...CASES.map((entry) => `${entry.case}.csv`),
      'cases.csv'
    ]);
    for (const { file, text: derived } of files) {
      expect(text(`${SCREEN_STATISTICS.directory}/${file}`), file).toBe(derived);
    }
    expect(readdirSync(path.join(ROOT, SCREEN_STATISTICS.directory)).sort()).toEqual(
      [...files.map((entry) => entry.file), 'SOURCE.json'].sort()
    );
    const committed = JSON.parse(text(SCREEN_STATISTICS.record));
    expect(committed.files).toEqual(record.files);
    expect(committed.cases).toEqual(record.cases);
    expect(committed.derived_from).toEqual(
      Object.values(SCREEN_STATISTICS.sources).map((file) => ({ file, sha256: sha256(read(file)) }))
    );
  });

  it('BS-STAT-010: a frame is the chart’s: the id, one column per biomarker named by it, the column of groups or the variable, a gap an empty cell; and the demo’s settings read from its own script (#36)', () => {
    // The demo opens on the planted difference.
    expect(demo.settings).toMatchObject({
      comparison: 'difference',
      visit: 'Week 4',
      value_type: 'change',
      group_by: 'ARM',
      baseline_visits: 'Baseline'
    });
    expect(VIEW).toMatchObject({
      comparison: 'difference',
      visit: 'Week 4',
      valueType: 'change',
      groupBy: 'ARM',
      adjustment: 'BH',
      filters: {}
    });
    expect(stateOf(demo, CASES[0]).levels).toEqual(['Placebo', 'Treatment']);
    const opening = requestOf(demo, CASES[0]);
    const lines = text(`${SCREEN_STATISTICS.directory}/difference-week-4-change.csv`)
      .trimEnd()
      .split('\n')
      .map((line) => line.split(','));
    const columns = ['USUBJID', ...opening.args.chrCols, 'ARM'];
    expect(lines[0]).toEqual(columns);
    expect(lines).toHaveLength(opening.rows + 1);
    lines.slice(1).forEach((cells, index) => {
      cells.forEach((cell, at) => {
        const value = opening.data[index][columns[at]];
        const read =
          at === 0 || at === columns.length - 1 ? cell : cell === '' ? null : Number(cell);
        expect(read).toBe(value);
      });
    });
    const against = text(`${SCREEN_STATISTICS.directory}/correlation-il-10.csv`).split('\n')[0];
    expect(against.endsWith(',TNF-alpha,VEGF,IL-10 at Baseline')).toBe(true);
    expect(rowsOfCase(demo, caseOf('correlation-il-10'))).not.toContain('IL-10');
  });
});

describe('what desktop R answered, and the key it wrote', () => {
  it('BS-STAT-011: the expected results name the script, the R version and the vendored statistics file, and hold one result per case, both comparisons and both adjustments, rows R could not compute left out of the adjustment (#36)', () => {
    const vendored = readRecord(path.join(ROOT, STATISTICS.directory));
    expect(fromR.made_by).toMatchObject({
      script: 'tools/r-screen-statistics.R',
      statistics_file: 'site/vendor/gsm.bio/statistics.R',
      statistics_commit: vendored.commit,
      statistics_sha256: vendored.files[0].sha256
    });
    expect(fromR.made_by.r_version).toMatch(/^\d+\.\d+\.\d+$/);
    const statistics = text(`${STATISTICS.directory}/statistics.R`);
    expect(statistics).toMatch(
      /^Analyze_Screen <- function\(dfData, chrCols, strComparison = "difference"/m
    );
    const script = text('tools/r-screen-statistics.R');
    expect(script).toContain('source(file.path(vendored, "statistics.R"))');
    expect(script).not.toMatch(/\bt\.test\(|cor\.test\(|p\.adjust\(|library\(|require\(/);

    expect(fromR.results.map((result) => result.case)).toEqual(CASES.map((entry) => entry.case));
    const seen = new Set();
    for (const entry of CASES) {
      const { name, value, args } = resultOf(entry.case);
      expect(name).toBe('Analyze_Screen');
      expect(value.test).toBe(args.strComparison);
      expect(value.p_value, entry.case).toBe(null);
      expect(
        value.rows.map((row) => row.biomarker),
        entry.case
      ).toEqual(args.chrCols);
      seen.add(`${args.strComparison} ${args.strPAdjust}`);
      // A row is adjusted across the rows that have a p-value, and only those.
      const tested = value.rows.filter((row) => row.p_unadjusted !== null);
      for (const row of value.rows) {
        expect(row.adjusted_over, entry.case).toBe(
          row.p_unadjusted === null ? null : tested.length
        );
        expect(row.adjustment).toBe(args.strPAdjust);
      }
    }
    expect(seen).toEqual(
      new Set([
        'difference BH',
        'difference holm',
        'correlation BH',
        'correlation holm',
        'hazard BH',
        'hazard holm'
      ])
    );
    // Holm is never less than Benjamini-Hochberg for the same p-values.
    const [bh, holm] = ['difference-week-4-change', 'difference-week-4-change-holm'].map(
      (name) => resultOf(name).value.rows
    );
    bh.forEach((row, index) => {
      expect(holm[index].p_unadjusted).toBe(row.p_unadjusted);
      expect(holm[index].p_value).toBeGreaterThanOrEqual(row.p_value);
    });
    // Every row of the four aged 35 has a group too small, and none is adjusted.
    const small = resultOf('difference-age-35').value;
    expect(small.status).toBe('too_small');
    expect(
      small.rows.every((row) => row.status === 'too_small' && row.adjusted_over === null)
    ).toBe(true);
    // Spearman: no interval in any row.
    expect(
      resultOf('correlation-il-10-spearman').value.rows.every((row) => row.lower === null)
    ).toBe(true);
  });

  it('BS-STAT-009: for every case the function, the arguments, the identity and the row count R wrote by the recipe are the ones the chart asks with, and the recipe in the reference is the script’s (#36)', () => {
    for (const entry of CASES) {
      const asked = requestOf(demo, entry);
      const written = resultOf(entry.case);
      expect(written.name, entry.case).toBe(asked.name);
      expect(written.args, entry.case).toEqual(asked.args);
      expect(written.dataId, entry.case).toEqual(asked.dataId);
      expect(written.rows, entry.case).toBe(asked.rows);
      expect(canonicalJson(written.dataId)).toBe(canonicalJson(asked.dataId));
      expect(canonicalJson(written.args)).toBe(canonicalJson(asked.args));
    }
    const code = (source) =>
      source
        .split('\n')
        .map((line) => line.replace(/\s+#.*$/, '').trimEnd())
        .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
        .join('\n');
    const recipe = (source) =>
      code(source.slice(source.indexOf('biomarker_screen_key <- function'))).split('\n}\n')[0];
    const inScript = recipe(text('tools/r-screen-statistics.R'));
    expect(inScript).toContain('lDataId <- list(chart = "biomarker-screen"');
    expect(recipe(text('docs/biomarker-screen.md'))).toBe(inScript);
  });

  it('BS-STAT-009: handed to a connection as stored results, each of R’s answers is found by the chart’s request for its view, and by no other view’s (#36)', async () => {
    const connection = createConnection({ results: stored(fromR.results) });
    const run = ({ name, data, args, dataId }) => connection.run(name, { data, args, dataId });
    for (const result of fromR.results) {
      expect(await run(requestOf(demo, caseOf(result.case))), result.case).toEqual({
        status: 'ok',
        value: result.value,
        form: 'precomputed'
      });
    }
    for (const view of [
      { visit: 'Week 8' },
      { levels: ['Treatment', 'Placebo'] },
      { groupBy: 'RESPONSE' },
      { filters: { SEX: 'M' } },
      {
        comparison: 'correlation',
        visit: 'Baseline',
        valueType: 'raw',
        with: { measure: 'IL-6', visit: 'Baseline' }
      },
      { comparison: 'correlation', with: { col: 'BMIBL' } },
      { comparison: 'correlation', with: { col: 'AGE' }, method: 'spearman' }
    ]) {
      const answer = await run(requestOf(demo, { case: 'other', view }));
      expect(answer.status, JSON.stringify(view)).toBe('unavailable');
      expect(answer).not.toHaveProperty('value');
    }
  });

  it('BS-STAT-012: in desktop R the planted biomarkers are the top rows, and a row’s statistic is the one the matching single chart’s own expected results hold (#36)', () => {
    // IL-6's change from Baseline to Week 4 between the arms tops the difference.
    expect(top('difference-week-4-change')).toMatchObject({ biomarker: 'IL-6', status: 'ok' });
    expect(top('difference-week-4-change-holm').biomarker).toBe('IL-6');
    expect(top('difference-week-4-change-women').biomarker).toBe('IL-6');
    // At Baseline, before treatment, nothing was planted: IL-6 is not on top.
    expect(top('difference-baseline').biomarker).not.toBe('IL-6');
    // TNF-alpha tops the correlation with IL-10 at Baseline, with 0.6 inside its interval.
    const tnf = top('correlation-il-10');
    expect(tnf).toMatchObject({ biomarker: 'TNF-alpha', counts: 200 });
    expect(tnf.lower).toBeLessThan(0.6);
    expect(tnf.upper).toBeGreaterThan(0.6);
    expect(top('correlation-il-10-spearman').biomarker).toBe('TNF-alpha');

    // The group comparison's Welch test of IL-6's change to Week 4 between the
    // arms, in that chart's own expected results, is the row's unadjusted p-value.
    const groups = JSON.parse(text('tests/fixtures/group-statistics-r.json')).results;
    const welch = (name) => groups.find((result) => result.case === name).value;
    const row = (name, biomarker) =>
      resultOf(name).value.rows.find((entry) => entry.biomarker === biomarker);
    expect(row('difference-week-4-change', 'IL-6').p_unadjusted).toBe(welch('welch').p_value);
    expect(row('difference-week-4-change', 'IL-6').method).toBe(welch('welch').method);
    expect(row('difference-week-4-change-women', 'IL-6').p_unadjusted).toBe(
      welch('welch-women').p_value
    );
    expect(row('difference-baseline', 'IL-6').p_unadjusted).toBe(welch('result-baseline').p_value);
    // The association scatter's Pearson coefficient of the planted pair is the row's.
    const pair = JSON.parse(text('tests/fixtures/association-statistics-r.json')).results.find(
      (result) => result.case === 'pearson'
    ).value;
    expect(tnf.estimate).toBe(pair.estimates[0].estimate);
    expect([tnf.lower, tnf.upper]).toEqual([pair.estimates[0].lower, pair.estimates[0].upper]);
    expect(tnf.p_unadjusted).toBe(pair.p_value);
  });

  it('BS-STAT-014: the recipe run on a data frame with a visit column that holds numbers writes the identity as text, as the chart asks with (#49)', () => {
    const recipe = (fromR.recipes || []).find((entry) => entry.case === 'numeric-visit');
    expect(recipe, 'the recipe case is in the fixture').toBeTruthy();
    // The first case's key is held to the chart's own request above; the recipe
    // case differs from it only in the member that held a number.
    const first = fromR.results[0];
    const expected = { ...first.dataId, visit: '4' };
    expect(recipe.dataId).toEqual(expected);
    expect(recipe.args).toEqual(first.args);
    expect(recipe.name).toBe(first.name);
  });
});
