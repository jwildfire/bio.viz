import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { captureEvidence } from './evidence.js';

// The built site, served straight out of _site/ — which proves the emitted
// relative URLs work at any mount path (site root, /dev/, /pr/N/).
// tests/e2e/global-setup.js builds the site before the suite, so every context
// that runs the browser tests exercises the current tree. The home page (#1),
// then the gallery, the evidence pages and the API references (#7), and the
// styles and the header every page takes from safety.viz's site (#91).
//
// The site's requirement rows are in the core matrix, so the screenshots these
// tests capture are filed with the core module's evidence.

const readJson = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const pkg = readJson('../../package.json');
const config = readJson('../../site/config.json');
const study = readJson('../../site/data/synthetic-study/SOURCE.json');
const requirementIds = (module) =>
  Object.keys(readJson(`../../docs/requirements/${module}.json`).requirements);
// How many tests the committed evidence set names for each requirement.
const testsRecorded = (module) => {
  const { records } = readJson(`../../docs/evidence/${module}/evidence.json`);
  return Object.fromEntries(
    requirementIds(module).map((id) => [
      id,
      records.filter((record) => record.requirementIds.includes(id)).length
    ])
  );
};
const modules = config.modules.map((entry) => entry.module);
const styles = readJson('../../site/vendor/safety.viz-site/SOURCE.json');
// The charts that are published, as the header's Gallery list names them.
const published = config.modules.filter(
  (entry) => entry.kind === 'chart' && entry.status !== 'planned'
);
// One of every kind of page the site builds, and every page of each kind.
const KINDS = [
  'index.html',
  'gallery/index.html',
  'r-check/index.html',
  'group-comparison/index.html',
  'group-comparison/evidence.html',
  'group-comparison/api.html'
];
const EVERY_PAGE = [
  'index.html',
  'gallery/index.html',
  'r-check/index.html',
  ...published.map((entry) => `${entry.module}/index.html`),
  ...modules.flatMap((module) => [`${module}/evidence.html`, `${module}/api.html`])
];
// A chart's demo starts R when it opens. These tests are of the page around
// the chart, so R's hosts are kept out of reach and they stay on this machine.
const blockR = (page) =>
  page.route(/^https:\/\/(webr|repo)\.r-wasm\.org\//, (route) => route.abort());

// Collects what a page reports as going wrong while a test drives it.
function watch(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

// The page's width against the viewport's, and anything laid out past the
// right edge, wherever the page hides it.
const layout = (page) =>
  page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    return {
      viewport,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      overflowing: [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > viewport + 0.5)
        .map((el) => `${el.tagName.toLowerCase()}#${el.id}.${el.className}`)
    };
  });
const HOLDS = { viewport: 390, scrollWidth: 390, bodyScrollWidth: 390, overflowing: [] };

test.describe('site', () => {
  test('CORE-SITE-001: the home page names the library and its version, and shows the version its bundle reports (#1)', async ({
    page
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/_site/index.html');

    await expect(page.locator('h1')).toContainText('bio.viz');
    await expect(page.locator('.site-version')).toHaveText(`v${pkg.version}`);
    // Filled in by the page's own script from the bundle it loaded.
    await expect(page.locator('#bundle-version')).toHaveText(pkg.version);
    expect(await page.evaluate(() => window.BioViz.version)).toBe(pkg.version);
    expect(errors).toEqual([]);
  });

  test('CORE-SITE-002: the home page holds at a 390px-wide viewport with no horizontal scroll (#1)', async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/_site/index.html');
    await expect(page.locator('#bundle-version')).toHaveText(pkg.version);

    const layout = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      // Anything laid out past the right edge, wherever the page hides it.
      const overflowing = [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > viewport + 0.5)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
      return {
        viewport,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        overflowing
      };
    });

    expect(layout.viewport).toBe(390);
    expect(layout.scrollWidth).toBe(390);
    expect(layout.bodyScrollWidth).toBe(390);
    expect(layout.overflowing).toEqual([]);
  });
});

