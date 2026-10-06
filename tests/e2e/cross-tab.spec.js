import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { compareValues, TOLERANCE } from '../../site/r-check/check.mjs';
import { describeAnswer } from '../../src/cross-tab/statistic.js';
import { captureEvidence, captureGallery } from './evidence.js';
import {
  expectDropsCounted,
  expectFailureSaid,
  expectNobodyWithOrphans,
  expectReplacedConnectionDead,
  expectSettingsRefused,
  expectTablesAndSettingsTogether
} from './review.js';

// The cross-tabulation in a real page (#44): safety.viz's vendored bundle and
// bio.viz's committed bundle, loaded as two script tags, drawing the vendored
// synthetic study. `npm run test:e2e -- cross-tab` runs this file.
//
// Every group but the last reaches no network and runs no R: the test is asked
// of a connection with no R attached, or of results desktop R stored. The last
// group, "live", opens the gallery's demo and runs real R from webR's public
// CDN, and holds what it answers to desktop R's.

const readJson = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
// What desktop R makes of each table (tools/r-cross-tab.R). No number below was typed.
const fromR = readJson('../fixtures/cross-tab-r.json');
const caseOf = (name) => fromR.cases.find((entry) => entry.case === name);
const keyed = ({ name, args, dataId, rows, value }) => ({ name, args, dataId, rows, value });
const stored = (...names) => names.map(caseOf).map(keyed);
const FIXTURE = '/tests/e2e/fixtures/cross-tab.html';
const NO_R = 'Statistics are unavailable: no R is attached to this chart.';
const CRP_MEDIAN = { measure: 'CRP', visit: 'Baseline', cut: 'median' };
const CRP_TYPED = { measure: 'CRP', visit: 'Baseline', cut: [8] };

