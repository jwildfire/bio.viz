import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CARD_LIMITS,
  renderDemoPage,
  renderGallery,
  renderHome,
  sentencesOf,
  validateRegistry
} from '../../../scripts/site-lib.mjs';

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
  card: 'Entry point & bundles.',
  blurb: 'The entry point and the two committed bundles, each reporting the package version.',
  matrix: 'core.md',
  api: { doc: 'core.md', surface: ['version'], source: ['src/main.js'] },
  ...overrides
});
const chart = module({
  module: 'group-comparison',
  title: 'Group comparison',
  kind: 'chart',
  demo: 'group-comparison.js',
  card: 'Does this biomarker differ between these groups? One value across the levels of a category.',
  blurb:
    'Does this biomarker differ between these groups? One value across the levels of a category at chosen visits, as boxes, violins or points. Click a box to list its participants.',
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
    // The card is safety.viz's gallery card: the title leads to the live demo,
    // and its links are worded as safety.viz's are.
    expect(charts).toContain('<li class="card" data-module="group-comparison">');
    expect(charts).toContain(
      '<h3><a href="../group-comparison/index.html">Group comparison</a></h3>'
    );
    expect(charts).toContain('One value across the levels of a category.');
    expect(charts).toContain(
      '<p class="card-links"><a href="../group-comparison/index.html">Demo</a> · ' +
        '<a href="../group-comparison/evidence.html">Evidence</a> · ' +
        '<a href="../group-comparison/api.html">API</a></p>'
    );
    // A shared part has no live demo: its title leads to its reference.
    expect(section(html, 'shared-parts')).not.toContain('>Demo</a>');
    expect(section(html, 'shared-parts')).toContain(
      '<h3><a href="../core/api.html">Library core</a></h3>'
    );
    // The list says how many charts it holds.
    expect(charts).toContain('<span class="gallery-count">1 published</span>');
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
    expect(withHero).toContain(
      '<a class="card-thumb" href="../group-comparison/index.html">' +
        '<img src="../group-comparison/evidence/GC-DRAW-001-boxes-by-arm.png" ' +
        'alt="Group comparison: a screenshot captured by its tests"></a>'
    );
  });

  it('CORE-SITE-003: a chart that is registered but not yet available is not listed as published (#7)', () => {
    const html = renderGallery({
      config: config(module(), { ...chart, status: 'planned' }),
      study
    });
    expect(section(html, 'charts')).toContain('No chart is published yet.');
    expect(html).not.toContain('data-module="group-comparison"');
  });

  it('CORE-SITE-016: a chart registered as experimental is published with an Experimental badge and the reason, on its gallery card, on the home page and on its live demo; the committed registry gives the stratified survival chart that status (#78)', () => {
    const experimental = {
      ...chart,
      status: 'experimental',
      statusNote: 'Its estimator awaits its clinical review.'
    };
    // The badge is safety.viz's pill, after the chart's title, and the reason
    // is written out under it; the pill's own title is the reason too.
    const badge =
      ' <span class="site-badge" title="Its estimator awaits its clinical review.">' +
      'Experimental</span>';
    const reason = '<p class="kit-status">Its estimator awaits its clinical review.</p>';
    const gallery = section(
      renderGallery({ config: config(module(), experimental), study }),
      'charts'
    );
    expect(gallery).toContain('data-module="group-comparison"');
    expect(gallery).toContain('<a href="../group-comparison/index.html">Demo</a>');
    expect(gallery).toContain(
      `<h3><a href="../group-comparison/index.html">Group comparison</a>${badge}</h3>${reason}`
    );
    const home = renderHome({
      config: config(module(), experimental),
      version: '0.1.0',
      summaries: {}
    });
    expect(home).toContain('<h2>The first chart</h2>');
    expect(home).toContain(
      `<h3><a href="group-comparison/index.html">Group comparison</a>${badge}</h3>${reason}`
    );
    const demo = renderDemoPage({
      entry: experimental,
      version: '0.1.0',
      study,
      kit: null,
      statistics: null
    });
    expect(demo).toContain(`<h1>Group comparison${badge}</h1>`);
    // The reason is above the tabs and the chart.
    expect(demo.indexOf(reason)).toBeGreaterThan(demo.indexOf('<h1>'));
    expect(demo.indexOf(reason)).toBeLessThan(demo.indexOf('<nav class="page-tabs"'));
    // An available chart carries no badge and no reason.
    const plain = section(renderGallery({ config: config(module(), chart), study }), 'charts');
    expect(plain).not.toContain('site-badge');
    expect(plain).not.toContain('kit-status');
    // The registry takes the status, and asks why.
    expect(validateRegistry(config(experimental))).toEqual([]);
    const { statusNote, ...unsaid } = experimental;
    expect(statusNote).toBeTruthy();
    expect(validateRegistry(config(unsaid)).join('\n')).toMatch(
      /is experimental, and needs `statusNote`/
    );
    // A published chart without a demo is named by its own status.
    const { demo: demoScript, ...undemoed } = experimental;
    expect(demoScript).toBeTruthy();
    expect(validateRegistry(config(undemoed)).join('\n')).toMatch(
      /is an experimental chart, and needs `demo`/
    );
    // A reason is for an experimental module alone.
    expect(validateRegistry(config({ ...chart, statusNote: 'Why.' })).join('\n')).toMatch(
      /has a `statusNote`, and only an experimental module has one/
    );
    const survival = realConfig.modules.find((entry) => entry.module === 'stratified-survival');
    expect(survival.status).toBe('experimental');
    expect(survival.statusNote).toMatch(/kmEstimate|estimator/);
    expect(
      realConfig.modules.filter((entry) => entry.status === 'experimental').map((e) => e.module)
    ).toEqual(['stratified-survival']);
  });

  it('CORE-SITE-023: a card says what its module is in the registry’s card text, at most two sentences and 200 characters, on the gallery and on the home page, and not in the fuller text, which stays at the head of a chart’s live demo; the registry as committed holds every module to it, and the group comparison’s card names its tiles, its picture over time and its single visit (#96)', () => {
    expect(CARD_LIMITS).toEqual({ sentences: 2, characters: 200 });
    // How sentences are counted: by their ends.
    expect(sentencesOf('One. Two? Three!')).toBe(3);
    expect(sentencesOf('R’s p-value, e.g. 0.05, printed.')).toBe(2);
    expect(sentencesOf('No end')).toBe(1);
    expect(sentencesOf('Kaplan–Meier curves per group, at 1.5 times the cut.')).toBe(1);

    // The card prints the card text, escaped, and none of the fuller text.
    const gallery = renderGallery({ config: config(module(), chart), study });
    const home = renderHome({ config: config(module(), chart), version: '0.1.0', summaries: {} });
    for (const html of [gallery, home]) {
      expect(html).toContain(`<p>${chart.card}</p>`);
      expect(html).toContain('<p>Entry point &amp; bundles.</p>');
      expect(html).not.toContain('Click a box to list its participants.');
      expect(html).not.toContain('each reporting the package version');
    }
    // The fuller text is where it was: at the head of the chart's demo page.
    const demo = renderDemoPage({
      entry: chart,
      version: '0.1.0',
      study,
      kit: null,
      statistics: null
    });
    expect(demo).toContain(`<p class="tagline">${chart.blurb}`);

    // The registry as committed: every module, chart or shared part.
    expect(realConfig.modules).toHaveLength(9);
    for (const entry of realConfig.modules) {
      expect(typeof entry.card, entry.module).toBe('string');
      expect(sentencesOf(entry.card), `${entry.module}: ${entry.card}`).toBeLessThanOrEqual(2);
      expect(entry.card.length, `${entry.module}: ${entry.card}`).toBeLessThanOrEqual(200);
      expect(entry.card, entry.module).toMatch(/[.?!]$/);
      // A chart's card opens on the question the chart answers, as its fuller text does.
      if (entry.kind === 'chart') {
        const question = entry.blurb.slice(0, entry.blurb.indexOf('?') + 1);
        expect(question.length, entry.module).toBeGreaterThan(10);
        expect(entry.card.startsWith(question), `${entry.module}: ${entry.card}`).toBe(true);
        expect(entry.blurb.length, entry.module).toBeGreaterThan(entry.card.length);
      }
    }
    const group = realConfig.modules.find((entry) => entry.module === 'group-comparison').card;
    expect(group).toMatch(/tile/i);
    expect(group).toMatch(/across the visits|over time/i);
    expect(group).toMatch(/one visit|a single visit/i);
    expect(group).not.toMatch(/grid/i);
    const real = renderGallery({ config: realConfig, study: realStudy });
    for (const entry of realConfig.modules) {
      expect(real, entry.module).toContain(`<p>${entry.card.replace(/'/g, '&#39;')}</p>`);
    }
  });

  it('CORE-SITE-023: the registry refuses an entry with no card text, with more than two sentences, or with more than 200 characters (#96)', () => {
    const problems = (entry) => validateRegistry(config(entry)).join('\n');
    expect(problems(module())).toBe('');
    expect(problems(chart)).toBe('');
    expect(problems(module({ card: undefined }))).toMatch(
      /module core: needs `card`, what its card says in one or two sentences/
    );
    expect(problems(module({ card: '   ' }))).toMatch(/needs `card`/);
    expect(problems(module({ card: 'One. Two. Three.' }))).toMatch(
      /module core: `card` is 3 sentences; a card holds at most 2\./
    );
    const long = `${'word '.repeat(40)}end.`;
    expect(long.length).toBe(204);
    expect(problems(module({ card: long }))).toMatch(
      /module core: `card` is 204 characters; a card holds at most 200\./
    );
    expect(problems(module({ card: `${'word '.repeat(39)}ends.` }))).toBe('');
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
    expect(one).toContain('<a href="group-comparison/index.html">Demo</a>');
  });

  it('the home page heads its word about the charts for one chart and for several (#26)', () => {
    const second = { ...chart, module: 'association-scatter', title: 'Association scatter' };
    const two = renderHome({
      config: config(module(), chart, second),
      version: '0.1.0',
      summaries: {}
    });
    expect(two).toContain('<h2>The charts</h2>');
    expect(two).not.toContain('The first chart');
    expect(two).toContain('<a href="association-scatter/index.html">Demo</a>');
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
      ['output', 'shared'],
      ['group-comparison', 'chart'],
      ['association-scatter', 'chart'],
      ['correlation-matrix', 'chart'],
      ['biomarker-screen', 'chart'],
      ['cross-tab', 'chart'],
      ['stratified-survival', 'chart']
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
