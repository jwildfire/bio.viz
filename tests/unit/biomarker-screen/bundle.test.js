import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// What ships (#36): the biomarker screen is in both committed bundles,
// safety.viz, Chart.js and webR are in neither, the chart is built from the
// shared parts, and of other charts it reaches only their public functions.

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
const reached = (files) => new Set(files.flatMap(importsOf));
const codeOf = (files) =>
  files
    .map(source)
    .map((file) => file.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''))
    .join('\n');

const screen = ['src/biomarker-screen.js', ...sourceFiles('src/biomarker-screen')];
const others = {
  'group-comparison': ['src/group-comparison.js', ...sourceFiles('src/group-comparison')],
  'association-scatter': ['src/association-scatter.js', ...sourceFiles('src/association-scatter')],
  'correlation-matrix': ['src/correlation-matrix.js', ...sourceFiles('src/correlation-matrix')]
};

describe('bundle: the biomarker screen ships, safety.viz, Chart.js and webR do not', () => {
  it('BS-KIT-002: BioViz.biomarkerScreen is exported by both committed bundles, which hold none of safety.viz, no Chart.js and no webR, and defining it needs no safety.viz (#36)', async () => {
    const context = {};
    vm.runInNewContext(readFileSync(dist('bio.viz.js'), 'utf8'), context);
    expect(typeof context.BioViz.biomarkerScreen).toBe('function');
    const esm = await import(/* @vite-ignore */ dist('bio.viz.esm.js'));
    expect(typeof esm.biomarkerScreen).toBe('function');
    expect(typeof esm.r.formatScreenRow).toBe('function');
    expect(() => esm.biomarkerScreen('#chart')).toThrow(
      /^bio\.viz: the biomarker screen is built from safety\.viz's kit, and `SafetyViz\.kit` was not found\./
    );
    for (const file of ['bio.viz.js', 'bio.viz.esm.js']) {
      const code = readFileSync(dist(file), 'utf8');
      for (const marker of [
        'Chart.register',
        'ScatterController',
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
      expect(code).toContain('bv-biomarker-screen');
      expect(code.match(/\bBiomarkerScreen = class\b/g)).toHaveLength(1);
      expect(code.match(/\bGroupComparison = class\b/g)).toHaveLength(1);
      expect(code.match(/\bAssociationScatter = class\b/g)).toHaveLength(1);
    }
  });

  it('BS-KIT-003: the chart is built from the shared parts and writes none of them again; of other charts it imports only their public functions, and no chart imports anything of this one (#36)', () => {
    const shared = sourceFiles('src/shared');
    const fromScreen = reached(screen);
    for (const file of shared) expect(fromScreen.has(file), file).toBe(true);
    const ofOthers = [...fromScreen].filter((file) =>
      /group-comparison|association-scatter|correlation-matrix/.test(file)
    );
    expect(ofOthers.sort()).toEqual(['src/association-scatter.js', 'src/group-comparison.js']);
    for (const file of sourceFiles('src/biomarker-screen')) {
      expect(
        importsOf(file).filter((target) =>
          /group-comparison|association-scatter|correlation-matrix/.test(target)
        ),
        file
      ).toEqual([]);
    }
    for (const files of [...Object.values(others), shared]) {
      expect([...reached(files)].filter((file) => file.includes('biomarker-screen'))).toEqual([]);
    }
    // What it shares with the charts that had it first is written once: the
    // pager, the way back, the number columns and the variable setting.
    const own = codeOf(screen);
    for (const once of [
      'function createDesk',
      'waiting for R',
      'URL.createObjectURL',
      'renderFilterControl',
      'function keepFiltered',
      'function pageOf',
      'function numberColumns',
      'function variableSetting',
      "'bv-back'",
      'function formatScreenRow'
    ]) {
      expect(own, once).not.toContain(once);
    }
    expect(codeOf(shared)).toContain('function pageOf');
    expect(codeOf(shared)).toContain("'bv-back'");
    // The group comparison's overview and the scatter use the same parts.
    expect(reached(others['group-comparison']).has('src/shared/paging.js')).toBe(true);
    expect(codeOf(others['association-scatter'])).not.toContain("'bv-back'");
    expect(codeOf(others['group-comparison'])).not.toMatch(
      /function overviewPage[\s\S]{0,200}Math\.ceil/
    );
  });

  it('BS-KIT-004: the chart’s source holds no statistical inference: no arithmetic of an estimate, an interval, a p-value or an adjustment, and nothing ordered by a key R did not return (#36)', () => {
    const code = codeOf(screen);
    for (const marker of [
      /Math\.sqrt/,
      /Math\.exp\b|Math\.log|Math\.pow|\*\*/,
      /\.reduce\(/,
      /covarian|varianc|deviation\(|hedges\(/i,
      /\bqt\(|\bpt\(|\bpnorm|\bqnorm/,
      /\bmean\(|\bsum\(/,
      /\bp\.adjust|bonferroni|\* rows\.length/i
    ]) {
      expect(code, String(marker)).not.toMatch(marker);
    }
    // One sort, of R's own numbers or of names, in one function.
    expect(code.match(/\.sort\(/g)).toHaveLength(1);
    const structure = codeOf(['src/biomarker-screen/structureData.js']);
    const sortRows = structure.slice(
      structure.indexOf('export function sortRows'),
      structure.indexOf('export const SORT_LABELS') > structure.indexOf('export function sortRows')
        ? structure.indexOf('export const SORT_LABELS')
        : structure.indexOf('export function axisRange')
    );
    expect(sortRows).toContain('.sort(compare)');
    expect(sortRows).toMatch(/by\('estimate', true\)/);
    expect(sortRows).toMatch(/by\('adjusted', false\)/);
    // The values compared are R's, as they are: nothing is worked out of them.
    expect(sortRows).not.toMatch(/Math\.|\b[xy]\s*[-+*/]|[-+*/]\s*[xy]\b/);
    // The arithmetic there is: where a value sits on the axis, and how far the axis runs.
    expect(code.match(/Math\.abs/g)).toHaveLength(1);
    const entry = codeOf(['src/biomarker-screen.js']);
    expect(entry).not.toMatch(/\.(estimate|lower|upper|raw|adjusted)\s*[-+*/]/);
  });
});
