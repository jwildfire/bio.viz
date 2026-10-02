import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { captureEvidence } from './evidence.js';

// The built site, served straight out of _site/ — which proves the emitted
// relative URLs work at any mount path (site root, /dev/, /pr/N/).
// tests/e2e/global-setup.js builds the site before the suite, so every context
// that runs the browser tests exercises the current tree. The home page (#1),
// then the gallery, the evidence pages and the API references (#7).
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
        await expect(card.getByRole('link', { name: 'API reference' })).toBeVisible();
      }
    }
    expect(errors).toEqual([]);

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
      await expect(page.locator('h1')).toHaveText(entry.title);
      await expect(page.locator('.page-tabs .current')).toHaveText('Evidence');
      await page.locator('.page-tabs').getByRole('link', { name: 'Gallery' }).click();

      await card.getByRole('link', { name: 'API reference' }).click();
      await expect(page).toHaveURL(new RegExp(`/_site/${entry.module}/api\\.html$`));
      await expect(page.locator('.page-tabs .current')).toHaveText('API reference');
      await page.locator('.page-tabs').getByRole('link', { name: 'Gallery' }).click();
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

    await captureEvidence(
      page.locator('#RCON-API-001'),
      'CORE-SITE-006',
      'a-requirement-and-its-tests',
      {
        module: 'core'
      }
    );
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
      // Opened, so the tests it holds are laid out and measured too.
      await page.locator('#shared-tests summary').click();
      await expect(page.locator('#shared-tests .tests li').first()).toBeVisible();
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
