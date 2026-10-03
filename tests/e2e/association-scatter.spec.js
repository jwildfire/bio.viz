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
import { captureEvidence } from './evidence.js';
import { RULED_FILTERS, expectFilterRules, warningsOf } from './filterRules.js';
import { NOBODY_PASSES, asked, expectNobody, letNobodyThrough, openDemo } from './nobody.js';

// The association scatter in a real page (#26): safety.viz's vendored bundle and
// bio.viz's committed bundle, loaded as two script tags, drawing the vendored
// synthetic study.
//
// Every group but the last reaches no network and runs no R: the statistics
// line is asked of a connection with no R attached, of a stand-in for R whose
// answers arrive when the test says, or of results desktop R stored. The last
// group, "live", is the opposite: it opens the gallery's demo and runs real R
// from webR's public CDN.

const readJson = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
// What desktop R answered for the rows the chart hands R, each with the key the
// chart asks with (tools/r-association-statistics.R). No number below was typed
// but the ones a printed line is held to.
const statistics = readJson('../fixtures/association-statistics-r.json');
const resultOf = (name) => statistics.results.find((result) => result.case === name);
const stored = (...names) =>
  names.map(resultOf).map(({ name, args, dataId, rows, value }) => ({
    name,
    args,
    dataId,
    rows,
    value
  }));
const statisticsRecord = readJson('../../site/vendor/gsm.bio/SOURCE.json');
const FIXTURE = '/tests/e2e/fixtures/association-scatter.html';
const R_HOSTS = ['webr.r-wasm.org', 'repo.r-wasm.org'];
const isRHost = (url) => R_HOSTS.includes(new URL(url).hostname);
const NO_R = 'Statistics are unavailable: no R is attached to this chart.';
const WAITING = 'Statistics: waiting for R…';
const HINT =
  'Drag across the points to list the participants in a region. Click a point to list its ' +
  'participant and open their profile.';

// Keeps a page from reaching R's hosts, so a test of a page that would start R
// stays on this machine. The page is then told that R could not be started.
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

// Opens the fixture on the chosen tables, with settings laid over its own, and
// waits for the chart to have drawn.
async function open(page, { data = 'both', settings = null, before = null, make = true } = {}) {
  if (before) await page.addInitScript(before);
  if (settings) {
    await page.addInitScript((given) => {
      window.__asSettings = given;
    }, settings);
  }
  await page.goto(`${FIXTURE}?data=${data}${make ? '' : '&make=no'}`);
  await page.evaluate(() => window.__as.ready);
}

// What the chart drew, read from the chart itself: one entry per panel.
const drawn = (page, holder = '__as') =>
  page.evaluate((name) => {
    const chart = name === '__as' ? window.__as.chart : window.BioVizDemo.chart;
    return chart.charts.map((panel) => ({
      title: panel.$panel.title,
      points: panel.data.datasets.reduce((total, dataset) => total + dataset.data.length, 0),
      datasets: panel.data.datasets.map((dataset) => [dataset.label, dataset.data.length]),
      x: {
        type: panel.scales.x.type,
        title: panel.options.scales.x.title.text,
        min: panel.scales.x.min,
        max: panel.scales.x.max
      },
      y: {
        type: panel.scales.y.type,
        title: panel.options.scales.y.title.text,
        min: panel.scales.y.min,
        max: panel.scales.y.max
      },
      // The key, when the chart shows one.
      legend: panel.options.plugins.legend.display
        ? panel.legend.legendItems.map((item) => item.text)
        : [],
      identity: panel.$identity || null,
      fit: (panel.$fit || []).map((line) => ({ group: line.group, points: line.curve.length }))
    }));
  }, holder);

// Sets a sidebar <select> by its control name; the chart redraws at once.
async function choose(page, control, value) {
  await page.locator(`.sv-sidebar select[data-control="${control}"]`).selectOption(value);
}
const controls = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('.sv-sidebar select[data-control]')].map((select) => [
        select.dataset.control,
        select.value
      ])
    )
  );

// Where a value pair is on the page, in a panel.
const placeOf = (page, at, panel = 0, holder = '__as') =>
  page.evaluate(
    ({ at, panel, holder }) => {
      const chart = (holder === '__as' ? window.__as.chart : window.BioVizDemo.chart).charts[panel];
      const box = chart.canvas.getBoundingClientRect();
      return {
        x: box.left + chart.scales.x.getPixelForValue(at.x),
        y: box.top + chart.scales.y.getPixelForValue(at.y)
      };
    },
    { at, panel, holder }
  );
// A participant's point: the one furthest from every other, so a click on it
// can only be a click on it.
const lonePoint = (page, panel = 0, holder = '__as') =>
  page.evaluate(
    ({ panel, holder }) => {
      const chart = (holder === '__as' ? window.__as.chart : window.BioVizDemo.chart).charts[panel];
      const box = chart.canvas.getBoundingClientRect();
      const points = chart.data.datasets.flatMap((dataset) =>
        dataset.data.map((point) => ({
          id: point.record.USUBJID,
          x: box.left + chart.scales.x.getPixelForValue(point.x),
          y: box.top + chart.scales.y.getPixelForValue(point.y)
        }))
      );
      let best = null;
      for (const point of points) {
        const nearest = Math.min(
          ...points
            .filter((other) => other !== point)
            .map((other) => Math.hypot(other.x - point.x, other.y - point.y))
        );
        if (!best || nearest > best.nearest) best = { ...point, nearest };
      }
      return best;
    },
    { panel, holder }
  );
// Drags the mouse across a region given in the values' own units.
async function drag(page, region, panel = 0) {
  await page.locator('.bv-association-scatter canvas').nth(panel).scrollIntoViewIfNeeded();
  const from = await placeOf(page, { x: region.x[0], y: region.y[0] }, panel);
  const to = await placeOf(page, { x: region.x[1], y: region.y[1] }, panel);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}
// The ids listed, and the ids the chart holds as selected.
const selection = (page) =>
  page.evaluate(() => {
    const { chart } = window.__as;
    return {
      listed: chart.host.currentTableData.map((row) => row.USUBJID),
      selected: chart.selection ? [...chart.selection.ids] : null,
      region: chart.selection ? chart.selection.region : null,
      panel: chart.selection ? chart.selection.panel.title : null
    };
  });
// The ids of a panel's points inside a region, worked out here from the points.
const inside = (page, region, panel = 0) =>
  page.evaluate(
    ({ region, panel }) =>
      window.__as.chart.charts[panel].$panel.records
        .filter(
          (record) =>
            record.x >= Math.min(...region.x) &&
            record.x <= Math.max(...region.x) &&
            record.y >= Math.min(...region.y) &&
            record.y <= Math.max(...region.y)
        )
        .map((record) => record.USUBJID),
    { region, panel }
  );

// The page's width against the viewport's. The fixture page has a margin, so the
// document is measured, not its body.
const layout = (page) =>
  page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
const HOLDS = { viewport: 390, scrollWidth: 390 };

const line = (page) => page.locator('.sv-main > .bv-statistic');
const coefficient = (page) => line(page).locator('.bv-coefficient');
const fitted = (page) => line(page).locator('.bv-fit');
const REGION = { x: [12, 14], y: [6, 8] };

test.describe('association scatter: the page and the two bundles', () => {
  test('AS-KIT-001: the chart is built from safety.viz’s kit on the page and draws with the kit’s Chart.js; without safety.viz it says what is missing (#26)', async ({
    page
  }) => {
    const errors = watch(page);
    const requests = [];
    page.on('request', (request) => requests.push(new URL(request.url()).pathname));
    await open(page);
    const found = await page.evaluate(() => ({
      drawsWithKit: window.__as.chart.charts.every(
        (chart) => chart instanceof window.SafetyViz.kit.Chart
      ),
      charts: window.__as.chart.charts.length,
      type: window.__as.chart.charts[0].config.type,
      ownChart: 'Chart' in window.BioViz,
      globalChart: typeof window.Chart,
      root: document.querySelector('#chart > .sv-root').className
    }));
    expect(found).toEqual({
      drawsWithKit: true,
      charts: 1,
      type: 'scatter',
      ownChart: false,
      globalChart: 'undefined',
      // safety.viz's shell, with this chart's class on it.
      root: 'sv-root bv-association-scatter'
    });
    // The two bundles are two files, each asked for once.
    const scripts = requests.filter((file) => file.endsWith('.js'));
    expect(scripts.filter((file) => file === '/site/vendor/safety.viz/safety.viz.js')).toHaveLength(
      1
    );
    expect(scripts.filter((file) => file.startsWith('/dist/bio.viz-'))).toHaveLength(1);
    expect(errors).toEqual([]);

    await page.goto('/tests/e2e/fixtures/index.html');
    const message = await page.evaluate(() => {
      try {
        window.BioViz.associationScatter(document.body, {});
        return 'made';
      } catch (error) {
        return error.message;
      }
    });
    expect(message).toMatch(
      /^bio\.viz: the association scatter is built from safety\.viz's kit, and `SafetyViz\.kit` was not found\./
    );
  });
});

test.describe('association scatter: what is drawn', () => {
  test('AS-DRAW-001: the planted pair, one point per participant at its two results, each axis named for its variable and unit (#26)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page);
    const [panel] = await drawn(page);
    expect(panel.points).toBe(200);
    expect(panel.datasets).toEqual([['All participants', 200]]);
    expect(panel.x.title).toBe('TNF-alpha at Baseline (pg/mL)');
    expect(panel.y.title).toBe('IL-10 at Baseline (pg/mL)');
    expect([panel.x.type, panel.y.type]).toEqual(['linear', 'linear']);
    expect(panel.legend).toEqual([]);
    // Each point is the participant's own two results, as the tables have them.
    const points = await page.evaluate(() => {
      const { chart, data } = window.__as;
      const at = (id, measure) =>
        Number(
          data.results.find(
            (row) => row.USUBJID === id && row.TEST === measure && row.VISIT === 'Baseline'
          ).STRESN
        );
      return chart.charts[0].data.datasets[0].data.map((point) => ({
        drawn: [point.x, point.y],
        written: [at(point.record.USUBJID, 'TNF-alpha'), at(point.record.USUBJID, 'IL-10')]
      }));
    });
    expect(new Set(points.map((point) => JSON.stringify(point.drawn))).size).toBeGreaterThan(190);
    for (const point of points) expect(point.drawn).toEqual(point.written);
    // The axes run to the ends of what is drawn, with a little room.
    const xs = points.map((point) => point.drawn[0]);
    expect(panel.x.min).toBeLessThan(Math.min(...xs));
    expect(panel.x.max).toBeGreaterThan(Math.max(...xs));
    await expect(page.locator('.sv-notes')).toHaveText('200 of 200 participants drawn.');
    await expect(page.locator('.sv-footnote')).toHaveText(HINT);
    await expect(page.locator('.sv-chart-wrap canvas')).toHaveAttribute(
      'aria-label',
      'IL-10 at Baseline (pg/mL) against TNF-alpha at Baseline (pg/mL): 200 participants drawn'
    );
    expect(errors).toEqual([]);
    await captureEvidence(page.locator('.sv-chart-wrap'), 'AS-DRAW-001', 'planted-pair');
  });

  test('AS-DRAW-002: a colour gives each level its own colour and a key, and the key does not switch a level off (#26)', async ({
    page
  }) => {
    await open(page);
    await choose(page, 'color-by', 'ARM');
    const [panel] = await drawn(page);
    expect(panel.datasets).toEqual([
      ['Placebo', 100],
      ['Treatment', 100]
    ]);
    expect(panel.legend).toEqual(['Placebo', 'Treatment']);
    const colours = await page.evaluate(() => {
      const chart = window.__as.chart.charts[0];
      return chart.data.datasets.map(
        (dataset, index) => chart.getDatasetMeta(index).data[0].options.borderColor
      );
    });
    expect(new Set(colours).size).toBe(2);
    // A click on the key hides nothing: the coefficient is of every point drawn.
    const key = await page.evaluate(() => {
      const chart = window.__as.chart.charts[0];
      const [item] = chart.legend.legendHitBoxes;
      const box = chart.canvas.getBoundingClientRect();
      return { x: box.left + item.left + 8, y: box.top + item.top + item.height / 2 };
    });
    await page.mouse.click(key.x, key.y);
    // Chart.js answers a click on its next frame: wait for two, so that a key
    // that did switch a level off would have by now.
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    );
    const visible = await page.evaluate(() => {
      const chart = window.__as.chart.charts[0];
      return chart.data.datasets.map((_, index) => chart.isDatasetVisible(index));
    });
    expect(visible).toEqual([true, true]);
    await captureEvidence(page.locator('.sv-chart-wrap'), 'AS-DRAW-002', 'colour-by-arm');
  });

  test('AS-DRAW-003: panels by one further variable are each a chart of their own on the same two axes, with their own count (#26)', async ({
    page
  }) => {
    await open(page);
    await choose(page, 'panel-by', 'SEX');
    await choose(page, 'color-by', 'ARM');
    const panels = await drawn(page);
    expect(panels.map((panel) => [panel.title, panel.points])).toEqual([
      ['F', 91],
      ['M', 109]
    ]);
    // The same two axes in every panel.
    expect(panels[1].x).toEqual(panels[0].x);
    expect(panels[1].y).toEqual(panels[0].y);
    await expect(page.locator('.bv-panel h3')).toHaveText(['F', 'M']);
    await expect(page.locator('.bv-panel .bv-panel-note')).toHaveText([
      '91 participants drawn.',
      '109 participants drawn.'
    ]);
    // Each has a statistics line of its own; the single chart's place is hidden.
    await expect(page.locator('.bv-panel .bv-statistic')).toHaveCount(2);
    await expect(page.locator('.sv-chart-wrap')).toBeHidden();
    await captureEvidence(page.locator('.sv-multiples'), 'AS-DRAW-003', 'panels-by-sex');
  });

  test('AS-DRAW-004: each axis can be logarithmic on its own, and values of zero or less are left out and counted by axis (#26)', async ({
    page
  }) => {
    await open(page, {
      settings: {
        x: { measure: 'CRP', visit: 'Baseline' },
        y: { measure: 'IL-6', visit: 'Week 4', value: 'change' }
      }
    });
    let [panel] = await drawn(page);
    expect([panel.x.type, panel.y.type, panel.points]).toEqual(['linear', 'linear', 186]);
    await expect(page.locator('.sv-notes')).toContainText('186 of 200 participants drawn.');
    await expect(page.locator('.sv-notes')).toContainText(
      '13 left out: No result at the visit (y axis).'
    );
    await expect(page.locator('.sv-notes')).toContainText('Baseline visit: Baseline.');

    // The x axis alone: CRP is above zero for everyone.
    await choose(page, 'x-scale', 'log');
    [panel] = await drawn(page);
    expect([panel.x.type, panel.y.type, panel.points]).toEqual(['logarithmic', 'linear', 186]);
    expect(panel.x.min).toBeGreaterThan(0);

    // The y axis: a change of zero or less has no place on it.
    await choose(page, 'y-scale', 'log');
    [panel] = await drawn(page);
    expect([panel.x.type, panel.y.type]).toEqual(['logarithmic', 'logarithmic']);
    const left = 186 - panel.points;
    expect(left).toBeGreaterThan(0);
    await expect(page.locator('.sv-notes')).toContainText(
      `${panel.points} of 200 participants drawn.`
    );
    await expect(page.locator('.sv-notes .sv-warning').last()).toHaveText(
      `${left} left out: zero or less on the y axis, which a logarithmic scale cannot show.`
    );
    const least = await page.evaluate(() =>
      Math.min(...window.__as.chart.charts[0].data.datasets[0].data.map((point) => point.y))
    );
    expect(least).toBeGreaterThan(0);
  });

  test('AS-DRAW-005: the identity line is drawn with no R attached, and nothing is asked of R for it (#26)', async ({
    page
  }) => {
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    // The same biomarker at two visits: the two axes share most of their length.
    await open(page, {
      settings: {
        x: { measure: 'IL-6', visit: 'Week 4' },
        y: { measure: 'IL-6', visit: 'Week 12' },
        fit: 'identity'
      }
    });
    const [panel] = await drawn(page);
    expect(panel.identity).toHaveLength(2);
    const [from, to] = panel.identity;
    expect(from.x).toBe(from.y);
    expect(to.x).toBe(to.y);
    expect(from.x).toBe(Math.max(panel.x.min, panel.y.min));
    expect(to.x).toBe(Math.min(panel.x.max, panel.y.max));
    // It is on the canvas: the pixels along y = x are the line's grey.
    const painted = await page.evaluate(() => {
      const chart = window.__as.chart.charts[0];
      const ratio = chart.currentDevicePixelRatio;
      const context = chart.canvas.getContext('2d');
      let grey = 0;
      for (let step = 1; step < 60; step += 1) {
        const at =
          chart.$identity[0].x + ((chart.$identity[1].x - chart.$identity[0].x) * step) / 60;
        const [x, y] = [chart.scales.x.getPixelForValue(at), chart.scales.y.getPixelForValue(at)];
        const [r, g, b, a] = context.getImageData(
          Math.round(x * ratio),
          Math.round(y * ratio),
          1,
          1
        ).data;
        if (
          a > 0 &&
          Math.abs(r - 0x52) < 40 &&
          Math.abs(g - 0x61) < 40 &&
          Math.abs(b - 0x6f) < 40
        ) {
          grey += 1;
        }
      }
      return grey;
    });
    expect(painted).toBeGreaterThan(15);
    // Only the coefficient was asked for, and of a connection with no R.
    const asked = await page.evaluate(() => window.__as.chart.statistics());
    expect(asked.map((entry) => entry.kind)).toEqual(['coefficient']);
    await expect(fitted(page)).toHaveCount(0);
    expect(requests.filter((url) => /webr|r-wasm/.test(url))).toEqual([]);
    await captureEvidence(page.locator('.sv-chart-wrap'), 'AS-DRAW-005', 'identity-line');

    // With no value shared by the two axes there is no part of y = x to draw.
    await page.evaluate(() =>
      window.__as.chart.setSettings({
        x: { col: 'AGE' },
        y: { measure: 'IL-6', visit: 'Week 4', value: 'change' }
      })
    );
    expect((await drawn(page))[0].identity).toBe(null);
  });
});

