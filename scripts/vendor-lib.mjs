// Vendoring, as a copy with a record. Three things are made elsewhere and
// copied here byte for byte: the synthetic biomarker study, from gsm.bio;
// safety.viz's script-tag bundle, which a chart's page loads beside bio.viz; and
// gsm.bio's statistics functions, the one file R in the browser is given.
// Nothing in this repository retypes, regenerates or reshapes any of them. Beside
// each copy sits a record, SOURCE.json, naming the repository and commit it
// came from and, for each file, its checksum and size (and, for a CSV file, its
// column names and row count). `verifyVendored` is the check that fails when a
// file and its record no longer agree.
//
// Pure functions over bytes and a folder; scripts/vendor-cli.mjs is the command
// line that fetches the bytes.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const RECORD_FILE = 'SOURCE.json';

// Where the study lives in gsm.bio and what each file is called here. The
// names are gsm.bio's own.
export const STUDY = {
  name: 'Synthetic biomarker study',
  repository: 'https://github.com/jwildfire/gsm.bio',
  directory: 'site/data/synthetic-study',
  files: [
    { file: 'synthetic_results.csv', source: 'inst/extdata/synthetic_results.csv' },
    { file: 'synthetic_participants.csv', source: 'inst/extdata/synthetic_participants.csv' },
    { file: 'synthetic_outcomes.csv', source: 'inst/extdata/synthetic_outcomes.csv' }
  ]
};

// safety.viz's script-tag bundle: the global `SafetyViz`, whose `kit` a chart is
// built from. It is loaded beside bio.viz on a page and never bundled into it.
// The path it is copied from carries safety.viz's version, which the vendoring
// tool reads from safety.viz's own package.json at the commit; here it has one
// name whatever the version, so no page needs editing when it is copied again.
export const SAFETY_VIZ = {
  name: 'safety.viz script-tag bundle',
  // What the record calls the thing copied.
  label: 'bundle',
  repository: 'https://github.com/jwildfire/safety.viz',
  directory: 'site/vendor/safety.viz',
  files: [{ file: 'safety.viz.js', source: 'dist/safety.viz-{version}/safety.viz.js' }]
};

// gsm.bio's statistics functions: one file of R that defines every Analyze_*
// function, written to stand alone. A page hands it to R in the browser as the
// connection's `sourceUrl`, and the desktop-R fixture script sources the same
// copy, so both run one source. It is never edited here.
export const STATISTICS = {
  name: 'gsm.bio statistics functions',
  label: 'statistics',
  repository: 'https://github.com/jwildfire/gsm.bio',
  directory: 'site/vendor/gsm.bio',
  files: [{ file: 'statistics.R', source: 'inst/statistics/statistics.R' }]
};

// safety.viz's portfolio manifest format: the JSON Schema of a chart list.
// bio.viz publishes its chart list in that format (src/data/portfolio.json,
// `BioViz.portfolio`) so safety.viz's demo app can list its charts, and a unit
// test validates the list against this copy. The format is safety.viz's; it is
// copied, never redefined here. It sits beside the list it describes, so the
// list's `$schema`, `./schema/portfolio.json`, names it.
export const PORTFOLIO_SCHEMA = {
  name: 'safety.viz portfolio manifest format',
  label: 'schema',
  repository: 'https://github.com/jwildfire/safety.viz',
  directory: 'src/data/schema',
  files: [{ file: 'portfolio.json', source: 'src/data/schema/portfolio.json' }]
};

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// The column names and the number of data rows of a CSV file, counted without
// interpreting any value. A quoted field could hide a comma or a line break, so
// a file with one is refused rather than miscounted.
export function describeCsv(bytes, file = 'file') {
  const text = Buffer.from(bytes).toString('utf8');
  if (text.includes('"')) {
    throw new Error(`${file}: holds a quoted field, which this counter does not read.`);
  }
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0 || lines[0] === '') throw new Error(`${file}: has no header row.`);
  return { columns: lines[0].split(','), rows: lines.length - 1 };
}

// One record entry for one file's bytes. A CSV file's columns and rows are
// recorded with it; any other file is held by its checksum and size alone.
export function describeFile({ file, source }, bytes) {
  const csv = file.endsWith('.csv') ? describeCsv(bytes, file) : {};
  return { file, source, sha256: sha256(bytes), bytes: bytes.length, ...csv };
}

