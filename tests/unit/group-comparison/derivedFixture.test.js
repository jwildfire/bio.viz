import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESULTS_WITH_ARM, deriveResultsWithColumn } from '../../../scripts/derive-lib.mjs';
import { readRecord, sha256 } from '../../../scripts/vendor-lib.mjs';

// The results-alone fixture (#9): derived from the vendored study by a recorded
// rule, never typed. Deriving it again here must give the committed file.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (file) => readFileSync(path.join(ROOT, file));

describe('the results-alone fixture', () => {
  it('GC-DATA-012: deriving the fixture again from the vendored study gives the committed file, byte for byte (#9)', () => {
    const { text, record } = deriveResultsWithColumn({
      results: read(RESULTS_WITH_ARM.sources.results),
      participants: read(RESULTS_WITH_ARM.sources.participants)
    });
    expect(read(RESULTS_WITH_ARM.file).toString('utf8')).toBe(text);
    expect(JSON.parse(read(RESULTS_WITH_ARM.record).toString('utf8'))).toEqual(record);
    expect(record.sha256).toBe(sha256(read(RESULTS_WITH_ARM.file)));
    expect(record.rule).toContain('TEST is one of IL-6, CRP');
  });

  it('GC-DATA-012: the fixture’s record names the vendored files it was derived from, by the checksums the study’s own record holds (#9)', () => {
    const record = JSON.parse(read(RESULTS_WITH_ARM.record).toString('utf8'));
    const study = readRecord(path.join(ROOT, 'site/data/synthetic-study'));
    const recorded = Object.fromEntries(
      study.files.map((entry) => [`site/data/synthetic-study/${entry.file}`, entry.sha256])
    );
    expect(record.derived_from).toHaveLength(2);
    for (const source of record.derived_from) {
      expect(source.sha256, source.file).toBe(recorded[source.file]);
    }
  });

  it('GC-DATA-012: every cell of the fixture is a cell of a vendored file: the results rows of two biomarkers, each with the participant’s arm (#9)', () => {
    const lines = read(RESULTS_WITH_ARM.file).toString('utf8').trimEnd().split('\n');
    expect(lines[0]).toBe('USUBJID,VISIT,VISITNUM,TEST,STRESU,STRESN,ARM');
    const results = read(RESULTS_WITH_ARM.sources.results).toString('utf8').trimEnd().split('\n');
    const arm = Object.fromEntries(
      read(RESULTS_WITH_ARM.sources.participants)
        .toString('utf8')
        .trimEnd()
        .split('\n')
        .slice(1)
        .map((line) => line.split(',').slice(0, 2))
    );
    const expected = results
      .slice(1)
      .filter((line) => ['IL-6', 'CRP'].includes(line.split(',')[3]))
      .map((line) => `${line},${arm[line.split(',')[0]]}`);
    expect(lines.slice(1)).toEqual(expected);
    expect(lines).toHaveLength(1913);
    // One arm for each participant, on every one of their rows.
    const arms = new Map();
    for (const line of lines.slice(1)) {
      const cells = line.split(',');
      if (!arms.has(cells[0])) arms.set(cells[0], new Set());
      arms.get(cells[0]).add(cells[6]);
    }
    expect(arms.size).toBe(200);
    expect([...arms.values()].every((set) => set.size === 1)).toBe(true);
  });
});
