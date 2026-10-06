import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { moduleForFile } from '../../scripts/evidence-lib.mjs';

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
// The module is the calling spec's, by the rule the evidence pipeline routes
// its records with (tests/e2e/<module>.spec.js, or <group>-<module>.spec.js),
// unless `module` is given. tests/e2e/site.spec.js gives it: that file tests
// the site, whose requirement rows are in the core matrix.

const MODULES = JSON.parse(
  readFileSync(new URL('../../site/config.json', import.meta.url), 'utf8')
).modules.map((entry) => entry.module);

export const CANONICAL = process.platform === 'linux';

// The three families the site's stylesheet asks for (safety.viz's, as copied). A capture taken before they
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

// Every "bio.viz <version>" the capture draws, as a footnote writes it. Pixel
// tolerance cannot see a version change in a footnote, so beside each picture
// the text it was drawn with is kept, and checked (#78 review).
const VERSION_DRAWN = /bio\.viz \d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?(?: with development changes)?/g;

async function versionsDrawn(target) {
  const element = typeof target.page === 'function' ? target : target.locator('body');
  const text = await element.innerText();
  return [...new Set(text.match(VERSION_DRAWN) || [])].sort();
}

// The evidence pictures a capture shows, by `<module>/<file>.png`: the gallery's
// page shows the charts' own pictures as images.
async function picturesShown(target) {
  const element = typeof target.page === 'function' ? target : target.locator('body');
  const sources = await element.evaluate((root) =>
    [...root.querySelectorAll('img')].map((image) => new URL(image.src, document.baseURI).pathname)
  );
  const named = sources
    .map((source) => source.match(/\/([a-z][a-z0-9-]*)\/evidence\/([^/]+\.png)$/))
    .filter(Boolean)
    .map(([, owner, file]) => `${owner}/${file}`);
  return [...new Set(named)].sort();
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Where the text a picture was drawn with is kept: beside it, named for it.
 * @param {string} picture The PNG's path.
 */
export const drawnRecordOf = (picture) => picture.replace(/\.png$/, '.drawn.json');

/**
 * `target` is the page, for the viewport, or a locator, for one part of it.
 *
 * On the Linux runner the versions of bio.viz the capture draws are kept beside
 * the picture, in `<name>.drawn.json`, with the picture's sha256 and the
 * evidence pictures it shows, whenever the picture is written: by a refresh
 * that rewrites it, or by `--update-snapshots=all`, which rewrites every one. A
 * run that does not rewrite the picture fails when the page now draws a version
 * other than the one kept, shows other pictures, or the committed picture is
 * not the one the record was written for: the picture is stale, however few of
 * its pixels differ, and is refreshed with every other (`update-baselines-all`).
 *
 * A picture of pictures, the gallery's page, is checked for its own text and
 * bytes, and names the pictures it shows; their versions are each held by
 * their own records. Its embedded pixels are not: the site under test is built
 * before a refresh rewrites the pictures it shows, so a picture of them always
 * lags them by one refresh, and holding it to them would fail every refresh.
 */
export async function captureEvidence(target, requirementId, slug, { module } = {}) {
  const file = test.info().file;
  const owner =
    module || moduleForFile(file, MODULES) || path.basename(file).replace(/\.spec\.js$/, '');
  const name = `${requirementId}-${slug}.png`;
  const page = typeof target.page === 'function' ? target.page() : target;
  if (CANONICAL) {
    // A page of the site asks for the three families; a fixture page asks for
    // none, and is drawn in the runner's own fonts.
    const missing = await fontsLoaded(page);
    if (new URL(page.url()).pathname.includes('/_site/')) {
      expect(
        missing,
        'the page’s web fonts did not load, so the capture would not be the page a reader sees'
      ).toEqual([]);
    }
    const picture = test.info().snapshotPath(owner, name, { kind: 'screenshot' });
    const record = drawnRecordOf(picture);
    const before = existsSync(picture) ? readFileSync(picture) : null;
    const drawn = await versionsDrawn(target);
    const shown = await picturesShown(target);
    await expect(target).toHaveScreenshot([owner, name]);
    const updating = test.info().config.updateSnapshots;
    const after = existsSync(picture) ? readFileSync(picture) : null;
    const written = after && (!before || !before.equals(after) || updating === 'all');
    if (updating !== 'none' && written) {
      const made = {
        versions: drawn,
        ...(shown.length ? { embeds: shown } : {}),
        sha256: sha256(after)
      };
      writeFileSync(record, `${JSON.stringify(made, null, 2)}\n`);
    } else if (existsSync(record)) {
      const kept = JSON.parse(readFileSync(record, 'utf8'));
      const stale = (what) =>
        `${name} ${what}: the picture is stale. Refresh every picture with the ` +
        'update-baselines-all label.';
      expect(
        kept.versions,
        stale(
          `was drawn with ${kept.versions.join(', ') || 'no version'}, and the page now draws ` +
            `${drawn.join(', ') || 'none'}`
        )
      ).toEqual(drawn);
      expect(kept.embeds || [], stale('shows other pictures than its record names')).toEqual(shown);
      if (kept.sha256 !== undefined) {
        expect(sha256(after), stale('is not the picture its record was written for')).toBe(
          kept.sha256
        );
      }
    }
  } else {
    await page.evaluate(() => document.fonts.ready);
    await target.screenshot({ path: `test-results/evidence-preview/${owner}/${name}` });
  }
}

/**
 * The time every chart is drawn at in a test that fixes the clock: the chart's
 * own footnote names the date drawn (#66), so a screenshot or an expected
 * sentence holds on any day, and across midnight.
 */
export const FIXED_DATE = new Date('2026-10-04T12:00:00Z');

/**
 * Fixes the page's clock at FIXED_DATE: Date.now() and new Date() read it, and
 * timers still run. Chart.js's animations read Date.now(), so a chart that
 * animates never finishes under it: a spec whose charts all draw without
 * animation may fix the clock.
 */
export const fixClock = (page) => page.clock.setFixedTime(FIXED_DATE);

/**
 * The gallery's picture of a chart (#66): its frame, `root`, captured as the
 * reader of a figure sees it, with its title and its own footnote, which says
 * what stands behind its statistics, inside the capture. Waits for R's answer,
 * and fails, rather than capture, when the frame lacks either. A view that
 * prints no statistic, as the group comparison's opening view does, is
 * captured with `statistics: false`: its footnote must then say that R was
 * asked for none (#108).
 * @param {import('@playwright/test').Locator} root The chart's frame, `.sv-main`.
 * @param {string} requirementId The chart's DRAW-001 requirement.
 * @param {object} [options]
 * @param {boolean} [options.statistics=true] Whether the view prints R's statistics.
 */
export async function captureGallery(root, requirementId, { statistics = true } = {}) {
  const page = root.page();
  // What a reader works the chart with is left out, as the chart's own PNG
  // leaves it out: the controls under it, the listing, the bar of downloads.
  const hidden = await page.addStyleTag({ content: '.bv-no-picture{display:none !important}' });
  const title = root.locator('.bv-title');
  const automatic = root.locator('.bv-foot-line[data-automatic="true"]');
  await expect(title).toBeVisible();
  await expect(automatic).toBeVisible();
  if (statistics) {
    // The footnote names R's method and counts: R has answered.
    await expect(automatic).toContainText('Statistics: ');
    await expect(automatic).not.toContainText('waiting for R');
    await expect(automatic).not.toContainText('unavailable');
  } else {
    // The view asks R for nothing, and its footnote says so in those words.
    await expect(automatic).toContainText('No statistic was asked of R.');
    await expect(automatic).not.toContainText('Statistics: ');
  }
  const [frame, foot, heading] = await Promise.all([
    root.boundingBox(),
    automatic.boundingBox(),
    title.boundingBox()
  ]);
  for (const [part, box] of [
    ['the title', heading],
    ['the chart’s own footnote', foot]
  ]) {
    expect(box.y, `${requirementId}: ${part} is inside the capture`).toBeGreaterThanOrEqual(
      frame.y
    );
    expect(
      box.y + box.height,
      `${requirementId}: ${part} is inside the capture`
    ).toBeLessThanOrEqual(frame.y + frame.height + 0.5);
  }
  await captureEvidence(root, requirementId, 'as-the-gallery-shows-it');
  await hidden.evaluate((style) => style.remove());
}
