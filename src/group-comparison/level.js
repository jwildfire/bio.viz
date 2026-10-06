// Which of its levels the group comparison chart draws, decided in one place.
//
//   every biomarker   no biomarker chosen: the trend tiles, one per biomarker
//   visits            a biomarker chosen: that biomarker, a panel per visit
//                     chosen, with R's test under each
//
// Pure: it reads what the controls are set to and nothing else.

/** The levels the chart draws at, by name. */
export const LEVELS = Object.freeze({ BIOMARKERS: 'biomarkers', VISITS: 'visits' });

/**
 * The level drawn for what the controls are set to.
 * @param {object} state What the controls are set to.
 * @param {?string} [state.measure] The biomarker chosen; null or undefined for none.
 * @returns {string} One of LEVELS.
 */
export function levelOf(state) {
  const { measure } = state || {};
  return measure === null || measure === undefined ? LEVELS.BIOMARKERS : LEVELS.VISITS;
}
