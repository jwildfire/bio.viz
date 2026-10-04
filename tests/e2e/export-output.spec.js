import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import Ajv2020 from 'ajv/dist/2020.js';
import { FIXED_DATE, captureEvidence, fixClock } from './evidence.js';
import { parseCsv, statisticsTable } from '../../src/shared/csv.js';
import { readPng } from '../../src/shared/png.js';
import { pixelsOf } from './pngPixels.js';

// Getting results out (#66): every chart's title, subtitle and footnotes in a
// real page, filled from the view drawn, with the footnote the chart writes
// last. Each chart is drawn on the synthetic study from desktop R's stored
// answer for its view, so no R runs and no network is reached.

const readJson = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const pkg = readJson('../../package.json');
const config = readJson('../../site/config.json');
const gsmBio = readJson('../../site/vendor/gsm.bio/SOURCE.json');
const keyed = ({ name, args, dataId, rows, value }) => ({ name, args, dataId, rows, value });
const from = (file, list, name) => {
  const fixture = readJson(`../fixtures/${file}`);
  const found = fixture[list].find((entry) => entry.case === name);
  return { stored: keyed(found), madeBy: fixture.made_by };
};
const R_HOSTS = /^https:\/\/(webr|repo)\.r-wasm\.org\//;
const blockR = (page) => page.route(R_HOSTS, (route) => route.abort());
// The clock is fixed in every test here (fixClock), so the date drawn is known.
const today = () => FIXED_DATE.toISOString().slice(0, 10);
// The version as the chart's own footnote says it: never a release for code
// that holds changes since it.
const versionSaid =
  pkg.bioviz && pkg.bioviz.development ? `${pkg.version} with development changes` : pkg.version;
const ADJUSTED = { BH: 'Benjamini-Hochberg', holm: 'Holm', bonferroni: 'Bonferroni' };
// Every method R named, the answer's own first, and every adjustment, as the
// footnote says them, read off R's answer here.
const methodsSaid = (value) => {
  const methods = [];
  const adjustments = [];
  const take = (entry) => {
    if (entry && typeof entry.method === 'string' && !methods.includes(entry.method))
      methods.push(entry.method);
    if (entry && entry.adjustment && entry.adjustment !== 'none') {
      const said = ADJUSTED[entry.adjustment] || entry.adjustment;
      if (!adjustments.includes(said)) adjustments.push(said);
    }
  };
  take(value);
  Object.values(value).forEach(
    (list) =>
      Array.isArray(list) &&
      list.forEach((entry) => entry && typeof entry === 'object' && take(entry))
  );
  const [first, ...rest] = methods;
  return {
    method: rest.length ? `${first}, with ${rest.join(' and ')}` : first,
    adjusted: adjustments.length ? `, p-values adjusted by ${adjustments.join(' and ')}` : ''
  };
};

test.beforeEach(async ({ page }) => {
  await fixClock(page);
});

function watch(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

// R's counts as the footnote writes them, from R's own answer.
const countsSaid = (counts, of) => {
  if (typeof counts === 'number') return `n = ${counts}`;
  const entries = Object.entries(counts);
  if (entries.length <= 4) return entries.map(([group, n]) => `${group} n = ${n}`).join(', ');
  const all = entries.map(([, n]) => n);
  const [least, most] = [Math.min(...all), Math.max(...all)];
  return `${least === most ? `n = ${least}` : `n = ${least} to ${most}`} across ${entries.length} ${of}`;
};
const sum = (counts) =>
  typeof counts === 'number' ? counts : Object.values(counts).reduce((a, b) => a + b, 0);

// Each chart, the view it is drawn on, desktop R's stored answer for that view,
// and what its title and subtitle read once filled.
const CHARTS = [
  {
    module: 'group-comparison',
    comma: {
      settings: { groups: [{ value_col: 'ARM', label: 'Arm, randomised' }] },
      heading: 'Arm, randomised'
    },
    id: 'EXP-DRAW-001',
    global: 'gc',
    data: 'arm-sex',
    settings: {
      start_value: 'IL-6',
      visits: 'Week 4',
      value_type: 'change',
      baseline_visits: 'Baseline',
      group_by: 'ARM'
    },
    ...from('group-statistics-r.json', 'results', 'welch'),
    title: '{measure}: {value} at {visits}',
    subtitle: '{n} participants, by {group}',
    reads: (value) => [
      'IL-6: Change from baseline at Week 4',
      `${sum(value.counts)} participants, by ARM`
    ]
  },
  {
    module: 'association-scatter',
    comma: {
      settings: { color_by: 'ARM', groups: [{ value_col: 'ARM', label: 'Arm, randomised' }] },
      heading: 'Arm, randomised'
    },
    id: 'EXP-DRAW-002',
    global: 'as',
    settings: {},
    ...from('association-statistics-r.json', 'results', 'pearson'),
    title: '{y} against {x}',
    subtitle: '{n} participants',
    reads: (value) => [
      'IL-10 at Baseline (pg/mL) against TNF-alpha at Baseline (pg/mL)',
      `${value.counts} participants`
    ]
  },
  {
    module: 'correlation-matrix',
    comma: { rename: { from: 'CRP', to: 'CRP, serum' }, heading: 'CRP, serum' },
    id: 'EXP-DRAW-003',
    global: 'cm',
    settings: {},
    ...from('matrix-statistics-r.json', 'results', 'biomarkers-baseline'),
    title: '{heading}',
    subtitle: '{variables} biomarkers, {n} participants',
    of: 'variables',
    reads: () => [
      'Result at Baseline, biomarker against biomarker',
      '12 biomarkers, 200 participants'
    ]
  },
  {
    module: 'biomarker-screen',
    comma: { rename: { from: 'CRP', to: 'CRP, serum' }, heading: 'CRP, serum' },
    id: 'EXP-DRAW-004',
    global: 'bs',
    settings: { visit: 'Week 4', value_type: 'change', group_by: 'ARM' },
    ...from('screen-statistics-r.json', 'results', 'difference-week-4-change'),
    title: '{heading}',
    subtitle: '{biomarkers} biomarkers, {comparison}',
    of: 'biomarkers',
    reads: () => [
      'Change from baseline at Week 4: Placebo against Treatment, standardised difference',
      '12 biomarkers, Difference between two groups'
    ]
  },
  {
    module: 'cross-tab',
    comma: {
      settings: {
        groups: [
          { value_col: 'ARM', label: 'Arm, randomised' },
          { value_col: 'RESPONSE', label: 'Response' }
        ]
      },
      heading: 'Arm, randomised'
    },
    id: 'EXP-DRAW-005',
    global: 'ct',
    settings: {},
    ...from('cross-tab-r.json', 'cases', 'arm-by-response-chisq'),
    title: '{rows} by {columns}',
    subtitle: '{n} participants',
    reads: (value) => ['ARM by RESPONSE', `${value.counts} participants`]
  },
  {
    module: 'stratified-survival',
    comma: {
      settings: { group_by: 'ARM', groups: [{ value_col: 'ARM', label: 'Arm, randomised' }] },
      heading: 'Arm, randomised'
    },
    id: 'EXP-DRAW-006',
    global: 'ss',
    settings: {},
    ...from('stratified-survival-r.json', 'cases', 'crp-median'),
    title: '{endpoint}, by {group}',
    subtitle: '{n} participants',
    reads: (value) => [
      'Event-free survival (months), by CRP at Baseline, cut at the median',
      `${sum(value.counts)} participants`
    ]
  }
];

// The page's chart, with settings laid over the fixture's, and a connection
// that holds desktop R's answer for the view and which R computed it.
async function openChart(page, chart, settings = {}) {
  await page.addInitScript(
    ({ name, given }) => {
      window[name] = given;
    },
    { name: `__${chart.global}Settings`, given: { ...chart.settings, ...settings } }
  );
  await page.goto(
    `/tests/e2e/fixtures/${chart.module}.html${chart.data ? `?data=${chart.data}` : ''}`
  );
  await page.evaluate((name) => window[name].ready, `__${chart.global}`);
  await page.evaluate(
    ({ name, results, computedBy }) =>
      window[name].chart.setSettings({
        connection: window.BioViz.r.createConnection({ results, computedBy })
      }),
    {
      name: `__${chart.global}`,
      results: [chart.stored],
      computedBy: { r_version: chart.madeBy.r_version, gsm_bio_version: gsmBio.version }
    }
  );
}

// What the chart's frame says above and under what it draws, and where.
const framed = (page, chart) =>
  page.evaluate((name) => {
    const root = window[name].chart.root;
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    };
    const titles = root.querySelector('.bv-titles');
    const foot = root.querySelector('.bv-foot');
    const figure = [...root.querySelectorAll('.sv-chart-wrap, .sv-multiples, .bv-statistic')]
      .filter((element) => element.getBoundingClientRect().height > 0)
      .map(box);
    const title = titles.querySelector('.bv-title');
    return {
      title: title ? title.textContent : null,
      heading: title ? [title.getAttribute('role'), title.getAttribute('aria-level')] : null,
      subtitle: titles.querySelector('.bv-subtitle')
        ? titles.querySelector('.bv-subtitle').textContent
        : null,
      footnotes: [...foot.querySelectorAll('.bv-foot-line')].map((line) => line.textContent),
      automatic: [...foot.querySelectorAll('.bv-foot-line')].map(
        (line) => line.dataset.automatic === 'true'
      ),
      titlesBottom: box(titles).bottom,
      footTop: box(foot).top,
      figureTop: Math.min(...figure.map((entry) => entry.top)),
      figureBottom: Math.max(...figure.map((entry) => entry.bottom)),
      // Nothing but the title, the subtitle, the footnotes and the <bdi> each
      // placeholder's value is set apart in.
      markup:
        titles.querySelectorAll('*:not(.bv-title):not(.bv-subtitle):not(bdi)').length +
        foot.querySelectorAll('*:not(.bv-foot-line):not(bdi)').length
    };
  }, `__${chart.global}`);

