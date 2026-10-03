import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, chromium } from '@playwright/test';
import { compareValues, TOLERANCE } from '../../site/r-check/check.mjs';
import { captureEvidence } from './evidence.js';
import { RULED_FILTERS, expectFilterRules, warningsOf } from './filterRules.js';
import { NOBODY_PASSES, asked, expectNobody, letNobodyThrough, openDemo } from './nobody.js';

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
    const lines = text.split('\n');
    expect(lines[0]).toBe('Participant,ARM,Value');
    expect(lines).toHaveLength(92);
    expect(lines[1]).toMatch(/^"BIO-\d{3}","Treatment","-?\d/);
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
        window.__r.calls.push({
          name,
          rows: request.data.length,
          args: request.args,
          fields: Object.keys(request.data[0]),
          counts,
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

// The overview (#17): what the chart opens on when no biomarker is named. The
// fixture page names IL-6 at Week 4, so these tests set both to null, which is
// what the settings default to.
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
const openOverview = (page, { data = 'both', settings = {}, before = null } = {}) =>
  open(page, { data, before, settings: { ...OVERVIEW, ...settings } });

// The overview as the page has it: its rows, and every chart drawn in them.
const overviewOf = (page) =>
  page.evaluate(() => ({
    rows: [...document.querySelectorAll('.bv-overview-row')].map((row) => ({
      measure: row.dataset.measure,
      heading: row.querySelector('h3').textContent,
      visits: [...row.querySelectorAll('.bv-overview-panel h4')].map((title) => title.textContent),
      role: row.getAttribute('role'),
      tabIndex: row.tabIndex,
      label: row.getAttribute('aria-label')
    })),
    charts: window.__gc.chart.charts.map((chart) => ({
      measure: chart.$measure,
      visit: chart.$panel.visit,
      ticks: chart.scales.x.ticks.map((tick) => tick.label),
      y: [chart.scales.y.min, chart.scales.y.max],
      yType: chart.scales.y.type,
      n: chart.$panel.records.length,
      cells: chart.$panel.cells.map((cell) => cell.n),
      plugins: chart.config.plugins.map((plugin) => plugin.id.replace(/-[a-z0-9]+$/, '')),
      points: chart.data.datasets.reduce((total, dataset) => total + dataset.data.length, 0),
      withKit: chart instanceof window.SafetyViz.kit.Chart
    })),
    statistics: window.__gc.chart.statistics(),
    lines: [...document.querySelectorAll('.bv-statistic')].map((line) => line.textContent)
  }));
const chartsOf = (overview, measure) =>
  overview.charts.filter((chart) => chart.measure === measure);

test.describe('group comparison: the overview of every biomarker', () => {
  test('GC-OVW-011: with no biomarker named the chart opens on every biomarker at every visit: a row each, a panel per visit, the number in each group, and no statistics line (#17)', async ({
    page
  }) => {
    const errors = watch(page);
    await openOverview(page);
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('bv_overview');
    await expect(page.locator('select[data-control="measure"] option').first()).toHaveText(
      'All Biomarkers'
    );
    await expect(page.locator('[data-control="visits"] summary')).toHaveText('All (5)');

    const overview = await overviewOf(page);
    // A row per biomarker, in the Biomarker control's order.
    expect(overview.rows.map((row) => row.measure)).toEqual(BIOMARKERS);
    expect(await page.locator('select[data-control="measure"] option').allTextContents()).toEqual([
      'All Biomarkers',
      ...BIOMARKERS
    ]);
    for (const row of overview.rows) expect(row.visits, row.measure).toEqual(VISITS);
    expect(overview.rows.find((row) => row.measure === 'IL-6').heading).toBe('IL-6 (pg/mL)');

    // Sixty panels, each a chart of its own, drawn with the kit's Chart.js.
    expect(overview.charts).toHaveLength(60);
    expect(overview.charts.every((chart) => chart.withKit)).toBe(true);
    for (const measure of BIOMARKERS) {
      const charts = chartsOf(overview, measure);
      expect(
        charts.map((chart) => chart.visit),
        measure
      ).toEqual(VISITS);
      // The groups, with the number in each beneath.
      for (const chart of charts) {
        expect(chart.ticks.map((tick) => tick[0])).toEqual(['Placebo', 'Treatment']);
        expect(chart.ticks.map((tick) => tick[1])).toEqual(chart.cells.map((n) => `n = ${n}`));
        expect(chart.plugins).toContain('gc-boxwhisker');
      }
      // One value axis for the biomarker, across its visits.
      expect(new Set(charts.map((chart) => chart.y.join())).size, measure).toBe(1);
    }
    // And its own: biomarkers on different scales have different axes.
    expect(new Set(overview.charts.map((chart) => chart.y.join())).size).toBe(12);
    // IL-6 at each visit: every participant with a result, one record each.
    expect(chartsOf(overview, 'IL-6').map((chart) => chart.n)).toEqual([200, 185, 186, 188, 184]);
    expect(chartsOf(overview, 'IL-6')[0].ticks).toEqual([
      ['Placebo', 'n = 100'],
      ['Treatment', 'n = 100']
    ]);

    await expect(page.locator('.bv-overview-count')).toHaveText('All 12 biomarkers are shown.');
    await expect(page.locator('.sv-footnote')).toHaveText(
      'Click a biomarker to view it alone, with a test under each visit.'
    );
    // The single chart gives way to the rows, and no test is printed or asked for.
    await expect(page.locator('.sv-chart-wrap')).toBeHidden();
    expect(overview.lines).toEqual(['']);
    await expect(page.locator('.sv-main > .bv-statistic')).toBeHidden();
    expect(overview.statistics).toEqual([]);
    expect(errors).toEqual([]);
    await captureEvidence(
      page.locator('.bv-overview-row[data-measure="IL-6"]'),
      'GC-OVW-011',
      'a-biomarker-row'
    );
  });

  test('GC-OVW-012: a biomarker’s row is a button that opens it alone, by a click or by Enter or Space, with its visits as panels and a statistics line under each; All Biomarkers returns to the overview (#17)', async ({
    page
  }) => {
    await openOverview(page);
    const { rows } = await overviewOf(page);
    for (const row of rows) {
      expect(row.role).toBe('button');
      expect(row.tabIndex).toBe(0);
      expect(row.label).toBe(`View ${row.measure}`);
    }

    // A click.
    await page.locator('.bv-overview-row[data-measure="IL-6"]').click();
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('IL-6');
    await expect(page.locator('.bv-overview-row')).toHaveCount(0);
    await expect(page.locator('.bv-panel h3')).toHaveText(VISITS);
    let panels = await drawn(page);
    expect(panels.map((panel) => panel.title)).toEqual(VISITS);
    expect(panels[0].yTitle).toBe('IL-6 (pg/mL)');
    // One statistics line per panel: with no R attached each says so.
    await expect(page.locator('.bv-panel .bv-statistic')).toHaveText(
      VISITS.map(() => 'Statistics are unavailable: no R is attached to this chart.')
    );
    // The single view is the chart as it was: a box lists its participants.
    await clickCell(page, 'Treatment', null, 2);
    await expect(page.locator('.sv-listing-actions strong')).toHaveText('91 of 91 records');

    // Back, from the Biomarker control.
    await choose(page, 'measure', 'bv_overview');
    await expect(page.locator('.bv-overview-row')).toHaveCount(12);
    await expect(page.locator('.sv-listing table')).toHaveCount(0);
    await expect(page.locator('.bv-panel')).toHaveCount(0);

    // Enter, on the row the keyboard is on.
    await page.locator('.bv-overview-row[data-measure="CRP"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('CRP');
    panels = await drawn(page);
    expect(panels).toHaveLength(5);
    expect(panels[0].yTitle).toBe('CRP (mg/L)');
    // The keyboard's place is on the Biomarker control, which leads back.
    await expect(page.locator('select[data-control="measure"]')).toBeFocused();

    // Space.
    await choose(page, 'measure', 'bv_overview');
    await page.locator('.bv-overview-row[data-measure="VEGF"]').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('VEGF');
    // Any other key leaves the overview as it is.
    await choose(page, 'measure', 'bv_overview');
    await page.locator('.bv-overview-row[data-measure="VEGF"]').focus();
    await page.keyboard.press('a');
    await expect(page.locator('.bv-overview-row')).toHaveCount(12);

    // Reset returns to what the chart opened on: the overview.
    await page.locator('.bv-overview-row[data-measure="LDH"]').click();
    await expect(page.locator('.bv-panel')).toHaveCount(5);
    await page.locator('.sv-reset').click();
    await expect(page.locator('.bv-overview-row')).toHaveCount(12);
    // And a setting that names a biomarker opens that biomarker.
    await page.evaluate(() => window.__gc.chart.setSettings({ start_value: 'IL-8' }));
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('IL-8');
    await page.evaluate(() => window.__gc.chart.setSettings({ start_value: null }));
    await expect(page.locator('.bv-overview-row')).toHaveCount(12);
  });

  test('GC-OVW-013: the overview asks R for nothing: no call, no request to R’s hosts and no waiting text; opening a biomarker asks once per visit panel, and each waits and is answered for itself (#17)', async ({
    page
  }) => {
    // R's hosts are not blocked here: every request the page makes is recorded.
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    const note = 'The first test starts R here.';
    await openOverview(page, { before: stubR, settings: { waiting_note: note } });
    await attachStub(page);
    await expect(page.locator('.bv-overview-row')).toHaveCount(12);

    // Drawn, and drawn again by every kind of control: nothing is asked.
    await page.locator('select[data-filter="SEX"]').selectOption('F');
    await choose(page, 'mark', 'violin');
    await choose(page, 'group-by', 'RESPONSE');
    await choose(page, 'value-type', 'change');
    await page.locator('.sv-reset').click();
    await page.evaluate(() => window.__gc.chart.render());
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__r.calls.length)).toBe(0);
    expect(await page.evaluate(() => window.__gc.chart.statistics())).toEqual([]);
    await expect(page.locator('.sv-main')).not.toContainText('waiting for R');
    await expect(page.locator('.sv-main')).not.toContainText('Statistics');
    expect((await overviewOf(page)).lines).toEqual(['']);
    expect(requests.filter(isRHost)).toEqual([]);

    // One biomarker: five panels, five questions, each for its own rows.
    await page.locator('.bv-overview-row[data-measure="IL-6"]').click();
    const lines = page.locator('.bv-panel .bv-statistic');
    // The first panel that waits says what the first start costs; the rest wait.
    await expect(lines).toHaveText([`${WAITING} ${note}`, WAITING, WAITING, WAITING, WAITING]);
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(5);
    expect((await calls(page)).map((call) => [call.rows, call.args.strMethod])).toEqual([
      [200, 't'],
      [185, 't'],
      [186, 't'],
      [188, 't'],
      [184, 't']
    ]);
    const asked = await page.evaluate(() => window.__gc.chart.statistics());
    expect(asked.map((entry) => [entry.panel, entry.dataId.visit, entry.rows])).toEqual(
      VISITS.map((visit, index) => [visit, visit, [200, 185, 186, 188, 184][index]])
    );
    // They are the keys desktop R wrote for the same five panels.
    expect(asked.map((entry) => entry.dataId)).toEqual(
      ['baseline', 'week-2', 'week-4', 'week-8', 'week-12'].map(
        (visit) => resultOf(`result-${visit}`).dataId
      )
    );
    // Answered out of order: each line prints its own answer when it comes.
    await page.evaluate(() => window.__r.answer(3, 0.04));
    await expect(lines.nth(3).locator('.bv-stat-result')).toContainText(
      'p = 0.040 (Placebo n = 93, Treatment n = 95)'
    );
    await expect(lines.nth(0)).toHaveText(`${WAITING} ${note}`);
    await expect(lines.nth(4)).toHaveText(WAITING);
    await page.evaluate(() => window.__r.answer(0, 0.3));
    await expect(lines.nth(0).locator('.bv-stat-result')).toContainText(
      'p = 0.300 (Placebo n = 100, Treatment n = 100)'
    );
    // While the others are still on their way the page answers: a box lists.
    await clickCell(page, 'Placebo', null, 1);
    await expect(page.locator('.sv-listing-actions strong')).toHaveText('92 of 92 records');

    // Back to the overview with three answers outstanding: they are dropped
    // when they come, and the overview prints none.
    await choose(page, 'measure', 'bv_overview');
    await page.evaluate(() => [1, 2, 4].forEach((index) => window.__r.answer(index, 0.5)));
    await page.waitForTimeout(100);
    await expect(page.locator('.sv-main')).not.toContainText('p =');
    expect((await overviewOf(page)).lines).toEqual(['']);
    expect(await page.evaluate(() => window.__r.calls.length)).toBe(5);
    expect(requests.filter(isRHost)).toEqual([]);
  });

  test('GC-OVW-014: the group, the levels, the colour, the mark, the scale, the value and the filters apply to the overview; Panel by waits for one biomarker and says so, and there is no Statistics section (#17)', async ({
    page
  }) => {
    await openOverview(page);
    // No test is offered where none is printed.
    await expect(page.locator('.sv-section-title')).toHaveText([
      'Value',
      'Groups',
      'Display',
      'Filters'
    ]);
    await expect(page.locator('select[data-control="test"]')).toHaveCount(0);
    // Panel by: there, switched off, and saying why.
    await expect(page.locator('select[data-control="panel-by"]')).toBeDisabled();
    await expect(page.locator('.bv-control-note')).toHaveText(
      'Applies when one biomarker is open. In the overview each biomarker’s panels are its visits.'
    );

    await choose(page, 'group-by', 'SEX');
    let overview = await overviewOf(page);
    expect(overview.charts).toHaveLength(60);
    expect(
      overview.charts.every((chart) => chart.ticks.map((tick) => tick[0]).join() === 'F,M')
    ).toBe(true);

    await page.locator('[data-control="levels"] summary').click();
    await page.locator('[data-control="levels"] input[value="M"]').uncheck();
    overview = await overviewOf(page);
    expect(overview.charts.every((chart) => chart.ticks.length === 1)).toBe(true);
    await expect(page.locator('.sv-notes')).toContainText('1 of 2 levels shown.');
    await page.locator('[data-control="levels"] input[value="M"]').check();

    // A second grouping by colour: one key for the whole overview.
    await choose(page, 'color-by', 'ARM');
    overview = await overviewOf(page);
    expect(overview.charts[0].cells).toHaveLength(4);
    expect(overview.charts[0].ticks[0]).toHaveLength(3);
    await expect(page.locator('.bv-legend')).toHaveText('ARM:PlaceboTreatment');
    await choose(page, 'color-by', '');
    await expect(page.locator('.bv-legend')).toHaveCount(0);

    await choose(page, 'mark', 'violin');
    overview = await overviewOf(page);
    expect(overview.charts.every((chart) => chart.plugins.includes('gc-violin'))).toBe(true);
    await choose(page, 'mark', 'points');
    overview = await overviewOf(page);
    expect(chartsOf(overview, 'IL-6').map((chart) => chart.points)).toEqual([
      200, 185, 186, 188, 184
    ]);
    await choose(page, 'y-scale', 'log');
    overview = await overviewOf(page);
    expect(overview.charts.every((chart) => chart.yType === 'logarithmic')).toBe(true);
    await choose(page, 'y-scale', 'linear');
    await choose(page, 'mark', 'box');

    await page.locator('select[data-filter="ARM"]').selectOption('Treatment');
    overview = await overviewOf(page);
    expect(chartsOf(overview, 'IL-6').map((chart) => chart.n)).toEqual([100, 93, 91, 95, 92]);
    await expect(page.locator('.sv-notes')).toContainText(
      '100 of 200 participants pass the filters.'
    );
    await page.locator('select[data-filter="ARM"]').selectOption('__all__');

    // The visits chosen are the panels of every row.
    await page.locator('[data-control="visits"] summary').click();
    await page.locator('[data-control="visits"] input[value="Week 2"]').uncheck();
    await page.locator('[data-control="visits"] input[value="Week 8"]').uncheck();
    overview = await overviewOf(page);
    expect(overview.charts).toHaveLength(36);
    expect(overview.rows.every((row) => row.visits.join() === 'Baseline,Week 4,Week 12')).toBe(
      true
    );
    await page.locator('.sv-reset').click();

    // A change from baseline: the baseline visit is not drawn, and the note says why.
    await choose(page, 'value-type', 'change');
    overview = await overviewOf(page);
    expect(overview.charts).toHaveLength(48);
    expect(overview.rows.every((row) => row.visits.join() === VISITS.slice(1).join())).toBe(true);
    expect(overview.rows.find((row) => row.measure === 'IL-6').heading).toBe(
      'IL-6, change from baseline (pg/mL)'
    );
    await expect(page.locator('.sv-notes')).toHaveText(
      'Baseline visit: Baseline. It is not drawn: there the change from baseline is the same for everyone.'
    );
    // A baseline value has no visit: one panel a biomarker, and no Visit control.
    await choose(page, 'value-type', 'baseline');
    overview = await overviewOf(page);
    expect(overview.charts).toHaveLength(12);
    expect(overview.rows.every((row) => row.visits.join() === 'Baseline value')).toBe(true);
    expect(overview.charts.every((chart) => chart.n === 200)).toBe(true);
    await expect(page.locator('[data-control="visits"]')).toHaveCount(0);
    await expect(page.locator('.sv-notes')).toContainText(
      'A baseline value has no visit: each biomarker has one panel.'
    );

    // One biomarker open: Panel by is a control again, and the test is offered.
    await page.locator('.bv-overview-row[data-measure="IL-6"]').click();
    await expect(page.locator('select[data-control="panel-by"]')).toBeEnabled();
    await expect(page.locator('.bv-control-note')).toHaveCount(0);
    await expect(page.locator('select[data-control="test"]')).toHaveValue('t');
  });

  test('GC-OVW-015: with more biomarkers than the limit the overview draws a page of them, says how many of how many, and reaches the rest by pages (#17)', async ({
    page
  }) => {
    await openOverview(page, { data: 'many-biomarkers' });
    // Thirty-six biomarkers, three times the default limit of twelve.
    const names = (
      await page.locator('select[data-control="measure"] option').allTextContents()
    ).slice(1);
    expect(names).toHaveLength(36);
    const shown = async () => (await overviewOf(page)).rows.map((row) => row.measure);
    expect(await shown()).toEqual(names.slice(0, 12));
    // Two visits in the fixture: twenty-four charts alive, not seventy-two.
    expect(await page.evaluate(() => window.__gc.chart.charts.length)).toBe(24);
    const count = page.locator('.bv-overview-count');
    await expect(count).toHaveText([
      '12 of 36 biomarkers shown: 1 to 12, in the Biomarker control’s order.',
      '12 of 36 biomarkers shown: 1 to 12, in the Biomarker control’s order.'
    ]);
    // The way to the rest is above the rows and below them.
    const pagers = page.locator('.bv-overview-pager');
    await expect(pagers).toHaveCount(2);
    await expect(pagers.first().locator('.bv-overview-page')).toHaveText('Page 1 of 3');
    await expect(pagers.first().locator('button[data-go="previous"]')).toBeDisabled();

    await pagers.first().locator('button[data-go="next"]').click();
    expect(await shown()).toEqual(names.slice(12, 24));
    await expect(count.first()).toHaveText(
      '12 of 36 biomarkers shown: 13 to 24, in the Biomarker control’s order.'
    );
    expect(await page.evaluate(() => window.__gc.chart.charts.length)).toBe(24);
    // A biomarker opened from a page, and the overview returned to: the same page.
    await page.locator('.bv-overview-row').nth(2).click();
    await expect(page.locator('select[data-control="measure"]')).toHaveValue(names[14]);
    await choose(page, 'measure', 'bv_overview');
    expect(await shown()).toEqual(names.slice(12, 24));

    await pagers.last().locator('button[data-go="next"]').click();
    expect(await shown()).toEqual(names.slice(24));
    await expect(pagers.first().locator('.bv-overview-page')).toHaveText('Page 3 of 3');
    await expect(pagers.first().locator('button[data-go="next"]')).toBeDisabled();
    await pagers.first().locator('button[data-go="previous"]').click();
    expect(await shown()).toEqual(names.slice(12, 24));
    // Every biomarker was on exactly one page.

    // The limit is a setting.
    await page.evaluate(() => window.__gc.chart.setSettings({ overview_limit: 5 }));
    await expect(page.locator('.bv-overview-row')).toHaveCount(5);
    // Another limit is other pages, so the overview starts again at its first.
    await expect(pagers.first().locator('.bv-overview-page')).toHaveText('Page 1 of 8');
    expect(await shown()).toEqual(names.slice(0, 5));
    await expect(count.first()).toHaveText(
      '5 of 36 biomarkers shown: 1 to 5, in the Biomarker control’s order.'
    );
    await page.evaluate(() => window.__gc.chart.setSettings({ overview_limit: 40 }));
    await expect(page.locator('.bv-overview-row')).toHaveCount(36);
    await expect(count).toHaveText(['All 36 biomarkers are shown.']);
    await expect(page.locator('.bv-overview-pager button')).toHaveCount(0);
  });

  test('GC-OVW-017: the first draw of twelve biomarkers at five visits is timed, at a desk’s width and at a phone’s, and recorded where a reader of the run can find it (#17)', async ({
    page,
    browser
  }, testInfo) => {
    const timings = {};
    for (const [name, viewport] of [
      ['desk', { width: 1280, height: 800 }],
      ['phone', { width: 390, height: 844 }]
    ]) {
      await page.setViewportSize(viewport);
      await openOverview(page);
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
        // The whole first draw: the tables read, the controls built, the rows
        // worked out and sixty charts made. Then the drawing alone, five times.
        const first = await time(() => chart.setData(data));
        const again = [];
        for (let run = 0; run < 5; run += 1) again.push((await time(() => chart.render())).drawn);
        return {
          charts: chart.charts.length,
          rows: document.querySelectorAll('.bv-overview-row').length,
          firstDrawMs: Math.round(first.drawn),
          firstPaintMs: Math.round(first.painted),
          redrawMs: again.map(Math.round).sort((a, b) => a - b)[2]
        };
      });
      expect(timings[name].charts).toBe(60);
      expect(timings[name].rows).toBe(12);
      // Generous: a guard against the overview becoming slow, not a benchmark.
      expect(timings[name].firstPaintMs).toBeLessThan(3000);
    }
    const record = {
      recorded: new Date().toISOString(),
      browser: `Chromium ${browser.version()}, headless`,
      machine:
        process.env.R_CHECK_MACHINE ||
        (process.env.CI ? 'a GitHub Actions runner (ubuntu-latest)' : 'not named'),
      what: 'twelve biomarkers at five visits, sixty Chart.js charts, one per panel',
      timings
    };
    const text = JSON.stringify(record, null, 2) + '\n';
    await testInfo.attach('group-comparison-overview-timing.json', {
      body: text,
      contentType: 'application/json'
    });
    mkdirSync(new URL('../../test-results/', import.meta.url), { recursive: true });
    writeFileSync(
      new URL('../../test-results/group-comparison-overview-timing.json', import.meta.url),
      text
    );
    console.log(`\nOverview, first draw — ${record.browser}, ${record.machine}`);
    for (const [name, timing] of Object.entries(timings)) {
      console.log(
        `  ${name.padEnd(5)} ${timing.charts} charts: ${timing.firstDrawMs} ms to draw, ` +
          `${timing.firstPaintMs} ms to the next paint, ${timing.redrawMs} ms to draw again`
      );
    }
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

test.describe('group comparison: the overview on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('GC-OVW-016: at 390px a biomarker’s row is a card as wide as the page, its visits two to a line, and a tap on it opens the biomarker; the page does not scroll sideways (#17)', async ({
    page
  }) => {
    await openOverview(page);
    expect(await layout(page)).toEqual(HOLDS);
    // The controls start folded, so the first biomarkers are on the first screen.
    await expect(page.locator('.sv-root')).toHaveClass(/sv-collapsed/);
    await expect(page.locator('.bv-overview-row')).toHaveCount(12);
    const row = page.locator('.bv-overview-row[data-measure="CRP"]');
    const card = await row.boundingBox();
    expect(card.width).toBeGreaterThan(330);
    expect(card.y).toBeLessThan(844);
    // Two panels to a line, each wide enough for its two groups' names and counts.
    const panels = await row
      .locator('.bv-overview-panel')
      .evaluateAll((cells) =>
        cells
          .map((cell) => cell.getBoundingClientRect())
          .map((box) => [Math.round(box.left), Math.round(box.top), box.width])
      );
    expect(panels).toHaveLength(5);
    expect(panels[0][1]).toBe(panels[1][1]);
    expect(panels[2][1]).toBeGreaterThan(panels[0][1]);
    expect(panels[2][0]).toBe(panels[0][0]);
    expect(panels[4][0]).toBe(panels[0][0]);
    for (const [, , width] of panels) expect(width).toBeGreaterThan(135);
    // Every label is whole and level: none was turned to make it fit.
    const turned = await page.evaluate(
      () => window.__gc.chart.charts.filter((chart) => chart.scales.x.labelRotation !== 0).length
    );
    expect(turned).toBe(0);
    // Nothing of the overview is wider than the page.
    const overflowing = await page.evaluate(() =>
      [...document.querySelectorAll('.sv-main *')]
        .filter((element) => element.getBoundingClientRect().right > 390.5)
        .map((element) => element.className)
    );
    expect(overflowing).toEqual([]);
    await captureEvidence(row, 'GC-OVW-016', 'a-biomarker-row-on-a-phone');

    // A tap on the row opens its biomarker: the visits, one panel to a line.
    await row.tap();
    const cards = page.locator('.bv-panel');
    await expect(cards).toHaveCount(5);
    await expect(page.locator('.bv-panel h3').first()).toHaveText('Baseline');
    expect(await layout(page)).toEqual(HOLDS);
    // The chart is brought back to the top of the page it replaced.
    const top = await page.locator('.sv-root').evaluate((root) => root.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(-1);

    // One tap opens the controls, where All Biomarkers leads back.
    await page.locator('.sv-sidebar-toggle').click();
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('CRP');
    await choose(page, 'measure', 'bv_overview');
    await expect(page.locator('.bv-overview-row')).toHaveCount(12);
    expect(await layout(page)).toEqual(HOLDS);
    // A row far down the page opens at the chart's top, not below it.
    await page.locator('.sv-sidebar-toggle').click();
    await page.locator('.bv-overview-row[data-measure="VEGF"]').tap();
    await expect(page.locator('.bv-panel')).toHaveCount(5);
    const after = await page
      .locator('.sv-root')
      .evaluate((root) => root.getBoundingClientRect().top);
    expect(after).toBeGreaterThanOrEqual(-1);
    expect(after).toBeLessThan(844);
  });
});

test.describe('group comparison: on the site', () => {
  test('GC-FILTER-006: on the demo, filters with nobody in common leave the overview and one biomarker saying, in words, that no participant passes the filters; nothing is drawn, R is asked nothing, the controls stay usable, and loosening a filter draws again (#29)', async ({
    page
  }) => {
    const errors = await openDemo(page, 'group-comparison', 'groupComparison');
    const charts = () => window.BioVizDemo.chart.charts.length;
    // The overview, which asks R for nothing in any case.
    expect(await page.evaluate(charts)).toBeGreaterThan(0);
    expect(await letNobodyThrough(page)).toBe(0);
    await expectNobody(page, errors, { drawn: charts });
    await expect(page.locator('#chart .bv-overview-row')).toHaveCount(0);
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
    // And back to the overview, which draws its rows again.
    await page.locator('#chart select[data-control="measure"]').selectOption({ index: 0 });
    await expect(page.locator('#chart .bv-overview-row').first()).toBeVisible();
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

  test('GC-OVW-018: the live demo opens on the overview, twelve biomarkers at five visits, and fetches nothing for R until a biomarker is opened (#17)', async ({
    page
  }) => {
    // R's hosts are not blocked while the overview is up: every request the
    // page makes is recorded, and none may be for R.
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
    const rows = page.locator('.bv-overview-row');
    await expect(rows).toHaveCount(12);
    expect(await rows.evaluateAll((all) => all.map((row) => row.dataset.measure))).toEqual(
      BIOMARKERS
    );
    const found = await page.evaluate(() => {
      const { chart } = window.BioVizDemo;
      return {
        charts: chart.charts.length,
        visits: [...new Set(chart.charts.map((one) => one.$panel.visit))],
        perRow: [...document.querySelectorAll('.bv-overview-row')].map(
          (row) => row.querySelectorAll('.bv-overview-panel canvas').length
        ),
        il6: chart.charts
          .filter((one) => one.$measure === 'IL-6')
          .map((one) => one.scales.x.ticks.map((tick) => tick.label)),
        statistics: chart.statistics(),
        settings: [chart.settings.start_value, chart.settings.visits]
      };
    });
    expect(found.charts).toBe(60);
    expect(found.visits).toEqual(VISITS);
    expect(found.perRow).toEqual(BIOMARKERS.map(() => 5));
    // The number in each group, under each group, in every panel.
    expect(found.il6).toEqual([
      [
        ['Placebo', 'n = 100'],
        ['Treatment', 'n = 100']
      ],
      [
        ['Placebo', 'n = 92'],
        ['Treatment', 'n = 93']
      ],
      [
        ['Placebo', 'n = 95'],
        ['Treatment', 'n = 91']
      ],
      [
        ['Placebo', 'n = 93'],
        ['Treatment', 'n = 95']
      ],
      [
        ['Placebo', 'n = 92'],
        ['Treatment', 'n = 92']
      ]
    ]);
    // Neither a biomarker nor a visit is named by the page: these are the defaults.
    expect(found.settings).toEqual([null, null]);
    expect(found.statistics).toEqual([]);
    await expect(page.locator('.sv-main > .bv-statistic')).toBeHidden();
    await expect(page.locator('.sv-main')).not.toContainText('waiting for R');
    await expect(page.locator('#about-demo')).toContainText(
      'The overview prints no test and asks R for nothing.'
    );
    // Filters and controls apply to the overview, and still nothing is asked of R.
    await page.locator('select[data-filter="SEX"]').selectOption('F');
    await choose(page, 'group-by', 'ARM_SEX');
    await choose(page, 'mark', 'violin');
    await expect(rows).toHaveCount(12);
    await page.locator('.sv-reset').click();
    await page.waitForTimeout(500);
    expect(forR()).toEqual([]);

    // From here R's hosts are kept out of reach, so the rest stays on this
    // machine: GC-OVW-019 opens a biomarker with R answering.
    await blockR(page);
    await rows.nth(6).click();
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('IL-6');
    await expect(page.locator('.bv-panel h3')).toHaveText(VISITS);
    await expect(page.locator('.bv-panel .bv-statistic')).toHaveCount(5);
    // Opening a biomarker is what asks for R: now, and not before.
    await expect.poll(() => forR().length).toBeGreaterThan(0);
    await choose(page, 'measure', 'bv_overview');
    await expect(rows).toHaveCount(12);
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
// The demo as it opens, for real (#17): the overview, and then one biomarker
// opened from it, with R in the browser. Like the group above this needs the
// network, fails when R's host cannot be reached, and is not retried. It has a
// browser of its own, on a new and empty profile, because what it watches is
// the first time R is asked for on a page that opened without asking.

test.describe('group comparison: the demo’s overview, with R in the browser, live', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  let context;
  let page;
  const requested = [];
  const forR = () =>
    requested.filter((url) => isRHost(url) || new URL(url).pathname.endsWith('/statistics.R'));

  test.beforeAll(async ({}, testInfo) => {
    const profile = mkdtempSync(path.join(tmpdir(), 'bio-viz-overview-'));
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

  test('GC-OVW-019: on the demo the overview starts no R; opening a biomarker starts it once, and its five visit panels each wait and print the test desktop R gives for that visit (#17)', async ({}, testInfo) => {
    // The overview, as the page opens: R's hosts are in reach, and not asked.
    await expect(page.locator('.bv-overview-row')).toHaveCount(12);
    await page.waitForTimeout(1500);
    expect(forR()).toEqual([]);
    expect(await page.evaluate(() => window.BioVizDemo.chart.statistics())).toEqual([]);

    // One biomarker, opened from its row.
    await page.locator('.bv-overview-row[data-measure="IL-6"]').click();
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
    await testInfo.attach('overview-five-panels-desktop-R-and-webR.json', {
      body: JSON.stringify(compared, null, 2),
      contentType: 'application/json'
    });
    console.log('\nIL-6 opened from the overview: five panels, desktop R beside R in the browser');
    for (const entry of compared) {
      console.log(
        `  ${entry.case.padEnd(15)} p_value desktop ${String(entry.desktop).padEnd(24)} ` +
          `browser ${String(entry.browser).padEnd(24)} ${entry.numbers} numbers held equal`
      );
    }

    // Back to the overview: no test, and nothing more asked of R or fetched.
    const before = forR().length;
    await choose(page, 'measure', 'bv_overview');
    await expect(page.locator('.bv-overview-row')).toHaveCount(12);
    expect(await page.evaluate(() => window.BioVizDemo.chart.statistics())).toEqual([]);
    await expect(page.locator('.sv-main')).not.toContainText('Welch');
    // Another biomarker: the same R answers, and nothing is fetched again.
    await page.locator('.bv-overview-row[data-measure="CRP"]').click();
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
