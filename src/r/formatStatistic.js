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
//   method      the name of the test as R wrote it, printed as it is,
//               e.g. "Wilcoxon rank sum test with continuity correction"
//   p_value     a number from 0 to 1
//   counts      the counts used: one number, or an object of group -> number
//   adjustment  the name of the multiplicity adjustment applied, if any
//   reason      why no number was computed, if none was
//
// `formatEstimate` formats one row of a result's `estimates`,
// `formatComparison` one row of its `rows` that compares two groups,
// `formatGroup` one row of its `rows` that is one group's own result, and
// `formatPair` one row that is one pair of variables in a correlation matrix,
// `formatScreenRow` one row of a biomarker screen, `formatLevel` one row that
// is the group test at one level of a column, a visit say, and `formatCell`
// one row that is one cell of a difference grid, which has no p-value.

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

// A number or an infinity R gave: R's Inf and -Inf, as fisher.test() gives
// for the odds ratio of a table with an empty cell. Not-a-number is neither.
const isNumberOrInfinite = (value) => isNumber(value) || value === Infinity || value === -Infinity;

// A bound as printed: its four figures, or the infinity R gave.
const bound = (value) => {
  if (value === Infinity) return 'infinity';
  if (value === -Infinity) return 'minus infinity';
  return figure(value);
};

/**
 * Formats one estimate R returned: one row of a result's `estimates`. The
 * numbers are printed to four significant figures and are otherwise R's: the
 * estimate, and its interval with the level R computed it at when R gave one.
 * An infinite estimate or bound, as R gives the odds ratio of a two-by-two
 * table with an empty cell, is printed in words: `infinite` (or `minus
 * infinity`) for the estimate, `infinity` for a bound, the finite bound as it
 * is.
 *
 * @param {{name?: string, group?: string, estimate?: number, lower?: number,
 *   upper?: number, level?: number}} estimate One row of `estimates`.
 * @returns {{status: 'shown'|'refused', text: string}} `shown`: the estimate
 *   with its name, what it is an estimate of, and its interval. `refused`: it
 *   has no name, no number (not-a-number among them), or half an interval.
 */
export function formatEstimate(estimate) {
  const row = estimate && typeof estimate === 'object' ? estimate : {};
  const refuse = (what) => ({ status: 'refused', text: `Estimate not shown: ${what}.` });
  const name = text(row.name);
  if (!name) return refuse('it has no name');
  if (!isNumberOrInfinite(row.estimate)) return refuse(`${name} is not a number`);
  const group = text(row.group);
  const said = row.estimate === Infinity ? 'infinite' : bound(row.estimate);
  const lead = `${name}${group ? ` (${group})` : ''}: ${said}`;

  const bounds = [row.lower, row.upper, row.level];
  const absent = (value) => value === undefined || value === null;
  if (bounds.every(absent)) return { status: 'shown', text: `${lead}.` };
  if (
    !isNumberOrInfinite(row.lower) ||
    !isNumberOrInfinite(row.upper) ||
    !isNumber(row.level) ||
    !(row.level > 0 && row.level < 1)
  ) {
    return refuse(`the interval of ${name} is incomplete`);
  }
  // 0.95 is printed as 95%. The rounding removes what the multiplication adds
  // in the last binary place, and nothing else.
  const percent = Number((row.level * 100).toPrecision(12));
  return {
    status: 'shown',
    text: `${lead}, ${percent}% confidence interval ${bound(row.lower)} to ${bound(row.upper)}.`
  };
}

/**
 * Formats one median survival time R returned, a row of `estimates` from
 * gsm.bio's `Analyze_Survival`: the median, and its interval with its level. R
 * gives no median, or no bound, where the curve or its band did not fall to one
 * half; that part reads `not reached`, as R's note says. Nothing is computed.
 *
 * @param {{name?: string, group?: string, estimate?: ?number, lower?: ?number,
 *   upper?: ?number, level?: number}} estimate One row of `estimates`.
 * @returns {{status: 'shown'|'refused', text: string}} `shown`: the median,
 *   what it is a median of, and its interval, each part a number or `not
 *   reached`. `refused`: it has no name, a value that is neither a number nor
 *   missing, or no level.
 */
