// Writes the rows desktop R is run on for the association scatter's expected
// results: one CSV file per case under tests/fixtures/association-statistics/,
// the list of cases, and a record of what they were derived from.
//
//   node tools/derive-association-statistics.mjs
//
// Derived, not typed: scripts/association-statistics-lib.mjs makes each case's
// rows with the chart's own code from the demo page's own tables and settings,
// and the unit tests derive them again and compare. Rerun this when the
// vendored study, the core's frame or the demo's settings change, then `npm run
// fixtures` so R answers for the new rows.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSOCIATION_STATISTICS,
  deriveAssociationStatistics
} from '../scripts/association-statistics-lib.mjs';
import { sha256 } from '../scripts/vendor-lib.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(rootDir, file));
const sources = Object.fromEntries(
  Object.entries(ASSOCIATION_STATISTICS.sources).map(([name, file]) => [
    name,
    read(file).toString('utf8')
  ])
);
const { files, record } = deriveAssociationStatistics(sources);
record.derived_from = record.derived_from.map(({ file }) => ({ file, sha256: sha256(read(file)) }));

const directory = path.join(rootDir, ASSOCIATION_STATISTICS.directory);
mkdirSync(directory, { recursive: true });
// The folder holds what this run writes and nothing left over from another.
for (const file of readdirSync(directory)) rmSync(path.join(directory, file));
for (const { file, text } of files) {
  writeFileSync(path.join(directory, file), text);
  console.log(
    `✓ Wrote ${ASSOCIATION_STATISTICS.directory}/${file} — ${text.split('\n').length - 2} rows`
  );
}
writeFileSync(
  path.join(rootDir, ASSOCIATION_STATISTICS.record),
  JSON.stringify(record, null, 2) + '\n'
);
console.log(`✓ Wrote ${ASSOCIATION_STATISTICS.record}`);
