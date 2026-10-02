import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  renderCheckPage,
  renderHome,
  renderShell,
  summarizeModule
} from '../../../scripts/site-lib.mjs';

// Site generators: pure functions scripts/site.mjs assembles into _site/.

const config = {
  repoUrl: 'https://github.com/jwildfire/bio.viz',
  matrixBaseUrl: 'https://github.com/jwildfire/bio.viz/blob/HEAD/requirements',
  modules: [
    {
      module: 'core',
      title: 'Library core',
      status: 'available',
      blurb: 'Entry point & bundles.',
      matrix: 'core.md'
    }
  ]
};

const evidence = {
  records: [
    { test: 'a', suite: 'unit', status: 'pass' },
    { test: 'b', suite: 'unit', status: 'pass' },
    { test: 'c', suite: 'browser', status: 'fail' }
  ]
};

describe('site pages', () => {
  it('escapeHtml escapes the five HTML-significant characters (#1)', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;'
    );
  });

  it('renderShell fills title, description, version and root, and leaves no token behind (#1)', () => {
    const html = renderShell({
      shell:
        '<title>{{title}}</title><meta content="{{description}}"><a href="{{root}}index.html">' +
        'v{{version}}</a><main>{{content}}</main><footer>{{build}}</footer>',
      title: 'bio.viz & friends',
      description: 'A "page"',
      version: '0.1.0',
      root: '../',
      build: 'abc1234',
      content: '<p>body</p>'
    });
    expect(html).toContain('<title>bio.viz &amp; friends</title>');
    expect(html).toContain('content="A &quot;page&quot;"');
    expect(html).toContain('href="../index.html"');
    expect(html).toContain('v0.1.0');
    expect(html).toContain('<main><p>body</p></main>');
    expect(html).not.toMatch(/\{\{\w+\}\}/);
  });

  it('summarizeModule counts requirement rows and passing test records (#1)', () => {
    const summary = summarizeModule({
      requirements: { requirements: { 'CORE-API-001': 'x', 'CORE-DEP-001': 'y' } },
      evidence
    });
    expect(summary).toEqual({ requirements: 2, records: 3, passing: 2 });
    expect(summarizeModule({})).toEqual({ requirements: 0, records: 0, passing: 0 });
  });

  it('CORE-SITE-001: the home page names the library and its version (#1)', () => {
    const html = renderHome({ config, version: '0.1.0', summaries: {} });
    expect(html).toContain('bio.viz');
    expect(html).toContain('0.1.0');
    // The page loads the bundle by its versioned path and has a slot for the
    // version that bundle reports.
    expect(html).toContain('src="dist/bio.viz-0.1.0/bio.viz.js"');
    expect(html).toContain('id="bundle-version"');
  });

  it('the home page lists each registered module with its counts and a link to its matrix (#1)', () => {
    const html = renderHome({
      config,
      version: '0.1.0',
      summaries: { core: { requirements: 6, records: 3, passing: 2 } }
    });
    expect(html).toContain('Library core');
    expect(html).toContain('Entry point &amp; bundles.');
    expect(html).toContain('6 requirements');
    expect(html).toContain('2 of 3 test records passing');
    expect(html).toContain(
      'href="https://github.com/jwildfire/bio.viz/blob/HEAD/requirements/core.md"'
    );
  });

  it('the home page links to the R check page (#3)', () => {
    const html = renderHome({ config, version: '0.1.0', summaries: {} });
    expect(html).toContain('href="r-check/index.html"');
  });
});

describe('R check page', () => {
  const expected = {
    made_by: { r_version: '4.3.3', survival_version: '3.5.8' },
    results: [{ name: 'rank_sum' }, { name: 'log_rank' }]
  };
  const measured = {
    recorded: '2026-10-02T12:00:00.000Z',
    browser: 'Chromium 149.0.7827.55, headless',
    machine: 'a laptop',
    network: 'Wi-Fi',
    profile: 'a new, empty browser profile with a disk cache',
    sizes: 'compressed bytes as received',
    states: {
      cold: {
        megabytes: 26.22,
        bytes: 26220000,
        requests: 12,
        requestsOverNetwork: 12,
        seconds: 3.4
      },
      reload: { megabytes: 0, bytes: 622, requests: 12, requestsOverNetwork: 1, seconds: 2.1 },
      warm: { megabytes: 0, bytes: 0, requests: 0, requestsOverNetwork: 0, seconds: 0.004 }
    }
  };

  it('RCON-PAGE-001: the page has a button that starts R, the stated tolerance and the versions desktop R used (#3)', () => {
    const html = renderCheckPage({ version: '0.1.0', expected, measured });
    expect(html).toContain('<button id="start-r" type="button" disabled>');
    expect(html).toContain('1 part in 10<sup>8</sup>');
    expect(html).toContain('R 4.3.3');
    expect(html).toContain('survival 3.5.8');
    expect(html).toContain('webR 0.6.0');
    // The bundle and the page's module, by relative paths.
    expect(html).toContain('src="../dist/bio.viz-0.1.0/bio.viz.js"');
    expect(html).toContain('<script type="module" src="page.mjs"></script>');
  });

  it('RCON-PAGE-002: the recorded megabytes, requests and seconds are shown for cold, reload and warm, with how they were measured (#3)', () => {
    const html = renderCheckPage({ version: '0.1.0', expected, measured });
    const rowOf = (state) => html.match(new RegExp(`<tr data-state="${state}">.*?</tr>`, 's'))[0];
    const cells = (state) => [...rowOf(state).matchAll(/<td>([^<]*)<\/td>/g)].map((m) => m[1]);
    // megabytes, requests, requests not from cache, seconds
    expect(cells('cold')).toEqual(['26.22', '12', '12', '3.400']);
    expect(cells('reload')).toEqual(['0.00', '12', '1', '2.100']);
    expect(cells('warm')).toEqual(['0.00', '0', '0', '0.004']);
    for (const state of ['Cold', 'Reload', 'Warm']) expect(html).toContain(`>${state}<span`);
    expect(html).toContain('Chromium 149.0.7827.55, headless');
    expect(html).toContain('a laptop');
    expect(html).toContain('network: Wi-Fi');
    expect(html).toContain('2 October 2026');
    expect(html).toContain('a new, empty browser profile with a disk cache');
    expect(html).toContain('compressed bytes as received');
  });

  it('RCON-PAGE-003: with no recorded measurement the page says so and prints no number in its place (#3)', () => {
    const html = renderCheckPage({ version: '0.1.0', expected, measured: undefined });
    expect(html).toContain('No measurement is recorded with this build.');
    expect(html).not.toContain('<td>');
    expect(html).not.toContain('id="recorded-table"');
  });
});
