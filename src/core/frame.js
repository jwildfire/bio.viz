// The frame: named variables resolved to one row per participant.
//
//   const { data, dropped } = frame(
//     { results, participants },
//     { y: { measure: 'IL-6', visit: 'Week 4', value: 'change' }, x: { col: 'ARM' } },
//     { baseline_visits: ['Baseline'] }
//   );
//   // data: [{ USUBJID: 'BIO-001', y: -1.027, x: 'Placebo' }, …]
//
// `data` is what a chart draws and what goes to R as the table of a statistics
// call: plain records, one per participant, holding the participant's id and
// one field per variable, named as the caller named it. A participant for whom
// a variable cannot be worked out is left out and counted, by reason.
//
// Everything here is arithmetic on the participant's own results: a
// difference, a ratio, the mean of a participant's baseline visits. Nothing is
// estimated or tested, and nothing is summarised across participants.

import { DROPPED, UNUSED } from './reasons.js';
import { readSettings } from './settings.js';
import { variable as readVariable } from './variable.js';

const refuse = (message) => {
  throw new TypeError(`bio.viz: ${message}`);
};

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// Nothing was written in the cell.
const isBlank = (value) =>
  value === undefined ||
  value === null ||
  (typeof value === 'number' && Number.isNaN(value)) ||
  (typeof value === 'string' && value.trim() === '');

// A finite number, or text that reads as one; otherwise null. A table read from
// a CSV file holds its numbers as text.
function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const hasColumn = (rows, column) => rows.some((row) => row !== null && column in row);

function readTable(table, name) {
  if (!Array.isArray(table) || !table.every(isPlainObject)) {
    refuse(`\`${name}\` must be an array of records, one object per row.`);
  }
  return table;
}

function needColumn(rows, column, setting, table) {
  if (!hasColumn(rows, column)) {
    refuse(`the ${table} table has no column \`${column}\` (\`${setting}\`).`);
  }
}

// The visits of the results table, in order: by the visit-order column when
// the table has one, otherwise by name, numbers inside a name counted as
// numbers. Only visits with at least one usable result are listed.
function visitsInOrder(results, settings) {
  const byName = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  const ordered = settings.visit_order_col !== null && hasColumn(results, settings.visit_order_col);
  const order = new Map();
  for (const row of results) {
    const visit = row[settings.visit_col];
    if (isBlank(visit) || order.has(String(visit))) continue;
    if (toNumber(row[settings.value_col]) === null) continue;
    order.set(String(visit), ordered ? toNumber(row[settings.visit_order_col]) : null);
  }
  return [...order.keys()].sort((a, b) => {
    const [first, second] = [order.get(a), order.get(b)];
    if (first !== null && second !== null && first !== second) return first - second;
    return byName(a, b);
  });
}

/**
 * The visits of a results table, in visit order: by the visit-order column when
 * the table has one, and otherwise by name, with numbers inside a name counted
 * as numbers. Only visits with at least one usable result are listed. The first
 * of them is the baseline visit when settings name none.
 *
 * @param {object[]} results The results table.
 * @param {object} [settings] Column names; see DEFAULT_SETTINGS.
 * @returns {string[]} The visits' names.
 */
export function visits(results, settings) {
  const config = readSettings(settings);
  const rows = readTable(results, 'results');
  if (!rows.length) return [];
  needColumn(rows, config.visit_col, 'visit_col', 'results');
  needColumn(rows, config.value_col, 'value_col', 'results');
  return visitsInOrder(rows, config);
}

const STATS = {
  mean: (values) => values.reduce((sum, value) => sum + value, 0) / values.length,
  min: (values) => Math.min(...values),
  max: (values) => Math.max(...values),
  first: (values) => values[0]
};

/**
 * Resolves named variables to one row per participant.
 *
 * @param {object} tables The tables.
 * @param {object[]} tables.results The results table, one record per
 *   participant, biomarker and visit; or a wide table, one record per
 *   participant. Required.
 * @param {object[]} [tables.participants] The participant table, one record
 *   per participant.
 * @param {object} variables The variables, each under the name its field is to
 *   have: `{ y: { measure, visit, value }, x: { col } }`.
 * @param {object} [settings] Column names and how the baseline is found; see
 *   DEFAULT_SETTINGS.
 * @returns {{data: object[], id_col: string, variables: object, participants: number,
 *   dropped: Array<{reason: string, variable: ?string, n: number}>,
 *   unused: Array<{reason: string, table: string, n: number}>,
 *   baseline_visits: ?string[]}} The frame.
 */
