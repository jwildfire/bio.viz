import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkApiReference, surfaceNames } from '../../../scripts/api-lib.mjs';
import { DEFAULT_SETTINGS } from '../../../src/stratified-survival/configure.js';

// The stratified survival chart's API reference (#61): every setting the chart has is a
// row of a table in docs/stratified-survival.md, with the default the code has.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const config = JSON.parse(readFileSync(path.join(ROOT, 'site/config.json'), 'utf8'));
const entry = config.modules.find((module) => module.module === 'stratified-survival');
const markdown = readFileSync(path.join(ROOT, 'docs', entry.api.doc), 'utf8');

describe('stratified survival: the API reference', () => {
  it('SS-SITE-003: the reference names every setting the chart has, with its default, and a setting it leaves out is a problem (#61)', async () => {
    expect(entry).toMatchObject({
      kind: 'chart',
      status: 'available',
      demo: 'stratified-survival.js',
      matrix: 'stratified-survival.md',
      api: {
        doc: 'stratified-survival.md',
        surface: ['stratifiedSurvival'],
        source: ['src/stratified-survival.js'],
        settings: 'src/stratified-survival/configure.js'
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
    expect(problems([...settings, 'margins'])).toEqual([
      'stratified-survival: docs/stratified-survival.md has no table row for the setting `margins`, which the chart has.'
    ]);
    const shown = (value) => (typeof value === 'string' ? `'${value}'` : String(value));
    for (const [setting, value] of Object.entries(DEFAULT_SETTINGS)) {
      const row = markdown.split('\n').find((line) => line.startsWith(`| \`${setting}\` `));
      expect(row, setting).toBeDefined();
      expect(row.split('|')[2].trim(), setting).toBe(`\`${shown(value)}\``);
    }
  });
});