test.describe('association scatter: controls', () => {
  test('AS-CTRL-003: the variable, the value type, the visit and the scale of each axis are chosen in the sidebar, and the chart follows (#26)', async ({
    page
  }) => {
    await open(page);
    await expect(page.locator('.sv-section-title')).toHaveText([
      'X axis',
      'Y axis',
      'Groups',
      'Display',
      'Statistics',
      'Filters'
    ]);
    expect(await controls(page)).toEqual({
      'x-variable': 'm:TNF-alpha',
      'x-value': 'raw',
      'x-visit': 'Baseline',
      'x-scale': 'linear',
      'y-variable': 'm:IL-10',
      'y-value': 'raw',
      'y-visit': 'Baseline',
      'y-scale': 'linear',
      'color-by': '',
      'panel-by': '',
      fit: 'none',
      method: 'pearson'
    });
    // Every biomarker, then the participant-level numbers.
    const offered = await page
      .locator('select[data-control="x-variable"] option')
      .allTextContents();
    expect(offered).toHaveLength(14);
    expect(offered.slice(0, 2)).toEqual(['CRP', 'D-dimer']);
    expect(offered.slice(-2)).toEqual(['AGE (participant)', 'BMIBL (participant)']);
    // Each control is named for a reader who cannot see which section it is in.
    await expect(page.locator('select[data-control="y-visit"]')).toHaveAttribute(
      'aria-label',
      'Y axis: Visit'
    );

    await choose(page, 'y-variable', 'm:IL-6');
    await choose(page, 'y-visit', 'Week 4');
    await choose(page, 'y-value', 'change');
    let [panel] = await drawn(page);
    expect(panel.y.title).toBe('IL-6 at Week 4, change from baseline (pg/mL)');
    expect(panel.points).toBe(186);
    // A baseline value has no visit: its Visit control goes.
    await choose(page, 'y-value', 'baseline');
    await expect(page.locator('select[data-control="y-visit"]')).toHaveCount(0);
    expect((await drawn(page))[0].y.title).toBe('IL-6 at baseline (pg/mL)');
    // A participant-level number has no value type and no visit.
    await choose(page, 'x-variable', 'c:AGE');
    await expect(page.locator('select[data-control="x-value"]')).toHaveCount(0);
    await expect(page.locator('select[data-control="x-visit"]')).toHaveCount(0);
    await expect(page.locator('select[data-control="x-scale"]')).toHaveCount(1);
    [panel] = await drawn(page);
    expect(panel.x.title).toBe('AGE');
    expect(panel.points).toBe(200);
    // Back to a biomarker: its value type and its visit return.
    await choose(page, 'x-variable', 'm:CRP');
    expect((await controls(page))['x-visit']).toBe('Baseline');
    expect((await drawn(page))[0].x.title).toBe('CRP at Baseline (mg/L)');
    // A change read at the baseline visit is the same for everyone: nothing to draw.
    await choose(page, 'x-value', 'change');
    await expect(page.locator('.sv-footnote')).toHaveText(
      'An axis is a change at the baseline visit, where it is the same for everyone. Choose a ' +
        'later visit to draw.'
    );
    expect(await drawn(page)).toEqual([]);
    await choose(page, 'x-visit', 'Week 8');
    expect((await drawn(page))[0].x.title).toBe('CRP at Week 8, change from baseline (mg/L)');
  });

  test('AS-CTRL-004: the colour, the panels, the fitted line and the method are chosen in the sidebar, and Reset chart returns every control to what the chart opened on (#26)', async ({
    page
  }) => {
    await open(page);
    const opening = await controls(page);
    await expect(page.locator('select[data-control="fit"] option')).toHaveText([
      'None',
      'Identity (y = x)',
      'Linear',
      'Smooth'
    ]);
    await expect(page.locator('select[data-control="method"] option')).toHaveText([
      'Pearson',
      'Spearman'
    ]);
    await choose(page, 'color-by', 'SEX');
    await choose(page, 'panel-by', 'ARM');
    await choose(page, 'fit', 'identity');
    await choose(page, 'method', 'spearman');
    await choose(page, 'x-scale', 'log');
    await page.locator('select[data-filter="RESPONSE"]').selectOption('Responder');
    const panels = await drawn(page);
    expect(panels.map((panel) => panel.title)).toEqual(['Placebo', 'Treatment']);
    expect(panels[0].legend).toEqual(['F', 'M']);
    expect(panels[0].x.type).toBe('logarithmic');
    expect(
      await page.evaluate(() => window.__as.chart.statistics().map((asked) => asked.args.strMethod))
    ).toEqual(['spearman', 'spearman']);
    expect(await page.evaluate(() => window.__as.chart.view())).toEqual({
      x: { measure: 'TNF-alpha', value: 'raw', visit: 'Baseline' },
      y: { measure: 'IL-10', value: 'raw', visit: 'Baseline' },
      color_by: 'SEX',
      panel_by: 'ARM',
      x_scale: 'log',
      y_scale: 'linear',
      fit: 'identity',
      method: 'spearman'
    });

    await page.locator('.sv-reset').click();
    expect(await controls(page)).toEqual(opening);
    await expect(page.locator('select[data-filter="RESPONSE"]')).toHaveValue('__all__');
    const [panel] = await drawn(page);
    expect([panel.title, panel.points, panel.x.type]).toEqual(['', 200, 'linear']);
    // With no function named, there is no Statistics section and no line; and
    // with no function for a line, only the lines that need none are offered.
    await page.evaluate(() =>
      window.__as.chart.setSettings({ statistic: null, fit_statistic: null })
    );
    await expect(page.locator('select[data-control="method"]')).toHaveCount(0);
    await expect(page.locator('select[data-control="fit"] option')).toHaveText([
      'None',
      'Identity (y = x)'
    ]);
    await expect(line(page)).toBeEmpty();
    await expect(line(page)).toBeHidden();
    expect(await page.evaluate(() => window.__as.chart.statistics())).toEqual([]);
  });
});

test.describe('association scatter: with and without participant data', () => {
  test('AS-FILTER-001: loaded with the results table alone it draws and shows no filters, and offers no colour and no panel when the rows carry none (#26)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page, { data: 'results' });
    const [panel] = await drawn(page);
    expect(panel.points).toBe(200);
    await expect(page.locator('.sv-notes')).toHaveText('200 of 200 participants drawn.');
    // No filter, and no Filters or Groups section: the vendored results carry
    // no participant-level column.
    await expect(page.locator('[data-filter]')).toHaveCount(0);
    await expect(page.locator('.sv-section-title')).toHaveText([
      'X axis',
      'Y axis',
      'Display',
      'Statistics'
    ]);
    await expect(page.locator('select[data-control="color-by"]')).toHaveCount(0);
    // Every variable an axis can take is a biomarker.
    await expect(page.locator('select[data-control="x-variable"] option')).toHaveCount(12);
    // The statistics line is still there, and a point still opens a profile.
    await expect(coefficient(page)).toHaveText(NO_R);
    const point = await lonePoint(page);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator('.sv-rail .sv-profile-id')).toHaveText(`Participant ${point.id}`);
    expect(errors).toEqual([]);

    // A column carried on the results rows is offered: the derived fixture
    // carries ARM, and holds two biomarkers.
    await open(page, {
      data: 'results-with-arm',
      settings: {
        x: { measure: 'IL-6', visit: 'Baseline' },
        y: { measure: 'CRP', visit: 'Baseline' }
      }
    });
    await expect(page.locator('[data-filter]')).toHaveCount(0);
    await expect(page.locator('select[data-control="color-by"] option')).toHaveText([
      'None',
      'ARM'
    ]);
    await choose(page, 'color-by', 'ARM');
    expect((await drawn(page))[0].legend).toEqual(['Placebo', 'Treatment']);
  });

  test('AS-FILTER-002: loaded with participant data it shows filters and offers participant-level variables, and a filter narrows the participants drawn (#26)', async ({
    page
  }) => {
    await open(page);
    const filters = await page
      .locator('[data-filter]')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.filter));
    expect(filters).toEqual(['ARM', 'SEX', 'RESPONSE']);
    await expect(page.locator('select[data-control="color-by"] option')).toHaveText([
      'None',
      'ARM',
      'SEX',
      'RESPONSE'
    ]);
    await page.locator('select[data-filter="SEX"]').selectOption('F');
    const [panel] = await drawn(page);
    expect(panel.points).toBe(91);
    await expect(page.locator('.sv-notes')).toHaveText(
      '91 of 91 participants drawn.91 of 200 participants pass the filters.'
    );
    // Filters that let nobody through: nothing is drawn, and the chart says so.
    await page.evaluate(() => {
      window.__as.chart.state.filters.ARM = 'Nobody';
      window.__as.chart.render();
    });
    expect(await drawn(page)).toEqual([]);
    await expect(page.locator('.sv-footnote')).toHaveText('No participant passes the filters.');
    await expect(line(page)).toHaveText('');
  });
});

// A stand-in for R whose answers arrive when the test says so. A test hands it
// the answer to give: one desktop R gave, from the committed expected results.
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
          first: request.data[0],
          resolve
        });
      })
  };
  window.__r.answer = (index, value) => window.__r.calls[index].resolve(value);
};
// Gives the chart a connection whose R is the stand-in.
const attachStub = (page, settings = {}) =>
  page.evaluate((given) => {
    window.__as.chart.setSettings({
      ...given,
      connection: window.BioViz.r.createConnection({ browser: { engine: window.__r.engine } })
    });
  }, settings);
const calls = (page) =>
  page.evaluate(() =>
    window.__r.calls.map(({ name, rows, args, fields, first }) => ({
      name,
      rows,
      args,
      fields,
      first
    }))
  );
const called = (page) => page.evaluate(() => window.__r.calls.length);
const answer = (page, index, name) =>
  page.evaluate(({ index, value }) => window.__r.answer(index, value), {
    index,
    value: resultOf(name).value
  });
const PEARSON =
  "Pearson's product-moment correlation: p < 0.001 (n = 200). Exploratory, unadjusted.";

