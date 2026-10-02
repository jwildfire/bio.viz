import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// What ships (#9): the chart is in both committed bundles, and safety.viz and
// Chart.js are in neither. They are loaded beside bio.viz on the page.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const dist = (file) => path.join(ROOT, `dist/bio.viz-${pkg.version}`, file);

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const file = path.join(dir, entry);
    if (statSync(file).isDirectory()) return sourceFiles(file);
    return file.endsWith('.js') ? [file] : [];
  });
}

describe('bundle: the chart ships, safety.viz and Chart.js do not', () => {
  it('GC-KIT-006: the build takes in only files under src/, and no source file imports from outside it (#9)', async () => {
    const result = await build({
      entryPoints: ['src/main.js'],
      absWorkingDir: ROOT,
      bundle: true,
      write: false,
      metafile: true,
      format: 'esm',
      logLevel: 'silent',
      define: { __BIO_VIZ_VERSION__: JSON.stringify(pkg.version) }
    });
    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs).toContain('src/group-comparison.js');
    expect(inputs.filter((input) => !input.startsWith('src/'))).toEqual([]);
    expect(inputs.filter((input) => input.includes('node_modules'))).toEqual([]);

    // Every import in the source is of a file beside it: none of a package.
    const imports = sourceFiles(path.join(ROOT, 'src')).flatMap((file) =>
      [
        ...readFileSync(file, 'utf8').matchAll(
          /^\s*(?:import|export)\s[^'"]*from\s+['"]([^'"]+)['"]/gm
        )
      ].map((match) => match[1])
    );
    expect(imports.length).toBeGreaterThan(10);
    expect(
      imports.filter((target) => !target.startsWith('./') && !target.startsWith('../'))
    ).toEqual([]);
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it('GC-KIT-006: the committed bundles hold none of safety.viz and no Chart.js (#9)', () => {
    for (const file of ['bio.viz.js', 'bio.viz.esm.js']) {
      const code = readFileSync(dist(file), 'utf8');
      // Chart.js's own registry and controllers, and safety.viz's shell and
      // stylesheet, are what a bundled copy would carry.
      for (const marker of [
        'Chart.register',
        'ScatterController',
        'LinearScale',
        'chartjs',
        'sv-sidebar-toggle',
        'safety-viz-shell-styles',
        'function renderShell',
        'kmEstimate',
        'node_modules'
      ]) {
        expect(code, `${file}: ${marker}`).not.toContain(marker);
      }
      // It reaches the kit on the page instead.
      expect(code).toContain('globalThis.SafetyViz');
      // safety.viz's bundle is seventeen times this size.
      expect(code.length).toBeLessThan(200_000);
    }
  });

  it('GC-KIT-006: BioViz.groupComparison is exported by both committed bundles, and defining it needs no safety.viz (#9)', async () => {
    const context = {};
    vm.runInNewContext(readFileSync(dist('bio.viz.js'), 'utf8'), context);
    expect(typeof context.BioViz.groupComparison).toBe('function');
    const esm = await import(/* @vite-ignore */ dist('bio.viz.esm.js'));
    expect(typeof esm.groupComparison).toBe('function');
    // Making a chart is what needs the kit, and it says so.
    expect(() => esm.groupComparison('#chart')).toThrow(/`SafetyViz\.kit` was not found/);
  });
});
