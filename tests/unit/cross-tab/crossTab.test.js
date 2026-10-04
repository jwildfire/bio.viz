import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_SETTINGS,
  PERCENTS,
  TESTS,
  syncSettings
} from '../../../src/cross-tab/configure.js';
import { buildTable, percentText } from '../../../src/cross-tab/structureData.js';
import { contingencyRequest, describeAnswer, scopeText } from '../../../src/cross-tab/statistic.js';
import { createConnection } from '../../../src/r/index.js';
import { categoryOrder } from '../../../src/shared/tables.js';
import { canonicalJson } from '../../../src/r/canonical.js';
import { participants, results } from '../core/study.js';

// The cross-tabulation (#44, obot.roadmap#359): a two-way table of counts with
// its totals and percentages, and R's chi-square or Fisher's exact test of it.
// What desktop R makes of each case is in tests/fixtures/cross-tab-r.json,
// written by tools/r-cross-tab.R from the vendored study; nothing here is typed.

const fromR = JSON.parse(
  readFileSync(new URL('../../fixtures/cross-tab-r.json', import.meta.url), 'utf8')
);
const caseOf = (name) => fromR.cases.find((entry) => entry.case === name);
// The baseline visit named, as the demo and the R recipe name it.
const settings = syncSettings({ baseline_visits: 'Baseline' });

const refused = (overrides) => {
  try {
    syncSettings(overrides);
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    return error.message;
  }
  throw new Error(`not refused: ${JSON.stringify(overrides)}`);
};

// The view a case is of, as the chart's controls hold it.
const stateOf = (entry) => ({
  rowBy: entry.dataId.row_by,
  colBy: entry.dataId.col_by,
  percent: 'row',
  test: entry.args.strMethod,
  filters: Object.fromEntries(
    Object.entries(entry.dataId.filters || {}).map(([column, values]) => [column, values[0]])
  )
});
// A case's tables: the study's, or the ones the case brings.
const tablesOf = (entry) => entry.tables || { results, participants };
const modelOf = (entry) => buildTable(tablesOf(entry), settings, stateOf(entry));
// A table's counts by its categories, whatever order each way is drawn in.
const countsByName = (rowLevels, colLevels, counts) =>
  Object.fromEntries(
    rowLevels.flatMap((row, i) => colLevels.map((col, j) => [`${row} | ${col}`, counts[i][j]]))
  );

describe('cross-tabulation: settings', () => {
  it('CT-CFG-001: every setting has a default; the rows and the columns are each a column or a cut variable; the percentages, the test and the statistic are checked (#44)', () => {
    expect(syncSettings()).toEqual(DEFAULT_SETTINGS);
    expect(PERCENTS).toEqual(['row', 'col', 'none']);
    expect(TESTS).toEqual(['chisq', 'fisher', 'none']);
    expect(DEFAULT_SETTINGS).toMatchObject({
      row_by: null,
      col_by: null,
      percent: 'row',
      test: 'chisq',
      statistic: 'Analyze_Contingency'
    });
    expect(syncSettings({ row_by: 'ARM' }).row_by).toBe('ARM');
    expect(
      syncSettings({ col_by: { measure: 'CRP', visit: 'Baseline', cut: 'median' } }).col_by
    ).toEqual({ measure: 'CRP', visit: 'Baseline', value: 'raw', cut: 'median' });
    expect(refused({ percent: 'cell' })).toBe('bio.viz: `percent` must be one of row, col, none.');
    expect(refused({ test: 'mcnemar' })).toBe(
      'bio.viz: `test` must be one of chisq, fisher, none.'
    );
    expect(refused({ row_by: { measure: 'CRP', visit: 'Baseline' } })).toMatch(
      /`row_by` is a variable with no cut/
    );
    expect(refused({ alpha: 0.05 })).toMatch(/`alpha` is not a setting of the cross-tabulation/);
  });
});

