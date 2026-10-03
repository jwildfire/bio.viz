// A cut variable as a chart takes it, and the sentence that says how it was
// cut. The rule itself, the points and the groups, is the core's
// (src/core/cut.js); every chart that makes groups from a cut variable writes it
// and says it the same way.
//
// Pure functions: no page and no chart.

import { cutGroup, cutPoints, writePoint } from '../core/cut.js';
import { frame } from '../core/frame.js';
import { label, variable } from '../core/variable.js';
import { coreSettings, isPlainObject, refuse } from './settings.js';

/**
 * A cut variable as the settings write one, and as it is written into the
 * identity of the rows R is handed: `{ measure, visit, value, cut }`, the
 * visit left out for a baseline value, or `{ col, type: 'number', cut }`.
 * @param {object} spec The variable, as written or as the core returned it.
 * @returns {object} The variable, written.
 */
export function writtenCut(spec) {
  const read = variable(spec);
  const cut = Array.isArray(read.cut) ? [...read.cut] : read.cut;
  if (read.kind === 'column') return { col: read.col, type: read.type, cut };
  return read.value === 'baseline'
    ? { measure: read.measure, value: read.value, cut }
    : { measure: read.measure, visit: read.visit, value: read.value, cut };
}

/**
 * Checks a setting that makes groups: the name of a column, null, or a cut
 * variable. A variable must carry a cut, because a number makes groups only
 * when it is cut.
 * @param {object} settings The settings, laid over the defaults.
 * @param {string} key The setting.
 */
export function checkGrouping(settings, key) {
  const value = settings[key];
  if (!isPlainObject(value)) return;
  if (value.cut === undefined || value.cut === null) {
    refuse(
      `\`${key}\` is a variable with no cut. A biomarker or a number makes groups only when it ` +
        "is cut: add `cut: 'median'`, 'tertiles', 'quartiles' or the cut points."
    );
  }
  settings[key] = writtenCut(value);
}

/** Whether a setting that makes groups holds a cut variable rather than a column. */
export const isCut = (by) => isPlainObject(by);

/**
 * The cut of one variable on a chart's tables: its value for each participant
 * the tables hold, one each, missing ones left out, and the points and groups
 * of the core's cut rule.
 * @param {{results: object[], participants: ?object[]}} tables The tables, as
 *   the filters leave them.
 * @param {object} spec The cut variable.
 * @param {object} settings The chart's settings.
 * @returns {object} The cut, as `cutPoints` gives it, with the variable as
 *   written (`spec`).
 */
export function cutOf({ results, participants }, spec, settings) {
  const made = frame(
    { results, participants: participants || undefined },
    { v: spec },
    { ...coreSettings(settings), required: [] }
  );
  return {
    spec: writtenCut(spec),
    ...cutPoints(
      made.data.map((record) => record.v),
      spec.cut
    )
  };
}

/**
 * The label of the group a value is in, or null for a missing value.
 * @param {?number} value A participant's value.
 * @param {object} cut The cut, as `cutOf` gives it.
 * @returns {?string} The group's label.
 */
export function groupLabel(value, cut) {
  const index = cutGroup(value, cut.points);
  return index === null ? null : cut.labels[index];
}

const listed = (items) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/**
 * How a variable was cut, in a sentence for the chart's footnote: the points,
 * how many values they were worked out on, whether repeated points collapsed
 * into fewer groups, and whether points written alike merged groups.
 * @param {object} spec The cut variable.
 * @param {object} cut The cut, as `cutPoints` or `cutOf` gives it.
 * @returns {string} The sentence.
 */
export function cutNote(spec, cut) {
  const plain = writtenCut(spec);
  delete plain.cut;
  const words = label(plain);
  // The points as the groups' labels write them.
  if (Array.isArray(cut.cut)) return `${words} is cut at ${listed(cut.points.map(writePoint))}.`;
  if (!cut.n) return `${words} has no value to cut, so it makes no groups.`;
  const asked = cut.asked.map(writePoint);
  const sentence =
    `${words} is cut at its ${cut.cut}, ${listed(asked)}, worked out on the ${cut.n} ` +
    `participant${cut.n === 1 ? '' : 's'} with a value.`;
  const said = [sentence];
  if (cut.repeated) {
    said.push(
      `The points repeat, so they make ${cut.points.length + 1} groups, not ` +
        `${cut.asked.length + 1}.`
    );
  }
  if (cut.merged) {
    said.push(
      'The points differ only past four significant digits, so groups with the same bounds ' +
        `are one, as R’s cut() makes them: ${cut.labels.length} groups, not ` +
        `${cut.points.length + 1}.`
    );
  }
  return said.join(' ');
}
