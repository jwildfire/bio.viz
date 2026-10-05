import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, chromium } from '@playwright/test';
import {
  expectDropsCounted,
  expectFailureSaid,
  expectNobodyWithOrphans,
  expectSettingsRefused,
  expectTablesAndSettingsTogether,
  expectReplacedConnectionDead
} from './review.js';
import { compareValues, TOLERANCE } from '../../site/r-check/check.mjs';
import { formatScreenRow } from '../../src/r/formatStatistic.js';
import { axisRange, placeOf } from '../../src/biomarker-screen/structureData.js';
import { shown as shownValue } from '../../src/shared/chartHost.js';
import { captureEvidence, captureGallery } from './evidence.js';
import {
  CASES as SCREEN_CASES,
  SCREEN_STATISTICS,
  outcomesFor,
  readDemo
} from '../../scripts/screen-statistics-lib.mjs';
import { RULED_FILTERS, expectFilterRules, warningsOf } from './filterRules.js';
import { NOBODY_PASSES, asked, expectNobody, letNobodyThrough, openDemo } from './nobody.js';

// The biomarker screen in a real page (#36): safety.viz's vendored bundle and
// bio.viz's committed bundle, loaded as two script tags, drawing the vendored
// synthetic study. `npm run test:e2e -- screen` runs this file.
//
// Every group but the last reaches no network and runs no R: the screen is
// asked of a connection with no R attached, of a stand-in for R whose answers
// arrive when the test says, or of results desktop R stored. The last group,
// "live", opens the gallery's demo and runs real R from webR's public CDN.

const readJson = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
// What desktop R answered for the frames the chart hands R, each with the key
// the chart asks with (tools/r-screen-statistics.R).
const statistics = readJson('../fixtures/screen-statistics-r.json');
const resultOf = (name) => statistics.results.find((result) => result.case === name);
const keyed = ({ name, args, dataId, rows, value }) => ({ name, args, dataId, rows, value });
const stored = (...names) => names.map(resultOf).map(keyed);
// The single charts' own expected results, for the biomarker a row opens.
const groupStatistics = readJson('../fixtures/group-statistics-r.json');
const scatterStatistics = readJson('../fixtures/association-statistics-r.json');
const fromFixture = (fixture, name) =>
  keyed(fixture.results.find((result) => result.case === name));
const statisticsRecord = readJson('../../site/vendor/gsm.bio/SOURCE.json');
// The demo's tables as the fixture's library reads them, for a case drawn on a
// changed outcomes table: the changed table is the library's, not typed here.
const screenDemo = readDemo(
  Object.fromEntries(
    Object.entries(SCREEN_STATISTICS.sources).map(([name, file]) => [
      name,
      readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
    ])
  )
);
const changedOutcomes = (name) =>
  outcomesFor(
    screenDemo,
    SCREEN_CASES.find((entry) => entry.case === name)
  );
const survivalCase = (name) =>
  readJson('../fixtures/stratified-survival-r.json').cases.find((item) => item.case === name);
const withOutcomes = (page, outcomes) =>
  page.evaluate(
    (given) => window.__bs.chart.setData({ ...window.__bs.data, outcomes: given }),
    outcomes
  );
const FIXTURE = '/tests/e2e/fixtures/biomarker-screen.html';
const R_HOSTS = ['webr.r-wasm.org', 'repo.r-wasm.org'];
const isRHost = (url) => R_HOSTS.includes(new URL(url).hostname);
const NO_R = 'Statistics are unavailable: no R is attached to this chart.';
const NOT_STORED =
  'Statistics are unavailable for this view: the page holds no stored result for it, and no R ' +
  'is attached to compute one.';
const WAITING = 'Statistics: waiting for R…';
const BACK = 'Back to the biomarker screen';
const BIOMARKERS = [
  'CRP',
  'D-dimer',
  'Ferritin',
  'IFN-gamma',
  'IL-1beta',
  'IL-2',
  'IL-6',
  'IL-8',
  'IL-10',
  'LDH',
  'TNF-alpha',
  'VEGF'
];
const ARMS = ['Placebo', 'Treatment'];
const WEEK_4 = { visit: 'Week 4', value_type: 'change', group_by: 'ARM' };
const AGAINST_IL10 = {
  comparison: 'correlation',
  visit: 'Baseline',
  value_type: 'raw',
  with: { measure: 'IL-10', visit: 'Baseline' }
};
const P_VALUE = /\bp\s*[=<>]\s*\d/;

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

async function open(page, { data = 'both', settings = null, before = null, make = true } = {}) {
  if (before) await page.addInitScript(before);
  await page.addInitScript((given) => {
    window.__bsSettings = given || {};
  }, settings);
  await page.goto(`${FIXTURE}?data=${data}${make ? '' : '&make=no'}`);
  await page.evaluate(() => window.__bs.ready);
}

// What the screen shows, read from the page: the heading, the caption, the
// count, the axis's labels, and every row with what a reader sees in it.
const screen = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('#chart > .bv-biomarker-screen');
    const wrap = root.querySelector('.bv-screen');
    if (wrap.hidden) return null;
    const text = (selector, within = wrap) => {
      const found = within.querySelector(selector);
      return found ? found.textContent : null;
    };
    const place = (element) => (element ? Number(parseFloat(element.style.left).toFixed(6)) : null);
    return {
      title: text('.bv-screen-title'),
      caption: text('.bv-screen-caption'),
      names: text('.bv-screen-names'),
      count: text('.bv-overview-count'),
      page: text('.bv-overview-page'),
      ticks: [...wrap.querySelectorAll('.bv-tick')].map((tick) => tick.textContent),
      rows: [...wrap.querySelectorAll('.bv-screen-row')].map((row) => {
        const line = row.querySelector('.bv-interval');
        const value = (selector) => {
          const found = row.querySelector(selector);
          if (!found) return null;
          const label = found.querySelector('.bv-narrow');
          return found.textContent.slice(label ? label.textContent.length : 0);
        };
        return {
          biomarker: row.dataset.biomarker,
          status: row.dataset.status,
          says: row.getAttribute('aria-label'),
          value: value('.bv-screen-value'),
          p: value('.bv-screen-p:not(.bv-screen-adjusted)'),
          adjusted: value('.bv-screen-adjusted'),
          n: value('.bv-screen-n'),
          dot: place(row.querySelector('.bv-estimate')),
          line: line ? [place(line), Number(parseFloat(line.style.width).toFixed(6))] : null,
          zero: place(row.querySelector('.bv-zero'))
        };
      })
    };
  });

// R's rows in the order the chart sorts them by estimate: largest first,
// uncomputed rows after, ties in R's order.
const byEstimate = (rows) =>
  rows
    .map((row, order) => ({ row, order }))
    .sort((a, b) => {
      const [x, y] = [a.row.estimate, b.row.estimate];
      if (x === null && y === null) return a.order - b.order;
      if (x === null) return 1;
      if (y === null) return -1;
      return x === y ? a.order - b.order : y - x;
    })
    .map(({ row }) => row);

// Holds every row on the page to R's answer: the order, the dot and the line
// where R's numbers put them, and every number as the shared formatter prints it.
function expectRows(
  shown,
  value,
  { groups = null, comparison = 'difference', order = byEstimate } = {}
) {
  const expected = order(value.rows);
  expect(shown.rows.map((row) => row.biomarker)).toEqual(expected.map((row) => row.biomarker));
  const computed = value.rows.map((row) => ({
    ...row,
    ...(row.status === 'ok' ? {} : { estimate: null, lower: null, upper: null })
  }));
  const range = axisRange(computed, comparison);
  const opens = {
    difference: 'the group comparison',
    correlation: 'the association scatter',
    hazard: 'the stratified survival chart'
  }[comparison];
  shown.rows.forEach((row, index) => {
    const from = expected[index];
    const formatted = formatScreenRow(from, groups);
    expect(row.status, from.biomarker).toBe(formatted.status);
    expect(row.zero).toBeCloseTo(placeOf(range.reference ?? 0, range), 2);
    if (formatted.status === 'shown') {
      expect(row.says).toBe(`${formatted.text} Open in ${opens}.`);
      expect(row.value).toBe(
        `${formatted.estimate}${formatted.bounds ? ` (${formatted.bounds})` : ''}`
      );
      expect([row.p, row.adjusted]).toEqual([formatted.p, formatted.adjusted]);
      expect(row.n).toBe(groups ? `${from.n_1} / ${from.n_2}` : String(from.counts));
      expect(row.dot).toBeCloseTo(placeOf(from.estimate, range), 2);
      if (from.lower === null) expect(row.line).toBe(null);
      else {
        expect(row.line[0]).toBeCloseTo(placeOf(from.lower, range), 2);
        expect(row.line[1]).toBeCloseTo(placeOf(from.upper, range) - placeOf(from.lower, range), 2);
      }
    } else {
      expect(row.dot).toBe(null);
      expect(row.line).toBe(null);
      expect(row.p).toBe(null);
      expect(row.value).toBe(`${from.reason} Not in the adjustment.`);
    }
  });
}

async function choose(page, control, value) {
  await page
    .locator(`#chart .sv-sidebar select[data-control="${control}"]`)
    .first()
    .selectOption(value);
}
const controls = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [
        ...document.querySelectorAll('#chart > .bv-biomarker-screen .sv-sidebar [data-control]')
      ].map((control) => [control.dataset.control, control.value])
    )
  );
const layout = (page) =>
  page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
const HOLDS = { viewport: 390, scrollWidth: 390 };

const root = (page) => page.locator('#chart > .bv-biomarker-screen');
const line = (page) => root(page).locator('.sv-main > .bv-statistic');
const notes = (page) => root(page).locator('.sv-notes > span');
const footnote = (page) => root(page).locator('.sv-footnote');
const rowAt = (page, biomarker) =>
  root(page).locator(`.bv-screen-row[data-biomarker="${biomarker}"]`);
const drill = (page) => page.locator('#chart > .bv-screen-drill');
// What the screen says, but the one sentence of the chart's own footnote that
// names the date drawn and the bio.viz version (#66), which are no statistic;
// the rest of the footnotes, R's methods and counts among them, is read.
const said = (page) =>
  root(page).evaluate((chart) =>
    [
      chart.innerText.replace(
        /Drawn on \d{4}-\d{2}-\d{2} by bio\.viz \d+\.\d+\.\d+(?: with development changes)?\./g,
        ''
      ),
      ...[...chart.querySelectorAll('[aria-label], [title]')].map(
        (element) =>
          `${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''}`
      )
    ].join('\n')
  );

const withStored = (page, results, settings = {}) =>
  page.evaluate(
    ({ results, settings }) => {
      window.__bs.chart.setSettings({
        ...settings,
        connection: window.BioViz.r.createConnection({ results })
      });
    },
    { results, settings }
  );

// A stand-in for R whose answers arrive when the test says so.
const stubR = () => {
  window.__r = { calls: [] };
  window.__r.engine = {
    start: () => Promise.resolve(),
    call: (name, request) =>
      new Promise((resolve) => {
        window.__r.calls.push({
          name,
          rows: request.data.length,
          args: request.args,
          fields: Object.keys(request.data[0]),
          data: request.data,
          resolve
        });
      })
  };
  window.__r.answer = (index, value) => window.__r.calls[index].resolve(value);
};
const attachStub = (page, settings = {}) =>
  page.evaluate((given) => {
    window.__bs.chart.setSettings({
      ...given,
      connection: window.BioViz.r.createConnection({ browser: { engine: window.__r.engine } })
    });
  }, settings);
const calls = (page) =>
  page.evaluate(() =>
    window.__r.calls.map(({ name, rows, args, fields }) => ({ name, rows, args, fields }))
  );
const called = (page) => page.evaluate(() => window.__r.calls.length);
const answer = (page, index, name) =>
  page.evaluate(({ index, value }) => window.__r.answer(index, value), {
    index,
    value: resultOf(name).value
  });

test.describe('biomarker screen: the page and the two bundles', () => {
  test('BS-KIT-001: the chart is built from safety.viz’s kit on the page; without safety.viz it says what is missing (#36)', async ({
    page
  }) => {
    const errors = watch(page);
    const requests = [];
    page.on('request', (request) => requests.push(new URL(request.url()).pathname));
    await open(page);
    const found = await page.evaluate(() => ({
      ownChart: 'Chart' in window.BioViz,
      globalChart: typeof window.Chart,
      root: document.querySelector('#chart > .sv-root').className,
      sections: [...document.querySelectorAll('#chart .sv-section-title')].map(
        (title) => title.textContent
      )
    }));
    expect(found).toEqual({
      ownChart: false,
      globalChart: 'undefined',
      root: 'sv-root bv-biomarker-screen',
      sections: ['Screen', 'Statistics', 'Display', 'Filters']
    });
    const scripts = requests.filter((file) => file.endsWith('.js'));
    expect(scripts.filter((file) => file === '/site/vendor/safety.viz/safety.viz.js')).toHaveLength(
      1
    );
    expect(scripts.filter((file) => file.startsWith('/dist/bio.viz-'))).toHaveLength(1);
    expect(errors).toEqual([]);
    await page.goto('/tests/e2e/fixtures/index.html');
    const message = await page.evaluate(() => {
      try {
        window.BioViz.biomarkerScreen(document.body, {});
        return 'made';
      } catch (error) {
        return error.message;
      }
    });
    expect(message).toMatch(
      /^bio\.viz: the biomarker screen is built from safety\.viz's kit, and `SafetyViz\.kit` was not found\./
    );
  });
});

