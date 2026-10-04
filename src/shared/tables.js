// What a chart's controls offer, read from the tables: the biomarkers, the
// visits, the columns that can make a group, the filters. And the one step
// every chart takes before a frame is made: the participants the filters keep.
//
// Pure functions: no page and no chart. Every chart reads its tables through
// these, so two charts on one page offer the same columns for the same tables.

import { visits as visitsInOrder } from '../core/frame.js';
import { coreSettings } from './settings.js';
import { byCodePoint } from './statisticLine.js';

export const isBlank = (value) =>
  value === undefined ||
  value === null ||
  (typeof value === 'number' && Number.isNaN(value)) ||
  (typeof value === 'string' && value.trim() === '');

export const naturally = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

/** Distinct values that are not blank, as text, sorted by name with numbers as numbers. */
export function levelsOf(values) {
  return [...new Set(values.filter((value) => !isBlank(value)).map(String))].sort(naturally);
}

// A text's parts: each run of the digits 0 to 9, and each run of anything else.
const partsOf = (text) => text.match(/[0-9]+|[^0-9]+/g) || [];
// The letters A to Z as a to z, and nothing else.
const lowerAscii = (text) => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
// A letter of any alphabet: an ASCII letter, or anything past ASCII.
const isLetter = (part) => /^[A-Za-z]/.test(part) || part.codePointAt(0) >= 0x80;

/**
 * The order a chart that hands R its categories draws them in: gsm.bio's own,
 * `Core_NaturalCompare` in its R/core.R, which tools/r-order.R copies. By name,
 * with numbers inside a name counted as numbers ("2 mg" before "10 mg"), the
 * letters A to Z read as a to z, and anything else compared by its code point,
 * so it is the same in every browser language and R can be handed the
 * categories in the order they are drawn. A digit sorts before a letter (any
 * character past ASCII counts as one) and after a space or punctuation; names
 * that differ only in case put lower case first.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function categoryOrder(a, b) {
  const [first, second] = [String(a), String(b)];
  const [partsA, partsB] = [partsOf(first), partsOf(second)];
  const shared = Math.min(partsA.length, partsB.length);
  for (let index = 0; index < shared; index += 1) {
    const [partA, partB] = [partsA[index], partsB[index]];
    const [digitsA, digitsB] = [/^[0-9]/.test(partA), /^[0-9]/.test(partB)];
    if (digitsA && digitsB) {
      const difference = Number(partA) - Number(partB);
      if (difference !== 0) return Math.sign(difference);
    } else if (digitsA !== digitsB) {
      const sign = isLetter(digitsA ? partB : partA) ? -1 : 1;
      return digitsA ? sign : -sign;
    } else {
      const order = Math.sign(byCodePoint(lowerAscii(partA), lowerAscii(partB)));
      if (order !== 0) return order;
    }
  }
  if (partsA.length !== partsB.length) return Math.sign(partsA.length - partsB.length);
  return -Math.sign(byCodePoint(first, second));
}

/**
 * Distinct values that are not blank, as text, in `categoryOrder`: the
 * cross-tabulation's categories and the stratified survival chart's groups,
 * drawn and handed to R in this one order.
 */
export function categoriesOf(values) {
  return [...new Set(values.filter((value) => !isBlank(value)).map(String))].sort(categoryOrder);
}

/**
 * The biomarkers the Measure control offers: the configured list in its order,
 * keeping the ones the table has, or every biomarker in the table by name.
 */
export function listMeasures(results, settings) {
  const present = levelsOf(results.map((row) => row[settings.measure_col]));
  if (!settings.measures) return present;
  const listed = settings.measures.filter((measure) => present.includes(measure));
  return listed.length ? listed : present;
}

/**
 * The unit of a biomarker's results, when the table has a unit column and the
 * biomarker has one unit; otherwise null.
 */
export function unitOf(results, settings, measure) {
  if (!settings.unit_col) return null;
  const units = levelsOf(
    results
      .filter((row) => String(row[settings.measure_col]) === measure)
      .map((row) => row[settings.unit_col])
  );
  return units.length === 1 ? units[0] : null;
}

