import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

// The connection to R in a real page (#2), from the committed bundle. What these
// tests add to the unit tests is the browser's own account of the network: which
// requests the page made, and when.
//
// No test here reaches the internet or runs R. Where a test needs webR to
// "load", the stand-in module in fixtures/fake-webr/ is served in its place.
// Real R is exercised by the R check page.

const fakeWebR = readFileSync(new URL('./fixtures/fake-webr/webr.mjs', import.meta.url), 'utf8');

const rows = [
  { ARM: 'Placebo', AVAL: 1.2 },
  { ARM: 'Active', AVAL: 2.4 }
];

// Opens the fixture and returns the list that every later request is added to.
async function openFixture(page) {
  await page.goto('/tests/e2e/fixtures/r-connection.html');
  await page.waitForFunction(() => typeof window.BioViz?.r?.createConnection === 'function');
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  return requests;
}

test.describe('connection to R', () => {
  test('RCON-PRE-001: with stored results the page answers without making a network request (#2)', async ({
    page
  }) => {
    const requests = await openFixture(page);
    const result = await page.evaluate(async (data) => {
      const connection = window.BioViz.r.createConnection({
        results: [
          {
            name: 'rank_sum',
            args: { value: 'AVAL', group: 'ARM' },
            dataId: 'opening view',
            rows: 2,
            value: { method: 'Wilcoxon rank-sum test', p_value: 0.0312 }
          }
        ]
      });
      return connection.run('rank_sum', {
        data,
        args: { group: 'ARM', value: 'AVAL' },
        dataId: 'opening view'
      });
    }, rows);

    expect(result).toEqual({
      status: 'ok',
      value: { method: 'Wilcoxon rank-sum test', p_value: 0.0312 },
      form: 'precomputed'
    });
    expect(requests).toEqual([]);
  });

  test('RCON-RES-002: with neither form configured the page answers unavailable, and requests nothing (#2)', async ({
    page
  }) => {
    const requests = await openFixture(page);
    const result = await page.evaluate(
      (data) => window.BioViz.r.createConnection().run('rank_sum', { data }),
      rows
    );
    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('no-r-attached');
    expect(requests).toEqual([]);
  });

  test('RCON-LAZY-004: the browser form requests nothing until the first run, and two simultaneous first runs load webR once (#2)', async ({
    page
  }) => {
    const requests = await openFixture(page);

    // Made, but not yet asked for anything. The location is relative to the page.
    await page.evaluate(() => {
      window.connection = window.BioViz.r.createConnection({
        browser: { baseUrl: 'fake-webr', packages: ['survival'], source: 'rank_sum <- identity' }
      });
    });
    await page.waitForTimeout(300);
    expect(requests).toEqual([]);

    const results = await page.evaluate(
      (data) =>
        Promise.all([
          window.connection.run('rank_sum', { data, args: { value: 'AVAL', group: 'ARM' } }),
          window.connection.run('rank_sum', { data, args: { value: 'AVAL', group: 'ARM' } })
        ]),
      rows
    );
    expect(results).toEqual([
      {
        status: 'ok',
        value: {
          method: 'Wilcoxon rank-sum test',
          p_value: 0.0312,
          counts: { Placebo: 86, Active: 84 }
        },
        form: 'browser'
      },
      {
        status: 'ok',
        value: {
          method: 'Wilcoxon rank-sum test',
          p_value: 0.0312,
          counts: { Placebo: 86, Active: 84 }
        },
        form: 'browser'
      }
    ]);

    // One request, for the module, at the configured location.
    expect(requests.map((url) => new URL(url).pathname)).toEqual([
      '/tests/e2e/fixtures/fake-webr/webr.mjs'
    ]);
    const engine = await page.evaluate(() => ({
      evaluations: window.__fakeWebR.evaluations,
      instances: window.__fakeWebR.instances.length,
      baseUrl: window.__fakeWebR.instances[0].options.baseUrl,
      channelType: window.__fakeWebR.instances[0].options.channelType,
      attached: window.__fakeWebR.instances[0].attached
    }));
    expect(engine.evaluations).toBe(1);
    expect(engine.instances).toBe(1);
    expect(new URL(engine.baseUrl).pathname).toBe('/tests/e2e/fixtures/fake-webr/');
    expect(engine.channelType).toBe(3);
    expect(engine.attached).toEqual(['survival']);

    // A later run reuses what was loaded.
    await page.evaluate((data) => window.connection.run('rank_sum', { data }), rows);
    expect(requests).toHaveLength(1);
  });

  test('RCON-WEBR-001: by default the page asks the public CDN for webR 0.6.0, and only on the first run (#2)', async ({
    page
  }) => {
    // Answered here, so the test never leaves the machine.
    const asked = [];
    await page.route('https://webr.r-wasm.org/**', (route) => {
      asked.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        headers: { 'access-control-allow-origin': '*' },
        body: fakeWebR
      });
    });
    await openFixture(page);

    await page.evaluate(() => {
      window.connection = window.BioViz.r.createConnection({ browser: {} });
    });
    await page.waitForTimeout(300);
    expect(asked).toEqual([]);

    const result = await page.evaluate((data) => window.connection.run('rank_sum', { data }), rows);
    expect(result.status).toBe('ok');
    expect(asked).toEqual(['https://webr.r-wasm.org/v0.6.0/webr.mjs']);
  });

  test('RCON-LAZY-003: when webR cannot be fetched the page answers unavailable with the cause (#2)', async ({
    page
  }) => {
    await openFixture(page);
    const result = await page.evaluate(
      (data) =>
        window.BioViz.r
          .createConnection({ browser: { baseUrl: 'nothing-here' } })
          .run('rank_sum', { data }),
      rows
    );
    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('load-failed');
    expect(result.message).toMatch(/^Statistics are unavailable: R could not be started \(/);
  });

  test('PVAL-FMT-001: a page formats a result from the connection with its method and counts (#2)', async ({
    page
  }) => {
    await openFixture(page);
    const formatted = await page.evaluate(async (data) => {
      const connection = window.BioViz.r.createConnection({ browser: { baseUrl: 'fake-webr' } });
      const result = await connection.run('rank_sum', { data });
      return window.BioViz.r.formatStatistic(result.value);
    }, rows);
    expect(formatted).toEqual({
      status: 'shown',
      text: 'Wilcoxon rank-sum test: p = 0.031 (Placebo n = 86, Active n = 84). Exploratory, unadjusted.'
    });
  });
});
