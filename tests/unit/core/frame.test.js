import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { build } from 'esbuild';
import {
  BASELINE_STATS,
  DEFAULT_SETTINGS,
  DROPPED,
  UNUSED,
  frame
} from '../../../src/core/index.js';
import { createConnection } from '../../../src/r/index.js';
import { participants, results, written } from './study.js';

// The frame (#8): named variables resolved to one row per participant, with
// what was left out counted by reason.

const root = new URL('../../../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const dist = (file) => new URL(`dist/bio.viz-${pkg.version}/${file}`, root);
const total = (list) => list.reduce((sum, entry) => sum + entry.n, 0);
const refused = (call) => {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    return error.message;
  }
  throw new Error('not refused');
};

const IL6_CHANGE = { measure: 'IL-6', visit: 'Week 4', value: 'change' };
const BASELINE = { baseline_visits: ['Baseline'] };

describe('core: the frame on the synthetic study', () => {
  it('CORE-FRAME-001: the frame has one record per participant, holding the id and one field per variable, named as given (#8)', () => {
    const got = frame({ results, participants }, { y: IL6_CHANGE, x: { col: 'ARM' } }, BASELINE);
    expect(got.id_col).toBe('USUBJID');
    expect(got.data[0]).toEqual({ USUBJID: 'BIO-001', y: 5.9 - 6.927, x: 'Placebo' });
    expect(got.data.every((row) => Object.keys(row).join() === 'USUBJID,y,x')).toBe(true);
    expect(new Set(got.data.map((row) => row.USUBJID)).size).toBe(got.data.length);
    // In the participant table's order.
    const order = participants.map((row) => row.USUBJID);
    const kept = got.data.map((row) => row.USUBJID);
    expect(kept).toEqual(order.filter((id) => kept.includes(id)));
    // The variables come back in full, and the baseline visits that were used.
    expect(got.variables).toEqual({
      y: { kind: 'measure', measure: 'IL-6', visit: 'Week 4', value: 'change' },
      x: { kind: 'column', col: 'ARM', type: null }
    });
    expect(got.baseline_visits).toEqual(['Baseline']);
  });

  it('CORE-FRAME-002: IL-6 change from Baseline to Week 4 has 186 participants and 14 dropped (#8)', () => {
    const got = frame({ results, participants }, { y: IL6_CHANGE, x: { col: 'ARM' } }, BASELINE);
    expect(got.data).toHaveLength(186);
    expect(got.participants).toBe(200);
    expect(total(got.dropped)).toBe(14);
    expect(got.dropped).toEqual([
      { reason: DROPPED.NO_RESULT, variable: 'y', n: 13 },
      { reason: DROPPED.MISSING_RESULT, variable: 'y', n: 1 }
    ]);

    // The same two counts, taken from the file: participants with no Week 4 row
    // for IL-6, and participants whose Week 4 row has nothing in STRESN.
    const week4 = participants.map((row) => written(row.USUBJID, 'IL-6', 'Week 4'));
    expect(week4.filter((value) => value === undefined)).toHaveLength(13);
    expect(week4.filter((value) => value === '')).toHaveLength(1);
    // Every value is a number, so R has none to leave out: its count of
    // participants used is this frame's 186, and 14 is what is not there.
    expect(got.data.every((row) => Number.isFinite(row.y))).toBe(true);
    const arms = got.data.reduce((n, row) => ({ ...n, [row.x]: (n[row.x] || 0) + 1 }), {});
    expect(Object.keys(arms).sort()).toEqual(['Placebo', 'Treatment']);
    expect(arms.Placebo + arms.Treatment).toBe(186);
  });

  it('CORE-FRAME-003: every participant seen is either in the frame or counted once in the dropped list (#8)', () => {
    for (const variables of [
      { y: IL6_CHANGE },
      { y: IL6_CHANGE, x: { col: 'ARM' } },
      { a: { measure: 'TNF-alpha', visit: 'Week 12' }, b: { measure: 'IL-10', visit: 'Week 8' } },
      { y: { measure: 'no such biomarker', visit: 'Week 4' } }
    ]) {
      const got = frame({ results, participants }, variables, BASELINE);
      expect(got.participants).toBe(200);
      expect(got.data.length + total(got.dropped)).toBe(200);
    }
    // A participant missing two variables is counted under the first, as given.
    const two = frame(
      { results, participants },
      { late: { measure: 'IL-6', visit: 'Week 12' }, mid: { measure: 'IL-6', visit: 'Week 4' } }
    );
    const lateMissing = participants.filter((row) => !written(row.USUBJID, 'IL-6', 'Week 12'));
    expect(total(two.dropped.filter((entry) => entry.variable === 'late'))).toBe(
      lateMissing.length
    );
    // A biomarker the table does not have drops everyone, and says why.
    const none = frame({ results }, { y: { measure: 'IL6', visit: 'Week 4' } });
    expect(none.data).toEqual([]);
    expect(none.dropped).toEqual([{ reason: DROPPED.NO_RESULT, variable: 'y', n: 200 }]);
  });

  it('CORE-FRAME-004: the results table alone gives a frame, with no participant column in it (#8)', () => {
    const got = frame({ results }, { y: IL6_CHANGE }, BASELINE);
    expect(got.data).toHaveLength(186);
    expect(total(got.dropped)).toBe(14);
    expect(got.participants).toBe(200);
    expect(got.data[0]).toEqual({ USUBJID: 'BIO-001', y: 5.9 - 6.927 });
    for (const row of got.data) expect(Object.keys(row)).toEqual(['USUBJID', 'y']);
    // The same values as with the participant table given.
    const withTable = frame({ results, participants }, { y: IL6_CHANGE }, BASELINE);
    expect(got.data).toEqual(withTable.data);
    // A participant column cannot be asked for when no table carries it.
    expect(refused(() => frame({ results }, { y: IL6_CHANGE, x: { col: 'ARM' } }))).toBe(
      'bio.viz: no table has the column `ARM`: it is not in the results table.'
    );
  });

  it('CORE-FRAME-005: a column is read from the participant table when it is given, and otherwise from a column carried on the results rows (#8)', () => {
    const arm = Object.fromEntries(participants.map((row) => [row.USUBJID, row.ARM]));
    const carried = results.map((row) => ({ ...row, ARM: arm[row.USUBJID] }));

    const fromRows = frame({ results: carried }, { y: IL6_CHANGE, x: { col: 'ARM' } }, BASELINE);
    const fromTable = frame(
      { results, participants },
      { y: IL6_CHANGE, x: { col: 'ARM' } },
      BASELINE
    );
    expect(fromRows.data).toHaveLength(186);
    expect(fromRows.data).toEqual(fromTable.data);
    expect(fromRows.dropped).toEqual(fromTable.dropped);

    // When both carry it, the participant table is the one read.
    const disagreeing = results.map((row) => ({ ...row, ARM: 'from the results rows' }));
    const both = frame({ results: disagreeing, participants }, { x: { col: 'ARM' } });
    expect(both.data.map((row) => row.x)).toEqual(participants.map((row) => row.ARM));
    // A column only the results rows carry is read from them, table or no table.
    const withoutArm = participants.map(({ USUBJID, SEX }) => ({ USUBJID, SEX }));
    const only = frame({ results: carried, participants: withoutArm }, { x: { col: 'ARM' } });
    expect(only.data.map((row) => row.x)).toEqual(participants.map((row) => row.ARM));
  });

  it('CORE-FRAME-006: a wide table with one row per participant resolves as it is, every column a variable (#8)', () => {
    // Built here from the vendored rows: one record per participant.
    const wide = participants.map((row) => ({
      USUBJID: row.USUBJID,
      ARM: row.ARM,
      AGE: row.AGE,
      IL6_BL: written(row.USUBJID, 'IL-6', 'Baseline'),
      IL6_W4: written(row.USUBJID, 'IL-6', 'Week 4') ?? ''
    }));
    const got = frame(
      { results: wide },
      {
        y: { col: 'IL6_W4', type: 'number' },
        x: { col: 'ARM' },
        age: { col: 'AGE', type: 'number' }
      }
    );
    expect(got.data).toHaveLength(186);
    expect(got.participants).toBe(200);
    expect(got.dropped).toEqual([{ reason: DROPPED.EMPTY_COLUMN, variable: 'y', n: 14 }]);
    expect(got.data[0]).toEqual({ USUBJID: 'BIO-001', y: 5.9, x: 'Placebo', age: 55 });
    expect(got.baseline_visits).toBe(null);
    // It needs none of the columns a long table has.
    expect(Object.keys(wide[0])).not.toContain('TEST');
    // Given as the participant table beside a long results table, the same columns resolve.
    const beside = frame(
      { results, participants: wide },
      { y: IL6_CHANGE, bl: { col: 'IL6_BL', type: 'number' } },
      BASELINE
    );
    expect(beside.data[0]).toEqual({ USUBJID: 'BIO-001', y: 5.9 - 6.927, bl: 6.927 });
  });
});

