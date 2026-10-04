import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { captureEvidence } from './evidence.js';

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
const today = () => new Date().toISOString().slice(0, 10);

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
      markup:
        titles.querySelectorAll('*:not(.bv-title):not(.bv-subtitle)').length +
        foot.querySelectorAll('*:not(.bv-foot-line)').length
    };
  }, `__${chart.global}`);

const layout = (page) =>
  page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));

test.describe('getting results out: titles and footnotes on every chart', () => {
  for (const chart of CHARTS) {
    test(`${chart.id}: the ${chart.module.replace('-', ' ')} draws its title and subtitle above it and its footnotes under it, filled from the view drawn, with its own footnote last: the date, the bio.viz version, R’s method and counts, and the R and gsm.bio versions of the stored result; it holds at 390px (#66)`, async ({
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
      const automatic =
        `Drawn on ${today()} by bio.viz ${pkg.version}. Statistics: ${value.method} ` +
        `(${countsSaid(value.counts, chart.of)}); computed by R ${chart.madeBy.r_version} with ` +
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
    const drawn = `Drawn on ${today()} by bio.viz ${pkg.version}.`;
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
        new RegExp(`^Drawn on ${today()} by bio\\.viz ${pkg.version.replace(/\./g, '\\.')}\\. `)
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(() => layout(page)).toEqual({ viewport: 390, scrollWidth: 390 });
    });
  }
});