test.describe('biomarker screen: what is drawn', () => {
  test('BS-DRAW-001: the planted difference: one row per biomarker sorted by R’s estimate with IL-6 at the top, its dot and its line where R’s numbers put them on one axis with nought marked, and its estimate, both p-values and each group’s count beside it (#36)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page, { settings: WEEK_4 });
    await withStored(page, stored('difference-week-4-change'));
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const shown = await screen(page);
    expect(shown.title).toBe(
      'Change from baseline at Week 4: Placebo against Treatment, standardised difference'
    );
    expect(shown.rows).toHaveLength(12);
    expect(shown.rows[0].biomarker).toBe('IL-6');
    expect(shown.ticks).toEqual(['−2', '−1', '0', '1', '2']);
    await expect(root(page).locator('.sv-footnote')).toHaveText(
      'Click a row, or press Enter on it, to open that biomarker in its own chart. The estimates share one axis without units, with nought marked.'
    );
    expectRows(shown, resultOf('difference-week-4-change').value, { groups: ARMS });
    expect(shown.rows[0]).toMatchObject({
      value: '0.9133 (0.6111 to 1.213)',
      p: 'p < 0.001',
      adjusted: 'p < 0.001',
      n: '95 / 91'
    });
    expect(shown.count).toBe('All 12 biomarkers are shown.');
    // The dot is drawn at R's estimate on the page, inside its line.
    const drawn = await rowAt(page, 'IL-6').evaluate((row) => {
      const box = (selector) => row.querySelector(selector).getBoundingClientRect();
      const [track, dot, interval, zero] = [
        '.bv-track',
        '.bv-estimate',
        '.bv-interval',
        '.bv-zero'
      ].map(box);
      return {
        dot: (dot.left + dot.width / 2 - track.left) / track.width,
        from: (interval.left - track.left) / track.width,
        to: (interval.right - track.left) / track.width,
        zero: (zero.left - track.left) / track.width
      };
    });
    expect(drawn.dot).toBeCloseTo((0.9133 + 2) / 4, 2);
    expect(drawn.from).toBeCloseTo((0.6111 + 2) / 4, 2);
    expect(drawn.to).toBeCloseTo((1.213 + 2) / 4, 2);
    expect(drawn.zero).toBeCloseTo(0.5, 2);
    await expect(notes(page)).toHaveText([
      '187 of 200 participants in the frame.',
      '13 left out: no value for any biomarker of the screen.',
      'Baseline visit: Baseline.'
    ]);
    expect(await controls(page)).toMatchObject({
      comparison: 'difference',
      'value-type': 'change',
      visit: 'Week 4',
      'group-by': 'ARM',
      first: 'Placebo',
      second: 'Treatment',
      adjustment: 'BH',
      sort: 'estimate'
    });
    expect(errors).toEqual([]);
    await captureEvidence(
      root(page).locator('.bv-screen'),
      'BS-DRAW-001',
      'the-planted-difference'
    );
    // The gallery's picture: the chart's frame titled as its demo is, with its
    // footnotes and its own last (#66).
    await page.evaluate((titles) => window.__bs.chart.setSettings(titles), {
      title: '{heading}',
      subtitle: '{biomarkers} biomarkers, {n} participants',
      footnotes: [
        'Synthetic study from gsm.bio: no real participant is shown.',
        'Filters: {filters}.'
      ]
    });
    await captureGallery(root(page).locator('.sv-main'), 'BS-DRAW-001');
  });

  test('BS-DRAW-002: every row is a button named by the shared formatter’s sentence; the caption and the line say what the estimate is, which test, and by what adjustment across how many biomarkers, once (#36)', async ({
    page
  }) => {
    await open(page, { settings: WEEK_4 });
    await withStored(page, stored('difference-week-4-change'));
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const shown = await screen(page);
    expect(shown.caption).toBe(
      'Each row: Standardised difference (Hedges’ g), Placebo less Treatment, with its 95% ' +
        'confidence interval on one axis without units. p: Welch Two Sample t-test, unadjusted, ' +
        'and adjusted by Benjamini-Hochberg across the 12 biomarkers with a p-value. Exploratory, ' +
        'adjusted (Benjamini-Hochberg).'
    );
    const il6 =
      'IL-6: 0.9133, 95% confidence interval 0.6111 to 1.213. Welch Two Sample t-test: p < 0.001 ' +
      'unadjusted, p < 0.001 adjusted across 12 biomarkers (Placebo n = 95, Treatment n = 91). ' +
      'Exploratory, adjusted (Benjamini-Hochberg). Open in the group comparison.';
    await expect(page.getByRole('button', { name: il6 })).toHaveCount(1);
    await expect(line(page).locator('p').first()).toHaveText(
      'Welch Two Sample t-test, one row per biomarker: 12 of 12 computed. The adjusted p-values ' +
        'are adjusted by Benjamini-Hochberg across the 12 biomarkers that have a p-value.'
    );
    await expect(line(page).locator('.bv-stat-remark')).toHaveText([
      "R’s note: Each row's estimate: Standardised difference (Hedges' g), Placebo - Treatment.",
      "R’s note: p_value is adjusted across the 12 rows that have a p-value by p.adjust(method = 'BH'); 0 of the 12 rows have none and are left out of the adjustment.",
      "R’s note: The p-values are t.test()'s (Welch). The standardised difference and its interval are computed here, not by an existing function.",
      // Since gsm.bio 514cbc3 R says that the interval pools the variances and the p-value does not (#49).
      "R’s note: The interval is the pooled-variance (Student) interval for Hedges' g, while the p-value is Welch's, which does not pool the variances: when the two groups' spreads differ, a row's interval can include zero while its p-value is below 0.05, or exclude zero while it is above."
    ]);
    await expect(line(page).locator('.bv-stat-scope')).toHaveText(
      '187 participants are in the frame. A row is of the ones who have its biomarker, so each row has its own counts.'
    );
    await expect(root(page).locator('.bv-screen-head > span').nth(3)).toHaveText(
      'p, Benjamini-Hochberg'
    );
    await expect(root(page).locator('.bv-screen-head > span').nth(4)).toHaveText(
      'n, Placebo / Treatment'
    );
  });

  test('BS-DRAW-003: every p-value comes with its method and counts and is labelled exploratory, the adjustment by name; no star and no verdict anywhere, for either adjustment or comparison (#36)', async ({
    page
  }) => {
    await open(page, { settings: WEEK_4 });
    for (const [name, settings] of [
      ['difference-week-4-change', { adjustment: 'BH' }],
      ['difference-week-4-change-holm', { adjustment: 'holm' }],
      ['correlation-il-10', { ...AGAINST_IL10, adjustment: 'BH' }],
      ['correlation-il-10-holm', { ...AGAINST_IL10, adjustment: 'holm' }]
    ]) {
      await withStored(page, stored(name), { ...WEEK_4, comparison: 'difference', ...settings });
      await expect(line(page), name).toHaveAttribute('data-state', 'shown');
      const everything = await said(page);
      expect(everything, name).not.toMatch(/\*|significan/i);
      const adjustment = settings.adjustment === 'holm' ? 'Holm' : 'Benjamini-Hochberg';
      for (const row of (await screen(page)).rows) {
        expect(row.says, `${name} ${row.biomarker}`).toMatch(
          new RegExp(
            `: p [<=>] [\\d.]+ unadjusted, p [<=>] [\\d.]+ adjusted across \\d+ biomarkers \\(.*n = \\d+\\)\\. Exploratory, adjusted \\(${adjustment}\\)\\. Open in`
          )
        );
      }
      expect(everything).toContain(`Exploratory, adjusted (${adjustment}).`);
    }
  });

  test('BS-DRAW-004: a row R could not compute shows R’s reason and no number, no dot and no line, and says it is outside the adjustment; where no row could be computed the line gives R’s reason (#36)', async ({
    page
  }) => {
    await open(page, {
      settings: {
        ...WEEK_4,
        filters: ['ARM', 'SEX', 'RESPONSE', { value_col: 'AGE', label: 'Age' }]
      }
    });
    await withStored(page, stored('difference-age-35'));
    await page.locator('#chart select[data-filter="AGE"]').selectOption('35');
    await expect(line(page)).toHaveAttribute('data-state', 'withheld');
    await expect(line(page).locator('.bv-stat-result')).toHaveText(
      'Not computed: every biomarker has a group below the minimum size. Each row gives its reason.'
    );
    const shown = await screen(page);
    expect(shown.rows).toHaveLength(12);
    expectRows(shown, resultOf('difference-age-35').value, { groups: ARMS });
    for (const row of shown.rows) {
      expect(row).toMatchObject({
        status: 'withheld',
        dot: null,
        line: null,
        value:
          'Not computed: Placebo has 2; Treatment has 2. The minimum group size is 5. Not in the adjustment.'
      });
      expect(row.says).toBe(
        `${row.biomarker}: Not computed: Placebo has 2; Treatment has 2. The minimum group size is 5. ` +
          'Counts: Placebo n = 2, Treatment n = 2. Not in the adjustment. Open in the group comparison.'
      );
    }
    expect(await said(page)).not.toMatch(P_VALUE);
    await captureEvidence(
      root(page).locator('.bv-screen'),
      'BS-DRAW-004',
      'rows-r-could-not-compute'
    );
  });

  test('BS-DRAW-005: the correlation against IL-10 at Baseline draws every other biomarker on an axis from −1 to 1 with TNF-alpha at the top; Spearman draws and prints no interval (#36)', async ({
    page
  }) => {
    await open(page, { settings: AGAINST_IL10 });
    await withStored(page, stored('correlation-il-10', 'correlation-il-10-spearman'));
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    let shown = await screen(page);
    expect(shown.title).toBe('Result at Baseline: correlation with IL-10 at Baseline');
    expect(shown.ticks).toEqual(['−1', '−0.5', '0', '0.5', '1']);
    expect(shown.rows.map((row) => row.biomarker)).not.toContain('IL-10');
    expect(shown.rows[0]).toMatchObject({
      biomarker: 'TNF-alpha',
      value: '0.6384 (0.5482 to 0.7139)',
      n: '200'
    });
    expectRows(shown, resultOf('correlation-il-10').value, { comparison: 'correlation' });
    await expect(notes(page)).toContainText([
      'IL-10 at Baseline is the variable every row is correlated with, and is not a row of its own.'
    ]);
    expect(shown.caption).toMatch(
      /^Each row: Pearson’s r with IL-10 at Baseline, with its 95% confidence interval/
    );
    expect(await controls(page)).toMatchObject({
      with: 'm:IL-10',
      'with-visit': 'Baseline',
      method: 'pearson'
    });
    await captureEvidence(
      root(page).locator('.bv-screen'),
      'BS-DRAW-005',
      'correlation-with-il-10'
    );
    await choose(page, 'method', 'spearman');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    shown = await screen(page);
    expectRows(shown, resultOf('correlation-il-10-spearman').value, { comparison: 'correlation' });
    expect(shown.rows.every((row) => row.line === null && !/ \(/.test(row.value))).toBe(true);
    expect(shown.caption).toMatch(/^Each row: Spearman’s rho with IL-10 at Baseline on one axis/);
    await expect(line(page).locator('.bv-stat-remark[data-kind="warning"]')).toHaveText(
      'R warned: Cannot compute exact p-value with ties'
    );
  });

  test('BS-DRAW-006: the chart says how many are in the frame of how many and who was left out, and that each row has its own counts, as R counted them (#36)', async ({
    page
  }) => {
    await open(page, { settings: WEEK_4 });
    await withStored(page, stored('difference-week-4-change'));
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    await expect(notes(page).first()).toHaveText('187 of 200 participants in the frame.');
    await expect(notes(page).nth(1)).toHaveClass('sv-warning');
    const { rows } = await screen(page);
    const value = resultOf('difference-week-4-change').value;
    const counts = rows.map((row) => row.n);
    expect(new Set(counts).size).toBeGreaterThan(3);
    for (const row of rows) {
      const from = value.rows.find((entry) => entry.biomarker === row.biomarker);
      expect(row.n).toBe(`${from.n_1} / ${from.n_2}`);
      expect(from.n_1 + from.n_2).toBeLessThanOrEqual(187);
    }
  });
});

