// Build core: emits the two bundles from src/main.js. Kept apart from the
// command-line entry (scripts/build.mjs) so the drift check can build into a
// scratch directory with exactly the same options.

import { build } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(__dirname, '..');

export const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
export const distDirFor = (version) => path.join(rootDir, 'dist', `bio.viz-${version}`);
export const bundleFiles = ['bio.viz.js', 'bio.viz.js.map', 'bio.viz.esm.js', 'bio.viz.esm.js.map'];

// An IIFE build (global `BioViz`, the asset a page or an htmlwidget loads with a
// <script> tag) and an ESM build. `BioViz.version` is the package version,
// substituted here so the bundle never carries package.json itself.
export async function buildAll(outDir) {
  mkdirSync(outDir, { recursive: true });

  const common = {
    entryPoints: [path.join(rootDir, 'src/main.js')],
    bundle: true,
    sourcemap: true,
    absWorkingDir: rootDir,
    define: {
      __BIO_VIZ_VERSION__: JSON.stringify(pkg.version),
      // Whether the build holds changes since that release (#69 review).
      __BIO_VIZ_DEVELOPMENT__: JSON.stringify(Boolean(pkg.bioviz && pkg.bioviz.development))
    }
  };

  await build({
    ...common,
    format: 'iife',
    globalName: 'BioViz',
    outfile: path.join(outDir, 'bio.viz.js')
  });

  await build({
    ...common,
    format: 'esm',
    outfile: path.join(outDir, 'bio.viz.esm.js')
  });
}
