import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderEvidencePage, validateEvidenceScreenshots } from '../../../scripts/site-lib.mjs';

// A module's evidence page (#7): its requirements, the tests named for each,
// what each recorded, and the screenshots a test captured.

const config = {
  repoUrl: 'https://github.com/jwildfire/bio.viz',
  matrixBaseUrl: 'https://github.com/jwildfire/bio.viz/blob/HEAD/requirements'
};
const entry = { module: 'group-comparison', title: 'Group comparison', matrix: 'gc.md' };
const requirements = {
  'GC-DRAW-001': 'A box is drawn per level of the `group` variable.',
  'GC-DRAW-002': 'The count in each group is printed beneath it.',
  'GC-LIST-001': 'Clicking a box lists its participants.'
};
const record = (test, suite, status, requirementIds, screenshots = []) => ({
  test,
  suite,
  status,
  requirementIds,
  issueRefs: [9],
  screenshots
});
const evidence = {
  module: 'group-comparison',
  generatedAt: '2026-10-02T15:04:05.000Z',
  environment: { os: 'linux 6.8.0', node: 'v22.17.0', playwright: '1.61.1', chromium: '149.0' },
  run: { id: '123', url: 'https://github.com/jwildfire/bio.viz/actions/runs/123' },
  records: [
    record('GC-DRAW-001: one box per group (#9)', 'unit', 'pass', ['GC-DRAW-001']),
    record(
      'GC-DRAW-001: the boxes are drawn on the page (#9)',
      'browser',
      'pass',
      ['GC-DRAW-001'],
      ['GC-DRAW-001-boxes.png', 'GC-DRAW-002-counts.png']
    ),
    record(
      'GC-DRAW-002: counts beneath (#9)',
      'browser',
      'fail',
      ['GC-DRAW-002'],
      ['GC-DRAW-002-counts.png']
    ),
    record('CORE-SITE-001: the home page names the library (#1)', 'browser', 'pass', [
      'CORE-SITE-001'
    ]),
    record('the site build fails on a broken link (#1)', 'unit', 'pass', [])
  ]
};

// The PNG files committed in the module's evidence folder.
const screenshots = ['GC-DRAW-002-counts.png', 'GC-DRAW-001-boxes.png', 'GC-DRAW-0011-other.png'];

const render = (overrides = {}) =>
  renderEvidencePage({ entry, config, requirements, evidence, screenshots, ...overrides });
const row = (html, id) =>
  html.match(new RegExp(`<li class="requirement" id="${id}"[\\s\\S]*?</li>\\n`))[0];
const fact = (html, id) => html.match(new RegExp(`id="${id}">([\\s\\S]*?)</dd>`))[1];

