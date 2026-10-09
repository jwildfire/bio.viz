// A chart's title, subtitle and footnotes, and the footnote written for it,
// written once for every chart (#66).
//
//   title:     'CRP at {visit}'
//   subtitle:  '{n} participants, by {group}'
//   footnotes: ['Synthetic data.', 'Filters: {filters}.']
//
// Each is text with named placeholders. A placeholder is a name in braces,
// `{visit}`, and it is replaced by the text of that value, once, left to
// right: nothing in the template or in a value is evaluated, and a value is
// never read for placeholders of its own. A name the chart does not have is
// left as it was written, braces and all, so a typing slip shows on the page.
// What comes out is text, and the page writes it as text.
//
// One footnote is always last, written by the chart: the date it was drawn,
// the bio.viz version, and R's method and counts behind every statistic it
// printed, with the R and gsm.bio versions that computed a stored result.
//
// Everything here is pure: no page and no chart.

// The two small checks of src/shared/settings.js, which imports this file.
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const refuse = (message) => {
  throw new TypeError(`bio.viz: ${message}`);
};

/* global __BIO_VIZ_VERSION__, __BIO_VIZ_DEVELOPMENT__ */
/**
 * The library version, fixed when the bundle is built (scripts/build-lib.mjs)
 * and in the unit tests (vitest.config.js). A script that reads the source
 * without either sees that it is unbuilt.
 */
export const VERSION = typeof __BIO_VIZ_VERSION__ === 'string' ? __BIO_VIZ_VERSION__ : 'unbuilt';

/**
 * Whether this build holds changes made since the release `VERSION` names:
 * package.json's `bioviz.development`, true on the integration branch and set
 * false when a release is prepared, so a released build says only its version.
 */
export const DEVELOPMENT =
  typeof __BIO_VIZ_DEVELOPMENT__ === 'boolean' ? __BIO_VIZ_DEVELOPMENT__ : true;

/** The version as the footnote and `{version}` say it: never a release it is not. */
export const VERSION_SAID = DEVELOPMENT ? `${VERSION} with development changes` : VERSION;

/** The settings every chart has for its title, subtitle and footnotes. */
export const TITLE_DEFAULTS = Object.freeze({ title: null, subtitle: null, footnotes: null });

/**
 * The settings every chart has for its downloads (#67): whether the bar of
 * downloads is shown under the chart, and the PNG's resolution in image pixels
 * per CSS pixel.
 */
export const DOWNLOAD_DEFAULTS = Object.freeze({ downloads: true, png_scale: 2 });

/**
 * Checks `downloads` and `png_scale`.
 * @param {object} settings The settings, laid over the defaults.
 */
export function checkDownloads(settings) {
  if (typeof settings.downloads !== 'boolean') refuse('`downloads` must be true or false.');
  const scale = settings.png_scale;
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale < 1 || scale > 4) {
    refuse('`png_scale` must be a number from 1 to 4: image pixels per CSS pixel.');
  }
}

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Fills the placeholders of a template with text.
 * @param {string} template Text with placeholders, `{name}`.
 * @param {object} values The text of each placeholder, by name. A number is
 *   written as it reads; null or undefined is written as nothing.
 * @returns {string} The text, with every placeholder whose name is in `values`
 *   replaced, and every other left as written.
 */
export function fillText(template, values = {}) {
  return fillParts(template, values)
    .map((part) => part.text)
    .join('');
}

/**
 * A template filled, as its runs of text: what was written, and each
 * placeholder's value as a run of its own, so a page can set a value apart (its
 * direction isolated, as a `<bdi>` does) without reading it as markup.
 * @param {string} template Text with placeholders, `{name}`.
 * @param {object} values The text of each placeholder, by name.
 * @returns {Array<{text: string, value: boolean}>} The runs, empty ones left out.
 */
