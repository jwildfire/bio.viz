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
});