test.describe('gallery', () => {
  test('CORE-SITE-003: the gallery is reached from the home page and lists the published charts, or says that none is published yet (#7)', async ({
    page
  }) => {
    const errors = watch(page);
    await page.goto('/_site/index.html');
    await page.locator('.site-nav').getByRole('link', { name: 'Gallery' }).click();
    await expect(page).toHaveURL(/\/_site\/gallery\/index\.html$/);
    await expect(page.locator('h1')).toHaveText('Gallery');

    const charts = config.modules.filter(
      (entry) => entry.kind === 'chart' && entry.status === 'available'
    );
    // The registry decides which of the two the page shows.
    if (charts.length === 0) {
      await expect(page.locator('#charts #no-charts')).toContainText('No chart is published yet.');
      await expect(page.locator('#charts [data-module]')).toHaveCount(0);
    } else {
      await expect(page.locator('#no-charts')).toHaveCount(0);
      for (const entry of charts) {
        const card = page.locator(`#charts [data-module="${entry.module}"]`);
        await expect(card.locator('h3')).toHaveText(entry.title);
        await expect(card.getByRole('link', { name: 'Evidence' })).toBeVisible();
        await expect(card.getByRole('link', { name: 'API', exact: true })).toBeVisible();
      }
    }
    expect(errors).toEqual([]);

    // The pointer is still on the header's Gallery link it clicked, and the
    // list of charts opens under a pointer resting there (#91). Take it off the
    // header, so the picture is of the gallery and not of the list over it.
    await page.mouse.move(0, 600);
    if (charts.length > 0) await expect(page.locator('#gallery-menu')).toBeHidden();
    await captureEvidence(page.locator('main'), 'CORE-SITE-003', 'gallery', { module: 'core' });
  });

  test('CORE-SITE-004: the gallery lists each shared part, and its two links lead to that module’s evidence page and API reference (#7)', async ({
    page
  }) => {
    const errors = watch(page);
    await page.goto('/_site/gallery/index.html');
    const shared = config.modules.filter((entry) => entry.kind === 'shared');
    await expect(page.locator('#shared-parts [data-module]')).toHaveCount(shared.length);

    for (const entry of shared) {
      const card = page.locator(`#shared-parts [data-module="${entry.module}"]`);
      await expect(card.locator('h3')).toHaveText(entry.title);

      await card.getByRole('link', { name: 'Evidence' }).click();
      await expect(page).toHaveURL(new RegExp(`/_site/${entry.module}/evidence\\.html$`));
      await expect(page.locator('h1')).toHaveText(`${entry.title}: test evidence`);
      // A shared part has no live demo: its pages are these two.
      await expect(page.locator('.page-tabs a')).toHaveText(['Test evidence', 'API reference']);
      await expect(page.locator('.page-tabs .current')).toHaveText('Test evidence');
      // The way back to the gallery is in the header of every page.
      await page.locator('.site-nav').getByRole('link', { name: 'Gallery' }).click();

      await card.getByRole('link', { name: 'API', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/_site/${entry.module}/api\\.html$`));
      await expect(page.locator('.page-tabs .current')).toHaveText('API reference');
      await page.locator('.site-nav').getByRole('link', { name: 'Gallery' }).click();
      await expect(page.locator('h1')).toHaveText('Gallery');
    }
    expect(errors).toEqual([]);
  });

  test('CORE-SITE-015: the site serves the synthetic study, and the gallery gives its row counts and the commit it was copied from (#7)', async ({
    page
  }) => {
    await page.goto('/_site/gallery/index.html');
    await expect(page.locator('#demo-data [data-file]')).toHaveCount(3);
    await expect(page.locator('#demo-data [data-file="synthetic_results.csv"]')).toContainText(
      '11,472 rows'
    );
    await expect(page.locator('#study-source code')).toHaveText(study.commit.slice(0, 7));

    // Each file the gallery links is served, with the rows the page says it has.
    for (const entry of study.files) {
      const href = await page
        .locator(`#demo-data [data-file="${entry.file}"] a`)
        .getAttribute('href');
      const lines = await page.evaluate(async (url) => {
        const response = await fetch(url);
        if (!response.ok) return response.status;
        return (await response.text()).trimEnd().split('\n').length;
      }, href);
      expect(lines).toBe(entry.rows + 1);
    }
    const record = await page.evaluate(async () =>
      (await fetch('../data/synthetic-study/SOURCE.json')).json()
    );
    expect(record).toEqual(study);
  });

  test('CORE-SITE-024: on the gallery and the home page every card says what its module is in the registry’s card text, at most two sentences and five lines at 1280px; with the first row of charts at the top of a 1280 by 800 window the second row’s pictures are in it; and a chart’s fuller text is at the head of its live demo (#96)', async ({
    page
  }) => {
    await blockR(page);
    const said = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.gallery .card[data-module]')].map((card) => {
          const text = card.querySelector(
            '.card-body > p:not(.kit-status):not(.gallery-count):not(.card-links)'
          );
          const { height } = text.getBoundingClientRect();
          return {
            module: card.dataset.module,
            text: text.textContent,
            lines: Math.round(height / parseFloat(getComputedStyle(text).lineHeight))
          };
        })
      );
    for (const url of ['/_site/gallery/index.html', '/_site/index.html']) {
      await page.goto(url);
      const cards = await said();
      expect(cards.map((card) => card.module).sort(), url).toEqual([...modules].sort());
      for (const card of cards) {
        const entry = config.modules.find((found) => found.module === card.module);
        expect(card.text, `${url}, ${card.module}`).toBe(entry.card);
        expect(
          card.text.match(/[.?!](?=\s|$)/g).length,
          `${url}, ${card.module}`
        ).toBeLessThanOrEqual(2);
        expect(card.lines, `${url}, ${card.module}: ${card.text}`).toBeLessThanOrEqual(5);
      }
    }

    // Two rows of charts on one screen: the first row at the top of the
    // window, and under it the second row's pictures, whole.
    await page.goto('/_site/gallery/index.html');
    expect(page.viewportSize()).toEqual({ width: 1280, height: 800 });
    await page.evaluate(() =>
      Promise.all([...document.images].map((image) => image.decode().catch(() => null)))
    );
    const rows = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#charts .card')];
      const top = cards[0].getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top, behavior: 'instant' });
      return cards.map((card) => {
        const picture = card.querySelector('.card-thumb').getBoundingClientRect();
        return {
          top: Math.round(card.getBoundingClientRect().top),
          pictureBottom: Math.round(picture.bottom),
          window: window.innerHeight
        };
      });
    });
    const tops = [...new Set(rows.map((row) => row.top))];
    expect(rows).toHaveLength(6);
    expect(tops).toHaveLength(2);
    expect(tops[0]).toBe(0);
    for (const row of rows) {
      expect(row.pictureBottom, JSON.stringify(row)).toBeLessThanOrEqual(row.window);
    }

    // The fuller text is not on a card; it is at the head of the chart's demo.
    const group = config.modules.find((entry) => entry.module === 'group-comparison');
    expect(group.blurb.length).toBeGreaterThan(group.card.length);
    await page.goto('/_site/group-comparison/index.html');
    await expect(page.locator('p.tagline').first()).toContainText(group.blurb);
  });

  test('CORE-SITE-012: the gallery holds at a 390px-wide viewport with no horizontal scroll (#7)', async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/_site/gallery/index.html');
    await expect(page.locator('#demo-data [data-file]')).toHaveCount(3);
    expect(await layout(page)).toEqual(HOLDS);
  });
});