describe('cross-tabulation: the table', () => {
  it('CT-DATA-001: the counts, the row and column totals and the grand total are desktop R’s table() of the same participants, for every case (#44)', () => {
    expect(fromR.cases.length).toBeGreaterThanOrEqual(6);
    for (const entry of fromR.cases) {
      const model = modelOf(entry);
      // Every participant in the table, in R's category each way.
      expect(
        model.records.map((record) => [record.USUBJID, record.row, record.col]),
        entry.case
      ).toEqual(entry.ids.map((id, index) => [id, entry.row_of[index], entry.col_of[index]]));
      // The same categories, and the same count in each cell, as R's.
      expect([...model.rowLevels].sort(), entry.case).toEqual([...entry.row_levels].sort());
      expect([...model.colLevels].sort(), entry.case).toEqual([...entry.col_levels].sort());
      expect(countsByName(model.rowLevels, model.colLevels, model.counts), entry.case).toEqual(
        countsByName(entry.row_levels, entry.col_levels, entry.counts)
      );
      const totals = (levels, values) =>
        Object.fromEntries(levels.map((level, i) => [level, values[i]]));
      expect(totals(model.rowLevels, model.rowTotals), entry.case).toEqual(
        totals(entry.row_levels, entry.row_totals)
      );
      expect(totals(model.colLevels, model.colTotals), entry.case).toEqual(
        totals(entry.col_levels, entry.col_totals)
      );
      expect(model.total, entry.case).toBe(entry.total);
    }
    // A value of white space alone is missing, as R's recipe reads it: the
    // participants with one are not in the table.
    const stages = caseOf('stage-by-grade-chisq');
    const blanks = stages.tables.participants.filter((row) => row.GRADE.trim() === '');
    expect(blanks.map((row) => row.GRADE)).toEqual(
      expect.arrayContaining([' ', '\u00a0', '\u2003'])
    );
    expect(blanks).toHaveLength(6);
    expect(stages.total).toBe(42);
    for (const space of [' ', '\u00a0', '\u2003']) {
      expect(modelOf(stages).colLevels).not.toContain(space);
      expect(stages.col_levels).not.toContain(space);
    }
    // The white space R's recipe reads as nothing is exactly what
    // JavaScript's trim() removes, character for character.
    const trimmed = [];
    for (let code = 1; code <= 0xffff; code += 1) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      if (String.fromCharCode(code).trim() === '') trimmed.push(code);
    }
    expect(fromR.blank_code_points).toEqual(trimmed);
  });

  it('CT-DATA-004: each percentage is printed to one decimal as R’s sprintf() prints it, a value exactly halfway to the even digit (6.25 as 6.2%), for every cell of every case (#78)', () => {
    for (const { value, text } of fromR.percent_text) {
      expect(percentText(value), String(value)).toBe(text);
    }
    expect(fromR.percent_text.find((sample) => sample.value === 6.25).text).toBe('6.2%');
    for (const entry of fromR.cases) {
      const model = modelOf(entry);
      const at = (levels, name) => levels.indexOf(name);
      for (const [percents, texts] of [
        [model.percents.row, entry.row_percent_text],
        [model.percents.col, entry.col_percent_text]
      ]) {
        entry.row_levels.forEach((row, i) =>
          entry.col_levels.forEach((col, j) => {
            const shown = percents[at(model.rowLevels, row)][at(model.colLevels, col)];
            expect(percentText(shown), `${entry.case} ${row} | ${col}`).toBe(texts[i][j]);
          })
        );
      }
    }
  });

  it('CT-DATA-002: the row and the column percentages are each count of its row’s or its column’s total, as desktop R works them out (#44)', () => {
    for (const entry of fromR.cases) {
      const model = modelOf(entry);
      for (const kind of ['row', 'col']) {
        const ours = countsByName(model.rowLevels, model.colLevels, model.percents[kind]);
        const theirs = countsByName(entry.row_levels, entry.col_levels, entry[`${kind}_percent`]);
        for (const [cell, value] of Object.entries(theirs)) {
          expect(ours[cell], `${entry.case} ${cell}`).toBeCloseTo(value, 12);
        }
      }
    }
  });

  it('CT-DATA-003: a biomarker cut by the shared cut rule makes the rows or the columns, low to high, worked out on the participants the filters keep (#44)', () => {
    const median = modelOf(caseOf('response-by-crp-median-chisq'));
    expect(median.colLevels).toEqual(['≤ 2.783', '> 2.783']);
    expect(median.cuts.col.points).toHaveLength(1);
    expect(median.cuts.col.points[0]).toBeCloseTo(2.783, 12);
    expect(median.cuts.row).toBe(undefined);
    const typed = modelOf(caseOf('response-by-crp-typed-chisq'));
    expect(typed.colLevels).toEqual(['≤ 8', '> 8']);
    // The women alone: 91 participants pass the filter.
    const women = modelOf(caseOf('arm-by-response-women-chisq'));
    expect(women.filtered).toBe(91);
    expect(women.total).toBe(91);
  });
});