export function fillParts(template, values = {}) {
  const text = String(template);
  const parts = [];
  const push = (piece, value) => {
    if (piece === '') return;
    const last = parts[parts.length - 1];
    if (!value && last && !last.value) last.text += piece;
    else parts.push({ text: piece, value });
  };
  let at = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    push(text.slice(at, match.index), false);
    const [written, name] = match;
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      const value = values[name];
      push(value === null || value === undefined ? '' : String(value), true);
    } else push(written, false);
    at = match.index + written.length;
  }
  push(text.slice(at), false);
  return parts;
}

/**
 * The placeholders a template names, each once, in the order written.
 * @param {string} template
 * @returns {string[]}
 */
export const placeholdersIn = (template) => [
  ...new Set([...String(template).matchAll(PLACEHOLDER)].map((match) => match[1]))
];

/**
 * Checks `title`, `subtitle` and `footnotes`, and writes `footnotes` as a list.
 * @param {object} settings The settings, laid over the defaults. Changed in place.
 */
export function checkTitles(settings) {
  for (const key of ['title', 'subtitle']) {
    if (settings[key] !== null && typeof settings[key] !== 'string') {
      refuse(`\`${key}\` must be text, which may hold placeholders such as {n}, or null for none.`);
    }
  }
  const { footnotes } = settings;
  if (footnotes === null) return;
  const list = Array.isArray(footnotes) ? footnotes : [footnotes];
  if (!list.every((entry) => typeof entry === 'string')) {
    refuse('`footnotes` must be text, or a list of texts, or null for none.');
  }
  settings.footnotes = list.filter((entry) => entry.trim() !== '');
}

// ---- The footnote the chart writes ---------------------------------------------

/** What the footnote says of a chart that asked R nothing. */
export const NOTHING_ASKED = 'No statistic was asked of R.';
/** What it says while an answer is on its way. */
export const STILL_WAITING = 'Statistics: waiting for R.';

/**
 * The date a chart was drawn, as the footnote writes it: ISO 8601, in UTC.
 * @param {Date} [when]
 * @returns {string}
 */
export const dateDrawn = (when = new Date()) => when.toISOString().slice(0, 10);

// A count as R returned it: a number, or the text of one.
const countOf = (count) => {
  if (typeof count === 'number') return Number.isFinite(count) ? count : null;
  if (typeof count === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(count)) return Number(count);
  return null;
};

/**
 * R's counts, as the footnote writes them: `n = 200` for one; `Placebo n = 95,
 * Treatment n = 91` for up to four groups; and for more, the smallest and the
 * largest with how many there are, `n = 179 to 186 across 12 biomarkers`.
 * @param {number|object} counts What R returned as `counts`.
 * @param {string} [of] What the counts are of, for many: `'biomarkers'`.
 * @returns {?string} The counts, or null when R returned none.
 */
export function countsText(counts, of = 'groups') {
  const one = countOf(counts);
  if (one !== null) return `n = ${one}`;
  if (counts === null || typeof counts !== 'object' || Array.isArray(counts)) return null;
  const entries = [];
  for (const [group, count] of Object.entries(counts)) {
    const read = countOf(count);
    if (read !== null) entries.push([group, read]);
  }
  if (!entries.length) return null;
  if (entries.length <= 4)
    return entries.map(([group, count]) => `${group} n = ${count}`).join(', ');
  let least = Infinity;
  let most = -Infinity;
  for (const [, count] of entries) {
    if (count < least) least = count;
    if (count > most) most = count;
  }
  return `${least === most ? `n = ${least}` : `n = ${least} to ${most}`} across ${entries.length} ${of}`;
}

/** What R's names of p-value adjustments are called in words. */
export const ADJUSTMENT_NAMES = Object.freeze({
  BH: 'Benjamini-Hochberg',
  fdr: 'Benjamini-Hochberg',
  BY: 'Benjamini-Yekutieli',
  holm: 'Holm',
  hochberg: 'Hochberg',
  hommel: 'Hommel',
  bonferroni: 'Bonferroni'
});