test.describe('evidence pages', () => {
  test('CORE-SITE-006: the connection to R’s evidence page lists every RCON- and PVAL- requirement with the tests that prove it (#7)', async ({
    page
  }) => {
    const errors = watch(page);
    await page.goto('/_site/r-connection/evidence.html');
    const ids = requirementIds('r-connection');
    expect(ids.length).toBeGreaterThan(60);
    expect(ids.every((id) => /^(RCON|PVAL)-/.test(id))).toBe(true);

    const listed = await page.locator('.requirement').evaluateAll((rows) =>
      rows.map((row) => ({
        id: row.id,
        text: row.querySelector('.req-text').textContent.length > 0,
        tests: row.querySelectorAll('.tests li').length
      }))
    );
    expect(listed.map((row) => row.id)).toEqual(ids);
    expect(listed.filter((row) => !row.text)).toEqual([]);
    // Each requirement shows exactly the tests the evidence set names for it.
    // That every requirement has one is the evidence run's own check
    // (CORE-SITE-011), made on the run rather than on this page.
    expect(Object.fromEntries(listed.map((row) => [row.id, row.tests]))).toEqual(
      testsRecorded('r-connection')
    );
    await expect(page.locator('#fact-requirements')).toHaveText(String(ids.length));
    // A test is shown by its own name, under the requirement it is named for.
    await expect(page.locator('#RCON-API-001')).toHaveAttribute('data-status', 'pass');
    await expect(page.locator('#RCON-API-001 .tests li').first()).toContainText('RCON-API-001:');
    await expect(page.locator('#PVAL-RULE-001 .tests li').first()).toContainText('PVAL-RULE-001:');
    expect(errors).toEqual([]);

    // The row's height is not a whole number of pixels, so how many pixels its
    // picture is tall depends on where the row starts, and that moves by parts
    // of a pixel with the facts above the table, which are the evidence set's.
    // The picture is of the row: it is put on a whole pixel first, so the
    // picture is the same whatever the page above it holds.
    const row = page.locator('#RCON-API-001');
    const top = await row.evaluate((element) => {
      // A spacer above the table, as tall as what the row lacks of a whole
      // pixel, and one pixel more so that it is there to measure from.
      const spacer = document.createElement('div');
      spacer.style.height = '1px';
      element.closest('table').before(spacer);
      const start = element.getBoundingClientRect().top + window.scrollY;
      spacer.style.height = `${1 + Math.ceil(start) - start}px`;
      return element.getBoundingClientRect().top + window.scrollY;
    });
    expect(top).toBe(Math.round(top));
    await captureEvidence(row, 'CORE-SITE-006', 'a-requirement-and-its-tests', {
      module: 'core'
    });
  });

  test('CORE-SITE-022: a row of the evidence table is laid out by its own words: the two columns are three fifths and two fifths of the table on every module’s page, and a row keeps its columns when another row is given a test with a long name (#85)', async ({
    page
  }) => {
    const shares = {};
    for (const module of modules) {
      await page.goto(`/_site/${module}/evidence.html`);
      shares[module] = await page.locator('table.evidence').evaluate((table) => {
        const whole = table.getBoundingClientRect().width;
        return [...table.tHead.rows[0].cells].map((cell) =>
          Math.round((100 * cell.getBoundingClientRect().width) / whole)
        );
      });
    }
    expect(shares).toEqual(Object.fromEntries(modules.map((module) => [module, [60, 40]])));

    await page.goto('/_site/r-connection/evidence.html');
    const cells = () =>
      page
        .locator('#RCON-API-001')
        .evaluate((row) => [...row.cells].map((cell) => cell.getBoundingClientRect().width));
    const before = await cells();
    // Another requirement gains a test with a long name, and one loses its tests:
    // what a pull request does to the evidence set.
    await page.locator('#PVAL-RULE-001 .tests').evaluate((list) => {
      const item = list.querySelector('li').cloneNode(true);
      item.append(` ${'a-test-with-a-long-name-and-no-space-to-break-at-'.repeat(4)}`);
      list.append(item);
    });
    await page.locator('#RCON-API-002 .tests').evaluate((list) => list.replaceChildren());
    expect(await cells()).toEqual(before);
    expect(await layout(page)).toEqual({
      ...HOLDS,
      viewport: 1280,
      scrollWidth: 1280,
      bodyScrollWidth: 1280
    });
  });

  test('CORE-SITE-006: every module has an evidence page that lists each requirement of its matrix (#7)', async ({
    page
  }) => {
    for (const module of modules) {
      await page.goto(`/_site/${module}/evidence.html`);
      const listed = await page
        .locator('.requirement')
        .evaluateAll((rows) => rows.map((r) => r.id));
      expect(listed).toEqual(requirementIds(module));
      await expect(page.locator('#fact-requirements')).toHaveText(String(listed.length));
    }
  });

  test('CORE-SITE-007: a screenshot a test captured is shown under its requirement on the evidence page (#7)', async ({
    page
  }) => {
    await page.goto('/_site/core/evidence.html');
    const shot = page.locator('#CORE-SITE-003 img.screenshot');
    await expect(shot).toHaveCount(1);
    await expect(shot).toHaveAttribute('src', 'evidence/CORE-SITE-003-gallery.png');
    await shot.scrollIntoViewIfNeeded();
    // The image is served and decodes: the page is not showing a broken picture.
    await expect
      .poll(() => shot.evaluate((img) => img.complete && img.naturalWidth))
      .toBeGreaterThan(0);
    // It is shown under that requirement only.
    await expect(page.locator('#CORE-SITE-012 img.screenshot')).toHaveCount(0);
  });

  test('CORE-SITE-013: each module’s evidence page holds at a 390px-wide viewport with no horizontal scroll (#7)', async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const module of modules) {
      await page.goto(`/_site/${module}/evidence.html`);
      await expect(page.locator('.requirement').first()).toBeVisible();
      // Opened, so the tests it holds are laid out and measured too. A module
      // whose first evidence set has not been made yet has none to open.
      const shared = page.locator('#shared-tests summary');
      if (await shared.count()) {
        await shared.click();
        await expect(page.locator('#shared-tests .tests li').first()).toBeVisible();
      }
      expect(await layout(page), module).toEqual(HOLDS);
    }
  });
});

