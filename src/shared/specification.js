// A chart's specification (#68): what it draws, written as JSON data, so a chart
// can be saved, rebuilt from what was saved, and run elsewhere (gsm.bio's batch
// runner reads the same format). It names the chart, the bio.viz version that
// wrote it, every setting the chart has, and every filter in force:
//
//   {
//     "format": "bio.viz specification",
//     "format_version": 1,
//     "bio_viz_version": "0.1.0",
//     "chart": "cross-tab",
//     "settings": { "row_by": "ARM", "col_by": "RESPONSE", ... },
//     "filters": [{ "column": "SEX", "operator": "in", "values": ["F"] }]
//   }
//
// Nothing in a specification is ever evaluated. It is data: text, numbers,
// true and false, null, lists and objects. A function, an expression or a
// template has no way in, and text that looks like code is text. A setting
// that holds something of the page (the connection to R, a way back) is not
// data and is not written; the page gives it again.
//
// Everything here is pure: no page and no chart.

/** What a specification says it is. */
export const SPECIFICATION_FORMAT = 'bio.viz specification';
/** The version of the format this library writes and reads. */
export const SPECIFICATION_VERSION = 1;
/** The operators a filter may have: `in`, the values it lets through. */
export const FILTER_OPERATORS = Object.freeze(['in']);
/** The settings a specification never holds: they are the page's, not data. */
export const PAGE_SETTINGS = Object.freeze(['connection', 'back']);
/** Names no column may have: they would reach an object's prototype. */
export const NO_COLUMN = Object.freeze(['__proto__', 'constructor', 'prototype']);
/** How deep a specification may nest: deeper than any chart's settings. */
export const MOST_NESTED = 64;

const refuse = (message) => {
  throw new TypeError(`bio.viz: ${message}`);
};
const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const isText = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * Where a value is not JSON data, or null when it all is: null, true and false,
 * finite numbers, text, lists and plain objects of these.
 * @param {*} value
 * @param {string} where Where the value is, for the sentence.
 * @returns {?string} A sentence naming what is not data.
 */
