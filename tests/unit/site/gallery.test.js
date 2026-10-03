import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderGallery, renderHome, validateRegistry } from '../../../scripts/site-lib.mjs';

// The gallery and the registry that drives it (#7).

const realConfig = JSON.parse(
  readFileSync(new URL('../../../site/config.json', import.meta.url), 'utf8')
);
const realStudy = JSON.parse(
  readFileSync(new URL('../../../site/data/synthetic-study/SOURCE.json', import.meta.url), 'utf8')
);

const module = (overrides) => ({
  module: 'core',
  title: 'Library core',
  kind: 'shared',
  status: 'available',
  blurb: 'Entry point & bundles.',
  matrix: 'core.md',
  api: { doc: 'core.md', surface: ['version'], source: ['src/main.js'] },
  ...overrides
});
const chart = module({
  module: 'group-comparison',
  title: 'Group comparison',
  kind: 'chart',
  demo: 'group-comparison.js',
  blurb: 'One value across the levels of a category.',
  matrix: 'group-comparison.md',
  api: { doc: 'group-comparison.md', surface: ['groupComparison'], source: ['src/group'] }
});
const config = (...modules) => ({
  repoUrl: 'https://github.com/jwildfire/bio.viz',
  matrixBaseUrl: 'https://github.com/jwildfire/bio.viz/blob/HEAD/requirements',
  modules
});
const study = {
  repository: 'https://github.com/jwildfire/gsm.bio',
  commit: '0123456789abcdef0123456789abcdef01234567',
  license: 'Apache License (>= 2)',
  files: [
    { file: 'synthetic_results.csv', rows: 11472, columns: ['USUBJID', 'TEST'] },
    { file: 'synthetic_participants.csv', rows: 200, columns: ['USUBJID', 'ARM'] },
    { file: 'synthetic_outcomes.csv', rows: 200, columns: ['USUBJID', 'AVAL'] }
  ]
};

const section = (html, id) => html.match(new RegExp(`<section id="${id}">[\\s\\S]*?</section>`))[0];

describe('gallery', () => {
  it('CORE-SITE-003: with no chart registered the gallery says that no chart is published yet (#7)', () => {
    const html = renderGallery({ config: config(module()), study });
    expect(section(html, 'charts')).toContain('No chart is published yet.');
    expect(section(html, 'charts')).toContain('id="no-charts"');
    expect(section(html, 'charts')).not.toContain('data-module=');
  });

  it('CORE-SITE-003: a registered chart is listed under Charts with links to its evidence page and API reference (#7)', () => {
    const html = renderGallery({ config: config(module(), chart), study });
    const charts = section(html, 'charts');
    expect(charts).not.toContain('No chart is published yet.');
    expect(charts).toContain('data-module="group-comparison"');
    expect(charts).toContain('<h3>Group comparison</h3>');
    expect(charts).toContain('One value across the levels of a category.');
    expect(charts).toContain('href="../group-comparison/evidence.html"');
    expect(charts).toContain('href="../group-comparison/api.html"');
    // A chart has a live demo, and its card leads to it.
    expect(charts).toContain('<a href="../group-comparison/index.html">Live demo</a>');
    expect(section(html, 'shared-parts')).not.toContain('Live demo');
    // The shared part stays out of the list of charts.
    expect(charts).not.toContain('data-module="core"');
  });

  it('CORE-SITE-003: a chart’s card shows its picture once that screenshot is committed, and no picture before (#9)', () => {
    const without = section(renderGallery({ config: config(module(), chart), study }), 'charts');
    expect(without).not.toContain('<img');
    const withHero = section(
      renderGallery({
        config: config(module(), chart),
        study,
        heroes: { 'group-comparison': 'GC-DRAW-001-boxes-by-arm.png' }
      }),
      'charts'
    );
    expect(withHero).toContain('src="../group-comparison/evidence/GC-DRAW-001-boxes-by-arm.png"');
    expect(withHero).toContain('alt="Group comparison: a screenshot captured by its tests"');
  });

  it('CORE-SITE-003: a chart that is registered but not yet available is not listed as published (#7)', () => {
    const html = renderGallery({
      config: config(module(), { ...chart, status: 'planned' }),
      study
    });
    expect(section(html, 'charts')).toContain('No chart is published yet.');
    expect(html).not.toContain('data-module="group-comparison"');
  });

  it('CORE-SITE-004: each shared part is listed with links to its evidence page and API reference (#7)', () => {
    const html = renderGallery({ config: config(module(), chart), study });
    const shared = section(html, 'shared-parts');
    expect(shared).toContain('data-module="core"');
    expect(shared).toContain('Entry point &amp; bundles.');
    expect(shared).toContain('href="../core/evidence.html"');
    expect(shared).toContain('href="../core/api.html"');
    expect(shared).not.toContain('data-module="group-comparison"');
  });

  it('CORE-SITE-004: the registry as committed lists the core and the connection to R as shared parts (#7)', () => {
    const html = renderGallery({ config: realConfig, study: realStudy });
    const shared = section(html, 'shared-parts');
    for (const name of ['core', 'r-connection']) {
      expect(shared).toContain(`href="../${name}/evidence.html"`);
      expect(shared).toContain(`href="../${name}/api.html"`);
    }
  });

  it('CORE-SITE-015: the gallery says what each table of the synthetic study holds, its rows, and the commit it was copied from (#7)', () => {
    const html = section(renderGallery({ config: config(module()), study }), 'demo-data');
    expect(html).toContain('One row per participant, biomarker and visit: 11,472 rows.');
    expect(html).toContain('One row per participant: 200 rows.');
    expect(html).toContain('One row per participant and endpoint: 200 rows.');
    expect(html).toContain('href="../data/synthetic-study/synthetic_results.csv"');
    expect(html).toContain('href="../data/synthetic-study/SOURCE.json"');
    expect(html).toContain('<code>USUBJID</code>, <code>TEST</code>');
    expect(html).toContain(
      'href="https://github.com/jwildfire/gsm.bio/tree/0123456789abcdef0123456789abcdef01234567/inst/extdata"'
    );
    expect(html).toContain('<code>0123456</code>');
    expect(html).toContain('No real participant');
  });

  it('the home page says there are no charts yet only while none is published (#9)', () => {
    const none = renderHome({ config: config(module()), version: '0.1.0', summaries: {} });
    expect(none).toContain('<h2>No charts yet</h2>');
    const one = renderHome({ config: config(module(), chart), version: '0.1.0', summaries: {} });
    expect(one).not.toContain('No charts yet');
    expect(one).toContain('<h2>The first chart</h2>');
    expect(one).toContain('href="group-comparison/index.html">Live demo</a>');
  });

  it('the home page heads its callout for one chart and for several (#26)', () => {
    const second = { ...chart, module: 'association-scatter', title: 'Association scatter' };
    const two = renderHome({
      config: config(module(), chart, second),
      version: '0.1.0',
      summaries: {}
    });
    expect(two).toContain('<h2>The charts</h2>');
    expect(two).not.toContain('The first chart');
    expect(two).toContain('href="association-scatter/index.html">Live demo</a>');
  });

  it('the home page links each module’s evidence page and API reference, and the gallery (#7)', () => {
    const html = renderHome({ config: config(module()), version: '0.1.0', summaries: {} });
    expect(html).toContain('href="core/evidence.html"');
    expect(html).toContain('href="core/api.html"');
    expect(html).toContain('href="gallery/index.html"');
  });
});

