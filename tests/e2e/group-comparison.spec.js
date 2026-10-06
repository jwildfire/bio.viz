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
import { captureEvidence, captureGallery } from './evidence.js';
import { RULED_FILTERS, expectFilterRules, warningsOf } from './filterRules.js';
import { NOBODY_PASSES, asked, expectNobody, letNobodyThrough, openDemo } from './nobody.js';
import { parseCsv } from '../../src/shared/csv.js';
import { readPng } from '../../src/shared/png.js';
import { pixelsOf } from './pngPixels.js';

// The group comparison chart in a real page (#9, #16): safety.viz's vendored
// bundle and bio.viz's committed bundle, loaded as two script tags, drawing the
// vendored synthetic study.
//
// Every group but the last reaches no network and runs no R: the statistics
// line is asked of a connection with no R attached, of a stand-in for R whose
// answers arrive when the test says, or of results desktop R stored. The last
// group, "live", is the opposite: it opens the gallery's demo and runs real R
// from webR's public CDN.

const readJson = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const fromR = readJson('../fixtures/group-comparison-r.json');
// What desktop R answered for the rows the chart hands R, each with the key the
// chart asks with (tools/r-group-statistics.R). No number below was typed.
const statistics = readJson('../fixtures/group-statistics-r.json');
const resultOf = (name) => statistics.results.find((result) => result.case === name);
const stored = (...names) =>
  names.map(resultOf).map(({ name, args, dataId, rows, value }) => ({
    name,
    args,
    dataId,
    rows,
    value
  }));
const kitRecord = readJson('../../site/vendor/safety.viz/SOURCE.json');
const statisticsRecord = readJson('../../site/vendor/gsm.bio/SOURCE.json');
const FIXTURE = '/tests/e2e/fixtures/group-comparison.html';
const R_HOSTS = ['webr.r-wasm.org', 'repo.r-wasm.org'];
const isRHost = (url) => R_HOSTS.includes(new URL(url).hostname);

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
async function open(page, { data = 'both', settings = null, before = null } = {}) {
  if (before) await page.addInitScript(before);
  if (settings) {
    await page.addInitScript((given) => {
      window.__gcSettings = given;
    }, settings);
  }
  await page.goto(`${FIXTURE}?data=${data}`);
  await page.evaluate(() => window.__gc.ready);
}

// What the chart drew, read from the chart itself: one entry per panel.
const drawn = (page) =>
  page.evaluate(() =>
    window.__gc.chart.charts.map((chart) => ({
      title: chart.$panel.title,
      ticks: chart.scales.x.ticks.map((tick) => tick.label),
      cells: chart.$panel.cells.map((cell) => ({
        level: cell.level,
        color: cell.color,
        n: cell.n,
        median: cell.stats.median,
        q25: cell.stats.q25,
        q75: cell.stats.q75
      })),
      points: chart.data.datasets.reduce((total, dataset) => total + dataset.data.length, 0),
      yType: chart.scales.y.type,
      yTitle: chart.options.scales.y.title.text,
      legend: chart.legend.legendItems.map((item) => item.text),
      plugins: chart.config.plugins.map((plugin) => plugin.id.replace(/-[a-z0-9]+$/, ''))
    }))
  );

// Sets a sidebar <select> by its control name and waits for the redraw.
async function choose(page, control, value) {
  await page.locator(`.sv-sidebar select[data-control="${control}"]`).selectOption(value);
}

// Where a cell's median is on the page, to click it.
async function cellPoint(page, level, color = null, panel = 0) {
  return page.evaluate(
    ({ level, color, panel }) => {
      const chart = window.__gc.chart.charts[panel];
      const cell = chart.$panel.cells.find((c) => c.level === level && c.color === color);
      const box = chart.canvas.getBoundingClientRect();
      return {
        x: box.left + chart.scales.x.getPixelForValue(cell.x),
        y: box.top + chart.scales.y.getPixelForValue(cell.stats.median)
      };
    },
    { level, color, panel }
  );
}

async function clickCell(page, level, color = null, panel = 0) {
  const canvas = page.locator('.bv-group-comparison canvas').nth(panel);
  await canvas.scrollIntoViewIfNeeded();
  const point = await cellPoint(page, level, color, panel);
  await page.mouse.click(point.x, point.y);
}

// The page's width against the viewport's. The fixture page has a margin, so the
// document is measured, not its body.
const layout = (page) =>
  page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
const HOLDS = { viewport: 390, scrollWidth: 390 };

test.describe('group comparison: the page and the two bundles', () => {
  test('GC-KIT-004: the chart is built from safety.viz’s kit on the page, and draws with the kit’s Chart.js, not one of its own (#9)', async ({
    page
  }) => {
    const errors = watch(page);
    const requests = [];
    page.on('request', (request) => requests.push(new URL(request.url()).pathname));
    await open(page);

    const found = await page.evaluate(() => ({
      kitMembers: Object.keys(window.SafetyViz.kit).length,
      reconciles: typeof window.SafetyViz.kit.reconcileFilters,
      kitFrozen: Object.isFrozen(window.SafetyViz.kit),
      chartVersion: window.SafetyViz.kit.Chart.version,
      drawsWithKit: window.__gc.chart.charts.every(
        (chart) => chart instanceof window.SafetyViz.kit.Chart
      ),
      charts: window.__gc.chart.charts.length,
      ownChart: 'Chart' in window.BioViz,
      globalChart: typeof window.Chart,
      root: document.querySelector('#chart > .sv-root').className
    }));
    // 36 since bio.viz#37: the kit from safety.viz dev adds reconcileFilters.
    expect(found.kitMembers).toBe(36);
    expect(found.reconciles).toBe('function');
    expect(found.kitFrozen).toBe(true);
    expect(found.chartVersion).toBe('4.5.1');
    expect(found.charts).toBe(1);
    expect(found.drawsWithKit).toBe(true);
    expect(found.ownChart).toBe(false);
    expect(found.globalChart).toBe('undefined');
    // safety.viz's shell, with this chart's class on it.
    expect(found.root).toBe('sv-root bv-group-comparison');
    // The two bundles are two files, each asked for once.
    const scripts = requests.filter((path) => path.endsWith('.js'));
    expect(scripts.filter((path) => path === '/site/vendor/safety.viz/safety.viz.js')).toHaveLength(
      1
    );
    expect(scripts.filter((path) => path.startsWith('/dist/bio.viz-'))).toHaveLength(1);
    expect(kitRecord.files[0].file).toBe('safety.viz.js');
    expect(errors).toEqual([]);
  });

  test('GC-KIT-005: without safety.viz on the page the chart says what is missing instead of failing somewhere else (#9)', async ({
    page
  }) => {
    await page.goto('/tests/e2e/fixtures/index.html');
    const message = await page.evaluate(() => {
      try {
        window.BioViz.groupComparison(document.body, {});
        return 'made';
      } catch (error) {
        return error.message;
      }
    });
    expect(message).toMatch(
      /^bio\.viz: the group comparison chart is built from safety\.viz's kit, and `SafetyViz\.kit` was not found\./
    );
  });
});

test.describe('group comparison: what is drawn', () => {
  test('GC-DRAW-001: a box per group, with the number in each group beneath, and the quartiles R gives (#9)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page);
    const [panel] = await drawn(page);
    // IL-6 change from Baseline to Week 4 by arm: 186 participants.
    expect(panel.ticks).toEqual([
      ['Placebo', 'n = 95'],
      ['Treatment', 'n = 91']
    ]);
    expect(panel.yTitle).toBe('IL-6 at Week 4, change from baseline (pg/mL)');
    expect(panel.plugins).toContain('gc-boxwhisker');
    // What the page drew is what desktop R says of the same cells.
    const expected = fromR.comparisons[0].cells;
    panel.cells.forEach((cell, index) => {
      expect(cell.n).toBe(expected[index].n);
      for (const key of ['q25', 'median', 'q75']) {
        expect(cell[key]).toBeCloseTo(expected[index][key], 10);
      }
    });
    await expect(page.locator('.sv-notes')).toContainText('186 of 200 participants drawn.');
    await expect(page.locator('.sv-notes')).toContainText('13 left out: No result at the visit.');
    await expect(page.locator('.sv-notes')).toContainText(
      '1 left out: Result at the visit is missing or not a number.'
    );
    await expect(page.locator('.sv-chart-wrap canvas')).toHaveAttribute(
      'aria-label',
      'IL-6 at Week 4, change from baseline (pg/mL): Placebo n = 95; Treatment n = 91'
    );
    expect(errors).toEqual([]);
    await captureEvidence(page.locator('.sv-main'), 'GC-DRAW-001', 'boxes-by-arm');
    // The gallery's picture: the chart's frame titled as its demo is, with its
    // footnotes and its own last (#66).
    await page.evaluate(
      ({ results, ...titles }) =>
        window.__gc.chart.setSettings({
          ...titles,
          connection: window.BioViz.r.createConnection({ results })
        }),
      {
        results: stored('welch'),
        title: '{value}: {measure} by {group}',
        subtitle: 'At {visits}',
        footnotes: [
          'Synthetic study from gsm.bio: no real participant is shown.',
          'Filters: {filters}.'
        ]
      }
    );
    await captureGallery(page.locator('#chart .sv-main'), 'GC-DRAW-001');
  });

  test('GC-DRAW-002: a violin per group, drawn by a plugin on the kit’s Chart.js (#9)', async ({
    page
  }) => {
    await open(page);
    await choose(page, 'mark', 'violin');
    const [panel] = await drawn(page);
    expect(panel.plugins).toContain('gc-violin');
    expect(panel.plugins).not.toContain('gc-boxwhisker');
    expect(panel.ticks.map((tick) => tick[1])).toEqual(['n = 95', 'n = 91']);
    const outline = await page.evaluate(() =>
      window.__gc.chart.charts[0].$panel.cells.map((cell) => ({
        points: cell.density.at.length,
        from: cell.density.at[0],
        to: cell.density.at[63],
        min: cell.stats.min,
        max: cell.stats.max
      }))
    );
    for (const cell of outline) {
      expect(cell.points).toBe(64);
      expect(cell.from).toBe(cell.min);
      expect(cell.to).toBeCloseTo(cell.max, 12);
    }
    await expect(page.locator('.sv-footnote')).toHaveText(
      'Click a violin to list its participants.'
    );
    await captureEvidence(page.locator('.sv-chart-wrap'), 'GC-DRAW-002', 'violins-by-arm');
  });

  test('GC-DRAW-003: points, one per participant, each in its group’s place (#9)', async ({
    page
  }) => {
    await open(page);
    await choose(page, 'mark', 'points');
    const [panel] = await drawn(page);
    expect(panel.points).toBe(186);
    const places = await page.evaluate(() => {
      const chart = window.__gc.chart.charts[0];
      return chart.data.datasets[0].data.map((point) => ({
        offset: Math.abs(point.x - point.cell.x),
        half: point.cell.halfWidth,
        id: point.record.USUBJID,
        y: point.y,
        value: point.record.y
      }));
    });
    expect(places.every((point) => point.offset <= point.half)).toBe(true);
    expect(places.every((point) => point.y === point.value)).toBe(true);
    expect(new Set(places.map((point) => point.id)).size).toBe(186);
    await captureEvidence(page.locator('.sv-chart-wrap'), 'GC-DRAW-003', 'points-by-arm');
  });

  test('GC-DRAW-004: a second grouping by colour draws the colours side by side, with a legend and the count in each (#9)', async ({
    page
  }) => {
    await open(page, { settings: { value_type: 'raw' } });
    await choose(page, 'color-by', 'SEX');
    const [panel] = await drawn(page);
    expect(panel.legend).toEqual(['F', 'M']);
    expect(panel.ticks).toEqual([
      ['Placebo', 'n = 95', '42 · 53'],
      ['Treatment', 'n = 91', '42 · 49']
    ]);
    expect(panel.cells.map((cell) => [cell.level, cell.color, cell.n])).toEqual([
      ['Placebo', 'F', 42],
      ['Placebo', 'M', 53],
      ['Treatment', 'F', 42],
      ['Treatment', 'M', 49]
    ]);
    const expected = fromR.comparisons[1].cells;
    panel.cells.forEach((cell, index) =>
      expect(cell.median).toBeCloseTo(expected[index].median, 10)
    );
    await captureEvidence(page.locator('.sv-chart-wrap'), 'GC-DRAW-004', 'colour-by-sex');
  });

  test('GC-DRAW-005: panels by one further variable, and by visit, each a chart of its own on one value axis (#9)', async ({
    page
  }) => {
    await open(page);
    await choose(page, 'panel-by', 'SEX');
    let panels = await drawn(page);
    expect(panels.map((panel) => panel.title)).toEqual(['F', 'M']);
    expect(panels.map((panel) => panel.cells.map((cell) => cell.n))).toEqual([
      [42, 42],
      [53, 49]
    ]);
    await expect(page.locator('.bv-panel h3')).toHaveText(['F', 'M']);
    await expect(page.locator('.bv-panel .bv-panel-note')).toHaveText([
      '84 participants drawn.',
      '102 participants drawn.'
    ]);
    // The single chart gives way to the panels.
    await expect(page.locator('.sv-chart-wrap')).toBeHidden();
    const axes = await page.evaluate(() =>
      window.__gc.chart.charts.map((chart) => [chart.scales.y.min, chart.scales.y.max])
    );
    expect(axes[0]).toEqual(axes[1]);

    // A second visit: each visit is a panel, crossed with the panel variable.
    await page.locator('[data-control="visits"] summary').click();
    await page.locator('[data-control="visits"] input[value="Week 12"]').check();
    panels = await drawn(page);
    expect(panels.map((panel) => panel.title)).toEqual([
      'Week 4 · F',
      'Week 4 · M',
      'Week 12 · F',
      'Week 12 · M'
    ]);
    await captureEvidence(page.locator('.sv-multiples'), 'GC-DRAW-005', 'panels-by-visit-and-sex');
  });

  test('GC-DRAW-006: a logarithmic scale, with values of zero or less left out and counted (#9)', async ({
    page
  }) => {
    await open(page, { settings: { value_type: 'raw' } });
    await choose(page, 'y-scale', 'log');
    let [panel] = await drawn(page);
    expect(panel.yType).toBe('logarithmic');
    expect(panel.ticks.map((tick) => tick[1])).toEqual(['n = 95', 'n = 91']);
    await expect(page.locator('.sv-notes')).not.toContainText('logarithmic scale cannot show');

    // A change from baseline is often below zero: those are left out, and said to be.
    await choose(page, 'value-type', 'change');
    [panel] = await drawn(page);
    const kept = panel.cells.reduce((total, cell) => total + cell.n, 0);
    expect(kept).toBeLessThan(186);
    await expect(page.locator('.sv-notes')).toContainText(
      `${186 - kept} left out: zero or less, which a logarithmic scale cannot show.`
    );
    const least = await page.evaluate(() => window.__gc.chart.charts[0].scales.y.min);
    expect(least).toBeGreaterThan(0);
  });
});

test.describe('group comparison: controls', () => {
  test('GC-CTRL-005: the biomarker, the value type and the visit are chosen in the sidebar, and the chart follows (#9)', async ({
    page
  }) => {
    await open(page);
    // Every biomarker, after the entry for all of them (#17).
    await expect(page.locator('select[data-control="measure"] option')).toHaveCount(13);
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('IL-6');
    await expect(page.locator('select[data-control="value-type"] option')).toHaveText([
      'Result',
      'Baseline',
      'Change from baseline',
      'Fold change from baseline',
      'Percent change from baseline'
    ]);

    await choose(page, 'measure', 'TNF-alpha');
    await choose(page, 'value-type', 'raw');
    await page.locator('[data-control="visits"] summary').click();
    await page.locator('[data-control="visits"] input[value="Week 12"]').check();
    await page.locator('[data-control="visits"] input[value="Week 4"]').uncheck();
    await choose(page, 'group-by', 'RESPONSE');
    const [panel] = await drawn(page);
    expect(panel.yTitle).toBe('TNF-alpha at Week 12 (pg/mL)');
    // TNF-alpha at Week 12 by response, as desktop R has it.
    const expected = fromR.comparisons[2].cells;
    expect(panel.cells.map((cell) => [cell.level, cell.n])).toEqual(
      expected.map((cell) => [cell.level, cell.n])
    );
    panel.cells.forEach((cell, index) =>
      expect(cell.median).toBeCloseTo(expected[index].median, 10)
    );

    // A baseline value has no visit, so the Visit control goes.
    await choose(page, 'value-type', 'baseline');
    await expect(page.locator('[data-control="visits"]')).toHaveCount(0);
    expect((await drawn(page))[0].yTitle).toBe('TNF-alpha at baseline (pg/mL)');
    await expect(page.locator('.sv-notes')).toContainText('200 of 200 participants drawn.');
  });

  test('GC-CTRL-006: the levels of the group are chosen in the sidebar, and a level left out is not drawn (#9)', async ({
    page
  }) => {
    await open(page);
    await choose(page, 'group-by', 'RESPONSE');
    expect((await drawn(page))[0].ticks.map((tick) => tick[0])).toEqual([
      'Non-responder',
      'Responder'
    ]);
    await page.locator('[data-control="levels"] summary').click();
    await page.locator('[data-control="levels"] input[value="Non-responder"]').uncheck();
    const [panel] = await drawn(page);
    expect(panel.ticks.map((tick) => tick[0])).toEqual(['Responder']);
    await expect(page.locator('.sv-notes')).toContainText('1 of 2 levels shown.');
  });

  test('GC-CTRL-007: Reset chart returns every control to what the chart opened on (#9)', async ({
    page
  }) => {
    await open(page);
    const opening = await drawn(page);
    await choose(page, 'measure', 'CRP');
    await choose(page, 'mark', 'points');
    await choose(page, 'color-by', 'SEX');
    await page.locator('select[data-filter="SEX"]').selectOption('F');
    expect(await drawn(page)).not.toEqual(opening);
    await page.locator('.sv-reset').click();
    expect(await drawn(page)).toEqual(opening);
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('IL-6');
    await expect(page.locator('select[data-filter="SEX"]')).toHaveValue('__all__');
  });
});

test.describe('group comparison: with and without participant data', () => {
  test('GC-FILTER-001: loaded with the results table alone it draws and shows no filters, and a group comes from a column on the results rows (#9)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page, { data: 'results-with-arm' });
    const loaded = await page.evaluate(() => ({
      tables: Object.keys(window.__gc.data),
      columns: Object.keys(window.__gc.data.results[0])
    }));
    expect(loaded.tables).toEqual(['results']);
    expect(loaded.columns).toContain('ARM');

    const [panel] = await drawn(page);
    expect(panel.ticks).toEqual([
      ['Placebo', 'n = 95'],
      ['Treatment', 'n = 91']
    ]);
    // The same boxes as with the participant table.
    const expected = fromR.comparisons[0].cells;
    panel.cells.forEach((cell, index) =>
      expect(cell.median).toBeCloseTo(expected[index].median, 10)
    );

    await expect(page.locator('.sv-section-title')).toHaveText([
      'Value',
      'Groups',
      'Display',
      'Statistics'
    ]);
    await expect(page.locator('.sv-sidebar [data-filter]')).toHaveCount(0);
    await expect(page.locator('select[data-control="group-by"] option')).toHaveText(['ARM']);
    expect(errors).toEqual([]);
  });

  test('GC-FILTER-002: the synthetic results as vendored carry no group column: the chart says so, and draws everyone as one group (#9)', async ({
    page
  }) => {
    await open(page, { data: 'results' });
    await expect(page.locator('.sv-sidebar [data-filter]')).toHaveCount(0);
    await expect(page.locator('select[data-control="group-by"]')).toHaveCount(0);
    await expect(page.locator('.bv-no-groups')).toHaveText(
      'No column can make a group. Give a participant table, or carry a column on the results rows.'
    );
    const [panel] = await drawn(page);
    expect(panel.ticks).toEqual([['All participants', 'n = 186']]);
  });

  test('GC-FILTER-003: loaded with participant data it shows filters and offers participant-level variables (#9)', async ({
    page
  }) => {
    await open(page);
    await expect(page.locator('.sv-section-title')).toHaveText([
      'Value',
      'Groups',
      'Display',
      'Statistics',
      'Filters'
    ]);
    await expect(page.locator('.sv-sidebar select[data-filter]')).toHaveCount(3);
    for (const control of ['group-by', 'color-by', 'panel-by']) {
      const offered = await page
        .locator(`select[data-control="${control}"] option`)
        .allTextContents();
      expect(offered.filter((text) => text !== 'None')).toEqual(['ARM', 'SEX', 'RESPONSE']);
    }
    await expect(page.locator('select[data-filter="SEX"] option')).toHaveText(['All', 'F', 'M']);
  });

  test('GC-FILTER-004: a filter narrows the participants drawn, and the counts beneath follow (#9)', async ({
    page
  }) => {
    await open(page);
    await page.locator('select[data-filter="SEX"]').selectOption('F');
    let [panel] = await drawn(page);
    expect(panel.ticks).toEqual([
      ['Placebo', 'n = 42'],
      ['Treatment', 'n = 42']
    ]);
    await expect(page.locator('.sv-notes')).toContainText(
      '91 of 200 participants pass the filters.'
    );
    await expect(page.locator('.sv-notes')).toContainText('84 of 91 participants drawn.');
    await page.locator('select[data-filter="RESPONSE"]').selectOption('Responder');
    [panel] = await drawn(page);
    const total = panel.cells.reduce((sum, cell) => sum + cell.n, 0);
    expect(total).toBeLessThan(84);
    await page.locator('select[data-filter="SEX"]').selectOption('__all__');
    await page.locator('select[data-filter="RESPONSE"]').selectOption('__all__');
    [panel] = await drawn(page);
    expect(panel.ticks.map((tick) => tick[1])).toEqual(['n = 95', 'n = 91']);
  });
});

test.describe('group comparison: listing and participant profile', () => {
  test('GC-LIST-001: clicking a box lists its participants in the kit’s record listing (#9)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page);
    await expect(page.locator('.sv-listing table')).toHaveCount(0);
    await clickCell(page, 'Treatment');
    await expect(page.locator('.sv-listing-actions strong')).toHaveText('91 of 91 records');
    await expect(page.locator('.sv-listing thead th')).toHaveText(['Participant', 'ARM', 'Value']);
    await expect(page.locator('.sv-listing tbody tr')).toHaveCount(10);
    await expect(page.locator('.sv-footnote')).toContainText('Treatment: 91 participants listed.');
    // Every row is a participant of that box: the listed ids are the cell's.
    const listed = await page.evaluate(() => ({
      rows: window.__gc.chart.host.currentTableData.map((row) => row.USUBJID),
      cell: window.__gc.chart.charts[0].$panel.cells[1].records.map((record) => record.USUBJID),
      arms: [...new Set(window.__gc.chart.host.currentTableData.map((row) => row.x))]
    }));
    expect(listed.rows).toEqual(listed.cell);
    expect(listed.arms).toEqual(['Treatment']);
    // The kit's own search and paging work on it.
    await page.locator('.sv-listing-search').fill('BIO-01');
    const matching = listed.rows.filter((id) => id.includes('BIO-01')).length;
    await expect(page.locator('.sv-listing-actions strong')).toHaveText(
      `${matching} of 91 records`
    );
    // Another box replaces the list.
    await clickCell(page, 'Placebo');
    await expect(page.locator('.sv-listing-actions strong')).toHaveText('95 of 95 records');
    expect(errors).toEqual([]);
    await captureEvidence(page.locator('.sv-listing'), 'GC-LIST-001', 'participants-of-a-box');
  });

  test('GC-LIST-002: a control or a filter change empties the listing, so it never lists a box that is no longer drawn (#9)', async ({
    page
  }) => {
    await open(page);
    await clickCell(page, 'Placebo');
    await expect(page.locator('.sv-listing table')).toHaveCount(1);
    await page.locator('select[data-filter="SEX"]').selectOption('M');
    await expect(page.locator('.sv-listing table')).toHaveCount(0);
    await expect(page.locator('.sv-footnote')).toHaveText('Click a box to list its participants.');
  });

  test('GC-LIST-003: the listing’s export downloads the listed rows under this chart’s name (#9)', async ({
    page
  }) => {
    await open(page);
    await clickCell(page, 'Treatment');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export: CSV' }).click()
    ]);
    expect(download.suggestedFilename()).toBe('bio.viz-group-comparison-listing.csv');
    const text = readFileSync(await download.path(), 'utf8');
    // Written by RFC 4180 (#67): records end in CRLF, and a field is quoted
    // only when it must be.
    const lines = text.trimEnd().split('\r\n');
    expect(lines[0]).toBe('Participant,ARM,Value');
    expect(lines).toHaveLength(92);
    expect(lines[1]).toMatch(/^BIO-\d{3},Treatment,-?\d/);
  });

  test('GC-PROF-001: a listing row opens safety.viz’s participant profile through the participantsSelected event (#9)', async ({
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
    await clickCell(page, 'Placebo');
    const first = page.locator('.sv-listing tbody tr').first();
    const id = await first.locator('td').first().textContent();
    await first.click();

    // The event safety.viz's charts raise, heard outside the chart.
    expect(await page.evaluate(() => window.__selected)).toEqual([[id]]);
    await expect(page.locator('.sv-listing tbody tr').first()).toHaveClass(
      /sv-listing-row-selected/
    );

    // The rail: the participant, their own columns, and their biomarkers.
    const rail = page.locator('.sv-rail');
    await expect(rail).toBeVisible();
    await expect(rail.locator('.sv-profile-id')).toHaveText(`Participant ${id}`);
    const details = await rail.locator('.sv-profile-details li').allInnerTexts();
    expect(details.map((text) => text.split('\n')[0].toUpperCase())).toEqual([
      'ARM',
      'SEX',
      'RESPONSE',
      'R RATIO'
    ]);
    expect(details[0]).toContain('Placebo');
    await expect(
      rail.locator(
        'table[aria-label="Measure summary"] tbody tr.sv-profile-measure-row, table[aria-label="Measure summary"] tbody tr'
      )
    ).not.toHaveCount(0);
    await expect(rail.locator('.sv-profile-measure-name')).toHaveCount(12);
    // No reference range is claimed: results are shown against the first result only.
    await expect(rail.locator('.sv-profile-display option')).toHaveText([
      'Multiple of first result'
    ]);
    const railCharts = await page.evaluate(
      () => document.querySelectorAll('.sv-rail canvas').length
    );
    expect(railCharts).toBeGreaterThan(0);

    // Clear, in the rail, clears the selection in the chart too.
    await rail.locator('.sv-profile-clear').click();
    await expect(rail).toBeHidden();
    await expect(page.locator('.sv-listing-row-selected')).toHaveCount(0);
    expect(await page.evaluate(() => window.__selected)).toEqual([[id], []]);
    expect(errors).toEqual([]);
  });

  test('GC-LIST-004: clicking a point lists its participant and opens their profile (#9)', async ({
    page
  }) => {
    await open(page);
    await choose(page, 'mark', 'points');
    const target = await page.evaluate(() => {
      const chart = window.__gc.chart.charts[0];
      const point = chart.data.datasets[0].data[7];
      const box = chart.canvas.getBoundingClientRect();
      return {
        id: point.record.USUBJID,
        x: box.left + chart.scales.x.getPixelForValue(point.x),
        y: box.top + chart.scales.y.getPixelForValue(point.y)
      };
    });
    await page.mouse.click(target.x, target.y);
    await expect(page.locator('.sv-listing-actions strong')).toHaveText('1 of 1 records');
    await expect(page.locator('.sv-listing tbody td').first()).toHaveText(target.id);
    await expect(page.locator('.sv-rail .sv-profile-id')).toHaveText(`Participant ${target.id}`);
  });
});

// A stand-in for R whose answers arrive when the test says so, in the shape
// gsm.bio's Analyze_GroupDifference returns. The counts are the ones in the
// rows it was handed, so a line can be told from the line for other rows.
const stubR = () => {
  window.__r = { calls: [] };
  window.__r.engine = {
    start: () => Promise.resolve(),
    call: (name, request) =>
      new Promise((resolve) => {
        const counts = {};
        request.data.forEach((row) => {
          counts[row.x] = (counts[row.x] || 0) + 1;
        });
        // For a row of visits: the counts of each group at each visit.
        const byVisit = {};
        if (request.args.strByCol) {
          request.data.forEach((row) => {
            const at = (byVisit[row.visit] = byVisit[row.visit] || {});
            at[row.x] = (at[row.x] || 0) + 1;
          });
        }
        window.__r.calls.push({
          name,
          rows: request.data.length,
          args: request.args,
          fields: Object.keys(request.data[0]),
          counts,
          byVisit,
          resolve
        });
      })
  };
  const METHODS = {
    t: 'Welch Two Sample t-test',
    wilcoxon: 'Wilcoxon rank sum test with continuity correction',
    anova: 'One-way analysis of variance',
    kruskal: 'Kruskal-Wallis rank sum test'
  };
  window.__r.answer = (index, p) => {
    const call = window.__r.calls[index];
    call.resolve({
      status: 'ok',
      reason: null,
      test: call.args.strMethod,
      method: METHODS[call.args.strMethod],
      estimates: [],
      p_value: p,
      adjustment: 'none',
      counts: call.counts,
      warnings: [],
      notes: [],
      rows: []
    });
  };
  // An answer for a row of visits, in the shape gsm.bio's
  // Analyze_GroupDifferenceBy returns: a row per visit asked about, each with
  // the p-value the test gives it, unadjusted, and the adjustment it was asked
  // for by name. The stand-in adjusts nothing.
  window.__r.answerVisits = (index, ps) => {
    const call = window.__r.calls[index];
    const groups = Object.keys(call.counts).sort();
    const visits = call.args.chrBy;
    call.resolve({
      status: 'ok',
      reason: null,
      test: call.args.strMethod,
      method: METHODS[call.args.strMethod],
      estimates: [],
      statistic: [],
      p_value: null,
      adjustment: 'none',
      counts: Object.fromEntries(
        visits.map((visit) => [
          visit,
          Object.values(call.byVisit[visit] || {}).reduce((total, n) => total + n, 0)
        ])
      ),
      dropped: [],
      warnings: [],
      notes: [],
      rows: visits.map((visit, at) => ({
        by: visit,
        ...Object.fromEntries(groups.map((group, k) => [`group_${k + 1}`, group])),
        ...Object.fromEntries(
          groups.map((group, k) => [`n_${k + 1}`, (call.byVisit[visit] || {})[group] || 0])
        ),
        method: METHODS[call.args.strMethod],
        p_unadjusted: ps[at],
        p_value: ps[at],
        adjustment: call.args.strPAdjust,
        adjusted_over: visits.length,
        status: 'ok',
        reason: null,
        warning: null
      }))
    });
  };
};

// Gives the chart a connection whose R is the stand-in.
const attachStub = (page) =>
  page.evaluate(() => {
    window.__gc.chart.setSettings({
      connection: window.BioViz.r.createConnection({ browser: { engine: window.__r.engine } })
    });
  });
const calls = (page) =>
  page.evaluate(() =>
    window.__r.calls.map(({ name, rows, args, fields, counts }) => ({
      name,
      rows,
      args,
      fields,
      counts
    }))
  );
const WAITING = 'Statistics: waiting for R…';

