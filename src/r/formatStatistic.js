// How a p-value is shown. The rules are the design's, written once here so that
// every chart prints a test result the same way:
//
//   - always with the method's name and the counts it used, never alone;
//   - labelled exploratory, and unadjusted unless an adjustment is named;
//   - no stars and no verdict: the text never says whether a result matters;
//   - where R declined to compute (a group too small), R's reason in place of a
//     number.
//
// This function formats what R returned. It computes nothing: no test, no
// adjustment, no interval. A value it cannot format honestly it refuses, with a
// sentence saying what is missing, rather than repairing it.
//
// It reads these members of a statistics result (the names gsm.bio's functions
// return):
//
//   method      the name of the test, e.g. "Wilcoxon rank-sum test"
//   p_value     a number from 0 to 1
//   counts      the counts used: one number, or an object of group -> number
//   adjustment  the name of the multiplicity adjustment applied, if any
//   reason      why no number was computed, if none was

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

const refused = (what) => ({ status: 'refused', text: `p-value not shown: ${what}.` });

/**
 * Formats one statistics result for printing on a chart.
 *
 * @param {{method?: string, p_value?: number, counts?: number|object,
 *   adjustment?: string, reason?: string}} statistic What an R statistics
 *   function returned.
 * @returns {{status: 'shown'|'withheld'|'refused', text: string}} `shown`: the
 *   p-value with its method, counts and label. `withheld`: R gave a reason
 *   instead of a number. `refused`: something the rules require is missing.
 */
export function formatStatistic(statistic) {
  const result = statistic && typeof statistic === 'object' ? statistic : {};
  const method = text(result.method);
  const counts = formatCounts(result.counts);
  const reason = text(result.reason);

  if (reason) {
    const lead = method ? `${method}: not computed, ${reason}` : `Not computed, ${reason}`;
    return { status: 'withheld', text: counts ? `${lead} (${counts}).` : `${lead}.` };
  }

  const p = result.p_value;
  if (typeof p !== 'number' || !(p >= 0 && p <= 1)) {
    return refused('the result has no p-value between 0 and 1');
  }
  if (!method) return refused('the result does not name its method');
  if (!counts) return refused('the result does not give the counts it used');

  const adjustment = text(result.adjustment);
  const label =
    adjustment && adjustment.toLowerCase() !== 'none'
      ? `Exploratory, adjusted (${adjustment}).`
      : 'Exploratory, unadjusted.';
  return { status: 'shown', text: `${method}: ${formatP(p)} (${counts}). ${label}` };
}