describe('core: what the frame leaves out', () => {
  const row = (USUBJID, VISIT, STRESN, more = {}) => ({
    USUBJID,
    VISIT,
    TEST: 'X',
    STRESN,
    ...more
  });
  const X = { y: { measure: 'X', visit: 'Week 4' } };

  it('CORE-FRAME-007: of several results for one participant, biomarker and visit the first usable one is used and the rest are counted (#8)', () => {
    const got = frame(
      {
        results: [
          row('A', 'Week 4', ''),
          row('A', 'Week 4', '3.5'),
          row('A', 'Week 4', '9'),
          row('A', 'Week 4', 9.5),
          row('B', 'Week 4', 2),
          row('B', 'Week 2', 7),
          row('B', 'Week 2', 8)
        ]
      },
      X
    );
    expect(got.data).toEqual([
      { USUBJID: 'A', y: 3.5 },
      { USUBJID: 'B', y: 2 }
    ]);
    expect(got.dropped).toEqual([]);
    // Two later results and one empty row at Week 4. Week 2 was not read, so
    // its duplicate is not counted.
    expect(got.unused).toEqual([
      { reason: UNUSED.DUPLICATE_RESULT, table: 'results', n: 2 },
      { reason: UNUSED.MISSING_RESULT, table: 'results', n: 1 }
    ]);
  });

  it('CORE-FRAME-008: a result that is missing or not a number is not a result, and a participant with no other is dropped and counted (#8)', () => {
    const got = frame(
      {
        results: [
          row('A', 'Week 4', '4.25'),
          row('B', 'Week 4', ''),
          row('C', 'Week 4', 'NA'),
          row('D', 'Week 4', null),
          row('E', 'Week 4', '<0.5'),
          row('F', 'Week 4', Infinity),
          row('G', 'Week 2', 1),
          row('H', 'Week 4', ' 7 '),
          row('I', 'Week 4', 0)
        ]
      },
      X
    );
    expect(got.data).toEqual([
      { USUBJID: 'A', y: 4.25 },
      { USUBJID: 'H', y: 7 },
      { USUBJID: 'I', y: 0 }
    ]);
    expect(got.dropped).toEqual([
      { reason: DROPPED.NO_RESULT, variable: 'y', n: 1 },
      { reason: DROPPED.MISSING_RESULT, variable: 'y', n: 5 }
    ]);
    expect(got.unused).toEqual([{ reason: UNUSED.MISSING_RESULT, table: 'results', n: 5 }]);
    expect(got.participants).toBe(9);

    // On the synthetic study: the one empty IL-6 result at Week 4.
    const study = frame({ results }, { y: { measure: 'IL-6', visit: 'Week 4' } });
    expect(study.unused).toEqual([{ reason: UNUSED.MISSING_RESULT, table: 'results', n: 1 }]);
  });

  it('CORE-FRAME-009: participants in one table and not the other are each handled and counted (#8)', () => {
    const got = frame(
      {
        results: [
          row('A', 'Week 4', 1),
          row('B', 'Week 4', 2),
          row('Z', 'Week 4', 9),
          row('', 'Week 4', 5)
        ],
        participants: [
          { USUBJID: 'B', ARM: 'Treatment' },
          { USUBJID: 'A', ARM: 'Placebo' },
          { USUBJID: 'C', ARM: 'Placebo' },
          { USUBJID: 'A', ARM: 'Treatment' },
          { USUBJID: null, ARM: 'Placebo' }
        ]
      },
      { ...X, x: { col: 'ARM' } }
    );
    // The participant table says who there is, and in what order. Z has results
    // and is not in it; C is in it and has no result.
    expect(got.data).toEqual([
      { USUBJID: 'B', y: 2, x: 'Treatment' },
      { USUBJID: 'A', y: 1, x: 'Placebo' }
    ]);
    expect(got.dropped).toEqual([
      { reason: DROPPED.NOT_IN_PARTICIPANT_TABLE, variable: null, n: 1 },
      { reason: DROPPED.NO_RESULT, variable: 'y', n: 1 }
    ]);
    expect(got.participants).toBe(4);
    expect(got.data.length + total(got.dropped)).toBe(got.participants);
    expect(got.unused).toEqual([
      { reason: UNUSED.NO_ID, table: 'results', n: 1 },
      { reason: UNUSED.NO_ID, table: 'participants', n: 1 },
      { reason: UNUSED.DUPLICATE_PARTICIPANT, table: 'participants', n: 1 }
    ]);
  });

  it('CORE-FRAME-010: a column carried on the results rows must hold one value for the participant; one that is empty, varies or is not a number is counted (#8)', () => {
    const got = frame(
      {
        results: [
          row('A', 'Week 2', 1, { ARM: 'Placebo', AGE: '61' }),
          row('A', 'Week 4', 1, { ARM: 'Placebo', AGE: 61 }),
          row('B', 'Week 2', 1, { ARM: 'Placebo', AGE: '50' }),
          row('B', 'Week 4', 1, { ARM: 'Treatment', AGE: '50' }),
          row('C', 'Week 2', 1, { ARM: '', AGE: '44' }),
          row('C', 'Week 4', 1, { ARM: 'Treatment', AGE: '44' }),
          row('D', 'Week 4', 1, { ARM: null, AGE: '70' }),
          row('E', 'Week 4', 1, { ARM: 'Placebo', AGE: 'unknown' })
        ]
      },
      { x: { col: 'ARM' }, age: { col: 'AGE', type: 'number' } }
    );
    // A has one arm and one age, written twice. C's arm is empty on one row and
    // given on the other, which is one value.
    expect(got.data).toEqual([
      { USUBJID: 'A', x: 'Placebo', age: 61 },
      { USUBJID: 'C', x: 'Treatment', age: 44 }
    ]);
    expect(got.dropped).toEqual([
      { reason: DROPPED.EMPTY_COLUMN, variable: 'x', n: 1 },
      { reason: DROPPED.VARYING_COLUMN, variable: 'x', n: 1 },
      { reason: DROPPED.NOT_A_NUMBER, variable: 'age', n: 1 }
    ]);
    // Without `type`, a column's value is passed on as the table holds it.
    const asWritten = frame(
      { results: [row('A', 'Week 4', 1, { AGE: '61' })] },
      { age: { col: 'AGE' } }
    );
    expect(asWritten.data).toEqual([{ USUBJID: 'A', age: '61' }]);
  });

  it('CORE-FRAME-011: a variable that is not required is left empty rather than dropping the participant (#8)', () => {
    const variables = {
      a: { measure: 'IL-6', visit: 'Week 4' },
      b: { measure: 'IL-6', visit: 'Week 12' }
    };
    const all = frame({ results }, variables);
    const either = frame({ results }, variables, { required: [] });
    const first = frame({ results }, variables, { required: ['a'] });
    expect(either.data).toHaveLength(200);
    expect(either.dropped).toEqual([]);
    expect(either.data.filter((row) => row.a === null)).toHaveLength(14);
    expect(either.data.every((row) => 'a' in row && 'b' in row)).toBe(true);
    expect(first.data).toHaveLength(186);
    expect(first.data.some((row) => row.b === null)).toBe(true);
    expect(all.data).toEqual(either.data.filter((row) => row.a !== null && row.b !== null));
    expect(all.data.length).toBeLessThan(186);
    expect(refused(() => frame({ results }, variables, { required: ['c'] }))).toMatch(
      /`required` names `c`, which is not one of the variables/
    );
  });
});

