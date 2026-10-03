import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, chromium } from '@playwright/test';
import { compareValues, TOLERANCE } from '../../site/r-check/check.mjs';
import { markOf, numberOf } from '../../src/correlation-matrix/structureData.js';
import { captureEvidence } from './evidence.js';
import { NOBODY_PASSES, asked, expectNobody, letNobodyThrough, openDemo } from './nobody.js';

// The correlation matrix in a real page (#27): safety.viz's vendored bundle and
// bio.viz's committed bundle, loaded as two script tags, drawing the vendored
// synthetic study.
//
// The file is named for the requirement's two charts, so that
// `npm run test:e2e -- association` runs this spec and the association
// scatter's together; its module is still correlation-matrix (the evidence
// pipeline routes `<group>-<module>.spec.js` to `<module>`).
//
// Every group but the last reaches no network and runs no R: the grid is asked
// of a connection with no R attached, of a stand-in for R whose answers arrive
// when the test says, or of results desktop R stored. The last group, "live",
// is the opposite: it opens the gallery's demo and runs real R from webR's
// public CDN.

const readJson = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
// What desktop R answered for the frames the chart hands R, each with the key
// the chart asks with (tools/r-matrix-statistics.R). No number below was typed
// but the ones a printed line is held to.
const statistics = readJson('../fixtures/matrix-statistics-r.json');
const resultOf = (name) => statistics.results.find((result) => result.case === name);
const keyed = ({ name, args, dataId, rows, value }) => ({ name, args, dataId, rows, value });
const stored = (...names) => names.map(resultOf).map(keyed);
// The association scatter's own expected results, for the pair a cell opens.
const scatterStatistics = readJson('../fixtures/association-statistics-r.json');
const scatterStored = (...names) =>
  names.map((name) => scatterStatistics.results.find((result) => result.case === name)).map(keyed);
const statisticsRecord = readJson('../../site/vendor/gsm.bio/SOURCE.json');
const FIXTURE = '/tests/e2e/fixtures/correlation-matrix.html';
const R_HOSTS = ['webr.r-wasm.org', 'repo.r-wasm.org'];
const isRHost = (url) => R_HOSTS.includes(new URL(url).hostname);
const NO_R = 'Statistics are unavailable: no R is attached to this chart.';
const NOT_STORED =
  'Statistics are unavailable for this view: the page holds no stored result for it, and no R ' +
  'is attached to compute one.';
const WAITING = 'Statistics: waiting for R…';
const HINT =
  'Click a cell, or press Enter on it, to open that pair in the association scatter. Point at ' +
  'a cell, or move to it with the arrow keys, to read its coefficient and its pair count.';
const NO_P_NOTE =
  'R’s note: No p-values: a matrix reports each coefficient, its interval and its pair count. ' +
  'Use Analyze_Correlation() to test one pair.';
const SCOPE = (n) =>
  `${n} participants are in the frame. A cell is of the ones who have both of its values, so ` +
  'each cell has its own count, and the cells are not adjusted for one another.';
const BACK = 'Back to the correlation matrix';
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
const VISITS = ['Baseline', 'Week 2', 'Week 4', 'Week 8', 'Week 12'];
// A printed p-value: the letter with a sign and a number, as every formatter prints one.
const P_VALUE = /\bp\s*[=<>]\s*\d/i;

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
      window.__cmSettings = given;
    }, settings);
  }
  await page.goto(`${FIXTURE}?data=${data}${make ? '' : '&make=no'}`);
  await page.evaluate(() => window.__cm.ready);
}

// What the grid shows, read from the page: the heading, the variables along
// the top and down the side, and every cell with what a reader sees in it.
const grid = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('.bv-correlation-matrix');
    const wrap = root.querySelector('.bv-matrix');
    const found = wrap.querySelector('.bv-matrix-grid');
    if (wrap.hidden || !found) return null;
    const shows = (element) => Boolean(element) && getComputedStyle(element).display !== 'none';
    return {
      title: wrap.querySelector('.bv-matrix-title').textContent,
      view: found.dataset.view,
      compact: found.classList.contains('bv-compact'),
      label: found.getAttribute('aria-label'),
      columns: [...found.querySelectorAll('.bv-col-head')].map((head) => head.textContent),
      rows: [...found.querySelectorAll('.bv-row-head')].map((head) => head.textContent),
      diagonal: [...found.querySelectorAll('.bv-diagonal')].map((same) => same.title),
      cells: [...found.querySelectorAll('.bv-cell')].map((cell) => {
        const mark = cell.querySelector('.bv-mark');
        const number = cell.querySelector('.bv-num');
        return {
          row: Number(cell.dataset.row),
          column: Number(cell.dataset.column),
          side: cell.dataset.side,
          status: cell.dataset.status,
          number: shows(number) ? number.textContent : null,
          mark: shows(mark)
            ? {
                sign: mark.dataset.sign,
                size: mark.style.getPropertyValue('--bv-size'),
                color: mark.style.getPropertyValue('--bv-color')
              }
            : null,
          dash: Boolean(cell.querySelector('.bv-none')),
          scatter: Boolean(cell.querySelector('canvas')),
          says: cell.getAttribute('aria-label'),
          title: cell.title
        };
      })
    };
  });
const cellAt = (page, row, column) =>
  page.locator(`.bv-matrix-grid .bv-cell[data-row="${row}"][data-column="${column}"]`);
const cellOf = (shown, row, column) =>
  shown.cells.find((cell) => cell.row === row && cell.column === column);
// R's row for a pair of the grid's variables, by their places in the grid.
const rowOf = (value, a, b) =>
  value.rows.find(
    (row) => [row.x, row.y].sort().join() === [`v${a + 1}`, `v${b + 1}`].sort().join()
  );
// What a cell of the grid should show for R's row: its number above the
// diagonal and its mark below, both read off R's coefficient.
function shownFor(row, side, compact = false) {
  if (row.estimate === null) return { number: null, mark: null, dash: true };
  const { sign, size, color } = markOf(row.estimate);
  const marked = side === 'mark' || compact;
  return {
    number: marked ? null : numberOf(row.estimate),
    mark: marked ? { sign, size: `${size}%`, color } : null,
    dash: false
  };
}
// Holds every cell of the grid to R's answer for it.
function expectGrid(shown, value, { compact = false } = {}) {
  expect(shown.cells).toHaveLength(value.rows.length * 2);
  for (const cell of shown.cells) {
    const row = rowOf(value, cell.row, cell.column);
    expect(row, `${cell.row},${cell.column}`).toBeTruthy();
    expect(
      { number: cell.number, mark: cell.mark, dash: cell.dash },
      `${cell.row},${cell.column}`
    ).toEqual(shownFor(row, cell.side, compact));
    expect(cell.status).toBe(row.estimate === null ? 'withheld' : 'shown');
  }
}

// Sets a sidebar <select> by its control name; the chart redraws at once.
async function choose(page, control, value) {
  await page.locator(`.sv-sidebar select[data-control="${control}"]`).selectOption(value);
}
const controls = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('.sv-sidebar [data-control]')].map((control) => [
        control.dataset.control,
        control.matches('details') ? control.querySelector('summary').textContent : control.value
      ])
    )
  );
// Ticks or unticks values of a multiple-choice control.
async function tick(page, control, values, on) {
  const picker = page.locator(`.sv-sidebar [data-control="${control}"]`);
  if (!(await picker.evaluate((details) => details.open))) await picker.locator('summary').click();
  for (const value of values) {
    const box = picker.locator(`input[value="${value}"]`);
    if (on) await box.check();
    else await box.uncheck();
  }
}

// The page's width against the viewport's. The fixture page has a margin, so the
// document is measured, not its body.
const layout = (page) =>
  page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
const HOLDS = { viewport: 390, scrollWidth: 390 };

const root = (page) => page.locator('#chart > .bv-correlation-matrix');
const line = (page) => root(page).locator('.sv-main > .bv-statistic');
const notes = (page) => root(page).locator('.sv-notes > span');
const footnote = (page) => root(page).locator('.sv-footnote');
const pairs = (page) => root(page).locator('.bv-pairs');
const listed = (page) =>
  pairs(page)
    .locator('tbody tr')
    .evaluateAll((rows) =>
      rows.map((row) => [...row.children].map((cell) => cell.textContent.trim()))
    );
// Everything the chart says of the grid on screen but the key, whose five
// numbers are the scale's and never a pair's: the cells, the notes, the line
// under the grid and the list.
const said = (page) =>
  root(page).evaluate((chart) =>
    ['.sv-notes', '.bv-matrix-grid', '.sv-footnote', '.bv-statistic', '.bv-pairs']
      .flatMap((selector) => [...chart.querySelectorAll(selector)])
      .map((element) => element.innerText)
      .join('\n')
  );
// The scatter a cell opened, in place of the grid.
const drill = (page) => page.locator('#chart > .bv-matrix-drill');
const scatterLine = (page) => drill(page).locator('.sv-main > .bv-statistic .bv-coefficient');