test.describe('biomarker screen: pages, controls and the download', () => {
  test('BS-LIMIT-002: Previous and Next go between pages of the sorted rows, which page of how many is said, and R is not asked again (#36)', async ({
    page
  }) => {
    await open(page, { settings: { ...WEEK_4, limit: 5 }, before: stubR });
    await attachStub(page);
    await expect.poll(() => called(page)).toBe(1);
    await answer(page, 0, 'difference-week-4-change');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const order = byEstimate(resultOf('difference-week-4-change').value.rows).map(
      (row) => row.biomarker
    );
    let shown = await screen(page);
    expect(shown.rows.map((row) => row.biomarker)).toEqual(order.slice(0, 5));
    expect(shown.count).toBe(
      '5 of 12 biomarkers shown: 1 to 5, by estimate, largest first; 5 to a page.'
    );
    expect(shown.page).toBe('Page 1 of 3');
    await expect(root(page).locator('button[data-go="previous"]')).toBeDisabled();
    await root(page).locator('button[data-go="next"]').click();
    shown = await screen(page);
    expect(shown.rows.map((row) => row.biomarker)).toEqual(order.slice(5, 10));
    expect(shown.page).toBe('Page 2 of 3');
    await root(page).locator('button[data-go="next"]').click();
    shown = await screen(page);
    expect(shown.rows.map((row) => row.biomarker)).toEqual(order.slice(10));
    expect(shown.count).toBe(
      '2 of 12 biomarkers shown: 11 to 12, by estimate, largest first; 5 to a page.'
    );
    await expect(root(page).locator('button[data-go="next"]')).toBeDisabled();
    await root(page).locator('button[data-go="previous"]').click();
    expect((await screen(page)).page).toBe('Page 2 of 3');
    // The same axis on every page, and R asked once in all.
    expect(await called(page)).toBe(1);
    await captureEvidence(root(page).locator('.bv-screen'), 'BS-LIMIT-002', 'a-page-of-rows');
  });

  test('BS-CTRL-001: the sidebar offers the comparison, the value and visit, the groups or the variable and method, the adjustment, the order, a filter per category column, and Reset chart (#36)', async ({
    page
  }) => {
    await open(page);
    const sections = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('#chart .sv-control-section')].map((section) => [
          section.querySelector('.sv-section-title').textContent,
          [...section.querySelectorAll('.sv-control > label')].map((label) => label.textContent)
        ])
      );
    expect(await sections()).toEqual([
      ['Screen', ['Compare', 'Value', 'Visit', 'Group by', 'First group', 'Second group']],
      ['Statistics', ['Adjustment']],
      ['Display', ['Sort']],
      ['Filters', ['ARM', 'SEX', 'RESPONSE']]
    ]);
    await expect(page.locator('#chart .sv-reset')).toHaveText('Reset chart');
    const options = (control) =>
      page.locator(`#chart select[data-control="${control}"] option`).allTextContents();
    expect(await options('comparison')).toEqual([
      'Difference between two groups',
      'Correlation with one variable'
    ]);
    expect(await options('group-by')).toEqual(['ARM', 'SEX', 'RESPONSE']);
    expect(await options('first')).toEqual(ARMS);
    expect(await options('adjustment')).toEqual(['Benjamini-Hochberg', 'Holm']);
    expect(await options('sort')).toEqual([
      'Estimate, largest first',
      'Biomarker name',
      'Adjusted p-value, smallest first'
    ]);
    // It opens on the first visit, as its result, the first column of groups' first two.
    expect(await controls(page)).toMatchObject({
      comparison: 'difference',
      'value-type': 'raw',
      visit: 'Baseline',
      'group-by': 'ARM',
      first: 'Placebo',
      second: 'Treatment'
    });
    await choose(page, 'value-type', 'baseline');
    expect((await sections())[0][1]).toEqual([
      'Compare',
      'Value',
      'Group by',
      'First group',
      'Second group'
    ]);
    await choose(page, 'value-type', 'raw');
    await choose(page, 'comparison', 'correlation');
    expect((await sections())[0][1]).toEqual([
      'Compare',
      'Value',
      'Visit',
      'Correlate with',
      'Method'
    ]);
    // The participant-level numbers first, then every biomarker.
    const offered = await options('with');
    expect(offered.slice(0, 2)).toEqual(['AGE', 'BMIBL']);
    expect(offered.slice(-12)).toEqual(BIOMARKERS);
    await choose(page, 'with', 'm:IL-10');
    expect((await sections())[0][1]).toEqual([
      'Compare',
      'Value',
      'Visit',
      'Correlate with',
      'At visit',
      'Method'
    ]);
    expect(await options('method')).toEqual(['Pearson', 'Spearman']);
  });

  test('BS-CTRL-002: a change to a control draws the screen again and asks R with it; the same group twice swaps them; Reset chart returns to the opening (#36)', async ({
    page
  }) => {
    await open(page, { before: stubR });
    await attachStub(page);
    await expect.poll(() => called(page)).toBe(1);
    const opening = await controls(page);
    const last = async () => (await calls(page)).at(-1);
    expect(await last()).toMatchObject({
      name: 'Analyze_Screen',
      rows: 200,
      args: { strComparison: 'difference', strGroupCol: 'ARM', chrGroups: ARMS, strPAdjust: 'BH' }
    });
    expect((await last()).fields).toEqual(['USUBJID', ...BIOMARKERS, 'ARM']);
    for (const [change, expected] of [
      [() => choose(page, 'visit', 'Week 4'), { rows: 187 }],
      [() => choose(page, 'value-type', 'change'), { rows: 187 }],
      [() => choose(page, 'first', 'Treatment'), { args: { chrGroups: ['Treatment', 'Placebo'] } }],
      [() => choose(page, 'adjustment', 'holm'), { args: { strPAdjust: 'holm' } }],
      [
        () => choose(page, 'group-by', 'SEX'),
        { args: { strGroupCol: 'SEX', chrGroups: ['F', 'M'] } }
      ],
      [() => page.locator('#chart select[data-filter="RESPONSE"]').selectOption('Responder'), {}]
    ]) {
      const before = await called(page);
      await change();
      await expect.poll(() => called(page)).toBe(before + 1);
      expect(await last()).toMatchObject(expected);
      await expect(line(page)).toHaveText(WAITING);
    }
    expect((await screen(page)).title).toBe(
      'Change from baseline at Week 4: F against M, standardised difference'
    );
    await choose(page, 'comparison', 'correlation');
    await expect.poll(async () => (await last()).args.strComparison).toBe('correlation');
    expect((await last()).args).toMatchObject({ strWithCol: 'AGE', strCorMethod: 'pearson' });
    await choose(page, 'with', 'm:IL-10');
    expect((await last()).args.strWithCol).toBe('IL-10 at Week 4');
    await choose(page, 'with-visit', 'Baseline');
    expect((await last()).args.strWithCol).toBe('IL-10 at Baseline');
    await choose(page, 'method', 'spearman');
    expect((await last()).args.strCorMethod).toBe('spearman');
    await page.locator('#chart .sv-reset').click();
    expect(await controls(page)).toEqual(opening);
    expect((await last()).args).toMatchObject({
      strComparison: 'difference',
      strGroupCol: 'ARM',
      strPAdjust: 'BH'
    });
  });

  test('BS-CTRL-003: a change to the order draws R’s rows in another order and asks R nothing (#36)', async ({
    page
  }) => {
    await open(page, { settings: WEEK_4, before: stubR });
    await attachStub(page);
    await expect.poll(() => called(page)).toBe(1);
    await answer(page, 0, 'difference-week-4-change');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const value = resultOf('difference-week-4-change').value;
    await choose(page, 'sort', 'name');
    expect((await screen(page)).rows.map((row) => row.biomarker)).toEqual(BIOMARKERS);
    await choose(page, 'sort', 'adjusted');
    const adjusted = (await screen(page)).rows.map(
      (row) => value.rows.find((entry) => entry.biomarker === row.biomarker).p_value
    );
    expect(adjusted).toEqual([...adjusted].sort((a, b) => a - b));
    await choose(page, 'sort', 'estimate');
    expectRows(await screen(page), value, { groups: ARMS });
    expect(await called(page)).toBe(1);
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
  });

  test('BS-CTRL-004: with the setting `statistic` null there are no Statistics controls, R is asked for nothing and no rows are drawn (#36)', async ({
    page
  }) => {
    await open(page, { before: stubR, settings: { statistic: null } });
    await attachStub(page);
    await expect(page.locator('#chart .sv-section-title')).toHaveText([
      'Screen',
      'Display',
      'Filters'
    ]);
    await expect(root(page).locator('.bv-screen-row')).toHaveCount(0);
    expect((await screen(page)).names).toBe(`12 biomarkers to screen: ${BIOMARKERS.join(', ')}.`);
    await choose(page, 'visit', 'Week 4');
    expect(await called(page)).toBe(0);
    expect(await page.evaluate(() => window.__bs.chart.statistics())).toEqual([]);
    // Switched off on a screen with R's rows on it, nothing of them is left.
    await withStored(page, stored('difference-week-4-change'), {
      ...WEEK_4,
      statistic: 'Analyze_Screen'
    });
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expect((await screen(page)).rows).toHaveLength(12);
    await page.evaluate(() => {
      window.__bs.chart.setSettings({ statistic: null });
    });
    expect((await screen(page)).rows).toEqual([]);
    await expect(line(page)).toHaveText('');
    expect(await said(page)).not.toMatch(/\d\.\d/);
  });

  test('BS-LIST-001: the rows download as a CSV file under this chart’s name, in the order shown (#36)', async ({
    page
  }) => {
    await open(page, { settings: WEEK_4 });
    await withStored(page, stored('difference-week-4-change'));
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      root(page).getByRole('button', { name: 'Download: CSV' }).click()
    ]);
    expect(download.suggestedFilename()).toBe('bio.viz-biomarker-screen-rows.csv');
    const lines = readFileSync(await download.path(), 'utf8')
      .trimEnd()
      .split(/\r?\n/);
    expect(lines[0]).toBe(
      'Biomarker,Estimate,Confidence interval,p unadjusted,p adjusted (Benjamini-Hochberg),n Placebo / Treatment,Not computed'
    );
    expect(lines).toHaveLength(13);
    // Written by RFC 4180 (#67): a field is quoted only when it must be.
    expect(lines[1]).toBe('IL-6,0.9133,0.6111 to 1.213,p < 0.001,p < 0.001,95 / 91,');
    const order = (await screen(page)).rows.map((row) => row.biomarker);
    expect(lines.slice(1).map((entry) => entry.split(',')[0].replaceAll('"', ''))).toEqual(order);
    expect(lines.join('\n')).not.toMatch(/\*|significan/i);
  });
});

test.describe('biomarker screen: the statistics, the waiting state and the no-stale rule', () => {
  test('BS-STAT-004: until R answers the line reads that it is waiting, with the page’s note until R has answered once, and no rows are drawn; then the rows are drawn from R’s answer (#36)', async ({
    page
  }) => {
    await open(page, { settings: WEEK_4, before: stubR });
    await attachStub(page, { waiting_note: 'The first screen starts R: about 13 MB, once.' });
    await expect(line(page)).toHaveText(`${WAITING} The first screen starts R: about 13 MB, once.`);
    await expect(line(page)).toHaveAttribute('data-state', 'waiting');
    let shown = await screen(page);
    expect(shown.rows).toEqual([]);
    expect(shown.names).toBe(`12 biomarkers to screen: ${BIOMARKERS.join(', ')}.`);
    expect(await said(page)).not.toMatch(/\d\.\d/);
    expect(await page.evaluate(() => window.__bs.chart.statistics()[0].answer)).toBe(null);
    await expect.poll(() => called(page)).toBe(1);
    await answer(page, 0, 'difference-week-4-change');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expectRows(await screen(page), resultOf('difference-week-4-change').value, { groups: ARMS });
    // R has answered: the next wait does not say what starting R costs.
    await choose(page, 'adjustment', 'holm');
    await expect(line(page)).toHaveText(WAITING);
    shown = await screen(page);
    expect(shown.rows).toEqual([]);
    await captureEvidence(root(page).locator('.sv-main'), 'BS-STAT-004', 'waiting-for-r');
  });

  test('BS-STAT-005: a change that asks R again clears the rows and the line, and an answer to the question before is never shown (#36)', async ({
    page
  }) => {
    await open(page, { settings: WEEK_4, before: stubR });
    await attachStub(page);
    await expect.poll(() => called(page)).toBe(1);
    await page.locator('#chart select[data-filter="SEX"]').selectOption('F');
    await expect.poll(() => called(page)).toBe(2);
    expect((await calls(page))[1].rows).toBe(85);
    // R answers the first question, for everyone, after the filter changed.
    await answer(page, 0, 'difference-week-4-change');
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
    await expect(line(page)).toHaveText(WAITING);
    expect((await screen(page)).rows).toEqual([]);
    expect(await said(page)).not.toMatch(/\d\.\d{3}/);
    await answer(page, 1, 'difference-week-4-change-women');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const shown = await screen(page);
    expectRows(shown, resultOf('difference-week-4-change-women').value, { groups: ARMS });
    expect(shown.rows[0]).toMatchObject({ biomarker: 'IL-6', n: '42 / 42' });
    await expect(line(page).locator('.bv-stat-scope')).toHaveText(
      '85 participants are in the frame. A row is of the ones who have its biomarker, so each row has its own counts. Filters: SEX is F.'
    );
    const held = await page.evaluate(() => window.__bs.chart.statistics());
    expect(held).toHaveLength(1);
    expect(held[0].dataId.filters).toEqual({ SEX: ['F'] });
  });

  test('BS-STAT-006: with no R attached the line says statistics are unavailable and no rows are drawn, the biomarkers it would screen are named, and nothing is fetched (#36)', async ({
    page
  }) => {
    const errors = watch(page);
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await open(page, { settings: WEEK_4 });
    await expect(line(page)).toHaveText(NO_R);
    await expect(line(page)).toHaveAttribute('data-state', 'unavailable');
    const shown = await screen(page);
    expect(shown.title).toBe(
      'Change from baseline at Week 4: Placebo against Treatment, standardised difference'
    );
    expect(shown.rows).toEqual([]);
    expect(shown.names).toBe(`12 biomarkers to screen: ${BIOMARKERS.join(', ')}.`);
    expect(await said(page)).not.toMatch(/\d\.\d/);
    await choose(page, 'comparison', 'correlation');
    await expect(line(page)).toHaveText(NO_R);
    expect((await screen(page)).rows).toEqual([]);
    expect(requests.filter((url) => /webr|r-wasm/.test(url))).toEqual([]);
    expect(errors).toEqual([]);
    await captureEvidence(root(page).locator('.sv-main'), 'BS-STAT-006', 'with-no-r');
  });

  test('BS-STAT-007: with R’s answers stored in the page the rows are drawn from them with no R and no request; a view not stored says so and draws no rows (#36)', async ({
    page
  }) => {
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await open(page);
    await withStored(
      page,
      stored('difference-baseline', 'difference-week-4-change', 'difference-sex')
    );
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expectRows(await screen(page), resultOf('difference-baseline').value, { groups: ARMS });
    await choose(page, 'visit', 'Week 4');
    await choose(page, 'value-type', 'change');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expectRows(await screen(page), resultOf('difference-week-4-change').value, { groups: ARMS });
    await choose(page, 'group-by', 'SEX');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expectRows(await screen(page), resultOf('difference-sex').value, { groups: ['F', 'M'] });
    for (const change of [
      () => choose(page, 'adjustment', 'holm'),
      () => choose(page, 'visit', 'Week 8')
    ]) {
      await change();
      await expect(line(page)).toHaveText(NOT_STORED);
      expect((await screen(page)).rows).toEqual([]);
    }
    expect(requests.filter((url) => /webr|r-wasm|statistics\.R/.test(url))).toEqual([]);
  });

  test('BS-STAT-008: chart.statistics() returns what the chart asked R for the screen now drawn and what R answered: one entry (#36)', async ({
    page
  }) => {
    await open(page);
    for (const [name, settings] of [
      ['difference-week-4-change', { ...WEEK_4, comparison: 'difference', adjustment: 'BH' }],
      ['correlation-il-10-holm', { ...AGAINST_IL10, adjustment: 'holm' }],
      [
        'correlation-age',
        {
          comparison: 'correlation',
          visit: 'Week 4',
          value_type: 'change',
          with: { col: 'AGE' },
          adjustment: 'BH'
        }
      ]
    ]) {
      await withStored(page, stored(name), settings);
      await expect(line(page), name).toHaveAttribute('data-state', 'shown');
      const expected = resultOf(name);
      expect(await page.evaluate(() => window.__bs.chart.statistics()), name).toEqual([
        {
          name: expected.name,
          args: expected.args,
          dataId: expected.dataId,
          rows: expected.rows,
          answer: { status: 'ok', value: expected.value, form: 'precomputed' }
        }
      ]);
    }
  });
});

