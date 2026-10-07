// Which of its levels the group comparison chart draws, decided in one place.
//
//   every biomarker   no biomarker chosen: the trend tiles, one per biomarker
//   over time         a biomarker chosen, and every visit it has values at:
//                     that biomarker across its visits in one picture, with
//                     R's test of the groups under each visit
//   visits            a biomarker chosen and some of its visits: a panel per
//                     visit chosen, with R's test under each
//
// Pure: it reads what the controls are set to, and the visits the biomarker
// has, and nothing else.

/** The levels the chart draws at, by name. */
export const LEVELS = Object.freeze({
  BIOMARKERS: 'biomarkers',
  OVER_TIME: 'over-time',
  VISITS: 'visits'
});

/**
 * Whether a biomarker has a picture over time for what the controls are set
 * to: it needs two visits or more to run across, and a value that has a visit.
 * A baseline value has none.
 * @param {object} state What the controls are set to.
 * @param {string[]} [offered] The visits the biomarker has values at.
 * @returns {boolean}
 */
export function hasOverTime(state, offered = []) {
  const { measure, valueType } = state || {};
  if (measure === null || measure === undefined) return false;
  return valueType !== 'baseline' && offered.length > 1;
}

/**
 * The level drawn for what the controls are set to.
 * @param {object} state What the controls are set to.
 * @param {?string} [state.measure] The biomarker chosen; null or undefined for none.
 * @param {string[]} [state.visits] The visits chosen.
 * @param {string} [state.valueType] The value type.
 * @param {string[]} [offered] The visits the biomarker chosen has values at,
 *   which are the ones the Visit control offers while it is open. Not read
 *   when no biomarker is chosen.
 * @returns {string} One of LEVELS.
 */
export function levelOf(state, offered = []) {
  const { measure, visits } = state || {};
  if (measure === null || measure === undefined) return LEVELS.BIOMARKERS;
  if (!hasOverTime(state, offered)) return LEVELS.VISITS;
  const chosen = new Set(visits || []);
  // The Visit control on all visits: every visit the biomarker has is chosen.
  return offered.every((visit) => chosen.has(visit)) ? LEVELS.OVER_TIME : LEVELS.VISITS;
}
