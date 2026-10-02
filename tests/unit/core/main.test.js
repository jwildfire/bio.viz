import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as bioViz from '../../../src/main.js';

// Library core (#1): the entry point, and the two committed bundles a page or
// a widget actually loads. The bundle tests read dist/ as committed, so a
// stale or missing build fails here as well as in `npm run build:check-dist`.

const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
const distUrl = (file) => new URL(`../../../dist/bio.viz-${pkg.version}/${file}`, import.meta.url);

describe('bio.viz core', () => {
  it('CORE-API-001: src/main.js exports version equal to the package version (#1)', () => {
    expect(bioViz.version).toBe(pkg.version);
  });

  it('CORE-BUILD-001: the committed IIFE bundle defines the global BioViz (#1)', () => {
    const context = {};
    vm.runInNewContext(readFileSync(distUrl('bio.viz.js'), 'utf8'), context);
    expect(typeof context.BioViz).toBe('object');
  });

  it('CORE-API-001: BioViz.version in the committed IIFE bundle equals the package version (#1)', () => {
    const context = {};
    vm.runInNewContext(readFileSync(distUrl('bio.viz.js'), 'utf8'), context);
    expect(context.BioViz.version).toBe(pkg.version);
  });

  it('CORE-BUILD-002: the committed ESM bundle has the same exports as the IIFE bundle (#1)', async () => {
    const context = {};
    vm.runInNewContext(readFileSync(distUrl('bio.viz.js'), 'utf8'), context);
    const esm = await import(/* @vite-ignore */ distUrl('bio.viz.esm.js').href);
    expect(Object.keys(esm).sort()).toEqual(Object.keys(context.BioViz).sort());
    expect(Object.keys(esm)).toContain('version');
  });

  it('CORE-API-001: version in the committed ESM bundle equals the package version (#1)', async () => {
    const esm = await import(/* @vite-ignore */ distUrl('bio.viz.esm.js').href);
    expect(esm.version).toBe(pkg.version);
  });

  it('CORE-DEP-001: package.json declares no runtime dependencies (#1)', () => {
    // safety.viz and webR are loaded beside the bundle on a page, never bundled
    // into it; a runtime dependency here would pull one of them into the build.
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });
});