test.describe('association scatter: the statistics line', () => {
  test('AS-STAT-015: with no R attached the statistics line of every panel reads that statistics are unavailable, and nothing is fetched to say so (#26)', async ({
    page
  }) => {
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await open(page);
    await expect(line(page)).toHaveText(NO_R);
    await expect(line(page)).toHaveAttribute('data-state', 'unavailable');
    await expect(line(page)).toHaveAttribute('role', 'status');
    await choose(page, 'panel-by', 'SEX');
    await expect(page.locator('.bv-panel .bv-statistic')).toHaveText([NO_R, NO_R]);
    expect(requests.filter((url) => /webr|r-wasm/.test(url))).toEqual([]);
  });

  test('AS-STAT-016: the line shows that it is waiting until R answers, and then prints the answer through the shared formatter; R is asked for the rows that are drawn (#26)', async ({
    page
  }) => {
    await open(page, { before: stubR });
    await attachStub(page);
    await expect(line(page)).toHaveText(WAITING);
    await expect(line(page)).toHaveAttribute('data-state', 'waiting');
    await expect.poll(() => called(page)).toBe(1);
    const [asked] = await calls(page);
    expect(asked).toMatchObject({
      name: 'Analyze_Correlation',
      rows: 200,
      args: { strXCol: 'x', strYCol: 'y', strMethod: 'pearson' },
      fields: ['USUBJID', 'x', 'y']
    });
    // The first row handed over is the first point drawn.
    const first = await page.evaluate(() => {
      const { record } = window.__as.chart.charts[0].data.datasets[0].data[0];
      return { USUBJID: record.USUBJID, x: record.x, y: record.y };
    });
    expect(asked.first).toEqual(first);

    await answer(page, 0, 'pearson');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    await expect(coefficient(page).locator('p')).toHaveText([
      PEARSON,
      'Pearson’s r: 0.6384, 95% confidence interval 0.5482 to 0.7139.',
      'This coefficient is of the 200 participants drawn.'
    ]);
    await expect(line(page)).not.toContainText('*');
    await expect(line(page)).not.toContainText(/significan/i);
    await captureEvidence(line(page), 'AS-STAT-016', 'statistics-line');
  });

  test('AS-STAT-017: a change to a variable, a visit, a scale, the colour, the method or a filter each clears the line and asks R again, the answer to the question before is never shown, and a region asks nothing (#26)', async ({
    page
  }) => {
    await open(page, { before: stubR });
    await attachStub(page);
    await expect.poll(() => called(page)).toBe(1);
    await answer(page, 0, 'pearson');
    await expect(coefficient(page).locator('.bv-stat-result')).toHaveText(PEARSON);

    // Each change: the line waits at once, and R is asked for what is then drawn.
    const changes = [
      [() => choose(page, 'method', 'spearman'), { strMethod: 'spearman' }, 200],
      [() => choose(page, 'x-visit', 'Week 4'), { strMethod: 'spearman' }, null],
      [() => choose(page, 'y-variable', 'm:IL-6'), { strMethod: 'spearman' }, null],
      [() => choose(page, 'y-value', 'baseline'), { strMethod: 'spearman' }, null],
      [() => choose(page, 'x-scale', 'log'), { strMethod: 'spearman' }, null],
      [
        () => choose(page, 'color-by', 'ARM'),
        { strMethod: 'spearman', strGroupCol: 'color' },
        null
      ],
      [
        () => page.locator('select[data-filter="SEX"]').selectOption('F'),
        { strMethod: 'spearman', strGroupCol: 'color' },
        null
      ]
    ];
    let count = 1;
    const logged = [];
    for (const [change, args, rows] of changes) {
      await change();
      await expect(line(page)).toHaveText(WAITING);
      count += 1;
      await expect.poll(() => called(page)).toBe(count);
      const last = (await calls(page))[count - 1];
      expect(last.args).toEqual({ strXCol: 'x', strYCol: 'y', ...args });
      if (rows !== null) expect(last.rows).toBe(rows);
      expect(last.rows).toBe((await drawn(page))[0].points);
      // What R is handed is what is drawn: on a logarithmic axis, its logarithm.
      const first = await page.evaluate(() => {
        const { chart } = window.__as;
        const { record } = chart.charts[0].data.datasets[0].data[0];
        const logged = chart.view().x_scale === 'log';
        return { x: logged ? Math.log10(record.x) : record.x, y: record.y, logged };
      });
      expect([last.first.x, last.first.y]).toEqual([first.x, first.y]);
      logged.push(first.logged);
    }
    expect(logged).toEqual([false, false, false, false, true, true, true]);
    // Every earlier question is answered now, late, with the first view's
    // numbers. None is shown: the line still waits for the last.
    for (let index = 1; index < count - 1; index += 1) await answer(page, index, 'pearson');
    await page.waitForTimeout(100);
    await expect(line(page)).toHaveText(WAITING);
    await expect(line(page)).toHaveAttribute('data-state', 'waiting');
    // The last is: it is the answer to the question about the rows on screen.
    // (The stand-in answers with a result of another size, so the two can be told apart.)
    await answer(page, count - 1, 'pearson-women');
    await expect(coefficient(page).locator('.bv-stat-result')).toContainText('(n = 91)');
    await expect(line(page)).not.toContainText('n = 200');

    // A region lists participants and asks R nothing: the line stays as it is.
    const before = await line(page).textContent();
    const points = await page.evaluate(() => {
      const xs = window.__as.chart.charts[0].$panel.records.map((record) => record.x);
      const ys = window.__as.chart.charts[0].$panel.records.map((record) => record.y);
      return { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)] };
    });
    await page.evaluate((region) => window.__as.chart.brush(region), points);
    const all = (await drawn(page))[0].points;
    await expect(page.locator('.sv-listing-actions strong')).toHaveText(`${all} of ${all} records`);
    expect(await called(page)).toBe(count);
    expect(await line(page).textContent()).toBe(before);
  });

  test('AS-STAT-018: each panel asks R for itself, on its own rows and under its own identity, and is answered for itself (#26)', async ({
    page
  }) => {
    await open(page, { before: stubR, settings: { panel_by: 'SEX' } });
    await attachStub(page);
    await expect.poll(() => called(page)).toBe(2);
    const asked = await calls(page);
    expect(asked.map((call) => call.rows)).toEqual([91, 109]);
    expect(asked.map((call) => call.first.panel)).toEqual(['F', 'M']);
    const ids = await page.evaluate(() =>
      window.__as.chart.statistics().map((entry) => [entry.panel, entry.dataId.panel, entry.rows])
    );
    expect(ids).toEqual([
      ['F', 'F', 91],
      ['M', 'M', 109]
    ]);
    const lines = page.locator('.bv-panel .bv-statistic');
    await expect(lines).toHaveText([WAITING, WAITING]);
    // The panel for F is answered; the other still waits.
    await answer(page, 0, 'pearson-panel-women');
    await expect(lines.nth(0).locator('.bv-stat-result')).toContainText('(n = 91)');
    await expect(lines.nth(0).locator('.bv-stat-scope')).toHaveText(
      'This coefficient is of the 91 participants drawn in this panel (F). Each panel has a ' +
        'coefficient of its own, and they are not adjusted for one another.'
    );
    await expect(lines.nth(1)).toHaveText(WAITING);
    expect(await page.evaluate(() => window.__as.chart.statistics()[1].answer)).toBe(null);
  });
});

test.describe('association scatter: R’s answers, stored with the page', () => {
  const withStored = (page, names, settings = {}) =>
    page.evaluate(
      ({ results, settings }) => {
        window.__as.chart.setSettings({
          ...settings,
          connection: window.BioViz.r.createConnection({ results })
        });
      },
      { results: stored(...names), settings }
    );

  test('AS-STAT-019: a view R’s answer was stored for prints it with no R and no request, the coefficient with its interval and the table per colour; a view it was not stored for reads unavailable, never another view’s numbers (#26)', async ({
    page
  }) => {
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await open(page, {
      settings: {
        groups: [{ value_col: 'ARM', label: 'Arm' }, 'SEX'],
        filters: ['SEX', { value_col: 'AGE', label: 'Age' }]
      }
    });
    await withStored(
      page,
      [
        'pearson',
        'spearman',
        'pearson-by-arm',
        'spearman-by-arm',
        'pearson-age-57-by-arm',
        'pearson-age-35'
      ],
      { color_by: 'ARM' }
    );
    await expect(coefficient(page).locator('p')).toHaveText([
      PEARSON,
      'Pearson’s r: 0.6384, 95% confidence interval 0.5482 to 0.7139.',
      'This coefficient is of the 200 participants drawn. It takes every level of Arm together; ' +
        'the table gives each level its own, and they are not adjusted for one another.'
    ]);
    const table = coefficient(page).locator('table.bv-stat-pairs');
    await expect(table.locator('caption')).toHaveText(
      "Within each level of Arm, each by Pearson's product-moment correlation. Exploratory, unadjusted."
    );
    await expect(table.locator('thead th')).toHaveText([
      'Arm',
      'n',
      'Pearson’s r (95% confidence interval)',
      'p'
    ]);
    await expect(table.locator('tbody tr')).toHaveText([
      'Placebo1000.5918 (0.4474 to 0.7061)p < 0.001',
      'Treatment1000.6737 (0.5501 to 0.7684)p < 0.001'
    ]);
    // The planted correlation, 0.6, is inside the interval printed.
    const printed = await coefficient(page).locator('.bv-stat-estimate').textContent();
    const [, low, high] = printed.match(/confidence interval (\S+) to (\S+)\.$/).map(Number);
    expect(low).toBeLessThan(0.6);
    expect(high).toBeGreaterThan(0.6);
    await captureEvidence(line(page), 'AS-STAT-019', 'coefficient-by-arm');

    // Spearman: no interval, R's warning and R's note, as R worded them.
    await choose(page, 'method', 'spearman');
    await expect(coefficient(page).locator('.bv-stat-result')).toHaveText(
      "Spearman's rank correlation rho: p < 0.001 (n = 200). Exploratory, unadjusted."
    );
    await expect(coefficient(page).locator('.bv-stat-estimate')).toHaveText(
      /^Spearman’s rho: 0\.\d+\.$/
    );
    await expect(coefficient(page)).not.toContainText('confidence interval 0');
    await expect(table.locator('thead th')).toHaveText(['Arm', 'n', 'Spearman’s rho', 'p']);
    await expect(coefficient(page).locator('.bv-stat-remark')).toHaveText([
      'R warned: Cannot compute exact p-value with ties',
      "R’s note: cor.test() gives no confidence interval for Spearman's rho, so none is reported."
    ]);
    // With no colour: each is its own stored result, with no table.
    await choose(page, 'color-by', '');
    await expect(coefficient(page).locator('.bv-stat-result')).toContainText('rho: p < 0.001');
    await expect(table).toHaveCount(0);
    await choose(page, 'method', 'pearson');
    await expect(coefficient(page).locator('.bv-stat-result')).toHaveText(PEARSON);

    // Too few pairs: R's reason, once, and no number.
    await page.locator('select[data-filter="AGE"]').selectOption('35');
    await expect(line(page)).toHaveAttribute('data-state', 'withheld');
    await expect(coefficient(page).locator('p')).toHaveText([
      'Not computed: 4 complete pairs. The minimum is 5. Counts: n = 4.',
      'This coefficient is of the 4 participants drawn. Filters: Age is 35.'
    ]);
    await expect(coefficient(page)).not.toContainText(/p [=<>]/);
    // Too few in one level: R's reason in that level's row.
    await page.locator('select[data-filter="AGE"]').selectOption('57');
    await choose(page, 'color-by', 'ARM');
    await expect(table.locator('tbody tr')).toHaveText([
      /^Placebo70\.5563 \(-0\.3386 to 0\.9228\)p = 0\.195$/,
      'Treatment2Not computed: 2 complete pairs. The minimum is 5. Counts: n = 2.'
    ]);
    await expect(table.locator('tbody tr').nth(1)).toHaveAttribute('data-status', 'withheld');

    // Views that were not stored: unavailable, and never a neighbour's numbers.
    const NOT_STORED =
      'Statistics are unavailable for this view: the page holds no stored result for it, and ' +
      'no R is attached to compute one.';
    await page.locator('select[data-filter="AGE"]').selectOption('__all__');
    await expect(coefficient(page).locator('.bv-stat-result')).toHaveText(PEARSON);
    for (const [control, value, back] of [
      ['x-visit', 'Week 4', 'Baseline'],
      ['x-scale', 'log', 'linear'],
      ['color-by', 'SEX', 'ARM'],
      ['y-value', 'baseline', 'raw']
    ]) {
      await choose(page, control, value);
      await expect(line(page)).toHaveText(NOT_STORED);
      await expect(line(page)).toHaveAttribute('data-state', 'unavailable');
      await choose(page, control, back);
      if (control === 'y-value') await choose(page, 'y-visit', 'Baseline');
      await expect(coefficient(page).locator('.bv-stat-result')).toHaveText(PEARSON);
    }
    expect(requests.filter((url) => /webr|r-wasm/.test(url))).toEqual([]);
  });

  test('AS-STAT-020: with an axis logarithmic the line says which scale the statistic was computed on, and R is handed the logarithms (#26)', async ({
    page
  }) => {
    await open(page, {
      settings: {
        x: { measure: 'CRP', visit: 'Baseline' },
        y: { measure: 'IFN-gamma', visit: 'Baseline' }
      }
    });
    await withStored(page, ['pearson-skewed', 'pearson-log', 'pearson-log-x', 'spearman-log']);
    // Both axes linear: nothing is said of a scale.
    await expect(coefficient(page).locator('.bv-stat-estimate')).toHaveText(
      'Pearson’s r: 0.07135, 95% confidence interval -0.06806 to 0.208.'
    );
    await expect(coefficient(page).locator('.bv-stat-remark')).toHaveCount(0);

    await choose(page, 'x-scale', 'log');
    await expect(coefficient(page).locator('.bv-stat-estimate')).toHaveText(
      'Pearson’s r: 0.03958, 95% confidence interval -0.09971 to 0.1773.'
    );
    await expect(coefficient(page).locator('.bv-stat-remark[data-kind="scale"]')).toHaveText(
      'The x axis is logarithmic: R was given the base-10 logarithm of CRP at Baseline (mg/L). ' +
        'Pearson’s coefficient is of the values as plotted, not of the values themselves.'
    );
    await choose(page, 'y-scale', 'log');
    await expect(coefficient(page).locator('.bv-stat-estimate')).toHaveText(
      'Pearson’s r: 0.06168, 95% confidence interval -0.07773 to 0.1987.'
    );
    await expect(coefficient(page).locator('.bv-stat-remark[data-kind="scale"]')).toHaveText(
      'Both axes are logarithmic: R was given the base-10 logarithm of CRP at Baseline (mg/L) ' +
        'and the base-10 logarithm of IFN-gamma at Baseline (pg/mL). Pearson’s coefficient is of ' +
        'the values as plotted, not of the values themselves.'
    );
    // What R was handed is the logarithm of what is drawn, row for row.
    const handed = await page.evaluate(() => {
      const { chart } = window.__as;
      const points = chart.charts[0].data.datasets[0].data.slice(0, 20);
      const [asked] = chart.statistics();
      return { asked: asked.dataId, type: chart.charts[0].scales.x.type, points: points.length };
    });
    expect(handed.type).toBe('logarithmic');
    expect(handed.asked).toMatchObject({ x_scale: 'log', y_scale: 'log' });
    expect(handed.asked).toEqual(resultOf('pearson-log').dataId);

    await choose(page, 'method', 'spearman');
    await expect(coefficient(page).locator('.bv-stat-remark[data-kind="scale"]')).toContainText(
      'Spearman’s coefficient is computed on ranks, which a logarithm does not change.'
    );
    await captureEvidence(line(page), 'AS-STAT-020', 'logarithmic-axes');
  });

  test('AS-FIT-005: with no R attached a linear fit and a smooth are not drawn and the chart says why, while the points and the identity line still draw (#26)', async ({
    page
  }) => {
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await open(page);
    for (const [fit, words] of [
      ['linear', 'linear fit'],
      ['smooth', 'smooth']
    ]) {
      await choose(page, 'fit', fit);
      const [panel] = await drawn(page);
      expect(panel.points).toBe(200);
      expect(panel.fit).toEqual([]);
      await expect(coefficient(page)).toHaveText(NO_R);
      await expect(fitted(page)).toHaveText(`The ${words} is not drawn. ${NO_R}`);
      await expect(fitted(page)).toHaveAttribute('data-state', 'unavailable');
      const asked = await page.evaluate(() => window.__as.chart.statistics());
      expect(asked.map((entry) => [entry.kind, entry.name, entry.answer.status])).toEqual([
        ['coefficient', 'Analyze_Correlation', 'unavailable'],
        ['fit', 'Analyze_Fit', 'unavailable']
      ]);
    }
    await choose(page, 'fit', 'identity');
    await expect(fitted(page)).toHaveCount(0);
    expect((await drawn(page))[0].points).toBe(200);
    expect(requests.filter((url) => /webr|r-wasm/.test(url))).toEqual([]);
  });

  test('AS-FIT-006: with R’s answers stored a linear fit and a smooth are drawn from R’s points with their band, each colour’s in its colour, and the slope and intercept are printed with their intervals (#26)', async ({
    page
  }) => {
    await open(page, { settings: { groups: [{ value_col: 'ARM', label: 'Arm' }] } });
    await withStored(
      page,
      ['pearson', 'pearson-by-arm', 'linear', 'smooth', 'linear-by-arm', 'smooth-by-arm'],
      { fit: 'linear' }
    );
    await expect(fitted(page).locator('p')).toHaveText([
      'Linear regression: p < 0.001 (n = 200). Exploratory, unadjusted.',
      'Slope: 0.3275, 95% confidence interval 0.2721 to 0.3828.',
      'Intercept: 2.028, 95% confidence interval 1.356 to 2.7.',
      'R-squared: 0.4075.',
      ...resultOf('linear').value.notes.map((note) => `R’s note: ${note}`),
      'The line is R’s linear fit of y on x for the 200 participants drawn, with R’s band about it.'
    ]);
    // The line drawn is R's points, each one, and nothing between or beyond them.
    const curve = await page.evaluate(() => window.__as.chart.charts[0].$fit);
    const rows = resultOf('linear').value.rows;
    expect(curve).toHaveLength(1);
    expect(curve[0].curve).toEqual(rows.map((row) => ({ x: row.x, y: row.fit })));
    expect(curve[0].lower).toEqual(rows.map((row) => ({ x: row.x, y: row.lower })));
    expect(curve[0].upper).toEqual(rows.map((row) => ({ x: row.x, y: row.upper })));
    // It is on the canvas: dark pixels along R's line.
    const dark = await page.evaluate(() => {
      const chart = window.__as.chart.charts[0];
      const ratio = chart.currentDevicePixelRatio;
      const context = chart.canvas.getContext('2d');
      return chart.$fit[0].curve.filter((point) => {
        const x = Math.round(chart.scales.x.getPixelForValue(point.x) * ratio);
        const y = Math.round(chart.scales.y.getPixelForValue(point.y) * ratio);
        const [r, g, b, a] = context.getImageData(x, y, 1, 1).data;
        return a > 0 && r < 110 && g < 120 && b < 130;
      }).length;
    });
    expect(dark).toBeGreaterThan(25);
    await captureEvidence(page.locator('.sv-chart-wrap'), 'AS-FIT-006', 'linear-fit');

    // A smooth: R's curve and band, and no p-value.
    await choose(page, 'fit', 'smooth');
    await expect(fitted(page).locator('.bv-stat-result')).toHaveText(
      'Local polynomial regression (loess): the curve and its band are R’s (n = 200).'
    );
    await expect(fitted(page)).not.toContainText(/p [=<>]/);
    const smooth = await page.evaluate(() => window.__as.chart.charts[0].$fit);
    expect(smooth[0].curve).toEqual(
      resultOf('smooth').value.rows.map((row) => ({ x: row.x, y: row.fit }))
    );

    // With a colour: a line and a band for each level, in R's order, and the
    // line of every point as well; the table gives each level's slope and intercept.
    await choose(page, 'fit', 'linear');
    await choose(page, 'color-by', 'ARM');
    await expect(fitted(page).locator('table tbody tr')).toHaveText([
      'Placebo1000.3034 (0.2205 to 0.3862)2.333 (1.305 to 3.361)p < 0.001',
      'Treatment1000.3474 (0.271 to 0.4238)1.785 (0.8783 to 2.692)p < 0.001'
    ]);
    await expect(fitted(page).locator('.bv-stat-scope')).toHaveText(
      'Each level of Arm has R’s linear fit of y on x in its colour, with R’s band about it. ' +
        'The dashed line is the linear fit of the 200 participants drawn together, drawn ' +
        'without its band.'
    );
    expect((await drawn(page))[0].fit).toEqual([
      { group: null, points: 50 },
      { group: 'Placebo', points: 50 },
      { group: 'Treatment', points: 50 }
    ]);
    await captureEvidence(page.locator('.sv-main'), 'AS-FIT-006', 'linear-fit-by-arm');

    // A view no line was stored for: not drawn, and the chart says why.
    await choose(page, 'x-visit', 'Week 4');
    expect((await drawn(page))[0].fit).toEqual([]);
    await expect(fitted(page)).toHaveText(
      'The linear fit is not drawn. Statistics are unavailable for this view: the page holds ' +
        'no stored result for it, and no R is attached to compute one.'
    );
  });
});

