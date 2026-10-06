// Which visits are unscheduled, and the results a chart is left with when it
// draws only the scheduled ones.
//
// The rule is safety.viz's, under safety.viz's setting names, so one mapping
// means the same in both libraries: a visit is unscheduled when it is named in
// `unscheduled_visit_values`, or, when no list is given, when its name matches
// `unscheduled_visit_pattern`.
//
// `parsePattern` and `isUnscheduledVisit` are copied from safety.viz's
// src/unscheduled-visits.js (`parseUnscheduledPattern`, `isUnscheduledVisit`)
// as it stands at safety.viz commit 096cc26d48e5d3cd1bf03eb78249658974c7a307,
// the commit of the bundle vendored in site/vendor/safety.viz/. safety.viz's
// kit does not share the rule, so bio.viz carries this copy. A unit test runs
// safety.viz's own two functions, read out of the vendored bundle, beside these
// and holds the answers equal, and holds the default pattern to the one in
// safety.viz's results over time chart (CORE-VISIT-002).
//
// It is here, in the core, because it decides which rows of the results table
// a chart reads, and R code that prepares the same chart (gsm.bio's widget)
// has to arrive at the same rows. A pattern is a JavaScript regular expression
// and R's are not quite the same, so a caller in R that must agree with the
// page names the visits in `unscheduled_visit_values`: a list is matched by
// name, and reads the same in both languages.
//
// Pure functions: no page, no chart, no network, nothing imported.

/**
 * The three settings of the rule, with safety.viz's names and the defaults of
 * safety.viz's results over time chart: unscheduled visits are left out, a
 * visit is unscheduled when its name holds `unscheduled` or `early
 * termination` in any case, and no visit is named outright.
 */
export const UNSCHEDULED_DEFAULTS = Object.freeze({
  unscheduled_visits: false,
  unscheduled_visit_pattern: '/unscheduled|early termination/i',
  unscheduled_visit_values: null
});

// A pattern written as text: `/source/flags`, or a plain source.
function parsePattern(pattern) {
  const match = /^\/(.*)\/([a-z]*)$/i.exec(String(pattern));
  return match ? new RegExp(match[1], match[2]) : new RegExp(String(pattern));
}

/**
 * Whether a visit is unscheduled. A list of names in
 * `unscheduled_visit_values` decides alone when there is one, an empty list
 * meaning no visit; otherwise the visit's name is tested against
 * `unscheduled_visit_pattern`, and with neither no visit is unscheduled.
 *
 * @param {string} visit The visit's name.
 * @param {object} [settings] The rule's settings; see UNSCHEDULED_DEFAULTS. A
 *   setting left out is not defaulted here: the chart's settings carry the
 *   defaults.
 * @param {?string} [settings.unscheduled_visit_pattern] A regular expression
 *   as text, `/source/flags` or a plain source.
 * @param {?string[]} [settings.unscheduled_visit_values] The unscheduled
 *   visits, by name.
 * @returns {boolean}
 */
export function isUnscheduledVisit(visit, settings = {}) {
  if (Array.isArray(settings.unscheduled_visit_values)) {
    return settings.unscheduled_visit_values.map(String).includes(String(visit));
  }
  if (settings.unscheduled_visit_pattern) {
    return parsePattern(settings.unscheduled_visit_pattern).test(String(visit));
  }
  return false;
}

const isBlank = (value) =>
  value === undefined ||
  value === null ||
  (typeof value === 'number' && Number.isNaN(value)) ||
  (typeof value === 'string' && value.trim() === '');

/**
 * The results a chart reads when it draws only scheduled visits, and what was
 * set aside: the rows at a visit the rule names are left out, whatever
 * `unscheduled_visits` says, which is the caller's switch to read.
 *
 * @param {object[]} results The results table.
 * @param {object} settings The visit column and the rule's settings.
 * @param {string} settings.visit_col The column that names the visit.
 * @param {?string} [settings.unscheduled_visit_pattern] As `isUnscheduledVisit` takes it.
 * @param {?string[]} [settings.unscheduled_visit_values] As `isUnscheduledVisit` takes it.
 * @returns {{results: object[], visits: string[], rows: number}} The rows at
 *   scheduled visits, in the table's order (the table itself when nothing is
 *   set aside); the names of the unscheduled visits found, in the order first
 *   seen; and how many rows were set aside. A row with no visit is kept.
 */
export function scheduledResults(results, settings) {
  const verdicts = new Map();
  const visits = [];
  const kept = [];
  for (const row of results) {
    const visit = row[settings.visit_col];
    if (isBlank(visit)) {
      kept.push(row);
      continue;
    }
    const name = String(visit);
    if (!verdicts.has(name)) {
      verdicts.set(name, isUnscheduledVisit(name, settings));
      if (verdicts.get(name)) visits.push(name);
    }
    if (!verdicts.get(name)) kept.push(row);
  }
  return visits.length
    ? { results: kept, visits, rows: results.length - kept.length }
    : { results, visits, rows: 0 };
}
