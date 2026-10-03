import { expect } from '@playwright/test';

// Filters that let nobody through (#29), on a chart's demo page, the same for
// every chart. The page's chart is given a connection that writes down what it
// is asked and answers that no R is attached, so the test sees whether R is
// asked and never reaches R's hosts. The demo's filters are given one more, age:
// the four participants aged 35 are all non-responders, so Age 35 with
// Response Responder lets nobody through.

export const NOBODY_PASSES = 'No participant passes the filters.';

// Opens a chart's demo with R kept out of reach, every page error written
// down, and the counting connection in place of the demo's own.
export async function openDemo(page, module, name) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route(/^https:\/\/(webr|repo)\.r-wasm\.org\//, (route) => route.abort());
  await page.goto(`/_site/${module}/index.html`);
  await page.waitForFunction(() => window.BioVizDemo && window.BioVizDemo.chart);
  await page.evaluate(() => window.BioVizDemo.ready);
  await page.evaluate((demo) => {
    window.__asked = [];
    const { chart } = window.BioVizDemo;
    chart.setSettings({
      filters: window.BioVizDemo[demo].settings.filters.concat([
        { value_col: 'AGE', label: 'Age' }
      ]),
      connection: {
        run: (asked) => {
          window.__asked.push(asked);
          return Promise.resolve({ status: 'unavailable', reason: 'no-r' });
        }
      }
    });
  }, name);
  return errors;
}

export const asked = (page) => page.evaluate(() => window.__asked.length);

// Sets the two filters with nobody in common, from the controls, one and then
// the other. Returns how many questions R had been put once the first was set:
// four participants pass it alone, and a chart that asks R asks for them.
export async function letNobodyThrough(page) {
  await page.locator('#chart select[data-filter="AGE"]').selectOption('35');
  const before = await asked(page);
  await page.locator('#chart select[data-filter="RESPONSE"]').selectOption('Responder');
  return before;
}

// What the chart says and shows with nobody through: the sentence, in words;
// the note that none of the 200 pass; no chart drawn; the controls all there
// and enabled; and the statistics line empty. Errors that are only R being out
// of reach are not the chart's.
export async function expectNobody(page, errors, { drawn }) {
  await expect(page.locator('#chart .sv-footnote').first()).toHaveText(NOBODY_PASSES);
  await expect(page.locator('#chart .sv-notes').first()).toContainText(
    '0 of 200 participants pass the filters.'
  );
  expect(await page.evaluate(drawn)).toBe(0);
  await expect(page.locator('#chart .sv-main > .bv-statistic').first()).toHaveText('');
  // The controls are all there, and the filters and Reset chart can be used.
  // (A control a view does not offer, such as a test with no groups to test,
  // is disabled by that view, not by the filters.)
  expect(await page.locator('#chart .sv-sidebar select').count()).toBeGreaterThan(3);
  const filters = page.locator('#chart .sv-sidebar select[data-filter]');
  expect(await filters.count()).toBe(4);
  expect(await filters.evaluateAll((all) => all.filter((control) => control.disabled))).toEqual([]);
  await expect(page.locator('#chart .sv-sidebar .sv-reset')).toBeEnabled();
  await expect(page.locator('#chart select[data-filter="AGE"]')).toHaveValue('35');
  await expect(page.locator('#chart select[data-filter="RESPONSE"]')).toHaveValue('Responder');
  expect(errors.filter((message) => !/webr|r-wasm|Failed to load resource/.test(message))).toEqual(
    []
  );
}
