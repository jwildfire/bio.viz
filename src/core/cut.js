// The shared cut rule: a continuous variable cut into groups. Every chart that
// makes groups from a number cuts it this way, so a biomarker cut at its median
// is the same two groups in the group comparison, the cross-tabulation and the
// survival chart, and the same in R:
//
//   points  <- unique(quantile(x, probs, type = 7, na.rm = TRUE, names = FALSE))
//   groups  <- cut(x, breaks = c(-Inf, points, Inf), right = TRUE)
//
// with probs 0.5 for the median, c(1, 2) / 3 for the tertiles and c(1, 2, 3) / 4
// for the quartiles, and typed points used as written. A value equal to a cut
// point falls in the lower group, a repeated point collapses, and a missing
// value is in no group.
//
// A cut point is a description of the values, like the median line of a box:
// nothing here tests, estimates or compares. The values are the chart's, one
// per participant, after its filters; the core's frame resolves them and this
// file cuts them. Pure functions: no page, no chart, no network.

/** The cuts a variable may name; typed points are a list of numbers instead. */
export const CUTS = Object.freeze(['median', 'tertiles', 'quartiles']);

// The probabilities of each cut, as R writes them.
const PROBS = { median: [0.5], tertiles: [1 / 3, 2 / 3], quartiles: [1 / 4, 2 / 4, 3 / 4] };

const isMissing = (value) => typeof value !== 'number' || !Number.isFinite(value);

// R's quantile(type = 7) of a sorted sample, step for step as R works it out,
// so the point is R's to the last binary place: the position is 1 + (n - 1)p,
// and between the two order statistics either side of it the point is
// (1 - h) times the lower plus h times the upper.
function quantile7(sorted, p) {
  const index = 1 + (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  const below = sorted[lo - 1];
  const above = sorted[hi - 1];
  if (!(index > lo) || above === below) return below;
  const h = index - lo;
  return (1 - h) * below + h * above;
}

// R's round-half-to-even, which signif() rounds with.
function roundHalfEven(value) {
  const floor = Math.floor(value);
  const rest = value - floor;
  if (rest > 0.5) return floor + 1;
  if (rest < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

// R's signif(x, digits), worked out as R works it out (src/nmath/fprec.c):
// scaled by a power of ten to `digits` whole digits, rounded half to even, and
// scaled back.
function signif(x, digits) {
  if (x === 0 || !Number.isFinite(x)) return x;
  const sign = x < 0 ? -1 : 1;
  const size = Math.abs(x);
  const e10 = digits - 1 - Math.floor(Math.log10(size));
  if (e10 > 0) {
    const scale = 10 ** e10;
    return (sign * roundHalfEven(size * scale)) / scale;
  }
  const scale = 10 ** -e10;
  return sign * roundHalfEven(size / scale) * scale;
}

/**
 * A cut point as a label writes it: four significant digits, as R's
 * `format(signif(p, 4), scientific = FALSE, trim = TRUE)` writes them.
 * @param {number} point A cut point.
 * @returns {string} The point in words: `2.783`, `0.00001234`, `123500`.
 * @private
 */
export function writePoint(point) {
  const rounded = signif(point, 4);
  // Zero has no sign in a label.
  const text = String(rounded === 0 ? 0 : rounded);
  if (!text.includes('e')) return text;
  // Very small or very large: written out in full, as R does.
  const e10 = 3 - Math.floor(Math.log10(Math.abs(rounded)));
  return e10 > 0 ? rounded.toFixed(e10) : rounded.toFixed(0);
}

/**
 * The labels of the groups a set of cut points makes, low to high, each with
 * its bounds: `≤ a`, then `> a, ≤ b` for each pair of points, then `> z`.
 * @param {number[]} points The cut points, ascending, each once.
 * @returns {string[]} One label per group: one more than there are points, or
 *   none when there is no point.
 */
export function cutLabels(points) {
  if (!points.length) return [];
  const bounds = points.map(writePoint);
  return [
    `≤ ${bounds[0]}`,
    ...bounds.slice(1).map((bound, index) => `> ${bounds[index]}, ≤ ${bound}`),
    `> ${bounds[bounds.length - 1]}`
  ];
}

/**
 * The cut points of a variable's values, and the groups they make.
 *
 * @param {Array<?number>} values One value per participant; a value that is not
 *   a finite number is missing and is left out.
 * @param {string|number[]} cut `median`, `tertiles` or `quartiles`, or the cut
 *   points as typed, in ascending order.
 * @returns {{cut: (string|number[]), n: number, asked: number[], points: number[],
 *   repeated: boolean, labels: string[]}} The cut; how many values it was worked
 *   out on; the points asked for, as R's quantile() gives them or as typed; the
 *   points used, each once, ascending; whether a point repeated and collapsed;
 *   and the label of each group, low to high. With no value there are no points
 *   and no groups.
 */
export function cutPoints(values, cut) {
  const present = values.filter((value) => !isMissing(value)).sort((a, b) => a - b);
  const typed = Array.isArray(cut);
  let asked;
  if (typed) asked = [...cut];
  else asked = present.length ? PROBS[cut].map((p) => quantile7(present, p)) : [];
  const points = asked.filter((point, index) => asked.indexOf(point) === index);
  return {
    cut: typed ? [...cut] : cut,
    n: present.length,
    asked,
    points,
    repeated: points.length < asked.length,
    labels: cutLabels(points)
  };
}

/**
 * The group a value falls in: R's `cut(x, breaks = c(-Inf, points, Inf),
 * right = TRUE)`. The groups are counted from 0, low to high, and a value equal
 * to a cut point is in the group below it.
 * @param {?number} value A participant's value.
 * @param {number[]} points The cut points, ascending, each once.
 * @returns {?number} The group's place among the labels, or null for a missing
 *   value.
 */
export function cutGroup(value, points) {
  if (isMissing(value)) return null;
  return points.filter((point) => point < value).length;
}
