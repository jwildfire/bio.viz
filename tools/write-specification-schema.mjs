// Writes src/data/specification.schema.json, the JSON schema of a chart's
// specification (#68), from each chart's own settings: which charts there are,
// and which settings each has. `node tools/write-specification-schema.mjs`
// writes it; `--check` fails when the committed file is not what it would
// write. The unit tests check it too, so continuous integration does.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS as groupComparison } from '../src/group-comparison/configure.js';
import { DEFAULT_SETTINGS as associationScatter } from '../src/association-scatter/configure.js';
import { DEFAULT_SETTINGS as correlationMatrix } from '../src/correlation-matrix/configure.js';
import { DEFAULT_SETTINGS as biomarkerScreen } from '../src/biomarker-screen/configure.js';
import { DEFAULT_SETTINGS as crossTab } from '../src/cross-tab/configure.js';
import { DEFAULT_SETTINGS as stratifiedSurvival } from '../src/stratified-survival/configure.js';
import {
  FILTER_OPERATORS,
  PAGE_SETTINGS,
  SPECIFICATION_FORMAT,
  SPECIFICATION_VERSION
} from '../src/shared/specification.js';

export const SCHEMA_FILE = 'src/data/specification.schema.json';

const CHARTS = {
  'group-comparison': groupComparison,
  'association-scatter': associationScatter,
  'correlation-matrix': correlationMatrix,
  'biomarker-screen': biomarkerScreen,
  'cross-tab': crossTab,
  'stratified-survival': stratifiedSurvival
};

/** The schema, as an object. */
export function specificationSchema() {
  const settingsOf = (defaults) =>
    Object.keys(defaults).filter((key) => !PAGE_SETTINGS.includes(key));
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://jwildfire.github.io/bio.viz/schema/specification.json',
    title: 'bio.viz chart specification',
    description:
      'A bio.viz chart written as data: the chart, the bio.viz version that wrote it, its settings and the filters in force. Nothing in it is evaluated. Written by tools/write-specification-schema.mjs from each chart’s settings; documented in docs/output.md.',
    type: 'object',
    required: ['format', 'format_version', 'chart'],
    additionalProperties: false,
    properties: {
      format: { const: SPECIFICATION_FORMAT },
      format_version: { const: SPECIFICATION_VERSION },
      bio_viz_version: { type: 'string', description: 'The bio.viz version that wrote it.' },
      chart: { enum: Object.keys(CHARTS) },
      settings: {
        type: 'object',
        description: 'Settings of the chart, by name; a setting left out keeps its default.',
        additionalProperties: { $ref: '#/$defs/data' }
      },
      filters: {
        type: 'array',
        description: 'The filters in force.',
        items: { $ref: '#/$defs/filter' }
      }
    },
    allOf: Object.entries(CHARTS).map(([chart, defaults]) => ({
      if: { properties: { chart: { const: chart } }, required: ['chart'] },
      then: {
        properties: { settings: { propertyNames: { enum: settingsOf(defaults) } } }
      }
    })),
    $defs: {
      data: {
        description: 'Data only: text, a number, true, false, null, a list or an object of these.',
        type: ['null', 'boolean', 'number', 'string', 'array', 'object'],
        items: { $ref: '#/$defs/data' },
        additionalProperties: { $ref: '#/$defs/data' }
      },
      filter: {
        type: 'object',
        required: ['column', 'operator', 'values'],
        additionalProperties: false,
        properties: {
          column: { type: 'string', minLength: 1 },
          operator: { enum: [...FILTER_OPERATORS] },
          values: { type: 'array', minItems: 1, items: { type: ['string', 'number'] } }
        }
      }
    }
  };
}

export const schemaText = () => `${JSON.stringify(specificationSchema(), null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = new URL(`../${SCHEMA_FILE}`, import.meta.url);
  if (process.argv.includes('--check')) {
    if (readFileSync(file, 'utf8') !== schemaText()) {
      console.error(`✗ ${SCHEMA_FILE} is not what tools/write-specification-schema.mjs writes. Run it.`);
      process.exit(1);
    }
    console.log(`✓ ${SCHEMA_FILE} is what the charts' settings make.`);
  } else {
    writeFileSync(file, schemaText());
    console.log(`✓ Wrote ${SCHEMA_FILE}`);
  }
}