test.describe('association scatter: a region, the listing and the participant profile', () => {
  test('AS-BRUSH-001: dragging across the points lists the participants of the region, the others fade, and the statistics stay those of every participant drawn (#26)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page, { before: stubR });
    await attachStub(page);
    await expect.poll(() => called(page)).toBe(1);
    await answer(page, 0, 'pearson');
    await expect(coefficient(page).locator('.bv-stat-result')).toHaveText(PEARSON);
    await expect(page.locator('.sv-listing table')).toHaveCount(0);

    await drag(page, REGION);
    const expected = await inside(page, REGION);
    expect(expected.length).toBeGreaterThan(5);
    const chosen = await selection(page);
    // The region dragged is the region held, to the pixel the mouse was let go at.
    expect(chosen.region.x[0]).toBeCloseTo(REGION.x[0], 1);
    expect(chosen.region.x[1]).toBeCloseTo(REGION.x[1], 1);
    expect(chosen.region.y[0]).toBeCloseTo(REGION.y[0], 1);
    expect(chosen.region.y[1]).toBeCloseTo(REGION.y[1], 1);
    // Every participant listed is in it, and every participant in it is listed.
    const held = await inside(page, chosen.region);
    expect(chosen.listed).toEqual(held);
    expect(chosen.selected.sort()).toEqual([...held].sort());
    expect(Math.abs(held.length - expected.length)).toBeLessThanOrEqual(2);
    await expect(page.locator('.sv-listing-actions strong')).toHaveText(
      `${held.length} of ${held.length} records`
    );
    await expect(page.locator('.sv-listing thead th')).toHaveText([
      'Participant',
      'TNF-alpha at Baseline (pg/mL)',
      'IL-10 at Baseline (pg/mL)'
    ]);
    await expect(page.locator('.sv-footnote')).toHaveText(
      `${held.length} participants in the region listed, of the 200 drawn. The statistics are ` +
        'still of all 200: a region lists participants and does not change what R is asked. ' +
        "Click a row to open the participant's profile."
    );
    // The points outside it fade, and the ones inside keep their colour.
    const alphas = await page.evaluate(() => {
      const { chart } = window.__as;
      const meta = chart.charts[0].getDatasetMeta(0);
      return chart.charts[0].data.datasets[0].data.map((point, index) => ({
        in: chart.selection.ids.has(point.record.USUBJID),
        alpha: Number(meta.data[index].options.backgroundColor.match(/, ([\d.]+)\)$/)[1])
      }));
    });
    expect(new Set(alphas.filter((point) => point.in).map((point) => point.alpha))).toEqual(
      new Set([0.55])
    );
    expect(new Set(alphas.filter((point) => !point.in).map((point) => point.alpha))).toEqual(
      new Set([0.12])
    );
    // R was not asked again, and its answer for all 200 still stands. No
    // participant is selected by a region: it lists.
    expect(await called(page)).toBe(1);
    await expect(coefficient(page).locator('.bv-stat-result')).toHaveText(PEARSON);
    await expect(page.locator('.sv-rail')).toBeHidden();
    expect(errors).toEqual([]);
    await captureEvidence(page.locator('.sv-main'), 'AS-BRUSH-001', 'a-region-listed');

    // A region with nobody in it lists nothing, and says so.
    await drag(page, { x: [3, 4], y: [9, 10] });
    await expect(page.locator('.sv-listing table')).toHaveCount(0);
    await expect(page.locator('.sv-footnote')).toHaveText(
      `No participant is in that region. ${HINT}`
    );
    expect((await selection(page)).selected).toBe(null);
  });

  test('AS-BRUSH-002: with panels a region is in the panel it was dragged in and lists that panel’s participants; chart.brush() selects one by values, and a new region replaces the last (#26)', async ({
    page
  }) => {
    await open(page, { settings: { panel_by: 'SEX' } });
    await drag(page, REGION, 1);
    let chosen = await selection(page);
    expect(chosen.panel).toBe('M');
    expect(chosen.listed).toEqual(await inside(page, chosen.region, 1));
    expect(chosen.listed.length).toBeGreaterThan(2);
    await expect(page.locator('.sv-listing thead th')).toHaveText([
      'Participant',
      'TNF-alpha at Baseline (pg/mL)',
      'IL-10 at Baseline (pg/mL)',
      'SEX'
    ]);
    await expect(page.locator('.sv-footnote')).toContainText(
      `${chosen.listed.length} participants in the region listed, of the 109 drawn in this panel (M).`
    );
    const sexes = await page.evaluate(() => [
      ...new Set(window.__as.chart.host.currentTableData.map((row) => row.panel))
    ]);
    expect(sexes).toEqual(['M']);

    // By values, in the other panel: it replaces the region in the first.
    await page.evaluate((region) => window.__as.chart.brush({ ...region, panel: 'F' }), REGION);
    chosen = await selection(page);
    expect(chosen.panel).toBe('F');
    expect(chosen.region).toEqual(REGION);
    expect(chosen.listed).toEqual(await inside(page, REGION, 0));
    // With panels a region must say which, and its ends must be numbers.
    const refused = await page.evaluate(() =>
      [{ x: [12, 14], y: [6, 8] }, { x: [12], y: [6, 8], panel: 'F' }, null].map((region) => {
        try {
          window.__as.chart.brush(region);
          return 'selected';
        } catch (error) {
          return error.message;
        }
      })
    );
    for (const message of refused) {
      expect(message).toMatch(/^bio\.viz: brush\(\) takes \{ x: \[from, to\], y: \[from, to\] \}/);
    }
  });

  test('AS-BRUSH-004: a change to a control or a filter, a click on nothing, or clearBrush() lets go of the region and empties the listing (#26)', async ({
    page
  }) => {
    await open(page);
    const brush = () => page.evaluate((region) => window.__as.chart.brush(region), REGION);
    const listed = page.locator('.sv-listing table');
    await brush();
    await expect(listed).toHaveCount(1);
    await page.locator('select[data-filter="SEX"]').selectOption('M');
    await expect(listed).toHaveCount(0);
    await expect(page.locator('.sv-footnote')).toHaveText(HINT);
    expect((await selection(page)).selected).toBe(null);

    await brush();
    await expect(listed).toHaveCount(1);
    await choose(page, 'method', 'spearman');
    await expect(listed).toHaveCount(0);

    await brush();
    await expect(listed).toHaveCount(1);
    await page.evaluate(() => window.__as.chart.clearBrush());
    await expect(listed).toHaveCount(0);
    await expect(page.locator('.sv-footnote')).toHaveText(HINT);

    // A click where no point is.
    await brush();
    await expect(listed).toHaveCount(1);
    const empty = await placeOf(page, { x: 4, y: 9.5 });
    await page.mouse.click(empty.x, empty.y);
    await expect(listed).toHaveCount(0);
    expect((await selection(page)).selected).toBe(null);
    await expect(page.locator('.sv-footnote')).toHaveText(HINT);
  });

  test('AS-LIST-001: the listing’s search and paging work on the participants listed, and its export downloads them under this chart’s name (#26)', async ({
    page
  }) => {
    await open(page, { settings: { color_by: 'ARM' } });
    const whole = await page.evaluate(() => {
      const { x, y } = window.__as.chart.charts[0].scales;
      return { x: [x.min, x.max], y: [y.min, y.max] };
    });
    await page.evaluate((region) => window.__as.chart.brush(region), whole);
    await expect(page.locator('.sv-listing-actions strong')).toHaveText('200 of 200 records');
    await expect(page.locator('.sv-listing tbody tr')).toHaveCount(10);
    await page.locator('.sv-listing-search').fill('BIO-01');
    const matching = await page.evaluate(
      () =>
        window.__as.chart.host.currentTableData.filter((row) => row.USUBJID.includes('BIO-01'))
          .length
    );
    expect(matching).toBeGreaterThan(1);
    await expect(page.locator('.sv-listing-actions strong')).toHaveText(
      `${matching} of 200 records`
    );
    await page.locator('.sv-listing-search').fill('');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export: CSV' }).click()
    ]);
    expect(download.suggestedFilename()).toBe('bio.viz-association-scatter-listing.csv');
    const lines = readFileSync(await download.path(), 'utf8').split('\n');
    expect(lines[0]).toBe(
      'Participant,TNF-alpha at Baseline (pg/mL),IL-10 at Baseline (pg/mL),ARM'
    );
    expect(lines).toHaveLength(201);
    expect(lines[1]).toMatch(/^"BIO-\d{3}","\d[\d.]*","\d[\d.]*","(Placebo|Treatment)"$/);
  });

  test('AS-PROF-001: clicking a point lists that participant and opens their profile through the participantsSelected event; a row of the listing does the same (#26)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page);
    await page.evaluate(() => {
      window.__selected = [];
      document
        .querySelector('#chart')
        .addEventListener('participantsSelected', (event) =>
          window.__selected.push(event.detail.data)
        );
    });
    await expect(page.locator('.sv-rail')).toBeHidden();
    const point = await lonePoint(page);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator('.sv-listing-actions strong')).toHaveText('1 of 1 records');
    await expect(page.locator('.sv-listing tbody td').first()).toHaveText(point.id);
    await expect(page.locator('.sv-listing tbody tr').first()).toHaveClass(
      /sv-listing-row-selected/
    );
    await expect(page.locator('.sv-footnote')).toContainText(
      '1 participant at the point listed, of the 200 drawn.'
    );
    // The event safety.viz's charts raise, heard outside the chart.
    expect(await page.evaluate(() => window.__selected)).toEqual([[point.id]]);
    const rail = page.locator('.sv-rail');
    await expect(rail).toBeVisible();
    await expect(rail.locator('.sv-profile-id')).toHaveText(`Participant ${point.id}`);
    await expect(rail.locator('.sv-profile-measure-name')).toHaveCount(12);
    // No reference range is claimed: results are shown against the first result only.
    await expect(rail.locator('.sv-profile-display option')).toHaveText([
      'Multiple of first result'
    ]);
    // Clear, in the rail, clears the selection in the chart too.
    await rail.locator('.sv-profile-clear').click();
    await expect(rail).toBeHidden();
    expect(await page.evaluate(() => window.__selected)).toEqual([[point.id], []]);

    // A row of a region's listing opens that participant's profile.
    await page.evaluate((region) => window.__as.chart.brush(region), REGION);
    const row = page.locator('.sv-listing tbody tr').nth(2);
    const id = await row.locator('td').first().textContent();
    await row.click();
    await expect(rail.locator('.sv-profile-id')).toHaveText(`Participant ${id}`);
    expect((await page.evaluate(() => window.__selected)).at(-1)).toEqual([id]);
    expect(errors).toEqual([]);
  });
});

