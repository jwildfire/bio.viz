// A variable: what goes on an axis, makes a group, a colour or a panel. It is
// written one way wherever one is taken:
//
//   { measure: 'IL-6', visit: 'Week 4', value: 'change' }   a biomarker at a
//                                                           visit, with a
//                                                           value type
//   { col: 'ARM' }                                          a column
//
// A number may also be cut into groups, with `cut`: the median, the tertiles,
// the quartiles, or typed points (src/core/cut.js).
//
//   { measure: 'CRP', visit: 'Baseline', cut: 'median' }
//   { col: 'AGE', type: 'number', cut: [40, 60] }
//
// `variable` checks one and returns it in full. A malformed one is refused with
// a message that names what is wrong, so the mistake is found where the
// variable was written and not in an empty chart.

/**
 * The value types of a biomarker at a visit.
 */
export const VALUE_TYPES = Object.freeze([
  'raw',
  'baseline',
  'change',
  'fold_change',
  'percent_change'
]);

import { CUTS, writePoint } from './cut.js';

const KEYS = ['measure', 'visit', 'value', 'col', 'type', 'cut'];

const isText = (value) => typeof value === 'string' && value.trim() !== '';
// A key counts as given unless it is absent or null, so a variable this
// function returned can be handed back to it.
const given = (value) => value !== undefined && value !== null;

const refuse = (message) => {
  throw new TypeError(`bio.viz: ${message}`);
};

/**
 * Checks a variable and returns it in full.
 *
 * @param {object} spec The variable as written: `{ measure, visit, value }`
 *   for a biomarker at a visit, or `{ col, type }` for a column.
 * @param {string} [spec.measure] The biomarker, as it is written in the
 *   results table.
 * @param {string} [spec.visit] The visit, as it is written in the results
 *   table. Not given with the value type `baseline`.
 * @param {string} [spec.value] The value type, one of VALUE_TYPES. `raw` when
 *   not given.
 * @param {string} [spec.col] The column, for a column variable.
 * @param {string} [spec.type] `number` to read a column as a number.
 * @param {string|number[]} [spec.cut] To cut the number into groups: `median`,
 *   `tertiles`, `quartiles`, or the cut points, ascending. A column cut must be
 *   read as a number.
 * @returns {object} The variable, frozen: `{ kind: 'measure', measure, visit,
 *   value }` or `{ kind: 'column', col, type }`, with `cut` when it has one.
 */
export function variable(spec) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    refuse(
      'a variable must be an object: { measure, visit, value } for a biomarker at a visit, or { col } for a column.'
    );
  }
  const written = JSON.stringify(spec);
  const unknown = Object.keys(spec).filter((key) => key !== 'kind' && !KEYS.includes(key));
  if (unknown.length) {
    refuse(
      `the variable ${written} has a key that is not known: ${unknown.join(', ')}. ` +
        `A variable takes ${KEYS.join(', ')}.`
    );
  }
  const cut = given(spec.cut) ? readCut(spec.cut, written) : null;
  // The variable in full, with its cut when it has one.
  const done = (read) => Object.freeze(cut === null ? read : { ...read, cut });
  const hasMeasure = given(spec.measure);
  const hasColumn = given(spec.col);
  if (hasMeasure === hasColumn) {
    refuse(
      `the variable ${written} must name a biomarker (\`measure\`) or a column (\`col\`), and ` +
        `it names ${hasMeasure ? 'both' : 'neither'}.`
    );
  }

  if (hasColumn) {
    if (!isText(spec.col)) refuse(`the variable ${written}: \`col\` must be the name of a column.`);
    for (const key of ['visit', 'value']) {
      if (given(spec[key])) {
        refuse(`the variable ${written} is a column, and a column takes no \`${key}\`.`);
      }
    }
    if (given(spec.type) && spec.type !== 'number') {
      refuse(
        `the variable ${written}: \`type\` can only be 'number', to read the column as a number.`
      );
    }
    if (cut !== null && spec.type !== 'number') {
      refuse(
        `the variable ${written} cuts a column, so it must be read as a number: add \`type: 'number'\`.`
      );
    }
    return done({ kind: 'column', col: spec.col, type: spec.type ?? null });
  }

  if (!isText(spec.measure)) {
    refuse(`the variable ${written}: \`measure\` must be the name of a biomarker.`);
  }
  if (given(spec.type)) {
    refuse(
      `the variable ${written} is a biomarker, which is always a number: it takes no \`type\`.`
    );
  }
  const value = spec.value ?? 'raw';
  if (!VALUE_TYPES.includes(value)) {
    refuse(
      `the variable ${written}: \`value\` must be one of ${VALUE_TYPES.join(', ')}, and it is ` +
        `${JSON.stringify(spec.value)}.`
    );
  }
  if (value === 'baseline') {
    if (given(spec.visit)) {
      refuse(
        `the variable ${written} is a baseline value, which is read at the baseline visits ` +
          'named in settings: it takes no `visit`.'
      );
    }
    return done({ kind: 'measure', measure: spec.measure, visit: null, value });
  }
  if (!isText(spec.visit)) {
    refuse(`the variable ${written} must name its visit: \`visit\` is missing or empty.`);
  }
  return done({ kind: 'measure', measure: spec.measure, visit: spec.visit, value });
}

