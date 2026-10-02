import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkApiReference,
  jsdocParams,
  readSources,
  surfaceNames,
  unclaimedExports
} from '../../../scripts/api-lib.mjs';
import { renderApiPage } from '../../../scripts/site-lib.mjs';

// The API reference (#7): a module's reference file in docs/, rendered, and the
// checks that hold that file to the code.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const config = JSON.parse(readFileSync(path.join(ROOT, 'site/config.json'), 'utf8'));
const committedBundle = () =>
  import(/* @vite-ignore */ `${ROOT}/dist/bio.viz-${pkg.version}/bio.viz.esm.js`);

const bundle = {
  version: '0.1.0',
  r: { createConnection() {}, formatStatistic() {}, WEBR_VERSION: '0.6.0' }
};
const entry = {
  module: 'r-connection',
  title: 'Connection to R',
  api: { doc: 'r-connection.md', surface: ['r'], source: ['src/r'] }
};
const reference = [
  '# The connection to R',
  '',
  'How a chart gets a statistic.',
  '',
  '## `createConnection(options)`',
  '',
  '| Option | Meaning |',
  '| --- | --- |',
  '| `results` | Stored results. |',
  '| `browser.sourceUrl` | Where the R source is. |',
  '',
  '## `connection.run(name, { data })`',
  '',
  'See [stored results](#stored-results) and [the core](core.md).',
  '',
  '## `formatStatistic(statistic)`',
  '',
  '```js',
  '# a comment, not a heading: oldName(x)',
  '```',
  '',
  '## `WEBR_VERSION`',
  '',
  'The version, `0.6.0`.',
  '',
  '## Stored results',
  '',
  'Text.'
].join('\n');
const source = `
/**
 * Makes a connection.
 * @param {object} [options]
 * @param {Array<{name: string, value: *}>} [options.results] Stored results.
 * @param {{start: Function,
 *   call: Function}} [options.browser.sourceUrl] Where the R source is.
 * @returns {{run: function(string): Promise<object>}}
 */
export function createConnection(options = {}) {}

/** Not exported, so not held to the reference. @param {string} secret */
function helper(secret) {}

/**
 * @param {{method?: string,
 *   p_value?: number}} statistic What R returned.
 */
export function formatStatistic(statistic) {}
`;
const check = (overrides = {}) =>
  checkApiReference({
    module: 'r-connection',
    doc: 'docs/r-connection.md',
    markdown: reference,
    names: surfaceNames(bundle, ['r']),
    params: jsdocParams(source),
    ...overrides
  });

describe('API reference page', () => {
  const page = renderApiPage({
    entry,
    config: { repoUrl: 'https://github.com/jwildfire/bio.viz' },
    markdown: reference,
    pages: { 'core.md': '../core/api.html' }
  });

  it('CORE-SITE-009: the page is the reference file, rendered: its title, sections, tables and code (#7)', () => {
    expect(page).toContain('<h1>The connection to R</h1>');
    expect(page.match(/<h1/g)).toHaveLength(1);
    expect(page).toContain('<p>How a chart gets a statistic.</p>');
    expect(page).toContain(
      '<h2 id="createconnectionoptions"><code>createConnection(options)</code></h2>'
    );
    expect(page).toContain('<td data-label="Option"><code>browser.sourceUrl</code></td>');
    expect(page).toContain('<pre><code class="language-js"># a comment, not a heading');
  });

  it('CORE-SITE-009: the sections are listed at the top, each linked to its place on the page (#7)', () => {
    const contents = page.match(/<nav class="api-toc"[\s\S]*?<\/nav>/)[0];
    expect([...contents.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])).toEqual([
      'createconnectionoptions',
      'connectionrunname--data-',
      'formatstatisticstatistic',
      'webr_version',
      'stored-results'
    ]);
    for (const [, id] of contents.matchAll(/href="#([^"]+)"/g)) {
      expect(page).toContain(`id="${id}"`);
    }
  });

  it('CORE-SITE-009: a link to another reference file goes to that module’s page, and the page names the file it was rendered from (#7)', () => {
    expect(page).toContain('<a href="../core/api.html">the core</a>');
    expect(page).toContain('<a href="#stored-results">stored results</a>');
    expect(page).toContain(
      'href="https://github.com/jwildfire/bio.viz/blob/HEAD/docs/r-connection.md"'
    );
    expect(page).toContain('href="evidence.html"');
  });
});