test.describe('group comparison: the statistics line', () => {
  test('GC-STAT-006: with no R attached the statistics line reads that statistics are unavailable (#9)', async ({
    page
  }) => {
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await open(page);
    const line = page.locator('.sv-main > .bv-statistic');
    await expect(line).toHaveText('Statistics are unavailable: no R is attached to this chart.');
    await expect(line).toHaveAttribute('data-state', 'unavailable');
    // In every panel, when there are panels.
    await choose(page, 'panel-by', 'SEX');
    await expect(page.locator('.bv-panel .bv-statistic')).toHaveText([
      'Statistics are unavailable: no R is attached to this chart.',
      'Statistics are unavailable: no R is attached to this chart.'
    ]);
    // Nothing was fetched to say so: no R, and no webR.
    expect(requests.filter((url) => /webr|r-wasm/.test(url))).toEqual([]);
  });

  test('GC-STAT-007: the line shows that it is waiting until R answers, and then prints the answer through the shared formatter (#9)', async ({
    page
  }) => {
    await open(page, { before: stubR });
    await attachStub(page);
    const line = page.locator('.sv-main > .bv-statistic');
    await expect(line).toHaveText(WAITING);
    await expect(line).toHaveAttribute('data-state', 'waiting');
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(1);
    // R is asked about the rows that are drawn, by the names of their fields,
    // for the test the chart opens on.
    expect((await calls(page))[0]).toEqual({
      name: 'Analyze_GroupDifference',
      rows: 186,
      args: { strValueCol: 'y', strGroupCol: 'x', strMethod: 't', bPairwise: false },
      fields: ['USUBJID', 'y', 'x'],
      counts: { Placebo: 95, Treatment: 91 }
    });
    await page.evaluate(() => window.__r.answer(0, 0.0004));
    await expect(line.locator('.bv-stat-result')).toHaveText(
      'Welch Two Sample t-test: p < 0.001 (Placebo n = 95, Treatment n = 91). Exploratory, unadjusted.'
    );
    await expect(line).toHaveAttribute('data-state', 'shown');
    await expect(line.locator('.bv-stat-scope')).toHaveText(
      'This test compares the levels of ARM on the 186 participants drawn.'
    );
    await captureEvidence(
      page.locator('.sv-main > .bv-statistic'),
      'GC-STAT-007',
      'statistics-line'
    );
  });

  test('GC-STAT-008: a filter change clears the line before asking again, and an answer for the rows before the change is never shown (#9)', async ({
    page
  }) => {
    await open(page, { before: stubR });
    await attachStub(page);
    const line = page.locator('.sv-main > .bv-statistic');
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(1);
    await page.evaluate(() => window.__r.answer(0, 0.03));
    await expect(line).toContainText('p = 0.030 (Placebo n = 95, Treatment n = 91)');

    // The filter changes: the answer for 186 rows goes at once.
    await page.locator('select[data-filter="SEX"]').selectOption('F');
    await expect(line).toHaveText(WAITING);
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(2);
    expect(await page.evaluate(() => window.__r.calls[1].rows)).toBe(84);

    // And changes again before R has answered: a third request, for all 186.
    await page.locator('select[data-filter="SEX"]').selectOption('__all__');
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(3);
    // The answer for the 84 rows arrives now, late. It is not shown.
    await page.evaluate(() => window.__r.answer(1, 0.5));
    await page.waitForTimeout(100);
    await expect(line).toHaveText(WAITING);
    // The answer for the rows on screen is.
    await page.evaluate(() => window.__r.answer(2, 0.03));
    await expect(line).toContainText('p = 0.030 (Placebo n = 95, Treatment n = 91)');
  });
});

test.describe('group comparison: the test R is asked for', () => {
  const testControl = 'select[data-control="test"]';
  const pairwise = 'input[data-control="pairwise"]';
  const offered = (page) => page.locator(`${testControl} option`).allTextContents();

  test('GC-STAT-026: the Test control offers only the tests that fit the number of groups drawn, and the pairwise switch is there only when there are pairs (#16)', async ({
    page
  }) => {
    await open(page, { data: 'arm-sex', before: stubR });
    await attachStub(page);
    // Two arms: the two-group tests, opening on the Welch t-test.
    expect(await offered(page)).toEqual(['Welch t-test', 'Wilcoxon rank-sum test', 'None']);
    await expect(page.locator(testControl)).toHaveValue('t');
    await expect(page.locator(pairwise)).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(1);
    expect((await calls(page))[0].args.strMethod).toBe('t');

    // Four groups: the several-group tests, and the t-test gives way to the
    // test of its kind, which is the one R is asked for.
    await choose(page, 'group-by', 'ARM_SEX');
    expect(await offered(page)).toEqual(['One-way ANOVA', 'Kruskal-Wallis test', 'None']);
    await expect(page.locator(testControl)).toHaveValue('anova');
    await expect(page.locator(pairwise)).toBeVisible();
    await expect(page.locator(pairwise)).not.toBeChecked();
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(2);
    expect((await calls(page))[1].args).toEqual({
      strValueCol: 'y',
      strGroupCol: 'x',
      strMethod: 'anova',
      bPairwise: false
    });

    // A rank test chosen among four groups stays a rank test among two.
    await choose(page, 'test', 'kruskal');
    await choose(page, 'group-by', 'ARM');
    await expect(page.locator(testControl)).toHaveValue('wilcoxon');
    expect((await calls(page)).at(-1).args.strMethod).toBe('wilcoxon');

    // Two of the four levels are two groups: the two-group tests again.
    await choose(page, 'group-by', 'ARM_SEX');
    await page.locator('[data-control="levels"] summary').click();
    await page.locator('[data-control="levels"] input[value="Placebo M"]').uncheck();
    expect(await offered(page)).toEqual(['One-way ANOVA', 'Kruskal-Wallis test', 'None']);
    await page.locator('[data-control="levels"] input[value="Treatment M"]').uncheck();
    expect(await offered(page)).toEqual(['Welch t-test', 'Wilcoxon rank-sum test', 'None']);
    await expect(page.locator(pairwise)).toBeHidden();
    expect((await calls(page)).at(-1)).toMatchObject({
      rows: 84,
      args: { strMethod: 'wilcoxon', bPairwise: false },
      counts: { 'Placebo F': 42, 'Treatment F': 42 }
    });
    // No test R was sent was one the control did not offer for its groups.
    for (const call of await calls(page)) {
      const groups = Object.keys(call.counts).length;
      expect(groups === 2 ? ['t', 'wilcoxon'] : ['anova', 'kruskal']).toContain(
        call.args.strMethod
      );
    }
  });

  test('GC-STAT-027: with one group drawn, or no test chosen, R is not asked, and the line says why (#16)', async ({
    page
  }) => {
    await open(page, { before: stubR });
    await attachStub(page);
    const line = page.locator('.sv-main > .bv-statistic');
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(1);

    // One level left: nothing to compare, and nothing fits.
    await page.locator('[data-control="levels"] summary').click();
    await page.locator('[data-control="levels"] input[value="Placebo"]').uncheck();
    await expect(line).toHaveText(
      'Statistics: no test. A test compares two or more groups, and only Treatment has values.'
    );
    await expect(line).toHaveAttribute('data-state', 'none');
    await expect(page.locator(testControl)).toBeDisabled();
    expect(await offered(page)).toEqual(['None: a test needs two or more groups']);
    await page.locator('[data-control="levels"] input[value="Placebo"]').check();
    await expect(page.locator(testControl)).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(2);

    // None chosen: the line says so, and R is not asked.
    await choose(page, 'test', 'none');
    await expect(line).toHaveText('Statistics: no test chosen.');
    await choose(page, 'mark', 'violin');
    await page.locator('select[data-filter="SEX"]').selectOption('F');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.__r.calls.length)).toBe(2);
    expect(await page.evaluate(() => window.__gc.chart.statistics())).toEqual([]);

    // A panel with one group has no test, and says so for itself; the panel
    // beside it is tested.
    await choose(page, 'test', 't');
    await page.locator('select[data-filter="SEX"]').selectOption('__all__');
    await choose(page, 'panel-by', 'ARM');
    await expect(page.locator('.bv-panel .bv-statistic')).toHaveText([
      'Statistics: no test in this panel. A test compares two or more groups, and only Placebo has values here.',
      'Statistics: no test in this panel. A test compares two or more groups, and only Treatment has values here.'
    ]);

    // With no column to group by there is no test either.
    await open(page, { data: 'results', before: stubR });
    await attachStub(page);
    await expect(line).toHaveText(
      'Statistics: no test. A test compares two or more groups, and no column makes a group.'
    );
    await expect(page.locator(testControl)).toBeDisabled();
    expect(await page.evaluate(() => window.__r.calls.length)).toBe(0);
  });

  test('GC-STAT-028: a change to the test, the pairwise switch, a filter or a variable each clears the line and asks R again, and the answer to the question before is never shown (#16)', async ({
    page
  }) => {
    await open(page, { data: 'arm-sex', before: stubR, settings: { group_by: 'ARM_SEX' } });
    await attachStub(page);
    const line = page.locator('.sv-main > .bv-statistic');
    const result = line.locator('.bv-stat-result');
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(1);
    await page.evaluate(() => window.__r.answer(0, 0.011));
    await expect(result).toContainText('One-way analysis of variance: p = 0.011 (Placebo F n = 42');

    // Each change in turn: the line goes back to waiting at once, R is asked
    // for what is now on screen, and the answer before is not printed when it
    // comes late.
    const changes = [
      {
        what: 'the test',
        make: () => choose(page, 'test', 'kruskal'),
        asked: { rows: 186, args: { strMethod: 'kruskal', bPairwise: false } },
        prints: 'Kruskal-Wallis rank sum test: p = 0.022'
      },
      {
        what: 'the pairwise switch',
        make: () => page.locator(pairwise).check(),
        asked: { rows: 186, args: { strMethod: 'kruskal', bPairwise: true } },
        prints: 'Kruskal-Wallis rank sum test: p = 0.022'
      },
      {
        what: 'a filter',
        make: () => page.locator('select[data-filter="RESPONSE"]').selectOption('Responder'),
        asked: { rows: 67, args: { strMethod: 'kruskal', bPairwise: true } },
        prints: 'Kruskal-Wallis rank sum test: p = 0.022 (Placebo F n = 12'
      },
      {
        what: 'the biomarker',
        make: () => choose(page, 'measure', 'CRP'),
        asked: { args: { strMethod: 'kruskal', bPairwise: true } },
        prints: 'Kruskal-Wallis rank sum test: p = 0.022'
      },
      {
        what: 'the value type',
        make: () => choose(page, 'value-type', 'raw'),
        asked: { args: { strMethod: 'kruskal', bPairwise: true } },
        prints: 'Kruskal-Wallis rank sum test: p = 0.022'
      },
      {
        what: 'the group',
        make: () => choose(page, 'group-by', 'ARM'),
        asked: { args: { strMethod: 'wilcoxon', bPairwise: false } },
        prints: 'Wilcoxon rank sum test with continuity correction: p = 0.022 (Placebo n ='
      }
    ];
    let asked = 1;
    for (const change of changes) {
      // The line holds an answer; a second question is left unanswered behind it.
      await change.make();
      await expect(line, change.what).toHaveText(WAITING);
      await expect(line, change.what).toHaveAttribute('data-state', 'waiting');
      await expect
        .poll(() => page.evaluate(() => window.__r.calls.length), { message: change.what })
        .toBe(asked + 1);
      expect((await calls(page))[asked], change.what).toMatchObject(change.asked);
      // Drawn again before R answers: one more question, for the same view.
      await page.evaluate(() => window.__gc.chart.render());
      await expect
        .poll(() => page.evaluate(() => window.__r.calls.length), { message: change.what })
        .toBe(asked + 2);
      // The first of the two answers late, with a number that would be wrong here.
      await page.evaluate((index) => window.__r.answer(index, 0.999), asked);
      await page.waitForTimeout(50);
      await expect(line, change.what).toHaveText(WAITING);
      await page.evaluate((index) => window.__r.answer(index, 0.022), asked + 1);
      await expect(result, change.what).toContainText(change.prints);
      await expect(line, change.what).not.toContainText('0.999');
      asked += 2;
    }
  });

  test('GC-STAT-029: each panel asks R for itself, on its own rows, and is answered for itself (#16)', async ({
    page
  }) => {
    // One biomarker at two visits: two panels.
    await open(page, {
      before: stubR,
      settings: { start_value: 'IL-6', visits: ['Week 4', 'Week 12'] }
    });
    await attachStub(page);
    const lines = page.locator('.bv-panel .bv-statistic');
    await expect(lines).toHaveText([WAITING, WAITING]);
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(2);
    expect((await calls(page)).map((call) => [call.rows, call.counts])).toEqual([
      [186, { Placebo: 95, Treatment: 91 }],
      [184, { Placebo: 92, Treatment: 92 }]
    ]);
    // Each panel's request names its own visit, and nothing else differs.
    const asked = await page.evaluate(() => window.__gc.chart.statistics());
    expect(asked.map((entry) => [entry.panel, entry.dataId.visit, entry.rows])).toEqual([
      ['Week 4', 'Week 4', 186],
      ['Week 12', 'Week 12', 184]
    ]);
    expect({ ...asked[0].dataId, visit: 'Week 12' }).toEqual(asked[1].dataId);
    expect(asked[0].args).toEqual(asked[1].args);
    expect(asked.map((entry) => entry.answer)).toEqual([null, null]);
    // They are the keys desktop R wrote for the same two panels.
    expect(asked[0].dataId).toEqual(resultOf('welch').dataId);
    expect(asked[1].dataId).toEqual(resultOf('welch-week-12').dataId);

    // The second panel is answered first: it prints, and the first still waits.
    await page.evaluate(() => window.__r.answer(1, 0.04));
    await expect(lines.nth(1).locator('.bv-stat-result')).toHaveText(
      'Welch Two Sample t-test: p = 0.040 (Placebo n = 92, Treatment n = 92). Exploratory, unadjusted.'
    );
    await expect(lines.nth(0)).toHaveText(WAITING);
    await page.evaluate(() => window.__r.answer(0, 0.2));
    await expect(lines.nth(0).locator('.bv-stat-result')).toHaveText(
      'Welch Two Sample t-test: p = 0.200 (Placebo n = 95, Treatment n = 91). Exploratory, unadjusted.'
    );
    await expect(lines.nth(0).locator('.bv-stat-scope')).toHaveText(
      'This test compares the levels of ARM on the 186 participants drawn in this panel (Week 4). ' +
        'Each panel has a test of its own, and they are not adjusted for one another.'
    );
    // A colour is not part of a panel's test, and the line says so; the rows are the same.
    await choose(page, 'color-by', 'SEX');
    await expect(lines).toHaveText([WAITING, WAITING]);
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(4);
    expect((await calls(page)).slice(2).map((call) => call.rows)).toEqual([186, 184]);
    await page.evaluate(() => window.__r.answer(2, 0.2));
    await expect(lines.nth(0).locator('.bv-stat-scope')).toContainText(
      'Colour by SEX is not part of it: each level of ARM is tested whole.'
    );
  });
});

test.describe('group comparison: R’s answers, stored with the page', () => {
  // The chart on the demo's tables, with what the demo opens on stated, and a
  // connection that holds desktop R's answers and has no R to ask.
  async function openStored(page, cases, settings = {}, { rows = true } = {}) {
    await open(page, {
      data: 'arm-sex',
      settings: {
        start_value: 'IL-6',
        visits: 'Week 4',
        value_type: 'change',
        baseline_visits: 'Baseline',
        group_by: 'ARM',
        ...settings
      }
    });
    await page.evaluate(
      (results) => {
        window.__gc.chart.setSettings({
          connection: window.BioViz.r.createConnection({ results })
        });
      },
      stored(...cases).map((entry) => (rows ? entry : { ...entry, rows: undefined }))
    );
  }
  const NOT_STORED =
    'Statistics are unavailable for this view: the page holds no stored result for it, and no R is attached to compute one.';

  test('GC-STAT-030: a view R’s answer was stored for prints it with no R and no request, and a view it was not stored for reads unavailable, never another view’s numbers (#16)', async ({
    page
  }) => {
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    // Stored without the number of rows each was computed on, so that it is the
    // stated identity alone that tells one view from another here.
    await openStored(page, ['welch', 'welch-week-12'], {}, { rows: false });
    const line = page.locator('.sv-main > .bv-statistic');
    await expect(line.locator('.bv-stat-result')).toHaveText(
      'Welch Two Sample t-test: p < 0.001 (Placebo n = 95, Treatment n = 91). Exploratory, unadjusted.'
    );
    await expect(line.locator('.bv-stat-estimate')).toHaveText(
      'Difference in means (Placebo - Treatment): 1.235, 95% confidence interval 0.844 to 1.626.'
    );
    const [asked] = await page.evaluate(() => window.__gc.chart.statistics());
    expect(asked.answer).toEqual({
      status: 'ok',
      value: resultOf('welch').value,
      form: 'precomputed'
    });
    // The key the chart asked with is the key desktop R wrote.
    const { name, args, dataId, rows } = resultOf('welch');
    expect({ name: asked.name, args: asked.args, dataId: asked.dataId, rows: asked.rows }).toEqual({
      name,
      args,
      dataId,
      rows
    });

    // Every other view: unavailable, and the stored numbers are not on the page.
    const elsewhere = [
      () => choose(page, 'test', 'wilcoxon'),
      () => page.locator('select[data-filter="SEX"]').selectOption('F'),
      () => choose(page, 'color-by', 'SEX'),
      () => choose(page, 'measure', 'CRP'),
      () => choose(page, 'value-type', 'percent_change'),
      () => choose(page, 'y-scale', 'log'),
      () => choose(page, 'group-by', 'RESPONSE')
    ];
    for (const move of elsewhere) {
      await page.locator('.sv-reset').click();
      await expect(line.locator('.bv-stat-result')).toContainText('Welch Two Sample t-test');
      await move();
      await expect(line).toHaveText(NOT_STORED);
      await expect(line).toHaveAttribute('data-state', 'unavailable');
      await expect(line).not.toContainText('p <');
    }
    // Back on the view that was stored, its answer is printed again.
    await page.locator('.sv-reset').click();
    await expect(line.locator('.bv-stat-result')).toContainText('p < 0.001 (Placebo n = 95');

    // One biomarker at two visits is two panels, each with a stored result of
    // its own; a third visit that was not stored says so for itself.
    await page.locator('[data-control="visits"] summary').click();
    await page.locator('[data-control="visits"] input[value="Week 12"]').check();
    await page.locator('[data-control="visits"] input[value="Week 8"]').check();
    await expect(page.locator('.bv-panel h3')).toHaveText(['Week 4', 'Week 8', 'Week 12']);
    const panels = page.locator('.bv-panel .bv-statistic');
    await expect(panels.nth(0).locator('.bv-stat-result')).toContainText(
      '(Placebo n = 95, Treatment n = 91)'
    );
    await expect(panels.nth(1)).toHaveText(NOT_STORED);
    await expect(panels.nth(2).locator('.bv-stat-result')).toContainText(
      '(Placebo n = 92, Treatment n = 92)'
    );
    await expect(panels.nth(2).locator('.bv-stat-estimate')).toHaveText(
      'Difference in means (Placebo - Treatment): 1.419, 95% confidence interval 1.016 to 1.822.'
    );
    // Nothing was fetched for any of it.
    expect(requests.filter(isRHost)).toEqual([]);
  });

  test('GC-STAT-031: the line prints what R returned: the result, the difference in means, the pairwise table, R’s warnings and notes, and R’s reason for a group too small (#16)', async ({
    page
  }) => {
    await openStored(page, ['wilcoxon', 'kruskal-pairwise', 'welch-age-57'], {
      test: 'wilcoxon',
      pairwise: true,
      filters: ['ARM', 'SEX', 'RESPONSE', { value_col: 'AGE', label: 'Age' }]
    });
    const line = page.locator('.sv-main > .bv-statistic');
    await expect(line.locator('p')).toHaveText([
      'Wilcoxon rank sum test with continuity correction: p < 0.001 (Placebo n = 95, Treatment n = 91). Exploratory, unadjusted.',
      'Difference in means (Placebo - Treatment): 1.235, 95% confidence interval 0.844 to 1.626.',
      'R’s note: The difference in means and its interval are from t.test() (Welch), whatever the test.',
      'This test compares the levels of ARM on the 186 participants drawn.'
    ]);
    await expect(line.locator('table')).toHaveCount(0);

    // Four groups, pairs on: the table, with each pair's counts and adjusted p-value.
    await choose(page, 'group-by', 'ARM_SEX');
    await expect(line.locator('.bv-stat-result')).toHaveText(
      'Kruskal-Wallis rank sum test: p < 0.001 (Placebo F n = 42, Placebo M n = 53, Treatment F n = 42, Treatment M n = 49). Exploratory, unadjusted.'
    );
    const table = line.locator('table.bv-stat-pairs');
    await expect(table.locator('caption')).toHaveText(
      'Pairwise comparisons, each by the test named with it. Exploratory, adjusted (Holm).'
    );
    await expect(table.locator('thead th')).toHaveText(['Pair', 'n', 'p, adjusted (Holm)']);
    const expected = resultOf('kruskal-pairwise').value.rows;
    expect(
      await table
        .locator('tbody tr')
        .evaluateAll((rows) =>
          rows.map((row) => [...row.children].map((cell) => cell.firstChild.textContent))
        )
    ).toEqual([
      ['Placebo F and Placebo M', '42, 53', 'p > 0.999'],
      ['Placebo F and Treatment F', '42, 42', 'p = 0.006'],
      ['Placebo F and Treatment M', '42, 49', 'p < 0.001'],
      ['Placebo M and Treatment F', '53, 42', 'p = 0.002'],
      ['Placebo M and Treatment M', '53, 49', 'p < 0.001'],
      ['Treatment F and Treatment M', '42, 49', 'p > 0.999']
    ]);
    await expect(table.locator('tbody .bv-stat-method')).toHaveText(
      expected.map((row) => row.method)
    );
    await expect(line.locator('.bv-stat-remark')).toHaveText([
      'R warned: cannot compute exact p-value with ties',
      "R’s note: Pairwise: each pair is compared with wilcox.test(); p_value is adjusted across the pairs by p.adjust(method = 'holm'); the intervals are not adjusted."
    ]);
    await expect(line).not.toContainText('*');
    await expect(line).not.toContainText(/significan/i);

    // A group below the minimum size: R's reason, once, and no number.
    await page.locator('.sv-reset').click();
    await choose(page, 'test', 't');
    await page.locator('select[data-filter="AGE"]').selectOption('57');
    await expect(line.locator('p')).toHaveText([
      'Not computed: Treatment has 1. The minimum group size is 5. Counts: Placebo n = 7, Treatment n = 1.',
      'This test compares the levels of ARM on the 8 participants drawn. Filters: Age is 57.'
    ]);
    await expect(line).toHaveAttribute('data-state', 'withheld');
    await expect(line.locator('.bv-stat-result')).not.toContainText(/p [=<>]/);
  });

  test('GC-STAT-032: with a pairwise table under it the chart holds at a 390px-wide viewport, and the page does not scroll sideways (#16)', async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openStored(page, ['kruskal-pairwise'], {
      group_by: 'ARM_SEX',
      test: 'kruskal',
      pairwise: true
    });
    const line = page.locator('.sv-main > .bv-statistic');
    await expect(line.locator('table.bv-stat-pairs tbody tr')).toHaveCount(6);
    await line.scrollIntoViewIfNeeded();
    expect(await layout(page)).toEqual(HOLDS);
    const fit = await page.evaluate(() => {
      const within = (element) => {
        const box = element.getBoundingClientRect();
        return box.left >= 0 && box.right <= document.documentElement.clientWidth + 0.5;
      };
      const statistic = document.querySelector('.sv-main > .bv-statistic');
      return {
        line: within(statistic),
        table: within(statistic.querySelector('table')),
        cells: [...statistic.querySelectorAll('th, td, p, caption')].every(within),
        // The table is not scrolled inside a box either: all of it is on the page.
        clipped: statistic.scrollWidth > statistic.clientWidth
      };
    });
    expect(fit).toEqual({ line: true, table: true, cells: true, clipped: false });
    // The controls, opened: the test and the switch are there and usable.
    await page.locator('.sv-sidebar-toggle').click();
    await expect(page.locator('select[data-control="test"]')).toHaveValue('kruskal');
    await expect(page.locator('input[data-control="pairwise"]')).toBeChecked();
    expect(await layout(page)).toEqual(HOLDS);
    await page.locator('.sv-sidebar-toggle').click();
    await captureEvidence(line, 'GC-STAT-032', 'pairwise-table-on-a-phone');
  });
});

test.describe('group comparison: nothing is fetched until a test is asked for', () => {
  test('GC-STAT-033: with R attached and no test chosen the page asks for nothing; the first test chosen starts R, once (#16)', async ({
    page
  }) => {
    // R here is the stand-in module, served from this machine in webR's place.
    await page.addInitScript(() => {
      const leaf = (type, values, names = null) => ({ type, names, values });
      window.__fakeWebR = {
        evaluations: 0,
        instances: [],
        functions: {
          Analyze_GroupDifference: () => ({
            type: 'list',
            names: ['status', 'method', 'p_value', 'adjustment', 'counts'],
            values: [
              leaf('character', ['ok']),
              leaf('character', ['Welch Two Sample t-test']),
              leaf('double', [0.25]),
              leaf('character', ['none']),
              leaf('integer', [95, 91], ['Placebo', 'Treatment'])
            ]
          })
        }
      };
    });
    // The stand-in evaluates no R, so the file of functions it is given is a
    // stand-in too: what is watched is when it is asked for.
    await page.route('**/stand-in/statistics.R', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: '# no R is run here\n' })
    );
    const requests = [];
    page.on('request', (request) => requests.push(new URL(request.url()).pathname));
    const note = 'The first test starts R here.';
    await open(page, { settings: { test: 'none', waiting_note: note } });
    await page.evaluate(() => {
      window.__gc.chart.setSettings({
        connection: window.BioViz.r.createConnection({
          browser: {
            baseUrl: '/tests/e2e/fixtures/fake-webr',
            sourceUrl: '/stand-in/statistics.R'
          }
        })
      });
    });
    const line = page.locator('.sv-main > .bv-statistic');
    await expect(line).toHaveText(`Statistics: no test chosen. ${note}`);
    await expect(page.locator('select[data-control="test"]')).toHaveValue('none');

    // Drawn again and again with no test chosen: nothing is asked of R.
    await choose(page, 'mark', 'violin');
    await page.locator('select[data-filter="SEX"]').selectOption('F');
    await page.locator('select[data-filter="SEX"]').selectOption('__all__');
    await page.waitForTimeout(300);
    const forR = () => requests.filter((url) => /fake-webr|statistics\.R$/.test(url));
    expect(forR()).toEqual([]);
    expect(await page.evaluate(() => window.__fakeWebR.instances.length)).toBe(0);

    // The first test chosen: R is started, and its one file of functions fetched.
    await choose(page, 'test', 't');
    await expect(line.locator('.bv-stat-result')).toHaveText(
      'Welch Two Sample t-test: p = 0.250 (Placebo n = 95, Treatment n = 91). Exploratory, unadjusted.'
    );
    expect(forR()).toEqual(['/tests/e2e/fixtures/fake-webr/webr.mjs', '/stand-in/statistics.R']);
    // Another test, and another view: the same R, started once.
    await choose(page, 'test', 'wilcoxon');
    await page.locator('select[data-filter="SEX"]').selectOption('F');
    await expect(line.locator('.bv-stat-result')).toContainText('p = 0.250');
    expect(forR()).toHaveLength(2);
    expect(await page.evaluate(() => window.__fakeWebR.instances.length)).toBe(1);
    // R has answered: the note about starting it is gone from the texts.
    await choose(page, 'test', 'none');
    await expect(line).toHaveText('Statistics: no test chosen.');
  });
});

// The trend tiles (#84): what the chart opens on when no biomarker is named.
// The fixture page names IL-6 at Week 4, so these tests set both to null, which
// is what the settings default to.
const OVERVIEW = { start_value: null, visits: null, value_type: 'raw' };
const VISITS = ['Baseline', 'Week 2', 'Week 4', 'Week 8', 'Week 12'];
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
// safety.viz's palette: the first two groups' colours.
const COLOURS = ['#2563eb', '#059669'];
const openTiles = (page, { data = 'both', settings = {}, before = null } = {}) =>
  open(page, { data, before, settings: { ...OVERVIEW, ...settings } });

// The tiles as the page has them, and the chart drawn in each. `chart` names
// where the chart is: the fixture's, or the demo's.
const tilesOf = (page, chart = '__gc') =>
  page.evaluate((name) => {
    const text = (element) => (element ? element.textContent : null);
    const made = window[name].chart;
    return {
      level: made.root.dataset.level,
      tiles: [...made.root.querySelectorAll('.bv-tile')].map((tile) => ({
        measure: tile.dataset.measure,
        tag: tile.tagName,
        type: tile.type,
        label: tile.getAttribute('aria-label'),
        described: text(document.getElementById(tile.getAttribute('aria-describedby'))),
        name: text(tile.querySelector('.bv-tile-name')),
        range: text(tile.querySelector('.bv-tile-range')),
        visits: [...tile.querySelectorAll('.bv-tile-visits span')].map(text),
        canvases: tile.querySelectorAll('canvas').length,
        empty: text(tile.querySelector('.bv-tile-empty'))
      })),
      charts: made.charts.map((drawn) => ({
        measure: drawn.$measure,
        type: drawn.config.type,
        lines: drawn.data.datasets.map((dataset) => ({
          level: dataset.label,
          colour: dataset.borderColor,
          points: dataset.data.map((point) => [point.x, point.y])
        })),
        y: [drawn.scales.y.min, drawn.scales.y.max],
        yType: drawn.scales.y.type,
        visits: drawn.$tile.visits,
        events: drawn.options.events,
        withKit: drawn instanceof window.SafetyViz.kit.Chart
      })),
      key: [...made.root.querySelectorAll('.bv-tile-key > span')].map(text),
      caption: text(made.root.querySelector('.bv-tile-caption')),
      statistics: made.statistics(),
      lines: [...made.root.querySelectorAll('.bv-statistic')].map(text)
    };
  }, chart);
const tileChart = (found, measure) => found.charts.find((chart) => chart.measure === measure);

// One biomarker over time, as the page has it: the one chart, the table under
// it and the statistics line under that. `chart` names where the chart is.
const overTimeOf = (page, chart = '__gc') =>
  page.evaluate((name) => {
    const text = (element) => (element ? element.textContent : null);
    const made = window[name].chart;
    const { root } = made;
    const [drawn] = made.charts;
    const built = drawn && drawn.$overTime;
    const test = root.querySelector('.bv-time-table tr[data-row="test"]');
    const line = root.querySelector('.bv-time-line');
    return {
      level: root.dataset.level,
      charts: made.charts.length,
      withKit: Boolean(drawn) && drawn instanceof window.SafetyViz.kit.Chart,
      plugins: drawn
        ? drawn.config.plugins.map((plugin) => plugin.id.replace(/-[a-z0-9]{6,}$/, ''))
        : [],
      visits: built ? built.visits : null,
      tested: built ? built.tested : null,
      groups: drawn
        ? drawn.data.datasets.map((dataset) => ({
            level: dataset.label,
            colour: dataset.borderColor,
            joined: dataset.showLine,
            radius: dataset.pointRadius,
            points: dataset.data.map((point) => ({
              visit: point.column.visit,
              x: point.x,
              y: point.y,
              lower: point.made.lower,
              upper: point.made.upper
            }))
          }))
        : [],
      cells: built
        ? built.columns.map((column) => ({
            visit: column.visit,
            at: column.at,
            cells: column.cells.map((cell) => ({
              level: cell.level,
              x: cell.x,
              n: cell.n,
              se: cell.se,
              ...cell.stats
            }))
          }))
        : [],
      y: drawn ? [drawn.scales.y.min, drawn.scales.y.max] : null,
      yType: drawn ? drawn.scales.y.type : null,
      yTitle: drawn ? drawn.options.scales.y.title.text : null,
      label: drawn ? drawn.canvas.getAttribute('aria-label') : null,
      key: [...root.querySelectorAll('.bv-time-key > span')].map(text),
      caption: text(root.querySelector('.bv-time-caption')),
      heads: [...root.querySelectorAll('.bv-time-table thead th[data-visit]')].map((cell) => ({
        visit: cell.dataset.visit,
        button: Boolean(cell.querySelector('button')),
        label: cell.querySelector('button')
          ? cell.querySelector('button').getAttribute('aria-label')
          : null,
        text: cell.textContent
      })),
      counts: Object.fromEntries(
        [...root.querySelectorAll('.bv-time-table tr[data-row="n"]')].map((row) => [
          row.dataset.group,
          [...row.querySelectorAll('td[data-visit]')].map(text)
        ])
      ),
      test: test && {
        state: test.dataset.state,
        head: test.querySelector('.bv-time-head').firstChild.textContent,
        sub: text(test.querySelector('.bv-time-sub')),
        cells: [...test.querySelectorAll('td')]
          .filter((cell) => cell.dataset.visit || cell.colSpan > 1)
          .map((cell) => ({
            visit: cell.dataset.visit || null,
            status: cell.dataset.status || null,
            text: cell.textContent,
            title: cell.title || null,
            span: cell.colSpan
          }))
      },
      line: line && {
        state: line.dataset.state,
        result: text(line.querySelector('.bv-stat-result')),
        levels: [...line.querySelectorAll('.bv-stat-level')].map(text),
        remarks: [...line.querySelectorAll('.bv-stat-remark')].map(text),
        scope: text(line.querySelector('.bv-stat-scope'))
      },
      trail: [...root.querySelectorAll('.bv-trail li')].map((item) => ({
        text: item.textContent,
        button: Boolean(item.querySelector('button'))
      })),
      footnote: text(root.querySelector('.sv-footnote')),
      statistics: made.statistics()
    };
  }, chart);