const blockR = (page) =>
  page.route(/^https:\/\/(webr|repo)\.r-wasm\.org\//, (route) => route.abort());

function watch(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

async function open(page, { data = 'both', settings = null, make = true } = {}) {
  await blockR(page);
  await page.addInitScript((given) => {
    window.__ctSettings = given || {};
  }, settings);
  await page.goto(`${FIXTURE}?data=${data}${make ? '' : '&make=no'}`);
  await page.evaluate(() => window.__ct.ready);
}

const root = (page) => page.locator('#chart > .bv-cross-tab');
const line = (page) => root(page).locator('.sv-main > .bv-statistic');
const footnote = (page) => root(page).locator('.sv-footnote');

const withStored = (page, results, settings = {}) =>
  page.evaluate(
    ({ results, settings }) => {
      window.__ct.chart.setSettings({
        ...settings,
        connection: window.BioViz.r.createConnection({ results })
      });
    },
    { results, settings }
  );

// The table as drawn: the categories each way, each cell's count and
// percentage, and the totals, read from the page.
const tableOf = (page) =>
  page.evaluate(() => {
    const table = document.querySelector('#chart .bv-crosstab');
    const cols = [...table.querySelectorAll('thead th')].slice(1, -1).map((th) => th.textContent);
    const body = [...table.querySelectorAll('tbody tr')];
    return {
      caption: table.querySelector('caption').textContent,
      rows: body.map((tr) => tr.querySelector('th').textContent),
      cols,
      counts: body.map((tr) =>
        [...tr.querySelectorAll('td.bv-cell button')].map((button) =>
          Number(button.firstChild.textContent)
        )
      ),
      percents: body.map((tr) =>
        [...tr.querySelectorAll('td.bv-cell button')].map((button) => {
          const percent = button.querySelector('.bv-percent');
          return percent ? percent.textContent : null;
        })
      ),
      rowTotals: body.map((tr) => Number(tr.querySelector('td.bv-total').textContent)),
      colTotals: [...table.querySelectorAll('tfoot td')]
        .slice(0, -1)
        .map((td) => Number(td.textContent)),
      total: Number([...table.querySelectorAll('tfoot td')].at(-1).textContent)
    };
  });

// The stacked bars, read from the chart itself.
const barsOf = (page) =>
  page.evaluate(() => {
    const [chart] = window.__ct.chart.charts;
    return {
      labels: chart.data.labels,
      datasets: chart.data.datasets.map((dataset) => ({
        label: dataset.label,
        data: dataset.data
      })),
      stacked: [chart.options.scales.x.stacked, chart.options.scales.y.stacked],
      max: chart.options.scales.x.max
    };
  });

function expectTable(drawn, entry, percent = 'row') {
  expect(drawn.rows).toEqual(entry.row_levels);
  expect(drawn.cols).toEqual(entry.col_levels);
  expect(drawn.counts).toEqual(entry.counts);
  expect(drawn.rowTotals).toEqual(entry.row_totals);
  expect(drawn.colTotals).toEqual(entry.col_totals);
  expect(drawn.total).toBe(entry.total);
  const expected =
    percent === 'none'
      ? entry.counts.map((row) => row.map(() => null))
      : percent === 'row'
        ? entry.row_percent_text
        : entry.col_percent_text;
  expect(drawn.percents).toEqual(expected);
}

const resultText = (entry) => describeAnswer({ status: 'ok', value: entry.value }).text;

test.describe('cross-tabulation: the page and the two bundles', () => {
  test('CT-KIT-001: the chart is built from safety.viz’s kit on the page and draws its bars with the kit’s Chart.js; without safety.viz it says what is missing (#44)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page);
    const found = await page.evaluate(() => ({
      ownChart: 'Chart' in window.BioViz,
      drawsWithKit: window.__ct.chart.charts.every(
        (chart) => chart instanceof window.SafetyViz.kit.Chart
      ),
      charts: window.__ct.chart.charts.length,
      root: document.querySelector('#chart > .sv-root').className,
      sections: [...document.querySelectorAll('#chart .sv-section-title')].map(
        (title) => title.textContent
      )
    }));
    expect(found).toEqual({
      ownChart: false,
      drawsWithKit: true,
      charts: 1,
      root: 'sv-root bv-cross-tab',
      sections: ['Table', 'Statistics', 'Filters']
    });
    expect(errors).toEqual([]);
    await page.goto('/tests/e2e/fixtures/index.html');
    const message = await page.evaluate(() => {
      try {
        window.BioViz.crossTab(document.body, {});
        return 'made';
      } catch (error) {
        return error.message;
      }
    });
    expect(message).toMatch(
      /^bio\.viz: the cross-tabulation is built from safety\.viz's kit, and `SafetyViz\.kit` was not found\./
    );
  });
});

test.describe('cross-tabulation: what is drawn', () => {
  test('CT-DRAW-001: arm by response: every count, the totals and each row’s percentages are desktop R’s, and the stacked bars are the same percentages (#44)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page);
    const entry = caseOf('arm-by-response-chisq');
    const drawn = await tableOf(page);
    expect(drawn.caption).toBe('ARM by RESPONSE');
    expectTable(drawn, entry);
    const bars = await barsOf(page);
    expect(bars.labels).toEqual(entry.row_levels);
    expect(bars.datasets.map((dataset) => dataset.label)).toEqual(entry.col_levels);
    bars.datasets.forEach((dataset, j) =>
      dataset.data.forEach((value, i) => expect(value).toBeCloseTo(entry.row_percent[i][j], 12))
    );
    expect(bars.stacked).toEqual([true, true]);
    expect(bars.max).toBe(100);
    await expect(root(page).locator('.sv-notes')).toContainText(
      '200 of 200 participants in the table.'
    );
    // The gallery's picture of the chart, with R's answer stored in the page.
    await withStored(page, stored('arm-by-response-chisq'));
    await expect(line(page).locator('.bv-stat-result')).toHaveText(resultText(entry));
    expect(errors).toEqual([]);
    await captureEvidence(page.locator('.sv-main'), 'CT-DRAW-001', 'arm-by-response');
    // The gallery's picture: the chart's frame titled as its demo is, with its
    // footnotes and its own last (#66).
    await page.evaluate((titles) => window.__ct.chart.setSettings(titles), {
      title: '{rows} by {columns}',
      subtitle: '{n} participants',
      footnotes: [
        'Synthetic study from gsm.bio: no real participant is shown.',
        'Filters: {filters}.'
      ]
    });
    await captureGallery(page.locator('#chart .sv-main'), 'CT-DRAW-001');
  });

  test('CT-DRAW-002: column percentages are each count of its column’s total, and the bars then stack each column by the rows; with none there are no percentages (#44)', async ({
    page
  }) => {
    await open(page, { settings: { percent: 'col' } });
    const entry = caseOf('arm-by-response-chisq');
    expectTable(await tableOf(page), entry, 'col');
    const bars = await barsOf(page);
    expect(bars.labels).toEqual(entry.col_levels);
    expect(bars.datasets.map((dataset) => dataset.label)).toEqual(entry.row_levels);
    bars.datasets.forEach((dataset, i) =>
      dataset.data.forEach((value, j) => expect(value).toBeCloseTo(entry.col_percent[i][j], 12))
    );
    await root(page).locator('select[data-control="percent"]').selectOption('none');
    expectTable(await tableOf(page), entry, 'none');
  });

  test('CT-DRAW-003: a biomarker cut by the shared cut rule makes the columns, low to high, with desktop R’s counts, and the footnote states the cut; the Columns control offers it (#44)', async ({
    page
  }) => {
    await open(page, {
      settings: { row_by: 'RESPONSE', col_by: CRP_MEDIAN, cuts: [CRP_TYPED] }
    });
    const entry = caseOf('response-by-crp-median-chisq');
    expectTable(await tableOf(page), entry);
    await expect(footnote(page)).toContainText(
      'CRP at Baseline is cut at its median, 2.783, worked out on the 200 participants with a value. ' +
        'Every participant the filters keep with a value is cut, whether or not they have a category the other way.'
    );
    const offered = await root(page)
      .locator('select[data-control="col-by"] option')
      .allTextContents();
    expect(offered).toContain('CRP at Baseline, cut at the median');
    expect(offered).toContain('CRP at Baseline, cut at 8');
    await captureEvidence(page.locator('.sv-main'), 'CT-DRAW-003', 'response-by-crp-median');
  });
});

