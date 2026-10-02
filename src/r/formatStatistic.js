// How a p-value is shown. The rules are the design's, written once here so that
// every chart prints a test result the same way:
//
//   - always with the method's name and the counts it used, never alone;
//   - labelled exploratory, and unadjusted unless an adjustment is named;
//   - no stars and no verdict: the text never says whether a result matters;
//   - where R declined to compute (a group too small), R's reason in place of a
//     number, said once.
//
// These functions format what R returned. They compute nothing: no test, no
// adjustment, no interval. A value they cannot format honestly they refuse,
// with a sentence saying what is missing, rather than repairing it.
//
// `formatStatistic` reads these members of a statistics result (the names
// gsm.bio's functions return):
//
//   status      "ok", "too_small" or "error"; absent is read as "ok"
//   method      the name of the test, e.g. "Wilcoxon rank-sum test"
//   p_value     a number from 0 to 1
//   counts      the counts used: one number, or an object of group -> number
//   adjustment  the name of the multiplicity adjustment applied, if any
//   reason      why no number was computed, if none was
//
// `formatEstimate` formats one row of a result's `estimates`, and
// `formatComparison` one row of its `rows` that compares two groups.

const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const isCount = (value) => Number.isInteger(value) && value >= 0;

function formatCounts(counts) {
  if (isCount(counts)) return `n = ${counts}`;
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return null;
  const groups = Object.entries(counts);
  if (groups.length === 0 || !groups.every(([, n]) => isCount(n))) return null;
  return groups.map(([group, n]) => (group === 'n' ? `n = ${n}` : `${group} n = ${n}`)).join(', ');
}

// Three decimals. Where that would print "0.000" or "1.000" the bound is
// printed instead, because a rounded number cannot claim either.
function formatP(p) {
  const rounded = p.toFixed(3);
  if (p < 0.001 || rounded === '0.000') return 'p < 0.001';
  if (rounded === '1.000') return 'p > 0.999';
  return `p = ${rounded}`;
}

// The names R's p.adjust() gives its methods, as they are usually written. A
// name that is not one of them is printed as R gave it.
const ADJUSTMENTS = {
  holm: 'Holm',
  hochberg: 'Hochberg',
  hommel: 'Hommel',
  bonferroni: 'Bonferroni',
  BH: 'Benjamini-Hochberg',
  fdr: 'Benjamini-Hochberg',
  BY: 'Benjamini-Yekutieli'
};

// The adjustment by its usual name, or null when there was none.
function adjustmentName(adjustment) {
  const named = text(adjustment);
  if (!named || named.toLowerCase() === 'none') return null;
  return Object.hasOwn(ADJUSTMENTS, named) ? ADJUSTMENTS[named] : named;
}

const formatLabel = (adjustment) =>
  adjustment ? `Exploratory, adjusted (${adjustment}).` : 'Exploratory, unadjusted.';

const ENDS_A_SENTENCE = /[.!?]$/;
const SAYS_NOT_COMPUTED = /^not computed\b/i;

// After a sentence the counts are a sentence of their own; after anything else
// they are in brackets, and the full stop follows.
const withCounts = (lead, counts) => {
  if (ENDS_A_SENTENCE.test(lead)) return counts ? `${lead} Counts: ${counts}.` : lead;
  return counts ? `${lead} (${counts}).` : `${lead}.`;
};

const refused = (what) => ({ status: 'refused', text: `p-value not shown: ${what}.` });

// The parts of one result, by the rules above. `formatStatistic` joins them
// into a sentence; `formatComparison` hands them over for a table.
function read(statistic) {
  const result = statistic && typeof statistic === 'object' ? statistic : {};
  const method = text(result.method);
  const counts = formatCounts(result.counts);
  const reason = text(result.reason);

  // R ran and could not answer: its own message, said to be one.
  if (result.status === 'error') {
    return {
      status: 'error',
      text: withCounts(`R reported an error: ${reason || 'no message'}`, counts)
    };
  }

  if (reason) {
    // A reason that already says nothing was computed is printed as it is. Any
    // other is led in by the method and these words, once.
    const lead = SAYS_NOT_COMPUTED.test(reason)
      ? reason
      : method
        ? `${method}: not computed, ${reason}`
        : `Not computed, ${reason}`;
    return { status: 'withheld', text: withCounts(lead, counts) };
  }

  const p = result.p_value;
  if (typeof p !== 'number' || !(p >= 0 && p <= 1)) {
    return refused('the result has no p-value between 0 and 1');
  }
  if (!method) return refused('the result does not name its method');
  if (!counts) return refused('the result does not give the counts it used');

  const adjustment = adjustmentName(result.adjustment);
  const label = formatLabel(adjustment);
  const shown = formatP(p);
  return {
    status: 'shown',
    text: `${method}: ${shown} (${counts}). ${label}`,
    method,
    p: shown,
    adjustment,
    label
  };
}

