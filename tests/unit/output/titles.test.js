import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEVELOPMENT,
  NOTHING_ASKED,
  STILL_WAITING,
  TITLE_DEFAULTS,
  VERSION,
  VERSION_SAID,
  automaticFootnote,
  checkTitles,
  countsText,
  dateDrawn,
  fillParts,
  fillText,
  placeholdersIn
} from '../../../src/shared/titles.js';
import { titlesOf } from '../../../src/shared/chartHost.js';
import { createConnection } from '../../../src/r/index.js';
import { syncSettings as groupComparison } from '../../../src/group-comparison/configure.js';
import { syncSettings as associationScatter } from '../../../src/association-scatter/configure.js';
import { syncSettings as correlationMatrix } from '../../../src/correlation-matrix/configure.js';
import { syncSettings as biomarkerScreen } from '../../../src/biomarker-screen/configure.js';
import { syncSettings as crossTab } from '../../../src/cross-tab/configure.js';
import { syncSettings as stratifiedSurvival } from '../../../src/stratified-survival/configure.js';

// Every chart's title, subtitle and footnotes (#66): text with placeholders,
// filled as text, and the footnote the chart writes last.

const SYNCS = {
  groupComparison,
  associationScatter,
  correlationMatrix,
  biomarkerScreen,
  crossTab,
  stratifiedSurvival
};
const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
const crossTabR = JSON.parse(
  readFileSync(new URL('../../fixtures/cross-tab-r.json', import.meta.url), 'utf8')
);
const ok = (value, more = {}) => ({ status: 'ok', value, form: 'browser', ...more });

const refusal = (make) => {
  try {
    make();
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    return error.message;
  }
  throw new Error('not refused');
};