test.describe('cross-tabulation: the statistics line', () => {
  test('CT-STAT-005: with R’s answers stored in the page, the chi-square and Fisher results print with their method and counts, Fisher’s odds ratio with its interval, and the identity R wrote is the chart’s (#44)', async ({
    page
  }) => {
    await open(page);
    await withStored(page, stored('arm-by-response-chisq', 'arm-by-response-fisher'));
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    await expect(line(page).locator('.bv-stat-result')).toHaveText(
      resultText(caseOf('arm-by-response-chisq'))
    );
    await expect(line(page).locator('.bv-stat-scope')).toHaveText(
      'This test is of the 200 participants in the table.'
    );
    await root(page).locator('select[data-control="test"]').selectOption('fisher');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    await expect(line(page).locator('.bv-stat-result')).toHaveText(
      resultText(caseOf('arm-by-response-fisher'))
    );
    await expect(line(page).locator('.bv-stat-estimate')).toHaveText(
      'odds ratio (Placebo / Treatment, odds of Non-responder against Responder): 1.292, 95% confidence interval 0.6994 to 2.398.'
    );
    const [asked] = await page.evaluate(() => window.__ct.chart.statistics());
    expect(keyed({ ...asked, value: asked.answer.value })).toEqual(
      keyed(caseOf('arm-by-response-fisher'))
    );
    await captureEvidence(root(page).locator('.sv-main'), 'CT-STAT-005', 'fisher-with-odds-ratio');
  });

  test('CT-STAT-015: with the arms named as doses, the table draws 2 mg before 10 mg, R is handed the rows in that order, and Fisher’s odds ratio is printed as R gave it for the table drawn, named 2 mg over 10 mg (#78)', async ({
    page
  }) => {
    await open(page, { make: false });
    const dose = caseOf('dose-by-response-fisher');
    await page.evaluate((results) => {
      const { data } = window.__ct;
      const doses = { Placebo: '2 mg', Treatment: '10 mg' };
      const participants = data.participants.map((row) => ({ ...row, ARM: doses[row.ARM] }));
      const chart = window.BioViz.crossTab('#chart', {
        row_by: 'ARM',
        col_by: 'RESPONSE',
        baseline_visits: 'Baseline',
        test: 'fisher',
        connection: window.BioViz.r.createConnection({ results })
      });
      window.__ct.chart = chart;
      chart.init({ ...data, participants });
    }, stored('dose-by-response-fisher'));
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const table = await tableOf(page);
    expect(table.rows).toEqual(['2 mg', '10 mg']);
    expect(table.cols).toEqual(['Non-responder', 'Responder']);
    expect(table.counts).toEqual(dose.counts);
    await expect(line(page).locator('.bv-stat-estimate')).toHaveText(
      'odds ratio (2 mg / 10 mg, odds of Non-responder against Responder): 1.292, 95% confidence interval 0.6994 to 2.398.'
    );
    const [asked] = await page.evaluate(() => window.__ct.chart.statistics());
    expect(asked.args.chrRowGroups).toEqual(table.rows);
    expect(keyed({ ...asked, value: asked.answer.value })).toEqual(keyed(dose));
  });

  test('CT-STAT-006: R’s small-expected-count warning is printed with the result for a table with an expected count below 5, and not for one without (#44)', async ({
    page
  }) => {
    await open(page);
    await withStored(page, stored('response-by-crp-typed-chisq', 'response-by-crp-median-chisq'), {
      row_by: 'RESPONSE',
      col_by: CRP_TYPED
    });
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const small = caseOf('response-by-crp-typed-chisq');
    expect(small.value.rows.some((row) => row.small_expected)).toBe(true);
    await expect(line(page).locator('.bv-stat-remark')).toHaveText([
      `R warned: ${small.value.warnings[0]}`,
      `R’s note: ${small.value.notes[0]}`
    ]);
    await captureEvidence(root(page).locator('.sv-main'), 'CT-STAT-006', 'small-expected-counts');
    await page.evaluate(() =>
      window.__ct.chart.setSettings({
        col_by: { measure: 'CRP', visit: 'Baseline', cut: 'median' }
      })
    );
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expect(
      caseOf('response-by-crp-median-chisq').value.rows.some((row) => row.small_expected)
    ).toBe(false);
    await expect(line(page).locator('.bv-stat-remark')).toHaveCount(0);
  });

  test('CT-STAT-007: with no R attached the line says statistics are unavailable, the table and the bars are still drawn, and nothing is fetched (#44)', async ({
    page
  }) => {
    const requests = [];
    page.on('request', (request) => requests.push(new URL(request.url()).hostname));
    await open(page);
    await expect(line(page)).toHaveText(NO_R);
    expectTable(await tableOf(page), caseOf('arm-by-response-chisq'));
    expect((await barsOf(page)).labels).toHaveLength(2);
    expect(requests.filter((host) => /r-wasm/.test(host))).toEqual([]);
    // No test chosen: no R is asked.
    await root(page).locator('select[data-control="test"]').selectOption('none');
    await expect(line(page)).toHaveText('Statistics: no test chosen.');
    expect(await page.evaluate(() => window.__ct.chart.statistics())).toEqual([]);
  });

  test('CT-STAT-008: the test is of the participants the filters keep, as desktop R gives it for the women alone, and the line says the filter (#44)', async ({
    page
  }) => {
    await open(page);
    await withStored(page, stored('arm-by-response-women-chisq'));
    await root(page).locator('select[data-filter="SEX"]').selectOption('F');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expectTable(await tableOf(page), caseOf('arm-by-response-women-chisq'));
    await expect(line(page).locator('.bv-stat-result')).toHaveText(
      resultText(caseOf('arm-by-response-women-chisq'))
    );
    await expect(line(page).locator('.bv-stat-scope')).toHaveText(
      'This test is of the 91 participants in the table. Filters: SEX is F.'
    );
  });

  test('CT-STAT-011: a table R withholds prints R’s reason, with the table’s variables named in it, and no number (#44, #58)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page);
    const small = caseOf('response-by-crp-10-chisq');
    await withStored(page, stored('response-by-crp-10-chisq'), {
      row_by: 'RESPONSE',
      col_by: { measure: 'CRP', visit: 'Baseline', cut: [10] }
    });
    await expect(line(page)).toHaveAttribute('data-state', 'withheld');
    const [, margin] = small.value.reason.match(/^Not computed: col = (.*?) has /);
    await expect(line(page)).toContainText(
      `Not computed: CRP at Baseline, cut at 10 = ${margin} has `
    );
    await expect(line(page)).not.toContainText('col =');
    await expect(line(page)).not.toContainText('p =');
    expect(errors).toEqual([]);
  });

  test('CT-STAT-018: for a table with a column below R’s minimum group size, the page prints Fisher’s exact test as R computed it, with R’s note naming the table’s variable, and at 390px does not scroll sideways; the chi-square test of the same table still prints R’s reason and no number (#104)', async ({
    browser
  }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = watch(page);
    await open(page);
    const CUT = (at) => ({ measure: 'CRP', visit: 'Baseline', cut: [at] });
    await withStored(
      page,
      stored('response-by-crp-9.5-fisher', 'response-by-crp-10-fisher', 'response-by-crp-10-chisq'),
      { row_by: 'RESPONSE', col_by: CUT(9.5), test: 'fisher' }
    );
    // Three participants above the cut: Fisher's exact test, as R computed it.
    const three = caseOf('response-by-crp-9.5-fisher');
    expect(three.col_totals).toEqual([197, 3]);
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expectTable(await tableOf(page), three);
    await expect(line(page).locator('.bv-stat-result')).toHaveText(
      "Fisher's Exact Test for Count Data: p = 0.556 (n = 200). Exploratory, unadjusted."
    );
    await expect(line(page).locator('.bv-stat-result')).toHaveText(resultText(three));
    await expect(line(page).locator('.bv-stat-estimate')).toHaveText(
      /^odds ratio \(Non-responder \/ Responder, odds of ≤ 9\.5 against > 9\.5\): [\d.]+, 95% confidence interval [\d.]+ to [\d.]+\.$/
    );
    await expect(line(page).locator('.bv-stat-remark')).toHaveText([
      "R’s note: Fisher's exact test is exact at any count, so the minimum group size of 5 is not applied to it. Below it here: CRP at Baseline, cut at 9.5 = > 9.5 has 3."
    ]);
    await expect(line(page)).not.toContainText('col =');
    const [asked] = await page.evaluate(() => window.__ct.chart.statistics());
    expect(keyed({ ...asked, value: asked.answer.value })).toEqual(keyed(three));
    const measure = () =>
      page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
      }));
    expect(await measure()).toEqual({ viewport: 390, scrollWidth: 390 });

    // Two above the cut: R's p-value is 1, which fisher.test() returns a
    // rounding above it. It is printed, as the largest a p-value is shown.
    const two = caseOf('response-by-crp-10-fisher');
    expect(two.col_totals).toEqual([198, 2]);
    expect(two.value.p_value).toBeGreaterThan(1);
    await page.evaluate((col_by) => window.__ct.chart.setSettings({ col_by }), CUT(10));
    await expect(line(page).locator('.bv-stat-result')).toHaveText(
      "Fisher's Exact Test for Count Data: p > 0.999 (n = 200). Exploratory, unadjusted."
    );
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expectTable(await tableOf(page), two);
    await expect(line(page).locator('.bv-stat-remark')).toContainText([
      'Below it here: CRP at Baseline, cut at 10 = > 10 has 2.'
    ]);

    // The same table by chi-square: the minimum group size still stops it.
    await page.evaluate(() => window.__ct.chart.setSettings({ test: 'chisq' }));
    await expect(line(page)).toHaveAttribute('data-state', 'withheld');
    await expect(line(page)).toContainText(
      'Not computed: CRP at Baseline, cut at 10 = > 10 has 2. The minimum group size is 5.'
    );
    await expect(line(page)).not.toContainText('p =');
    await expect(line(page)).not.toContainText('p >');
    expect(await measure()).toEqual({ viewport: 390, scrollWidth: 390 });
    expect(errors).toEqual([]);
    await context.close();
  });

  test('CT-STAT-012: after a filter changes, the answer to the table no longer on screen is dropped when it arrives; the line shows the answer for the table drawn (#44, #58)', async ({
    page
  }) => {
    await open(page);
    // A connection whose answers arrive when the test says.
    await page.evaluate(() => {
      window.__pending = [];
      window.__ct.chart.setSettings({
        connection: {
          run: (name, request) =>
            new Promise((resolve) => window.__pending.push({ request, resolve }))
        }
      });
    });
    await expect(line(page)).toHaveAttribute('data-state', 'waiting');
    // The women alone: a second question; the first is still unanswered.
    await root(page).locator('select[data-filter="SEX"]').selectOption('F');
    await expect.poll(() => page.evaluate(() => window.__pending.length)).toBe(2);
    const rows = await page.evaluate(() =>
      window.__pending.map((asked) => asked.request.data.length)
    );
    expect(rows).toEqual([
      caseOf('arm-by-response-chisq').rows,
      caseOf('arm-by-response-women-chisq').rows
    ]);
    // The women's answer first, then the late answer for everyone.
    await page.evaluate(
      (value) => window.__pending[1].resolve({ status: 'ok', value }),
      caseOf('arm-by-response-women-chisq').value
    );
    await expect(line(page).locator('.bv-stat-result')).toHaveText(
      resultText(caseOf('arm-by-response-women-chisq'))
    );
    await page.evaluate(
      (value) => window.__pending[0].resolve({ status: 'ok', value }),
      caseOf('arm-by-response-chisq').value
    );
    await page.waitForTimeout(250);
    await expect(line(page).locator('.bv-stat-result')).toHaveText(
      resultText(caseOf('arm-by-response-women-chisq'))
    );
    const asked = await page.evaluate(() => window.__ct.chart.statistics());
    expect(asked).toHaveLength(1);
    expect(asked[0].rows).toBe(caseOf('arm-by-response-women-chisq').rows);
  });

  test('CT-STAT-013: changing what the percentages are of redraws the table and the bars and asks R nothing: the line keeps R’s answer (#44, #58)', async ({
    page
  }) => {
    await page.addInitScript(() => {
      window.__runs = 0;
    });
    await open(page);
    await page.evaluate((results) => {
      const stored = window.BioViz.r.createConnection({ results });
      window.__ct.chart.setSettings({
        connection: {
          run: (...args) => {
            window.__runs += 1;
            return stored.run(...args);
          }
        }
      });
    }, stored('arm-by-response-chisq'));
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const before = await page.evaluate(() => window.__runs);
    expect(before).toBe(1);
    const said = await line(page).textContent();
    await root(page).locator('select[data-control="percent"]').selectOption('col');
    expectTable(await tableOf(page), caseOf('arm-by-response-chisq'), 'col');
    expect((await barsOf(page)).labels).toEqual(caseOf('arm-by-response-chisq').col_levels);
    await root(page).locator('select[data-control="percent"]').selectOption('none');
    expectTable(await tableOf(page), caseOf('arm-by-response-chisq'), 'none');
    expect(await page.evaluate(() => window.__runs)).toBe(before);
    await expect(line(page)).toHaveText(said);
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
  });
});