describe('core: settings', () => {
  it('CORE-FRAME-012: column names are settings, and their defaults are the synthetic study’s (#8)', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      id_col: 'USUBJID',
      measure_col: 'TEST',
      value_col: 'STRESN',
      visit_col: 'VISIT',
      visit_order_col: 'VISITNUM',
      participant_id_col: null,
      baseline_visits: null,
      baseline_stat: 'mean',
      required: null
    });
    expect(BASELINE_STATS).toEqual(['mean', 'min', 'max', 'first']);
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);

    // The same study under other column names gives the same values.
    const renamed = results.map((row) => ({
      SUBJECT: row.USUBJID,
      PARAM: row.TEST,
      AVAL: row.STRESN,
      AVISIT: row.VISIT,
      AVISITN: row.VISITNUM
    }));
    const people = participants.map((row) => ({ PATIENT: row.USUBJID, TRT: row.ARM }));
    const got = frame(
      { results: renamed, participants: people },
      { y: IL6_CHANGE, x: { col: 'TRT' } },
      {
        id_col: 'SUBJECT',
        measure_col: 'PARAM',
        value_col: 'AVAL',
        visit_col: 'AVISIT',
        visit_order_col: 'AVISITN',
        participant_id_col: 'PATIENT'
      }
    );
    const standard = frame({ results, participants }, { y: IL6_CHANGE, x: { col: 'ARM' } });
    expect(got.id_col).toBe('SUBJECT');
    expect(got.baseline_visits).toEqual(['Baseline']);
    expect(got.data).toEqual(
      standard.data.map(({ USUBJID, y, x }) => ({ SUBJECT: USUBJID, y, x }))
    );
    expect(got.dropped).toEqual(standard.dropped);
  });

  it('CORE-FRAME-013: a call that cannot be made is refused with a message naming what is wrong (#8)', () => {
    const y = { y: IL6_CHANGE };
    expect(refused(() => frame(results, y))).toMatch(
      /takes the tables as an object: \{ results, participants \}/
    );
    expect(refused(() => frame({ participants }, y))).toMatch(
      /`results` must be an array of records/
    );
    expect(refused(() => frame({ results: 'results.csv' }, y))).toMatch(
      /`results` must be an array/
    );
    expect(refused(() => frame({ results, participants: {} }, y))).toMatch(
      /`participants` must be an array/
    );
    expect(refused(() => frame({ results, outcomes: [] }, y))).toMatch(
      /takes the tables `results` and `participants`, not `outcomes`/
    );
    expect(refused(() => frame({ results }, {}))).toMatch(
      /takes the variables as an object, each under the name of its field/
    );
    expect(refused(() => frame({ results }, [IL6_CHANGE]))).toMatch(
      /takes the variables as an object/
    );
    expect(refused(() => frame({ results }, { USUBJID: IL6_CHANGE }))).toMatch(
      /cannot be named `USUBJID`: that field holds the participant's id/
    );
    expect(refused(() => frame({ results }, { ' y': IL6_CHANGE }))).toMatch(
      /needs a name with no space at either end/
    );
    expect(refused(() => frame({ results }, { y: { measure: 'IL-6' } }))).toMatch(
      /must name its visit/
    );
    expect(refused(() => frame({ results }, { y: { ...IL6_CHANGE, cut: 'median' } }))).toMatch(
      /the cut rule is not available yet/
    );
    expect(refused(() => frame({ results }, y, { subject_col: 'ID' }))).toMatch(
      /`subject_col` is not a setting\. The settings are id_col, measure_col/
    );
    expect(refused(() => frame({ results }, y, { id_col: '' }))).toMatch(
      /`id_col` must be the name of a column/
    );
    expect(refused(() => frame({ results }, y, { baseline_stat: 'median' }))).toMatch(
      /`baseline_stat` must be one of mean, min, max, first/
    );
    expect(refused(() => frame({ results }, y, { baseline_visits: [] }))).toMatch(
      /`baseline_visits` must be a name, or a list of names/
    );
    expect(refused(() => frame({ results }, y, { required: 'y' }))).toMatch(
      /`required` must be a list/
    );
    expect(refused(() => frame({ results }, y, 'Baseline'))).toMatch(/settings must be an object/);
    // A column a setting names must be in the table it is read from.
    expect(refused(() => frame({ results }, y, { value_col: 'AVAL' }))).toBe(
      'bio.viz: the results table has no column `AVAL` (`value_col`).'
    );
    expect(
      refused(() => frame({ results, participants }, y, { participant_id_col: 'PATIENT' }))
    ).toBe('bio.viz: the participant table has no column `PATIENT` (`participant_id_col`).');
  });
});

