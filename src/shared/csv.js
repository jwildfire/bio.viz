// The CSV every download is written in, and the statistics R returned laid out
// as a table (#67). RFC 4180: fields separated by commas, records by CRLF, and
// a field that holds a comma, a double quote, a carriage return or a line feed
// written between double quotes, with each double quote inside doubled. The
// headings are written by the same rule, so a heading that holds a comma stays
// one heading (bio.viz#39).
//
// Everything here is pure: no page and no chart.

const NEEDS_QUOTES = /[",\r\n]/;

/**
 * One field as RFC 4180 writes it. Null and undefined are written as nothing;
 * a number as the shortest text that reads back as that number; true and false
 * as `TRUE` and `FALSE`, as R reads them; anything else as its text.
 * @param {*} value
 * @returns {string}
 */
export function csvField(value) {
  if (value === null || value === undefined) return '';
  let text;
  if (typeof value === 'number') text = Number.isFinite(value) ? String(value) : '';
  else if (typeof value === 'boolean') text = value ? 'TRUE' : 'FALSE';
  else text = String(value);
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Rows as CSV, with a heading row.
 * @param {object[]} rows The rows, each an object.
 * @param {Array<{value_col: string, label: string}>} columns Which field of a
 *   row each column holds, and its heading.
 * @returns {string} The CSV text, records ending in CRLF.
 */
export function toCsv(rows, columns) {
  const lines = [columns.map((column) => csvField(column.label)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvField(row[column.value_col])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * CSV read back by RFC 4180, every field as text: the inverse of `toCsv`.
 * @param {string} text
 * @returns {string[][]} The records, the heading row first.
 */
export function parseCsv(text) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  let index = 0;
  const end = () => {
    record.push(field);
    field = '';
  };
  while (index < text.length) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 2;
        continue;
      }
      if (char === '"') quoted = false;
      else field += char;
      index += 1;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') end();
    else if (char === '\r' && text[index + 1] === '\n') {
      end();
      records.push(record);
      record = [];
      index += 2;
      continue;
    } else if (char === '\n') {
      end();
      records.push(record);
      record = [];
    } else field += char;
    index += 1;
  }
  if (field !== '' || record.length) {
    end();
    records.push(record);
  }
  return records;
}

// ---- The statistics, as a table ----------------------------------------------------

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The scalar members of an object, nested objects as `outer.inner`; a list of
// scalars as one field, its values joined by `; `. A list of objects is not a
// member: it is the parts of an answer, laid out as rows of their own.
function scalars(object, prefix = '') {
  const out = {};
  for (const [key, value] of Object.entries(object)) {
    const name = `${prefix}${key}`;
    if (isObject(value)) Object.assign(out, scalars(value, `${name}.`));
    else if (Array.isArray(value)) {
      if (value.every((entry) => !isObject(entry) && !Array.isArray(entry))) {
        if (value.length)
          out[name] = value.map((entry) => (entry === null ? 'NA' : String(entry))).join('; ');
      }
    } else out[name] = value;
  }
  return out;
}

/**
 * The statistics R returned for the view drawn, as one table: for each answer,
 * a row for R's result (its test, method, statistic, p-value, counts and so
 * on), then a row for each of its parts (each estimate, each row of a screen or
 * a grid, each pair), each with the R function asked and the data it was asked
 * about. Every number is R's, as R returned it.
 * @param {Array<{name: string, dataId: *, answer: ?object}>} asked What the
 *   chart asked R and what came back, as `chart.statistics()` returns it.
 * @returns {{columns: Array<{value_col: string, label: string}>, rows: object[]}}
 *   Only answers R returned are laid out; a view that has none has no rows.
 */
export function statisticsTable(asked) {
  const rows = [];
  asked.forEach((entry, index) => {
    const answer = entry.answer;
    if (!answer || answer.status !== 'ok' || !isObject(answer.value)) return;
    const about = {
      asked: index + 1,
      function: entry.name,
      ...(isObject(entry.dataId) ? scalars(entry.dataId, 'data.') : { data: entry.dataId })
    };
    const value = answer.value;
    rows.push({ ...about, part: 'result', ...scalars(value) });
    for (const [key, list] of Object.entries(value)) {
      if (!Array.isArray(list) || !list.some(isObject)) continue;
      list.forEach((part, at) => {
        if (isObject(part)) rows.push({ ...about, part: key, item: at + 1, ...scalars(part) });
      });
    }
  });
  const order = [];
  for (const row of rows)
    for (const key of Object.keys(row)) if (!order.includes(key)) order.push(key);
  return { columns: order.map((key) => ({ value_col: key, label: key })), rows };
}