test.describe('cross-tabulation: listing and participant profile', () => {
  test('CT-LIST-001: clicking a count lists that cell’s participants in the kit’s listing, and a row of it opens the participant’s profile (#44)', async ({
    page
  }) => {
    await open(page);
    const entry = caseOf('arm-by-response-chisq');
    await root(page).locator('.bv-cell button[data-row="Treatment"][data-col="Responder"]').click();
    const n = entry.counts[1][1];
    await expect(page.locator('.sv-listing-actions strong')).toHaveText(`${n} of ${n} records`);
    await expect(page.locator('.sv-listing thead th')).toHaveText([
      'Participant',
      'ARM',
      'RESPONSE'
    ]);
    await expect(footnote(page)).toHaveText(
      `ARM Treatment, RESPONSE Responder: ${n} participants listed. Click a row to open the participant's profile.`
    );
    const listed = await page.evaluate(() =>
      window.__ct.chart.host.currentTableData.map((row) => [row.ARM, row.RESPONSE])
    );
    expect(new Set(listed.map(String))).toEqual(new Set(['Treatment,Responder']));
    // The participants listed are the ones R puts in that cell.
    const inCell = entry.ids.filter(
      (id, index) => entry.row_of[index] === 'Treatment' && entry.col_of[index] === 'Responder'
    );
    const ids = await page.evaluate(() =>
      window.__ct.chart.host.currentTableData.map((row) => row.USUBJID)
    );
    expect([...ids].sort()).toEqual([...inCell].sort());
    // A row opens that participant's profile: the rail names them, and named
    // nobody before.
    const rail = page.locator('#chart .sv-rail');
    const first = await page
      .locator('.sv-listing tbody tr')
      .first()
      .locator('td')
      .first()
      .textContent();
    expect(inCell).toContain(first);
    await expect(rail).not.toContainText(first);
    await page.locator('.sv-listing tbody tr').first().click();
    await expect(rail).toContainText(first);
    await captureEvidence(page.locator('.sv-listing'), 'CT-LIST-001', 'participants-of-a-cell');
  });
});

