import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RECORD_FILE,
  STATISTICS,
  buildRecord,
  readRecord,
  sha256,
  verifyAgainstSource,
  verifyVendored,
  writeVendored
} from '../../../scripts/vendor-lib.mjs';

// gsm.bio's statistics functions (#16): one file of R, copied from gsm.bio with
// a record of where it came from. It is the file R in the browser is given and
// the file desktop R sources for the expected results. The first group reads
// the committed copy; the second runs the copy and its check on a folder made
// for the test.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const directory = path.join(ROOT, STATISTICS.directory);

describe('the vendored statistics file', () => {
  it('GC-STAT-024: gsm.bio’s statistics file is in site/vendor/gsm.bio/ with a record naming the repository, the commit and the file it was copied from (#16)', () => {
    const record = readRecord(directory);
    expect(record.statistics).toBe('gsm.bio statistics functions');
    expect(record.repository).toBe('https://github.com/jwildfire/gsm.bio');
    expect(record.ref).toBe('dev');
    expect(record.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(record.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(record.files).toEqual([
      {
        file: 'statistics.R',
        source: 'inst/statistics/statistics.R',
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        bytes: expect.any(Number)
      }
    ]);
    // It defines the function the chart asks for, with the arguments the chart sends.
    const code = readFileSync(path.join(directory, 'statistics.R'), 'utf8');
    expect(code).toMatch(
      /^Analyze_GroupDifference <- function\(dfData, strValueCol, strGroupCol, strMethod = "t", chrGroups = NULL,\n\s+bPairwise = TRUE,/m
    );
  });

  it('GC-STAT-024: the file is sourced with base R alone: it attaches no package, and names survival only inside its survival functions (#16)', () => {
    const lines = readFileSync(path.join(directory, 'statistics.R'), 'utf8').split('\n');
    const code = lines.filter((line) => !line.trimStart().startsWith('#'));
    expect(
      code.filter((line) => /\b(library|require|requireNamespace|loadNamespace)\(/.test(line))
    ).toEqual([]);
    // Every mention of survival is a call inside a function body, which runs
    // only when that function is called. The group comparison is not one of them.
    const survival = code.filter((line) => line.includes('survival::'));
    expect(survival.length).toBeGreaterThan(0);
    expect(survival.every((line) => /^\s+/.test(line))).toBe(true);
    const from = lines.findIndex((line) => line.startsWith('Analyze_GroupDifference <- function'));
    const to = lines.findIndex((line, index) => index > from && line === '}');
    expect(from).toBeGreaterThan(0);
    expect(lines.slice(from, to).some((line) => line.includes('survival::'))).toBe(false);
  });

  it('GC-STAT-025: the vendored file matches its recorded checksum and size (#16)', () => {
    expect(verifyVendored(directory)).toEqual([]);
    const [entry] = readRecord(directory).files;
    const bytes = readFileSync(path.join(directory, entry.file));
    expect(sha256(bytes)).toBe(entry.sha256);
    expect(bytes.length).toBe(entry.bytes);
  });
});

describe('vendoring the statistics file: the copy and its check', () => {
  const COMMIT = '0123456789abcdef0123456789abcdef01234567';
  const BYTES = Buffer.from('Analyze_GroupDifference <- function(dfData) list()\n');
  function vendor() {
    const dir = mkdtempSync(path.join(tmpdir(), 'vendor-statistics-'));
    writeVendored(
      dir,
      buildRecord({
        study: STATISTICS,
        ref: 'dev',
        commit: COMMIT,
        license: 'Apache License (>= 2)',
        more: { version: '0.1.0' },
        read: () => BYTES
      })
    );
    return dir;
  }

  it('GC-STAT-025: the copy writes the file exactly as gsm.bio holds it and records the commit, the licence and the version (#16)', () => {
    const dir = vendor();
    expect(readFileSync(path.join(dir, 'statistics.R')).equals(BYTES)).toBe(true);
    expect(readRecord(dir)).toEqual({
      statistics: 'gsm.bio statistics functions',
      repository: 'https://github.com/jwildfire/gsm.bio',
      ref: 'dev',
      commit: COMMIT,
      license: 'Apache License (>= 2)',
      version: '0.1.0',
      files: [
        {
          file: 'statistics.R',
          source: 'inst/statistics/statistics.R',
          sha256: sha256(BYTES),
          bytes: BYTES.length
        }
      ]
    });
    expect(verifyVendored(dir)).toEqual([]);
  });

  it('GC-STAT-025: an edited file, a missing one and a file beside it that is not recorded each fail the check, and a file that differs from gsm.bio’s at the recorded commit fails the check against the source (#16)', async () => {
    const changed = vendor();
    writeFileSync(path.join(changed, 'statistics.R'), `${BYTES}# a local edit\n`);
    expect(verifyVendored(changed).join('\n')).toMatch(
      /statistics\.R: the file no longer matches its recorded checksum/
    );

    const missing = vendor();
    rmSync(path.join(missing, 'statistics.R'));
    expect(verifyVendored(missing).join('\n')).toMatch(/statistics\.R: recorded, but/);

    const extra = vendor();
    writeFileSync(path.join(extra, 'more.R'), 'x <- 1\n');
    expect(verifyVendored(extra).join('\n')).toMatch(/more\.R: present, but not in/);

    const unrecorded = vendor();
    rmSync(path.join(unrecorded, RECORD_FILE));
    expect(verifyVendored(unrecorded)).toEqual([
      'SOURCE.json is missing: the files have no source record.'
    ]);

    const dir = vendor();
    expect(await verifyAgainstSource(dir, () => BYTES)).toEqual([]);
    const problems = await verifyAgainstSource(dir, () =>
      Buffer.from('Analyze_GroupDifference <- 1\n')
    );
    expect(problems.join('\n')).toMatch(
      /statistics\.R: differs from inst\/statistics\/statistics\.R at 0123456/
    );
  });
});
