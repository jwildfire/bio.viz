// Site build: assembles _site/ from site/ (shell, stylesheet, config) plus the
// committed artifacts — the dist/ bundle, the requirement extracts and the
// evidence sets. No test execution and no network: the same tree always builds
// the same site, apart from the optional commit label below.
//
// Fails on a broken internal link, so a broken site can never publish (the same
// validation gates CI).
//
// SITE_COMMIT, when set by the deploy workflow, is printed in the footer so a
// deployed page says which commit it was built from.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  escapeHtml,
  renderCheckPage,
  renderHome,
  renderShell,
  summarizeModule,
  validateSiteLinks
} from './site-lib.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = path.join(rootDir, '_site');
const { version } = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const config = JSON.parse(readFileSync(path.join(rootDir, 'site/config.json'), 'utf8'));
const shell = readFileSync(path.join(rootDir, 'site/shell.html'), 'utf8');

const commit = (process.env.SITE_COMMIT || '').trim();
const build = /^[0-9a-f]{7,40}$/.test(commit)
  ? ` Built from commit <a href="${escapeHtml(config.repoUrl)}/commit/${commit}">` +
    `<code>${commit.slice(0, 7)}</code></a>.`
  : '';

const errors = [];
const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined);

rmSync(siteDir, { recursive: true, force: true });
mkdirSync(siteDir, { recursive: true });
copyFileSync(path.join(rootDir, 'site/site.css'), path.join(siteDir, 'site.css'));

// The committed script-tag bundle and its source map, at the same versioned
// path a consumer would vendor.
const distDir = path.join(rootDir, `dist/bio.viz-${version}`);
const siteDistDir = path.join(siteDir, `dist/bio.viz-${version}`);
mkdirSync(siteDistDir, { recursive: true });
for (const file of ['bio.viz.js', 'bio.viz.js.map']) {
  if (!existsSync(path.join(distDir, file))) {
    errors.push(`missing dist/bio.viz-${version}/${file} — run \`npm run build\` first`);
    continue;
  }
  copyFileSync(path.join(distDir, file), path.join(siteDistDir, file));
}

const summaries = {};
for (const { module } of config.modules) {
  summaries[module] = summarizeModule({
    requirements: readJson(path.join(rootDir, 'docs/requirements', `${module}.json`)),
    evidence: readJson(path.join(rootDir, 'docs/evidence', module, 'evidence.json'))
  });
}

writeFileSync(
  path.join(siteDir, 'index.html'),
  renderShell({
    shell,
    title: 'bio.viz — biomarker charts with every test computed by R',
    description:
      `bio.viz ${version}: charts for comparing groups and relating variables in biomarker ` +
      'data, with every statistical test computed by R. This page names the build it carries.',
    content: renderHome({ config, version, summaries }),
    root: '',
    version,
    build
  })
);

// The R check page: its frame, the files it reads when it runs, and the
// measurement recorded with this build, when there is one.
const checkSource = path.join(rootDir, 'site/r-check');
const checkDir = path.join(siteDir, 'r-check');
mkdirSync(path.join(checkDir, 'data'), { recursive: true });
for (const file of ['check.mjs', 'page.mjs', 'statistics.R', 'expected.json']) {
  copyFileSync(path.join(checkSource, file), path.join(checkDir, file));
}
for (const file of readdirSync(path.join(checkSource, 'data')).filter((f) => f.endsWith('.csv'))) {
  copyFileSync(path.join(checkSource, 'data', file), path.join(checkDir, 'data', file));
}
writeFileSync(
  path.join(checkDir, 'index.html'),
  renderShell({
    shell,
    title: 'R check · bio.viz',
    description:
      'Two real tests run through R in the browser and compared with desktop R, with the ' +
      'megabytes and seconds that starting R in a browser costs.',
    content: renderCheckPage({
      version,
      expected: readJson(path.join(checkSource, 'expected.json')),
      measured: readJson(path.join(checkSource, 'measured.json'))
    }),
    root: '../',
    version,
    build
  })
);

errors.push(...validateSiteLinks(siteDir));

if (errors.length) {
  console.error('✗ Site build failed validation:');
  errors.forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}

console.log(
  `✓ Built _site/ — bio.viz ${version} home page and R check page, ${config.modules.length} ` +
    `module${config.modules.length === 1 ? '' : 's'} listed, all internal links verified.`
);