// What desktop R gives for one biomarker over time: by arm at every visit.
const rOverTime = (measure, valueType) =>
  fromR.over_time.find((entry) => entry.measure === measure)[valueType];
// R's answers for one biomarker over time, as stored results.
const overTimeResult = (name) => statistics.over_time.find((result) => result.case === name);
const storedOverTime = (...names) =>
  names.map(overTimeResult).map(({ name, args, dataId, rows, value }) => ({
    name,
    args,
    dataId,
    rows,
    value
  }));
// A p-value as the shared rule prints it.
const printedP = (p) =>
  p < 0.001 ? 'p < 0.001' : p.toFixed(3) === '1.000' ? 'p > 0.999' : `p = ${p.toFixed(3)}`;
// What desktop R gives for a biomarker's tile: per arm, the value at each visit.
const rLines = (measure, valueType, summary) => {
  const rows = fromR.tiles.find((tile) => tile.measure === measure)[valueType];
  return ['Placebo', 'Treatment'].map((level) =>
    VISITS.map((visit) => rows.find((row) => row.level === level && row.visit === visit)[summary])
  );
};
const near = (actual, expected, label) => {
  if (expected === 0) expect(actual, label).toBe(0);
  else expect(Math.abs(actual - expected) / Math.abs(expected), label).toBeLessThanOrEqual(1e-12);
};

test.describe('group comparison: the trend tiles of every biomarker', () => {
  test('GC-OVW-011: with no biomarker named the chart opens on a tile per biomarker: in each a line per group in the groups’ colours across every visit, its own value axis with the range and unit printed beneath, one key above them all, and no statistics line (#17, #84)', async ({
    page
  }) => {
    const errors = watch(page);
    await openTiles(page);
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('bv_overview');
    await expect(page.locator('select[data-control="measure"] option').first()).toHaveText(
      'All Biomarkers'
    );
    await expect(page.locator('[data-control="visits"] summary')).toHaveText('All (5)');

    const found = await tilesOf(page);
    expect(found.level).toBe('biomarkers');
    // A tile per biomarker, in the Biomarker control's order, named for it.
    expect(found.tiles.map((tile) => tile.measure)).toEqual(BIOMARKERS);
    expect(found.tiles.map((tile) => tile.name)).toEqual(BIOMARKERS);
    expect(await page.locator('select[data-control="measure"] option').allTextContents()).toEqual([
      'All Biomarkers',
      ...BIOMARKERS
    ]);
    // Twelve tiles, one chart each, drawn with the kit's Chart.js: not the
    // sixty panels of a panel per visit.
    expect(found.charts).toHaveLength(12);
    expect(found.charts.map((chart) => chart.measure)).toEqual(BIOMARKERS);
    expect(found.charts.every((chart) => chart.withKit && chart.type === 'line')).toBe(true);
    for (const chart of found.charts) {
      // A line per arm, in the arms' colours, with a point at each visit in order.
      expect(
        chart.lines.map((line) => [line.level, line.colour]),
        chart.measure
      ).toEqual([
        ['Placebo', COLOURS[0]],
        ['Treatment', COLOURS[1]]
      ]);
      for (const line of chart.lines) {
        expect(line.points.map((point) => point[0])).toEqual([0, 1, 2, 3, 4]);
      }
      expect(chart.visits).toEqual(VISITS);
      expect(chart.yType).toBe('linear');
    }
    // Each biomarker on its own axis: biomarkers on different scales differ.
    expect(new Set(found.charts.map((chart) => chart.y.join())).size).toBe(12);
    // Under each tile the first and last visit, then the axis's range and unit.
    for (const tile of found.tiles) {
      expect(tile.visits, tile.measure).toEqual(['Baseline', 'Week 12']);
      expect(tile.canvases).toBe(1);
    }
    const il6 = found.tiles.find((tile) => tile.measure === 'IL-6');
    expect(il6.range).toMatch(/^\d\.\d to \d\.\d pg\/mL$/);
    expect(found.tiles.find((tile) => tile.measure === 'LDH').range).toMatch(/^\d+ to \d+ U\/L$/);
    // One key above all the tiles: what a line goes through, and the groups.
    expect(found.key).toEqual(['Median result by ARM:', 'Placebo', 'Treatment']);
    await expect(page.locator('.bv-tile-key')).toHaveCount(1);
    expect(
      await page
        .locator('.bv-tile-key .bv-legend-swatch')
        .evaluateAll((all) => all.map((swatch) => swatch.style.background))
    ).toEqual(['rgb(37, 99, 235)', 'rgb(5, 150, 105)']);
    expect(found.caption).toBe(
      'Each biomarker has its own value axis, printed under its tile. It is never narrower than ' +
        '1.25 standard deviations of the results at the baseline visit, so lines that differ by ' +
        'less stay close to flat.'
    );
    await expect(page.locator('.sv-footnote')).toHaveText(
      'Click a biomarker to view it across the visits, with a test under each.'
    );
    // The single chart gives way to the tiles, and no test is printed or asked for.
    await expect(page.locator('.sv-chart-wrap')).toBeHidden();
    expect(found.lines).toEqual(['']);
    await expect(page.locator('.sv-main > .bv-statistic')).toBeHidden();
    expect(found.statistics).toEqual([]);
    await expect(page.locator('.sv-main')).not.toContainText('p =');
    // No pages: nothing counts the biomarkers shown or leads to more.
    await expect(page.locator('.bv-overview-pager')).toHaveCount(0);
    expect(errors).toEqual([]);
    await captureEvidence(page.locator('.sv-multiples'), 'GC-OVW-011', 'trend-tiles');
  });

  test('GC-TILE-008: on the page each tile’s line goes through the medians desktop R gives for that arm at each visit, the result and the change from baseline alike, and through R’s means when the tiles are switched to means (#84)', async ({
    page
  }) => {
    await openTiles(page);
    let compared = 0;
    const hold = async (valueType, summary) => {
      const found = await tilesOf(page);
      expect(found.charts).toHaveLength(12);
      for (const chart of found.charts) {
        const expected = rLines(chart.measure, valueType, summary);
        chart.lines.forEach((line, arm) => {
          expect(line.points).toHaveLength(5);
          line.points.forEach(([at, value]) => {
            near(
              value,
              expected[arm][at],
              `${chart.measure} ${valueType} ${summary} ${line.level}`
            );
            compared += 1;
          });
        });
      }
      return found;
    };
    await hold('raw', 'median');
    // The switch, in the Display section: means, and back.
    await expect(page.locator('select[data-control="tile-summary"]')).toHaveValue('median');
    await expect(page.locator('select[data-control="tile-summary"] option')).toHaveText([
      'Medians',
      'Means'
    ]);
    await choose(page, 'tile-summary', 'mean');
    let found = await hold('raw', 'mean');
    expect(found.key[0]).toBe('Mean result by ARM:');
    await choose(page, 'value-type', 'change');
    found = await hold('change', 'mean');
    expect(found.key[0]).toBe('Mean change from baseline by ARM:');
    await choose(page, 'tile-summary', 'median');
    found = await hold('change', 'median');
    expect(found.key[0]).toBe('Median change from baseline by ARM:');
    // Every line of a change starts at no change, at the baseline visit.
    for (const chart of found.charts) {
      for (const line of chart.lines) expect(line.points[0]).toEqual([0, 0]);
    }
    // Four views, twelve biomarkers, two arms, five visits.
    expect(compared).toBe(480);
    // The setting opens on means.
    await page.evaluate(() =>
      window.__gc.chart.setSettings({ tile_summary: 'mean', value_type: 'raw' })
    );
    await expect(page.locator('select[data-control="tile-summary"]')).toHaveValue('mean');
    await hold('raw', 'mean');
    // The switch is the tiles': with a biomarker open it is not offered.
    await page.locator('.bv-tile[data-measure="IL-6"]').click();
    await expect(page.locator('select[data-control="tile-summary"]')).toHaveCount(0);
  });

  test('GC-TILE-009: on the page a tile’s value axis never spans less than the set multiple of desktop R’s standard deviation of the results at the baseline visit, the range printed under the tile is the axis’s own two ends, and the multiple is a setting (#84)', async ({
    page
  }) => {
    await openTiles(page);
    const sd = (measure) => fromR.tiles.find((tile) => tile.measure === measure).baseline.sd;
    const printed = (found, measure) => {
      const tile = found.tiles.find((entry) => entry.measure === measure);
      const [low, high] = tile.range.split(' to ').map((part) => parseFloat(part));
      return { low, high, text: tile.range };
    };
    let found = await tilesOf(page);
    for (const chart of found.charts) {
      const drawn = chart.lines.flatMap((line) => line.points.map((point) => point[1]));
      const spread = Math.max(...drawn) - Math.min(...drawn);
      // The axis: 1.25 standard deviations at the least, and the points inside it.
      expect(chart.y[1] - chart.y[0], chart.measure).toBeGreaterThanOrEqual(
        1.25 * sd(chart.measure)
      );
      expect(chart.y[1] - chart.y[0]).toBeGreaterThan(spread);
      expect(Math.min(...drawn)).toBeGreaterThan(chart.y[0]);
      expect(Math.max(...drawn)).toBeLessThan(chart.y[1]);
      // What is printed is the axis, to the figures printed.
      const range = printed(found, chart.measure);
      const step = range.text.includes('.')
        ? 10 ** -range.text.split(' ')[0].split('.')[1].length
        : 1;
      expect(Math.abs(range.low - chart.y[0]), range.text).toBeLessThanOrEqual(step / 2 + 1e-9);
      expect(Math.abs(range.high - chart.y[1]), range.text).toBeLessThanOrEqual(step / 2 + 1e-9);
    }
    // The planted biomarker's arms part by nearly the whole of that, so its
    // lines fill its tile; CRP's part by a fifth of it, and stay near flat.
    const filled = (chart) => {
      const drawn = chart.lines.flatMap((line) => line.points.map((point) => point[1]));
      return (Math.max(...drawn) - Math.min(...drawn)) / (chart.y[1] - chart.y[0]);
    };
    expect(filled(tileChart(found, 'IL-6'))).toBeGreaterThan(0.75);
    expect(filled(tileChart(found, 'CRP'))).toBeLessThan(0.25);

    // No least at all: every axis is its points and their room, and the caption
    // no longer speaks of one.
    await page.evaluate(() => window.__gc.chart.setSettings({ tile_min_spread: 0 }));
    found = await tilesOf(page);
    for (const chart of found.charts) expect(filled(chart), chart.measure).toBeCloseTo(1 / 1.2, 9);
    expect(found.caption).toBe('Each biomarker has its own value axis, printed under its tile.');
    // A wider one: three standard deviations.
    await page.evaluate(() => window.__gc.chart.setSettings({ tile_min_spread: 3 }));
    found = await tilesOf(page);
    for (const chart of found.charts) {
      expect(chart.y[1] - chart.y[0], chart.measure).toBeGreaterThanOrEqual(3 * sd(chart.measure));
      expect(chart.y[0]).toBeGreaterThanOrEqual(0);
    }
    expect(found.caption).toContain('never narrower than 3 standard deviations');
    // On a logarithmic scale the axis is logarithmic, and its ends are a ratio apart.
    await page.evaluate(() => window.__gc.chart.setSettings({ tile_min_spread: 1.25 }));
    await choose(page, 'y-scale', 'log');
    found = await tilesOf(page);
    for (const chart of found.charts) {
      expect(chart.yType).toBe('logarithmic');
      const least = fromR.tiles.find((tile) => tile.measure === chart.measure).baseline.sd_log10;
      expect(Math.log10(chart.y[1] / chart.y[0]), chart.measure).toBeGreaterThanOrEqual(
        1.25 * least * (1 - 1e-9)
      );
    }
  });

  test('GC-OVW-012: a tile is a button named for its biomarker that opens it over time, by a click or by Enter or Space, across its visits with a row of tests under them; All Biomarkers returns to the tiles (#17, #84, #85)', async ({
    page
  }) => {
    await openTiles(page);
    const { tiles } = await tilesOf(page);
    for (const tile of tiles) {
      expect(tile.tag).toBe('BUTTON');
      expect(tile.type).toBe('button');
      expect(tile.label).toBe(`View ${tile.measure}`);
      // Its range is read out with it.
      expect(tile.described).toBe(tile.range);
    }
    await expect(page.getByRole('button', { name: 'View IL-6', exact: true })).toHaveCount(1);
    // Nothing in a tile answers the pointer but the tile.
    expect((await tilesOf(page)).charts.every((chart) => chart.events.length === 0)).toBe(true);

    // A click.
    await page.locator('.bv-tile[data-measure="IL-6"]').click();
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('IL-6');
    await expect(page.locator('.bv-tile')).toHaveCount(0);
    expect(await page.locator('.sv-root').getAttribute('data-level')).toBe('over-time');
    // The biomarker over time: one picture across the five visits, not a panel each.
    await expect(page.locator('.bv-panel')).toHaveCount(0);
    let opened = await overTimeOf(page);
    expect(opened.charts).toBe(1);
    expect(opened.visits).toEqual(VISITS);
    expect(opened.yTitle).toBe('IL-6 (pg/mL)');
    // One row of tests, and one line under it: with no R attached both say so.
    expect(opened.test.cells).toHaveLength(1);
    expect(opened.test.cells[0].text).toBe('Statistics unavailable');
    expect(opened.line.result).toBe('Statistics are unavailable: no R is attached to this chart.');

    // Back, from the Biomarker control.
    await choose(page, 'measure', 'bv_overview');
    await expect(page.locator('.bv-tile')).toHaveCount(12);
    await expect(page.locator('.bv-time-table')).toHaveCount(0);
    await expect(page.locator('.bv-trail')).toHaveCount(0);

    // Enter, on the tile the keyboard is on.
    await page.locator('.bv-tile[data-measure="CRP"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('CRP');
    opened = await overTimeOf(page);
    expect(opened.level).toBe('over-time');
    expect(opened.visits).toHaveLength(5);
    expect(opened.yTitle).toBe('CRP (mg/L)');
    // The keyboard's place is on the Biomarker control, which leads back.
    await expect(page.locator('select[data-control="measure"]')).toBeFocused();

    // Space.
    await choose(page, 'measure', 'bv_overview');
    await page.locator('.bv-tile[data-measure="VEGF"]').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('VEGF');
    // Any other key leaves the tiles as they are.
    await choose(page, 'measure', 'bv_overview');
    await page.locator('.bv-tile[data-measure="VEGF"]').focus();
    await page.keyboard.press('a');
    await expect(page.locator('.bv-tile')).toHaveCount(12);
    // The tiles are reached in order by Tab.
    await page.locator('.bv-tile[data-measure="CRP"]').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('.bv-tile[data-measure="D-dimer"]')).toBeFocused();

    // Reset returns to what the chart opened on: the tiles.
    await page.locator('.bv-tile[data-measure="LDH"]').click();
    await expect(page.locator('.bv-time-table')).toHaveCount(1);
    await page.locator('.sv-reset').click();
    await expect(page.locator('.bv-tile')).toHaveCount(12);
    // And a setting that names a biomarker opens that biomarker.
    await page.evaluate(() => window.__gc.chart.setSettings({ start_value: 'IL-8' }));
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('IL-8');
    await page.evaluate(() => window.__gc.chart.setSettings({ start_value: null }));
    await expect(page.locator('.bv-tile')).toHaveCount(12);
  });

  test('GC-OVW-013: the tiles ask R for nothing: no call, no request to R’s hosts and no waiting text, however they are drawn again; opening a biomarker asks once, for the row of visits, and an answer that arrives after the tiles are back is dropped (#17, #84, #85)', async ({
    page
  }) => {
    // R's hosts are not blocked here: every request the page makes is recorded.
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    const note = 'The first test starts R here.';
    await openTiles(page, { before: stubR, settings: { waiting_note: note } });
    await attachStub(page);
    await expect(page.locator('.bv-tile')).toHaveCount(12);

    // Drawn, and drawn again by every kind of control: nothing is asked.
    await page.locator('select[data-filter="SEX"]').selectOption('F');
    await choose(page, 'tile-summary', 'mean');
    await choose(page, 'group-by', 'RESPONSE');
    await choose(page, 'value-type', 'change');
    await choose(page, 'y-scale', 'log');
    await page.locator('.sv-reset').click();
    await page.evaluate(() => window.__gc.chart.render());
    await page.evaluate(() => window.__gc.chart.setSettings({ tile_min_spread: 2 }));
    await page.waitForTimeout(200);
    await expect(page.locator('.bv-tile')).toHaveCount(12);
    expect(await page.evaluate(() => window.__r.calls.length)).toBe(0);
    expect(await page.evaluate(() => window.__gc.chart.statistics())).toEqual([]);
    await expect(page.locator('.sv-main')).not.toContainText('waiting for R');
    await expect(page.locator('.sv-main')).not.toContainText('Statistics');
    expect((await tilesOf(page)).lines).toEqual(['']);
    // The requests the page made were recorded, and none is for R.
    expect(requests.length).toBeGreaterThan(3);
    expect(requests.filter(isRHost)).toEqual([]);

    // One biomarker over time: one question, for the row of five visits.
    await page.locator('.bv-tile[data-measure="IL-6"]').click();
    // The row waits, and the line under it says what the first start costs.
    await expect(page.locator('.bv-time-table tr[data-row="test"] td[colspan]')).toHaveText(
      'Waiting for R…'
    );
    await expect(page.locator('.bv-time-line')).toHaveText(`${WAITING} ${note}`);
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(1);
    expect(
      (await calls(page)).map((call) => [call.name, call.rows, call.args.strMethod, call.fields])
    ).toEqual([['Analyze_GroupDifferenceBy', 943, 't', ['USUBJID', 'y', 'x', 'visit']]]);
    const asked = await page.evaluate(() => window.__gc.chart.statistics());
    expect(asked.map((entry) => [entry.panel, entry.rows, entry.answer])).toEqual([
      ['', 943, null]
    ]);
    // It is the key desktop R wrote for the same view.
    expect(asked[0].dataId).toEqual(overTimeResult('over-time-result').dataId);
    expect(asked[0].args).toEqual(overTimeResult('over-time-result').args);
    // While the answer is on its way the page answers: a visit opens, with a
    // question of its own, and the answer for the row of visits is dropped.
    await page.locator('button.bv-time-visit[data-visit="Week 2"]').click();
    await expect(page.locator('.sv-main > .bv-statistic')).toHaveText(`${WAITING} ${note}`);
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(2);
    await page.evaluate(() => window.__r.answerVisits(0, [0.5, 0.5, 0.5, 0.5, 0.5]));
    await page.waitForTimeout(100);
    await expect(page.locator('.sv-main')).not.toContainText('p =');
    await page.evaluate(() => window.__r.answer(1, 0.04));
    await expect(page.locator('.sv-main > .bv-statistic .bv-stat-result')).toContainText(
      'p = 0.040 (Placebo n = 92, Treatment n = 93)'
    );

    // Back to the tiles: they print none, and an answer that comes late is dropped.
    await page.evaluate(() => window.__gc.chart.setSettings({ visits: null }));
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(3);
    await choose(page, 'measure', 'bv_overview');
    await page.evaluate(() => window.__r.answerVisits(2, [0.5, 0.5, 0.5, 0.5, 0.5]));
    await page.waitForTimeout(100);
    await expect(page.locator('.sv-main')).not.toContainText('p =');
    expect((await tilesOf(page)).lines).toEqual(['']);
    expect(await page.evaluate(() => window.__r.calls.length)).toBe(3);
    expect(requests.filter(isRHost)).toEqual([]);
  });

  test('GC-OVW-014: Group by, Levels, Value, Scale, Visit and the filters apply to every tile; Colour by, Panel by and Draw as are switched off there and say where they apply, and there is no Statistics section (#17, #84, #85)', async ({
    page
  }) => {
    await openTiles(page);
    // No test is offered where none is printed.
    await expect(page.locator('.sv-section-title')).toHaveText([
      'Value',
      'Groups',
      'Display',
      'Filters'
    ]);
    await expect(page.locator('select[data-control="test"]')).toHaveCount(0);
    // Colour by, Panel by and Draw as: there, switched off, each saying why.
    for (const [control, words] of [
      ['color-by', 'Applies once a biomarker and a visit are open.'],
      ['panel-by', 'Applies once a biomarker and a visit are open.'],
      ['mark', 'Applies when one biomarker is open.']
    ]) {
      const select = page.locator(`select[data-control="${control}"]`);
      await expect(select).toBeDisabled();
      expect(
        await select.evaluate((element) => element.nextElementSibling.textContent),
        control
      ).toBe(words);
    }
    await expect(page.locator('.bv-control-note')).toHaveCount(3);
    for (const control of ['measure', 'value-type', 'group-by', 'tile-summary', 'y-scale']) {
      await expect(page.locator(`select[data-control="${control}"]`)).toBeEnabled();
    }

    await choose(page, 'group-by', 'SEX');
    let found = await tilesOf(page);
    expect(found.charts).toHaveLength(12);
    expect(found.key).toEqual(['Median result by SEX:', 'F', 'M']);
    expect(
      found.charts.every((chart) => chart.lines.map((line) => line.level).join() === 'F,M')
    ).toBe(true);

    // A level left out is not drawn, and the one left keeps its colour.
    await page.locator('[data-control="levels"] summary').click();
    await page.locator('[data-control="levels"] input[value="F"]').uncheck();
    found = await tilesOf(page);
    expect(found.key).toEqual(['Median result by SEX:', 'M']);
    expect(
      found.charts.every(
        (chart) => chart.lines.length === 1 && chart.lines[0].colour === COLOURS[1]
      )
    ).toBe(true);
    await expect(page.locator('.sv-notes')).toContainText('1 of 2 levels shown.');
    await page.locator('[data-control="levels"] input[value="F"]').check();
    await choose(page, 'group-by', 'ARM');

    await choose(page, 'y-scale', 'log');
    found = await tilesOf(page);
    expect(found.charts.every((chart) => chart.yType === 'logarithmic')).toBe(true);
    await choose(page, 'y-scale', 'linear');

    // A filter: the medians are of the participants it keeps.
    const before = tileChart(await tilesOf(page), 'IL-6');
    await page.locator('select[data-filter="SEX"]').selectOption('F');
    found = await tilesOf(page);
    expect(tileChart(found, 'IL-6').lines[0].points).not.toEqual(before.lines[0].points);
    await expect(page.locator('.sv-notes')).toContainText(
      '91 of 200 participants pass the filters.'
    );
    await page.locator('select[data-filter="SEX"]').selectOption('__all__');
    expect(tileChart(await tilesOf(page), 'IL-6').lines).toEqual(before.lines);

    // The visits chosen are the points of every line.
    await page.locator('[data-control="visits"] summary').click();
    await page.locator('[data-control="visits"] input[value="Week 2"]').uncheck();
    await page.locator('[data-control="visits"] input[value="Week 12"]').uncheck();
    found = await tilesOf(page);
    expect(found.charts).toHaveLength(12);
    expect(found.charts.every((chart) => chart.visits.join() === 'Baseline,Week 4,Week 8')).toBe(
      true
    );
    expect(found.tiles.every((tile) => tile.visits.join() === 'Baseline,Week 8')).toBe(true);
    await page.locator('.sv-reset').click();

    // A change from baseline: the baseline visit stays, where no change is.
    await choose(page, 'value-type', 'change');
    found = await tilesOf(page);
    expect(found.charts.every((chart) => chart.visits.join() === VISITS.join())).toBe(true);
    expect(found.charts.every((chart) => chart.y[0] < 0 && chart.y[1] > 0)).toBe(true);
    await expect(page.locator('.sv-notes')).toHaveText('Baseline visit: Baseline.');
    // A percent change is in percent, and a fold change has no unit.
    await choose(page, 'value-type', 'percent_change');
    expect((await tilesOf(page)).tiles[0].range).toMatch(/ %$/);
    await choose(page, 'value-type', 'fold_change');
    expect((await tilesOf(page)).tiles[0].range).toMatch(/^[\d.]+ to [\d.]+$/);
    // A baseline value has no visit: a point for each group, and no Visit control.
    await choose(page, 'value-type', 'baseline');
    found = await tilesOf(page);
    expect(found.charts).toHaveLength(12);
    expect(
      found.charts.every((chart) => chart.lines.every((line) => line.points.length === 1))
    ).toBe(true);
    expect(found.tiles.every((tile) => tile.visits.join() === 'Baseline value')).toBe(true);
    await expect(page.locator('[data-control="visits"]')).toHaveCount(0);
    await expect(page.locator('.sv-notes')).toContainText(
      'A baseline value has no visit: each group is one point.'
    );

    // What the three controls were set to is kept, and applies once a
    // biomarker and a visit are open: they are controls again there.
    await page.evaluate(() =>
      window.__gc.chart.setSettings({ value_type: 'raw', color_by: 'SEX', mark: 'violin' })
    );
    await expect(page.locator('select[data-control="color-by"]')).toBeDisabled();
    await expect(page.locator('select[data-control="color-by"]')).toHaveValue('SEX');
    expect((await tilesOf(page)).key).toEqual(['Median result by ARM:', 'Placebo', 'Treatment']);
    // The biomarker over time offers the test, and still takes no colour.
    await page.locator('.bv-tile[data-measure="IL-6"]').click();
    await expect(page.locator('select[data-control="test"]')).toHaveValue('t');
    await expect(page.locator('select[data-control="color-by"]')).toBeDisabled();
    await expect(page.locator('select[data-control="color-by"]')).toHaveValue('SEX');
    // One of its visits: the colour, the panels and the mark apply.
    await page.locator('button.bv-time-visit[data-visit="Week 4"]').click();
    for (const control of ['color-by', 'panel-by', 'mark']) {
      await expect(page.locator(`select[data-control="${control}"]`)).toBeEnabled();
    }
    await expect(page.locator('.bv-control-note')).toHaveCount(0);
    await expect(page.locator('select[data-control="test"]')).toHaveValue('t');
    const panels = await drawn(page);
    expect(panels[0].legend).toEqual(['F', 'M']);
    expect(panels[0].plugins).toContain('gc-violin');
  });

  test('GC-OVW-015: with thirty-six biomarkers every one has a tile: there are no pages and no count of how many are shown, and `overview_limit` and `page`, still read, change nothing (#17, #84)', async ({
    page
  }) => {
    const errors = watch(page);
    await openTiles(page, { data: 'many-biomarkers' });
    const names = (
      await page.locator('select[data-control="measure"] option').allTextContents()
    ).slice(1);
    expect(names).toHaveLength(36);
    const shown = async () => (await tilesOf(page)).tiles.map((tile) => tile.measure);
    expect(await shown()).toEqual(names);
    // A chart a tile: thirty-six alive, whatever the visits.
    expect(await page.evaluate(() => window.__gc.chart.charts.length)).toBe(36);
    await expect(page.locator('.bv-overview-pager')).toHaveCount(0);
    await expect(page.locator('.bv-overview-count')).toHaveCount(0);
    await expect(page.locator('.sv-main button[data-go]')).toHaveCount(0);

    // The two settings of the overview v0.2.0 paged: read, kept, and applied to
    // nothing.
    await page.evaluate(() => window.__gc.chart.setSettings({ overview_limit: 5, page: 2 }));
    expect(await shown()).toEqual(names);
    expect(
      await page.evaluate(() => {
        const { settings } = window.__gc.chart.specification();
        return [settings.overview_limit, settings.page];
      })
    ).toEqual([5, 2]);
    // A tile far down the list opens its biomarker, and All Biomarkers returns
    // to all thirty-six.
    await page.locator('.bv-tile').nth(30).click();
    await expect(page.locator('select[data-control="measure"]')).toHaveValue(names[30]);
    await choose(page, 'measure', 'bv_overview');
    expect(await shown()).toEqual(names);
    expect(errors).toEqual([]);
  });

  test('GC-OVW-017: the first draw of thirty-six tiles is timed, at a desk’s width and at a phone’s, and recorded where a reader of the run can find it (#17, #84)', async ({
    page,
    browser
  }, testInfo) => {
    const timings = {};
    for (const [name, viewport] of [
      ['desk', { width: 1280, height: 800 }],
      ['phone', { width: 390, height: 844 }]
    ]) {
      await page.setViewportSize(viewport);
      await openTiles(page, { data: 'many-biomarkers' });
      timings[name] = await page.evaluate(async () => {
        const { chart, data } = window.__gc;
        const painted = () =>
          new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const time = async (work) => {
          const from = performance.now();
          work();
          const drawn = performance.now() - from;
          await painted();
          return { drawn, painted: performance.now() - from };
        };
        // The whole first draw: the tables read, the controls built, every
        // tile worked out and thirty-six charts made. Then the drawing alone,
        // five times.
        const first = await time(() => chart.setData(data));
        const again = [];
        for (let run = 0; run < 5; run += 1) again.push((await time(() => chart.render())).drawn);
        return {
          charts: chart.charts.length,
          tiles: document.querySelectorAll('.bv-tile').length,
          rows: data.results.length,
          firstDrawMs: Math.round(first.drawn),
          firstPaintMs: Math.round(first.painted),
          redrawMs: again.map(Math.round).sort((a, b) => a - b)[2]
        };
      });
      expect(timings[name].charts).toBe(36);
      expect(timings[name].tiles).toBe(36);
      // Generous: a guard against the tiles becoming slow, not a benchmark.
      expect(timings[name].firstPaintMs).toBeLessThan(3000);
    }
    const record = {
      recorded: new Date().toISOString(),
      browser: `Chromium ${browser.version()}, headless`,
      machine:
        process.env.R_CHECK_MACHINE ||
        (process.env.CI ? 'a GitHub Actions runner (ubuntu-latest)' : 'not named'),
      what: 'thirty-six biomarkers at two visits, thirty-six Chart.js charts, one per tile',
      timings
    };
    const text = JSON.stringify(record, null, 2) + '\n';
    await testInfo.attach('group-comparison-tiles-timing.json', {
      body: text,
      contentType: 'application/json'
    });
    mkdirSync(new URL('../../test-results/', import.meta.url), { recursive: true });
    writeFileSync(
      new URL('../../test-results/group-comparison-tiles-timing.json', import.meta.url),
      text
    );
    console.log(`\nTrend tiles, first draw — ${record.browser}, ${record.machine}`);
    for (const [name, timing] of Object.entries(timings)) {
      console.log(
        `  ${name.padEnd(5)} ${timing.charts} charts from ${timing.rows} rows: ${timing.firstDrawMs} ms to draw, ` +
          `${timing.firstPaintMs} ms to the next paint, ${timing.redrawMs} ms to draw again`
      );
    }
  });
});