test.describe('API reference', () => {
  test('CORE-SITE-009: the connection to R’s API reference documents createConnection and formatStatistic (#7)', async ({
    page
  }) => {
    const errors = watch(page);
    await page.goto('/_site/r-connection/api.html');
    await expect(page.locator('h1')).toHaveText('The connection to R');
    await expect(
      page.locator('.api-body h2 code').filter({ hasText: /^createConnection\(/ })
    ).toHaveCount(1);
    await expect(
      page.locator('.api-body h2 code').filter({ hasText: /^formatStatistic\(/ })
    ).toHaveCount(1);

    // The option table and the rule for a p-value are there, from the reference file.
    await expect(page.locator('.api-body')).toContainText('browser.sourceUrl');
    await expect(page.locator('.api-body')).toContainText('Never a p-value alone');
    await expect(page.locator('.api-body pre').first()).toContainText('BioViz.r.createConnection(');

    // The list of sections leads to each section.
    await page
      .locator('.api-toc')
      .getByRole('link', { name: 'formatStatistic(statistic)' })
      .click();
    await expect(page).toHaveURL(/#formatstatisticstatistic$/);
    await expect(page.locator('#formatstatisticstatistic')).toBeInViewport();
    const dangling = await page
      .locator('.api-toc a, .api-body a[href^="#"]')
      .evaluateAll((links) =>
        links
          .map((link) => link.getAttribute('href'))
          .filter((href) => !document.getElementById(href.slice(1)))
      );
    expect(dangling).toEqual([]);
    expect(errors).toEqual([]);

    await captureEvidence(page.locator('.api-toc'), 'CORE-SITE-009', 'sections-of-the-reference', {
      module: 'core'
    });
  });

  test('CORE-SITE-009: every module has an API reference page that documents each name it exports (#7)', async ({
    page
  }) => {
    await page.goto('/_site/index.html');
    // What the bundle this page loaded really exports, for each module's
    // surface as the registry gives it: a namespace stands for its members.
    const exported = await page.evaluate(
      (entries) =>
        Object.fromEntries(
          entries.map(({ module, api }) => [
            module,
            api.surface.flatMap((key) =>
              window.BioViz[key] !== null && typeof window.BioViz[key] === 'object'
                ? Object.keys(window.BioViz[key])
                : [key]
            )
          ])
        ),
      config.modules
    );
    expect(exported['r-connection']).toEqual(
      expect.arrayContaining(['createConnection', 'formatStatistic'])
    );
    for (const module of modules) {
      await page.goto(`/_site/${module}/api.html`);
      const headings = await page
        .locator('.api-body h2 code')
        .evaluateAll((codes) => codes.map((code) => code.textContent));
      for (const name of exported[module]) {
        expect(
          headings.some((heading) => heading === name || heading.startsWith(`${name}(`)),
          `${module}: ${name}`
        ).toBe(true);
      }
      // Every link within the page leads to a heading on it.
      const dangling = await page
        .locator('.api-toc a, .api-body a[href^="#"]')
        .evaluateAll((links) =>
          links
            .map((link) => link.getAttribute('href'))
            .filter((href) => !document.getElementById(href.slice(1)))
        );
      expect(dangling, module).toEqual([]);
    }
  });

  test('CORE-SITE-014: each module’s API reference holds at a 390px-wide viewport, with its tables restacked (#7)', async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const module of modules) {
      await page.goto(`/_site/${module}/api.html`);
      await expect(page.locator('.api-body .doc-table').first()).toBeVisible();
      expect(await layout(page), module).toEqual(HOLDS);
      // A table is a list here: no header row, and each cell under its column's name.
      await expect(page.locator('.api-body .doc-table thead').first()).toBeHidden();
      const cell = page.locator('.api-body .doc-table td').first();
      const label = await cell.evaluate((td) => getComputedStyle(td, '::before').content);
      expect(label).toBe(JSON.stringify(await cell.getAttribute('data-label')));
    }
  });
});

test.describe('styles and header', () => {
  test('CORE-SITE-019: every page is styled by safety.viz’s stylesheet as it was copied, published with its record, and then by the site’s own (#91)', async ({
    page
  }) => {
    await blockR(page);
    // The published stylesheet is the copy, byte for byte, with its record beside it.
    const css = await page.request.get('/_site/vendor/safety.viz-site/site.css');
    expect(css.ok()).toBe(true);
    const recorded = styles.files.find((entry) => entry.file === 'site.css');
    const bytes = await css.body();
    expect(bytes.length).toBe(recorded.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(recorded.sha256);
    const record = await page.request.get('/_site/vendor/safety.viz-site/SOURCE.json');
    expect(await record.json()).toEqual(styles);
    expect(styles.commit).toMatch(/^[0-9a-f]{40}$/);
    // The shell the header follows is not a page of this site.
    expect((await page.request.get('/_site/vendor/safety.viz-site/shell.html')).status()).toBe(404);

    for (const file of EVERY_PAGE) {
      await page.goto(`/_site/${file}`);
      const sheets = await page.evaluate(() =>
        [...document.querySelectorAll('link[rel="stylesheet"]')].map((link) =>
          new URL(link.href).pathname.replace(/^.*\/_site\//, '')
        )
      );
      expect(sheets, file).toEqual(['vendor/safety.viz-site/site.css', 'site.css']);
    }

    // What a reader of safety.viz's site would know the page by, read off the
    // page as drawn on one of each kind: the paper, the espresso band with its
    // orange rule, the serif title, the mono navigation, and the orange link.
    for (const file of KINDS) {
      await page.goto(`/_site/${file}`);
      await page.evaluate(() => document.fonts.ready);
      const drawn = await page.evaluate(() => {
        const style = (selector) => getComputedStyle(document.querySelector(selector));
        return {
          paper: style('body').backgroundColor,
          band: style('.site-header').backgroundColor,
          rule: `${style('.site-header').borderTopWidth} ${style('.site-header').borderTopColor}`,
          footer: style('.site-footer').backgroundColor,
          title: style('h1').fontFamily.split(',')[0].replaceAll('"', ''),
          titleSize: style('h1').fontSize,
          body: style('body').fontFamily.split(',')[0].replaceAll('"', ''),
          nav: style('.site-nav a').fontFamily.split(',')[0].replaceAll('"', ''),
          link: style('.site-footer a').color,
          column: style('.site-main').maxWidth
        };
      });
      expect(drawn, file).toEqual({
        paper: 'rgb(250, 246, 241)',
        band: 'rgb(39, 24, 16)',
        rule: '4px rgb(249, 115, 22)',
        footer: 'rgb(39, 24, 16)',
        title: 'Instrument Serif',
        titleSize: '33.6px',
        body: 'Instrument Sans',
        nav: 'IBM Plex Mono',
        link: 'rgb(245, 237, 228)',
        // A chart with its sidebar is given more room, as on safety.viz's site.
        column: file === 'group-comparison/index.html' ? '1360px' : '1024px'
      });
    }
  });

  test('CORE-SITE-019: the gallery’s cards, a module’s tabs, the fact panel, the evidence table and the reference’s sidebar are drawn by safety.viz’s rules (#91)', async ({
    page
  }) => {
    await blockR(page);
    const drawn = (selector, properties) =>
      page.evaluate(
        ([sel, props]) => {
          const style = getComputedStyle(document.querySelector(sel));
          return Object.fromEntries(props.map((name) => [name, style[name]]));
        },
        [selector, properties]
      );
    await page.goto('/_site/gallery/index.html');
    expect(await drawn('#charts-list', ['display', 'listStyleType'])).toEqual({
      display: 'grid',
      listStyleType: 'none'
    });
    expect(
      await drawn('#charts .card', ['backgroundColor', 'borderTopLeftRadius', 'overflow'])
    ).toEqual({
      backgroundColor: 'rgb(255, 255, 255)',
      borderTopLeftRadius: '14px',
      overflow: 'hidden'
    });
    // Three cards to a row at this width, each with its picture above its words.
    const cards = await page
      .locator('#charts .card')
      .evaluateAll((found) => found.map((card) => Math.round(card.getBoundingClientRect().top)));
    expect(new Set(cards.slice(0, 3)).size).toBe(1);
    expect(cards[3]).toBeGreaterThan(cards[0]);
    const thumb = await page.locator('#charts .card-thumb img').first().boundingBox();
    const words = await page.locator('#charts .card-body').first().boundingBox();
    expect(thumb.height).toBe(240);
    expect(words.y).toBeGreaterThanOrEqual(thumb.y + thumb.height);
    // The whole picture is shown, where safety.viz's site crops one to fill.
    expect(await drawn('#charts .card-thumb img', ['objectFit'])).toEqual({ objectFit: 'contain' });

    await page.goto('/_site/group-comparison/evidence.html');
    await expect(page.locator('.page-tabs a')).toHaveText([
      'Live demo',
      'Test evidence',
      'API reference'
    ]);
    expect(await drawn('.page-tabs a.current', ['borderTopColor', 'backgroundColor'])).toEqual({
      borderTopColor: 'rgb(249, 115, 22)',
      backgroundColor: 'rgb(255, 255, 255)'
    });
    expect(await drawn('.facts', ['display', 'borderTopLeftRadius'])).toEqual({
      display: 'grid',
      borderTopLeftRadius: '14px'
    });
    expect(await drawn('table.evidence th', ['textTransform', 'backgroundColor'])).toEqual({
      textTransform: 'uppercase',
      backgroundColor: 'rgb(245, 239, 231)'
    });
    // At this width the table is a table: a requirement beside its tests.
    const cells = await page
      .locator('#GC-DRAW-001 td')
      .evaluateAll((found) => found.map((cell) => Math.round(cell.getBoundingClientRect().top)));
    expect(cells).toHaveLength(2);
    expect(cells[0]).toBe(cells[1]);
    // A screenshot under a requirement is a thumbnail that opens the picture,
    // and every screenshot is shown again under Visual evidence.
    const shot = page.locator('#GC-DRAW-001 img.screenshot').first();
    await shot.scrollIntoViewIfNeeded();
    expect((await shot.boundingBox()).height).toBe(104);
    const shown = Number(await page.locator('#fact-screenshots').textContent());
    expect(shown).toBeGreaterThan(0);
    await expect(page.locator('#visual-evidence .evidence-gallery figure')).toHaveCount(shown);

    await page.goto('/_site/group-comparison/api.html');
    expect(await drawn('.api-layout', ['display'])).toEqual({ display: 'grid' });
    expect(await drawn('.api-toc', ['position'])).toEqual({ position: 'sticky' });
    // The list of sections is beside the reference, not above it.
    const toc = await page.locator('.api-toc').boundingBox();
    const body = await page.locator('.api-body').boundingBox();
    expect(body.x).toBeGreaterThan(toc.x + toc.width);
    expect(Math.abs(body.y - toc.y)).toBeLessThan(2);

    // The site's own rules stop at a chart. The page wraps a long string
    // anywhere, so that nothing runs past a phone's edge; a chart's parts wrap
    // as the chart has them. And a chart's many-choice control, a summary line
    // as the site's folded lists are, is not drawn in the site's accent.
    await page.goto('/_site/group-comparison/index.html');
    await expect(page.locator('#chart summary').first()).toBeVisible();
    expect(await drawn('body', ['overflowWrap'])).toEqual({ overflowWrap: 'anywhere' });
    expect(await drawn('#chart', ['overflowWrap'])).toEqual({ overflowWrap: 'normal' });
    await page.goto('/_site/core/evidence.html');
    const accent = (await drawn('#shared-tests summary', ['color'])).color;
    expect(accent).toBe('rgb(194, 65, 12)');
    await page.goto('/_site/group-comparison/index.html');
    await expect(page.locator('#chart summary').first()).toBeVisible();
    expect((await drawn('#chart summary', ['color'])).color).not.toBe(accent);
  });

  test('CORE-SITE-020: every page carries the header and the footer: the name and version, a Gallery list of every published chart, and links that all lead somewhere (#91)', async ({
    page
  }) => {
    await blockR(page);
    const reached = new Map();
    for (const file of EVERY_PAGE) {
      await page.goto(`/_site/${file}`);
      const header = page.locator('.site-header');
      await expect(header.locator('.site-name'), file).toContainText('bio.viz');
      await expect(header.locator('.site-version'), file).toHaveText(`v${pkg.version}`);
      await expect(page.locator('.site-footer'), file).toContainText(`bio.viz v${pkg.version}`);
      // The list is closed until it is asked for, and names every published chart.
      await expect(page.locator('#gallery-menu'), file).toBeHidden();
      expect(
        await page
          .locator('#gallery-menu a')
          .evaluateAll((links) => links.map((a) => a.textContent)),
        file
      ).toEqual(published.map((entry) => entry.title));
      // Every link of the header and the footer, as the browser resolves it.
      const links = await page
        .locator('.site-header a, .site-footer a')
        .evaluateAll((found) => found.map((a) => a.href));
      expect(links.length, file).toBe(published.length + 10);
      for (const href of links) {
        if (!reached.has(href)) reached.set(href, null);
      }
    }
    // Each one on this site is a page that is served; each one off it is one of
    // the five places the header and footer name.
    const local = [...reached.keys()].filter((href) => href.includes('/_site/'));
    for (const href of local) {
      const response = await page.request.get(href);
      expect(response.ok(), href).toBe(true);
    }
    expect(local.map((href) => href.replace(/^.*\/_site\//, '')).sort()).toEqual(
      [
        'index.html',
        'gallery/index.html',
        'r-check/index.html',
        ...published.map((entry) => `${entry.module}/index.html`)
      ].sort()
    );
    expect([...reached.keys()].filter((href) => !href.includes('/_site/')).sort()).toEqual([
      'https://github.com/jwildfire/bio.viz',
      'https://github.com/jwildfire/bio.viz/releases',
      'https://jwildfire.github.io/obot.roadmap/',
      'https://jwildfire.github.io/safety.viz/'
    ]);
  });

  test('CORE-SITE-020: the Gallery list opens from its button and from the keyboard, leads to a chart’s live demo, and the header marks the page a reader is on (#91)', async ({
    page
  }) => {
    await blockR(page);
    // What a page throws. The console is not read here: a chart's demo says
    // there that R's host could not be reached, which is this test's doing.
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/_site/gallery/index.html');
    // The gallery is the page a reader is on.
    const gallery = page.locator('.site-nav .nav-group > a');
    await expect(gallery).toHaveText('Gallery');
    await expect(gallery).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.site-nav [aria-current="page"]')).toHaveCount(1);

    const button = page.getByRole('button', { name: 'Show charts' });
    const menu = page.locator('#gallery-menu');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    // Opened from the keyboard here, so the pointer is nowhere near it: the
    // list also opens while the pointer is over the entry, and stays open then.
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('link')).toHaveText(published.map((entry) => entry.title));
    await captureEvidence(menu, 'CORE-SITE-020', 'the-gallery-list', { module: 'core' });
    // Escape closes it, and the arrow keys open it and move through it.
    await page.keyboard.press('Escape');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();
    await button.focus();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('link').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('link').nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(menu.getByRole('link').last()).toBeFocused();
    // A press outside closes it.
    await page.locator('h1').click();
    await expect(menu).toBeHidden();

    // A chart in the list leads to its live demo, where the header marks it.
    const second = published[1];
    await button.click();
    await menu.getByRole('link', { name: second.title }).click();
    await expect(page).toHaveURL(new RegExp(`/_site/${second.module}/index\\.html$`));
    await expect(page.locator('h1')).toContainText(second.title);
    await expect(page.locator('.page-tabs .current')).toHaveText('Live demo');
    const current = page.locator('.site-nav [aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText(second.title);
    // The name leads home, and the R check page is marked when it is the page.
    await page.locator('.site-name').click();
    await expect(page).toHaveURL(/\/_site\/index\.html$/);
    await page.locator('.site-nav').getByRole('link', { name: 'R check' }).click();
    await expect(page).toHaveURL(/\/_site\/r-check\/index\.html$/);
    await expect(page.locator('.site-nav [aria-current="page"]')).toHaveText('R check');
    expect(errors).toEqual([]);

    await captureEvidence(page.locator('.site-header'), 'CORE-SITE-020', 'the-header', {
      module: 'core'
    });
  });

  test('CORE-SITE-021: the header holds at a 390px-wide viewport on every kind of page, and the Gallery list opens under it, on the screen (#91)', async ({
    page
  }) => {
    await blockR(page);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const file of KINDS) {
      await page.goto(`/_site/${file}`);
      await expect(page.locator('h1'), file).toBeVisible();
      if (file === 'group-comparison/index.html') {
        await page.evaluate(() => window.BioVizDemo.ready);
      }
      expect(await layout(page), file).toEqual(HOLDS);
      // Every entry of the header is on the screen.
      const entries = await page
        .locator('.site-header a:visible, .site-header button')
        .evaluateAll((found) => found.map((el) => el.getBoundingClientRect().right));
      expect(Math.max(...entries), file).toBeLessThanOrEqual(390);

      await page.getByRole('button', { name: 'Show charts' }).click();
      const menu = page.locator('#gallery-menu');
      await expect(menu, file).toBeVisible();
      const header = await page.locator('.site-header').boundingBox();
      const list = await menu.boundingBox();
      // Directly under the header, across the screen, and all of it in view.
      expect(Math.abs(list.y - (header.y + header.height)), file).toBeLessThan(1);
      expect(list.x, file).toBe(0);
      expect(list.width, file).toBe(390);
      expect(list.y + list.height, file).toBeLessThan(844);
      await expect(menu.getByRole('link').last(), file).toBeInViewport();
      expect(await layout(page), file).toEqual(HOLDS);
    }
    await captureEvidence(page.locator('.site-header'), 'CORE-SITE-021', 'the-header-on-a-phone', {
      module: 'core'
    });
  });
});