/**
 * The columns that can make a group, a colour or a panel: columns that hold a
 * category, which is to say at most `max_levels` different values.
 *
 * With a participant table: its columns, other than the id. Without one: the
 * columns carried on the results rows, other than the ones the settings map
 * (id, biomarker, result, visit, visit order, unit), that hold one value for
 * each participant. With both, the participant table's columns come first and a
 * column of the same name on the results rows is not offered twice.
 *
 * The setting `groups`, when given, is the list, and nothing is worked out.
 * @returns {Array<{value_col: string, label: string, table: string}>}
 */
export function categoryColumns({ results, participants }, settings) {
  if (settings.groups) {
    return settings.groups.map((spec) => ({ ...spec, table: 'given' }));
  }
  const columns = [];
  const taken = new Set();
  const offer = (name, table) => {
    taken.add(name);
    columns.push({ value_col: name, label: name, table });
  };
  const fewEnough = (values) => {
    const levels = new Set();
    for (const value of values) {
      if (isBlank(value)) continue;
      levels.add(String(value));
      if (levels.size > settings.max_levels) return false;
    }
    return levels.size > 0;
  };

  if (participants && participants.length) {
    const idCol = settings.participant_id_col || settings.id_col;
    for (const name of Object.keys(participants[0])) {
      if (name === idCol) continue;
      if (fewEnough(participants.map((row) => row[name]))) offer(name, 'participants');
    }
  }

  const mapped = new Set(
    [
      settings.id_col,
      settings.measure_col,
      settings.value_col,
      settings.visit_col,
      settings.visit_order_col,
      settings.unit_col,
      settings.studyday_col,
      settings.normal_col_high,
      settings.normal_col_low
    ].filter(Boolean)
  );
  for (const name of results.length ? Object.keys(results[0]) : []) {
    if (mapped.has(name) || taken.has(name)) continue;
    // One value for each participant, or it is not a participant-level column.
    const byParticipant = new Map();
    let constant = true;
    for (const row of results) {
      if (isBlank(row[name])) continue;
      const id = String(row[settings.id_col]);
      const value = String(row[name]);
      if (!byParticipant.has(id)) byParticipant.set(id, value);
      else if (byParticipant.get(id) !== value) {
        constant = false;
        break;
      }
    }
    if (constant && fewEnough(byParticipant.values())) offer(name, 'results');
  }
  return columns;
}

/**
 * The filters the chart shows. There are filters only when there is a
 * participant table: they choose participants. The setting `filters`, when
 * given, is the list (kept to the columns the participant table has); otherwise
 * every category column of the participant table is a filter.
 * @returns {Array<{value_col: string, label: string}>}
 */
export function filterColumns({ participants }, settings, categories) {
  if (!participants || !participants.length) return [];
  if (settings.filters) {
    // A column the participant table has, by its own name, and never the
    // participant's id, which is no filter (#71 review).
    const id = settings.participant_id_col || settings.id_col;
    return settings.filters.filter(
      (spec) => Object.hasOwn(participants[0], spec.value_col) && spec.value_col !== id
    );
  }
  return categories
    .filter((column) => column.table === 'participants')
    .map(({ value_col, label }) => ({ value_col, label }));
}

/**
 * The visits the Visit control offers, and the ones it opens on: the visits in
 * the setting `visits` that the table has, or, when the setting names none,
 * every visit.
 */
export function listVisits(results, settings) {
  const config = coreSettings(settings);
  const all = visitsInOrder(results, config);
  // Null is every visit, and so is a list of none the table has; an empty
  // list is a selection of none (#71 review).
  if (Array.isArray(settings.visits) && !settings.visits.length) return { all, start: [] };
  const asked = (settings.visits || []).filter((visit) => all.includes(visit));
  return { all, start: asked.length ? asked : all };
}

/**
 * Every level of a column, read from the table that holds it: the participant
 * table when it has the column, and otherwise the results rows. What the Levels
 * control offers in the overview, where no one biomarker says which levels
 * have values.
 */
export function columnLevels({ results, participants }, column) {
  const rows = participants && participants.some((row) => column in row) ? participants : results;
  return levelsOf(rows.map((row) => row[column]));
}

/**
 * What a chart says when its filters together let no participant through: it
 * draws nothing and asks R for nothing. Every chart says it in these words.
 */
export const NOBODY_PASSES = 'No participant passes the filters.';

// One value against one filter's selection, when the page's kit gives no test
// of its own: a selection of nothing lets everything through, as a filter set
// to nothing is not in force (filtersInForce).
const matches = (value, selection) =>
  selection === null ||
  selection === undefined ||
  selection === '' ||
  (Array.isArray(selection)
    ? selection.map(String).includes(String(value))
    : String(selection) === String(value));

