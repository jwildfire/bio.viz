import { describe, it, expect, beforeEach } from 'vitest';
import { createConnection, WEBR_BASE_URL, WEBR_VERSION } from '../../../src/r/index.js';
import {
  createWebREngine,
  recordsToColumns,
  toPlain,
  R_HELPERS
} from '../../../src/r/webREngine.js';

// The browser form's engine (#2), against a fake webR module: what it loads and
// from where, the order it does things in, and the two conversions it owns —
// records to columns going in, R's value tree to plain JavaScript coming out.
// No network and no R: real webR is exercised by the R check page.

const fake = () => globalThis.__fakeWebR;

// The engine's default importer is `import(url)`. The tests hand it one that
// records the URL asked for and returns the fake module instead.
function fakeImporter() {
  const urls = [];
  const importModule = async (url) => {
    urls.push(url);
    await new Promise((resolve) => setTimeout(resolve, 5));
    return import('../../e2e/fixtures/fake-webr/webr.mjs');
  };
  return { urls, importModule };
}

const rows = [
  { ARM: 'Placebo', AVAL: 1.5, FLAG: true },
  { ARM: 'Active', AVAL: null },
  { ARM: 'Active', AVAL: Number.NaN, FLAG: false, EXTRA: 'x' }
];

// What webR's toJs() returns for list(method = "Wilcoxon rank-sum test",
// p_value = 0.0312, counts = c(Placebo = 86L, Active = 84L)).
const resultTree = {
  type: 'list',
  names: ['method', 'p_value', 'counts'],
  values: [
    { type: 'character', names: null, values: ['Wilcoxon rank-sum test'] },
    { type: 'double', names: null, values: [0.0312] },
    { type: 'integer', names: ['Placebo', 'Active'], values: [86, 84] }
  ]
};

beforeEach(async () => {
  await import('../../e2e/fixtures/fake-webr/webr.mjs');
  fake().instances.length = 0;
  fake().functions = { rank_sum: () => resultTree };
});