const layout = (page) =>
  page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));

test.describe('getting results out: titles and footnotes on every chart', () => {
  for (const chart of CHARTS) {
    test(`${chart.id}: the ${chart.module.replaceAll('-', ' ')} draws its title and subtitle above it and its footnotes under it, filled from the view drawn, with its own footnote last: the date, the bio.viz version, R’s method and counts, and the R and gsm.bio versions of the stored result; it holds at 390px (#66)`, async ({
      page
    }) => {
      const errors = watch(page);
      await blockR(page);
      await openChart(page, chart, {
        title: chart.title,
        subtitle: chart.subtitle,
        footnotes: ['Synthetic study from gsm.bio.', 'Filters: {filters}. Drawn {date}.']
      });
      const value = chart.stored.value;
      const { method, adjusted } = methodsSaid(value);
      const automatic =
        `Drawn on ${today()} by bio.viz ${versionSaid}. Statistics: ${method} ` +
        `(${countsSaid(value.counts, chart.of)})${adjusted}; computed by R ${chart.madeBy.r_version} with ` +
        `gsm.bio ${gsmBio.version}, stored with the page.`;
      await expect.poll(async () => (await framed(page, chart)).footnotes.at(-1)).toBe(automatic);
      const said = await framed(page, chart);
      const [title, subtitle] = chart.reads(value);
      expect(said).toMatchObject({
        title,
        subtitle,
        heading: ['heading', '2'],
        footnotes: ['Synthetic study from gsm.bio.', `Filters: none. Drawn ${today()}.`, automatic],
        automatic: [false, false, true],
        markup: 0
      });
      // Above what it draws, and under it.
      expect(said.titlesBottom).toBeLessThanOrEqual(said.figureTop);
      expect(said.footTop).toBeGreaterThanOrEqual(said.figureBottom);
      await captureEvidence(
        page.locator(`#chart > .sv-root, #chart > .bv-${chart.module}`).first(),
        chart.id,
        'titled-and-footnoted'
      );
      // On a phone the text wraps, and the page does not scroll sideways.
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(() => layout(page)).toEqual({ viewport: 390, scrollWidth: 390 });
      const narrow = await framed(page, chart);
      expect(narrow.title).toBe(title);
      expect(narrow.footnotes.at(-1)).toBe(automatic);
      expect(errors).toEqual([]);
    });
  }

  test('EXP-TXT-003: in the page a title, subtitle or footnote that holds code-like text is drawn as that text: no element is made of it, no script runs, and a placeholder inside it is filled as text (#66)', async ({
    page
  }) => {
    const errors = watch(page);
    await blockR(page);
    const chart = CHARTS.find((entry) => entry.module === 'cross-tab');
    const title = '<script>window.__pwned = 1</script>${window.__pwned = 2}';
    const subtitle = '<img src=x onerror="window.__pwned = 3"> {{n}} {constructor}';
    const footnote = '{{7*7}} `${n}` {n}';
    await openChart(page, chart, { title, subtitle, footnotes: [footnote] });
    const said = await framed(page, chart);
    expect(said.title).toBe(title);
    expect(said.subtitle).toBe('<img src=x onerror="window.__pwned = 3"> {200} {constructor}');
    expect(said.footnotes[0]).toBe('{{7*7}} `$200` 200');
    expect(said.markup).toBe(0);
    expect(await page.evaluate(() => window.__pwned)).toBe(undefined);
    expect(
      await page.evaluate(() => document.querySelectorAll('#chart img, #chart script').length)
    ).toBe(0);
    expect(errors).toEqual([]);
  });

  test('EXP-AUTO-003: the chart’s own footnote says it is waiting while R is asked and is written again when R answers in the browser; with no R it says statistics are unavailable, and a view that asks R nothing says so (#66)', async ({
    page
  }) => {
    const chart = CHARTS.find((entry) => entry.module === 'cross-tab');
    await page.addInitScript(() => {
      window.__r = [];
      window.__engine = {
        start: () => Promise.resolve(),
        call: () => new Promise((resolve) => window.__r.push(resolve))
      };
    });
    await page.goto('/tests/e2e/fixtures/cross-tab.html');
    await page.evaluate(() => window.__ct.ready);
    const last = () =>
      page.evaluate(
        () => [...window.__ct.chart.root.querySelectorAll('.bv-foot-line')].at(-1).textContent
      );
    const drawn = `Drawn on ${today()} by bio.viz ${versionSaid}.`;
    // The fixture's chart has no R attached.
    expect(await last()).toBe(
      `${drawn} Statistics: unavailable, as the line under the chart says.`
    );
    await page.evaluate(() =>
      window.__ct.chart.setSettings({
        connection: window.BioViz.r.createConnection({ browser: { engine: window.__engine } })
      })
    );
    await expect.poll(() => page.evaluate(() => window.__r.length)).toBe(1);
    expect(await last()).toBe(`${drawn} Statistics: waiting for R.`);
    await page.evaluate((value) => window.__r[0](value), chart.stored.value);
    await expect
      .poll(last)
      .toBe(
        `${drawn} Statistics: ${chart.stored.value.method} (n = ${chart.stored.value.counts}); computed by R in this browser.`
      );
    // No test chosen: nothing is asked of R.
    await page.evaluate(() => window.__ct.chart.setSettings({ test: 'none' }));
    expect(await last()).toBe(`${drawn} No statistic was asked of R.`);
  });
});

