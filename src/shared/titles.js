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

/* global __BIO_VIZ_VERSION__ */
/**
 * The library version the footnote names, fixed when the bundle is built
 * (scripts/build-lib.mjs) and in the unit tests (vitest.config.js). A script
 * that reads the source without either sees that it is unbuilt.
 */
export const VERSION = typeof __BIO_VIZ_VERSION__ === 'string' ? __BIO_VIZ_VERSION__ : 'unbuilt';

/** The settings every chart has for its title, subtitle and footnotes. */
export const TITLE_DEFAULTS = Object.freeze({ title: null, subtitle: null, footnotes: null });

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
  return String(template).replace(PLACEHOLDER, (written, name) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) return written;
    const value = values[name];
    return value === null || value === undefined ? '' : String(value);
  });
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

const named = (count) => (Number.isFinite(count) ? String(count) : null);

/**
 * R's counts, as the footnote writes them: `n = 200` for one; `Placebo n = 95,
 * Treatment n = 91` for up to four groups; and for more, the smallest and the
 * largest with how many there are, `n = 179 to 186 across 12 biomarkers`.
 * @param {number|object} counts What R returned as `counts`.
 * @param {string} [of] What the counts are of, for many: `'biomarkers'`.
 * @returns {?string} The counts, or null when R returned none.
 */
export function countsText(counts, of = 'groups') {
  if (Number.isFinite(counts)) return `n = ${counts}`;
  if (counts === null || typeof counts !== 'object' || Array.isArray(counts)) return null;
  const entries = Object.entries(counts).filter(([, count]) => named(count) !== null);
  if (!entries.length) return null;
  if (entries.length <= 4)
    return entries.map(([group, count]) => `${group} n = ${count}`).join(', ');
  const all = entries.map(([, count]) => count);
  const [least, most] = [Math.min(...all), Math.max(...all)];
  return `${least === most ? `n = ${least}` : `n = ${least} to ${most}`} across ${entries.length} ${of}`;
}

// Who answered: R in the page, or R ahead of time, with its versions when the
// page was told them.
function sourceText(answer) {
  if (answer.form !== 'precomputed') return 'computed by R in this browser';
  const by = answer.computedBy;
  if (by && isText(by.r_version) && isText(by.gsm_bio_version)) {
    return `computed by R ${by.r_version} with gsm.bio ${by.gsm_bio_version}, stored with the page`;
  }
  if (by && isText(by.r_version)) return `computed by R ${by.r_version}, stored with the page`;
  return 'stored with the page';
}

// One answer: R's method and its counts.
function answerText(answer, of) {
  const value = answer.value && typeof answer.value === 'object' ? answer.value : {};
  const method = isText(value.method) ? value.method : 'no statistic';
  const counts = countsText(value.counts, of);
  return counts ? `${method} (${counts})` : method;
}

/**
 * The footnote a chart writes last: when and by what it was drawn, and what
 * stands behind each statistic it printed.
 * @param {object} parts
 * @param {string} parts.date The date drawn, `dateDrawn()`.
 * @param {string} parts.version The bio.viz version.
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