describe('API reference: held to the code', () => {
  it('CORE-SITE-010: a reference that documents every export, parameter and constant has no problems (#7)', () => {
    expect(check()).toEqual([]);
  });

  it('CORE-SITE-010: a namespace in the surface stands for each of its members, and a constant carries its value (#7)', () => {
    expect(surfaceNames(bundle, ['version', 'r'])).toEqual([
      { name: 'version', path: 'version', value: '0.1.0' },
      { name: 'createConnection', path: 'r.createConnection' },
      { name: 'formatStatistic', path: 'r.formatStatistic' },
      { name: 'WEBR_VERSION', path: 'r.WEBR_VERSION', value: '0.6.0' }
    ]);
  });

  it('CORE-SITE-010: an export with no heading in the reference is a problem (#7)', () => {
    const grown = { ...bundle, r: { ...bundle.r, compareGroups() {} } };
    expect(check({ names: surfaceNames(grown, ['r']) })).toEqual([
      'r-connection: docs/r-connection.md has no heading for `r.compareGroups`, which the bundle exports.'
    ]);
  });

  it('CORE-SITE-010: a function the reference documents that the bundle does not export is a problem (#7)', () => {
    const shrunk = { r: { createConnection() {}, WEBR_VERSION: '0.6.0' } };
    expect(check({ names: surfaceNames(shrunk, ['r']) })).toEqual([
      'r-connection: docs/r-connection.md documents `formatStatistic()`, which the bundle does not export.'
    ]);
  });

  it('CORE-SITE-010: a parameter the source documents and the reference leaves out is a problem (#7)', () => {
    expect(jsdocParams(source)).toEqual({
      createConnection: ['options', 'options.results', 'options.browser.sourceUrl'],
      formatStatistic: ['statistic']
    });
    const added = source.replace(
      ' * @returns',
      ' * @param {number} [options.browser.timeout] How long to wait.\n * @returns'
    );
    expect(check({ params: jsdocParams(added) })).toEqual([
      'r-connection: docs/r-connection.md does not name `options.browser.timeout`, a parameter the source documents for `createConnection`.'
    ]);
    // A renamed first parameter no longer matches the heading's signature.
    expect(check({ params: { formatStatistic: ['result'] } }).join('\n')).toMatch(
      /does not name `result`/
    );
  });

  it('CORE-SITE-010: a constant whose value the reference does not give is a problem (#7)', () => {
    const moved = { r: { ...bundle.r, WEBR_VERSION: '0.7.0' } };
    expect(check({ names: surfaceNames(moved, ['r']) })).toEqual([
      'r-connection: docs/r-connection.md does not give the value of `r.WEBR_VERSION`, which is 0.7.0.'
    ]);
  });

  it('CORE-SITE-010: an export no module claims, a surface the bundle lacks and an empty surface are each a problem (#7)', () => {
    const modules = [{ api: { surface: ['r'] } }, { module: 'bare' }];
    expect(unclaimedExports({ ...bundle, core: {} }, modules)).toEqual(['core', 'version']);
    expect(unclaimedExports(bundle, [...modules, { api: { surface: ['version'] } }])).toEqual([]);
    expect(check({ names: surfaceNames(bundle, ['r', 'charts']) }).join('\n')).toMatch(
      /lists `charts`, which the bundle does not export/
    );
    expect(check({ names: [] }).join('\n')).toMatch(/documents nothing/);
  });

  it('CORE-SITE-010: the committed references document everything the committed bundle exports (#7)', async () => {
    const committed = await committedBundle();
    expect(unclaimedExports(committed, config.modules)).toEqual([]);
    for (const { module, api } of config.modules) {
      const names = surfaceNames(committed, api.surface);
      expect(names.length).toBeGreaterThan(0);
      expect(
        checkApiReference({
          module,
          doc: `docs/${api.doc}`,
          markdown: readFileSync(path.join(ROOT, 'docs', api.doc), 'utf8'),
          names,
          params: jsdocParams(readSources(ROOT, api.source))
        })
      ).toEqual([]);
    }
  });

  it('CORE-SITE-010: the connection’s reference is held to the parameters its source documents (#7)', () => {
    const params = jsdocParams(readSources(ROOT, ['src/r']));
    expect(params.createConnection).toEqual([
      'options',
      'options.results',
      'options.browser',
      'options.browser.source',
      'options.browser.sourceUrl',
      'options.browser.packages',
      'options.browser.baseUrl',
      'options.browser.engine'
    ]);
    expect(params.formatStatistic).toEqual(['statistic']);
  });
});
