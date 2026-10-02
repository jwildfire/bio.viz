// `npm run fixtures:check`: reruns tools/r-fixtures.R in desktop R and compares
// what it writes with the committed site/r-check/expected.json, so the expected
// results on the R check page can only be what the script produces.
//
//   node scripts/check-r-fixtures.mjs               compare when R is installed;
//                                                   say so loudly and exit 0
//                                                   when it is not
//   node scripts/check-r-fixtures.mjs --require-r   fail when R, or its
//                                                   survival package, is missing
//                                                   (what CI runs)
//
// How the two files are compared:
//
//   - Everything that is not a number — names, arguments, methods, counts'
//     names, the shape of each value — must be identical.
//   - When the R and survival versions are the ones that made the committed
//     file, every number must agree to 1 part in 10^12. Not to the last digit:
//     the same R on another processor may round the final one differently.
//   - When the versions differ, that is printed, and numbers are held to the
//     page's own tolerance (1 part in 10^8) — the same question the page asks of
//     R in the browser.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOLERANCE } from '../site/r-check/check.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const committedPath = path.join(rootDir, 'site/r-check/expected.json');
const requireR = process.argv.includes('--require-r');

function unavailable(why) {
  const line = `SKIPPED: ${why}. The committed expected results were NOT re-derived from R in this run.`;
  if (requireR) {
    console.error(`✗ ${line} (--require-r was given, so this is a failure.)`);
    process.exit(1);
  }
  // GitHub Actions shows this as a warning on the run.
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=R fixtures not checked::${line}`);
  console.log(`⚠ ${line}`);
  process.exit(0);
}

const probe = spawnSync('Rscript', ['-e', 'cat(requireNamespace("survival", quietly = TRUE))'], {
  encoding: 'utf8'
});
if (probe.error || probe.status !== 0) unavailable('Rscript was not found');
if (!probe.stdout.includes('TRUE')) unavailable('R is installed but its survival package is not');

const tmp = mkdtempSync(path.join(tmpdir(), 'r-fixtures-'));
const freshPath = path.join(tmp, 'expected.json');
let fresh;
try {
  const run = spawnSync('Rscript', ['tools/r-fixtures.R', freshPath], {
    cwd: rootDir,
    encoding: 'utf8'
  });
  if (run.status !== 0) {
    console.error(`✗ tools/r-fixtures.R failed:\n${run.stdout}${run.stderr}`);
    process.exit(1);
  }
  fresh = JSON.parse(readFileSync(freshPath, 'utf8'));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
const committed = JSON.parse(readFileSync(committedPath, 'utf8'));

const sameVersions =
  committed.made_by.r_version === fresh.made_by.r_version &&
  committed.made_by.survival_version === fresh.made_by.survival_version;
const relative = sameVersions ? 1e-12 : TOLERANCE.relative;

const differences = [];
let numbers = 0;
function compare(a, b, where) {
  if (typeof a === 'number' && typeof b === 'number') {
    numbers += 1;
    const scale = Math.max(Math.abs(a), Math.abs(b));
    if (Math.abs(a - b) > relative * scale) {
      differences.push(`${where}: committed ${a}, R now gives ${b}`);
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) differences.push(`${where}: ${a.length} items against ${b.length}`);
    else a.forEach((item, index) => compare(item, b[index], `${where}[${index}]`));
    return;
  }
  if (
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const key of keys) {
      if (!(key in a)) differences.push(`${where}.${key}: only in what R now gives`);
      else if (!(key in b)) differences.push(`${where}.${key}: only in the committed file`);
      else compare(a[key], b[key], `${where}.${key}`);
    }
    return;
  }
  if (a !== b)
    differences.push(`${where}: committed ${JSON.stringify(a)}, R now gives ${JSON.stringify(b)}`);
}

// The versions and the platform are provenance: reported, not compared.
compare(committed.results, fresh.results, 'results');
if (committed.made_by.script !== fresh.made_by.script) {
  differences.push('made_by.script differs');
}

const describe = (made) =>
  `R ${made.r_version}, survival ${made.survival_version}, ${made.platform}`;
console.log(`Committed expected results were made by ${describe(committed.made_by)}.`);
console.log(`This run used                          ${describe(fresh.made_by)}.`);
if (!sameVersions) {
  console.log(
    "⚠ The versions differ, so numbers are held to the page's tolerance of 1 part in 10^8, " +
      'not to 1 part in 10^12.'
  );
}

if (differences.length) {
  console.error('✗ site/r-check/expected.json is not what tools/r-fixtures.R produces:');
  differences.forEach((difference) => console.error(`  - ${difference}`));
  console.error('\nRun `npm run fixtures` and commit the result.');
  process.exit(1);
}

console.log(
  `✓ site/r-check/expected.json is what tools/r-fixtures.R produces: ${committed.results.length} ` +
    `results, ${numbers} numbers agree to 1 part in 10^${sameVersions ? 12 : 8}.`
);
