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

// An engine whose starts and calls settle only when a test says so, in the
// order they were made, and which counts how many starts ran at once.
function heldEngine() {
  const starts = [];
  const calls = [];
  let running = 0;
  let most = 0;
  const hold = (list, entry = {}) =>
    new Promise((resolve, reject) => list.push({ ...entry, resolve, reject }));
  const engine = {
    start() {
      running += 1;
      most = Math.max(most, running);
      return hold(starts).finally(() => {
        running -= 1;
      });
    },
    call: (name) => hold(calls, { name })
  };
  return { engine, starts, calls, mostAtOnce: () => most };
}

// Long enough for every promise already settled to be acted on.
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

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

  it('RCON-RES-002: with no form configured, run answers unavailable with a reason (#2)', async () => {
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

  it('RCON-PRE-005: with stored results and the browser form, a call with no stored result goes to R in the browser (#2)', async () => {
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

describe('connection: R’s non-finite numbers in a stored answer', () => {
  it('RCON-PRE-007: a stored answer’s "Inf", "-Inf" and "NaN" where R returned a number are read as Infinity, -Infinity and NaN, as R in the browser hands them over; text elsewhere spelled so is left as text (#78)', async () => {
    const value = {
      method: "Fisher's Exact Test for Count Data",
      p_value: 2.6e-8,
      estimates: [
        { name: 'odds ratio', group: 'Inf', estimate: 'Inf', lower: 14.86, upper: 'Inf' },
        { name: 'Difference', group: null, estimate: '-Inf', lower: '-Inf', upper: 'NaN' }
      ],
      statistic: [{ name: 'Inf', value: 'NaN' }],
      rows: [{ row: 'Inf', col: 'NaN', n: 3, expected: 'Inf' }],
      notes: ['Inf'],
      reason: 'NaN'
    };
    const connection = createConnection({
      results: [{ name: 'fisher', args: {}, dataId: 'empty cell', value }]
    });
    const { value: read } = await connection.run('fisher', {
      data: [],
      args: {},
      dataId: 'empty cell'
    });
    expect(read.estimates).toEqual([
      { name: 'odds ratio', group: 'Inf', estimate: Infinity, lower: 14.86, upper: Infinity },
      { name: 'Difference', group: null, estimate: -Infinity, lower: -Infinity, upper: NaN }
    ]);
    expect(read.statistic).toEqual([{ name: 'Inf', value: NaN }]);
    expect(read.rows).toEqual([{ row: 'Inf', col: 'NaN', n: 3, expected: Infinity }]);
    // Text stays text: a note, a reason, a name, a group or a category.
    expect(read.notes).toEqual(['Inf']);
    expect(read.reason).toBe('NaN');
    expect(read.p_value).toBe(2.6e-8);
    // The stored result itself is not changed.
    expect(value.estimates[0].estimate).toBe('Inf');
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

// The server form (#122): R running somewhere else, reached through an engine
// the page supplies. An answer arrives as JSON, as a stored one does.
describe('connection: the server form', () => {
  const by = { r_version: '4.5.1', gsm_bio_version: '0.4.0' };

  it('RCON-SRV-001: with a server form, a call is answered through its engine as form server; creating the connection starts nothing, the first run starts the engine once with nothing of webR’s, and later runs reuse it (#122)', async () => {
    const { engine, log } = stubEngine({ impl: () => ({ method: 'Welch', p_value: 0.2 }) });
    const connection = createConnection({ server: { engine } });
    expect(log.starts).toHaveLength(0);
    const request = { data: rows, args: { value: 'AVAL' }, dataId: 'any' };
    const [first, second] = await Promise.all([
      connection.run('welch', request),
      connection.run('welch', request)
    ]);
    expect(first).toEqual({
      status: 'ok',
      value: { method: 'Welch', p_value: 0.2 },
      form: 'server'
    });
    expect(second).toEqual(first);
    await connection.run('welch', request);
    expect(log.starts).toEqual([undefined]);
    expect(log.calls).toHaveLength(3);
    expect(log.calls[0]).toEqual(['welch', { data: rows, args: { value: 'AVAL' } }]);
  });

  it('RCON-SRV-002: a server form given computedBy, which R answers there, hands that record with every answer from the server; one that is not a record is refused when the connection is created (#122)', async () => {
    const { engine } = stubEngine();
    const connection = createConnection({ server: { engine, computedBy: by } });
    const result = await connection.run('f', { data: rows });
    expect(result).toEqual({
      status: 'ok',
      value: { p_value: 0.04 },
      form: 'server',
      computedBy: by
    });
    // The record handed over is a copy: changing it changes no later answer.
    result.computedBy.r_version = '0.0.0';
    expect((await connection.run('f', { data: rows })).computedBy).toEqual(by);
    expect(() => createConnection({ server: { engine, computedBy: 'R 4.5.1' } })).toThrow(
      /computedBy/
    );
    expect(() => createConnection({ server: { engine, computedBy: {} } })).toThrow(/computedBy/);
  });

  it('RCON-SRV-003: with stored results and a server form, a stored result answers without the server, with its own record, and a call with none goes to the server (#122)', async () => {
    const { engine, log } = stubEngine({ impl: () => ({ p_value: 0.5 }) });
    const connection = createConnection({
      results: stored,
      computedBy: { r_version: '4.3.3' },
      server: { engine, computedBy: by }
    });
    const args = { value: 'AVAL', group: 'ARM' };
    const kept = await connection.run('rank_sum', { data: rows, args, dataId: 'opening view' });
    expect(kept.form).toBe('precomputed');
    expect(kept.computedBy).toEqual({ r_version: '4.3.3' });
    expect(log.starts).toHaveLength(0);
    const asked = await connection.run('rank_sum', { data: rows, args, dataId: 'SEX = F' });
    expect(asked).toEqual({
      status: 'ok',
      value: { p_value: 0.5 },
      form: 'server',
      computedBy: by
    });
    expect(log.calls).toHaveLength(1);
  });

  it('RCON-SRV-004: a server’s answer is read as a stored one is: "Inf", "-Inf" and "NaN" where R returned a number are Infinity, -Infinity and NaN, and text elsewhere spelled so is left as text (#122)', async () => {
    const { engine } = stubEngine({
      impl: () => ({
        p_value: 'NaN',
        estimates: [
          { name: 'odds ratio', group: 'Inf', estimate: 'Inf', lower: 14.86, upper: 'Inf' }
        ],
        notes: ['Inf']
      })
    });
    const { value } = await createConnection({ server: { engine } }).run('fisher', { data: [] });
    expect(value.p_value).toBeNaN();
    expect(value.estimates).toEqual([
      { name: 'odds ratio', group: 'Inf', estimate: Infinity, lower: 14.86, upper: Infinity }
    ]);
    expect(value.notes).toEqual(['Inf']);
  });

  it('RCON-SRV-005: a server that cannot be reached answers unavailable with reason load-failed and the cause, in words about the server, and the next run tries again; an error R reports there is an error with R’s message (#122)', async () => {
    const { engine, log } = stubEngine({ failStarts: 1 });
    const connection = createConnection({ server: { engine } });
    expect(await connection.run('f', { data: rows })).toEqual({
      status: 'unavailable',
      reason: 'load-failed',
      message:
        'Statistics are unavailable: R on the server could not be reached (the engine file could not be fetched).'
    });
    expect((await connection.run('f', { data: rows })).status).toBe('ok');
    expect(log.starts).toHaveLength(2);

    const failing = stubEngine({
      impl: () => {
        throw new Error('object of type closure is not subsettable');
      }
    });
    expect(
      await createConnection({ server: { engine: failing.engine } }).run('f', { data: rows })
    ).toEqual({ status: 'error', message: 'object of type closure is not subsettable' });
  });

  it('RCON-SRV-007: an engine that loses its server after reaching it rejects with unreachable true: the answer is unavailable with reason load-failed, not an error of R’s, and the next run starts the engine again (#122)', async () => {
    let lost = true;
    const { engine, log } = stubEngine({
      impl: () => {
        if (!lost) return { p_value: 0.3 };
        throw Object.assign(new Error('the session has ended'), { unreachable: true });
      }
    });
    const connection = createConnection({ server: { engine } });
    expect(await connection.run('f', { data: rows })).toEqual({
      status: 'unavailable',
      reason: 'load-failed',
      message:
        'Statistics are unavailable: R on the server could not be reached (the session has ended).'
    });
    expect(log.starts).toHaveLength(1);
    lost = false;
    expect(await connection.run('f', { data: rows })).toEqual({
      status: 'ok',
      value: { p_value: 0.3 },
      form: 'server'
    });
    expect(log.starts).toHaveLength(2);
    // The browser form has no such answer: whatever its engine throws is R's.
    const browser = stubEngine({
      impl: () => {
        throw Object.assign(new Error('stopped'), { unreachable: true });
      }
    });
    expect(
      await createConnection({ browser: { engine: browser.engine } }).run('f', { data: rows })
    ).toEqual({ status: 'error', message: 'stopped' });
  });

  it('RCON-SRV-008: a rejection marked unreachable forgets only the start its call waited on: with two calls in flight and one rejected, the other’s late rejection neither begins a second start beside one still running nor discards a start that succeeded since (#127)', async () => {
    const lost = () => Object.assign(new Error('the session has ended'), { unreachable: true });
    const ask = (connection, name) => connection.run(name, { data: rows });

    // A start still running when the late rejection arrives.
    const held = heldEngine();
    const connection = createConnection({ server: { engine: held.engine } });
    const first = ask(connection, 'first');
    const second = ask(connection, 'second');
    await turn();
    expect(held.starts).toHaveLength(1);
    held.starts[0].resolve();
    await turn();
    expect(held.calls.map((call) => call.name)).toEqual(['first', 'second']);
    // The first call loses its server, and a new run begins the second start.
    held.calls[0].reject(lost());
    expect((await first).reason).toBe('load-failed');
    const third = ask(connection, 'third');
    await turn();
    expect(held.starts).toHaveLength(2);
    // The second call's rejection arrives late: it waited on the first start.
    held.calls[1].reject(lost());
    expect((await second).reason).toBe('load-failed');
    const fourth = ask(connection, 'fourth');
    await turn();
    expect(held.starts).toHaveLength(2);
    expect(held.mostAtOnce()).toBe(1);
    held.starts[1].resolve();
    await turn();
    expect(held.calls.map((call) => call.name)).toEqual(['first', 'second', 'third', 'fourth']);
    held.calls[2].resolve({ p_value: 0.3 });
    held.calls[3].resolve({ p_value: 0.3 });
    expect((await third).status).toBe('ok');
    expect((await fourth).status).toBe('ok');

    // A start that has succeeded by the time the late rejection arrives.
    const again = heldEngine();
    const other = createConnection({ server: { engine: again.engine } });
    const one = ask(other, 'one');
    const two = ask(other, 'two');
    await turn();
    again.starts[0].resolve();
    await turn();
    again.calls[0].reject(lost());
    await one;
    const three = ask(other, 'three');
    await turn();
    again.starts[1].resolve();
    await turn();
    again.calls[2].resolve({ p_value: 0.3 });
    expect((await three).status).toBe('ok');
    again.calls[1].reject(lost());
    expect((await two).status).toBe('unavailable');
    const four = ask(other, 'four');
    await turn();
    // No third start: the call is made on the start that succeeded.
    expect(again.starts).toHaveLength(2);
    expect(again.calls.map((call) => call.name)).toEqual(['one', 'two', 'three', 'four']);
    again.calls[3].resolve({ p_value: 0.3 });
    expect((await four).status).toBe('ok');
    expect(again.mostAtOnce()).toBe(1);
  });

  it('RCON-SRV-009: a server’s answer is copied before it is read, so the engine’s own object is left as it was given, frozen or not; an answer the page cannot read is unavailable with reason answer-unreadable and the cause, not an error of R’s, and the engine is not started again (#127)', async () => {
    const freeze = (value) => {
      if (value && typeof value === 'object') Object.values(value).forEach(freeze);
      return Object.freeze(value);
    };
    const given = () => ({
      p_value: 'NaN',
      estimates: [{ name: 'odds ratio', estimate: 'Inf', lower: 14.86, upper: 'Inf' }]
    });
    const read = {
      p_value: NaN,
      estimates: [{ name: 'odds ratio', estimate: Infinity, lower: 14.86, upper: Infinity }]
    };
    for (const answer of [freeze(given()), given()]) {
      const { engine } = stubEngine({ impl: () => answer });
      const result = await createConnection({ server: { engine } }).run('fisher', { data: [] });
      expect(result).toEqual({ status: 'ok', value: read, form: 'server' });
      // The engine's object still holds what it was given.
      expect(answer).toEqual(given());
      expect(result.value).not.toBe(answer);
      expect(result.value.estimates[0]).not.toBe(answer.estimates[0]);
    }

    // An answer that is not data cannot be copied, so it cannot be read. R
    // reported no error, and the server was reached.
    const odd = stubEngine({ impl: () => ({ p_value: 0.2, method: () => 'Welch' }) });
    const connection = createConnection({ server: { engine: odd.engine } });
    const result = await connection.run('welch', { data: rows });
    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('answer-unreadable');
    expect(result.message).toMatch(
      /^Statistics are unavailable: the answer from R on the server could not be read \(.+\)\.$/
    );
    expect(result.message).not.toMatch(/R stopped|could not be reached/);
    await connection.run('welch', { data: rows });
    expect(odd.log.starts).toHaveLength(1);
    expect(odd.log.calls).toHaveLength(2);
  });

  it('RCON-SRV-010: an engine that rejects with no message, from its start or from a call marked unreachable, is answered with one sentence, that R on the server could not be reached, and no cause in brackets (#127)', async () => {
    const sentence = 'Statistics are unavailable: R on the server could not be reached.';
    for (const thrown of [undefined, new Error(''), '', { odd: true }]) {
      const engine = {
        start: async () => {
          throw thrown;
        },
        call: async () => ({})
      };
      expect(await createConnection({ server: { engine } }).run('f', { data: rows })).toEqual({
        status: 'unavailable',
        reason: 'load-failed',
        message: sentence
      });
    }
    const { engine } = stubEngine({
      impl: () => {
        throw Object.assign(new Error(''), { unreachable: true });
      }
    });
    expect((await createConnection({ server: { engine } }).run('f', { data: rows })).message).toBe(
      sentence
    );
  });

  it('RCON-SRV-011: a server form’s computedBy may hold computed_at beside r_version and gsm_bio_version, each text; white space around each is trimmed in the record handed with an answer, and a member that is not text is refused in a sentence that names all three (#127)', async () => {
    const { engine } = stubEngine();
    const connection = createConnection({
      server: {
        engine,
        computedBy: {
          r_version: '  4.5.1 ',
          gsm_bio_version: ' 0.4.0\n',
          computed_at: '\t2026-10-09T08:00:00Z '
        }
      }
    });
    expect((await connection.run('f', { data: rows })).computedBy).toEqual({
      r_version: '4.5.1',
      gsm_bio_version: '0.4.0',
      computed_at: '2026-10-09T08:00:00Z'
    });
    const one = createConnection({ server: { engine, computedBy: { r_version: ' 4.5.1' } } });
    expect((await one.run('f', { data: rows })).computedBy).toEqual({ r_version: '4.5.1' });
    for (const computedBy of [
      { r_version: '4.5.1', computed_at: 20261009 },
      { r_version: '4.5.1', gsm_bio_version: '  ' },
      { gsm_bio_version: '0.4.0' }
    ]) {
      expect(() => createConnection({ server: { engine, computedBy } })).toThrow(
        'bio.viz: `server.computedBy` must be { r_version, gsm_bio_version, computed_at }, each text'
      );
    }
  });

  it('RCON-SRV-006: a server form is refused when the connection is created if it is not an object of settings, if its engine is missing or lacks start or call, or if a browser form is given with it (#122)', () => {
    const { engine } = stubEngine();
    expect(() => createConnection({ server: 'https://example.org/r' })).toThrow(TypeError);
    expect(() => createConnection({ server: {} })).toThrow(/server\.engine/);
    expect(() => createConnection({ server: { engine: { start() {} } } })).toThrow(
      /server\.engine/
    );
    expect(() => createConnection({ server: { engine }, browser: { engine } })).toThrow(
      /`browser` or `server`, not both/
    );
    // Absent or null is no server form, as for the browser form.
    expect(() => createConnection({ server: null })).not.toThrow();
  });
});