export function formatMedian(estimate) {
  const row = estimate && typeof estimate === 'object' ? estimate : {};
  const refuse = (what) => ({ status: 'refused', text: `Estimate not shown: ${what}.` });
  const name = text(row.name);
  if (!name) return refuse('it has no name');
  const absent = (value) => value === undefined || value === null;
  for (const part of ['estimate', 'lower', 'upper']) {
    if (!absent(row[part]) && !isNumber(row[part])) return refuse(`${name} is not a number`);
  }
  if (!(row.level > 0 && row.level < 1)) return refuse(`the interval of ${name} has no level`);
  const said = (value) => (absent(value) ? 'not reached' : figure(value));
  const group = text(row.group);
  const percent = Number((row.level * 100).toPrecision(12));
  const interval =
    absent(row.lower) && absent(row.upper)
      ? 'not reached'
      : `${said(row.lower)} to ${said(row.upper)}`;
  return {
    status: 'shown',
    text: `${name}${group ? ` (${group})` : ''}: ${said(row.estimate)}, ${percent}% confidence interval ${interval}.`
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

/**
 * Formats one group's result from a result's `rows`: an estimate R computed
 * within one group, such as a correlation coefficient in one arm, with its
 * interval, the group's count and its p-value. The p-value is held to the
 * rules a whole result is held to, and is handed over in parts for a table
 * only with its method, the count and its label.
 *
 * @param {{group?: string, counts?: number, estimate?: number, lower?: number,
 *   upper?: number, level?: number, method?: string, p_value?: number,
 *   adjustment?: string, status?: string, reason?: string}} row One row of
 *   `rows`: one group's result.
 * @returns {{status: 'shown'|'withheld'|'error'|'refused', text: string,
 *   result: string, group: ?string, n: ?number, estimate: ?string,
 *   interval: ?string, bounds: ?string, level: ?string, method: ?string,
 *   p: ?string, adjustment: ?string, label: ?string}} `text` is the whole
 *   sentence, and `result` the same without the group's name. The parts are
 *   for a table: `group` and `n` are the group and its count; `estimate` is
 *   the estimate as printed; `interval` is its interval in words with the
 *   level R computed it at, `bounds` the two ends alone and `level` the level
 *   alone, all three null where R gave no interval; `method`, `p` and `label`
 *   are given only when `status` is `shown`, and `adjustment` is the
 *   adjustment's name, or null when the p-value is unadjusted.
 */
export function formatGroup(row) {
  const given = row && typeof row === 'object' ? row : {};
  const group = text(given.group);
  const counted = isCount(given.counts);
  const none = {
    estimate: null,
    interval: null,
    bounds: null,
    level: null,
    method: null,
    p: null,
    adjustment: null
  };
  const whole = (status, result) => ({
    status,
    text: group ? `${group}: ${result}` : result,
    result,
    group,
    n: counted ? given.counts : null,
    ...none,
    label: null
  });
  if (!group) return whole('refused', refused('the row does not name its group').text);
  const parts = read({
    status: given.status,
    method: given.method,
    p_value: given.p_value,
    adjustment: given.adjustment,
    reason: given.reason,
    counts: counted ? given.counts : undefined
  });
  if (parts.status !== 'shown') return whole(parts.status, parts.text);

  // The estimate the p-value is of. A p-value with no estimate beside it, or
  // with half an interval, is not printed.
  const refuse = (what) => whole('refused', `Estimate not shown: ${what}.`);
  if (!isNumber(given.estimate)) return refuse('the group’s estimate is not a number');
  const bounds = [given.lower, given.upper, given.level];
  const absent = (value) => value === undefined || value === null;
  let ends = null;
  let level = null;
  if (!bounds.every(absent)) {
    if (!bounds.every(isNumber) || !(given.level > 0 && given.level < 1)) {
      return refuse('the interval of the group’s estimate is incomplete');
    }
    level = `${Number((given.level * 100).toPrecision(12))}%`;
    ends = `${figure(given.lower)} to ${figure(given.upper)}`;
  }
  const interval = ends ? `${level} confidence interval ${ends}` : null;
  const estimate = figure(given.estimate);
  const result = `${estimate}${interval ? `, ${interval}` : ''}. ${parts.text}`;
  return {
    status: 'shown',
    text: `${group}: ${result}`,
    result,
    group,
    n: given.counts,
    estimate,
    interval,
    bounds: ends,
    level,
    method: parts.method,
    p: parts.p,
    adjustment: parts.adjustment,
    label: parts.label
  };
}

/**
 * Formats one pair's result from a result's `rows`: a coefficient R computed
 * on the complete pairs of two variables, as one cell of a correlation matrix
 * holds it, with its interval and its pair count. A matrix reports no p-value,
 * and none is read or printed here.
 *
 * @param {{x?: string, y?: string, counts?: number, estimate?: number,
 *   lower?: number, upper?: number, level?: number, status?: string,
 *   reason?: string}} row One row of `rows`: one pair of variables.
 * @returns {{status: 'shown'|'withheld'|'error'|'refused', text: string,
 *   pair: ?string[], n: ?number, estimate: ?string, interval: ?string,
 *   bounds: ?string, level: ?string}} `text` is the sentence, without the
 *   pair's names. The parts are for a table or a cell: `pair` is the two
 *   variables as R named them, and `n` the number of complete pairs;
 *   `estimate` is the coefficient as printed; `interval` is its interval in
 *   words with the level R computed it at, `bounds` the two ends alone and
 *   `level` the level alone, all three null where R gave no interval. The
 *   estimate and its interval are given only when `status` is `shown`.
 */
export function formatPair(row) {
  const given = row && typeof row === 'object' ? row : {};
  const names = [text(given.x), text(given.y)];
  const pair = names.every(Boolean) ? names : null;
  const counted = isCount(given.counts);
  const whole = (status, said) => ({
    status,
    text: said,
    pair,
    n: counted ? given.counts : null,
    estimate: null,
    interval: null,
    bounds: null,
    level: null
  });
  const refuse = (what) => whole('refused', `Estimate not shown: ${what}.`);
  if (!pair) return refuse('the row does not name its two variables');
  const counts = counted ? `n = ${given.counts}` : null;
  const reason = text(given.reason);
  if (given.status === 'error') {
    return whole('error', withCounts(`R reported an error: ${reason || 'no message'}`, counts));
  }
  // Too few complete pairs, or anything else R gave a reason for: R's words.
  if (reason) {
    return whole(
      'withheld',
      withCounts(SAYS_NOT_COMPUTED.test(reason) ? reason : `Not computed, ${reason}`, counts)
    );
  }
  if (!counted) return refuse('the pair does not give the number of complete pairs it used');
  if (!isNumber(given.estimate)) return refuse('the pair’s estimate is not a number');
  const bounds = [given.lower, given.upper, given.level];
  const absent = (value) => value === undefined || value === null;
  let ends = null;
  let level = null;
  if (!bounds.every(absent)) {
    if (!bounds.every(isNumber) || !(given.level > 0 && given.level < 1)) {
      return refuse('the interval of the pair’s estimate is incomplete');
    }
    level = `${Number((given.level * 100).toPrecision(12))}%`;
    ends = `${figure(given.lower)} to ${figure(given.upper)}`;
  }
  const interval = ends ? `${level} confidence interval ${ends}` : null;
  const estimate = figure(given.estimate);
  return {
    status: 'shown',
    text: `${estimate}${interval ? `, ${interval}` : ''} (${counts}).`,
    pair,
    n: given.counts,
    estimate,
    interval,
    bounds: ends,
    level
  };
}

/**
 * Formats one row of a biomarker screen's `rows`: one biomarker's estimate, a
 * standardised difference or a coefficient, with its interval, the counts it
 * used, and its p-value twice: as R computed it, unadjusted, and as R adjusted
 * it across the rows that have one, with the adjustment by name. Both are held
 * to the rules a whole result is held to: never without the method, the counts
 * and the label.
 *
 * @param {{biomarker?: string, counts?: number, n_1?: number, n_2?: number,
 *   estimate?: number, lower?: number, upper?: number, level?: number,
 *   method?: string, p_unadjusted?: number, p_value?: number,
 *   adjustment?: string, adjusted_over?: number, status?: string,
 *   reason?: string}} row One row of `rows`.
 * @param {string[]} [groups] For a difference, the two groups, first and
 *   second, so the counts can say whose they are.
 * @returns {{status: 'shown'|'withheld'|'error'|'refused', text: string,
 *   result: string, biomarker: ?string, n: ?string, estimate: ?string,
 *   interval: ?string, bounds: ?string, level: ?string, method: ?string,
 *   p: ?string, adjusted: ?string, adjustment: ?string, over: ?number,
 *   label: ?string}} `text` is the whole sentence, and `result` the same
 *   without the biomarker's name. The parts are for a table, given only when
 *   `status` is `shown`: `n` the counts in words; `estimate` as printed;
 *   `interval` in words with its level, `bounds` its two ends and `level` the
 *   level alone; `method`; `p` the unadjusted p-value and `adjusted` the
 *   adjusted one, as printed; `adjustment` the adjustment's name; `over` how
 *   many rows it was adjusted across; `label` the label both are under.
 */
export function formatScreenRow(row, groups = null) {
  const given = row && typeof row === 'object' ? row : {};
  const biomarker = text(given.biomarker);
  const named = Array.isArray(groups) && groups.length === 2 && groups.every(text);
  const twoCounts = named && isCount(given.n_1) && isCount(given.n_2);
  const counts = twoCounts
    ? { [groups[0]]: given.n_1, [groups[1]]: given.n_2 }
    : isCount(given.counts)
      ? given.counts
      : undefined;
  const n = formatCounts(counts);
  const none = {
    estimate: null,
    interval: null,
    bounds: null,
    level: null,
    method: null,
    p: null,
    adjusted: null,
    adjustment: null,
    over: null,
    label: null
  };
  const whole = (status, result) => ({
    status,
    text: biomarker ? `${biomarker}: ${result}` : result,
    result,
    biomarker,
    n,
    ...none
  });
  if (!biomarker) return whole('refused', refused('the row does not name its biomarker').text);
  // The p-value as R computed it, by the rules of a whole result: R's reason
  // where it computed none, R's error, or a refusal where something is missing.
  const raw = read({
    status: given.status,
    method: given.method,
    p_value: given.p_unadjusted,
    reason: given.reason,
    counts
  });
  if (raw.status !== 'shown') return whole(raw.status, raw.text);
  const refuse = (what) => whole('refused', `Row not shown: ${what}.`);
  const adjustment = adjustmentName(given.adjustment);
  if (!adjustment) return refuse('the row does not name the adjustment of its p-value');
  if (!isCount(given.adjusted_over) || given.adjusted_over < 1) {
    return refuse('the row does not say how many rows its p-value was adjusted across');
  }
  const p = given.p_value;
  if (typeof p !== 'number' || !(p >= 0 && p <= 1)) {
    return refuse('the adjusted p-value is not a number between 0 and 1');
  }
  if (!isNumber(given.estimate)) return refuse('the estimate is not a number');
  const bounds = [given.lower, given.upper, given.level];
  const absent = (value) => value === undefined || value === null;
  let ends = null;
  let level = null;
  if (!bounds.every(absent)) {
    if (!bounds.every(isNumber) || !(given.level > 0 && given.level < 1)) {
      return refuse('the interval of the estimate is incomplete');
    }
    level = `${Number((given.level * 100).toPrecision(12))}%`;
    ends = `${figure(given.lower)} to ${figure(given.upper)}`;
  }
  const interval = ends ? `${level} confidence interval ${ends}` : null;
  const estimate = figure(given.estimate);
  const adjusted = formatP(p);
  const label = formatLabel(adjustment);
  const over = given.adjusted_over;
  const result =
    `${estimate}${interval ? `, ${interval}` : ''}. ${raw.method}: ${raw.p} unadjusted, ` +
    `${adjusted} adjusted across ${over} biomarker${over === 1 ? '' : 's'} (${n}). ${label}`;
  return {
    status: 'shown',
    text: `${biomarker}: ${result}`,
    result,
    biomarker,
    n,
    estimate,
    interval,
    bounds: ends,
    level,
    method: raw.method,
    p: raw.p,
    adjusted,
    adjustment,
    over,
    label
  };
}

/**
 * Formats one level's result from a by-level answer's `rows`: the test of the
 * groups R ran on the rows of one level of a column, a visit say, as gsm.bio's
 * `Analyze_GroupDifferenceBy` returns it. The p-value is `p_value`, which R
 * adjusted across the levels that have one when it names an adjustment, and
 * is held to the rules a whole result is held to: never without the method,
 * each group's count and its label. Nothing is computed.
 *
 * @param {{by?: string, group_1?: string, n_1?: number, group_2?: string,
 *   n_2?: number, method?: string, p_unadjusted?: number, p_value?: number,
 *   adjustment?: string, adjusted_over?: number, status?: string,
 *   reason?: string}} row One row of `rows`: one level. It names its groups in
 *   `group_1`, `group_2` and so on, however many there are, with each one's
 *   count in `n_1`, `n_2` and so on.
 * @param {string} [of='level'] What a level is called, in the singular, where
 *   the sentence says how many the adjustment covered: `'visit'`.
 * @returns {{status: 'shown'|'withheld'|'error'|'refused', text: string,
 *   result: string, by: ?string, groups: ?string[], n: ?number[],
 *   method: ?string, p: ?string, unadjusted: ?string, adjustment: ?string,
 *   over: ?number, label: ?string}} `text` is the whole sentence, and `result`
 *   the same without the level's name. The parts are for a table: `by` is the
 *   level; `groups` and `n` are the groups and their counts; `method`, `p`,
 *   `unadjusted` and `label` are given only when `status` is `shown`: `p` is
 *   the p-value to print, R's `p_value`, and `unadjusted` the one R computed
 *   before any adjustment; `adjustment` is the adjustment's name, or null when
 *   the p-value is unadjusted, and `over` how many levels R adjusted across.
 */
export function formatLevel(row, of = 'level') {
  const given = row && typeof row === 'object' ? row : {};
  const by = text(given.by);
  const groups = [];
  const n = [];
  for (let at = 1; Object.hasOwn(given, `group_${at}`); at += 1) {
    groups.push(text(given[`group_${at}`]));
    n.push(given[`n_${at}`]);
  }
  const named = groups.length >= 2 && groups.every(Boolean);
  const counted = named && n.every(isCount);
  const none = { method: null, p: null, unadjusted: null, adjustment: null, over: null };
  const whole = (status, result) => ({
    status,
    text: by ? `${by}: ${result}` : result,
    result,
    by,
    groups: named ? groups : null,
    n: counted ? n : null,
    ...none,
    label: null
  });
  if (!by) return whole('refused', refused('the row does not name its level').text);
  if (!named) return whole('refused', refused('the row does not name its groups').text);
  const parts = read({
    status: given.status,
    method: given.method,
    p_value: given.p_value,
    adjustment: given.adjustment,
    reason: given.reason,
    counts: counted ? Object.fromEntries(groups.map((group, at) => [group, n[at]])) : undefined
  });
  if (parts.status !== 'shown') return whole(parts.status, parts.text);
  // The p-value R computed before any adjustment is printed beside an adjusted
  // one, so both must be there, and how many levels the adjustment covered.
  const raw = given.p_unadjusted;
  if (typeof raw !== 'number' || !(raw >= 0 && raw <= 1)) {
    return whole('refused', refused('the row has no unadjusted p-value between 0 and 1').text);
  }
  const unadjusted = formatP(raw);
  let result = parts.text;
  let over = null;
  if (parts.adjustment) {
    if (!isCount(given.adjusted_over) || given.adjusted_over < 1) {
      return whole(
        'refused',
        refused('the row does not say how many levels its p-value was adjusted across').text
      );
    }
    over = given.adjusted_over;
    const counts = formatCounts(Object.fromEntries(groups.map((group, at) => [group, n[at]])));
    result =
      `${parts.method}: ${unadjusted} unadjusted, ${parts.p} adjusted across ${over} ` +
      `${of}${over === 1 ? '' : 's'} (${counts}). ${parts.label}`;
  }
  return {
    status: 'shown',
    text: `${by}: ${result}`,
    result,
    by,
    groups,
    n,
    method: parts.method,
    p: parts.p,
    unadjusted,
    adjustment: parts.adjustment,
    over,
    label: parts.label
  };
}

// A number to two decimals with a true minus sign, and nought never written as
// minus nought: what a small cell of a grid has room for. The whole sentence
// beside it gives the number to four figures.
const twoDecimals = (value) => {
  const fixed = value.toFixed(2);
  return (fixed === '-0.00' ? '0.00' : fixed).replace('-', '−');
};

/**
 * Formats one cell of a difference grid: one row of the `rows` of gsm.bio's
 * `Analyze_DifferenceGrid`, the standardised difference between two groups for
 * one biomarker on the rows of one level of a column, a visit say. A cell has
 * an estimate with its interval and each group's count, and no p-value: the
 * grid tests nothing, so nothing here is held to the p-value rules, and no
 * verdict is given. Nothing is computed.
 *
 * @param {{biomarker?: string, by?: string, n_1?: number, n_2?: number,
 *   estimate?: number, lower?: number, upper?: number, level?: number,
 *   status?: string, reason?: string}} row One row of `rows`: one cell.
 * @param {object} of What the row does not say for itself.
 * @param {string[]} of.groups The two groups, first and second: the estimate
 *   is the first minus the second.
 * @param {string} [of.method] The estimate's name as R gave it for the whole
 *   answer, `Standardised difference (Hedges' g)`. A cell with an estimate is
 *   not shown without it.
 * @returns {{status: 'shown'|'withheld'|'error'|'refused', text: string,
 *   result: string, biomarker: ?string, by: ?string, groups: ?string[],
 *   n: ?number[], estimate: ?string, short: ?string, interval: ?string,
 *   bounds: ?string, level: ?string}} `text` is the whole sentence, led by the
 *   biomarker and the level, and `result` the same without them. The parts are
 *   for a grid: `groups` and `n` the two groups and their counts; and, only
 *   when `status` is `shown`, `estimate` to four figures, `short` the same
 *   number to two decimals for the cell, `interval` in words with its level,
 *   `bounds` its two ends and `level` the level alone.
 */
export function formatCell(row, of = {}) {
  const given = row && typeof row === 'object' ? row : {};
  const biomarker = text(given.biomarker);
  const by = text(given.by);
  const groups = Array.isArray(of.groups) ? of.groups.map(text) : [];
  const named = groups.length === 2 && groups.every(Boolean);
  const counted = named && isCount(given.n_1) && isCount(given.n_2);
  const n = counted ? [given.n_1, given.n_2] : null;
  const counts = counted ? formatCounts({ [groups[0]]: given.n_1, [groups[1]]: given.n_2 }) : null;
  const none = { estimate: null, short: null, interval: null, bounds: null, level: null };
  const where = biomarker && by ? `${biomarker} at ${by}: ` : '';
  const whole = (status, result) => ({
    status,
    text: `${where}${result}`,
    result,
    biomarker,
    by,
    groups: named ? groups : null,
    n,
    ...none
  });
  const refuse = (what) => whole('refused', `Cell not shown: ${what}.`);
  if (!biomarker) return refuse('the row does not name its biomarker');
  if (!by) return refuse('the row does not name its level');
  if (!named) return refuse('the two groups compared are not named');
  const reason = text(given.reason);
  if (given.status === 'error') {
    return whole('error', withCounts(`R reported an error: ${reason || 'no message'}`, counts));
  }
  // A group too small, or anything else R gave a reason for: R's words.
  if (reason) {
    return whole(
      'withheld',
      withCounts(SAYS_NOT_COMPUTED.test(reason) ? reason : `Not computed, ${reason}`, counts)
    );
  }
  const method = text(of.method);
  if (!method) return refuse('the answer does not name the estimate');
  if (!counted) return refuse('the row does not give each group’s count');
  if (!isNumber(given.estimate)) return refuse('the estimate is not a number');
  const bounds = [given.lower, given.upper, given.level];
  const absent = (value) => value === undefined || value === null;
  let ends = null;
  let level = null;
  if (!bounds.every(absent)) {
    if (!bounds.every(isNumber) || !(given.level > 0 && given.level < 1)) {
      return refuse('the interval of the estimate is incomplete');
    }
    level = `${Number((given.level * 100).toPrecision(12))}%`;
    ends = `${figure(given.lower)} to ${figure(given.upper)}`;
  }
  const interval = ends ? `${level} confidence interval ${ends}` : null;
  const estimate = figure(given.estimate);
  const result =
    `${method}, ${groups[0]} minus ${groups[1]}: ${estimate}` +
    `${interval ? `, ${interval}` : ''} (${counts}).`;
  return {
    status: 'shown',
    text: `${where}${result}`,
    result,
    biomarker,
    by,
    groups,
    n,
    estimate,
    short: twoDecimals(given.estimate),
    interval,
    bounds: ends,
    level
  };
}
