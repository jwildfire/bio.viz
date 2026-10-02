// Settings of the core: the column names, and how a baseline is found. The
// names are safety.viz's, so one column mapping drives both libraries, and the
// defaults are the columns of the synthetic study.

/**
 * How several baseline visits are brought to one baseline value.
 */
export const BASELINE_STATS = Object.freeze(['mean', 'min', 'max', 'first']);

/**
 * The settings and their defaults.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  id_col: 'USUBJID',
  measure_col: 'TEST',
  value_col: 'STRESN',
  visit_col: 'VISIT',
  visit_order_col: 'VISITNUM',
  participant_id_col: null,
  baseline_visits: null,
  baseline_stat: 'mean',
  required: null
});

const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const refuse = (message) => {
  throw new TypeError(`bio.viz: ${message}`);
};

function textList(value, name) {
  const list = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(list) || list.length === 0 || !list.every(isText)) {
    refuse(`\`${name}\` must be a name, or a list of names, and none of them empty.`);
  }
  return [...new Set(list)];
}

// The settings in full: the caller's over the defaults. Refuses a setting that
// is not one of these, and a value a setting cannot take.
export function readSettings(overrides) {
  if (overrides !== undefined && overrides !== null && !isPlainObject(overrides)) {
    refuse('settings must be an object.');
  }
  const given = overrides || {};
  for (const key of Object.keys(given)) {
    if (!(key in DEFAULT_SETTINGS)) {
      refuse(
        `\`${key}\` is not a setting. The settings are ${Object.keys(DEFAULT_SETTINGS).join(', ')}.`
      );
    }
  }
  const settings = { ...DEFAULT_SETTINGS };
  for (const [key, value] of Object.entries(given)) {
    if (value !== undefined) settings[key] = value;
  }

  for (const key of ['id_col', 'measure_col', 'value_col', 'visit_col']) {
    if (!isText(settings[key])) refuse(`\`${key}\` must be the name of a column.`);
  }
  for (const key of ['visit_order_col', 'participant_id_col']) {
    if (settings[key] !== null && !isText(settings[key])) {
      refuse(`\`${key}\` must be the name of a column, or null.`);
    }
  }
  if (settings.baseline_visits !== null) {
    settings.baseline_visits = textList(settings.baseline_visits, 'baseline_visits');
  }
  if (!BASELINE_STATS.includes(settings.baseline_stat)) {
    refuse(`\`baseline_stat\` must be one of ${BASELINE_STATS.join(', ')}.`);
  }
  if (settings.required !== null) {
    if (!Array.isArray(settings.required) || !settings.required.every(isText)) {
      refuse('`required` must be a list of the names of variables, or null for all of them.');
    }
    settings.required = [...new Set(settings.required)];
  }
  return settings;
}
