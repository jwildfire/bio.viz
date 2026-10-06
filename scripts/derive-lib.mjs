// Derived fixtures. Nothing in them is typed in: every cell is a cell of a
// vendored file, or a biomarker's name with a letter added, and the unit tests
// derive each fixture again and compare it with the committed one byte for
// byte.
//
// The first is the results table with a participant column carried on its rows,
// for the case the chart must handle with no participant table at all. The
// vendored study keeps its two tables apart, so this joins one column of the
// participant table onto the results rows of a few biomarkers.
//
// The second is a results table with more biomarkers than a screen holds, for
// the group comparison chart's trend tiles, which draw every one. The vendored
// study has twelve biomarkers, so this writes a part of it three times over,
// under three names for each biomarker.

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

// More biomarkers than a screen holds: thirty-six, three times the study's.
export const MANY_BIOMARKERS = {
  file: 'tests/e2e/fixtures/data/results-many-biomarkers.csv',
  record: 'tests/e2e/fixtures/data/results-many-biomarkers.json',
  sources: {
    results: 'site/data/synthetic-study/synthetic_results.csv',
    participants: 'site/data/synthetic-study/synthetic_participants.csv'
  },
  visits: ['Baseline', 'Week 4'],
  participants: 40,
  // What is added to a biomarker's name in each copy.
  copies: ['', ' B', ' C'],
  key: 'USUBJID',
  measure_col: 'TEST',
  visit_col: 'VISIT'
};

/**
 * The many-biomarkers fixture's text and its record, from the two vendored
 * files' bytes: the results of the first participants at a few visits, written
 * once for each copy with the copy's letter added to the biomarker's name.
 * @param {{results: Buffer, participants: Buffer}} sources The vendored files.
 * @param {object} [spec] What to derive.
 * @returns {{text: string, record: object}}
 */
export function deriveManyBiomarkers(sources, spec = MANY_BIOMARKERS) {
  const results = parse(sources.results.toString('utf8'));
  const participants = parse(sources.participants.toString('utf8'));
  const at = (table, column) => table.columns.indexOf(column);
  const [keyAt, measureAt, visitAt] = [spec.key, spec.measure_col, spec.visit_col].map((column) =>
    at(results, column)
  );
  if ([keyAt, measureAt, visitAt, at(participants, spec.key)].includes(-1)) {
    throw new Error('A column the derivation needs is not in the vendored files.');
  }
  const first = new Set(
    participants.lines.slice(0, spec.participants).map((cells) => cells[at(participants, spec.key)])
  );
  const kept = results.lines.filter(
    (cells) => first.has(cells[keyAt]) && spec.visits.includes(cells[visitAt])
  );
  const rows = spec.copies.flatMap((suffix) =>
    kept.map((cells) =>
      cells.map((cell, index) => (index === measureAt ? `${cell}${suffix}` : cell)).join(',')
    )
  );
  const text = [results.columns.join(','), ...rows].join('\n') + '\n';
  const measures = new Set(kept.map((cells) => cells[measureAt])).size * spec.copies.length;
  return {
    text,
    record: {
      file: spec.file,
      derived_by: 'tools/derive-many-biomarkers.mjs',
      rule:
        `The rows of ${spec.sources.results} at ${spec.visits.join(' and ')} for the first ` +
        `${spec.participants} participants of ${spec.sources.participants}, in their order, written ` +
        `${spec.copies.length} times: as they are, and then with ` +
        `${spec.copies
          .filter(Boolean)
          .map((suffix) => `"${suffix}"`)
          .join(' and ')} added to the ${spec.measure_col} of every row. It makes ` +
        `${measures} biomarkers of the study's ${measures / spec.copies.length}, so that there ` +
        'are more than a screen holds. The copies are the same results under other names, and ' +
        'say nothing about any biomarker.',
      derived_from: [
        { file: spec.sources.results, sha256: sha256(sources.results) },
        { file: spec.sources.participants, sha256: sha256(sources.participants) }
      ],
      sha256: sha256(Buffer.from(text)),
      rows: rows.length,
      biomarkers: measures,
      columns: results.columns
    }
  };
}