describe('getting results out: titles and footnotes', () => {
  it('EXP-TXT-001: a placeholder is replaced by the text of its value, once, left to right; a name the chart does not have is left as written; nothing in a template or a value is evaluated, so code-like text is shown as text (#66)', () => {
    expect(
      fillText('{measure} at {visit}: {n} participants', {
        measure: 'CRP',
        visit: 'Week 4',
        n: 186
      })
    ).toBe('CRP at Week 4: 186 participants');
    // A name the chart does not have stays, braces and all.
    expect(fillText('{measure} by {arm}', { measure: 'CRP' })).toBe('CRP by {arm}');
    // Null and undefined are written as nothing; a number as it reads.
    expect(fillText('[{a}][{b}][{c}]', { a: null, b: undefined, c: 0 })).toBe('[][][0]');
    // Code-like text in a template is text.
    for (const template of [
      '${1 + 1} and ${globalThis.x = 1}',
      '<script>window.hacked = true</script>',
      '{{constructor.constructor("return 1")()}}',
      '{ measure }',
      '{__proto__}',
      '{toString}'
    ]) {
      expect(fillText(template, { measure: 'CRP' }), template).toBe(template);
      expect(globalThis.x).toBe(undefined);
    }
    // Code-like text in a value is text, and is not read for placeholders.
    const values = {
      measure: '${process.exit(1)}',
      visit: '<img src=x onerror=alert(1)>',
      n: '{measure}',
      group: '{{7*7}}'
    };
    expect(fillText('{measure} | {visit} | {n} | {group}', values)).toBe(
      '${process.exit(1)} | <img src=x onerror=alert(1)> | {measure} | {{7*7}}'
    );
    // Doubled braces round a name fill the name and keep the outer braces.
    expect(fillText('{{measure}}', { measure: 'CRP' })).toBe('{CRP}');
    expect(placeholdersIn('{measure} at {visit}, {measure} again; {{n}}')).toEqual([
      'measure',
      'visit',
      'n'
    ]);
  });

  it('EXP-TXT-002: every chart takes `title`, `subtitle` and `footnotes`, null by default; a title or subtitle that is not text, or footnotes that are not text or a list of texts, are refused with a sentence; one footnote is a list of one (#66)', () => {
    expect(TITLE_DEFAULTS).toEqual({ title: null, subtitle: null, footnotes: null });
    for (const [name, sync] of Object.entries(SYNCS)) {
      expect(sync(), name).toMatchObject(TITLE_DEFAULTS);
      expect(
        sync({ title: 'CRP', subtitle: '{n} participants', footnotes: 'Synthetic.' }),
        name
      ).toMatchObject({
        title: 'CRP',
        subtitle: '{n} participants',
        footnotes: ['Synthetic.']
      });
      expect(sync({ footnotes: ['One.', '', 'Two.'] }).footnotes, name).toEqual(['One.', 'Two.']);
      expect(
        refusal(() => sync({ title: 42 })),
        name
      ).toBe(
        'bio.viz: `title` must be text, which may hold placeholders such as {n}, or null for none.'
      );
      expect(
        refusal(() => sync({ subtitle: () => 'x' })),
        name
      ).toBe(
        'bio.viz: `subtitle` must be text, which may hold placeholders such as {n}, or null for none.'
      );
      expect(
        refusal(() => sync({ footnotes: ['One.', { text: 'Two.' }] })),
        name
      ).toBe('bio.viz: `footnotes` must be text, or a list of texts, or null for none.');
    }
    const settings = { title: null, subtitle: null, footnotes: 'A.' };
    checkTitles(settings);
    expect(settings.footnotes).toEqual(['A.']);
  });

  it('EXP-AUTO-001: the chart’s own footnote, always last, gives the date drawn, the bio.viz version, and R’s method and counts behind every statistic printed, with the R and gsm.bio versions of a stored result; while R is asked it says it is waiting (#66)', () => {
    expect(VERSION).toBe(pkg.version);
    expect(dateDrawn(new Date('2026-10-04T23:30:00Z'))).toBe('2026-10-04');
    const date = '2026-10-04';
    const version = VERSION;
    const drawn = `Drawn on 2026-10-04 by bio.viz ${VERSION}.`;
    expect(automaticFootnote({ date, version, asked: [] })).toBe(`${drawn} ${NOTHING_ASKED}`);
    expect(automaticFootnote({ date, version, asked: [{ answer: null }] })).toBe(
      `${drawn} ${STILL_WAITING}`
    );
    // R in this browser, R's method and its counts, as R returned them.
    const chisq = crossTabR.cases.find((entry) => entry.value.method).value;
    expect(automaticFootnote({ date, version, asked: [{ answer: ok(chisq) }] })).toBe(
      `${drawn} Statistics: ${chisq.method} (n = ${chisq.counts}); computed by R in this browser.`
    );
    // A stored result, with the versions that computed it.
    const welch = {
      method: 'Welch Two Sample t-test',
      counts: { Placebo: 95, Treatment: 91 }
    };
    const stored = {
      status: 'ok',
      value: welch,
      form: 'precomputed',
      computedBy: {
        r_version: '4.3.3',
        gsm_bio_version: '0.2.0',
        computed_at: '2026-10-01T09:00:00Z'
      }
    };
    expect(automaticFootnote({ date, version, asked: [{ answer: stored }] })).toBe(
      `${drawn} Statistics: Welch Two Sample t-test (Placebo n = 95, Treatment n = 91); computed by R 4.3.3 with gsm.bio 0.2.0 on 2026-10-01, stored with the page.`
    );
    // A stored result whose versions the page was not told.
    expect(
      automaticFootnote({
        date,
        version,
        asked: [{ answer: { ...stored, computedBy: undefined } }]
      })
    ).toBe(
      `${drawn} Statistics: Welch Two Sample t-test (Placebo n = 95, Treatment n = 91); stored with the page.`
    );
    // Several answers: each method with its counts, the source once.
    expect(
      automaticFootnote({
        date,
        version,
        asked: [
          { answer: ok({ method: "Pearson's product-moment correlation", counts: 200 }) },
          { answer: ok({ method: 'Linear regression', counts: 200 }) }
        ]
      })
    ).toBe(
      `${drawn} Statistics: Pearson's product-moment correlation (n = 200); Linear regression (n = 200); computed by R in this browser.`
    );
    // Unavailable, and R's error.
    expect(
      automaticFootnote({
        date,
        version,
        asked: [{ answer: { status: 'unavailable', reason: 'no-r-attached', message: 'x' } }]
      })
    ).toBe(`${drawn} Statistics: unavailable, as the line under the chart says.`);
    expect(
      automaticFootnote({ date, version, asked: [{ answer: { status: 'error', message: 'x' } }] })
    ).toBe(`${drawn} Statistics: R reported an error.`);
    // Counts of many: the least and the most, with how many.
    expect(
      countsText({ CRP: 185, 'D-dimer': 179, Ferritin: 184, IL6: 186, IL8: 185 }, 'biomarkers')
    ).toBe('n = 179 to 186 across 5 biomarkers');
    expect(countsText({ a: 5, b: 5, c: 5, d: 5, e: 5 }, 'variables')).toBe(
      'n = 5 across 5 variables'
    );
    expect(countsText(null)).toBe(null);
    // A result with no method and no counts: what R returned is what is said.
    expect(
      automaticFootnote({ date, version, asked: [{ answer: ok({ status: 'too_small' }) }] })
    ).toBe(`${drawn} Statistics: no statistic; computed by R in this browser.`);
  });

  it('EXP-AUTO-002: a connection told which R computed its stored results hands that record with every stored answer, and with no other; a record that is not one is refused with a sentence (#66)', async () => {
    const result = { name: 'f', args: {}, dataId: 'view', value: { method: 'm', counts: 3 } };
    const computedBy = {
      r_version: '4.3.3',
      gsm_bio_version: '0.2.0',
      computed_at: '2026-10-01T09:00:00Z'
    };
    const told = createConnection({ results: [result], computedBy });
    expect(await told.run('f', { args: {}, dataId: 'view' })).toEqual({
      status: 'ok',
      value: result.value,
      form: 'precomputed',
      computedBy
    });
    const untold = createConnection({ results: [result] });
    expect(await untold.run('f', { args: {}, dataId: 'view' })).toEqual({
      status: 'ok',
      value: result.value,
      form: 'precomputed'
    });
    for (const bad of [{ gsm_bio_version: '0.2.0' }, 'R 4.3.3', { r_version: 4 }]) {
      expect(refusal(() => createConnection({ results: [result], computedBy: bad }))).toBe(
        'bio.viz: `computedBy` must be { r_version, gsm_bio_version, computed_at }, each text: which R computed the stored results.'
      );
    }
  });
});

