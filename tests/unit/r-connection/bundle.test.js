import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { build } from 'esbuild';

// What ships (#2): the connection and the formatter are in both committed
// bundles, and webR is in neither. webR is fetched by the page the first time a
// result is asked for; a bundler must not pull it in or even try to find it.

const root = new URL('../../../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const dist = (file) => new URL(`dist/bio.viz-${pkg.version}/${file}`, root);

describe('bundle: the connection ships, webR does not', () => {
  it('RCON-API-005: BioViz.r.createConnection and BioViz.r.formatStatistic are exported by both committed bundles (#2)', async () => {
    const context = {};
    vm.runInNewContext(readFileSync(dist('bio.viz.js'), 'utf8'), context);
    expect(typeof context.BioViz.r.createConnection).toBe('function');
    expect(typeof context.BioViz.r.formatStatistic).toBe('function');
    expect(context.BioViz.r.WEBR_VERSION).toBe('0.6.0');

    const esm = await import(/* @vite-ignore */ dist('bio.viz.esm.js').href);
    expect(typeof esm.r.createConnection).toBe('function');
    expect(typeof esm.r.formatStatistic).toBe('function');
  });

  it('RCON-BUILD-001: the build bundles only files under src/ and does not resolve the webR import (#2)', async () => {
    const result = await build({
      entryPoints: ['src/main.js'],
      absWorkingDir: new URL('.', root).pathname,
      bundle: true,
      write: false,
      metafile: true,
      format: 'esm',
      logLevel: 'silent',
      define: { __BIO_VIZ_VERSION__: JSON.stringify(pkg.version) }
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs.length).toBeGreaterThan(1);
    expect(inputs.filter((input) => !input.startsWith('src/'))).toEqual([]);
    // No import is recorded for the output: the webR URL is only known when the
    // page runs, so esbuild leaves `import(url)` alone.
    const [output] = Object.values(result.metafile.outputs);
    expect(output.imports).toEqual([]);
  });

  it('RCON-BUILD-002: the committed bundles keep the dynamic import and carry none of webR (#2)', () => {
    for (const file of ['bio.viz.js', 'bio.viz.esm.js']) {
      const code = readFileSync(dist(file), 'utf8');
      // The import survives as a runtime import of a URL held in a variable …
      expect(code).toMatch(/\bimport\(\s*(?:\/\*[^*]*\*\/\s*)?url\s*\)/);
      expect(code).toContain('https://webr.r-wasm.org/v');
      // … and nothing of webR itself is inside: its worker, its channels, its
      // WebAssembly loader, its file system and its R session.
      for (const marker of [
        'webr-worker',
        'SharedArrayBuffer',
        'WebAssembly',
        'R_HOME',
        'emscripten',
        'class WebR',
        'node_modules'
      ]) {
        expect(code, `${file}: ${marker}`).not.toContain(marker);
      }
      // Every file the bundle was made from is one of this repository's own,
      // under src/: esbuild writes each one's path above its code, and a webR
      // that had been bundled in would be listed by its path in a package.
      const modules = [...code.matchAll(/^ {0,2}\/\/ (\S+\.[cm]?js)$/gm)].map((match) => match[1]);
      expect(modules).toContain('src/r/webREngine.js');
      expect(modules.filter((module) => !module.startsWith('src/'))).toEqual([]);
    }
  });

  it('RCON-BUILD-003: the r module imports nothing from outside src/r (#2)', async () => {
    const result = await build({
      entryPoints: ['src/r/index.js'],
      absWorkingDir: new URL('.', root).pathname,
      bundle: true,
      write: false,
      metafile: true,
      format: 'esm',
      logLevel: 'silent'
    });
    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs.filter((input) => !input.startsWith('src/r/'))).toEqual([]);
  });
});
