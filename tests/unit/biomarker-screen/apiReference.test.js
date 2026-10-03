import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkApiReference, surfaceNames } from '../../../scripts/api-lib.mjs';
import { DEFAULT_SETTINGS } from '../../../src/biomarker-screen/configure.js';

// The biomarker screen's API reference (#36): every setting the chart has is a
// row of a table in docs/biomarker-screen.md, with the default the code has.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const config = JSON.parse(readFileSync(path.join(ROOT, 'site/config.json'), 'utf8'));
const entry = config.modules.find((module) => module.module === 'biomarker-screen');
const markdown = readFileSync(path.join(ROOT, 'docs', entry.api.doc), 'utf8');

describe('biomarker screen: the API reference', () => {
  it('BS-SITE-004: the reference names every setting the chart has, with its default, and a setting it leaves out is a problem (#36)', async () => {
    expect(entry).toMatchObject({
      kind: 'chart',
      status: 'available',
      demo: 'biomarker-screen.js',
      matrix: 'biomarker-screen.md',
      api: {
        doc: 'biomarker-screen.md',
        surface: ['biomarkerScreen'],
        source: ['src/biomarker-screen.js'],
        settings: 'src/biomarker-screen/configure.js'
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
    expect(problems([...settings, 'forest'])).toEqual([
      'biomarker-screen: docs/biomarker-screen.md has no table row for the setting `forest`, which the chart has.'
    ]);
    const shown = (value) => (typeof value === 'string' ? `'${value}'` : String(value));
    for (const [setting, value] of Object.entries(DEFAULT_SETTINGS)) {
      const row = markdown.split('\n').find((line) => line.startsWith(`| \`${setting}\` `));
      expect(row, setting).toBeDefined();
      expect(row.split('|')[2].trim(), setting).toBe(`\`${shown(value)}\``);
    }
  });
});
