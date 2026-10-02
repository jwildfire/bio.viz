// Site generators: pure functions scripts/site.mjs assembles into _site/. Plain
// Node, no framework — and every internal URL relative, so one build serves the
// site root, /dev/, and /pr/{N}/ unchanged. Modelled on safety.viz's site-lib.
//
// The module registry in site/config.json drives every page here: the gallery
// lists the modules whose `kind` is `chart`, and every module, chart or shared
// part, gets an evidence page and an API reference.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  escapeHtml,
  extractHeadings,
  mdBlock,
  mdInline,
  mdText,
  rewriteRelativeLinks
} from './markdown-lib.mjs';

export { escapeHtml };

// Shared shell: replaces {{title}}, {{description}}, {{version}}, {{build}},
// {{root}} and {{content}}. {{root}} prefixes shell-level links so one shell
// serves pages at any depth.
export function renderShell({
  shell,
  title,
  content,
  root = '',
  version = '',
  description = '',
  build = '',
  mainClass = ''
}) {
  return shell
    .replaceAll('{{mainClass}}', escapeHtml(mainClass))
    .replaceAll('{{title}}', escapeHtml(title))
    .replaceAll('{{description}}', escapeHtml(description))
    .replaceAll('{{version}}', escapeHtml(version))
    .replaceAll('{{build}}', build)
    .replaceAll('{{root}}', root)
    .replace('{{content}}', content);
}

// Counts shown beside a module on the home page, from its committed
// requirement extract and evidence set (either may be absent).
export function summarizeModule({ requirements, evidence } = {}) {
  const records = (evidence && evidence.records) || [];
  return {
    requirements: Object.keys((requirements && requirements.requirements) || {}).length,
    records: records.length,
    passing: records.filter((record) => record.status === 'pass').length
  };
}

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function renderModule(entry, summary, config) {
  const facts = [];
  if (summary) {
    facts.push(plural(summary.requirements, 'requirement'));
    facts.push(`${summary.passing} of ${plural(summary.records, 'test record')} passing`);
  }
  const matrix = entry.matrix
    ? `<a href="${escapeHtml(config.matrixBaseUrl)}/${escapeHtml(entry.matrix)}">Requirement matrix</a>`
    : '';
  return (
    `<li class="module" data-module="${escapeHtml(entry.module)}">` +
    `<h3>${escapeHtml(entry.title)}</h3>` +
    `<p>${escapeHtml(entry.blurb)}</p>` +
    `<p class="module-facts">${[...facts.map(escapeHtml), matrix].filter(Boolean).join(' · ')}</p>` +
    moduleLinks(entry) +
    `</li>`
  );
}

// Home page. The page loads the committed script-tag bundle by its versioned
// path and prints the version that bundle reports, so the deployed page itself
// shows which build it carries.
export function renderHome({ config, version, summaries = {} }) {
  const bundle = `dist/bio.viz-${version}/bio.viz.js`;
  const modules = config.modules
    .map((entry) => renderModule(entry, summaries[entry.module], config))
    .join('');
  return `
<section class="hero">
  <p class="eyebrow">Biomarker charts · every test computed by R</p>
  <h1>bio.viz <span class="hero-version">${escapeHtml(version)}</span></h1>
  <p class="lead">
    Charts for comparing groups and relating variables in biomarker data. They run beside
    <a href="https://jwildfire.github.io/safety.viz/">safety.viz</a> and reuse its shared parts.
    The library computes no statistical test itself: each one is asked of R.
  </p>
</section>

${
  config.modules.some((entry) => entry.kind === 'chart' && entry.status === 'available')
    ? `<aside class="callout">
  <h2>The first chart</h2>
  <p>
    The <a href="gallery/index.html">gallery</a> has the charts that are published, each with a
    live demo on a made-up study. A chart draws; it does not test. Every test is computed by R,
    and the charts say so where one would be printed.
  </p>
</aside>`
    : `<aside class="callout">
  <h2>No charts yet</h2>
  <p>
    This first release sets the repository up and measures what running R in the browser costs:
    how many megabytes it downloads and how many seconds pass before the first result. The charts
    follow once that is known.
  </p>
</aside>`
}

<section>
  <h2>This build</h2>
  <dl class="facts">
    <div><dt>Library</dt><dd>bio.viz</dd></div>
    <div><dt>Version in package.json</dt><dd>${escapeHtml(version)}</dd></div>
    <div>
      <dt>Version reported by the bundle this page loaded</dt>
      <dd><code id="bundle-version">not loaded</code></dd>
    </div>
    <div><dt>Bundle</dt><dd><code>${escapeHtml(bundle)}</code></dd></div>
  </dl>
</section>

<section>
  <h2>What is in it</h2>
  <ul class="modules">${modules}</ul>
  <p class="sub">
    The <a href="gallery/index.html">gallery</a> lists each chart, with the tests that prove it
    and the reference for calling it.
  </p>
</section>

<section>
  <h2>R in the browser, checked</h2>
  <p>
    The <a href="r-check/index.html">R check page</a> runs two real tests through R in this
    browser, shows each answer beside the one desktop R gives, and reports what starting R costs
    in megabytes and seconds.
  </p>
</section>

<section>
  <h2>Loading it</h2>
  <p>The bundle is committed, so a page needs no build step:</p>
  <pre><code>&lt;script src="${escapeHtml(bundle)}"&gt;&lt;/script&gt;
&lt;script&gt;
  console.log(BioViz.version);
&lt;/script&gt;</code></pre>
</section>

<script src="${escapeHtml(bundle)}"></script>
<script>
  document.getElementById('bundle-version').textContent = BioViz.version;
</script>
`;
}

