// `npm run fixtures:check`: reruns each R script that writes a committed
// fixture, in desktop R, and compares what it writes with the committed file, so
// a fixture can only be what its script produces. Nine fixtures:
//
//   tools/r-fixtures.R           site/r-check/expected.json, the expected
//                                results on the R check page
//   tools/r-group-comparison.R   tests/fixtures/group-comparison-r.json, the
//                                quantiles and violin outlines the group
//                                comparison chart's arithmetic is held to,
//                                and the medians, means and baseline standard
//                                deviations its trend tiles are held to
//   tools/r-group-statistics.R   tests/fixtures/group-statistics-r.json, what
//                                gsm.bio's vendored statistics file answers for
//                                the rows the group comparison chart hands R
//   tools/r-association-statistics.R
//                                tests/fixtures/association-statistics-r.json,
//                                the same for the rows the association scatter
//                                hands R
//   tools/r-matrix-statistics.R  tests/fixtures/matrix-statistics-r.json, the
//                                same for the frames the correlation matrix
//                                hands R
//   tools/r-screen-statistics.R  tests/fixtures/screen-statistics-r.json, the
//                                same for the frames the biomarker screen
//                                hands R
//   tools/r-cut.R                tests/fixtures/cut-r.json, the cut points
//                                stats::quantile() gives and the groups
//                                base::cut() makes, which the core's cut rule
//                                is held to
//   tools/r-survival.R           tests/fixtures/stratified-survival-r.json,
//                                each group's survfit() estimate and what
//                                gsm.bio's Analyze_Survival answers
//   tools/r-cross-tab.R          tests/fixtures/cross-tab-r.json, the
//                                cross-tabulation's counts, totals and
//                                percentages, and what gsm.bio's
//                                Analyze_Contingency answers for them
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
//   - When the R version (and, for the R check page, the survival version) is
//     the one that made the committed file, every number must agree to 1 part
//     in 10^12. Not to the last digit: the same R on another processor may
//     round the final one differently.
//   - When the versions differ, that is printed, and numbers are held to the
//     R check page's own tolerance (1 part in 10^8) — the same question the page
//     asks of R in the browser.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOLERANCE } from '../site/r-check/check.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = [
  { script: 'tools/r-fixtures.R', committed: 'site/r-check/expected.json', body: 'results' },
  {
    script: 'tools/r-group-comparison.R',
    committed: 'tests/fixtures/group-comparison-r.json',
    body: ['comparisons', 'tiles']
  },
  {
    script: 'tools/r-group-statistics.R',
    committed: 'tests/fixtures/group-statistics-r.json',
    // The results, and the recipe run on a data frame as R holds one (#49).
    body: ['results', 'recipes']
  },
  {
    script: 'tools/r-association-statistics.R',
    committed: 'tests/fixtures/association-statistics-r.json',
    body: ['results', 'recipes']
  },
  {
    script: 'tools/r-matrix-statistics.R',
    committed: 'tests/fixtures/matrix-statistics-r.json',
    body: ['results', 'recipes']
  },
  {
    script: 'tools/r-screen-statistics.R',
    committed: 'tests/fixtures/screen-statistics-r.json',
    body: ['results', 'recipes']
  },
  { script: 'tools/r-cut.R', committed: 'tests/fixtures/cut-r.json', body: 'cases' },
  {
    script: 'tools/r-cross-tab.R',
    committed: 'tests/fixtures/cross-tab-r.json',
    body: ['cases', 'blank_code_points']
  },
  {
    script: 'tools/r-survival.R',
    committed: 'tests/fixtures/stratified-survival-r.json',
    body: 'cases'
  }
];
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

const describe = (made) =>
  `R ${made.r_version}` +
  (made.survival_version ? `, survival ${made.survival_version}` : '') +
  `, ${made.platform}`;

let failed = false;
for (const fixture of FIXTURES) {
  const committedPath = path.join(rootDir, fixture.committed);
  const tmp = mkdtempSync(path.join(tmpdir(), 'r-fixtures-'));
  const freshPath = path.join(tmp, 'fresh.json');
  let fresh;
  try {
    const run = spawnSync('Rscript', [fixture.script, freshPath], {
      cwd: rootDir,
      encoding: 'utf8'
    });
    if (run.status !== 0) {
      console.error(`✗ ${fixture.script} failed:\n${run.stdout}${run.stderr}`);
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
  const compare = (a, b, where) => {
    if (typeof a === 'number' && typeof b === 'number') {
      numbers += 1;
      const scale = Math.max(Math.abs(a), Math.abs(b));
      if (Math.abs(a - b) > relative * scale) {
        differences.push(`${where}: committed ${a}, R now gives ${b}`);
      }
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        differences.push(`${where}: ${a.length} items against ${b.length}`);
      } else a.forEach((item, index) => compare(item, b[index], `${where}[${index}]`));
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
    if (a !== b) {
      differences.push(
        `${where}: committed ${JSON.stringify(a)}, R now gives ${JSON.stringify(b)}`
      );
    }
  };

  // The versions and the platform are provenance: reported, not compared.
  for (const body of [].concat(fixture.body)) compare(committed[body], fresh[body], body);
  if (committed.made_by.script !== fresh.made_by.script) {
    differences.push('made_by.script differs');
  }
  // A fixture made from a vendored file names the copy it was made from: one
  // made from another copy is stale, whatever its numbers.
  for (const member of ['statistics_commit', 'statistics_sha256']) {
    if (committed.made_by[member] !== fresh.made_by[member]) {
      differences.push(
        `made_by.${member}: committed ${committed.made_by[member]}, the vendored file is ` +
          `${fresh.made_by[member]}`
      );
    }
  }

  console.log(`${fixture.committed} was made by ${describe(committed.made_by)}.`);
  console.log(`This run used ${describe(fresh.made_by)}.`);
  if (!sameVersions) {
    console.log(
      "⚠ The versions differ, so numbers are held to the R check page's tolerance of 1 part in " +
        '10^8, not to 1 part in 10^12.'
    );
  }

  if (differences.length) {
    failed = true;
    console.error(`✗ ${fixture.committed} is not what ${fixture.script} produces:`);
    differences.slice(0, 20).forEach((difference) => console.error(`  - ${difference}`));
    if (differences.length > 20) console.error(`  - and ${differences.length - 20} more`);
    console.error(`\nRun \`Rscript ${fixture.script}\` and commit the result.`);
    continue;
  }
  console.log(
    `✓ ${fixture.committed} is what ${fixture.script} produces: ` +
      `${[]
        .concat(fixture.body)
        .map((body) => `${committed[body].length} ${body}`)
        .join(', ')}, ` +
      `${numbers} numbers agree to 1 part in ` +
      `10^${sameVersions ? 12 : 8}.`
  );
}
if (failed) process.exit(1);
