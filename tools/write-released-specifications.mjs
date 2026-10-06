// Writes tests/fixtures/group-comparison-specifications-0.2.0.json:
// specifications of the group comparison chart written by the released chart
// itself, bio.viz v0.2.0, with what that chart drew and asked R for each. The
// tests named GC-TILE-010 hold this version to them: a specification the
// released chart wrote is still read, and still rebuilds its view (#84). The
// one that names a biomarker and every visit is held by GC-TIME-032: it is
// read, and opens on the biomarker over time, not on a panel per visit (#85).
//
//   node tools/write-released-specifications.mjs
//
// Nothing in the file is typed. The script reads the released bundle, the
// safety.viz bundle released beside it and the synthetic study from the git
// tag v0.2.0, loads them in a headless Chromium (npx playwright install
// chromium), makes each chart from the settings below, and writes down what
// `chart.specification()` and `chart.statistics()` answer. It needs the tag:
// `git fetch --tags` in a clone without it. Run it again only to add a case;
// the released chart does not change.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const TAG = 'v0.2.0';
const OUT = 'tests/fixtures/group-comparison-specifications-0.2.0.json';
const root = fileURLToPath(new URL('..', import.meta.url));
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const released = (file) => git('show', `${TAG}:${file}`);

// The study's files have no quoted field (the vendoring check refuses one).
const table = (file) => {
  const [header, ...lines] = released(file).trimEnd().split('\n');
  const columns = header.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(columns.map((column, index) => [column, cells[index]]));
  });
};

// Each case: the settings the released chart was made with, and what a reader
// then did to it, so the specification holds what its controls read.
const CASES = [
  {
    name: 'one-visit',
    what: 'IL-6, change from baseline at Week 4, by arm, a Wilcoxon test, women only: the single-visit view.',
    settings: {
      start_value: 'IL-6',
      visits: ['Week 4'],
      value_type: 'change',
      baseline_visits: 'Baseline',
      group_by: 'ARM',
      test: 'wilcoxon',
      title: '{measure} by {group}',
      filters: [{ value_col: 'SEX', label: 'Sex', start: 'F' }, 'RESPONSE']
    }
  },
  {
    name: 'one-biomarker-two-visits',
    what: 'CRP, the result at Week 2 and Week 8, by response, coloured by sex, as violins: a panel per visit.',
    settings: {
      start_value: 'CRP',
      visits: ['Week 2', 'Week 8'],
      value_type: 'raw',
      group_by: 'RESPONSE',
      color_by: 'SEX',
      mark: 'violin'
    }
  },
  {
    name: 'every-biomarker',
    what: 'No biomarker and no visit named: the overview v0.2.0 opened on, every biomarker at every visit.',
    settings: { group_by: 'ARM', baseline_visits: 'Baseline' }
  },
  {
    name: 'every-biomarker-second-page',
    what: 'The overview four biomarkers at a time, on its second page, by sex, on a logarithmic scale.',
    settings: { group_by: 'SEX', overview_limit: 4, y_scale: 'log' },
    then: 'next-page'
  },
  {
    name: 'one-biomarker-every-visit',
    what: 'IL-6, the result, by arm, with no visit named: v0.2.0 drew a panel for every visit, where this version draws the biomarker over time.',
    settings: { start_value: 'IL-6', value_type: 'raw', group_by: 'ARM' }
  }
];

const browser = await chromium.launch();
const cases = [];
let version;
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body><div id="chart"></div></body></html>');
  await page.addScriptTag({ content: released('site/vendor/safety.viz/safety.viz.js') });
  await page.addScriptTag({ content: released('dist/bio.viz-0.2.0/bio.viz.js') });
  const data = {
    results: table('site/data/synthetic-study/synthetic_results.csv'),
    participants: table('site/data/synthetic-study/synthetic_participants.csv')
  };
  version = await page.evaluate(() => window.BioViz.version);
  for (const entry of CASES) {
    const wrote = await page.evaluate(
      ({ settings, then, data }) => {
        document.querySelector('#chart').innerHTML = '';
        const chart = window.BioViz.groupComparison('#chart', settings).init(data);
        if (then === 'next-page') {
          chart.root.querySelector('.bv-overview-pager button[data-go="next"]').click();
        }
        const panels = chart.model ? chart.model.panels : [];
        const out = {
          specification: chart.specification(),
          drew: {
            biomarker: chart.state.measure,
            panels: panels.map((panel) => ({
              title: panel.title,
              visit: panel.visit,
              participants: panel.records.length,
              groups: panel.ticks.map((lines) => lines.join(' '))
            })),
            overview: chart.overview
              ? {
                  biomarkers: chart.overview.rows.map((row) => row.measure),
                  page: chart.overview.page,
                  pages: chart.overview.pages
                }
              : null
          },
          asked: chart.statistics().map(({ panel, name, args, dataId, rows }) => ({
            panel,
            name,
            args,
            dataId,
            rows
          }))
        };
        chart.destroy();
        return out;
      },
      { settings: entry.settings, then: entry.then || null, data }
    );
    cases.push({ name: entry.name, what: entry.what, ...wrote });
  }
} finally {
  await browser.close();
}

const file = {
  made_by: {
    tool: 'tools/write-released-specifications.mjs',
    tag: TAG,
    commit: git('rev-parse', `${TAG}^{commit}`).trim(),
    bio_viz_version: version,
    bundle: 'dist/bio.viz-0.2.0/bio.viz.js',
    data: 'site/data/synthetic-study/'
  },
  cases
};
writeFileSync(new URL(`../${OUT}`, import.meta.url), `${JSON.stringify(file, null, 2)}\n`);
console.log(
  `✓ Wrote ${OUT}: ${cases.length} specifications written by bio.viz ${version} (${TAG}).`
);
