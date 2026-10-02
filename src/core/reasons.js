// The words the frame uses for what it left out. Two lists, because two things
// are counted: participants who are not in the frame, and rows of a table that
// were read and not used. A chart prints these as they are.

/**
 * Why a participant is not in the frame. Each is the `reason` of an entry in
 * the frame's `dropped` list.
 */
export const DROPPED = Object.freeze({
  NOT_IN_PARTICIPANT_TABLE: 'Not in the participant table',
  NO_RESULT: 'No result at the visit',
  MISSING_RESULT: 'Result at the visit is missing or not a number',
  NO_BASELINE: 'No baseline result',
  MISSING_BASELINE: 'Baseline result is missing or not a number',
  ZERO_BASELINE: 'Baseline is zero',
  NEGATIVE_BASELINE: 'Baseline is negative',
  EMPTY_COLUMN: 'Column is empty',
  VARYING_COLUMN: 'Column has more than one value for the participant',
  NOT_A_NUMBER: 'Column value is not a number'
});

/**
 * Why a row of a table was read and not used. Each is the `reason` of an entry
 * in the frame's `unused` list.
 */
export const UNUSED = Object.freeze({
  NO_ID: 'Row has no participant id',
  DUPLICATE_PARTICIPANT: 'Later row for a participant already in the participant table',
  DUPLICATE_RESULT: 'Later result for the same participant, biomarker and visit',
  MISSING_RESULT: 'Result is missing or not a number'
});