/**
 * The tables the filters leave. A filter chooses participants: the ones
 * filtered out are set aside with their results before a frame is made, so
 * they are not counted as missing from it. Nothing else is set aside: a row of
 * results with no participant id, or for a participant the participant table
 * does not have, reaches the frame, which counts it by reason. With no
 * participant table there is nothing to filter, and the tables come back as
 * they are.
 *
 * @param {{results: object[], participants: ?object[]}} tables The tables.
 * @param {object} settings The chart's settings.
 * @param {object} [filters] What each filter is set to, by its column.
 * @param {Function} [filterMatches] safety.viz's test of one value against one
 *   filter's selection.
 * @returns {{results: object[], participants: ?object[]}} `participants` is
 *   null when there is no participant table.
 */
export function keepFiltered({ results, participants }, settings, filters, filterMatches) {
  const test = filterMatches || matches;
  if (!participants) return { results, participants: null };
  const idCol = settings.id_col;
  const participantIdCol = settings.participant_id_col || idCol;
  const kept = participants.filter((row) =>
    Object.entries(filters || {}).every(([column, selection]) => test(row[column], selection))
  );
  const idOf = (row, column) => (isBlank(row[column]) ? null : String(row[column]));
  const keptIds = new Set(kept.map((row) => idOf(row, participantIdCol)));
  // The participants the filters set aside: in the table, and not kept.
  const filteredOut = new Set(
    participants
      .map((row) => idOf(row, participantIdCol))
      .filter((id) => id !== null && !keptIds.has(id))
  );
  return {
    participants: kept,
    // When the filters keep nobody, nobody passes: no results are framed, so a
    // row for someone the table does not have cannot make a frame of no one.
    results: kept.length ? results.filter((row) => !filteredOut.has(idOf(row, idCol))) : []
  };
}

// ---- Participant-level numbers ------------------------------------------------

// A value written as a number.
const isNumeric = (value) => {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
};

/**
 * The participant-level numbers a chart can take as a variable: columns in which every value
 * that is written is a number, and that hold more than one different value.
 *
 * With a participant table: its columns, other than the id. Without one: the
 * columns carried on the results rows, other than the ones the settings map,
 * that hold one value for each participant. With both, the participant table's
 * columns come first and a column of the same name on the results rows is not
 * offered twice.
 *
 * The setting `numbers`, when given, is the list, and nothing is worked out.
 * @returns {Array<{value_col: string, label: string, table: string}>}
 */
export function numberColumns({ results, participants }, settings) {
  if (settings.numbers) return settings.numbers.map((spec) => ({ ...spec, table: 'given' }));
  const columns = [];
  const taken = new Set();
  const numbers = (values) => {
    const distinct = new Set();
    for (const value of values) {
      if (isBlank(value)) continue;
      if (!isNumeric(value)) return false;
      distinct.add(Number(value));
    }
    return distinct.size > 1;
  };

  if (participants && participants.length) {
    const idCol = settings.participant_id_col || settings.id_col;
    for (const name of Object.keys(participants[0])) {
      if (name === idCol) continue;
      taken.add(name);
      if (numbers(participants.map((row) => row[name]))) {
        columns.push({ value_col: name, label: name, table: 'participants' });
      }
    }
  }

  const mapped = new Set(
    [
      settings.id_col,
      settings.measure_col,
      settings.value_col,
      settings.visit_col,
      settings.visit_order_col,
      settings.unit_col,
      settings.studyday_col,
      settings.normal_col_high,
      settings.normal_col_low
    ].filter(Boolean)
  );
  for (const name of results.length ? Object.keys(results[0]) : []) {
    if (mapped.has(name) || taken.has(name)) continue;
    // One value for each participant, or it is not a participant-level column.
    const byParticipant = new Map();
    let constant = true;
    for (const row of results) {
      if (isBlank(row[name])) continue;
      const id = String(row[settings.id_col]);
      const value = String(row[name]);
      if (!byParticipant.has(id)) byParticipant.set(id, value);
      else if (byParticipant.get(id) !== value) {
        constant = false;
        break;
      }
    }
    if (constant && numbers(byParticipant.values())) {
      columns.push({ value_col: name, label: name, table: 'results' });
    }
  }
  return columns;
}
