// WORK IN PROGRESS (#86), paused 2026-10-06. Not run by Playwright: this file
// is not a spec. It is the draft of the difference grid's browser tests, to be
// folded into tests/e2e/group-comparison.spec.js, after the group "one
// biomarker over time, on a phone", when the work resumes. None of it has been
// run. It leans on that spec's helpers (open, openTiles, choose, calls, stubR,
// attachStub, tilesOf, drawn, layout, HOLDS, watch, captureEvidence, released,
// statistics, VISITS, BIOMARKERS, OVERVIEW, WAITING) and on two things not yet
// written: `import { shadeOf } from '../../src/group-comparison/grid.js'`, and
// in stubR a record of each call's counts by biomarker and visit with
// `window.__r.answerGrid(index, estimates)`, which resolves a call with a row
// per biomarker and visit in the shape Analyze_DifferenceGrid returns. The
// rows GC-GRID-015 to GC-GRID-028 are not yet in requirements/group-comparison.md.

// ---------------------------------------------------------------------------
// The difference grid (#86): the opening view's second form. A row per
// biomarker and a column per visit, each cell the standardised difference
// between two groups, which R computes for every cell in one request. The
// answers are desktop R's, stored with the page, or a stand-in's whose answers
// arrive when the test says; no test here reaches R's hosts.

const GRID = { ...OVERVIEW, group_by: 'ARM', opening_view: 'grid' };
// R's answers for a grid, as stored results.
const gridResult = (name) => statistics.grid.find((result) => result.case === name);
const storedGrid = (...names) =>
  names.map(gridResult).map(({ name, args, dataId, rows, value }) => ({
    name,
    args,
    dataId,
    rows,
    value
  }));
const attachGrid = (page, names, chart = '__gc') =>
  page.evaluate(
    ({ given, name }) =>
      window[name].chart.setSettings({
        connection: window.BioViz.r.createConnection({ results: given })
      }),
    { given: storedGrid(...names), name: chart }
  );
async function openGrid(page, { data = 'both', settings = {}, before = null, results } = {}) {
  await open(page, { data, before, settings: { ...GRID, ...settings } });
  if (results) await attachGrid(page, results);
}
// An estimate as a cell prints it: two decimal places and a true minus sign.
const printedCell = (estimate) => {
  const fixed = estimate.toFixed(2);
  return (fixed === '-0.00' ? '0.00' : fixed).replace('-', '−');
};
// A colour as the browser writes it back from an element's style.
const asWritten = (page, colours) =>
  page.evaluate(
    (given) =>
      given.map((colour) => {
        const probe = document.createElement('i');
        probe.style.background = colour;
        return probe.style.background;
      }),
    colours
  );

// The grid as the page has it: the table, the key above it, the line under it
// and the two controls that choose the groups. `chart` names where the chart is.
const gridOf = (page, chart = '__gc') =>
  page.evaluate((name) => {
    const text = (element) => (element ? element.textContent : null);
    const made = window[name].chart;
    const { root } = made;
    const table = root.querySelector('.bv-grid-table');
    const scroll = root.querySelector('.bv-grid-scroll');
    const line = root.querySelector('.bv-grid-line');
    const key = root.querySelector('.bv-grid-key');
    const shown = (element) => Boolean(element) && getComputedStyle(element).display !== 'none';
    return {
      level: root.dataset.level,
      view: root.dataset.view,
      charts: made.charts.length,
      tiles: root.querySelectorAll('.bv-tile').length,
      shown: shown(scroll),
      caption: table ? text(table.querySelector('caption')) : null,
      columns: table
        ? [...table.querySelectorAll('thead th')].map((cell) => ({
            text: text(cell),
            scope: cell.scope
          }))
        : [],
      rows: table
        ? [...table.querySelectorAll('tbody tr')].map((row) => {
            const heading = row.querySelector('th');
            const button = heading.querySelector('button');
            return {
              measure: row.dataset.measure,
              heading: {
                scope: heading.scope,
                text: text(button),
                type: button.type,
                label: button.getAttribute('aria-label')
              },
              cells: [...row.querySelectorAll('td')].map((cell) => {
                const inside = cell.querySelector('button');
                return {
                  visit: cell.dataset.visit,
                  status: cell.dataset.status,
                  button: Boolean(inside),
                  type: inside ? inside.type : null,
                  text: text(inside),
                  label: (inside || cell).getAttribute('aria-label'),
                  title: (inside || cell).title || null,
                  background: inside ? inside.style.background : '',
                  side: inside ? inside.dataset.side || null : null
                };
              })
            };
          })
        : [],
      key: key && {
        shown: shown(key),
        text: text(key.querySelector('span')),
        role: key.querySelector('.bv-grid-scale').getAttribute('role'),
        label: key.querySelector('.bv-grid-scale').getAttribute('aria-label'),
        steps: [...key.querySelectorAll('.bv-grid-swatch')].map((swatch) => ({
          text: text(swatch),
          background: swatch.style.background
        }))
      },
      said: text(root.querySelector('.bv-grid-caption')),
      line: line && {
        state: line.dataset.state,
        role: line.getAttribute('role'),
        result: text(line.querySelector('.bv-stat-result')),
        levels: [...line.querySelectorAll('.bv-stat-level')].map(text),
        summary: text(line.querySelector('.bv-grid-reasons summary')),
        reasons: [...line.querySelectorAll('.bv-grid-reasons li')].map(text),
        remarks: [...line.querySelectorAll('.bv-stat-remark')].map(text),
        scope: text(line.querySelector('.bv-stat-scope'))
      },
      pair: ['grid-first', 'grid-second'].map((control) => {
        const select = root.querySelector(`select[data-control="${control}"]`);
        return select
          ? {
              value: select.value,
              options: [...select.options].map((option) => option.value),
              shown: select.offsetParent !== null
            }
          : null;
      }),
      pairNote: text(root.querySelector('.bv-grid-pair-note')),
      pager: {
        count: text(root.querySelector('.bv-overview-count')),
        page: text(root.querySelector('.bv-overview-page'))
      },
      notes: [...root.querySelectorAll('.sv-notes > span')].map(text),
      footnote: text(root.querySelector('.sv-footnote')),
      statistics: made.statistics().map(({ panel, name: asked, args, dataId, rows, answer }) => ({
        panel,
        name: asked,
        args,
        dataId,
        rows,
        status: answer ? answer.status : null,
        form: answer ? answer.form || null : null
      }))
    };
  }, chart);
// The key a stored result was written under, as `chart.statistics()` gives one.
const keyOf = (result, form = 'precomputed') => ({
  panel: '',
  name: 'Analyze_DifferenceGrid',
  args: result.args,
  dataId: result.dataId,
  rows: result.rows,
  status: 'ok',
  form
});
// Every cell of the grid on the page, held to R's rows for the same request:
// the figure is R's estimate printed, on the colour read off it.
async function holdCells(page, found, result, label = result.case) {
  const { rows } = result.value;
  const visits = result.args.chrBy;
  const tested = (row) => row.cells.filter((cell) => cell.status !== 'untested');
  expect(
    found.rows.map((row) => row.measure),
    label
  ).toEqual(result.args.chrBiomarkers);
  expect(found.rows.flatMap((row) => tested(row).map((cell) => cell.visit))).toEqual(
    result.args.chrBiomarkers.flatMap(() => visits)
  );
  const colours = await asWritten(
    page,
    rows.map((row) => (row.status === 'ok' ? shadeOf(row.estimate).color : ''))
  );
  const [first, second] = result.args.chrGroups;
  rows.forEach((row, index) => {
    const cell = tested(found.rows[Math.floor(index / visits.length)])[index % visits.length];
    const where = `${label} ${row.biomarker} ${row.by}`;
    expect(cell.visit, where).toBe(row.by);
    expect(cell.button, where).toBe(true);
    if (row.status !== 'ok') {
      expect(cell.status, where).toBe('withheld');
      expect(cell.text, where).toBe('not computed');
      expect(cell.background, where).toBe('');
      expect(cell.label, where).toContain(`${row.biomarker} at ${row.by}: ${row.reason}`);
      expect(cell.label, where).toContain(`${first} n = ${row.n_1}, ${second} n = ${row.n_2}`);
      return;
    }
    expect(cell.status, where).toBe('shown');
    expect(cell.text, where).toBe(printedCell(row.estimate));
    expect(cell.background, where).toBe(colours[index]);
    expect(cell.side, where).toBe(row.estimate < 0 ? 'below' : 'above');
    expect(cell.label, where).toContain(`${first} n = ${row.n_1}, ${second} n = ${row.n_2}`);
  });
}