// Gives the chart a connection that holds R's stored answers.
const withStored = (page, results, settings = {}) =>
  page.evaluate(
    ({ results, settings }) => {
      window.__cm.chart.setSettings({
        ...settings,
        connection: window.BioViz.r.createConnection({ results })
      });
    },
    { results, settings }
  );

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
    window.__cm.chart.setSettings({
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

test.describe('correlation matrix: the page and the two bundles', () => {
  test('CM-KIT-001: the chart is built from safety.viz’s kit on the page, its small scatters drawn with the kit’s Chart.js; without safety.viz it says what is missing (#27)', async ({
    page
  }) => {
    const errors = watch(page);
    const requests = [];
    page.on('request', (request) => requests.push(new URL(request.url()).pathname));
    await open(page, { settings: { biomarkers: ['CRP', 'IL-6', 'IL-10'], view: 'scatters' } });
    const found = await page.evaluate(() => {
      const { chart } = window.__cm;
      return {
        drawsWithKit: chart.charts.every((mini) => mini instanceof window.SafetyViz.kit.Chart),
        charts: chart.charts.length,
        type: chart.charts[0].config.type,
        ownChart: 'Chart' in window.BioViz,
        globalChart: typeof window.Chart,
        root: document.querySelector('#chart > .sv-root').className,
        // The shell, the sidebar and the controls are the kit's.
        sidebar: Boolean(document.querySelector('#chart .sv-sidebar .sv-controls')),
        sections: [...document.querySelectorAll('#chart .sv-section-title')].map(
          (title) => title.textContent
        )
      };
    });
    expect(found).toEqual({
      drawsWithKit: true,
      // Three variables: three pairs, each a small scatter below the diagonal.
      charts: 3,
      type: 'scatter',
      ownChart: false,
      globalChart: 'undefined',
      // safety.viz's shell, with this chart's class on it.
      root: 'sv-root bv-correlation-matrix',
      sidebar: true,
      sections: ['Variables', 'Display', 'Statistics', 'Filters']
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
        window.BioViz.correlationMatrix(document.body, {});
        return 'made';
      } catch (error) {
        return error.message;
      }
    });
    expect(message).toMatch(
      /^bio\.viz: the correlation matrix is built from safety\.viz's kit, and `SafetyViz\.kit` was not found\./
    );
  });
});

test.describe('correlation matrix: what is drawn', () => {
  test('CM-DRAW-001: it opens on every biomarker at the first visit: a mark below the diagonal whose width and colour are those of R’s coefficient, and R’s coefficient above it (#27)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page);
    await withStored(page, stored('biomarkers-baseline'));
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const shown = await grid(page);
    expect(shown.title).toBe('Result at Baseline, biomarker against biomarker');
    expect(shown.label).toBe(
      'Correlation matrix: Result at Baseline, biomarker against biomarker, 12 variables'
    );
    expect(shown.view).toBe('grid');
    expect(shown.compact).toBe(false);
    expect(shown.columns).toEqual(BIOMARKERS);
    expect(shown.rows).toEqual(BIOMARKERS);
    expect(await controls(page)).toMatchObject({
      mode: 'biomarkers',
      'value-type': 'raw',
      visit: 'Baseline',
      biomarkers: 'All (12)',
      view: 'grid',
      method: 'pearson',
      'min-pairs': ''
    });
    // 66 pairs, each with a cell on either side of the diagonal.
    expect(shown.cells).toHaveLength(132);
    for (const cell of shown.cells) {
      expect(cell.side).toBe(cell.column > cell.row ? 'number' : 'mark');
    }
    // Every cell is R's coefficient for its pair, and nothing else.
    const { value } = resultOf('biomarkers-baseline');
    expectGrid(shown, value);
    // The planted pair, TNF-alpha with IL-10: the one large mark, and 0.64.
    expect(cellOf(shown, 10, 8)).toMatchObject({
      side: 'mark',
      number: null,
      mark: { sign: 'positive', size: '64%', color: 'hsl(217, 78%, 52%)' }
    });
    expect(cellOf(shown, 8, 10)).toMatchObject({ side: 'number', number: '0.64', mark: null });
    const sizes = shown.cells.filter((cell) => cell.mark).map((cell) => parseInt(cell.mark.size));
    expect(Math.max(...sizes)).toBe(64);
    expect(sizes.filter((size) => size > 30)).toEqual([64]);
    // A negative coefficient is a ring in the other hue, and a true minus sign.
    expect(cellOf(shown, 1, 0)).toMatchObject({
      mark: { sign: 'negative', size: '24%', color: 'hsl(18, 82%, 79%)' }
    });
    expect(cellOf(shown, 0, 1).number).toBe('−0.13');
    // The mark is drawn at that width, in that colour: the planted pair's is a
    // filled disc 64% of its cell wide.
    const drawn = await cellAt(page, 10, 8).evaluate((cell) => {
      const mark = cell.querySelector('.bv-mark');
      const box = mark.getBoundingClientRect();
      const style = getComputedStyle(mark);
      return {
        ratio: box.width / cell.clientWidth,
        square: Math.abs(box.width - box.height) < 0.5,
        round: style.borderRadius,
        background: style.backgroundColor
      };
    });
    expect(drawn.ratio).toBeCloseTo(0.64, 2);
    expect(drawn).toMatchObject({ square: true, round: '50%', background: 'rgb(37, 110, 228)' });
    // Above the grid: all twelve are shown, and who is in the frame.
    await expect(notes(page)).toHaveText([
      'All 12 biomarkers chosen are shown.',
      '200 of 200 participants in the frame.'
    ]);
    await expect(line(page).locator('p')).toHaveText([
      "Pearson's product-moment correlation, pair by pair: 66 pairs of 12 variables, each on the " +
        'participants who have both of its values.',
      NO_P_NOTE,
      SCOPE(200)
    ]);
    await expect(footnote(page)).toHaveText(HINT);
    expect(errors).toEqual([]);
    await captureEvidence(
      root(page).locator('.bv-matrix'),
      'CM-DRAW-001',
      'biomarkers-at-baseline'
    );
  });

  test('CM-DRAW-002: every cell gives its pair count: its name and its title say the pair, the coefficient with R’s interval and the count, and so does the line under the grid while the pointer or the keyboard is on it (#27)', async ({
    page
  }) => {
    await open(page);
    await withStored(page, stored('biomarkers-baseline'));
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const shown = await grid(page);
    const { value } = resultOf('biomarkers-baseline');
    const figure = (number) => String(Number(number.toPrecision(4)));
    for (const cell of shown.cells) {
      const row = rowOf(value, cell.row, cell.column);
      const said =
        `${BIOMARKERS[cell.row]} and ${BIOMARKERS[cell.column]}: Pearson’s r ` +
        `${figure(row.estimate)}, 95% confidence interval ${figure(row.lower)} to ` +
        `${figure(row.upper)} (n = ${row.counts}). Open the scatter.`;
      expect(cell.says).toBe(said);
      expect(cell.title).toBe(said);
    }
    const planted =
      'TNF-alpha and IL-10: Pearson’s r 0.6384, 95% confidence interval 0.5482 to 0.7139 ' +
      '(n = 200). Open the scatter.';
    expect(cellOf(shown, 10, 8).says).toBe(planted);
    // The cell is a button with that name.
    await expect(page.getByRole('button', { name: planted })).toHaveCount(1);
    // Under the grid while the pointer is on it, and the hint again when it leaves.
    await cellAt(page, 10, 8).hover();
    await expect(footnote(page)).toHaveText(planted);
    await root(page).locator('.bv-matrix-title').hover();
    await expect(footnote(page)).toHaveText(HINT);
    // And while the keyboard is on it, with the pointer out of the way.
    await page.mouse.move(0, 0);
    await cellAt(page, 8, 10).focus();
    await expect(footnote(page)).toHaveText(
      'IL-10 and TNF-alpha: Pearson’s r 0.6384, 95% confidence interval 0.5482 to 0.7139 ' +
        '(n = 200). Open the scatter.'
    );
    await cellAt(page, 8, 10).blur();
    await expect(footnote(page)).toHaveText(HINT);
    // On the diagonal: how many participants have that variable, as R counted them.
    expect(shown.diagonal).toEqual(
      BIOMARKERS.map((label) => `${label}: 200 participants have a value.`)
    );
    expect(value.counts.v9).toBe(200);
  });

  test('CM-DRAW-003: a key shows the mark for −1, −0.5, 0, 0.5 and 1 and says what width, darkness, colour and shape mean; in greyscale its marks still differ by size, by lightness and by shape (#27)', async ({
    page
  }) => {
    await open(page);
    await withStored(page, stored('biomarkers-baseline'));
    const key = root(page).locator('.bv-key');
    await expect(key).toHaveAttribute('role', 'note');
    await expect(key.locator('.bv-key-item')).toHaveText([
      '−1.00',
      '−0.50',
      '0.00',
      '0.50',
      '1.00'
    ]);
    await expect(key.locator('p')).toHaveText(
      'Below the diagonal a pair is a mark: the wider and the darker, the stronger the ' +
        'coefficient; a filled blue disc is positive and an orange ring negative. Above it is ' +
        'the coefficient itself, to two decimals, where a cell is wide enough to hold it; where ' +
        'it is not, both sides are marks and the numbers are in the list beneath. A hatched ' +
        'cell has too few complete pairs for a coefficient.'
    );
    // Each mark of the key as it is drawn: its width, its shape, and the grey
    // its colour is without its hue (the luminance a greyscale print keeps).
    const marks = await key.locator('.bv-mark').evaluateAll((found) =>
      found.map((mark) => {
        const style = getComputedStyle(mark);
        const canvas = document.createElement('canvas').getContext('2d');
        canvas.fillStyle = mark.style.getPropertyValue('--bv-color');
        canvas.fillRect(0, 0, 1, 1);
        const [red, green, blue] = canvas.getImageData(0, 0, 1, 1).data;
        return {
          sign: mark.dataset.sign,
          width: mark.getBoundingClientRect().width,
          grey: Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue),
          ring: style.backgroundImage.startsWith('radial-gradient')
        };
      })
    );
    expect(marks.map((mark) => mark.sign)).toEqual([
      'negative',
      'negative',
      'positive',
      'positive',
      'positive'
    ]);
    // The sign without colour: a ring or a filled disc.
    expect(marks.map((mark) => mark.ring)).toEqual([true, true, false, false, false]);
    const [minusOne, minusHalf, nought, half, one] = marks;
    // The size of the coefficient without colour: wider and darker, on either side of nought.
    for (const [weaker, stronger] of [
      [nought, half],
      [half, one],
      [nought, minusHalf],
      [minusHalf, minusOne]
    ]) {
      expect(stronger.width).toBeGreaterThan(weaker.width + 5);
      expect(stronger.grey).toBeLessThan(weaker.grey - 25);
    }
    // The two signs of one size are the same width.
    expect(minusOne.width).toBeCloseTo(one.width, 1);
    expect(minusHalf.width).toBeCloseTo(half.width, 1);
    await captureEvidence(key, 'CM-DRAW-003', 'the-key');
  });

  test('CM-DRAW-004: no p-value is printed anywhere in the chart, for either method: not in a cell, its name, the line, the list or the download (#27)', async ({
    page
  }) => {
    await open(page);
    for (const [method, name] of [
      ['pearson', 'biomarkers-baseline'],
      ['spearman', 'biomarkers-baseline-spearman']
    ]) {
      await withStored(page, stored(name), { method });
      await expect(line(page)).toHaveAttribute('data-state', 'shown');
      await expect(pairs(page).locator('tbody tr')).toHaveCount(66);
      // Everything a reader can see or be read: the text, and every name and title.
      const everything = await root(page).evaluate((chart) =>
        [
          chart.innerText,
          ...[...chart.querySelectorAll('[aria-label], [title]')].flatMap((element) => [
            element.getAttribute('aria-label') || '',
            element.getAttribute('title') || ''
          ])
        ].join('\n')
      );
      expect(everything, method).not.toMatch(P_VALUE);
      expect(everything, method).not.toMatch(/significan|\*/i);
      // R says so itself, and the chart prints R's note.
      expect(everything).toContain('No p-values: a matrix reports each coefficient');
      // The download holds the list's three columns, and no p-value either.
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        pairs(page).getByRole('button', { name: 'Download: CSV' }).click()
      ]);
      const csv = readFileSync(await download.path(), 'utf8');
      expect(csv, method).not.toMatch(P_VALUE);
      expect(csv.split('\n')[0]).not.toMatch(/\bp\b/i);
      // What R returned holds none to print.
      const asked = await page.evaluate(() => window.__cm.chart.statistics());
      expect(asked[0].answer.value.p_value).toBe(null);
      expect(asked[0].answer.value.rows.some((row) => 'p_value' in row)).toBe(false);
    }
    // The settings have no way to ask for one.
    const refused = await page.evaluate(() => {
      try {
        window.__cm.chart.setSettings({ p_values: true });
        return null;
      } catch (error) {
        return error.message;
      }
    });
    expect(refused).toMatch(/`p_values` is not a setting of the correlation matrix/);
  });

  test('CM-DRAW-005: a cell with fewer complete pairs than the minimum shows R’s reason and no number, and the cells R did answer are drawn as ever (#27)', async ({
    page
  }) => {
    await open(page);
    await withStored(page, stored('week-12-minimum-183'), { visit: 'Week 12', min_pairs: 183 });
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expect((await controls(page))['min-pairs']).toBe('183');
    const shown = await grid(page);
    const { value } = resultOf('week-12-minimum-183');
    expectGrid(shown, value);
    const withheld = shown.cells.filter((cell) => cell.status === 'withheld');
    // 51 of the 66 pairs fall under the minimum: a cell on each side for each.
    expect(withheld).toHaveLength(102);
    for (const cell of withheld) {
      const row = rowOf(value, cell.row, cell.column);
      expect(row.counts).toBeLessThan(183);
      expect(cell).toMatchObject({ number: null, mark: null, dash: true });
      expect(cell.says).toBe(
        `${BIOMARKERS[cell.row]} and ${BIOMARKERS[cell.column]}: Not computed: ${row.counts} ` +
          `complete pairs. The minimum is 183. Counts: n = ${row.counts}. Open the scatter.`
      );
      // No number of a coefficient: the only numbers are counts.
      expect(cell.says).not.toMatch(/\d\.\d/);
    }
    // It is hatched, and holds a dash that a screen reader is not read.
    const hatched = await cellAt(page, 1, 0).evaluate((cell) => ({
      background: getComputedStyle(cell).backgroundImage.slice(0, 25),
      text: cell.textContent,
      hidden: cell.querySelector('.bv-none').getAttribute('aria-hidden')
    }));
    expect(hatched).toEqual({ background: 'repeating-linear-gradient', text: '–', hidden: 'true' });
    // The 15 pairs R answered are drawn, and say their coefficient.
    const answered = shown.cells.filter((cell) => cell.status === 'shown');
    expect(answered).toHaveLength(30);
    expect(answered.every((cell) => /Pearson’s r -?\d/.test(cell.says))).toBe(true);
    // The list gives R's reason in the coefficient's place, with the count beside it.
    const rows = await listed(page);
    expect(rows).toHaveLength(66);
    expect(rows[0]).toEqual([
      'CRP and D-dimer',
      '178',
      'Not computed: 178 complete pairs. The minimum is 183.'
    ]);
    expect(rows.filter((row) => row[2].startsWith('Not computed: '))).toHaveLength(51);
    await captureEvidence(
      root(page).locator('.bv-matrix'),
      'CM-DRAW-005',
      'cells-under-the-minimum'
    );
  });

  test('CM-DRAW-006: across visits the grid is one biomarker’s visits in visit order; for a change from baseline the baseline visit is not a variable, and the note says so (#27)', async ({
    page
  }) => {
    await open(page, { settings: { mode: 'visits', measure: 'IL-6' } });
    await withStored(page, stored('visits-il-6', 'visits-il-6-change'));
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    let shown = await grid(page);
    expect(shown.title).toBe('IL-6: result, visit against visit (pg/mL)');
    expect(shown.columns).toEqual(VISITS);
    expect(shown.rows).toEqual(VISITS);
    expect(shown.cells).toHaveLength(20);
    expectGrid(shown, resultOf('visits-il-6').value);
    await expect(notes(page)).toHaveText([
      'All 5 visits chosen are shown.',
      '200 of 200 participants in the frame.'
    ]);
    // A visit correlates with the next more than with the last: R's numbers, drawn.
    expect(cellOf(shown, 0, 1).says).toMatch(/^Baseline and Week 2: Pearson’s r 0\.\d+, 95% /);
    await captureEvidence(root(page).locator('.bv-matrix'), 'CM-DRAW-006', 'visits-of-il-6');

    await choose(page, 'value-type', 'change');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    shown = await grid(page);
    expect(shown.title).toBe('IL-6: change from baseline, visit against visit (pg/mL)');
    expect(shown.columns).toEqual(VISITS.slice(1));
    expect(shown.cells).toHaveLength(12);
    expectGrid(shown, resultOf('visits-il-6-change').value);
    await expect(notes(page)).toHaveText([
      'All 4 visits chosen are shown.',
      '200 of 200 participants in the frame.',
      'Baseline visit: Baseline. It is not drawn: there the change from baseline is the same ' +
        'for everyone.'
    ]);
    // A baseline value has no visit: nothing to relate, and the chart says what to do.
    await choose(page, 'value-type', 'baseline');
    expect(await grid(page)).toBe(null);
    await expect(footnote(page)).toHaveText(
      'A baseline value has no visit, so there is nothing to relate across visits. Choose ' +
        'another value, or relate biomarkers at one visit.'
    );
    await expect(line(page)).toHaveText('');
  });

  test('CM-DRAW-007: for six variables or fewer the pairs can be drawn as small scatters, one point per participant with both values, with R’s coefficient above the diagonal; the view asks R nothing more, and is not offered for more than six (#27)', async ({
    page
  }) => {
    await open(page, { before: stubR });
    await attachStub(page);
    await expect.poll(() => called(page)).toBe(1);
    await answer(page, 0, 'biomarkers-baseline');
    // Twelve variables: the small scatters are not offered.
    const option = page.locator('select[data-control="view"] option[value="scatters"]');
    await expect(option).toBeDisabled();
    await expect(page.locator('select[data-control="view"] + .bv-control-note')).toHaveText(
      'Small scatters are offered for 6 variables or fewer; 12 are drawn.'
    );
    // Six of them: offered, and the dropdown stays open while they are unticked.
    const six = ['CRP', 'IFN-gamma', 'IL-2', 'IL-6', 'IL-10', 'TNF-alpha'];
    await tick(
      page,
      'biomarkers',
      BIOMARKERS.filter((name) => !six.includes(name)),
      false
    );
    await expect(page.locator('[data-control="biomarkers"] summary')).toHaveText('6 of 12');
    expect(
      await page.locator('[data-control="biomarkers"]').evaluate((picker) => picker.open)
    ).toBe(true);
    await expect(option).toBeEnabled();
    await expect(page.locator('select[data-control="view"] + .bv-control-note')).toHaveText(
      'Small scatters are offered for 6 variables or fewer.'
    );
    // Each untick drew the grid again and asked R again: six unticks, and the
    // last question is the six biomarkers'.
    await expect.poll(() => called(page)).toBe(7);
    const asked = (await calls(page)).at(-1);
    expect(asked).toMatchObject({
      name: 'Analyze_CorrelationMatrix',
      rows: 200,
      args: { chrCols: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'], strMethod: 'pearson' }
    });
    await answer(page, 6, 'six-biomarkers');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expectGrid(await grid(page), resultOf('six-biomarkers').value);

    await choose(page, 'view', 'scatters');
    // The view asks R for the same grid, by the same request, and nothing more.
    await expect.poll(() => called(page)).toBe(8);
    const again = (await calls(page)).at(-1);
    expect({ name: again.name, args: again.args, rows: again.rows }).toEqual({
      name: asked.name,
      args: asked.args,
      rows: asked.rows
    });
    await answer(page, 7, 'six-biomarkers');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expect(await called(page)).toBe(8);
    const shown = await grid(page);
    expect(shown.view).toBe('scatters');
    expect(shown.columns).toEqual(six);
    const { value } = resultOf('six-biomarkers');
    for (const cell of shown.cells) {
      const row = rowOf(value, cell.row, cell.column);
      if (cell.side === 'mark') {
        // A small scatter in place of the mark.
        expect(cell).toMatchObject({ scatter: true, mark: null, number: null });
      } else {
        expect(cell).toMatchObject({ scatter: false, number: numberOf(row.estimate) });
      }
      // The cell still says R's coefficient and its count.
      expect(cell.says).toContain(`(n = ${row.counts}). Open the scatter.`);
    }
    // Fifteen pairs, fifteen small scatters: each the participants who have
    // both values, the column's variable along the bottom and the row's up the side.
    const minis = await page.evaluate(() => {
      const { chart } = window.__cm;
      const cells = [...document.querySelectorAll('.bv-cell[data-side="mark"]')];
      return chart.charts.map((mini, index) => ({
        row: Number(cells[index].dataset.row),
        column: Number(cells[index].dataset.column),
        owns: cells[index].contains(mini.canvas),
        points: mini.data.datasets[0].data,
        datasets: mini.data.datasets.length,
        axes: [mini.options.scales.x.display, mini.options.scales.y.display],
        answers: mini.options.events
      }));
    });
    expect(minis).toHaveLength(15);
    const frame = await page.evaluate(() => window.__cm.chart.model.records);
    for (const mini of minis) {
      expect(mini.owns).toBe(true);
      // Points and nothing else: one dataset, no line, no axes.
      expect(mini.datasets).toBe(1);
      expect(mini.axes).toEqual([false, false]);
      // The cell is what is clicked: the small scatter answers no pointer.
      expect(mini.answers).toEqual([]);
      expect(mini.points).toEqual(
        frame.map((record) => ({
          x: record[`v${mini.column + 1}`],
          y: record[`v${mini.row + 1}`]
        }))
      );
      expect(mini.points).toHaveLength(rowOf(value, mini.row, mini.column).counts);
    }
    await expect(root(page).locator('.bv-key p')).toHaveText(
      'Below the diagonal a pair is its points: one for each participant who has both values, ' +
        'the column’s variable along the bottom and the row’s up the side, each pair on its own ' +
        'axes. Above it is R’s coefficient, to two decimals. A hatched cell has too few ' +
        'complete pairs for a coefficient.'
    );
    await captureEvidence(root(page).locator('.bv-matrix'), 'CM-DRAW-007', 'small-scatters');
    // A seventh variable: the grid is drawn, and the control says so.
    await tick(page, 'biomarkers', ['VEGF'], true);
    await expect.poll(async () => (await grid(page)).view).toBe('grid');
    expect((await controls(page)).view).toBe('grid');
    await expect(option).toBeDisabled();
    expect(await page.evaluate(() => window.__cm.chart.charts.length)).toBe(0);
  });

  test('CM-DRAW-008: the chart says how many participants are in the frame and how many were left out, and that each cell has its own count; where participants have gaps the cells’ counts differ, and each is R’s (#27)', async ({
    page
  }) => {
    await open(page);
    await withStored(page, stored('biomarkers-week-4-change'), {
      visit: 'Week 4',
      value_type: 'change'
    });
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    await expect(notes(page)).toHaveText([
      'All 12 biomarkers chosen are shown.',
      '187 of 200 participants in the frame.',
      '13 left out: no value for any variable of the grid.',
      'Baseline visit: Baseline.'
    ]);
    await expect(notes(page).nth(2)).toHaveClass('sv-warning');
    await expect(line(page).locator('.bv-stat-scope')).toHaveText(SCOPE(187));
    const shown = await grid(page);
    expect(shown.title).toBe('Change from baseline at Week 4, biomarker against biomarker');
    const { value } = resultOf('biomarkers-week-4-change');
    expectGrid(shown, value);
    // Each cell says its own count, and they are not all the same.
    const counts = shown.cells.map((cell) => Number(cell.says.match(/\(n = (\d+)\)/)[1]));
    shown.cells.forEach((cell, index) => {
      expect(counts[index]).toBe(rowOf(value, cell.row, cell.column).counts);
    });
    expect(new Set(counts).size).toBeGreaterThan(3);
    expect(Math.max(...counts)).toBeLessThanOrEqual(187);
    // The list gives every pair its count, and the diagonal each variable's.
    const rows = await listed(page);
    expect(rows.map((row) => Number(row[1]))).toEqual(value.rows.map((row) => row.counts));
    expect(shown.diagonal[1]).toBe(`D-dimer: ${value.counts.v2} participants have a value.`);
    expect(value.counts.v2).toBeLessThan(187);
  });
});