test.describe('cross-tabulation: on a phone and on the site', () => {
  test('CT-MOBILE-001: at 390px the controls are folded away, the table fits or scrolls inside its own box, and the page does not scroll sideways (#44)', async ({
    browser
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await open(page, { settings: { row_by: 'RESPONSE', col_by: CRP_TYPED } });
    const measure = () =>
      page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
      }));
    expect(await measure()).toEqual({ viewport: 390, scrollWidth: 390 });
    await expect(root(page)).toHaveClass(/sv-collapsed/);
    await captureEvidence(root(page), 'CT-MOBILE-001', 'the-table-on-a-phone');
    await context.close();
  });

  test('CT-SITE-002: the gallery lists the chart with links to its live demo, its evidence page and its API reference, and the demo opens on arm by response (#44)', async ({
    page
  }) => {
    await blockR(page);
    await page.goto('/_site/gallery/index.html');
    const card = page.locator('#charts [data-module="cross-tab"]');
    await expect(card.locator('h3')).toHaveText('Cross-tabulation');
    await expect(card).toContainText('Is this category associated with that one?');
    await card.getByRole('link', { name: 'Evidence' }).click();
    await expect(page).toHaveURL(/\/_site\/cross-tab\/evidence\.html$/);
    await page.locator('.page-tabs').getByRole('link', { name: 'API reference' }).click();
    await expect(page.locator('h1')).toHaveText('The cross-tabulation');
    await expect(page.locator('.api-body h2 code').filter({ hasText: /^crossTab\(/ })).toHaveCount(
      1
    );
    await page.locator('.site-nav').getByRole('link', { name: 'Gallery' }).click();
    await card.getByRole('link', { name: 'Demo', exact: true }).click();
    await expect(page).toHaveURL(/\/_site\/cross-tab\/index\.html$/);
    await expect(page.locator('h1')).toHaveText('Cross-tabulation');
    // The URL is the demo's before its scripts have run: wait for them.
    await page.waitForFunction(() => Boolean(window.BioVizDemo && window.BioVizDemo.ready));
    await page.evaluate(() => window.BioVizDemo.ready);
    const drawn = await tableOf(page);
    expect(drawn.rows).toEqual(['Placebo', 'Treatment']);
    expect(drawn.counts).toEqual(caseOf('arm-by-response-chisq').counts);
    // Where R cannot be reached the table is drawn all the same, and the line says so.
    await expect(line(page)).toHaveAttribute('data-state', 'unavailable');
    const offered = await root(page)
      .locator('select[data-control="col-by"] option')
      .allTextContents();
    expect(offered).toContain('CRP at Baseline, cut at the median');
  });

  test('CT-SITE-001: the live demo holds at a 390px-wide viewport with no horizontal scroll, with the controls open (#44)', async ({
    browser
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await blockR(page);
    await page.goto('/_site/cross-tab/index.html');
    await page.evaluate(() => window.BioVizDemo.ready);
    const measure = () =>
      page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth
      }));
    const holds = { viewport: 390, scrollWidth: 390, bodyScrollWidth: 390 };
    expect(await measure()).toEqual(holds);
    await root(page).locator('.sv-sidebar-toggle').tap();
    await expect(root(page).locator('.sv-controls')).toBeVisible();
    expect(await measure()).toEqual(holds);
    await root(page).locator('.sv-sidebar-toggle').tap();
    await captureEvidence(page.locator('#demo'), 'CT-SITE-001', 'demo-on-a-phone');
    await context.close();
  });
});