const STATES = [
  ['cold', 'Cold', 'first visit, nothing cached'],
  ['reload', 'Reload', 'page loaded again, files in the browser cache, R starts again'],
  ['warm', 'Warm', 'R already running in the page, a second call']
];

function longDate(iso) {
  const date = new Date(iso);
  const month = date.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
  return `${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`;
}

function renderRecorded(measured) {
  if (!measured || !measured.states) {
    return `<p id="recorded-none">No measurement is recorded with this build.</p>`;
  }
  const number = (value, digits) =>
    typeof value === 'number' ? value.toFixed(digits) : 'not measured';
  const rows = STATES.map(([key, label, meaning]) => {
    const state = measured.states[key] || {};
    return (
      `<tr data-state="${key}"><th scope="row">${label}<span class="sub">${meaning}</span></th>` +
      `<td>${number(state.megabytes, 2)}</td>` +
      `<td>${number(state.requests, 0)}</td>` +
      `<td>${number(state.requestsOverNetwork, 0)}</td>` +
      `<td>${number(state.seconds, 3)}</td></tr>`
    );
  }).join('');
  // Context for a slower line, by arithmetic on the bytes counted; labelled as such.
  const coldBytes = measured.states.cold && measured.states.cold.bytes;
  const slowNote =
    typeof coldBytes === 'number' && coldBytes > 0
      ? `\n    <li>The seconds above depend on the network they were measured on. By arithmetic, not measurement: at 10 megabits a second the cold download alone, ${(coldBytes / 1e6).toFixed(1)} MB, takes about ${Math.round((coldBytes * 8) / 10e6)} seconds to arrive.</li>`
      : '';
  return `
  <table id="recorded-table" class="recorded">
    <thead>
      <tr>
        <th scope="col">State</th>
        <th scope="col"><abbr title="megabytes over the network">MB</abbr></th>
        <th scope="col">Requests</th>
        <th scope="col">From network</th>
        <th scope="col">Seconds</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <ul class="notes">
    <li>Recorded on ${escapeHtml(longDate(measured.recorded))} in ${escapeHtml(measured.browser)}, on ${escapeHtml(measured.machine)}; network: ${escapeHtml(measured.network || 'not recorded')}. The browser started on ${escapeHtml(measured.profile || 'a new profile')}.</li>
    <li>MB is megabytes over the network; From network is how many of the requests were not answered from the browser's cache. Both, and the requests, are counted by the browser itself, through its DevTools protocol, for every request for R's files that the page and R's worker make from the press of the button to the last result. Megabytes are ${escapeHtml(measured.sizes)}.</li>
    <li>Seconds are from the call to the first result for cold and reload, which includes starting R, installing survival and reading the R source; and for one repeated rank-sum call for warm.</li>
    <li>Each continuous-integration run measures the same three states on its own machine and attaches them to the run.</li>${slowNote}
  </ul>`;
}

