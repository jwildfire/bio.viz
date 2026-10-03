import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// What ships (#26): the association scatter is in both committed bundles,
// safety.viz and Chart.js are in neither, and the two charts are built from one
// set of shared parts.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const dist = (file) => path.join(ROOT, `dist/bio.viz-${pkg.version}`, file);
const source = (file) => readFileSync(path.join(ROOT, file), 'utf8');

function sourceFiles(dir) {
  return readdirSync(path.join(ROOT, dir)).flatMap((entry) => {
    const file = path.join(dir, entry);
    if (statSync(path.join(ROOT, file)).isDirectory()) return sourceFiles(file);
    return file.endsWith('.js') ? [file] : [];
  });
}
const importsOf = (file) =>
  [...source(file).matchAll(/^\s*(?:import|export)\s[^'"]*from\s+['"]([^'"]+)['"]/gm)].map(
    (match) => path.normalize(path.join(path.dirname(file), match[1]))
  );

describe('bundle: the association scatter ships, safety.viz and Chart.js do not', () => {
  it('AS-KIT-002: BioViz.associationScatter is exported by both committed bundles, which hold none of safety.viz and no Chart.js, and defining it needs no safety.viz (#26)', async () => {
    const context = {};
    vm.runInNewContext(readFileSync(dist('bio.viz.js'), 'utf8'), context);
    expect(typeof context.BioViz.associationScatter).toBe('function');
    const esm = await import(/* @vite-ignore */ dist('bio.viz.esm.js'));
    expect(typeof esm.associationScatter).toBe('function');
    // Making a chart is what needs the kit, and it says so.
    expect(() => esm.associationScatter('#chart')).toThrow(
      /^bio\.viz: the association scatter is built from safety\.viz's kit, and `SafetyViz\.kit` was not found\./
    );
    for (const file of ['bio.viz.js', 'bio.viz.esm.js']) {
      const code = readFileSync(dist(file), 'utf8');
      for (const marker of [
        'Chart.register',
        'ScatterController',
        'LogarithmicScale',
        'chartjs',
        'sv-sidebar-toggle',
        'safety-viz-shell-styles',
        'function renderShell',
        'node_modules'
      ]) {
        expect(code, `${file}: ${marker}`).not.toContain(marker);
      }
      // The chart's own code is there, and webR is not: it is loaded on first use.
      expect(code).toContain('bv-association-scatter');
      expect(code).not.toMatch(/webr\.mjs['"]\s*;?\s*$|WebAssembly\.instantiate/);
    }
  });

  it('AS-KIT-003: the chart is built from the parts every chart shares and from nothing of the group comparison chart; that chart is built from the same parts (#26)', () => {
    const scatter = ['src/association-scatter.js', ...sourceFiles('src/association-scatter')];
    const comparison = ['src/group-comparison.js', ...sourceFiles('src/group-comparison')];
    // What every chart is built from. One more shared part,
    // src/shared/variables.js (#27), is how a variable is written in settings
    // and in a request: this chart and the correlation matrix use it, and the
    // group comparison chart, which names no variable that way, does not.
    // src/shared/paging.js (#36) is how a long list is paged: the group
    // comparison chart's overview and the biomarker screen use it.
    // src/shared/cut.js (#43) is how a cut variable makes groups: the group
    // comparison chart uses it, and this chart, whose axes are numbers, does not.
    const everything = sourceFiles('src/shared');
    expect(everything).toEqual([
      'src/shared/chartHost.js',
      'src/shared/cut.js',
      'src/shared/paging.js',
      'src/shared/settings.js',
      'src/shared/statisticLine.js',
      'src/shared/tables.js',
      'src/shared/variables.js'
    ]);
    const shared = everything.filter(
      (file) =>
        !['src/shared/variables.js', 'src/shared/paging.js', 'src/shared/cut.js'].includes(file)
    );
    const reached = (files) => new Set(files.flatMap(importsOf));
    const fromScatter = reached(scatter);
    const fromComparison = reached(comparison);
    // Neither chart imports the other.
    expect([...fromScatter].filter((file) => file.includes('group-comparison'))).toEqual([]);
    expect([...fromComparison].filter((file) => file.includes('association-scatter'))).toEqual([]);
    // Both are built from every shared part: the statistics line's rounds and
    // waiting state, the tables, the settings, and the kit's shell, listing,
    // download and participant rail.
    for (const file of shared) {
      expect(fromScatter.has(file), `association scatter: ${file}`).toBe(true);
      expect(fromComparison.has(file), `group comparison: ${file}`).toBe(true);
    }
    expect(fromScatter.has('src/shared/variables.js')).toBe(true);
    expect(fromComparison.has('src/shared/variables.js')).toBe(false);
    // This chart imports nothing of the correlation matrix either: the grid
    // opens the scatter, never the other way about.
    expect([...fromScatter].filter((file) => file.includes('correlation-matrix'))).toEqual([]);
    // The shared parts depend on no chart, and on nothing outside src/.
    for (const target of reached(everything)) {
      expect(target.startsWith('src/'), target).toBe(true);
      expect(target).not.toMatch(/group-comparison|association-scatter|correlation-matrix/);
    }
    // Each thing is written once: the chart's own files do not write it again.
    const own = scatter.map(source).join('\n');
    for (const once of [
      'function createDesk',
      'waiting for R',
      'participantsSelected',
      'URL.createObjectURL',
      'kit.mountProfileRail(',
      'renderListing',
      'renderFilterControl'
    ]) {
      expect(own, once).not.toContain(once);
      expect(shared.map(source).join('\n'), once).toContain(once);
    }
  });

  it('AS-KIT-004: the chart’s source holds no statistical inference: it imports no statistics, and no arithmetic of a correlation, a regression, a smooth, an interval or a p-value is written in it (#26)', () => {
    const files = ['src/association-scatter.js', ...sourceFiles('src/association-scatter')];
    const code = files
      .map(source)
      // Comments say what R computes; the check is of the code.
      .map((file) => file.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''))
      .join('\n');
    for (const marker of [
      /Math\.sqrt/,
      /Math\.atanh|Math\.tanh/,
      /Math\.exp\b/,
      /\.reduce\(/,
      /covarian|varianc|deviation/i,
      /\bqt\(|\bpt\(|\bpnorm|\bqnorm/,
      /leastSquares|regress\w*\(|loess\(|lowess/i,
      /\bmean\(|\bsum\(/
    ]) {
      expect(code, String(marker)).not.toMatch(marker);
    }
    // The arithmetic it does have: a logarithm for a logarithmic axis, its
    // inverse to place R's points back on that axis, and the room about an axis.
    expect(code.match(/Math\.log10/g)).toHaveLength(1);
    expect(code.match(/10 \*\* /g)).toHaveLength(1);
  });
});
