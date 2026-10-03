// Canonical text for a JSON value: object keys sorted, undefined members
// dropped, arrays in order. Two values that differ only in the order their keys
// were written give the same text, so it can be compared and used as a key.
//
// Nothing is coerced: 1 and "1" differ, and so do "ARM" and ["ARM"]. A stored
// result written by R must therefore write a single value as a single value
// (jsonlite: `auto_unbox = TRUE`), or it will not be found.

function order(value) {
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : order(item)));
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) sorted[key] = order(value[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(order(value === undefined ? null : value));
}

export const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