test.describe('association scatter: lifecycle', () => {
  test('AS-LIFE-001: init, setData, setSettings, render, resize and destroy drive the chart as they drive a safety.viz chart, and setSettings({ x, y }) opens it on a named pair (#26)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page);
    // Chaining: each returns the chart.
    const chained = await page.evaluate(() => {
      const { chart, data } = window.__as;
      return [
        chart.init(data) === chart,
        chart.setData(data) === chart,
        chart.setSettings({}) === chart,
        chart.brush({ x: [12, 14], y: [6, 8] }) === chart,
        chart.clearBrush() === chart
      ];
    });
    expect(chained).toEqual([true, true, true, true, true]);

    // A named pair, in place: the controls move and the chart is drawn again.
    await page.evaluate(() =>
      window.__as.chart.setSettings({
        x: { measure: 'IL-6', visit: 'Baseline' },
        y: { measure: 'IL-6', visit: 'Week 12', value: 'percent_change' },
        method: 'spearman'
      })
    );
    expect(await controls(page)).toMatchObject({
      'x-variable': 'm:IL-6',
      'x-visit': 'Baseline',
      'y-variable': 'm:IL-6',
      'y-value': 'percent_change',
      'y-visit': 'Week 12',
      method: 'spearman'
    });
    let [panel] = await drawn(page);
    expect(panel.y.title).toBe('IL-6 at Week 12, percent change from baseline (%)');
    // A setting that is not a view leaves the view where the reader put it.
    await choose(page, 'color-by', 'ARM');
    await page.evaluate(() => window.__as.chart.setSettings({ page_size: 5 }));
    expect((await controls(page))['color-by']).toBe('ARM');
    expect((await drawn(page))[0].y.title).toBe(
      'IL-6 at Week 12, percent change from baseline (%)'
    );
    // A pair the tables do not have gives way to the chart's own, and says so.
    const warnings = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    await page.evaluate(() =>
      window.__as.chart.setSettings({ x: { measure: 'IL-17', visit: 'Baseline' }, y: null })
    );
    expect(await page.evaluate(() => window.__as.chart.view())).toMatchObject({
      x: { measure: 'CRP', value: 'raw', visit: 'Baseline' },
      y: { measure: 'D-dimer', value: 'raw', visit: 'Baseline' }
    });
    expect(warnings.join('\n')).toContain('The initial x variable');

    // New tables: the controls return to what the settings open on.
    await page.evaluate(() => {
      const { chart, data } = window.__as;
      chart.setSettings({ x: null, y: null, color_by: null });
      chart.setData({ results: data.results.filter((row) => row.TEST === 'IL-6') });
    });
    // One biomarker: the same biomarker at the first two visits.
    expect(await page.evaluate(() => window.__as.chart.view())).toMatchObject({
      x: { measure: 'IL-6', value: 'raw', visit: 'Baseline' },
      y: { measure: 'IL-6', value: 'raw', visit: 'Week 2' }
    });
    [panel] = await drawn(page);
    expect(panel.points).toBeGreaterThan(150);

    // render, resize, and an empty table.
    await page.evaluate(() => {
      window.__as.chart.render();
      window.__as.chart.resize();
    });
    expect(await drawn(page)).toHaveLength(1);
    await page.evaluate(() => window.__as.chart.setData({ results: [] }));
    await expect(page.locator('.sv-footnote')).toHaveText('No results to draw.');
    expect(await drawn(page)).toEqual([]);

    await page.evaluate(() => window.__as.chart.destroy());
    await expect(page.locator('#chart')).toBeEmpty();
    expect(errors).toEqual([]);
  });

  test('AS-LIFE-002: tables the chart cannot read are refused with a message, shown in its place (#26)', async ({
    page
  }) => {
    await open(page);
    const messages = await page.evaluate(() => {
      const tried = [];
      for (const data of [{ results: 'none' }, { results: [{ SUBJECT: 'A' }] }]) {
        const chart = window.BioViz.associationScatter('#chart', {});
        try {
          chart.setData(data);
          tried.push('drawn');
        } catch (error) {
          tried.push([error.message, document.querySelector('#chart .sv-warning').textContent]);
        }
      }
      return tried;
    });
    expect(messages).toEqual([
      [
        'bio.viz: `results` must be an array of records, one object per row.',
        'bio.viz: `results` must be an array of records, one object per row.'
      ],
      [
        'bio.viz: the results table has no column `USUBJID` (`id_col`).',
        'bio.viz: the results table has no column `USUBJID` (`id_col`).'
      ]
    ]);
  });

  test('AS-LIFE-003: the chart can be mounted inside another chart’s element on a named pair, with a way back that calls the caller, by a click or from the keyboard (#26)', async ({
    page
  }) => {
    await open(page, { make: false });
    await page.evaluate(() => {
      // A stand-in for a chart that opens this one: its own root, with a place
      // inside it for the scatter, and a function that brings it back.
      const host = document.querySelector('#chart');
      host.innerHTML = '<div class="grid">The grid</div><div class="drill"></div>';
      window.__back = [];
      const connection = window.BioViz.r.createConnection();
      window.__open = (x, y) => {
        host.querySelector('.grid').hidden = true;
        window.__drill = window.BioViz.associationScatter(host.querySelector('.drill'), {
          x,
          y,
          method: 'spearman',
          baseline_visits: 'Baseline',
          connection,
          back: {
            label: 'Back to the grid',
            action: (chart) => {
              window.__back.push(chart === window.__drill);
              chart.destroy();
              host.querySelector('.grid').hidden = false;
            }
          }
        }).init(window.__as.data);
      };
      window.__open(
        { measure: 'TNF-alpha', visit: 'Baseline' },
        { measure: 'IL-10', visit: 'Baseline' }
      );
    });
    const back = page.locator('.bv-association-scatter .bv-back');
    await expect(back).toHaveText('Back to the grid');
    await expect(page.locator('.grid')).toBeHidden();
    await expect(page.locator('.drill .sv-chart-wrap canvas')).toHaveAttribute(
      'aria-label',
      /^IL-10 at Baseline \(pg\/mL\) against TNF-alpha at Baseline/
    );
    expect(await page.evaluate(() => window.__drill.view())).toMatchObject({
      x: { measure: 'TNF-alpha', value: 'raw', visit: 'Baseline' },
      y: { measure: 'IL-10', value: 'raw', visit: 'Baseline' },
      method: 'spearman'
    });
    await back.click();
    await expect(page.locator('.grid')).toBeVisible();
    await expect(page.locator('.drill')).toBeEmpty();

    // Another pair, and back from the keyboard: the button takes Enter.
    await page.evaluate(() =>
      window.__open({ measure: 'IL-6', visit: 'Week 4' }, { measure: 'CRP', visit: 'Week 4' })
    );
    await expect(page.locator('.drill .sv-chart-wrap canvas')).toHaveAttribute(
      'aria-label',
      /^CRP at Week 4 \(mg\/L\) against IL-6 at Week 4/
    );
    await back.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.grid')).toBeVisible();
    expect(await page.evaluate(() => window.__back)).toEqual([true, true]);
    // Without the setting there is no button.
    await page.evaluate(() => {
      window.__plain = window.BioViz.associationScatter('.drill', {}).init(window.__as.data);
    });
    await expect(page.locator('.bv-back')).toHaveCount(0);
  });
});

test.describe('association scatter: on a phone', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });

  // A finger dragged across the chart, through the browser's own touch input.
  async function touchDrag(page, from, to) {
    const client = await page.context().newCDPSession(page);
    const at = (point) => [{ x: Math.round(point.x), y: Math.round(point.y) }];
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(from) });
    for (let step = 1; step <= 6; step += 1) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: at({
          x: from.x + ((to.x - from.x) * step) / 6,
          y: from.y + ((to.y - from.y) * step) / 6
        })
      });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.detach();
  }

  test('AS-MOBILE-001: at 390px the chart fills the width with its controls folded away one tap from open, panels stack one to a row, and the page does not scroll sideways (#26)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page, { settings: { color_by: 'ARM' } });
    expect(await layout(page)).toEqual(HOLDS);
    await expect(page.locator('.sv-controls')).toBeHidden();
    const chart = await page.locator('.sv-chart-wrap').boundingBox();
    expect(chart.width).toBeGreaterThan(330);
    expect((await drawn(page))[0].points).toBe(200);
    // One tap opens the controls, and the page still holds.
    await page.locator('.sv-sidebar-toggle').tap();
    await expect(page.locator('.sv-controls')).toBeVisible();
    expect(await layout(page)).toEqual(HOLDS);
    await choose(page, 'panel-by', 'SEX');
    await page.locator('.sv-sidebar-toggle').tap();
    const cards = await page.locator('.bv-panel').evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { left: Math.round(box.left), width: Math.round(box.width) };
      })
    );
    expect(cards).toHaveLength(2);
    expect(cards[1].left).toBe(cards[0].left);
    expect(cards[0].width).toBeGreaterThan(330);
    expect(await layout(page)).toEqual(HOLDS);
    expect(errors).toEqual([]);
    await captureEvidence(page.locator('#chart'), 'AS-MOBILE-001', 'panels-on-a-phone');
  });

  test('AS-MOBILE-002: at 390px a point can be tapped, its listing read and a profile opened below the chart, with the coefficient and both tables beneath, and the page does not scroll sideways (#26)', async ({
    page
  }) => {
    await open(page, { settings: { groups: [{ value_col: 'ARM', label: 'Arm' }] } });
    await page.evaluate(
      (results) =>
        window.__as.chart.setSettings({
          color_by: 'ARM',
          fit: 'linear',
          connection: window.BioViz.r.createConnection({ results })
        }),
      stored('pearson-by-arm', 'linear-by-arm')
    );
    await expect(coefficient(page).locator('table tbody tr')).toHaveCount(2);
    await expect(fitted(page).locator('table tbody tr')).toHaveCount(2);
    expect(await layout(page)).toEqual(HOLDS);
    // Neither table runs off the page.
    const tables = await page
      .locator('.bv-statistic table')
      .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().right)));
    for (const right of tables) expect(right).toBeLessThanOrEqual(390);

    await page.locator('.sv-chart-wrap canvas').scrollIntoViewIfNeeded();
    const point = await lonePoint(page);
    await page.touchscreen.tap(point.x, point.y);
    await expect(page.locator('.sv-listing tbody td').first()).toHaveText(point.id);
    await expect(page.locator('.sv-rail .sv-profile-id')).toHaveText(`Participant ${point.id}`);
    expect(await layout(page)).toEqual(HOLDS);
    await captureEvidence(line(page), 'AS-MOBILE-002', 'tables-on-a-phone');
  });

  test('AS-BRUSH-003: where a finger is the pointer a drag on the chart scrolls the page until Select a region is on; then a drag selects a region and does not scroll (#26)', async ({
    page
  }) => {
    await open(page);
    const button = page.locator('.bv-association-scatter .bv-region');
    await expect(button).toHaveText('Select a region');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.sv-footnote')).toHaveText(
      'Tap a point to list its participant and open their profile. To list a region, tap Select ' +
        'a region, then drag on the chart.'
    );
    // The switch is a button a finger taps: on, and off again.
    await button.tap();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.sv-chart-wrap canvas')).toHaveClass(/bv-region-on/);
    await button.tap();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.sv-chart-wrap canvas')).not.toHaveClass(/bv-region-on/);
    // From here the switch is pressed with a click. The drags below are sent
    // through the browser's own touch input, and a tap synthesized after one of
    // them was once not turned into a click on the Linux runner; what is under
    // test from here is the drag, not the button.
    await page.locator('.sv-chart-wrap').scrollIntoViewIfNeeded();
    const ends = async () => [
      await placeOf(page, { x: 9, y: 7.5 }),
      await placeOf(page, { x: 14, y: 4.5 })
    ];

    // Off: the drag is the page's. Nothing is selected, and the page moved.
    let [from, to] = await ends();
    const before = await page.evaluate(() => window.scrollY);
    await touchDrag(page, to, from);
    await page.waitForTimeout(250);
    expect((await selection(page)).selected).toBe(null);
    await expect(page.locator('.sv-listing table')).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(before);

    // And where a browser hands the chart a finger's drag itself, without
    // scrolling, the chart still does not take it for a region.
    const handed = await page.evaluate(
      ([start, end]) => {
        const canvas = document.querySelector('.sv-chart-wrap canvas');
        const fire = (type, at) =>
          canvas.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 7,
              pointerType: 'touch',
              isPrimary: true,
              bubbles: true,
              clientX: at.x,
              clientY: at.y
            })
          );
        const box = canvas.getBoundingClientRect();
        const within = (point) => ({ x: point.x, y: Math.min(point.y, box.bottom - 40) });
        fire('pointerdown', within(start));
        fire('pointermove', within({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }));
        fire('pointermove', within(end));
        fire('pointerup', within(end));
        return window.__as.chart.selection === null;
      },
      await ends()
    );
    expect(handed).toBe(true);
    await expect(page.locator('.sv-listing table')).toHaveCount(0);

    // On: the same drag selects a region, and the page stays where it is.
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.sv-chart-wrap canvas')).toHaveClass(/bv-region-on/);
    await expect(page.locator('.sv-footnote')).toContainText(
      'Selecting a region: drag on the chart'
    );
    await page.locator('.sv-chart-wrap').scrollIntoViewIfNeeded();
    [from, to] = await ends();
    const still = await page.evaluate(() => window.scrollY);
    await touchDrag(page, from, to);
    await expect(page.locator('.sv-listing table')).toHaveCount(1);
    const chosen = await selection(page);
    expect(chosen.listed.length).toBeGreaterThan(10);
    expect(chosen.listed).toEqual(await inside(page, chosen.region));
    expect(chosen.region.x[0]).toBeCloseTo(9, 0);
    expect(chosen.region.x[1]).toBeCloseTo(14, 0);
    expect(await page.evaluate(() => window.scrollY)).toBe(still);
    expect(await layout(page)).toEqual(HOLDS);
    await captureEvidence(page.locator('.sv-main'), 'AS-BRUSH-003', 'a-region-on-a-phone');

    // Off again: the chart scrolls the page once more, and the region stays listed.
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.sv-chart-wrap canvas')).not.toHaveClass(/bv-region-on/);
    await expect(page.locator('.sv-listing table')).toHaveCount(1);
  });
});