test.describe('group comparison: the difference grid', () => {
  test('GC-GRID-015: the View control switches the opening view between the trend tiles and the difference grid; the grid of the synthetic study has one row per biomarker and one column per visit for the two arms, asks R once with the key desktop R wrote, and prints in every cell the estimate desktop R returns for the same rows, on the colour read off it (#86)', async ({
    page
  }) => {
    const errors = watch(page);
    await openTiles(page, { settings: { group_by: 'ARM' } });
    await attachGrid(page, ['grid-result']);
    // The chart opens on the tiles, and the control says so.
    const root = page.locator('.sv-root');
    await expect(root).toHaveAttribute('data-view', 'tiles');
    const view = page.locator('select[data-control="view"]');
    await expect(view).toHaveValue('tiles');
    await expect(view.locator('option')).toHaveText(['Trend tiles', 'Difference grid']);
    await expect(page.locator('.bv-tile')).toHaveCount(12);
    expect(await page.evaluate(() => window.__gc.chart.statistics())).toEqual([]);

    await choose(page, 'view', 'grid');
    await expect(root).toHaveAttribute('data-view', 'grid');
    await expect(root).toHaveAttribute('data-level', 'biomarkers');
    await expect(page.locator('.bv-grid-line')).toHaveAttribute('data-state', 'shown');
    const expected = gridResult('grid-result');
    const found = await gridOf(page);
    expect(found.tiles).toBe(0);
    expect(found.charts).toBe(0);
    // One request, with the key desktop R wrote, answered from what it stored.
    expect(found.statistics).toEqual([keyOf(expected)]);
    expect(expected.rows).toBe(11304);
    // A row per biomarker, in the control's order; a column per visit.
    expect(found.columns.map((column) => column.text)).toEqual(['Biomarker', ...VISITS]);
    expect(found.rows.map((row) => row.measure)).toEqual(BIOMARKERS);
    expect(found.rows.flatMap((row) => row.cells)).toHaveLength(60);
    // Every cell prints R's estimate for it, on the colour read off it.
    expect(expected.value.rows).toHaveLength(60);
    await holdCells(page, found, expected);
    const cellOf = (measure, visit) =>
      found.rows.find((row) => row.measure === measure).cells.find((c) => c.visit === visit);
    expect(cellOf('IL-6', 'Week 4').text).toBe('0.98');
    expect(cellOf('D-dimer', 'Baseline').text).toBe('−0.35');
    expect(cellOf('IL-6', 'Week 4').label).toBe(
      "IL-6 at Week 4: Standardised difference (Hedges' g), Placebo minus Treatment: 0.9795, 95% confidence interval 0.675 to 1.282 (Placebo n = 95, Treatment n = 91). Open IL-6 at Week 4."
    );
    // The key: what a cell is, which way round, and five steps of the scale,
    // each the colour a cell of that number takes.
    expect(found.key.text).toBe('Standardised difference in the result, Placebo minus Treatment:');
    expect(found.key.steps.map((step) => step.text)).toEqual([
      '−1 or less',
      '−0.5',
      '0',
      '0.5',
      '1 or more'
    ]);
    expect(found.key.steps.map((step) => step.background)).toEqual(
      await asWritten(
        page,
        [-1, -0.5, 0, 0.5, 1].map((estimate) => shadeOf(estimate).color)
      )
    );
    expect(found.said).toBe(
      'Each cell is the difference between the two groups’ means in pooled standard deviations (Hedges’ g), as R computed it: above nought Placebo is higher, below it Treatment is. The colour follows the number and is deepest at 1 and beyond; the number in the cell is the estimate.'
    );
    // The line under the grid: what the cells are, and that none is a test.
    expect(found.line.result).toBe(
      "Standardised difference (Hedges' g), Placebo minus Treatment, in each cell: 60 cells computed. A description of each difference with its interval and its counts: no cell is a test, and the grid has no p-value."
    );
    expect(found.line.scope).toBe(
      'Each cell compares Placebo with Treatment, two levels of ARM, on the participants with a result of that biomarker at that visit.'
    );
    await expect(page.locator('.sv-main')).not.toContainText(/\bp [=<>]/);
    await expect(page.locator('.sv-main')).not.toContainText('Exploratory');
    // With two groups there is nothing to choose: the controls are put away.
    expect(found.pair.map((control) => control.shown)).toEqual([false, false]);
    expect(found.pairNote).toBe(
      'Each cell is Placebo minus Treatment. With two groups drawn there is no other pair to choose.'
    );
    await captureEvidence(page.locator('.sv-multiples'), 'GC-GRID-015', 'difference-grid');

    // And back: the tiles, with no grid and nothing asked.
    await choose(page, 'view', 'tiles');
    await expect(root).toHaveAttribute('data-view', 'tiles');
    await expect(page.locator('.bv-tile')).toHaveCount(12);
    await expect(page.locator('.bv-grid-table')).toHaveCount(0);
    expect(await page.evaluate(() => window.__gc.chart.statistics())).toEqual([]);
    // With no function named to answer it there is no grid, and no control.
    await page.evaluate(() => window.__gc.chart.setSettings({ statistic_grid: null }));
    await expect(view).toHaveCount(0);
    await page.evaluate(() =>
      window.__gc.chart.setSettings({ statistic_grid: null, opening_view: 'grid' })
    );
    await expect(root).toHaveAttribute('data-view', 'tiles');
    await expect(page.locator('.bv-tile')).toHaveCount(12);
    expect(errors).toEqual([]);
  });

  test('GC-GRID-016: colour is never the only carrier: every cell prints its number and is a button named for the whole of what R returned, the estimate, which way round it is, its interval and each group’s count; the grid is a table with a caption, a heading for every column and row, and a key whose scale has its steps in figures and a description in words (#86)', async ({
    page
  }) => {
    await openGrid(page, { results: ['grid-result'] });
    await expect(page.locator('.bv-grid-line')).toHaveAttribute('data-state', 'shown');
    const found = await gridOf(page);
    const expected = gridResult('grid-result');
    expect(found.caption).toBe(
      'Standardised difference in the result, Placebo minus Treatment, for each biomarker at each visit'
    );
    expect(found.columns.map((column) => column.scope)).toEqual(Array(6).fill('col'));
    for (const row of found.rows) {
      expect(row.heading).toEqual({
        scope: 'row',
        text: row.measure,
        type: 'button',
        label: `View ${row.measure} across the visits`
      });
    }
    expected.value.rows.forEach((row, index) => {
      const cell = found.rows[Math.floor(index / 5)].cells[index % 5];
      // The number, signed in the figure itself.
      expect(cell.text).toMatch(/^−?\d\.\d\d$/);
      expect(cell.text.startsWith('−')).toBe(row.estimate.toFixed(2) < 0);
      expect(cell.type).toBe('button');
      // The whole sentence, read out and on hover: nothing a sighted reader
      // takes from the colour is missing from it.
      expect(cell.label).toMatch(
        new RegExp(
          `^${row.biomarker.replace(/[-.]/g, '\\$&')} at ${row.by}: Standardised difference \\(Hedges' g\\), Placebo minus Treatment: -?[\\d.e-]+, 95% confidence interval -?[\\d.e-]+ to -?[\\d.e-]+ \\(Placebo n = ${row.n_1}, Treatment n = ${row.n_2}\\)\\. Open ${row.biomarker.replace(/[-.]/g, '\\$&')} at ${row.by}\\.$`
        )
      );
      expect(`${cell.title} Open ${row.biomarker} at ${row.by}.`).toBe(cell.label);
    });
    expect(found.key.role).toBe('img');
    expect(found.key.label).toBe(
      'Colour scale: orange below nought, where Treatment is higher; neutral at nought; blue above, where Placebo is higher; deepest at 1 and beyond.'
    );
    // With every colour taken away the grid says the same: the figures and
    // the names are untouched.
    await page.addStyleTag({
      content: '.bv-grid-cell,.bv-grid-swatch{background:none !important}'
    });
    const plain = await gridOf(page);
    expect(plain.rows.map((row) => row.cells.map((cell) => [cell.text, cell.label]))).toEqual(
      found.rows.map((row) => row.cells.map((cell) => [cell.text, cell.label]))
    );
    // A cell is reached and opened from the keyboard, as a button is.
    const cell = page.locator('td[data-measure="CRP"][data-visit="Week 2"] .bv-grid-cell');
    await cell.focus();
    await expect(cell).toBeFocused();
    await expect(cell).toHaveCSS('outline-style', 'solid');
  });

  test('GC-GRID-017: with no R attached the grid says that it needs R, as a statistics line does, and draws no cell: no table, no key, no figure and nothing fetched; a page whose stored results do not hold the view says so too; the tiles are one choice away and ask for nothing (#86)', async ({
    page
  }) => {
    const errors = watch(page);
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await openGrid(page);
    const root = page.locator('.sv-root');
    await expect(root).toHaveAttribute('data-view', 'grid');
    await expect(page.locator('.bv-grid-line')).toHaveAttribute('data-state', 'unavailable');
    let found = await gridOf(page);
    expect(found.line.result).toBe(
      'The difference grid needs R: every cell is a number R computes. Statistics are unavailable: no R is attached to this chart.'
    );
    expect(found.line.levels).toEqual([
      'The trend tiles ask R for nothing: choose Trend tiles under View.'
    ]);
    expect(found.line.role).toBe('status');
    // No cell: the grid and its key are put away, and no figure is on the page.
    await expect(page.locator('.bv-grid-cell')).toHaveCount(0);
    expect(found.shown).toBe(false);
    expect(found.key.shown).toBe(false);
    await expect(page.locator('.bv-grid-scroll')).toBeHidden();
    await expect(page.locator('.sv-multiples')).not.toContainText(/\d\.\d\d/);
    // It was asked, of a connection with no R, and answered that there is none.
    expect(found.statistics).toHaveLength(1);
    expect(found.statistics[0]).toMatchObject({
      name: 'Analyze_DifferenceGrid',
      rows: 11304,
      status: 'unavailable'
    });
    await expect(
      page.locator('#chart .bv-downloads button[data-download="statistics"]')
    ).toBeDisabled();
    await captureEvidence(
      page.locator('.sv-multiples'),
      'GC-GRID-017',
      'difference-grid-with-no-r'
    );

    // Stored results that do not hold this view: said, and no other view's numbers.
    await attachGrid(page, ['grid-change']);
    await expect(page.locator('.bv-grid-line')).toHaveAttribute('data-state', 'unavailable');
    found = await gridOf(page);
    expect(found.line.result).toBe(
      'The difference grid needs R: every cell is a number R computes. Statistics are unavailable for this view: the page holds no stored result for it, and no R is attached to compute one.'
    );
    await expect(page.locator('.bv-grid-cell')).toHaveCount(0);

    // The tiles remain a choice away, and ask for nothing.
    await choose(page, 'view', 'tiles');
    await expect(page.locator('.bv-tile')).toHaveCount(12);
    expect(await page.evaluate(() => window.__gc.chart.statistics())).toEqual([]);
    await expect(page.locator('.sv-main')).not.toContainText('needs R');
    expect(requests.length).toBeGreaterThan(3);
    expect(requests.filter(isRHost)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('GC-GRID-018: the tiles ask R for nothing with the grid a choice away: switching from the grid back to the tiles makes no request, an answer for the grid that arrives after the tiles are back is dropped, and the tiles redrawn by every kind of control ask nothing; returning to the grid asks once more (#86)', async ({
    page
  }) => {
    // R's hosts are not blocked here: every request the page makes is recorded.
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await openTiles(page, { before: stubR, settings: { group_by: 'ARM' } });
    await attachStub(page);
    await expect(page.locator('.bv-tile')).toHaveCount(12);
    expect(await page.evaluate(() => window.__r.calls.length)).toBe(0);

    await choose(page, 'view', 'grid');
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(1);
    await expect(page.locator('.bv-grid-line')).toHaveAttribute('data-state', 'waiting');
    // Back to the tiles while R works: no request, and the late answer is dropped.
    await choose(page, 'view', 'tiles');
    await expect(page.locator('.bv-tile')).toHaveCount(12);
    await page.evaluate(() => window.__r.answerGrid(0, [0.5]));
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.__r.calls.length)).toBe(1);
    expect(await page.evaluate(() => window.__gc.chart.statistics())).toEqual([]);
    await expect(page.locator('.sv-main')).not.toContainText('waiting for R');
    await expect(page.locator('.sv-main')).not.toContainText('0.50');
    await expect(page.locator('.bv-grid-cell')).toHaveCount(0);
    expect((await tilesOf(page)).lines).toEqual(['']);
    // The tiles drawn again by every kind of control: still nothing asked.
    await page.locator('select[data-filter="SEX"]').selectOption('F');
    await choose(page, 'tile-summary', 'mean');
    await choose(page, 'value-type', 'change');
    await choose(page, 'y-scale', 'log');
    await page.evaluate(() => window.__gc.chart.render());
    await page.locator('.sv-reset').click();
    await page.waitForTimeout(200);
    await expect(page.locator('.bv-tile')).toHaveCount(12);
    expect(await page.evaluate(() => window.__r.calls.length)).toBe(1);
    expect(await page.evaluate(() => window.__gc.chart.statistics())).toEqual([]);

    // The grid again: asked once more, and answered.
    await choose(page, 'view', 'grid');
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(2);
    await page.evaluate(() => window.__r.answerGrid(1, [0.5]));
    await expect(page.locator('.bv-grid-cell')).toHaveCount(60);
    expect(await page.evaluate(() => window.__r.calls.length)).toBe(2);
    // The requests the page made were recorded, and none is for R.
    expect(requests.length).toBeGreaterThan(3);
    expect(requests.filter(isRHost)).toEqual([]);
  });

  test('GC-GRID-019: the grid waits until R answers, keeping its rows and columns with every cell empty and the waiting line under it, and then prints each cell; a change to the value, the scale or a filter clears the cells and asks again in one request, and the answer to the question before is never shown (#86)', async ({
    page
  }) => {
    const note = 'The first test starts R here.';
    await openGrid(page, { before: stubR, settings: { waiting_note: note } });
    await attachStub(page);
    const line = page.locator('.bv-grid-line');
    await expect(line).toHaveAttribute('data-state', 'waiting');
    await expect(line).toHaveText(`${WAITING} ${note}`);
    // The grid keeps its place: a row a biomarker and a column a visit, empty.
    await expect(page.locator('.bv-grid-table tbody tr')).toHaveCount(12);
    await expect(page.locator('.bv-grid-table td[data-status="waiting"]')).toHaveCount(60);
    await expect(page.locator('.bv-grid-cell')).toHaveCount(0);
    await expect(page.locator('.bv-grid-table tbody')).not.toContainText(/\d/);
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(1);
    // One request for every cell: the long rows, by their fields.
    expect((await calls(page))[0]).toEqual({
      name: 'Analyze_DifferenceGrid',
      rows: 11304,
      args: {
        strValueCol: 'y',
        strGroupCol: 'x',
        strBiomarkerCol: 'biomarker',
        strByCol: 'visit',
        chrGroups: ['Placebo', 'Treatment'],
        chrBiomarkers: BIOMARKERS,
        chrBy: VISITS
      },
      fields: ['USUBJID', 'y', 'x', 'visit', 'biomarker'],
      counts: { Placebo: 5654, Treatment: 5650 }
    });
    // The page answers while R works: a row's heading is there to open.
    await expect(page.locator('.bv-grid-row')).toHaveCount(12);
    await page.evaluate(() => window.__r.answerGrid(0, [-1.25, -0.5, 0, 0.004, 0.75]));
    await expect(line).toHaveAttribute('data-state', 'shown');
    await expect(page.locator('tr[data-measure="CRP"] .bv-grid-cell')).toHaveText([
      '−1.25',
      '−0.50',
      '0.00',
      '0.00',
      '0.75'
    ]);
    await expect(page.locator('.bv-grid-cell')).toHaveCount(60);
    // R is running: the waiting line no longer says what a first start costs.
    const changes = [
      { what: 'the value', make: () => choose(page, 'value-type', 'change'), cells: 48 },
      { what: 'the scale', make: () => choose(page, 'y-scale', 'log'), cells: 48 },
      {
        what: 'a filter',
        make: () => page.locator('select[data-filter="SEX"]').selectOption('F'),
        cells: 48
      }
    ];
    let asked = 1;
    for (const change of changes) {
      await change.make();
      asked += 1;
      await expect
        .poll(() => page.evaluate(() => window.__r.calls.length), change.what)
        .toBe(asked);
      // Cleared at once: no cell of the answer before is left.
      await expect(line).toHaveAttribute('data-state', 'waiting');
      await expect(line).toHaveText(WAITING);
      await expect(page.locator('.bv-grid-cell')).toHaveCount(0);
      await expect(page.locator('.bv-grid-table td[data-status="waiting"]')).toHaveCount(
        change.cells
      );
    }
    expect((await calls(page)).map((call) => call.args.chrBy.length)).toEqual([5, 4, 4, 4]);
    // The answers to the two questions before arrive late, and are not shown.
    await page.evaluate(() => {
      window.__r.answerGrid(1, [0.11]);
      window.__r.answerGrid(2, [0.22]);
    });
    await page.waitForTimeout(100);
    await expect(page.locator('.bv-grid-cell')).toHaveCount(0);
    await expect(page.locator('.sv-multiples')).not.toContainText(/0\.11|0\.22/);
    await page.evaluate(() => window.__r.answerGrid(3, [0.33]));
    await expect(page.locator('.bv-grid-cell')).toHaveCount(48);
    await expect(page.locator('.bv-grid-cell').first()).toHaveText('0.33');
    await expect(page.locator('.sv-multiples')).not.toContainText(/0\.11|0\.22/);
  });

  test('GC-GRID-020: a cell opens its biomarker at its visit, by a click or by Enter, as the single-visit view with the participants the cell compared and its own question for R; a row’s heading opens its biomarker across the visits, by a click or by Space; and All biomarkers leads back to the grid, which asks again (#86)', async ({
    page
  }) => {
    const errors = watch(page);
    await openGrid(page, { results: ['grid-result'] });
    const line = page.locator('.bv-grid-line');
    await expect(line).toHaveAttribute('data-state', 'shown');
    const root = page.locator('.sv-root');
    const cellRow = (measure, visit) =>
      gridResult('grid-result').value.rows.find(
        (row) => row.biomarker === measure && row.by === visit
      );

    await page.locator('td[data-measure="IL-6"][data-visit="Week 4"] .bv-grid-cell').click();
    await expect(root).toHaveAttribute('data-level', 'visits');
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('IL-6');
    await expect(page.locator('.bv-trail li')).toHaveText([
      'All biomarkers',
      'IL-6 over time',
      'Week 4'
    ]);
    let asked = await page.evaluate(() => window.__gc.chart.statistics());
    expect(asked).toHaveLength(1);
    expect(asked[0].name).toBe('Analyze_GroupDifference');
    expect(asked[0].dataId).toMatchObject({
      measure: 'IL-6',
      visit: 'Week 4',
      value_type: 'raw',
      groups: ['Placebo', 'Treatment']
    });
    // The participants of the panel are the ones the cell compared.
    const il6 = cellRow('IL-6', 'Week 4');
    expect(asked[0].rows).toBe(il6.n_1 + il6.n_2);
    expect((await drawn(page))[0].cells.map((cell) => cell.n)).toEqual([il6.n_1, il6.n_2]);

    // All biomarkers, in the trail: the grid again, and R asked again.
    await page.locator('.bv-trail button').first().click();
    await expect(root).toHaveAttribute('data-view', 'grid');
    await expect(line).toHaveAttribute('data-state', 'shown');
    await expect(page.locator('.bv-grid-cell')).toHaveCount(60);

    // By the keyboard: Enter on a cell.
    const cell = page.locator('td[data-measure="CRP"][data-visit="Week 12"] .bv-grid-cell');
    await cell.focus();
    await page.keyboard.press('Enter');
    await expect(root).toHaveAttribute('data-level', 'visits');
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('CRP');
    asked = await page.evaluate(() => window.__gc.chart.statistics());
    expect(asked[0].dataId).toMatchObject({ measure: 'CRP', visit: 'Week 12' });
    const crp = cellRow('CRP', 'Week 12');
    expect(asked[0].rows).toBe(crp.n_1 + crp.n_2);
    await choose(page, 'measure', 'bv_overview');
    await expect(root).toHaveAttribute('data-view', 'grid');
    await expect(page.locator('.bv-grid-cell')).toHaveCount(60);

    // A row's heading: the biomarker across the visits, with its row of tests.
    await page.locator('.bv-grid-row[data-measure="VEGF"]').click();
    await expect(root).toHaveAttribute('data-level', 'over-time');
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('VEGF');
    await expect(page.locator('.bv-time-table tr[data-row="test"]')).toHaveCount(1);
    expect((await page.evaluate(() => window.__gc.chart.statistics()))[0].name).toBe(
      'Analyze_GroupDifferenceBy'
    );
    await choose(page, 'measure', 'bv_overview');
    await expect(page.locator('.bv-grid-cell')).toHaveCount(60);
    const heading = page.locator('.bv-grid-row[data-measure="LDH"]');
    await heading.focus();
    await page.keyboard.press('Space');
    await expect(root).toHaveAttribute('data-level', 'over-time');
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('LDH');
    // Reset returns to what the settings open on: the grid.
    await page.locator('.sv-reset').click();
    await expect(root).toHaveAttribute('data-view', 'grid');
    await expect(page.locator('.bv-grid-cell')).toHaveCount(60);
    expect(errors).toEqual([]);
  });

  test('GC-GRID-021: with more than two groups drawn the reader chooses the two the grid compares: two controls list the groups drawn, the setting names the pair the chart opens on, and each cell is the first minus the second as desktop R returns it; choosing another pair asks R again under another key and is never answered with the first pair’s numbers; choosing the group the other control holds makes the two change places (#86)', async ({
    page
  }) => {
    await openGrid(page, {
      data: 'arm-sex',
      settings: { group_by: 'ARM_SEX', grid_groups: ['Treatment F', 'Placebo F'] },
      results: ['grid-arm-sex', 'grid-result']
    });
    const line = page.locator('.bv-grid-line');
    await expect(line).toHaveAttribute('data-state', 'shown');
    const expected = gridResult('grid-arm-sex');
    let found = await gridOf(page);
    expect(found.statistics).toEqual([keyOf(expected)]);
    expect(expected.args.chrGroups).toEqual(['Treatment F', 'Placebo F']);
    expect(expected.dataId.groups).toEqual(['Treatment F', 'Placebo F']);
    await holdCells(page, found, expected);
    const groups = ['Placebo F', 'Placebo M', 'Treatment F', 'Treatment M'];
    expect(found.pair).toEqual([
      { value: 'Treatment F', options: groups, shown: true },
      { value: 'Placebo F', options: groups, shown: true }
    ]);
    await expect(page.locator('.sv-sidebar')).toContainText('Difference of');
    await expect(page.locator('.sv-sidebar')).toContainText('Minus');
    expect(found.pairNote).toBe('Each cell is Treatment F minus Placebo F.');
    expect(found.key.text).toBe(
      'Standardised difference in the result, Treatment F minus Placebo F:'
    );
    expect(found.line.result).toContain('Treatment F minus Placebo F, in each cell: 60 cells');
    expect(found.rows[0].cells[0].label).toContain('(Treatment F n = 47, Placebo F n = 44)');
    await captureEvidence(page.locator('.sv-multiples'), 'GC-GRID-021', 'two-of-four-groups');

    // Another pair: R is asked again, for other rows, under another key. The
    // page holds no answer for it, and says so; the first pair's numbers go.
    await choose(page, 'grid-second', 'Placebo M');
    await expect(line).toHaveAttribute('data-state', 'unavailable');
    found = await gridOf(page);
    expect(found.statistics[0].args.chrGroups).toEqual(['Treatment F', 'Placebo M']);
    expect(found.statistics[0].dataId.groups).toEqual(['Treatment F', 'Placebo M']);
    expect(found.statistics[0].rows).not.toBe(expected.rows);
    expect(found.statistics[0].status).toBe('unavailable');
    await expect(page.locator('.bv-grid-cell')).toHaveCount(0);
    expect(found.pairNote).toBe('Each cell is Treatment F minus Placebo M.');
    expect(
      await page.evaluate(() => window.__gc.chart.specification().settings.grid_groups)
    ).toEqual(['Treatment F', 'Placebo M']);
    // The group the other control holds: the two change places.
    await choose(page, 'grid-second', 'Treatment F');
    found = await gridOf(page);
    expect(found.pair.map((control) => control.value)).toEqual(['Placebo M', 'Treatment F']);
    expect(found.statistics[0].args.chrGroups).toEqual(['Placebo M', 'Treatment F']);
    await choose(page, 'grid-first', 'Treatment F');
    found = await gridOf(page);
    expect(found.pair.map((control) => control.value)).toEqual(['Treatment F', 'Placebo M']);
    // Back to the pair R answered for: its numbers again.
    await choose(page, 'grid-second', 'Placebo F');
    await expect(line).toHaveAttribute('data-state', 'shown');
    found = await gridOf(page);
    expect(found.statistics).toEqual([keyOf(expected)]);
    // A group left out by Levels is not offered, and a pair that names it
    // falls back to the first two drawn.
    await page.evaluate(() =>
      window.__gc.chart.setSettings({ levels: ['Placebo M', 'Treatment F', 'Treatment M'] })
    );
    found = await gridOf(page);
    expect(found.pair.map((control) => control.options)).toEqual([
      groups.slice(1),
      groups.slice(1)
    ]);
    expect(found.pair.map((control) => control.value)).toEqual(['Placebo M', 'Treatment F']);
    expect(found.statistics[0].args.chrGroups).toEqual(['Placebo M', 'Treatment F']);
    // Another column to group by: its first two groups, and with exactly two
    // there is nothing to choose.
    await choose(page, 'group-by', 'ARM');
    await expect(line).toHaveAttribute('data-state', 'shown');
    found = await gridOf(page);
    expect(found.statistics).toEqual([keyOf(gridResult('grid-result'))]);
    expect(found.pair.map((control) => control.shown)).toEqual([false, false]);
    expect(await page.evaluate(() => window.__gc.chart.specification().settings.grid_groups)).toBe(
      null
    );
  });

  test('GC-GRID-022: for a change from baseline the baseline visit keeps its column, which is empty and named as not compared, and its rows are not sent to R; the Visit control chooses the columns; and a baseline value, which has no visit, is one column whose cells open the biomarker; every cell is desktop R’s for the same rows (#86)', async ({
    page
  }) => {
    await openGrid(page, {
      settings: { value_type: 'change' },
      results: ['grid-change', 'grid-change-two-visits', 'grid-baseline-value']
    });
    const line = page.locator('.bv-grid-line');
    await expect(line).toHaveAttribute('data-state', 'shown');
    const change = gridResult('grid-change');
    let found = await gridOf(page);
    expect(found.statistics).toEqual([keyOf(change)]);
    // Not sent: the baseline visit is in neither the visits asked about nor the rows.
    expect(change.args.chrBy).toEqual(VISITS.slice(1));
    expect(change.dataId.visits).toEqual(VISITS.slice(1));
    expect(found.columns.map((column) => column.text)).toEqual(['Biomarker', ...VISITS]);
    for (const row of found.rows) {
      expect(row.cells).toHaveLength(5);
      expect(row.cells[0]).toEqual({
        visit: 'Baseline',
        status: 'untested',
        button: false,
        type: null,
        text: null,
        label: `${row.measure} at Baseline: not compared. Baseline is the baseline visit: there the change from baseline is the same for everyone.`,
        title:
          'Baseline is the baseline visit: there the change from baseline is the same for everyone.',
        background: '',
        side: null
      });
    }
    await expect(page.locator('.bv-grid-table td[data-visit="Baseline"]')).toHaveText(
      Array(12).fill('')
    );
    await holdCells(page, found, change);
    expect(found.rows.flatMap((row) => row.cells).filter((cell) => cell.button)).toHaveLength(48);
    expect(found.key.text).toBe(
      'Standardised difference in the change from baseline, Placebo minus Treatment:'
    );
    expect(found.line.result).toContain('in each cell: 48 cells computed.');
    expect(found.line.scope).toBe(
      'Each cell compares Placebo with Treatment, two levels of ARM, on the participants with a change from baseline of that biomarker at that visit. Baseline has no cell: it is the baseline visit, where the change from baseline is the same for everyone.'
    );
    expect(found.notes).toContain('Baseline visit: Baseline.');
    await captureEvidence(
      page.locator('.sv-multiples'),
      'GC-GRID-022',
      'difference-grid-change-from-baseline'
    );

    // The Visit control chooses the columns.
    await page.evaluate(() => window.__gc.chart.setSettings({ visits: ['Week 4', 'Week 12'] }));
    await expect(line).toHaveAttribute('data-state', 'shown');
    const two = gridResult('grid-change-two-visits');
    found = await gridOf(page);
    expect(found.statistics).toEqual([keyOf(two)]);
    expect(found.columns.map((column) => column.text)).toEqual(['Biomarker', 'Week 4', 'Week 12']);
    await holdCells(page, found, two);

    // A baseline value has no visit: one column.
    await page.evaluate(() =>
      window.__gc.chart.setSettings({ visits: null, value_type: 'baseline' })
    );
    await expect(line).toHaveAttribute('data-state', 'shown');
    const baseline = gridResult('grid-baseline-value');
    found = await gridOf(page);
    expect(found.statistics).toEqual([keyOf(baseline)]);
    expect(found.columns.map((column) => column.text)).toEqual(['Biomarker', 'Baseline value']);
    await holdCells(page, found, baseline);
    expect(found.notes).toContain('A baseline value has no visit: each group is one point.');
    expect(found.rows[6].cells[0].label).toMatch(/^IL-6 at Baseline value: .* Open IL-6\.$/);
    await page.locator('td[data-measure="IL-6"] .bv-grid-cell').click();
    await expect(page.locator('.sv-root')).toHaveAttribute('data-level', 'visits');
    await expect(page.locator('select[data-control="measure"]')).toHaveValue('IL-6');
    expect((await page.evaluate(() => window.__gc.chart.statistics()))[0].dataId).toMatchObject({
      measure: 'IL-6',
      value_type: 'baseline'
    });
  });

  test('GC-GRID-023: the filters and the Levels control apply to the grid: a cell where a group is below R’s minimum size reads not computed, with R’s reason in its name and listed under the grid, and the others are desktop R’s; when R computes no cell the line gives R’s reason; and with fewer than two groups drawn the grid says so and asks R for nothing (#86)', async ({
    page
  }) => {
    await openGrid(page, {
      settings: {
        filters: [{ value_col: 'AGE', multiple: true, start: ['40', '41', '42', '43'] }]
      },
      results: ['grid-age-40-to-43', 'grid-age-57', 'grid-result']
    });
    const line = page.locator('.bv-grid-line');
    await expect(line).toHaveAttribute('data-state', 'shown');
    const some = gridResult('grid-age-40-to-43');
    let found = await gridOf(page);
    expect(found.statistics).toEqual([keyOf(some)]);
    expect(some.dataId.filters).toEqual({ AGE: ['40', '41', '42', '43'] });
    await holdCells(page, found, some);
    const cells = found.rows.flatMap((row) => row.cells);
    expect(cells.filter((cell) => cell.status === 'shown')).toHaveLength(34);
    expect(cells.filter((cell) => cell.status === 'withheld')).toHaveLength(26);
    expect(found.line.result).toBe(
      "Standardised difference (Hedges' g), Placebo minus Treatment, in each cell: 34 cells computed, 26 cells not. A description of each difference with its interval and its counts: no cell is a test, and the grid has no p-value."
    );
    // R's reason for each, as R wrote it, with R's counts.
    const reasons = some.value.rows
      .filter((row) => row.status !== 'ok')
      .map(
        (row) =>
          `${row.biomarker} at ${row.by}: ${row.reason} Counts: Placebo n = ${row.n_1}, Treatment n = ${row.n_2}.`
      );
    expect(reasons[0]).toBe(
      'CRP at Week 2: Not computed: Placebo has 4. The minimum group size is 5. Counts: Placebo n = 4, Treatment n = 6.'
    );
    expect(found.line.summary).toBe('Why 26 cells have no number');
    expect(found.line.reasons).toEqual(reasons);
    expect(found.rows[0].cells[1].title).toBe(reasons[0]);
    expect(found.line.scope).toBe(
      'Each cell compares Placebo with Treatment, two levels of ARM, on the participants with a result of that biomarker at that visit. Filters: AGE is 40 or 41 or 42 or 43.'
    );
    expect(found.notes).toContain('11 of 200 participants pass the filters.');
    await captureEvidence(page.locator('.sv-multiples'), 'GC-GRID-023', 'cells-r-did-not-compute');

    // Aged 57: an arm is below R's minimum in every cell.
    await page.evaluate(() =>
      window.__gc.chart.setSettings({ filters: [{ value_col: 'AGE', start: '57' }] })
    );
    await expect(line).toHaveAttribute('data-state', 'withheld');
    const none = gridResult('grid-age-57');
    found = await gridOf(page);
    expect(found.statistics).toEqual([keyOf(none)]);
    expect(found.line.result).toBe(
      'Not computed: every cell has a group below the minimum size. Each row gives its reason.'
    );
    expect(found.rows.flatMap((row) => row.cells).map((cell) => cell.text)).toEqual(
      Array(60).fill('not computed')
    );
    expect(found.line.summary).toBe('Why 60 cells have no number');
    await holdCells(page, found, none);

    // One group left by Levels: nothing to take a difference of, and R is not asked.
    await page.evaluate(() =>
      window.__gc.chart.setSettings({ filters: null, levels: ['Placebo'] })
    );
    await expect(line).toHaveAttribute('data-state', 'none');
    found = await gridOf(page);
    expect(found.line.result).toBe(
      'The difference grid compares two groups, and only Placebo is drawn. Choose a Group by with two groups or more, or Trend tiles under View.'
    );
    await expect(page.locator('.bv-grid-table')).toHaveCount(0);
    expect(found.statistics).toEqual([]);
    // Both again: the grid, and R's answer for it.
    await page.evaluate(() => window.__gc.chart.setSettings({ levels: null }));
    await expect(line).toHaveAttribute('data-state', 'shown');
    expect((await gridOf(page)).statistics).toEqual([keyOf(gridResult('grid-result'))]);
  });

  test('GC-GRID-024: on a logarithmic scale the grid leaves out values of zero or less and compares the values as they are, not their logarithms: the request says so in its identity, the sentence under the grid says which difference it is, and each cell is desktop R’s for those rows (#86)', async ({
    page
  }) => {
    await openGrid(page, { results: ['grid-result', 'grid-log'] });
    const line = page.locator('.bv-grid-line');
    await expect(line).toHaveAttribute('data-state', 'shown');
    await choose(page, 'y-scale', 'log');
    await expect(line).toHaveAttribute('data-state', 'shown');
    const log = gridResult('grid-log');
    let found = await gridOf(page);
    expect(found.statistics).toEqual([keyOf(log)]);
    expect(log.dataId.positive_only).toBe(true);
    expect(gridResult('grid-result').dataId).not.toHaveProperty('positive_only');
    await holdCells(page, found, log);
    // The study has no result at zero or below: the cells are the ones of the
    // linear scale, to the figure.
    expect(log.value.rows).toEqual(gridResult('grid-result').value.rows);
    expect(found.line.scope).toBe(
      'Each cell compares Placebo with Treatment, two levels of ARM, on the participants with a result of that biomarker at that visit. The scale is logarithmic: values of zero or less are left out, as they are from the tiles, and the difference is of the values as they are, not of their logarithms.'
    );
    // A change can be zero or less: those rows are left out of what R is
    // handed, and what is handed is the change itself.
    await choose(page, 'value-type', 'change');
    await expect(line).toHaveAttribute('data-state', 'unavailable');
    found = await gridOf(page);
    const sent = await page.evaluate(() => window.__gc.chart.tableOf().rows.map((row) => row.y));
    expect(found.statistics[0].rows).toBe(sent.length);
    expect(sent.length).toBeGreaterThan(1000);
    expect(sent.length).toBeLessThan(gridResult('grid-change').rows);
    expect(sent.every((value) => value > 0)).toBe(true);
    expect(found.statistics[0].dataId).toEqual({
      ...gridResult('grid-change').dataId,
      positive_only: true
    });
  });

  test('GC-GRID-025: a specification keeps the view and the pair: written from the grid it names the difference grid and the two groups compared, and read again it draws the same grid and asks R the same question; a setting that names the view moves the control, and a specification bio.viz v0.2.0 wrote for its paged overview opens on the tiles with its page kept (#86)', async ({
    page
  }) => {
    const errors = watch(page);
    await openGrid(page, {
      data: 'arm-sex',
      settings: { group_by: 'ARM_SEX' },
      results: ['grid-arm-sex', 'grid-result']
    });
    // The pair is chosen from the controls, not named in the settings.
    await choose(page, 'grid-first', 'Treatment F');
    await choose(page, 'grid-second', 'Placebo F');
    await expect(page.locator('.bv-grid-line')).toHaveAttribute('data-state', 'shown');
    const trip = await page.evaluate(() => {
      const old = window.__gc.chart;
      const written = old.specification();
      const read = (chart) => ({
        view: chart.root.dataset.view,
        asked: chart.statistics().map(({ name, args, dataId, rows }) => ({
          name,
          args,
          dataId,
          rows
        })),
        columns: [...chart.root.querySelectorAll('.bv-grid-table thead th')].map(
          (cell) => cell.textContent
        ),
        rows: [...chart.root.querySelectorAll('.bv-grid-table tbody tr')].map(
          (row) => row.dataset.measure
        ),
        table: chart.tableOf()
      });
      const before = read(old);
      const { connection } = old;
      old.destroy();
      const again = window.BioViz.fromSpecification('#chart', JSON.stringify(written), {
        connection
      }).init(window.__gc.data);
      window.__gc.chart = again;
      return {
        written,
        before,
        after: read(again),
        notices: again.notices,
        rewritten: again.specification()
      };
    });
    expect(trip.written.chart).toBe('group-comparison');
    expect(trip.written.settings).toMatchObject({
      start_value: null,
      opening_view: 'grid',
      grid_groups: ['Treatment F', 'Placebo F'],
      group_by: 'ARM_SEX',
      overview_limit: 12,
      page: 0
    });
    expect(trip.notices).toEqual([]);
    expect(trip.after).toEqual(trip.before);
    expect(trip.after.view).toBe('grid');
    expect(trip.after.asked[0].args.chrGroups).toEqual(['Treatment F', 'Placebo F']);
    expect(trip.rewritten).toEqual(trip.written);
    await expect(page.locator('.bv-grid-line')).toHaveAttribute('data-state', 'shown');
    await holdCells(page, await gridOf(page), gridResult('grid-arm-sex'));

    // From the tiles the specification says tiles, and keeps the pair chosen.
    const root = page.locator('.sv-root');
    await choose(page, 'view', 'tiles');
    expect(
      await page.evaluate(() => {
        const { settings } = window.__gc.chart.specification();
        return [settings.opening_view, settings.grid_groups];
      })
    ).toEqual(['tiles', ['Treatment F', 'Placebo F']]);
    // A setting that names the view moves the control, and Reset returns to
    // what the settings open on.
    await page.evaluate(() => window.__gc.chart.setSettings({ opening_view: 'grid' }));
    await expect(root).toHaveAttribute('data-view', 'grid');
    await expect(page.locator('select[data-control="view"]')).toHaveValue('grid');
    await choose(page, 'view', 'tiles');
    await page.locator('.sv-reset').click();
    await expect(root).toHaveAttribute('data-view', 'grid');
    await page.evaluate(() => window.__gc.chart.setSettings({ opening_view: 'tiles' }));
    await expect(root).toHaveAttribute('data-view', 'tiles');
    await expect(page.locator('select[data-control="view"]')).toHaveValue('tiles');

    // What v0.2.0 wrote for the second page of its overview, four biomarkers a
    // page: read whole, it opens on the tiles of every biomarker, and its two
    // settings are kept and page the grid.
    const paged = released.cases.find((entry) => entry.name === 'every-biomarker-second-page');
    expect(paged.specification.settings).toMatchObject({ overview_limit: 4, page: 1 });
    expect(paged.specification.settings).not.toHaveProperty('opening_view');
    const old = await page.evaluate((specification) => {
      window.__gc.chart.destroy();
      const chart = window.BioViz.fromSpecification('#chart', specification).init(window.__gc.data);
      window.__gc.chart = chart;
      return {
        notices: chart.notices,
        view: chart.root.dataset.view,
        tiles: chart.root.querySelectorAll('.bv-tile').length,
        asked: chart.statistics().length,
        again: chart.specification().settings
      };
    }, paged.specification);
    expect(old.notices).toEqual([]);
    expect(old.view).toBe('tiles');
    expect(old.tiles).toBe(12);
    expect(old.asked).toBe(0);
    expect(old.again).toMatchObject({ opening_view: 'tiles', overview_limit: 4, page: 1 });
    await choose(page, 'view', 'grid');
    const found = await gridOf(page);
    expect(found.statistics[0].args.chrBiomarkers).toEqual(BIOMARKERS.slice(4, 8));
    expect(found.pager.page).toBe('Page 2 of 3');
    expect(errors).toEqual([]);
  });

  test('GC-GRID-026: the grid draws a page of biomarkers at a time, `overview_limit` of them, and asks R for that page alone: with thirty-six biomarkers there are three pages of twelve, Previous and Next move between them, each asking once for its own biomarkers, and `page` is the page the chart opens on and the one a specification keeps; the tiles still draw all thirty-six (#86)', async ({
    page
  }) => {
    const errors = watch(page);
    await openGrid(page, { data: 'many-biomarkers', before: stubR });
    await attachStub(page);
    const names = (
      await page.locator('select[data-control="measure"] option').allTextContents()
    ).slice(1);
    expect(names).toHaveLength(36);
    const asked = async () =>
      (await calls(page)).map((call) => [call.name, call.args.chrBiomarkers]);
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(1);
    expect(await asked()).toEqual([['Analyze_DifferenceGrid', names.slice(0, 12)]]);
    let found = await gridOf(page);
    expect(found.rows.map((row) => row.measure)).toEqual(names.slice(0, 12));
    expect(found.pager).toEqual({
      count: '12 of 36 biomarkers shown: 1 to 12, in the Biomarker control’s order.',
      page: 'Page 1 of 3'
    });
    await expect(page.locator('.sv-main button[data-go="previous"]')).toBeDisabled();
    await page.evaluate(() => window.__r.answerGrid(0, [0.25]));
    await expect(page.locator('.bv-grid-cell')).toHaveCount(24);

    // Next: the second twelve, in one request of their own.
    await page.locator('.sv-main button[data-go="next"]').click();
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(2);
    expect((await asked())[1]).toEqual(['Analyze_DifferenceGrid', names.slice(12, 24)]);
    found = await gridOf(page);
    expect(found.rows.map((row) => row.measure)).toEqual(names.slice(12, 24));
    expect(found.pager.page).toBe('Page 2 of 3');
    expect(found.statistics[0].dataId.measures).toEqual(names.slice(12, 24));
    expect(found.statistics[0].dataId).not.toHaveProperty('page');
    expect(await page.evaluate(() => window.__gc.chart.specification().settings.page)).toBe(1);
    await page.locator('.sv-main button[data-go="next"]').click();
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(3);
    await expect(page.locator('.sv-main button[data-go="next"]')).toBeDisabled();
    await page.locator('.sv-main button[data-go="previous"]').click();
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(4);
    expect((await asked())[3][1]).toEqual(names.slice(12, 24));

    // The two settings: five a page, opened on the third page.
    await page.evaluate(() => window.__gc.chart.setSettings({ overview_limit: 5, page: 2 }));
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(5);
    expect((await asked())[4][1]).toEqual(names.slice(10, 15));
    found = await gridOf(page);
    expect(found.pager).toEqual({
      count: '5 of 36 biomarkers shown: 11 to 15, in the Biomarker control’s order.',
      page: 'Page 3 of 8'
    });
    // A page past the last opens the last.
    await page.evaluate(() => window.__gc.chart.setSettings({ page: 40 }));
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(6);
    expect((await asked())[5][1]).toEqual(names.slice(35));
    expect((await gridOf(page)).pager.page).toBe('Page 8 of 8');
    // Twelve or fewer are one page, with no pager.
    await page.evaluate(() => window.__gc.chart.setSettings({ overview_limit: 36, page: 0 }));
    await expect.poll(() => page.evaluate(() => window.__r.calls.length)).toBe(7);
    await expect(page.locator('.bv-overview-pager')).toHaveCount(0);
    expect((await asked())[6][1]).toEqual(names);

    // The tiles read neither: all thirty-six, no pages, nothing asked.
    await page.evaluate(() => window.__gc.chart.setSettings({ overview_limit: 5, page: 2 }));
    await choose(page, 'view', 'tiles');
    await expect(page.locator('.bv-tile')).toHaveCount(36);
    await expect(page.locator('.bv-overview-pager')).toHaveCount(0);
    expect(await page.evaluate(() => window.__r.calls.length)).toBe(8);
    expect(errors).toEqual([]);
  });

  test('GC-GRID-027: at the grid the PNG holds the grid with a cell’s colour and its figure, the statistics file holds R’s result and R’s row for every cell, the table file holds the rows R was handed, one per participant, biomarker and visit, and the title and the chart’s own footnote are filled from the grid drawn (#86)', async ({
    page
  }) => {
    const errors = watch(page);
    await openGrid(page, {
      settings: {
        title: '{value}: {measure} by {group}',
        subtitle: 'At {visits}; {n} participants'
      },
      results: ['grid-result']
    });
    await expect(page.locator('.bv-grid-line')).toHaveAttribute('data-state', 'shown');
    const expected = gridResult('grid-result');
    await expect(page.locator('#chart .bv-title')).toHaveText('Result: every biomarker by ARM');
    await expect(page.locator('#chart .bv-subtitle')).toHaveText(
      'At Baseline, Week 2, Week 4, Week 8, Week 12; 200 participants'
    );
    // The chart's own footnote names the estimate, and counts rows, not participants.
    await expect(page.locator('#chart .bv-foot-line').last()).toContainText(
      "Statistics: Standardised difference (Hedges' g) (11304 rows of values); stored with the page."
    );
    await expect(page.locator('#chart .bv-downloads button')).toHaveText([
      'PNG',
      'Statistics (CSV)',
      'Table (CSV)'
    ]);
    const save = async (kind) => {
      const waiting = page.waitForEvent('download');
      await page.locator(`#chart .bv-downloads button[data-download="${kind}"]`).click();
      const download = await waiting;
      return {
        name: download.suggestedFilename(),
        bytes: readFileSync(await download.path())
      };
    };
    const base =
      'bio.viz-group-comparison-every-biomarker-baseline-week-2-week-4-week-8-week-12-arm';

    // The picture: the frame at twice its size, with the grid in it. The cell
    // of IL-6 at Week 12, the deepest blue, is blue and lettered in the picture.
    const where = await page.evaluate(() => {
      const { main } = window.__gc.chart;
      const frame = main.getBoundingClientRect();
      let lost = 0;
      const table = main.querySelector('.bv-grid-table');
      for (const element of main.querySelectorAll('.bv-no-picture')) {
        if (element.parentElement.closest('.bv-no-picture')) continue;
        if (!(element.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (box.height) {
          lost += box.height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
        }
      }
      const box = main
        .querySelector('td[data-measure="IL-6"][data-visit="Week 12"] .bv-grid-cell')
        .getBoundingClientRect();
      return {
        width: Math.ceil(frame.width),
        cell: {
          left: Math.round(box.left - frame.left) + 3,
          right: Math.round(box.right - frame.left) - 3,
          top: Math.round(box.top - frame.top - lost) + 3,
          bottom: Math.round(box.bottom - frame.top - lost) - 3
        }
      };
    });
    const png = await save('png');
    expect(png.name).toBe(`${base}.png`);
    const read = readPng(new Uint8Array(png.bytes));
    expect(read.width).toBe(where.width * 2);
    expect(read.text.Title).toBe(
      'Result: every biomarker by ARM — At Baseline, Week 2, Week 4, Week 8, Week 12; 200 participants'
    );
    const picture = pixelsOf(new Uint8Array(png.bytes));
    let blue = 0;
    let dark = 0;
    for (let x = where.cell.left * 2; x <= where.cell.right * 2; x += 1) {
      for (let y = where.cell.top * 2; y <= where.cell.bottom * 2; y += 1) {
        const [red, green, bluish] = picture.pixel(x, y);
        if (bluish > 200 && bluish - red > 60 && green > red) blue += 1;
        if (red < 130 && green < 130 && bluish < 130) dark += 1;
      }
    }
    // Most of the cell is its colour, and some of it is the figure.
    const area =
      (where.cell.right - where.cell.left) * 2 * ((where.cell.bottom - where.cell.top) * 2);
    expect(blue).toBeGreaterThan(area * 0.6);
    expect(dark).toBeGreaterThan(20);

    // The statistics: R's result, then R's row for each cell, every number R's.
    const file = await save('statistics');
    expect(file.name).toBe(`${base}-statistics.csv`);
    const [head, ...records] = parseCsv(file.bytes.toString('utf8'));
    const column = (name) => head.indexOf(name);
    expect(records).toHaveLength(1 + 60);
    expect(records[0][column('part')]).toBe('result');
    expect(records[0][column('function')]).toBe('Analyze_DifferenceGrid');
    expect(head).not.toContain('p_value_row');
    expected.value.rows.forEach((row, at) => {
      const record = records[at + 1];
      expect(record[column('part')]).toBe('rows');
      expect(record[column('biomarker')]).toBe(row.biomarker);
      expect(record[column('by')]).toBe(row.by);
      for (const member of ['estimate', 'lower', 'upper', 'level', 'n_1', 'n_2', 'counts']) {
        expect(Number(record[column(member)]), `${row.biomarker} ${row.by} ${member}`).toBe(
          row[member]
        );
      }
      // What it was asked about: the two groups, in the order compared.
      expect(record[column('data/groups')]).toBe('Placebo | Treatment');
    });

    // The table: the rows R was handed.
    const table = await save('table');
    expect(table.name).toBe(`${base}-table.csv`);
    const [columns, ...rows] = parseCsv(table.bytes.toString('utf8'));
    expect(columns).toEqual(['Participant', 'Biomarker', 'Visit', 'ARM', 'Result']);
    expect(rows).toHaveLength(11304);
    const fixture = readFileSync(
      new URL('../fixtures/group-statistics/grid-result.csv', import.meta.url),
      'utf8'
    )
      .trimEnd()
      .split('\n')
      .slice(1)
      .map((row) => row.split(','));
    // The same rows desktop R ran on: participant, value, group, visit, biomarker.
    expect(
      rows.map(([id, biomarker, visit, group, value]) => [id, value, group, visit, biomarker])
    ).toEqual(fixture);
    expect(errors).toEqual([]);
  });
});

test.describe('group comparison: the difference grid on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('GC-GRID-028: at 390px the grid scrolls sideways inside its own frame and the page does not: every column is reached by scrolling the frame, the biomarkers’ names stay at its left edge, and a tap on a cell opens that biomarker at that visit with the top of its chart on screen (#86)', async ({
    page
  }) => {
    await openGrid(page, { results: ['grid-result'] });
    await expect(page.locator('.bv-grid-line')).toHaveAttribute('data-state', 'shown');
    expect(await layout(page)).toEqual(HOLDS);
    const frame = () =>
      page.locator('.bv-grid-scroll').evaluate((scroll) => {
        const box = scroll.getBoundingClientRect();
        const last = scroll.querySelector('tbody tr td:last-child').getBoundingClientRect();
        const heading = scroll.querySelector('tbody th').getBoundingClientRect();
        return {
          overflow: getComputedStyle(scroll).overflowX,
          client: scroll.clientWidth,
          scroll: scroll.scrollWidth,
          left: scroll.scrollLeft,
          box: [box.left, box.right],
          lastRight: last.right,
          heading: [heading.left, heading.right],
          pageX: window.scrollX
        };
      });
    let held = await frame();
    // The grid is wider than its frame, and the frame is within the page.
    expect(held.overflow).toBe('auto');
    expect(held.scroll).toBeGreaterThan(held.client);
    expect(held.box[0]).toBeGreaterThanOrEqual(0);
    expect(held.box[1]).toBeLessThanOrEqual(390);
    expect(held.lastRight).toBeGreaterThan(held.box[1]);
    await captureEvidence(
      page.locator('.sv-multiples'),
      'GC-GRID-028',
      'difference-grid-on-a-phone'
    );
    // Scrolled to its end: the last column is inside the frame, the names are
    // still at its left edge, and the page has not moved.
    await page.locator('.bv-grid-scroll').evaluate((scroll) => {
      scroll.scrollLeft = scroll.scrollWidth;
    });
    const scrolled = await frame();
    expect(scrolled.left).toBeGreaterThan(0);
    expect(scrolled.lastRight).toBeLessThanOrEqual(scrolled.box[1] + 1);
    expect(scrolled.heading[0]).toBeGreaterThanOrEqual(scrolled.box[0]);
    expect(scrolled.heading[0]).toBeLessThan(scrolled.box[0] + 20);
    expect(scrolled.pageX).toBe(0);
    expect(await layout(page)).toEqual(HOLDS);
    // Every cell is as wide as its figure needs: none is squeezed to fit.
    const widths = await page
      .locator('.bv-grid-cell')
      .evaluateAll((all) => all.map((cell) => [cell.clientWidth, cell.scrollWidth]));
    expect(widths).toHaveLength(60);
    for (const [client, scroll] of widths) {
      expect(client).toBeGreaterThanOrEqual(44);
      expect(scroll).toBeLessThanOrEqual(client);
    }

    // A tap on a cell, far down the page, opens it with the trail and the top
    // of the chart on screen.
    await page.locator('td[data-measure="VEGF"][data-visit="Week 12"] .bv-grid-cell').tap();
    await expect(page.locator('.sv-root')).toHaveAttribute('data-level', 'visits');
    await expect(page.locator('.bv-trail li')).toHaveText([
      'All biomarkers',
      'VEGF over time',
      'Week 12'
    ]);
    await expect(page.locator('.sv-main > .bv-statistic')).toHaveAttribute(
      'data-state',
      'unavailable'
    );
    const top = await page.evaluate(
      () => document.querySelector('.bv-group-comparison').getBoundingClientRect().top
    );
    expect(top).toBeGreaterThanOrEqual(-60);
    expect(top).toBeLessThan(844);
    await expect(page.locator('.bv-trail')).toBeInViewport();
    expect(await layout(page)).toEqual(HOLDS);
  });
});
