import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkApiReference, surfaceNames } from '../../../scripts/api-lib.mjs';
import { DEFAULT_SETTINGS } from '../../../src/association-scatter/configure.js';

// The association scatter's API reference (#26): every setting the chart has
// is a row of a table in docs/association-scatter.md, and what the reference
// says of the defaults is what the code has.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const config = JSON.parse(readFileSync(path.join(ROOT, 'site/config.json'), 'utf8'));
const entry = config.modules.find((module) => module.module === 'association-scatter');
const markdown = readFileSync(path.join(ROOT, 'docs', entry.api.doc), 'utf8');

describe('association scatter: the API reference', () => {
  it('AS-SITE-004: the reference names every setting the chart has, with its default, and a setting it leaves out is a problem (#26)', async () => {
    expect(entry).toMatchObject({
      kind: 'chart',
      status: 'available',
      demo: 'association-scatter.js',
      matrix: 'association-scatter.md',
      api: {
        doc: 'association-scatter.md',
        surface: ['associationScatter'],
        source: ['src/association-scatter.js'],
        settings: 'src/association-scatter/configure.js'
      }
    });
    const settings = Object.keys(DEFAULT_SETTINGS);
    expect(settings.length).toBeGreaterThan(30);
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
    expect(problems([...settings, 'span'])).toEqual([
      'association-scatter: docs/association-scatter.md has no table row for the setting `span`, which the chart has.'
    ]);
    // A mention in passing is not a row.
    const renamed = markdown.replace('| `statistic` ', '| `r_function` ');
    expect(renamed).toContain('the setting `statistic` names a function');
    expect(problems(settings, renamed)).toEqual([
      'association-scatter: docs/association-scatter.md has no table row for the setting `statistic`, which the chart has.'
    ]);
    // Each row gives the default the code has.
    const shown = (value) => (typeof value === 'string' ? `'${value}'` : String(value));
    for (const [setting, value] of Object.entries(DEFAULT_SETTINGS)) {
      const row = markdown.split('\n').find((line) => line.startsWith(`| \`${setting}\` `));
      expect(row, setting).toBeDefined();
      expect(row.split('|')[2].trim(), setting).toBe(`\`${shown(value)}\``);
    }
  });
});
