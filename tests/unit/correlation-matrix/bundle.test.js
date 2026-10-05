import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// What ships (#27): the correlation matrix is in both committed bundles,
// safety.viz, Chart.js and webR are in neither, the chart is built from the
// shared parts, and of another chart it reaches only the association scatter's
// public function.

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
// What a chart's files reach: what they import, and what the shared parts they
// import import in turn (#67: the downloads' CSV and PNG writers are reached
// through the shell).
const reached = (files) => {
  const seen = new Set(files.flatMap(importsOf));
  for (const file of seen) {
    if (file.startsWith('src/shared/')) for (const next of importsOf(file)) seen.add(next);
  }
  return seen;
};
// Comments say what R computes; the checks are of the code.
const codeOf = (files) =>
  files
    .map(source)
    .map((file) => file.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''))
    .join('\n');

const matrix = ['src/correlation-matrix.js', ...sourceFiles('src/correlation-matrix')];
const scatter = ['src/association-scatter.js', ...sourceFiles('src/association-scatter')];
const comparison = ['src/group-comparison.js', ...sourceFiles('src/group-comparison')];

describe('bundle: the correlation matrix ships, safety.viz, Chart.js and webR do not', () => {
  it('CM-KIT-002: BioViz.correlationMatrix is exported by both committed bundles, which hold none of safety.viz, no Chart.js and no webR, and defining it needs no safety.viz (#27)', async () => {
    const context = {};
    vm.runInNewContext(readFileSync(dist('bio.viz.js'), 'utf8'), context);
    expect(typeof context.BioViz.correlationMatrix).toBe('function');
    const esm = await import(/* @vite-ignore */ dist('bio.viz.esm.js'));
    expect(typeof esm.correlationMatrix).toBe('function');
    // Making a chart is what needs the kit, and it says so.
    expect(() => esm.correlationMatrix('#chart')).toThrow(
      /^bio\.viz: the correlation matrix is built from safety\.viz's kit, and `SafetyViz\.kit` was not found\./
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
        'webr-worker',
        'class WebR',
        'node_modules'
      ]) {
        expect(code, `${file}: ${marker}`).not.toContain(marker);
      }
      // The chart's own code is there, once, with the scatter it opens.
      expect(code).toContain('bv-correlation-matrix');
      expect(code.match(/\bCorrelationMatrix = class\b/g)).toHaveLength(1);
      expect(code.match(/\bAssociationScatter = class\b/g)).toHaveLength(1);
      expect(code).not.toMatch(/webr\.mjs['"]\s*;?\s*$|WebAssembly\.instantiate/);
    }
  });

  it('CM-KIT-003: the chart is built from the shared parts and writes none of them again; of another chart it imports only the association scatter’s public function, and no chart imports anything of this one (#27)', () => {
    const shared = sourceFiles('src/shared');
    expect(shared).toEqual([
      'src/shared/chartHost.js',
      'src/shared/csv.js',
      'src/shared/cut.js',
      'src/shared/outcomes.js',
      'src/shared/paging.js',
      'src/shared/png.js',
      'src/shared/settings.js',
      'src/shared/specification.js',
      'src/shared/statisticLine.js',
      'src/shared/tables.js',
      'src/shared/titles.js',
      'src/shared/variables.js'
    ]);
    const fromMatrix = reached(matrix);
    // Every shared part but the paging of a long list, which a grid of at most
    // `limit` variables has no use for, and the cut that makes groups (#43),
    // which a grid of numbers has none of, and the reading of an outcomes
    // table (#62), is one the grid is built from.
    for (const file of shared.filter(
      (name) =>
        !['src/shared/paging.js', 'src/shared/cut.js', 'src/shared/outcomes.js'].includes(name)
    )) {
      expect(fromMatrix.has(file), file).toBe(true);
    }
    // Of another chart: the function a page calls to make a scatter, and
    // nothing under that chart's folder, and nothing of the group comparison.
    const ofOthers = [...fromMatrix].filter((file) =>
      /association-scatter|group-comparison/.test(file)
    );
    expect(ofOthers).toEqual(['src/association-scatter.js']);
    expect(source('src/correlation-matrix.js')).toContain(
      "import { associationScatter } from './association-scatter.js';"
    );
    // Only the chart's entry file reaches it: its parts know no other chart.
    for (const file of sourceFiles('src/correlation-matrix')) {
      expect(
        importsOf(file).filter((target) => /association-scatter|group-comparison/.test(target)),
        file
      ).toEqual([]);
    }
    // Neither of the other charts, nor a shared part, reaches this one.
    for (const files of [scatter, comparison, shared]) {
      expect([...reached(files)].filter((file) => file.includes('correlation-matrix'))).toEqual([]);
    }
    // How a variable is written in settings and in a request is written once,
    // for the scatter and the grid alike: the cell's pair is the scatter's x and y.
    const variables = source('src/shared/variables.js');
    for (const name of ['axisOf', 'variableOf', 'settingOf', 'sameAxis']) {
      expect(variables).toMatch(new RegExp(`export (function|const) ${name}\\b`));
      for (const files of [matrix, scatter]) {
        expect(codeOf(files), name).not.toMatch(
          new RegExp(`^(export )?(function|const) ${name}\\b`, 'm')
        );
      }
    }
    expect(importsOf('src/association-scatter/structureData.js')).toContain(
      'src/shared/variables.js'
    );
    // Each thing is written once: the chart's own files do not write it again.
    const own = matrix.map(source).join('\n');
    for (const once of [
      'function createDesk',
      'waiting for R',
      'URL.createObjectURL',
      'renderFilterControl',
      'function keepFiltered',
      'function formatPair'
    ]) {
      expect(own, once).not.toContain(once);
    }
    expect(shared.map(source).join('\n').includes('function createDesk')).toBe(true);
  });

  it('CM-KIT-004: the chart’s source holds no statistical inference: no arithmetic of a correlation, an interval or a p-value, nothing ordered by a coefficient, and no p-value read (#27)', () => {
    const code = codeOf(matrix);
    for (const marker of [
      /Math\.sqrt/,
      /Math\.atanh|Math\.tanh/,
      /Math\.exp\b|Math\.log/,
      /\.reduce\(/,
      /covarian|varianc|deviation/i,
      /\bqt\(|\bpt\(|\bpnorm|\bqnorm/,
      /\bmean\(|\bsum\(|\brank\w*\(/,
      // No p-value is read from what R returned, or named in what is printed.
      /p_value|pValue|\bp\s*[<=>]\s*0/,
      // No minimum is worked out or defaulted here: it is R's.
      /nMinPairs\s*[:=]\s*\d/,
      /min_pairs:\s*\d/
    ]) {
      expect(code, String(marker)).not.toMatch(marker);
    }
    // Nothing is ordered by a coefficient. The two sorts there are: R's own
    // order of the pairs, and the two names of a pair's key.
    const sorts = code.match(/\.sort\([^\n]*/g);
    expect(sorts).toEqual(['.sort((a, b) => a.order - b.order);', ".sort().join('\\u0000');"]);
    expect(code).not.toMatch(/sort\([^\n]*estimate/);
    // What is worked out from a coefficient: a mark's width and lightness, in
    // one function, and the number to two decimals, in another.
    expect(code.match(/Math\.abs/g)).toHaveLength(1);
    expect(code.match(/\.toFixed\(/g)).toHaveLength(1);
    const structure = codeOf(['src/correlation-matrix/structureData.js']);
    const markOf = structure.slice(
      structure.indexOf('export function markOf'),
      structure.indexOf('export function numberOf')
    );
    expect(markOf).toContain('Math.abs(estimate)');
    expect(structure.replace(markOf, '')).not.toMatch(/Math\.abs|strength/);
    // The chart's entry file does no arithmetic on a coefficient at all: it
    // hands R's number to those two functions.
    const entry = codeOf(['src/correlation-matrix.js']);
    expect(entry.match(/\bestimate\b[^\n]*/g).filter((line) => /[-+*/<>]\s*\d/.test(line))).toEqual(
      []
    );
    expect(entry).toContain('numberOf(pair.estimate)');
    expect(entry).toContain('this.mark(pair.estimate)');
  });
});
