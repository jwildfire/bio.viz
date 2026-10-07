// The `core` namespace: `BioViz.core` in a page, `import { core } from …` in a
// module. The two steps every chart shares before anything is drawn: a
// variable named once, and named variables resolved to one row per
// participant. Pure functions: no page, no chart, no network, and nothing
// imported from outside src/core.

export { variable, label, cutWords, VALUE_TYPES } from './variable.js';
export { CUTS, cutPoints, cutGroup, cutLabels } from './cut.js';
export { frame, visits } from './frame.js';
export { UNSCHEDULED_DEFAULTS, isUnscheduledVisit, scheduledResults } from './unscheduled.js';
export { DEFAULT_SETTINGS, BASELINE_STATS } from './settings.js';
export { DROPPED, UNUSED } from './reasons.js';
