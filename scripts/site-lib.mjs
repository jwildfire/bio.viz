// Site generators: pure functions scripts/site.mjs assembles into _site/. Plain
// Node, no framework — and every internal URL relative, so one build serves the
// site root, /dev/, and /pr/{N}/ unchanged. Modelled on safety.viz's site-lib.
//
// The module registry in site/config.json drives every page here: the gallery
// lists the modules whose `kind` is `chart`, and every module, chart or shared
// part, gets an evidence page and an API reference.
//
// The pages are written in the markup safety.viz's site uses (#91), so that its
// stylesheet, copied to site/vendor/safety.viz-site/, styles them as it is: the
// header and its Gallery menu, a page's title and tagline, the tabs of a
// module's pages, gallery cards, the fact panel, the evidence table and the
// reference's sidebar. A class these functions write is one that stylesheet
// defines, or one of the few in site/site.css; tests/unit/site/siteStyles.test.js
// fails on any other.

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

// The header's Gallery entry, as safety.viz's header has it: the link to the
// gallery, and beside it a button that opens a menu of one link per published
// chart, straight to its live demo. The list is the registry's, so a chart
// published later is in the menu without an edit here. `root` is the path from
// the page back to the site root. The shell's script opens and closes the
// menu; with no script, pointing at the entry opens it and the link still
// leads to the gallery.
export function renderGalleryNav(modules = [], root = '') {
  const items = modules
    .filter((entry) => entry.kind === 'chart' && isPublished(entry) && entry.demo)
    .map(
      (entry) =>
        `<li><a href="${root}${escapeHtml(entry.module)}/index.html">` +
        `${escapeHtml(entry.title)}</a></li>`
    )
    .join('');
  const link = `<a href="${root}gallery/index.html">Gallery</a>`;
  // With no chart published there is nothing to open.
  if (!items) return link;
  return (
    `<div class="nav-group">` +
    link +
    `<button type="button" class="nav-disclosure" aria-expanded="false" ` +
    `aria-controls="gallery-menu" aria-label="Show charts">` +
    `<span class="nav-caret" aria-hidden="true"></span></button>` +
    `<ul id="gallery-menu" class="nav-menu">${items}</ul>` +
    `</div>`
  );
}