test.describe('biomarker screen: a row opens its chart', () => {
  const opened = (page) =>
    page.evaluate(() => {
      const chart = window.__bs.chart.opened();
      if (!chart) return null;
      const kind = chart.root.classList.contains('bv-group-comparison')
        ? 'group comparison'
        : 'association scatter';
      return {
        kind,
        connection: chart.connection === window.__bs.chart.connection,
        settings: {
          start_value: chart.settings.start_value,
          visits: chart.settings.visits,
          value_type: chart.settings.value_type,
          group_by: chart.settings.group_by,
          levels: chart.settings.levels,
          test: chart.settings.test,
          x: chart.settings.x,
          y: chart.settings.y,
          method: chart.settings.method,
          filters: (chart.settings.filters || []).map(({ value_col, start }) => [
            value_col,
            start ?? null
          ]),
          back: chart.settings.back && chart.settings.back.label
        },
        asked: chart
          .statistics()
          .map(({ name, args, dataId, answer }) => ({ name, args, dataId, answer }))
      };
    });

  test('BS-DRILL-001: a click on a row of a difference opens the group comparison for that biomarker in place, at the same visit and value with the same groups and Welch’s test, and a button back that takes the keyboard’s place (#36)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page, { settings: WEEK_4 });
    await withStored(page, [
      ...stored('difference-week-4-change'),
      fromFixture(groupStatistics, 'welch')
    ]);
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    await rowAt(page, 'IL-6').click();
    await expect(root(page)).toBeHidden();
    await expect(drill(page)).toBeVisible();
    const back = drill(page).locator('.bv-back');
    await expect(back).toHaveText(BACK);
    await expect(back).toBeFocused();
    const now = await opened(page);
    expect(now).toMatchObject({
      kind: 'group comparison',
      connection: true,
      settings: {
        start_value: 'IL-6',
        visits: ['Week 4'],
        value_type: 'change',
        group_by: 'ARM',
        levels: ARMS,
        test: 't',
        back: BACK
      }
    });
    await expect(drill(page).locator('.bv-statistic').first()).toHaveAttribute(
      'data-state',
      'shown'
    );
    await captureEvidence(
      page.locator('#chart'),
      'BS-DRILL-001',
      'a-row-opened-in-the-group-comparison'
    );
    await back.click();
    await expect(root(page)).toBeVisible();
    await expect(drill(page)).toHaveCount(0);
    await expect(rowAt(page, 'IL-6')).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('BS-DRILL-002: a click on a row of a correlation opens the association scatter for that biomarker against the fixed variable, with the same method (#36)', async ({
    page
  }) => {
    await open(page, { settings: { ...AGAINST_IL10, method: 'spearman' } });
    await withStored(page, stored('correlation-il-10-spearman'));
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    await rowAt(page, 'TNF-alpha').click();
    expect(await opened(page)).toMatchObject({
      kind: 'association scatter',
      connection: true,
      settings: {
        x: { measure: 'TNF-alpha', value: 'raw', visit: 'Baseline' },
        y: { measure: 'IL-10', value: 'raw', visit: 'Baseline' },
        method: 'spearman',
        back: BACK
      }
    });
    await expect(drill(page).locator('.bv-back')).toBeFocused();
    await drill(page).locator('.bv-back').click();
    await expect(rowAt(page, 'TNF-alpha')).toBeFocused();
  });

  test('BS-DRILL-003: from the keyboard a row is reached with Tab and opened with Enter or Space, and Enter or Space on the button back returns (#36)', async ({
    page
  }) => {
    await open(page, { settings: WEEK_4 });
    await withStored(page, stored('difference-week-4-change'));
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    await rowAt(page, 'IL-6').focus();
    await page.keyboard.press('Tab');
    await expect(rowAt(page, 'IL-1beta')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(drill(page).locator('.bv-back')).toBeFocused();
    expect((await opened(page)).settings.start_value).toBe('IL-1beta');
    await page.keyboard.press('Enter');
    await expect(drill(page)).toHaveCount(0);
    await expect(rowAt(page, 'IL-1beta')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(drill(page).locator('.bv-back')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(rowAt(page, 'IL-1beta')).toBeFocused();
  });

  test('BS-DRILL-004: the chart a row opens has the screen’s connection, its filters and its columns; from stored results the group comparison’s Welch p-value is the row’s unadjusted p-value, and the scatter’s coefficient is the row’s (#36)', async ({
    page
  }) => {
    await open(page, {
      settings: {
        ...WEEK_4,
        filters: [
          { value_col: 'SEX', label: 'Sex' },
          { value_col: 'ARM', label: 'Arm' }
        ],
        group_comparison: { mark: 'violin', test: 'wilcoxon' }
      }
    });
    await withStored(page, [
      ...stored('difference-week-4-change', 'difference-week-4-change-women', 'correlation-il-10'),
      fromFixture(groupStatistics, 'welch'),
      fromFixture(groupStatistics, 'welch-women'),
      fromFixture(scatterStatistics, 'pearson')
    ]);
    await page.locator('#chart select[data-filter="SEX"]').selectOption('F');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const row = resultOf('difference-week-4-change-women').value.rows.find(
      (entry) => entry.biomarker === 'IL-6'
    );
    await rowAt(page, 'IL-6').click();
    await expect(drill(page).locator('.bv-statistic').first()).toHaveAttribute(
      'data-state',
      'shown'
    );
    const now = await opened(page);
    expect(now.connection).toBe(true);
    // The page's settings for the chart lie beneath; Welch's test is the screen's.
    expect(now.settings).toMatchObject({
      test: 't',
      filters: [
        ['SEX', 'F'],
        ['ARM', null]
      ]
    });
    expect(await page.evaluate(() => window.__bs.chart.opened().settings.mark)).toBe('violin');
    const [welch] = now.asked;
    expect(welch.answer.form).toBe('precomputed');
    expect(welch.answer.value.p_value).toBe(row.p_unadjusted);
    expect(welch.answer.value.method).toBe(row.method);
    await expect(drill(page).locator('.bv-stat-result').first()).toHaveText(
      `${row.method}: p < 0.001 (Placebo n = 42, Treatment n = 42). Exploratory, unadjusted.`
    );
    await drill(page).locator('.bv-back').click();
    // The correlation: the scatter's coefficient is the row's.
    await page.locator('#chart select[data-filter="SEX"]').selectOption('__all__');
    await page.evaluate((settings) => {
      window.__bs.chart.setSettings(settings);
    }, AGAINST_IL10);
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const tnf = resultOf('correlation-il-10').value.rows.find(
      (entry) => entry.biomarker === 'TNF-alpha'
    );
    await rowAt(page, 'TNF-alpha').click();
    const coefficient = drill(page).locator('.bv-coefficient');
    await expect(coefficient).toHaveAttribute('data-state', 'shown');
    const [pearson] = (await opened(page)).asked;
    expect(pearson.answer.value.estimates[0].estimate).toBe(tnf.estimate);
    expect(pearson.answer.value.p_value).toBe(tnf.p_unadjusted);
    await expect(coefficient.locator('.bv-stat-estimate')).toHaveText(
      'Pearson’s r: 0.6384, 95% confidence interval 0.5482 to 0.7139.'
    );
  });

  test('BS-DRILL-005: returning shows the screen exactly as it was, on the same page in the same order, with the keyboard on the row, and R is not asked again (#36)', async ({
    page
  }) => {
    await open(page, { settings: { ...WEEK_4, limit: 5, sort: 'adjusted' }, before: stubR });
    await attachStub(page);
    await expect.poll(() => called(page)).toBe(1);
    await answer(page, 0, 'difference-week-4-change');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    await root(page).locator('button[data-go="next"]').click();
    const before = {
      screen: await screen(page),
      line: await line(page).evaluate((element) => element.innerText),
      notes: await notes(page).allTextContents(),
      controls: await controls(page)
    };
    const target = before.screen.rows[1].biomarker;
    await rowAt(page, target).click();
    await expect(drill(page).locator('.bv-back')).toBeFocused();
    // The opened chart asks R for itself, through the same connection.
    await expect.poll(() => called(page)).toBe(2);
    expect((await calls(page))[1].name).toBe('Analyze_GroupDifference');
    await drill(page).locator('.bv-back').click();
    await expect(rowAt(page, target)).toBeFocused();
    expect({
      screen: await screen(page),
      line: await line(page).evaluate((element) => element.innerText),
      notes: await notes(page).allTextContents(),
      controls: await controls(page)
    }).toEqual(before);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(await called(page)).toBe(2);
    expect((await calls(page)).filter((call) => call.name === 'Analyze_Screen')).toHaveLength(1);
  });

  test('BS-DRILL-006: chart.open(biomarker) opens a row’s chart and returns it, chart.opened() gives it, chart.close() returns; a name the screen lacks is refused; drawing again closes it (#36)', async ({
    page
  }) => {
    await open(page, { settings: WEEK_4 });
    const result = await page.evaluate(() => {
      const { chart } = window.__bs;
      const made = chart.open('CRP');
      return {
        returned: made === chart.opened(),
        hidden: chart.root.classList.contains('sv-hidden'),
        biomarker: made.settings.start_value
      };
    });
    expect(result).toEqual({ returned: true, hidden: true, biomarker: 'CRP' });
    await page.evaluate(() => {
      window.__bs.chart.open('IL-6');
    });
    await expect(drill(page)).toHaveCount(1);
    expect(
      await page.evaluate(() => {
        const { chart } = window.__bs;
        return [chart.close() === chart, chart.opened(), chart.close() === chart];
      })
    ).toEqual([true, null, true]);
    const refused = await page.evaluate(() => {
      try {
        window.__bs.chart.open('IL-17');
        return null;
      } catch (error) {
        return [error instanceof TypeError, error.message];
      }
    });
    expect(refused).toEqual([
      true,
      `bio.viz: open() takes a biomarker of the screen, by its name: ${BIOMARKERS.join(', ')}.`
    ]);
    for (const redraw of [
      () => window.__bs.chart.render(),
      () => {
        window.__bs.chart.setSettings({ adjustment: 'holm' });
      },
      () => {
        window.__bs.chart.setData(window.__bs.data);
      }
    ]) {
      await page.evaluate(() => {
        window.__bs.chart.open('IL-6');
      });
      await expect(drill(page)).toHaveCount(1);
      await page.evaluate(redraw);
      await expect(drill(page)).toHaveCount(0);
      await expect(root(page)).toBeVisible();
    }
  });
});

test.describe('biomarker screen: filters and lifecycle', () => {
  test('BS-FILTER-001: on the demo, filters with nobody in common leave the chart saying, in words, that no participant passes the filters; no rows are drawn, R is asked nothing, the controls stay usable, and loosening a filter draws again (#36)', async ({
    page
  }) => {
    const errors = await openDemo(page, 'biomarker-screen', 'biomarkerScreen');
    const rows = () => document.querySelectorAll('#chart .bv-screen-row').length;
    await expect.poll(() => asked(page)).toBeGreaterThan(0);
    const before = await letNobodyThrough(page);
    await expectNobody(page, errors, { drawn: rows });
    expect(await asked(page)).toBe(before);
    await page.locator('#chart select[data-filter="RESPONSE"]').selectOption('__all__');
    await expect(page.locator('#chart .sv-notes')).toContainText(
      '4 of 200 participants pass the filters.'
    );
    await expect.poll(() => asked(page)).toBeGreaterThan(before);
    await expect(page.locator('#chart .sv-footnote')).not.toHaveText(NOBODY_PASSES);
  });

  test('BS-LIFE-001: init, setData, setSettings, render, resize and destroy drive the chart as they drive a safety.viz chart; setSettings moves a control, and destroy takes down the screen and a chart a row had opened (#36)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page);
    expect(
      await page.evaluate(() => {
        const { chart, data } = window.__bs;
        return [
          chart.init(data) === chart,
          chart.setData(data) === chart,
          chart.setSettings({}) === chart,
          chart.close() === chart
        ];
      })
    ).toEqual([true, true, true, true]);
    await page.evaluate(() => {
      window.__bs.chart.setSettings({
        comparison: 'correlation',
        visit: 'Week 4',
        value_type: 'percent_change',
        with: { col: 'BMIBL' },
        method: 'spearman',
        adjustment: 'holm',
        sort: 'name'
      });
    });
    expect(await controls(page)).toMatchObject({
      comparison: 'correlation',
      visit: 'Week 4',
      'value-type': 'percent_change',
      with: 'c:BMIBL',
      method: 'spearman',
      adjustment: 'holm',
      sort: 'name'
    });
    expect((await screen(page)).title).toBe(
      'Percent change from baseline at Week 4: correlation with BMIBL'
    );
    // A visit the tables do not have gives way to the first, and says so.
    const warnings = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    await page.evaluate(() => {
      window.__bs.chart.setSettings({ visit: 'Week 99', value_type: 'raw' });
    });
    expect((await controls(page)).visit).toBe('Baseline');
    expect(warnings.join('\n')).toContain(
      'The initial visit [Week 99] does not exist. Defaulting to the first.'
    );
    // New tables: three biomarkers.
    await page.evaluate(() => {
      const { chart, data } = window.__bs;
      chart.setSettings({ comparison: 'difference' });
      chart.setData({
        ...data,
        results: data.results.filter((row) => ['IL-6', 'IL-10', 'CRP'].includes(row.TEST))
      });
    });
    expect((await screen(page)).names).toBe('3 biomarkers to screen: CRP, IL-6, IL-10.');
    await page.evaluate(() => {
      window.__bs.chart.render();
      window.__bs.chart.resize();
    });
    await page.evaluate(() => {
      window.__bs.chart.setData({ results: [] });
    });
    await expect(footnote(page)).toHaveText('No results to draw.');
    await page.evaluate(() => {
      const { chart, data } = window.__bs;
      chart.setData(data);
      chart.open('IL-6');
    });
    await expect(drill(page)).toHaveCount(1);
    await page.evaluate(() => window.__bs.chart.destroy());
    await expect(page.locator('#chart')).toBeEmpty();
    expect(errors).toEqual([]);
  });

  test('BS-LIFE-002: tables the chart cannot read are refused with a message, shown in its place (#36)', async ({
    page
  }) => {
    await open(page);
    const messages = await page.evaluate(() =>
      [{ results: 'none' }, { results: [{ SUBJECT: 'A' }] }].map((data) => {
        const chart = window.BioViz.biomarkerScreen('#chart', {});
        try {
          chart.setData(data);
          return 'drawn';
        } catch (error) {
          return [
            error instanceof TypeError,
            error.message,
            document.querySelector('#chart .sv-warning').textContent
          ];
        }
      })
    );
    expect(messages).toEqual([
      [
        true,
        'bio.viz: `results` must be an array of records, one object per row.',
        'bio.viz: `results` must be an array of records, one object per row.'
      ],
      [
        true,
        'bio.viz: the results table has no column `USUBJID` (`id_col`).',
        'bio.viz: the results table has no column `USUBJID` (`id_col`).'
      ]
    ]);
  });
});

test.describe('biomarker screen: on a phone', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const overflowing = (page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('#chart *')]
        .filter((element) => element.getBoundingClientRect().right > 390.5)
        .map((element) => element.className || element.tagName.toLowerCase())
    );

  test('BS-MOBILE-001: at 390px the controls are folded away; each row stacks its name, its interval on the full width and its numbers, each named, and the page does not scroll sideways (#36)', async ({
    page
  }) => {
    await open(page, { settings: WEEK_4 });
    await withStored(page, stored('difference-week-4-change'));
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expect(await layout(page)).toEqual(HOLDS);
    await expect(root(page)).toHaveClass(/sv-collapsed/);
    const shown = await screen(page);
    expectRows(shown, resultOf('difference-week-4-change').value, { groups: ARMS });
    const stack = await rowAt(page, 'IL-6').evaluate((row) => {
      const box = (selector) => row.querySelector(selector).getBoundingClientRect();
      const label = (selector) =>
        getComputedStyle(row.querySelector(`${selector} .bv-narrow`)).display;
      return {
        nameAbove: box('.bv-screen-name').bottom <= box('.bv-track').top + 1,
        trackWide: box('.bv-track').width / row.getBoundingClientRect().width,
        numbersBelow: box('.bv-track').bottom <= box('.bv-screen-value').top + 1,
        labels: [
          label('.bv-screen-p:not(.bv-screen-adjusted)'),
          label('.bv-screen-adjusted'),
          label('.bv-screen-n')
        ],
        text: row.innerText
      };
    });
    expect(stack).toMatchObject({
      nameAbove: true,
      numbersBelow: true,
      labels: ['inline', 'inline', 'inline']
    });
    expect(stack.trackWide).toBeGreaterThan(0.9);
    expect(stack.text).toContain('Unadjusted: p < 0.001');
    expect(stack.text).toContain('Benjamini-Hochberg: p < 0.001');
    expect(stack.text).toContain('n, Placebo / Treatment: 95 / 91');
    expect(await overflowing(page)).toEqual([]);
    await captureEvidence(
      root(page).locator('.bv-screen'),
      'BS-MOBILE-001',
      'the-screen-on-a-phone'
    );
  });

  test('BS-MOBILE-002: at 390px a tap on a row opens its chart and its button returns, and the page never scrolls sideways (#36)', async ({
    page
  }) => {
    await open(page, { settings: WEEK_4 });
    await withStored(page, [
      ...stored('difference-week-4-change'),
      fromFixture(groupStatistics, 'welch')
    ]);
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    await rowAt(page, 'IL-6').tap();
    await expect(drill(page).locator('.bv-back')).toBeVisible();
    await expect(drill(page).locator('.bv-statistic').first()).toHaveAttribute(
      'data-state',
      'shown'
    );
    expect(await layout(page)).toEqual(HOLDS);
    expect(await overflowing(page)).toEqual([]);
    await drill(page).locator('.bv-back').tap();
    await expect(root(page)).toBeVisible();
    expect(await layout(page)).toEqual(HOLDS);
  });
});

test.describe('biomarker screen: on the site', () => {
  test('BS-SITE-001: the gallery lists the chart, with links to its live demo, its evidence page and its API reference (#36)', async ({
    page
  }) => {
    const errors = watch(page);
    await blockR(page);
    await page.goto('/_site/gallery/index.html');
    const card = page.locator('#charts [data-module="biomarker-screen"]');
    await expect(card.locator('h3')).toHaveText('Biomarker screen');
    await expect(card).toContainText('Across every biomarker, where is the signal?');
    expect(
      await page
        .locator('#charts [data-module]')
        .evaluateAll((cards) => cards.map((found) => found.dataset.module))
    ).toEqual([
      'group-comparison',
      'association-scatter',
      'correlation-matrix',
      'biomarker-screen',
      'cross-tab',
      'stratified-survival'
    ]);
    await card.getByRole('link', { name: 'Evidence' }).click();
    await expect(page).toHaveURL(/\/_site\/biomarker-screen\/evidence\.html$/);
    await page.locator('.page-tabs').getByRole('link', { name: 'API reference' }).click();
    await expect(page.locator('h1')).toHaveText('The biomarker screen');
    await expect(
      page.locator('.api-body h2 code').filter({ hasText: /^biomarkerScreen\(/ })
    ).toHaveCount(1);
    await page.locator('.page-tabs').getByRole('link', { name: 'Gallery' }).click();
    await card.getByRole('link', { name: 'Live demo' }).click();
    await expect(page).toHaveURL(/\/_site\/biomarker-screen\/index\.html$/);
    await expect(page.locator('h1')).toHaveText('Biomarker screen');
    expect(
      errors.filter((message) => !/webr|r-wasm|Failed to load resource/.test(message))
    ).toEqual([]);
  });

  test('BS-SITE-002: the live demo draws the chart on the synthetic study, opening on the planted difference, with R attached; where R cannot be reached it draws no rows, and says so (#36)', async ({
    page
  }) => {
    await blockR(page);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const scripts = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith('.js')) scripts.push(url.pathname.replace('/_site/', ''));
    });
    await page.goto('/_site/biomarker-screen/index.html');
    await page.evaluate(() => window.BioVizDemo.ready);
    expect(scripts.map((file) => file.replace(/bio\.viz-[\d.]+/, 'bio.viz-x'))).toEqual([
      'vendor/safety.viz/safety.viz.js',
      'dist/bio.viz-x/bio.viz.js',
      'demo/synthetic-study.js',
      'demo/biomarker-screen.js'
    ]);
    expect(await controls(page)).toMatchObject({
      comparison: 'difference',
      'value-type': 'change',
      visit: 'Week 4',
      'group-by': 'ARM',
      first: 'Placebo',
      second: 'Treatment',
      adjustment: 'BH',
      sort: 'estimate'
    });
    const shown = await screen(page);
    expect(shown.title).toBe(
      'Change from baseline at Week 4: Placebo against Treatment, standardised difference'
    );
    expect(shown.rows).toEqual([]);
    await expect(line(page)).toHaveAttribute('data-state', 'unavailable');
    await expect(line(page)).toHaveText(
      'Statistics are unavailable: R could not be started (Failed to fetch dynamically imported module: https://webr.r-wasm.org/v0.6.0/webr.mjs).'
    );
    await expect(page.locator('#chart .sv-control-section').last().locator('label')).toHaveText([
      'Arm',
      'Sex',
      'Response'
    ]);
    expect(
      await page.locator('#chart select[data-control="group-by"] option').allTextContents()
    ).toEqual(['Arm', 'Sex', 'Response']);
    await expect(page.locator('#about-demo')).toContainText(
      'IL-6 was planted with a difference between the arms'
    );
    await expect(page.locator('#demo-statistics')).toContainText(
      `copied from gsm.bio at commit ${statisticsRecord.commit.slice(0, 7)}`
    );
    const file = await page.request.get('/_site/vendor/gsm.bio/statistics.R');
    expect((await file.text()).includes('Analyze_Screen <- function(')).toBe(true);
    // A row opens here as on the fixture.
    await page.evaluate(() => {
      window.BioVizDemo.chart.open('IL-6');
    });
    await expect(drill(page).locator('.bv-back')).toBeFocused();
    expect(await page.evaluate(() => window.BioVizDemo.chart.opened().settings.start_value)).toBe(
      'IL-6'
    );
    await drill(page).locator('.bv-back').click();
    expect(errors).toEqual([]);
  });

  test('BS-SITE-003: the live demo holds at a 390px-wide viewport with no horizontal scroll, with the controls open and a row opened (#36)', async ({
    browser
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await blockR(page);
    await page.goto('/_site/biomarker-screen/index.html');
    await page.evaluate(() => window.BioVizDemo.ready);
    const measure = () =>
      page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth
      }));
    const holds = { viewport: 390, scrollWidth: 390, bodyScrollWidth: 390 };
    expect(await measure()).toEqual(holds);
    await expect(root(page)).toHaveClass(/sv-collapsed/);
    await root(page).locator('.sv-sidebar-toggle').tap();
    await expect(root(page).locator('.sv-controls')).toBeVisible();
    expect(await measure()).toEqual(holds);
    await root(page).locator('.sv-sidebar-toggle').tap();
    await captureEvidence(page.locator('#demo'), 'BS-SITE-003', 'demo-on-a-phone');
    await page.evaluate(() => {
      window.BioVizDemo.chart.open('IL-6');
    });
    await expect(drill(page).locator('.bv-back')).toBeVisible();
    expect(await measure()).toEqual(holds);
    await drill(page).locator('.bv-back').tap();
    expect(await measure()).toEqual(holds);
    await context.close();
  });

  test('BS-SITE-005: the demos point at one another: the screen’s page says a row opens the group comparison or the scatter, and their pages point to the screen as the way in (#36)', async ({
    page
  }) => {
    await blockR(page);
    await page.goto('/_site/biomarker-screen/index.html');
    for (const [target, words] of [
      [
        'group-comparison',
        'Click a row, or press Enter on it, to open that biomarker in the group comparison'
      ],
      ['association-scatter', 'A row of a correlation opens the association scatter']
    ]) {
      const link = page.locator(`#about-demo a[href="../${target}/index.html"]`);
      await expect(link).toHaveCount(1);
      await expect(
        page
          .locator('#about-demo li')
          .filter({ has: page.locator(`a[href="../${target}/index.html"]`) })
      ).toContainText(words);
    }
    for (const [from, words] of [
      [
        'group-comparison',
        'To find which biomarker differs between two groups, start from the biomarker screen'
      ],
      [
        'association-scatter',
        'To find which biomarker moves with a variable, start from the biomarker screen'
      ]
    ]) {
      await page.goto(`/_site/${from}/index.html`);
      const back = page
        .locator('#about-demo li')
        .filter({ has: page.locator('a[href="../biomarker-screen/index.html"]') });
      await expect(back).toContainText(words);
      await back.locator('a[href="../biomarker-screen/index.html"]').click();
      await expect(page).toHaveURL(/\/_site\/biomarker-screen\/index\.html$/);
    }
  });
});

