// Requirement-text sync CLI: extracts the requirement text from the matrices in
// requirements/ into docs/requirements/<module>.json so a page can show what
// each test evidences. Mirrors scripts/evidence.mjs. Carried over from
// safety.viz.
//
//   node scripts/requirements.mjs           regenerate the JSON extracts from
//                                           the matrices
//   node scripts/requirements.mjs --check   freshness guard: re-extract and
//                                           compare against every committed
//                                           extract; exit 1 on drift, on a
//                                           missing matrix or extract, or on a
//                                           matrix file no module registers
//
// Which matrix belongs to which module comes from site/config.json's `modules`
// list, so a new module needs no edits here: add the config entry with its
// `matrix`, and its extract appears on the next run. A module with no `matrix`
// key has no requirements yet and is reported, not failed.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRequirementSet,
  compareRequirements,
  findUnregisteredMatrices
} from './requirements-lib.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(rootDir, 'requirements');
const outputRoot = path.join(rootDir, 'docs', 'requirements');
const matrixPathFor = (matrix) => path.join(sourceRoot, matrix);
const outputPathFor = (module) => path.join(outputRoot, `${module}.json`);
const rel = (p) => path.relative(rootDir, p);

const mode = process.argv.includes('--check') ? 'check' : 'run';

const config = JSON.parse(readFileSync(path.join(rootDir, 'site', 'config.json'), 'utf8'));
const modules = config.modules;

const problems = [];
const extract = ({ module, matrix }) =>
  buildRequirementSet({ module, matrix, markdown: readFileSync(matrixPathFor(matrix), 'utf8') });

for (const file of findUnregisteredMatrices(readdirSync(sourceRoot), modules)) {
  problems.push(
    `requirements/${file} is not named by any module in site/config.json — register it, ` +
      'or its rows are never extracted.'
  );
}

const written = [];
let checked = 0;
let rows = 0;

for (const entry of modules) {
  const { module, matrix } = entry;
  if (!matrix) {
    console.log(`· ${module}: no matrix registered — no requirement text to extract.`);
    continue;
  }
  if (!existsSync(matrixPathFor(matrix))) {
    problems.push(
      `${module}: site/config.json names requirements/${matrix}, which does not exist.`
    );
    continue;
  }
  const fresh = extract(entry);
  const count = Object.keys(fresh.requirements).length;
  if (count === 0) {
    problems.push(`requirements/${matrix} has no rows the extractor recognizes.`);
    continue;
  }
  const outputPath = outputPathFor(module);

  if (mode === 'check') {
    if (!existsSync(outputPath)) {
      problems.push(`${rel(outputPath)} is missing — run npm run requirements and commit.`);
      continue;
    }
    const committed = JSON.parse(readFileSync(outputPath, 'utf8'));
    const { stale, differences } = compareRequirements(committed, fresh);
    if (stale) {
      problems.push(
        `${rel(outputPath)} is stale — run npm run requirements and commit:\n` +
          differences.map((d) => `      ${d}`).join('\n')
      );
      continue;
    }
    console.log(`✓ ${rel(outputPath)} fresh: ${count} rows.`);
  } else {
    mkdirSync(outputRoot, { recursive: true });
    writeFileSync(outputPath, JSON.stringify(fresh, null, 2) + '\n');
    written.push(outputPath);
    console.log(`✓ Wrote ${rel(outputPath)} — ${count} requirements`);
  }
  checked += 1;
  rows += count;
}

// Keep the committed artifacts Prettier-clean (CI checks formatting).
if (written.length) {
  spawnSync('npx', ['prettier', '--log-level=warn', '--write', ...written], {
    cwd: rootDir,
    stdio: ['ignore', 'inherit', 'inherit']
  });
}

if (problems.length) {
  console.error('✗ Requirement text is out of sync:');
  problems.forEach((problem) => console.error(`  - ${problem}`));
  process.exit(1);
}

// Said out loud, because a guard that compared nothing would otherwise read as
// a pass.
console.log(
  `${mode === 'check' ? 'Checked' : 'Extracted'} ${checked} of ${modules.length} ` +
    `registered module${modules.length === 1 ? '' : 's'}: ${rows} requirement rows.`
);
