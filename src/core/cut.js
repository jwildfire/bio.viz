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

// R's round-half-to-even, which signif() rounds with (C's nearbyint).
function roundHalfEven(value) {
  const floor = Math.floor(value);
  const rest = value - floor;
  if (rest > 0.5) return floor + 1;
  if (rest < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

// R's R_pow_di(x, n): x to a whole power by repeated squaring, as R works it
// out, so a power of ten past 1e22, which no double holds exactly, is R's to
// the last binary place.
function powDi(x, n) {
  let base = x;
  let power = 1;
  let left = Math.abs(n);
  for (;;) {
    if (left % 2 === 1) power *= base;
    left = Math.floor(left / 2);
    if (left === 0) break;
    base *= base;
  }
  return n < 0 ? 1 / power : power;
}

// The largest power of ten a double holds (DBL_MAX_10_EXP).
const MAX10E = 308;

// R's signif(x, digits), worked out as R works it out (fprec() in
// src/nmath/fprec.c): scaled by a power of ten to `digits` whole digits,
// rounded half to even, and scaled back.
function signif(x, digits) {
  if (x === 0 || !Number.isFinite(x)) return x;
  const sign = x < 0 ? -1 : 1;
  const size = Math.abs(x);
  const l10 = Math.log10(size);
  let e10 = digits - 1 - Math.floor(l10);
  if (Math.abs(l10) < MAX10E - 2) {
    let p10 = 1;
    if (e10 > MAX10E) {
      p10 = powDi(10, e10 - MAX10E);
      e10 = MAX10E;
    }
    if (e10 > 0) {
      const scale = powDi(10, e10);
      return (sign * (roundHalfEven(size * scale * p10) / scale)) / p10;
    }
    const scale = powDi(10, -e10);
    return sign * (roundHalfEven(size / scale) * scale);
  }
  // Next to the largest and the smallest doubles.
  const e2 = digits + (e10 > 0 ? 1 : 6);
  const p10 = powDi(10, e2);
  const P10 = powDi(10, e10 - e2);
  let scaled = size * p10 * P10;
  if (MAX10E - l10 >= powDi(10, -digits)) scaled += 0.5;
  return (sign * (Math.floor(scaled) / p10)) / P10;
}

/**
 * A cut point as a label writes it: four significant digits, as R's
 * `format(signif(p, 4), scientific = FALSE, trim = TRUE)` writes them, in
 * full however small or large, with no trailing zero.
 * @param {number} point A cut point.
 * @returns {string} The point in words: `2.783`, `0.00001234`, `123500`,
 *   `0.000000000000000111`, `3382000000000000000000`.
 * @private
 */
export function writePoint(point) {
  let rounded = signif(point, 4);
  // Past the doubles R's rounding works on, the point as it is.
  if (!Number.isFinite(rounded)) rounded = point;
  // Zero has no sign in a label.
  if (rounded === 0) return '0';
  const sign = rounded < 0 ? '-' : '';
  const size = Math.abs(rounded);
  // A whole number is written to its last digit, as R's sprintf("%.0f") does:
  // past 2^53 those are the double's own digits, not the four asked for.
  if (Number.isInteger(size)) return sign + BigInt(size).toString();
  // Otherwise its four significant digits, the trailing zeros dropped, written
  // out with the decimal point in its place.
  const [mantissa, exponent] = size.toExponential(3).split('e');
  const digits = mantissa.replace('.', '').replace(/0+$/, '');
  const place = Number(exponent) + 1;
  if (place <= 0) return `${sign}0.${'0'.repeat(-place)}${digits}`;
  if (place >= digits.length) return sign + digits + '0'.repeat(place - digits.length);
  return `${sign}${digits.slice(0, place)}.${digits.slice(place)}`;
}

// The label of each group the points make, low to high: one more than there
// are points. Distinct points written alike give two groups the same label.
function boundLabels(points) {
  if (!points.length) return [];
  const bounds = points.map(writePoint);
  return [
    `≤ ${bounds[0]}`,
    ...bounds.slice(1).map((bound, index) => `> ${bounds[index]}, ≤ ${bound}`),
    `> ${bounds[bounds.length - 1]}`
  ];
}

/**
 * The labels of the groups a set of cut points makes, low to high, each with
 * its bounds: `≤ a`, then `> a, ≤ b` for each pair of points, then `> z`. Two
 * points that are written alike to four significant digits make groups with the
 * same label, and those groups are one, as R's `cut()` merges levels with the
 * same label.
 * @param {number[]} points The cut points, ascending, each once.
 * @returns {string[]} One label per group: one more than there are points,
 *   fewer where groups merge, or none when there is no point.
 */
export function cutLabels(points) {
  return [...new Set(boundLabels(points))];
}

/**
 * The cut points of a variable's values, and the groups they make.
 *
 * @param {Array<?number>} values One value per participant; a value that is not
 *   a finite number is missing and is left out.
 * @param {string|number[]} cut `median`, `tertiles` or `quartiles`, or the cut
 *   points as typed, in ascending order.
 * @returns {{cut: (string|number[]), n: number, asked: number[], points: number[],
 *   repeated: boolean, merged: boolean, labels: string[]}} The cut; how many
 *   values it was worked out on; the points asked for, as R's quantile() gives
 *   them or as typed; the points used, each once, ascending; whether a point
 *   repeated and collapsed; whether points written alike merged groups; and the
 *   label of each group, low to high. With no value there are no points
 *   and no groups.
 */
export function cutPoints(values, cut) {
  const present = values.filter((value) => !isMissing(value)).sort((a, b) => a - b);
  const typed = Array.isArray(cut);
  let asked;
  if (typed) asked = [...cut];
  else asked = present.length ? PROBS[cut].map((p) => quantile7(present, p)) : [];
  const points = asked.filter((point, index) => asked.indexOf(point) === index);
  const labels = cutLabels(points);
  return {
    cut: typed ? [...cut] : cut,
    n: present.length,
    asked,
    points,
    repeated: points.length < asked.length,
    merged: points.length > 0 && labels.length < points.length + 1,
    labels
  };
}

/**
 * The group a value falls in: R's `cut(x, breaks = c(-Inf, points, Inf),
 * right = TRUE)`. The groups are counted from 0, low to high, and a value equal
 * to a cut point is in the group below it.
 * @param {?number} value A participant's value.
 * @param {number[]} points The cut points, ascending, each once.
 * @returns {?number} The group's place among the labels `cutLabels` gives, or
 *   null for a missing value.
 */
export function cutGroup(value, points) {
  if (isMissing(value)) return null;
  const labels = boundLabels(points);
  // Groups with the same label are one: the place among the labels kept.
  return cutLabels(points).indexOf(labels[points.filter((point) => point < value).length]);
}