test.describe('getting results out: the gallery', () => {
  for (const entry of config.modules.filter((module) => module.kind === 'chart')) {
    test(`EXP-SITE-001: the ${entry.title.toLowerCase()} demo shows its title, subtitle and footnotes, every placeholder filled, with the chart’s own footnote last; at 390px the page does not scroll sideways (#66)`, async ({
      page
    }) => {
      await blockR(page);
      await page.goto(`/_site/${entry.module}/index.html`);
      await page.evaluate(() => window.BioVizDemo.ready);
      const said = await page.evaluate(() => {
        const root = window.BioVizDemo.chart.root;
        const text = (selector) => {
          const found = root.querySelector(selector);
          return found ? found.textContent : null;
        };
        return {
          title: text('.bv-titles .bv-title'),
          subtitle: text('.bv-titles .bv-subtitle'),
          footnotes: [...root.querySelectorAll('.bv-foot .bv-foot-line')].map(
            (line) => line.textContent
          )
        };
      });
      expect(said.title, entry.module).toMatch(/\S/);
      expect(said.subtitle, entry.module).toMatch(/\S/);
      expect(said.footnotes.length, entry.module).toBeGreaterThanOrEqual(2);
      for (const text of [said.title, said.subtitle, ...said.footnotes]) {
        expect(text, entry.module).not.toMatch(/\{[A-Za-z_]\w*\}/);
      }
      expect(said.footnotes.at(-1)).toMatch(
        new RegExp(`^Drawn on ${today()} by bio\\.viz ${versionSaid.replace(/\./g, '\\.')}\\. `)
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(() => layout(page)).toEqual({ viewport: 390, scrollWidth: 390 });
    });
  }
});

// A download, as the page saves it: its name and its bytes.
async function downloaded(page, chart, kind) {
  const waiting = page.waitForEvent('download');
  await page.locator(`#chart .bv-downloads button[data-download="${kind}"]`).click();
  const download = await waiting;
  const file = await download.path();
  return { name: download.suggestedFilename(), bytes: readFileSync(file) };
}

const slug = (text) =>
  text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(.{0,60})(?:-.*)?$/, (whole, kept) => (whole.length <= 60 ? whole : kept))
    .replace(/-+$/g, '');

const DOWNLOADS = [
  'EXP-DL-001',
  'EXP-DL-002',
  'EXP-DL-003',
  'EXP-DL-004',
  'EXP-DL-005',
  'EXP-DL-006'
];

