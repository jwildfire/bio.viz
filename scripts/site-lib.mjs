// Site generators: pure functions scripts/site.mjs assembles into _site/. Plain
// Node, no framework — and every internal URL relative, so one build serves the
// site root, /dev/, and /pr/{N}/ unchanged. Modelled on safety.viz's site-lib,
// trimmed to the one page that exists; the gallery, evidence and API-reference
// generators arrive with the first chart.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

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
  build = ''
}) {
  return shell
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
    `<li class="module">` +
    `<h3>${escapeHtml(entry.title)}</h3>` +
    `<p>${escapeHtml(entry.blurb)}</p>` +
    `<p class="module-facts">${[...facts.map(escapeHtml), matrix].filter(Boolean).join(' · ')}</p>` +
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

<aside class="callout">
  <h2>No charts yet</h2>
  <p>
    This first release sets the repository up and measures what running R in the browser costs:
    how many megabytes it downloads and how many seconds pass before the first result. The charts
    follow once that is known.
  </p>
</aside>

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
