import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseRequirementMatrix,
  buildRequirementSet,
  compareRequirements,
  findUnregisteredMatrices
} from '../../../scripts/requirements-lib.mjs';

// Requirement-text sync: extract the requirement text from the requirements/
// matrices into a committed docs/requirements/<module>.json so a page can show
// what each test evidences. The extract is a pure function of the matrix
// markdown; a freshness guard (compareRequirements) keeps the committed copy
// from drifting. Carried over from safety.viz, fixture matrix included.

const matrixMd = readFileSync(new URL('./fixtures/requirement-matrix.md', import.meta.url), 'utf8');

describe('requirements-lib: matrix parsing', () => {
  const requirements = parseRequirementMatrix(matrixMd);

  it('maps each requirement ID to its reviewed text (#1)', () => {
    expect(requirements['SH-FUNC-004A']).toBe(
      'Render a gray normal-range band behind histogram data using the measure limits.'
    );
    expect(requirements['SH-CFG-005']).toBe(
      'Missing and non-numeric results are dropped and counted.'
    );
  });

  it('keeps an escaped pipe inside a requirement cell as a single row (#1)', () => {
    // A `\|` in the source renders as a literal pipe; it must not split the row.
    expect(Object.keys(requirements)).toContain('SH-REG-013');
    expect(requirements['SH-REG-013']).toBe(
      'Confirm that adding a filter such as {"value_col":"SITE"} | leaves the x-axis unchanged.'
    );
  });

  it('ignores the header, separator, and non-requirement content (#1)', () => {
    // The `## Source inventory` bullet list and the table header/separator
    // rows must not appear as requirement entries.
    expect(requirements).not.toHaveProperty('ID');
    expect(Object.keys(requirements)).toEqual([
      'SH-FUNC-004A',
      'SH-FUNC-004B',
      'SH-CFG-005',
      'SH-REG-013'
    ]);
  });
});

describe('requirements-lib: requirement set', () => {
  it('wraps the parsed map with module + matrix provenance (#1)', () => {
    const set = buildRequirementSet({
      module: 'histogram',
      matrix: 'safety-histogram.md',
      markdown: matrixMd
    });
    expect(set.module).toBe('histogram');
    expect(set.matrix).toBe('safety-histogram.md');
    expect(set.requirements['SH-FUNC-004A']).toContain('gray normal-range band');
  });
});

describe('requirements-lib: freshness guard', () => {
  const base = buildRequirementSet({
    module: 'histogram',
    matrix: 'safety-histogram.md',
    markdown: matrixMd
  });

  it('reports fresh when the committed set matches a fresh extraction (#1)', () => {
    const { stale, differences } = compareRequirements(base, base);
    expect(stale).toBe(false);
    expect(differences).toEqual([]);
  });

  it('flags changed requirement text (#1)', () => {
    const drifted = {
      ...base,
      requirements: { ...base.requirements, 'SH-CFG-005': 'Reworded requirement.' }
    };
    const { stale, differences } = compareRequirements(base, drifted);
    expect(stale).toBe(true);
    expect(differences.join(' ')).toContain('SH-CFG-005');
  });

  it('flags added and removed requirement IDs (#1)', () => {
    const { ['SH-REG-013']: _removed, ...rest } = base.requirements;
    const removed = { ...base, requirements: rest };
    expect(compareRequirements(base, removed).stale).toBe(true);

    const added = {
      ...base,
      requirements: { ...base.requirements, 'SH-NEW-001': 'A new requirement.' }
    };
    expect(compareRequirements(base, added).stale).toBe(true);
  });
});

describe('requirements-lib: unregistered matrices', () => {
  const modules = [{ module: 'core', matrix: 'core.md' }, { module: 'no-matrix-yet' }];

  it('reports a matrix file no module in site/config.json names (#1)', () => {
    expect(findUnregisteredMatrices(['README.md', 'core.md', 'stray.md'], modules)).toEqual([
      'stray.md'
    ]);
  });

  it('passes when every matrix file is registered, ignoring the README and non-markdown files (#1)', () => {
    expect(findUnregisteredMatrices(['README.md', 'core.md', 'notes.txt'], modules)).toEqual([]);
  });
});
