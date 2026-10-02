import path from 'node:path';
import { test, expect } from '@playwright/test';

// Evidence capture, carried over from safety.viz. On the Linux
// continuous-integration runner a capture is an assertion against the committed
// baseline in docs/evidence/<module>/: one PNG is the baseline, the evidence and
// the image the module's evidence page shows. On any other system it writes a
// preview under test-results/ and asserts nothing, because font rendering
// differs between systems and a baseline from one would fail on another.
//
// The file is named `${requirementId}-${slug}.png`; the evidence pipeline
// attaches it to every test record that carries that requirement ID.
//
// The module is the calling spec's file name (tests/e2e/<module>.spec.js)
// unless `module` is given. tests/e2e/site.spec.js gives it: that file tests
// the site, whose requirement rows are in the core matrix.

export const CANONICAL = process.platform === 'linux';

// The three families site/site.css asks for. A capture taken before they
// arrive, or when they never do, would show the fallback fonts: not the page a
// reader sees, and a baseline nothing would match again.
const FAMILIES = ['Instrument Sans', 'Instrument Serif', 'IBM Plex Mono'];

async function fontsLoaded(page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(
    (families) =>
      families.filter(
        (family) =>
          ![...document.fonts].some(
            (face) => face.family.replaceAll('"', '') === family && face.status === 'loaded'
          )
      ),
    FAMILIES
  );
}

/**
 * `target` is the page, for the viewport, or a locator, for one part of it.
 */
export async function captureEvidence(target, requirementId, slug, { module } = {}) {
  const owner = module || path.basename(test.info().file).replace(/\.spec\.js$/, '');
  const name = `${requirementId}-${slug}.png`;
  const page = typeof target.page === 'function' ? target.page() : target;
  if (CANONICAL) {
    expect(
      await fontsLoaded(page),
      'the page’s web fonts did not load, so the capture would not be the page a reader sees'
    ).toEqual([]);
    await expect(target).toHaveScreenshot([owner, name]);
  } else {
    await page.evaluate(() => document.fonts.ready);
    await target.screenshot({ path: `test-results/evidence-preview/${owner}/${name}` });
  }
}