// The R check page. The static frame is built here; site/r-check/page.mjs fills
// in what the browser finds when it runs.
export function renderCheckPage({ version, expected, measured }) {
  const made = expected.made_by;
  const bundle = `../dist/bio.viz-${version}/bio.viz.js`;
  return `
<section class="hero">
  <p class="eyebrow">R in the browser, measured</p>
  <h1>R check</h1>
  <p class="lead">
    A chart in bio.viz computes no test itself: it asks R. This page asks R for two test results
    three ways, compares what R in this browser answers with what desktop R answers, and reports
    what starting R in a browser costs.
  </p>
</section>

<section id="without-r">
  <h2>With no R attached</h2>
  <p>The call still answers. A chart would draw, and print this in place of a statistic:</p>
  <p class="answer-text" id="unavailable-answer">Loading…</p>
</section>

<section id="precomputed">
  <h2>From results shipped with the page</h2>
  <p>
    Desktop R (R ${escapeHtml(made.r_version)}, survival ${escapeHtml(made.survival_version)}) worked
    these out ahead of time, and they are read from a file. No R is loaded to show them.
  </p>
  <ul class="answers" id="precomputed-answers"></ul>
</section>

<section id="browser">
  <h2>From R in this browser</h2>
  <p>
    The button starts R itself in this page (webR 0.6.0, fetched from its public CDN), installs
    the survival package, and runs the same two tests on the same two tables. Nothing is fetched
    until it is pressed, and each time below is counted from the call that needed it.
  </p>
  <p><button id="start-r" type="button" disabled>Start R and run both tests</button></p>
  <p id="r-status" role="status">R has not been started.</p>
  <p id="r-session"></p>
  <div id="comparisons"></div>
  <p class="sub">
    Two numbers count as the same when they differ by no more than 1 part in 10<sup>8</sup> of the
    larger: eight digits must agree, five more than a chart prints. Desktop R and R in the browser
    are different versions built by different compilers, so the last digits of a number may
    differ; both numbers are shown in full, with their difference, so nothing the tolerance lets
    through is hidden. Text, counts and the shape of each answer must match exactly.
  </p>
</section>

<section id="timings" hidden>
  <h2>What it took, this time</h2>
  <table class="recorded">
    <thead><tr><th scope="col">Step</th><th scope="col">Time</th></tr></thead>
    <tbody id="timings-body"></tbody>
  </table>
  <p class="sub">
    The first result includes fetching and starting R, installing survival and reading the R
    source. This page cannot say how many megabytes that took, or whether they came over the
    network or from this browser's cache: R's files are fetched by a worker, and a page cannot see
    a worker's requests. The megabytes below were counted from outside the page.
  </p>
</section>

<section id="recorded">
  <h2>What it costs, as measured</h2>
  ${renderRecorded(measured)}
</section>

<section id="data">
  <h2>The data and the R</h2>
  <ul class="notes">
    <li>Rank-sum test: Alanine Aminotransferase at Week 8, Placebo against Xanomeline High Dose (<a href="data/alt-week-8.csv">alt-week-8.csv</a>).</li>
    <li>Log-rank test: days on study with discontinuation as the event, three arms (<a href="data/days-on-study.csv">days-on-study.csv</a>).</li>
    <li>Both tables are cut from the public CDISC Pilot 01 test data published by pharmaverse (Apache-2.0), as vendored by safety.viz. No real participant is described.</li>
    <li>The R both sides run is <a href="statistics.R">statistics.R</a>: two wrappers, around <code>wilcox.test</code> and <code>survival::survdiff</code>. The desktop answers are in <a href="expected.json">expected.json</a>, written by <code>tools/r-fixtures.R</code>.</li>
  </ul>
</section>

<script src="${escapeHtml(bundle)}"></script>
<script type="module" src="page.mjs"></script>
`;
}

// ---- The module registry ---------------------------------------------------

// A module is a chart or a shared part of the library. The gallery lists the
// charts; every module of either kind gets an evidence page and an API
// reference.
export const MODULE_KINDS = ['chart', 'shared'];
const MODULE_STATUSES = ['available', 'planned'];

const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isTextList = (value) => Array.isArray(value) && value.length > 0 && value.every(isText);