// Shared shell: replaces {{title}}, {{description}}, {{version}}, {{build}},
// {{galleryNav}}, {{root}} and {{content}}. {{root}} prefixes shell-level links
// so one shell serves pages at any depth; {{galleryNav}} is the header's
// Gallery entry, built from the registry's modules.
export function renderShell({
  shell,
  title,
  content,
  root = '',
  version = '',
  description = '',
  build = '',
  modules = []
}) {
  return shell
    .replaceAll('{{title}}', escapeHtml(title))
    .replaceAll('{{description}}', escapeHtml(description))
    .replaceAll('{{version}}', escapeHtml(version))
    .replaceAll('{{build}}', build)
    .replaceAll('{{galleryNav}}', renderGalleryNav(modules, root))
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

// One module's card, as safety.viz's gallery draws a chart's: a picture when
// there is one, the title as a link, what it is, and the links to its pages. A
// chart's title leads to its live demo; a shared part has none, and its title
// leads to its API reference. `root` is the path from the page that carries
// the card back to the site root, and `facts` a line of counts, when the page
// has them.
function moduleCard(entry, { root = '', hero = null, facts = '' } = {}) {
  const base = `${root}${escapeHtml(entry.module)}`;
  const picture = hero
    ? `<a class="card-thumb" href="${base}/index.html">` +
      `<img src="${base}/evidence/${escapeHtml(hero)}" ` +
      `alt="${escapeHtml(entry.title)}: a screenshot captured by its tests"></a>`
    : '';
  return (
    `<li class="card" data-module="${escapeHtml(entry.module)}">` +
    picture +
    `<div class="card-body">` +
    `<h3><a href="${base}/${entry.demo ? 'index' : 'api'}.html">${escapeHtml(entry.title)}</a>` +
    `${statusBadge(entry)}</h3>` +
    statusNote(entry) +
    `<p>${escapeHtml(entry.blurb)}</p>` +
    facts +
    moduleLinks(entry, root) +
    `</div></li>`
  );
}

function renderModule(entry, summary, config) {
  const facts = [];
  if (summary) {
    facts.push(plural(summary.requirements, 'requirement'));
    facts.push(`${summary.passing} of ${plural(summary.records, 'test record')} passing`);
  }
  const matrix = entry.matrix
    ? `<a href="${escapeHtml(config.matrixBaseUrl)}/${escapeHtml(entry.matrix)}">Requirement matrix</a>`
    : '';
  return moduleCard(entry, {
    facts: `<p class="gallery-count">${[...facts.map(escapeHtml), matrix].filter(Boolean).join(' · ')}</p>`
  });
}

// Home page. The page loads the committed script-tag bundle by its versioned
// path and prints the version that bundle reports, so the deployed page itself
// shows which build it carries.
export function renderHome({ config, version, summaries = {} }) {
  const bundle = `dist/bio.viz-${version}/bio.viz.js`;
  const modules = config.modules
    .map((entry) => renderModule(entry, summaries[entry.module], config))
    .join('');
  const published = config.modules.filter((entry) => entry.kind === 'chart' && isPublished(entry));
  return `
<h1>bio.viz</h1>
<p class="tagline home-intro">
  bio.viz is a charting library for comparing groups and relating variables in biomarker data. It
  runs beside <a href="https://jwildfire.github.io/safety.viz/">safety.viz</a> and reuses its
  shared parts, and it computes no statistical test itself: each one is asked of R.
</p>

${
  published.length
    ? `<section id="the-charts">
  <h2>${published.length === 1 ? 'The first chart' : 'The charts'}</h2>
  <p class="lead">
    The <a href="gallery/index.html">gallery</a> has the charts that are published, each with a
    live demo on a made-up study. A chart draws; it does not test. Every test is computed by R,
    and the charts say so where one would be printed.
  </p>
</section>`
    : `<section id="the-charts">
  <h2>No charts yet</h2>
  <p class="lead">
    This first release sets the repository up and measures what running R in the browser costs:
    how many megabytes it downloads and how many seconds pass before the first result. The charts
    follow once that is known.
  </p>
</section>`
}

<section id="this-build">
  <h2>This build</h2>
  <dl class="facts">
    <div class="fact"><dt>Library</dt><dd>bio.viz</dd></div>
    <div class="fact"><dt>Version in package.json</dt><dd>${escapeHtml(version)}</dd></div>
    <div class="fact">
      <dt>Version reported by the bundle this page loaded</dt>
      <dd><code id="bundle-version">not loaded</code></dd>
    </div>
    <div class="fact"><dt>Bundle</dt><dd><code>${escapeHtml(bundle)}</code></dd></div>
  </dl>
</section>

<section id="modules">
  <h2>What is in it <span class="gallery-count">${plural(config.modules.length, 'module')}</span></h2>
  <ul class="gallery">${modules}</ul>
  <p class="section-summary">
    The <a href="gallery/index.html">gallery</a> lists each chart, with the tests that prove it
    and the reference for calling it.
  </p>
</section>

<section id="r-checked">
  <h2>R in the browser, checked</h2>
  <p class="lead">
    The <a href="r-check/index.html">R check page</a> runs two real tests through R in this
    browser, shows each answer beside the one desktop R gives, and reports what starting R costs
    in megabytes and seconds.
  </p>
</section>

<section id="loading">
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
  <ul class="demo-tips">
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
<h1>R check</h1>
<p class="tagline">
  A chart in bio.viz computes no test itself: it asks R. This page asks R for two test results
  three ways, compares what R in this browser answers with what desktop R answers, and reports
  what starting R in a browser costs.
</p>

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
  <p class="section-summary">
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
  <p class="section-summary">
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
  <ul class="demo-tips">
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
// `available` and `experimental` are published: each has its pages, and a
// chart its live demo and its card in the gallery. `experimental` is published
// with an Experimental badge and the reason (`statusNote`), as safety.viz
// marks its experimental charts; `planned` is registered and not published.
const MODULE_STATUSES = ['available', 'experimental', 'planned'];
const PUBLISHED = ['available', 'experimental'];
const isPublished = (entry) => PUBLISHED.includes(entry.status);

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
    if (entry.kind === 'chart' && isPublished(entry) && !isText(entry.demo)) {
      say(
        `is an ${entry.status} chart, and needs \`demo\`, the name of its demo script in site/demo/.`
      );
    }
    if (entry.status === 'experimental' && !isText(entry.statusNote)) {
      say('is experimental, and needs `statusNote`, a sentence saying why.');
    }
    if (entry.status !== 'experimental' && entry.statusNote !== undefined) {
      say('has a `statusNote`, and only an experimental module has one.');
    }
    if (entry.kind !== 'chart' && entry.demo !== undefined) {
      say('has a `demo`, and only a chart has one.');
    }
    // A chart is in the chart list (src/data/portfolio.json) unless it says why
    // it is not.
    if (entry.portfolio !== undefined && entry.portfolio !== false) {
      say('`portfolio`, when given, is false: the chart is left out of the chart list.');
    }
    if (entry.portfolio === false && !isText(entry.portfolioNote)) {
      say('is left out of the chart list, and needs `portfolioNote`, a sentence saying why.');
    }
    if (entry.hero !== undefined && !(isText(entry.hero) && entry.hero.endsWith('.png'))) {
      say('`hero`, when given, is the name of one of its evidence screenshots.');
    }
  });
  return errors;
}