describe('evidence page', () => {
  it('CORE-SITE-006: every requirement is listed in the matrix’s order with its text (#7)', () => {
    const html = render();
    const ids = [...html.matchAll(/<li class="requirement" id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(['GC-DRAW-001', 'GC-DRAW-002', 'GC-LIST-001']);
    expect(row(html, 'GC-DRAW-001')).toContain(
      'A box is drawn per level of the <code>group</code> variable.'
    );
    expect(fact(html, 'fact-requirements')).toBe('3');
  });

  it('CORE-SITE-006: each requirement shows the tests named for it, unit or browser, with the result each recorded (#7)', () => {
    const html = render();
    const first = row(html, 'GC-DRAW-001');
    expect(first).toContain('data-status="pass"');
    expect(first).toContain('<span class="suite">unit</span> GC-DRAW-001: one box per group');
    expect(first).toContain(
      '<span class="suite">browser</span> GC-DRAW-001: the boxes are drawn on the page'
    );
    expect(first.match(/chip status-pass/g)).toHaveLength(3);
    // The issue a test belongs to is a link.
    expect(first).toContain('(<a href="https://github.com/jwildfire/bio.viz/issues/9">#9</a>)');
    // A test of another requirement is not listed here.
    expect(first).not.toContain('counts beneath');

    const second = row(html, 'GC-DRAW-002');
    expect(second).toContain('data-status="fail"');
    expect(second).toContain('<span class="chip status-fail">fail</span>');
    expect(fact(html, 'fact-tests')).toContain('3 ');
    expect(fact(html, 'fact-tests')).toContain('(1 unit, 2 browser)');
    expect(fact(html, 'fact-result')).toContain('1 test failing');
  });

  it('CORE-SITE-006: a requirement with no test says so, and the summary counts it (#7)', () => {
    const html = render();
    const third = row(html, 'GC-LIST-001');
    expect(third).toContain('data-status="none"');
    expect(third).toContain('<span class="chip status-none">no test</span>');
    expect(third).toContain('No test is named for this requirement.');

    const passing = render({
      evidence: { ...evidence, records: evidence.records.filter((r) => r.status === 'pass') }
    });
    expect(fact(passing, 'fact-result')).toContain('2 requirements with no test');
  });

  it('CORE-SITE-006: with every requirement tested and passing the summary says every test is passing (#7)', () => {
    const html = render({
      requirements: { 'GC-DRAW-001': requirements['GC-DRAW-001'] }
    });
    expect(fact(html, 'fact-result')).toContain('every test passing');
  });

  it('CORE-SITE-006: tests that carry none of the module’s requirements are listed apart, as run with every module (#7)', () => {
    const html = render();
    const shared = html.match(/<section id="shared-tests">[\s\S]*?<\/section>/)[0];
    expect(shared).toContain('2 tests of the site');
    expect(shared).toContain('CORE-SITE-001: the home page names the library');
    expect(shared).toContain('the site build fails on a broken link');
    expect(html.match(/<section id="requirements">[\s\S]*?<\/section>/)[0]).not.toContain(
      'CORE-SITE-001'
    );
  });

  it('CORE-SITE-007: a screenshot is shown under the requirement it was captured for, and only there (#7)', () => {
    const html = render();
    expect(row(html, 'GC-DRAW-001')).toContain('src="evidence/GC-DRAW-001-boxes.png"');
    expect(row(html, 'GC-DRAW-001')).toContain('href="evidence/GC-DRAW-001-boxes.png"');
    expect(row(html, 'GC-DRAW-001')).toContain('test of GC-DRAW-001: boxes"');
    expect(row(html, 'GC-DRAW-001')).not.toContain('GC-DRAW-002-counts.png');
    // A file named for a longer ID is not mistaken for this one's.
    expect(row(html, 'GC-DRAW-001')).not.toContain('GC-DRAW-0011-other.png');
    expect(row(html, 'GC-DRAW-002')).toContain('src="evidence/GC-DRAW-002-counts.png"');
    expect(row(html, 'GC-LIST-001')).not.toContain('<img');
    expect(fact(html, 'fact-screenshots')).toBe('2');
    expect(fact(render({ screenshots: [] }), 'fact-screenshots')).toBe('0');
  });

  it('CORE-SITE-007: the build is told of a screenshot the evidence names that is not committed (#7)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'evidence-'));
    writeFileSync(path.join(dir, 'GC-DRAW-001-boxes.png'), '');
    const errors = validateEvidenceScreenshots(evidence, dir, 'docs/evidence/group-comparison');
    expect(errors).toEqual([
      'the evidence set names a screenshot that is not in docs/evidence/group-comparison: ' +
        'GC-DRAW-002-counts.png'
    ]);
    writeFileSync(path.join(dir, 'GC-DRAW-002-counts.png'), '');
    expect(validateEvidenceScreenshots(evidence, dir)).toEqual([]);
  });

  it('CORE-SITE-008: the page says when and where the results were recorded and links the run (#7)', () => {
    const html = render();
    expect(fact(html, 'fact-recorded')).toBe('2026-10-02 15:04 UTC');
    expect(fact(html, 'fact-environment')).toBe(
      'linux 6.8.0 · node v22.17.0 · playwright 1.61.1 · chromium 149.0'
    );
    expect(fact(html, 'fact-run')).toContain(
      '<a href="https://github.com/jwildfire/bio.viz/actions/runs/123">'
    );
    // A result links the run that recorded it.
    expect(row(html, 'GC-DRAW-001')).toContain(
      '<a class="chip-link" href="https://github.com/jwildfire/bio.viz/actions/runs/123">'
    );
  });

  it('CORE-SITE-008: results recorded on a developer’s machine say so, and absent provenance is not invented (#7)', () => {
    const local = render({ evidence: { ...evidence, run: null } });
    expect(fact(local, 'fact-run')).toContain('not in continuous integration');
    expect(local).not.toContain('class="chip-link"');

    const bare = render({ evidence: { records: evidence.records } });
    expect(fact(bare, 'fact-recorded')).toBe('Not recorded for this evidence set');
    expect(fact(bare, 'fact-environment')).toBe('Not recorded for this evidence set');
    expect(fact(bare, 'fact-run')).toBe('Not recorded for this evidence set');
  });

  it('the page links the module’s requirement matrix and its committed evidence set (#7)', () => {
    const html = render();
    expect(html).toContain(
      'href="https://github.com/jwildfire/bio.viz/blob/HEAD/requirements/gc.md"'
    );
    expect(html).toContain(
      'href="https://github.com/jwildfire/bio.viz/blob/HEAD/docs/evidence/group-comparison/evidence.json"'
    );
    expect(html).toContain('href="api.html"');
    expect(html).toContain('href="../gallery/index.html"');
  });
});
