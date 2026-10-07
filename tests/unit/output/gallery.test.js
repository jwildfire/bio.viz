import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { moduleForFile } from '../../../scripts/evidence-lib.mjs';

// The gallery shows each chart as a reader of a figure sees it: with its title,
// subtitle and footnotes, its own last (#66, the gallery clause of hub#361).

const ROOT = new URL('../../../', import.meta.url);
const config = JSON.parse(readFileSync(new URL('site/config.json', ROOT), 'utf8'));
const charts = config.modules.filter((entry) => entry.kind === 'chart');
const modules = config.modules.map((entry) => entry.module);
const specs = readdirSync(new URL('tests/e2e/', ROOT)).filter((file) => file.endsWith('.spec.js'));
const specOf = (module) =>
  specs.filter((file) => moduleForFile(`tests/e2e/${file}`, modules) === module);

describe('getting results out: the gallery', () => {
  it('EXP-SITE-002: every chart’s picture in the gallery is a capture taken by captureGallery, which holds the capture to the chart’s frame with its title and its own footnote inside it; a view that asks R for nothing, the group comparison’s opening tiles, is captured with a footnote that says so (#66, #108)', () => {
    expect(charts).toHaveLength(6);
    for (const chart of charts) {
      const match = /^([A-Z]+-DRAW-001)-as-the-gallery-shows-it\.png$/.exec(chart.hero || '');
      expect(match, `${chart.module}: hero ${chart.hero}`).not.toBe(null);
      const [, id] = match;
      const sources = specOf(chart.module).map((file) =>
        readFileSync(new URL(`tests/e2e/${file}`, ROOT), 'utf8')
      );
      expect(sources.length, chart.module).toBeGreaterThan(0);
      expect(
        sources.some((source) => new RegExp(`captureGallery\\([^;]*'${id}'`).test(source)),
        `${chart.module}: no captureGallery(…, '${id}') in its spec`
      ).toBe(true);
    }
    // The helper holds a capture to a frame with a title and the chart's own
    // footnote, once R has answered.
    const helper = readFileSync(new URL('tests/e2e/evidence.js', ROOT), 'utf8');
    const body = helper.slice(helper.indexOf('export async function captureGallery'));
    expect(body).toContain('.bv-title');
    expect(body).toContain('.bv-foot-line[data-automatic="true"]');
    expect(body).toContain("'as-the-gallery-shows-it'");
    expect(body).toContain('.bv-no-picture{display:none');
    expect(body).toContain("not.toContainText('unavailable')");
    // A view that prints no statistic is captured only when its footnote says
    // R was asked for none, and one chart is: the group comparison, whose
    // picture is the view it opens on, the trend tiles (#108).
    expect(body).toContain("toContainText('No statistic was asked of R.')");
    const unasked = charts.filter((chart) =>
      specOf(chart.module).some((file) =>
        /captureGallery\([^;]*statistics: false/.test(
          readFileSync(new URL(`tests/e2e/${file}`, ROOT), 'utf8')
        )
      )
    );
    expect(unasked.map((chart) => chart.module)).toEqual(['group-comparison']);
  });
});
