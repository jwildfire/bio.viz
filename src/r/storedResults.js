// The precomputed form: results worked out ahead of time (by gsm.bio, in R) and
// shipped with the page. Looking one up loads nothing and touches no network.
//
// A stored result is found by three things together:
//
//   name    the R function that produced it
//   args    the arguments it was called with (key order does not matter)
//   dataId  the identity of the data it was computed on: any JSON value the
//           producer and the chart agree on, such as a description of the
//           selection ("opening view", or the filters in force)
//
// The data identity is stated, not derived from the rows. A fingerprint of the
// rows would have to be computed identically in R and in JavaScript, and the two
// do not always read the same decimal text to the same number; a stated identity
// cannot drift. An entry may also carry `rows`, the number of rows R computed
// on, which is checked against the rows the chart holds.
//
// Anything short of an exact match is a miss, and a miss is reported as such: a
// stale or neighbouring result is never returned in its place.

import { canonicalJson, isPlainObject } from './canonical.js';

const keyFor = (name, args, dataId) =>
  JSON.stringify([name, canonicalJson(args ?? {}), canonicalJson(dataId)]);

const describe = (value) => (typeof value === 'string' ? `"${value}"` : canonicalJson(value));

// Builds the lookup from the `results` setting. Throws a TypeError on anything
// malformed, so a bad results file fails when the connection is made rather
// than quietly never matching.
export function createStore(results) {
  if (results === undefined || results === null) return null;
  if (!Array.isArray(results)) {
    throw new TypeError('bio.viz: `results` must be an array of stored results.');
  }
  const entries = new Map();
  results.forEach((entry, index) => {
    const where = `bio.viz: stored result ${index}`;
    if (!isPlainObject(entry)) throw new TypeError(`${where} must be an object.`);
    const { name, args, dataId, rows, value } = entry;
    if (typeof name !== 'string' || name.trim() === '') {
      throw new TypeError(`${where} needs \`name\`, the R function that produced it.`);
    }
    if (args !== undefined && !isPlainObject(args)) {
      throw new TypeError(`${where} (${name}): \`args\` must be an object of named arguments.`);
    }
    if (dataId === undefined || dataId === null || dataId === '') {
      throw new TypeError(
        `${where} (${name}) needs \`dataId\`, the identity of the data it was computed on.`
      );
    }
    if (rows !== undefined && (!Number.isInteger(rows) || rows < 0)) {
      throw new TypeError(`${where} (${name}): \`rows\` must be a whole number of rows.`);
    }
    if (value === undefined) {
      throw new TypeError(`${where} (${name}) needs \`value\`, what the function returned.`);
    }
    const key = keyFor(name, args, dataId);
    if (entries.has(key)) {
      throw new TypeError(
        `${where} (${name}) has the same name, arguments and data identity as an earlier one.`
      );
    }
    entries.set(key, { rows, value });
  });
  return entries;
}

// Returns { hit: true, value } or { hit: false, message }.
export function lookUp(store, name, { data, args, dataId }) {
  const miss = (detail) => ({
    hit: false,
    message: `Statistics are unavailable: no stored result for ${name} ${detail}.`
  });
  if (dataId === undefined || dataId === null || dataId === '') {
    return miss('can be matched, because no data identity was given with the call');
  }
  const entry = store.get(keyFor(name, args, dataId));
  if (!entry) return miss(`with these arguments on the data ${describe(dataId)}`);
  if (entry.rows !== undefined) {
    const given = Array.isArray(data) ? data.length : 'none';
    if (given !== entry.rows) {
      return miss(
        `fits the data given: it was computed on ${entry.rows} rows, and ${given} were given`
      );
    }
  }
  // A copy, so nothing a caller does to the value reaches the stored result.
  return { hit: true, value: structuredClone(entry.value) };
}
