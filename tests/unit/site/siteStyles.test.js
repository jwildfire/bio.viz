import { describe, it, expect } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderApiPage,
  renderCheckPage,
  renderDemoPage,
  renderEvidencePage,
  renderGallery,
  renderGalleryNav,
  renderHome,
  renderShell
} from '../../../scripts/site-lib.mjs';
import {
  SITE_STYLES,
  readRecord,
  sha256,
  verifyAgainstSource,
  verifyVendored
} from '../../../scripts/vendor-lib.mjs';

// The site's styles (#91, obot.roadmap#369): safety.viz's site stylesheet and
// page shell, copied with a record of the commit they came from, and the pages
// written in the markup that stylesheet styles. The copy is useful only while
// the pages agree with it, so the agreement is a test: copy the stylesheet
// again after safety.viz renames a class, or write a class here that neither
// stylesheet has, and this file fails until they say the same thing.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');
const directory = path.join(ROOT, SITE_STYLES.directory);
const copied = read(`${SITE_STYLES.directory}/site.css`);
const copiedShell = read(`${SITE_STYLES.directory}/shell.html`);
const own = read('site/site.css');
const shell = read('site/shell.html');
const config = JSON.parse(read('site/config.json'));
const study = JSON.parse(read('site/data/synthetic-study/SOURCE.json'));

