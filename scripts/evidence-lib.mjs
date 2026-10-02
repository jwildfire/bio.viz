// Evidence normalizer: reshapes Vitest/Playwright JSON-reporter output into the
// committed docs/evidence/<module>/evidence.json contract — one evidence set
// per module. Run provenance (generatedAt / environment / run) lives in
// dedicated top-level keys; the records array is deliberately timestamp-free so
// it stays a pure function of the test run and the freshness guard
// (compareEvidence) can ignore provenance entirely. Carried over from
// safety.viz.

// Requirement IDs are `<PREFIX>-<AREA>-<NUM><suffix?>` per the matrices in
// requirements/ — CORE-API-001, RCON-FORM-002, … The pattern is structural
// rather than an enumerated prefix list so a new module needs no edits here.
const REQUIREMENT_ID = /[A-Z]{2,4}-[A-Z]+-\d+[A-D]?/g;
const ISSUE_REF = /\(#(\d+)\)/g;

export function parseTestName(name) {
  const requirementIds = [...new Set(name.match(REQUIREMENT_ID) || [])];
  const issueRefs = [...name.matchAll(ISSUE_REF)].map((m) => Number(m[1]));
  return { requirementIds, issueRefs };
}

// Test-file → module routing:
//
//   tests/unit/<module>/**       → <module>
//   tests/e2e/<module>.spec.js   → <module>  (the Playwright JSON reporter
//                                  emits testDir-relative paths, so a bare
//                                  `<module>.spec.js` matches too)
//
// Anything else — site.spec.js, tests/unit/evidence.test.js,
// tests/unit/site/**, or a directory that is not a registered module — routes
// to `null`: shared scaffold evidence. Shared records are duplicated into EVERY
// module's evidence set, so each evidence.json is self-contained and the
// freshness guard still catches scaffold drift. `modules` comes from
// site/config.json's module registry (any status), so which modules exist is
// data, not code.
export function moduleForFile(file, modules) {
  const normalized = String(file || '').replaceAll('\\', '/');
  const unit = normalized.match(/(?:^|\/)tests\/unit\/([^/]+)\//);
  if (unit && modules.includes(unit[1])) return unit[1];
  const spec = normalized.match(/([^/]+)\.spec\.js$/);
  if (spec && modules.includes(spec[1])) return spec[1];
  return null;
}

function record(test, suite, passed, file) {
  const { requirementIds, issueRefs } = parseTestName(test);
  return {
    test,
    suite,
    status: passed ? 'pass' : 'fail',
    requirementIds,
    issueRefs,
    screenshots: [],
    file
  };
}

// Vitest --reporter=json (jest-compatible shape). `name` is the test file.
export function normalizeVitest(json) {
  return (json.testResults || []).flatMap((file) =>
    (file.assertionResults || []).map((assertion) =>
      record(
        assertion.fullName || assertion.title,
        'unit',
        assertion.status === 'passed',
        file.name || ''
      )
    )
  );
}

// Playwright --reporter=json: suites nest arbitrarily; specs carry the
// results and their source file.
export function normalizePlaywright(json) {
  const records = [];
  const walk = (suite, inheritedFile) => {
    const file = suite.file || inheritedFile;
    (suite.specs || []).forEach((spec) => {
      const results = (spec.tests || []).flatMap((t) => t.results || []);
      const last = results[results.length - 1];
      records.push(
        record(spec.title, 'browser', last ? last.status === 'passed' : false, spec.file || file)
      );
    });
    (suite.suites || []).forEach((child) => walk(child, file));
  };
  (json.suites || []).forEach((suite) => walk(suite, ''));
  return records;
}

// GitHub Actions run provenance: built from the env GHA injects into
// every job; null for local runs. Consumers (the docs site) feature-detect.
export function buildRun(env = {}) {
  if (!env.GITHUB_RUN_ID) return null;
  const server = env.GITHUB_SERVER_URL || 'https://github.com';
  return {
    id: env.GITHUB_RUN_ID,
    url: env.GITHUB_REPOSITORY
      ? `${server}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : null
  };
}

// Screenshot files are named `${requirementId}-${slug}.png` (Playwright
// sanitizes snapshot names, so dashes are the canonical separator); each
// attaches to every record evidencing that requirement ID.
function attachScreenshots(records, screenshots) {
  for (const rec of records) {
    rec.screenshots = screenshots
      .filter((file) => {
        const prefix = file.match(/^[A-Z]{2,4}-[A-Z]+-\d+[A-D]?/);
        return prefix && rec.requirementIds.includes(prefix[0]);
      })
      .sort();
  }
}

// Build every module's evidence set from ONE Vitest run + ONE Playwright run.
// Records route to modules by test-file path (moduleForFile); shared
// scaffold records are copied into each set. Only modules with at least one
// module-routed record get an evidence set — a module's evidence.json
// appears the moment its first module test lands, with zero pipeline edits.
export function buildEvidenceSets({
  modules,
  vitest,
  playwright,
  screenshotsByModule = {},
  provenance = {}
}) {
  const all = [...normalizeVitest(vitest || {}), ...normalizePlaywright(playwright || {})];
  const shared = [];
  const byModule = new Map();
  for (const rec of all) {
    const module = moduleForFile(rec.file, modules);
    if (module) {
      if (!byModule.has(module)) byModule.set(module, []);
      byModule.get(module).push(rec);
    } else {
      shared.push(rec);
    }
  }

  const sets = {};
  for (const [module, moduleRecords] of byModule) {
    // Copy (and drop the routing-only `file` key) so shared records attach
    // screenshots independently per module.
    const records = [...moduleRecords, ...shared].map(({ file, ...rest }) => ({
      ...rest,
      screenshots: []
    }));
    attachScreenshots(records, screenshotsByModule[module] || []);
    records.sort((a, b) => a.suite.localeCompare(b.suite) || a.test.localeCompare(b.test));
    sets[module] = {
      module,
      generatedAt: provenance.generatedAt ?? null,
      environment: provenance.environment ?? null,
      run: provenance.run ?? null,
      records
    };
  }
  return sets;
}

// Freshness guard: stale when the test set or any pass/fail status differs.
// Screenshots, provenance (generatedAt/environment/run), and everything else
// are ignored — pixel enforcement is the browser suite's job, and provenance
// changes on every run by design.
export function compareEvidence(committed, fresh) {
  const key = (r) => `${r.suite}|${r.test}`;
  const committedMap = new Map((committed.records || []).map((r) => [key(r), r.status]));
  const freshMap = new Map((fresh.records || []).map((r) => [key(r), r.status]));
  const differences = [];
  for (const [k, status] of committedMap) {
    if (!freshMap.has(k)) differences.push(`missing in fresh run: ${k}`);
    else if (freshMap.get(k) !== status)
      differences.push(`status changed: ${k} (${status} → ${freshMap.get(k)})`);
  }
  for (const k of freshMap.keys()) {
    if (!committedMap.has(k)) differences.push(`new test not in committed evidence: ${k}`);
  }
  return { stale: differences.length > 0, differences };
}

// Traceability guard: every requirement row has a test named for it, and no
// test names a requirement that is in no matrix. `requirementIds` is every row
// of every registered matrix; `sets` is what buildEvidenceSets returned. A row
// with no test is a requirement nothing proves; a test naming a row that does
// not exist (a typing slip, or a row since renamed) proves nothing a page can
// show.
export function findTraceabilityGaps({ requirementIds, sets }) {
  const known = new Set(requirementIds);
  const named = new Map();
  for (const set of Object.values(sets || {})) {
    for (const rec of set.records || []) {
      for (const id of rec.requirementIds || []) {
        if (!named.has(id)) named.set(id, rec.test);
      }
    }
  }
  return {
    untested: [...known].filter((id) => !named.has(id)).sort(),
    unknown: [...named]
      .filter(([id]) => !known.has(id))
      .map(([id, test]) => ({ id, test }))
      .sort((a, b) => a.id.localeCompare(b.id))
  };
}