/**
 * Formats one statistics result for printing on a chart.
 *
 * @param {{status?: string, method?: string, p_value?: number, counts?: number|object,
 *   adjustment?: string, reason?: string}} statistic What an R statistics
 *   function returned.
 * @returns {{status: 'shown'|'withheld'|'error'|'refused', text: string}}
 *   `shown`: the p-value with its method, counts and label. `withheld`: R gave
 *   a reason instead of a number. `error`: R reported an error. `refused`:
 *   something the rules require is missing.
 */
export function formatStatistic(statistic) {
  const { status, text: sentence } = read(statistic);
  return { status, text: sentence };
}

// A number for reading: four significant figures, without trailing zeros.
const figure = (value) => String(Number(value.toPrecision(4)));
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Formats one estimate R returned: one row of a result's `estimates`. The
 * numbers are printed to four significant figures and are otherwise R's: the
 * estimate, and its interval with the level R computed it at when R gave one.
 *
 * @param {{name?: string, group?: string, estimate?: number, lower?: number,
 *   upper?: number, level?: number}} estimate One row of `estimates`.
 * @returns {{status: 'shown'|'refused', text: string}} `shown`: the estimate
 *   with its name, what it is an estimate of, and its interval. `refused`: it
 *   has no name, no number, or half an interval.
 */
export function formatEstimate(estimate) {
  const row = estimate && typeof estimate === 'object' ? estimate : {};
  const refuse = (what) => ({ status: 'refused', text: `Estimate not shown: ${what}.` });
  const name = text(row.name);
  if (!name) return refuse('it has no name');
  if (!isNumber(row.estimate)) return refuse(`${name} is not a number`);
  const group = text(row.group);
  const lead = `${name}${group ? ` (${group})` : ''}: ${figure(row.estimate)}`;

  const bounds = [row.lower, row.upper, row.level];
  const absent = (value) => value === undefined || value === null;
  if (bounds.every(absent)) return { status: 'shown', text: `${lead}.` };
  if (!bounds.every(isNumber) || !(row.level > 0 && row.level < 1)) {
    return refuse(`the interval of ${name} is incomplete`);
  }
  // 0.95 is printed as 95%. The rounding removes what the multiplication adds
  // in the last binary place, and nothing else.
  const percent = Number((row.level * 100).toPrecision(12));
  return {
    status: 'shown',
    text: `${lead}, ${percent}% confidence interval ${figure(row.lower)} to ${figure(row.upper)}.`
  };
}

/**
 * Formats one comparison of two groups from a result's `rows`, by the rules a
 * whole result is held to: its p-value is given only with its method, the two
 * groups' counts and its label.
 *
 * @param {{group_1?: string, group_2?: string, n_1?: number, n_2?: number,
 *   method?: string, p_value?: number, adjustment?: string, status?: string,
 *   reason?: string}} comparison One row of `rows`: a pairwise comparison.
 * @returns {{status: 'shown'|'withheld'|'error'|'refused', text: string,
 *   result: string, groups: ?string[], n: ?number[], method: ?string,
 *   p: ?string, adjustment: ?string, label: ?string}} `text` is the whole
 *   sentence, and `result` the same without the pair's name. The parts are for
 *   a table: `groups` and `n` are the two groups and their counts; `method`,
 *   `p` and `label` are given only when `status` is `shown`, and `adjustment`
 *   is the adjustment's name, or null when the p-value is unadjusted.
 */
export function formatComparison(comparison) {
  const row = comparison && typeof comparison === 'object' ? comparison : {};
  const groups = [text(row.group_1), text(row.group_2)];
  const n = [row.n_1, row.n_2];
  const named = groups.every(Boolean);
  const counted = named && n.every(isCount);
  const parts = read({
    status: row.status,
    method: row.method,
    p_value: row.p_value,
    adjustment: row.adjustment,
    reason: row.reason,
    counts: counted ? { [groups[0]]: n[0], [groups[1]]: n[1] } : undefined
  });
  const pair = { groups: named ? groups : null, n: counted ? n : null };
  const shown = named && parts.status === 'shown';
  const result = named ? parts.text : refused('the comparison does not name its two groups').text;
  return {
    status: named ? parts.status : 'refused',
    text: named ? `${groups[0]} and ${groups[1]}: ${result}` : result,
    result,
    ...pair,
    method: shown ? parts.method : null,
    p: shown ? parts.p : null,
    adjustment: shown ? parts.adjustment : null,
    label: shown ? parts.label : null
  };
}
