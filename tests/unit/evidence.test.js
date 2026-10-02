import { describe, it, expect } from 'vitest';
import {
  parseTestName,
  moduleForFile,
  normalizeVitest,
  normalizePlaywright,
  buildRun,
  buildEvidenceSets,
  compareEvidence,
  findTraceabilityGaps
} from '../../scripts/evidence-lib.mjs';

// Evidence pipeline: reporter output → docs/evidence/<module>/evidence.json,
// one set per module. The normalizer + router are the unit-testable core.
//
// These tests and their fixture records are carried over from safety.viz, where
// the pipeline was written: the module names and requirement IDs inside the
// fixtures (histogram, shift-plot, SH-*, SSP-*) are safety.viz's and stand in
// for any two registered modules.

const MODULES = ['histogram', 'shift-plot'];

const PROVENANCE = {
  generatedAt: '2026-07-11T12:00:00.000Z',
  environment: {
    os: 'linux 6.8.0',
    node: 'v22.17.0',
    playwright: '1.61.1',
    chromium: '149.0.7827.55'
  },
  run: { id: '123', url: 'https://github.com/jwildfire/safety.viz/actions/runs/123' }
};

const VITEST_FIXTURE = {
  testResults: [
    {
      name: '/repo/tests/unit/histogram/structureData.test.js',
      assertionResults: [
        {
          fullName:
            'histogram structureData > SH-DATA-002: missing and non-numeric results are removed with a reported count (#2)',
          status: 'passed'
        },
        {
          fullName:
            "histogram structureData > SH-CTRL-006: binning algorithms produce the pilot's bin quantities (#2)",
          status: 'failed'
        }
      ]
    },
    {
      name: '/repo/tests/unit/shift-plot/structureData.test.js',
      assertionResults: [
        {
          fullName:
            'shift-plot structureData > SSP-DATA-001: baseline and comparison values pair by participant (#23)',
          status: 'passed'
        }
      ]
    },
    {
      name: '/repo/tests/unit/main.test.js',
      assertionResults: [
        {
          fullName: 'safety.viz entry > module entry exposes the renderer factories (#1)',
          status: 'passed'
        }
      ]
    }
  ]
};

const PLAYWRIGHT_FIXTURE = {
  suites: [
    {
      title: 'histogram.spec.js',
      file: 'histogram.spec.js',
      suites: [
        {
          title: 'safety.viz histogram module',
          file: 'histogram.spec.js',
          specs: [
            {
              title:
                'SH-CTRL-004/SH-FUNC-004A/SH-FUNC-004B: normal range checkbox toggles a stable overlay region (#2)',
              file: 'histogram.spec.js',
              tests: [{ results: [{ status: 'passed' }] }]
            },
            {
              title:
                'SH-FUNC-011: selecting a bar de-emphasizes the bars outside the linked listing (#2)',
              file: 'histogram.spec.js',
              tests: [{ results: [{ status: 'failed' }] }]
            }
          ]
        }
      ]
    },
    {
      title: 'shift-plot.spec.js',
      file: 'shift-plot.spec.js',
      suites: [
        {
          title: 'safety.viz shift-plot module',
          file: 'shift-plot.spec.js',
          specs: [
            {
              title: 'SSP-CHART-001: baseline versus comparison scatter renders (#23)',
              file: 'shift-plot.spec.js',
              tests: [{ results: [{ status: 'passed' }] }]
            }
          ]
        }
      ]
    },
    {
      title: 'smoke.spec.js',
      file: 'smoke.spec.js',
      suites: [
        {
          title: 'safety.viz scaffold',
          file: 'smoke.spec.js',
          specs: [
            {
              title: 'demo page loads with no console errors (#1)',
              file: 'smoke.spec.js',
              tests: [{ results: [{ status: 'passed' }] }]
            }
          ]
        }
      ]
    }
  ]
};