export function notData(value, where) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? null
      : `${where} is ${String(value)}, which is not a number JSON holds`;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = notData(value[i], `${where}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      const found = notData(entry, `${where}.${key}`);
      if (found) return found;
    }
    return null;
  }
  const kind =
    typeof value === 'function'
      ? 'a function'
      : value === undefined
        ? 'undefined'
        : `a ${typeof value === 'object' ? value.constructor?.name || 'object' : typeof value}`;
  return `${where} is ${kind}, which is not data: a specification holds only text, numbers, true, false, null, lists and objects`;
}

const copy = (value) => JSON.parse(JSON.stringify(value));

/**
 * A specification given as an object, copied in one pass: each own enumerable
 * property read once, by its descriptor, so a getter, a setter or a Proxy's
 * traps cannot answer twice, and everything after is checked on the copy alone.
 * A getter or a setter is refused, and so is nesting deeper than MOST_NESTED.
 * @param {*} value
 * @param {string} where Where the value is, for the sentence.
 * @param {number} [depth]
 * @returns {*} The copy, of plain objects and arrays.
 */
export function snapshot(value, where = 'the specification', depth = 0) {
  if (value === null || typeof value !== 'object') return value;
  if (depth > MOST_NESTED) {
    refuse(
      `the specification is nested more than ${MOST_NESTED} deep, which no chart’s settings are.`
    );
  }
  const array = Array.isArray(value);
  if (!array && !isPlainObject(value)) {
    const problem = notData(value, where);
    if (problem) refuse(`${problem}.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const read = (key, descriptor, at) => {
    if ('get' in descriptor || 'set' in descriptor) {
      refuse(
        `${at} is a getter or a setter, which is not data: a specification holds only text, numbers, true, false, null, lists and objects.`
      );
    }
    return snapshot(descriptor.value, at, depth + 1);
  };
  if (array) {
    const length = descriptors.length ? descriptors.length.value : 0;
    const out = [];
    for (let i = 0; i < length; i += 1) {
      const descriptor = descriptors[i];
      out.push(descriptor ? read(i, descriptor, `${where}[${i}]`) : undefined);
    }
    return out;
  }
  const out = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable) continue;
    // A key that would set the copy's prototype is kept as a property of its own.
    Object.defineProperty(out, key, {
      value: read(key, descriptor, `${where}.${key}`),
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  return out;
}
/**
 * A chart's specification.
 * @param {object} parts
 * @param {string} parts.chart The chart's name: `cross-tab`.
 * @param {string} parts.version The bio.viz version writing it.
 * @param {object} parts.settings Every setting, as the chart's controls now
 *   read; the page's own (`connection`, `back`) and anything that is not data
 *   are left out.
 * @param {Array<{column: string, values: Array<string|number>}>} parts.filters
 *   Every filter in force.
 * @returns {object}
 */
export function writeSpecification({ chart, version, settings, filters = [] }) {
  const written = {};
  for (const [key, value] of Object.entries(settings)) {
    if (PAGE_SETTINGS.includes(key) || notData(value, key)) continue;
    written[key] = copy(value);
  }
  return {
    format: SPECIFICATION_FORMAT,
    format_version: SPECIFICATION_VERSION,
    bio_viz_version: version,
    chart,
    settings: written,
    filters: filters.map(({ column, values }) => ({
      column,
      operator: 'in',
      values: values.map((entry) => (typeof entry === 'number' ? entry : String(entry)))
    }))
  };
}

/**
 * Reads a specification: checks it is one, of a chart this library has, whose
 * settings are all settings of that chart and whose filters are all filters,
 * and returns the chart's name and the settings to make it with. A filter in
 * force is laid onto the chart's `filters` setting as where that filter starts.
 * Nothing is evaluated. A specification from another version is read if what
 * it holds is still what this version has.
 * @param {*} specification The specification: an object, or its JSON text.
 * @param {object} charts Each chart's name to its settings' defaults.
 * @returns {{chart: string, settings: object, version: string}}
 */
export function readSpecification(specification, charts) {
  let spec = specification;
  if (typeof spec !== 'string') spec = snapshot(spec);
  if (typeof spec === 'string') {
    try {
      spec = JSON.parse(spec);
    } catch (error) {
      refuse(`a specification given as text must be JSON: ${error.message}.`);
    }
  }
  if (!isPlainObject(spec))
    refuse('a specification is an object: { format, chart, settings, filters }.');
  const problem = notData(spec, 'the specification');
  if (problem) refuse(`${problem}.`);
  if (spec.format !== SPECIFICATION_FORMAT) {
    refuse(
      `this is not a bio.viz specification: its \`format\` must be "${SPECIFICATION_FORMAT}".`
    );
  }
  if (spec.format_version !== SPECIFICATION_VERSION) {
    refuse(
      `this specification is of format version ${JSON.stringify(spec.format_version)}, and this ` +
        `version of bio.viz reads version ${SPECIFICATION_VERSION}.`
    );
  }
  const known = ['format', 'format_version', 'bio_viz_version', 'chart', 'settings', 'filters'];
  const extra = Object.keys(spec).filter((key) => !known.includes(key));
  if (extra.length) {
    refuse(`a specification has no \`${extra[0]}\`: it holds ${known.join(', ')}.`);
  }
  if (!isText(spec.bio_viz_version)) {
    refuse('a specification’s `bio_viz_version` is text, the version that wrote it.');
  }
  if (!isText(spec.chart) || !Object.prototype.hasOwnProperty.call(charts, spec.chart)) {
    refuse(
      `this specification names the chart ${JSON.stringify(spec.chart)}, which bio.viz does not ` +
        `have. Its charts are ${Object.keys(charts).join(', ')}.`
    );
  }
  const defaults = charts[spec.chart];
  const settings = spec.settings === undefined ? {} : spec.settings;
  if (!isPlainObject(settings)) refuse('a specification’s `settings` is an object of settings.');
  const unknown = Object.keys(settings).filter(
    (key) => !Object.prototype.hasOwnProperty.call(defaults, key) || PAGE_SETTINGS.includes(key)
  );
  if (unknown.length) {
    const names = unknown.map((key) => `\`${key}\``).join(', ');
    refuse(
      `this specification of the ${spec.chart} chart${isText(spec.bio_viz_version) ? `, written by bio.viz ${spec.bio_viz_version},` : ''} ` +
        `holds ${names}, which ${unknown.length === 1 ? 'is not a setting' : 'are not settings'} of that chart in this version.`
    );
  }
  if ('filters' in settings && settings.filters !== null && !Array.isArray(settings.filters)) {
    refuse('the setting `filters` of a specification is a list of filters, or null.');
  }
  // A setting that names a column by a name no column may have.
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value === 'string' && NO_COLUMN.includes(value)) {
      refuse(`\`${key}\` names \`${value}\`, which is no column’s name.`);
    }
  }
  const filters = spec.filters === undefined ? [] : spec.filters;
  if (!Array.isArray(filters))
    refuse('a specification’s `filters` is a list of { column, operator, values }.');
  const read = copy(settings);
  filters.forEach((filter, index) => {
    const where = `filter ${index + 1}`;
    if (!isPlainObject(filter)) refuse(`${where} must be { column, operator, values }.`);
    const keys = Object.keys(filter).filter(
      (key) => !['column', 'operator', 'values'].includes(key)
    );
    if (keys.length)
      refuse(`${where} has \`${keys[0]}\`: a filter is { column, operator, values }.`);
    if (!isText(filter.column)) refuse(`${where} must name its column.`);
    if (NO_COLUMN.includes(filter.column)) {
      refuse(`${where} is on \`${filter.column}\`, which is no column’s name.`);
    }
    const before = filters.findIndex((other) => other && other.column === filter.column);
    if (before < index) {
      refuse(
        `${where} is on ${filter.column}, which filter ${before + 1} is already on: a column is filtered once.`
      );
    }
    if (!FILTER_OPERATORS.includes(filter.operator)) {
      refuse(
        `${where}, on ${filter.column}, has the operator ${JSON.stringify(filter.operator)}; ` +
          `the operators are ${FILTER_OPERATORS.map((entry) => `"${entry}"`).join(', ')}: in, the values it lets through.`
      );
    }
    // An empty list lets nobody through: a filter of several values emptied.
    if (
      !Array.isArray(filter.values) ||
      !filter.values.every((value) => typeof value === 'string' || typeof value === 'number')
    ) {
      refuse(
        `${where}, on ${filter.column}, must list the values it lets through: text or numbers.`
      );
    }
    const twice = filter.values.map(String).find((value, at, all) => all.indexOf(value) !== at);
    if (twice !== undefined) {
      refuse(`${where}, on ${filter.column}, names ${twice} twice: a value is listed once.`);
    }
    const specs = Array.isArray(read.filters) ? read.filters : read.filters ? [read.filters] : [];
    const at = specs.findIndex((entry) =>
      typeof entry === 'string'
        ? entry === filter.column
        : entry && entry.value_col === filter.column
    );
    const values = filter.values.map(String);
    const started = {
      ...(at >= 0 && typeof specs[at] === 'object' ? specs[at] : { value_col: filter.column }),
      start: values.length === 1 ? values[0] : values,
      ...(values.length !== 1 ? { multiple: true } : {})
    };
    if (at >= 0) specs[at] = started;
    else specs.push(started);
    read.filters = specs;
  });
  return {
    chart: spec.chart,
    settings: read,
    version: spec.bio_viz_version,
    filters: filters.map(({ column, values }) => ({ column, values: values.map(String) }))
  };
}
