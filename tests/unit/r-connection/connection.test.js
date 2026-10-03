import { describe, it, expect, vi } from 'vitest';
import { createConnection } from '../../../src/r/index.js';

// The connection to R (#2), against a stub engine: no R and no network. The
// engine is the part that knows webR; everything here is the connection's own
// behaviour — the result shapes, the stored-results lookup, and the lazy single
// start.

const rows = [
  { ARM: 'Placebo', AVAL: 1.2 },
  { ARM: 'Active', AVAL: 2.4 }
];

// A stand-in for the engine. `start` resolves after a tick (so two calls can
// overlap), fails `failStarts` times first, and `call` answers from `impl`.
function stubEngine({ failStarts = 0, impl = () => ({ p_value: 0.04 }) } = {}) {
  const log = { starts: [], calls: [] };
  let failures = failStarts;
  const engine = {
    async start(config) {
      log.starts.push(config);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (failures > 0) {
        failures -= 1;
        throw new Error('the engine file could not be fetched');
      }
    },
    async call(name, payload) {
      log.calls.push([name, payload]);
      return impl(name, payload);
    }
  };
  return { engine, log };
}

const stored = [
  {
    name: 'rank_sum',
    args: { value: 'AVAL', group: 'ARM' },
    dataId: 'opening view',
    rows: 2,
    value: { method: 'Wilcoxon rank-sum test', p_value: 0.0312 }
  }
];