// ---------------------------------------------------------------------------
// The gallery's demo, for real (#36). These tests need the network: they open
// the built demo page, which starts webR 0.6.0 from its public host and gives it
// gsm.bio's statistics file, and they hold what R in the browser answers to
// what desktop R answered for the same frames
// (tests/fixtures/screen-statistics-r.json). If R's host cannot be reached the
// tests fail; nothing here skips, and nothing retries. They run in order on one
// page, because R is started once and the cost of starting it is measured.
// Equality is 1 part in 10^8, the R check page's tolerance.

const megabytes = (bytes) => Number((bytes / 1e6).toFixed(2));

test.describe('biomarker screen: the demo, with R in the browser, live', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  let context;
  let page;
  const finished = [];
  const sideBySide = [];
  const measured = {};
  const differences = [];
  const isRFile = (url) => isRHost(url) || new URL(url).pathname.endsWith('/statistics.R');
  const chart = () => page.evaluate(() => Boolean(window.BioVizDemo.chart));
  const held = () => page.evaluate(() => window.BioVizDemo.chart.statistics()[0]);
  const frame = () =>
    page.evaluate(() =>
      window.BioVizDemo.chart.model.records.map((record) => Object.values(record))
    );
  const answered = async () => {
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const found = document.querySelector(
              '#chart > .bv-biomarker-screen .sv-main > .bv-statistic'
            );
            return found ? found.dataset.state : 'empty';
          }),
        { timeout: 200_000 }
      )
      .not.toMatch(/^(waiting|empty)$/);
  };
  const lineLog = () =>
    page.evaluate(() =>
      window.__line
        .filter((entry) => entry.state !== 'empty')
        .map(({ state, text, drawn }) => [state, text, drawn])
    );
  const clearLineLog = () =>
    page.evaluate(() => {
      window.__line = [];
    });
  const setView = (settings) =>
    page.evaluate((given) => {
      window.BioVizDemo.chart.setSettings(given);
    }, settings);
  const OPENING = {
    comparison: 'difference',
    ...WEEK_4,
    levels: null,
    adjustment: 'BH',
    sort: 'estimate',
    method: 'pearson'
  };
  const reopen = async () => {
    await page.evaluate((opening) => {
      const { chart: screenChart, biomarkerScreen } = window.BioVizDemo;
      screenChart.setSettings({ ...opening, filters: biomarkerScreen.settings.filters });
    }, OPENING);
    await answered();
  };
  const fixtureFrame = (file, comparison) => {
    const [header, ...lines] = readFileSync(
      new URL(`../fixtures/screen-statistics/${file}`, import.meta.url),
      'utf8'
    )
      .trimEnd()
      .split('\n');
    const last = header.split(',').length - 1;
    return lines.map((line) =>
      line.split(',').map((cell, index) => {
        if (index === 0 || (index === last && comparison === 'difference'))
          return cell === '' ? null : cell;
        return cell === '' ? null : Number(cell);
      })
    );
  };

  async function holdToDesktop(name, testInfo) {
    const expected = resultOf(name);
    await answered();
    const answer = await held();
    expect(answer.answer.status, `${name}: ${answer.answer.message}`).toBe('ok');
    expect(answer.answer.form).toBe('browser');
    expect({
      name: answer.name,
      args: answer.args,
      dataId: answer.dataId,
      rows: answer.rows
    }).toEqual({
      name: expected.name,
      args: expected.args,
      dataId: expected.dataId,
      rows: expected.rows
    });
    expect(await frame()).toEqual(fixtureFrame(expected.file, expected.args.strComparison));
    const actual = answer.answer.value;
    const compared = compareValues(expected.value, actual);
    const differing = compared.filter((row) => !row.ok);
    const numbers = compared.filter((row) => row.difference !== null);
    expect(actual.rows).toHaveLength(expected.value.rows.length);
    expected.value.rows.forEach((row, index) => {
      const inBrowser = actual.rows[index];
      expect(inBrowser.biomarker).toBe(row.biomarker);
      for (const member of [
        'counts',
        'n_1',
        'n_2',
        'adjusted_over',
        'status',
        'reason',
        'adjustment'
      ]) {
        expect(inBrowser[member], `${name} ${row.biomarker} ${member}`).toBe(row[member]);
      }
      for (const member of ['estimate', 'lower', 'upper', 'level', 'p_unadjusted', 'p_value']) {
        if (row[member] === null) expect(inBrowser[member]).toBe(null);
        else {
          const scale = Math.max(Math.abs(row[member]), Math.abs(inBrowser[member]));
          expect(
            Math.abs(inBrowser[member] - row[member]),
            `${name} ${row.biomarker} ${member}: desktop ${row[member]}, browser ${inBrowser[member]}`
          ).toBeLessThanOrEqual(TOLERANCE.relative * scale);
        }
      }
    });
    const comparison = expected.args.strComparison;
    const shown = await screen(page);
    expectRows(shown, actual, {
      groups:
        comparison === 'difference'
          ? expected.args.chrGroups
          : comparison === 'hazard'
            ? ['High', 'Low']
            : null,
      comparison
    });
    sideBySide.push({
      case: name,
      rows: expected.value.rows.length,
      computed: expected.value.rows.filter((row) => row.status === 'ok').length,
      top: shown.rows[0] ? shown.rows[0].biomarker : null,
      numbersCompared: numbers.length,
      greatestRelativeDifference: Math.max(
        0,
        ...numbers
          .filter((row) => row.ok)
          .map(
            (row) => row.difference / Math.max(Math.abs(row.expected), Math.abs(row.actual)) || 0
          )
      ),
      differing: differing.map(({ path: where, expected: desktop, actual: browser }) => ({
        where,
        desktop,
        browser
      }))
    });
    await testInfo.attach(`${name}-desktop-R-and-webR.json`, {
      body: JSON.stringify({ desktopR: expected.value, webR: actual, differing }, null, 2),
      contentType: 'application/json'
    });
    return { expected: expected.value, actual, differing, shown };
  }
  function onlyWording(name, differing) {
    const worded = /^(warnings\[\d+\]|rows\[\d+\]\.warning)$/;
    expect(differing.filter((row) => !worded.test(row.path))).toEqual([]);
    for (const row of differing) {
      expect(row.actual.toLowerCase()).toBe(row.expected.toLowerCase());
    }
    if (differing.length) {
      differences.push({
        case: name,
        where: `${differing.length} warnings (${differing[0].path}, …)`,
        desktop: differing[0].expected,
        browser: differing[0].actual
      });
    }
  }

  test.beforeAll(async ({}, testInfo) => {
    const profile = mkdtempSync(path.join(tmpdir(), 'bio-viz-biomarker-screen-'));
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 1280, height: 800 }
    });
    await context.addInitScript(() => {
      window.__line = [];
      new MutationObserver(() => {
        const found = document.querySelector(
          '#chart > .bv-biomarker-screen .sv-main > .bv-statistic'
        );
        if (!found) return;
        const entry = {
          state: found.dataset.state || 'empty',
          text: found.textContent,
          drawn: document.querySelectorAll('#chart > .bv-biomarker-screen .bv-screen-row').length
        };
        const last = window.__line.at(-1);
        if (!last || last.state !== entry.state || last.text !== entry.text) {
          window.__line.push({ ...entry, at: performance.now() });
        }
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true
      });
    });
    page = context.pages()[0] || (await context.newPage());
    page.on('requestfinished', async (request) => {
      const entry = { url: request.url(), bytes: 0 };
      finished.push(entry);
      const sizes = await request.sizes().catch(() => null);
      if (sizes) entry.bytes = Math.max(0, sizes.responseBodySize);
    });
    await page.goto('/_site/biomarker-screen/index.html');
    await page.evaluate(() => window.BioVizDemo.ready);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('BS-LIVE-001: the demo starts R when the screen first asks; the line waits, saying what the first start costs, and then every row is desktop R’s, in the order of R’s estimates with IL-6 at the top (#36)', async ({}, testInfo) => {
    expect(await chart()).toBe(true);
    const { differing, shown, actual } = await holdToDesktop('difference-week-4-change', testInfo);
    expect(differing).toEqual([]);
    expect(shown.rows).toHaveLength(12);
    expect(shown.rows[0].biomarker).toBe('IL-6');
    expect(actual.rows.find((row) => row.biomarker === 'IL-6').p_value).toBeLessThan(0.001);
    const log = await lineLog();
    expect(log[0]).toEqual([
      'waiting',
      'Statistics: waiting for R… The first screen starts R in this browser and installs the survival package: about 26 MB to download, once, and a few seconds.',
      0
    ]);
    expect(log.map(([state]) => state)).toEqual(['waiting', 'shown']);
    expect(await said(page)).not.toMatch(/\*|significan/i);
    const forR = finished.filter((request) => isRFile(request.url)).map((request) => request.url);
    expect(forR.filter((url) => url.endsWith('/webr.mjs'))).toEqual([
      'https://webr.r-wasm.org/v0.6.0/webr.mjs'
    ]);
    expect(forR.filter((url) => url.endsWith('/statistics.R'))).toEqual([
      new URL('/_site/vendor/gsm.bio/statistics.R', page.url()).href
    ]);
    // The survival package, which a hazard ratio calls, is installed with R
    // (#62): it and the packages it needs come from webR's repository.
    const fromRepo = forR.filter((url) => new URL(url).hostname === 'repo.r-wasm.org');
    expect(fromRepo.some((url) => /\/survival_[\d.-]+\.tgz$/.test(url))).toBe(true);
    expect(fromRepo.every((url) => url.includes('/bin/emscripten/contrib/'))).toBe(true);
    const times = await page.evaluate(() =>
      ['waiting', 'shown'].map((state) => window.__line.find((entry) => entry.state === state).at)
    );
    const files = finished.filter((request) => isRFile(request.url));
    measured.cold = {
      megabytes: megabytes(files.reduce((total, file) => total + file.bytes, 0)),
      bytes: files.reduce((total, file) => total + file.bytes, 0),
      requests: files.length,
      seconds: Number(((times[1] - times[0]) / 1000).toFixed(3)),
      files: [...files]
    };
    await captureEvidence(page.locator('#demo'), 'BS-LIVE-001', 'r-in-the-browser');
  });

  test('BS-LIVE-002: with Holm’s adjustment every row equals desktop R’s (#36)', async ({}, testInfo) => {
    const before = finished.filter((request) => isRFile(request.url)).length;
    await clearLineLog();
    await choose(page, 'adjustment', 'holm');
    const { differing, shown } = await holdToDesktop('difference-week-4-change-holm', testInfo);
    expect(differing).toEqual([]);
    expect(shown.rows[0].biomarker).toBe('IL-6');
    expect(finished.filter((request) => isRFile(request.url))).toHaveLength(before);
    expect((await lineLog())[0]).toEqual(['waiting', WAITING, 0]);
    await expect(root(page).locator('.bv-screen-head > span').nth(3)).toHaveText('p, Holm');
    await choose(page, 'adjustment', 'BH');
    await answered();
  });

  test('BS-LIVE-003: the correlation against IL-10 at Baseline, by Benjamini-Hochberg and by Holm and with Spearman, equals desktop R’s in every row, with TNF-alpha at the top and 0.6 inside its interval (#36)', async ({}, testInfo) => {
    await setView({ ...AGAINST_IL10, adjustment: 'BH', method: 'pearson' });
    const pearson = await holdToDesktop('correlation-il-10', testInfo);
    expect(pearson.differing).toEqual([]);
    expect(pearson.shown.rows[0].biomarker).toBe('TNF-alpha');
    const tnf = pearson.actual.rows.find((row) => row.biomarker === 'TNF-alpha');
    expect(tnf.lower).toBeLessThan(0.6);
    expect(tnf.upper).toBeGreaterThan(0.6);
    expect(pearson.shown.rows.map((row) => row.biomarker)).not.toContain('IL-10');
    await choose(page, 'adjustment', 'holm');
    expect((await holdToDesktop('correlation-il-10-holm', testInfo)).differing).toEqual([]);
    await choose(page, 'adjustment', 'BH');
    await answered();
    await choose(page, 'method', 'spearman');
    const ranked = await holdToDesktop('correlation-il-10-spearman', testInfo);
    onlyWording('correlation-il-10-spearman', ranked.differing);
    expect(ranked.shown.rows[0].biomarker).toBe('TNF-alpha');
    expect(ranked.actual.rows.every((row) => row.lower === null)).toBe(true);
  });

  test('BS-LIVE-004: a change shows the waiting state and then the new screen, as desktop R gives it, and never the old one: a filter, another column of groups, the result at Baseline, a participant-level number, and every row too small (#36)', async ({}, testInfo) => {
    await reopen();
    await clearLineLog();
    await root(page).locator('select[data-filter="SEX"]').selectOption('F');
    const women = await holdToDesktop('difference-week-4-change-women', testInfo);
    expect(women.differing).toEqual([]);
    const log = await lineLog();
    expect(log.map(([state, , drawn]) => [state, drawn])).toEqual([
      ['waiting', 0],
      ['shown', 12]
    ]);
    for (const [, text] of log) expect(text).not.toContain('187 participants');
    await root(page).locator('select[data-filter="SEX"]').selectOption('__all__');
    await answered();
    await choose(page, 'group-by', 'SEX');
    expect((await holdToDesktop('difference-sex', testInfo)).differing).toEqual([]);
    await setView({ group_by: 'ARM', visit: 'Baseline', value_type: 'raw' });
    const baseline = await holdToDesktop('difference-baseline', testInfo);
    expect(baseline.differing).toEqual([]);
    expect(baseline.shown.rows[0].biomarker).not.toBe('IL-6');
    await setView({
      comparison: 'correlation',
      visit: 'Week 4',
      value_type: 'change',
      with: { col: 'AGE' }
    });
    expect((await holdToDesktop('correlation-age', testInfo)).differing).toEqual([]);
    await page.evaluate((opening) => {
      const { chart: screenChart, biomarkerScreen } = window.BioVizDemo;
      screenChart.setSettings({
        ...opening,
        filters: biomarkerScreen.settings.filters.concat([{ value_col: 'AGE', label: 'Age' }])
      });
    }, OPENING);
    await answered();
    await clearLineLog();
    await root(page).locator('select[data-filter="AGE"]').selectOption('35');
    const few = await holdToDesktop('difference-age-35', testInfo);
    expect(few.differing).toEqual([]);
    await expect(line(page)).toHaveAttribute('data-state', 'withheld');
    expect(few.shown.rows.every((row) => row.status === 'withheld' && row.dot === null)).toBe(true);
    expect((await lineLog()).map(([state]) => state)).toEqual(['waiting', 'withheld']);
  });

  test('BS-LIVE-005: a row of the difference opens the group comparison, whose Welch p-value from the same R is the row’s; a row of the correlation opens the scatter, whose coefficient is the row’s; returning asks R nothing (#36)', async () => {
    await reopen();
    await page.evaluate(() => {
      const { connection } = window.BioVizDemo.chart;
      window.__runs = [];
      window.BioVizDemo.chart.setSettings({
        connection: {
          run: (name, request) => {
            window.__runs.push(name);
            return connection.run(name, request);
          }
        }
      });
    });
    await answered();
    const runs = () => page.evaluate(() => window.__runs);
    const rFiles = finished.filter((request) => isRFile(request.url)).length;
    for (const [settings, biomarker, kind] of [
      [{}, 'IL-6', 'difference'],
      [{ ...AGAINST_IL10, method: 'pearson' }, 'TNF-alpha', 'correlation']
    ]) {
      if (kind === 'correlation') {
        await setView(settings);
        await answered();
      }
      const before = { screen: await screen(page), held: await held() };
      const row = before.held.answer.value.rows.find((entry) => entry.biomarker === biomarker);
      await page.evaluate(() => {
        window.__runs = [];
      });
      await rowAt(page, biomarker).click();
      await expect(drill(page).locator('.bv-back')).toBeFocused();
      const status =
        kind === 'difference'
          ? drill(page).locator('.bv-statistic').first()
          : drill(page).locator('.bv-coefficient');
      await expect(status).toHaveAttribute('data-state', 'shown', { timeout: 200_000 });
      const [asked] = await page.evaluate(() => window.BioVizDemo.chart.opened().statistics());
      expect(asked.answer.form).toBe('browser');
      if (kind === 'difference') {
        expect(await runs()).toEqual(['Analyze_GroupDifference']);
        expect(asked.answer.value.p_value).toBe(row.p_unadjusted);
        expect(asked.answer.value.method).toBe(row.method);
        expect(asked.rows).toBe(row.counts);
      } else {
        expect(await runs()).toEqual(['Analyze_Correlation']);
        expect(asked.answer.value.estimates[0].estimate).toBe(row.estimate);
        expect([
          asked.answer.value.estimates[0].lower,
          asked.answer.value.estimates[0].upper
        ]).toEqual([row.lower, row.upper]);
        expect(asked.answer.value.p_value).toBe(row.p_unadjusted);
      }
      expect(finished.filter((request) => isRFile(request.url))).toHaveLength(rFiles);
      if (kind === 'difference') {
        await captureEvidence(page.locator('#demo'), 'BS-LIVE-005', 'a-row-opened-with-r');
      }
      await drill(page).locator('.bv-back').click();
      await expect(rowAt(page, biomarker)).toBeFocused();
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
      expect(await runs()).toHaveLength(1);
      expect(await screen(page)).toEqual(before.screen);
      expect(await held()).toEqual(before.held);
    }
    expect(finished.filter((request) => request.url.endsWith('/webr.mjs'))).toHaveLength(1);
    // A screen once R has started: how long R takes for the opening view again.
    await reopen();
    await clearLineLog();
    await page.evaluate(() => window.BioVizDemo.chart.render());
    await answered();
    const times = await page.evaluate(() =>
      ['waiting', 'shown'].map((state) => window.__line.find((entry) => entry.state === state).at)
    );
    measured.warm = Number(((times[1] - times[0]) / 1000).toFixed(3));
  });

  test('BS-HAZ-008: with R and the survival package in this browser, every hazard row, by Benjamini-Hochberg and by Holm, for the women alone, with every row too small, with thirty outcomes taken out and with a ratio R cannot estimate, is desktop R’s, CRP at the top; its row opens the stratified survival chart, whose hazard ratio from the same R is the row’s, and the way back returns (#62)', async ({}, testInfo) => {
    await reopen();
    await setView({ comparison: 'hazard', visit: 'Baseline', value_type: 'raw', adjustment: 'BH' });
    const bh = await holdToDesktop('hazard-baseline', testInfo);
    expect(bh.differing).toEqual([]);
    expect(bh.shown.rows[0].biomarker).toBe('CRP');
    await root(page).locator('select[data-filter="SEX"]').selectOption('F');
    expect((await holdToDesktop('hazard-baseline-women', testInfo)).differing).toEqual([]);
    await root(page).locator('select[data-filter="SEX"]').selectOption('__all__');
    await answered();
    await setView({ adjustment: 'holm' });
    const holm = await holdToDesktop('hazard-baseline-holm', testInfo);
    expect(holm.differing).toEqual([]);
    const crp = holm.actual.rows.find((row) => row.biomarker === 'CRP');
    await rowAt(page, 'CRP').click();
    await expect(drill(page).locator('.bv-back')).toBeFocused();
    const status = drill(page).locator('.bv-statistic').first();
    await expect(status).toHaveAttribute('data-state', 'shown', { timeout: 200_000 });
    const [asked] = await page.evaluate(() => window.BioVizDemo.chart.opened().statistics());
    expect(asked.answer.form).toBe('browser');
    expect(asked.dataId.group_by).toEqual({
      measure: 'CRP',
      visit: 'Baseline',
      value: 'raw',
      cut: 'median'
    });
    const hazard = asked.answer.value.estimates.find((row) => row.name === 'Hazard ratio');
    for (const member of ['estimate', 'lower', 'upper']) {
      const scale = Math.max(Math.abs(hazard[member]), Math.abs(crp[member]));
      expect(Math.abs(hazard[member] - crp[member]), member).toBeLessThanOrEqual(
        TOLERANCE.relative * scale
      );
    }
    expect(asked.answer.value.p_value).toBe(crp.p_unadjusted);
    await captureEvidence(page.locator('#demo'), 'BS-HAZ-008', 'a-hazard-row-opened-with-r');
    await drill(page).locator('.bv-back').click();
    await expect(rowAt(page, 'CRP')).toBeFocused();
    // Every row too small, among the four participants aged 35.
    await page.evaluate(() => {
      const { chart: screenChart, biomarkerScreen } = window.BioVizDemo;
      screenChart.setSettings({
        filters: biomarkerScreen.settings.filters.concat([{ value_col: 'AGE', label: 'Age' }]),
        adjustment: 'BH'
      });
    });
    await answered();
    await root(page).locator('select[data-filter="AGE"]').selectOption('35');
    const few = await holdToDesktop('hazard-baseline-age-35', testInfo);
    expect(few.differing).toEqual([]);
    await expect(line(page)).toHaveAttribute('data-state', 'withheld');
    // On a changed outcomes table: thirty participants with CRP and no outcome,
    // then no event in CRP's Low half, which R cannot estimate a ratio for.
    const withLiveOutcomes = (outcomes, settings) =>
      page.evaluate(
        ({ outcomes, settings }) => {
          const { chart: screenChart, biomarkerScreen } = window.BioVizDemo;
          screenChart.setData(
            { ...screenChart.tables, outcomes },
            { ...settings, filters: biomarkerScreen.settings.filters }
          );
        },
        { outcomes, settings }
      );
    const opened = await page.evaluate(() => window.BioVizDemo.chart.tables.outcomes);
    const hazardView = {
      comparison: 'hazard',
      visit: 'Baseline',
      value_type: 'raw',
      adjustment: 'BH'
    };
    await withLiveOutcomes(changedOutcomes('hazard-baseline-30-without-outcome'), hazardView);
    await answered();
    const without = await holdToDesktop('hazard-baseline-30-without-outcome', testInfo);
    expect(without.differing).toEqual([]);
    expect(without.shown.rows[0].biomarker).toBe('CRP');
    await withLiveOutcomes(changedOutcomes('hazard-baseline-no-events-in-low-crp'), hazardView);
    await answered();
    const none = await holdToDesktop('hazard-baseline-no-events-in-low-crp', testInfo);
    expect(none.differing).toEqual([]);
    expect(none.shown.rows.find((row) => row.biomarker === 'CRP').value).toMatch(
      /^Not computed: the hazard ratio is not estimable: Low has no events/
    );
    await withLiveOutcomes(opened, hazardView);
    await answered();
  });

  test('BS-LIVE-006: the megabytes and seconds of the first screen, and of a screen once R has started, are measured, recorded, and are what the page tells its reader (#36)', async ({
    browser
  }, testInfo) => {
    const told = await page.evaluate(() => window.BioVizDemo.biomarkerScreen);
    expect(told.settings.waiting_note).toContain(`about ${told.megabytes} MB`);
    expect(told.browser).toEqual({
      sourceUrl: '../vendor/gsm.bio/statistics.R',
      packages: ['survival']
    });
    expect(measured.cold.megabytes).toBeGreaterThan(5);
    expect(Math.abs(measured.cold.megabytes - told.megabytes)).toBeLessThan(1.5);
    expect(measured.warm).toBeGreaterThan(0);
    const record = {
      recorded: new Date().toISOString(),
      browser: `Chromium ${browser.version()}, headless`,
      machine:
        process.env.R_CHECK_MACHINE ||
        (process.env.CI ? 'a GitHub Actions runner (ubuntu-latest)' : 'not named'),
      profile: 'a new, empty browser profile with a disk cache',
      firstScreen: {
        ...measured.cold,
        files: undefined,
        secondsAre:
          'from the moment the line first read that it was waiting to the moment the rows were drawn from R’s answer, with R started on the way'
      },
      screenOnceStarted: {
        seconds: measured.warm,
        of: 'the opening view: 12 biomarkers, 187 participants'
      },
      tolerance: `1 part in 10^${Math.round(-Math.log10(TOLERANCE.relative))}`,
      desktopR: statistics.made_by,
      answers: sideBySide,
      differencesBetweenVersions: differences,
      files: measured.cold.files
    };
    const text = JSON.stringify(record, null, 2) + '\n';
    await testInfo.attach('biomarker-screen-measurements.json', {
      body: text,
      contentType: 'application/json'
    });
    mkdirSync(new URL('../../test-results/', import.meta.url), { recursive: true });
    writeFileSync(
      new URL('../../test-results/biomarker-screen-measurements.json', import.meta.url),
      text
    );
    console.log(`\nBiomarker screen demo, first screen — ${record.browser}, ${record.machine}`);
    console.log(
      `  ${measured.cold.megabytes} MB over the network in ${measured.cold.requests} requests, ` +
        `${measured.cold.seconds} s from waiting to R's rows; ${measured.warm} s for a screen once R has started`
    );
    console.log(
      `\nDesktop R ${statistics.made_by.r_version} beside R in the browser, tolerance ${record.tolerance}`
    );
    for (const entry of sideBySide) {
      console.log(
        `  ${entry.case.padEnd(32)} ${String(entry.rows).padStart(2)} rows, ${String(entry.computed).padStart(2)} computed, ` +
          `top ${String(entry.top).padEnd(9)} ${entry.numbersCompared} numbers, greatest relative difference ` +
          `${entry.greatestRelativeDifference.toExponential(2)}, ${entry.differing.length} differing`
      );
    }
    for (const difference of differences) {
      console.log(
        `  R's own answer differs between the versions, ${difference.case} ${difference.where}: desktop ${difference.desktop}, browser ${difference.browser}`
      );
    }
    expect(sideBySide.map((entry) => entry.case).sort()).toEqual(
      statistics.results.map((result) => result.case).sort()
    );
  });

  test('BS-LIVE-007: on a phone the demo draws its rows from R, stacked, and the page does not scroll sideways (#36)', async ({}, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.evaluate(() => window.BioVizDemo.ready);
    const measure = () =>
      page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth
      }));
    const holds = { viewport: 390, scrollWidth: 390, bodyScrollWidth: 390 };
    await expect(root(page)).toHaveClass(/sv-collapsed/);
    expect(await measure()).toEqual(holds);
    const { differing, shown } = await holdToDesktop('difference-week-4-change', testInfo);
    sideBySide.pop();
    expect(differing).toEqual([]);
    expect(shown.rows[0].biomarker).toBe('IL-6');
    expect(await measure()).toEqual(holds);
    const overflowing = await page.evaluate(() =>
      [...document.querySelectorAll('#demo *')]
        .filter((element) => element.getBoundingClientRect().right > 390.5)
        .map((element) => element.className || element.tagName.toLowerCase())
    );
    expect(overflowing).toEqual([]);
    await captureEvidence(page.locator('#demo'), 'BS-LIVE-007', 'r-in-the-browser-on-a-phone');
  });
});

