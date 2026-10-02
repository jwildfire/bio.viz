// `npm run build:check-dist`: rebuilds src/ into a scratch directory and fails
// when the committed dist/bio.viz-{version}/ differs from it, or when a browser
// fixture loads a bundle version other than the one in package.json.

import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { buildAll, bundleFiles, distDirFor, pkg, rootDir } from './build-lib.mjs';

const committedDir = distDirFor(pkg.version);

// Built as a sibling of dist/bio.viz-{version}/, not os.tmpdir(): esbuild's
// sourcemaps record a path to the source *relative to the output directory*, so
// comparing against a build at a different nesting depth reports drift that isn't real.
const distRoot = path.join(rootDir, 'dist');
mkdirSync(distRoot, { recursive: true });
const tmpDir = mkdtempSync(path.join(distRoot, '.drift-check-'));
const drifted = [];

try {
  await buildAll(tmpDir);

  if (!existsSync(committedDir)) {
    drifted.push(`${path.relative(rootDir, committedDir)}/ does not exist — run \`npm run build\``);
  } else {
    for (const file of bundleFiles) {
      const committedPath = path.join(committedDir, file);
      const freshPath = path.join(tmpDir, file);

      if (!existsSync(committedPath)) {
        drifted.push(`${file}: missing from committed dist/`);
        continue;
      }

      const committed = readFileSync(committedPath, 'utf8');
      const fresh = readFileSync(freshPath, 'utf8');
      if (committed !== fresh) {
        drifted.push(`${file}: committed dist/ does not match a fresh build of src/`);
      }
    }
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

// The e2e fixtures load the bundle by its versioned path, so a version bump that
// forgets them leaves the whole browser suite exercising the previous release's
// frozen bytes rather than the code under test. Fail the same gate.
const fixtureDir = path.join(rootDir, 'tests/e2e/fixtures');
const pinPattern = /dist\/bio\.viz-(\d+\.\d+\.\d+)\//g;
let pins = 0;
for (const name of readdirSync(fixtureDir).filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(path.join(fixtureDir, name), 'utf8');
  for (const [, pinned] of html.matchAll(pinPattern)) {
    pins += 1;
    if (pinned !== pkg.version) {
      drifted.push(
        `tests/e2e/fixtures/${name}: loads dist/bio.viz-${pinned}/ but package.json is ${pkg.version}`
      );
    }
  }
}

if (drifted.length > 0) {
  console.error('dist/ drift detected:');
  for (const line of drifted) console.error(`  - ${line}`);
  console.error('\nRun `npm run build` and commit the result.');
  process.exit(1);
}

console.log(
  `dist/bio.viz-${pkg.version} matches a fresh build of src/ ` +
    `(${bundleFiles.length} files; ${pins} fixture bundle reference${pins === 1 ? '' : 's'} at ${pkg.version}).`
);
