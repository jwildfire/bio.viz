import { readFileSync } from 'node:fs';

// The vendored synthetic study as a page would hold it after reading the CSV
// files: an array of records per table, every value text. The files have no
// quoted field (the vendoring check refuses one), so a split is a read.

const folder = new URL('../../../site/data/synthetic-study/', import.meta.url);

export function readStudyTable(file) {
  const [header, ...lines] = readFileSync(new URL(file, folder), 'utf8').trimEnd().split('\n');
  const columns = header.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(columns.map((column, index) => [column, cells[index]]));
  });
}

export const results = readStudyTable('synthetic_results.csv');
export const participants = readStudyTable('synthetic_participants.csv');

// One participant's result as the file has it: the text of STRESN on the one
// row for that biomarker and visit, or undefined when there is no such row.
export function written(id, measure, visit) {
  const rows = results.filter(
    (row) => row.USUBJID === id && row.TEST === measure && row.VISIT === visit
  );
  if (rows.length > 1) throw new Error(`more than one row for ${id}, ${measure}, ${visit}`);
  return rows.length ? rows[0].STRESN : undefined;
}
