// Evidence pipeline CLI. Runs the suites ONCE with JSON reporters, routes each
// test record to its module by test-file path (see scripts/evidence-lib.mjs),
// and (re)builds every docs/evidence/<module>/evidence.json from the results.
// Carried over from safety.viz.
//
//   node scripts/evidence.mjs            regenerate the evidence.json files
//                                        from a fresh run; exit 1 if any test
//                                        fails
//   node scripts/evidence.mjs --check    freshness guard: compare a fresh
//                                        run's test names + statuses against
//                                        every committed evidence.json; exit 1
//                                        on drift (provenance keys ignored)
//
// Modules are discovered from site/config.json's `modules` list (any status),
// so a new module needs no edits here: add the config entry, put unit tests
// under tests/unit/<module>/ and browser specs in tests/e2e/<module>.spec.js,
// and its docs/evidence/<module>/evidence.json appears on the next run.
//
// Not carried over yet: screenshot baselines and the `--update` mode that
// refreshes them on the Linux CI runner. No test here captures a screenshot;
// both arrive with the first chart.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs';
import { createRequire } from 'node:module';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEvidenceSets, buildRun, compareEvidence } from './evidence-lib.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceRoot = path.join(rootDir, 'docs', 'evidence');
const evidencePathFor = (module) => path.join(evidenceRoot, module, 'evidence.json');

const mode = process.argv.includes('--check') ? 'check' : 'run';

// Module registry → module universe for test-file routing.
const config = JSON.parse(readFileSync(path.join(rootDir, 'site', 'config.json'), 'utf8'));
const modules = config.modules.map((entry) => entry.module);

// Provenance: environment versions + the GitHub Actions run when present. The
// chromium version comes from playwright-core's browser registry (its exports
// map hides browsers.json, so resolve the package dir and read the file).
const require = createRequire(import.meta.url);
function chromiumVersion() {
  try {
    const coreDir = path.dirname(require.resolve('playwright-core'));
    const { browsers } = JSON.parse(readFileSync(path.join(coreDir, 'browsers.json'), 'utf8'));
    return browsers.find((browser) => browser.name === 'chromium')?.browserVersion ?? null;
  } catch {
    return null;
  }
}
const provenance = {
  generatedAt: new Date().toISOString(),
  environment: {
    os: `${os.platform()} ${os.release()}`,
    node: process.version,
    playwright: require('@playwright/test/package.json').version,
    chromium: chromiumVersion()
  },
  run: buildRun(process.env)
};

const tmp = mkdtempSync(path.join(tmpdir(), 'evidence-'));
const vitestOut = path.join(tmp, 'vitest.json');
const playwrightOut = path.join(tmp, 'playwright.json');

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, ...env }
  });
  if (result.error) throw result.error;
  return result.status;
}

// A suite that crashed before writing its report must not read as "no tests".
function readReport(file, suite) {
  if (!existsSync(file)) {
    console.error(`✗ ${suite} wrote no JSON report — the suite did not run to completion.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

console.log('▸ Vitest (json reporter)…');
run('npx', ['vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile=${vitestOut}`]);

console.log('▸ Playwright (json reporter)…');
run('npx', ['playwright', 'test', '--reporter=json'], {
  PLAYWRIGHT_JSON_OUTPUT_NAME: playwrightOut
});

const screenshotsByModule = {};
for (const module of modules) {
  const dir = path.join(evidenceRoot, module);
  if (existsSync(dir)) {
    screenshotsByModule[module] = readdirSync(dir)
      .filter((file) => file.endsWith('.png'))
      .sort();
  }
}

const sets = buildEvidenceSets({
  modules,
  vitest: readReport(vitestOut, 'Vitest'),
  playwright: readReport(playwrightOut, 'Playwright'),
  screenshotsByModule,
  provenance
});

// A run that routed no record to any module would compare nothing and pass.
if (Object.keys(sets).length === 0) {
  console.error(
    '✗ The fresh run produced no test record for any registered module ' +
      `(${modules.join(', ') || 'none registered'}) — nothing to record or compare.`
  );
  process.exit(1);
}

// Modules with a committed evidence.json — compared against the fresh sets so
// removing a module's tests (or adding a module's first test) flags drift.
const committedModules = existsSync(evidenceRoot)
  ? readdirSync(evidenceRoot).filter((entry) => existsSync(evidencePathFor(entry)))
  : [];
const allModules = [...new Set([...Object.keys(sets), ...committedModules])].sort();

if (mode === 'check') {
  let stale = false;
  for (const module of allModules) {
    const evidencePath = evidencePathFor(module);
    const rel = path.relative(rootDir, evidencePath);
    if (!sets[module]) {
      stale = true;
      console.error(`✗ ${rel} is committed but the fresh run produced no records for it.`);
      continue;
    }
    if (!existsSync(evidencePath)) {
      stale = true;
      console.error(`✗ ${rel} is missing — run npm run evidence and commit.`);
      continue;
    }
    const committed = JSON.parse(readFileSync(evidencePath, 'utf8'));
    const { stale: moduleStale, differences } = compareEvidence(committed, sets[module]);
    if (moduleStale) {
      stale = true;
      console.error(`✗ ${rel} is stale — run npm run evidence and commit:`);
      differences.forEach((d) => console.error(`  - ${d}`));
    } else {
      console.log(`✓ ${rel} fresh: ${sets[module].records.length} records match.`);
    }
  }
  if (stale) process.exit(1);
} else {
  const written = [];
  for (const module of Object.keys(sets).sort()) {
    const evidencePath = evidencePathFor(module);
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, JSON.stringify(sets[module], null, 2) + '\n');
    written.push(evidencePath);
  }
  // Keep the committed artifacts Prettier-clean (CI checks formatting).
  run('npx', ['prettier', '--log-level=warn', '--write', ...written]);

  for (const module of committedModules.filter((entry) => !sets[entry])) {
    console.warn(
      `⚠ ${path.relative(rootDir, evidencePathFor(module))} is committed but the fresh run ` +
        'produced no records for it — remove it (with approval) or restore its tests.'
    );
  }

  // Shared scaffold records appear in every set; count distinct failures.
  const failures = new Set(
    Object.values(sets).flatMap((set) =>
      set.records.filter((r) => r.status === 'fail').map((r) => `${r.suite}|${r.test}`)
    )
  );
  for (const module of Object.keys(sets).sort()) {
    console.log(
      `✓ Wrote ${path.relative(rootDir, evidencePathFor(module))} — ` +
        `${sets[module].records.length} records`
    );
  }
  console.log(failures.size ? `✗ ${failures.size} FAILING tests` : '✓ All tests passing');
  if (failures.size) process.exit(1);
}
