// Writes the many-biomarkers fixture: a results table with thirty-six
// biomarkers, three times the study's, and a record of what it was derived
// from. The browser tests load it with the vendored participant table to see
// the group comparison chart draw a trend tile for every one of them.
//
//   node tools/derive-many-biomarkers.mjs
//
// Derived, not typed: scripts/derive-lib.mjs holds the rule, and the unit tests
// derive it again and compare. Rerun this when the vendored study changes.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANY_BIOMARKERS, deriveManyBiomarkers } from '../scripts/derive-lib.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(rootDir, file));
const { text, record } = deriveManyBiomarkers({
  results: read(MANY_BIOMARKERS.sources.results),
  participants: read(MANY_BIOMARKERS.sources.participants)
});
mkdirSync(path.dirname(path.join(rootDir, MANY_BIOMARKERS.file)), { recursive: true });
writeFileSync(path.join(rootDir, MANY_BIOMARKERS.file), text);
writeFileSync(path.join(rootDir, MANY_BIOMARKERS.record), JSON.stringify(record, null, 2) + '\n');
console.log(
  `✓ Wrote ${MANY_BIOMARKERS.file} — ${record.rows} rows, ${record.biomarkers} biomarkers`
);
console.log(`✓ Wrote ${MANY_BIOMARKERS.record}`);
