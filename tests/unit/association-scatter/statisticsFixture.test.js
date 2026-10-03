import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSOCIATION_STATISTICS,
  CASES,
  VIEW,
  deriveAssociationStatistics,
  readDemo,
  requestOf
} from '../../../scripts/association-statistics-lib.mjs';
import { STATISTICS, readRecord, sha256 } from '../../../scripts/vendor-lib.mjs';
import { createConnection } from '../../../src/r/index.js';
import { canonicalJson } from '../../../src/r/canonical.js';
import { TOLERANCE } from '../../../site/r-check/check.mjs';

// The expected results of the association scatter (#26), and the rows they were
// computed on. The rows are derived by the chart's own code and committed, so R
// reads them and works nothing out a second time; deriving them again here must
// give the committed files. What R wrote with each answer (the function, the
// arguments, the identity of the rows) is held to what the chart asks, so a
// stored result written by the recipe is one the chart finds.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (file) => readFileSync(path.join(ROOT, file));
const text = (file) => read(file).toString('utf8');
const sources = Object.fromEntries(
  Object.entries(ASSOCIATION_STATISTICS.sources).map(([name, file]) => [name, text(file)])
);
const demo = readDemo(sources);
const fromR = JSON.parse(text(ASSOCIATION_STATISTICS.expected));
const resultOf = (name) => fromR.results.find((result) => result.case === name);
const caseOf = (name) => CASES.find((entry) => entry.case === name);
const stored = (results) =>
  results.map(({ name, args, dataId, rows, value }) => ({ name, args, dataId, rows, value }));

describe('the rows R is run on', () => {
  it('AS-STAT-011: deriving each case’s rows again, with the chart’s own code from the demo’s own tables and settings, gives the committed files (#26)', () => {
    const { files, record } = deriveAssociationStatistics(sources);
    expect(files.map((entry) => entry.file)).toEqual([
      ...CASES.map((entry) => `${entry.case}.csv`),
      'cases.csv'
    ]);
    for (const { file, text: derived } of files) {
      expect(text(`${ASSOCIATION_STATISTICS.directory}/${file}`), file).toBe(derived);
    }
    // The folder holds those files and their record, and nothing left over.
    expect(readdirSync(path.join(ROOT, ASSOCIATION_STATISTICS.directory)).sort()).toEqual(
      [...files.map((entry) => entry.file), 'SOURCE.json'].sort()
    );
    const committed = JSON.parse(text(ASSOCIATION_STATISTICS.record));
    expect(committed.files).toEqual(record.files);
    expect(committed.cases).toEqual(record.cases);
    // The record names what the rows were derived from, by checksum.
    expect(committed.derived_from).toEqual(
      Object.values(ASSOCIATION_STATISTICS.sources).map((file) => ({
        file,
        sha256: sha256(read(file))
      }))
    );
  });

  it('AS-STAT-011: the rows are the chart’s: one per participant, the fields the chart hands R, the values the chart drew, and the demo’s settings read from the demo’s own script (#26)', () => {
    // The demo opens on the planted pair, coloured by arm, with a linear fit.
    expect(demo.settings).toMatchObject({
      x: { measure: 'TNF-alpha', visit: 'Baseline' },
      y: { measure: 'IL-10', visit: 'Baseline' },
      baseline_visits: 'Baseline',
      color_by: 'ARM',
      fit: 'linear'
    });
    // The view every case starts from is stated with the cases, whatever the
    // demo opens on: the planted pair with no colour.
    expect(VIEW).toMatchObject({
      x: { kind: 'measure', measure: 'TNF-alpha', value: 'raw', visit: 'Baseline' },
      y: { kind: 'measure', measure: 'IL-10', value: 'raw', visit: 'Baseline' },
      colorBy: '',
      xScale: 'linear',
      yScale: 'linear',
      filters: {}
    });
    expect(demo.tables.participants).toHaveLength(200);

    const pearson = requestOf(demo, caseOf('pearson'));
    expect(Object.keys(pearson.data[0])).toEqual(['USUBJID', 'x', 'y']);
    expect(new Set(pearson.data.map((row) => row.USUBJID)).size).toBe(200);
    const lines = text(`${ASSOCIATION_STATISTICS.directory}/pearson.csv`).trimEnd().split('\n');
    expect(lines[0]).toBe('USUBJID,x,y');
    expect(lines).toHaveLength(201);
    // A number is written as the text that reads back as exactly that number.
    lines.slice(1).forEach((line, index) => {
      const [id, x, y] = line.split(',');
      expect([id, Number(x), Number(y)]).toEqual([
        pearson.data[index].USUBJID,
        pearson.data[index].x,
        pearson.data[index].y
      ]);
    });
    // A view with a colour or a panel hands R that field too.
    expect(Object.keys(requestOf(demo, caseOf('pearson-by-arm')).data[0])).toEqual([
      'USUBJID',
      'x',
      'y',
      'color'
    ]);
    expect(Object.keys(requestOf(demo, caseOf('pearson-panel-women')).data[0])).toEqual([
      'USUBJID',
      'x',
      'y',
      'panel'
    ]);
    // On logarithmic axes the file holds the values the chart drew, which are
    // the core's and the same in every engine; what the chart hands R is their
    // base-10 logarithm, and the R script takes that logarithm itself.
    expect(text(`${ASSOCIATION_STATISTICS.directory}/pearson-log.csv`)).toBe(
      text(`${ASSOCIATION_STATISTICS.directory}/pearson-skewed.csv`)
    );
    const drawn = text(`${ASSOCIATION_STATISTICS.directory}/pearson-log.csv`)
      .trimEnd()
      .split('\n')
      .slice(1)
      .map((line) => line.split(','));
    const handed = requestOf(demo, caseOf('pearson-log')).data;
    expect(handed).toHaveLength(drawn.length);
    drawn.forEach(([id, x, y], index) => {
      expect(handed[index].USUBJID).toBe(id);
      expect(handed[index].x).toBe(Math.log10(Number(x)));
      expect(handed[index].y).toBe(Math.log10(Number(y)));
    });
    const script = text('tools/r-association-statistics.R');
    expect(script).toContain('if (identical(lView$x_scale, "log")) rows$x <- log10(rows$x)');
    expect(script).toContain('if (identical(lView$y_scale, "log")) rows$y <- log10(rows$y)');
    // One axis alone: only that column is a logarithm.
    const xOnly = requestOf(demo, caseOf('pearson-log-x')).data;
    expect(xOnly[0].x).toBe(Math.log10(Number(drawn[0][1])));
    expect(xOnly[0].y).toBe(Number(drawn[0][2]));
    // A coefficient and a line of the same view are asked on the same rows.
    expect(text(`${ASSOCIATION_STATISTICS.directory}/linear.csv`)).toBe(
      text(`${ASSOCIATION_STATISTICS.directory}/pearson.csv`)
    );
  });
});