describe('module registry', () => {
  it('CORE-SITE-005: the registry as committed is well formed (#7)', () => {
    expect(validateRegistry(realConfig)).toEqual([]);
    expect(realConfig.modules.map((entry) => [entry.module, entry.kind])).toEqual([
      ['core', 'shared'],
      ['r-connection', 'shared'],
      ['group-comparison', 'chart'],
      ['association-scatter', 'chart'],
      ['correlation-matrix', 'chart'],
      ['biomarker-screen', 'chart']
    ]);
  });

  it('CORE-SITE-005: an entry that does not say whether it is a chart or a shared part is refused (#7)', () => {
    const { kind, ...unkinded } = module();
    expect(kind).toBe('shared');
    expect(validateRegistry(config(unkinded)).join('\n')).toMatch(
      /module core: `kind` must be one of chart, shared/
    );
    expect(validateRegistry(config(module({ kind: 'widget' }))).join('\n')).toMatch(/`kind`/);
  });

  it('CORE-SITE-005: an entry without its matrix or its API reference is refused, as is a name registered twice (#7)', () => {
    const problems = (entry) => validateRegistry(config(entry)).join('\n');
    expect(problems(module({ matrix: undefined }))).toMatch(/needs `matrix`/);
    expect(problems(module({ api: undefined }))).toMatch(/needs `api\.doc`/);
    expect(problems(module({ api: { doc: 'core.md', surface: [], source: ['src'] } }))).toMatch(
      /needs `api\.surface`/
    );
    expect(problems(module({ api: { doc: 'core.md', surface: ['version'] } }))).toMatch(
      /needs `api\.source`/
    );
    expect(problems(module({ status: 'done' }))).toMatch(/`status` must be one of/);
    expect(problems(module({ module: 'Core Module' }))).toMatch(/lower-case name/);
    expect(validateRegistry(config(module(), module())).join('\n')).toMatch(/registered twice/);
    expect(validateRegistry({ modules: [] })).toEqual(['site/config.json registers no modules.']);
    // A chart that is available names its demo; a shared part has none.
    const { demo, ...undemoed } = chart;
    expect(demo).toBe('group-comparison.js');
    expect(problems(undemoed)).toMatch(/is an available chart, and needs `demo`/);
    expect(problems({ ...undemoed, status: 'planned' })).toBe('');
    expect(problems(module({ demo: 'core.js' }))).toMatch(/has a `demo`, and only a chart has one/);
    expect(problems({ ...chart, hero: 'boxes.jpg' })).toMatch(/`hero`, when given, is the name/);
    expect(problems({ ...chart, api: { ...chart.api, settings: 5 } })).toMatch(/`api\.settings`/);
    expect(problems(chart)).toBe('');
  });
});
