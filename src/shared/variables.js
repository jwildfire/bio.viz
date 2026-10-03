// A variable as a chart keeps it while its controls change, and the two ways it
// is written down: for the core, which resolves it to one value per
// participant, and for the settings, which is also how it is written into the
// identity of the rows R is handed.
//
// Pure functions: no page and no chart.

/**
 * An axis as the chart keeps it, from a variable as the settings write one.
 * @param {object} spec `{ measure, visit, value }` or `{ col }`.
 * @returns {object} `{ kind: 'measure', measure, value, visit }` or
 *   `{ kind: 'column', col }`. A baseline value has a visit of null.
 */
export function axisOf(spec) {
  if (spec.col !== undefined && spec.col !== null) return { kind: 'column', col: spec.col };
  const value = spec.value || 'raw';
  return {
    kind: 'measure',
    measure: spec.measure,
    value,
    visit: value === 'baseline' ? null : (spec.visit ?? null)
  };
}

/**
 * An axis as the core takes a variable. A column on an axis is read as a
 * number: a participant whose value is not one is left out, and counted.
 */
export function variableOf(axis) {
  if (axis.kind === 'column') return { col: axis.col, type: 'number' };
  return axis.value === 'baseline'
    ? { measure: axis.measure, value: 'baseline' }
    : { measure: axis.measure, visit: axis.visit, value: axis.value };
}

/**
 * An axis as the settings write a variable, the way `x` and `y` are given:
 * `{ measure, value, visit }` or `{ col }`.
 */
export function settingOf(axis) {
  if (axis.kind === 'column') return { col: axis.col };
  return {
    measure: axis.measure,
    value: axis.value,
    ...(axis.value === 'baseline' ? {} : { visit: axis.visit })
  };
}

/** Whether two axes are the same variable. */
export const sameAxis = (a, b) => JSON.stringify(settingOf(a)) === JSON.stringify(settingOf(b));