describe('what desktop R answered, and the key it wrote', () => {
  it('AS-STAT-012: the expected results name the script, the R version and the vendored statistics file that made them, and hold one result per case (#26)', () => {
    const vendored = readRecord(path.join(ROOT, STATISTICS.directory));
    expect(fromR.made_by.script).toBe('tools/r-association-statistics.R');
    expect(fromR.made_by.r_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(fromR.made_by.platform).not.toBe('');
    expect(fromR.made_by.statistics_file).toBe('site/vendor/gsm.bio/statistics.R');
    // The copy of gsm.bio's statistics that is vendored now, not an earlier one.
    expect(fromR.made_by.statistics_commit).toBe(vendored.commit);
    expect(fromR.made_by.statistics_sha256).toBe(vendored.files[0].sha256);
    expect(fromR.made_by.statistics_sha256).toBe(
      sha256(read(`${STATISTICS.directory}/statistics.R`))
    );
    // The vendored file defines both functions the chart asks for.
    const statistics = text(`${STATISTICS.directory}/statistics.R`);
    expect(statistics).toMatch(/^Analyze_Correlation <- function\(/m);
    expect(statistics).toMatch(/^Analyze_Fit <- function\(/m);

    expect(fromR.results.map((result) => result.case)).toEqual(CASES.map((entry) => entry.case));
    for (const entry of CASES) {
      const { name, value } = resultOf(entry.case);
      expect(name, entry.case).toBe(entry.fit ? 'Analyze_Fit' : 'Analyze_Correlation');
      expect(value.test, entry.case).toBe(entry.fit || entry.method);
    }
    // Both coefficients, a coefficient per colour, a level and a view too small,
    // and both lines.
    expect(resultOf('pearson').value.estimates[0].name).toBe('cor');
    expect(resultOf('spearman').value.estimates[0].name).toBe('rho');
    expect(resultOf('pearson-by-arm').value.rows.map((row) => row.group)).toEqual([
      'Placebo',
      'Treatment'
    ]);
    expect(resultOf('pearson-age-57-by-arm').value.rows.map((row) => row.status)).toEqual([
      'ok',
      'too_small'
    ]);
    expect(resultOf('pearson-age-35').value.status).toBe('too_small');
    expect(resultOf('linear').value.estimates.map((row) => row.name)).toEqual([
      'Intercept',
      'Slope'
    ]);
    expect(resultOf('linear').value.rows).toHaveLength(50);
    expect(resultOf('smooth').value.rows).toHaveLength(50);
    expect(resultOf('linear-by-arm').value.rows).toHaveLength(150);
  });

  it('AS-STAT-013: for every case the function, the arguments, the identity and the row count R wrote by the recipe are the ones the chart asks with (#26)', () => {
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
  });

  it('AS-STAT-013: handed to a connection as stored results, each of R’s answers is found by the chart’s request for its panel, and by no other view’s (#26)', async () => {
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
    const at = (measure, visit, value = 'raw') => ({ kind: 'measure', measure, value, visit });
    const others = [
      { case: 'another visit', view: { x: at('TNF-alpha', 'Week 4') }, method: 'pearson' },
      { case: 'another value', view: { y: at('IL-10', 'Week 4', 'change') }, method: 'pearson' },
      { case: 'the axes swapped', view: { x: VIEW.y, y: VIEW.x }, method: 'pearson' },
      { case: 'another colour', view: { colorBy: 'SEX' }, method: 'pearson' },
      { case: 'another filter', view: { filters: { RESPONSE: 'Responder' } }, method: 'pearson' },
      { case: 'the other panel', view: { panelBy: 'SEX' }, panel: 'M', method: 'pearson' },
      { case: 'a logarithmic axis', view: { yScale: 'log' }, method: 'pearson' },
      { case: 'a line of another view', view: { filters: { SEX: 'F' } }, fit: 'linear' },
      { case: 'a smooth on logarithms', view: { xScale: 'log', yScale: 'log' }, fit: 'smooth' }
    ];
    for (const entry of others) {
      const answer = await run(requestOf(demo, entry));
      expect(answer.status, entry.case).toBe('unavailable');
      expect(answer.reason, entry.case).toBe('not-precomputed');
      expect(answer, entry.case).not.toHaveProperty('value');
    }
    // A result stored for the values themselves never answers for their
    // logarithms, nor the other way about: only one of the two is stored here.
    const one = createConnection({ results: stored([resultOf('pearson-skewed')]) });
    const logged = requestOf(demo, caseOf('pearson-log'));
    expect((await one.run(logged.name, logged)).status).toBe('unavailable');
    const linear = requestOf(demo, caseOf('pearson-skewed'));
    expect((await one.run(linear.name, linear)).status).toBe('ok');
    // And a stored result whose row count is not the panel's is refused.
    const short = await run({
      ...requestOf(demo, CASES[0]),
      data: requestOf(demo, CASES[0]).data.slice(1)
    });
    expect(short.status).toBe('unavailable');
  });

  it('AS-STAT-014: the correlation the study was planted with, 0.6, lies inside the interval R gives for the planted pair; and R’s Spearman coefficient is the same on logarithms as on the values (#26)', () => {
    const { value } = resultOf('pearson');
    const [coefficient] = value.estimates;
    expect(value.counts).toBe(200);
    expect(coefficient.level).toBe(0.95);
    expect(coefficient.lower).toBeLessThan(0.6);
    expect(coefficient.upper).toBeGreaterThan(0.6);
    expect(coefficient.lower).toBeLessThan(coefficient.estimate);
    expect(coefficient.estimate).toBeLessThan(coefficient.upper);
    // Within each arm as well: the pair was planted in every participant.
    for (const row of resultOf('pearson-by-arm').value.rows) {
      expect(row.lower, row.group).toBeLessThan(0.6);
      expect(row.upper, row.group).toBeGreaterThan(0.6);
    }
    // A linear fit's test of its slope is the test of Pearson's coefficient:
    // R gives the two the same p-value, each by its own function.
    const within = (a, b) =>
      Math.abs(a - b) <= TOLERANCE.relative * Math.max(Math.abs(a), Math.abs(b));
    expect(within(resultOf('linear').value.p_value, value.p_value)).toBe(true);

    // What the chart says of a logarithmic axis is true of R's own answers:
    // ranks do not change, and Pearson's coefficient does.
    const [rank, rankOfLogs] = ['spearman-skewed', 'spearman-log'].map(
      (name) => resultOf(name).value
    );
    expect(rankOfLogs.estimates[0].estimate).toBe(rank.estimates[0].estimate);
    expect(rankOfLogs.p_value).toBe(rank.p_value);
    expect(resultOf('pearson-log').value.estimates[0].estimate).not.toBe(
      resultOf('pearson-skewed').value.estimates[0].estimate
    );
  });

  it('AS-STAT-022: the recipe run on a data frame with a panel column that holds numbers writes the identity as text, as the chart asks with (#49)', () => {
    const recipe = (fromR.recipes || []).find((entry) => entry.case === 'numeric-panel');
    expect(recipe, 'the recipe case is in the fixture').toBeTruthy();
    // The first case's key is held to the chart's own request above; the recipe
    // case differs from it only in the member that held a number.
    const first = fromR.results[0];
    const expected = { ...first.dataId, panel_by: 'COHORT', panel: '2' };
    expect(recipe.dataId).toEqual(expected);
    expect(recipe.args).toEqual(first.args);
    expect(recipe.name).toBe(first.name);
  });
});
