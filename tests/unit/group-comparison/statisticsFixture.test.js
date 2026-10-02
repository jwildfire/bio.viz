import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CASES,
  GROUP_STATISTICS,
  VIEW,
  deriveGroupStatistics,
  readDemo,
  requestOf
} from '../../../scripts/group-statistics-lib.mjs';
import { STATISTICS, readRecord, sha256 } from '../../../scripts/vendor-lib.mjs';
import { createConnection } from '../../../src/r/index.js';
import { canonicalJson } from '../../../src/r/canonical.js';

// The expected results of the statistics line (#16), and the rows they were
// computed on. The rows are derived by the chart's own code and committed, so R
// reads them and works nothing out a second time; deriving them again here must
// give the committed files. What R wrote with each answer (the function, the
// arguments, the identity of the rows) is held to what the chart asks, so a
// stored result written by the recipe is one the chart finds.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (file) => readFileSync(path.join(ROOT, file));
const text = (file) => read(file).toString('utf8');
const sources = Object.fromEntries(
  Object.entries(GROUP_STATISTICS.sources).map(([name, file]) => [name, text(file)])
);
const demo = readDemo(sources);
const fromR = JSON.parse(text(GROUP_STATISTICS.expected));
const resultOf = (name) => fromR.results.find((result) => result.case === name);

describe('the rows R is run on', () => {
  it('GC-STAT-021: deriving each case’s rows again, with the chart’s own code from the demo’s own tables and settings, gives the committed files (#16)', () => {
    const { files, record } = deriveGroupStatistics(sources);
    expect(files.map((entry) => entry.file)).toEqual([
      ...CASES.map((entry) => `${entry.case}.csv`),
      'cases.csv'
    ]);
    for (const { file, text: derived } of files) {
      expect(text(`${GROUP_STATISTICS.directory}/${file}`), file).toBe(derived);
    }
    // The folder holds those files and their record, and nothing left over.
    expect(readdirSync(path.join(ROOT, GROUP_STATISTICS.directory)).sort()).toEqual(
      [...files.map((entry) => entry.file), 'SOURCE.json'].sort()
    );
    const committed = JSON.parse(text(GROUP_STATISTICS.record));
    expect(committed.files).toEqual(record.files);
    expect(committed.cases).toEqual(record.cases);
    // The record names what the rows were derived from, by checksum.
    expect(committed.derived_from).toEqual(
      Object.values(GROUP_STATISTICS.sources).map((file) => ({ file, sha256: sha256(read(file)) }))
    );
  });

  it('GC-STAT-021: the rows are the chart’s: one per participant, the fields the chart hands R, and the demo’s settings read from the demo’s own script (#16)', () => {
    // The demo's settings give the baseline and the groups; the view of every
    // case is stated with the cases, whatever the demo opens on.
    expect(demo.settings.baseline_visits).toBe('Baseline');
    expect(demo.settings.groups.map((group) => group.value_col)).toContain('ARM_SEX');
    expect(VIEW).toMatchObject({
      measure: 'IL-6',
      visits: ['Week 4'],
      valueType: 'change',
      groupBy: 'ARM',
      filters: {}
    });
    expect(demo.tables.participants).toHaveLength(200);
    expect(demo.tables.participants[0].ARM_SEX).toBe('Placebo F');

    const welch = requestOf(demo, CASES[0]);
    expect(Object.keys(welch.data[0])).toEqual(['USUBJID', 'y', 'x']);
    expect(new Set(welch.data.map((row) => row.USUBJID)).size).toBe(186);
    const lines = text(`${GROUP_STATISTICS.directory}/welch.csv`).trimEnd().split('\n');
    expect(lines[0]).toBe('USUBJID,y,x');
    expect(lines).toHaveLength(187);
    // A number is written as the text that reads back as exactly that number.
    lines.slice(1).forEach((line, index) => {
      const [id, y, x] = line.split(',');
      expect([id, Number(y), x]).toEqual([
        welch.data[index].USUBJID,
        welch.data[index].y,
        welch.data[index].x
      ]);
    });
    // A view with a colour or a panel hands R that field too.
    const colour = CASES.find((entry) => entry.case === 'welch-colour');
    expect(Object.keys(requestOf(demo, colour).data[0])).toEqual(['USUBJID', 'y', 'x', 'color']);
    const panel = CASES.find((entry) => entry.case === 'welch-panel-women');
    expect(Object.keys(requestOf(demo, panel).data[0])).toEqual(['USUBJID', 'y', 'x', 'panel']);
    // Each visit of a view with several is a panel of its own, with its own rows.
    const week12 = CASES.find((entry) => entry.case === 'welch-week-12');
    expect(requestOf(demo, week12).dataId.visit).toBe('Week 12');
    expect(requestOf(demo, week12).rows).toBe(184);
  });
});