// The ways the registry in site/config.json is malformed; an empty list means
// none. An entry that does not say what it is, or does not name its matrix and
// its API reference, would otherwise be left off a page without a word.
export function validateRegistry(config) {
  const errors = [];
  const modules = (config && config.modules) || [];
  if (!Array.isArray(modules) || modules.length === 0) {
    return ['site/config.json registers no modules.'];
  }
  const seen = new Set();
  modules.forEach((entry, index) => {
    const name = isText(entry && entry.module) ? entry.module : `entry ${index}`;
    const say = (problem) => errors.push(`site/config.json, module ${name}: ${problem}`);
    if (!entry || !isText(entry.module) || !/^[a-z][a-z0-9-]*$/.test(entry.module)) {
      say('`module` must be a lower-case name such as `group-comparison`.');
    } else if (seen.has(entry.module)) {
      say('is registered twice.');
    }
    seen.add(name);
    if (!entry) return;
    if (!MODULE_KINDS.includes(entry.kind)) {
      say(`\`kind\` must be one of ${MODULE_KINDS.join(', ')}: a chart is listed in the gallery.`);
    }
    if (!MODULE_STATUSES.includes(entry.status)) {
      say(`\`status\` must be one of ${MODULE_STATUSES.join(', ')}.`);
    }
    if (!isText(entry.title)) say('needs a `title`.');
    if (!isText(entry.blurb)) say('needs a `blurb`.');
    if (!isText(entry.matrix) || !entry.matrix.endsWith('.md')) {
      say('needs `matrix`, the name of its requirement matrix in requirements/.');
    }
    const api = entry.api;
    if (!api || !isText(api.doc) || !api.doc.endsWith('.md')) {
      say('needs `api.doc`, the name of its reference file in docs/.');
    }
    if (!api || !isTextList(api.surface)) {
      say('needs `api.surface`, the exports of the bundle its reference documents.');
    }
    if (!api || !isTextList(api.source)) {
      say('needs `api.source`, the source files or folders those exports are written in.');
    }
    if (api && api.settings !== undefined && !isText(api.settings)) {
      say('`api.settings`, when given, is the source file that exports its DEFAULT_SETTINGS.');
    }
    // A chart is drawn somewhere a reader can try it: it names its demo.
    if (entry.kind === 'chart' && entry.status === 'available' && !isText(entry.demo)) {
      say('is an available chart, and needs `demo`, the name of its demo script in site/demo/.');
    }
    if (entry.kind !== 'chart' && entry.demo !== undefined) {
      say('has a `demo`, and only a chart has one.');
    }
    if (entry.hero !== undefined && !(isText(entry.hero) && entry.hero.endsWith('.png'))) {
      say('`hero`, when given, is the name of one of its evidence screenshots.');
    }
  });
  return errors;
}

// The modules that have pages on the site.
export const availableModules = (config) =>
  config.modules.filter((entry) => entry.status === 'available');

// Links to a module's two pages. `root` is the path from the page that carries
// the links back to the site root.
export function moduleLinks(entry, root = '') {
  const base = `${root}${escapeHtml(entry.module)}`;
  return (
    `<p class="module-links">` +
    (entry.demo ? `<a href="${base}/index.html">Live demo</a> · ` : '') +
    `<a href="${base}/evidence.html">Evidence</a> · ` +
    `<a href="${base}/api.html">API reference</a>` +
    `</p>`
  );
}

// The tabs at the top of a module's pages.
function moduleTabs(active, entry = {}) {
  const tab = (id, href, label) =>
    id === active
      ? `<a class="current" aria-current="page" href="${href}">${label}</a>`
      : `<a href="${href}">${label}</a>`;
  return (
    `<nav class="page-tabs" aria-label="Pages for this module">` +
    tab('gallery', '../gallery/index.html', 'Gallery') +
    // A chart has a live demo; a shared part has none.
    (entry.demo ? tab('demo', 'index.html', 'Live demo') : '') +
    tab('evidence', 'evidence.html', 'Evidence') +
    tab('api', 'api.html', 'API reference') +
    `</nav>`
  );
}

// ---- Gallery ---------------------------------------------------------------

const count = (value) => Number(value).toLocaleString('en-US');

// What each table of the synthetic study holds, by file name. The row counts
// and column names beside these words come from the source record.
const STUDY_TABLES = {
  'synthetic_results.csv': ['Results', 'One row per participant, biomarker and visit'],
  'synthetic_participants.csv': ['Participants', 'One row per participant'],
  'synthetic_outcomes.csv': ['Outcomes', 'One row per participant and endpoint']
};