// The record for a set of files as they were read from one commit. `read` is
// given a path in the source repository and returns that file's bytes. `more`
// is recorded as given, after the commit: a version, a licence, a note.
export function buildRecord({ study = STUDY, ref, commit, license, read, more = {} }) {
  if (!/^[0-9a-f]{40}$/.test(commit || '')) {
    throw new Error(`A source record needs the full 40-character commit, not "${commit}".`);
  }
  const contents = study.files.map((entry) => ({ entry, bytes: Buffer.from(read(entry.source)) }));
  return {
    record: {
      [study.label || 'study']: study.name,
      repository: study.repository,
      ref,
      commit,
      ...(license === undefined ? {} : { license }),
      ...more,
      files: contents.map(({ entry, bytes }) => describeFile(entry, bytes))
    },
    contents
  };
}

// Writes the files exactly as given, and the record beside them.
export function writeVendored(directory, { record, contents }) {
  mkdirSync(directory, { recursive: true });
  for (const { entry, bytes } of contents) writeFileSync(path.join(directory, entry.file), bytes);
  writeFileSync(path.join(directory, RECORD_FILE), JSON.stringify(record, null, 2) + '\n');
}

export function readRecord(directory) {
  return JSON.parse(readFileSync(path.join(directory, RECORD_FILE), 'utf8'));
}

// The check. Returns the list of ways the folder and its record disagree; an
// empty list means every recorded file is present and unchanged, and no CSV
// file is there unrecorded. It never passes by comparing nothing.
export function verifyVendored(directory) {
  const problems = [];
  if (!existsSync(path.join(directory, RECORD_FILE))) {
    return [`${RECORD_FILE} is missing: the files have no source record.`];
  }
  let record;
  try {
    record = readRecord(directory);
  } catch (error) {
    return [`${RECORD_FILE} cannot be read: ${error.message}`];
  }
  if (!/^[0-9a-f]{40}$/.test(record.commit || '')) {
    problems.push(`${RECORD_FILE} does not name the full commit the files were copied from.`);
  }
  if (typeof record.repository !== 'string' || record.repository === '') {
    problems.push(`${RECORD_FILE} does not name the repository the files were copied from.`);
  }
  const files = Array.isArray(record.files) ? record.files : [];
  if (files.length === 0) problems.push(`${RECORD_FILE} records no files.`);

  for (const entry of files) {
    const file = path.join(directory, String(entry.file));
    if (!existsSync(file)) {
      problems.push(`${entry.file}: recorded, but the file is missing.`);
      continue;
    }
    const bytes = readFileSync(file);
    if (sha256(bytes) !== entry.sha256) {
      problems.push(
        `${entry.file}: the file no longer matches its recorded checksum ` +
          `(recorded ${String(entry.sha256).slice(0, 12)}…, found ${sha256(bytes).slice(0, 12)}…).`
      );
      continue;
    }
    if (bytes.length !== entry.bytes) {
      problems.push(`${entry.file}: ${bytes.length} bytes, and the record says ${entry.bytes}.`);
    }
    if (!String(entry.file).endsWith('.csv')) continue;
    const { columns, rows } = describeCsv(bytes, entry.file);
    if (rows !== entry.rows) {
      problems.push(`${entry.file}: ${rows} rows, and the record says ${entry.rows}.`);
    }
    if (JSON.stringify(columns) !== JSON.stringify(entry.columns)) {
      problems.push(`${entry.file}: its columns are not the ones recorded.`);
    }
  }

  // The folder holds what its record names and nothing more.
  const recorded = new Set(files.map((entry) => entry.file));
  for (const file of readdirSync(directory).filter((name) => name !== RECORD_FILE)) {
    if (!recorded.has(file)) problems.push(`${file}: present, but not in ${RECORD_FILE}.`);
  }
  return problems;
}

// The second check, against the source itself: every recorded file equals the
// bytes gsm.bio holds at the recorded commit. `read` is given the commit and a
// path in the source repository and returns that file's bytes.
export async function verifyAgainstSource(directory, read) {
  const record = readRecord(directory);
  const problems = [];
  for (const entry of record.files || []) {
    const theirs = Buffer.from(await read(record.commit, entry.source));
    const file = path.join(directory, entry.file);
    const ours = existsSync(file) ? readFileSync(file) : null;
    if (!ours || !ours.equals(theirs)) {
      problems.push(
        `${entry.file}: differs from ${entry.source} at ${record.commit.slice(0, 7)} of ` +
          `${record.repository}.`
      );
    }
  }
  if ((record.files || []).length === 0) problems.push(`${RECORD_FILE} records no files.`);
  return problems;
}
