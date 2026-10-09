import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, chromium } from '@playwright/test';
import { compareValues } from '../../site/r-check/check.mjs';
import { captureEvidence } from './evidence.js';

// The connection to R in a real page (#2), from the committed bundle. What these
// tests add to the unit tests is the browser's own account of the network: which
// requests the page made, and when.
//
// The first group reaches no network and runs no R: where a test needs webR to
// "load", the stand-in module in fixtures/fake-webr/ is served in its place.
// The second group, `RCON-LIVE-*`, is the opposite: it opens the R check page
// and runs real R from webR's public CDN.

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

  test('RCON-RES-002: with no form configured the page answers unavailable, and requests nothing (#2)', async ({
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

// ---------------------------------------------------------------------------
// The R check page, for real (#3). These tests need the network: they load webR
// 0.6.0 and the survival package from their public hosts and run R. If those
// hosts cannot be reached the tests fail; nothing here skips, and nothing
// retries.
//
// They run in order on one page, because the states being measured are states
// of one browser: nothing cached, then the same files cached, then R running.
// The browser is started on a new, empty profile with a disk cache, the way a
// first-time visitor's is. (Playwright's ordinary test pages keep their cache in
// memory, which is too small to hold R's 12 MB engine, so a reload there would
// download it again and overstate what a returning visitor pays.)
//
// What is counted, and how:
//
//   megabytes  bytes of response bodies as they crossed the network —
//              compressed where the server compresses — as the browser reports
//              them for each finished request (Playwright's request.sizes(),
//              which reads the DevTools protocol's encodedDataLength). Response
//              headers are not included. A file served from the browser's cache
//              counts as a request and as zero bytes. (For a cached file the
//              browser reports no bytes received, which request.sizes() turns
//              into a small negative number; it is read as zero.)
//   requests   requests for R's own files: webR's host, the package host, and
//              the page's R source. The site's web fonts are left out; they are
//              not part of R.
//   seconds    taken by the page itself, from the call to the result.
//
// The numbers are printed, attached to the test, and written to
// test-results/r-check-measurements.json. With R_CHECK_RECORD=1 they are also
// written to site/r-check/measured.json, which the page shows.

const expectedResults = JSON.parse(
  readFileSync(new URL('../../site/r-check/expected.json', import.meta.url), 'utf8')
);
const R_HOSTS = ['webr.r-wasm.org', 'repo.r-wasm.org'];
const megabytes = (bytes) => Number((bytes / 1e6).toFixed(2));
const toSeconds = (milliseconds) => Number((milliseconds / 1000).toFixed(3));

test.describe('R check page, live', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  let context;
  let page;
  let finished = [];
  const measured = {};
  // What R in the browser answered, kept for the record written at the end.
  const answered = { session: null, values: {} };

  const isRFile = (url) => {
    const { hostname, pathname } = new URL(url);
    return R_HOSTS.includes(hostname) || pathname.endsWith('/r-check/statistics.R');
  };

  // Presses the button, waits for the page to finish, and returns what the
  // browser reports for the requests made in between.
  async function startRAndMeasure() {
    finished = [];
    await page.click('#start-r');
    await page.waitForFunction(
      () => ['done', 'failed'].includes(document.body.dataset.rState),
      null,
      { timeout: 200_000 }
    );
    // Let the last responses be accounted for.
    await page.waitForTimeout(1_000);
    const requests = finished.filter((request) => isRFile(request.url));
    const bytes = requests.reduce((total, request) => total + request.bytes, 0);
    return {
      requests: requests.length,
      requestsOverNetwork: requests.filter((request) => request.bytes > 0).length,
      bytes,
      megabytes: megabytes(bytes),
      files: requests.map((request) => ({
        url: request.url,
        bytes: request.bytes
      }))
    };
  }

  const readPage = () =>
    page.evaluate(() => ({
      state: document.body.dataset.rState,
      browser: window.rCheck.browser,
      precomputed: window.rCheck.precomputed,
      unavailable: window.rCheck.unavailable
    }));

  test.beforeAll(async ({}, testInfo) => {
    const profile = mkdtempSync(path.join(tmpdir(), 'bio-viz-r-check-'));
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 1280, height: 800 }
    });
    page = context.pages()[0] || (await context.newPage());
    page.on('requestfinished', async (request) => {
      const entry = { url: request.url(), bytes: 0 };
      finished.push(entry);
      const sizes = await request.sizes().catch(() => null);
      if (sizes) entry.bytes = Math.max(0, sizes.responseBodySize);
    });
    await page.goto('/_site/r-check/index.html');
    await page.waitForFunction(() => window.rCheck && window.rCheck.ready);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('RCON-LIVE-001: with no R attached the page answers that statistics are unavailable (#3)', async () => {
    const { unavailable } = await readPage();
    expect(unavailable).toEqual({
      status: 'unavailable',
      reason: 'no-r-attached',
      message: 'Statistics are unavailable: no R is attached to this chart.'
    });
    await expect(page.locator('#unavailable-answer')).toHaveText(unavailable.message);
  });

  test("RCON-LIVE-002: the precomputed form gives the desktop-R answers with no R loaded and no request to R's hosts (#3)", async () => {
    const { precomputed, state } = await readPage();
    expect(state).toBe('idle');
    expect(precomputed.map((entry) => entry.name)).toEqual(['rank_sum', 'log_rank']);
    for (const [index, entry] of precomputed.entries()) {
      expect(entry.answer).toEqual({
        status: 'ok',
        value: expectedResults.results[index].value,
        form: 'precomputed'
      });
    }
    await expect(page.locator('#precomputed-answers .answer-text')).toHaveText([
      /^Wilcoxon rank sum test with continuity correction: p < 0\.001 \(Placebo n = 70, Xanomeline High Dose n = 52\)\. Exploratory, unadjusted\.$/,
      /^Log-rank test: p < 0\.001 \(Placebo n = 86, Xanomeline High Dose n = 72, Xanomeline Low Dose n = 96\)\. Exploratory, unadjusted\.$/
    ]);
    // The page has loaded and answered twice, and R has not been asked for.
    expect(finished.filter((request) => R_HOSTS.includes(new URL(request.url).hostname))).toEqual(
      []
    );
    expect(await page.evaluate(() => window.rCheck.browser)).toBe(null);
    await captureEvidence(
      page.locator('#precomputed'),
      'RCON-LIVE-002',
      'answers-shipped-with-the-page'
    );
  });

  test('RCON-LIVE-003: R in the browser gives the rank-sum result desktop R gives, within the stated tolerance (#3)', async ({}, testInfo) => {
    // The first press of the button, in a browser that has cached nothing.
    measured.cold = await startRAndMeasure();
    const { state, browser } = await readPage();
    expect(browser.error).toBe(null);
    expect(state).toBe('done');

    const result = browser.results.find((entry) => entry.name === 'rank_sum');
    answered.values.rank_sum = result.value;
    expect(result.form).toBe('browser');
    // Compared here as well as by the page, from the values themselves.
    const rows = compareValues(expectedResults.results[0].value, result.value);
    expect(rows.filter((row) => !row.ok)).toEqual([]);
    expect(rows.map((row) => row.path)).toContain('p_value');
    await expect(page.locator('.comparison-block[data-test="rank_sum"]')).toHaveAttribute(
      'data-same',
      'true'
    );
    await testInfo.attach('rank-sum-desktop-R-and-webR.json', {
      body: JSON.stringify(
        { desktopR: expectedResults.results[0].value, webR: result.value },
        null,
        2
      ),
      contentType: 'application/json'
    });
  });

  test('RCON-LIVE-004: the survival package installs and loads, and the log-rank result is the one desktop R gives (#3)', async ({}, testInfo) => {
    const { browser } = await readPage();
    // Installed: the package came over the network. Loaded: R reports its version.
    expect(measured.cold.files.some((file) => /\/survival_[^/]+\.tgz$/.test(file.url))).toBe(true);
    expect(browser.session.survival_version).toMatch(/^\d+\.\d+[.-]\d+$/);
    expect(browser.session.r_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(browser.session.platform).toContain('wasm');

    const result = browser.results.find((entry) => entry.name === 'log_rank');
    answered.values.log_rank = result.value;
    answered.session = browser.session;
    const rows = compareValues(expectedResults.results[1].value, result.value);
    expect(rows.filter((row) => !row.ok)).toEqual([]);
    expect(rows.map((row) => row.path)).toContain('groups[2].expected');
    await expect(page.locator('.comparison-block[data-test="log_rank"]')).toHaveAttribute(
      'data-same',
      'true'
    );
    await expect(page.locator('#r-status')).toHaveText(
      'Done. R in this browser gave the same answers as desktop R.'
    );
    await expect(page.locator('#r-session')).toContainText(
      `R in this browser is ${browser.session.r_version} with survival ${browser.session.survival_version}.`
    );
    await testInfo.attach('log-rank-desktop-R-and-webR.json', {
      body: JSON.stringify(
        {
          desktopR: { ...expectedResults.made_by, value: expectedResults.results[1].value },
          webR: { ...browser.session, value: result.value }
        },
        null,
        2
      ),
      contentType: 'application/json'
    });
  });

  test('RCON-LIVE-005: cold, a first visit with nothing cached: megabytes, requests and seconds to the first result (#3)', async () => {
    const { browser } = await readPage();
    measured.cold.seconds = toSeconds(browser.timings.firstResult);
    // Nothing was cached: R's engine alone is several megabytes on the wire.
    expect(measured.cold.megabytes).toBeGreaterThan(5);
    expect(measured.cold.requestsOverNetwork).toBe(measured.cold.requests);
    // One load of webR, from the pinned version on its public CDN.
    expect(measured.cold.files.filter((file) => file.url.endsWith('/webr.mjs'))).toEqual([
      expect.objectContaining({ url: 'https://webr.r-wasm.org/v0.6.0/webr.mjs' })
    ]);
    expect(measured.cold.seconds).toBeGreaterThan(0);
  });

  test('RCON-LIVE-006: reload, the page loaded again with the files cached: R starts again and gives the same answers (#3)', async () => {
    await page.reload();
    await page.waitForFunction(() => window.rCheck && window.rCheck.ready);
    expect(await page.evaluate(() => window.rCheck.browser)).toBe(null);

    measured.reload = await startRAndMeasure();
    const { state, browser } = await readPage();
    expect(state).toBe('done');
    expect(browser.allSame).toBe(true);
    measured.reload.seconds = toSeconds(browser.timings.firstResult);
    // R was started again: its module was asked for again.
    expect(measured.reload.files.some((file) => file.url.endsWith('/webr.mjs'))).toBe(true);
    // And less came over the network than on the first visit.
    expect(measured.reload.bytes).toBeLessThan(measured.cold.bytes);
  });

  test('RCON-LIVE-007: warm, R already running: a repeated call makes no request (#3)', async () => {
    // Once R is up the page runs both tests a second time and times them. The
    // request log was last cleared at the press of the button, so anything a
    // repeated call fetched would be in it after the first-run files; a quiet
    // half second more, with the log cleared, confirms R fetches nothing idle.
    const { browser } = await readPage();
    finished = [];
    await page.waitForTimeout(500);
    const repeat = (name) => browser.timings.repeat.find((entry) => entry.name === name);
    measured.warm = {
      requests: finished.filter((request) => isRFile(request.url)).length,
      requestsOverNetwork: 0,
      bytes: 0,
      megabytes: 0,
      seconds: toSeconds(repeat('rank_sum').milliseconds),
      logRankSeconds: toSeconds(repeat('log_rank').milliseconds)
    };
    expect(measured.warm.requests).toBe(0);
    // Every file R asked for on this page load was asked for before the first
    // result of the second test: the repeated calls added none.
    expect(measured.reload.requests).toBe(measured.cold.requests);
    expect(measured.warm.seconds).toBeLessThan(measured.reload.seconds);
  });

  test('RCON-LIVE-008: the R check page holds at a 390px-wide viewport with its results shown (#3)', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.comparison-block')).toHaveCount(2);
    const layout = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      return {
        viewport,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        overflowing: [...document.querySelectorAll('body *')]
          .filter((el) => el.getBoundingClientRect().right > viewport + 0.5)
          .map((el) => `${el.tagName.toLowerCase()}#${el.id}.${el.className}`)
      };
    });
    expect(layout.viewport).toBe(390);
    expect(layout.scrollWidth).toBe(390);
    expect(layout.bodyScrollWidth).toBe(390);
    expect(layout.overflowing).toEqual([]);
  });

  test('RCON-LIVE-009: the three measurements are recorded where a reader of the run can find them (#3)', async ({
    browser
  }, testInfo) => {
    const record = {
      recorded: new Date().toISOString(),
      browser: `Chromium ${browser.version()}, headless`,
      machine:
        process.env.R_CHECK_MACHINE ||
        (process.env.CI ? 'a GitHub Actions runner (ubuntu-latest)' : 'not named'),
      network: process.env.R_CHECK_NETWORK || 'not recorded',
      profile: 'a new, empty browser profile with a disk cache',
      sizes:
        'compressed bytes of response bodies as received over the network; response headers are not counted, and a file served from the browser cache counts as zero',
      states: Object.fromEntries(
        ['cold', 'reload', 'warm'].map((name) => [
          name,
          {
            megabytes: measured[name].megabytes,
            bytes: measured[name].bytes,
            requests: measured[name].requests,
            requestsOverNetwork: measured[name].requestsOverNetwork,
            seconds: measured[name].seconds
          }
        ])
      ),
      // Both sides of the comparison, every number as the shortest text that
      // reads back as exactly that number.
      answers: {
        desktopR: {
          ...expectedResults.made_by,
          rank_sum: expectedResults.results[0].value,
          log_rank: expectedResults.results[1].value
        },
        webR: { ...answered.session, ...answered.values }
      },
      detail: {
        cold: measured.cold,
        reload: measured.reload,
        warm: measured.warm
      }
    };
    const text = JSON.stringify(record, null, 2) + '\n';
    await testInfo.attach('r-check-measurements.json', {
      body: text,
      contentType: 'application/json'
    });
    mkdirSync(new URL('../../test-results/', import.meta.url), { recursive: true });
    writeFileSync(new URL('../../test-results/r-check-measurements.json', import.meta.url), text);
    if (process.env.R_CHECK_RECORD === '1') {
      const { detail, answers, ...shown } = record;
      writeFileSync(
        new URL('../../site/r-check/measured.json', import.meta.url),
        JSON.stringify(shown, null, 2) + '\n'
      );
    }

    // In the run's log, for anyone reading it without opening the attachment.
    console.log(`\nR check measurements — ${record.browser}, ${record.machine}`);
    console.log('state    megabytes  requests  over-network  seconds');
    for (const name of ['cold', 'reload', 'warm']) {
      const state = measured[name];
      console.log(
        `${name.padEnd(8)} ${String(state.megabytes).padStart(9)}  ${String(state.requests).padStart(8)}  ` +
          `${String(state.requestsOverNetwork ?? 0).padStart(12)}  ${String(state.seconds).padStart(7)}`
      );
    }
    const { desktopR, webR } = record.answers;
    console.log(
      `\nDesktop R ${desktopR.r_version} (survival ${desktopR.survival_version}) beside ` +
        `webR's R ${webR.r_version} (survival ${webR.survival_version})`
    );
    for (const [name, member] of [
      ['rank_sum', 'p_value'],
      ['rank_sum', 'statistic'],
      ['log_rank', 'p_value'],
      ['log_rank', 'statistic']
    ]) {
      console.log(
        `  ${`${name}.${member}`.padEnd(19)} desktop ${String(desktopR[name][member]).padEnd(24)} ` +
          `webR ${String(webR[name][member]).padEnd(24)} ` +
          `difference ${Math.abs(desktopR[name][member] - webR[name][member])}`
      );
    }
    for (const file of measured.cold.files) {
      console.log(`  cold  ${String(file.bytes).padStart(9)} bytes  ${file.url}`);
    }

    for (const name of ['cold', 'reload', 'warm']) {
      expect(Number.isFinite(record.states[name].megabytes)).toBe(true);
      expect(Number.isInteger(record.states[name].requests)).toBe(true);
      expect(record.states[name].seconds).toBeGreaterThan(0);
    }
  });
});