// A chart's card shows a picture of it when one of its evidence screenshots is
// named as its `hero` and is committed (`heroes` lists the ones that are).
function galleryCard(entry, heroes = {}) {
  const hero = heroes[entry.module];
  const picture = hero
    ? `<a class="module-hero" href="../${escapeHtml(entry.module)}/index.html">` +
      `<img src="../${escapeHtml(entry.module)}/evidence/${escapeHtml(hero)}" ` +
      `alt="${escapeHtml(entry.title)}: a screenshot captured by its tests"></a>`
    : '';
  return (
    `<li class="module" data-module="${escapeHtml(entry.module)}">` +
    picture +
    `<h3>${escapeHtml(entry.title)}</h3>` +
    `<p>${escapeHtml(entry.blurb)}</p>` +
    moduleLinks(entry, '../') +
    `</li>`
  );
}

function renderStudy(study) {
  if (!study) return '';
  const tables = study.files
    .map((entry) => {
      const [title, per] = STUDY_TABLES[entry.file] || [entry.file, 'One row per record'];
      const columns = entry.columns.map((column) => `<code>${escapeHtml(column)}</code>`);
      return (
        `<li class="module" data-file="${escapeHtml(entry.file)}">` +
        `<h3>${escapeHtml(title)}</h3>` +
        `<p>${escapeHtml(per)}: ${count(entry.rows)} rows.</p>` +
        `<p class="module-facts">` +
        `<a href="../data/synthetic-study/${escapeHtml(entry.file)}">${escapeHtml(entry.file)}</a>` +
        ` · columns ${columns.join(', ')}</p>` +
        `</li>`
      );
    })
    .join('');
  const commitUrl = `${escapeHtml(study.repository)}/tree/${escapeHtml(study.commit)}/inst/extdata`;
  return `
<section id="demo-data">
  <h2>Demo data</h2>
  <p>
    Every demo and most tests run on one made-up study, generated in
    <a href="${escapeHtml(study.repository)}">gsm.bio</a> from a seeded model with known effects
    planted in it, so a test can assert an answer that is known in advance. No real participant
    is in it.
  </p>
  <ul class="modules">${tables}</ul>
  <ul class="notes">
    <li id="study-source">Copied byte for byte from gsm.bio at commit <a href="${commitUrl}"><code>${escapeHtml(study.commit.slice(0, 7))}</code></a>${study.license ? `, licence ${escapeHtml(study.license)}` : ''}. Nothing is retyped or regenerated here.</li>
    <li>The <a href="../data/synthetic-study/SOURCE.json">source record</a> holds each file's checksum, and the unit tests fail when a file no longer matches it.</li>
  </ul>
</section>`;
}

// The gallery: the charts that are published, the shared parts they are built
// on, and the data the demos run on. With no chart published it says so.
export function renderGallery({ config, study, heroes = {} }) {
  const modules = availableModules(config);
  const charts = modules.filter((entry) => entry.kind === 'chart');
  const shared = modules.filter((entry) => entry.kind !== 'chart');
  const chartList = charts.length
    ? `<ul class="modules" id="charts-list">${charts.map((entry) => galleryCard(entry, heroes)).join('')}</ul>`
    : `<aside class="callout" id="no-charts">
    <p>
      No chart is published yet. When one is, it is listed here with a live demo on the synthetic
      study below, its evidence page and its API reference.
    </p>
  </aside>`;
  return `
<section class="hero">
  <p class="eyebrow">Charts · evidence · reference</p>
  <h1>Gallery</h1>
  <p class="lead">
    Each chart in bio.viz, with the tests that prove it does what its requirements say and the
    reference for calling it.
  </p>
</section>

<section id="charts">
  <h2>Charts</h2>
  ${chartList}
</section>

<section id="shared-parts">
  <h2>Shared parts</h2>
  <p>What every chart is built on. Each has the same two pages a chart has.</p>
  <ul class="modules" id="shared-list">${shared.map((entry) => galleryCard(entry)).join('')}</ul>
</section>
${renderStudy(study)}
`;
}

// ---- Demo page -------------------------------------------------------------