export function frame(tables, variables, settings) {
  const config = readSettings(settings);
  if (!isPlainObject(tables))
    refuse('frame() takes the tables as an object: { results, participants }.');
  for (const key of Object.keys(tables)) {
    if (!['results', 'participants'].includes(key)) {
      refuse(`frame() takes the tables \`results\` and \`participants\`, not \`${key}\`.`);
    }
  }
  const results = readTable(tables.results, 'results');
  const participantTable =
    tables.participants === undefined || tables.participants === null
      ? null
      : readTable(tables.participants, 'participants');

  // The variables, by name, each checked.
  if (!isPlainObject(variables) || Object.keys(variables).length === 0) {
    refuse('frame() takes the variables as an object, each under the name of its field.');
  }
  const idCol = config.id_col;
  const named = Object.entries(variables).map(([name, spec]) => {
    if (name.trim() === '' || name !== name.trim()) {
      refuse('a variable needs a name with no space at either end: it is the name of its field.');
    }
    if (name === idCol) {
      refuse(`a variable cannot be named \`${name}\`: that field holds the participant's id.`);
    }
    return { name, variable: readVariable(spec) };
  });
  const required = new Set(
    config.required === null ? named.map(({ name }) => name) : config.required
  );
  for (const name of required) {
    if (!named.some((entry) => entry.name === name)) {
      refuse(`\`required\` names \`${name}\`, which is not one of the variables.`);
    }
  }

  const unusedCounts = new Map();
  const unused = (reason, table, n = 1) => {
    const key = `${table}\u0000${reason}`;
    unusedCounts.set(key, (unusedCounts.get(key) || 0) + n);
  };

  // The columns the variables need, each checked before a row is read.
  needColumn(results, idCol, 'id_col', 'results');
  const measures = named.filter(({ variable }) => variable.kind === 'measure');
  const needsBaseline = measures.some(({ variable }) => variable.value !== 'raw');
  if (measures.length) {
    needColumn(results, config.measure_col, 'measure_col', 'results');
    needColumn(results, config.visit_col, 'visit_col', 'results');
    needColumn(results, config.value_col, 'value_col', 'results');
  }
  const participantIdCol = config.participant_id_col || idCol;
  if (participantTable) {
    needColumn(participantTable, participantIdCol, 'participant_id_col', 'participant');
  }
  // A column is read from the participant table when that table has it, and
  // otherwise from the results rows.
  const columnSource = new Map();
  for (const { variable } of named) {
    if (variable.kind !== 'column') continue;
    if (participantTable && hasColumn(participantTable, variable.col)) {
      columnSource.set(variable.col, 'participants');
    } else if (hasColumn(results, variable.col)) {
      columnSource.set(variable.col, 'results');
    } else {
      refuse(
        `no table has the column \`${variable.col}\`: it is not in the ` +
          `${participantTable ? 'participant table or the ' : ''}results table.`
      );
    }
  }

  // The results rows of each participant, in the order first seen.
  const resultRows = new Map();
  for (const row of results) {
    if (isBlank(row[idCol])) {
      unused(UNUSED.NO_ID, 'results');
      continue;
    }
    const id = String(row[idCol]);
    if (!resultRows.has(id)) resultRows.set(id, []);
    resultRows.get(id).push(row);
  }

  // Who the frame is about: the participant table's participants, in its
  // order, when there is one; otherwise everyone with a row of results.
  const participantRow = new Map();
  let ids = [...resultRows.keys()];
  let notInTable = 0;
  if (participantTable) {
    for (const row of participantTable) {
      if (isBlank(row[participantIdCol])) {
        unused(UNUSED.NO_ID, 'participants');
      } else if (participantRow.has(String(row[participantIdCol]))) {
        unused(UNUSED.DUPLICATE_PARTICIPANT, 'participants');
      } else {
        participantRow.set(String(row[participantIdCol]), row);
      }
    }
    notInTable = ids.filter((id) => !participantRow.has(id)).length;
    ids = [...participantRow.keys()];
  }

  // The baseline visits: the ones named in settings, or the first visit.
  let baselineVisits = null;
  if (needsBaseline) {
    baselineVisits = config.baseline_visits || visitsInOrder(results, config).slice(0, 1);
  }

  // For each biomarker and visit a variable reads, each participant's usable
  // results, in table order. The first is the one used. Later ones, and rows
  // with no usable result, are counted as unused.
  const consulted = new Map();
  for (const { variable } of measures) {
    if (!consulted.has(variable.measure)) consulted.set(variable.measure, new Set());
    const visits = consulted.get(variable.measure);
    if (variable.visit !== null) visits.add(variable.visit);
    if (variable.value !== 'raw') baselineVisits.forEach((visit) => visits.add(visit));
  }
  const cells = new Map();
  const cellKey = (id, measure, visit) => `${id}\u0000${measure}\u0000${visit}`;
  for (const id of ids) {
    for (const row of resultRows.get(id) || []) {
      const measure = String(row[config.measure_col]);
      const visit = String(row[config.visit_col]);
      if (!consulted.has(measure) || !consulted.get(measure).has(visit)) continue;
      const key = cellKey(id, measure, visit);
      if (!cells.has(key)) cells.set(key, { rows: 0, values: [] });
      const cell = cells.get(key);
      cell.rows += 1;
      const number = toNumber(row[config.value_col]);
      if (number === null) {
        unused(UNUSED.MISSING_RESULT, 'results');
      } else {
        if (cell.values.length) unused(UNUSED.DUPLICATE_RESULT, 'results');
        cell.values.push(number);
      }
    }
  }

  const resultAt = (id, measure, visit) => {
    const cell = cells.get(cellKey(id, measure, visit));
    if (!cell) return { reason: DROPPED.NO_RESULT };
    if (!cell.values.length) return { reason: DROPPED.MISSING_RESULT };
    return { value: cell.values[0] };
  };

  // One value per baseline visit that has one, brought to a single value.
  const baselineOf = (id, measure) => {
    const found = baselineVisits.map((visit) => resultAt(id, measure, visit));
    const values = found.filter((entry) => 'value' in entry).map((entry) => entry.value);
    if (values.length) return { value: STATS[config.baseline_stat](values) };
    const missing = found.some((entry) => entry.reason === DROPPED.MISSING_RESULT);
    return { reason: missing ? DROPPED.MISSING_BASELINE : DROPPED.NO_BASELINE };
  };

  const measureValue = (id, { measure, visit, value }) => {
    if (value === 'raw') return resultAt(id, measure, visit);
    if (value === 'baseline') return baselineOf(id, measure);
    const at = resultAt(id, measure, visit);
    if ('reason' in at) return at;
    const baseline = baselineOf(id, measure);
    if ('reason' in baseline) return baseline;
    if (value === 'change') return { value: at.value - baseline.value };
    // A ratio to a baseline of zero does not exist, and one to a negative
    // baseline has no meaning as a fold or a percent change.
    if (baseline.value === 0) return { reason: DROPPED.ZERO_BASELINE };
    if (baseline.value < 0) return { reason: DROPPED.NEGATIVE_BASELINE };
    if (value === 'fold_change') return { value: at.value / baseline.value };
    return { value: (100 * (at.value - baseline.value)) / baseline.value };
  };

  const columnValue = (id, { col, type }) => {
    let found;
    if (columnSource.get(col) === 'participants') {
      found = participantRow.get(id)[col];
      if (isBlank(found)) return { reason: DROPPED.EMPTY_COLUMN };
    } else {
      const distinct = new Map();
      for (const row of resultRows.get(id) || []) {
        if (!isBlank(row[col]) && !distinct.has(String(row[col])))
          distinct.set(String(row[col]), row[col]);
      }
      if (distinct.size === 0) return { reason: DROPPED.EMPTY_COLUMN };
      if (distinct.size > 1) return { reason: DROPPED.VARYING_COLUMN };
      [found] = distinct.values();
    }
    if (type !== 'number') return { value: found };
    const number = toNumber(found);
    return number === null ? { reason: DROPPED.NOT_A_NUMBER } : { value: number };
  };

  // One record per participant. The first required variable that cannot be
  // worked out, in the order the variables were given, is the reason the
  // participant is left out. A variable that is not required is left as null.
  const data = [];
  const droppedCounts = new Map();
  for (const id of ids) {
    const source = participantRow.get(id) || (resultRows.get(id) || [])[0];
    const record = { [idCol]: source[participantRow.has(id) ? participantIdCol : idCol] };
    let leftOut = null;
    for (const { name, variable } of named) {
      const found =
        variable.kind === 'measure' ? measureValue(id, variable) : columnValue(id, variable);
      if ('value' in found) {
        record[name] = found.value;
      } else if (required.has(name)) {
        leftOut = { name, reason: found.reason };
        break;
      } else {
        record[name] = null;
      }
    }
    if (leftOut) {
      const key = `${leftOut.name}\u0000${leftOut.reason}`;
      droppedCounts.set(key, (droppedCounts.get(key) || 0) + 1);
    } else {
      data.push(record);
    }
  }

  // Counts in a fixed order: by variable as given, then by reason as listed.
  const reasons = Object.values(DROPPED);
  const dropped = [];
  if (notInTable) {
    dropped.push({ reason: DROPPED.NOT_IN_PARTICIPANT_TABLE, variable: null, n: notInTable });
  }
  for (const { name } of named) {
    for (const reason of reasons) {
      const n = droppedCounts.get(`${name}\u0000${reason}`);
      if (n) dropped.push({ reason, variable: name, n });
    }
  }
  const unusedList = [];
  for (const table of ['results', 'participants']) {
    for (const reason of Object.values(UNUSED)) {
      const n = unusedCounts.get(`${table}\u0000${reason}`);
      if (n) unusedList.push({ reason, table, n });
    }
  }

  return {
    data,
    id_col: idCol,
    variables: Object.fromEntries(named.map(({ name, variable }) => [name, variable])),
    participants: ids.length + notInTable,
    dropped,
    unused: unusedList,
    baseline_visits: baselineVisits
  };
}
