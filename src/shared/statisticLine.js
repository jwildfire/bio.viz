// The statistics line every chart prints under what it draws, and the two rules
// that keep a wrong number from standing there:
//
//   - The line says it is waiting from the moment a result is asked for until
//     that result arrives.
//   - A result is shown only if nothing has been drawn since it was asked for.
//     Every render begins a new round, and an answer to an earlier round is
//     dropped when it arrives, however late.
//
// A chart computes none of what the line says. It chooses what to ask R for,
// hands R the rows it drew through the connection, and says how R's answer
// reads (its own `describe`); this file asks, waits and drops what is stale.
//
// Everything here is pure: no page and no chart.

export const WAITING = 'Statistics: waiting for R…';
export const NOT_STORED =
  'Statistics are unavailable for this view: the page holds no stored result for it, and no R ' +
  'is attached to compute one.';

/**
 * A line that holds one sentence and nothing R returned with it: waiting,
 * unavailable, nothing asked.
 * @param {string} state The state of the line.
 * @param {string} said The sentence.
 * @returns {{state: string, text: string, estimates: string[], remarks: Array, scope: ?string}}
 */
export const sentence = (state, said) => ({
  state,
  text: said,
  estimates: [],
  remarks: [],
  scope: null
});

// By Unicode code point, the order R's `sort(x, method = "radix")` puts text
// in. An order both languages produce without a locale, so a list written by R
// is the list written here.
function byCodePoint(a, b) {
  const [first, second] = [[...a], [...b]];
  const shared = Math.min(first.length, second.length);
  for (let index = 0; index < shared; index += 1) {
    const difference = first[index].codePointAt(0) - second[index].codePointAt(0);
    if (difference !== 0) return difference;
  }
  return first.length - second.length;
}

/** Distinct values as text, sorted by code point. */
export const sorted = (values) => [...new Set(values.map(String))].sort(byCodePoint);

/**
 * The filters in force, each as the list of values it lets through, as text,
 * sorted by code point. A filter set to all is not in force and is left out.
 * @param {object} [filters] What each filter is set to, by its column.
 * @returns {object} Column to list of values.
 */
export function filtersInForce(filters) {
  const inForce = {};
  for (const [column, selection] of Object.entries(filters || {})) {
    if (selection === null || selection === undefined || selection === '') continue;
    const values = Array.isArray(selection) ? selection : [selection];
    if (values.length) inForce[column] = sorted(values);
  }
  return inForce;
}

/** The filters in force, in words: `Filters: Sex is F; Response is Responder.` */
export function filtersSaid(filters) {
  if (!filters || !filters.length) return null;
  return `Filters: ${filters.map(({ label, values }) => `${label} is ${values.join(' or ')}`).join('; ')}.`;
}

const texts = (value) =>
  (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]).filter(
    (entry) => typeof entry === 'string' && entry.trim() !== ''
  );

/**
 * What R said about its answer, to print with it as R worded it: its warnings,
 * then the notes of the function that ran.
 * @param {object} value What R returned.
 * @returns {Array<{kind: string, text: string}>}
 */
export const remarksOf = (value) => [
  ...texts(value.warnings).map((said) => ({ kind: 'warning', text: `R warned: ${said}` })),
  ...texts(value.notes).map((said) => ({ kind: 'note', text: `R’s note: ${said}` }))
];

/**
 * What an answer that is not R's result reads as: no R answered, or R ran and
 * reported an error.
 * @param {object} result What `connection.run` resolved to, with a status other than `ok`.
 * @returns {{state: string, text: string}}
 */
export function failureOf(result) {
  if (result && result.status === 'unavailable') {
    return {
      state: 'unavailable',
      text: result.reason === 'not-precomputed' ? NOT_STORED : result.message
    };
  }
  const message = result && typeof result.message === 'string' ? result.message : 'no message';
  return { state: 'error', text: `R reported an error: ${message}` };
}

// The connections R has answered on, started in the browser or ahead of time
// but not from stored results: one that has needs no note about starting R.
const ANSWERED = new WeakSet();
const hasAnswered = (connection) =>
  connection !== null && typeof connection === 'object' && ANSWERED.has(connection);

/**
 * @param {object} parts
 * @param {{run: Function}} parts.connection The connection to R.
 * @param {?string} [parts.note] A sentence added to the waiting text until R
 *   has answered once: what starting R costs on this page.
 * @param {Function} parts.describe `(result, context)`: what one answer from
 *   the connection reads as on the chart's line.
 * @param {Function} [parts.waiting] `(text, context)`: the line while it waits.
 * @returns {{begin: Function, idle: Function, retire: Function}} `begin()`
 *   starts a round and ends every earlier one; the round's `ask(request, show,
 *   context)` asks R and calls `show(description)` at once with the waiting
 *   state, and again with the answer if the round is still the current one and
 *   the desk has not been retired. It resolves to whether the answer was shown.
 *   `idle(text)` is `text` with the note, for a line that is not asking.
 *   `retire()` ends every round for good: a chart calls it when it replaces the
 *   desk, so no answer to a question asked through it is ever shown.
 */
export function createDesk({
  connection,
  note = null,
  describe,
  waiting = (said) => sentence('waiting', said)
}) {
  let current = 0;
  let retired = false;
  // Whether R has answered on this connection: after that, starting it costs
  // nothing more. It is the connection's, not the desk's, so a chart opened in
  // place with the same connection does not say it again.
  const withNote = (said) => (note && !hasAnswered(connection) ? `${said} ${note}` : said);
  return {
    idle: withNote,
    retire() {
      retired = true;
    },
    begin() {
      current += 1;
      const round = current;
      // With several panels the note is said once, by the first that waits.
      let noted = false;
      return {
        ask({ name, data, args, dataId }, show, context) {
          show(waiting(noted ? WAITING : withNote(WAITING), context));
          noted = true;
          return connection.run(name, { data, args, dataId }).then((result) => {
            const ran = result && result.status === 'ok' && result.form !== 'precomputed';
            if (ran && connection !== null && typeof connection === 'object') {
              ANSWERED.add(connection);
            }
            if (retired || round !== current) return false;
            show(describe(result, context), result);
            return true;
          });
        }
      };
    }
  };
}