// A chart's live demo: the chart, drawn on the synthetic study by the chart's
// demo script. safety.viz's bundle is loaded first, as its own script tag, and
// bio.viz's after it: the chart is built from safety.viz's kit and bundles none
// of it.
export function renderDemoPage({ entry, version, study, kit }) {
  const bundle = `../dist/bio.viz-${version}/bio.viz.js`;
  const source = study
    ? ` The data is the <a href="../gallery/index.html#demo-data">synthetic study</a>: ` +
      `${count(study.files[1] ? study.files[1].rows : 0)} made-up participants, and no real one.`
    : '';
  const built = kit
    ? `<p class="sub" id="demo-kit">The controls, the filters, the listing, the participant ` +
      `profile and the Chart.js this chart draws with are safety.viz's, version ` +
      `${escapeHtml(kit.version)}, loaded beside bio.viz from ` +
      `<a href="../vendor/safety.viz/SOURCE.json">a copy with a record of where it came from</a>.` +
      (kit.merged_to_dev === false
        ? ` That copy is from a branch of safety.viz that is not merged yet.`
        : '') +
      `</p>`
    : '';
  return `
<section class="hero">
  <p class="eyebrow">Live demo</p>
  <h1>${escapeHtml(entry.title)}</h1>
  <p class="lead">${escapeHtml(entry.blurb)}${source}</p>
  ${moduleTabs('demo', entry)}
</section>

<section id="demo">
  <div id="chart"></div>
</section>

<section id="about-demo">
  <ul class="notes">
    <li>Choose the biomarker, the value, the visits, the groups and how they are drawn in the controls. On a phone the controls are folded away above the chart: tap Controls to open them.</li>
    <li>Click a box, a violin or a point to list its participants. Click a row of the list to open that participant's profile.</li>
    <li>The line under the chart is where a test of the groups is printed. Every test is computed by R, and no R is attached to this page, so the line says that statistics are unavailable. The chart computes none itself.</li>
  </ul>
  ${built}
</section>

<script src="../vendor/safety.viz/safety.viz.js"></script>
<script src="${escapeHtml(bundle)}"></script>
<script src="../demo/synthetic-study.js"></script>
<script src="../demo/${escapeHtml(entry.demo)}"></script>
`;
}

// ---- Evidence page ---------------------------------------------------------

function chip(status, runUrl) {
  const label = { pass: 'pass', fail: 'fail', none: 'no test' }[status];
  const html = `<span class="chip status-${status}">${label}</span>`;
  // A result links the continuous-integration run that recorded it, when the
  // evidence set names one.
  return runUrl && status !== 'none'
    ? `<a class="chip-link" href="${escapeHtml(runUrl)}">${html}</a>`
    : html;
}

