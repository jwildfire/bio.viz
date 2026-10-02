import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkApiReference, surfaceNames } from '../../../scripts/api-lib.mjs';
import { DEFAULT_SETTINGS } from '../../../src/correlation-matrix/configure.js';

// The correlation matrix's API reference (#27): every setting the chart has is
// a row of a table in docs/correlation-matrix.md, and what the reference says
// of the defaults is what the code has.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const config = JSON.parse(readFileSync(path.join(ROOT, 'site/config.json'), 'utf8'));
const entry = config.modules.find((module) => module.module === 'correlation-matrix');
const markdown = readFileSync(path.join(ROOT, 'docs', entry.api.doc), 'utf8');

describe('correlation matrix: the API reference', () => {
  it('CM-SITE-004: the reference names every setting the chart has, with its default, and a setting it leaves out is a problem (#27)', async () => {
    expect(entry).toMatchObject({
      kind: 'chart',
      status: 'available',
      demo: 'correlation-matrix.js',
      matrix: 'correlation-matrix.md',
      api: {
        doc: 'correlation-matrix.md',
        surface: ['correlationMatrix'],
        source: ['src/correlation-matrix.js'],
        settings: 'src/correlation-matrix/configure.js'
      }
    });
    const settings = Object.keys(DEFAULT_SETTINGS);
    expect(settings.length).toBeGreaterThan(25);
    const committed = await import(
      /* @vite-ignore */ `${ROOT}/dist/bio.viz-${pkg.version}/bio.viz.esm.js`
    );
    const names = surfaceNames(committed, entry.api.surface);
    const problems = (given, text = markdown) =>
      checkApiReference({
        module: entry.module,
        doc: `docs/${entry.api.doc}`,
        markdown: text,
        names,
        settings: given
      });
    expect(problems(settings)).toEqual([]);
    expect(problems([...settings, 'cluster'])).toEqual([
      'correlation-matrix: docs/correlation-matrix.md has no table row for the setting `cluster`, which the chart has.'
    ]);
    // A mention in passing is not a row.
    const renamed = markdown.replace('| `limit` ', '| `cap` ');
    expect(renamed).toContain('sets `limit` higher');
    expect(problems(settings, renamed)).toEqual([
      'correlation-matrix: docs/correlation-matrix.md has no table row for the setting `limit`, which the chart has.'
    ]);
    // Each row gives the default the code has.
    const shown = (value) => (typeof value === 'string' ? `'${value}'` : String(value));
    for (const [setting, value] of Object.entries(DEFAULT_SETTINGS)) {
      const row = markdown.split('\n').find((line) => line.startsWith(`| \`${setting}\` `));
      expect(row, setting).toBeDefined();
      expect(row.split('|')[2].trim(), setting).toBe(`\`${shown(value)}\``);
    }
    // The reference says what was measured for the limit, and the limit it measured for.
    expect(DEFAULT_SETTINGS.limit).toBe(12);
    expect(markdown).toMatch(/\| 12 +\| 66 +\|/);
    expect(markdown).toMatch(/\| 36 +\| 630 +\|/);
  });
});
