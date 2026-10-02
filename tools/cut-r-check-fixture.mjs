// Cuts the R check page's two small tables from the public example data that
// safety.viz vendors (built there from pharmaverseadam, the CDISC Pilot 01
// study; Apache-2.0). Run once, by hand, against a checkout of safety.viz's
// `dev` branch; the output is committed, so nothing here runs at build time.
//
//   node tools/cut-r-check-fixture.mjs <path to a safety.viz checkout> <its commit>
//
// Writes, under site/r-check/data/:
//
//   alt-week-8.csv     lab values by arm, for the rank-sum test: Alanine
//                      Aminotransferase at Week 8 for the Placebo and
//                      Xanomeline High Dose arms, one row per participant
//   days-on-study.csv  days on study with discontinuation as the event, by
//                      arm, for the log-rank test: one row per participant
//
// Only rows of the published study are taken. safety.viz appends synthetic
// cohorts to its lab file (participant ids beginning CLD- and AKI-); they are
// left out.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [source, commit] = process.argv.slice(2);
if (!source || !/^[0-9a-f]{40}$/.test(commit || '')) {
  console.error(
    'usage: node tools/cut-r-check-fixture.mjs <safety.viz checkout> <its 40-character commit>'
  );
  process.exit(1);
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(rootDir, 'site/r-check/data');
mkdirSync(outDir, { recursive: true });

// The source files have no quoted fields in the columns used here; a field with
// a comma or a quote would break this reader, so it is refused.
function readCsv(file) {
  const [header, ...lines] = readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const names = header.split(',');
  return lines.map((line) => {
    if (line.includes('"')) throw new Error(`${file}: quoted field, not handled: ${line}`);
    const cells = line.split(',');
    return Object.fromEntries(names.map((name, index) => [name, cells[index]]));
  });
}

function writeCsv(file, names, rows) {
  for (const row of rows) {
    for (const name of names) {
      if (/[",\n]/.test(String(row[name]))) throw new Error(`${file}: field needs quoting`);
    }
  }
  const text = [names.join(','), ...rows.map((row) => names.map((name) => row[name]).join(','))];
  writeFileSync(path.join(outDir, file), text.join('\n') + '\n');
  console.log(`✓ Wrote site/r-check/data/${file} — ${rows.length} rows`);
}

const isStudyParticipant = (id) => /^01-\d{3}-\d{4}$/.test(id);
const byId = (a, b) => (a.USUBJID < b.USUBJID ? -1 : a.USUBJID > b.USUBJID ? 1 : 0);

// Lab values by arm.
const ARMS = ['Placebo', 'Xanomeline High Dose'];
const lab = readCsv(path.join(source, 'site/data/adbds.csv'))
  .filter(
    (row) =>
      isStudyParticipant(row.USUBJID) &&
      row.TEST === 'Alanine Aminotransferase' &&
      row.VISIT === 'Week 8' &&
      ARMS.includes(row.ARM) &&
      row.STRESN !== ''
  )
  .map((row) => ({ USUBJID: row.USUBJID, ARM: row.ARM, AVAL: row.STRESN }))
  .sort(byId);
if (new Set(lab.map((row) => row.USUBJID)).size !== lab.length) {
  throw new Error('more than one Week 8 value for a participant');
}
writeCsv('alt-week-8.csv', ['USUBJID', 'ARM', 'AVAL'], lab);

// Days on study, with discontinuation as the event.
const disposition = readCsv(path.join(source, 'site/data/adsl.csv'))
  .filter((row) => isStudyParticipant(row.USUBJID))
  .map((row) => {
    if (!['COMPLETED', 'DISCONTINUED'].includes(row.EOSSTT)) {
      throw new Error(`unexpected end-of-study status: ${row.EOSSTT}`);
    }
    return {
      USUBJID: row.USUBJID,
      ARM: row.ARM,
      DAYS: row.EOSDY,
      DISCONTINUED: row.EOSSTT === 'DISCONTINUED' ? 1 : 0
    };
  })
  .sort(byId);
writeCsv('days-on-study.csv', ['USUBJID', 'ARM', 'DAYS', 'DISCONTINUED'], disposition);

writeFileSync(
  path.join(outDir, 'SOURCE.md'),
  `# Where this data came from

Two small tables for the R check page, cut by [\`tools/cut-r-check-fixture.mjs\`](../../../tools/cut-r-check-fixture.mjs) from the public example data vendored in safety.viz at commit [\`${commit.slice(0, 7)}\`](https://github.com/jwildfire/safety.viz/tree/${commit}/site/data) of its \`dev\` branch.

| File | Rows | Cut from | What it holds |
| --- | ---: | --- | --- |
| \`alt-week-8.csv\` | ${lab.length} | \`site/data/adbds.csv\` | Alanine Aminotransferase at Week 8 for the Placebo and Xanomeline High Dose arms: participant, arm, value (U/L). |
| \`days-on-study.csv\` | ${disposition.length} | \`site/data/adsl.csv\` | Every participant in the safety population: participant, arm, day of end of study, and whether the participant discontinued (1) or completed (0). |

safety.viz builds those files from [pharmaverseadam](https://github.com/pharmaverse/pharmaverseadam), the pharmaverse consortium's ADaM test data, which is derived from the public CDISC SDTM/ADaM Pilot 01 study (\`CDISCPILOT01\`). pharmaverseadam is licensed [Apache-2.0](https://github.com/pharmaverse/pharmaverseadam/blob/main/LICENSE). How safety.viz derives its files is described in its [\`docs/DATA_SOURCES.md\`](https://github.com/jwildfire/safety.viz/blob/${commit}/docs/DATA_SOURCES.md).

Only rows of the published study are taken: the synthetic cohorts safety.viz appends to its lab file are left out. No value is changed. The data is public test data and describes no real participant's care.

Do not edit these files by hand; rerun the script.
`
);
console.log('✓ Wrote site/r-check/data/SOURCE.md');