describe('getting results out: what the #69 review found', () => {
  const welch = { method: 'Welch Two Sample t-test', counts: { Placebo: 95, Treatment: 91 } };
  const group = JSON.parse(
    readFileSync(new URL('../../fixtures/group-statistics-r.json', import.meta.url), 'utf8')
  );
  const screen = JSON.parse(
    readFileSync(new URL('../../fixtures/screen-statistics-r.json', import.meta.url), 'utf8')
  );
  const valueOf = (fixture, name) => fixture.results.find((entry) => entry.case === name).value;
  const drawn = `Drawn on 2026-10-04 by bio.viz ${VERSION_SAID}.`;
  const say = (answer, of) =>
    automaticFootnote({ date: '2026-10-04', version: VERSION_SAID, asked: [{ answer }], of });

  it('EXP-AUTO-004: the chart’s own footnote names every method R used for what is printed, the pairwise test beside the overall one, and every adjustment of the p-values, by name (#69 review)', () => {
    const pairwise = valueOf(group, 'kruskal-pairwise');
    expect(say(ok(pairwise))).toBe(
      `${drawn} Statistics: Kruskal-Wallis rank sum test, with Wilcoxon rank sum test with continuity correction and Wilcoxon rank sum exact test (Placebo F n = 42, Placebo M n = 53, Treatment F n = 42, Treatment M n = 49), p-values adjusted by Holm; computed by R in this browser.`
    );
    const screened = valueOf(screen, 'difference-week-4-change');
    expect(say(ok(screened), 'biomarkers')).toMatch(
      /^Drawn on .* Statistics: Welch Two Sample t-test \(n = \d+ to \d+ across 12 biomarkers\), p-values adjusted by Benjamini-Hochberg; computed by R in this browser\.$/
    );
    const holm = valueOf(screen, 'difference-week-4-change-holm');
    expect(say(ok(holm), 'biomarkers')).toMatch(/, p-values adjusted by Holm; /);
    // No adjustment, no words about one.
    expect(say(ok(welch))).not.toMatch(/adjusted/);
  });

  it('EXP-AUTO-005: the footnote never names a released version for code that is not one: with development changes on the integration branch it says so; the package says so exactly while the release log has an upcoming section, and never in a tagged build (#69 review)', () => {
    expect(DEVELOPMENT).toBe(Boolean(pkg.bioviz && pkg.bioviz.development));
    expect(VERSION_SAID).toBe(
      DEVELOPMENT ? `${pkg.version} with development changes` : pkg.version
    );
    const news = readFileSync(new URL('../../../NEWS.md', import.meta.url), 'utf8');
    const upcoming = /^# bio\.viz v\S+ \(Upcoming\)$/m.test(news);
    expect(DEVELOPMENT, 'bioviz.development in package.json follows NEWS.md').toBe(upcoming);
    if ((process.env.GITHUB_REF || '').startsWith('refs/tags/')) expect(DEVELOPMENT).toBe(false);
    expect(say(ok(welch))).toMatch(
      new RegExp(`^Drawn on 2026-10-04 by bio\\.viz ${VERSION_SAID.replace(/\./g, '\\.')}\\. `)
    );
  });

  it('EXP-AUTO-006: the counts are named for four groups and summarised for five, numeric text is read as a number, many counts are summarised without spreading them; the source is the connection’s form as it says, and a stored result’s date is named (#69 review)', () => {
    const four = { a: 1, b: 2, c: 3, d: 4 };
    expect(countsText(four)).toBe('a n = 1, b n = 2, c n = 3, d n = 4');
    expect(countsText({ ...four, e: 5 }, 'groups')).toBe('n = 1 to 5 across 5 groups');
    expect(countsText('200')).toBe('n = 200');
    expect(countsText({ a: '7', b: 9 })).toBe('a n = 7, b n = 9');
    expect(countsText('many')).toBe(null);
    const huge = Object.fromEntries(Array.from({ length: 300000 }, (_, i) => [`v${i}`, i % 50]));
    expect(countsText(huge, 'variables')).toBe('n = 0 to 49 across 300000 variables');
    // The form, as the connection says it.
    expect(say({ status: 'ok', value: welch, form: 'browser' })).toMatch(
      /; computed by R in this browser\.$/
    );
    expect(say({ status: 'ok', value: welch, form: 'server' })).toMatch(/; computed by R\.$/);
    expect(say({ status: 'ok', value: welch })).toMatch(/; computed by R\.$/);
    expect(
      say({
        status: 'ok',
        value: welch,
        form: 'precomputed',
        computedBy: {
          r_version: '4.3.3',
          gsm_bio_version: '0.2.0',
          computed_at: '2026-10-01T09:00:00Z'
        }
      })
    ).toMatch(
      /; computed by R 4\.3\.3 with gsm\.bio 0\.2\.0 on 2026-10-01, stored with the page\.$/
    );
  });

  it('EXP-TXT-004: a title or subtitle of only white space is absent; a chart whose placeholders throw is still titled, and the error is reported, not swallowed; each placeholder’s value is its own run of text, so a page can isolate its direction (#69 review)', () => {
    const chart = (settings, placeholders) => ({
      settings: { title: null, subtitle: null, footnotes: null, ...settings },
      asked: [],
      placeholders
    });
    expect(titlesOf(chart({ title: '   ', subtitle: '\n\t' }, () => ({})))).toMatchObject({
      title: null,
      subtitle: null
    });
    const errors = [];
    const error = console.error;
    console.error = (...args) => errors.push(args);
    let said;
    try {
      said = titlesOf(
        chart({ title: '{n} at {version}' }, () => {
          throw new Error('broken');
        })
      );
    } finally {
      console.error = error;
    }
    expect(said.title).toBe(`{n} at ${VERSION_SAID}`);
    expect(errors).toHaveLength(1);
    expect(String(errors[0][0])).toMatch(/placeholders/);
    expect(fillParts('{a} and {b}!', { a: 'שלום', b: 2 })).toEqual([
      { text: 'שלום', value: true },
      { text: ' and ', value: false },
      { text: '2', value: true },
      { text: '!', value: false }
    ]);
    expect(fillParts('{x}', {})).toEqual([{ text: '{x}', value: false }]);
  });
});