describe('connection: the call and its three answers', () => {
  it('RCON-API-001: createConnection returns an object whose one call is run (#2)', () => {
    const connection = createConnection();
    expect(Object.keys(connection)).toEqual(['run']);
    expect(typeof connection.run).toBe('function');
    expect(Object.isFrozen(connection)).toBe(true);
  });

  it('RCON-RES-001: ok carries the value R returned and the form that answered (#2)', async () => {
    const { engine } = stubEngine({ impl: () => ({ method: 'Wilcoxon rank-sum test', n: 2 }) });
    const connection = createConnection({ browser: { engine } });
    expect(await connection.run('rank_sum', { data: rows, args: { value: 'AVAL' } })).toEqual({
      status: 'ok',
      value: { method: 'Wilcoxon rank-sum test', n: 2 },
      form: 'browser'
    });
  });

  it('RCON-RES-002: with neither form configured, run answers unavailable with a reason (#2)', async () => {
    const result = await createConnection().run('rank_sum', { data: rows, args: {} });
    expect(result).toEqual({
      status: 'unavailable',
      reason: 'no-r-attached',
      message: 'Statistics are unavailable: no R is attached to this chart.'
    });
  });

  it("RCON-RES-003: error carries R's message when the R function fails (#2)", async () => {
    const { engine } = stubEngine({
      impl: () => {
        throw new Error("not enough 'x' observations");
      }
    });
    const result = await createConnection({ browser: { engine } }).run('rank_sum', { data: rows });
    expect(result).toEqual({ status: 'error', message: "not enough 'x' observations" });
  });

  it('RCON-API-002: run resolves and never rejects, whatever the engine throws (#2)', async () => {
    for (const thrown of ['a bare string', new Error('an Error'), { odd: true }, undefined, 42]) {
      const { engine } = stubEngine({
        impl: () => {
          throw thrown;
        }
      });
      const result = await createConnection({ browser: { engine } }).run('f', { data: rows });
      expect(result.status).toBe('error');
      expect(typeof result.message).toBe('string');
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('RCON-API-003: a call run cannot make sense of resolves to an error, without starting R (#2)', async () => {
    const { engine, log } = stubEngine();
    const connection = createConnection({ browser: { engine } });
    for (const [name, request] of [
      [undefined, { data: rows }],
      ['', { data: rows }],
      ['f', { data: 'not records' }],
      ['f', { data: rows, args: ['not', 'named'] }],
      ['f', 'not a request']
    ]) {
      const result = await connection.run(name, request);
      expect(result.status).toBe('error');
      expect(result.message).toMatch(/^bio\.viz: /);
    }
    expect(log.starts).toHaveLength(0);
  });
});

describe('connection: the precomputed form', () => {
  it('RCON-PRE-001: a stored result is answered with nothing loaded and no network request (#2)', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('no network in the precomputed form');
    });
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const { engine, log } = stubEngine();
      // Even with the browser form configured, a stored result must not start R.
      const connection = createConnection({ results: stored, browser: { engine } });
      const result = await connection.run('rank_sum', {
        data: rows,
        args: { value: 'AVAL', group: 'ARM' },
        dataId: 'opening view'
      });
      expect(result).toEqual({
        status: 'ok',
        value: { method: 'Wilcoxon rank-sum test', p_value: 0.0312 },
        form: 'precomputed'
      });
      expect(log.starts).toHaveLength(0);
      expect(log.calls).toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('RCON-PRE-002: a stored result is keyed by function name, arguments and data identity; argument order does not matter (#2)', async () => {
    const connection = createConnection({ results: stored });
    const hit = await connection.run('rank_sum', {
      data: rows,
      args: { group: 'ARM', value: 'AVAL' },
      dataId: 'opening view'
    });
    expect(hit.status).toBe('ok');
    expect(hit.value.p_value).toBe(0.0312);
  });

  it('RCON-PRE-003: a call with no stored result answers unavailable, never another result (#2)', async () => {
    const connection = createConnection({ results: stored });
    const ask = (name, request) => connection.run(name, { data: rows, ...request });
    const args = { value: 'AVAL', group: 'ARM' };
    const misses = [
      // another function
      await ask('t_test', { args, dataId: 'opening view' }),
      // other arguments
      await ask('rank_sum', { args: { value: 'CHG', group: 'ARM' }, dataId: 'opening view' }),
      // an extra argument
      await ask('rank_sum', { args: { ...args, exact: true }, dataId: 'opening view' }),
      // other data
      await ask('rank_sum', { args, dataId: 'SEX = F' }),
      // no data identity given: the connection cannot know which data this is
      await ask('rank_sum', { args }),
      // the stored result was computed on two rows; these are three
      await connection.run('rank_sum', { data: [...rows, rows[0]], args, dataId: 'opening view' })
    ];
    for (const result of misses) {
      expect(result.status).toBe('unavailable');
      expect(result.reason).toBe('not-precomputed');
      expect(result).not.toHaveProperty('value');
    }
    expect(misses[4].message).toContain('no data identity');
    expect(misses[5].message).toContain('2 rows');
    expect(misses[5].message).toContain('3');
  });

  it('RCON-PRE-004: stored results that are malformed or ambiguous are refused when the connection is created (#2)', () => {
    const entry = stored[0];
    expect(() => createConnection({ results: 'not a list' })).toThrow(TypeError);
    expect(() => createConnection({ results: [{ ...entry, name: '' }] })).toThrow(/name/);
    expect(() => createConnection({ results: [{ ...entry, dataId: undefined }] })).toThrow(
      /dataId/
    );
    expect(() => createConnection({ results: [{ name: 'f', dataId: 'x' }] })).toThrow(/value/);
    expect(() => createConnection({ results: [{ ...entry, rows: -1 }] })).toThrow(/rows/);
    // Two results under one key: nothing says which is right.
    expect(() =>
      createConnection({ results: [entry, { ...entry, value: { p_value: 0.9 } }] })
    ).toThrow(/same/);
  });

  it('RCON-PRE-005: with both forms, a call with no stored result goes to R in the browser (#2)', async () => {
    const { engine, log } = stubEngine({ impl: () => ({ p_value: 0.5 }) });
    const connection = createConnection({ results: stored, browser: { engine } });
    const result = await connection.run('rank_sum', {
      data: rows,
      args: { value: 'AVAL', group: 'ARM' },
      dataId: 'SEX = F'
    });
    expect(result).toEqual({ status: 'ok', value: { p_value: 0.5 }, form: 'browser' });
    expect(log.starts).toHaveLength(1);
  });

  it('RCON-PRE-006: changing a returned value does not change the stored result (#2)', async () => {
    const connection = createConnection({ results: stored });
    const request = { data: rows, args: { value: 'AVAL', group: 'ARM' }, dataId: 'opening view' };
    const first = await connection.run('rank_sum', request);
    first.value.p_value = 1;
    expect((await connection.run('rank_sum', request)).value.p_value).toBe(0.0312);
  });
});

describe('connection: the browser form starts R lazily and once', () => {
  it('RCON-LAZY-001: creating a connection starts nothing; the first run starts the engine with its configuration (#2)', async () => {
    const { engine, log } = stubEngine();
    const connection = createConnection({
      browser: { engine, source: 'f <- function(data) 1', packages: ['survival'] }
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(log.starts).toHaveLength(0);

    await connection.run('f', { data: rows, args: { a: 1 } });
    expect(log.starts).toEqual([
      {
        baseUrl: 'https://webr.r-wasm.org/v0.6.0/',
        packages: ['survival'],
        source: 'f <- function(data) 1',
        sourceUrl: undefined
      }
    ]);
    expect(log.calls).toEqual([['f', { data: rows, args: { a: 1 } }]]);
  });

  it('RCON-LAZY-002: two simultaneous first calls cause one start, and later calls reuse it (#2)', async () => {
    const { engine, log } = stubEngine();
    const connection = createConnection({ browser: { engine } });
    const [a, b] = await Promise.all([
      connection.run('f', { data: rows }),
      connection.run('g', { data: rows })
    ]);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    expect(log.starts).toHaveLength(1);

    await connection.run('f', { data: rows });
    expect(log.starts).toHaveLength(1);
    expect(log.calls.map(([name]) => name)).toEqual(['f', 'g', 'f']);
  });

  it('RCON-LAZY-003: a failed start answers unavailable for every waiting call, and the next run tries again (#2)', async () => {
    const { engine, log } = stubEngine({ failStarts: 1 });
    const connection = createConnection({ browser: { engine } });
    const failed = await Promise.all([
      connection.run('f', { data: rows }),
      connection.run('f', { data: rows })
    ]);
    for (const result of failed) {
      expect(result).toEqual({
        status: 'unavailable',
        reason: 'load-failed',
        message:
          'Statistics are unavailable: R could not be started (the engine file could not be fetched).'
      });
    }
    expect(log.starts).toHaveLength(1);
    expect(log.calls).toHaveLength(0);

    expect((await connection.run('f', { data: rows })).status).toBe('ok');
    expect(log.starts).toHaveLength(2);
  });

  it('RCON-ISO-001: two connections share nothing: each starts its own engine (#2)', async () => {
    const one = stubEngine();
    const two = stubEngine();
    const first = createConnection({ browser: { engine: one.engine } });
    const second = createConnection({ browser: { engine: two.engine } });
    await first.run('f', { data: rows });
    expect(one.log.starts).toHaveLength(1);
    expect(two.log.starts).toHaveLength(0);
    await second.run('f', { data: rows });
    expect(two.log.starts).toHaveLength(1);
  });

  it('RCON-API-004: a browser form with a malformed setting is refused when the connection is created (#2)', () => {
    expect(() => createConnection({ browser: { packages: 'survival' } })).toThrow(TypeError);
    expect(() => createConnection({ browser: { packages: ['bad name; q()'] } })).toThrow(/package/);
    expect(() => createConnection({ browser: { source: 42 } })).toThrow(/source/);
    expect(() => createConnection({ browser: { source: 'x', sourceUrl: 'y.R' } })).toThrow(
      /source/
    );
    expect(() => createConnection({ browser: { baseUrl: 42 } })).toThrow(/baseUrl/);
    expect(() => createConnection({ browser: { engine: {} } })).toThrow(/engine/);
  });
});