test.describe('getting results out: the downloads of every chart', () => {
  CHARTS.forEach((chart, index) => {
    test(`${DOWNLOADS[index]}: the ${chart.module.replaceAll('-', ' ')} downloads a PNG of its frame at twice its size on the page, carrying its title and footnotes; the statistics R returned as CSV, R’s numbers; and the table it drew from as CSV, its rows and columns; a heading with a comma reads back as one heading (#67)`, async ({
      page
    }) => {
      const errors = watch(page);
      await blockR(page);
      await openChart(page, chart, { title: chart.title, subtitle: chart.subtitle });
      const value = chart.stored.value;
      await expect
        .poll(async () => (await framed(page, chart)).footnotes.at(-1))
        .toMatch(/stored with the page\.$/);
      const said = await framed(page, chart);
      const view = await page.evaluate((name) => {
        const shown = window[name].chart;
        return {
          width: Math.ceil(shown.main.getBoundingClientRect().width),
          viewFields: shown.viewFields,
          values: shown.placeholders(),
          table: shown.tableOf(),
          asked: shown.statistics()
        };
      }, `__${chart.global}`);
      const base = `bio.viz-${chart.module}-${slug(
        view.viewFields
          .map((field) => view.values[field])
          .filter((entry) => entry !== '' && entry !== null && entry !== undefined)
          .join(' ')
      )}`;

      // The picture: twice the frame's width, with its title and footnotes in the file.
      const png = await downloaded(page, chart, 'png');
      expect(png.name).toBe(`${base}.png`);
      const read = readPng(new Uint8Array(png.bytes));
      expect(read.width).toBe(view.width * 2);
      expect(read.height).toBeGreaterThan(200);
      expect(read.perMetre).toBe(Math.round((2 * 96) / 0.0254));
      expect(read.text).toEqual({
        Title: `${said.title} — ${said.subtitle}`,
        Description: said.footnotes.join('\n'),
        Software: `bio.viz ${versionSaid}`
      });

      // The statistics: R's answer, laid out, every number R's.
      const statistics = await downloaded(page, chart, 'statistics');
      expect(statistics.name).toBe(`${base}-statistics.csv`);
      const [head, ...records] = parseCsv(statistics.bytes.toString('utf8'));
      const expected = statisticsTable(view.asked);
      expect(head).toEqual(expected.columns.map((column) => column.label));
      expect(records).toHaveLength(expected.rows.length);
      const result = Object.fromEntries(head.map((name, i) => [name, records[0][i]]));
      expect(result.part).toBe('result');
      expect(result.method).toBe(value.method);
      if (typeof value.p_value === 'number') expect(Number(result.p_value)).toBe(value.p_value);
      for (const [list, parts] of Object.entries(value)) {
        if (!Array.isArray(parts) || !parts.some((part) => part && typeof part === 'object'))
          continue;
        parts.forEach((part, at) => {
          const record = records.find(
            (entry) =>
              entry[head.indexOf('part')] === list && entry[head.indexOf('item')] === String(at + 1)
          );
          expect(record, `${list} ${at}`).toBeDefined();
          for (const [member, number] of Object.entries(part)) {
            if (typeof number === 'number')
              expect(Number(record[head.indexOf(member)]), `${list} ${at} ${member}`).toBe(number);
          }
        });
      }

      // The table: the rows and columns the chart drew from.
      const table = await downloaded(page, chart, 'table');
      expect(table.name).toBe(`${base}-table.csv`);
      const [columns, ...rows] = parseCsv(table.bytes.toString('utf8'));
      expect(columns).toEqual(view.table.columns.map((column) => column.label));
      expect(rows).toHaveLength(view.table.rows.length);
      expect(rows.length).toBeGreaterThan(0);
      const text = (cell) =>
        cell === null || cell === undefined
          ? ''
          : typeof cell === 'boolean'
            ? cell
              ? 'TRUE'
              : 'FALSE'
            : String(cell);
      rows.forEach((row, i) =>
        expect(row, `row ${i}`).toEqual(
          view.table.columns.map((column) => text(view.table.rows[i][column.value_col]))
        )
      );

      // A heading that holds a comma is one heading, quoted, and reads back whole.
      if (chart.comma.rename) {
        await page.evaluate(
          ({ name, from, to, measure }) => {
            const shown = window[name];
            shown.chart.setData({
              ...shown.data,
              results: shown.data.results.map((row) =>
                row[measure] === from ? { ...row, [measure]: to } : row
              )
            });
          },
          { name: `__${chart.global}`, ...chart.comma.rename, measure: 'TEST' }
        );
      } else {
        await page.evaluate(({ name, settings }) => window[name].chart.setSettings(settings), {
          name: `__${chart.global}`,
          settings: chart.comma.settings
        });
      }
      const renamed = await downloaded(page, chart, 'table');
      const text2 = renamed.bytes.toString('utf8');
      const [headings] = parseCsv(text2);
      expect(headings).toContain(chart.comma.heading);
      expect(text2.split('\r\n')[0]).toContain(`"${chart.comma.heading}"`);
      expect(errors).toEqual([]);
    });
  });

  test('EXP-DL-007: with `downloads` false the bar is not shown; the statistics download waits for R’s answer; and `png_scale` sets the picture’s size and resolution (#67)', async ({
    page
  }) => {
    await blockR(page);
    const chart = CHARTS.find((entry) => entry.module === 'cross-tab');
    await openChart(page, chart, { png_scale: 3 });
    await expect(page.locator('#chart .bv-downloads')).toBeVisible();
    const width = await page.evaluate(() =>
      Math.ceil(window.__ct.chart.main.getBoundingClientRect().width)
    );
    const png = await downloaded(page, chart, 'png');
    const read = readPng(new Uint8Array(png.bytes));
    expect(read.width).toBe(width * 3);
    expect(read.perMetre).toBe(Math.round((3 * 96) / 0.0254));
    await page.evaluate(() => window.__ct.chart.setSettings({ downloads: false }));
    await expect(page.locator('#chart .bv-downloads')).toBeHidden();
    // No R: nothing R returned to download.
    await page.evaluate(() =>
      window.__ct.chart.setSettings({
        downloads: true,
        connection: window.BioViz.r.createConnection()
      })
    );
    // R said statistics are unavailable: the button is disabled, and says why,
    // not waiting.
    const statistics = page.locator('#chart .bv-downloads button[data-download="statistics"]');
    await expect(statistics).toBeDisabled();
    await expect(statistics).toHaveAttribute('title', 'R returned no statistics for this view.');
    // While R is asked, it waits, and says so.
    await page.evaluate(() =>
      window.__ct.chart.setSettings({
        connection: window.BioViz.r.createConnection({
          browser: { engine: { start: () => Promise.resolve(), call: () => new Promise(() => {}) } }
        })
      })
    );
    await expect(statistics).toBeDisabled();
    await expect(statistics).toHaveAttribute('title', 'Waiting for R’s answer.');
    // A view that asks R nothing offers no statistics.
    await page.evaluate(() => window.__ct.chart.setSettings({ test: 'none' }));
    await expect(
      page.locator('#chart .bv-downloads button[data-download="statistics"]')
    ).toHaveCount(0);
    await expect(page.locator('#chart .bv-downloads button[data-download="table"]')).toBeEnabled();
  });
});

// ---- What the #69 review found -------------------------------------------------------

const UPDATES = [
  'EXP-UPD-001',
  'EXP-UPD-002',
  'EXP-UPD-003',
  'EXP-UPD-004',
  'EXP-UPD-005',
  'EXP-UPD-006'
];

