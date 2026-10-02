import { describe, it, expect } from 'vitest';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RECORD_FILE,
  STUDY,
  buildRecord,
  readRecord,
  sha256,
  verifyAgainstSource,
  verifyVendored,
  writeVendored
} from '../../../scripts/vendor-lib.mjs';

// The vendored synthetic study (#7): three CSV files copied from gsm.bio, with
// a source record beside them. The first group reads the committed files, so a
// file edited by hand, or a record edited without its file, fails `npm test`.
// The second group runs the copy and the check on folders made for the test.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const directory = path.join(ROOT, STUDY.directory);

// The files have no quoted fields (the check refuses one), so a split is a read.
function readTable(file) {
  const [header, ...lines] = readFileSync(path.join(directory, file), 'utf8').trimEnd().split('\n');
  const columns = header.split(',');
  const rows = lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(columns.map((column, index) => [column, cells[index]]));
  });
  return { columns, rows };
}
const distinct = (rows, column) => [...new Set(rows.map((row) => row[column]))];

describe('the vendored synthetic study', () => {
  it('CORE-DATA-001: the three files are in site/data/synthetic-study/ with a record naming the gsm.bio commit and each file there (#7)', () => {
    const record = readRecord(directory);
    expect(record.repository).toBe('https://github.com/jwildfire/gsm.bio');
    expect(record.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(record.files.map(({ file, source }) => [file, source])).toEqual([
      ['synthetic_results.csv', 'inst/extdata/synthetic_results.csv'],
      ['synthetic_participants.csv', 'inst/extdata/synthetic_participants.csv'],
      ['synthetic_outcomes.csv', 'inst/extdata/synthetic_outcomes.csv']
    ]);
    for (const { file } of record.files) {
      expect(readFileSync(path.join(directory, file)).length).toBeGreaterThan(0);
    }
  });

  it('CORE-DATA-002: each vendored file matches its recorded checksum, size, columns and row count (#7)', () => {
    expect(verifyVendored(directory)).toEqual([]);
    // Said again without the checker, so the checker is not its own witness.
    const record = readRecord(directory);
    expect(record.files).toHaveLength(3);
    for (const entry of record.files) {
      const bytes = readFileSync(path.join(directory, entry.file));
      expect(sha256(bytes)).toBe(entry.sha256);
      expect(bytes.length).toBe(entry.bytes);
    }
  });

  it('CORE-DATA-003: the results table has its six columns and 11,472 rows, one per participant, biomarker and visit (#7)', () => {
    const { columns, rows } = readTable('synthetic_results.csv');
    expect(columns).toEqual(['USUBJID', 'VISIT', 'VISITNUM', 'TEST', 'STRESU', 'STRESN']);
    expect(rows).toHaveLength(11472);
    expect(distinct(rows, 'USUBJID')).toHaveLength(200);
    expect(distinct(rows, 'TEST')).toHaveLength(12);
    expect(distinct(rows, 'VISIT')).toEqual(['Baseline', 'Week 2', 'Week 4', 'Week 8', 'Week 12']);
    const keys = new Set(rows.map((row) => `${row.USUBJID}|${row.TEST}|${row.VISIT}`));
    expect(keys.size).toBe(rows.length);
  });

  it('CORE-DATA-004: the participant table has its six columns and 200 rows, one per participant, covering everyone in the results (#7)', () => {
    const { columns, rows } = readTable('synthetic_participants.csv');
    expect(columns).toEqual(['USUBJID', 'ARM', 'SEX', 'AGE', 'BMIBL', 'RESPONSE']);
    expect(rows).toHaveLength(200);
    const participants = new Set(rows.map((row) => row.USUBJID));
    expect(participants.size).toBe(200);
    const results = readTable('synthetic_results.csv').rows;
    expect(distinct(results, 'USUBJID').filter((id) => !participants.has(id))).toEqual([]);
  });

  it('CORE-DATA-005: the outcomes table has its five columns and 200 rows, one per participant and endpoint, all of them known participants (#7)', () => {
    const { columns, rows } = readTable('synthetic_outcomes.csv');
    expect(columns).toEqual(['USUBJID', 'PARAMCD', 'PARAM', 'AVAL', 'CNSR']);
    expect(rows).toHaveLength(200);
    const keys = new Set(rows.map((row) => `${row.USUBJID}|${row.PARAMCD}`));
    expect(keys.size).toBe(200);
    const participants = new Set(
      readTable('synthetic_participants.csv').rows.map((row) => row.USUBJID)
    );
    expect(distinct(rows, 'USUBJID').filter((id) => !participants.has(id))).toEqual([]);
  });
});

describe('vendoring: the copy and its check', () => {
  const COMMIT = '0123456789abcdef0123456789abcdef01234567';
  // Bytes a reshaping copy would not survive: a carriage return, a trailing
  // space and a value with trailing zeros.
  const SOURCES = {
    'inst/extdata/synthetic_results.csv': Buffer.from('USUBJID,STRESN\r\nBIO-001,6.900 \r\n'),
    'inst/extdata/synthetic_participants.csv': Buffer.from('USUBJID,ARM\nBIO-001,Placebo\n'),
    'inst/extdata/synthetic_outcomes.csv': Buffer.from('USUBJID,AVAL\nBIO-001,2.34\n')
  };

  function vendor() {
    const dir = mkdtempSync(path.join(tmpdir(), 'vendor-'));
    const vendored = buildRecord({
      ref: 'dev',
      commit: COMMIT,
      license: 'Apache License (>= 2)',
      read: (source) => SOURCES[source]
    });
    writeVendored(dir, vendored);
    return dir;
  }

  it('CORE-DATA-006: the copy writes each file exactly as the source holds it and records the checksum of those bytes (#7)', () => {
    const dir = vendor();
    const record = readRecord(dir);
    expect(record.commit).toBe(COMMIT);
    expect(record.ref).toBe('dev');
    for (const entry of record.files) {
      const written = readFileSync(path.join(dir, entry.file));
      expect(written.equals(SOURCES[entry.source])).toBe(true);
      expect(entry.sha256).toBe(sha256(SOURCES[entry.source]));
      expect(entry.bytes).toBe(SOURCES[entry.source].length);
    }
    expect(record.files[0].columns).toEqual(['USUBJID', 'STRESN']);
    expect(record.files[0].rows).toBe(1);
    expect(verifyVendored(dir)).toEqual([]);
  });

  it('CORE-DATA-006: a record is refused without the full commit it was copied from (#7)', () => {
    expect(() =>
      buildRecord({ ref: 'dev', commit: 'e602585', read: (source) => SOURCES[source] })
    ).toThrow(/40-character commit/);
  });

  it('CORE-DATA-002: a changed file fails the check, even by one character (#7)', () => {
    const dir = vendor();
    writeFileSync(path.join(dir, 'synthetic_outcomes.csv'), 'USUBJID,AVAL\nBIO-001,2.35\n');
    const problems = verifyVendored(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/synthetic_outcomes\.csv: the file no longer matches/);
  });

  it('CORE-DATA-002: a record edited without its file fails the check (#7)', () => {
    const dir = vendor();
    const record = readRecord(dir);
    record.files[1].sha256 = sha256(Buffer.from('something else'));
    writeFileSync(path.join(dir, RECORD_FILE), JSON.stringify(record));
    expect(verifyVendored(dir).join('\n')).toMatch(
      /synthetic_participants\.csv: the file no longer/
    );
  });

  it('CORE-DATA-002: a missing file, an unrecorded file and a missing record each fail the check (#7)', () => {
    const missing = vendor();
    rmSync(path.join(missing, 'synthetic_results.csv'));
    expect(verifyVendored(missing).join('\n')).toMatch(/synthetic_results\.csv: recorded, but/);

    const extra = vendor();
    copyFileSync(path.join(extra, 'synthetic_outcomes.csv'), path.join(extra, 'another.csv'));
    expect(verifyVendored(extra).join('\n')).toMatch(/another\.csv: present, but not in/);

    const unrecorded = vendor();
    rmSync(path.join(unrecorded, RECORD_FILE));
    expect(verifyVendored(unrecorded)).toEqual([
      'SOURCE.json is missing: the files have no source record.'
    ]);

    const empty = vendor();
    writeFileSync(
      path.join(empty, RECORD_FILE),
      JSON.stringify({ ...readRecord(empty), files: [] })
    );
    expect(verifyVendored(empty).join('\n')).toMatch(/records no files/);
  });

  it('CORE-DATA-006: the check against the source fails when a vendored file differs from the commit it names (#7)', async () => {
    const dir = vendor();
    const asked = [];
    const read = (commit, source) => {
      asked.push([commit, source]);
      return SOURCES[source];
    };
    expect(await verifyAgainstSource(dir, read)).toEqual([]);
    expect(asked.map(([commit]) => commit)).toEqual([COMMIT, COMMIT, COMMIT]);

    const moved = (commit, source) =>
      source.endsWith('participants.csv') ? Buffer.from('USUBJID,ARM\n') : SOURCES[source];
    const problems = await verifyAgainstSource(dir, moved);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/synthetic_participants\.csv: differs from inst\/extdata/);
  });
});
