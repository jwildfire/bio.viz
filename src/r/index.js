// The `r` namespace: `BioViz.r` in a page, `import { r } from …` in a module.
// Everything here is self-contained — nothing is imported from outside src/r —
// so the connection can be handed to a chart in another library.

export { createConnection } from './connection.js';
export {
  formatStatistic,
  formatEstimate,
  formatMedian,
  formatComparison,
  formatGroup,
  formatPair,
  formatScreenRow,
  formatLevel,
  formatCell
} from './formatStatistic.js';
export { WEBR_VERSION, WEBR_BASE_URL } from './webREngine.js';