test.describe('correlation matrix: how many variables are drawn', () => {
  test('CM-LIMIT-002: thirty-six biomarkers open on the first twelve, 66 pairs, and the chart says so and how to choose others; unticking brings others in; with the limit raised it draws all 630 pairs, too narrow for numbers; the drawing is timed (#27)', async ({
    page
  }, testInfo) => {
    const errors = watch(page);
    await open(page, { data: 'many-biomarkers', before: stubR });
    await attachStub(page);
    const offered = await page.evaluate(() => window.__cm.chart.measures);
    expect(offered).toHaveLength(36);
    let shown = await grid(page);
    expect(shown.columns).toEqual(offered.slice(0, 12));
    expect(shown.cells).toHaveLength(132);
    await expect(notes(page)).toHaveText([
      '12 of 36 biomarkers shown: the first 12 of those chosen, in the Biomarkers control’s ' +
        'order. The grid draws at most 12 at a time: untick biomarkers under Biomarkers to bring ' +
        'others in.',
      // Only forty participants of the fixture have a value for these.
      '40 of 200 participants in the frame.',
      '160 left out: no value for any variable of the grid.'
    ]);
    await expect(page.locator('[data-control="biomarkers"] summary')).toHaveText('All (36)');
    // R is asked for the twelve drawn, not the thirty-six chosen.
    await expect.poll(() => called(page)).toBe(1);
    expect((await calls(page))[0]).toMatchObject({
      rows: 40,
      args: { chrCols: Array.from({ length: 12 }, (_, index) => `v${index + 1}`) },
      fields: ['USUBJID', ...Array.from({ length: 12 }, (_, index) => `v${index + 1}`)]
    });
    // Unticking the first three brings the next three in.
    await tick(page, 'biomarkers', offered.slice(0, 3), false);
    shown = await grid(page);
    expect(shown.columns).toEqual(offered.slice(3, 15));
    await expect(notes(page).first()).toHaveText(/^12 of 33 biomarkers shown: /);
    // Thirteen chosen, with a limit of twelve; twelve chosen are all shown.
    await tick(page, 'biomarkers', offered.slice(16), false);
    await expect(notes(page).first()).toHaveText(/^12 of 13 biomarkers shown: /);
    await tick(page, 'biomarkers', [offered[15]], false);
    await expect(notes(page).first()).toHaveText('All 12 biomarkers chosen are shown.');
    expect((await grid(page)).columns).toEqual(offered.slice(3, 15));

    // The limit is a setting. Each size is drawn, measured, and asked of R once.
    const timings = [];
    for (const [limit, pairsDrawn] of [
      [12, 66],
      [24, 276],
      [36, 630]
    ]) {
      const before = await called(page);
      const timing = await page.evaluate((given) => {
        const { chart } = window.__cm;
        chart.setSettings({ limit: given, biomarkers: null });
        // Drawing alone, several times over: the frame, the grid and its fit.
        const runs = [];
        for (let run = 0; run < 5; run += 1) {
          const started = performance.now();
          chart.render();
          runs.push(performance.now() - started);
        }
        const found = document.querySelector('.bv-matrix-grid');
        return {
          milliseconds: Number(runs.sort((a, b) => a - b)[2].toFixed(1)),
          cell: parseInt(found.style.getPropertyValue('--bv-cell')),
          compact: found.classList.contains('bv-compact'),
          cells: found.querySelectorAll('.bv-cell').length,
          scrolls: found.parentElement.scrollWidth > found.parentElement.clientWidth + 1
        };
      }, limit);
      expect(timing.cells).toBe(pairsDrawn * 2);
      // One request per draw, whatever the number of cells.
      expect((await called(page)) - before).toBe(6);
      expect((await calls(page)).at(-1).args.chrCols).toHaveLength(limit);
      timings.push({ variables: limit, pairs: pairsDrawn, ...timing });
    }
    // At a desk twelve hold their numbers; twenty-four and thirty-six do not,
    // and none of them scrolls.
    expect(timings.map((timing) => timing.compact)).toEqual([false, true, true]);
    expect(timings.every((timing) => !timing.scrolls)).toBe(true);
    expect(timings[0].cell).toBeGreaterThanOrEqual(34);
    expect(timings[2].cell).toBeGreaterThanOrEqual(18);
    // Drawing is not what a large grid runs out of: a generous bound, far
    // above what is measured, that a grid redrawn on every keystroke would break.
    for (const timing of timings) expect(timing.milliseconds).toBeLessThan(1500);
    await expect(notes(page).first()).toHaveText('All 36 biomarkers chosen are shown.');
    expect(await layout(page)).toEqual({ viewport: 1280, scrollWidth: 1280 });
    const holdsNumbers = async (limit) => {
      await page.evaluate((given) => {
        window.__cm.chart.setSettings({ limit: given });
      }, limit);
      return !(await grid(page)).compact;
    };
    // The most that hold their numbers depends on how wide the names are in
    // the fonts at hand: it is measured, and it is well above the default.
    let mostWithNumbers = 12;
    while (await holdsNumbers(mostWithNumbers + 1)) mostWithNumbers += 1;
    expect(mostWithNumbers).toBeGreaterThanOrEqual(20);
    expect(mostWithNumbers).toBeLessThan(30);
    expect(await holdsNumbers(mostWithNumbers + 1)).toBe(false);
    const record = {
      measured: 'drawing a grid from its tables, the median of five, with no R attached',
      viewport: '1280 by 800',
      mostVariablesWithNumbersInCells: mostWithNumbers,
      machine:
        process.env.R_CHECK_MACHINE ||
        (process.env.CI ? 'a GitHub Actions runner (ubuntu-latest)' : 'not named'),
      timings
    };
    const text = JSON.stringify(record, null, 2) + '\n';
    await testInfo.attach('correlation-matrix-drawing.json', {
      body: text,
      contentType: 'application/json'
    });
    mkdirSync(new URL('../../test-results/', import.meta.url), { recursive: true });
    writeFileSync(
      new URL('../../test-results/correlation-matrix-drawing.json', import.meta.url),
      text
    );
    console.log(`\nCorrelation matrix, drawing a grid — ${record.machine}`);
    console.log(`  cells hold their numbers up to ${mostWithNumbers} variables`);
    for (const timing of timings) {
      console.log(
        `  ${timing.variables} variables, ${timing.pairs} pairs: ${timing.milliseconds} ms, ` +
          `cells of ${timing.cell} pixels${timing.compact ? ', marks only' : ', numbers shown'}`
      );
    }
    expect(errors).toEqual([]);
    await captureEvidence(
      root(page).locator('.bv-matrix'),
      'CM-LIMIT-002',
      'thirty-six-biomarkers'
    );
  });
});

test.describe('correlation matrix: controls', () => {
  test('CM-CTRL-001: the sidebar offers the mode, the value, the visit and the biomarkers or the biomarker and the visits, how the pairs are drawn, the method, the minimum pairs, a filter per category column, and Reset chart (#27)', async ({
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
      ['Variables', ['Relate', 'Value', 'Visit', 'Biomarkers']],
      ['Display', ['Draw as']],
      ['Statistics', ['Method', 'Minimum pairs for a cell']],
      ['Filters', ['ARM', 'SEX', 'RESPONSE']]
    ]);
    await expect(page.locator('#chart .sv-reset')).toHaveText('Reset chart');
    const options = (control) =>
      page.locator(`select[data-control="${control}"] option`).allTextContents();
    expect(await options('mode')).toEqual(['Biomarkers at one visit', 'Visits of one biomarker']);
    expect(await options('value-type')).toEqual([
      'Result',
      'Baseline',
      'Change from baseline',
      'Fold change from baseline',
      'Percent change from baseline'
    ]);
    expect(await options('visit')).toEqual(VISITS);
    expect(await options('view')).toEqual(['Grid', 'Small scatters']);
    expect(await options('method')).toEqual(['Pearson', 'Spearman']);
    await expect(page.locator('[data-control="biomarkers"] .sv-ms-option')).toHaveText([
      'All',
      ...BIOMARKERS
    ]);
    // The minimum opens empty: it is R's own, and the control says so.
    const minimum = page.locator('input[data-control="min-pairs"]');
    await expect(minimum).toHaveValue('');
    await expect(minimum).toHaveAttribute('placeholder', 'R’s own');
    await expect(page.locator('input[data-control="min-pairs"] + .bv-control-note')).toHaveText(
      'A cell with fewer complete pairs shows R’s reason and no number. Left empty, the ' +
        'minimum is R’s own.'
    );
    // Every control has a name a screen reader is read.
    for (const [control, name] of [
      ['mode', 'Relate'],
      ['value-type', 'Value'],
      ['visit', 'Visit'],
      ['view', 'Draw as'],
      ['method', 'Method'],
      ['min-pairs', 'Minimum pairs for a cell']
    ]) {
      await expect(page.locator(`[data-control="${control}"]`)).toHaveAttribute('aria-label', name);
    }

    // A baseline value has no visit: the control goes.
    await choose(page, 'value-type', 'baseline');
    expect((await sections())[0]).toEqual(['Variables', ['Relate', 'Value', 'Biomarkers']]);
    expect((await grid(page)).title).toBe('Baseline value, biomarker against biomarker');
    await choose(page, 'value-type', 'raw');
    // Across visits the controls are the mode's own.
    await choose(page, 'mode', 'visits');
    expect((await sections())[0]).toEqual([
      'Variables',
      ['Relate', 'Value', 'Biomarker', 'Visits']
    ]);
    expect(await options('measure')).toEqual(BIOMARKERS);
    await expect(page.locator('[data-control="visits"] .sv-ms-option')).toHaveText([
      'All',
      ...VISITS
    ]);
    await expect(page.locator('[data-control="visit"], [data-control="biomarkers"]')).toHaveCount(
      0
    );
    // With the results table alone there is nobody to filter: no Filters section.
    await open(page, { data: 'results' });
    expect((await sections()).map(([title]) => title)).toEqual([
      'Variables',
      'Display',
      'Statistics'
    ]);
    expect((await grid(page)).columns).toEqual(BIOMARKERS);
  });

  test('CM-CTRL-002: a change to the mode, the value, the visit, the biomarkers, the biomarker, the visits or a filter draws the grid again for what was chosen, and Reset chart returns every control to what the chart opened on (#27)', async ({
    page
  }) => {
    await open(page, { before: stubR });
    await attachStub(page);
    await expect.poll(() => called(page)).toBe(1);
    const opening = await controls(page);
    const last = async () => (await calls(page)).at(-1);

    await choose(page, 'visit', 'Week 8');
    expect((await grid(page)).title).toBe('Result at Week 8, biomarker against biomarker');
    await expect.poll(() => called(page)).toBe(2);
    await choose(page, 'value-type', 'percent_change');
    expect((await grid(page)).title).toBe(
      'Percent change from baseline at Week 8, biomarker against biomarker (%)'
    );
    await tick(page, 'biomarkers', ['CRP', 'VEGF'], false);
    expect((await grid(page)).columns).toEqual(BIOMARKERS.slice(1, -1));
    expect((await last()).args.chrCols).toHaveLength(10);
    await page.locator('select[data-filter="SEX"]').selectOption('F');
    await expect(notes(page)).toContainText(['91 of 200 participants pass the filters.']);
    expect((await last()).rows).toBeLessThanOrEqual(91);
    // What R is handed is the frame drawn: the first participant's own values.
    const first = await page.evaluate(() => window.__cm.chart.model.records[0]);
    expect((await last()).first).toEqual(first);
    expect((await last()).fields).toEqual(Object.keys(first));

    await choose(page, 'mode', 'visits');
    let shown = await grid(page);
    // The baseline visit is not a variable of a percent change.
    expect(shown.title).toBe('CRP: percent change from baseline, visit against visit (%)');
    expect(shown.columns).toEqual(VISITS.slice(1));
    await choose(page, 'measure', 'TNF-alpha');
    expect((await grid(page)).title).toMatch(/^TNF-alpha: percent change from baseline/);
    await tick(page, 'visits', ['Week 2'], false);
    shown = await grid(page);
    expect(shown.columns).toEqual(['Week 4', 'Week 8', 'Week 12']);
    expect((await last()).args.chrCols).toEqual(['v1', 'v2', 'v3']);
    // One visit left of a change: no grid, and the chart says what to choose.
    await tick(page, 'visits', ['Week 4', 'Week 8'], false);
    expect(await grid(page)).toBe(null);
    await expect(footnote(page)).toHaveText(
      'Choose two or more visits: a grid relates one to another.'
    );
    const before = await called(page);

    await page.locator('#chart .sv-reset').click();
    expect(await controls(page)).toEqual(opening);
    await expect(page.locator('select[data-filter="SEX"]')).toHaveValue('__all__');
    shown = await grid(page);
    expect(shown.title).toBe('Result at Baseline, biomarker against biomarker');
    expect(shown.columns).toEqual(BIOMARKERS);
    await expect.poll(() => called(page)).toBe(before + 1);
    expect(await last()).toMatchObject({
      rows: 200,
      args: { strMethod: 'pearson' }
    });
    expect((await last()).args.chrCols).toHaveLength(12);
  });

  test('CM-CTRL-003: with the setting `statistic` null there are no Statistics controls, R is asked for nothing, and the grid’s frame is drawn with empty cells (#27)', async ({
    page
  }) => {
    await open(page, { before: stubR, settings: { statistic: null } });
    await attachStub(page);
    await expect(page.locator('#chart .sv-section-title')).toHaveText([
      'Variables',
      'Display',
      'Filters'
    ]);
    await expect(page.locator('[data-control="method"], [data-control="min-pairs"]')).toHaveCount(
      0
    );
    const shown = await grid(page);
    expect(shown.columns).toEqual(BIOMARKERS);
    expect(shown.cells).toHaveLength(132);
    expect(shown.cells.every((cell) => cell.status === 'empty' && !cell.number && !cell.mark)).toBe(
      true
    );
    await expect(line(page)).toHaveText('');
    await expect(pairs(page)).toHaveCount(0);
    await choose(page, 'visit', 'Week 4');
    expect(await called(page)).toBe(0);
    expect(await page.evaluate(() => window.__cm.chart.statistics())).toEqual([]);

    // Switched off on a chart that had R's answer on screen, nothing of that
    // answer is left: the cells are empty again.
    await page.locator('#chart .sv-reset').click();
    await withStored(page, stored('biomarkers-baseline'), {
      statistic: 'Analyze_CorrelationMatrix'
    });
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expect((await grid(page)).cells.every((cell) => cell.status === 'shown')).toBe(true);
    await page.evaluate(() => {
      window.__cm.chart.setSettings({ statistic: null });
    });
    const after = await grid(page);
    expect(after.cells.every((cell) => cell.status === 'empty' && !cell.number && !cell.mark)).toBe(
      true
    );
    await expect(line(page)).toHaveText('');
    await expect(pairs(page)).toHaveCount(0);
    expect(await said(page)).not.toMatch(/\d\.\d/);
  });
});

test.describe('correlation matrix: the list of pairs', () => {
  test('CM-LIST-001: under the grid is every pair R returned, in R’s order, with its count and its coefficient with R’s interval; a pair’s name opens the pair (#27)', async ({
    page
  }) => {
    await open(page);
    await withStored(page, [...stored('biomarkers-baseline'), ...scatterStored('pearson')]);
    await expect(pairs(page).locator('summary')).toHaveText(
      'Every pair, with its count: 66, in the order R returned them'
    );
    expect(await pairs(page).evaluate((details) => details.open)).toBe(true);
    await expect(pairs(page).locator('thead th')).toHaveText([
      'Pair',
      'Complete pairs',
      'Pearson’s r (95% confidence interval)'
    ]);
    const { value } = resultOf('biomarkers-baseline');
    const figure = (number) => String(Number(number.toPrecision(4)));
    const label = (name) => BIOMARKERS[Number(name.slice(1)) - 1];
    expect(await listed(page)).toEqual(
      value.rows.map((row) => [
        `${label(row.x)} and ${label(row.y)}`,
        String(row.counts),
        `${figure(row.estimate)} (${figure(row.lower)} to ${figure(row.upper)})`
      ])
    );
    const rows = await listed(page);
    expect(rows[61]).toEqual(['IL-10 and TNF-alpha', '200', '0.6384 (0.5482 to 0.7139)']);
    await expect(pairs(page).locator('tbody tr').first()).toHaveAttribute('data-status', 'shown');
    // The pair's name is a button, and opens the pair as its cell below the
    // diagonal does: the earlier variable along the bottom.
    const name = pairs(page).getByRole('button', { name: 'IL-10 and TNF-alpha: open the scatter' });
    await name.scrollIntoViewIfNeeded();
    await name.click();
    await expect(drill(page).locator('.bv-back')).toBeFocused();
    expect(await page.evaluate(() => window.__cm.chart.scatter().view())).toMatchObject({
      x: { measure: 'IL-10', value: 'raw', visit: 'Baseline' },
      y: { measure: 'TNF-alpha', value: 'raw', visit: 'Baseline' }
    });
    await drill(page).locator('.bv-back').click();
    await expect(cellAt(page, 10, 8)).toBeFocused();
    await pairs(page).scrollIntoViewIfNeeded();
    await captureEvidence(pairs(page), 'CM-LIST-001', 'every-pair-with-its-count');
  });

  test('CM-LIST-002: the list downloads as a CSV file under this chart’s name, with the same columns (#27)', async ({
    page
  }) => {
    await open(page);
    const save = async () => {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        pairs(page).getByRole('button', { name: 'Download: CSV' }).click()
      ]);
      return {
        file: download.suggestedFilename(),
        lines: readFileSync(await download.path(), 'utf8')
          .trimEnd()
          .split(/\r?\n/)
      };
    };
    await withStored(page, stored('biomarkers-baseline'));
    await expect(pairs(page).locator('tbody tr')).toHaveCount(66);
    let saved = await save();
    expect(saved.file).toBe('bio.viz-correlation-matrix-pairs.csv');
    const rows = await listed(page);
    const quoted = (cells) => cells.map((cell) => `"${cell}"`).join(',');
    expect(saved.lines).toEqual([
      'Pair,Complete pairs,Pearson’s r (95% confidence interval)',
      ...rows.map(quoted)
    ]);
    // Where R warned of a pair, the file says which pairs, in a column of its own.
    await withStored(page, stored('biomarkers-baseline-spearman'), { method: 'spearman' });
    await expect(pairs(page).locator('thead th').nth(2)).toHaveText('Spearman’s rho');
    saved = await save();
    expect(saved.lines[0]).toBe('Pair,Complete pairs,Spearman’s rho,R’s warning');
    expect(saved.lines).toHaveLength(67);
    const warned = resultOf('biomarkers-baseline-spearman').value.rows.map((row) => row.warning);
    saved.lines.slice(1).forEach((written, index) => {
      expect(written.endsWith(`,"${warned[index] || ''}"`), written).toBe(true);
    });
  });
});