// Specifications the released chart wrote, with what it drew and asked R for
// each (tools/write-released-specifications.mjs). Nothing in the file was typed.
const released = readJson('../fixtures/group-comparison-specifications-0.2.0.json');

test.describe('group comparison: a specification the released chart wrote', () => {
  test('GC-TILE-010: a specification written by bio.viz v0.2.0 is still read and rebuilds its view: one visit, and a panel per visit, with the panels, the groups and the questions for R the released chart had; and the overview it paged, as a tile for every biomarker (#84)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page);
    expect(released.made_by).toMatchObject({
      tool: 'tools/write-released-specifications.mjs',
      tag: 'v0.2.0',
      bio_viz_version: '0.2.0'
    });
    expect(released.cases.map((entry) => entry.name)).toEqual([
      'one-visit',
      'one-biomarker-two-visits',
      'every-biomarker',
      'every-biomarker-second-page',
      'one-biomarker-every-visit'
    ]);
    // The last, a biomarker at every visit, no longer draws a panel a visit:
    // GC-TIME-034 holds what it opens on now.
    for (const entry of released.cases.slice(0, 4)) {
      const rebuilt = await page.evaluate((specification) => {
        window.__gc.chart.destroy();
        const chart = window.BioViz.fromSpecification('#chart', specification).init(
          window.__gc.data
        );
        window.__gc.chart = chart;
        const panels = chart.model ? chart.model.panels : [];
        return {
          notices: chart.notices,
          level: chart.root.dataset.level,
          biomarker: chart.state.measure,
          panels: panels.map((panel) => ({
            title: panel.title,
            visit: panel.visit,
            participants: panel.records.length,
            groups: panel.ticks.map((lines) => lines.join(' '))
          })),
          tiles: chart.tiles ? chart.tiles.tiles.map((tile) => tile.measure) : null,
          groups: chart.tiles ? chart.tiles.groups.map((group) => group.level) : null,
          scale: chart.charts.map((drawn) => drawn.scales.y.type),
          filters: [...chart.root.querySelectorAll('select[data-filter]')].map((select) => [
            select.dataset.filter,
            select.value
          ]),
          asked: chart.statistics().map(({ panel, name, args, dataId, rows }) => ({
            panel,
            name,
            args,
            dataId,
            rows
          })),
          again: chart.specification()
        };
      }, entry.specification);
      // Read whole: nothing it asks for is refused or drawn otherwise.
      expect(rebuilt.notices, entry.name).toEqual([]);
      expect(rebuilt.biomarker, entry.name).toBe(entry.drew.biomarker);
      // The view it had: the same panels, with the same participants and groups.
      expect(rebuilt.panels, entry.name).toEqual(entry.drew.panels);
      // And R is asked what the released chart asked it, key for key.
      expect(rebuilt.asked, entry.name).toEqual(entry.asked);
      if (entry.drew.overview) {
        // What was a page of the overview is a tile for every biomarker.
        expect(rebuilt.level, entry.name).toBe('biomarkers');
        expect(rebuilt.tiles, entry.name).toEqual(BIOMARKERS);
        for (const measure of entry.drew.overview.biomarkers) {
          expect(rebuilt.tiles).toContain(measure);
        }
        expect(rebuilt.asked).toEqual([]);
      } else {
        expect(rebuilt.level, entry.name).toBe('visits');
        expect(rebuilt.asked.length, entry.name).toBe(entry.drew.panels.length);
      }
      // Written again, it holds every setting the released one held, as it was,
      // and the same filters.
      for (const [key, value] of Object.entries(entry.specification.settings)) {
        expect(rebuilt.again.settings[key], `${entry.name} ${key}`).toEqual(value);
      }
      expect(rebuilt.again.filters, entry.name).toEqual(entry.specification.filters);
      if (entry.name === 'one-visit') {
        expect(rebuilt.panels).toHaveLength(1);
        expect(rebuilt.filters).toContainEqual(['SEX', 'F']);
        expect(rebuilt.asked[0].args.strMethod).toBe('wilcoxon');
        expect(rebuilt.asked[0].dataId).not.toHaveProperty('unscheduled_visits');
        await expect(page.locator('#chart .bv-title')).toHaveText('IL-6 by ARM');
      }
      if (entry.name === 'every-biomarker-second-page') {
        // Its grouping and its scale are the tiles'; its page and limit are kept
        // and apply to nothing.
        expect(rebuilt.groups).toEqual(['F', 'M']);
        expect(new Set(rebuilt.scale)).toEqual(new Set(['logarithmic']));
        expect(rebuilt.again.settings).toMatchObject({ overview_limit: 4, page: 1 });
      }
    }
    // A specification this version writes holds the tiles' settings and the
    // rule for unscheduled visits, and makes the same tiles again.
    const trip = await page.evaluate(() => {
      window.__gc.chart.destroy();
      const first = window.BioViz.groupComparison('#chart', {
        tile_summary: 'mean',
        tile_min_spread: 2,
        unscheduled_visit_values: ['Week 8'],
        group_by: 'ARM'
      }).init(window.__gc.data);
      const written = first.specification();
      const points = first.charts.map((drawn) => drawn.data.datasets.map((set) => set.data));
      first.destroy();
      const second = window.BioViz.fromSpecification('#chart', JSON.stringify(written)).init(
        window.__gc.data
      );
      window.__gc.chart = second;
      return {
        written: written.settings,
        again: second.specification(),
        same:
          JSON.stringify(
            second.charts.map((drawn) => drawn.data.datasets.map((set) => set.data))
          ) === JSON.stringify(points),
        visits: second.tiles.tiles[0].visits,
        notices: second.notices
      };
    });
    expect(trip.written).toMatchObject({
      start_value: null,
      tile_summary: 'mean',
      tile_min_spread: 2,
      unscheduled_visits: false,
      unscheduled_visit_pattern: '/unscheduled|early termination/i',
      unscheduled_visit_values: ['Week 8']
    });
    expect(trip.again.settings).toEqual(trip.written);
    expect(trip.same).toBe(true);
    expect(trip.visits).toEqual(['Baseline', 'Week 2', 'Week 4', 'Week 12']);
    expect(trip.notices).toEqual([]);
    expect(errors).toEqual([]);
  });
});

// Unscheduled visits (#84). The synthetic study has none, so these tests add
// rows of their own to a copy of it in the page: for the first forty
// participants a visit named Unscheduled 1, numbered between Week 2 and Week 4,
// holding twice their Week 2 result, and for the first ten of them a visit
// named Early Termination, numbered last.
const UNSCHEDULED = ['Unscheduled 1', 'Early Termination'];
const WITH_UNSCHEDULED = [
  'Baseline',
  'Week 2',
  'Unscheduled 1',
  'Week 4',
  'Week 8',
  'Week 12',
  'Early Termination'
];
const addUnscheduled = (page, settings = null) =>
  page.evaluate((given) => {
    const { chart, data } = window.__gc;
    const ids = [...new Set(data.results.map((row) => row.USUBJID))].slice(0, 40);
    const copy = (visit, from, order, some, times) =>
      data.results
        .filter((row) => row.VISIT === from && some.includes(row.USUBJID))
        .map((row) => ({
          ...row,
          VISIT: visit,
          VISITNUM: order,
          STRESN: String(Number(row.STRESN) * times)
        }));
    const added = [
      ...copy('Unscheduled 1', 'Week 2', '3', ids, 2),
      ...copy('Early Termination', 'Week 8', '99', ids.slice(0, 10), 1)
    ];
    const tables = { results: [...data.results, ...added], participants: data.participants };
    if (given) chart.setData(tables, given);
    else chart.setData(tables);
    const arm = new Map(data.participants.map((row) => [row.USUBJID, row.ARM]));
    // The added IL-6 values at Unscheduled 1, by arm, for the test to summarise itself.
    return added
      .filter((row) => row.VISIT === 'Unscheduled 1' && row.TEST === 'IL-6')
      .map((row) => ({ arm: arm.get(row.USUBJID), value: Number(row.STRESN) }));
  }, settings);
const visitsOffered = (page) =>
  page
    .locator('[data-control="visits"] input[type="checkbox"]')
    .evaluateAll((boxes) =>
      boxes.filter((box) => box.hasAttribute('value')).map((box) => box.value)
    );
const HIDDEN_NOTE =
  '2 unscheduled visits not drawn: Unscheduled 1, Early Termination. ' +
  'Switch on Unscheduled visits to draw them.';

