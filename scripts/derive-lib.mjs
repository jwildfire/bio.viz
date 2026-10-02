// A derived fixture: the results table with a participant column carried on its
// rows, for the case the chart must handle with no participant table at all.
// The vendored study keeps its two tables apart, so this joins one column of
// the participant table onto the results rows of a few biomarkers. Nothing is
// typed in: every cell is a cell of a vendored file, and the unit tests derive
// the fixture again and compare it with the committed one byte for byte.

import { sha256 } from './vendor-lib.mjs';

export const RESULTS_WITH_ARM = {
  file: 'tests/e2e/fixtures/data/results-with-arm.csv',
  record: 'tests/e2e/fixtures/data/results-with-arm.json',
  sources: {
    results: 'site/data/synthetic-study/synthetic_results.csv',
    participants: 'site/data/synthetic-study/synthetic_participants.csv'
  },
  measures: ['IL-6', 'CRP'],
  column: 'ARM',
  key: 'USUBJID',
  measure_col: 'TEST'
};

const parse = (text) => {
  const [header, ...lines] = text.trimEnd().split('\n');
  return { columns: header.split(','), lines: lines.map((line) => line.split(',')) };
};

/**
 * The fixture's text and its record, from the two vendored files' bytes.
 * @param {{results: Buffer, participants: Buffer}} sources The vendored files.
 * @param {object} [spec] What to derive.
 * @returns {{text: string, record: object}}
 */
export function deriveResultsWithColumn(sources, spec = RESULTS_WITH_ARM) {
  const results = parse(sources.results.toString('utf8'));
  const participants = parse(sources.participants.toString('utf8'));
  const keyAt = participants.columns.indexOf(spec.key);
  const columnAt = participants.columns.indexOf(spec.column);
  const resultKeyAt = results.columns.indexOf(spec.key);
  const measureAt = results.columns.indexOf(spec.measure_col);
  if ([keyAt, columnAt, resultKeyAt, measureAt].includes(-1)) {
    throw new Error('A column the derivation needs is not in the vendored files.');
  }
  const carried = new Map(participants.lines.map((cells) => [cells[keyAt], cells[columnAt]]));
  const rows = results.lines
    .filter((cells) => spec.measures.includes(cells[measureAt]))
    .map((cells) => {
      if (!carried.has(cells[resultKeyAt])) {
        throw new Error(`${cells[resultKeyAt]} has results and is not in the participant table.`);
      }
      return [...cells, carried.get(cells[resultKeyAt])].join(',');
    });
  const text = [[...results.columns, spec.column].join(','), ...rows].join('\n') + '\n';
  return {
    text,
    record: {
      file: spec.file,
      derived_by: 'tools/derive-results-with-arm.mjs',
      rule:
        `The rows of ${spec.sources.results} whose ${spec.measure_col} is one of ` +
        `${spec.measures.join(', ')}, in their order, each with the participant's ` +
        `${spec.column} from ${spec.sources.participants} added as a last column.`,
      derived_from: [
        { file: spec.sources.results, sha256: sha256(sources.results) },
        { file: spec.sources.participants, sha256: sha256(sources.participants) }
      ],
      sha256: sha256(Buffer.from(text)),
      rows: rows.length,
      columns: [...results.columns, spec.column]
    }
  };
}