test.describe('association scatter: on the site', () => {
  test('AS-FILTER-003: on the demo, filters with nobody in common leave the chart saying, in words, that no participant passes the filters; nothing is drawn, R is asked nothing, the controls stay usable, and loosening a filter draws again (#29)', async ({
    page
  }) => {
    const errors = await openDemo(page, 'association-scatter', 'associationScatter');
    const charts = () => window.BioVizDemo.chart.charts.length;
    await expect.poll(() => asked(page)).toBeGreaterThan(0);
    const before = await letNobodyThrough(page);
    await expectNobody(page, errors, { drawn: charts });
    expect(await asked(page)).toBe(before);
    await page.locator('#chart select[data-filter="RESPONSE"]').selectOption('__all__');
    await expect(page.locator('#chart .sv-notes')).toContainText(
      '4 of 200 participants pass the filters.'
    );
    expect(await page.evaluate(charts)).toBe(1);
    await expect.poll(() => asked(page)).toBeGreaterThan(before);
    await expect(page.locator('#chart .sv-footnote')).not.toHaveText(NOBODY_PASSES);
  });

  test('AS-SITE-001: the gallery lists the chart, with links to its live demo, its evidence page and its API reference (#26)', async ({
    page
  }) => {
    const errors = watch(page);
    await blockR(page);
    await page.goto('/_site/gallery/index.html');
    const card = page.locator('#charts [data-module="association-scatter"]');
    await expect(card.locator('h3')).toHaveText('Association scatter');
    await expect(card).toContainText('Do these two variables move together?');
    // Every chart is listed, the first one first.
    await expect(page.locator('#charts [data-module]')).toHaveCount(5);

    await card.getByRole('link', { name: 'Evidence' }).click();
    await expect(page).toHaveURL(/\/_site\/association-scatter\/evidence\.html$/);
    await expect(page.locator('.page-tabs a')).toHaveText([
      'Gallery',
      'Live demo',
      'Evidence',
      'API reference'
    ]);
    await page.locator('.page-tabs').getByRole('link', { name: 'API reference' }).click();
    await expect(page.locator('h1')).toHaveText('The association scatter');
    await expect(
      page.locator('.api-body h2 code').filter({ hasText: /^associationScatter\(/ })
    ).toHaveCount(1);
    await page.locator('.page-tabs').getByRole('link', { name: 'Gallery' }).click();
    await card.getByRole('link', { name: 'Live demo' }).click();
    await expect(page).toHaveURL(/\/_site\/association-scatter\/index\.html$/);
    await expect(page.locator('h1')).toHaveText('Association scatter');
    expect(
      errors.filter((message) => !/webr|r-wasm|Failed to load resource/.test(message))
    ).toEqual([]);
  });

  test('AS-SITE-002: the live demo draws the chart on the synthetic study, opening on the planted pair coloured by arm, with R attached; where R cannot be reached it still draws, and says so (#26)', async ({
    page
  }) => {
    // R's hosts are kept out of reach: this test stays on this machine. The
    // tests named AS-LIVE run the same page against real R.
    await blockR(page);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const scripts = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith('.js')) scripts.push(url.pathname.replace('/_site/', ''));
    });
    await page.goto('/_site/association-scatter/index.html');
    await page.evaluate(() => window.BioVizDemo.ready);
    await expect(page.locator('h1')).toHaveText('Association scatter');
    // safety.viz first, then bio.viz, then the demo's own two scripts.
    expect(scripts.map((file) => file.replace(/bio\.viz-[\d.]+/, 'bio.viz-x'))).toEqual([
      'vendor/safety.viz/safety.viz.js',
      'dist/bio.viz-x/bio.viz.js',
      'demo/synthetic-study.js',
      'demo/association-scatter.js'
    ]);
    // It opens on the pair the study was planted with, coloured by arm, with
    // R's linear fit chosen.
    expect(await page.evaluate(() => window.BioVizDemo.chart.view())).toEqual({
      x: { measure: 'TNF-alpha', value: 'raw', visit: 'Baseline' },
      y: { measure: 'IL-10', value: 'raw', visit: 'Baseline' },
      color_by: 'ARM',
      panel_by: null,
      x_scale: 'linear',
      y_scale: 'linear',
      fit: 'linear',
      method: 'pearson'
    });
    const [panel] = await drawn(page, 'demo');
    expect(panel.points).toBe(200);
    expect(panel.legend).toEqual(['Placebo', 'Treatment']);
    expect([panel.x.title, panel.y.title]).toEqual([
      'TNF-alpha at Baseline (pg/mL)',
      'IL-10 at Baseline (pg/mL)'
    ]);
    expect(
      await page.evaluate(
        () => window.BioVizDemo.chart.charts[0] instanceof window.SafetyViz.kit.Chart
      )
    ).toBe(true);
    // The chart is drawn, and the line under it says that R could not be
    // started rather than nothing at all; no line of R's is drawn.
    await expect(line(page)).toHaveAttribute('data-state', 'unavailable');
    const unreachable =
      'Statistics are unavailable: R could not be started (Failed to fetch dynamically imported module: https://webr.r-wasm.org/v0.6.0/webr.mjs).';
    await expect(coefficient(page)).toHaveText(unreachable);
    await expect(fitted(page)).toHaveText(`The linear fit is not drawn. ${unreachable}`);
    expect(panel.fit).toEqual([]);
    // The demo names its filters, its groups and its participant-level numbers.
    await expect(page.locator('.sv-sidebar select[data-filter]')).toHaveCount(3);
    await expect(page.locator('select[data-control="color-by"] option')).toHaveText([
      'None',
      'Arm',
      'Sex',
      'Response'
    ]);
    const offered = await page
      .locator('select[data-control="x-variable"] option')
      .allTextContents();
    expect(offered.slice(-2)).toEqual(['Age (participant)', 'BMI at baseline (participant)']);
    // The page says what it is for, and where the R it runs comes from.
    await expect(page.locator('#about-demo')).toContainText(
      'TNF-alpha against IL-10 at Baseline, one point per participant, whose true Pearson correlation is 0.6'
    );
    await expect(page.locator('#demo-statistics')).toContainText(
      `copied from gsm.bio at commit ${statisticsRecord.commit.slice(0, 7)}`
    );
    const file = await page.request.get('/_site/vendor/gsm.bio/statistics.R');
    expect(file.ok()).toBe(true);
    expect((await file.body()).length).toBe(statisticsRecord.files[0].bytes);
    expect((await file.text()).includes('Analyze_Fit <- function(')).toBe(true);
    // A point opens the profile here as on the fixture.
    await page.locator('.sv-chart-wrap canvas').scrollIntoViewIfNeeded();
    const point = await lonePoint(page, 0, 'demo');
    await page.mouse.click(point.x, point.y);
    await expect(page.locator('.sv-rail .sv-profile-id')).toHaveText(`Participant ${point.id}`);
    await expect(page.locator('.sv-rail .sv-profile-details li')).toHaveCount(5);
    expect(errors).toEqual([]);
  });

  test('AS-SITE-003: the live demo holds at a 390px-wide viewport with no horizontal scroll (#26)', async ({
    browser
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await blockR(page);
    await page.goto('/_site/association-scatter/index.html');
    await page.evaluate(() => window.BioVizDemo.ready);
    const measure = () =>
      page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth
      }));
    const holds = { viewport: 390, scrollWidth: 390, bodyScrollWidth: 390 };
    expect(await measure()).toEqual(holds);
    await expect(page.locator('.sv-root')).toHaveClass(/sv-collapsed/);
    await expect(page.locator('.bv-region')).toBeVisible();
    const chart = await page.locator('.sv-chart-wrap').boundingBox();
    expect(chart.width).toBeGreaterThan(320);
    // With the controls open, a listing shown and a profile open, it still holds.
    await page.locator('.sv-sidebar-toggle').tap();
    await expect(page.locator('.sv-controls')).toBeVisible();
    expect(await measure()).toEqual(holds);
    await page.locator('.sv-sidebar-toggle').tap();
    await page.locator('.sv-chart-wrap canvas').scrollIntoViewIfNeeded();
    const point = await lonePoint(page, 0, 'demo');
    await page.touchscreen.tap(point.x, point.y);
    await expect(page.locator('.sv-rail .sv-profile-id')).toBeVisible();
    expect(await measure()).toEqual(holds);
    await captureEvidence(page.locator('#demo'), 'AS-SITE-003', 'demo-on-a-phone');
    await context.close();
  });
});

// ---------------------------------------------------------------------------
// The gallery's demo, for real (#26). These tests need the network: they open
// the built demo page, which starts webR 0.6.0 from its public host and gives it
// gsm.bio's statistics file, and they hold what R in the browser answers to
// what desktop R answered for the same rows (tests/fixtures/
// association-statistics-r.json). If R's host cannot be reached the tests fail;
// nothing here skips, and nothing retries.
//
// They run in order on one page, because R is started once and the cost of
// starting it is one of the things measured. The browser is started on a new,
// empty profile with a disk cache, the way a first-time visitor's is.
//
// Equality is 1 part in 10^8, the R check page's tolerance: desktop R and R in
// the browser are different builds of different R versions. A difference that is
// not a rounding of the last digits is never let through by widening the
// tolerance: it is recorded, with both versions' numbers, and the test says
// which member differed and why that is R's own.

const megabytes = (bytes) => Number((bytes / 1e6).toFixed(2));