test.describe('group comparison: unscheduled visits', () => {
  test('GC-UNS-003: with rows for unscheduled visits added to the study, such a visit is in no tile, not in the Visit control, not a visit of a biomarker over time and not a panel of one, and a note says how many are left out and which; the Unscheduled visits control, or `unscheduled_visits`, brings them in at every level (#84, #85)', async ({
    page
  }) => {
    const errors = watch(page);
    await openTiles(page);
    // The study as vendored has no such visit: no note, and no control to
    // switch on what is not there.
    await expect(page.locator('.bv-hidden-visits')).toHaveCount(0);
    await expect(page.locator('input[data-control="unscheduled-visits"]')).toHaveCount(0);
    const plain = await tilesOf(page);

    const added = await addUnscheduled(page);
    // Of the forty, those with an IL-6 result at Week 2 to copy.
    expect(added.length).toBeGreaterThan(30);
    // Off, as the settings default: the tiles are the tiles of the study
    // without the added rows, point for point.
    expect(await page.evaluate(() => window.__gc.chart.settings.unscheduled_visits)).toBe(false);
    let found = await tilesOf(page);
    expect(found.charts.every((chart) => chart.visits.join() === VISITS.join())).toBe(true);
    expect(found.charts.map((chart) => chart.lines)).toEqual(
      plain.charts.map((chart) => chart.lines)
    );
    expect(found.charts.map((chart) => chart.y)).toEqual(plain.charts.map((chart) => chart.y));
    // Not offered by the Visit control.
    await expect(page.locator('[data-control="visits"] summary')).toHaveText('All (5)');
    expect(await visitsOffered(page)).toEqual(VISITS);
    // The note, and the control it names, unticked.
    await expect(page.locator('.sv-notes .bv-hidden-visits')).toHaveText(HIDDEN_NOTE);
    await expect(page.locator('.bv-hidden-visits')).toHaveAttribute('data-hidden', '2');
    const control = page.locator('input[data-control="unscheduled-visits"]');
    await expect(control).toHaveCount(1);
    await expect(control).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Show unscheduled visits' })).toHaveCount(1);
    await expect(page.locator('.sv-sidebar')).toContainText('Unscheduled visits');

    // One biomarker over time: its visits are the scheduled ones, and R is
    // asked what it is asked of the study without the added rows.
    await page.locator('.bv-tile[data-measure="IL-6"]').click();
    let opened = await overTimeOf(page);
    expect(opened.level).toBe('over-time');
    expect(opened.visits).toEqual(VISITS);
    expect(opened.heads.map((head) => head.visit)).toEqual(VISITS);
    expect(await visitsOffered(page)).toEqual(VISITS);
    await expect(page.locator('.sv-notes .bv-hidden-visits')).toHaveText(HIDDEN_NOTE);
    expect(opened.statistics.map((entry) => [entry.dataId, entry.rows])).toEqual([
      [overTimeResult('over-time-result').dataId, 943]
    ]);
    // A few of its visits, a panel each: the same, panel by panel.
    await page.evaluate(() =>
      window.__gc.chart.setSettings({ visits: ['Baseline', 'Week 2', 'Week 4', 'Week 8'] })
    );
    await expect(page.locator('.bv-panel h3')).toHaveText(VISITS.slice(0, 4));
    let asked = await page.evaluate(() => window.__gc.chart.statistics());
    expect(asked.map((entry) => entry.dataId)).toEqual(
      ['baseline', 'week-2', 'week-4', 'week-8'].map((visit) => resultOf(`result-${visit}`).dataId)
    );
    expect(asked.map((entry) => entry.rows)).toEqual([200, 185, 186, 188]);

    // Switched on from the control, with those panels open: the unscheduled
    // visits are offered, in visit order, and each is a panel.
    await page.locator('input[data-control="unscheduled-visits"]').check();
    expect(await visitsOffered(page)).toEqual(WITH_UNSCHEDULED);
    await expect(page.locator('.bv-hidden-visits')).toHaveCount(0);
    await expect(page.locator('.bv-panel h3')).toHaveText([
      'Baseline',
      'Week 2',
      'Unscheduled 1',
      'Week 4',
      'Week 8',
      'Early Termination'
    ]);
    asked = await page.evaluate(() => window.__gc.chart.statistics());
    expect(asked.map((entry) => [entry.panel, entry.rows])).toEqual([
      ['Baseline', 200],
      ['Week 2', 185],
      ['Unscheduled 1', added.length],
      ['Week 4', 186],
      ['Week 8', 188],
      ['Early Termination', asked[5].rows]
    ]);
    expect(asked[5].rows).toBeGreaterThan(5);
    expect(asked[5].rows).toBeLessThanOrEqual(10);
    // The rows now framed hold unscheduled visits, and the identity says so.
    expect(asked.every((entry) => entry.dataId.unscheduled_visits === true)).toBe(true);
    // Every visit again: the biomarker over time, across seven visits, in one
    // request whose identity names them and says that they are unscheduled.
    await page.locator('[data-control="visits"] summary').click();
    await page.locator('[data-control="visits"] .sv-ms-all input').check();
    opened = await overTimeOf(page);
    expect(opened.level).toBe('over-time');
    expect(opened.visits).toEqual(WITH_UNSCHEDULED);
    expect(opened.heads.map((head) => head.visit)).toEqual(WITH_UNSCHEDULED);
    expect(opened.statistics).toHaveLength(1);
    expect(opened.statistics[0].dataId.visits).toEqual(WITH_UNSCHEDULED);
    expect(opened.statistics[0].dataId.unscheduled_visits).toBe(true);
    expect(opened.statistics[0].args.chrBy).toEqual(WITH_UNSCHEDULED);
    expect(opened.statistics[0].rows).toBe(943 + added.length + asked[5].rows);
    // The number in each arm at the added visit is the number of rows added.
    expect(opened.counts.Placebo[2]).toBe(
      `n = ${added.filter((row) => row.arm === 'Placebo').length}`
    );

    // And in every tile: seven visits, the unscheduled ones in their place.
    await choose(page, 'measure', 'bv_overview');
    await expect(page.locator('input[data-control="unscheduled-visits"]')).toBeChecked();
    found = await tilesOf(page);
    expect(found.charts).toHaveLength(12);
    expect(found.charts.every((chart) => chart.visits.join() === WITH_UNSCHEDULED.join())).toBe(
      true
    );
    expect(found.tiles.every((tile) => tile.visits.join() === 'Baseline,Early Termination')).toBe(
      true
    );
    await expect(page.locator('[data-control="visits"] summary')).toHaveText('All (7)');
    // The point at Unscheduled 1 is the median of the rows the test added,
    // worked out here and not by the chart.
    const median = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      const middle = sorted.length / 2;
      return sorted.length % 2
        ? sorted[Math.floor(middle)]
        : (sorted[middle - 1] + sorted[middle]) / 2;
    };
    const il6 = tileChart(found, 'IL-6');
    il6.lines.forEach((line) => {
      const own = added.filter((row) => row.arm === line.level).map((row) => row.value);
      expect(own.length).toBeGreaterThan(5);
      near(line.points[2][1], median(own), line.level);
    });
    // The scheduled points are where they were.
    il6.lines.forEach((line, arm) => {
      const before = tileChart(plain, 'IL-6').lines[arm].points.map((point) => point[1]);
      expect([0, 1, 3, 4, 5].map((at) => line.points[at][1])).toEqual(before);
    });

    // Off again: five visits, and the note is back.
    await page.locator('input[data-control="unscheduled-visits"]').uncheck();
    found = await tilesOf(page);
    expect(found.charts.every((chart) => chart.visits.join() === VISITS.join())).toBe(true);
    await expect(page.locator('.sv-notes .bv-hidden-visits')).toHaveText(HIDDEN_NOTE);
    // The setting opens with them, moves the control, and a specification keeps it.
    await page.evaluate(() => window.__gc.chart.setSettings({ unscheduled_visits: true }));
    await expect(page.locator('input[data-control="unscheduled-visits"]')).toBeChecked();
    expect((await tilesOf(page)).charts[0].visits).toEqual(WITH_UNSCHEDULED);
    expect(
      await page.evaluate(() => window.__gc.chart.specification().settings.unscheduled_visits)
    ).toBe(true);
    // Reset returns to what the settings open on, which is now with them; and
    // a control unticked is written to the specification as off.
    await page.locator('input[data-control="unscheduled-visits"]').uncheck();
    expect(
      await page.evaluate(() => window.__gc.chart.specification().settings.unscheduled_visits)
    ).toBe(false);
    await page.locator('.sv-reset').click();
    await expect(page.locator('input[data-control="unscheduled-visits"]')).toBeChecked();
    expect(errors).toEqual([]);
  });

  test('GC-UNS-004: a list of names in `unscheduled_visit_values` decides alone which visits are unscheduled, whatever the pattern says, and another pattern names others; the note counts and names what is left out (#84)', async ({
    page
  }) => {
    await openTiles(page);
    await addUnscheduled(page, { unscheduled_visit_values: ['Week 12'] });
    // The list wins over the pattern: Week 12 is left out, and the visits the
    // pattern would name are drawn.
    let found = await tilesOf(page);
    const listed = WITH_UNSCHEDULED.filter((visit) => visit !== 'Week 12');
    expect(found.charts[0].visits).toEqual(listed);
    expect(await visitsOffered(page)).toEqual(listed);
    await expect(page.locator('.sv-notes .bv-hidden-visits')).toHaveText(
      '1 unscheduled visit not drawn: Week 12. Switch on Unscheduled visits to draw it.'
    );
    // A list of none: no visit is unscheduled, so there is no note and no control.
    await page.evaluate(() => window.__gc.chart.setSettings({ unscheduled_visit_values: [] }));
    expect((await tilesOf(page)).charts[0].visits).toEqual(WITH_UNSCHEDULED);
    await expect(page.locator('.bv-hidden-visits')).toHaveCount(0);
    await expect(page.locator('input[data-control="unscheduled-visits"]')).toHaveCount(0);
    // No list: the pattern decides, and it is a setting.
    await page.evaluate(() =>
      window.__gc.chart.setSettings({
        unscheduled_visit_values: null,
        unscheduled_visit_pattern: '/^week (2|4)$/i'
      })
    );
    found = await tilesOf(page);
    expect(found.charts[0].visits).toEqual([
      'Baseline',
      'Unscheduled 1',
      'Week 8',
      'Week 12',
      'Early Termination'
    ]);
    await expect(page.locator('.sv-notes .bv-hidden-visits')).toHaveText(
      '2 unscheduled visits not drawn: Week 2, Week 4. Switch on Unscheduled visits to draw them.'
    );
    // A pattern that is no regular expression is refused by name, and nothing changes.
    const refused = await page.evaluate(() => {
      try {
        window.__gc.chart.setSettings({ unscheduled_visit_pattern: '/(/' });
        return null;
      } catch (error) {
        return error.message;
      }
    });
    expect(refused).toMatch(
      /^bio\.viz: `unscheduled_visit_pattern` is not a regular expression a browser reads: /
    );
    expect((await tilesOf(page)).charts[0].visits).toHaveLength(5);
  });

  test('GC-UNS-005: left out, an unscheduled visit is not the baseline a change is measured from: with no baseline visit named it is the first scheduled visit, and with unscheduled visits switched on, the first visit of all (#84)', async ({
    page
  }) => {
    await openTiles(page, { settings: { baseline_visits: null, value_type: 'change' } });
    // An unscheduled visit numbered before Baseline: half of everyone's result there.
    await page.evaluate(() => {
      const { chart, data } = window.__gc;
      const early = data.results
        .filter((row) => row.VISIT === 'Baseline')
        .map((row) => ({
          ...row,
          VISIT: 'Unscheduled 0',
          VISITNUM: '-1',
          STRESN: String(Number(row.STRESN) / 2)
        }));
      chart.setData({ results: [...data.results, ...early], participants: data.participants });
    });
    await expect(page.locator('.sv-notes')).toContainText('Baseline visit: Baseline.');
    let found = await tilesOf(page);
    // The change from Baseline, as desktop R gives it for the study itself.
    expect(found.charts[0].visits).toEqual(VISITS);
    tileChart(found, 'IL-6').lines.forEach((line, arm) => {
      line.points.forEach(([at, value]) =>
        near(value, rLines('IL-6', 'change', 'median')[arm][at], line.level)
      );
    });
    // One visit open: the question for R is the one asked of the study itself.
    await page.evaluate(() =>
      window.__gc.chart.setSettings({ start_value: 'IL-6', visits: ['Week 4'] })
    );
    await expect(page.locator('.sv-notes')).toContainText('Baseline visit: Baseline.');
    let [asked] = await page.evaluate(() => window.__gc.chart.statistics());
    expect(asked.rows).toBe(186);
    expect(asked.dataId).not.toHaveProperty('unscheduled_visits');
    const scheduled = await page.evaluate(() =>
      window.__gc.chart.model.panels[0].records.map((record) => record.y)
    );

    // Switched on: the first visit of all is the baseline, the values drawn are
    // other values, and the identity of the rows says they hold unscheduled visits.
    await page.locator('input[data-control="unscheduled-visits"]').check();
    await expect(page.locator('.sv-notes')).toContainText('Baseline visit: Unscheduled 0.');
    [asked] = await page.evaluate(() => window.__gc.chart.statistics());
    expect(asked.dataId.unscheduled_visits).toBe(true);
    const all = await page.evaluate(() =>
      window.__gc.chart.model.panels[0].records.map((record) => record.y)
    );
    expect(all).not.toEqual(scheduled);
    // Everything else of the identity is as it was.
    const { unscheduled_visits: said, ...rest } = asked.dataId;
    expect(said).toBe(true);
    expect(rest).toEqual({
      chart: 'group-comparison',
      measure: 'IL-6',
      value_type: 'change',
      visit: 'Week 4',
      baseline_stat: 'mean',
      group_by: 'ARM',
      groups: ['Placebo', 'Treatment']
    });
  });
  test('GC-UNS-006: a specification that names an unscheduled visit, as one written by v0.2.0 for a study that has them, is read; the visit is left out like any other, and the notice above the chart says which and by which setting, not that it is missing from the tables; with `unscheduled_visits` true in it the visit is drawn and nothing is said (#84)', async ({
    page
  }) => {
    const errors = watch(page);
    await openTiles(page);
    await addUnscheduled(page);
    const made = await page.evaluate(() => {
      const { chart } = window.__gc;
      const { tables } = chart;
      // One biomarker at three visits, one of them unscheduled, as the released
      // chart would have written it: with none of the settings this version adds.
      const written = chart.specification();
      for (const key of [
        'unscheduled_visits',
        'unscheduled_visit_pattern',
        'unscheduled_visit_values',
        'tile_summary',
        'tile_min_spread'
      ]) {
        delete written.settings[key];
      }
      written.settings.start_value = 'IL-6';
      chart.destroy();
      const remake = (settings) => {
        const again = window.BioViz.fromSpecification('#chart', {
          ...written,
          settings: { ...written.settings, ...settings }
        }).init(tables);
        const note = again.root.querySelector('.bv-hidden-visits');
        const out = {
          notices: again.notices.map((notice) => notice.said),
          said: again.root.querySelector('.bv-notices').textContent,
          panels: again.model.panels.map((panel) => panel.title),
          hidden: note ? note.textContent : null
        };
        again.destroy();
        return out;
      };
      return {
        off: remake({ visits: ['Week 2', 'Unscheduled 1', 'Week 4'] }),
        on: remake({ visits: ['Week 2', 'Unscheduled 1', 'Week 4'], unscheduled_visits: true }),
        absent: remake({ visits: ['Week 2', 'Unscheduled 1', 'Week 99'] }),
        every: remake({
          visits: [
            'Baseline',
            'Week 2',
            'Unscheduled 1',
            'Week 4',
            'Week 8',
            'Week 12',
            'Early Termination'
          ]
        })
      };
    });
    const notice =
      'Visits: Unscheduled 1 is an unscheduled visit, left out unless `unscheduled_visits` is ' +
      'true, so the chart draws Week 2, Week 4.';
    expect(made.off.panels).toEqual(['Week 2', 'Week 4']);
    expect(made.off.notices).toEqual([notice]);
    expect(made.off.said).toBe(`Not drawn as the specification asks: ${notice}`);
    expect(made.off.hidden).toBe(HIDDEN_NOTE);
    // With the switch in the specification, it draws what it names.
    expect(made.on.panels).toEqual(['Week 2', 'Unscheduled 1', 'Week 4']);
    expect(made.on.notices).toEqual([]);
    expect(made.on.hidden).toBe(null);
    // A visit the tables do not have is still said to be that.
    expect(made.absent.notices).toEqual([
      'Visits: Unscheduled 1 is an unscheduled visit, left out unless `unscheduled_visits` is ' +
        'true, so the chart draws Week 2. Week 99 is not in the tables.'
    ]);
    // Every visit the released chart drew of such a study: the scheduled ones are drawn.
    expect(made.every.panels).toEqual(VISITS);
    expect(made.every.notices).toEqual([
      'Visits: Unscheduled 1, Early Termination are unscheduled visits, left out unless ' +
        '`unscheduled_visits` is true, so the chart draws Baseline, Week 2, Week 4, Week 8, Week 12.'
    ]);
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// One biomarker over time (#85): the level between the tiles and one visit.
// With a biomarker chosen and every visit it has ticked, the chart draws that
// biomarker across the visits in one picture, with a table under the axis: the
// number in each group at each visit, and R's test of the groups at each visit,
// asked of R in one request. No number below was typed: the marks are held to
// tests/fixtures/group-comparison-r.json, and the tests to
// tests/fixtures/group-statistics-r.json, both written by desktop R.

// The fixture page on one biomarker with no visit named: every visit it has.
const OVER_TIME = {
  start_value: 'IL-6',
  visits: null,
  value_type: 'raw',
  baseline_visits: 'Baseline',
  group_by: 'ARM'
};
async function openOverTime(page, { data = 'both', settings = {}, before = null, results } = {}) {
  await open(page, { data, before, settings: { ...OVER_TIME, ...settings } });
  if (results) {
    await page.evaluate(
      (given) =>
        window.__gc.chart.setSettings({
          connection: window.BioViz.r.createConnection({ results: given })
        }),
      storedOverTime(...results)
    );
  }
}
const testRow = (page) => page.locator('.bv-time-table tr[data-row="test"]');
const timeLine = (page) => page.locator('.bv-time-line');
// R's cell of one group at one visit.
const rCell = (rows, visit, level) =>
  rows.find((row) => row.visit === visit && row.level === level);
// Within a part in a thousand million: a standard error is a square root away
// from the numbers R and the browser agree on to the last place.
const close = (actual, expected, label) =>
  expect(Math.abs(actual - expected), label).toBeLessThanOrEqual(
    1e-9 * Math.max(1, Math.abs(expected))
  );

test.describe('group comparison: one biomarker over time', () => {
  test('GC-TIME-019: a biomarker opened from its tile is drawn across its visits in one picture on the kit’s Chart.js: visit along the bottom in visit order, the groups side by side in their colours as safety.viz’s boxes, and under each visit the number in each group; the boxes and the counts are desktop R’s (#85)', async ({
    page
  }) => {
    const errors = watch(page);
    await openTiles(page, { settings: { value_type: 'raw', group_by: 'ARM' } });
    await page.locator('.bv-tile[data-measure="IL-6"]').click();
    const found = await overTimeOf(page);
    expect(found.level).toBe('over-time');
    // One picture, not a panel a visit, drawn by the kit with its own box.
    expect(found.charts).toBe(1);
    expect(found.withKit).toBe(true);
    expect(found.plugins).toEqual(['gc-time-frame', 'gc-time-boxwhisker']);
    await expect(page.locator('.bv-panel')).toHaveCount(0);
    await expect(page.locator('.bv-tile')).toHaveCount(0);
    // Visit along the bottom, in visit order, each named under its place.
    expect(found.visits).toEqual(VISITS);
    expect(found.heads.map((head) => head.text)).toEqual(VISITS);
    expect(found.cells.map((column) => column.at)).toEqual([0, 1, 2, 3, 4]);
    // A group keeps one colour across the visits, and no line joins boxes.
    expect(found.groups.map((group) => [group.level, group.colour, group.joined])).toEqual([
      ['Placebo', COLOURS[0], false],
      ['Treatment', COLOURS[1], false]
    ]);
    // Side by side at each visit, within the visit's own part of the axis.
    for (const column of found.cells) {
      const [first, second] = column.cells.map((cell) => cell.x);
      expect(first, column.visit).toBeLessThan(column.at);
      expect(second, column.visit).toBeGreaterThan(column.at);
      expect(column.at - first, column.visit).toBeLessThan(0.5);
      expect(second - column.at, column.visit).toBeLessThan(0.5);
    }
    // Each box is desktop R's: its count, its five quantiles and its mean.
    const fromDesktop = rOverTime('IL-6', 'raw');
    for (const column of found.cells) {
      for (const cell of column.cells) {
        const expected = rCell(fromDesktop, column.visit, cell.level);
        expect(cell.n, `${column.visit} ${cell.level}`).toBe(expected.n);
        for (const key of ['q5', 'q25', 'median', 'q75', 'q95', 'mean']) {
          near(cell[key], expected[key], `${column.visit} ${cell.level} ${key}`);
        }
      }
    }
    // Under each visit, the number in each group: R's count, as text.
    expect(found.counts).toEqual(
      Object.fromEntries(
        ['Placebo', 'Treatment'].map((level) => [
          level,
          VISITS.map((visit) => `n = ${rCell(fromDesktop, visit, level).n}`)
        ])
      )
    );
    expect(found.counts.Placebo).toEqual(['n = 100', 'n = 92', 'n = 95', 'n = 93', 'n = 92']);
    // The key says what is drawn, the caption how a box is read, and the
    // picture is named for a reader who cannot see it.
    expect(found.key).toEqual(['Boxes of the result by ARM:', 'Placebo', 'Treatment']);
    expect(found.caption).toBe(
      'Each box runs from the 25th to the 75th percentile, with a line at the median and a dot at the mean; its whiskers end at the 5th and 95th percentiles.'
    );
    expect(found.yTitle).toBe('IL-6 (pg/mL)');
    expect(found.label).toBe(
      'IL-6 (pg/mL), boxes at Baseline, Week 2, Week 4, Week 8, Week 12: Placebo 8.103, 7.794, 8.062, 7.917, 7.925; Treatment 7.818, 6.461, 6.365, 6.368, 6.579'
    );
    expect(found.footnote).toBe(
      'Click a visit to view it alone, with its marks, a second grouping and pairwise comparisons.'
    );
    // The value axis holds every whisker.
    const all = found.cells.flatMap((column) => column.cells);
    expect(found.y[0]).toBeLessThan(Math.min(...all.map((cell) => cell.q5)));
    expect(found.y[1]).toBeGreaterThan(Math.max(...all.map((cell) => cell.q95)));
    // A visit's column of the table is under its place in the picture.
    const placed = await page.evaluate(() => {
      const [chart] = window.__gc.chart.charts;
      const canvas = chart.canvas.getBoundingClientRect();
      return [...document.querySelectorAll('.bv-time-table thead th[data-visit]')].map(
        (cell, at) => {
          const box = cell.getBoundingClientRect();
          return [(box.left + box.right) / 2, canvas.left + chart.scales.x.getPixelForValue(at)];
        }
      );
    });
    for (const [column, place] of placed) expect(Math.abs(column - place)).toBeLessThanOrEqual(2);
    expect(errors).toEqual([]);
    await captureEvidence(page.locator('.sv-multiples'), 'GC-TIME-019', 'il-6-over-time-boxes');
  });

  test('GC-TIME-020: drawn as means with standard errors, each group is a point at desktop R’s mean at each visit with a bar one standard error either side, joined across the visits by a line in the group’s colour (#85)', async ({
    page
  }) => {
    await openOverTime(page);
    await choose(page, 'time-mark', 'mean_se');
    const found = await overTimeOf(page);
    expect(found.plugins).toEqual(['gc-time-frame', 'gc-time-bars']);
    expect(found.groups.map((group) => [group.level, group.colour, group.joined])).toEqual([
      ['Placebo', COLOURS[0], true],
      ['Treatment', COLOURS[1], true]
    ]);
    const fromDesktop = rOverTime('IL-6', 'raw');
    for (const group of found.groups) {
      expect(group.points.map((point) => point.visit)).toEqual(VISITS);
      expect(group.radius).toBeGreaterThan(0);
      for (const point of group.points) {
        const expected = rCell(fromDesktop, point.visit, group.level);
        const where = `${point.visit} ${group.level}`;
        near(point.y, expected.mean, where);
        close(point.lower, expected.mean - expected.se, `${where} lower`);
        close(point.upper, expected.mean + expected.se, `${where} upper`);
      }
    }
    // The standard error is R's: sd(x) / sqrt(n).
    for (const column of found.cells) {
      for (const cell of column.cells) {
        close(cell.se, rCell(fromDesktop, column.visit, cell.level).se, column.visit);
      }
    }
    expect(found.key[0]).toBe('Mean and standard error of the result by ARM:');
    expect(found.caption).toBe(
      'Each point is a group’s mean at a visit, and its bar reaches one standard error either side: the standard deviation over the square root of the number in the group.'
    );
    expect(found.label).toBe(
      'IL-6 (pg/mL), means with standard errors at Baseline, Week 2, Week 4, Week 8, Week 12: Placebo 7.941, 7.874, 8.006, 7.989, 8.073; Treatment 7.689, 6.348, 6.462, 6.411, 6.476'
    );
    // The value axis is the bars', closer than the boxes' whiskers.
    const ends = found.groups.flatMap((group) => group.points);
    expect(found.y[0]).toBeLessThan(Math.min(...ends.map((point) => point.lower)));
    expect(found.y[1]).toBeGreaterThan(Math.max(...ends.map((point) => point.upper)));
    expect(found.y[1] - found.y[0]).toBeLessThan(4);
    // The counts under the visits are the same whatever is drawn.
    expect(found.counts.Treatment).toEqual(['n = 100', 'n = 93', 'n = 91', 'n = 95', 'n = 92']);
    await captureEvidence(page.locator('.sv-multiples'), 'GC-TIME-020', 'il-6-over-time-means');
  });

  test('GC-TIME-021: drawn as medians with quartiles, each group is a point at desktop R’s median with a bar from the 25th to the 75th percentile, joined by a line; `time_mark` opens the chart on a form, the control reads it, and a change from baseline starts every group at nought (#85)', async ({
    page
  }) => {
    await openOverTime(page, { settings: { time_mark: 'median_iqr' } });
    await expect(page.locator('select[data-control="time-mark"]')).toHaveValue('median_iqr');
    let found = await overTimeOf(page);
    expect(found.plugins).toEqual(['gc-time-frame', 'gc-time-bars']);
    const check = (rows) => {
      for (const group of found.groups) {
        expect(group.joined).toBe(true);
        expect(group.points.map((point) => point.visit)).toEqual(VISITS);
        for (const point of group.points) {
          const expected = rCell(rows, point.visit, group.level);
          const where = `${point.visit} ${group.level}`;
          near(point.y, expected.median, where);
          near(point.lower, expected.q25, `${where} lower`);
          near(point.upper, expected.q75, `${where} upper`);
        }
      }
    };
    check(rOverTime('IL-6', 'raw'));
    expect(found.key[0]).toBe('Median and quartiles of the result by ARM:');
    expect(found.caption).toBe(
      'Each point is a group’s median at a visit, and its bar reaches from the 25th to the 75th percentile.'
    );
    // The change from baseline: at the baseline visit every group is at nought.
    await choose(page, 'value-type', 'change');
    found = await overTimeOf(page);
    check(rOverTime('IL-6', 'change'));
    for (const group of found.groups) {
      expect(group.points[0]).toMatchObject({ visit: 'Baseline', y: 0, lower: 0, upper: 0 });
    }
    expect(found.key[0]).toBe('Median and quartiles of the change from baseline by ARM:');
    expect(found.yTitle).toBe('IL-6, change from baseline (pg/mL)');
    // The form is the reader's until changed: another biomarker keeps it.
    await choose(page, 'measure', 'CRP');
    found = await overTimeOf(page);
    expect(found.level).toBe('over-time');
    await expect(page.locator('select[data-control="time-mark"]')).toHaveValue('median_iqr');
    check(rOverTime('CRP', 'change'));
    await captureEvidence(page.locator('.sv-multiples'), 'GC-TIME-021', 'crp-over-time-medians');
  });

  test('GC-TIME-022: under each visit the row of tests prints the p-value desktop R returns for that visit, from one request for the whole row; the Adjust across visits switch asks R again and prints R’s adjusted p-values, and the row’s heading and the line under it name the adjustment R made (#85)', async ({
    page
  }) => {
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await openOverTime(page, {
      results: [
        'over-time-result',
        'over-time-result-holm',
        'over-time-result-bh',
        'over-time-age-40-to-43',
        'over-time-age-40-to-43-unadjusted'
      ]
    });
    // What R returned for the rows, and what R gives for each visit asked
    // about alone, with p.adjust() across them (tools/r-group-statistics.R).
    const held = async (name, heading, said) => {
      const expected = overTimeResult(name);
      const found = await overTimeOf(page);
      // One request, with the key desktop R wrote, answered from what it stored.
      expect(found.statistics, name).toHaveLength(1);
      const [asked] = found.statistics;
      expect({
        name: asked.name,
        args: asked.args,
        dataId: asked.dataId,
        rows: asked.rows
      }).toEqual({
        name: 'Analyze_GroupDifferenceBy',
        args: expected.args,
        dataId: expected.dataId,
        rows: expected.rows
      });
      expect(asked.answer.form).toBe('precomputed');
      expect(found.test.head).toBe('Welch t-test');
      expect(found.test.sub, name).toBe(heading);
      expect(found.test.cells.map((cell) => cell.visit)).toEqual(VISITS);
      expected.value.rows.forEach((row, at) => {
        const cell = found.test.cells[at];
        expect(row.by).toBe(VISITS[at]);
        if (row.status !== 'ok') {
          expect(cell.text, `${name} ${row.by}`).toBe('not computed');
          return;
        }
        // R's p-value for the visit, by the shared rule; and it is the one R
        // gives for that visit alone, adjusted by p.adjust() across the visits.
        const alone = expected.separately.visits.indexOf(row.by);
        close(row.p_unadjusted, expected.separately.p_unadjusted[alone], `${name} ${row.by}`);
        close(row.p_value, expected.separately.p_value[alone], `${name} ${row.by} adjusted`);
        expect(cell.status).toBe('shown');
        expect(cell.text, `${name} ${row.by}`).toBe(printedP(row.p_value));
        // The cell's title is the whole sentence: the method, both p-values
        // where R adjusted, and each group's count.
        expect(cell.title).toContain(`${row.by}: Welch Two Sample t-test: `);
        expect(cell.title).toContain(printedP(row.p_unadjusted));
        expect(cell.title).toContain(`Placebo n = ${row.n_1}, Treatment n = ${row.n_2}`);
      });
      expect(found.line.result, name).toBe(said);
      expect(found.line.state).toBe('shown');
      return found;
    };
    let found = await held(
      'over-time-result',
      'p, unadjusted',
      'Welch Two Sample t-test at each visit, on the participants drawn there: 5 visits tested. Exploratory, unadjusted.'
    );
    expect(found.test.cells.map((cell) => cell.text)).toEqual([
      'p = 0.221',
      'p < 0.001',
      'p < 0.001',
      'p < 0.001',
      'p < 0.001'
    ]);
    expect(found.line.scope).toBe(
      'Each visit has a test of its own, of the levels of ARM on the participants drawn at that visit.'
    );
    // R's own remarks on its answer are printed as R wrote them.
    expect(found.line.remarks).toEqual(
      overTimeResult('over-time-result').value.notes.map((note) => `R’s note: ${note}`)
    );

    // The switch: R is asked again, for the adjustment by its p.adjust() name.
    await choose(page, 'visit-adjustment', 'holm');
    found = await held(
      'over-time-result-holm',
      'p, adjusted (Holm)',
      'Welch Two Sample t-test at each visit, on the participants drawn there: 5 visits tested. Exploratory, adjusted (Holm) across 5 visits.'
    );
    expect(found.statistics[0].args.strPAdjust).toBe('holm');
    expect(found.test.cells[0].title).toBe(
      'Baseline: Welch Two Sample t-test: p = 0.221 unadjusted, p = 0.221 adjusted across 5 visits (Placebo n = 100, Treatment n = 100). Exploratory, adjusted (Holm).'
    );
    await choose(page, 'visit-adjustment', 'BH');
    found = await held(
      'over-time-result-bh',
      'p, adjusted (Benjamini-Hochberg)',
      'Welch Two Sample t-test at each visit, on the participants drawn there: 5 visits tested. Exploratory, adjusted (Benjamini-Hochberg) across 5 visits.'
    );
    expect(found.statistics[0].args.strPAdjust).toBe('BH');
    await captureEvidence(
      page.locator('.sv-multiples'),
      'GC-TIME-022',
      'tests-under-the-visits-adjusted'
    );

    // Among the participants aged 40 to 43 the p-values are not small, so the
    // adjustment shows in print: each visit's own p-value, then R's adjusted
    // one in its place. The filter is the demo's own, set as a reader would.
    await page.evaluate(() =>
      window.__gc.chart.setSettings({
        visit_adjustment: 'none',
        filters: [{ value_col: 'AGE', multiple: true, start: ['40', '41', '42', '43'] }]
      })
    );
    found = await overTimeOf(page);
    expect(found.statistics[0].dataId).toEqual(
      overTimeResult('over-time-age-40-to-43-unadjusted').dataId
    );
    expect(found.test.sub).toBe('p, unadjusted');
    expect(found.test.cells.map((cell) => cell.text)).toEqual([
      'p = 0.959',
      'not computed',
      'p = 0.635',
      'not computed',
      'p = 0.193'
    ]);
    await choose(page, 'visit-adjustment', 'holm');
    found = await overTimeOf(page);
    expect(found.test.sub).toBe('p, adjusted (Holm)');
    expect(found.test.cells.map((cell) => cell.text)).toEqual([
      'p > 0.999',
      'not computed',
      'p > 0.999',
      'not computed',
      'p = 0.579'
    ]);
    const adjusted = overTimeResult('over-time-age-40-to-43');
    expect(
      adjusted.value.rows.filter((row) => row.status === 'ok').map((row) => printedP(row.p_value))
    ).toEqual(['p > 0.999', 'p > 0.999', 'p = 0.579']);
    expect(found.test.cells[4].title).toBe(
      'Week 12: Welch Two Sample t-test: p = 0.193 unadjusted, p = 0.579 adjusted across 3 visits (Placebo n = 5, Treatment n = 5). Exploratory, adjusted (Holm).'
    );
    // No R ran here, and none was fetched: every answer was stored.
    expect(requests.filter(isRHost)).toEqual([]);
  });

  test('GC-TIME-023: the row of tests waits until R answers and then prints each visit’s p-value with the adjustment R names; a change to the test, the adjustment or a filter clears the row and asks again, in one request, and the answer to the question before is never shown (#85)', async ({
    page
  }) => {
    await openOverTime(page, { before: stubR });
    await attachStub(page);
    const row = testRow(page);
    await expect(row).toHaveAttribute('data-state', 'waiting');
    await expect(row.locator('td[colspan]')).toHaveText('Waiting for R…');
    await expect(row.locator('td[colspan]')).toHaveAttribute('colspan', '5');
    await expect(timeLine(page)).toHaveAttribute('data-state', 'waiting');
    await expect(timeLine(page)).toContainText(WAITING);
    // The picture and the counts are drawn while R is asked.
    expect((await overTimeOf(page)).counts.Placebo).toHaveLength(5);
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(1);
    // One request for the whole row: the rows of every visit, by their fields.
    expect((await calls(page))[0]).toEqual({
      name: 'Analyze_GroupDifferenceBy',
      rows: 943,
      args: {
        strValueCol: 'y',
        strGroupCol: 'x',
        strByCol: 'visit',
        strMethod: 't',
        chrBy: VISITS,
        strPAdjust: 'none'
      },
      fields: ['USUBJID', 'y', 'x', 'visit'],
      counts: { Placebo: 472, Treatment: 471 }
    });
    await page.evaluate(() => window.__r.answerVisits(0, [0.5, 0.04, 0.03, 0.0004, 0.9996]));
    await expect(row).toHaveAttribute('data-state', 'shown');
    await expect(row.locator('td[data-visit]')).toHaveText([
      'p = 0.500',
      'p = 0.040',
      'p = 0.030',
      'p < 0.001',
      'p > 0.999'
    ]);
    await expect(row.locator('.bv-time-sub')).toHaveText('p, unadjusted');

    const changes = [
      {
        what: 'the test',
        make: () => choose(page, 'test', 'wilcoxon'),
        asked: { strMethod: 'wilcoxon', strPAdjust: 'none' },
        sub: 'p, unadjusted'
      },
      {
        what: 'the adjustment',
        make: () => choose(page, 'visit-adjustment', 'holm'),
        asked: { strMethod: 'wilcoxon', strPAdjust: 'holm' },
        sub: 'p, adjusted (Holm)'
      },
      {
        what: 'a filter',
        make: () => page.locator('select[data-filter="SEX"]').selectOption('F'),
        asked: { strMethod: 'wilcoxon', strPAdjust: 'holm' },
        sub: 'p, adjusted (Holm)'
      }
    ];
    let asked = 1;
    for (const change of changes) {
      await change.make();
      await expect(row, change.what).toHaveAttribute('data-state', 'waiting');
      await expect(row.locator('td[colspan]'), change.what).toHaveText('Waiting for R…');
      await expect
        .poll(() => page.evaluate(() => window.__r.calls.length), { message: change.what })
        .toBe(asked + 1);
      expect((await calls(page))[asked].args, change.what).toMatchObject(change.asked);
      // Drawn again before R answers: one more question, for the same view.
      await page.evaluate(() => window.__gc.chart.render());
      await expect
        .poll(() => page.evaluate(() => window.__r.calls.length), { message: change.what })
        .toBe(asked + 2);
      // The first of the two answers late, with numbers that would be wrong here.
      await page.evaluate(
        (index) => window.__r.answerVisits(index, [0.111, 0.111, 0.111, 0.111, 0.111]),
        asked
      );
      await page.waitForTimeout(50);
      await expect(row, change.what).toHaveAttribute('data-state', 'waiting');
      await expect(page.locator('.sv-main'), change.what).not.toContainText('0.111');
      await page.evaluate(
        (index) => window.__r.answerVisits(index, [0.25, 0.25, 0.25, 0.25, 0.25]),
        asked + 1
      );
      await expect(row.locator('td[data-visit]'), change.what).toHaveText(
        VISITS.map(() => 'p = 0.250')
      );
      await expect(row.locator('.bv-time-sub'), change.what).toHaveText(change.sub);
      asked += 2;
    }
    // After the filter the rows asked about are the women's.
    expect((await calls(page))[asked - 1].rows).toBeLessThan(943);
    await expect(row.locator('.bv-time-head')).toContainText('Wilcoxon rank-sum test');
  });

  test('GC-TIME-024: for a change from baseline the baseline visit is drawn, where every group starts at nought, and is not tested: its name is not a button, its cell reads not tested, its rows are not sent to R, and the notes and the line say why (#85)', async ({
    page
  }) => {
    await openOverTime(page, {
      settings: { value_type: 'change' },
      results: ['over-time-change', 'over-time-change-holm', 'over-time-change-wilcoxon']
    });
    const expected = overTimeResult('over-time-change');
    let found = await overTimeOf(page);
    expect(found.visits).toEqual(VISITS);
    expect(found.tested).toEqual(VISITS.slice(1));
    // Drawn: every group at nought, with everyone who has a baseline.
    for (const cell of found.cells[0].cells) {
      expect(cell).toMatchObject({ n: 100, median: 0, q25: 0, q75: 0, mean: 0 });
    }
    expect(found.counts.Placebo[0]).toBe('n = 100');
    // Not a way into a view that would draw nothing.
    expect(found.heads.map((head) => [head.visit, head.button])).toEqual([
      ['Baseline', false],
      ['Week 2', true],
      ['Week 4', true],
      ['Week 8', true],
      ['Week 12', true]
    ]);
    // Not sent: R is asked about the four later visits, on their rows alone.
    expect(found.statistics).toHaveLength(1);
    expect(found.statistics[0].args).toEqual(expected.args);
    expect(found.statistics[0].args.chrBy).toEqual(VISITS.slice(1));
    expect(found.statistics[0].dataId).toEqual(expected.dataId);
    expect(found.statistics[0].dataId.visits).toEqual(VISITS.slice(1));
    expect(found.statistics[0].rows).toBe(743);
    expect(found.statistics[0].rows).toBe(
      found.cells
        .slice(1)
        .flatMap((column) => column.cells)
        .reduce((total, cell) => total + cell.n, 0)
    );
    expect(found.statistics[0].answer.value.rows.map((row) => row.by)).toEqual(VISITS.slice(1));
    // Its cell says so, and the others hold R's p-values.
    expect(found.test.cells[0]).toMatchObject({
      visit: 'Baseline',
      status: 'untested',
      text: 'not tested',
      title:
        'Baseline is the baseline visit: there the change from baseline is the same for everyone.'
    });
    expect(found.test.cells.slice(1).map((cell) => cell.text)).toEqual(
      expected.value.rows.map((row) => printedP(row.p_value))
    );
    await expect(page.locator('.sv-notes')).toContainText(
      'Baseline visit: Baseline. It is not tested: there the change from baseline is the same for everyone.'
    );
    expect(found.line.result).toBe(
      'Welch Two Sample t-test at each visit, on the participants drawn there: 4 visits tested. Exploratory, unadjusted.'
    );
    expect(found.line.scope).toBe(
      'Each visit has a test of its own, of the levels of ARM on the participants drawn at that visit. ' +
        'Baseline is not tested: it is the baseline visit, where the change from baseline is the same for everyone.'
    );
    // A click in its part of the picture opens nothing; in another, that visit.
    const at = (visit) =>
      page.evaluate((index) => {
        const [chart] = window.__gc.chart.charts;
        const box = chart.canvas.getBoundingClientRect();
        return {
          x: box.left + chart.scales.x.getPixelForValue(index),
          y: box.top + (chart.chartArea.top + chart.chartArea.bottom) / 2
        };
      }, VISITS.indexOf(visit));
    let point = await at('Baseline');
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(100);
    expect(await page.locator('.sv-root').getAttribute('data-level')).toBe('over-time');
    // Adjusted, the adjustment is across the four visits tested.
    await choose(page, 'visit-adjustment', 'holm');
    found = await overTimeOf(page);
    expect(found.test.sub).toBe('p, adjusted (Holm)');
    expect(found.line.result).toBe(
      'Welch Two Sample t-test at each visit, on the participants drawn there: 4 visits tested. Exploratory, adjusted (Holm) across 4 visits.'
    );
    expect(found.statistics[0].answer.value.rows.map((row) => row.adjusted_over)).toEqual([
      4, 4, 4, 4
    ]);
    await captureEvidence(
      page.locator('.sv-multiples'),
      'GC-TIME-024',
      'change-from-baseline-over-time'
    );
    point = await at('Week 8');
    await page.mouse.click(point.x, point.y);
    await expect(page.locator('.sv-root')).toHaveAttribute('data-level', 'visits');
    await expect(page.locator('[data-control="visits"] summary')).toHaveText('1 of 5');
    await expect(page.locator('[data-control="visits"] input[value="Week 8"]')).toBeChecked();
    await expect(page.locator('.sv-chart-wrap canvas')).toHaveAttribute(
      'aria-label',
      /^IL-6 at Week 8, change from baseline/
    );
  });

  test('GC-TIME-025: with no R attached the picture and the counts are drawn all the same, the row of tests says that statistics are unavailable and nothing is fetched; with no test chosen, or one group, R is not asked and the row says so (#85)', async ({
    page
  }) => {
    const errors = watch(page);
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await openOverTime(page);
    let found = await overTimeOf(page);
    expect(found.charts).toBe(1);
    expect(found.groups.map((group) => group.points.length)).toEqual([5, 5]);
    expect(found.counts.Placebo).toEqual(['n = 100', 'n = 92', 'n = 95', 'n = 93', 'n = 92']);
    expect(found.test).toMatchObject({
      state: 'unavailable',
      head: 'Welch t-test',
      sub: 'p-value'
    });
    expect(found.test.cells).toEqual([
      { visit: null, status: null, text: 'Statistics unavailable', title: null, span: 5 }
    ]);
    expect(found.line).toMatchObject({
      state: 'unavailable',
      result: 'Statistics are unavailable: no R is attached to this chart.'
    });
    // What it would have asked is still on record, with no answer of R's.
    expect(found.statistics).toHaveLength(1);
    expect(found.statistics[0].answer.status).toBe('unavailable');
    const statisticsButton = page.locator('.bv-downloads button[data-download="statistics"]');
    await expect(statisticsButton).toBeDisabled();
    await expect(statisticsButton).toHaveAttribute(
      'title',
      'R returned no statistics for this view.'
    );
    await captureEvidence(page.locator('.sv-multiples'), 'GC-TIME-025', 'over-time-with-no-r');

    // No test chosen: R is not asked.
    await choose(page, 'test', 'none');
    found = await overTimeOf(page);
    expect(found.test).toMatchObject({ state: 'none', head: 'Test' });
    expect(found.test.cells[0].text).toBe('No test chosen');
    expect(found.line.result).toBe('Statistics: no test chosen.');
    expect(found.statistics).toEqual([]);
    await expect(page.locator('select[data-control="visit-adjustment"]')).toBeDisabled();
    await expect(statisticsButton).toHaveCount(0);
    // One group: nothing to compare.
    await choose(page, 'test', 't');
    await page.locator('select[data-filter="ARM"]').selectOption('Placebo');
    found = await overTimeOf(page);
    expect(found.groups.map((group) => group.level)).toEqual(['Placebo']);
    expect(found.test.state).toBe('none');
    expect(found.test.cells).toHaveLength(1);
    expect(found.test.cells[0].text).toBe('No test');
    expect(found.line.result).toBe(
      'Statistics: no test. A test compares two or more groups, and only Placebo has values.'
    );
    expect(found.statistics).toEqual([]);
    expect(requests.filter((url) => /webr|r-wasm|statistics\.R/.test(url))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('GC-TIME-026: a visit’s name in the table is a button that opens that visit alone, by a click or by the keyboard, as the released single-visit view with its own question for R; the trail above the chart names the level drawn and leads back, as All in the Visit control does (#85)', async ({
    page
  }) => {
    const errors = watch(page);
    await openOverTime(page, {
      settings: { value_type: 'change' },
      results: ['over-time-change']
    });
    await page.evaluate(
      (results) =>
        window.__gc.chart.setSettings({
          connection: window.BioViz.r.createConnection({ results })
        }),
      [...storedOverTime('over-time-change'), ...stored('welch')]
    );
    let found = await overTimeOf(page);
    // The trail: where the reader is, and the way back to every biomarker.
    expect(found.trail).toEqual([
      { text: 'All biomarkers', button: true },
      { text: 'IL-6 over time', button: false }
    ]);
    await expect(page.locator('.bv-trail')).toHaveAttribute('aria-label', 'Where this view is');
    await expect(page.locator('.bv-trail [aria-current="true"]')).toHaveText('IL-6 over time');
    expect(found.heads[2]).toEqual({
      visit: 'Week 4',
      button: true,
      label: 'View IL-6 at Week 4',
      text: 'Week 4'
    });

    // A click on Week 4: the single-visit view, as it was released.
    await page.locator('button.bv-time-visit[data-visit="Week 4"]').click();
    await expect(page.locator('.sv-root')).toHaveAttribute('data-level', 'visits');
    await expect(page.locator('.bv-time-table')).toHaveCount(0);
    await expect(page.locator('.sv-chart-wrap canvas')).toHaveAttribute(
      'aria-label',
      'IL-6 at Week 4, change from baseline (pg/mL): Placebo n = 95; Treatment n = 91'
    );
    const [panel] = await drawn(page);
    expect(panel.plugins).toContain('gc-boxwhisker');
    expect(panel.ticks.map((tick) => tick[1])).toEqual(['n = 95', 'n = 91']);
    await expect(page.locator('[data-control="visits"] summary')).toHaveText('1 of 5');
    await expect(page.locator('[data-control="visits"] input[value="Week 4"]')).toBeChecked();
    // The keyboard's place is on the Visit control, where the way back is.
    await expect(page.locator('[data-control="visits"] summary')).toBeFocused();
    // Its own question, with the key the single-visit view always asked with.
    const asked = await page.evaluate(() => window.__gc.chart.statistics());
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      name: 'Analyze_GroupDifference',
      args: resultOf('welch').args,
      dataId: resultOf('welch').dataId,
      rows: 186
    });
    await expect(page.locator('.sv-main > .bv-statistic .bv-stat-result')).toHaveText(
      'Welch Two Sample t-test: p < 0.001 (Placebo n = 95, Treatment n = 91). Exploratory, unadjusted.'
    );
    // Its marks, its second grouping and its pairwise switch apply there.
    for (const control of ['color-by', 'panel-by', 'mark']) {
      await expect(page.locator(`select[data-control="${control}"]`)).toBeEnabled();
    }
    await expect(page.locator('select[data-control="time-mark"]')).toHaveCount(0);
    await expect(page.locator('select[data-control="visit-adjustment"]')).toHaveCount(0);
    // The trail names the visit, and its middle step leads back.
    await expect(page.locator('.bv-trail li')).toHaveText([
      'All biomarkers',
      'IL-6 over time',
      'Week 4'
    ]);
    await expect(page.locator('.bv-trail [aria-current="true"]')).toHaveText('Week 4');
    await page.locator('.bv-trail button', { hasText: 'IL-6 over time' }).click();
    found = await overTimeOf(page);
    expect(found.level).toBe('over-time');
    expect(found.visits).toEqual(VISITS);
    await expect(page.locator('[data-control="visits"] summary')).toHaveText('All (5)');
    expect(found.test.cells.map((cell) => cell.status)).toEqual([
      'untested',
      'shown',
      'shown',
      'shown',
      'shown'
    ]);

    // By the keyboard: the button takes the focus, and Enter opens the visit.
    await page.locator('button.bv-time-visit[data-visit="Week 12"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.sv-root')).toHaveAttribute('data-level', 'visits');
    await expect(page.locator('[data-control="visits"] input[value="Week 12"]')).toBeChecked();
    expect((await drawn(page))[0].ticks.map((tick) => tick[1])).toEqual(['n = 92', 'n = 92']);
    // Back by the Visit control: All ticks every visit, and the picture returns.
    await page.locator('[data-control="visits"] summary').click();
    await page.locator('[data-control="visits"] .sv-ms-all input').check();
    await expect(page.locator('.sv-root')).toHaveAttribute('data-level', 'over-time');
    await expect(page.locator('.bv-time-table')).toHaveCount(1);
    // The control stays open under the reader's hand, to untick a visit again.
    await expect(page.locator('[data-control="visits"]')).toHaveAttribute('open', '');
    // Some of the visits, not all: a panel each, the view between the two.
    await page.locator('[data-control="visits"] input[value="Week 2"]').uncheck();
    await expect(page.locator('.sv-root')).toHaveAttribute('data-level', 'visits');
    await expect(page.locator('.bv-panel h3')).toHaveText(['Week 4', 'Week 8', 'Week 12']);
    await expect(page.locator('.bv-trail li')).toHaveText([
      'All biomarkers',
      'IL-6 over time',
      'Baseline, Week 4, Week 8, Week 12'
    ]);
    // And the first step of the trail leads to every biomarker.
    await page.locator('.bv-trail button', { hasText: 'All biomarkers' }).click();
    await expect(page.locator('.bv-tile')).toHaveCount(12);
    await expect(page.locator('.bv-trail')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('GC-TIME-027: over time, Colour by and Panel by are switched off and say where they apply, Draw as offers the three forms, and Statistics offers the test and the adjustment across visits and no pairwise switch; Group by, Levels, Value, Scale and the filters apply to the picture and its table (#85)', async ({
    page
  }) => {
    await openOverTime(page, { data: 'arm-sex' });
    for (const control of ['color-by', 'panel-by']) {
      const select = page.locator(`select[data-control="${control}"]`);
      await expect(select).toBeDisabled();
      expect(await select.evaluate((element) => element.nextElementSibling.textContent)).toBe(
        'Applies once a biomarker and a visit are open.'
      );
    }
    await expect(page.locator('.bv-control-note')).toHaveCount(2);
    const options = (control) =>
      page
        .locator(`select[data-control="${control}"] option`)
        .evaluateAll((all) => all.map((option) => [option.value, option.textContent]));
    expect(await options('time-mark')).toEqual([
      ['box', 'Boxes'],
      ['mean_se', 'Means with standard errors'],
      ['median_iqr', 'Medians with quartiles']
    ]);
    await expect(page.locator('select[data-control="mark"]')).toHaveCount(0);
    expect(await options('test')).toEqual([
      ['t', 'Welch t-test'],
      ['wilcoxon', 'Wilcoxon rank-sum test'],
      ['none', 'None']
    ]);
    expect(await options('visit-adjustment')).toEqual([
      ['none', 'None'],
      ['holm', 'Holm'],
      ['BH', 'Benjamini-Hochberg']
    ]);
    expect(
      await page
        .locator('select[data-control="visit-adjustment"]')
        .evaluate((select) => select.parentElement.querySelector('label').textContent)
    ).toBe('Adjust across visits');
    await expect(page.locator('input[data-control="pairwise"]')).toHaveCount(0);

    // Group by: four groups side by side, and the tests that fit four.
    await choose(page, 'group-by', 'ARM_SEX');
    let found = await overTimeOf(page);
    expect(found.groups.map((group) => group.level)).toEqual([
      'Placebo F',
      'Placebo M',
      'Treatment F',
      'Treatment M'
    ]);
    expect(Object.keys(found.counts)).toEqual([
      'Placebo F',
      'Placebo M',
      'Treatment F',
      'Treatment M'
    ]);
    expect(await options('test')).toEqual([
      ['anova', 'One-way ANOVA'],
      ['kruskal', 'Kruskal-Wallis test'],
      ['none', 'None']
    ]);
    expect(found.statistics[0].args.strMethod).toBe('anova');
    for (const column of found.cells) {
      const xs = column.cells.map((cell) => cell.x);
      expect([...xs].sort((a, b) => a - b)).toEqual(xs);
      expect(xs[3] - xs[0]).toBeLessThan(1);
    }
    // Levels: the ones left keep their colours, and a row of counts each.
    await page.evaluate(() =>
      window.__gc.chart.setSettings({ levels: ['Placebo M', 'Treatment M'] })
    );
    found = await overTimeOf(page);
    expect(found.groups.map((group) => group.level)).toEqual(['Placebo M', 'Treatment M']);
    expect(found.key).toEqual(['Boxes of the result by ARM_SEX:', 'Placebo M', 'Treatment M']);
    expect(found.counts['Placebo M']).toEqual(['n = 56', 'n = 51', 'n = 53', 'n = 51', 'n = 51']);
    await expect(page.locator('.sv-notes')).toContainText('2 of 4 levels shown.');
    expect(found.statistics[0].args.strMethod).toBe('t');
    // Value and Scale.
    await choose(page, 'y-scale', 'log');
    found = await overTimeOf(page);
    expect(found.yType).toBe('logarithmic');
    expect(found.y[0]).toBeGreaterThan(0);
    await choose(page, 'value-type', 'percent_change');
    found = await overTimeOf(page);
    expect(found.yTitle).toBe('IL-6, percent change from baseline (%)');
    expect(found.tested).toEqual(VISITS.slice(1));
    // A filter: fewer in each count, and R asked about the rows left.
    const before = found.statistics[0].rows;
    await page.locator('select[data-filter="RESPONSE"]').selectOption('Responder');
    found = await overTimeOf(page);
    expect(found.statistics[0].rows).toBeLessThan(before);
    expect(found.statistics[0].dataId.filters).toEqual({ RESPONSE: ['Responder'] });
    // A baseline value has no visit, so no picture over time: one chart.
    await choose(page, 'value-type', 'baseline');
    await expect(page.locator('.sv-root')).toHaveAttribute('data-level', 'visits');
    await expect(page.locator('.bv-time-table')).toHaveCount(0);
    await expect(page.locator('.bv-trail li')).toHaveText([
      'All biomarkers',
      'IL-6, baseline value'
    ]);
  });

  test('GC-TIME-028: a visit R did not compute reads not computed in its cell, with R’s reason in the cell’s title and under the table, and R’s adjustment is across the visits that have a p-value; when R computes none, every cell says so and the line gives R’s reason (#85)', async ({
    page
  }) => {
    await openOverTime(page, {
      settings: {
        visit_adjustment: 'holm',
        filters: [{ value_col: 'AGE', multiple: true, start: ['40', '41', '42', '43'] }]
      },
      results: ['over-time-age-40-to-43', 'over-time-age-57']
    });
    const some = overTimeResult('over-time-age-40-to-43');
    let found = await overTimeOf(page);
    expect(found.statistics[0].dataId).toEqual(some.dataId);
    // Every visit is sent, and R says which it did not compute, and why.
    expect(found.statistics[0].args.chrBy).toEqual(VISITS);
    expect(some.value.rows.map((row) => row.status)).toEqual([
      'ok',
      'too_small',
      'ok',
      'too_small',
      'ok'
    ]);
    expect(found.test.state).toBe('shown');
    expect(found.test.cells.map((cell) => [cell.visit, cell.status, cell.text])).toEqual([
      ['Baseline', 'shown', 'p > 0.999'],
      ['Week 2', 'withheld', 'not computed'],
      ['Week 4', 'shown', 'p > 0.999'],
      ['Week 8', 'withheld', 'not computed'],
      ['Week 12', 'shown', 'p = 0.579']
    ]);
    // The picture and the counts hold the small groups all the same.
    expect(found.counts).toEqual({
      Placebo: ['n = 5', 'n = 4', 'n = 5', 'n = 3', 'n = 5'],
      Treatment: ['n = 6', 'n = 6', 'n = 6', 'n = 5', 'n = 5']
    });
    // R's reason, as R wrote it, with R's counts.
    const reasons = some.value.rows
      .filter((row) => row.status !== 'ok')
      .map(
        (row) =>
          `${row.by}: ${row.reason} Counts: Placebo n = ${row.n_1}, Treatment n = ${row.n_2}.`
      );
    expect(reasons).toEqual([
      'Week 2: Not computed: Placebo has 4. The minimum group size is 5. Counts: Placebo n = 4, Treatment n = 6.',
      'Week 8: Not computed: Placebo has 3. The minimum group size is 5. Counts: Placebo n = 3, Treatment n = 5.'
    ]);
    expect(found.line.levels).toEqual(reasons);
    expect([found.test.cells[1].title, found.test.cells[3].title]).toEqual(reasons);
    // The adjustment is R's, across the three visits it computed.
    expect(found.line.result).toBe(
      'Welch Two Sample t-test at each visit, on the participants drawn there: 3 visits tested. Exploratory, adjusted (Holm) across 3 visits.'
    );
    expect(
      some.value.rows.filter((row) => row.status === 'ok').map((row) => row.adjusted_over)
    ).toEqual([3, 3, 3]);
    expect(found.line.scope).toBe(
      'Each visit has a test of its own, of the levels of ARM on the participants drawn at that visit. Filters: AGE is 40 or 41 or 42 or 43.'
    );
    await captureEvidence(page.locator('.sv-multiples'), 'GC-TIME-028', 'visits-r-did-not-compute');

    // Aged 57: an arm is below R's minimum at every visit.
    await page.evaluate(() =>
      window.__gc.chart.setSettings({ filters: [{ value_col: 'AGE', start: '57' }] })
    );
    const none = overTimeResult('over-time-age-57');
    found = await overTimeOf(page);
    expect(found.statistics[0].dataId).toEqual(none.dataId);
    expect(found.test.state).toBe('withheld');
    expect(found.test.cells.map((cell) => cell.text)).toEqual(VISITS.map(() => 'not computed'));
    expect(found.test.sub).toBe('p, unadjusted');
    expect(found.line.state).toBe('withheld');
    expect(found.line.result).toContain(none.value.reason);
    expect(found.line.levels).toEqual(
      none.value.rows.map(
        (row) =>
          `${row.by}: ${row.reason} Counts: Placebo n = ${row.n_1}, Treatment n = ${row.n_2}.`
      )
    );
    await expect(page.locator('.sv-main')).not.toContainText('p =');
    // The picture is drawn: seven and two are still a box and a box.
    expect(found.charts).toBe(1);
    expect(found.counts.Treatment).toEqual(['n = 2', 'n = 1', 'n = 1', 'n = 2', 'n = 2']);
  });

  test('GC-TIME-029: with more than two groups the row of tests is the several-group test desktop R returns at each visit, a one-way ANOVA or a Kruskal-Wallis test, adjusted across the visits when asked (#85)', async ({
    page
  }) => {
    await openOverTime(page, {
      data: 'arm-sex',
      settings: { group_by: 'ARM_SEX', test: 'anova' },
      results: ['over-time-anova', 'over-time-kruskal-holm']
    });
    const anova = overTimeResult('over-time-anova');
    let found = await overTimeOf(page);
    expect(found.statistics[0]).toMatchObject({
      name: 'Analyze_GroupDifferenceBy',
      args: anova.args,
      dataId: anova.dataId,
      rows: 943
    });
    expect(found.groups).toHaveLength(4);
    expect(found.test.head).toBe('One-way ANOVA');
    expect(found.test.cells.map((cell) => cell.text)).toEqual(
      anova.value.rows.map((row) => printedP(row.p_value))
    );
    expect(found.test.cells[0].text).toBe('p = 0.436');
    expect(found.test.cells[0].title).toBe(
      'Baseline: One-way analysis of variance: p = 0.436 (Placebo F n = 44, Placebo M n = 56, Treatment F n = 47, Treatment M n = 53). Exploratory, unadjusted.'
    );
    expect(found.line.result).toBe(
      'One-way analysis of variance at each visit, on the participants drawn there: 5 visits tested. Exploratory, unadjusted.'
    );
    await page.evaluate(() =>
      window.__gc.chart.setSettings({ test: 'kruskal', visit_adjustment: 'holm' })
    );
    const kruskal = overTimeResult('over-time-kruskal-holm');
    found = await overTimeOf(page);
    expect(found.statistics[0].args).toEqual(kruskal.args);
    expect(found.test.head).toBe('Kruskal-Wallis test');
    expect(found.test.sub).toBe('p, adjusted (Holm)');
    expect(found.test.cells.map((cell) => cell.text)).toEqual(
      kruskal.value.rows.map((row) => printedP(row.p_value))
    );
    expect(found.test.cells[0].text).toBe('p = 0.490');
    expect(found.line.result).toBe(
      'Kruskal-Wallis rank sum test at each visit, on the participants drawn there: 5 visits tested. Exploratory, adjusted (Holm) across 5 visits.'
    );
    await captureEvidence(page.locator('.sv-multiples'), 'GC-TIME-029', 'four-groups-over-time');
  });

  test('GC-TIME-030: over time the PNG holds the picture with its table of counts and tests, the statistics file holds R’s row for every visit, the table file a row per participant and visit, and the specification written makes the same picture again (#85)', async ({
    page
  }) => {
    const errors = watch(page);
    await openOverTime(page, {
      settings: {
        visit_adjustment: 'holm',
        time_mark: 'mean_se',
        title: '{measure}: {value} by {group}',
        subtitle: 'At {visits}; {n} participants'
      },
      results: ['over-time-result-holm']
    });
    const expected = overTimeResult('over-time-result-holm');
    await expect(testRow(page)).toHaveAttribute('data-state', 'shown');
    // The title and subtitle are filled from the level drawn.
    await expect(page.locator('#chart .bv-title')).toHaveText('IL-6: Result by ARM');
    await expect(page.locator('#chart .bv-subtitle')).toHaveText(
      'At Baseline, Week 2, Week 4, Week 8, Week 12; 200 participants'
    );
    // The chart's own footnote names the method, the counts by visit and the adjustment.
    await expect(page.locator('#chart .bv-foot-line').last()).toContainText(
      'Statistics: Welch Two Sample t-test (n = 184 to 200 across 5 visits), p-values adjusted by Holm; stored with the page.'
    );
    const buttons = page.locator('#chart .bv-downloads button');
    await expect(buttons).toHaveText(['PNG', 'Statistics (CSV)', 'Table (CSV)']);
    const save = async (kind) => {
      const waiting = page.waitForEvent('download');
      await page.locator(`#chart .bv-downloads button[data-download="${kind}"]`).click();
      const download = await waiting;
      return {
        name: download.suggestedFilename(),
        bytes: readFileSync(await download.path())
      };
    };
    const base = 'bio.viz-group-comparison-il-6-baseline-week-2-week-4-week-8-week-12-arm';

    // The picture: the frame at twice its size, with the table in it: a
    // p-value and a count are printed where the page has them, and the empty
    // cell at the row's end is blank. What is left out of the picture above
    // the table, the toolbar and the hint, takes its height with it.
    const where = await page.evaluate(() => {
      const { main } = window.__gc.chart;
      const frame = main.getBoundingClientRect();
      const table = main.querySelector('.bv-time-table');
      let lost = 0;
      for (const element of main.querySelectorAll('.bv-no-picture')) {
        if (element.parentElement.closest('.bv-no-picture')) continue;
        if (!(element.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (box.height) {
          lost += box.height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
        }
      }
      const cell = (selector) => {
        const box = main.querySelector(selector).getBoundingClientRect();
        return {
          left: Math.round(box.left - frame.left) + 2,
          right: Math.round(box.right - frame.left) - 2,
          top: Math.round(box.top - frame.top - lost) + 2,
          bottom: Math.round(box.bottom - frame.top - lost) - 2
        };
      };
      return {
        width: Math.ceil(frame.width),
        p: cell('.bv-time-table tr[data-row="test"] td[data-visit="Week 4"]'),
        n: cell('.bv-time-table tr[data-row="n"] td[data-visit="Week 4"]'),
        blank: cell('.bv-time-table tr[data-row="n"] td:last-child')
      };
    });
    const png = await save('png');
    expect(png.name).toBe(`${base}.png`);
    const read = readPng(new Uint8Array(png.bytes));
    expect(read.width).toBe(where.width * 2);
    expect(read.text.Title).toBe(
      'IL-6: Result by ARM — At Baseline, Week 2, Week 4, Week 8, Week 12; 200 participants'
    );
    const picture = pixelsOf(new Uint8Array(png.bytes));
    // Text, not a rule between rows: every channel dark.
    const lettered = (cell) => {
      for (let x = cell.left * 2; x <= cell.right * 2; x += 1) {
        for (let y = cell.top * 2; y <= cell.bottom * 2; y += 1) {
          if (x < 0 || y < 0 || x >= picture.width || y >= picture.height) continue;
          if (
            picture
              .pixel(x, y)
              .slice(0, 3)
              .every((channel) => channel < 130)
          ) {
            return true;
          }
        }
      }
      return false;
    };
    expect(lettered(where.p)).toBe(true);
    expect(lettered(where.n)).toBe(true);
    expect(where.blank.right).toBeGreaterThan(where.blank.left);
    expect(lettered(where.blank)).toBe(false);

    // The statistics: R's result, then R's row for each visit, every number R's.
    const file = await save('statistics');
    expect(file.name).toBe(`${base}-statistics.csv`);
    const [head, ...records] = parseCsv(file.bytes.toString('utf8'));
    const column = (name) => head.indexOf(name);
    expect(records).toHaveLength(1 + VISITS.length);
    expect(records[0][column('part')]).toBe('result');
    expect(records[0][column('function')]).toBe('Analyze_GroupDifferenceBy');
    expected.value.rows.forEach((row, at) => {
      const record = records[at + 1];
      expect(record[column('part')]).toBe('rows');
      expect(record[column('item')]).toBe(String(at + 1));
      expect(record[column('by')]).toBe(row.by);
      expect(record[column('adjustment')]).toBe('holm');
      for (const member of ['p_unadjusted', 'p_value', 'n_1', 'n_2', 'estimate', 'adjusted_over']) {
        expect(Number(record[column(member)]), `${row.by} ${member}`).toBe(row[member]);
      }
      // What it was asked about: the biomarker and the visits of the row.
      expect(record[column('data/measure')]).toBe('IL-6');
      expect(record[column('data/visits')]).toBe(VISITS.join(' | '));
    });

    // The table: one row per participant and visit drawn.
    const table = await save('table');
    expect(table.name).toBe(`${base}-table.csv`);
    const [columns, ...rows] = parseCsv(table.bytes.toString('utf8'));
    expect(columns).toEqual(['Participant', 'Visit', 'ARM', 'IL-6, Result']);
    expect(rows).toHaveLength(943);
    expect([...new Set(rows.map((row) => row[1]))]).toEqual(VISITS);
    const fixture = readFileSync(
      new URL('../fixtures/group-statistics/over-time-result.csv', import.meta.url),
      'utf8'
    )
      .trimEnd()
      .split('\n')
      .slice(1)
      .map((line) => line.split(','));
    // The same rows desktop R ran on: participant, value, group, visit.
    expect(rows.map(([id, visit, group, value]) => [id, value, group, visit])).toEqual(fixture);

    // The specification: what the controls read, and the same picture again.
    const trip = await page.evaluate(() => {
      const old = window.__gc.chart;
      const written = old.specification();
      const before = {
        asked: old
          .statistics()
          .map(({ name, args, dataId, rows }) => ({ name, args, dataId, rows })),
        table: old.tableOf(),
        label: old.charts[0].canvas.getAttribute('aria-label')
      };
      const { connection } = old;
      old.destroy();
      const again = window.BioViz.fromSpecification('#chart', JSON.stringify(written), {
        connection
      }).init(window.__gc.data);
      window.__gc.chart = again;
      return {
        written,
        before,
        after: {
          asked: again
            .statistics()
            .map(({ name, args, dataId, rows }) => ({ name, args, dataId, rows })),
          table: again.tableOf(),
          label: again.charts[0].canvas.getAttribute('aria-label')
        },
        level: again.root.dataset.level,
        notices: again.notices,
        rewritten: again.specification()
      };
    });
    expect(trip.written.settings).toMatchObject({
      start_value: 'IL-6',
      visits: VISITS,
      value_type: 'raw',
      time_mark: 'mean_se',
      visit_adjustment: 'holm',
      test: 't'
    });
    expect(trip.level).toBe('over-time');
    expect(trip.notices).toEqual([]);
    expect(trip.after).toEqual(trip.before);
    expect(trip.rewritten).toEqual(trip.written);
    expect(trip.before.label).toContain('means with standard errors');
    expect(errors).toEqual([]);
  });

  test('GC-TIME-034: a specification written by bio.viz v0.2.0 that names a biomarker and every visit, which drew a panel for every visit, is read whole and now opens on the biomarker over time, with the same participants at each visit and one request where there were five (#85)', async ({
    page
  }) => {
    await open(page);
    const entry = released.cases.find((one) => one.name === 'one-biomarker-every-visit');
    expect(entry.specification.bio_viz_version).toBe('0.2.0');
    expect(entry.specification.settings).toMatchObject({ start_value: 'IL-6', visits: VISITS });
    expect(entry.drew.panels.map((panel) => panel.visit)).toEqual(VISITS);
    await page.evaluate((specification) => {
      window.__gc.chart.destroy();
      window.__gc.chart = window.BioViz.fromSpecification('#chart', specification).init(
        window.__gc.data
      );
    }, entry.specification);
    const found = await overTimeOf(page);
    expect(await page.evaluate(() => window.__gc.chart.notices)).toEqual([]);
    expect(found.level).toBe('over-time');
    expect(found.visits).toEqual(VISITS);
    await expect(page.locator('.bv-panel')).toHaveCount(0);
    // The same participants at each visit, in the same groups.
    expect(
      VISITS.map((visit, at) =>
        Object.entries(found.counts).map(([level, counts]) => `${level} ${counts[at]}`)
      )
    ).toEqual(entry.drew.panels.map((panel) => panel.groups));
    // One request, on the rows the released chart sent in five.
    expect(found.statistics).toHaveLength(1);
    expect(entry.asked).toHaveLength(5);
    expect(found.statistics[0].rows).toBe(
      entry.asked.reduce((total, asked) => total + asked.rows, 0)
    );
    expect(found.statistics[0].args.strMethod).toBe(entry.asked[0].args.strMethod);
    // Written again it holds every setting the released one held, as it was.
    const again = await page.evaluate(() => window.__gc.chart.specification());
    for (const [key, value] of Object.entries(entry.specification.settings)) {
      expect(again.settings[key], key).toEqual(value);
    }
    // A reader gets the released view of one of its visits in one click.
    await page.locator('button.bv-time-visit[data-visit="Week 2"]').click();
    const asked = await page.evaluate(() => window.__gc.chart.statistics());
    expect(
      asked.map(({ panel, name, args, dataId, rows }) => ({ panel, name, args, dataId, rows }))
    ).toEqual([{ ...entry.asked[1], panel: asked[0].panel }]);
  });
});

test.describe('group comparison: one biomarker over time, on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('GC-TIME-031: at 390px the picture over time and its table hold five visits within the page, each visit’s column under its place; a tap on a visit opens it; with more visits than fit, the block scrolls sideways inside the chart and the page still does not (#85)', async ({
    page
  }) => {
    await openOverTime(page, {
      settings: { value_type: 'change', visit_adjustment: 'holm' },
      results: ['over-time-change-holm']
    });
    expect(await layout(page)).toEqual(HOLDS);
    await expect(testRow(page)).toHaveAttribute('data-state', 'shown');
    const block = () =>
      page.locator('.bv-time-scroll').evaluate((scroll) => ({
        client: scroll.clientWidth,
        scroll: scroll.scrollWidth,
        // The first group's counts: a cell a visit, whatever the row of tests holds.
        counts: [...scroll.querySelector('tr[data-row="n"]').querySelectorAll('td[data-visit]')]
          .length,
        cells: [...scroll.querySelectorAll('tr[data-row="test"] td[data-visit]')].map((cell) => {
          const box = cell.getBoundingClientRect();
          return { right: box.right, text: cell.textContent };
        })
      }));
    let held = await block();
    // Five visits fit: nothing to scroll, and every cell is within the page.
    expect(held.scroll).toBe(held.client);
    expect(held.cells).toHaveLength(5);
    expect(Math.max(...held.cells.map((cell) => cell.right))).toBeLessThanOrEqual(390);
    expect(held.cells.map((cell) => cell.text)).toEqual([
      'not tested',
      'p < 0.001',
      'p < 0.001',
      'p < 0.001',
      'p < 0.001'
    ]);
    const found = await overTimeOf(page);
    expect(found.charts).toBe(1);
    expect(found.trail.map((step) => step.text)).toEqual(['All biomarkers', 'IL-6 over time']);
    await captureEvidence(page.locator('.sv-root'), 'GC-TIME-031', 'over-time-on-a-phone');

    // A tap on a visit opens it, at the chart's top.
    await page.locator('button.bv-time-visit[data-visit="Week 4"]').tap();
    await expect(page.locator('.sv-root')).toHaveAttribute('data-level', 'visits');
    expect(await layout(page)).toEqual(HOLDS);
    const top = await page.locator('.sv-root').evaluate((root) => root.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(-1);
    await page.locator('.bv-trail button', { hasText: 'IL-6 over time' }).tap();
    await expect(page.locator('.bv-time-table')).toHaveCount(1);
    expect(await layout(page)).toEqual(HOLDS);

    // Seven visits, two of them unscheduled: the block is wider than the
    // chart and scrolls inside it; the page does not scroll sideways.
    await addUnscheduled(page, { unscheduled_visits: true });
    await expect(page.locator('.bv-time-table thead th[data-visit]')).toHaveCount(7);
    held = await block();
    expect(held.counts).toBe(7);
    expect(held.scroll).toBeGreaterThan(held.client);
    expect(await layout(page)).toEqual(HOLDS);
    // The controls open above it, with the two that do not apply saying so.
    await page.locator('.sv-sidebar-toggle').click();
    await expect(page.locator('.bv-control-note')).toHaveCount(2);
    expect(await layout(page)).toEqual(HOLDS);
  });
});

test.describe('group comparison: lifecycle', () => {
  test('GC-LIFE-001: init, setData, setSettings, render, resize and destroy drive the chart as they drive a safety.viz chart (#9)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page);
    const methods = await page.evaluate(() =>
      ['init', 'setData', 'setSettings', 'render', 'resize', 'destroy'].filter(
        (name) => typeof window.__gc.chart[name] === 'function'
      )
    );
    expect(methods).toEqual(['init', 'setData', 'setSettings', 'render', 'resize', 'destroy']);

    // setSettings moves a control and draws again; it returns the chart.
    const chained = await page.evaluate(
      () => window.__gc.chart.setSettings({ mark: 'points', group_by: 'SEX' }) === window.__gc.chart
    );
    expect(chained).toBe(true);
    await expect(page.locator('select[data-control="mark"]')).toHaveValue('points');
    expect((await drawn(page))[0].ticks.map((tick) => tick[0])).toEqual(['F', 'M']);

    // setData replaces the tables: results alone, and the filters go.
    await page.evaluate(() =>
      window.__gc.chart.setData({ results: window.__gc.data.results.slice(0, 4000) })
    );
    await expect(page.locator('.sv-sidebar [data-filter]')).toHaveCount(0);
    // An array is the results table.
    await page.evaluate(() => window.__gc.chart.init(window.__gc.data.results));
    expect((await drawn(page))[0].ticks[0][0]).toBe('All participants');

    await page.evaluate(() => {
      window.__gc.chart.render();
      window.__gc.chart.resize();
    });
    expect(await page.evaluate(() => window.__gc.chart.charts.length)).toBe(1);

    // destroy leaves nothing behind.
    await page.evaluate(() => window.__gc.chart.destroy());
    await expect(page.locator('#chart')).toBeEmpty();
    expect(await page.evaluate(() => window.__gc.chart.charts.length)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('GC-LIFE-002: tables the chart cannot read are refused with a message, shown in its place (#9)', async ({
    page
  }) => {
    await open(page);
    const message = await page.evaluate(() => {
      try {
        window.__gc.chart.setData({
          results: [{ SUBJECT: 'A', TEST: 'X', STRESN: 1, VISIT: 'W1' }]
        });
        return 'accepted';
      } catch (error) {
        return error.message;
      }
    });
    expect(message).toBe('bio.viz: the results table has no column `USUBJID` (`id_col`).');
    await expect(page.locator('#chart .sv-warning')).toHaveText(message);
  });
});

test.describe('group comparison: opened by another chart', () => {
  test('GC-LIFE-003: the chart can be mounted inside another chart’s element on one biomarker, with a way back that calls the caller, by a click or from the keyboard (#36)', async ({
    page
  }) => {
    await open(page, { make: false });
    await page.evaluate(() => {
      const host = document.querySelector('#chart');
      host.innerHTML = '<div class="rows">The rows</div><div class="drill"></div>';
      window.__back = [];
      window.__open = (measure) => {
        host.querySelector('.rows').hidden = true;
        window.__drill = window.BioViz.groupComparison(host.querySelector('.drill'), {
          start_value: measure,
          visits: ['Week 4'],
          value_type: 'change',
          baseline_visits: 'Baseline',
          group_by: 'ARM',
          back: {
            label: 'Back to the rows',
            action: (chart) => {
              window.__back.push(chart === window.__drill);
              chart.destroy();
              host.querySelector('.rows').hidden = false;
            }
          }
        }).init(window.__gc.data);
      };
      window.__open('IL-6');
    });
    const back = page.locator('.bv-group-comparison .bv-back');
    await expect(back).toHaveText('Back to the rows');
    await expect(page.locator('.rows')).toBeHidden();
    // The button is above the chart, before its notes.
    expect(
      await page.evaluate(() => {
        const button = document.querySelector('.bv-group-comparison .bv-back');
        const notes = document.querySelector('.bv-group-comparison .sv-notes');
        return Boolean(button.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING);
      })
    ).toBe(true);
    expect(await page.evaluate(() => window.__drill.charts.length)).toBe(1);
    await back.click();
    await expect(page.locator('.rows')).toBeVisible();
    await expect(page.locator('.drill')).toBeEmpty();
    await page.evaluate(() => window.__open('CRP'));
    await back.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.rows')).toBeVisible();
    expect(await page.evaluate(() => window.__back)).toEqual([true, true]);
    // Without the setting there is no button; a way back that is not one is refused.
    await page.evaluate(() => {
      window.__plain = window.BioViz.groupComparison('.drill', {}).init(window.__gc.data);
    });
    await expect(page.locator('.bv-back')).toHaveCount(0);
    const refused = await page.evaluate(() => {
      try {
        window.BioViz.groupComparison('.drill', { back: { label: 'Back' } });
        return null;
      } catch (error) {
        return error.message;
      }
    });
    expect(refused).toBe(
      'bio.viz: `back` must be { label, action }, a sentence and a function, or null for none.'
    );
  });
});

test.describe('group comparison: on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('GC-MOBILE-001: at 390px the chart fills the width with its controls folded away one tap from open, and the page does not scroll sideways (#9)', async ({
    page
  }) => {
    await open(page);
    expect(await layout(page)).toEqual(HOLDS);
    // The controls start folded, so the chart is on the first screen.
    await expect(page.locator('.sv-root')).toHaveClass(/sv-collapsed/);
    await expect(page.locator('.sv-controls')).toBeHidden();
    await expect(page.locator('.sv-sidebar-title')).toBeVisible();
    const chart = await page.locator('.sv-chart-wrap').boundingBox();
    expect(chart.width).toBeGreaterThan(330);
    expect(chart.y).toBeLessThan(844);
    expect((await drawn(page))[0].ticks.map((tick) => tick[1])).toEqual(['n = 95', 'n = 91']);

    // One tap opens them, above the chart, and every control is usable.
    await page.locator('.sv-sidebar-toggle').click();
    await expect(page.locator('.sv-controls')).toBeVisible();
    expect(await layout(page)).toEqual(HOLDS);
    await choose(page, 'mark', 'violin');
    await choose(page, 'panel-by', 'SEX');
    await page.locator('.sv-sidebar-toggle').click();

    // Panels stack, one to a row.
    const panels = await page
      .locator('.bv-panel')
      .evaluateAll((cards) =>
        cards.map((card) => card.getBoundingClientRect()).map((box) => [box.left, box.width])
      );
    expect(panels).toHaveLength(2);
    expect(panels[0][0]).toBe(panels[1][0]);
    expect(panels[0][1]).toBeGreaterThan(330);
    expect(await layout(page)).toEqual(HOLDS);
    await captureEvidence(page.locator('.sv-root'), 'GC-MOBILE-001', 'panels-on-a-phone');
  });

  test('GC-MOBILE-002: at 390px a box can be tapped, its listing read and a profile opened, and the page still does not scroll sideways (#9)', async ({
    page
  }) => {
    await open(page);
    await clickCell(page, 'Placebo');
    await expect(page.locator('.sv-listing-actions strong')).toHaveText('95 of 95 records');
    expect(await layout(page)).toEqual(HOLDS);
    await page.locator('.sv-listing tbody tr').first().click();
    await expect(page.locator('.sv-rail .sv-profile-id')).toBeVisible();
    expect(await layout(page)).toEqual(HOLDS);
    // The profile sits below the chart, at the page's width.
    const rail = await page.locator('.sv-rail').boundingBox();
    const main = await page.locator('.sv-main').boundingBox();
    expect(rail.y).toBeGreaterThan(main.y);
    expect(rail.width).toBeLessThanOrEqual(390);
  });
});

test.describe('group comparison: the trend tiles on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('GC-OVW-016: at 390px the tiles are two to a line, each whole with its range beneath, a tap on one opens its biomarker over time at the chart’s top, and the page does not scroll sideways (#17, #84, #85)', async ({
    page
  }) => {
    await openTiles(page);
    expect(await layout(page)).toEqual(HOLDS);
    // The controls start folded, so the first tiles are on the first screen.
    await expect(page.locator('.sv-root')).toHaveClass(/sv-collapsed/);
    await expect(page.locator('.bv-tile')).toHaveCount(12);
    const boxes = await page
      .locator('.bv-tile')
      .evaluateAll((tiles) =>
        tiles
          .map((tile) => tile.getBoundingClientRect())
          .map((box) => [Math.round(box.left), Math.round(box.top), box.width, box.height])
      );
    // Two to a line, six lines.
    expect(boxes[0][1]).toBe(boxes[1][1]);
    expect(boxes[2][1]).toBeGreaterThan(boxes[0][1]);
    expect(boxes[2][0]).toBe(boxes[0][0]);
    expect(boxes[11][0]).toBe(boxes[1][0]);
    expect(new Set(boxes.map((box) => box[1])).size).toBe(6);
    for (const [, , width] of boxes) expect(width).toBeGreaterThan(150);
    expect(boxes[0][1]).toBeLessThan(844);
    // Every tile's chart is drawn inside its tile, and its range is on one line.
    const drawn = await page.evaluate(() =>
      window.__gc.chart.charts.map((chart) => {
        const canvas = chart.canvas.getBoundingClientRect();
        const tile = chart.canvas.closest('.bv-tile');
        const box = tile.getBoundingClientRect();
        const range = tile.querySelector('.bv-tile-range').getBoundingClientRect();
        return {
          inside: canvas.left >= box.left && canvas.right <= box.right && canvas.width > 100,
          rangeHeight: range.height
        };
      })
    );
    expect(drawn.every((entry) => entry.inside)).toBe(true);
    expect(drawn.every((entry) => entry.rangeHeight < 24)).toBe(true);
    // Nothing of the tiles is wider than the page.
    const overflowing = await page.evaluate(() =>
      [...document.querySelectorAll('.sv-main *')]
        .filter((element) => element.getBoundingClientRect().right > 390.5)
        .map((element) => element.className)
    );
    expect(overflowing).toEqual([]);
    await captureEvidence(page.locator('.sv-multiples'), 'GC-OVW-016', 'trend-tiles-on-a-phone');

    // A tap on a tile opens its biomarker over time: one picture, five visits.
    await page.locator('.bv-tile[data-measure="CRP"]').tap();
    await expect(page.locator('.bv-time-table')).toHaveCount(1);
    await expect(page.locator('.bv-time-table thead th[data-visit]').first()).toHaveText(
      'Baseline'
    );
    expect(await layout(page)).toEqual(HOLDS);
    // The chart is brought back to the top of the page it replaced.
    const top = await page.locator('.sv-root').evaluate((root) => root.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(-1);

    // One tap opens the controls, where All Biomarkers leads back.
    await page.locator('.sv-sidebar-toggle').click();
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('CRP');
    await choose(page, 'measure', 'bv_overview');
    await expect(page.locator('.bv-tile')).toHaveCount(12);
    // The controls the tiles do not read say so within the page's width.
    await expect(page.locator('.bv-control-note')).toHaveCount(3);
    expect(await layout(page)).toEqual(HOLDS);
    // A tile far down the page opens at the chart's top, not below it.
    await page.locator('.sv-sidebar-toggle').click();
    await page.locator('.bv-tile[data-measure="VEGF"]').tap();
    await expect(page.locator('.bv-time-table thead th[data-visit]')).toHaveCount(5);
    const after = await page
      .locator('.sv-root')
      .evaluate((root) => root.getBoundingClientRect().top);
    expect(after).toBeGreaterThanOrEqual(-1);
    expect(after).toBeLessThan(844);
    // With unscheduled visits left out, the note that says so holds too.
    await page.locator('.sv-sidebar-toggle').click();
    await choose(page, 'measure', 'bv_overview');
    await addUnscheduled(page);
    await expect(page.locator('.sv-notes .bv-hidden-visits')).toHaveText(HIDDEN_NOTE);
    expect(await layout(page)).toEqual(HOLDS);
  });
});

test.describe('group comparison: on the site', () => {
  test('GC-FILTER-006: on the demo, filters with nobody in common leave the tiles and one biomarker saying, in words, that no participant passes the filters; nothing is drawn, R is asked nothing, the controls stay usable, and loosening a filter draws again (#29)', async ({
    page
  }) => {
    const errors = await openDemo(page, 'group-comparison', 'groupComparison');
    const charts = () => window.BioVizDemo.chart.charts.length;
    // The tiles, which ask R for nothing in any case.
    expect(await page.evaluate(charts)).toBeGreaterThan(0);
    expect(await letNobodyThrough(page)).toBe(0);
    await expectNobody(page, errors, { drawn: charts });
    await expect(page.locator('#chart .bv-tile')).toHaveCount(0);
    expect(await asked(page)).toBe(0);
    // One biomarker, opened from the controls with nobody through: nothing
    // drawn and nothing asked.
    await page.locator('#chart select[data-control="measure"]').selectOption('IL-6');
    await expectNobody(page, errors, { drawn: charts });
    expect(await asked(page)).toBe(0);
    // Loosened: the four aged 35 are drawn, and R is asked for their test.
    await page.locator('#chart select[data-filter="RESPONSE"]').selectOption('__all__');
    await expect(page.locator('#chart .sv-notes')).toContainText(
      '4 of 200 participants pass the filters.'
    );
    expect(await page.evaluate(charts)).toBeGreaterThan(0);
    await expect.poll(() => asked(page)).toBeGreaterThan(0);
    await expect(page.locator('#chart .sv-footnote')).not.toHaveText(NOBODY_PASSES);
    // And back to the tiles, which are drawn again.
    await page.locator('#chart select[data-control="measure"]').selectOption({ index: 0 });
    await expect(page.locator('#chart .bv-tile').first()).toBeVisible();
    expect(
      errors.filter((message) => !/webr|r-wasm|Failed to load resource/.test(message))
    ).toEqual([]);
  });

  test('GC-SITE-001: the gallery lists the chart, with links to its live demo, its evidence page and its API reference (#9)', async ({
    page
  }) => {
    const errors = watch(page);
    await page.goto('/_site/gallery/index.html');
    await expect(page.locator('#no-charts')).toHaveCount(0);
    const card = page.locator('#charts [data-module="group-comparison"]');
    await expect(card.locator('h3')).toHaveText('Group comparison');
    await expect(card).toContainText('Does this biomarker differ between these groups?');

    await card.getByRole('link', { name: 'Evidence' }).click();
    await expect(page).toHaveURL(/\/_site\/group-comparison\/evidence\.html$/);
    await expect(page.locator('.page-tabs a')).toHaveText([
      'Gallery',
      'Live demo',
      'Evidence',
      'API reference'
    ]);
    await page.locator('.page-tabs').getByRole('link', { name: 'API reference' }).click();
    await expect(page.locator('h1')).toHaveText('The group comparison chart');
    await expect(
      page.locator('.api-body h2 code').filter({ hasText: /^groupComparison\(/ })
    ).toHaveCount(1);
    await page.locator('.page-tabs').getByRole('link', { name: 'Gallery' }).click();
    await card.getByRole('link', { name: 'Live demo' }).click();
    await expect(page).toHaveURL(/\/_site\/group-comparison\/index\.html$/);
    expect(errors).toEqual([]);
  });

  test('GC-SITE-002: the live demo draws the chart on the synthetic study, from safety.viz’s bundle and bio.viz’s, with R attached; where R cannot be reached it still draws, and says so (#9)', async ({
    page
  }) => {
    // R's hosts are kept out of reach: this test stays on this machine. The
    // tests named GC-STAT-034 and after run the same page against real R.
    await blockR(page);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const scripts = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith('.js')) scripts.push(url.pathname.replace('/_site/', ''));
    });
    await page.goto('/_site/group-comparison/index.html');
    await page.evaluate(() => window.BioVizDemo.ready);
    await expect(page.locator('h1')).toHaveText('Group comparison');
    // The demo opens on every biomarker (GC-OVW-018). This test is of one
    // biomarker at one visit, and says which: IL-6, change from Baseline to
    // Week 4.
    await page.evaluate(() =>
      window.BioVizDemo.chart.setSettings({
        start_value: 'IL-6',
        visits: 'Week 4',
        value_type: 'change'
      })
    );
    // safety.viz first, then bio.viz, then the demo's own two scripts.
    expect(scripts.map((file) => file.replace(/bio\.viz-[\d.]+/, 'bio.viz-x'))).toEqual([
      'vendor/safety.viz/safety.viz.js',
      'dist/bio.viz-x/bio.viz.js',
      'demo/synthetic-study.js',
      'demo/group-comparison.js'
    ]);
    const found = await page.evaluate(() => {
      const chart = window.BioVizDemo.chart.charts[0];
      return {
        ticks: chart.scales.x.ticks.map((tick) => tick.label),
        title: chart.options.scales.y.title.text,
        group: chart.options.scales.x.title.text,
        drawsWithKit: chart instanceof window.SafetyViz.kit.Chart
      };
    });
    expect(found).toEqual({
      ticks: [
        ['Placebo', 'n = 95'],
        ['Treatment', 'n = 91']
      ],
      title: 'IL-6 at Week 4, change from baseline (pg/mL)',
      group: 'Arm',
      drawsWithKit: true
    });
    // The chart is drawn, and the line under it says that R could not be
    // started rather than nothing at all.
    const line = page.locator('.sv-main > .bv-statistic');
    await expect(line).toHaveAttribute('data-state', 'unavailable');
    await expect(line).toContainText(
      'Statistics are unavailable: R could not be started (Failed to fetch dynamically imported module: https://webr.r-wasm.org/v0.6.0/webr.mjs).'
    );
    await expect(page.locator('.sv-sidebar select[data-filter]')).toHaveCount(3);
    // The demo offers a category with four levels beside the study's own three.
    await expect(page.locator('select[data-control="group-by"] option')).toHaveText([
      'Arm',
      'Sex',
      'Response',
      'Arm and sex'
    ]);
    // The page says where the R it runs comes from: gsm.bio's file, at the
    // commit it was copied from, published beside the page.
    await expect(page.locator('#demo-statistics')).toContainText(
      `copied from gsm.bio at commit ${statisticsRecord.commit.slice(0, 7)}`
    );
    const file = await page.request.get('/_site/vendor/gsm.bio/statistics.R');
    expect(file.ok()).toBe(true);
    expect((await file.body()).length).toBe(statisticsRecord.files[0].bytes);
    // The page says where safety.viz's bundle came from, and that the copy is from a branch.
    await expect(page.locator('#demo-kit')).toContainText(`version ${kitRecord.version}`);
    if (kitRecord.merged_to_dev === false) {
      await expect(page.locator('#demo-kit')).toContainText('not merged yet');
    }
    // A box, then a row, opens the profile here as on the fixture.
    await clickDemoCell(page, 0);
    await expect(page.locator('.sv-listing-actions strong')).toHaveText('95 of 95 records');
    await page.locator('.sv-listing tbody tr').first().click();
    await expect(page.locator('.sv-rail .sv-profile-id')).toBeVisible();
    await expect(page.locator('.sv-rail .sv-profile-details li')).toHaveCount(5);
    expect(errors).toEqual([]);
  });

  test('GC-OVW-018: the live demo opens on the trend tiles, one per biomarker of the synthetic study with a line per arm and no statistics line, and fetches nothing for R until a biomarker is opened (#17, #84)', async ({
    page
  }) => {
    // R's hosts are not blocked while the tiles are up: every request the page
    // makes is recorded, and none may be for R.
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    const forR = () =>
      requests.filter((url) => isRHost(url) || new URL(url).pathname.endsWith('/statistics.R'));
    await page.goto('/_site/group-comparison/index.html');
    await page.evaluate(() => window.BioVizDemo.ready);

    await expect(page.locator('select[data-control="measure"]')).toHaveValue('bv_overview');
    await expect(page.locator('select[data-control="measure"] option:checked')).toHaveText(
      'All Biomarkers'
    );
    await expect(page.locator('[data-control="visits"] summary')).toHaveText('All (5)');
    const tiles = page.locator('.bv-tile');
    await expect(tiles).toHaveCount(12);
    expect(await tiles.evaluateAll((all) => all.map((tile) => tile.dataset.measure))).toEqual(
      BIOMARKERS
    );
    const found = await tilesOf(page, 'BioVizDemo');
    // A chart a tile, a line per arm in each, at the study's five visits.
    expect(found.charts).toHaveLength(12);
    for (const chart of found.charts) {
      expect(
        chart.lines.map((line) => line.level),
        chart.measure
      ).toEqual(['Placebo', 'Treatment']);
      expect(chart.visits).toEqual(VISITS);
    }
    // The medians are desktop R's.
    tileChart(found, 'IL-6').lines.forEach((line, arm) => {
      line.points.forEach(([at, value]) =>
        near(value, rLines('IL-6', 'raw', 'median')[arm][at], line.level)
      );
    });
    expect(found.key).toEqual(['Median result by Arm:', 'Placebo', 'Treatment']);
    // Neither a biomarker nor a visit is named by the page: these are the defaults.
    expect(
      await page.evaluate(() => {
        const { settings } = window.BioVizDemo.chart;
        return [settings.start_value, settings.visits, settings.unscheduled_visits];
      })
    ).toEqual([null, null, false]);
    // The synthetic study has no unscheduled visit: no note, and no control.
    await expect(page.locator('.bv-hidden-visits')).toHaveCount(0);
    await expect(page.locator('input[data-control="unscheduled-visits"]')).toHaveCount(0);
    expect(found.statistics).toEqual([]);
    await expect(page.locator('.sv-main > .bv-statistic')).toBeHidden();
    await expect(page.locator('.sv-main')).not.toContainText('waiting for R');
    await expect(page.locator('.sv-main')).not.toContainText('p =');
    await expect(page.locator('#about-demo')).toContainText(
      'The tiles print no test and ask R for nothing.'
    );
    // The title is filled from the tiles' view.
    await expect(page.locator('#chart .bv-title')).toHaveText('Result: every biomarker by Arm');
    // Filters and controls apply to the tiles, and still nothing is asked of R.
    await page.locator('select[data-filter="SEX"]').selectOption('F');
    await choose(page, 'group-by', 'ARM_SEX');
    await choose(page, 'tile-summary', 'mean');
    await expect(tiles).toHaveCount(12);
    expect((await tilesOf(page, 'BioVizDemo')).key).toEqual([
      'Mean result by Arm and sex:',
      'Placebo F',
      'Treatment F'
    ]);
    await page.locator('.sv-reset').click();
    await page.waitForTimeout(500);
    expect(requests.length).toBeGreaterThan(5);
    expect(forR()).toEqual([]);

    // From here R's hosts are kept out of reach, so the rest stays on this
    // machine: GC-OVW-019 opens a biomarker with R answering.
    await blockR(page);
    await tiles.nth(6).click();
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('IL-6');
    await expect(page.locator('.bv-time-table thead th[data-visit]')).toHaveText(VISITS);
    await expect(page.locator('.bv-time-line')).toHaveCount(1);
    // Opening a biomarker is what asks for R: now, and not before.
    await expect.poll(() => forR().length).toBeGreaterThan(0);
    await choose(page, 'measure', 'bv_overview');
    await expect(tiles).toHaveCount(12);
    expect(errors).toEqual([]);
  });

  test('GC-SITE-003: the live demo holds at a 390px-wide viewport with no horizontal scroll (#9)', async ({
    page
  }) => {
    // This test stays on this machine: R's hosts are out of reach, and the chart
    // is set to ask for no test, so the line under it says that none is chosen
    // and what the first one would cost. GC-STAT-042 is the same page on a
    // phone with R answering.
    await blockR(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/_site/group-comparison/index.html');
    await page.evaluate(() => window.BioVizDemo.ready);
    // One biomarker at one visit, stated here: the demo itself opens on every
    // biomarker, and GC-OVW-016 is that view on a phone.
    await page.evaluate(() =>
      window.BioVizDemo.chart.setSettings({
        start_value: 'IL-6',
        visits: 'Week 4',
        value_type: 'change',
        test: 'none'
      })
    );
    await expect(page.locator('.sv-main > .bv-statistic')).toHaveText(
      'Statistics: no test chosen. The first test starts R in this browser: about 13 MB to download, once, and a few seconds.'
    );
    const measure = () =>
      page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth
      }));
    const holds = { viewport: 390, scrollWidth: 390, bodyScrollWidth: 390 };
    expect(await measure()).toEqual(holds);
    await expect(page.locator('.sv-root')).toHaveClass(/sv-collapsed/);
    const chart = await page.locator('.sv-chart-wrap').boundingBox();
    expect(chart.width).toBeGreaterThan(320);
    // With the controls open, a listing shown and a profile open, it still holds.
    await page.locator('.sv-sidebar-toggle').click();
    await expect(page.locator('.sv-controls')).toBeVisible();
    expect(await measure()).toEqual(holds);
    await page.locator('.sv-sidebar-toggle').click();
    await clickDemoCell(page, 0);
    await page.locator('.sv-listing tbody tr').first().click();
    await expect(page.locator('.sv-rail .sv-profile-id')).toBeVisible();
    expect(await measure()).toEqual(holds);
    await captureEvidence(page.locator('#demo'), 'GC-SITE-003', 'demo-on-a-phone');
  });
});