// Every method R named in its answer, the answer's own first, then each part's
// (a pairwise test, a screen's rows), each once; and every adjustment of its
// p-values, in words.
function methodsOf(value) {
  const methods = [];
  const adjustments = [];
  const take = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    if (isText(entry.method) && !methods.includes(entry.method)) methods.push(entry.method);
    if (isText(entry.adjustment) && entry.adjustment !== 'none') {
      const said = ADJUSTMENT_NAMES[entry.adjustment] || entry.adjustment;
      if (!adjustments.includes(said)) adjustments.push(said);
    }
  };
  take(value);
  for (const list of Object.values(value)) {
    if (Array.isArray(list)) list.forEach(take);
  }
  return { methods, adjustments };
}

// Who answered, as the connection says: R started in this page; R on a server,
// with the R and gsm.bio versions the page was told answer there, the white
// space around each left out; or a result stored with the page, with those
// versions and the date that computed it when the page was told them; any
// other form, R.
function sourceText(answer) {
  if (answer.form === 'browser') return 'computed by R in this browser';
  if (answer.form === 'server') {
    const by = answer.computedBy;
    if (!by || !isText(by.r_version)) return 'computed by R on this server';
    const gsmBio = isText(by.gsm_bio_version) ? ` with gsm.bio ${by.gsm_bio_version.trim()}` : '';
    return `computed by R ${by.r_version.trim()}${gsmBio} on this server`;
  }
  if (answer.form !== 'precomputed') return 'computed by R';
  const by = answer.computedBy;
  if (!by || !isText(by.r_version)) return 'stored with the page';
  const gsmBio = isText(by.gsm_bio_version) ? ` with gsm.bio ${by.gsm_bio_version}` : '';
  const when =
    isText(by.computed_at) && /^\d{4}-\d{2}-\d{2}/.test(by.computed_at)
      ? ` on ${by.computed_at.slice(0, 10)}`
      : '';
  return `computed by R ${by.r_version}${gsmBio}${when}, stored with the page`;
}

// One answer: every method R used, its counts, and every adjustment.
function answerText(answer, of) {
  const value = answer.value && typeof answer.value === 'object' ? answer.value : {};
  const { methods, adjustments } = methodsOf(value);
  const [first, ...rest] = methods;
  const method = !first
    ? 'no statistic'
    : rest.length
      ? `${first}, with ${rest.join(' and ')}`
      : first;
  const counts = countsText(value.counts, of);
  return (
    (counts ? `${method} (${counts})` : method) +
    (adjustments.length ? `, p-values adjusted by ${adjustments.join(' and ')}` : '')
  );
}

/**
 * The footnote a chart writes last: when and by what it was drawn, and what
 * stands behind each statistic it printed.
 * @param {object} parts
 * @param {string} parts.date The date drawn, `dateDrawn()`.
 * @param {string} parts.version The bio.viz version, as it is said (`VERSION_SAID`).
 * @param {Array<{answer: ?object}>} parts.asked What the chart asked R, with
 *   each answer as the connection gave it, or null while it is on its way.
 * @param {string} [parts.of] What R's counts are of, when there are many.
 * @returns {string}
 */
export function automaticFootnote({ date, version, asked = [], of }) {
  const drawn = `Drawn on ${date} by bio.viz ${version}.`;
  if (!asked.length) return `${drawn} ${NOTHING_ASKED}`;
  if (asked.some((entry) => !entry.answer)) return `${drawn} ${STILL_WAITING}`;
  const answers = asked.map((entry) => entry.answer);
  const ok = answers.filter((answer) => answer.status === 'ok');
  if (!ok.length) {
    const failed = answers.find((answer) => answer.status === 'error');
    return failed
      ? `${drawn} Statistics: R reported an error.`
      : `${drawn} Statistics: unavailable, as the line under the chart says.`;
  }
  const sources = [...new Set(ok.map(sourceText))];
  const said = ok.map((answer) => answerText(answer, of)).join('; ');
  const missing = answers.length - ok.length;
  return (
    `${drawn} Statistics: ${said}; ${sources.join('; ')}.` +
    (missing ? ` ${missing} of ${answers.length} could not be computed.` : '')
  );
}