test.describe('association scatter: the demo, with R in the browser, live', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  let context;
  let page;
  const finished = [];
  const sideBySide = [];
  const measured = {};
  const differences = [];
  const isRFile = (url) => isRHost(url) || new URL(url).pathname.endsWith('/statistics.R');

  // What the chart asked R for the one panel drawn, and what R answered.
  const asked = (kind) =>
    page.evaluate(
      (wanted) => window.BioVizDemo.chart.statistics().find((entry) => entry.kind === wanted),
      kind
    );
  // The rows the chart drew, which are the rows desktop R read: on a
  // logarithmic axis each side takes their base-10 logarithm for R.
  const drawnRows = () =>
    page.evaluate(() =>
      window.BioVizDemo.chart.model.panels[0].records.map((record) => [
        record.USUBJID,
        record.x,
        record.y,
        ...(record.color === undefined ? [] : [record.color])
      ])
    );
  // Waits until neither the coefficient nor the fitted line is waiting.
  const answered = async () => {
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            [...document.querySelectorAll('.sv-main > .bv-statistic > div')]
              .map((part) => part.dataset.state || 'empty')
              .filter((state, index) => index === 0 || state !== 'empty')
              .every((state) => !/^(waiting|empty)$/.test(state))
          ),
        { timeout: 200_000 }
      )
      .toBe(true);
  };
  // Everything the coefficient's line, or the fitted line's, has read since the
  // log was last cleared, as it changed.
  const lineLog = (part = 'coefficient') =>
    page.evaluate(
      (wanted) =>
        window.__line
          .filter((entry) => entry.part === wanted && entry.state !== 'empty')
          .map(({ state, text }) => [state, text]),
      part
    );
  const clearLineLog = () =>
    page.evaluate(() => {
      window.__line = [];
    });
  const setView = (settings) =>
    page.evaluate((given) => {
      window.BioVizDemo.chart.setSettings(given);
    }, settings);
  // The demo's own opening view, stated here: the planted pair, coloured by arm,
  // with R's linear fit and Pearson's coefficient.
  const OPENING = {
    x: { measure: 'TNF-alpha', visit: 'Baseline' },
    y: { measure: 'IL-10', visit: 'Baseline' },
    color_by: 'ARM',
    panel_by: null,
    x_scale: 'linear',
    y_scale: 'linear',
    fit: 'linear',
    method: 'pearson'
  };

  // The rows desktop R ran on, from the committed file.
  const fixtureRows = (file) =>
    readFileSync(new URL(`../fixtures/association-statistics/${file}`, import.meta.url), 'utf8')
      .trimEnd()
      .split('\n')
      .slice(1)
      .map((row) =>
        row.split(',').map((cell, index) => (index === 1 || index === 2 ? Number(cell) : cell))
      );

  // Holds one answer from R in the browser to desktop R's for the same case:
  // the chart asked with the key desktop R wrote, on the rows desktop R read,
  // and every member of the answer is the same. Returns the members that are
  // not, for a case where R's own answer differs between its versions.
  async function holdToDesktop(name, testInfo) {
    const expected = resultOf(name);
    const kind = expected.name === 'Analyze_Fit' ? 'fit' : 'coefficient';
    await answered();
    const answer = await asked(kind);
    expect(answer, `${name}: nothing was asked for the ${kind}`).toBeTruthy();
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
    expect(await drawnRows()).toEqual(fixtureRows(expected.file));

    const compared = compareValues(expected.value, answer.answer.value);
    const differing = compared.filter((row) => !row.ok);
    const numbers = compared.filter((row) => row.difference !== null);
    const estimates = (value) =>
      (value.estimates || []).map((row) => [
        row.name,
        row.group,
        row.estimate,
        row.lower,
        row.upper
      ]);
    sideBySide.push({
      case: name,
      asked: expected.name,
      method: expected.value.method,
      p_value: { desktop: expected.value.p_value, browser: answer.answer.value.p_value },
      estimates: {
        desktop: estimates(expected.value),
        browser: estimates(answer.answer.value)
      },
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
      body: JSON.stringify(
        { desktopR: expected.value, webR: answer.answer.value, differing },
        null,
        2
      ),
      contentType: 'application/json'
    });
    return { expected: expected.value, actual: answer.answer.value, differing, compared };
  }

  test.beforeAll(async ({}, testInfo) => {
    const profile = mkdtempSync(path.join(tmpdir(), 'bio-viz-association-scatter-'));
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 1280, height: 800 }
    });
    // Every state and text the coefficient's line and the fitted line's take,
    // with when they took it.
    await context.addInitScript(() => {
      window.__line = [];
      new MutationObserver(() => {
        for (const part of ['coefficient', 'fit']) {
          const found = document.querySelector(`.sv-main > .bv-statistic > .bv-${part}`);
          if (!found) continue;
          const entry = { part, state: found.dataset.state || 'empty', text: found.textContent };
          const last = window.__line.filter((logged) => logged.part === part).at(-1);
          if (!last || last.state !== entry.state || last.text !== entry.text) {
            window.__line.push({ ...entry, at: performance.now() });
          }
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
    await page.goto('/_site/association-scatter/index.html');
    await page.evaluate(() => window.BioVizDemo.ready);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('AS-LIVE-001: the demo draws first and starts R when the chart first asks; the line waits, saying what the first start costs, and then prints Pearson’s coefficient, for everyone and within each arm, as desktop R gives it; the planted 0.6 is inside the printed interval (#26)', async ({}, testInfo) => {
    // The chart is on the page, on the view the demo opens on.
    expect(await page.evaluate(() => window.BioVizDemo.chart.view())).toEqual({
      ...OPENING,
      x: { ...OPENING.x, value: 'raw' },
      y: { ...OPENING.y, value: 'raw' }
    });
    expect(await page.evaluate(() => window.BioVizDemo.chart.charts.length)).toBe(1);
    const { expected, differing } = await holdToDesktop('pearson-by-arm', testInfo);
    expect(differing).toEqual([]);
    expect(expected.method).toBe("Pearson's product-moment correlation");

    // What the line read, in order: waiting, with the page's note on the cost
    // of the first start, and then R's answer. No number before R's.
    const log = await lineLog();
    expect(log[0]).toEqual([
      'waiting',
      'Statistics: waiting for R… The first statistic starts R in this browser: about 13 MB to download, once, and a few seconds.'
    ]);
    expect(log.map(([state]) => state)).toEqual(['waiting', 'shown']);
    expect(log[0][1]).not.toMatch(/p [=<>]|0\.\d/);
    await expect(coefficient(page).locator('p')).toHaveText([
      "Pearson's product-moment correlation: p < 0.001 (n = 200). Exploratory, unadjusted.",
      'Pearson’s r: 0.6384, 95% confidence interval 0.5482 to 0.7139.',
      'This coefficient is of the 200 participants drawn. It takes every level of Arm together; ' +
        'the table gives each level its own, and they are not adjusted for one another.'
    ]);
    await expect(coefficient(page).locator('table tbody tr')).toHaveText([
      'Placebo1000.5918 (0.4474 to 0.7061)p < 0.001',
      'Treatment1000.6737 (0.5501 to 0.7684)p < 0.001'
    ]);
    await expect(line(page)).not.toContainText('*');
    await expect(line(page)).not.toContainText(/significan/i);
    // The correlation the study was planted with is inside the interval the
    // page prints, and inside the one R returned to it.
    const printed = await coefficient(page).locator('.bv-stat-estimate').textContent();
    const [, low, high] = printed.match(/confidence interval (\S+) to (\S+)\.$/).map(Number);
    expect(low).toBeLessThan(0.6);
    expect(high).toBeGreaterThan(0.6);
    const [returned] = (await asked('coefficient')).answer.value.estimates;
    expect(returned.lower).toBeLessThan(0.6);
    expect(returned.upper).toBeGreaterThan(0.6);

    // R was started once, from the pinned version on its public host, and
    // given gsm.bio's statistics file as this site publishes it.
    const forR = finished.filter((request) => isRFile(request.url)).map((request) => request.url);
    expect(forR.filter((url) => url.endsWith('/webr.mjs'))).toEqual([
      'https://webr.r-wasm.org/v0.6.0/webr.mjs'
    ]);
    expect(forR.filter((url) => url.endsWith('/statistics.R'))).toEqual([
      new URL('/_site/vendor/gsm.bio/statistics.R', page.url()).href
    ]);
    // No R package was installed: the file needs none to be sourced.
    expect(forR.filter((url) => new URL(url).hostname === 'repo.r-wasm.org')).toEqual([]);

    // The cost of that first start, kept for AS-LIVE-007.
    const times = await page.evaluate(() =>
      ['waiting', 'shown'].map(
        (state) =>
          window.__line.find((entry) => entry.part === 'coefficient' && entry.state === state).at
      )
    );
    const files = finished.filter((request) => isRFile(request.url));
    measured.cold = {
      megabytes: megabytes(files.reduce((total, file) => total + file.bytes, 0)),
      bytes: files.reduce((total, file) => total + file.bytes, 0),
      requests: files.length,
      seconds: Number(((times[1] - times[0]) / 1000).toFixed(3)),
      files
    };
  });

  test('AS-LIVE-002: Spearman’s coefficient, overall and within each arm, is the one desktop R gives; where R’s own answer differs between the two versions both are recorded and nothing else differs (#26)', async ({}, testInfo) => {
    const before = finished.filter((request) => isRFile(request.url)).length;
    await clearLineLog();
    await choose(page, 'method', 'spearman');
    const { expected, actual, differing } = await holdToDesktop('spearman-by-arm', testInfo);
    // R was not started again: nothing more was fetched for it.
    expect(finished.filter((request) => isRFile(request.url))).toHaveLength(before);
    expect((await lineLog()).map(([state]) => state)).toEqual(['waiting', 'shown']);
    expect((await lineLog())[0][1]).toBe(WAITING);

    // Every number agrees. What differs is R's own wording of one warning,
    // which changed between the desktop's version and the browser's: the same
    // sentence, with its first letter in another case. Both are recorded, and
    // nothing else may differ.
    const worded = /^(warnings\[\d+\]|rows\[\d+\]\.warning)$/;
    expect(differing.filter((row) => !worded.test(row.path))).toEqual([]);
    for (const row of differing) {
      expect(typeof row.expected).toBe('string');
      expect(row.actual.toLowerCase()).toBe(row.expected.toLowerCase());
      differences.push({
        case: 'spearman-by-arm',
        where: row.path,
        desktop: row.expected,
        browser: row.actual
      });
    }
    // The page prints the warning as the R that answered worded it.
    const warned = actual.warnings.map((said) => `R warned: ${said}`);
    await expect(coefficient(page).locator('.bv-stat-remark[data-kind="warning"]')).toHaveText(
      warned
    );
    expect(warned).toHaveLength(expected.warnings.length);
    expect(actual.estimates[0].name).toBe('rho');
    expect(actual.estimates[0].lower).toBe(null);
    await expect(coefficient(page).locator('.bv-stat-result')).toHaveText(
      "Spearman's rank correlation rho: p < 0.001 (n = 200). Exploratory, unadjusted."
    );
    await expect(coefficient(page).locator('.bv-stat-estimate')).toHaveText(
      `Spearman’s rho: ${Number(expected.estimates[0].estimate.toPrecision(4))}.`
    );
    await expect(coefficient(page)).not.toContainText('confidence interval 0');
    await expect(coefficient(page).locator('table thead th')).toHaveText([
      'Arm',
      'n',
      'Spearman’s rho',
      'p'
    ]);
    await expect(coefficient(page).locator('table tbody tr th')).toHaveText([
      /^Placebo/,
      /^Treatment/
    ]);
    await expect(coefficient(page).locator('.bv-stat-remark[data-kind="note"]')).toHaveText(
      "R’s note: cor.test() gives no confidence interval for Spearman's rho, so none is reported."
    );
    await choose(page, 'method', 'pearson');
    await answered();
  });

  test('AS-LIVE-003: the linear fit’s slope, intercept, their intervals and every point of the line and its band, overall and within each arm, are the ones desktop R gives, and the lines drawn are those points (#26)', async ({}, testInfo) => {
    const { expected, actual, differing, compared } = await holdToDesktop(
      'linear-by-arm',
      testInfo
    );
    expect(differing).toEqual([]);
    // Three lines of fifty points, each with its fit and its band, and six
    // coefficients with their intervals: every one of them was compared.
    expect(actual.rows.filter((row) => row.x !== null)).toHaveLength(150);
    expect(
      compared.filter((row) => /^rows\[\d+\]\.(x|fit|lower|upper)$/.test(row.path))
    ).toHaveLength(600);
    expect(
      compared.filter((row) => /^estimates\[\d+\]\.(estimate|lower|upper)$/.test(row.path))
    ).toHaveLength(18);
    await expect(fitted(page).locator('p').first()).toHaveText(
      'Linear regression: p < 0.001 (n = 200). Exploratory, unadjusted.'
    );
    await expect(fitted(page).locator('.bv-stat-estimate')).toHaveText([
      'Slope: 0.3275, 95% confidence interval 0.2721 to 0.3828.',
      'Intercept: 2.028, 95% confidence interval 1.356 to 2.7.',
      'R-squared: 0.4075.'
    ]);
    await expect(fitted(page).locator('table tbody tr')).toHaveText([
      'Placebo1000.3034 (0.2205 to 0.3862)2.333 (1.305 to 3.361)p < 0.001',
      'Treatment1000.3474 (0.271 to 0.4238)1.785 (0.8783 to 2.692)p < 0.001'
    ]);
    // What is drawn is what R in this browser returned, point for point.
    const lines = await page.evaluate(() => window.BioVizDemo.chart.charts[0].$fit);
    expect(lines.map((entry) => entry.group)).toEqual([null, 'Placebo', 'Treatment']);
    for (const entry of lines) {
      const rows = actual.rows.filter((row) => row.group === entry.group);
      expect(entry.curve).toEqual(rows.map((row) => ({ x: row.x, y: row.fit })));
      expect(entry.lower).toEqual(rows.map((row) => ({ x: row.x, y: row.lower })));
      expect(entry.upper).toEqual(rows.map((row) => ({ x: row.x, y: row.upper })));
    }
    // And with no colour: the one line of every point, with its band.
    await choose(page, 'color-by', '');
    const plain = await holdToDesktop('linear', testInfo);
    expect(plain.differing).toEqual([]);
    expect(await page.evaluate(() => window.BioVizDemo.chart.charts[0].$fit.length)).toBe(1);
    expect((await holdToDesktop('pearson', testInfo)).differing).toEqual([]);
    expect(expected.estimates).toHaveLength(6);
  });

  test('AS-LIVE-004: the smooth’s curve and band are the ones desktop R gives, and no p-value is printed for it (#26)', async ({}, testInfo) => {
    await choose(page, 'fit', 'smooth');
    const plain = await holdToDesktop('smooth', testInfo);
    expect(plain.differing).toEqual([]);
    expect(plain.actual.p_value).toBe(null);
    await choose(page, 'color-by', 'ARM');
    const { actual, differing, compared } = await holdToDesktop('smooth-by-arm', testInfo);
    expect(differing).toEqual([]);
    expect(
      compared.filter((row) => /^rows\[\d+\]\.(x|fit|lower|upper)$/.test(row.path))
    ).toHaveLength(600);
    await expect(fitted(page).locator('.bv-stat-result')).toHaveText(
      'Local polynomial regression (loess): the curve and its band are R’s (n = 200).'
    );
    await expect(fitted(page)).not.toContainText(/p [=<>]/);
    await expect(fitted(page).locator('.bv-stat-estimate')).toHaveCount(0);
    const lines = await page.evaluate(() => window.BioVizDemo.chart.charts[0].$fit);
    expect(lines).toHaveLength(3);
    expect(lines[0].curve).toEqual(
      actual.rows.filter((row) => row.group === null).map((row) => ({ x: row.x, y: row.fit }))
    );
  });

  test('AS-LIVE-005: with both axes logarithmic Pearson’s coefficient and the linear fit are those of the logarithms, as desktop R gives them, and the line says which scale they were computed on (#26)', async ({}, testInfo) => {
    await setView({
      ...OPENING,
      x: { measure: 'CRP', visit: 'Baseline' },
      y: { measure: 'IFN-gamma', visit: 'Baseline' },
      color_by: null,
      x_scale: 'log',
      y_scale: 'log'
    });
    const coefficientOfLogs = await holdToDesktop('pearson-log', testInfo);
    expect(coefficientOfLogs.differing).toEqual([]);
    const lineOfLogs = await holdToDesktop('linear-log', testInfo);
    expect(lineOfLogs.differing).toEqual([]);
    const scale =
      'Both axes are logarithmic: R was given the base-10 logarithm of CRP at Baseline (mg/L) ' +
      'and the base-10 logarithm of IFN-gamma at Baseline (pg/mL).';
    await expect(coefficient(page).locator('.bv-stat-remark[data-kind="scale"]')).toHaveText(
      `${scale} Pearson’s coefficient is of the values as plotted, not of the values themselves.`
    );
    await expect(fitted(page).locator('.bv-stat-remark[data-kind="scale"]')).toHaveText(
      `${scale} The line is fitted to the values as plotted, so it is straight on these axes, ` +
        'and its slope and intercept are of the logarithms.'
    );
    // The line drawn is R's points, each put back on its axis's own scale. The
    // two are compared in the page: a power of ten, like a logarithm, is not
    // the same to the last binary place in every engine.
    const placed = await page.evaluate(() => {
      const { chart } = window.BioVizDemo;
      const [line] = chart.charts[0].$fit;
      const { rows } = chart.statistics().find((entry) => entry.kind === 'fit').answer.value;
      const same = (points, member) =>
        points.every(
          (point, index) => point.x === 10 ** rows[index].x && point.y === 10 ** rows[index][member]
        );
      return {
        lines: chart.charts[0].$fit.length,
        points: line.curve.length,
        rows: rows.length,
        curve: same(line.curve, 'fit'),
        lower: same(line.lower, 'lower'),
        upper: same(line.upper, 'upper')
      };
    });
    expect(placed).toEqual({
      lines: 1,
      points: 50,
      rows: 50,
      curve: true,
      lower: true,
      upper: true
    });
    expect(lineOfLogs.actual.rows).toHaveLength(50);
    expect((await drawn(page, 'demo'))[0].x.type).toBe('logarithmic');
    // The same pair on linear axes is another question, with another answer.
    await setView({ x_scale: 'linear', y_scale: 'linear' });
    const linear = await holdToDesktop('pearson-skewed', testInfo);
    expect(linear.differing).toEqual([]);
    expect(linear.actual.estimates[0].estimate).not.toBe(
      coefficientOfLogs.actual.estimates[0].estimate
    );
    await expect(coefficient(page).locator('.bv-stat-remark[data-kind="scale"]')).toHaveCount(0);
  });

  test('AS-LIVE-006: a filter change shows the waiting state and then the new result, and never the old one; a level with too few pairs, and a view with too few, print R’s reason and no number (#26)', async ({}, testInfo) => {
    await setView(OPENING);
    await answered();
    await expect(coefficient(page).locator('.bv-stat-result')).toContainText('(n = 200)');
    await clearLineLog();
    await page.locator('select[data-filter="SEX"]').selectOption('F');
    const women = await holdToDesktop('pearson-women', testInfo);
    expect(women.differing).toEqual([]);
    await expect(coefficient(page).locator('.bv-stat-scope')).toHaveText(
      'This coefficient is of the 91 participants drawn. It takes every level of Arm together; ' +
        'the table gives each level its own, and they are not adjusted for one another. ' +
        'Filters: Sex is F.'
    );
    // From the moment of the change: waiting, then the answer for the 91. The
    // answer for the 200 is not on the line at any point after it.
    const log = await lineLog();
    expect(log.map(([state]) => state)).toEqual(['waiting', 'shown']);
    expect(log[0][1]).toBe(WAITING);
    for (const [, text] of log) expect(text).not.toContain('n = 200');
    await page.locator('select[data-filter="SEX"]').selectOption('__all__');

    // The demo's filters, and one more: age, where one arm has two
    // participants aged 57.
    await page.evaluate(() => {
      const { chart, associationScatter } = window.BioVizDemo;
      chart.setSettings({
        filters: associationScatter.settings.filters.concat([{ value_col: 'AGE', label: 'Age' }])
      });
    });
    await page.locator('select[data-filter="AGE"]').selectOption('57');
    const oneArm = await holdToDesktop('pearson-age-57-by-arm', testInfo);
    expect(oneArm.differing).toEqual([]);
    expect((await holdToDesktop('linear-age-57-by-arm', testInfo)).differing).toEqual([]);
    expect(oneArm.actual.rows.map((row) => row.status)).toEqual(['ok', 'too_small']);
    await expect(coefficient(page).locator('table tbody tr').nth(1)).toHaveText(
      'Treatment2Not computed: 2 complete pairs. The minimum is 5. Counts: n = 2.'
    );
    // The arm R could not fit has no line: the one of all nine, and Placebo's.
    expect(
      await page.evaluate(() => window.BioVizDemo.chart.charts[0].$fit.map((entry) => entry.group))
    ).toEqual([null, 'Placebo']);

    // Four participants aged 35: too few for a coefficient, or for a line.
    await choose(page, 'color-by', '');
    await page.locator('select[data-filter="AGE"]').selectOption('35');
    const few = await holdToDesktop('pearson-age-35', testInfo);
    expect(few.differing).toEqual([]);
    expect(few.actual.status).toBe('too_small');
    expect((await holdToDesktop('linear-age-35', testInfo)).differing).toEqual([]);
    await expect(coefficient(page)).toHaveAttribute('data-state', 'withheld');
    await expect(coefficient(page).locator('p')).toHaveText([
      'Not computed: 4 complete pairs. The minimum is 5. Counts: n = 4.',
      'This coefficient is of the 4 participants drawn. Filters: Age is 35.'
    ]);
    await expect(fitted(page).locator('.bv-stat-result')).toHaveText(
      'The linear fit is not drawn. Not computed: 4 complete pairs. The minimum is 5. Counts: n = 4.'
    );
    await expect(line(page)).not.toContainText(/p [=<>]/);
    expect(await page.evaluate(() => window.BioVizDemo.chart.charts[0].$fit)).toBe(null);
    expect((await drawn(page, 'demo'))[0].points).toBe(4);
    await page.locator('select[data-filter="AGE"]').selectOption('__all__');
  });

  test('AS-LIVE-007: the megabytes and seconds of the first statistic are measured, recorded where a reader of the run can find them, and are what the page tells its reader (#26)', async ({
    browser
  }, testInfo) => {
    // What the page says the first start costs, and the number behind it.
    const told = await page.evaluate(() => window.BioVizDemo.associationScatter);
    expect(told.settings.waiting_note).toContain(`about ${told.megabytes} MB`);
    expect(told.browser).toEqual({ sourceUrl: '../vendor/gsm.bio/statistics.R', packages: [] });
    // Nothing was cached, and what came over the network is what the page said.
    expect(measured.cold.megabytes).toBeGreaterThan(5);
    expect(Math.abs(measured.cold.megabytes - told.megabytes)).toBeLessThan(1.5);
    expect(measured.cold.seconds).toBeGreaterThan(0);

    const record = {
      recorded: new Date().toISOString(),
      browser: `Chromium ${browser.version()}, headless`,
      machine:
        process.env.R_CHECK_MACHINE ||
        (process.env.CI ? 'a GitHub Actions runner (ubuntu-latest)' : 'not named'),
      profile: 'a new, empty browser profile with a disk cache',
      sizes:
        'compressed bytes of response bodies as received over the network; response headers are not counted',
      firstStatistic: {
        megabytes: measured.cold.megabytes,
        bytes: measured.cold.bytes,
        requests: measured.cold.requests,
        seconds: measured.cold.seconds,
        secondsAre:
          'from the moment the line first read that it was waiting to the moment it printed R’s coefficient'
      },
      tolerance: `1 part in 10^${Math.round(-Math.log10(TOLERANCE.relative))}`,
      desktopR: statistics.made_by,
      answers: sideBySide,
      differencesBetweenVersions: differences,
      files: measured.cold.files
    };
    const text = JSON.stringify(record, null, 2) + '\n';
    await testInfo.attach('association-scatter-measurements.json', {
      body: text,
      contentType: 'application/json'
    });
    mkdirSync(new URL('../../test-results/', import.meta.url), { recursive: true });
    writeFileSync(
      new URL('../../test-results/association-scatter-measurements.json', import.meta.url),
      text
    );

    console.log(
      `\nAssociation scatter demo, first statistic — ${record.browser}, ${record.machine}`
    );
    console.log(
      `  ${record.firstStatistic.megabytes} MB over the network in ${record.firstStatistic.requests} ` +
        `requests, ${record.firstStatistic.seconds} s from waiting to R's coefficient`
    );
    for (const file of measured.cold.files) {
      console.log(`  ${String(file.bytes).padStart(9)} bytes  ${file.url}`);
    }
    console.log(
      `\nDesktop R ${statistics.made_by.r_version} beside R in the browser, tolerance ${record.tolerance}`
    );
    for (const entry of sideBySide) {
      console.log(
        `  ${entry.case.padEnd(22)} p_value desktop ${String(entry.p_value.desktop).padEnd(24)} ` +
          `browser ${String(entry.p_value.browser).padEnd(24)} ${entry.numbersCompared} numbers, ` +
          `greatest relative difference among those that agree ` +
          `${entry.greatestRelativeDifference.toExponential(2)}, ${entry.differing.length} differing`
      );
      for (const [
        index,
        [name, group, estimate, lower, upper]
      ] of entry.estimates.desktop.entries()) {
        const [, , inBrowser, lowerInBrowser, upperInBrowser] =
          entry.estimates.browser[index] || [];
        console.log(
          `      ${`${name}${group ? ` (${group})` : ''}`.padEnd(22)} desktop ${estimate} ` +
            `(${lower} to ${upper})  browser ${inBrowser} (${lowerInBrowser} to ${upperInBrowser})`
        );
      }
    }
    for (const difference of differences) {
      console.log(
        `  R's own answer differs between the versions, ${difference.case} ${difference.where}: ` +
          `desktop ${difference.desktop}, browser ${difference.browser}`
      );
    }
    // Every case was compared: both coefficients, each arm's, both fitted
    // lines, the logarithmic axes, a filter, and too few pairs.
    expect(sideBySide.map((entry) => entry.case)).toEqual([
      'pearson-by-arm',
      'spearman-by-arm',
      'linear-by-arm',
      'linear',
      'pearson',
      'smooth',
      'smooth-by-arm',
      'pearson-log',
      'linear-log',
      'pearson-skewed',
      'pearson-women',
      'pearson-age-57-by-arm',
      'linear-age-57-by-arm',
      'pearson-age-35',
      'linear-age-35'
    ]);
  });

  test('AS-LIVE-008: on a phone the demo prints R’s coefficient, its table per arm and the fitted line’s, and the page does not scroll sideways (#26)', async () => {
    // The page as a phone opens it: loaded at that width, where the controls
    // start folded away. R is started again, from the files the browser kept.
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
    await expect(page.locator('.sv-root')).toHaveClass(/sv-collapsed/);
    // While it waits, with the note on what the first start costs, and after.
    expect((await lineLog())[0][0]).toBe('waiting');
    expect(await measure()).toEqual(holds);
    await answered();
    await expect(coefficient(page).locator('.bv-stat-estimate')).toHaveText(
      'Pearson’s r: 0.6384, 95% confidence interval 0.5482 to 0.7139.'
    );
    await expect(coefficient(page).locator('table tbody tr')).toHaveCount(2);
    await expect(fitted(page).locator('table tbody tr')).toHaveCount(2);
    await expect(fitted(page).locator('.bv-stat-estimate').first()).toHaveText(
      'Slope: 0.3275, 95% confidence interval 0.2721 to 0.3828.'
    );
    expect(await page.evaluate(() => window.BioVizDemo.chart.charts[0].$fit.length)).toBe(3);
    expect(await measure()).toEqual(holds);
    const overflowing = await page.evaluate(() =>
      [...document.querySelectorAll('#demo .bv-statistic, #demo .bv-statistic *')]
        .filter((element) => element.getBoundingClientRect().right > 390.5)
        .map((element) => element.tagName.toLowerCase())
    );
    expect(overflowing).toEqual([]);
    await line(page).scrollIntoViewIfNeeded();
    await captureEvidence(page.locator('#demo'), 'AS-LIVE-008', 'r-in-the-browser-on-a-phone');
  });
});

test.describe('association scatter: the filter rules safety.viz’s charts follow', () => {
  test('AS-FILTER-004: a filter reads its spec by safety.viz’s rule: `start` opens it with All still offered, only `all: false` removes All and its first value is then in force, a value the data lacks falls back to All with a warning, and the chart filters by what the controls show (#37)', async ({
    page
  }) => {
    const warnings = warningsOf(page);
    await open(page, { settings: { filters: RULED_FILTERS } });
    await expectFilterRules(page, warnings, () => ({ ...window.__as.chart.state.filters }));
  });
});

// ---- What the v0.1.0-RC1 review found (#49) ---------------------------------------

test.describe('association scatter: what the v0.1.0-RC1 review found', () => {
  test('AS-STAT-021: once the connection is replaced, a late answer from the old one changes neither the line nor what chart.statistics() reports (#49)', async ({
    page
  }) => {
    await expectReplacedConnectionDead(page, 'as');
  });

  test('AS-FAIL-001: when drawing fails the chart says so in its element and keeps its controls, leaving nothing half drawn, and draws again once it can (#49)', async ({
    page
  }) => {
    await expectFailureSaid(page, 'as', (name) => window[name].chart.charts.length);
  });

  test('AS-DROP-001: with a participant table, participants it does not have and rows with no participant id are counted by reason; a participant table without the id column is refused with a sentence that names it (#49)', async ({
    page
  }) => {
    await expectDropsCounted(page, 'as');
  });

  test('AS-DROP-002: with results the participant table does not have and filters that let nobody through, the chart says that nobody passes the filters (#49)', async ({
    page
  }) => {
    await expectNobodyWithOrphans(page, 'as');
  });

  test('AS-DROP-003: a setting naming a participant id column the participant table does not have is refused with the same sentence, and the chart stays as it was (#49)', async ({
    page
  }) => {
    await expectSettingsRefused(page, 'as');
  });

  test('AS-DROP-004: the participant table and the setting that names its id column change together, with setData(tables, settings), and the chart draws (#52)', async ({
    page
  }) => {
    await expectTablesAndSettingsTogether(page, 'as');
  });
});
