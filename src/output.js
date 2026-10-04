// The `output` namespace: `BioViz.output` in a page. What a chart does to get
// its results out of the browser, written once in src/shared/ and offered here
// to a page or a widget that writes the same words: a template's placeholders
// filled as text, and the footnote every chart writes last (#66).

export {
  TITLE_DEFAULTS,
  automaticFootnote,
  countsText,
  fillParts,
  fillText,
  placeholdersIn
} from './shared/titles.js';