// Clicks the median of a cell of the demo page's chart.
async function clickDemoCell(page, index) {
  await page.locator('.sv-chart-wrap canvas').scrollIntoViewIfNeeded();
  const point = await page.evaluate((at) => {
    const chart = window.BioVizDemo.chart.charts[0];
    const cell = chart.$panel.cells[at];
    const box = chart.canvas.getBoundingClientRect();
    return {
      x: box.left + chart.scales.x.getPixelForValue(cell.x),
      y: box.top + chart.scales.y.getPixelForValue(cell.stats.median)
    };
  }, index);
  await page.mouse.click(point.x, point.y);
}

// ---------------------------------------------------------------------------
// The gallery's demo, for real (#16). These tests need the network: they open
// the built demo page, which starts webR 0.6.0 from its public host and gives it
// gsm.bio's statistics file, and they hold what R in the browser answers to
// what desktop R answered for the same rows (tests/fixtures/
// group-statistics-r.json). If R's host cannot be reached the tests fail;
// nothing here skips, and nothing retries.
//
// They run in order on one page, because R is started once and the cost of
// starting it is one of the things measured. The browser is started on a new,
// empty profile with a disk cache, the way a first-time visitor's is.
//
// Equality is 1 part in 10^8, the R check page's tolerance: desktop R and R in
// the browser are different builds of different R versions. One difference
// between those versions is not a rounding of the last digits and is not let
// through by widening the tolerance: with tied values and fewer than 50 in each
// group, `wilcox.test` in R 4.3 warns that it cannot compute an exact p-value
// and approximates, where R 4.6 computes the exact one. Where desktop R recorded
// that warning the two answers are printed side by side and every other number
// is still held equal.

