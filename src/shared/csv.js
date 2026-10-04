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
 * a number as the shortest text that reads back as that number in JavaScript,
 * NaN, Inf and -Inf as R writes them; true and false
 * as `TRUE` and `FALSE`, as R reads them; anything else as its text.
 * @param {*} value
 * @returns {string}
 */
export function csvField(value) {
  if (value === null || value === undefined) return '';
  let text;
  // R's NaN, Inf and -Inf, as R writes them: a value R computed, not one missing.
  if (typeof value === 'number') {
    text = Number.isNaN(value)
      ? 'NaN'
      : value === Infinity
        ? 'Inf'
        : value === -Infinity
          ? '-Inf'
          : String(value);
  } else if (typeof value === 'boolean') text = value ? 'TRUE' : 'FALSE';
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

// The columns the file names itself, which no member of R's answer may take.
const OWN = ['asked', 'function', 'part', 'item'];

const refuse = (message) => {
  throw new TypeError(`bio.viz: ${message}`);
};

// Every scalar of a value, by its path: nested names joined by a slash (`counts/
// Placebo`; R's own names may hold a dot, `p.value`), a list's entries by their
// place (`variables/1/measure`). A list of scalars alone is one field, its
// values joined by " | ", which R's notes, joined by "; ", do not use. Two paths
// that would be written alike are refused.
function scalars(value, prefix, out = {}) {
  const put = (name, entry) => {
    if (Object.prototype.hasOwnProperty.call(out, name)) {
      refuse(`R’s answer has two members written \`${name}\` in the statistics file.`);
    }
    out[name] = entry;
  };
  if (Array.isArray(value)) {
    if (value.every((entry) => !isObject(entry) && !Array.isArray(entry))) {
      if (value.length)
        put(prefix, value.map((entry) => (entry === null ? 'NA' : String(entry))).join(' | '));
      return out;
    }
    value.forEach((entry, at) => {
      const name = `${prefix}/${at + 1}`;
      if (isObject(entry) || Array.isArray(entry)) scalars(entry, name, out);
      else put(name, entry);
    });
    return out;
  }
  for (const [key, entry] of Object.entries(value)) {
    const name = prefix ? `${prefix}/${key}` : key;
    if (isObject(entry) || Array.isArray(entry)) scalars(entry, name, out);
    else put(name, entry);
  }
  return out;
}

// The members of one result or part: its scalars and nested members, but not
// the lists of objects that are parts of their own.
function membersOf(object, parts) {
  const out = {};
  for (const [key, entry] of Object.entries(object)) {
    if (OWN.includes(key) || key === 'data' || key.startsWith('data/')) {
      refuse(`R’s answer has a member \`${key}\`, which the statistics file names itself.`);
    }
    if (parts && Array.isArray(entry) && entry.some(isObject)) continue;
    if (isObject(entry) || Array.isArray(entry)) scalars(entry, key, out);
    else out[key] = entry;
  }
  return out;
}

/**
 * The statistics R returned for the view drawn, as one table: for each answer,
 * a row for R's result (its test, method, statistic, p-value, counts and so
 * on), then a row for each of its parts (each estimate, each row of a screen or
 * a grid, each pair), each with the R function asked and the data it was asked
 * about. Every member R returned is a column, by its path, and every number is
 * R's as R returned it.
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
      ...(isObject(entry.dataId) || Array.isArray(entry.dataId)
        ? scalars(entry.dataId, 'data')
        : { data: entry.dataId })
    };
    const value = answer.value;
    rows.push({ ...about, part: 'result', ...membersOf(value, true) });
    for (const [key, list] of Object.entries(value)) {
      if (!Array.isArray(list) || !list.some(isObject)) continue;
      list.forEach((part, at) => {
        if (isObject(part))
          rows.push({ ...about, part: key, item: at + 1, ...membersOf(part, false) });
      });
    }
  });
  const order = [];
  const seen = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
    }
  }
  return { columns: order.map((key) => ({ value_col: key, label: key })), rows };
}
