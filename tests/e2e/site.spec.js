import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

// Site smoke (#1): the built home page, served straight out of _site/ — which
// proves the emitted relative URLs work at any mount path (site root, /dev/,
// /pr/N/). The build runs here so every context that runs the browser suite
// exercises the current tree.

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

test.describe('site', () => {
  test.beforeAll(() => {
    execSync('npm run site', { stdio: 'inherit', cwd: new URL('../..', import.meta.url) });
  });

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
