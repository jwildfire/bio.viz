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
