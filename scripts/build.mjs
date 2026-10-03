// `npm run build`: writes the IIFE and ESM bundles to dist/bio.viz-{version}/.
// dist/ is committed; `npm run build:check-dist` fails when it drifts from src/.

import path from 'node:path';
import { buildAll, distDirFor, pkg, rootDir } from './build-lib.mjs';

const outDir = distDirFor(pkg.version);
await buildAll(outDir);
console.log(`Built bio.viz ${pkg.version} to ${path.relative(rootDir, outDir)}/`);