test.describe('getting results out: placeholders follow the view', () => {
  CHARTS.forEach((chart, index) => {
    test(`${UPDATES[index]}: the ${chart.module.replaceAll('-', ' ')}’s title and subtitle are filled again when a filter or a control moves: {filters} names the filter, {n} counts the participants it lets through, and the control’s placeholder reads its new value (#69 review)`, async ({
      page
    }) => {
      const errors = watch(page);
      await blockR(page);
      await openChart(page, chart, {
        title: chart.title,
        subtitle: '{n} participants; filters: {filters}'
      });
      const before = await framed(page, chart);
      const count = (subtitle) => Number(subtitle.match(/^(\d+) participants/)[1]);
      expect(before.subtitle).toMatch(/^\d+ participants; filters: none$/);
      await page.evaluate((name) => {
        const filter = window[name].chart.root.querySelector(
          '.sv-controls select[data-filter="SEX"]'
        );
        filter.value = 'F';
        filter.dispatchEvent(new Event('change'));
      }, `__${chart.global}`);
      const filtered = await framed(page, chart);
      expect(filtered.subtitle).toMatch(/^\d+ participants; filters: SEX is F$/);
      expect(count(filtered.subtitle)).toBeLessThan(count(before.subtitle));
      expect(count(filtered.subtitle)).toBeGreaterThan(0);
      // A control moves: the title's placeholder reads its new value.
      const moved = await page.evaluate((name) => {
        const shown = window[name].chart;
        const select = [...shown.root.querySelectorAll('.sv-controls select[data-control]')].find(
          (control) => control.options.length > 1
        );
        const next = [...select.options].find((option) => option.value !== select.value);
        select.value = next.value;
        select.dispatchEvent(new Event('change'));
        return select.dataset.control;
      }, `__${chart.global}`);
      const after = await framed(page, chart);
      expect(after.title, moved).not.toBe(filtered.title);
      expect(after.title).not.toMatch(/\{[A-Za-z_]\w*\}/);
      expect(errors).toEqual([]);
    });
  });

  test('EXP-TXT-005: in the group comparison’s overview, {n} is the participants drawn anywhere on its page of biomarkers, not blank (#69 review)', async ({
    page
  }) => {
    await blockR(page);
    const chart = CHARTS.find((entry) => entry.module === 'group-comparison');
    await openChart(page, chart, {
      start_value: null,
      visits: null,
      subtitle: '{n} participants: {measure}'
    });
    const said = await framed(page, chart);
    const drawn = await page.evaluate(() => {
      const ids = new Set();
      for (const row of window.__gc.chart.overview.rows) {
        for (const panel of row.model.panels)
          for (const record of panel.records) ids.add(record.USUBJID);
      }
      return ids.size;
    });
    expect(drawn).toBeGreaterThan(0);
    expect(said.subtitle).toBe(`${drawn} participants: every biomarker`);
  });
});

// ---- What the #70 review found -------------------------------------------------------

// Where an element of the chart's frame is, in the downloaded picture's pixels.
const placed = (page, name, selector) =>
  page.evaluate(
    ({ name, selector }) => {
      const chart = window[name].chart;
      const frame = chart.main.getBoundingClientRect();
      // What is drawn in the frame, not what is left out of the picture.
      return [...chart.main.querySelectorAll(selector)]
        .filter((element) => !element.closest('.bv-no-picture'))
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({
          x: rect.left - frame.left + rect.width / 2,
          y: rect.top - frame.top + rect.height / 2,
          half: Math.min(rect.width, rect.height) / 2,
          right: rect.right - frame.left
        }));
    },
    { name, selector }
  );

test.describe('getting results out: what the #70 review found', () => {
  for (const [width, label] of [
    [1280, 'on a wide page'],
    [390, 'on a phone']
  ]) {
    test(`EXP-PNG-002: ${label}, the PNG draws the marks the chart draws: every disc of the correlation matrix and its colour key, and the screen’s zero line, intervals and dots, each where the page has it (#70 review)`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await blockR(page);
      for (const [module, selectors] of [
        ['correlation-matrix', ['.bv-mark', '.bv-key-mark']],
        ['biomarker-screen', ['.bv-zero', '.bv-interval', '.bv-estimate']]
      ]) {
        const chart = CHARTS.find((entry) => entry.module === module);
        await openChart(page, chart);
        await expect(page.locator('#chart .bv-statistic').first()).not.toHaveAttribute(
          'data-state',
          'waiting'
        );
        const marks = [];
        for (const selector of selectors) {
          const found = await placed(page, `__${chart.global}`, selector);
          expect(found.length, `${module} ${selector}`).toBeGreaterThan(0);
          marks.push(...found.map((mark) => ({ ...mark, selector })));
        }
        const png = await downloaded(page, chart, 'png');
        const picture = pixelsOf(new Uint8Array(png.bytes));
        // Inked anywhere within the mark: a ring's middle is white.
        const missing = marks.filter(
          (mark) => !picture.inked(mark.x * 2, mark.y * 2, Math.max(2, Math.floor(mark.half * 2)))
        );
        expect(
          missing.map((mark) => mark.selector),
          `${module}: marks not drawn`
        ).toEqual([]);
      }
    });
  }

  test('EXP-PNG-003: on a phone, what scrolls sideways in the frame is drawn whole: the survival chart’s at-risk table to its last column, with no scroll bar, the picture as wide as it needs (#70 review)', async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await blockR(page);
    const chart = CHARTS.find((entry) => entry.module === 'stratified-survival');
    await openChart(page, chart);
    const cells = await placed(
      page,
      '__ss',
      '.bv-risk-wrap td, .bv-risk-wrap button, .bv-risk-wrap th'
    );
    expect(cells.length).toBeGreaterThan(0);
    const last = cells.reduce((far, cell) => (cell.right > far.right ? cell : far));
    const frameWidth = await page.evaluate(() =>
      Math.ceil(window.__ss.chart.main.getBoundingClientRect().width)
    );
    expect(last.right).toBeGreaterThan(frameWidth);
    const png = await downloaded(page, chart, 'png');
    const picture = pixelsOf(new Uint8Array(png.bytes));
    expect(picture.width).toBeGreaterThanOrEqual(Math.ceil(last.right) * 2);
    expect(picture.inked(last.x * 2, last.y * 2, 4)).toBe(true);
  });

  test('EXP-PNG-004: nothing a reader works the chart with is in the picture: every control of the frame (the toolbar, the hint, the listing, the bar of downloads, a chart’s own download and pager buttons) is marked to be left out (#70 review)', async ({
    page
  }) => {
    await blockR(page);
    for (const chart of CHARTS) {
      await openChart(page, chart);
      await expect(page.locator('#chart .bv-statistic').first()).not.toHaveAttribute(
        'data-state',
        'waiting'
      );
      const unmarked = await page.evaluate((name) => {
        const shown = window[name].chart;
        return [
          ...shown.main.querySelectorAll(
            '.bv-toolbar, .sv-footnote, .sv-listing, .bv-downloads, .bv-screen-tools, .bv-pairs-tools, .bv-overview-pager button'
          )
        ]
          .filter((element) => !element.closest('.bv-no-picture'))
          .map((element) => element.className);
      }, `__${chart.global}`);
      expect(unmarked, chart.module).toEqual([]);
    }
  });

  test('EXP-DL-008: a download that fails says so in the bar, where the reader sees it, and the next one works (#70 review)', async ({
    page
  }) => {
    await blockR(page);
    const chart = CHARTS.find((entry) => entry.module === 'cross-tab');
    await openChart(page, chart);
    await page.evaluate(() => {
      window.__toBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (done) {
        done(null);
      };
    });
    await page.locator('#chart .bv-downloads button[data-download="png"]').click();
    const said = page.locator('#chart .bv-downloads .bv-download-error');
    await expect(said).toBeVisible();
    await expect(said).toHaveAttribute('role', 'alert');
    await expect(said).toHaveText(
      'The PNG could not be made: the picture could not be written, which a browser does when it is too large. Try a smaller png_scale.'
    );
    await page.evaluate(() => {
      HTMLCanvasElement.prototype.toBlob = window.__toBlob;
    });
    const png = await downloaded(page, chart, 'png');
    expect(png.name).toBe('bio.viz-cross-tab-arm-response.png');
    await expect(said).toHaveCount(0);
  });

  test('EXP-DL-009: the table download holds the value a cut was made from: the survival chart’s biomarker beside its group, and the cross-tabulation’s for a cut row or column; its headings, as written (#70 review)', async ({
    page
  }) => {
    await blockR(page);
    const survival = CHARTS.find((entry) => entry.module === 'stratified-survival');
    await openChart(page, survival);
    const [head, ...rows] = parseCsv(
      (await downloaded(page, survival, 'table')).bytes.toString('utf8')
    );
    expect(head).toEqual([
      'Participant',
      'CRP at Baseline, cut at the median',
      'CRP at Baseline',
      'Time',
      'Event'
    ]);
    const values = await page.evaluate(() =>
      Object.fromEntries(
        window.__ss.data.results
          .filter((row) => row.TEST === 'CRP' && row.VISIT === 'Baseline')
          .map((row) => [row.USUBJID, Number(row.STRESN)])
      )
    );
    for (const row of rows.slice(0, 20)) expect(Number(row[2]), row[0]).toBe(values[row[0]]);
    const crossTab = CHARTS.find((entry) => entry.module === 'cross-tab');
    await openChart(page, crossTab, {
      row_by: { measure: 'CRP', visit: 'Baseline', cut: 'median' },
      col_by: 'RESPONSE'
    });
    const [heads, ...cells] = parseCsv(
      (await downloaded(page, crossTab, 'table')).bytes.toString('utf8')
    );
    expect(heads).toEqual([
      'Participant',
      'CRP at Baseline, cut at the median',
      'CRP at Baseline',
      'RESPONSE'
    ]);
    for (const row of cells.slice(0, 20)) expect(Number(row[2]), row[0]).toBe(values[row[0]]);
  });
});