// The modules that have pages on the site.
export const availableModules = (config) => config.modules.filter(isPublished);

// An experimental module's badge, as safety.viz marks an experimental chart: a
// pill after its title, on its card and on its pages. The pill's own title is
// the reason, for whoever points at it. Nothing for any other module.
function statusBadge(entry) {
  if (entry.status !== 'experimental') return '';
  return ` <span class="site-badge" title="${escapeHtml(entry.statusNote)}">Experimental</span>`;
}

// The reason an experimental module is experimental, written out under its
// title; nothing for any other.
function statusNote(entry) {
  if (entry.status !== 'experimental') return '';
  return `<p class="kit-status">${escapeHtml(entry.statusNote)}</p>`;
}

// The links on a module's card to its pages, worded as safety.viz's cards
// word them. `root` is the path from the page that carries the links back to
// the site root.
export function moduleLinks(entry, root = '') {
  const base = `${root}${escapeHtml(entry.module)}`;
  return (
    `<p class="card-links">` +
    (entry.demo ? `<a href="${base}/index.html">Demo</a> · ` : '') +
    `<a href="${base}/evidence.html">Evidence</a> · ` +
    `<a href="${base}/api.html">API</a>` +
    `</p>`
  );
}

// The tabs at the top of a module's pages, as safety.viz's chart pages have
// them. The gallery is one step away in the header on every page.
function moduleTabs(active, entry = {}) {
  const tab = (id, href, label) =>
    id === active
      ? `<a class="current" aria-current="page" href="${href}">${label}</a>`
      : `<a href="${href}">${label}</a>`;
  return (
    `<nav class="page-tabs" aria-label="Pages for this module">` +
    // A chart has a live demo; a shared part has none.
    (entry.demo ? tab('demo', 'index.html', 'Live demo') : '') +
    tab('evidence', 'evidence.html', 'Test evidence') +
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

function renderStudy(study) {
  if (!study) return '';
  const tables = study.files
    .map((entry) => {
      const [title, per] = STUDY_TABLES[entry.file] || [entry.file, 'One row per record'];
      const columns = entry.columns.map((column) => `<code>${escapeHtml(column)}</code>`);
      return (
        `<li class="card" data-file="${escapeHtml(entry.file)}"><div class="card-body">` +
        `<h3>${escapeHtml(title)}</h3>` +
        `<p>${escapeHtml(per)}: ${count(entry.rows)} rows.</p>` +
        `<p>Columns ${columns.join(', ')}</p>` +
        `<p class="card-links">` +
        `<a href="../data/synthetic-study/${escapeHtml(entry.file)}">${escapeHtml(entry.file)}</a>` +
        `</p>` +
        `</div></li>`
      );
    })
    .join('');
  const commitUrl = `${escapeHtml(study.repository)}/tree/${escapeHtml(study.commit)}/inst/extdata`;
  return `
<section id="demo-data">
  <h2>Demo data</h2>
  <p class="lead">
    Every demo and most tests run on one made-up study, generated in
    <a href="${escapeHtml(study.repository)}">gsm.bio</a> from a seeded model with known effects
    planted in it, so a test can assert an answer that is known in advance. No real participant
    is in it.
  </p>
  <ul class="gallery">${tables}</ul>
  <ul class="demo-tips">
    <li id="study-source">Copied byte for byte from gsm.bio at commit <a href="${commitUrl}"><code>${escapeHtml(study.commit.slice(0, 7))}</code></a>${study.license ? `, licence ${escapeHtml(study.license)}` : ''}. Nothing is retyped or regenerated here.</li>
    <li>The <a href="../data/synthetic-study/SOURCE.json">source record</a> holds each file's checksum, and the unit tests fail when a file no longer matches it.</li>
  </ul>
</section>`;
}

// The gallery: the charts that are published, the shared parts they are built
// on, and the data the demos run on. With no chart published it says so. A
// chart's card shows a picture of it when one of its evidence screenshots is
// named as its `hero` and is committed (`heroes` lists the ones that are).
export function renderGallery({ config, study, heroes = {} }) {
  const modules = availableModules(config);
  const charts = modules.filter((entry) => entry.kind === 'chart');
  const shared = modules.filter((entry) => entry.kind !== 'chart');
  const card = (entry) => moduleCard(entry, { root: '../', hero: heroes[entry.module] });
  const chartList = charts.length
    ? `<ul class="gallery gallery-lead" id="charts-list">${charts.map(card).join('')}</ul>`
    : `<p class="queue-strip" id="no-charts">
      No chart is published yet. When one is, it is listed here with a live demo on the synthetic
      study below, its evidence page and its API reference.
    </p>`;
  return `
<h1>Gallery</h1>
<p class="tagline">
  Each chart in bio.viz, with the tests that prove it does what its requirements say and the
  reference for calling it.
</p>

<section id="charts">
  <h2>Charts <span class="gallery-count">${charts.length} published</span></h2>
  ${chartList}
</section>

<section id="shared-parts">
  <h2>Shared parts <span class="gallery-count">${shared.length} published</span></h2>
  <p class="lead">What every chart is built on. Each has the same two pages a chart has.</p>
  <ul class="gallery" id="shared-list">${shared.map(card).join('')}</ul>
</section>
${renderStudy(study)}
`;
}

// ---- Demo page -------------------------------------------------------------

// What a reader is told under a chart's demo, by module: how to use the page.
// A sentence may hold a link.
const DEMO_NOTES = {
  'group-comparison': [
    'The chart opens on a tile for each biomarker: a line for each group through the group\u2019s median at every visit, in the groups\u2019 colours, with one key above the tiles. Each biomarker has its own value axis, and its range is printed under its tile. An axis is never narrower than 1.25 standard deviations of the results at the baseline visit, so lines that differ by less than that stay close to flat, and a tile whose lines part is one to open. Click a biomarker, or press Enter or Space on it, to view it across the visits; choose All Biomarkers under Biomarker in the controls, or in the trail above the chart, to come back.',
    'To find which biomarker differs between two groups, start from the <a href="../biomarker-screen/index.html">biomarker screen</a>: every biomarker at once, one row each, with R\'s standardised difference and its p-values adjusted across them. A click on a row there opens that biomarker here.',
    'Choose the value, the visits, the groups and the scale in the controls: they apply to every tile, and Tiles draw switches the lines from medians to means. Draw as applies once a biomarker is open, and Colour by and Panel by once a biomarker and a visit are; each says so until then. On a phone the controls are folded away above the chart: tap Controls to open them.',
    'With one biomarker open and every visit ticked, the chart draws it over time: the groups side by side at each visit, as boxes, as means with standard errors or as medians with quartiles, and under each visit the number in each group and R\u2019s test of the groups there. Adjust across visits has R adjust those p-values across the visits. Click a visit\u2019s name to view that visit alone; the trail above the chart, or All in the Visit control, leads back.',
    "With one visit open, or a few, each visit is a panel. Click a box, a violin or a point to list its participants, and a row of the list to open that participant's profile.",
    'With one biomarker open, the row under the visits, and the line under each panel, is a test of the groups, computed by R. The tiles print no test and ask R for nothing. R is started in this browser the first time a biomarker is opened: the row says it is waiting, and the line under it what that first start downloads, until R answers. Nothing leaves this machine, and the chart computes no test itself.',
    'Choose the test under Statistics in the controls: a Welch t-test or a Wilcoxon rank-sum test between two groups, a one-way ANOVA or a Kruskal-Wallis test across more, or none. Group by Arm and sex for four groups, and switch on Pairwise comparisons to compare every pair, with the p-values adjusted across the pairs.',
    "Every result is exploratory. Each visit's test is its own, adjusted across the visits only when you ask for it, and the row says which; panels are not adjusted for one another. A change to a filter, a group or the test clears the line and asks R again, on the participants then drawn."
  ],
  'correlation-matrix': [
    "The chart opens on every biomarker at the first visit, Baseline: twelve biomarkers, sixty-six pairs. Below the diagonal a pair is a mark, wider and darker the stronger R's coefficient, a filled blue disc where it is positive and an orange ring where it is negative; above the diagonal is the coefficient itself. One pair was planted with a correlation, TNF-alpha with IL-10, true Pearson coefficient 0.6; the rest are unrelated by construction.",
    'Every coefficient is computed by R, on the participants who have both values of its pair, so each cell has its own count. R is started in this browser when the page opens: the line under the grid says it is waiting, and what that first start downloads, until R answers. Nothing leaves this machine, and the chart computes no coefficient itself, not for a number, a size or a colour.',
    'The grid prints no p-value, by design: sixty-six unadjusted tests at once is not a question. To test one pair, open it.',
    'Click a cell, or press Enter on it, to open that pair in the <a href="../association-scatter/index.html">association scatter</a>, in place: one point per participant, R\'s coefficient with its interval and p-value, and a fitted line. Back to the correlation matrix returns to the grid as it was. The method and the filters go with you.',
    "Under Variables choose biomarkers at one visit or the visits of one biomarker, the value, and which are in the grid. The grid draws at most twelve at a time and says how many it is showing of how many. With six or fewer, Small scatters draws each pair's points in place of its mark.",
    'Point at a cell, or move to it with the arrow keys, to read its coefficient, its interval and its pair count. The list under the grid has every pair with its count, in the order R returned them. On a phone the cells are too small to hold a number: both sides of the diagonal are marks, and the numbers are in that list.',
    "Under Statistics choose Pearson or Spearman, and the fewest complete pairs a cell needs: a cell with fewer shows R's reason and no number. Left empty, the minimum is R's own."
  ],
  'biomarker-screen': [
    "The chart opens on the difference the synthetic study was planted with: every biomarker's change from Baseline to Week 4, Placebo against Treatment. Each row is one biomarker: R's standardised difference (Hedges' g, the first group's mean less the second's, in pooled standard deviations) as a dot, its 95% confidence interval as a line, on one axis without units with nought marked. IL-6 was planted with a difference between the arms; the others differ by chance alone.",
    "Beside each row are R's p-values: Welch's t-test, unadjusted, and adjusted across every biomarker that has one, by Benjamini-Hochberg or, under Statistics, Holm. The caption says how many tests the adjustment covered. Every result is exploratory. R is started in this browser when the page opens: the line under the screen says it is waiting, and what that first start downloads, until R answers. Nothing leaves this machine, and the chart computes no estimate, interval, p-value or adjustment itself.",
    'Click a row, or press Enter on it, to open that biomarker in the <a href="../group-comparison/index.html">group comparison</a>, in place, at the same visit and value with the same two groups and Welch\'s test; Back to the biomarker screen returns to the rows as they were. The filters go with you.',
    'Under Screen choose Correlation with one variable to screen every biomarker against a participant-level number, such as age, or against another biomarker at a visit: IL-10 at Baseline is the one the study was planted with, and TNF-alpha is then the top row. A row of a correlation opens the <a href="../association-scatter/index.html">association scatter</a>.',
    "Sort the rows by R's estimate, largest first, by name, or by R's adjusted p-value. With more biomarkers than fit, the rows are paged, twenty to a page. A row R could not compute shows R's reason and no number, and is left out of the adjustment, as R says. On a phone each row stacks: the biomarker, its interval, and the numbers beneath."
  ],
  'association-scatter': [
    'The chart opens on the pair the synthetic study was planted with: TNF-alpha against IL-10 at Baseline, one point per participant, whose true Pearson correlation is 0.6. The points are coloured by arm.',
    'The overview of every pair is the <a href="../correlation-matrix/index.html">correlation matrix</a>: every biomarker against every other at one visit, with R\u2019s coefficient in each cell. A click on a cell there opens that pair here.',
    'To find which biomarker moves with a variable, start from the <a href="../biomarker-screen/index.html">biomarker screen</a>: every biomarker correlated with one variable, one row each, sorted by R\u2019s coefficient. A click on a row there opens that biomarker here.',
    "Under the chart is R's coefficient with its interval and p-value, for everyone drawn and, in the table, within each arm. R is started in this browser when the page opens: the line says it is waiting, and what that first start downloads, until R answers. Nothing leaves this machine, and the chart computes no statistic itself.",
    'Choose the variable on each axis in the controls: any biomarker at any visit, as its result, its baseline, or its change, fold change or percent change from baseline; or a participant-level number, age or body-mass index. Each axis can be logarithmic, and the line then says that R was given the logarithms.',
    "Choose Pearson or Spearman under Statistics. Spearman's coefficient has no interval in R, and none is made up.",
    "Under Fitted line choose the identity line, y = x, which needs no statistics, or R's linear fit or smooth, each with its band: the straight line's slope and intercept are printed with their intervals. Every point of a line and its band is R's.",
    'Drag across the points to list the participants in a region, and click a point to list its participant and open their profile. On a phone, tap Select a region first, so that a drag selects and does not scroll; the controls are folded away above the chart, one tap from open. A region lists participants and does not change what R is asked.',
    'Every result is exploratory and unadjusted. A change to a variable, a scale, a colour, a panel, the method or a filter clears the line and asks R again, on the participants then drawn.'
  ]
};

// A chart's live demo: the chart, drawn on the synthetic study by the chart's
// demo script. safety.viz's bundle is loaded first, as its own script tag, and
// bio.viz's after it: the chart is built from safety.viz's kit and bundles none
// of it.
export function renderDemoPage({ entry, version, study, kit, statistics }) {
  const bundle = `../dist/bio.viz-${version}/bio.viz.js`;
  const notes = (DEMO_NOTES[entry.module] || []).map((note) => `<li>${note}</li>`).join('\n    ');
  const source = study
    ? ` The data is the <a href="../gallery/index.html#demo-data">synthetic study</a>: ` +
      `${count(study.files[1] ? study.files[1].rows : 0)} made-up participants, and no real one.`
    : '';
  const built = kit
    ? `<p class="section-summary" id="demo-kit">The controls, the filters, the listing, the ` +
      `participant profile and the Chart.js this chart draws with are safety.viz's, version ` +
      `${escapeHtml(kit.version)}, loaded beside bio.viz from ` +
      `<a href="../vendor/safety.viz/SOURCE.json">a copy with a record of where it came from</a>.` +
      (kit.merged_to_dev === false
        ? ` That copy is from a branch of safety.viz that is not merged yet.`
        : '') +
      `</p>`
    : '';
  // Which R functions answer, and from where: gsm.bio's statistics file, as
  // vendored, with the commit it was copied from.
  const computed = statistics
    ? `<p class="section-summary" id="demo-statistics">The ${entry.module === 'group-comparison' ? 'tests' : 'statistics'} are gsm.bio's, version ` +
      `${escapeHtml(statistics.version || '')}: R in this browser is given ` +
      `<a href="../vendor/gsm.bio/statistics.R">one file of R</a>, copied from gsm.bio at commit ` +
      `<code>${escapeHtml(statistics.commit.slice(0, 7))}</code> with ` +
      `<a href="../vendor/gsm.bio/SOURCE.json">a record of where it came from</a>. The same ` +
      `file, run in desktop R on the rows this chart hands over, wrote the answers the ` +
      `browser tests hold this page to.</p>`
    : '';
  // `demo-page` gives the page the room a chart with its sidebar needs, as it
  // does on safety.viz's site.
  return `
<div class="demo-page">
<h1>${escapeHtml(entry.title)}${statusBadge(entry)}</h1>
<p class="tagline">${escapeHtml(entry.blurb)}${source}</p>
${statusNote(entry)}
${moduleTabs('demo', entry)}

<section id="demo">
  <div id="chart"></div>
</section>

<section id="about-demo">
  <ul class="demo-tips">
    ${notes}
  </ul>
  ${built}
  ${computed}
</section>
</div>

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

// What a screenshot shows, from its name: `<requirement ID>-<what it shows>.png`.
const shotCaption = (id, file) => file.slice(id.length + 1, -4).replaceAll('-', ' ');

// A module's evidence page, laid out as safety.viz's is: the facts of the run,
// then a table with a row for each requirement in the module's matrix, in the
// matrix's order, with the tests named for it, what each recorded, and any
// screenshot a test captured; then every screenshot again, larger. A
// requirement with no test is shown as having none; the evidence run fails on
// one, so a published page should never show it.
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
  const shown = ids.flatMap((id) => shotsFor(id).map((file) => ({ id, file })));
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
            `test of ${escapeHtml(id)}: ${escapeHtml(shotCaption(id, file))}"></a>`
        )
        .join('');
      return (
        `<tr class="requirement" id="${escapeHtml(id)}" data-status="${status}">` +
        `<td data-label="Requirement">` +
        `<div class="req-ids"><span class="req-id">${escapeHtml(id)}</span>${chip(status, runUrl)}</div>` +
        `<div class="req-texts"><p class="req-text">${mdInline(requirements[id])}</p></div></td>` +
        `<td data-label="Tests and evidence">` +
        (tests.length
          ? `<ul class="tests">${tests.map((record) => testItem(record, config, runUrl)).join('')}</ul>`
          : `<p class="sub">No test is named for this requirement.</p>`) +
        (shots ? `<div class="screenshots">${shots}</div>` : '') +
        `</td></tr>`
      );
    })
    .join('\n');

  const result = failing.length
    ? `${chip('fail', runUrl)} ${plural(failing.length, 'test')} failing`
    : untested.length
      ? `${chip('none')} ${plural(untested.length, 'requirement')} with no test`
      : `${chip('pass', runUrl)} every test passing`;

  const visual = shown.length
    ? `
<section id="visual-evidence">
  <h2>Visual evidence</h2>
  <p class="section-summary">
    Every screenshot below is a committed baseline: the same picture is what the browser tests
    compare the page with and what is shown here. Click one for the picture at its full size.
  </p>
  <ul class="evidence-gallery">
${shown
  .map(
    ({ id, file }) =>
      `<li><figure><a href="evidence/${escapeHtml(file)}">` +
      `<img src="evidence/${escapeHtml(file)}" loading="lazy" ` +
      `alt="Evidence screenshot: ${escapeHtml(shotCaption(id, file))}"></a>` +
      `<figcaption><code>${escapeHtml(id)}</code> — ${escapeHtml(shotCaption(id, file))}</figcaption>` +
      `</figure></li>`
  )
  .join('\n')}
  </ul>
</section>`
    : '';

  const otherTests = other.length
    ? `
<section id="shared-tests">
  <h2>Tests run with every module</h2>
  <details>
    <summary>${plural(other.length, 'test')} of the site, the evidence pipeline and the repository’s own checks</summary>
    <p class="section-summary">
      These are recorded in every module’s evidence set. A requirement ID one of them carries
      belongs to another module’s page.
    </p>
    <ul class="tests">${other.map((record) => testItem(record, config, runUrl)).join('')}</ul>
  </details>
</section>`
    : '';

  return `
<h1>${escapeHtml(entry.title)}: test evidence${statusBadge(entry)}</h1>
<p class="tagline">
  Every requirement of this module, the tests named for it, and what each test recorded the
  last time the evidence was rebuilt.
</p>
${moduleTabs('evidence', entry)}
<p class="matrix-link">
  <a href="${matrixUrl}">Requirement matrix ↗</a> — the rows these tests are named for.
</p>

<section id="summary">
  <dl class="facts">
    <div class="fact"><dt>Requirements</dt><dd id="fact-requirements">${ids.length}</dd></div>
    <div class="fact"><dt>Tests named for them</dt><dd id="fact-tests">${named.length} <span class="sub">${named.filter((record) => record.suite === 'unit').length} unit · ${named.filter((record) => record.suite === 'browser').length} browser</span></dd></div>
    <div class="fact"><dt>Result</dt><dd id="fact-result">${result}</dd></div>
    <div class="fact"><dt>Screenshots</dt><dd id="fact-screenshots">${shown.length}</dd></div>
    <div class="fact"><dt>Recorded</dt><dd id="fact-recorded">${recordedFact(evidence)}</dd></div>
    <div class="fact"><dt>Environment</dt><dd id="fact-environment">${environmentFact(evidence)}</dd></div>
    <div class="fact"><dt>Test run</dt><dd id="fact-run">${runFact(evidence)}</dd></div>
  </dl>
  <p class="section-summary">
    The requirements are the rows of the module’s
    <a href="${matrixUrl}">requirement matrix</a>. A test is named for a requirement by starting
    its name with the requirement’s ID. The results are read from the committed
    <a href="${escapeHtml(config.repoUrl)}/blob/HEAD/docs/evidence/${escapeHtml(entry.module)}/evidence.json">evidence set</a>;
    continuous integration reruns every test and fails when the committed set no longer matches.
  </p>
</section>

<section id="requirements">
  <h2>Requirements and their tests</h2>
  <p class="section-summary">${plural(ids.length, 'requirement')} · ${plural(named.length, 'test')}</p>
  <table class="evidence doc-table">
    <thead><tr><th scope="col">Requirement</th><th scope="col">Tests and evidence</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</section>
${visual}
${otherTests}
<section class="reproduce" id="reproduce">
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
//
// The list of sections is a narrow column beside the page, as safety.viz's is,
// and a heading here is often a whole signature. `breakAfterBracket` lets one
// break after its opening bracket, so it does not break inside a word. Only the
// text between tags is touched, and only in the list: the heading is as written.
const breakAfterBracket = (html) =>
  html.replace(/(^|>)([^<]+)/g, (match, open, text) => open + text.replace(/\(/g, '(<wbr>'));

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
    .map(
      (heading) =>
        `<li><a href="#${heading.id}">${breakAfterBracket(mdInline(heading.text))}</a></li>`
    )
    .join('');
  const docUrl = `${escapeHtml(config.repoUrl)}/blob/HEAD/docs/${escapeHtml(entry.api.doc)}`;
  return `
<h1>${escapeHtml(title)}${statusBadge(entry)}</h1>
<p class="tagline" id="api-source">
  This page is the file <a href="${docUrl}"><code>docs/${escapeHtml(entry.api.doc)}</code></a>,
  rendered. The site build fails when the library exports something the file does not document,
  or when the file documents a function the library does not export.
</p>
${moduleTabs('api', entry)}

<div class="api-layout">
<nav class="api-toc" aria-label="On this page">
  <h2>On this page</h2>
  <ul>${contents}</ul>
</nav>

<article class="api-body">
${mdBlock(body)}
</article>
</div>
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
