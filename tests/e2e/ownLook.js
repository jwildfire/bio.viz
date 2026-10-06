// A chart's own look on a page that styles by tag (#97).
//
// The site's stylesheet is safety.viz's, and safety.viz's demo app has the
// same rules: every `table`, `th` and `td`, and every `h1` to `h4`, is styled
// by its tag alone. A chart is made of the same tags, so a table or a heading
// of a chart's own must say how it looks, or it is restyled by whatever page
// the chart is put in. These helpers read how a part looks, so a test can hold
// it to the same on a page with no stylesheet and on one that styles by tag.

import { expect } from '@playwright/test';

// What a look is: every property the copied stylesheet's tag rules set, on a
// table, a heading or a cell, with the ones a part inherits them through.
const PROPERTIES = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'textTransform',
  'color',
  'backgroundColor',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderTopStyle',
  'borderBottomStyle',
  'borderTopColor',
  'borderBottomColor',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'textAlign',
  'verticalAlign',
  'boxSizing',
  'borderCollapse'
];

// The copied stylesheet, as the site publishes it. The browser suite serves
// the repository's root, so a test page can be given it without the site.
export const SITE_STYLES = '/site/vendor/safety.viz-site/site.css';

/**
 * How each named part looks. `parts` maps a name to a selector; the first
 * element a selector finds is read, and a selector that finds none is an
 * error, so a test cannot pass by reading nothing.
 */
export function lookOf(page, parts) {
  return page.evaluate(
    ({ parts, properties }) =>
      Object.fromEntries(
        Object.entries(parts).map(([name, selector]) => {
          const element = document.querySelector(selector);
          if (!element) throw new Error(`No part of the page is ${selector} (${name}).`);
          const style = getComputedStyle(element);
          return [name, Object.fromEntries(properties.map((key) => [key, style[key]]))];
        })
      ),
    { parts, properties: PROPERTIES }
  );
}

/**
 * How the page draws a table and a heading that say nothing of themselves:
 * the proof that it styles them by tag. A test that holds a chart's part to
 * its own look reads this first, so it is not passing on a page that has
 * stopped styling tables.
 */
export function byTag(page) {
  return page.evaluate(() => {
    const holder = document.createElement('div');
    holder.innerHTML =
      '<table><thead><tr><th>Heading</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table><h3>Title</h3>';
    document.body.append(holder);
    const of = (selector) => getComputedStyle(holder.querySelector(selector));
    const read = {
      heading: {
        transform: of('th').textTransform,
        spacing: of('th').letterSpacing,
        rule: of('th').borderLeftWidth
      },
      cell: { rule: of('td').borderLeftWidth },
      table: { margin: of('table').marginTop },
      title: { weight: of('h3').fontWeight, face: of('h3').fontFamily }
    };
    holder.remove();
    return read;
  });
}

// What `byTag` reads on a page that carries the copied stylesheet.
export const STYLED_BY_TAG = {
  heading: {
    transform: 'uppercase',
    spacing: expect.stringMatching(/^\d+(\.\d+)?px$/),
    rule: '1px'
  },
  cell: { rule: '1px' },
  table: { margin: '16px' },
  title: { weight: '400', face: expect.stringMatching(/Instrument Serif/) }
};

/** Gives a test page the copied stylesheet, as a demo page has it. */
export async function wearSiteStyles(page) {
  await page.addStyleTag({ url: SITE_STYLES });
  await page.evaluate(() => document.fonts.ready);
}

/** The width and height of a part, to the pixel. */
export function boxOf(page, selector) {
  return page.locator(selector).evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { width: Math.round(box.width), height: Math.round(box.height) };
  });
}

/**
 * What `read` returns with the copied stylesheet switched off on a page that
 * carries it, as a demo page does; the stylesheet is switched back on after.
 * For a size, which a test page cannot give: a demo names its columns, so its
 * table is not the width of the test page's.
 */
export async function withoutSiteStyles(page, read) {
  const sheet = page.locator('link[rel="stylesheet"][href*="safety.viz-site/site.css"]');
  await expect(sheet).toHaveCount(1);
  await sheet.evaluate((link) => (link.disabled = true));
  const value = await read();
  await sheet.evaluate((link) => (link.disabled = false));
  return value;
}