// A cut as written: one of CUTS, or typed points, each a finite number and each
// greater than the one before. Typed points come back as a frozen copy.
function readCut(cut, written) {
  if (typeof cut === 'string' && CUTS.includes(cut)) return cut;
  if (!Array.isArray(cut)) {
    refuse(
      `the variable ${written}: \`cut\` must be ${CUTS.map((name) => `'${name}'`).join(', ')} ` +
        `or a list of cut points in ascending order, and it is ${JSON.stringify(cut)}.`
    );
  }
  if (!cut.length) {
    refuse(`the variable ${written}: \`cut\` is an empty list: give one cut point or more.`);
  }
  for (const point of cut) {
    if (typeof point !== 'number' || !Number.isFinite(point)) {
      refuse(
        `the variable ${written}: a cut point must be a finite number, and ` +
          `${JSON.stringify(point)} is not one.`
      );
    }
  }
  for (let index = 1; index < cut.length; index += 1) {
    if (!(cut[index] > cut[index - 1])) {
      refuse(
        `the variable ${written}: the cut points must be in ascending order, each greater than ` +
          `the one before: ${cut[index - 1]} then ${cut[index]}.`
      );
    }
  }
  return Object.freeze([...cut]);
}

const WORDS = {
  change: 'change from baseline',
  fold_change: 'fold change from baseline',
  percent_change: 'percent change from baseline'
};

// A list in words: `1`, `1 and 2`, `1, 2 and 3`.
const listed = (items) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/**
 * A cut in words: `cut at the median`, `cut at 2 and 5`.
 * @param {string|number[]} cut The cut, as a variable carries it.
 * @returns {string} The words.
 */
export function cutWords(cut) {
  return Array.isArray(cut) ? `cut at ${listed(cut.map(writePoint))}` : `cut at the ${cut}`;
}

/**
 * A variable in words, for an axis title or a legend.
 *
 * @param {object} spec The variable.
 * @returns {string} `ARM`, `IL-6 at Week 4`, `IL-6 at baseline`,
 *   `IL-6 at Week 4, change from baseline`, `CRP at Baseline, cut at the median`.
 */
export function label(spec) {
  const read = variable(spec);
  let words;
  if (read.kind === 'column') words = read.col;
  else if (read.value === 'baseline') words = `${read.measure} at baseline`;
  else {
    const at = `${read.measure} at ${read.visit}`;
    words = read.value === 'raw' ? at : `${at}, ${WORDS[read.value]}`;
  }
  return read.cut === undefined ? words : `${words}, ${cutWords(read.cut)}`;
}
