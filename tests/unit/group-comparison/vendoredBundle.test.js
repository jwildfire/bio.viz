import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RECORD_FILE,
  SAFETY_VIZ,
  buildRecord,
  readRecord,
  sha256,
  verifyAgainstSource,
  verifyVendored,
  writeVendored
} from '../../../scripts/vendor-lib.mjs';

// safety.viz's bundle (#9): one file, copied from safety.viz with a record of
// where it came from, and loaded beside bio.viz on a chart's page. The first
// group reads the committed copy; the second runs the copy and its check on a
// folder made for the test.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const directory = path.join(ROOT, SAFETY_VIZ.directory);

describe('the vendored safety.viz bundle', () => {
  it('GC-KIT-001: safety.viz’s bundle is in site/vendor/safety.viz/ with a record naming the repository, the commit, the version and the file it was copied from (#9)', () => {
    const record = readRecord(directory);
    expect(record.repository).toBe('https://github.com/jwildfire/safety.viz');
    expect(record.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(record.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(record.files).toHaveLength(1);
    expect(record.files[0].file).toBe('safety.viz.js');
    expect(record.files[0].source).toBe(`dist/safety.viz-${record.version}/safety.viz.js`);
    // It is the script-tag bundle: it defines the global a page reads the kit from.
    const code = readFileSync(path.join(directory, 'safety.viz.js'), 'utf8');
    expect(code.startsWith('var SafetyViz = (() => {')).toBe(true);
    expect(code).toContain('kit: () => kit');
  });

  it('GC-KIT-002: the vendored bundle matches its recorded checksum and size (#9)', () => {
    expect(verifyVendored(directory)).toEqual([]);
    const [entry] = readRecord(directory).files;
    const bytes = readFileSync(path.join(directory, entry.file));
    expect(sha256(bytes)).toBe(entry.sha256);
    expect(bytes.length).toBe(entry.bytes);
    // A bundle is held by its bytes alone: no columns or rows are recorded for it.
    expect(entry).not.toHaveProperty('rows');
  });

  it('GC-KIT-003: the record says whether the commit is on safety.viz’s dev branch, and when it is not, why and what is to be done (#9)', () => {
    const record = readRecord(directory);
    expect(typeof record.merged_to_dev).toBe('boolean');
    if (!record.merged_to_dev) {
      expect(record.note).toMatch(/unmerged branch/);
      expect(record.note).toMatch(/make this copy again from dev/);
    }
    // The kit has merged (#37): the copy is safety.viz's dev at a recorded
    // commit, and the record carries no note of an unmerged branch.
    expect(record).toMatchObject({ ref: 'dev', merged_to_dev: true });
    expect(record.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(record).not.toHaveProperty('note');
  });
});

describe('the vendored safety.viz bundle: its release', () => {
  it('GC-KIT-004: the record names the safety.viz release the copy is byte for byte, its tag and the tag’s commit, beside the dev commit it was copied from; the source check holds the copy to both (#78)', async () => {
    const record = readRecord(directory);
    expect(record.release).toEqual({
      tag: `v${record.version}`,
      commit: expect.stringMatching(/^[0-9a-f]{40}$/)
    });
    expect(record.release.commit).not.toBe(record.commit);
    // The source check reads the file at the tag's commit as well as at dev's.
    const asked = [];
    const bytes = readFileSync(path.join(directory, record.files[0].file));
    const problems = await verifyAgainstSource(directory, async (commit, file) => {
      asked.push([commit, file]);
      return bytes;
    });
    expect(problems).toEqual([]);
    expect(asked.map(([commit]) => commit)).toEqual([record.commit, record.release.commit]);
    // A release whose file differs is a problem, named by its tag.
    const differs = await verifyAgainstSource(directory, async (commit) =>
      commit === record.release.commit ? Buffer.from('other') : bytes
    );
    expect(differs.join('\n')).toMatch(new RegExp(`differs from .* at ${record.release.tag}`));
  });
});

describe('vendoring a bundle: the copy and its check', () => {
  const COMMIT = '0123456789abcdef0123456789abcdef01234567';
  const BYTES = Buffer.from('var SafetyViz = (() => ({ kit: Object.freeze({}) }))();\r\n');
  const source = {
    ...SAFETY_VIZ,
    files: [{ file: 'safety.viz.js', source: 'dist/safety.viz-9.9.9/safety.viz.js' }]
  };
  function vendor() {
    const dir = mkdtempSync(path.join(tmpdir(), 'vendor-bundle-'));
    writeVendored(
      dir,
      buildRecord({
        study: source,
        ref: '154-kit',
        commit: COMMIT,
        more: { version: '9.9.9', merged_to_dev: false, note: 'Why, and what to do later.' },
        read: () => BYTES
      })
    );
    return dir;
  }

  it('GC-KIT-002: the copy writes the bundle exactly as the source holds it and records what was asked of it (#9)', () => {
    const dir = vendor();
    expect(readFileSync(path.join(dir, 'safety.viz.js')).equals(BYTES)).toBe(true);
    expect(readRecord(dir)).toEqual({
      bundle: 'safety.viz script-tag bundle',
      repository: 'https://github.com/jwildfire/safety.viz',
      ref: '154-kit',
      commit: COMMIT,
      version: '9.9.9',
      merged_to_dev: false,
      note: 'Why, and what to do later.',
      files: [
        {
          file: 'safety.viz.js',
          source: 'dist/safety.viz-9.9.9/safety.viz.js',
          sha256: sha256(BYTES),
          bytes: BYTES.length
        }
      ]
    });
    expect(verifyVendored(dir)).toEqual([]);
  });

  it('GC-KIT-002: a changed bundle, a missing one, and a file beside it that is not recorded each fail the check (#9)', async () => {
    const changed = vendor();
    writeFileSync(path.join(changed, 'safety.viz.js'), 'var SafetyViz = {};');
    expect(verifyVendored(changed).join('\n')).toMatch(
      /safety\.viz\.js: the file no longer matches/
    );

    const missing = vendor();
    rmSync(path.join(missing, 'safety.viz.js'));
    expect(verifyVendored(missing).join('\n')).toMatch(/safety\.viz\.js: recorded, but/);

    const extra = vendor();
    copyFileSync(path.join(extra, 'safety.viz.js'), path.join(extra, 'safety.viz.esm.js'));
    expect(verifyVendored(extra).join('\n')).toMatch(/safety\.viz\.esm\.js: present, but not in/);

    const unrecorded = vendor();
    rmSync(path.join(unrecorded, RECORD_FILE));
    expect(verifyVendored(unrecorded)).toEqual([
      'SOURCE.json is missing: the files have no source record.'
    ]);

    // Against the source: the same bytes pass, other bytes fail.
    const dir = vendor();
    expect(await verifyAgainstSource(dir, () => BYTES)).toEqual([]);
    const problems = await verifyAgainstSource(dir, () => Buffer.from('var SafetyViz = 1;'));
    expect(problems.join('\n')).toMatch(/safety\.viz\.js: differs from dist\/safety\.viz-9\.9\.9/);
  });
});