// ---- Specifications (#68) ---------------------------------------------------------

const schema = readJson('../../src/data/specification.schema.json');
const validateSpecification = new Ajv2020({ allErrors: true }).compile(schema);
const SPECIFICATIONS = [
  'EXP-SPEC-005',
  'EXP-SPEC-006',
  'EXP-SPEC-007',
  'EXP-SPEC-008',
  'EXP-SPEC-009',
  'EXP-SPEC-010'
];

// What a chart draws, for two charts to be held equal: what it asked R, the
// table it drew from, and its title, subtitle and footnotes.
const viewOf = (page) =>
  page.evaluate(() => {
    const chart = window.__shown;
    const text = (selector) =>
      [...chart.root.querySelectorAll(selector)].map((element) => element.textContent);
    return {
      asked: chart
        .statistics()
        .map(({ name, args, dataId, rows }) => ({ name, args, dataId, rows })),
      table: chart.tableOf(),
      titles: text('.bv-titles > *'),
      footnotes: text('.bv-foot-line'),
      controls: [...chart.root.querySelectorAll('.sv-controls select')].map((select) => [
        select.dataset.control || select.dataset.filter || select.getAttribute('aria-label'),
        select.value
      ])
    };
  });

test.describe('getting results out: specifications of every chart', () => {
  CHARTS.forEach((chart, index) => {
    test(`${SPECIFICATIONS[index]}: the ${chart.module.replaceAll('-', ' ')} writes its specification, held by the schema, as its controls and filters now read; made again from it, the chart draws the same view, asks R the same, and writes the same specification (#68)`, async ({
      page
    }) => {
      const errors = watch(page);
      await blockR(page);
      await openChart(page, chart, {
        title: chart.title,
        subtitle: chart.subtitle,
        footnotes: ['Filters: {filters}.']
      });
      // The reader moves a control and a filter: the specification is of what
      // the controls now read, not of the settings the chart was made with.
      // Every select control, one after the other, as the controls are drawn
      // again after each; then a checkbox of a control (not a filter's).
      await page.evaluate((name) => {
        const shown = window[name].chart;
        const names = [...shown.root.querySelectorAll('.sv-controls select[data-control]')].map(
          (select) => select.dataset.control
        );
        for (const control of names) {
          const select = shown.root.querySelector(`.sv-controls select[data-control="${control}"]`);
          if (!select || select.options.length < 2) continue;
          const next = [...select.options].find((option) => option.value !== select.value);
          select.value = next.value;
          select.dispatchEvent(new Event('change'));
        }
        const box = [...shown.root.querySelectorAll('.sv-controls input[type=checkbox]')].find(
          (input) => !input.closest('[data-filter]') && !input.closest('.sv-ms-all')
        );
        if (box) box.click();
        const filter = shown.root.querySelector('.sv-controls select[data-filter="SEX"]');
        filter.value = 'F';
        filter.dispatchEvent(new Event('change'));
        window.__shown = shown;
      }, `__${chart.global}`);
      const written = await page.evaluate(() => window.__shown.specification());
      expect(validateSpecification(written), JSON.stringify(validateSpecification.errors)).toBe(
        true
      );
      expect(written).toMatchObject({
        format: 'bio.viz specification',
        format_version: 1,
        bio_viz_version: pkg.version,
        chart: chart.module
      });
      expect(written.filters).toEqual([{ column: 'SEX', operator: 'in', values: ['F'] }]);
      expect(JSON.parse(JSON.stringify(written))).toEqual(written);
      const before = await viewOf(page);
      expect(before.footnotes[0]).toBe('Filters: SEX is F.');

      // Made again, in the same element, from the specification's JSON text.
      await page.evaluate(
        ({ name, text }) => {
          const old = window[name].chart;
          const connection = old.connection;
          old.destroy();
          window.__shown = window.BioViz.fromSpecification('#chart', text, { connection }).init(
            window[name].data
          );
        },
        { name: `__${chart.global}`, text: JSON.stringify(written) }
      );
      await expect
        .poll(async () => (await viewOf(page)).footnotes.at(-1))
        .toBe(before.footnotes.at(-1));
      const after = await viewOf(page);
      expect(after).toEqual(before);
      // A chart's own specification asks for nothing the data cannot draw.
      expect(await page.evaluate(() => window.__shown.notices)).toEqual([]);
      expect(await page.evaluate(() => window.__shown.specification())).toEqual(written);
      expect(errors).toEqual([]);
    });
  });

  test('EXP-SPEC-011: in the page, a chart made from a specification that holds code-like text draws it as text and runs nothing; one with a setting the chart does not have, or an operator that is not `in`, is refused with a sentence and makes no chart (#68)', async ({
    page
  }) => {
    await blockR(page);
    const chart = CHARTS.find((entry) => entry.module === 'cross-tab');
    await openChart(page, chart);
    const result = await page.evaluate(() => {
      const base = window.__ct.chart.specification();
      window.__ct.chart.destroy();
      const evil = {
        ...base,
        settings: {
          ...base.settings,
          title: '<img src=x onerror="window.__pwned = 1">${window.__pwned = 2}',
          footnotes: ['{{constructor.constructor("window.__pwned = 3")()}}']
        },
        filters: [
          { column: 'SEX', operator: 'in', values: ['<script>window.__pwned = 4</script>'] }
        ]
      };
      const made = window.BioViz.fromSpecification('#chart', evil).init(window.__ct.data);
      const said = {
        title: made.root.querySelector('.bv-title').textContent,
        footnote: made.root.querySelector('.bv-foot-line').textContent,
        images: document.querySelectorAll('#chart img, #chart script').length,
        pwned: window.__pwned
      };
      made.destroy();
      const refused = (spec) => {
        try {
          window.BioViz.fromSpecification('#chart', spec);
          return null;
        } catch (error) {
          return error.message;
        }
      };
      return {
        said,
        unknown: refused({ ...base, settings: { ...base.settings, margins: true } }),
        operator: refused({
          ...base,
          filters: [{ column: 'SEX', operator: 'not', values: ['F'] }]
        }),
        empty: document.querySelector('#chart').children.length
      };
    });
    expect(result.said).toEqual({
      title: '<img src=x onerror="window.__pwned = 1">${window.__pwned = 2}',
      footnote: '{{constructor.constructor("window.__pwned = 3")()}}',
      images: 0,
      pwned: undefined
    });
    expect(result.unknown).toMatch(
      /holds `margins`, which is not a setting of that chart in this version\.$/
    );
    expect(result.operator).toMatch(/has the operator "not"; the operators are "in"/);
    expect(result.empty).toBe(0);
  });

  test('EXP-SPEC-012: the site publishes the format’s schema at schema/specification.json, the committed file (#68)', async ({
    page
  }) => {
    const response = await page.goto('/_site/schema/specification.json');
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(schema);
  });
});