// A stylesheet with its comments taken out, so a class a comment names is not
// read as a class a rule styles.
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
// The classes a stylesheet's selectors name. A selector is what comes before a
// `{`; a declaration's value (a URL, a number) is never read.
const classesStyled = (css) => {
  const found = new Set();
  for (const [, selector] of withoutComments(css).matchAll(/([^{}]+)\{/g)) {
    for (const [, name] of selector.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) found.add(name);
  }
  return found;
};
// The classes a piece of HTML writes.
const classesWritten = (html) => {
  const found = new Set();
  for (const [, value] of html.matchAll(/class="([^"]*)"/g)) {
    for (const name of value.split(/\s+/).filter(Boolean)) found.add(name);
  }
  return found;
};
const scriptOf = (html) =>
  html
    .match(/<script>([\s\S]*?)<\/script>/)[1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

// One of every page the site builds, from the registry and the study as
// committed: a chart and a shared part, with a requirement that has a test, a
// screenshot and no test at all, and a reference with a table and code.
const chart = config.modules.find((entry) => entry.module === 'stratified-survival');
const part = config.modules.find((entry) => entry.module === 'core');
const evidence = {
  generatedAt: '2026-10-05T03:22:00.000Z',
  environment: { os: 'linux', node: 'v22', playwright: '1.61.1', chromium: '149' },
  run: { id: '1', url: 'https://github.com/jwildfire/bio.viz/actions/runs/1' },
  records: [
    {
      test: 'SS-DRAW-001: drawn (#61)',
      suite: 'browser',
      status: 'pass',
      requirementIds: ['SS-DRAW-001'],
      screenshots: ['SS-DRAW-001-curves.png']
    },
    {
      test: 'SS-DRAW-002: fails (#61)',
      suite: 'unit',
      status: 'fail',
      requirementIds: ['SS-DRAW-002'],
      screenshots: []
    },
    {
      test: 'the site holds (#1)',
      suite: 'browser',
      status: 'pass',
      requirementIds: [],
      screenshots: []
    }
  ]
};
const pages = {
  home: renderHome({ config, version: '0.2.0', summaries: {} }),
  gallery: renderGallery({
    config,
    study,
    heroes: { 'stratified-survival': 'SS-DRAW-001-as-the-gallery-shows-it.png' }
  }),
  'gallery with no chart': renderGallery({ config: { ...config, modules: [part] }, study }),
  demo: renderDemoPage({
    entry: chart,
    version: '0.2.0',
    study,
    kit: { version: '1.9.0', merged_to_dev: true },
    statistics: { version: '0.2.0', commit: '0123456789abcdef0123456789abcdef01234567' }
  }),
  evidence: renderEvidencePage({
    entry: chart,
    config,
    requirements: { 'SS-DRAW-001': 'Drawn.', 'SS-DRAW-002': 'Also.', 'SS-DRAW-003': 'Untested.' },
    evidence,
    screenshots: ['SS-DRAW-001-curves.png']
  }),
  api: renderApiPage({
    entry: part,
    config,
    markdown: '# The core\n\n## `version`\n\n| Name | Is |\n|---|---|\n| a | b |\n\n```js\nx\n```\n'
  }),
  'R check': renderCheckPage({
    version: '0.2.0',
    expected: { made_by: { r_version: '4.3.3', survival_version: '3.5.8' } },
    measured: {
      recorded: '2026-10-02T12:00:00.000Z',
      browser: 'Chromium',
      machine: 'a laptop',
      sizes: 'compressed',
      states: {
        cold: { megabytes: 1, bytes: 1e6, requests: 1, requestsOverNetwork: 1, seconds: 1 }
      }
    }
  })
};
const built = Object.fromEntries(
  Object.entries(pages).map(([name, content]) => [
    name,
    renderShell({
      shell,
      title: name,
      content,
      root: '../',
      version: '0.2.0',
      modules: config.modules
    })
  ])
);

// Classes a page writes for a test or a script to find, which no rule styles:
// a requirement's row, a reference's body, and the language of a code sample.
const HOOKS = [/^requirement$/, /^api-body$/, /^language-[a-z]+$/];
// The R check page's own script writes its results into the page.
const checkScript = read('site/r-check/page.mjs');

describe('the copied site styles', () => {
  it('CORE-SITE-018: safety.viz’s site stylesheet and page shell are in site/vendor/safety.viz-site/ with a record naming the repository, its dev branch, the commit and each file, and the copy matches its record (#91)', () => {
    expect(verifyVendored(directory)).toEqual([]);
    const record = readRecord(directory);
    expect(record).toMatchObject({
      styles: SITE_STYLES.name,
      repository: 'https://github.com/jwildfire/safety.viz',
      ref: 'dev',
      merged_to_dev: true
    });
    expect(record.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(record.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(record.files.map((entry) => [entry.file, entry.source])).toEqual([
      ['site.css', 'site/site.css'],
      ['shell.html', 'site/shell.html']
    ]);
    for (const entry of record.files) {
      const bytes = readFileSync(path.join(directory, entry.file));
      expect(sha256(bytes), entry.file).toBe(entry.sha256);
      expect(bytes.length, entry.file).toBe(entry.bytes);
    }
    // It is safety.viz's stylesheet: its tokens, and the classes its pages are written in.
    expect(copied).toContain('--accent-bright:');
    for (const name of ['site-header', 'card-thumb', 'page-tabs', 'facts', 'api-toc']) {
      expect(classesStyled(copied), name).toContain(name);
    }
  });

  it('CORE-SITE-018: a copied file that is changed, missing, or beside one the record does not name fails the check, and the second check holds each file to safety.viz at the recorded commit (#91)', async () => {
    const scratch = mkdtempSync(path.join(tmpdir(), 'bioviz-styles-'));
    try {
      const copyTo = (name) => {
        const dir = path.join(scratch, name);
        cpSync(directory, dir, { recursive: true });
        return dir;
      };
      expect(verifyVendored(copyTo('untouched'))).toEqual([]);
      const changed = copyTo('changed');
      writeFileSync(path.join(changed, 'site.css'), `${copied}\nbody { color: red; }\n`);
      expect(verifyVendored(changed).join('\n')).toMatch(
        /site\.css: the file no longer matches its recorded checksum/
      );
      const missing = copyTo('missing');
      rmSync(path.join(missing, 'shell.html'));
      expect(verifyVendored(missing).join('\n')).toMatch(/shell\.html: recorded, but/);
      const extra = copyTo('extra');
      writeFileSync(path.join(extra, 'more.css'), 'a {}');
      expect(verifyVendored(extra).join('\n')).toMatch(/more\.css: present, but not in/);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    // Against the source: each file is asked for at the recorded commit, by its
    // path in safety.viz, and a file that differs there is named.
    const record = readRecord(directory);
    const asked = [];
    const same = await verifyAgainstSource(directory, async (commit, file) => {
      asked.push([commit, file]);
      return readFileSync(path.join(directory, path.basename(file)));
    });
    expect(same).toEqual([]);
    expect(asked).toEqual([
      [record.commit, 'site/site.css'],
      [record.commit, 'site/shell.html']
    ]);
    const differs = await verifyAgainstSource(directory, async () => Buffer.from('other'));
    expect(differs.join('\n')).toMatch(/site\.css: differs from site\/site\.css at/);
  });
});

describe('the pages and the two stylesheets', () => {
  it('CORE-SITE-019: every page loads the copied stylesheet and then the site’s own, by paths that hold at any depth (#91)', () => {
    const links = [...shell.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    expect(links).toEqual(['{{root}}vendor/safety.viz-site/site.css', '{{root}}site.css']);
    for (const [name, html] of Object.entries(built)) {
      const loaded = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
      expect(loaded, name).toEqual(['../vendor/safety.viz-site/site.css', '../site.css']);
    }
  });

  it('CORE-SITE-019: the site’s own stylesheet redefines none of safety.viz’s tokens, writes every colour and typeface as one of them, and names no element by its tag alone but the page’s body (#91, #112)', () => {
    const rules = withoutComments(own);
    // No token is defined, and nothing is imported: the faces are the copy's.
    expect(rules).not.toMatch(/(^|[\s;{])--[\w-]+\s*:/);
    expect(rules).not.toMatch(/@import|@font-face/);
    // Every declaration, by property and value.
    const declarations = [...rules.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)].map(([, p, v]) => [
      p,
      v.trim()
    ]);
    expect(declarations.length).toBeGreaterThan(40);
    const literalColour = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\(/;
    expect(declarations.filter(([, value]) => literalColour.test(value))).toEqual([]);
    // A colour is a token; so is a typeface, wherever one is named.
    const coloured = declarations.filter(([property]) =>
      /^(color|background|background-color|border(-\w+)*-color)$/.test(property)
    );
    expect(coloured.length).toBeGreaterThan(10);
    expect(coloured.filter(([, value]) => !/^var\(--[\w-]+\)$/.test(value))).toEqual([]);
    const faces = declarations.filter(([property]) => /^font(-family)?$/.test(property));
    expect(faces.length).toBeGreaterThan(5);
    expect(faces.filter(([, value]) => !/var\(--(sans|serif|mono)\)$/.test(value))).toEqual([]);
    // No colour is given to an element by its tag alone. A demo page holds a
    // chart, and a chart's own parts (a folded list's summary line, a button)
    // are coloured by the chart: a rule here names a class or an id of the
    // site's, so it cannot reach into one.
    const tagAlone = [...rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /(^|[\s;])(color|background(-color)?)\s*:/.test(body))
      .flatMap(([, selector]) => selector.split(','))
      .map((selector) => selector.trim())
      .filter((selector) => !/[.#]/.test(selector));
    expect(tagAlone).toEqual([]);
    // And no rule of any kind names a tag alone (#112): a chart's parts are
    // made of the same tags the site's pages are, and a rule on `pre` or `th`
    // reaches them. The one exception is the page's own wrapping of a long
    // string, which is inherited and is switched off again inside the chart.
    const bare = [...rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .flatMap(([, selector, body]) =>
        selector.split(',').map((one) => [one.trim(), body.trim().replace(/\s+/g, ' ')])
      )
      .filter(([selector]) => !/[.#]/.test(selector));
    expect(bare).toEqual([['body', 'overflow-wrap: anywhere;']]);
    expect(rules).toMatch(/#chart\s*\{\s*overflow-wrap:\s*normal;/);
    // Each token it reads is one the copy defines.
    const defined = new Set([...copied.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...rules.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
    expect([...used].filter((token) => !defined.has(token))).toEqual([]);
  });

  it('CORE-SITE-019: every class a page writes is styled by one of the two stylesheets, and the site’s own styles no class the pages do not write (#91)', () => {
    const styled = new Set([...classesStyled(copied), ...classesStyled(own)]);
    const written = new Set();
    for (const [name, html] of Object.entries(built)) {
      const unstyled = [...classesWritten(html)].filter(
        (cls) => !styled.has(cls) && !HOOKS.some((hook) => hook.test(cls))
      );
      expect(unstyled, `${name}: written, and styled by neither stylesheet`).toEqual([]);
      for (const cls of classesWritten(html)) written.add(cls);
    }
    // The pages do write safety.viz's own: the parts a reader of its site knows.
    for (const cls of [
      'site-header',
      'site-name',
      'site-version',
      'site-nav',
      'nav-group',
      'nav-menu',
      'site-main',
      'site-footer',
      'tagline',
      'page-tabs',
      'gallery',
      'card',
      'card-thumb',
      'card-body',
      'card-links',
      'site-badge',
      'facts',
      'fact',
      'chip',
      'evidence',
      'evidence-gallery',
      'api-layout',
      'api-toc',
      'demo-page'
    ]) {
      expect(written, cls).toContain(cls);
      expect(classesStyled(copied), cls).toContain(cls);
    }
    // And nothing in the site's own stylesheet is left over from a page that
    // no longer writes it. The R check page's script writes some of its own.
    const unwritten = [...classesStyled(own)].filter(
      (cls) => !written.has(cls) && !new RegExp(`['" ]${cls}['" ]`).test(checkScript)
    );
    expect(unwritten).toEqual([]);
    // It restates no rule of the copy: a class both stylesheets style is one
    // the site's own adjusts, and there are few.
    const both = [...classesStyled(own)].filter((cls) => classesStyled(copied).has(cls));
    expect(both.sort()).toEqual(
      [
        'api-layout',
        'card-thumb',
        'chip',
        'evidence',
        'evidence-gallery',
        'gallery',
        // Named only to say where a snippet of code wraps (#112).
        'reproduce',
        'req-ids',
        'site-header',
        'sub'
      ].sort()
    );
  });
});

describe('the page shell', () => {
  it('CORE-SITE-020: the shell’s header, navigation and footer are the copied shell’s, and its header script is the copied shell’s, character for character (#91)', () => {
    // Every class the shell writes is one the copied shell writes.
    const theirs = classesWritten(copiedShell);
    expect([...classesWritten(shell)].filter((cls) => !theirs.has(cls))).toEqual([]);
    for (const cls of [
      'site-header',
      'site-name',
      'site-version',
      'site-nav',
      'site-main',
      'site-footer'
    ]) {
      expect(classesWritten(shell), cls).toContain(cls);
    }
    // The same tokens are filled, and the Gallery entry is where theirs is.
    for (const token of [
      '{{title}}',
      '{{description}}',
      '{{version}}',
      '{{root}}',
      '{{galleryNav}}',
      '{{content}}'
    ]) {
      expect(copiedShell, token).toContain(token);
      expect(shell, token).toContain(token);
    }
    // The script that marks the page a reader is on and opens the Gallery list.
    expect(scriptOf(shell)).toBe(scriptOf(copiedShell));
    expect(scriptOf(shell)).toContain("classList.add('current')");
    expect(scriptOf(shell)).toContain("setAttribute('aria-expanded'");
    // It is this library's page, not safety.viz's.
    expect(shell).toContain('href="https://github.com/jwildfire/bio.viz"');
    expect(shell).not.toMatch(/Demo app|nav-app|architecture\.html|about\.html|domains\//);
  });

  it('CORE-SITE-020: the header’s Gallery entry lists each published chart, leading to its live demo, and is a plain link while none is published (#91)', () => {
    const charts = config.modules.filter(
      (entry) => entry.kind === 'chart' && entry.status !== 'planned'
    );
    const nav = renderGalleryNav(config.modules, '../');
    expect(nav).toContain('<a href="../gallery/index.html">Gallery</a>');
    expect(
      [...nav.matchAll(/<li><a href="([^"]+)">([^<]+)<\/a><\/li>/g)].map((m) => [m[1], m[2]])
    ).toEqual(charts.map((entry) => [`../${entry.module}/index.html`, entry.title]));
    expect(charts.length).toBeGreaterThan(0);
    // The button says what it opens, and starts closed.
    expect(nav).toContain('aria-controls="gallery-menu"');
    expect(nav).toContain('aria-expanded="false"');
    expect(nav).toContain('<ul id="gallery-menu" class="nav-menu">');
    // A shared part is not a chart, and a planned chart has no page to lead to.
    expect(nav).not.toContain('core/index.html');
    const planned = [part, { ...chart, status: 'planned' }];
    expect(renderGalleryNav(planned)).toBe('<a href="gallery/index.html">Gallery</a>');
    // On a page, at the page's depth, with the name, the version and the footer.
    const home = renderShell({
      shell,
      title: 'bio.viz',
      content: '',
      root: '',
      version: '0.2.0',
      modules: config.modules
    });
    expect(home).toContain('<a class="site-name" href="index.html">');
    expect(home).toMatch(/<span class="site-version">v0\.2\.0<\/span>/);
    expect(home).toContain('<a href="gallery/index.html">Gallery</a>');
    expect(home).toContain(`<li><a href="${charts[0].module}/index.html">`);
    expect(home).toContain('<a href="r-check/index.html">R check</a>');
    expect(home).toContain('<footer class="site-footer">');
    expect(home).not.toMatch(/\{\{\w+\}\}/);
  });
});
