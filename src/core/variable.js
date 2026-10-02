// A variable: what goes on an axis, makes a group, a colour or a panel. It is
// written one way wherever one is taken:
//
//   { measure: 'IL-6', visit: 'Week 4', value: 'change' }   a biomarker at a
//                                                           visit, with a
//                                                           value type
//   { col: 'ARM' }                                          a column
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
 * @returns {object} The variable, frozen: `{ kind: 'measure', measure, visit,
 *   value }` or `{ kind: 'column', col, type }`.
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
        `A variable takes ${KEYS.filter((key) => key !== 'cut').join(', ')}.`
    );
  }
  if (given(spec.cut)) {
    refuse(
      `the variable ${written} asks for a cut, and the cut rule is not available yet: it ` +
        'arrives with cross-tabulation. Until then a group comes from a column.'
    );
  }
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
    return Object.freeze({ kind: 'column', col: spec.col, type: spec.type ?? null });
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
    return Object.freeze({ kind: 'measure', measure: spec.measure, visit: null, value });
  }
  if (!isText(spec.visit)) {
    refuse(`the variable ${written} must name its visit: \`visit\` is missing or empty.`);
  }
  return Object.freeze({ kind: 'measure', measure: spec.measure, visit: spec.visit, value });
}

const WORDS = {
  change: 'change from baseline',
  fold_change: 'fold change from baseline',
  percent_change: 'percent change from baseline'
};

/**
 * A variable in words, for an axis title or a legend.
 *
 * @param {object} spec The variable.
 * @returns {string} `ARM`, `IL-6 at Week 4`, `IL-6 at baseline`,
 *   `IL-6 at Week 4, change from baseline`.
 */
export function label(spec) {
  const read = variable(spec);
  if (read.kind === 'column') return read.col;
  if (read.value === 'baseline') return `${read.measure} at baseline`;
  const at = `${read.measure} at ${read.visit}`;
  return read.value === 'raw' ? at : `${at}, ${WORDS[read.value]}`;
}
