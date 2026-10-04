// Moving a cut line by hand. While a line is dragged the curves follow it at
// once; when it is dropped, the cut becomes typed points and R is asked again.
// A dropped line lands on the point its label writes: four significant digits,
// as the shared cut rule writes a bound, so the point in the settings, in the
// key R's stored result is found by, and on the label are one number.
//
// Pure functions: no page and no chart.

import { writePoint } from '../core/cut.js';

/**
 * The point a cut line dropped at `value` lands on: the value as the label of
 * its groups writes it, four significant digits.
 * @param {number} value Where the line was let go, on the variable's scale.
 * @returns {number} The point.
 */
export const dropPoint = (value) => Number(writePoint(value));

/**
 * The cut points after one of them is moved to `value`, or null when it cannot
 * go there: the points must stay in ascending order, and no two may be written
 * alike, or their groups could not be told apart.
 * @param {number[]} points The cut points, ascending.
 * @param {number} index Which point is moved.
 * @param {number} value Where it is moved to.
 * @param {{drop?: boolean}} [options] `drop`: the line is let go, so the point
 *   lands as its label writes it.
 * @returns {?number[]} The points.
 */
export function movePoints(points, index, value, { drop = false } = {}) {
  if (!Number.isFinite(value) || index < 0 || index >= points.length) return null;
  const point = drop ? dropPoint(value) : value;
  const below = index > 0 ? points[index - 1] : -Infinity;
  const above = index < points.length - 1 ? points[index + 1] : Infinity;
  if (!(point > below && point < above)) return null;
  const written = writePoint(point);
  if (
    (index > 0 && writePoint(below) === written) ||
    (index < points.length - 1 && writePoint(above) === written)
  ) {
    return null;
  }
  return points.map((each, i) => (i === index ? point : each));
}
