// What every chart's settings share: the small checks a `syncSettings` is built
// from, and the settings the core reads. A chart's own file (its
// `configure.js`) holds its defaults and decides what each setting may be; the
// words a refusal is written in are the same everywhere, and are these.

import { variable } from '../core/variable.js';

export const isText = (value) => typeof value === 'string' && value.trim() !== '';
export const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const refuse = (message) => {
  throw new TypeError(`bio.viz: ${message}`);
};

// A column name, or { value_col, label }, as { value_col, label }.
export function fieldSpec(value, setting) {
  if (isText(value)) return { value_col: value, label: value };
  if (isPlainObject(value) && isText(value.value_col)) {
    return {
      ...value,
      value_col: value.value_col,
      label: isText(value.label) ? value.label : value.value_col
    };
  }
  return refuse(
    `\`${setting}\` holds something that is not a column name or { value_col, label }.`
  );
}

export function fieldList(value, setting) {
  if (value === null || value === undefined) return null;
  const list = Array.isArray(value) ? value : [value];
  return list.map((entry) => fieldSpec(entry, setting));
}

export function textList(value, setting) {
  if (value === null || value === undefined) return null;
  const list = Array.isArray(value) ? value : [value];
  if (!list.length || !list.every((entry) => isText(entry) || typeof entry === 'number')) {
    refuse(`\`${setting}\` must be a name, or a list of names.`);
  }
  return [...new Set(list.map(String))];
}

export const columnOrNull = (settings, key) => {
  if (settings[key] !== null && !isText(settings[key])) {
    refuse(`\`${key}\` must be the name of a column, or null.`);
  }
};

// The settings the core reads, taken from a chart's.
export function coreSettings(settings) {
  return {
    id_col: settings.id_col,
    measure_col: settings.measure_col,
    value_col: settings.value_col,
    visit_col: settings.visit_col,
    visit_order_col: settings.visit_order_col,
    participant_id_col: settings.participant_id_col,
    baseline_visits: settings.baseline_visits,
    baseline_stat: settings.baseline_stat
  };
}

// What a chart's settings are laid over its defaults with: a setting that is
// not known is refused by name, and one left undefined keeps its default.
// `chart` is the chart in words, for the message: "the group comparison chart".
export function layOver(defaults, overrides, chart) {
  if (overrides !== undefined && overrides !== null && !isPlainObject(overrides)) {
    refuse(`${chart} takes its settings as an object.`);
  }
  const given = overrides || {};
  for (const key of Object.keys(given)) {
    if (!(key in defaults)) {
      refuse(
        `\`${key}\` is not a setting of ${chart}. Its settings are ` +
          `${Object.keys(defaults).join(', ')}.`
      );
    }
  }
  const settings = { ...defaults };
  for (const [key, value] of Object.entries(given)) {
    if (value !== undefined) settings[key] = value;
  }
  return settings;
}

// The checks every chart makes of the settings every chart has: the columns
// the core reads, the baseline, the listing, the statistics line and the
// participant profile. A chart checks its own settings after this.
export function checkShared(settings, baselineStats) {
  for (const key of ['id_col', 'measure_col', 'value_col', 'visit_col']) {
    if (!isText(settings[key])) refuse(`\`${key}\` must be the name of a column.`);
  }
  if (!baselineStats.includes(settings.baseline_stat)) {
    refuse(`\`baseline_stat\` must be one of ${baselineStats.join(', ')}.`);
  }
  // A chart that opens no participant profile has no such setting.
  if ('profile' in settings && typeof settings.profile !== 'boolean') {
    refuse('`profile` must be true or false.');
  }
  if (settings.waiting_note !== null && !isText(settings.waiting_note)) {
    refuse('`waiting_note` must be a sentence, or null for none.');
  }
  if (
    settings.connection !== null &&
    (typeof settings.connection !== 'object' || typeof settings.connection.run !== 'function')
  ) {
    refuse('`connection` must be a connection to R (BioViz.r.createConnection), or null.');
  }
}

/**
 * Checks the setting `back`: a way back to a chart that opened this one in its
 * place, `{ label, action }`, or null for none.
 * @param {object} settings The settings, laid over the defaults.
 */
export function checkBack(settings) {
  if (
    settings.back !== null &&
    (!isPlainObject(settings.back) ||
      !isText(settings.back.label) ||
      typeof settings.back.action !== 'function')
  ) {
    refuse('`back` must be { label, action }, a sentence and a function, or null for none.');
  }
}

/**
 * A variable as a setting writes one: `{ measure, visit, value }` for a biomarker
 * at a visit, or `{ col }` for a participant-level number, checked by the core
 * and written back in full; null stays null.
 * @param {?object} value What the caller wrote.
 * @param {string} setting The setting's name, for the message.
 * @returns {?object} The variable, as the settings write one.
 */
export function variableSetting(value, setting) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) {
    refuse(
      `\`${setting}\` must be a variable: { measure, visit, value } for a biomarker at a visit, ` +
        'or { col } for a participant-level number; or null.'
    );
  }
  const read = variable('col' in value && value.col != null ? { ...value, type: 'number' } : value);
  // A number taken as a number is not cut: a cut makes groups, and only a
  // setting that makes groups takes one.
  if (read.cut !== undefined) {
    refuse(
      `\`${setting}\` is read as a number, so it takes no \`cut\`: a cut makes groups. Leave ` +
        '`cut` out.'
    );
  }
  return read.kind === 'column'
    ? { col: read.col }
    : {
        measure: read.measure,
        value: read.value,
        ...(read.visit === null ? {} : { visit: read.visit })
      };
}