test.describe('biomarker screen: the hazard rows', () => {
  test('BS-HAZ-005: with an outcomes table the screen offers a hazard ratio, high against low: from R’s stored answer every row is drawn on a logarithmic axis with 1 marked, CRP at the top, each with High’s and Low’s counts (#62)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page, { data: 'outcomes' });
    const offered = await page
      .locator('#chart .sv-sidebar select[data-control="comparison"] option')
      .allTextContents();
    expect(offered).toEqual([
      'Difference between two groups',
      'Correlation with one variable',
      'Hazard ratio, high against low'
    ]);
    await withStored(page, stored('hazard-baseline'), {
      comparison: 'hazard',
      visit: 'Baseline',
      value_type: 'raw'
    });
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const shown = await screen(page);
    expect(shown.title).toBe(
      'Result at Baseline: hazard ratio, high against low, on Event-free survival (months)'
    );
    expect(shown.caption).toMatch(
      /^Each row: Hazard ratio, High \/ Low, on Event-free survival \(months\), with its 95% confidence interval on one logarithmic axis, with 1, no difference, marked\./
    );
    expect(shown.ticks).toContain('1');
    // The hint names the line the log axis marks: 1, not nought.
    await expect(root(page).locator('.sv-footnote')).toHaveText(
      'Click a row, or press Enter on it, to open that biomarker in its own chart. The estimates share one logarithmic axis without units, with 1, no difference, marked.'
    );
    expectRows(shown, resultOf('hazard-baseline').value, {
      groups: ['High', 'Low'],
      comparison: 'hazard'
    });
    expect(shown.rows[0].biomarker).toBe('CRP');
    expect(await controls(page)).toMatchObject({ comparison: 'hazard', endpoint: 'EFS' });
    await captureEvidence(root(page).locator('.bv-screen'), 'BS-HAZ-005', 'hazard-rows');
    expect(errors).toEqual([]);
  });

  test('BS-HAZ-006: without an outcomes table the screen offers only its other two comparisons and says why, and a setting asking for a hazard ratio opens on a difference (#62)', async ({
    page
  }) => {
    await open(page, { settings: { comparison: 'hazard' } });
    const offered = await page
      .locator('#chart .sv-sidebar select[data-control="comparison"] option')
      .allTextContents();
    expect(offered).toEqual(['Difference between two groups', 'Correlation with one variable']);
    await expect(root(page).locator('.bv-no-outcomes')).toHaveText(
      'A hazard ratio needs an outcomes table: give `outcomes`, one row per participant and endpoint, with a time and a flag, as `init({ results, participants, outcomes })`.'
    );
    expect(await controls(page)).toMatchObject({ comparison: 'difference' });
    // Given an outcomes table, it is offered.
    await page.evaluate(() =>
      window.BioVizDemo.loadOutcomes('/site/data/synthetic-study/').then((outcomes) =>
        window.__bs.chart.setData({ ...window.__bs.data, outcomes })
      )
    );
    await expect(
      page.locator('#chart .sv-sidebar select[data-control="comparison"] option')
    ).toHaveCount(3);
    await expect(root(page).locator('.bv-no-outcomes')).toHaveCount(0);
  });

  test('BS-HAZ-007: a click on a hazard row opens the stratified survival chart for that biomarker, cut at its median, on the same endpoint, with the screen’s connection and filters; its hazard ratio from stored results is the row’s; the way back returns (#62)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page, { data: 'outcomes' });
    const survival = readJson('../fixtures/stratified-survival-r.json').cases.find(
      (entry) => entry.case === 'crp-median'
    );
    await withStored(
      page,
      [
        ...stored('hazard-baseline'),
        {
          name: survival.name,
          args: survival.args,
          dataId: survival.dataId,
          rows: survival.rows,
          value: survival.value
        }
      ],
      { comparison: 'hazard', visit: 'Baseline', value_type: 'raw' }
    );
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    await rowAt(page, 'CRP').click();
    await expect(root(page)).toBeHidden();
    const back = drill(page).locator('.bv-back');
    await expect(back).toHaveText(BACK);
    await expect(back).toBeFocused();
    const now = await page.evaluate(() => {
      const chart = window.__bs.chart.opened();
      return {
        survival: chart.root.classList.contains('bv-stratified-survival'),
        connection: chart.connection === window.__bs.chart.connection,
        group_by: chart.settings.group_by,
        endpoint: chart.settings.endpoint,
        filters: chart.settings.filters.map((spec) => spec.value_col),
        asked: chart.statistics().map(({ answer }) => answer && answer.form)
      };
    });
    expect(now).toMatchObject({
      survival: true,
      connection: true,
      group_by: { measure: 'CRP', visit: 'Baseline', value: 'raw', cut: 'median' },
      endpoint: 'EFS',
      filters: expect.any(Array),
      asked: ['precomputed']
    });
    const row = resultOf('hazard-baseline').value.rows.find((entry) => entry.biomarker === 'CRP');
    const hazard = survival.value.estimates.find((entry) => entry.name === 'Hazard ratio');
    expect([hazard.estimate, hazard.lower, hazard.upper]).toEqual([
      row.estimate,
      row.lower,
      row.upper
    ]);
    await expect(drill(page).locator('.bv-statistic').first()).toContainText('Hazard ratio');
    await back.click();
    await expect(root(page)).toBeVisible();
    await expect(rowAt(page, 'CRP')).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('BS-HAZ-011: with thirty participants holding CRP but no outcome, the row and the survival chart it opens cut at the same median, of those with both, with the same High and Low counts and the same hazard ratio; the thirty are counted once (#62)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page, { data: 'outcomes' });
    await withOutcomes(page, changedOutcomes('hazard-baseline-30-without-outcome'));
    const survival = survivalCase('crp-median-30-without-outcome');
    await withStored(page, [...stored('hazard-baseline-30-without-outcome'), keyed(survival)], {
      comparison: 'hazard',
      visit: 'Baseline',
      value_type: 'raw'
    });
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const value = resultOf('hazard-baseline-30-without-outcome').value;
    expectRows(await screen(page), value, { groups: ['High', 'Low'], comparison: 'hazard' });
    const gaps = (await notes(page).allTextContents()).filter((note) =>
      note.includes('no outcome to use')
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatch(/^30 with no outcome to use: /);
    await rowAt(page, 'CRP').click();
    await expect(root(page)).toBeHidden();
    const now = await page.evaluate(() => {
      const chart = window.__bs.chart.opened();
      return {
        points: chart.model.cut.points,
        counts: chart.model.levels.map(
          (level) => chart.model.records.filter((record) => record.group === level).length
        ),
        asked: chart.statistics().map(({ answer }) => answer && answer.form)
      };
    });
    const row = value.rows.find((entry) => entry.biomarker === 'CRP');
    expect(now.points).toEqual(survival.points);
    expect(now.counts.sort()).toEqual([row.n_1, row.n_2].sort());
    expect(now.asked).toEqual(['precomputed']);
    const hazard = survival.value.estimates.find((entry) => entry.name === 'Hazard ratio');
    expect(hazard.estimate).toBeCloseTo(row.estimate, 10);
    expect([hazard.lower, hazard.upper].map((bound) => bound.toFixed(10))).toEqual(
      [row.lower, row.upper].map((bound) => bound.toFixed(10))
    );
    await expect(drill(page).locator('.bv-statistic').first()).toContainText(
      'Hazard ratio, high over low'
    );
    expect(errors).toEqual([]);
  });

  test('BS-HAZ-012: a hazard ratio R could not estimate, CRP’s Low half having no event, is drawn as a row with R’s reason and no mark, out of the adjustment, which is across the other eleven (#62)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page, { data: 'outcomes' });
    await withOutcomes(page, changedOutcomes('hazard-baseline-no-events-in-low-crp'));
    await withStored(page, stored('hazard-baseline-no-events-in-low-crp'), {
      comparison: 'hazard',
      visit: 'Baseline',
      value_type: 'raw'
    });
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    await expect(line(page)).toContainText('11 of 12 computed');
    await expect(line(page)).toContainText('across the 11 biomarkers that have a p-value');
    const value = resultOf('hazard-baseline-no-events-in-low-crp').value;
    const shown = await screen(page);
    expectRows(shown, value, { groups: ['High', 'Low'], comparison: 'hazard' });
    const crp = shown.rows.find((row) => row.biomarker === 'CRP');
    expect(crp.value).toBe(
      "Not computed: the hazard ratio is not estimable: Low has no events, so the Cox model's estimate is infinite. Not in the adjustment."
    );
    expect([crp.dot, crp.line]).toEqual([null, null]);
    expect(shown.rows.at(-1).biomarker).toBe('CRP');
    expect(errors).toEqual([]);
  });

  test('BS-HAZ-013: with two endpoints the Endpoint control offers both by their labels; choosing the second asks R again on its times, names it in the heading and the identity, and a row opens the survival chart on it (#62)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page, { data: 'outcomes', before: stubR });
    // The demo's event-free survival, and overall survival at twice its times.
    await page.evaluate(() => {
      const efs = window.__bs.data.outcomes;
      const os = efs.map((row) => ({
        ...row,
        PARAMCD: 'OS',
        PARAM: 'Overall survival (months)',
        AVAL: String(Number(row.AVAL) * 2)
      }));
      window.__bs.chart.setData({ ...window.__bs.data, outcomes: [...efs, ...os] });
    });
    await attachStub(page, { comparison: 'hazard', visit: 'Baseline', value_type: 'raw' });
    await expect.poll(() => called(page)).toBe(1);
    expect(
      await page.evaluate(() => window.__bs.chart.statistics().map(({ dataId }) => dataId.endpoint))
    ).toEqual(['EFS']);
    const endpoint = page.locator('#chart .sv-sidebar select[data-control="endpoint"]');
    expect(await endpoint.locator('option').allTextContents()).toEqual([
      'Event-free survival (months)',
      'Overall survival (months)'
    ]);
    await answer(page, 0, 'hazard-baseline');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    await choose(page, 'endpoint', 'OS');
    await expect.poll(() => called(page)).toBe(2);
    expect(
      await page.evaluate(() => window.__bs.chart.statistics().map(({ dataId }) => dataId.endpoint))
    ).toEqual(['OS']);
    expect((await calls(page)).map(({ rows }) => rows)).toEqual([200, 200]);
    // The second frame's times are overall survival's: twice the first's.
    expect(
      await page.evaluate(() =>
        window.__r.calls[1].data.every(
          (record, i) => record.time === window.__r.calls[0].data[i].time * 2
        )
      )
    ).toBe(true);
    await answer(page, 1, 'hazard-baseline');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expect((await screen(page)).title).toBe(
      'Result at Baseline: hazard ratio, high against low, on Overall survival (months)'
    );
    expect(await controls(page)).toMatchObject({ comparison: 'hazard', endpoint: 'OS' });
    await rowAt(page, 'CRP').click();
    await expect(root(page)).toBeHidden();
    const opened = await page.evaluate(() => {
      const chart = window.__bs.chart.opened();
      return {
        endpoint: chart.settings.endpoint,
        first: chart.model.records[0].time,
        dataId: chart.statistics()[0].dataId.endpoint
      };
    });
    const efsFirst = await page.evaluate(() => {
      const chart = window.__bs.chart.opened();
      const id = chart.model.records[0][chart.settings.id_col];
      return Number(window.__bs.data.outcomes.find((row) => row.USUBJID === id).AVAL);
    });
    expect(opened).toMatchObject({ endpoint: 'OS', dataId: 'OS' });
    expect(opened.first).toBe(efsFirst * 2);
    expect(errors).toEqual([]);
  });

  test('BS-HAZ-014: on a wide logarithmic axis the tick labels are thinned to every other one, counted from 1, which is always labelled, and each is written by the shared rule for a value (#65 review)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page, { data: 'outcomes' });
    // R's answer with one row's interval made wide, from 0.6 to 300.
    const wide = keyed(resultOf('hazard-baseline'));
    wide.value = {
      ...wide.value,
      rows: wide.value.rows.map((row) =>
        row.biomarker === 'CRP' ? { ...row, lower: 0.6, upper: 300 } : row
      )
    };
    await withStored(page, [wide], { comparison: 'hazard', visit: 'Baseline', value_type: 'raw' });
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const { ticks } = axisRange(
      wide.value.rows.filter((row) => row.status === 'ok'),
      'hazard'
    );
    expect(ticks.length).toBeGreaterThan(7);
    const one = ticks.indexOf(1);
    expect(one).toBe(1);
    const labelled = ticks.filter((tick, index) => (index - one) % 2 === 0);
    expect((await screen(page)).ticks).toEqual(labelled.map((tick) => shownValue(tick)));
    expect(labelled).toContain(1);
    // A narrow axis keeps every label.
    await withStored(page, stored('hazard-baseline'), {});
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expect((await screen(page)).ticks).toEqual(['0.5', '1', '2', '4', '8']);
    expect(errors).toEqual([]);
  });

  test('BS-HAZ-015: an endpoint setting the outcomes table does not hold warns in the console, as a visit does, and the screen opens on the first endpoint (#65 review)', async ({
    page
  }) => {
    const warnings = warningsOf(page);
    await open(page, { data: 'outcomes', settings: { comparison: 'hazard', endpoint: 'PFS' } });
    expect(warnings).toContain(
      'The initial endpoint [PFS] does not exist. Defaulting to the first.'
    );
    expect(await controls(page)).toMatchObject({ comparison: 'hazard', endpoint: 'EFS' });
    // Without an outcomes table there is no endpoint to warn about.
    const quiet = await page.evaluate(() => {
      const before = [];
      const warn = console.warn;
      console.warn = (text) => before.push(text);
      window.BioViz.biomarkerScreen(document.createElement('div'), {
        baseline_visits: 'Baseline',
        endpoint: 'PFS'
      }).init({ results: window.__bs.data.results, participants: window.__bs.data.participants });
      console.warn = warn;
      return before.filter((text) => text.includes('endpoint'));
    });
    expect(quiet).toEqual([]);
  });
});