describe('webR engine: what is loaded, and from where', () => {
  it('RCON-WEBR-001: webR is pinned to 0.6.0 and loaded from the public CDN unless another location is given (#2)', async () => {
    expect(WEBR_VERSION).toBe('0.6.0');
    expect(WEBR_BASE_URL).toBe('https://webr.r-wasm.org/v0.6.0/');

    const cdn = fakeImporter();
    const defaultConnection = createConnection({
      browser: { engine: createWebREngine({ importModule: cdn.importModule }) }
    });
    await defaultConnection.run('rank_sum', { data: rows });
    expect(cdn.urls).toEqual(['https://webr.r-wasm.org/v0.6.0/webr.mjs']);
    expect(fake().instances[0].options.baseUrl).toBe('https://webr.r-wasm.org/v0.6.0/');

    const own = fakeImporter();
    const ownConnection = createConnection({
      browser: {
        baseUrl: 'https://example.org/vendor/webr',
        engine: createWebREngine({ importModule: own.importModule })
      }
    });
    await ownConnection.run('rank_sum', { data: rows });
    // A missing trailing slash is supplied; the module and webR's own files
    // come from the same place.
    expect(own.urls).toEqual(['https://example.org/vendor/webr/webr.mjs']);
    expect(fake().instances[1].options.baseUrl).toBe('https://example.org/vendor/webr/');
  });

  it('RCON-WEBR-002: webR is started on the PostMessage channel (#2)', async () => {
    const { importModule } = fakeImporter();
    const connection = createConnection({
      browser: { engine: createWebREngine({ importModule }) }
    });
    await connection.run('rank_sum', { data: rows });
    // 3 is ChannelType.PostMessage in the module that was loaded.
    expect(fake().instances[0].options.channelType).toBe(3);
  });

  it('RCON-LAZY-004: nothing is imported until the first run, and two simultaneous first runs import once (#2)', async () => {
    const { urls, importModule } = fakeImporter();
    const connection = createConnection({
      browser: {
        engine: createWebREngine({ importModule }),
        source: 'rank_sum <- function(data) list()'
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(urls).toHaveLength(0);
    expect(fake().instances).toHaveLength(0);

    const results = await Promise.all([
      connection.run('rank_sum', { data: rows }),
      connection.run('rank_sum', { data: rows })
    ]);
    expect(results.map((result) => result.status)).toEqual(['ok', 'ok']);
    expect(urls).toHaveLength(1);
    expect(fake().instances).toHaveLength(1);
    expect(fake().instances[0].log.filter(([step]) => step === 'init')).toHaveLength(1);
  });

  it('RCON-WEBR-003: the packages it was told to are installed and attached, and the R source is evaluated once (#2)', async () => {
    const { importModule } = fakeImporter();
    const source = 'rank_sum <- function(data, ...) list()';
    const connection = createConnection({
      browser: {
        engine: createWebREngine({ importModule }),
        packages: ['survival'],
        source
      }
    });
    await connection.run('rank_sum', { data: rows });
    await connection.run('rank_sum', { data: rows });

    const log = fake().instances[0].log;
    const steps = log.filter(([step]) => !['evalR', 'purge', 'RList'].includes(step));
    expect(steps[0]).toEqual(['init']);
    expect(steps[1]).toEqual(['installPackages', ['survival'], { quiet: true }]);
    expect(steps[2]).toEqual(['evalRVoid', 'library("survival", character.only = TRUE)']);
    // The call helper, defined in base R only, then the source it was given.
    expect(steps[3][1]).toContain('.bioviz_call <- function');
    expect(steps[4]).toEqual(['evalRVoid', source]);
    expect(steps).toHaveLength(5);
    expect(log.filter(([step, code]) => step === 'evalRVoid' && code === source)).toHaveLength(1);
    expect(log.filter(([step]) => step === 'evalR')).toHaveLength(2);
  });

  it('RCON-WEBR-004: an R source given by URL is fetched on the first run, not before (#2)', async () => {
    const { importModule } = fakeImporter();
    const fetched = [];
    const connection = createConnection({
      browser: {
        engine: createWebREngine({
          importModule,
          fetchText: async (url) => {
            fetched.push(url);
            return 'rank_sum <- function(data) list()';
          }
        }),
        sourceUrl: 'stats/functions.R'
      }
    });
    expect(fetched).toEqual([]);
    await connection.run('rank_sum', { data: rows });
    await connection.run('rank_sum', { data: rows });
    expect(fetched).toEqual(['stats/functions.R']);
    expect(
      fake().instances[0].log.some(
        ([step, code]) => step === 'evalRVoid' && code === 'rank_sum <- function(data) list()'
      )
    ).toBe(true);
  });

  it('RCON-WEBR-005: a start that fails closes what it opened and reports why (#2)', async () => {
    const { importModule } = fakeImporter();
    const connection = createConnection({
      browser: { engine: createWebREngine({ importModule }), packages: ['notapackage'] }
    });
    const result = await connection.run('rank_sum', { data: rows });
    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('load-failed');
    expect(result.message).toContain('there is no package called');
    expect(fake().instances[0].log.at(-1)).toEqual(['close']);
  });
});

describe('webR engine: one call', () => {
  it('RCON-CALL-001: the records go to R as columns, with the function name and the arguments (#2)', async () => {
    const { importModule } = fakeImporter();
    const seen = [];
    fake().functions.rank_sum = (columns, args) => {
      seen.push({ columns, args });
      return resultTree;
    };
    const connection = createConnection({
      browser: { engine: createWebREngine({ importModule }) }
    });
    await connection.run('rank_sum', { data: rows, args: { value: 'AVAL', group: 'ARM' } });
    expect(seen).toEqual([
      {
        columns: {
          ARM: ['Placebo', 'Active', 'Active'],
          AVAL: [1.5, null, null],
          FLAG: [true, null, false],
          EXTRA: [null, null, 'x']
        },
        args: { value: 'AVAL', group: 'ARM' }
      }
    ]);
    const log = fake().instances[0].log;
    const [, code] = log.find(([step]) => step === 'evalR');
    expect(code).toBe('.bioviz_call(.bioviz_name, .bioviz_columns, .bioviz_args)');
    // Columns and arguments are each handed over as an R named list.
    expect(log.filter(([step]) => step === 'RList').map(([, names]) => names)).toEqual([
      ['ARM', 'AVAL', 'FLAG', 'EXTRA'],
      ['value', 'group']
    ]);
  });

  it('RCON-CALL-006: nested arguments go to R as nested lists, and a call with no data or arguments sends neither (#2)', async () => {
    const { importModule } = fakeImporter();
    const seen = [];
    fake().functions.rank_sum = (columns, args) => {
      seen.push({ columns, args });
      return resultTree;
    };
    const connection = createConnection({
      browser: { engine: createWebREngine({ importModule }) }
    });
    await connection.run('rank_sum', {
      data: rows,
      args: { value: 'AVAL', cut: { rule: 'median', points: [1, 2] } }
    });
    await connection.run('rank_sum');
    expect(seen[0].args).toEqual({ value: 'AVAL', cut: { rule: 'median', points: [1, 2] } });
    expect(seen[1]).toEqual({ columns: undefined, args: undefined });

    const log = fake().instances[0].log;
    expect(log.filter(([step]) => step === 'RList').map(([, names]) => names)).toEqual([
      ['ARM', 'AVAL', 'FLAG', 'EXTRA'],
      ['rule', 'points'],
      ['value', 'cut']
    ]);
    expect(log.filter(([step]) => step === 'evalR').map(([, code]) => code)).toEqual([
      '.bioviz_call(.bioviz_name, .bioviz_columns, .bioviz_args)',
      '.bioviz_call(.bioviz_name, NULL, NULL)'
    ]);
  });

  it('RCON-CALL-002: recordsToColumns gives every column every row, with missing values as null (#2)', () => {
    expect(recordsToColumns(rows)).toEqual({
      ARM: ['Placebo', 'Active', 'Active'],
      AVAL: [1.5, null, null],
      FLAG: [true, null, false],
      EXTRA: [null, null, 'x']
    });
    expect(recordsToColumns([])).toEqual({});
    expect(recordsToColumns(undefined)).toEqual({});
  });

  it('RCON-CALL-003: the list R returns becomes plain JavaScript (#2)', async () => {
    const { importModule } = fakeImporter();
    const connection = createConnection({
      browser: { engine: createWebREngine({ importModule }) }
    });
    expect(await connection.run('rank_sum', { data: rows })).toEqual({
      status: 'ok',
      value: {
        method: 'Wilcoxon rank-sum test',
        p_value: 0.0312,
        counts: { Placebo: 86, Active: 84 }
      },
      form: 'browser'
    });
  });

  it('RCON-CALL-004: toPlain maps each kind of R value to one JavaScript shape (#2)', () => {
    const atomic = (type, values, names = null) => ({ type, names, values });
    // NULL
    expect(toPlain({ type: 'null' })).toBe(null);
    // a vector of length one is a scalar; NA is null
    expect(toPlain(atomic('double', [0.5]))).toBe(0.5);
    expect(toPlain(atomic('logical', [null]))).toBe(null);
    // any other unnamed vector is an array
    expect(toPlain(atomic('character', ['a', 'b']))).toEqual(['a', 'b']);
    expect(toPlain(atomic('double', []))).toEqual([]);
    // a named vector is an object, whatever its length
    expect(toPlain(atomic('integer', [3], ['Placebo']))).toEqual({ Placebo: 3 });
    // a named list is an object; an unnamed list is an array, even of length one
    expect(
      toPlain({
        type: 'list',
        names: ['estimate', 'groups'],
        values: [
          atomic('double', [1.5, 2.5]),
          { type: 'list', names: null, values: [atomic('character', ['Placebo'])] }
        ]
      })
    ).toEqual({ estimate: [1.5, 2.5], groups: ['Placebo'] });
    // something with no plain form is an error, not a guess
    expect(() => toPlain({ type: 'closure' })).toThrow(/closure/);
  });

  it('RCON-CALL-008: a data frame R returns becomes an array of row objects, whatever its size and depth (#2)', () => {
    const atomic = (type, values) => ({ type, names: null, values });
    // What .bioviz_plain sends for a data frame: the row count, then the columns.
    const frame = (count, columns) => ({
      type: 'list',
      names: ['.bioviz_frame', 'columns'],
      values: [
        atomic('integer', [count]),
        {
          type: 'list',
          names: Object.keys(columns).length ? Object.keys(columns) : null,
          values: Object.values(columns)
        }
      ]
    });
    const two = frame(2, {
      group: atomic('character', ['Placebo', 'Active']),
      n: atomic('integer', [86, 84]),
      median: atomic('double', [1.5, null])
    });
    const one = frame(1, {
      group: atomic('character', ['Placebo']),
      n: atomic('integer', [86]),
      median: atomic('double', [null])
    });
    const none = frame(0, {
      group: atomic('character', []),
      n: atomic('integer', []),
      median: atomic('double', [])
    });

    expect(toPlain(two)).toEqual([
      { group: 'Placebo', n: 86, median: 1.5 },
      { group: 'Active', n: 84, median: null }
    ]);
    // One row is still an array, of one object: the same shape as two rows.
    expect(toPlain(one)).toEqual([{ group: 'Placebo', n: 86, median: null }]);
    // No rows is an empty array.
    expect(toPlain(none)).toEqual([]);
    // No columns: one empty object per row.
    expect(toPlain(frame(2, {}))).toEqual([{}, {}]);

    // At any depth: inside a list, and as a list column inside another table.
    expect(
      toPlain({
        type: 'list',
        names: ['method', 'pairs'],
        values: [atomic('character', ['Wilcoxon rank-sum test']), one]
      })
    ).toEqual({
      method: 'Wilcoxon rank-sum test',
      pairs: [{ group: 'Placebo', n: 86, median: null }]
    });
    const withListColumn = frame(2, {
      biomarker: atomic('character', ['IL6', 'CRP']),
      groups: { type: 'list', names: null, values: [one, none] }
    });
    expect(toPlain(withListColumn)).toEqual([
      { biomarker: 'IL6', groups: [{ group: 'Placebo', n: 86, median: null }] },
      { biomarker: 'CRP', groups: [] }
    ]);

    // The R side marks a data frame before it is treated as a list.
    expect(R_HELPERS.indexOf('is.data.frame(x)')).toBeGreaterThan(-1);
    expect(R_HELPERS.indexOf('is.data.frame(x)')).toBeLessThan(
      R_HELPERS.indexOf('if (is.list(x)) return(lapply(x, .bioviz_plain))')
    );
  });

  it('RCON-CALL-007: the R that passes a table in and a result out uses base R only (#2)', async () => {
    const { importModule } = fakeImporter();
    const connection = createConnection({
      browser: { engine: createWebREngine({ importModule }) }
    });
    await connection.run('rank_sum', { data: rows });
    const helpers = fake()
      .instances[0].log.filter(([step]) => step === 'evalRVoid')
      .map(([, code]) => code)
      .find((code) => code.includes('.bioviz_call <- function'));
    expect(helpers).toContain('.bioviz_plain <- function');
    // No package is attached, required or reached into.
    for (const reach of ['library(', 'require(', 'requireNamespace(', '::', 'jsonlite']) {
      expect(helpers).not.toContain(reach);
    }
    // And no statistics: the helper builds a data frame and calls the function.
    for (const test of ['.test(', 'p.adjust', 'survdiff', 'cor(', 'mean(', 'median(']) {
      expect(helpers).not.toContain(test);
    }
  });

  it("RCON-CALL-005: an R error is reported with R's message, and the R objects of the call are released (#2)", async () => {
    const { importModule } = fakeImporter();
    fake().functions.rank_sum = () => {
      throw new Error('grouping factor must have exactly 2 levels');
    };
    const connection = createConnection({
      browser: { engine: createWebREngine({ importModule }) }
    });
    expect(await connection.run('rank_sum', { data: rows })).toEqual({
      status: 'error',
      message: 'grouping factor must have exactly 2 levels'
    });
    expect(await connection.run('no_such_function', { data: rows })).toEqual({
      status: 'error',
      message: 'could not find function "no_such_function"'
    });
    const log = fake().instances[0].log;
    expect(log.filter(([step]) => step === 'evalR')).toHaveLength(2);
    expect(log.filter(([step]) => step === 'purge')).toHaveLength(2);
  });
});
