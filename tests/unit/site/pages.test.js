import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
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
});