describe('evidence normalizer', () => {
  it('parseTestName extracts requirement IDs and issue refs (#1)', () => {
    const parsed = parseTestName(
      'SH-CTRL-001/SH-CTRL-002/SH-CTRL-006: renders measure, filter, axis, bin, and group controls (#2)'
    );
    expect(parsed.requirementIds).toEqual(['SH-CTRL-001', 'SH-CTRL-002', 'SH-CTRL-006']);
    expect(parsed.issueRefs).toEqual([2]);

    const suffixed = parseTestName(
      'SH-FUNC-004C: normal range control is hidden when the measure has no normal range data (#2)'
    );
    expect(suffixed.requirementIds).toEqual(['SH-FUNC-004C']);

    expect(parseTestName('demo page loads with no console errors (#1)').requirementIds).toEqual([]);
  });

  it('parseTestName recognizes any requirement-ID prefix, not just SH (#1)', () => {
    expect(
      parseTestName('SSP-DATA-001: baseline and comparison values pair by participant (#23)')
        .requirementIds
    ).toEqual(['SSP-DATA-001']);
    expect(
      parseTestName('SROT-CHART-002A/AET-FUNC-003: combined evidence row (#24)').requirementIds
    ).toEqual(['SROT-CHART-002A', 'AET-FUNC-003']);
    // Prose that merely looks dashed must not mint requirement IDs.
    expect(parseTestName('exports SUBJ-006 rows to CSV (#2)').requirementIds).toEqual([]);
  });

  it('moduleForFile routes test files to modules by path (#1)', () => {
    // Unit tests live in tests/unit/<module>/.
    expect(moduleForFile('/repo/tests/unit/histogram/structureData.test.js', MODULES)).toBe(
      'histogram'
    );
    expect(moduleForFile('tests/unit/shift-plot/configure.test.js', MODULES)).toBe('shift-plot');
    // Browser specs are tests/e2e/<module>.spec.js (the JSON reporter emits
    // testDir-relative paths).
    expect(moduleForFile('histogram.spec.js', MODULES)).toBe('histogram');
    expect(moduleForFile('tests/e2e/shift-plot.spec.js', MODULES)).toBe('shift-plot');
    // Everything else is shared scaffold evidence.
    for (const shared of [
      'site.spec.js',
      'smoke.spec.js',
      '/repo/tests/unit/main.test.js',
      '/repo/tests/unit/evidence.test.js',
      '/repo/tests/unit/api/schema.test.js',
      '/repo/tests/unit/site/gallery.test.js',
      'tests/unit/not-a-renderer/foo.test.js'
    ]) {
      expect(moduleForFile(shared, MODULES)).toBe(null);
    }
  });

  it('normalizeVitest maps assertion results to unit-suite records (#1)', () => {
    const records = normalizeVitest(VITEST_FIXTURE);
    expect(records).toHaveLength(4);
    expect(records[0]).toMatchObject({
      suite: 'unit',
      status: 'pass',
      requirementIds: ['SH-DATA-002'],
      issueRefs: [2],
      file: '/repo/tests/unit/histogram/structureData.test.js'
    });
    expect(records[1].status).toBe('fail');
    expect(records[1].requirementIds).toEqual(['SH-CTRL-006']);
  });

  it('normalizePlaywright walks nested suites into browser-suite records (#1)', () => {
    const records = normalizePlaywright(PLAYWRIGHT_FIXTURE);
    expect(records).toHaveLength(4);
    expect(records[0]).toMatchObject({
      suite: 'browser',
      status: 'pass',
      requirementIds: ['SH-CTRL-004', 'SH-FUNC-004A', 'SH-FUNC-004B'],
      file: 'histogram.spec.js'
    });
    expect(records[1]).toMatchObject({ suite: 'browser', status: 'fail' });
    expect(records[2]).toMatchObject({ file: 'shift-plot.spec.js' });
  });

  it('buildRun builds GitHub Actions run provenance from the environment (#1)', () => {
    expect(buildRun({})).toBe(null);
    expect(
      buildRun({
        GITHUB_RUN_ID: '123',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'jwildfire/bio.viz'
      })
    ).toEqual({ id: '123', url: 'https://github.com/jwildfire/bio.viz/actions/runs/123' });
  });

  it('buildEvidenceSets splits records per module and duplicates shared scaffold records (#1)', () => {
    const sets = buildEvidenceSets({
      modules: MODULES,
      vitest: VITEST_FIXTURE,
      playwright: PLAYWRIGHT_FIXTURE,
      screenshotsByModule: {
        histogram: ['SH-CTRL-004-normal-range-overlay.png'],
        'shift-plot': ['SSP-CHART-001-scatter.png']
      },
      provenance: PROVENANCE
    });

    // Only modules with module-routed records get an evidence set.
    expect(Object.keys(sets).sort()).toEqual(['histogram', 'shift-plot']);

    // histogram: 2 unit + 2 browser of its own, plus the 2 shared scaffold
    // records (main.test.js, smoke.spec.js).
    expect(sets.histogram.module).toBe('histogram');
    expect(sets.histogram.records).toHaveLength(6);
    // shift-plot: 1 unit + 1 browser of its own, plus the same 2 shared records.
    expect(sets['shift-plot'].records).toHaveLength(4);
    const sharedTest = 'demo page loads with no console errors (#1)';
    expect(sets.histogram.records.some((r) => r.test === sharedTest)).toBe(true);
    expect(sets['shift-plot'].records.some((r) => r.test === sharedTest)).toBe(true);
    // Module records never leak across sets.
    expect(sets['shift-plot'].records.some((r) => r.requirementIds.includes('SH-DATA-002'))).toBe(
      false
    );

    // Screenshots attach per module, by requirement-ID prefix.
    const overlay = sets.histogram.records.find((r) => r.requirementIds.includes('SH-CTRL-004'));
    expect(overlay.screenshots).toEqual(['SH-CTRL-004-normal-range-overlay.png']);
    const scatter = sets['shift-plot'].records.find((r) =>
      r.requirementIds.includes('SSP-CHART-001')
    );
    expect(scatter.screenshots).toEqual(['SSP-CHART-001-scatter.png']);

    // Records are the committed contract: sorted, file-free, screenshot-ready.
    for (const set of Object.values(sets)) {
      for (const rec of set.records) {
        expect(rec).not.toHaveProperty('file');
        expect(rec).toHaveProperty('screenshots');
      }
    }

    // Deterministic given the same inputs.
    const again = buildEvidenceSets({
      modules: MODULES,
      vitest: VITEST_FIXTURE,
      playwright: PLAYWRIGHT_FIXTURE,
      screenshotsByModule: { histogram: ['SH-CTRL-004-normal-range-overlay.png'] },
      provenance: PROVENANCE
    });
    expect(again.histogram.records.map((r) => r.test)).toEqual(
      sets.histogram.records.map((r) => r.test)
    );
  });

  it('provenance lives in dedicated top-level keys; the records array stays timestamp-free (#1)', () => {
    const sets = buildEvidenceSets({
      modules: MODULES,
      vitest: VITEST_FIXTURE,
      playwright: PLAYWRIGHT_FIXTURE,
      provenance: PROVENANCE
    });
    expect(sets.histogram.generatedAt).toBe('2026-07-11T12:00:00.000Z');
    expect(sets.histogram.environment).toEqual(PROVENANCE.environment);
    expect(sets.histogram.run).toEqual(PROVENANCE.run);
    // The records array remains a pure function of the test run.
    expect(JSON.stringify(sets.histogram.records)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('compareEvidence flags status drift and test-set changes, ignoring screenshots (#1)', () => {
    const build = (screenshotsByModule) =>
      buildEvidenceSets({
        modules: MODULES,
        vitest: VITEST_FIXTURE,
        playwright: PLAYWRIGHT_FIXTURE,
        screenshotsByModule,
        provenance: PROVENANCE
      }).histogram;
    const committed = build({ histogram: ['SH-CTRL-004-normal-range-overlay.png'] });
    const same = build({});
    expect(compareEvidence(committed, same).stale).toBe(false);

    const flipped = JSON.parse(JSON.stringify(same));
    flipped.records[0].status = flipped.records[0].status === 'pass' ? 'fail' : 'pass';
    const drift = compareEvidence(committed, flipped);
    expect(drift.stale).toBe(true);
    expect(drift.differences.length).toBeGreaterThan(0);

    const missing = JSON.parse(JSON.stringify(same));
    missing.records.pop();
    expect(compareEvidence(committed, missing).stale).toBe(true);
  });

  it('compareEvidence ignores provenance so --check never drifts on generatedAt/environment/run (#1)', () => {
    const sets = buildEvidenceSets({
      modules: MODULES,
      vitest: VITEST_FIXTURE,
      playwright: PLAYWRIGHT_FIXTURE,
      provenance: PROVENANCE
    });
    const fresh = buildEvidenceSets({
      modules: MODULES,
      vitest: VITEST_FIXTURE,
      playwright: PLAYWRIGHT_FIXTURE,
      provenance: {
        generatedAt: '2026-08-01T00:00:00.000Z',
        environment: {
          os: 'darwin 23.6.0',
          node: 'v24.0.0',
          playwright: '1.62.0',
          chromium: '150.0.0.0'
        },
        run: null
      }
    });
    expect(compareEvidence(sets.histogram, fresh.histogram).stale).toBe(false);
  });

  it('CORE-SITE-011: a requirement row with no test named for it is reported (#7)', () => {
    const sets = buildEvidenceSets({
      modules: MODULES,
      vitest: VITEST_FIXTURE,
      playwright: PLAYWRIGHT_FIXTURE
    });
    const tested = [
      'SH-DATA-002',
      'SH-CTRL-006',
      'SH-CTRL-004',
      'SH-FUNC-004A',
      'SH-FUNC-004B',
      'SH-FUNC-011',
      'SSP-DATA-001',
      'SSP-CHART-001'
    ];
    expect(findTraceabilityGaps({ requirementIds: tested, sets })).toEqual({
      untested: [],
      unknown: []
    });
    expect(
      findTraceabilityGaps({ requirementIds: [...tested, 'SSP-LIST-001', 'SH-LIST-009'], sets })
    ).toEqual({ untested: ['SH-LIST-009', 'SSP-LIST-001'], unknown: [] });
  });

  it('CORE-SITE-011: a test that names a requirement in no matrix is reported with the test (#7)', () => {
    const sets = {
      histogram: {
        records: [
          { test: 'SH-DATA-002: rows are removed (#2)', requirementIds: ['SH-DATA-002'] },
          { test: 'SH-DATA-200: a slip of the keys (#2)', requirementIds: ['SH-DATA-200'] }
        ]
      },
      'shift-plot': {
        records: [{ test: 'SH-DATA-200: a slip of the keys (#2)', requirementIds: ['SH-DATA-200'] }]
      }
    };
    expect(findTraceabilityGaps({ requirementIds: ['SH-DATA-002'], sets })).toEqual({
      untested: [],
      unknown: [{ id: 'SH-DATA-200', test: 'SH-DATA-200: a slip of the keys (#2)' }]
    });
    // With no evidence at all, every row is untested: it never passes by comparing nothing.
    expect(findTraceabilityGaps({ requirementIds: ['SH-DATA-002'], sets: {} })).toEqual({
      untested: ['SH-DATA-002'],
      unknown: []
    });
  });
});