describe('core: what leaves the frame, and what the module is made of', () => {
  it('CORE-FRAME-014: the frame’s records go to R through the connection as they are, with the fields named as the statistics functions take them (#8)', async () => {
    const got = frame({ results, participants }, { y: IL6_CHANGE, x: { col: 'ARM' } }, BASELINE);
    // Plain records of text and finite numbers: what JSON, and so R, can carry.
    expect(JSON.parse(JSON.stringify(got.data))).toEqual(got.data);
    const calls = [];
    const connection = createConnection({
      browser: {
        engine: {
          start: async () => {},
          call: async (name, request) => {
            calls.push({ name, ...request });
            return { counts: { Placebo: 0, Treatment: 0 } };
          }
        }
      }
    });
    const answer = await connection.run('Analyze_GroupDifference', {
      data: got.data,
      args: { strValueCol: 'y', strGroupCol: 'x', strMethod: 'wilcoxon' }
    });
    expect(answer.status).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(calls[0].data).toHaveLength(186);
    expect(calls[0].data[0]).toEqual({ USUBJID: 'BIO-001', y: 5.9 - 6.927, x: 'Placebo' });
    expect(calls[0].args).toEqual({ strValueCol: 'y', strGroupCol: 'x', strMethod: 'wilcoxon' });
    // Two variables on one biomarker are told apart by the names they were given.
    const pair = frame(
      { results },
      { week4: { measure: 'IL-6', visit: 'Week 4' }, change: IL6_CHANGE },
      BASELINE
    );
    expect(pair.data[0]).toEqual({ USUBJID: 'BIO-001', week4: 5.9, change: 5.9 - 6.927 });
  });

  it('CORE-FRAME-015: the frame changes nothing it is given (#8)', () => {
    const tables = {
      results: [
        { USUBJID: 'A', VISIT: 'Baseline', VISITNUM: '0', TEST: 'X', STRESN: '2', ARM: 'Placebo' },
        { USUBJID: 'A', VISIT: 'Week 4', VISITNUM: '4', TEST: 'X', STRESN: '3', ARM: 'Placebo' }
      ],
      participants: [{ USUBJID: 'A', AGE: '61' }]
    };
    const variables = {
      y: { measure: 'X', visit: 'Week 4', value: 'change' },
      age: { col: 'AGE', type: 'number' }
    };
    const settings = { baseline_visits: 'Baseline' };
    const before = JSON.stringify({ tables, variables, settings });
    const got = frame(tables, variables, settings);
    expect(got.data).toEqual([{ USUBJID: 'A', y: 1, age: 61 }]);
    expect(JSON.stringify({ tables, variables, settings })).toBe(before);
  });

  it('CORE-API-002: BioViz.core is exported by both committed bundles, with the variable, the frame and their vocabulary (#8)', async () => {
    const context = {};
    vm.runInNewContext(readFileSync(dist('bio.viz.js'), 'utf8'), context);
    const esm = await import(/* @vite-ignore */ dist('bio.viz.esm.js').href);
    const names = [
      'BASELINE_STATS',
      'DEFAULT_SETTINGS',
      'DROPPED',
      'UNUSED',
      'VALUE_TYPES',
      'frame',
      'label',
      'variable'
    ];
    expect(Object.keys(context.BioViz.core).sort()).toEqual(names);
    expect(Object.keys(esm.core).sort()).toEqual(names);
    // The committed bundle gives the answer the source gives.
    const got = esm.core.frame(
      { results, participants },
      { y: IL6_CHANGE, x: { col: 'ARM' } },
      BASELINE
    );
    expect(got.data).toHaveLength(186);
    expect(total(got.dropped)).toBe(14);
    expect(context.BioViz.core.label(IL6_CHANGE)).toBe('IL-6 at Week 4, change from baseline');
  });

  it('CORE-BUILD-003: the core module imports nothing from outside src/core, and reaches for no page and no network (#8)', async () => {
    const result = await build({
      entryPoints: ['src/core/index.js'],
      absWorkingDir: new URL('.', root).pathname,
      bundle: true,
      write: false,
      metafile: true,
      format: 'esm',
      logLevel: 'silent'
    });
    expect(result.errors).toEqual([]);
    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs.length).toBeGreaterThan(1);
    expect(inputs.filter((input) => !input.startsWith('src/core/'))).toEqual([]);
    const [output] = Object.values(result.metafile.outputs);
    expect(output.imports).toEqual([]);

    // Nothing in the source names a page, a chart or the network, or loads code when it runs.
    const reaching =
      /\b(document|window|navigator|globalThis|fetch|XMLHttpRequest|Chart|localStorage)\b|\bimport\s*\(|\brequire\s*\(/;
    const files = readdirSync(new URL('src/core/', root)).filter((file) => file.endsWith('.js'));
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      const code = readFileSync(new URL(`src/core/${file}`, root), 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');
      expect(code.match(reaching), file).toBe(null);
    }
  });
});
