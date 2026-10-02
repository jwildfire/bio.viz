import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { captureEvidence } from './evidence.js';

// The group comparison chart in a real page (#9): safety.viz's vendored bundle
// and bio.viz's committed bundle, loaded as two script tags, drawing the
// vendored synthetic study. Nothing here reaches the network: the statistics
// line is asked of a connection with no R attached, or of a stand-in for R.

const readJson = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const fromR = readJson('../fixtures/group-comparison-r.json');
const kitRecord = readJson('../../site/vendor/safety.viz/SOURCE.json');
const FIXTURE = '/tests/e2e/fixtures/group-comparison.html';

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
    expect(found.kitMembers).toBe(35);
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
    await expect(page.locator('select[data-control="measure"] option')).toHaveCount(12);
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

    await expect(page.locator('.sv-section-title')).toHaveText(['Value', 'Groups', 'Display']);
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

// A stand-in for R whose answers arrive when the test says so. gsm.bio's
// result for a group difference, in the shape the connection hands back.
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
          resolve
        });
      })
  };
  window.__r.answer = (index, p) => {
    const call = window.__r.calls[index];
    const counts = {};
    call.rows > 100
      ? Object.assign(counts, { Placebo: 95, Treatment: 91 })
      : Object.assign(counts, { Placebo: 42, Treatment: 42 });
    call.resolve({
      status: 'ok',
      reason: null,
      method: 'Welch Two Sample t-test',
      p_value: p,
      adjustment: 'none',
      counts
    });
  };
};

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
    await open(page, {
      before: stubR,
      settings: undefined
    });
    // The chart is given a connection whose R is the stand-in.
    await page.evaluate(() => {
      window.__gc.chart.setSettings({
        connection: window.BioViz.r.createConnection({ browser: { engine: window.__r.engine } })
      });
    });
    const line = page.locator('.sv-main > .bv-statistic');
    await expect(line).toHaveText('Statistics: waiting for R…');
    await expect(line).toHaveAttribute('data-state', 'waiting');
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(1);
    const call = await page.evaluate(() => {
      const { name, rows, args, fields } = window.__r.calls[0];
      return { name, rows, args, fields };
    });
    // R is asked about the rows that are drawn, by the names of their fields.
    expect(call).toEqual({
      name: 'Analyze_GroupDifference',
      rows: 186,
      args: { strValueCol: 'y', strGroupCol: 'x' },
      fields: ['USUBJID', 'y', 'x']
    });
    await page.evaluate(() => window.__r.answer(0, 0.0004));
    await expect(line).toHaveText(
      'Welch Two Sample t-test: p < 0.001 (Placebo n = 95, Treatment n = 91). Exploratory, unadjusted.'
    );
    await expect(line).toHaveAttribute('data-state', 'shown');
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
    await page.evaluate(() => {
      window.__gc.chart.setSettings({
        connection: window.BioViz.r.createConnection({ browser: { engine: window.__r.engine } })
      });
    });
    const line = page.locator('.sv-main > .bv-statistic');
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(1);
    await page.evaluate(() => window.__r.answer(0, 0.03));
    await expect(line).toContainText('p = 0.030 (Placebo n = 95, Treatment n = 91)');

    // The filter changes: the answer for 186 rows goes at once.
    await page.locator('select[data-filter="SEX"]').selectOption('F');
    await expect(line).toHaveText('Statistics: waiting for R…');
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(2);
    expect(await page.evaluate(() => window.__r.calls[1].rows)).toBe(84);

    // And changes again before R has answered: a third request, for all 186.
    await page.locator('select[data-filter="SEX"]').selectOption('__all__');
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(3);
    // The answer for the 84 rows arrives now, late. It is not shown.
    await page.evaluate(() => window.__r.answer(1, 0.5));
    await page.waitForTimeout(100);
    await expect(line).toHaveText('Statistics: waiting for R…');
    // The answer for the rows on screen is.
    await page.evaluate(() => window.__r.answer(2, 0.03));
    await expect(line).toContainText('p = 0.030 (Placebo n = 95, Treatment n = 91)');
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

test.describe('group comparison: on the site', () => {
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

  test('GC-SITE-002: the live demo draws the chart on the synthetic study, from safety.viz’s bundle and bio.viz’s, and says statistics are unavailable (#9)', async ({
    page
  }) => {
    const errors = watch(page);
    const scripts = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith('.js')) scripts.push(url.pathname.replace('/_site/', ''));
    });
    await page.goto('/_site/group-comparison/index.html');
    await page.evaluate(() => window.BioVizDemo.ready);
    await expect(page.locator('h1')).toHaveText('Group comparison');
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
    await expect(page.locator('.sv-main > .bv-statistic')).toHaveText(
      'Statistics are unavailable: no R is attached to this chart.'
    );
    await expect(page.locator('.sv-sidebar select[data-filter]')).toHaveCount(3);
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

  test('GC-SITE-003: the live demo holds at a 390px-wide viewport with no horizontal scroll (#9)', async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/_site/group-comparison/index.html');
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
