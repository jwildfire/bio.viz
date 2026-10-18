// The R check page's own logic, kept apart from the page so it can be tested
// without a browser: reading the page's tables, and deciding whether what R in
// the browser returned equals what desktop R returned.
//
// Nothing here is a statistic. Both numbers in every comparison were produced
// by R; this file only subtracts one from the other.

// Two numbers are the same answer when they differ by no more than 1 part in
// 10^8 of the larger. The measure is relative on purpose: a p-value of 10^-8 is
// held to the same eight digits as a statistic of 36.
//
// Why this size: desktop R and R in the browser are different builds of
// different R versions, compiled by different compilers for different machines,
// so the last few of a number's sixteen digits may legitimately differ. One part
// in 10^8 leaves eight digits that must agree — five more than any chart prints —
// and is far too tight to pass a wrong answer. The page shows both numbers in
// full and their difference, so what the tolerance let through is visible.
export const TOLERANCE = Object.freeze({ relative: 1e-8 });

export function withinTolerance(expected, actual) {
  if (typeof expected !== 'number' || typeof actual !== 'number') return false;
  if (!Number.isFinite(expected) || !Number.isFinite(actual)) return false;
  const difference = Math.abs(expected - actual);
  const scale = Math.max(Math.abs(expected), Math.abs(actual));
  return difference <= TOLERANCE.relative * scale;
}

// The shortest text that reads back as exactly this number: every digit that
// distinguishes it, and none that do not.
export const showNumber = (value) => String(value);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const join = (path, key) => (path ? `${path}.${key}` : key);

// Walks the expected value and the actual one together and returns one row per
// leaf: { path, expected, actual, difference, ok }. Numbers are compared by the
// tolerance; text, booleans, missing values and structure exactly. `difference`
// is the absolute difference for a pair of numbers and null otherwise.
export function compareValues(expected, actual, path = '') {
  if (isObject(expected)) {
    if (!isObject(actual)) {
      return [{ path: path || '(whole value)', expected, actual, difference: null, ok: false }];
    }
    const rows = Object.keys(expected).flatMap((key) =>
      key in actual
        ? compareValues(expected[key], actual[key], join(path, key))
        : [
            {
              path: join(path, key),
              expected: expected[key],
              actual: undefined,
              difference: null,
              ok: false
            }
          ]
    );
    for (const key of Object.keys(actual)) {
      if (!(key in expected)) {
        rows.push({
          path: join(path, key),
          expected: undefined,
          actual: actual[key],
          difference: null,
          ok: false
        });
      }
    }
    return rows;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return [{ path, expected, actual, difference: null, ok: false }];
    }
    if (expected.length === 0) return [{ path, expected, actual, difference: null, ok: true }];
    return expected.flatMap((item, index) =>
      compareValues(item, actual[index], `${path}[${index}]`)
    );
  }
  if (typeof expected === 'number' && typeof actual === 'number') {
    return [
      {
        path,
        expected,
        actual,
        difference: Math.abs(expected - actual),
        ok: withinTolerance(expected, actual)
      }
    ];
  }
  return [{ path, expected, actual, difference: null, ok: expected === actual }];
}

// A table from CSV: one object per row, the named columns as numbers, a blank
// as missing. The page's tables have no quoted fields; one that had would be
// misread, so it is refused.
export function parseCsv(text, numericColumns = []) {
  if (text.includes('"')) throw new Error('quoted CSV fields are not supported');
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const names = header.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(
      names.map((name, index) => {
        const cell = cells[index] ?? '';
        if (!numericColumns.includes(name)) return [name, cell];
        return [name, cell === '' ? null : Number(cell)];
      })
    );
  });
}