describe('cross-tabulation: what R is asked, and what the line says', () => {
  it('CT-STAT-001: R is asked once per table, with the function, the arguments, the identity and the row count desktop R’s recipe writes, and one row per participant (#44)', () => {
    for (const entry of fromR.cases) {
      const model = modelOf(entry);
      const request = contingencyRequest({
        name: settings.statistic,
        test: entry.args.strMethod,
        settings,
        state: stateOf(entry),
        model
      });
      expect(request.name, entry.case).toBe(entry.name);
      expect(request.args, entry.case).toEqual(entry.args);
      expect(canonicalJson(request.dataId), entry.case).toBe(canonicalJson(entry.dataId));
      expect(request.rows, entry.case).toBe(entry.rows);
      expect(request.data).toHaveLength(entry.rows);
      expect(Object.keys(request.data[0])).toEqual([settings.id_col, 'row', 'col']);
    }
    // The baseline settings are named only where a cut biomarker reads a
    // baseline, so a table of columns, or of a result itself, is keyed without
    // them.
    const named = (entry) => 'baseline_visits' in entry.dataId || 'baseline_stat' in entry.dataId;
    expect(fromR.cases.filter(named).map((entry) => entry.case)).toEqual([
      'arm-by-crp-change-median-chisq'
    ]);
    expect(caseOf('arm-by-crp-change-median-chisq').dataId.baseline_visits).toEqual(['Baseline']);

    // A column's categories are drawn, and named in the key, in one order
    // whatever the browser's language, gsm.bio's: by name with numbers as
    // numbers and A to Z read as a to z, otherwise by code point, so week 1
    // before Week 2 before Week 10, and ASCII before Ö.
    const stages = caseOf('stage-by-grade-chisq');
    const requestIn = (locale) => {
      const compare = String.prototype.localeCompare;
      String.prototype.localeCompare = function (other, _locales, options) {
        return compare.call(this, other, locale, options);
      };
      try {
        const model = modelOf(stages);
        return {
          shown: model.rowLevels,
          request: contingencyRequest({
            name: settings.statistic,
            test: 'chisq',
            settings,
            state: stateOf(stages),
            model
          })
        };
      } finally {
        String.prototype.localeCompare = compare;
      }
    };
    for (const { shown, request } of ['en', 'sv', 'de', 'tr'].map(requestIn)) {
      expect(shown).toEqual(['week 1', 'Week 2', 'Week 10', 'Ödem']);
      expect(request.args.chrRowGroups).toEqual(shown);
      expect(request.args.chrColGroups).toEqual(['a', 'B']);
      expect(canonicalJson(request.args)).toBe(canonicalJson(stages.args));
      expect(canonicalJson(request.dataId)).toBe(canonicalJson(stages.dataId));
    }
  });

  it('CT-STAT-002: R’s chi-square and Fisher results are printed with their method and counts, labelled exploratory and unadjusted, and Fisher’s odds ratio with its interval (#44)', () => {
    const chisq = describeAnswer({ status: 'ok', value: caseOf('arm-by-response-chisq').value });
    expect(chisq.state).toBe('shown');
    expect(chisq.text).toBe(
      "Pearson's Chi-squared test with Yates' continuity correction: p = 0.464 (n = 200). " +
        'Exploratory, unadjusted.'
    );
    const fisherCase = caseOf('arm-by-response-fisher');
    const fisher = describeAnswer(
      { status: 'ok', value: fisherCase.value },
      { groups: { rows: fisherCase.args.chrRowGroups, cols: fisherCase.args.chrColGroups } }
    );
    expect(fisher.text).toBe(
      "Fisher's Exact Test for Count Data: p = 0.464 (n = 200). Exploratory, unadjusted."
    );
    // The odds ratio says which row is over which, and the odds of which column.
    expect(fisher.estimates).toEqual([
      'odds ratio (Placebo / Treatment, odds of Non-responder against Responder): 1.292, 95% confidence interval 0.6994 to 2.398.'
    ]);
    expect(scopeText({ n: 91, filters: [{ label: 'Sex', values: ['F'] }] })).toBe(
      'This test is of the 91 participants in the table. Filters: Sex is F.'
    );
  });

  it('CT-STAT-003: the small-expected warning is R’s, printed with the result when R gives it and not otherwise (#44)', () => {
    const small = describeAnswer({
      status: 'ok',
      value: caseOf('response-by-crp-typed-chisq').value
    });
    expect(small.remarks).toEqual([
      { kind: 'warning', text: 'R warned: Chi-squared approximation may be incorrect' },
      {
        kind: 'note',
        text: "R’s note: 1 of 4 expected counts are below 5, so the chi-squared approximation may be poor. Fisher's exact test does not rely on it."
      }
    ]);
    for (const name of ['arm-by-response-chisq', 'response-by-crp-median-chisq']) {
      expect(describeAnswer({ status: 'ok', value: caseOf(name).value }).remarks, name).toEqual([]);
    }
  });

  it('CT-STAT-010: a table R withholds, a category below its minimum size, prints R’s reason with the table’s variables named where R names the columns the chart gave it, and no number (#44, #58)', () => {
    const small = caseOf('response-by-crp-10-chisq');
    expect(small.value.status).toBe('too_small');
    // R names the margin by the column the chart handed it: `col`.
    expect(small.value.reason).toMatch(/^Not computed: col = > 10 has \d+\./);
    const described = describeAnswer(
      { status: 'ok', value: small.value },
      { names: { row: 'RESPONSE', col: 'CRP at Baseline, cut at 10' } }
    );
    expect(described.state).toBe('withheld');
    expect(described.text).toBe(
      `${small.value.reason.replace('Not computed: col = ', 'Not computed: CRP at Baseline, cut at 10 = ')} ` +
        `Counts: n = ${small.value.counts}.`
    );
    expect(described.text).not.toMatch(/\b(row|col) = /);
    expect(described.text).not.toMatch(/p [=<]/);
    // Both margins, and a reason that names neither, are left as R wrote them
    // but for the names.
    const both = describeAnswer(
      {
        status: 'ok',
        value: {
          ...small.value,
          reason: 'Not computed: row = b has 3; col = > 10 has 2. The minimum group size is 5.'
        }
      },
      { names: { row: 'Arm', col: 'Grade' } }
    );
    expect(both.text).toMatch(/^Not computed: Arm = b has 3; Grade = > 10 has 2\./);
    // With no names given, R's words are printed as they are.
    expect(describeAnswer({ status: 'ok', value: small.value }).text).toMatch(/col = > 10/);
  });

  it('CT-STAT-014: a column’s categories are drawn in one order in every browser language, numbers in their names as numbers, and R is handed them in that order, so Fisher’s odds ratio is of the table drawn and says which row is over which (#78)', () => {
    // The arms renamed as doses: by code point "10 mg" comes first, by name
    // with numbers as numbers "2 mg" does.
    const dose = caseOf('dose-by-response-fisher');
    expect(dose.args.chrRowGroups).toEqual(['2 mg', '10 mg']);
    // The order is gsm.bio's, as R sorts names on every rule it has.
    const { given, sorted: inR } = fromR.category_order;
    expect([...given].sort(categoryOrder)).toEqual(inR);
    expect([...given].reverse().sort(categoryOrder)).toEqual(inR);
    const compare = String.prototype.localeCompare;
    for (const locale of ['en', 'sv', 'de', 'tr']) {
      String.prototype.localeCompare = function (other, _locales, options) {
        return compare.call(this, other, locale, options);
      };
      try {
        const model = modelOf(dose);
        const request = contingencyRequest({
          name: settings.statistic,
          test: 'fisher',
          settings,
          state: stateOf(dose),
          model
        });
        // The table's first row is the first R is handed, in every language.
        expect(model.rowLevels, locale).toEqual(['2 mg', '10 mg']);
        expect(request.args.chrRowGroups, locale).toEqual(model.rowLevels);
        expect(request.args.chrColGroups, locale).toEqual(model.colLevels);
        expect(canonicalJson(request.args), locale).toBe(canonicalJson(dose.args));
        // R's odds ratio is on the side of 1 the table drawn is: the odds of
        // the first column in the first row over those in the second.
        const [[a, b], [c, d]] = model.counts;
        expect(Math.sign(Math.log((a * d) / (b * c)))).toBe(
          Math.sign(Math.log(dose.value.estimates[0].estimate))
        );
      } finally {
        String.prototype.localeCompare = compare;
      }
    }
    const described = describeAnswer(
      { status: 'ok', value: dose.value },
      { groups: { rows: dose.args.chrRowGroups, cols: dose.args.chrColGroups } }
    );
    expect(described.estimates).toEqual([
      'odds ratio (2 mg / 10 mg, odds of Non-responder against Responder): 1.292, 95% confidence interval 0.6994 to 2.398.'
    ]);
  });

  it('CT-STAT-004: handed to a connection as stored results, each of R’s answers is found by the chart’s request for its table (#44)', async () => {
    const connection = createConnection({
      results: fromR.cases.map(({ name, args, dataId, rows, value }) => ({
        name,
        args,
        dataId,
        rows,
        value
      }))
    });
    for (const entry of fromR.cases) {
      const request = contingencyRequest({
        name: settings.statistic,
        test: entry.args.strMethod,
        settings,
        state: stateOf(entry),
        model: modelOf(entry)
      });
      expect(await connection.run(request.name, request), entry.case).toEqual({
        status: 'ok',
        value: entry.value,
        form: 'precomputed'
      });
    }
  });
});