describe('what desktop R answered, and the key it wrote', () => {
  it('GC-STAT-022: the expected results name the script, the R version and the vendored statistics file that made them (#16)', () => {
    const vendored = readRecord(path.join(ROOT, STATISTICS.directory));
    expect(fromR.made_by.script).toBe('tools/r-group-statistics.R');
    expect(fromR.made_by.r_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(fromR.made_by.platform).not.toBe('');
    expect(fromR.made_by.statistics_file).toBe('site/vendor/gsm.bio/statistics.R');
    // The copy of gsm.bio's statistics that is vendored now, not an earlier one.
    expect(fromR.made_by.statistics_commit).toBe(vendored.commit);
    expect(fromR.made_by.statistics_sha256).toBe(vendored.files[0].sha256);
    expect(fromR.made_by.statistics_sha256).toBe(
      sha256(read(`${STATISTICS.directory}/statistics.R`))
    );
    // One result per case, in the cases' order: the four tests, and pairwise.
    expect(fromR.results.map((result) => result.case)).toEqual(CASES.map((entry) => entry.case));
    expect(fromR.results.map((result) => result.value.test).slice(0, 6)).toEqual([
      't',
      'wilcoxon',
      'anova',
      'kruskal',
      'anova',
      'kruskal'
    ]);
    expect(resultOf('anova-pairwise').value.rows).toHaveLength(6);
    expect(resultOf('kruskal-pairwise').value.rows).toHaveLength(6);
    expect(resultOf('welch-age-57').value.status).toBe('too_small');
  });

  it('GC-STAT-023: for every case the function, the arguments, the identity and the row count R wrote by the recipe are the ones the chart asks with (#16)', () => {
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

  it('GC-STAT-023: handed to a connection as stored results, each of R’s answers is found by the chart’s request for its panel, and by no other view’s (#16)', async () => {
    // Every result but the ones that share a key with another: one stored
    // result per panel.
    const stored = fromR.results.filter(
      (result) =>
        !['wilcoxon', 'kruskal', 'anova-pairwise', 'kruskal-pairwise'].includes(result.case)
    );
    const connection = createConnection({
      results: stored.map(({ name, args, dataId, rows, value }) => ({
        name,
        args,
        dataId,
        rows,
        value
      }))
    });
    const run = ({ name, data, args, dataId }) => connection.run(name, { data, args, dataId });
    for (const result of stored) {
      const entry = CASES.find((candidate) => candidate.case === result.case);
      expect(await run(requestOf(demo, entry)), result.case).toEqual({
        status: 'ok',
        value: result.value,
        form: 'precomputed'
      });
    }
    // One biomarker at two visits is two panels, each with a stored result of
    // its own: the request for Week 12 is answered with Week 12's.
    const week12 = await run(
      requestOf(demo, {
        case: 'x',
        view: { visits: ['Week 4', 'Week 12'] },
        panel: 'Week 12',
        test: 't'
      })
    );
    expect(week12.value.counts).toEqual({ Placebo: 92, Treatment: 92 });
    const week4 = await run(
      requestOf(demo, {
        case: 'x',
        view: { visits: ['Week 4', 'Week 12'] },
        panel: 'Week 4',
        test: 't'
      })
    );
    expect(week4.value.counts).toEqual({ Placebo: 95, Treatment: 91 });

    // A view that was not stored is unavailable. It is never answered with the
    // opening view's numbers, however near it is.
    const others = [
      { case: 'another test', test: 'wilcoxon' },
      { case: 'another biomarker', view: { measure: 'CRP' }, test: 't' },
      { case: 'another visit', view: { visits: ['Week 8'] }, test: 't' },
      { case: 'another value', view: { valueType: 'percent_change' }, test: 't' },
      { case: 'another group', view: { groupBy: 'RESPONSE' }, test: 't' },
      { case: 'a filter', view: { filters: { RESPONSE: 'Responder' } }, test: 't' },
      { case: 'the other panel', view: { panelBy: 'SEX' }, panel: 'M', test: 't' },
      { case: 'pairs', view: { groupBy: 'ARM_SEX' }, test: 'anova', pairwise: true }
    ];
    for (const entry of others) {
      const answer = await run(requestOf(demo, entry));
      expect(answer.status, entry.case).toBe('unavailable');
      expect(answer.reason, entry.case).toBe('not-precomputed');
      expect(answer, entry.case).not.toHaveProperty('value');
    }
    // The same panel's rows under another identity are not found either: the
    // filter Sex = F and the panel for F hold the same 84 participants.
    const women = requestOf(
      demo,
      CASES.find((entry) => entry.case === 'welch-women')
    );
    const panel = requestOf(
      demo,
      CASES.find((entry) => entry.case === 'welch-panel-women')
    );
    expect(women.data.map((row) => row.USUBJID)).toEqual(panel.data.map((row) => row.USUBJID));
    expect(canonicalJson(women.dataId)).not.toBe(canonicalJson(panel.dataId));
    // And a stored result whose row count is not the panel's is refused.
    const short = await run({
      ...requestOf(demo, CASES[0]),
      data: requestOf(demo, CASES[0]).data.slice(1)
    });
    expect(short.status).toBe('unavailable');
  });
});
