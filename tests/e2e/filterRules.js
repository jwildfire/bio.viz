import { expect } from '@playwright/test';

// The filter rules every chart shares with safety.viz's (#37), read the way the
// kit reads a spec: `start` sets what a filter opens on and All stays on offer;
// only `all: false` removes All, and then the first value is selected and the
// chart filters by it; a selection the data lacks falls back to All with a
// console warning. The selection a control shows is the one the chart filters by.

// Three filters that put each rule to work.
export const RULED_FILTERS = [
  { value_col: 'SEX', label: 'Sex', start: 'F' },
  { value_col: 'ARM', label: 'Arm', all: false },
  { value_col: 'RESPONSE', label: 'Response', start: 'Nobody' }
];

// Women in the Placebo arm: 13 responders and 31 non-responders.
export const RULED_COUNT = 44;

export const RULED_WARNING =
  'The [ Response ] filter value [ Nobody ] does not exist in the data, so the filter opens on All.';

// Holds a chart, already made with `RULED_FILTERS` on its fixture page, to the
// rules. `stateOf` reads the chart's own filter state from the page.
export async function expectFilterRules(page, warnings, stateOf) {
  const select = (column) => page.locator(`#chart select[data-filter="${column}"]`).first();
  const options = (column) =>
    select(column)
      .locator('option')
      .evaluateAll((all) => all.map((found) => found.value));
  // `start` opens the filter on its value, and All is still offered.
  await expect(select('SEX')).toHaveValue('F');
  expect(await options('SEX')).toContain('__all__');
  // `all: false` removes All, and the first value is both shown and in force.
  await expect(select('ARM')).toHaveValue('Placebo');
  expect(await options('ARM')).not.toContain('__all__');
  // A start the data lacks falls back to All, and says so once.
  await expect(select('RESPONSE')).toHaveValue('__all__');
  expect(warnings.filter((text) => text === RULED_WARNING)).toHaveLength(1);
  // The chart filters by what the controls show.
  expect(await page.evaluate(stateOf)).toEqual({ SEX: 'F', ARM: 'Placebo', RESPONSE: null });
  await expect(page.locator('#chart .sv-notes').first()).toContainText(
    `${RULED_COUNT} of 200 participants pass the filters.`
  );
  // All is on offer for the started filter, and choosing it lets every sex through.
  await select('SEX').selectOption('__all__');
  await expect(page.locator('#chart .sv-notes').first()).toContainText(
    '100 of 200 participants pass the filters.'
  );
  expect(await page.evaluate(stateOf)).toEqual({ SEX: null, ARM: 'Placebo', RESPONSE: null });
}

// Every console warning, as the page writes it.
export function warningsOf(page) {
  const warnings = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  return warnings;
}
