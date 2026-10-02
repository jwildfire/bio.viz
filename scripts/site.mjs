// Site build: assembles _site/ from site/ (shell, stylesheet, config) plus the
// committed artifacts — the dist/ bundle, the requirement extracts, the
// evidence sets with their screenshots, the reference files in docs/ and the
// vendored synthetic study. No test execution and no network: the same tree
// always builds the same site, apart from the optional commit label below.
//
// Pages: the home page, the R check page, the gallery, and for every module in
// the registry an evidence page and an API reference.
//
// Fails, and so can never publish, on a malformed registry entry, a broken
// internal link, a screenshot the evidence names but nobody committed, a
// vendored file that no longer matches its record, or an API reference that has
// drifted from the code (the same validation gates CI).
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  checkApiReference,
  jsdocParams,
  readSources,
  surfaceNames,
  unclaimedExports
} from './api-lib.mjs';
import {
  availableModules,
  escapeHtml,
  renderApiPage,
  renderCheckPage,
  renderEvidencePage,
  renderGallery,
  renderHome,
  renderShell,
  summarizeModule,
  validateEvidenceScreenshots,
  validateRegistry,
  validateSiteLinks
} from './site-lib.mjs';
import { STUDY, readRecord, verifyVendored } from './vendor-lib.mjs';

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

function fail() {
  console.error('✗ Site build failed validation:');
  errors.forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}

// Nothing below can be trusted to list a module the registry describes badly.
errors.push(...validateRegistry(config));
if (errors.length) fail();

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

// The vendored synthetic study, published where every demo reads it, with its
// source record. A file that no longer matches the record stops the build.
const studySource = path.join(rootDir, STUDY.directory);
const studyDir = path.join(siteDir, 'data/synthetic-study');
const studyProblems = verifyVendored(studySource);
errors.push(...studyProblems.map((problem) => `${STUDY.directory}: ${problem}`));
let study;
if (!studyProblems.length) {
  study = readRecord(studySource);
  mkdirSync(studyDir, { recursive: true });
  for (const file of [...study.files.map((entry) => entry.file), 'SOURCE.json']) {
    copyFileSync(path.join(studySource, file), path.join(studyDir, file));
  }
}

// The gallery: the charts that are published, the shared parts and the study.
mkdirSync(path.join(siteDir, 'gallery'), { recursive: true });
writeFileSync(
  path.join(siteDir, 'gallery/index.html'),
  renderShell({
    shell,
    title: 'Gallery · bio.viz',
    description:
      'The charts in bio.viz, each with the tests that prove it and the reference for calling ' +
      'it, the shared parts they are built on, and the synthetic study the demos run on.',
    content: renderGallery({ config, study }),
    root: '../',
    version,
    build
  })
);

// Per module: an evidence page and an API reference. The committed ES module
// bundle says what the library exports, so the reference is held to the code a
// page actually loads.
const modules = availableModules(config);
const bundleFile = path.join(distDir, 'bio.viz.esm.js');
const bundle = existsSync(bundleFile) ? await import(pathToFileURL(bundleFile).href) : null;
if (bundle) {
  for (const name of unclaimedExports(bundle, config.modules)) {
    errors.push(
      `the bundle exports \`${name}\`, and no module in site/config.json lists it in ` +
        '`api.surface`: it has no API reference.'
    );
  }
}
// A link from one reference file to another stays on the site.
const referencePages = Object.fromEntries(
  modules.map((entry) => [entry.api.doc, `../${entry.module}/api.html`])
);

for (const entry of modules) {
  const { module } = entry;
  const moduleDir = path.join(siteDir, module);
  mkdirSync(path.join(moduleDir, 'evidence'), { recursive: true });

  // Evidence: the committed set joined to the requirement extract, with the
  // screenshots the set names copied beside the page.
  const evidenceDir = path.join(rootDir, 'docs/evidence', module);
  const evidence = readJson(path.join(evidenceDir, 'evidence.json'));
  const requirements = readJson(path.join(rootDir, 'docs/requirements', `${module}.json`));
  if (!evidence)
    errors.push(`missing docs/evidence/${module}/evidence.json — run \`npm run evidence\``);
  if (!requirements) {
    errors.push(`missing docs/requirements/${module}.json — run \`npm run requirements\``);
  }
  if (evidence && requirements) {
    errors.push(...validateEvidenceScreenshots(evidence, evidenceDir));
    const screenshots = readdirSync(evidenceDir).filter((name) => name.endsWith('.png'));
    for (const file of screenshots) {
      copyFileSync(path.join(evidenceDir, file), path.join(moduleDir, 'evidence', file));
    }
    writeFileSync(
      path.join(moduleDir, 'evidence.html'),
      renderShell({
        shell,
        title: `${entry.title}: test evidence · bio.viz`,
        description:
          `Every requirement of the bio.viz ${entry.title} module, the tests named for it and ` +
          'what each recorded, with the screenshots the tests captured.',
        content: renderEvidencePage({
          entry,
          config,
          requirements: requirements.requirements,
          evidence,
          screenshots
        }),
        root: '../',
        version,
        build
      })
    );
  }

  // API reference: the module's reference file, checked against the code and
  // then rendered.
  const docFile = path.join(rootDir, 'docs', entry.api.doc);
  if (!existsSync(docFile)) {
    errors.push(`${module}: site/config.json names docs/${entry.api.doc}, which does not exist.`);
    continue;
  }
  const markdown = readFileSync(docFile, 'utf8');
  if (bundle) {
    errors.push(
      ...checkApiReference({
        module,
        doc: `docs/${entry.api.doc}`,
        markdown,
        names: surfaceNames(bundle, entry.api.surface),
        params: jsdocParams(readSources(rootDir, entry.api.source))
      })
    );
  }
  writeFileSync(
    path.join(moduleDir, 'api.html'),
    renderShell({
      shell,
      title: `${entry.title}: API reference · bio.viz`,
      description:
        `The interface of the bio.viz ${entry.title} module: what it exports, what each call ` +
        'takes and what it answers.',
      content: renderApiPage({ entry, config, markdown, pages: referencePages }),
      root: '../',
      version,
      build
    })
  );
}

errors.push(...validateSiteLinks(siteDir));

if (errors.length) fail();

const charts = modules.filter((entry) => entry.kind === 'chart').length;
console.log(
  `✓ Built _site/ — bio.viz ${version}: home page, R check page, gallery ` +
    `(${charts} chart${charts === 1 ? '' : 's'}), and an evidence page and an API reference for ` +
    `each of ${modules.length} module${modules.length === 1 ? '' : 's'}; all internal links ` +
    'verified.'
);