test.describe('cross-tabulation: what the v0.1.0-RC1 review found, held here too', () => {
  test('CT-STAT-009: once the connection is replaced, a late answer from the old one changes neither the line nor what chart.statistics() reports (#44)', async ({
    page
  }) => {
    await expectReplacedConnectionDead(page, 'ct');
  });

  test('CT-FAIL-001: when drawing fails the chart says so in its element and keeps its controls, leaving nothing half drawn, and draws again once it can (#44)', async ({
    page
  }) => {
    await expectFailureSaid(page, 'ct', (name) => window[name].chart.charts.length);
  });

  test('CT-DROP-001: with a participant table, participants it does not have and rows with no participant id are counted by reason; a participant table without the id column is refused with a sentence; filters that let nobody through say so; the id column and the table change together (#44)', async ({
    page
  }) => {
    await expectDropsCounted(page, 'ct');
    await expectNobodyWithOrphans(page, 'ct');
    await expectSettingsRefused(page, 'ct');
    await expectTablesAndSettingsTogether(page, 'ct');
  });
});

test.describe('cross-tabulation: the demo, with R in the browser, live', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  let context;
  let page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto('/_site/cross-tab/index.html');
    await page.evaluate(() => window.BioVizDemo.ready);
  });

  test.afterAll(async () => {
    await context.close();
  });

  const answered = () =>
    expect
      .poll(
        () =>
          page.evaluate(() => {
            const found = document.querySelector('#chart > .bv-cross-tab .sv-main > .bv-statistic');
            return found ? found.dataset.state : 'empty';
          }),
        { timeout: 200_000 }
      )
      .not.toMatch(/^(waiting|empty)$/);

  // `names` are the table's own names for its rows and columns, where one of
  // R's notes names a category by the column the chart handed it.
  async function holdToDesktop(name, settings, names) {
    const expected = caseOf(name);
    await page.evaluate((given) => window.BioVizDemo.chart.setSettings(given), settings);
    await answered();
    const [asked] = await page.evaluate(() => window.BioVizDemo.chart.statistics());
    expect(asked.answer.status, `${name}: ${asked.answer.message}`).toBe('ok');
    expect(asked.answer.form).toBe('browser');
    expect({ name: asked.name, args: asked.args, dataId: asked.dataId, rows: asked.rows }).toEqual({
      name: expected.name,
      args: expected.args,
      dataId: expected.dataId,
      rows: expected.rows
    });
    const differing = compareValues(expected.value, asked.answer.value).filter((row) => !row.ok);
    expect(differing, `${name}: within 1 part in ${1 / TOLERANCE.relative}`).toEqual([]);
    expectTable(await tableOf(page), expected);
    await expect(line(page).locator('.bv-stat-result')).toHaveText(resultText(expected));
    const remarks = describeAnswer({ status: 'ok', value: expected.value }, { names }).remarks.map(
      (remark) => remark.text
    );
    await expect(line(page).locator('.bv-stat-remark')).toHaveText(remarks);
    return expected;
  }

  test('CT-LIVE-001: arm by response, by chi-square and by Fisher’s exact test, with R started in this browser: every count, statistic and p-value is desktop R’s (#44)', async () => {
    await holdToDesktop('arm-by-response-chisq', {
      row_by: 'ARM',
      col_by: 'RESPONSE',
      test: 'chisq'
    });
    await holdToDesktop('arm-by-response-fisher', { test: 'fisher' });
    await captureEvidence(root(page).locator('.sv-main'), 'CT-LIVE-001', 'r-in-the-browser');
  });

  test('CT-LIVE-002: response by CRP at Baseline cut at its median, by both tests, and cut at 8, where R warns of small expected counts, are desktop R’s (#44)', async () => {
    await holdToDesktop('response-by-crp-median-chisq', {
      row_by: 'RESPONSE',
      col_by: CRP_MEDIAN,
      test: 'chisq'
    });
    await holdToDesktop('response-by-crp-median-fisher', { test: 'fisher' });
    const small = await holdToDesktop('response-by-crp-typed-chisq', {
      col_by: CRP_TYPED,
      test: 'chisq'
    });
    expect(small.value.notes.length).toBe(1);
  });

  test('CT-LIVE-003: the women alone, by the filter, is desktop R’s (#44)', async () => {
    await page.evaluate(() =>
      window.BioVizDemo.chart.setSettings({ row_by: 'ARM', col_by: 'RESPONSE', test: 'chisq' })
    );
    await answered();
    await root(page).locator('select[data-filter="SEX"]').selectOption('F');
    await answered();
    const expected = caseOf('arm-by-response-women-chisq');
    const [asked] = await page.evaluate(() => window.BioVizDemo.chart.statistics());
    expect(asked.dataId).toEqual(expected.dataId);
    expect(compareValues(expected.value, asked.answer.value).filter((row) => !row.ok)).toEqual([]);
    expectTable(await tableOf(page), expected);
  });

  test('CT-LIVE-004: response by CRP at Baseline cut at 9.5 and at 10, which leave three and two participants above the cut: Fisher’s exact test is computed by R in this browser and is desktop R’s, and the chi-square test of the table cut at 10 is withheld with R’s reason (#104)', async () => {
    // The test before this one left the women alone: everyone again.
    await root(page).locator('select[data-filter="SEX"]').selectOption({ index: 0 });
    await answered();
    const CUT = (at) => ({ measure: 'CRP', visit: 'Baseline', cut: [at] });
    const three = await holdToDesktop(
      'response-by-crp-9.5-fisher',
      { row_by: 'RESPONSE', col_by: CUT(9.5), test: 'fisher' },
      { row: 'RESPONSE', col: 'CRP at Baseline, cut at 9.5' }
    );
    expect(three.col_totals).toEqual([197, 3]);
    await expect(line(page).locator('.bv-stat-result')).toHaveText(
      "Fisher's Exact Test for Count Data: p = 0.556 (n = 200). Exploratory, unadjusted."
    );
    await captureEvidence(
      root(page).locator('.sv-main'),
      'CT-LIVE-004',
      'fisher-on-a-small-margin'
    );
    const two = await holdToDesktop(
      'response-by-crp-10-fisher',
      { col_by: CUT(10) },
      { row: 'RESPONSE', col: 'CRP at Baseline, cut at 10' }
    );
    expect(two.col_totals).toEqual([198, 2]);
    await expect(line(page).locator('.bv-stat-result')).toHaveText(
      "Fisher's Exact Test for Count Data: p > 0.999 (n = 200). Exploratory, unadjusted."
    );
    // By chi-square the same table is withheld, by R, in R's words.
    const small = caseOf('response-by-crp-10-chisq');
    await page.evaluate(() => window.BioVizDemo.chart.setSettings({ test: 'chisq' }));
    await answered();
    await expect(line(page)).toHaveAttribute('data-state', 'withheld');
    const [asked] = await page.evaluate(() => window.BioVizDemo.chart.statistics());
    expect(asked.answer.form).toBe('browser');
    expect(asked.answer.value.status).toBe('too_small');
    expect(asked.answer.value.reason).toBe(small.value.reason);
    await expect(line(page)).toContainText(
      'Not computed: CRP at Baseline, cut at 10 = > 10 has 2. The minimum group size is 5.'
    );
  });
});
