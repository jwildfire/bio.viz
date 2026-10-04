import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

// Library core in a real page (#1): the fixture loads the committed IIFE bundle
// by its versioned path with a plain <script> tag, the way a widget does.

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

test.describe('bio.viz core', () => {
  test('CORE-API-001: a page that loads the committed bundle reads BioViz.version as the package version (#1)', async ({
    page
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/tests/e2e/fixtures/index.html');

    expect(await page.evaluate(() => window.BioViz.version)).toBe(pkg.version);
    await expect(page.locator('#version')).toHaveText(pkg.version);
    expect(errors).toEqual([]);
  });

  test('CORE-MAN-007: the site publishes the chart list as portfolio.json, the same list a page reads as BioViz.portfolio, and the format it names at schema/portfolio.json (#32)', async ({
    page,
    request
  }) => {
    const published = await request.get('/_site/portfolio.json');
    expect(published.status()).toBe(200);
    const list = await published.json();
    await page.goto('/tests/e2e/fixtures/index.html');
    expect(await page.evaluate(() => window.BioViz.portfolio)).toEqual(list);
    expect(Object.keys(list.modules)).toEqual([
      'group-comparison',
      'association-scatter',
      'correlation-matrix',
      'biomarker-screen',
      'cross-tab'
    ]);
    // `$schema` is relative, so it resolves beside the published list.
    const schemaUrl = new URL(list.$schema, published.url()).pathname;
    expect(schemaUrl).toBe('/_site/schema/portfolio.json');
    const schema = await request.get(schemaUrl);
    expect(schema.status()).toBe(200);
    expect(await schema.text()).toBe(
      readFileSync(new URL('../../src/data/schema/portfolio.json', import.meta.url), 'utf8')
    );
  });
});