test.describe('biomarker screen: the filter rules safety.viz’s charts follow', () => {
  test('BS-FILTER-002: a filter reads its spec by safety.viz’s rule: `start` opens it with All still offered, only `all: false` removes All and its first value is then in force, a value the data lacks falls back to All with a warning, and the chart filters by what the controls show (#37)', async ({
    page
  }) => {
    const warnings = warningsOf(page);
    await open(page, {
      settings: { visit: 'Week 4', value_type: 'change', group_by: 'SEX', filters: RULED_FILTERS }
    });
    await expectFilterRules(page, warnings, () => ({ ...window.__bs.chart.state.filters }));
  });
});

// ---- What the v0.1.0-RC1 review found (#49) ---------------------------------------

test.describe('biomarker screen: what the v0.1.0-RC1 review found', () => {
  test('BS-STAT-013: once the connection is replaced, a late answer from the old one changes neither the line nor what chart.statistics() reports (#49)', async ({
    page
  }) => {
    await expectReplacedConnectionDead(page, 'bs');
  });

  test('BS-FAIL-001: when drawing fails the chart says so in its element and keeps its controls, leaving nothing half drawn, and draws again once it can (#49)', async ({
    page
  }) => {
    await expectFailureSaid(page, 'bs', (name) => window[name].chart.asked.length);
  });

  test('BS-DROP-001: with a participant table, participants it does not have and rows with no participant id are counted by reason; a participant table without the id column is refused with a sentence that names it (#49)', async ({
    page
  }) => {
    await expectDropsCounted(page, 'bs');
  });

  test('BS-DROP-002: with results the participant table does not have and filters that let nobody through, the chart says that nobody passes the filters (#49)', async ({
    page
  }) => {
    await expectNobodyWithOrphans(page, 'bs');
  });

  test('BS-DROP-003: a setting naming a participant id column the participant table does not have is refused with the same sentence, and the chart stays as it was (#49)', async ({
    page
  }) => {
    await expectSettingsRefused(page, 'bs', { open: ['IL-6'], is: 'opened' });
  });

  test('BS-DROP-004: the participant table and the setting that names its id column change together, with setData(tables, settings), and the chart draws (#52)', async ({
    page
  }) => {
    await expectTablesAndSettingsTogether(page, 'bs');
  });

  test('BS-NAME-001: a biomarker whose name has a space at either end is screened under its name as written, and R is handed it by that name (#49)', async ({
    page
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(/^https:\/\/(webr|repo)\.r-wasm\.org\//, (route) => route.abort());
    await page.addInitScript(() => {
      window.__pending = [];
      window.__deferred = {
        run(name, request) {
          return new Promise((resolve) => window.__pending.push({ name, request, resolve }));
        }
      };
    });
    await page.goto('/tests/e2e/fixtures/biomarker-screen.html?make=no');
    await page.evaluate(() => window.__bs.ready);
    const said = await page.evaluate(() => {
      const { data } = window.__bs;
      // As a SAS export pads a name: 'CRP ' and ' IL-6'.
      const padded = { CRP: 'CRP ', 'IL-6': ' IL-6' };
      const results = data.results.map((row) =>
        row.TEST in padded ? { ...row, TEST: padded[row.TEST] } : row
      );
      const chart = BioViz.biomarkerScreen('#chart', {
        baseline_visits: 'Baseline',
        connection: window.__deferred
      });
      chart.init({ results, participants: data.participants });
      const [asked] = window.__pending;
      return {
        footnote: document.querySelector('#chart .sv-footnote').textContent,
        biomarkers: asked.request.args.chrCols,
        columns: Object.keys(asked.request.data[0])
      };
    });
    expect(errors).toEqual([]);
    expect(said.footnote).not.toMatch(/could not be drawn/);
    expect(said.biomarkers).toContain('CRP ');
    expect(said.biomarkers).toContain(' IL-6');
    expect(said.columns).toContain('CRP ');
    expect(said.columns).toContain(' IL-6');
  });

  test('BS-STAT-015: for a difference the statistics line under the rows prints R’s own note that the interval pools the variances and the p-value does not; the chart adds no words of its own about R’s method (#49, #52)', async ({
    page
  }) => {
    await open(page);
    await withStored(page, stored('difference-baseline'));
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const said = resultOf('difference-baseline').value.notes.find((note) =>
      note.startsWith('The interval is the pooled-variance (Student) interval for Hedges')
    );
    expect(said, 'R says it in its answer').toBeTruthy();
    await expect(line(page).locator('.bv-stat-remark')).toContainText([`R’s note: ${said}`]);
    // The line is under the rows, where they are read.
    expect(
      await page.evaluate(() => {
        const rows = document.querySelector('#chart .bv-screen');
        const statistic = document.querySelector('#chart .sv-main > .bv-statistic');
        return Boolean(rows.compareDocumentPosition(statistic) & Node.DOCUMENT_POSITION_FOLLOWING);
      })
    ).toBe(true);
    // The footnote says nothing of R's methods: that is R's to say.
    await expect(footnote(page)).not.toContainText('Hedges');
    await expect(footnote(page)).not.toContainText('Welch');
  });
});