// ---- What the #71 review found -------------------------------------------------------

// Made again from its own specification, in the same element, with the same
// connection; resolves to the two specifications and the two views.
const remade = async (page, name) => {
  const before = {
    spec: await page.evaluate(() => window.__shown.specification()),
    view: await viewOf(page)
  };
  await page.evaluate(
    ({ name, text }) => {
      const old = window.__shown;
      const connection = old.connection;
      old.destroy();
      window.__shown = window.BioViz.fromSpecification('#chart', text, { connection }).init(
        window[name].data
      );
    },
    { name, text: JSON.stringify(before.spec) }
  );
  return {
    before,
    after: {
      spec: await page.evaluate(() => window.__shown.specification()),
      view: await viewOf(page)
    }
  };
};
// A checkbox of a control clicked, as a reader's click does, open or not.
const tick = (page, selector) =>
  page.evaluate((found) => {
    const box = document.querySelector(found);
    if (!box) throw new Error(`no ${found}`);
    box.click();
  }, selector);

test.describe('getting results out: what the #71 review found', () => {
  test('EXP-SPEC-013: a selection emptied by hand round-trips: every Visit unticked in the group comparison, and every biomarker of the correlation matrix, write [] that the reader takes, and the chart made again draws the same nothing (#71 review)', async ({
    page
  }) => {
    await blockR(page);
    const comparison = CHARTS.find((entry) => entry.module === 'group-comparison');
    await openChart(page, comparison);
    await page.evaluate(() => (window.__shown = window.__gc.chart));
    await tick(page, '.sv-controls input[type=checkbox][value="Week 4"]');
    let trip = await remade(page, '__gc');
    expect(trip.before.spec.settings.visits).toEqual([]);
    expect(validateSpecification(trip.before.spec)).toBe(true);
    expect(trip.after.spec).toEqual(trip.before.spec);
    expect(trip.after.view).toEqual(trip.before.view);
    await expect(page.locator('#chart .sv-footnote')).toHaveText('Choose a visit to draw.');
    const matrix = CHARTS.find((entry) => entry.module === 'correlation-matrix');
    await openChart(page, matrix);
    await page.evaluate(() => (window.__shown = window.__cm.chart));
    await tick(page, '.sv-controls [data-control="biomarkers"] .sv-ms-all input');
    trip = await remade(page, '__cm');
    expect(trip.before.spec.settings.biomarkers).toEqual([]);
    expect(trip.after.spec).toEqual(trip.before.spec);
    expect(trip.after.view).toEqual(trip.before.view);
  });

  test('EXP-SPEC-014: a filter of several values emptied by hand writes values [] and comes back empty, letting nobody through, not as All (#71 review)', async ({
    page
  }) => {
    await blockR(page);
    const chart = CHARTS.find((entry) => entry.module === 'cross-tab');
    await openChart(page, chart, { filters: [{ value_col: 'SEX', label: 'Sex', multiple: true }] });
    await page.evaluate(() => (window.__shown = window.__ct.chart));
    await tick(page, '.sv-controls [data-filter="SEX"] .sv-ms-all input');
    await expect(page.locator('#chart .sv-footnote')).toHaveText(
      'No participant passes the filters.'
    );
    const trip = await remade(page, '__ct');
    expect(trip.before.spec.filters).toEqual([{ column: 'SEX', operator: 'in', values: [] }]);
    expect(validateSpecification(trip.before.spec)).toBe(true);
    expect(trip.after.spec).toEqual(trip.before.spec);
    await expect(page.locator('#chart .sv-footnote')).toHaveText(
      'No participant passes the filters.'
    );
  });

  test('EXP-SPEC-015: what a specification asks for that the data cannot draw is said on the chart and listed in chart.notices: a filter on a column the participant table does not have, a value a filter does not offer, a grouping the tables do not have, a filter on the id column; a filter named twice is refused (#71 review)', async ({
    page
  }) => {
    await blockR(page);
    const chart = CHARTS.find((entry) => entry.module === 'cross-tab');
    await openChart(page, chart);
    const result = await page.evaluate(() => {
      const base = window.__ct.chart.specification();
      window.__ct.chart.destroy();
      const asked = {
        ...base,
        settings: { ...base.settings, row_by: 'NOPE' },
        filters: [
          { column: 'NOPE', operator: 'in', values: ['x'] },
          { column: 'SEX', operator: 'in', values: ['X'] },
          { column: 'USUBJID', operator: 'in', values: ['BIO-001'] }
        ]
      };
      const made = window.BioViz.fromSpecification('#chart', asked).init(window.__ct.data);
      const notices = made.notices;
      const said = made.root.querySelector('.bv-notices')
        ? made.root.querySelector('.bv-notices').textContent
        : null;
      let twice = null;
      try {
        window.BioViz.fromSpecification('#chart', {
          ...base,
          filters: [
            { column: 'SEX', operator: 'in', values: ['F'] },
            { column: 'SEX', operator: 'in', values: ['M'] }
          ]
        });
      } catch (error) {
        twice = error.message;
      }
      return { notices, said, twice };
    });
    expect(result.notices).toEqual([
      {
        kind: 'setting',
        name: 'row_by',
        asked: 'NOPE',
        drawn: 'ARM',
        said: 'Rows: NOPE is not in the tables, so the chart draws ARM.'
      },
      {
        kind: 'filter',
        name: 'NOPE',
        asked: ['x'],
        drawn: null,
        said: 'Filter NOPE: the participant table has no such column, so it is not a filter.'
      },
      {
        kind: 'filter',
        name: 'SEX',
        asked: ['X'],
        drawn: null,
        said: 'Filter SEX: X is not one of its values, so it is at All.'
      },
      {
        kind: 'filter',
        name: 'USUBJID',
        asked: ['BIO-001'],
        drawn: null,
        said: 'Filter USUBJID: the participant id is not a filter.'
      }
    ]);
    expect(result.said).toBe(
      'Not drawn as the specification asks: ' +
        result.notices.map((notice) => notice.said).join(' ')
    );
    expect(result.twice).toBe(
      'bio.viz: filter 2 is on SEX, which filter 1 is already on: a column is filtered once.'
    );
  });

  test('EXP-SPEC-016: a specification opens on the same page of the group comparison’s overview and of the screen, in the screen’s order, and the survival chart’s Groups keep the cut it opened on after a moved line (#71 review)', async ({
    page
  }) => {
    await blockR(page);
    const comparison = CHARTS.find((entry) => entry.module === 'group-comparison');
    await openChart(page, comparison, { start_value: null, visits: null, overview_limit: 4 });
    await page.evaluate(() => (window.__shown = window.__gc.chart));
    await page.locator('#chart .bv-overview-pager button[data-go="next"]').first().click();
    let trip = await remade(page, '__gc');
    expect(trip.before.spec.settings.page).toBe(1);
    expect(trip.after.spec).toEqual(trip.before.spec);
    expect(await page.locator('#chart .bv-overview-count').first().textContent()).toMatch(
      /^4 of 12 biomarkers shown: 5 to 8/
    );
    const screen = CHARTS.find((entry) => entry.module === 'biomarker-screen');
    await openChart(page, screen, { limit: 5 });
    await page.evaluate(() => (window.__shown = window.__bs.chart));
    await expect(page.locator('#chart .bv-statistic').first()).toHaveAttribute(
      'data-state',
      'shown'
    );
    await page.evaluate(() => {
      const select = window.__shown.root.querySelector('select[data-control="sort"]');
      select.value = 'name';
      select.dispatchEvent(new Event('change'));
    });
    await page.locator('#chart .bv-overview-pager button[data-go="next"]').first().click();
    trip = await remade(page, '__bs');
    expect(trip.before.spec.settings).toMatchObject({ sort: 'name', page: 1 });
    expect(trip.after.spec).toEqual(trip.before.spec);
    const survival = CHARTS.find((entry) => entry.module === 'stratified-survival');
    await openChart(page, survival);
    await page.evaluate(() => {
      window.__shown = window.__ss.chart;
      window.__shown.moveCut(0, 3);
      window.__shown.dropCut(0, 3);
    });
    trip = await remade(page, '__ss');
    const groups = await page.evaluate(() =>
      [...window.__shown.root.querySelectorAll('select[data-control="group-by"] option')].map(
        (option) => option.textContent
      )
    );
    expect(groups).toContain('CRP at Baseline, cut at the median');
    expect(trip.after.spec).toEqual(trip.before.spec);
  });

  test('EXP-SPEC-011: a filter value that looks like code and is in the data is drawn as text, and filters by it (#71 review)', async ({
    page
  }) => {
    await blockR(page);
    const chart = CHARTS.find((entry) => entry.module === 'cross-tab');
    await openChart(page, chart);
    const said = await page.evaluate(() => {
      const evil = '<img src=x onerror="window.__pwned = 1">';
      const data = {
        ...window.__ct.data,
        participants: window.__ct.data.participants.map((row, i) =>
          i < 10 ? { ...row, SEX: evil } : row
        )
      };
      const base = window.__ct.chart.specification();
      window.__ct.chart.destroy();
      const made = window.BioViz.fromSpecification('#chart', {
        ...base,
        settings: { ...base.settings, subtitle: '{filters}: {n}' },
        filters: [{ column: 'SEX', operator: 'in', values: [evil] }]
      }).init(data);
      return {
        subtitle: made.root.querySelector('.bv-subtitle').textContent,
        images: document.querySelectorAll('#chart img').length,
        pwned: window.__pwned
      };
    });
    expect(said).toEqual({
      subtitle: 'SEX is <img src=x onerror="window.__pwned = 1">: 10',
      images: 0,
      pwned: undefined
    });
  });
});