test.describe('correlation matrix: the statistics, the waiting state and the no-stale rule', () => {
  const emptyGrid = async (page) => {
    const shown = await grid(page);
    return shown.cells.every(
      (cell) => cell.status === 'empty' && !cell.number && !cell.mark && !cell.dash
    );
  };

  test('CM-STAT-004: until R answers the line reads that it is waiting, with the page’s note until R has answered once, and every cell is empty; then the cells, the list and the line are filled from R’s answer (#27)', async ({
    page
  }) => {
    await open(page, { before: stubR });
    await attachStub(page, { waiting_note: 'The first grid starts R: about 13 MB, once.' });
    await expect(line(page)).toHaveText(`${WAITING} The first grid starts R: about 13 MB, once.`);
    await expect(line(page)).toHaveAttribute('data-state', 'waiting');
    await expect(line(page)).toHaveAttribute('role', 'status');
    // The frame is drawn, and nothing of a coefficient is.
    const waiting = await grid(page);
    expect(waiting.columns).toEqual(BIOMARKERS);
    expect(await emptyGrid(page)).toBe(true);
    expect(cellOf(waiting, 10, 8).says).toBe('TNF-alpha and IL-10. Open the scatter.');
    await expect(pairs(page)).toHaveCount(0);
    expect(await said(page)).not.toMatch(/\d\.\d/);
    expect(await page.evaluate(() => window.__cm.chart.statistics()[0].answer)).toBe(null);
    await expect.poll(() => called(page)).toBe(1);

    await answer(page, 0, 'biomarkers-baseline');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expectGrid(await grid(page), resultOf('biomarkers-baseline').value);
    await expect(pairs(page).locator('tbody tr')).toHaveCount(66);
    // R has answered: the next wait does not say what starting it costs.
    await choose(page, 'method', 'spearman');
    await expect(line(page)).toHaveText(WAITING);
    expect(await emptyGrid(page)).toBe(true);
    await expect(pairs(page)).toHaveCount(0);
    await captureEvidence(root(page).locator('.sv-main'), 'CM-STAT-004', 'waiting-for-r');
  });

  test('CM-STAT-005: a change to the mode, the value, the visit, the variables, the method, the minimum or a filter clears the cells, the list and the line and asks R again, and the answer to the question before is never shown (#27)', async ({
    page
  }) => {
    await open(page, { before: stubR });
    await attachStub(page);
    await expect.poll(() => called(page)).toBe(1);
    await answer(page, 0, 'biomarkers-baseline');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');

    // Each change: the answer on screen is cleared at once, and R is asked again.
    const changes = [
      () => choose(page, 'method', 'spearman'),
      () => page.locator('input[data-control="min-pairs"]').fill('150'),
      () => choose(page, 'visit', 'Week 4'),
      () => choose(page, 'value-type', 'change'),
      () => tick(page, 'biomarkers', ['VEGF'], false),
      () => page.locator('select[data-filter="ARM"]').selectOption('Placebo'),
      () => choose(page, 'mode', 'visits')
    ];
    let asked = 1;
    for (const [index, change] of changes.entries()) {
      // Fill the grid first, with an answer the test hands the stand-in, so
      // there is something on screen to clear.
      if (index > 0) {
        await page.evaluate(() => {
          window.__cm.chart.setSettings({});
        });
        asked += 1;
        await expect.poll(() => called(page)).toBe(asked);
      }
      await change();
      if (index === 1) await page.locator('input[data-control="min-pairs"]').press('Enter');
      asked += 1;
      await expect.poll(() => called(page), `change ${index}`).toBe(asked);
      await expect(line(page), `change ${index}`).toHaveText(WAITING);
      expect(await emptyGrid(page), `change ${index}`).toBe(true);
      await expect(pairs(page)).toHaveCount(0);
    }
    const all = await calls(page);
    // The method and the minimum went to R as arguments.
    expect(all[1].args).toMatchObject({ strMethod: 'spearman' });
    expect('nMinPairs' in all[1].args).toBe(false);
    expect(all[3].args).toMatchObject({ strMethod: 'spearman', nMinPairs: 150 });

    // An answer that arrives late, for a question the chart has moved on from.
    await page.locator('#chart .sv-reset').click();
    asked += 1;
    await expect.poll(() => called(page)).toBe(asked);
    const everyone = asked - 1;
    await page.locator('select[data-filter="SEX"]').selectOption('F');
    asked += 1;
    await expect.poll(() => called(page)).toBe(asked);
    const women = asked - 1;
    expect((await calls(page))[women].rows).toBe(91);
    // R answers the first question, for all 200, after the filter changed.
    await answer(page, everyone, 'biomarkers-baseline');
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
    await expect(line(page)).toHaveText(WAITING);
    await expect(line(page)).toHaveAttribute('data-state', 'waiting');
    expect(await emptyGrid(page)).toBe(true);
    await expect(pairs(page)).toHaveCount(0);
    expect(await root(page).evaluate((chart) => chart.innerText)).not.toContain('n = 200');
    // Then the answer to the question on screen.
    await answer(page, women, 'biomarkers-women');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const shown = await grid(page);
    expectGrid(shown, resultOf('biomarkers-women').value);
    expect(shown.cells.every((cell) => cell.says.includes('(n = 91)'))).toBe(true);
    await expect(line(page).locator('.bv-stat-scope')).toHaveText(
      `${SCOPE(91)} Filters: SEX is F.`
    );
    // What the chart holds as asked is the question on screen, with its answer.
    const held = await page.evaluate(() => window.__cm.chart.statistics());
    expect(held).toHaveLength(1);
    expect(held[0].rows).toBe(91);
    expect(held[0].dataId.filters).toEqual({ SEX: ['F'] });
  });

  test('CM-STAT-006: with no R attached the grid’s frame is drawn with empty cells that still open their pairs, no coefficient and no list, and the line says that statistics are unavailable; nothing is fetched to say so (#27)', async ({
    page
  }) => {
    const errors = watch(page);
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await open(page);
    await expect(line(page)).toHaveText(NO_R);
    await expect(line(page)).toHaveAttribute('data-state', 'unavailable');
    const shown = await grid(page);
    expect(shown.title).toBe('Result at Baseline, biomarker against biomarker');
    expect(shown.columns).toEqual(BIOMARKERS);
    expect(shown.rows).toEqual(BIOMARKERS);
    expect(shown.cells).toHaveLength(132);
    expect(await emptyGrid(page)).toBe(true);
    await expect(pairs(page)).toHaveCount(0);
    await expect(notes(page)).toHaveText([
      'All 12 biomarkers chosen are shown.',
      '200 of 200 participants in the frame.'
    ]);
    // No number that could be taken for a coefficient is anywhere in the chart.
    expect(await said(page)).not.toMatch(/\d\.\d/);
    // The other mode, the other method and the small scatters draw too.
    await choose(page, 'method', 'spearman');
    await choose(page, 'mode', 'visits');
    await choose(page, 'view', 'scatters');
    await expect(line(page)).toHaveText(NO_R);
    const across = await grid(page);
    expect(across.view).toBe('scatters');
    expect(across.cells.filter((cell) => cell.scatter)).toHaveLength(10);
    expect(across.cells.filter((cell) => cell.number || cell.mark)).toEqual([]);
    await captureEvidence(root(page).locator('.sv-main'), 'CM-STAT-006', 'with-no-r');
    // A cell still opens its pair: the scatter draws its points, and says the same of R.
    await page.locator('#chart .sv-reset').click();
    await cellAt(page, 10, 8).click();
    await expect(drill(page).locator('canvas')).toHaveCount(1);
    await expect(scatterLine(page)).toHaveText(NO_R);
    expect(
      await page.evaluate(() =>
        window.__cm.chart
          .scatter()
          .charts[0].data.datasets.reduce((total, dataset) => total + dataset.data.length, 0)
      )
    ).toBe(200);
    expect(requests.filter((url) => /webr|r-wasm/.test(url))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('CM-STAT-007: with R’s answers stored in the page the grid is filled from them with no R and no request; a view not stored says so and its cells stay empty, never another view’s numbers (#27)', async ({
    page
  }) => {
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await open(page);
    await withStored(
      page,
      stored('biomarkers-baseline', 'biomarkers-women', 'visits-il-6', 'six-biomarkers')
    );
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expectGrid(await grid(page), resultOf('biomarkers-baseline').value);
    const held = await page.evaluate(() => window.__cm.chart.statistics());
    expect(held[0].answer).toEqual({
      status: 'ok',
      value: resultOf('biomarkers-baseline').value,
      form: 'precomputed'
    });
    // A filter whose view was stored: that view's numbers, on its own 91.
    await page.locator('select[data-filter="SEX"]').selectOption('F');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expectGrid(await grid(page), resultOf('biomarkers-women').value);
    // A view that was not stored: unavailable, the cells empty, no list.
    for (const change of [
      () => page.locator('select[data-filter="SEX"]').selectOption('M'),
      () => choose(page, 'visit', 'Week 8'),
      () => choose(page, 'method', 'spearman')
    ]) {
      await change();
      await expect(line(page)).toHaveText(NOT_STORED);
      await expect(line(page)).toHaveAttribute('data-state', 'unavailable');
      const shown = await grid(page);
      expect(
        shown.cells.every((cell) => cell.status === 'empty' && !cell.number && !cell.mark)
      ).toBe(true);
      await expect(pairs(page)).toHaveCount(0);
    }
    // Back on a stored view, and across visits.
    await page.locator('#chart .sv-reset').click();
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    await choose(page, 'mode', 'visits');
    await choose(page, 'measure', 'IL-6');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expectGrid(await grid(page), resultOf('visits-il-6').value);
    await choose(page, 'measure', 'CRP');
    await expect(line(page)).toHaveText(NOT_STORED);
    expect(requests.filter((url) => /webr|r-wasm|statistics\.R/.test(url))).toEqual([]);
  });

  test('CM-STAT-008: chart.statistics() returns what the chart asked R for the grid now drawn and what R answered: one entry, with the function, the arguments, the identity and the number of rows (#27)', async ({
    page
  }) => {
    await open(page);
    for (const [name, settings] of [
      ['biomarkers-baseline', {}],
      ['week-12-minimum-183', { visit: 'Week 12', min_pairs: 183 }],
      ['visits-tnf-alpha-spearman', { mode: 'visits', measure: 'TNF-alpha', method: 'spearman' }],
      [
        'visits-il-6-change',
        { mode: 'visits', measure: 'IL-6', value_type: 'change', method: 'pearson' }
      ]
    ]) {
      await page.locator('#chart .sv-reset').click();
      await withStored(page, stored(name), { min_pairs: null, visit: null, ...settings });
      await expect(line(page), name).toHaveAttribute('data-state', 'shown');
      const expected = resultOf(name);
      const held = await page.evaluate(() => window.__cm.chart.statistics());
      // One request for the whole grid, whatever the number of cells.
      expect(held, name).toEqual([
        {
          name: expected.name,
          args: expected.args,
          dataId: expected.dataId,
          rows: expected.rows,
          answer: { status: 'ok', value: expected.value, form: 'precomputed' }
        }
      ]);
    }
    // What is returned is a copy: changing it changes nothing the chart holds.
    const unchanged = await page.evaluate(() => {
      const { chart } = window.__cm;
      chart.statistics()[0].args.strMethod = 'kendall';
      return chart.statistics()[0].args.strMethod;
    });
    expect(unchanged).toBe('pearson');
    // With no grid there is nothing asked.
    await choose(page, 'value-type', 'baseline');
    expect(await page.evaluate(() => window.__cm.chart.statistics())).toEqual([]);
  });

  test('CM-STAT-013: for Spearman the cells and the list give R’s rho with no interval, none being made up, and R’s notes and warning are printed as R worded them (#27)', async ({
    page
  }) => {
    await open(page);
    await withStored(page, stored('biomarkers-baseline-spearman'), { method: 'spearman' });
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const { value } = resultOf('biomarkers-baseline-spearman');
    const shown = await grid(page);
    expectGrid(shown, value);
    const figure = (number) => String(Number(number.toPrecision(4)));
    for (const cell of shown.cells) {
      const row = rowOf(value, cell.row, cell.column);
      expect(cell.says).toBe(
        `${BIOMARKERS[cell.row]} and ${BIOMARKERS[cell.column]}: Spearman’s rho ` +
          `${figure(row.estimate)} (n = 200).` +
          (row.warning ? ` R warned: ${row.warning}.` : '') +
          ' Open the scatter.'
      );
      expect(cell.says).not.toMatch(/interval/);
    }
    await expect(line(page).locator('p')).toHaveText([
      "Spearman's rank correlation rho, pair by pair: 66 pairs of 12 variables, each on the " +
        'participants who have both of its values.',
      'R warned: Cannot compute exact p-value with ties',
      NO_P_NOTE,
      "R’s note: cor.test() gives no confidence interval for Spearman's rho, so none is reported.",
      SCOPE(200)
    ]);
    // The list: rho alone, no interval in the heading or in any row, and each
    // pair R warned of is marked, with the warning said once beneath.
    await expect(pairs(page).locator('thead th')).toHaveText([
      'Pair',
      'Complete pairs',
      'Spearman’s rho'
    ]);
    const rows = await listed(page);
    expect(rows.map((row) => row[2])).toEqual(
      value.rows.map((row) => `${figure(row.estimate)}${row.warning ? ' 1' : ''}`)
    );
    expect(value.rows.filter((row) => row.warning).length).toBe(63);
    await expect(pairs(page).locator('.bv-pair-warned')).toHaveCount(63);
    await expect(pairs(page).locator('.bv-pair-warned').first()).toHaveAttribute(
      'title',
      'R warned: Cannot compute exact p-value with ties'
    );
    await expect(pairs(page).locator('.bv-pairs-note')).toHaveText([
      '1 R warned, of each pair marked: Cannot compute exact p-value with ties'
    ]);
    expect(await pairs(page).evaluate((list) => list.innerText)).not.toMatch(/ to -?\d/);
  });

  test('CM-STAT-014: where no pair has enough complete pairs the line prints R’s reason and no number, every cell is hatched with its own reason, and the list gives each pair’s count (#27)', async ({
    page
  }) => {
    await open(page, {
      settings: { filters: ['ARM', 'SEX', 'RESPONSE', { value_col: 'AGE', label: 'Age' }] }
    });
    await withStored(page, stored('age-35'));
    await page.locator('select[data-filter="AGE"]').selectOption('35');
    await expect(line(page)).toHaveAttribute('data-state', 'withheld');
    await expect(line(page).locator('p')).toHaveText([
      'Not computed: no pair of columns has 5 complete pairs.',
      NO_P_NOTE,
      '4 participants are in the frame. A cell is of the ones who have both of its values, so ' +
        'each cell has its own count, and the cells are not adjusted for one another. Filters: ' +
        'Age is 35.'
    ]);
    await expect(notes(page)).toContainText([
      '4 of 4 participants in the frame.',
      '4 of 200 participants pass the filters.'
    ]);
    const shown = await grid(page);
    expectGrid(shown, resultOf('age-35').value);
    expect(shown.cells).toHaveLength(132);
    for (const cell of shown.cells) {
      expect(cell).toMatchObject({ status: 'withheld', dash: true, number: null, mark: null });
      expect(cell.says).toBe(
        `${BIOMARKERS[cell.row]} and ${BIOMARKERS[cell.column]}: Not computed: 4 complete ` +
          'pairs. The minimum is 5. Counts: n = 4. Open the scatter.'
      );
    }
    const rows = await listed(page);
    expect(rows).toHaveLength(66);
    expect(rows.every((row) => row[1] === '4')).toBe(true);
    expect(
      rows.every((row) => row[2] === 'Not computed: 4 complete pairs. The minimum is 5.')
    ).toBe(true);
    // No number of a coefficient anywhere: no decimal in the chart at all.
    expect(await said(page)).not.toMatch(/\d\.\d/);
  });
});

test.describe('correlation matrix: a cell opens the association scatter', () => {
  // Everything of the grid a reader could tell a change in.
  const everything = async (page) => ({
    grid: await grid(page),
    list: await listed(page),
    line: await line(page).evaluate((element) => [element.dataset.state, element.innerText]),
    notes: await notes(page).allTextContents(),
    footnote: await footnote(page).textContent(),
    controls: await controls(page),
    filters: await page
      .locator('#chart > .bv-correlation-matrix select[data-filter]')
      .evaluateAll((selects) => selects.map((select) => [select.dataset.filter, select.value]))
  });
  const view = (page) => page.evaluate(() => window.__cm.chart.scatter().view());
  const TNF = { measure: 'TNF-alpha', value: 'raw', visit: 'Baseline' };
  const IL10 = { measure: 'IL-10', value: 'raw', visit: 'Baseline' };

  test('CM-DRILL-001: a click on a cell opens the association scatter for that pair in place of the grid, the column’s variable on its x axis and the row’s on its y axis, with a button back that takes the keyboard’s place (#27)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page);
    await withStored(page, [...stored('biomarkers-baseline'), ...scatterStored('pearson')]);
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expect(await page.evaluate(() => window.__cm.chart.scatter())).toBe(null);

    // Below the diagonal: row TNF-alpha, column IL-10.
    await cellAt(page, 10, 8).click();
    // In place: the grid is hidden, and the scatter is in the same element.
    await expect(root(page)).toBeHidden();
    await expect(drill(page)).toBeVisible();
    await expect(drill(page).locator('.sv-root')).toHaveClass(/bv-association-scatter/);
    await expect(page.locator('#chart > *')).toHaveCount(2);
    expect(await view(page)).toMatchObject({ x: IL10, y: TNF, method: 'pearson' });
    const titles = await page.evaluate(() => {
      const [panel] = window.__cm.chart.scatter().charts;
      return [panel.options.scales.x.title.text, panel.options.scales.y.title.text];
    });
    expect(titles).toEqual(['IL-10 at Baseline (pg/mL)', 'TNF-alpha at Baseline (pg/mL)']);
    // The way back is a button above the scatter, and the keyboard is on it.
    const back = drill(page).locator('.bv-back');
    await expect(back).toHaveText(BACK);
    await expect(back).toBeFocused();
    expect(await back.evaluate((button) => button.tagName)).toBe('BUTTON');
    await back.click();
    await expect(root(page)).toBeVisible();
    await expect(drill(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__cm.chart.scatter())).toBe(null);

    // Above the diagonal the same pair is the other way about: row IL-10, column TNF-alpha.
    await cellAt(page, 8, 10).click();
    expect(await view(page)).toMatchObject({ x: TNF, y: IL10 });
    // The scatter is the association scatter, whole: its own controls and its own line.
    await expect(drill(page).locator('.sv-section-title')).toContainText(['X axis', 'Y axis']);
    await expect(scatterLine(page).locator('.bv-stat-estimate')).toHaveText(
      'Pearson’s r: 0.6384, 95% confidence interval 0.5482 to 0.7139.'
    );
    await captureEvidence(page.locator('#chart'), 'CM-DRILL-001', 'a-cell-opened');
    await drill(page).locator('.bv-back').click();
    await expect(cellAt(page, 8, 10)).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('CM-DRILL-002: from the keyboard the arrow keys move among the cells, stepping over the diagonal, Enter or Space on a cell opens its pair, and Enter or Space on the button back returns (#27)', async ({
    page
  }) => {
    await open(page);
    // One cell of the grid is in the tab order; the arrow keys reach the rest.
    const tabStops = () =>
      page
        .locator('.bv-matrix-grid .bv-cell[tabindex="0"]')
        .evaluateAll((cells) => cells.map((cell) => [cell.dataset.row, cell.dataset.column]));
    expect(await tabStops()).toEqual([['0', '1']]);
    await cellAt(page, 0, 1).focus();
    const focused = () =>
      page.evaluate(() => {
        const cell = document.activeElement;
        return cell.classList.contains('bv-cell')
          ? [Number(cell.dataset.row), Number(cell.dataset.column)]
          : cell.className;
      });
    // Down from row 0 in column 1: row 1 is the diagonal, so row 2.
    await page.keyboard.press('ArrowDown');
    expect(await focused()).toEqual([2, 1]);
    // Right from column 1 in row 2: column 2 is the diagonal, so column 3.
    await page.keyboard.press('ArrowRight');
    expect(await focused()).toEqual([2, 3]);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    expect(await focused()).toEqual([0, 3]);
    // At the edge the keyboard stays where it is.
    await page.keyboard.press('ArrowUp');
    expect(await focused()).toEqual([0, 3]);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(await focused()).toEqual([0, 1]);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    expect(await focused()).toEqual([2, 3]);
    // The tab stop follows the keyboard, and the cell says what it holds.
    expect(await tabStops()).toEqual([['2', '3']]);
    await expect(footnote(page)).toHaveText('Ferritin and IFN-gamma. Open the scatter.');

    // Enter opens the pair: row Ferritin, column IFN-gamma.
    await page.keyboard.press('Enter');
    await expect(drill(page).locator('.bv-back')).toBeFocused();
    expect(await view(page)).toMatchObject({
      x: { measure: 'IFN-gamma', value: 'raw', visit: 'Baseline' },
      y: { measure: 'Ferritin', value: 'raw', visit: 'Baseline' }
    });
    // Enter on the button returns, to the cell that was opened.
    await page.keyboard.press('Enter');
    await expect(drill(page)).toHaveCount(0);
    expect(await focused()).toEqual([2, 3]);
    // Space opens it too, and Space returns.
    await page.keyboard.press('Space');
    await expect(drill(page).locator('.bv-back')).toBeFocused();
    expect(await view(page)).toMatchObject({ x: { measure: 'IFN-gamma' } });
    await page.keyboard.press('Space');
    await expect(drill(page)).toHaveCount(0);
    expect(await focused()).toEqual([2, 3]);
    // Another key on a cell opens nothing.
    await page.keyboard.press('a');
    await expect(drill(page)).toHaveCount(0);
  });

  test('CM-DRILL-003: the scatter is handed the grid’s connection itself, its method, its columns and its filters as they are set, with the setting `scatter` beneath; from results stored in the page it prints the coefficient the cell holds (#27)', async ({
    page
  }) => {
    await open(page, {
      settings: {
        measures: ['TNF-alpha', 'IL-10', 'IL-6', 'CRP'],
        max_levels: 8,
        filters: [
          { value_col: 'SEX', label: 'Sex' },
          { value_col: 'ARM', label: 'Arm' }
        ],
        scatter: {
          groups: [{ value_col: 'ARM', label: 'Arm' }],
          color_by: 'ARM',
          fit: 'identity',
          // What the grid carries across is laid over what the page set.
          method: 'spearman',
          x: { measure: 'CRP', visit: 'Week 4' }
        }
      }
    });
    // Two grids and two scatters of the same pair, each with R's own answer.
    await withStored(page, [...stored('biomarkers-women'), ...scatterStored('pearson-women')]);
    await page
      .locator('#chart > .bv-correlation-matrix select[data-filter="SEX"]')
      .selectOption('F');
    // The measures offered are the page's four, in its order.
    expect((await grid(page)).columns).toEqual(['TNF-alpha', 'IL-10', 'IL-6', 'CRP']);
    // Row IL-10, column TNF-alpha: TNF-alpha along the bottom.
    await cellAt(page, 1, 0).click();
    const handed = await page.evaluate(() => {
      const { chart } = window.__cm;
      const scatter = chart.scatter();
      return {
        sameConnection: scatter.connection === chart.connection,
        settings: {
          method: scatter.settings.method,
          measures: scatter.settings.measures,
          max_levels: scatter.settings.max_levels,
          baseline_visits: scatter.settings.baseline_visits,
          id_col: scatter.settings.id_col,
          color_by: scatter.settings.color_by,
          fit: scatter.settings.fit,
          filters: scatter.settings.filters.map(({ value_col, label, start }) => ({
            value_col,
            label,
            start: start ?? null
          })),
          back: scatter.settings.back.label
        },
        points: scatter.charts[0].data.datasets.reduce(
          (total, dataset) => total + dataset.data.length,
          0
        )
      };
    });
    expect(handed).toEqual({
      // The connection itself, not one like it: R is started once for both.
      sameConnection: true,
      settings: {
        // The grid's method, over the page's for the scatter.
        method: 'pearson',
        measures: ['TNF-alpha', 'IL-10', 'IL-6', 'CRP'],
        max_levels: 8,
        baseline_visits: ['Baseline'],
        id_col: 'USUBJID',
        // What the page set for the scatter, beneath.
        color_by: 'ARM',
        fit: 'identity',
        filters: [
          { value_col: 'SEX', label: 'Sex', start: 'F' },
          { value_col: 'ARM', label: 'Arm', start: null }
        ],
        back: BACK
      },
      // The filter is in force in the scatter: the 91 women.
      points: 91
    });
    expect(await view(page)).toMatchObject({
      x: { measure: 'TNF-alpha', value: 'raw', visit: 'Baseline' },
      y: { measure: 'IL-10', value: 'raw', visit: 'Baseline' },
      color_by: 'ARM',
      fit: 'identity',
      method: 'pearson'
    });
    await expect(drill(page).locator('select[data-filter="SEX"]')).toHaveValue('F');
    await expect(drill(page).locator('select[data-filter="ARM"]')).toHaveValue('__all__');
    await drill(page).locator('.bv-back').click();

    // On the study's twelve biomarkers, coloured by arm, the scatter's request
    // is one desktop R answered for the women: the same connection answers it,
    // and its coefficient is the cell's.
    await page.evaluate(() => {
      window.__cm.chart.setSettings({
        measures: null,
        filters: [{ value_col: 'SEX', label: 'Sex' }],
        scatter: { groups: [{ value_col: 'ARM', label: 'Arm' }], color_by: 'ARM' }
      });
    });
    await page
      .locator('#chart > .bv-correlation-matrix select[data-filter="SEX"]')
      .selectOption('F');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const cell = cellOf(await grid(page), 8, 10);
    expect(cell.says).toMatch(/^IL-10 and TNF-alpha: Pearson’s r /);
    const [, coefficient, low, high] = cell.says.match(
      /Pearson’s r (\S+), 95% confidence interval (\S+) to (\S+) \(n = 91\)/
    );
    await cellAt(page, 8, 10).click();
    await expect(scatterLine(page)).toHaveAttribute('data-state', 'shown');
    await expect(scatterLine(page).locator('.bv-stat-estimate')).toHaveText(
      `Pearson’s r: ${coefficient}, 95% confidence interval ${low} to ${high}.`
    );
    await expect(scatterLine(page).locator('.bv-stat-result')).toContainText('(n = 91)');
    // Spearman in the grid is Spearman in the scatter.
    await drill(page).locator('.bv-back').click();
    await choose(page, 'method', 'spearman');
    await cellAt(page, 8, 10).click();
    expect((await view(page)).method).toBe('spearman');
    await expect(drill(page).locator('select[data-control="method"]')).toHaveValue('spearman');
  });

  test('CM-DRILL-004: returning shows the grid exactly as it was, with the keyboard’s place on the cell that was opened, and R is not asked again for the grid (#27)', async ({
    page
  }) => {
    await open(page, { before: stubR });
    await attachStub(page, {
      filters: ['ARM', 'SEX', 'RESPONSE'],
      waiting_note: 'It starts R.'
    });
    await page.locator('select[data-filter="SEX"]').selectOption('F');
    await expect.poll(() => called(page)).toBe(2);
    await answer(page, 1, 'biomarkers-women');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const before = await everything(page);
    expect(before.grid.cells.filter((cell) => cell.status === 'shown')).toHaveLength(132);
    const held = await page.evaluate(() => window.__cm.chart.statistics());

    for (const [row, column, opens] of [
      [10, 8, () => cellAt(page, 10, 8).click()],
      [3, 7, () => cellAt(page, 3, 7).press('Enter')],
      [
        6,
        2,
        () =>
          pairs(page).getByRole('button', { name: 'Ferritin and IL-6: open the scatter' }).click()
      ]
    ]) {
      const asked = await called(page);
      await opens();
      await expect(drill(page).locator('.bv-back')).toBeFocused();
      // The scatter asks the same R, through the same connection, for itself:
      // one question, for the pair's coefficient, on the 91 women.
      await expect.poll(() => called(page)).toBe(asked + 1);
      const question = (await calls(page)).at(-1);
      expect(question).toMatchObject({
        name: 'Analyze_Correlation',
        rows: 91,
        args: { strXCol: 'x', strYCol: 'y', strMethod: 'pearson' }
      });
      // Changing the scatter's own controls changes nothing of the grid's.
      await drill(page).locator('select[data-filter="SEX"]').selectOption('M');
      await drill(page).locator('select[data-control="method"]').selectOption('spearman');
      await expect.poll(() => called(page)).toBe(asked + 3);
      const beforeBack = await called(page);
      await drill(page).locator('.bv-back').click();
      await expect(drill(page)).toHaveCount(0);
      await expect(root(page)).toBeVisible();
      // The keyboard's place is the cell that was opened.
      await expect(cellAt(page, row, column)).toBeFocused();
      await cellAt(page, row, column).blur();
      // The grid is as it was, to the last cell, and its tab stop apart.
      const after = await everything(page);
      expect(after).toEqual(before);
      // R was not asked again: the grid holds what it held, and no call was made.
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
      expect(await called(page)).toBe(beforeBack);
      expect(await page.evaluate(() => window.__cm.chart.statistics())).toEqual(held);
      expect(
        (await calls(page)).filter((call) => call.name === 'Analyze_CorrelationMatrix')
      ).toHaveLength(2);
    }
    // The line never went back to waiting on a return.
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
  });

  test('CM-DRILL-005: chart.open(x, y) opens a pair by its two labels and returns the scatter, chart.scatter() gives it, chart.close() returns to the grid; a label the grid does not have is refused; drawing the grid again closes the scatter (#27)', async ({
    page
  }) => {
    await open(page);
    const opened = await page.evaluate(() => {
      const { chart } = window.__cm;
      const scatter = chart.open('TNF-alpha', 'IL-10');
      return {
        returned: scatter === chart.scatter(),
        isScatter: typeof scatter.view === 'function' && typeof scatter.brush === 'function',
        view: scatter.view(),
        hidden: chart.root.classList.contains('sv-hidden')
      };
    });
    expect(opened).toMatchObject({
      returned: true,
      isScatter: true,
      hidden: true,
      view: { x: TNF, y: IL10 }
    });
    await expect(drill(page)).toHaveCount(1);
    // Opening another pair replaces the scatter; it does not stack them.
    await page.evaluate(() => {
      window.__cm.chart.open('IL-6', 'CRP');
    });
    await expect(drill(page)).toHaveCount(1);
    expect(await view(page)).toMatchObject({ x: { measure: 'IL-6' }, y: { measure: 'CRP' } });
    const closed = await page.evaluate(() => {
      const { chart } = window.__cm;
      return [chart.close() === chart, chart.scatter(), chart.close() === chart];
    });
    expect(closed).toEqual([true, null, true]);
    await expect(root(page)).toBeVisible();
    await expect(drill(page)).toHaveCount(0);

    // A label the grid does not have, or the same one twice, is refused, with what it has.
    const refusals = await page.evaluate(() =>
      [
        ['IL-17', 'IL-10'],
        ['IL-10', 'IL-10'],
        ['Week 4', 'Week 8']
      ].map(([x, y]) => {
        try {
          window.__cm.chart.open(x, y);
          return 'opened';
        } catch (error) {
          return [error instanceof TypeError, error.message];
        }
      })
    );
    for (const refusal of refusals) {
      expect(refusal).toEqual([
        true,
        'bio.viz: open() takes two different variables of the grid, each by its label: ' +
          `${BIOMARKERS.join(', ')}.`
      ]);
    }
    await expect(drill(page)).toHaveCount(0);
    // Across visits the labels are the visits.
    await choose(page, 'mode', 'visits');
    await page.evaluate(() => {
      window.__cm.chart.open('Week 4', 'Week 8');
    });
    expect(await view(page)).toMatchObject({
      x: { measure: 'CRP', value: 'raw', visit: 'Week 4' },
      y: { measure: 'CRP', value: 'raw', visit: 'Week 8' }
    });
    // Drawing the grid again closes it: by render, by a setting, by new tables.
    for (const redraw of [
      () => window.__cm.chart.render(),
      () => {
        window.__cm.chart.setSettings({ method: 'spearman' });
      },
      () => {
        window.__cm.chart.setData(window.__cm.data);
      }
    ]) {
      await page.evaluate(() => {
        window.__cm.chart.open('Week 4', 'Week 8');
      });
      await expect(drill(page)).toHaveCount(1);
      await page.evaluate(redraw);
      await expect(drill(page)).toHaveCount(0);
      await expect(root(page)).toBeVisible();
      expect(await page.evaluate(() => window.__cm.chart.scatter())).toBe(null);
    }
  });
});

test.describe('correlation matrix: lifecycle', () => {
  test('CM-LIFE-001: init, setData, setSettings, render, resize and destroy drive the chart as they drive a safety.viz chart; setSettings moves the control of a setting, and destroy takes down the grid and a scatter a cell had opened (#27)', async ({
    page
  }) => {
    const errors = watch(page);
    await open(page);
    // Chaining: each returns the chart.
    const chained = await page.evaluate(() => {
      const { chart, data } = window.__cm;
      return [
        chart.init(data) === chart,
        chart.setData(data) === chart,
        chart.setSettings({}) === chart,
        chart.close() === chart
      ];
    });
    expect(chained).toEqual([true, true, true, true]);

    // A setting that says what the chart opens on moves its control.
    await page.evaluate(() => {
      window.__cm.chart.setSettings({
        mode: 'visits',
        measure: 'IL-6',
        visits: ['Week 4', 'Week 8', 'Week 12'],
        value_type: 'percent_change',
        method: 'spearman',
        min_pairs: 20
      });
    });
    expect(await controls(page)).toMatchObject({
      mode: 'visits',
      measure: 'IL-6',
      visits: '3 of 5',
      'value-type': 'percent_change',
      method: 'spearman',
      'min-pairs': '20'
    });
    let shown = await grid(page);
    expect(shown.title).toBe('IL-6: percent change from baseline, visit against visit (%)');
    expect(shown.columns).toEqual(['Week 4', 'Week 8', 'Week 12']);
    // A setting that is not a view leaves the view where the reader put it.
    await choose(page, 'measure', 'CRP');
    await page.evaluate(() => {
      window.__cm.chart.setSettings({ limit: 2 });
    });
    expect((await controls(page)).measure).toBe('CRP');
    shown = await grid(page);
    expect(shown.columns).toEqual(['Week 4', 'Week 8']);
    await expect(notes(page).first()).toHaveText(/^2 of 3 visits shown: /);
    // A visit or a biomarker the tables do not have gives way to the first, and says so.
    const warnings = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    await page.evaluate(() => {
      window.__cm.chart.setSettings({ mode: 'biomarkers', visit: 'Week 99', limit: 12 });
    });
    expect((await controls(page)).visit).toBe('Baseline');
    expect(warnings.join('\n')).toContain(
      'The initial visit [Week 99] does not exist. Defaulting to the first.'
    );

    // New tables: the controls are rebuilt, and return to what the settings open on.
    await page.evaluate(() => {
      const { chart, data } = window.__cm;
      chart.setSettings({ visit: null, value_type: 'raw', method: 'pearson', min_pairs: null });
      chart.setData({
        results: data.results.filter((row) => ['IL-6', 'IL-10', 'CRP'].includes(row.TEST))
      });
    });
    shown = await grid(page);
    expect(shown.columns).toEqual(['CRP', 'IL-6', 'IL-10']);
    await expect(page.locator('[data-control="biomarkers"] summary')).toHaveText('All (3)');
    // The results table alone: no filters.
    await expect(page.locator('#chart select[data-filter]')).toHaveCount(0);

    // render, resize, and an empty table.
    const sized = await page.evaluate(() => {
      const { chart } = window.__cm;
      chart.render();
      const before = chart.grid.style.getPropertyValue('--bv-cell');
      document.querySelector('#chart').style.width = '520px';
      chart.resize();
      const after = chart.grid.style.getPropertyValue('--bv-cell');
      document.querySelector('#chart').style.width = '';
      chart.resize();
      return [before, after, chart.grid.style.getPropertyValue('--bv-cell')];
    });
    expect(sized[0]).toBe('72px');
    expect(parseInt(sized[1])).toBeLessThan(72);
    expect(sized[2]).toBe('72px');
    await page.evaluate(() => {
      window.__cm.chart.setData({ results: [] });
    });
    await expect(footnote(page)).toHaveText('No results to draw.');
    expect(await grid(page)).toBe(null);

    // destroy: the grid, and a scatter a cell had opened.
    await page.evaluate(() => {
      const { chart, data } = window.__cm;
      chart.setData(data);
      chart.open('IL-6', 'IL-10');
    });
    await expect(drill(page)).toHaveCount(1);
    await page.evaluate(() => window.__cm.chart.destroy());
    await expect(page.locator('#chart')).toBeEmpty();
    // Nothing of the chart answers the window any more.
    await page.setViewportSize({ width: 900, height: 700 });
    expect(errors).toEqual([]);
  });

  test('CM-LIFE-002: tables the chart cannot read are refused with a message, shown in its place (#27)', async ({
    page
  }) => {
    await open(page);
    const messages = await page.evaluate(() => {
      const tried = [];
      for (const data of [{ results: 'none' }, { results: [{ SUBJECT: 'A' }] }]) {
        const chart = window.BioViz.correlationMatrix('#chart', {});
        try {
          chart.setData(data);
          tried.push('drawn');
        } catch (error) {
          tried.push([
            error instanceof TypeError,
            error.message,
            document.querySelector('#chart .sv-warning').textContent
          ]);
        }
      }
      return tried;
    });
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

test.describe('correlation matrix: on a phone', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });

  // Nothing of the chart reaches past the right edge of the screen.
  const overflowing = (page, within = '#chart') =>
    page.evaluate(
      (selector) =>
        [...document.querySelectorAll(`${selector} *`)]
          .filter((element) => !element.closest('.bv-matrix-scroll'))
          .filter((element) => element.getBoundingClientRect().right > 390.5)
          .map((element) => element.className || element.tagName.toLowerCase()),
      within
    );

  test('CM-MOBILE-001: at 390px the chart fills the width with its controls folded away; twelve variables fit with marks on both sides of the diagonal and the numbers in the list beneath, and six keep their numbers (#27)', async ({
    page
  }) => {
    await open(page);
    await withStored(page, stored('biomarkers-baseline', 'six-biomarkers'));
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expect(await layout(page)).toEqual(HOLDS);
    // The controls start folded away, one tap from open.
    await expect(root(page)).toHaveClass(/sv-collapsed/);
    await expect(root(page).locator('.sv-controls')).toBeHidden();
    const shown = await grid(page);
    expect(shown.columns).toEqual(BIOMARKERS);
    // Too narrow for a number: a mark on both sides of the diagonal, each R's.
    expect(shown.compact).toBe(true);
    const { value } = resultOf('biomarkers-baseline');
    expectGrid(shown, value, { compact: true });
    expect(shown.cells.every((cell) => cell.mark && cell.number === null)).toBe(true);
    // The planted pair is the one large mark, on either side.
    expect(cellOf(shown, 10, 8).mark).toEqual(cellOf(shown, 8, 10).mark);
    expect(cellOf(shown, 8, 10).mark.size).toBe('64%');
    // The whole grid is on the screen: nothing to scroll, inside it or out.
    const fits = await root(page)
      .locator('.bv-matrix-scroll')
      .evaluate((scroll) => {
        const found = scroll.querySelector('.bv-matrix-grid');
        const cell = found.querySelector('.bv-cell').getBoundingClientRect();
        return {
          scrolls: scroll.scrollWidth > scroll.clientWidth + 1,
          right: found.getBoundingClientRect().right,
          cell: [cell.width, cell.height],
          labels: [...found.querySelectorAll('.bv-row-head')].every(
            (head) => head.scrollWidth <= head.clientWidth + 1
          )
        };
      });
    expect(fits.scrolls).toBe(false);
    expect(fits.right).toBeLessThanOrEqual(390);
    expect(fits.cell[0]).toBeGreaterThanOrEqual(18);
    expect(fits.cell[0]).toBeLessThan(34);
    expect(fits.cell[0]).toBe(fits.cell[1]);
    // Every variable's name is whole.
    expect(fits.labels).toBe(true);
    // The numbers, the intervals and the counts are in the list beneath.
    const rows = await listed(page);
    expect(rows).toHaveLength(66);
    expect(rows[61]).toEqual(['IL-10 and TNF-alpha', '200', '0.6384 (0.5482 to 0.7139)']);
    await expect(root(page).locator('.bv-key p')).toContainText(
      'both sides are marks and the numbers are in the list beneath'
    );
    expect(await overflowing(page)).toEqual([]);
    expect(await layout(page)).toEqual(HOLDS);
    await captureEvidence(
      root(page).locator('.bv-matrix'),
      'CM-MOBILE-001',
      'twelve-variables-on-a-phone'
    );
    // A pair in the list is a target a finger can find: taller than its cell is.
    const target = await pairs(page).locator('.bv-pair').first().boundingBox();
    const row = await pairs(page).locator('tbody tr').first().boundingBox();
    expect(row.height).toBeGreaterThanOrEqual(24);
    expect(target.width).toBeGreaterThan(60);

    // The controls open with a tap, and the page still holds.
    await root(page).locator('.sv-sidebar-toggle').tap();
    await expect(root(page).locator('.sv-controls')).toBeVisible();
    expect(await layout(page)).toEqual(HOLDS);
    // Six variables: the cells are wide enough for their numbers.
    const six = ['CRP', 'IFN-gamma', 'IL-2', 'IL-6', 'IL-10', 'TNF-alpha'];
    await tick(
      page,
      'biomarkers',
      BIOMARKERS.filter((name) => !six.includes(name)),
      false
    );
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    const fewer = await grid(page);
    expect(fewer.compact).toBe(false);
    expectGrid(fewer, resultOf('six-biomarkers').value);
    expect(fewer.cells.filter((cell) => cell.number)).toHaveLength(15);
    // And for the small scatters.
    await choose(page, 'view', 'scatters');
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    expect((await grid(page)).cells.filter((cell) => cell.scatter)).toHaveLength(15);
    expect(await layout(page)).toEqual(HOLDS);
    expect(await overflowing(page)).toEqual([]);
  });

  test('CM-MOBILE-002: at 390px a tap on a cell, or on a pair in the list, opens the scatter and its button returns; a grid of more variables than fit scrolls inside its own box; the page never scrolls sideways (#27)', async ({
    page
  }) => {
    await open(page);
    await withStored(page, [...stored('biomarkers-baseline'), ...scatterStored('pearson')]);
    await expect(line(page)).toHaveAttribute('data-state', 'shown');
    // A tap on a cell.
    await cellAt(page, 8, 10).scrollIntoViewIfNeeded();
    await cellAt(page, 8, 10).tap();
    await expect(drill(page).locator('.bv-back')).toBeVisible();
    await expect(scatterLine(page).locator('.bv-stat-estimate')).toHaveText(
      'Pearson’s r: 0.6384, 95% confidence interval 0.5482 to 0.7139.'
    );
    expect(await layout(page)).toEqual(HOLDS);
    expect(await overflowing(page)).toEqual([]);
    // The way back is a target a finger can find, at the top of the scatter.
    const back = await drill(page).locator('.bv-back').boundingBox();
    expect(back.height).toBeGreaterThanOrEqual(24);
    await captureEvidence(page.locator('#chart'), 'CM-MOBILE-002', 'a-pair-opened-on-a-phone');
    await drill(page).locator('.bv-back').tap();
    await expect(drill(page)).toHaveCount(0);
    await expect(root(page)).toBeVisible();
    expectGrid(await grid(page), resultOf('biomarkers-baseline').value, { compact: true });
    // A tap on a pair in the list.
    const name = pairs(page).getByRole('button', { name: 'IL-10 and TNF-alpha: open the scatter' });
    await name.scrollIntoViewIfNeeded();
    await name.tap();
    await expect(drill(page).locator('.bv-back')).toBeVisible();
    expect(
      await page.evaluate(() => {
        const { x, y } = window.__cm.chart.scatter().view();
        return [x.measure, y.measure];
      })
    ).toEqual(['IL-10', 'TNF-alpha']);
    expect(await layout(page)).toEqual(HOLDS);
    await drill(page).locator('.bv-back').tap();
    await expect(root(page)).toBeVisible();

    // More variables than fit at the narrowest cell: the grid scrolls inside
    // its own box, and the page does not.
    await open(page, { data: 'many-biomarkers', settings: { limit: 36 } });
    const box = await root(page)
      .locator('.bv-matrix-scroll')
      .evaluate((scroll) => ({
        scrolls: scroll.scrollWidth > scroll.clientWidth + 1,
        within: scroll.getBoundingClientRect().right <= 390,
        overflow: getComputedStyle(scroll).overflowX,
        cell: scroll.querySelector('.bv-cell').getBoundingClientRect().width,
        cells: scroll.querySelectorAll('.bv-cell').length
      }));
    expect(box).toEqual({ scrolls: true, within: true, overflow: 'auto', cell: 18, cells: 1260 });
    expect(await layout(page)).toEqual(HOLDS);
    expect(await overflowing(page)).toEqual([]);
    // On this page fourteen are the fewest that do not fit; thirteen and the
    // default limit, twelve, fit, long names and all.
    await open(page, { data: 'many-biomarkers', settings: { limit: 14 } });
    expect(
      await root(page)
        .locator('.bv-matrix-scroll')
        .evaluate((scroll) => scroll.scrollWidth > scroll.clientWidth + 1)
    ).toBe(true);
    for (const limit of [13, 12]) {
      await open(page, { data: 'many-biomarkers', settings: { limit } });
      expect(
        await root(page)
          .locator('.bv-matrix-scroll')
          .evaluate((scroll) => scroll.scrollWidth > scroll.clientWidth + 1),
        String(limit)
      ).toBe(false);
    }
    await expect(notes(page).first()).toHaveText(/^12 of 36 biomarkers shown: /);
    expect(await layout(page)).toEqual(HOLDS);
    // A name too long for its column is cut short inside the grid, never
    // pushed out of it, and is whole in its title.
    const heads = await root(page)
      .locator('.bv-matrix-grid')
      .evaluate((found) => {
        const box = found.getBoundingClientRect();
        return [...found.querySelectorAll('.bv-row-head')].map((head) => ({
          label: head.textContent,
          title: head.title,
          inside: head.getBoundingClientRect().left >= box.left - 0.5,
          cut: head.scrollWidth > head.clientWidth
        }));
      });
    expect(heads.every((head) => head.inside && head.title === head.label)).toBe(true);
    expect(heads.filter((head) => head.cut).map((head) => head.label)).toEqual([
      'IFN-gamma B',
      'IFN-gamma C'
    ]);
  });
});

test.describe('correlation matrix: on the site', () => {
  test('CM-FILTER-001: on the demo, filters with nobody in common leave the chart saying, in words, that no participant passes the filters; no grid is drawn, R is asked nothing, the controls stay usable, and loosening a filter draws again (#29)', async ({
    page
  }) => {
    const errors = await openDemo(page, 'correlation-matrix', 'correlationMatrix');
    const cells = () =>
      document.querySelector('#chart .bv-matrix').hidden
        ? 0
        : document.querySelectorAll('#chart .bv-matrix-grid .bv-cell').length;
    await expect.poll(() => asked(page)).toBeGreaterThan(0);
    const before = await letNobodyThrough(page);
    await expectNobody(page, errors, { drawn: cells });
    expect(await asked(page)).toBe(before);
    await expect(page.locator('#chart .bv-pairs')).toHaveCount(0);
    await page.locator('#chart select[data-filter="RESPONSE"]').selectOption('__all__');
    await expect(page.locator('#chart .sv-notes')).toContainText(
      '4 of 4 participants in the frame.'
    );
    expect(await page.evaluate(cells)).toBe(132);
    await expect.poll(() => asked(page)).toBeGreaterThan(before);
    await expect(page.locator('#chart .sv-footnote')).not.toHaveText(NOBODY_PASSES);
  });

  test('CM-SITE-001: the gallery lists the chart, with links to its live demo, its evidence page and its API reference (#27)', async ({
    page
  }) => {
    const errors = watch(page);
    await blockR(page);
    await page.goto('/_site/gallery/index.html');
    const card = page.locator('#charts [data-module="correlation-matrix"]');
    await expect(card.locator('h3')).toHaveText('Correlation matrix');
    await expect(card).toContainText(
      'Which of these biomarkers, or which visits of one biomarker, are related?'
    );
    await expect(card).toContainText('It prints no p-value.');
    // Every chart is listed, in the order they were built.
    await expect(page.locator('#charts [data-module]')).toHaveCount(4);
    expect(
      await page
        .locator('#charts [data-module]')
        .evaluateAll((cards) => cards.map((found) => found.dataset.module))
    ).toEqual([
      'group-comparison',
      'association-scatter',
      'correlation-matrix',
      'biomarker-screen'
    ]);

    await card.getByRole('link', { name: 'Evidence' }).click();
    await expect(page).toHaveURL(/\/_site\/correlation-matrix\/evidence\.html$/);
    await expect(page.locator('.page-tabs a')).toHaveText([
      'Gallery',
      'Live demo',
      'Evidence',
      'API reference'
    ]);
    await page.locator('.page-tabs').getByRole('link', { name: 'API reference' }).click();
    await expect(page.locator('h1')).toHaveText('The correlation matrix');
    await expect(
      page.locator('.api-body h2 code').filter({ hasText: /^correlationMatrix\(/ })
    ).toHaveCount(1);
    await page.locator('.page-tabs').getByRole('link', { name: 'Gallery' }).click();
    await card.getByRole('link', { name: 'Live demo' }).click();
    await expect(page).toHaveURL(/\/_site\/correlation-matrix\/index\.html$/);
    await expect(page.locator('h1')).toHaveText('Correlation matrix');
    expect(
      errors.filter((message) => !/webr|r-wasm|Failed to load resource/.test(message))
    ).toEqual([]);
  });

  test('CM-SITE-002: the live demo draws the chart on the synthetic study, opening on its twelve biomarkers at Baseline, with R attached; where R cannot be reached it still draws the grid’s frame, and says so (#27)', async ({
    page
  }) => {
    // R's hosts are kept out of reach: this test stays on this machine. The
    // tests named CM-LIVE run the same page against real R.
    await blockR(page);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const scripts = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith('.js')) scripts.push(url.pathname.replace('/_site/', ''));
    });
    await page.goto('/_site/correlation-matrix/index.html');
    await page.evaluate(() => window.BioVizDemo.ready);
    await expect(page.locator('h1')).toHaveText('Correlation matrix');
    // safety.viz first, then bio.viz, then the demo's own two scripts.
    expect(scripts.map((file) => file.replace(/bio\.viz-[\d.]+/, 'bio.viz-x'))).toEqual([
      'vendor/safety.viz/safety.viz.js',
      'dist/bio.viz-x/bio.viz.js',
      'demo/synthetic-study.js',
      'demo/correlation-matrix.js'
    ]);
    const demoRoot = page.locator('#chart > .bv-correlation-matrix');
    const shown = await grid(page);
    expect(shown.title).toBe('Result at Baseline, biomarker against biomarker');
    expect(shown.columns).toEqual(BIOMARKERS);
    expect(shown.cells).toHaveLength(132);
    expect(await controls(page)).toMatchObject({
      mode: 'biomarkers',
      visit: 'Baseline',
      biomarkers: 'All (12)',
      'value-type': 'raw',
      view: 'grid',
      method: 'pearson',
      'min-pairs': ''
    });
    await expect(notes(page)).toHaveText([
      'All 12 biomarkers chosen are shown.',
      '200 of 200 participants in the frame.'
    ]);
    // The frame is drawn, and the line under it says that R could not be
    // started rather than nothing at all; no cell holds a coefficient.
    await expect(line(page)).toHaveAttribute('data-state', 'unavailable');
    await expect(line(page)).toHaveText(
      'Statistics are unavailable: R could not be started (Failed to fetch dynamically imported module: https://webr.r-wasm.org/v0.6.0/webr.mjs).'
    );
    expect(shown.cells.every((cell) => cell.status === 'empty' && !cell.number && !cell.mark)).toBe(
      true
    );
    await expect(pairs(page)).toHaveCount(0);
    // The demo names its filters.
    await expect(demoRoot.locator('.sv-control-section').last().locator('label')).toHaveText([
      'Arm',
      'Sex',
      'Response'
    ]);
    // The page says what it is for, and where the R it runs comes from.
    await expect(page.locator('#about-demo')).toContainText(
      'One pair was planted with a correlation, TNF-alpha with IL-10, true Pearson coefficient 0.6'
    );
    await expect(page.locator('#about-demo')).toContainText(
      'The grid prints no p-value, by design'
    );
    await expect(page.locator('#demo-statistics')).toContainText(
      `copied from gsm.bio at commit ${statisticsRecord.commit.slice(0, 7)}`
    );
    const file = await page.request.get('/_site/vendor/gsm.bio/statistics.R');
    expect(file.ok()).toBe(true);
    expect((await file.body()).length).toBe(statisticsRecord.files[0].bytes);
    expect((await file.text()).includes('Analyze_CorrelationMatrix <- function(')).toBe(true);
    // A cell opens the scatter here as on the fixture, with what the demo sets
    // for it: its groups, and a participant's profile from a point.
    await cellAt(page, 8, 10).click();
    await expect(drill(page).locator('.bv-back')).toBeFocused();
    await expect(drill(page).locator('select[data-control="color-by"] option')).toHaveText([
      'None',
      'Arm',
      'Sex',
      'Response'
    ]);
    expect(
      await page.evaluate(() => {
        const { x, y } = window.BioVizDemo.chart.scatter().view();
        return [
          x.measure,
          y.measure,
          window.BioVizDemo.chart.scatter().charts[0].data.datasets[0].data.length
        ];
      })
    ).toEqual(['TNF-alpha', 'IL-10', 200]);
    await drill(page).locator('.bv-back').click();
    await expect(cellAt(page, 8, 10)).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('CM-SITE-003: the live demo holds at a 390px-wide viewport with no horizontal scroll, with the grid drawn, the controls open and a pair opened in the scatter (#27)', async ({
    browser
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await blockR(page);
    await page.goto('/_site/correlation-matrix/index.html');
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
    const shown = await grid(page);
    expect(shown.columns).toEqual(BIOMARKERS);
    expect(shown.compact).toBe(true);
    const wide = await root(page).locator('.bv-matrix').boundingBox();
    expect(wide.width).toBeGreaterThan(320);
    expect(
      await root(page)
        .locator('.bv-matrix-scroll')
        .evaluate((scroll) => scroll.scrollWidth > scroll.clientWidth + 1)
    ).toBe(false);
    // With the controls open it still holds.
    await root(page).locator('.sv-sidebar-toggle').tap();
    await expect(root(page).locator('.sv-controls')).toBeVisible();
    expect(await measure()).toEqual(holds);
    await root(page).locator('.sv-sidebar-toggle').tap();
    await captureEvidence(page.locator('#demo'), 'CM-SITE-003', 'demo-on-a-phone');
    // And with a pair opened in the scatter.
    await cellAt(page, 10, 8).scrollIntoViewIfNeeded();
    await cellAt(page, 10, 8).tap();
    await expect(drill(page).locator('.bv-back')).toBeVisible();
    await expect(drill(page).locator('canvas').first()).toBeVisible();
    expect(await measure()).toEqual(holds);
    await drill(page).locator('.bv-back').tap();
    await expect(root(page)).toBeVisible();
    expect(await measure()).toEqual(holds);
    await context.close();
  });

  test('CM-SITE-005: the two demos point at each other: the matrix’s page says a cell opens the association scatter, and the scatter’s page points to the matrix as the overview (#27)', async ({
    page
  }) => {
    await blockR(page);
    await page.goto('/_site/correlation-matrix/index.html');
    const toScatter = page.locator('#about-demo a[href="../association-scatter/index.html"]');
    await expect(toScatter).toHaveText('association scatter');
    await expect(
      page
        .locator('#about-demo li')
        .filter({ has: page.locator('a[href="../association-scatter/index.html"]') })
    ).toContainText(
      'Click a cell, or press Enter on it, to open that pair in the association scatter, in place'
    );
    await toScatter.click();
    await expect(page).toHaveURL(/\/_site\/association-scatter\/index\.html$/);
    await expect(page.locator('h1')).toHaveText('Association scatter');
    const toMatrix = page.locator('#about-demo a[href="../correlation-matrix/index.html"]');
    await expect(toMatrix).toHaveText('correlation matrix');
    await expect(
      page
        .locator('#about-demo li')
        .filter({ has: page.locator('a[href="../correlation-matrix/index.html"]') })
    ).toHaveText(
      'The overview of every pair is the correlation matrix: every biomarker against every ' +
        'other at one visit, with R’s coefficient in each cell. A click on a cell there opens ' +
        'that pair here.'
    );
    await toMatrix.click();
    await expect(page).toHaveURL(/\/_site\/correlation-matrix\/index\.html$/);
    await expect(page.locator('h1')).toHaveText('Correlation matrix');
  });
});

// ---------------------------------------------------------------------------
// The gallery's demo, for real (#27). These tests need the network: they open
// the built demo page, which starts webR 0.6.0 from its public host and gives it
// gsm.bio's statistics file, and they hold what R in the browser answers to
// what desktop R answered for the same frames
// (tests/fixtures/matrix-statistics-r.json). If R's host cannot be reached the
// tests fail; nothing here skips, and nothing retries.
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

test.describe('correlation matrix: the demo, with R in the browser, live', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  let context;
  let page;
  const finished = [];
  const sideBySide = [];
  const measured = {};
  const differences = [];
  const isRFile = (url) => isRHost(url) || new URL(url).pathname.endsWith('/statistics.R');
  const chartOf = () => (page.url().includes('/_site/') ? 'demo' : 'fixture');

  // What the chart asked R for the grid drawn, and what R answered.
  const held = () =>
    page.evaluate(() => (window.BioVizDemo.chart || window.__cm.chart).statistics()[0]);
  // The frame the chart handed R, as rows of cells in the frame's own columns.
  const frame = () =>
    page.evaluate(() => {
      const { records } = (window.BioVizDemo.chart || window.__cm.chart).model;
      return records.map((record) => Object.values(record));
    });
  // Waits until the line under the grid is no longer waiting.
  const answered = async () => {
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const found = document.querySelector(
              '#chart > .bv-correlation-matrix .sv-main > .bv-statistic'
            );
            return found ? found.dataset.state : 'empty';
          }),
        { timeout: 200_000 }
      )
      .not.toMatch(/^(waiting|empty)$/);
  };
  // Everything the line under the grid has read since the log was last
  // cleared, as it changed, each with how many cells held something then.
  const lineLog = () =>
    page.evaluate(() =>
      window.__line
        .filter((entry) => entry.state !== 'empty')
        .map(({ state, text, filled }) => [state, text, filled])
    );
  const clearLineLog = () =>
    page.evaluate(() => {
      window.__line = [];
    });
  const setView = (settings) =>
    page.evaluate((given) => {
      window.BioVizDemo.chart.setSettings(given);
    }, settings);
  // The demo's own opening view, stated here: every biomarker at Baseline, as
  // its result, Pearson, R's own minimum, no filter.
  const OPENING = {
    mode: 'biomarkers',
    visit: 'Baseline',
    biomarkers: null,
    value_type: 'raw',
    view: 'grid',
    method: 'pearson',
    min_pairs: null
  };
  const reopen = async () => {
    await page.evaluate((opening) => {
      const { chart, correlationMatrix } = window.BioVizDemo;
      chart.setSettings({ ...opening, filters: correlationMatrix.settings.filters });
    }, OPENING);
    await answered();
  };

  // The frame desktop R ran on, from the committed file: a gap is null.
  const fixtureFrame = (file) =>
    readFileSync(new URL(`../fixtures/matrix-statistics/${file}`, import.meta.url), 'utf8')
      .trimEnd()
      .split('\n')
      .slice(1)
      .map((row) =>
        row
          .split(',')
          .map((cell, index) => (index === 0 ? cell : cell === '' ? null : Number(cell)))
      );

  // Holds one grid from R in the browser to desktop R's for the same case: the
  // chart asked with the key desktop R wrote, on the frame desktop R read, and
  // every member of the answer is the same: every cell's coefficient, interval
  // and pair count. Then holds the page to the answer: every cell drawn is
  // that answer's. Returns the members that differ, for a case where R's own
  // answer differs between its versions.
  async function holdToDesktop(name, testInfo, { compact = false } = {}) {
    const expected = resultOf(name);
    await answered();
    const answer = await held();
    expect(answer, `${name}: nothing was asked`).toBeTruthy();
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
    expect(await frame()).toEqual(fixtureFrame(expected.file));

    const actual = answer.answer.value;
    const compared = compareValues(expected.value, actual);
    const differing = compared.filter((row) => !row.ok);
    const numbers = compared.filter((row) => row.difference !== null);
    // Every cell, by name: its coefficient, its interval and its pair count.
    expect(actual.rows).toHaveLength(expected.value.rows.length);
    expected.value.rows.forEach((row, index) => {
      const inBrowser = actual.rows[index];
      expect([inBrowser.x, inBrowser.y], `${name} row ${index}`).toEqual([row.x, row.y]);
      expect(inBrowser.counts, `${name} ${row.x} ${row.y}`).toBe(row.counts);
      expect(inBrowser.status).toBe(row.status);
      expect(inBrowser.reason).toBe(row.reason);
      for (const member of ['estimate', 'lower', 'upper', 'level']) {
        if (row[member] === null) {
          expect(inBrowser[member], `${name} ${row.x} ${row.y} ${member}`).toBe(null);
        } else {
          const scale = Math.max(Math.abs(row[member]), Math.abs(inBrowser[member]));
          expect(
            Math.abs(inBrowser[member] - row[member]),
            `${name} ${row.x} ${row.y} ${member}: desktop ${row[member]}, browser ${inBrowser[member]}`
          ).toBeLessThanOrEqual(TOLERANCE.relative * scale);
        }
      }
    });
    // What is on the page is that answer, cell by cell.
    const shown = await grid(page);
    expectGrid(shown, actual, { compact });
    for (const cell of shown.cells) {
      const row = rowOf(actual, cell.row, cell.column);
      expect(cell.says).toContain(
        row.estimate === null ? `Counts: n = ${row.counts}.` : `(n = ${row.counts}).`
      );
    }

    sideBySide.push({
      case: name,
      method: expected.value.method,
      pairs: expected.value.rows.length,
      withACoefficient: expected.value.rows.filter((row) => row.estimate !== null).length,
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
    return { expected: expected.value, actual, differing, compared, shown };
  }
  // R's own wording of a warning changed between the desktop's version and the
  // browser's: the same sentence, with its first letter in another case. Both
  // are recorded, and nothing else may differ.
  function onlyWording(name, differing) {
    const worded = /^(warnings\[\d+\]|rows\[\d+\]\.warning)$/;
    expect(differing.filter((row) => !worded.test(row.path))).toEqual([]);
    for (const row of differing) {
      expect(typeof row.expected).toBe('string');
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
    const profile = mkdtempSync(path.join(tmpdir(), 'bio-viz-correlation-matrix-'));
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 1280, height: 800 }
    });
    // Every state and text the line under the grid takes, with when it took it
    // and how many cells held something at that moment.
    await context.addInitScript(() => {
      window.__line = [];
      new MutationObserver(() => {
        const found = document.querySelector(
          '#chart > .bv-correlation-matrix .sv-main > .bv-statistic'
        );
        if (!found) return;
        const entry = {
          state: found.dataset.state || 'empty',
          text: found.textContent,
          filled: document.querySelectorAll(
            '#chart .bv-matrix-grid .bv-cell:not([data-status="empty"])'
          ).length
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
    await page.goto('/_site/correlation-matrix/index.html');
    await page.evaluate(() => window.BioVizDemo.ready);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('CM-LIVE-001: the demo draws the frame first and starts R when the grid first asks; the line waits, saying what the first start costs, and then every cell’s coefficient, interval and pair count are desktop R’s; the planted cell holds 0.6 inside its interval, and no p-value is printed (#27)', async ({}, testInfo) => {
    expect(chartOf()).toBe('demo');
    // The chart is on the page, on the view the demo opens on.
    expect(await controls(page)).toMatchObject({
      mode: 'biomarkers',
      'value-type': 'raw',
      visit: 'Baseline',
      biomarkers: 'All (12)',
      view: 'grid',
      method: 'pearson',
      'min-pairs': ''
    });
    const { expected, actual, differing, shown } = await holdToDesktop(
      'biomarkers-baseline',
      testInfo
    );
    expect(differing).toEqual([]);
    expect(expected.method).toBe("Pearson's product-moment correlation");
    expect(shown.columns).toEqual(BIOMARKERS);
    expect(actual.rows).toHaveLength(66);

    // What the line read, in order: waiting, with the page's note on the cost
    // of the first start, and then R's answer. While it waited the frame was
    // drawn and no cell held anything.
    const log = await lineLog();
    expect(log[0]).toEqual([
      'waiting',
      'Statistics: waiting for R… The first grid starts R in this browser: about 13 MB to download, once, and a few seconds.',
      0
    ]);
    expect(log.map(([state]) => state)).toEqual(['waiting', 'shown']);
    expect(log[0][1]).not.toMatch(/\d\.\d/);
    await expect(line(page).locator('p')).toHaveText([
      "Pearson's product-moment correlation, pair by pair: 66 pairs of 12 variables, each on the " +
        'participants who have both of its values.',
      NO_P_NOTE,
      SCOPE(200)
    ]);
    // The planted pair's cell: 0.6 is inside the interval the page gives for
    // it, and inside the one R returned to it.
    const planted = cellOf(shown, 8, 10);
    expect(planted.number).toBe('0.64');
    expect(planted.says).toBe(
      'IL-10 and TNF-alpha: Pearson’s r 0.6384, 95% confidence interval 0.5482 to 0.7139 ' +
        '(n = 200). Open the scatter.'
    );
    const [, low, high] = planted.says.match(/confidence interval (\S+) to (\S+) \(/).map(Number);
    expect(low).toBeLessThan(0.6);
    expect(high).toBeGreaterThan(0.6);
    const returned = rowOf(actual, 8, 10);
    expect([returned.x, returned.y]).toEqual(['v9', 'v11']);
    expect(returned.counts).toBe(200);
    expect(returned.lower).toBeLessThan(0.6);
    expect(returned.upper).toBeGreaterThan(0.6);
    // No p-value: none in what R returned, and none on the page.
    expect(actual.p_value).toBe(null);
    expect(actual.rows.some((row) => 'p_value' in row)).toBe(false);
    const everything = await root(page).evaluate((chart) =>
      [
        chart.innerText,
        ...[...chart.querySelectorAll('[aria-label], [title]')].flatMap((element) => [
          element.getAttribute('aria-label') || '',
          element.getAttribute('title') || ''
        ])
      ].join('\n')
    );
    expect(everything).not.toMatch(P_VALUE);
    expect(everything).not.toMatch(/significan|\*/i);
    await expect(pairs(page).locator('tbody tr')).toHaveCount(66);
    expect((await listed(page))[61]).toEqual([
      'IL-10 and TNF-alpha',
      '200',
      '0.6384 (0.5482 to 0.7139)'
    ]);

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

    // The cost of that first start, kept for CM-LIVE-007.
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
    await captureEvidence(page.locator('#demo'), 'CM-LIVE-001', 'r-in-the-browser');
  });

  test('CM-LIVE-002: Spearman’s rho in every cell is the one desktop R gives, with no interval; where R’s own wording differs between the two versions both are recorded and nothing else differs (#27)', async ({}, testInfo) => {
    const before = finished.filter((request) => isRFile(request.url)).length;
    await clearLineLog();
    await choose(page, 'method', 'spearman');
    const { expected, actual, differing } = await holdToDesktop(
      'biomarkers-baseline-spearman',
      testInfo
    );
    // R was not started again: nothing more was fetched for it.
    expect(finished.filter((request) => isRFile(request.url))).toHaveLength(before);
    const log = await lineLog();
    expect(log.map(([state]) => state)).toEqual(['waiting', 'shown']);
    // R has answered once: the wait no longer says what starting it costs.
    expect(log[0]).toEqual(['waiting', WAITING, 0]);
    // Every number agrees. What may differ is R's wording of one warning.
    onlyWording('biomarkers-baseline-spearman', differing);
    expect(actual.method).toBe("Spearman's rank correlation rho");
    for (const row of actual.rows) {
      expect(typeof row.estimate).toBe('number');
      expect([row.lower, row.upper, row.level]).toEqual([null, null, null]);
    }
    // The page prints the warning as the R that answered worded it, and no interval.
    await expect(line(page).locator('.bv-stat-remark[data-kind="warning"]')).toHaveText(
      actual.warnings.map((warning) => `R warned: ${warning}`)
    );
    expect(actual.warnings).toHaveLength(expected.warnings.length);
    await expect(line(page).locator('.bv-stat-remark[data-kind="note"]')).toHaveText([
      NO_P_NOTE,
      "R’s note: cor.test() gives no confidence interval for Spearman's rho, so none is reported."
    ]);
    await expect(pairs(page).locator('thead th')).toHaveText([
      'Pair',
      'Complete pairs',
      'Spearman’s rho'
    ]);
    expect(await said(page)).not.toMatch(/confidence interval -?\d| to -?\d/);
    expect(await said(page)).not.toMatch(P_VALUE);
    await choose(page, 'method', 'pearson');
    await answered();
  });

  test('CM-LIVE-003: across the visits of one biomarker every cell is the one desktop R gives: for the result, for the change from baseline with the baseline visit left out, and for Spearman on another biomarker (#27)', async ({}, testInfo) => {
    await clearLineLog();
    await setView({ mode: 'visits', measure: 'IL-6' });
    const result = await holdToDesktop('visits-il-6', testInfo);
    expect(result.differing).toEqual([]);
    expect(result.shown.title).toBe('IL-6: result, visit against visit (pg/mL)');
    expect(result.shown.columns).toEqual(VISITS);
    expect(result.actual.rows).toHaveLength(10);
    expect((await lineLog()).map(([state, , filled]) => [state, filled])).toEqual([
      ['waiting', 0],
      ['shown', 20]
    ]);

    await choose(page, 'value-type', 'change');
    const changed = await holdToDesktop('visits-il-6-change', testInfo);
    expect(changed.differing).toEqual([]);
    expect(changed.shown.columns).toEqual(VISITS.slice(1));
    expect(changed.actual.rows).toHaveLength(6);
    await expect(notes(page)).toContainText([
      'Baseline visit: Baseline. It is not drawn: there the change from baseline is the same ' +
        'for everyone.'
    ]);

    await setView({ measure: 'TNF-alpha', value_type: 'raw', method: 'spearman' });
    const ranked = await holdToDesktop('visits-tnf-alpha-spearman', testInfo);
    onlyWording('visits-tnf-alpha-spearman', ranked.differing);
    expect(ranked.shown.title).toBe('TNF-alpha: result, visit against visit (pg/mL)');
    expect(ranked.actual.rows.every((row) => row.lower === null)).toBe(true);
  });

  test('CM-LIVE-004: a change shows the waiting state and then the new grid, as desktop R gives it, and never the old one: with a filter, with gaps, with six biomarkers, with a minimum some cells fall under, and where every cell does (#27)', async ({}, testInfo) => {
    await reopen();
    await expect(line(page).locator('.bv-stat-scope')).toHaveText(SCOPE(200));
    await clearLineLog();
    await root(page).locator('select[data-filter="SEX"]').selectOption('F');
    const women = await holdToDesktop('biomarkers-women', testInfo);
    expect(women.differing).toEqual([]);
    await expect(line(page).locator('.bv-stat-scope')).toHaveText(
      `${SCOPE(91)} Filters: Sex is F.`
    );
    // From the moment of the change: waiting, with every cell empty, then the
    // answer for the 91. The grid of the 200 is not on the page at any point after it.
    const log = await lineLog();
    expect(log.map(([state, , filled]) => [state, filled])).toEqual([
      ['waiting', 0],
      ['shown', 132]
    ]);
    expect(log[0][1]).toBe(WAITING);
    for (const [, text] of log) expect(text).not.toContain('200 participants');
    expect(women.shown.cells.every((cell) => cell.says.includes('(n = 91)'))).toBe(true);
    await root(page).locator('select[data-filter="SEX"]').selectOption('__all__');

    // With gaps: participants with no result at Week 4 for some biomarkers.
    await clearLineLog();
    await setView({ visit: 'Week 4', value_type: 'change' });
    const gaps = await holdToDesktop('biomarkers-week-4-change', testInfo);
    expect(gaps.differing).toEqual([]);
    expect(new Set(gaps.actual.rows.map((row) => row.counts)).size).toBeGreaterThan(3);
    await expect(notes(page)).toContainText([
      '187 of 200 participants in the frame.',
      '13 left out: no value for any variable of the grid.'
    ]);
    expect((await lineLog()).map(([state, , filled]) => [state, filled])).toEqual([
      ['waiting', 0],
      ['shown', 132]
    ]);

    // A minimum the reader set, which 51 of the 66 pairs fall under: R declines
    // those, in its own words, and answers the rest.
    await setView({ visit: 'Week 12', value_type: 'raw' });
    await answered();
    await clearLineLog();
    await page.locator('input[data-control="min-pairs"]').fill('183');
    await page.locator('input[data-control="min-pairs"]').press('Enter');
    const some = await holdToDesktop('week-12-minimum-183', testInfo);
    expect(some.differing).toEqual([]);
    const declined = some.shown.cells.filter((cell) => cell.status === 'withheld');
    expect(declined).toHaveLength(102);
    for (const cell of declined) {
      expect(cell).toMatchObject({ dash: true, number: null, mark: null });
      expect(cell.says).toMatch(
        /: Not computed: \d+ complete pairs\. The minimum is 183\. Counts: n = \d+\. Open the scatter\.$/
      );
    }
    expect((await lineLog()).map(([state]) => state)).toEqual(['waiting', 'shown']);
    await page.locator('input[data-control="min-pairs"]').fill('');
    await page.locator('input[data-control="min-pairs"]').press('Enter');

    // Six biomarkers.
    await setView({
      visit: 'Baseline',
      biomarkers: ['CRP', 'IFN-gamma', 'IL-2', 'IL-6', 'IL-10', 'TNF-alpha']
    });
    const six = await holdToDesktop('six-biomarkers', testInfo);
    expect(six.differing).toEqual([]);
    expect(six.actual.rows).toHaveLength(15);

    // Four participants aged 35: no pair has enough complete pairs.
    await page.evaluate(() => {
      const { chart, correlationMatrix } = window.BioVizDemo;
      chart.setSettings({
        biomarkers: null,
        filters: correlationMatrix.settings.filters.concat([{ value_col: 'AGE', label: 'Age' }])
      });
    });
    await answered();
    await clearLineLog();
    await root(page).locator('select[data-filter="AGE"]').selectOption('35');
    const few = await holdToDesktop('age-35', testInfo);
    expect(few.differing).toEqual([]);
    expect(few.actual.status).toBe('too_small');
    await expect(line(page)).toHaveAttribute('data-state', 'withheld');
    await expect(line(page).locator('.bv-stat-result')).toHaveText(
      'Not computed: no pair of columns has 5 complete pairs.'
    );
    expect(few.shown.cells.every((cell) => cell.status === 'withheld' && cell.dash)).toBe(true);
    expect(await said(page)).not.toMatch(/\d\.\d/);
    expect((await lineLog()).map(([state]) => state)).toEqual(['waiting', 'withheld']);
  });

  test('CM-LIVE-005: a cell opens the scatter, which asks the same R, started once, and prints for the pair the coefficient the cell holds; returning shows the grid as it was and asks R nothing (#27)', async () => {
    await reopen();
    // Every question put to R from here on, by either chart: the chart is given
    // a connection that writes each one down and passes it to the demo's own,
    // so the R behind it is the one already started.
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
    const before = {
      grid: await grid(page),
      list: await listed(page),
      line: await line(page).evaluate((element) => [element.dataset.state, element.innerText]),
      held: await held()
    };
    const cell = cellOf(before.grid, 8, 10);
    const rFiles = finished.filter((request) => isRFile(request.url)).length;
    const scatterAnswered = () =>
      expect(scatterLine(page)).toHaveAttribute('data-state', 'shown', { timeout: 200_000 });

    for (const [opens, returns] of [
      [() => cellAt(page, 8, 10).click(), () => drill(page).locator('.bv-back').click()],
      [() => cellAt(page, 8, 10).press('Enter'), () => page.keyboard.press('Enter')]
    ]) {
      await page.evaluate(() => {
        window.__runs = [];
      });
      await opens();
      await expect(drill(page).locator('.bv-back')).toBeFocused();
      await scatterAnswered();
      // The scatter asked R one thing, the pair's coefficient, through the
      // grid's connection; the grid asked nothing.
      expect(await runs()).toEqual(['Analyze_Correlation']);
      const [asked] = await page.evaluate(() => window.BioVizDemo.chart.scatter().statistics());
      expect(asked.answer.form).toBe('browser');
      expect(asked.rows).toBe(200);
      // The same R: nothing more was fetched to answer it.
      expect(finished.filter((request) => isRFile(request.url))).toHaveLength(rFiles);
      // It is the coefficient the cell holds: the same R, on the same 200 pairs.
      const returned = rowOf(before.held.answer.value, 8, 10);
      const [inScatter] = asked.answer.value.estimates;
      expect(inScatter.estimate).toBe(returned.estimate);
      expect([inScatter.lower, inScatter.upper]).toEqual([returned.lower, returned.upper]);
      expect(asked.answer.value.counts).toBe(returned.counts);
      await expect(scatterLine(page).locator('.bv-stat-estimate')).toHaveText(
        'Pearson’s r: 0.6384, 95% confidence interval 0.5482 to 0.7139.'
      );
      expect(cell.says).toContain(
        'Pearson’s r 0.6384, 95% confidence interval 0.5482 to 0.7139 (n = 200)'
      );
      // The scatter prints the p-value the grid does not.
      await expect(scatterLine(page).locator('.bv-stat-result')).toHaveText(
        "Pearson's product-moment correlation: p < 0.001 (n = 200). Exploratory, unadjusted."
      );
      // And it is desktop R's for that pair, held by the association scatter's own fixture.
      const desktop = scatterStatistics.results.find((result) => result.case === 'pearson');
      expect(compareValues(desktop.value, asked.answer.value).filter((row) => !row.ok)).toEqual([]);

      await returns();
      await expect(drill(page)).toHaveCount(0);
      await expect(root(page)).toBeVisible();
      await expect(cellAt(page, 8, 10)).toBeFocused();
      await cellAt(page, 8, 10).blur();
      // The grid as it was, and R asked nothing on the way back.
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
      expect(await runs()).toEqual(['Analyze_Correlation']);
      expect(await grid(page)).toEqual(before.grid);
      expect(await listed(page)).toEqual(before.list);
      expect(
        await line(page).evaluate((element) => [element.dataset.state, element.innerText])
      ).toEqual(before.line);
      expect(await held()).toEqual(before.held);
    }
    // R was started once in all: the page fetched webR's module once.
    expect(
      finished.filter((request) => request.url.endsWith('/webr.mjs')).map((request) => request.url)
    ).toEqual(['https://webr.r-wasm.org/v0.6.0/webr.mjs']);
    await page.evaluate(() => window.BioVizDemo.chart.open('TNF-alpha', 'IL-10') && null);
    await scatterAnswered();
    await captureEvidence(page.locator('#demo'), 'CM-LIVE-005', 'a-cell-opened-with-r');
    await page.evaluate(() => {
      window.BioVizDemo.chart.close();
    });
  });

  test('CM-LIVE-006: on the fixture of thirty-six biomarkers, with real R, grids of twelve, twenty-four and thirty-six variables are each filled from one answer of R’s: 66, 276 and 630 pairs, with marks on both sides where cells are too narrow for numbers and every pair listed with its count (#27)', async () => {
    await page.goto(`${FIXTURE}?data=many-biomarkers&make=no`);
    await page.evaluate(() => window.__cm.ready);
    expect(chartOf()).toBe('fixture');
    await page.evaluate(() => {
      const real = window.BioViz.r.createConnection({
        browser: { sourceUrl: '/site/vendor/gsm.bio/statistics.R', packages: [] }
      });
      // Every question put to R is written down on its way through.
      window.__runs = [];
      const connection = {
        run: (name, request) => {
          window.__runs.push([name, request.args.chrCols.length]);
          return real.run(name, request);
        }
      };
      const chart = window.BioViz.correlationMatrix('#chart', {
        baseline_visits: 'Baseline',
        connection
      });
      window.__cm.chart = chart;
      chart.init(window.__cm.data);
    });
    // The default: twelve of the thirty-six. R is started here, from the
    // browser's cache, so this first wait is not a measure of a grid.
    await answered();
    await expect(notes(page).first()).toHaveText(/^12 of 36 biomarkers shown: /);
    measured.grids = [];
    for (const [limit, pairsDrawn, compact] of [
      [12, 66, false],
      [24, 276, true],
      [36, 630, true]
    ]) {
      await clearLineLog();
      await page.evaluate((given) => {
        window.__runs = [];
        window.__cm.chart.setSettings({ limit: given });
      }, limit);
      await answered();
      await expect(line(page)).toHaveAttribute('data-state', 'shown');
      // One question for the whole grid.
      expect(await page.evaluate(() => window.__runs)).toEqual([
        ['Analyze_CorrelationMatrix', limit]
      ]);
      const answer = await held();
      expect(answer.answer.form).toBe('browser');
      expect(answer.rows).toBe(40);
      const { value } = answer.answer;
      expect(value.rows).toHaveLength(pairsDrawn);
      expect(value.p_value).toBe(null);
      // Every cell is R's coefficient for its pair: a mark on both sides where
      // the cells are too narrow for a number.
      const shown = await grid(page);
      expect(shown.compact).toBe(compact);
      expect(shown.cells).toHaveLength(pairsDrawn * 2);
      expectGrid(shown, value, { compact });
      if (compact) expect(shown.cells.every((cell) => cell.mark && !cell.number)).toBe(true);
      // And every pair is in the list, with its count.
      const rows = await listed(page);
      expect(rows).toHaveLength(pairsDrawn);
      expect(rows.map((row) => Number(row[1]))).toEqual(value.rows.map((row) => row.counts));
      const times = await page.evaluate(() =>
        ['waiting', 'shown'].map((state) => window.__line.find((entry) => entry.state === state).at)
      );
      measured.grids.push({
        variables: limit,
        pairs: pairsDrawn,
        participants: answer.rows,
        seconds: Number(((times[1] - times[0]) / 1000).toFixed(3)),
        cell: await page.evaluate(() =>
          parseInt(document.querySelector('.bv-matrix-grid').style.getPropertyValue('--bv-cell'))
        ),
        numbersInCells: !compact
      });
    }
    await expect(notes(page).first()).toHaveText('All 36 biomarkers chosen are shown.');
    expect(await layout(page)).toEqual({ viewport: 1280, scrollWidth: 1280 });
    // R answers a grid of 630 pairs in seconds, not minutes: a generous bound.
    for (const timing of measured.grids) expect(timing.seconds).toBeLessThan(60);
    await captureEvidence(
      root(page).locator('.bv-matrix'),
      'CM-LIVE-006',
      'thirty-six-biomarkers-with-r'
    );
  });

  test('CM-LIVE-007: the megabytes and seconds of the first grid, and the seconds R takes for a grid of each size once started, are measured, recorded where a reader of the run can find them, and are what the page tells its reader (#27)', async ({
    browser
  }, testInfo) => {
    await page.goto('/_site/correlation-matrix/index.html');
    await page.evaluate(() => window.BioVizDemo.ready);
    // What the page says the first start costs, and the number behind it.
    const told = await page.evaluate(() => window.BioVizDemo.correlationMatrix);
    expect(told.settings.waiting_note).toContain(`about ${told.megabytes} MB`);
    expect(told.browser).toEqual({ sourceUrl: '../vendor/gsm.bio/statistics.R', packages: [] });
    // Nothing was cached, and what came over the network is what the page said.
    expect(measured.cold.megabytes).toBeGreaterThan(5);
    expect(Math.abs(measured.cold.megabytes - told.megabytes)).toBeLessThan(1.5);
    expect(measured.cold.seconds).toBeGreaterThan(0);
    expect(measured.grids.map((timing) => timing.pairs)).toEqual([66, 276, 630]);

    const record = {
      recorded: new Date().toISOString(),
      browser: `Chromium ${browser.version()}, headless`,
      machine:
        process.env.R_CHECK_MACHINE ||
        (process.env.CI ? 'a GitHub Actions runner (ubuntu-latest)' : 'not named'),
      profile: 'a new, empty browser profile with a disk cache',
      sizes:
        'compressed bytes of response bodies as received over the network; response headers are not counted',
      firstGrid: {
        megabytes: measured.cold.megabytes,
        bytes: measured.cold.bytes,
        requests: measured.cold.requests,
        seconds: measured.cold.seconds,
        secondsAre:
          'from the moment the line first read that it was waiting to the moment the grid was filled from R’s answer: 66 pairs on 200 participants, with R started on the way'
      },
      gridsOnceStarted: {
        on: 'the fixture of thirty-six biomarkers, 40 participants in the frame',
        secondsAre:
          'from the moment the line read that it was waiting to the moment the grid was filled, with R already started',
        timings: measured.grids
      },
      tolerance: `1 part in 10^${Math.round(-Math.log10(TOLERANCE.relative))}`,
      desktopR: statistics.made_by,
      answers: sideBySide,
      differencesBetweenVersions: differences,
      files: measured.cold.files
    };
    const text = JSON.stringify(record, null, 2) + '\n';
    await testInfo.attach('correlation-matrix-measurements.json', {
      body: text,
      contentType: 'application/json'
    });
    mkdirSync(new URL('../../test-results/', import.meta.url), { recursive: true });
    writeFileSync(
      new URL('../../test-results/correlation-matrix-measurements.json', import.meta.url),
      text
    );

    console.log(`\nCorrelation matrix demo, first grid — ${record.browser}, ${record.machine}`);
    console.log(
      `  ${record.firstGrid.megabytes} MB over the network in ${record.firstGrid.requests} ` +
        `requests, ${record.firstGrid.seconds} s from waiting to R's grid`
    );
    for (const file of measured.cold.files) {
      console.log(`  ${String(file.bytes).padStart(9)} bytes  ${file.url}`);
    }
    console.log('\nR in the browser, once started, by the size of the grid');
    for (const timing of measured.grids) {
      console.log(
        `  ${String(timing.variables).padStart(2)} variables, ${String(timing.pairs).padStart(3)} pairs: ` +
          `${timing.seconds} s, cells of ${timing.cell} pixels` +
          `${timing.numbersInCells ? ', numbers shown' : ', marks only'}`
      );
    }
    console.log(
      `\nDesktop R ${statistics.made_by.r_version} beside R in the browser, tolerance ${record.tolerance}`
    );
    for (const entry of sideBySide) {
      console.log(
        `  ${entry.case.padEnd(30)} ${String(entry.pairs).padStart(2)} pairs, ` +
          `${String(entry.withACoefficient).padStart(2)} with a coefficient, ` +
          `${entry.numbersCompared} numbers, greatest relative difference among those that ` +
          `agree ${entry.greatestRelativeDifference.toExponential(2)}, ` +
          `${entry.differing.length} differing`
      );
    }
    for (const difference of differences) {
      console.log(
        `  R's own answer differs between the versions, ${difference.case} ${difference.where}: ` +
          `desktop ${difference.desktop}, browser ${difference.browser}`
      );
    }
    // Every case was compared: both methods in both modes, a filter, gaps, six
    // biomarkers, a minimum some cells fall under, and one every cell does.
    expect(sideBySide.map((entry) => entry.case)).toEqual([
      'biomarkers-baseline',
      'biomarkers-baseline-spearman',
      'visits-il-6',
      'visits-il-6-change',
      'visits-tnf-alpha-spearman',
      'biomarkers-women',
      'biomarkers-week-4-change',
      'week-12-minimum-183',
      'six-biomarkers',
      'age-35'
    ]);
    expect(sideBySide.map((entry) => entry.case).sort()).toEqual(
      statistics.results.map((result) => result.case).sort()
    );
  });

  test('CM-LIVE-008: on a phone the demo fills its grid from R, with marks on both sides of the diagonal, lists every pair with its count and coefficient, and the page does not scroll sideways (#27)', async ({}, testInfo) => {
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
    await expect(root(page)).toHaveClass(/sv-collapsed/);
    // While it waits, with the note on what the first start costs, and after.
    expect((await lineLog())[0][0]).toBe('waiting');
    expect(await measure()).toEqual(holds);
    const { differing, shown } = await holdToDesktop('biomarkers-baseline', testInfo, {
      compact: true
    });
    expect(differing).toEqual([]);
    expect(shown.compact).toBe(true);
    expect(shown.cells.every((cell) => cell.mark && !cell.number)).toBe(true);
    expect(cellOf(shown, 8, 10).mark.size).toBe('64%');
    const rows = await listed(page);
    expect(rows).toHaveLength(66);
    expect(rows[61]).toEqual(['IL-10 and TNF-alpha', '200', '0.6384 (0.5482 to 0.7139)']);
    expect(await measure()).toEqual(holds);
    const overflowing = await page.evaluate(() =>
      [...document.querySelectorAll('#demo *')]
        .filter((element) => element.getBoundingClientRect().right > 390.5)
        .map((element) => element.className || element.tagName.toLowerCase())
    );
    expect(overflowing).toEqual([]);
    await captureEvidence(page.locator('#demo'), 'CM-LIVE-008', 'r-in-the-browser-on-a-phone');
  });
});
