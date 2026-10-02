// Writes the results-alone fixture: the vendored synthetic results for two
// biomarkers with each participant's ARM carried on the rows, and a record of
// what it was derived from. The browser tests load it with no participant
// table, where a group must come from a column on the results rows.
//
//   node tools/derive-results-with-arm.mjs
//
// Derived, not typed: scripts/derive-lib.mjs holds the rule, and the unit tests
// derive it again and compare. Rerun this when the vendored study changes.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESULTS_WITH_ARM, deriveResultsWithColumn } from '../scripts/derive-lib.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(rootDir, file));
const { text, record } = deriveResultsWithColumn({
  results: read(RESULTS_WITH_ARM.sources.results),
  participants: read(RESULTS_WITH_ARM.sources.participants)
});
mkdirSync(path.dirname(path.join(rootDir, RESULTS_WITH_ARM.file)), { recursive: true });
writeFileSync(path.join(rootDir, RESULTS_WITH_ARM.file), text);
writeFileSync(path.join(rootDir, RESULTS_WITH_ARM.record), JSON.stringify(record, null, 2) + '\n');
console.log(`✓ Wrote ${RESULTS_WITH_ARM.file} — ${record.rows} rows`);
console.log(`✓ Wrote ${RESULTS_WITH_ARM.record}`);