const TIES = 'cannot compute exact p-value with ties';
const megabytes = (bytes) => Number((bytes / 1e6).toFixed(2));

test.describe('group comparison: the demo, with R in the browser, live', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  let context;
  let page;
  const finished = [];
  const sideBySide = [];
  const measured = {};
  const session = {};
  const line = () => page.locator('.sv-main > .bv-statistic');
  const result = () => line().locator('.bv-stat-result');
  const isRFile = (url) => isRHost(url) || new URL(url).pathname.endsWith('/statistics.R');

  // What the chart asked R for the one panel drawn, and what R answered.
  const asked = () => page.evaluate(() => window.BioVizDemo.chart.statistics()[0]);
  // The rows the chart drew in that panel, which are the rows it handed R.
  const drawnRows = () =>
    page.evaluate(() =>
      window.BioVizDemo.chart.model.panels[0].records.map((record) => Object.values(record))
    );
  // Waits until the line holds an answer from R for the view now drawn.
  const answered = async () => {
    await expect(line()).not.toHaveAttribute('data-state', /^(waiting|empty)$/, {
      timeout: 200_000
    });
    return asked();
  };
  // Everything the line has read since the page opened, as it changed. A line
  // that was cleared and not yet asked for is not something it read.
  const lineLog = () =>
    page.evaluate(() =>
      window.__line
        .filter((entry) => entry.state !== 'empty')
        .map(({ state, text }) => [state, text])
    );
  // The view these tests start from, stated here and not left to what the demo
  // opens on: one biomarker at one visit, by arm, with the Welch t-test.
  const OPENING = {
    start_value: 'IL-6',
    visits: 'Week 4',
    value_type: 'change',
    group_by: 'ARM',
    test: 't',
    pairwise: false
  };
  const openView = async () => {
    await page.evaluate(() => window.BioVizDemo.ready);
    await page.evaluate((settings) => {
      window.BioVizDemo.chart.setSettings(settings);
    }, OPENING);
  };
  const clearLineLog = () =>
    page.evaluate(() => {
      window.__line = [];
    });

  // The rows desktop R ran on, from the committed file.
  const fixtureRows = (file) =>
    readFileSync(new URL(`../fixtures/group-statistics/${file}`, import.meta.url), 'utf8')
      .trimEnd()
      .split('\n')
      .slice(1)
      .map((row) => row.split(',').map((cell, index) => (index === 1 ? Number(cell) : cell)));

  // Holds one answer from R in the browser to desktop R's for the same case:
  // the chart asked with the key desktop R wrote, on the rows desktop R read,
  // and every member of the answer is the same. Returns the members that are
  // not, for the one case where that is expected.
  async function holdToDesktop(name, testInfo) {
    const expected = resultOf(name);
    const answer = await answered();
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
    sideBySide.push({
      case: name,
      method: expected.value.method,
      p_value: { desktop: expected.value.p_value, browser: answer.answer.value.p_value },
      statistic: {
        desktop: expected.value.statistic.map((entry) => entry.value),
        browser: (answer.answer.value.statistic || []).map((entry) => entry.value)
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
    const profile = mkdtempSync(path.join(tmpdir(), 'bio-viz-group-comparison-'));
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 1280, height: 800 }
    });
    // Every state and text the statistics line takes, with when it took it.
    await context.addInitScript(() => {
      window.__line = [];
      new MutationObserver(() => {
        const found = document.querySelector('.sv-main > .bv-statistic');
        if (!found) return;
        const entry = { state: found.dataset.state, text: found.textContent };
        const last = window.__line[window.__line.length - 1];
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
    await page.goto('/_site/group-comparison/index.html');
    await openView();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('GC-STAT-034: the demo draws first and starts R when its first panel asks for a test; the line waits, saying what the first start costs, and then prints the Welch t-test desktop R gives (#16)', async ({}, testInfo) => {
    // The chart is on the page before R has answered anything.
    const drawn = await page.evaluate(() => window.BioVizDemo.chart.charts.length);
    expect(drawn).toBe(1);
    const { expected, differing } = await holdToDesktop('welch', testInfo);
    expect(differing).toEqual([]);
    expect(expected.method).toBe('Welch Two Sample t-test');

    // What the line read, in order: waiting, with the page's note on the cost
    // of the first start, and then R's answer. Nothing else, and no number
    // before R's. (Where the page was slow to finish loading, R answered the
    // view it opened on before this group stated the same view again: then the
    // line waited and printed twice, and the same holds of both.)
    const log = await lineLog();
    expect(log[0]).toEqual([
      'waiting',
      'Statistics: waiting for R… The first test starts R in this browser: about 13 MB to download, once, and a few seconds.'
    ]);
    const states = log.map(([state]) => state);
    expect([
      ['waiting', 'shown'],
      ['waiting', 'shown', 'waiting', 'shown']
    ]).toContainEqual(states);
    for (const [state, text] of log) {
      if (state === 'waiting') expect(text).not.toMatch(/p [=<>]/);
      else expect(text).toContain('p < 0.001 (Placebo n = 95, Treatment n = 91)');
    }
    await expect(line().locator('p')).toHaveText([
      'Welch Two Sample t-test: p < 0.001 (Placebo n = 95, Treatment n = 91). Exploratory, unadjusted.',
      'Difference in means (Placebo - Treatment): 1.235, 95% confidence interval 0.844 to 1.626.',
      'This test compares the levels of Arm on the 186 participants drawn.'
    ]);
    await expect(line()).not.toContainText('*');
    await expect(line()).not.toContainText(/significan/i);

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

    // The cost of that first start, kept for GC-STAT-041.
    const times = await page.evaluate(() =>
      ['waiting', 'shown'].map((state) => window.__line.find((entry) => entry.state === state).at)
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

  test('GC-STAT-035: choosing the Wilcoxon rank-sum test prints the result desktop R gives, and R is not started again (#16)', async ({}, testInfo) => {
    const before = finished.filter((request) => isRFile(request.url)).length;
    await clearLineLog();
    await choose(page, 'test', 'wilcoxon');
    const { differing } = await holdToDesktop('wilcoxon', testInfo);
    expect(differing).toEqual([]);
    await expect(line().locator('p')).toHaveText([
      'Wilcoxon rank sum test with continuity correction: p < 0.001 (Placebo n = 95, Treatment n = 91). Exploratory, unadjusted.',
      'Difference in means (Placebo - Treatment): 1.235, 95% confidence interval 0.844 to 1.626.',
      'R’s note: The difference in means and its interval are from t.test() (Welch), whatever the test.',
      'This test compares the levels of Arm on the 186 participants drawn.'
    ]);
    // R is running: the wait says only that it is waiting, and nothing more is fetched.
    expect((await lineLog())[0]).toEqual(['waiting', WAITING]);
    await page.waitForTimeout(500);
    expect(finished.filter((request) => isRFile(request.url)).length).toBe(before);
  });

  test('GC-STAT-036: with four groups the control offers the several-group tests, and the one-way ANOVA is the one desktop R gives (#16)', async ({}, testInfo) => {
    await choose(page, 'group-by', 'ARM_SEX');
    await expect(page.locator('select[data-control="test"] option')).toHaveText([
      'One-way ANOVA',
      'Kruskal-Wallis test',
      'None'
    ]);
    await choose(page, 'test', 'anova');
    const { differing } = await holdToDesktop('anova', testInfo);
    expect(differing).toEqual([]);
    await expect(line().locator('p')).toHaveText([
      'One-way analysis of variance: p < 0.001 (Placebo F n = 42, Placebo M n = 53, Treatment F n = 42, Treatment M n = 49). Exploratory, unadjusted.',
      'This test compares the levels of Arm and sex on the 186 participants drawn.'
    ]);
  });

  test('GC-STAT-037: the Kruskal-Wallis test is the one desktop R gives (#16)', async ({}, testInfo) => {
    await choose(page, 'test', 'kruskal');
    const { differing } = await holdToDesktop('kruskal', testInfo);
    expect(differing).toEqual([]);
    await expect(line().locator('p')).toHaveText([
      'Kruskal-Wallis rank sum test: p < 0.001 (Placebo F n = 42, Placebo M n = 53, Treatment F n = 42, Treatment M n = 49). Exploratory, unadjusted.',
      'This test compares the levels of Arm and sex on the 186 participants drawn.'
    ]);
  });

  test('GC-STAT-038: pairwise comparisons are the ones desktop R gives, adjusted by Holm; where R’s own answer differs between the two versions, both are shown and nothing else differs (#16)', async ({}, testInfo) => {
    const table = line().locator('table.bv-stat-pairs');
    const cells = () =>
      table
        .locator('tbody tr')
        .evaluateAll((rows) =>
          rows.map((row) => [...row.children].map((cell) => cell.firstChild.textContent))
        );

    // Under the one-way ANOVA every pair is a Welch t-test: no ties to matter,
    // and every number agrees.
    await choose(page, 'test', 'anova');
    await page.locator('input[data-control="pairwise"]').check();
    const means = await holdToDesktop('anova-pairwise', testInfo);
    expect(means.differing).toEqual([]);
    expect(means.actual.rows).toHaveLength(6);
    expect(means.actual.rows.every((row) => row.adjustment === 'holm')).toBe(true);
    await expect(table.locator('caption')).toHaveText(
      'Pairwise comparisons, each by Welch Two Sample t-test. Exploratory, adjusted (Holm).'
    );
    await expect(table.locator('thead th')).toHaveText(['Pair', 'n', 'p, adjusted (Holm)']);
    expect(await cells()).toEqual([
      ['Placebo F and Placebo M', '42, 53', 'p > 0.999'],
      ['Placebo F and Treatment F', '42, 42', 'p < 0.001'],
      ['Placebo F and Treatment M', '42, 49', 'p < 0.001'],
      ['Placebo M and Treatment F', '53, 42', 'p < 0.001'],
      ['Placebo M and Treatment M', '53, 49', 'p < 0.001'],
      ['Treatment F and Treatment M', '42, 49', 'p > 0.999']
    ]);
    await expect(line().locator('.bv-stat-remark')).toHaveText([
      "R’s note: Pairwise: each pair is compared with t.test() (Welch); p_value is adjusted across the pairs by p.adjust(method = 'holm'); the intervals are not adjusted."
    ]);

    // Under the Kruskal-Wallis test every pair is a Wilcoxon rank-sum test.
    await choose(page, 'test', 'kruskal');
    const ranks = await holdToDesktop('kruskal-pairwise', testInfo);
    // The pairs where desktop R (4.3) met ties in two groups of fewer than 50
    // and approximated. There R in the browser (4.6) computes the exact
    // p-value instead: a different method, a different number, and no warning.
    const tied = ranks.expected.rows
      .map((row, index) => (row.warning === TIES ? index : null))
      .filter((index) => index !== null);
    expect(tied).toEqual([1, 5]);
    const known = (where) =>
      where === 'warnings' ||
      tied.some((index) =>
        ['method', 'p_unadjusted', 'p_value', 'warning'].some(
          (member) => where === `rows[${index}].${member}`
        )
      );
    // Every member outside that case agrees with desktop R: the whole-chart
    // test, the counts, the statistics, and the four pairs with no ties to
    // approximate, adjusted p-values included.
    expect(ranks.differing.filter((row) => !known(row.path))).toEqual([]);
    expect(ranks.compared.filter((row) => row.ok && !known(row.path)).length).toBeGreaterThan(80);
    // And the case is the known one, not some other disagreement.
    for (const index of tied) {
      const [desktop, browser] = [ranks.expected.rows[index], ranks.actual.rows[index]];
      expect(desktop.method).toBe('Wilcoxon rank sum test with continuity correction');
      expect(browser.method).toBe('Wilcoxon rank sum exact test');
      expect(browser.warning).toBe(null);
      // The statistic is the same W: only how its p-value is worked out differs.
      expect(browser.statistic).toBe(desktop.statistic);
      expect(browser.n_1 < 50 && browser.n_2 < 50).toBe(true);
    }
    expect(ranks.expected.warnings).toEqual([TIES]);
    session.ties = tied.map((index) => ({
      pair: `${ranks.expected.rows[index].group_1} and ${ranks.expected.rows[index].group_2}`,
      desktop: {
        method: ranks.expected.rows[index].method,
        p_unadjusted: ranks.expected.rows[index].p_unadjusted,
        p_value: ranks.expected.rows[index].p_value,
        warning: ranks.expected.rows[index].warning
      },
      browser: {
        method: ranks.actual.rows[index].method,
        p_unadjusted: ranks.actual.rows[index].p_unadjusted,
        p_value: ranks.actual.rows[index].p_value,
        warning: ranks.actual.rows[index].warning
      }
    }));

    // The page prints what R in this browser returned.
    await expect(line().locator('.bv-stat-result')).toHaveText(
      'Kruskal-Wallis rank sum test: p < 0.001 (Placebo F n = 42, Placebo M n = 53, Treatment F n = 42, Treatment M n = 49). Exploratory, unadjusted.'
    );
    await expect(table.locator('caption')).toHaveText(
      'Pairwise comparisons, each by the test named with it. Exploratory, adjusted (Holm).'
    );
    const printed = await cells();
    expect(printed.map((row) => row.slice(0, 2))).toEqual([
      ['Placebo F and Placebo M', '42, 53'],
      ['Placebo F and Treatment F', '42, 42'],
      ['Placebo F and Treatment M', '42, 49'],
      ['Placebo M and Treatment F', '53, 42'],
      ['Placebo M and Treatment M', '53, 49'],
      ['Treatment F and Treatment M', '42, 49']
    ]);
    // The four pairs both versions agree on print what desktop R's numbers print.
    expect([0, 2, 3, 4].map((index) => printed[index][2])).toEqual([
      'p > 0.999',
      'p < 0.001',
      'p = 0.002',
      'p < 0.001'
    ]);
    await expect(table.locator('tbody .bv-stat-method')).toHaveText(
      ranks.actual.rows.map((row) => row.method)
    );
    session.printedPairs = printed;
  });

  test('GC-STAT-039: a filter change shows the waiting state and then the new result, and never the old one (#16)', async ({}, testInfo) => {
    await page.locator('.sv-reset').click();
    await expect(result()).toContainText('(Placebo n = 95, Treatment n = 91)');
    await clearLineLog();

    await page.locator('select[data-filter="SEX"]').selectOption('F');
    const { differing } = await holdToDesktop('welch-women', testInfo);
    expect(differing).toEqual([]);
    await expect(line().locator('p')).toHaveText([
      'Welch Two Sample t-test: p < 0.001 (Placebo n = 42, Treatment n = 42). Exploratory, unadjusted.',
      'Difference in means (Placebo - Treatment): 1.098, 95% confidence interval 0.5471 to 1.649.',
      'This test compares the levels of Arm on the 84 participants drawn. Filters: Sex is F.'
    ]);
    // From the moment of the change: waiting, then the answer for the 84. The
    // answer for the 186 is not on the line at any point after it.
    const log = await lineLog();
    expect(log.map(([state]) => state)).toEqual(['waiting', 'shown']);
    expect(log[0][1]).toBe(WAITING);
    for (const [, text] of log) expect(text).not.toContain('Placebo n = 95');

    // Back again, and the same holds the other way.
    await clearLineLog();
    await page.locator('select[data-filter="SEX"]').selectOption('__all__');
    await expect(result()).toContainText('(Placebo n = 95, Treatment n = 91)');
    const back = await lineLog();
    expect(back.map(([state]) => state)).toEqual(['waiting', 'shown']);
    for (const [, text] of back) expect(text).not.toContain('Placebo n = 42');
  });

  test('GC-STAT-040: a group below the minimum size prints R’s reason, once, and no number (#16)', async ({}, testInfo) => {
    // The demo's filters, and one more: age, where one arm has a single
    // participant aged 57 with a value.
    await page.evaluate(() => {
      const { chart, groupComparison } = window.BioVizDemo;
      chart.setSettings({
        filters: groupComparison.settings.filters.concat([{ value_col: 'AGE', label: 'Age' }])
      });
    });
    await page.locator('select[data-filter="AGE"]').selectOption('57');
    const { expected, actual, differing } = await holdToDesktop('welch-age-57', testInfo);
    expect(differing).toEqual([]);
    expect(actual.status).toBe('too_small');
    expect(actual.p_value).toBe(null);
    await expect(line()).toHaveAttribute('data-state', 'withheld');
    await expect(line().locator('p')).toHaveText([
      'Not computed: Treatment has 1. The minimum group size is 5. Counts: Placebo n = 7, Treatment n = 1.',
      'This test compares the levels of Arm on the 8 participants drawn. Filters: Age is 57.'
    ]);
    const text = await result().textContent();
    expect(text.startsWith(expected.reason)).toBe(true);
    expect(text.match(/not computed/gi)).toHaveLength(1);
    expect(text).not.toMatch(/p [=<>]/);
    await expect(line().locator('.bv-stat-estimate')).toHaveCount(0);
    await page.locator('select[data-filter="AGE"]').selectOption('__all__');
    await expect(result()).toContainText('(Placebo n = 95, Treatment n = 91)');
  });

  test('GC-STAT-041: the megabytes and seconds of the first test are measured, recorded where a reader of the run can find them, and are what the page tells its reader (#16)', async ({
    browser
  }, testInfo) => {
    // What the page says the first start costs, and the number behind it.
    const told = await page.evaluate(() => window.BioVizDemo.groupComparison);
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
      firstTest: {
        megabytes: measured.cold.megabytes,
        bytes: measured.cold.bytes,
        requests: measured.cold.requests,
        seconds: measured.cold.seconds,
        secondsAre:
          'from the moment the line first read that it was waiting to the moment it printed R’s answer'
      },
      tolerance: `1 part in 10^${Math.round(-Math.log10(TOLERANCE.relative))}`,
      desktopR: statistics.made_by,
      answers: sideBySide,
      knownDifference: session.ties,
      files: measured.cold.files
    };
    const text = JSON.stringify(record, null, 2) + '\n';
    await testInfo.attach('group-comparison-measurements.json', {
      body: text,
      contentType: 'application/json'
    });
    mkdirSync(new URL('../../test-results/', import.meta.url), { recursive: true });
    writeFileSync(
      new URL('../../test-results/group-comparison-measurements.json', import.meta.url),
      text
    );

    console.log(`\nGroup comparison demo, first test — ${record.browser}, ${record.machine}`);
    console.log(
      `  ${record.firstTest.megabytes} MB over the network in ${record.firstTest.requests} ` +
        `requests, ${record.firstTest.seconds} s from waiting to R's answer`
    );
    for (const file of measured.cold.files) {
      console.log(`  ${String(file.bytes).padStart(9)} bytes  ${file.url}`);
    }
    console.log(
      `\nDesktop R ${statistics.made_by.r_version} beside R in the browser, tolerance ${record.tolerance}`
    );
    for (const entry of sideBySide) {
      console.log(
        `  ${entry.case.padEnd(17)} p_value desktop ${String(entry.p_value.desktop).padEnd(24)} ` +
          `browser ${String(entry.p_value.browser).padEnd(24)} ` +
          `${entry.numbersCompared} numbers, greatest relative difference among those that agree ` +
          `${entry.greatestRelativeDifference.toExponential(2)}, ${entry.differing.length} differing`
      );
    }
    for (const tie of session.ties) {
      console.log(
        `  known difference, ${tie.pair}: desktop ${tie.desktop.method}, unadjusted ` +
          `${tie.desktop.p_unadjusted}, adjusted ${tie.desktop.p_value}; browser ` +
          `${tie.browser.method}, unadjusted ${tie.browser.p_unadjusted}, adjusted ${tie.browser.p_value}`
      );
    }
    // Every case of the four tests and the pairwise comparisons was compared.
    expect(sideBySide.map((entry) => entry.case)).toEqual([
      'welch',
      'wilcoxon',
      'anova',
      'kruskal',
      'anova-pairwise',
      'kruskal-pairwise',
      'welch-women',
      'welch-age-57'
    ]);
  });

  test('GC-STAT-042: on a phone the demo prints R’s result and a pairwise table, and the page does not scroll sideways (#16)', async () => {
    // The page as a phone opens it: loaded at that width, where the controls
    // start folded away. R is started again, from the files the browser kept.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await openView();
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
    await expect(result()).toHaveText(
      'Welch Two Sample t-test: p < 0.001 (Placebo n = 95, Treatment n = 91). Exploratory, unadjusted.'
    );
    expect(await measure()).toEqual(holds);

    // One tap opens the controls: four groups, every pair compared.
    await page.locator('.sv-sidebar-toggle').click();
    await choose(page, 'group-by', 'ARM_SEX');
    await page.locator('input[data-control="pairwise"]').check();
    await page.locator('.sv-sidebar-toggle').click();
    await answered();
    const table = line().locator('table.bv-stat-pairs');
    await expect(table.locator('tbody tr')).toHaveCount(6);
    await expect(table.locator('caption')).toHaveText(
      'Pairwise comparisons, each by Welch Two Sample t-test. Exploratory, adjusted (Holm).'
    );
    expect(await measure()).toEqual(holds);
    const overflowing = await page.evaluate(() =>
      [...document.querySelectorAll('#demo .bv-statistic, #demo .bv-statistic *')]
        .filter((element) => element.getBoundingClientRect().right > 390.5)
        .map((element) => element.tagName.toLowerCase())
    );
    expect(overflowing).toEqual([]);
    await line().scrollIntoViewIfNeeded();
    await captureEvidence(line(), 'GC-STAT-042', 'r-in-the-browser-on-a-phone');
  });
});

// ---------------------------------------------------------------------------
// The demo as it opens, for real (#17, #84): the tiles, and then one biomarker
// opened from its tile, with R in the browser. Like the group above this needs the
// network, fails when R's host cannot be reached, and is not retried. It has a
// browser of its own, on a new and empty profile, because what it watches is
// the first time R is asked for on a page that opened without asking.

test.describe('group comparison: the demo’s tiles, with R in the browser, live', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  let context;
  let page;
  const requested = [];
  const forR = () =>
    requested.filter((url) => isRHost(url) || new URL(url).pathname.endsWith('/statistics.R'));

  test.beforeAll(async ({}, testInfo) => {
    const profile = mkdtempSync(path.join(tmpdir(), 'bio-viz-tiles-'));
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 1280, height: 800 }
    });
    // Every state each panel's statistics line takes, in the order it takes them.
    await context.addInitScript(() => {
      window.__lines = [];
      new MutationObserver(() => {
        document.querySelectorAll('.bv-panel').forEach((panel) => {
          const line = panel.querySelector('.bv-statistic');
          if (!line || !line.dataset.state) return;
          const entry = { panel: panel.dataset.panel, state: line.dataset.state };
          const last = window.__lines.filter((one) => one.panel === entry.panel).pop();
          if (!last || last.state !== entry.state) {
            window.__lines.push({ ...entry, text: line.textContent });
          }
        });
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true
      });
    });
    page = context.pages()[0] || (await context.newPage());
    page.on('request', (request) => requested.push(request.url()));
    await page.goto('/_site/group-comparison/index.html');
    await page.evaluate(() => window.BioVizDemo.ready);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('GC-OVW-019: on the demo the tiles start no R; opening a biomarker starts it once, and its five visit panels each wait and print the test desktop R gives for that visit (#17, #84)', async ({}, testInfo) => {
    // The tiles, as the page opens: R's hosts are in reach, and not asked.
    await expect(page.locator('.bv-tile')).toHaveCount(12);
    await page.waitForTimeout(1500);
    expect(forR()).toEqual([]);
    expect(await page.evaluate(() => window.BioVizDemo.chart.statistics())).toEqual([]);

    // One biomarker, opened from its tile.
    await page.locator('.bv-tile[data-measure="IL-6"]').click();
    const lines = page.locator('.bv-panel .bv-statistic');
    await expect(lines).toHaveCount(5);
    // While R starts the page answers: a box lists its participants.
    await page.locator('.bv-panel canvas').first().scrollIntoViewIfNeeded();
    const point = await page.evaluate(() => {
      const chart = window.BioVizDemo.chart.charts[0];
      const cell = chart.$panel.cells[0];
      const box = chart.canvas.getBoundingClientRect();
      return {
        x: box.left + chart.scales.x.getPixelForValue(cell.x),
        y: box.top + chart.scales.y.getPixelForValue(cell.stats.median)
      };
    });
    await page.mouse.click(point.x, point.y);
    await expect(page.locator('.sv-listing-actions strong')).toHaveText('100 of 100 records');

    for (const index of [0, 1, 2, 3, 4]) {
      await expect(lines.nth(index)).toHaveAttribute('data-state', 'shown', { timeout: 200_000 });
    }
    // Each panel waited and then printed, for itself. The first to wait said
    // what the first start costs, and only it.
    const log = await page.evaluate(() => window.__lines);
    for (const visit of VISITS) {
      expect(
        log.filter((entry) => entry.panel === visit).map((entry) => entry.state),
        visit
      ).toEqual(['waiting', 'shown']);
    }
    const waited = log.filter((entry) => entry.state === 'waiting').map((entry) => entry.text);
    expect(waited).toEqual([
      'Statistics: waiting for R… The first test starts R in this browser: about 13 MB to download, once, and a few seconds.',
      WAITING,
      WAITING,
      WAITING,
      WAITING
    ]);
    // R was started once for the five of them, and given its one file once.
    expect(forR().filter((url) => url.endsWith('/webr.mjs'))).toEqual([
      'https://webr.r-wasm.org/v0.6.0/webr.mjs'
    ]);
    expect(forR().filter((url) => url.endsWith('/statistics.R'))).toHaveLength(1);
    expect(forR().filter((url) => url.endsWith('/R.wasm'))).toHaveLength(1);

    // Five requests, one per visit panel, each answered with what desktop R
    // gives for that panel's rows.
    const asked = await page.evaluate(() => window.BioVizDemo.chart.statistics());
    expect(asked.map((entry) => entry.panel)).toEqual(VISITS);
    const drawnRows = await page.evaluate(() =>
      window.BioVizDemo.chart.model.panels.map((panel) =>
        panel.records.map((record) => Object.values(record))
      )
    );
    const cases = ['baseline', 'week-2', 'week-4', 'week-8', 'week-12'].map((visit) =>
      resultOf(`result-${visit}`)
    );
    const compared = [];
    cases.forEach((expected, index) => {
      const answer = asked[index];
      expect(answer.answer.status, expected.case).toBe('ok');
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
      const rows = readFileSync(
        new URL(`../fixtures/group-statistics/${expected.file}`, import.meta.url),
        'utf8'
      )
        .trimEnd()
        .split('\n')
        .slice(1)
        .map((row) => row.split(',').map((cell, at) => (at === 1 ? Number(cell) : cell)));
      expect(drawnRows[index], expected.case).toEqual(rows);
      const leaves = compareValues(expected.value, answer.answer.value);
      expect(
        leaves.filter((leaf) => !leaf.ok),
        expected.case
      ).toEqual([]);
      compared.push({
        case: expected.case,
        desktop: expected.value.p_value,
        browser: answer.answer.value.p_value,
        numbers: leaves.filter((leaf) => leaf.difference !== null).length
      });
    });
    await expect(page.locator('.bv-panel .bv-stat-result')).toHaveText([
      'Welch Two Sample t-test: p = 0.221 (Placebo n = 100, Treatment n = 100). Exploratory, unadjusted.',
      'Welch Two Sample t-test: p < 0.001 (Placebo n = 92, Treatment n = 93). Exploratory, unadjusted.',
      'Welch Two Sample t-test: p < 0.001 (Placebo n = 95, Treatment n = 91). Exploratory, unadjusted.',
      'Welch Two Sample t-test: p < 0.001 (Placebo n = 93, Treatment n = 95). Exploratory, unadjusted.',
      'Welch Two Sample t-test: p < 0.001 (Placebo n = 92, Treatment n = 92). Exploratory, unadjusted.'
    ]);
    await expect(page.locator('.bv-panel .bv-stat-estimate').first()).toHaveText(
      'Difference in means (Placebo - Treatment): 0.2522, 95% confidence interval -0.1533 to 0.6577.'
    );
    await expect(page.locator('.bv-panel .bv-stat-scope').first()).toHaveText(
      'This test compares the levels of Arm on the 200 participants drawn in this panel (Baseline). ' +
        'Each panel has a test of its own, and they are not adjusted for one another.'
    );
    await testInfo.attach('tiles-five-panels-desktop-R-and-webR.json', {
      body: JSON.stringify(compared, null, 2),
      contentType: 'application/json'
    });
    console.log('\nIL-6 opened from its tile: five panels, desktop R beside R in the browser');
    for (const entry of compared) {
      console.log(
        `  ${entry.case.padEnd(15)} p_value desktop ${String(entry.desktop).padEnd(24)} ` +
          `browser ${String(entry.browser).padEnd(24)} ${entry.numbers} numbers held equal`
      );
    }

    // Back to the tiles: no test, and nothing more asked of R or fetched.
    const before = forR().length;
    await choose(page, 'measure', 'bv_overview');
    await expect(page.locator('.bv-tile')).toHaveCount(12);
    expect(await page.evaluate(() => window.BioVizDemo.chart.statistics())).toEqual([]);
    await expect(page.locator('.sv-main')).not.toContainText('Welch');
    // Another biomarker: the same R answers, and nothing is fetched again.
    await page.locator('.bv-tile[data-measure="CRP"]').click();
    for (const index of [0, 1, 2, 3, 4]) {
      await expect(lines.nth(index)).toHaveAttribute('data-state', 'shown', { timeout: 60_000 });
    }
    await page.waitForTimeout(500);
    expect(forR().length).toBe(before);
  });
});

test.describe('group comparison: the filter rules safety.viz’s charts follow', () => {
  test('GC-FILTER-007: a filter reads its spec by safety.viz’s rule: `start` opens it with All still offered, only `all: false` removes All and its first value is then in force, a value the data lacks falls back to All with a warning, and the chart filters by what the controls show (#37)', async ({
    page
  }) => {
    const warnings = warningsOf(page);
    await open(page, {
      settings: {
        start_value: 'IL-6',
        visits: ['Week 4'],
        value_type: 'change',
        group_by: 'SEX',
        filters: RULED_FILTERS
      }
    });
    await expectFilterRules(page, warnings, () => ({ ...window.__gc.chart.state.filters }));
  });
});

// ---- The shared cut rule (#43) ---------------------------------------------------

// What desktop R makes of each cut (tools/r-cut.R): the points, the labels and,
// for the drawn biomarker, the count in each group. No number below was typed.
const cutsFromR = readJson('../fixtures/cut-r.json');
const cutCase = (name) => cutsFromR.cases.find((entry) => entry.name === name);
const CRP_CUTS = [
  ['median', 'CRP at Baseline, cut at the median'],
  ['tertiles', 'CRP at Baseline, cut at the tertiles'],
  ['quartiles', 'CRP at Baseline, cut at the quartiles'],
  [[2, 5], 'CRP at Baseline, cut at 2 and 5']
];
const crpCut = (cut) => ({ measure: 'CRP', visit: 'Baseline', cut });
const IL6_WEEK_4 = { start_value: 'IL-6', visits: ['Week 4'], value_type: 'change' };
// The groups R drew a biomarker in, low to high, each with its count; a group
// with nobody in it is not drawn.
const ticksOf = (entry) =>
  entry.labels
    .map((group, index) => [group, `n = ${entry.drawn.counts[index]}`])
    .filter((tick) => tick[1] !== 'n = 0');

test.describe('group comparison: a cut biomarker makes the groups', () => {
  test('GC-CUT-001: IL-6’s change to Week 4 by CRP at Baseline cut at the median, the tertiles, the quartiles and typed points: the groups low to high, each with R’s count beneath (#43)', async ({
    page
  }) => {
    const errors = watch(page);
    for (const [cut, name] of CRP_CUTS) {
      const entry = cutCase(name);
      await open(page, { settings: { ...IL6_WEEK_4, group_by: crpCut(cut) } });
      const [panel] = await drawn(page);
      expect(panel.ticks, name).toEqual(ticksOf(entry));
      expect(
        panel.cells.map((cell) => cell.level),
        name
      ).toEqual(entry.labels);
      // The Group control names the cut, and holds it.
      await expect(page.locator('select[data-control="group-by"] option:checked')).toHaveText(name);
      if (cut === 'tertiles') {
        await captureEvidence(page.locator('.sv-main'), 'GC-CUT-001', 'il-6-by-crp-tertiles');
      }
    }
    expect(errors).toEqual([]);
  });

  test('GC-CUT-002: the footnote states the cut and its points, worked out on the participants with a value (#43)', async ({
    page
  }) => {
    const median = cutCase('CRP at Baseline, cut at the median');
    await open(page, { settings: { ...IL6_WEEK_4, group_by: crpCut('median') } });
    await expect(page.locator('.sv-footnote')).toHaveText(
      'Click a box to list its participants. CRP at Baseline is cut at its median, ' +
        `${median.labels[1].slice(2)}, worked out on the ${median.n} participants with a value.`
    );
    const tertiles = cutCase('CRP at Baseline, cut at the tertiles');
    await open(page, { settings: { ...IL6_WEEK_4, group_by: crpCut('tertiles') } });
    await expect(page.locator('.sv-footnote')).toContainText(
      `CRP at Baseline is cut at its tertiles, ${tertiles.labels[0].slice(2)} and ` +
        `${tertiles.labels[2].slice(2)}, worked out on the ${tertiles.n} participants with a value.`
    );
    await open(page, { settings: { ...IL6_WEEK_4, group_by: crpCut([2, 5]) } });
    await expect(page.locator('.sv-footnote')).toContainText('CRP at Baseline is cut at 2 and 5.');
  });

  test('GC-CUT-003: a cut biomarker makes the panels, in its order, each with R’s counts (#43)', async ({
    page
  }) => {
    const entry = cutCase('CRP at Baseline, cut at the median');
    await open(page, {
      settings: { ...IL6_WEEK_4, group_by: null, panel_by: crpCut('median') }
    });
    const panels = await drawn(page);
    expect(panels.map((panel) => panel.title)).toEqual(entry.labels);
    // By arm within each panel; together the panels hold R's count of each group.
    panels.forEach((panel, index) => {
      const n = panel.cells.reduce((total, cell) => total + cell.n, 0);
      expect(n, panel.title).toBe(entry.drawn.counts[index]);
    });
    await expect(page.locator('select[data-control="panel-by"] option:checked')).toHaveText(
      'CRP at Baseline, cut at the median'
    );
    await expect(page.locator('.sv-footnote')).toContainText(
      'CRP at Baseline is cut at its median'
    );
    await captureEvidence(page.locator('.sv-main'), 'GC-CUT-003', 'panels-by-crp-median');
  });

  test('GC-CUT-006: the cut points are worked out on the participants the filters keep, and move with the filters (#43)', async ({
    page
  }) => {
    const women = cutCase('IL-6 at baseline, cut at the median, for women');
    await open(page, {
      settings: {
        start_value: 'IL-6',
        visits: ['Week 4'],
        value_type: 'baseline',
        group_by: { measure: 'IL-6', value: 'baseline', cut: 'median' },
        filters: [{ value_col: 'SEX', label: 'Sex', start: 'F' }]
      }
    });
    const [panel] = await drawn(page);
    expect(panel.ticks).toEqual(
      women.labels.map((group, index) => [group, `n = ${women.counts[index]}`])
    );
    await expect(page.locator('.sv-footnote')).toContainText(
      `IL-6 at baseline is cut at its median, ${women.labels[1].slice(2)}, worked out on the ` +
        `${women.n} participants with a value.`
    );
    // All participants: the median moves.
    await page.locator('.sv-sidebar select[data-filter="SEX"]').selectOption('__all__');
    const [all] = await drawn(page);
    expect(all.ticks.map((tick) => tick[0])).not.toEqual(women.labels);
  });

  test('GC-CUT-008: a cut has no Levels control: every group it makes is drawn (#43)', async ({
    page
  }) => {
    await open(page, { settings: { ...IL6_WEEK_4, group_by: crpCut('quartiles') } });
    await expect(page.locator('[data-control="levels"]')).toHaveCount(0);
    await expect(page.locator('.bv-control-note')).toContainText(
      'Every group a cut makes is drawn.'
    );
    // A column again: the control is back.
    await choose(page, 'group-by', 'ARM');
    await expect(page.locator('[data-control="levels"]')).toHaveCount(1);
  });

  test('GC-CUT-010: with R’s stored answers for cut groups R made itself, the result names the groups low to high, and a group below R’s minimum size prints R’s reason and counts (#43, #46)', async ({
    page
  }) => {
    const errors = watch(page);
    const recipes = ['cut-median', 'cut-too-small'].map((name) => {
      const { args, dataId, rows, value } = statistics.recipes.find((entry) => entry.case === name);
      return { name: 'Analyze_GroupDifference', args, dataId, rows, value };
    });
    const line = page.locator('.sv-main > .bv-statistic');
    // R's counts, in the order R named them.
    const countsOf = (value) =>
      Object.entries(value.counts)
        .map(([group, n]) => `${group} n = ${n}`)
        .join(', ');
    const withStored = async (cut) => {
      await open(page, {
        settings: { ...IL6_WEEK_4, baseline_visits: 'Baseline', group_by: crpCut(cut) }
      });
      await page.evaluate((results) => {
        window.__gc.chart.setSettings({
          connection: window.BioViz.r.createConnection({ results })
        });
      }, recipes);
    };

    await withStored('median');
    await expect(line.locator('.bv-stat-result')).toContainText('Welch Two Sample t-test');
    expect(Object.keys(recipes[0].value.counts)).toEqual(['≤ 2.783', '> 2.783']);
    await expect(line.locator('.bv-stat-result')).toContainText(`(${countsOf(recipes[0].value)})`);
    await expect(line.locator('.bv-stat-estimate')).toContainText(
      'Difference in means (≤ 2.783 - > 2.783)'
    );

    await withStored([10]);
    const tooSmall = recipes[1].value;
    expect(tooSmall.status).toBe('too_small');
    await expect(line).toHaveAttribute('data-state', 'withheld');
    await expect(line).toContainText(tooSmall.reason);
    await expect(line).toContainText(`Counts: ${countsOf(tooSmall)}.`);
    await expect(line).not.toContainText('p =');
    const [asked] = await page.evaluate(() => window.__gc.chart.statistics());
    expect(asked.answer.form).toBe('precomputed');
    await captureEvidence(page.locator('.sv-main'), 'GC-CUT-010', 'cut-group-too-small');
    expect(errors).toEqual([]);
  });
});

// ---- What the v0.1.0-RC1 review found (#49) ---------------------------------------

test.describe('group comparison: what the v0.1.0-RC1 review found', () => {
  test('GC-STAT-043: once the connection is replaced, a late answer from the old one changes neither the line nor what chart.statistics() reports (#49)', async ({
    page
  }) => {
    await expectReplacedConnectionDead(page, 'gc');
  });

  test('GC-FAIL-001: when drawing fails the chart says so in its element and keeps its controls, leaving nothing half drawn, and draws again once it can (#49)', async ({
    page
  }) => {
    await expectFailureSaid(page, 'gc', (name) => window[name].chart.charts.length);
  });

  test('GC-DROP-001: with a participant table, participants it does not have and rows with no participant id are counted by reason; a participant table without the id column is refused with a sentence that names it (#49)', async ({
    page
  }) => {
    await expectDropsCounted(page, 'gc');
  });

  test('GC-DROP-002: with results the participant table does not have and filters that let nobody through, the chart says that nobody passes the filters (#49)', async ({
    page
  }) => {
    await expectNobodyWithOrphans(page, 'gc');
  });

  test('GC-DROP-003: a setting naming a participant id column the participant table does not have is refused with the same sentence, and the chart stays as it was (#49)', async ({
    page
  }) => {
    await expectSettingsRefused(page, 'gc');
  });

  test('GC-DROP-004: the participant table and the setting that names its id column change together, with setData(tables, settings), and the chart draws (#52)', async ({
    page
  }) => {
    await expectTablesAndSettingsTogether(page, 'gc');
  });

  test('GC-DRAW-007: with one biomarker open at several visits, the groups’ labels under each visit’s panel do not run into one another, on a desk and on a phone (#49)', async ({
    page
  }) => {
    await page.route(/^https:\/\/(webr|repo)\.r-wasm\.org\//, (route) => route.abort());
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/tests/e2e/fixtures/group-comparison.html');
      await page.evaluate(() => window.__gc.ready);
      const panels = await page.evaluate(async () => {
        const { chart, data } = window.__gc;
        // Three arms with long names, as a study's are.
        const arms = ['Placebo', 'Xanomeline High Dose', 'Xanomeline Low Dose'];
        const participants = data.participants.map((row, index) => ({
          ...row,
          ARM: arms[index % 3]
        }));
        chart.setData({ results: data.results, participants });
        chart.setSettings({
          start_value: 'IL-6',
          // Four of its five visits: a panel each. All five is the picture over time.
          visits: ['Baseline', 'Week 2', 'Week 4', 'Week 8'],
          group_by: 'ARM',
          value_type: 'raw'
        });
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50)));
        return chart.charts.map((drawn) => {
          const axis = drawn.scales.x;
          const ctx = drawn.ctx;
          const font = axis._resolveTickFontOptions(0);
          ctx.save();
          ctx.font = font.string;
          const lines = drawn.$panel.ticks.map((tick) => [].concat(tick));
          const widest = Math.max(
            ...lines.flatMap((tick) => tick.map((line) => ctx.measureText(line).width))
          );
          ctx.restore();
          const height = Math.max(...lines.map((tick) => tick.length)) * font.lineHeight;
          const spacing = axis.getPixelForValue(1) - axis.getPixelForValue(0);
          return { rotation: axis.labelRotation, widest, height, spacing };
        });
      });
      expect(panels.length, `${width}px`).toBe(4);
      for (const panel of panels) {
        // Level labels fit side by side, or are turned so that neighbours do not touch.
        const fits =
          panel.rotation === 0
            ? panel.widest <= panel.spacing
            : panel.spacing * Math.sin((panel.rotation * Math.PI) / 180) >= panel.height;
        expect(fits, `${width}px: ${JSON.stringify(panel)}`).toBe(true);
      }
    }
  });

  test('GC-DRAW-008: with five long arm names, the groups’ labels under each visit’s panel do not run into one another at 1280 pixels wide; narrower is #53 (#52)', async ({
    page
  }) => {
    await page.route(/^https:\/\/(webr|repo)\.r-wasm\.org\//, (route) => route.abort());
    for (const width of [1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/tests/e2e/fixtures/group-comparison.html');
      await page.evaluate(() => window.__gc.ready);
      const panels = await page.evaluate(async () => {
        const { chart, data } = window.__gc;
        // Three arms with long names, as a study's are.
        const arms = [
          'Placebo',
          'Xanomeline Low Dose',
          'Xanomeline Medium Dose',
          'Xanomeline High Dose',
          'Xanomeline Highest Dose'
        ];
        const participants = data.participants.map((row, index) => ({
          ...row,
          ARM: arms[index % 5]
        }));
        chart.setData({ results: data.results, participants });
        chart.setSettings({
          start_value: 'IL-6',
          // Four of its five visits: a panel each. All five is the picture over time.
          visits: ['Baseline', 'Week 2', 'Week 4', 'Week 8'],
          group_by: 'ARM',
          value_type: 'raw'
        });
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50)));
        return chart.charts.map((drawn) => {
          const axis = drawn.scales.x;
          const ctx = drawn.ctx;
          const font = axis._resolveTickFontOptions(0);
          ctx.save();
          ctx.font = font.string;
          const lines = drawn.$panel.ticks.map((tick) => [].concat(tick));
          const widest = Math.max(
            ...lines.flatMap((tick) => tick.map((line) => ctx.measureText(line).width))
          );
          ctx.restore();
          const height = Math.max(...lines.map((tick) => tick.length)) * font.lineHeight;
          const spacing = axis.getPixelForValue(1) - axis.getPixelForValue(0);
          return { rotation: axis.labelRotation, widest, height, spacing };
        });
      });
      expect(panels.length, `${width}px`).toBe(4);
      for (const panel of panels) {
        // Level labels fit side by side, or are turned so that neighbours do not touch.
        const fits =
          panel.rotation === 0
            ? panel.widest <= panel.spacing
            : panel.spacing * Math.sin((panel.rotation * Math.PI) / 180) >= panel.height;
        expect(fits, `${width}px: ${JSON.stringify(panel)}`).toBe(true);
      }
    }
  });

  test('GC-CTRL-008: with one biomarker open the Visit control offers, and the chart draws, only the visits that biomarker has values at, in visit order (#49)', async ({
    page
  }) => {
    await page.route(/^https:\/\/(webr|repo)\.r-wasm\.org\//, (route) => route.abort());
    await page.goto('/tests/e2e/fixtures/group-comparison.html');
    await page.evaluate(() => window.__gc.ready);
    const said = await page.evaluate(() => {
      const { chart, data } = window.__gc;
      // IL-6 has no result at Week 2; the other biomarkers do.
      const results = data.results.filter(
        (row) => !(row.TEST === 'IL-6' && row.VISIT === 'Week 2')
      );
      chart.setData({ results, participants: data.participants });
      chart.setSettings({ start_value: 'IL-6', visits: null, value_type: 'raw' });
      const offered = () =>
        [...document.querySelectorAll('#chart [data-control="visits"] input[type="checkbox"]')]
          .map((box) => box.value)
          .filter((value) => value && value !== '__all__' && value !== 'on');
      const il6 = { offered: offered(), panels: chart.model.panels.map((panel) => panel.visit) };
      chart.selectMeasure('CRP');
      const crp = { offered: offered(), panels: chart.model.panels.map((panel) => panel.visit) };
      return { il6, crp };
    });
    expect(said.il6.panels).toEqual(['Baseline', 'Week 4', 'Week 8', 'Week 12']);
    expect(said.il6.offered).toEqual(['Baseline', 'Week 4', 'Week 8', 'Week 12']);
    expect(said.crp.panels).toEqual(['Baseline', 'Week 2', 'Week 4', 'Week 8', 'Week 12']);
    expect(said.crp.offered).toEqual(['Baseline', 'Week 2', 'Week 4', 'Week 8', 'Week 12']);
  });

  test('GC-FAIL-002: a failure while the controls are built, where the Levels control reads the groups, is said like any other: the chart could not be drawn, and nothing is thrown (#49)', async ({
    page
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/tests/e2e/fixtures/group-comparison.html');
    await page.evaluate(() => window.__gc.ready);
    const threw = await page.evaluate(() => {
      const { chart, data } = window.__gc;
      // Tables the frame refuses, put in place past the checks, and read as the
      // chart reads its tables for the visits it draws (#84).
      chart.tables = {
        results: data.results,
        participants: data.participants.map(({ USUBJID, ...rest }) => ({
          SUBJID: USUBJID,
          ...rest
        }))
      };
      chart.readVisits(false);
      const log = console.error;
      console.error = () => {};
      try {
        chart.buildControls();
        chart.render();
        return null;
      } catch (error) {
        return error.message;
      } finally {
        console.error = log;
      }
    });
    expect(threw).toBe(null);
    await expect(page.locator('#chart .sv-footnote')).toContainText(
      'This chart could not be drawn:'
    );
    expect(errors).toEqual([]);
  });
});