// A test's name with its `(#7)` issue reference made a link.
function testName(record, config) {
  return escapeHtml(record.test).replace(
    /\(#(\d+)\)/g,
    (match, issue) => `(<a href="${escapeHtml(config.repoUrl)}/issues/${issue}">#${issue}</a>)`
  );
}

function testItem(record, config, runUrl) {
  return (
    `<li>${chip(record.status, runUrl)} ` +
    `<span class="suite">${record.suite === 'browser' ? 'browser' : 'unit'}</span> ` +
    `${testName(record, config)}</li>`
  );
}

const NOT_RECORDED = 'Not recorded for this evidence set';

function recordedFact(evidence) {
  if (!evidence.generatedAt) return NOT_RECORDED;
  const date = new Date(evidence.generatedAt);
  if (Number.isNaN(date.valueOf())) return escapeHtml(evidence.generatedAt);
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function environmentFact(evidence) {
  const env = evidence.environment;
  if (!env) return NOT_RECORDED;
  const parts = [
    env.os && escapeHtml(env.os),
    env.node && `node ${escapeHtml(env.node)}`,
    env.playwright && `playwright ${escapeHtml(env.playwright)}`,
    env.chromium && `chromium ${escapeHtml(env.chromium)}`
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : NOT_RECORDED;
}

function runFact(evidence) {
  if (evidence.run && evidence.run.url) {
    const id = evidence.run.id ? ` ${escapeHtml(evidence.run.id)}` : '';
    return `<a href="${escapeHtml(evidence.run.url)}">Continuous-integration run${id}</a>`;
  }
  return evidence.generatedAt
    ? 'Run on a developer’s machine, not in continuous integration'
    : NOT_RECORDED;
}

// A module's evidence page: each requirement in its matrix, in the matrix's
// order, with the tests named for it, what each recorded, and any screenshot a
// test captured. A requirement with no test is shown as having none; the
// evidence run fails on one, so a published page should never show it.
//
// `screenshots` is the list of PNG files committed in the module's evidence
// folder. A capture is named `<requirement ID>-<what it shows>.png`, and is
// shown under the requirement it is named for.
export function renderEvidencePage({
  entry,
  config,
  requirements = {},
  evidence = {},
  screenshots = []
}) {
  const records = evidence.records || [];
  const runUrl = evidence.run && evidence.run.url ? evidence.run.url : null;
  const ids = Object.keys(requirements);
  const owned = new Set(ids);
  const testsFor = (id) => records.filter((record) => record.requirementIds.includes(id));
  const named = records.filter((record) => record.requirementIds.some((id) => owned.has(id)));
  const other = records.filter((record) => !record.requirementIds.some((id) => owned.has(id)));
  const failing = named.filter((record) => record.status === 'fail');
  const untested = ids.filter((id) => testsFor(id).length === 0);
  const shotsFor = (id) => screenshots.filter((file) => file.startsWith(`${id}-`)).sort();
  const shown = ids.flatMap(shotsFor);
  const matrixUrl = `${escapeHtml(config.matrixBaseUrl)}/${escapeHtml(entry.matrix)}`;
  const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

  const rows = ids
    .map((id) => {
      const tests = testsFor(id);
      const status = !tests.length
        ? 'none'
        : tests.some((record) => record.status === 'fail')
          ? 'fail'
          : 'pass';
      const shots = shotsFor(id)
        .map(
          (file) =>
            `<a href="evidence/${escapeHtml(file)}"><img class="screenshot" ` +
            `src="evidence/${escapeHtml(file)}" loading="lazy" alt="Screenshot captured by a ` +
            `test of ${escapeHtml(id)}: ${escapeHtml(file.slice(id.length + 1, -4).replaceAll('-', ' '))}"></a>`
        )
        .join('');
      return (
        `<li class="requirement" id="${escapeHtml(id)}" data-status="${status}">` +
        `<h3><span class="req-id">${escapeHtml(id)}</span> ${chip(status, runUrl)}</h3>` +
        `<p class="req-text">${mdInline(requirements[id])}</p>` +
        (tests.length
          ? `<ul class="tests">${tests.map((record) => testItem(record, config, runUrl)).join('')}</ul>`
          : `<p class="sub">No test is named for this requirement.</p>`) +
        (shots ? `<div class="screenshots">${shots}</div>` : '') +
        `</li>`
      );
    })
    .join('\n');

  const result = failing.length
    ? `${chip('fail', runUrl)} ${plural(failing.length, 'test')} failing`
    : untested.length
      ? `${chip('none')} ${plural(untested.length, 'requirement')} with no test`
      : `${chip('pass', runUrl)} every test passing`;

  const otherTests = other.length
    ? `
<section id="shared-tests">
  <h2>Tests run with every module</h2>
  <details>
    <summary>${plural(other.length, 'test')} of the site, the evidence pipeline and the repository’s own checks</summary>
    <p class="sub">
      These are recorded in every module’s evidence set. A requirement ID one of them carries
      belongs to another module’s page.
    </p>
    <ul class="tests">${other.map((record) => testItem(record, config, runUrl)).join('')}</ul>
  </details>
</section>`
    : '';

  return `
<section class="hero">
  <p class="eyebrow">Test evidence</p>
  <h1>${escapeHtml(entry.title)}</h1>
  <p class="lead">
    Every requirement of this module, the tests named for it, and what each test recorded the
    last time the evidence was rebuilt.
  </p>
  ${moduleTabs('evidence', entry)}
</section>

<section id="summary">
  <h2>Summary</h2>
  <dl class="facts">
    <div><dt>Requirements</dt><dd id="fact-requirements">${ids.length}</dd></div>
    <div><dt>Tests named for them</dt><dd id="fact-tests">${named.length} <span class="sub">(${named.filter((record) => record.suite === 'unit').length} unit, ${named.filter((record) => record.suite === 'browser').length} browser)</span></dd></div>
    <div><dt>Result</dt><dd id="fact-result">${result}</dd></div>
    <div><dt>Screenshots</dt><dd id="fact-screenshots">${shown.length}</dd></div>
    <div><dt>Recorded</dt><dd id="fact-recorded">${recordedFact(evidence)}</dd></div>
    <div><dt>Environment</dt><dd id="fact-environment">${environmentFact(evidence)}</dd></div>
    <div><dt>Test run</dt><dd id="fact-run">${runFact(evidence)}</dd></div>
  </dl>
  <p class="sub">
    The requirements are the rows of the module’s
    <a href="${matrixUrl}">requirement matrix</a>. A test is named for a requirement by starting
    its name with the requirement’s ID. The results are read from the committed
    <a href="${escapeHtml(config.repoUrl)}/blob/HEAD/docs/evidence/${escapeHtml(entry.module)}/evidence.json">evidence set</a>;
    continuous integration reruns every test and fails when the committed set no longer matches.
  </p>
</section>

<section id="requirements">
  <h2>Requirements and their tests</h2>
  <ol class="requirements">
${rows}
  </ol>
</section>
${otherTests}
<section id="reproduce">
  <h2>Checking this page</h2>
  <pre><code>npm ci
npm run evidence:check   # rerun every test and compare with the committed evidence set
npm run evidence         # rebuild docs/evidence/${escapeHtml(entry.module)}/evidence.json</code></pre>
</section>
`;
}

// Every screenshot an evidence set names must be committed beside it, or the
// page would show a broken image.
export function validateEvidenceScreenshots(evidence, evidenceDir, label = evidenceDir) {
  const missing = new Set();
  for (const record of (evidence && evidence.records) || []) {
    for (const screenshot of record.screenshots || []) {
      if (!existsSync(path.join(evidenceDir, screenshot))) missing.add(screenshot);
    }
  }
  return [...missing]
    .sort()
    .map((file) => `the evidence set names a screenshot that is not in ${label}: ${file}`);
}

// ---- API reference ---------------------------------------------------------

// A module's API reference: its reference file in docs/, rendered. The file is
// the only description of the interface, so the page cannot disagree with it;
// scripts/api-lib.mjs checks the file against the code.
//
// `pages` maps another module's reference file to that module's page, so a
// link between two reference files stays on the site.
export function renderApiPage({ entry, config, markdown, pages = {} }) {
  const lines = String(markdown).split('\n');
  const titleAt = lines.findIndex((line) => /^#\s+/.test(line));
  const title = titleAt === -1 ? entry.title : mdText(lines[titleAt].replace(/^#\s+/, ''));
  const body = rewriteRelativeLinks(lines.filter((line, index) => index !== titleAt).join('\n'), {
    repoUrl: config.repoUrl,
    pages
  });
  const contents = extractHeadings(body)
    .filter((heading) => heading.level === 2)
    .map((heading) => `<li><a href="#${heading.id}">${mdInline(heading.text)}</a></li>`)
    .join('');
  const docUrl = `${escapeHtml(config.repoUrl)}/blob/HEAD/docs/${escapeHtml(entry.api.doc)}`;
  return `
<section class="hero">
  <p class="eyebrow">API reference</p>
  <h1>${escapeHtml(title)}</h1>
  ${moduleTabs('api', entry)}
</section>

<nav class="api-toc" aria-label="On this page">
  <h2>On this page</h2>
  <ul>${contents}</ul>
</nav>

<article class="api-body">
${mdBlock(body)}
</article>

<p class="sub" id="api-source">
  This page is the file <a href="${docUrl}"><code>docs/${escapeHtml(entry.api.doc)}</code></a>,
  rendered. The site build fails when the library exports something the file does not document,
  or when the file documents a function the library does not export.
</p>
`;
}

// ---- Build validation ------------------------------------------------------

function walkHtmlFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const file = path.join(dir, entry);
    if (statSync(file).isDirectory()) return walkHtmlFiles(file);
    return entry.endsWith('.html') ? [file] : [];
  });
}

// Build validation: every internal href/src in the emitted site must resolve to
// an emitted file. External, mailto, data, and fragment-only targets are
// ignored.
export function validateSiteLinks(siteDir) {
  const errors = [];
  for (const file of walkHtmlFiles(siteDir)) {
    const html = readFileSync(file, 'utf8');
    for (const [, target] of html.matchAll(/(?:href|src)="([^"]*)"/g)) {
      if (/^(https?:|mailto:|data:|#|\/\/)/.test(target)) continue;
      const cleaned = decodeURI(target.split(/[?#]/)[0]);
      if (!cleaned) continue;
      const resolved = path.resolve(path.dirname(file), cleaned);
      if (!existsSync(resolved)) {
        errors.push(`${path.relative(siteDir, file)}: broken internal link "${target}"`);
      }
    }
  }
  return errors;
}
