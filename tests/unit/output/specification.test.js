import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  FILTER_OPERATORS,
  SPECIFICATION_FORMAT,
  SPECIFICATION_VERSION,
  notData,
  readSpecification,
  writeSpecification
} from '../../../src/shared/specification.js';
import { fromSpecification, readChartSpecification } from '../../../src/specification.js';
import { SCHEMA_FILE, schemaText } from '../../../tools/write-specification-schema.mjs';
import { DEFAULT_SETTINGS as CROSS_TAB } from '../../../src/cross-tab/configure.js';
import { DEFAULT_SETTINGS as SURVIVAL } from '../../../src/stratified-survival/configure.js';

// A chart's specification (#68): written as JSON data, read with nothing
// evaluated, refused with a sentence when it is not what a chart has.

const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
const schema = JSON.parse(
  readFileSync(new URL(`../../../${SCHEMA_FILE}`, import.meta.url), 'utf8')
);
const validate = new Ajv2020({ allErrors: true }).compile(schema);
const CHARTS = { 'cross-tab': CROSS_TAB, 'stratified-survival': SURVIVAL };
const spec = (more = {}) => ({
  format: SPECIFICATION_FORMAT,
  format_version: SPECIFICATION_VERSION,
  bio_viz_version: pkg.version,
  chart: 'cross-tab',
  settings: { row_by: 'ARM', col_by: 'RESPONSE' },
  filters: [],
  ...more
});
const refusal = (make) => {
  try {
    make();
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    return error.message;
  }
  throw new Error('not refused');
};

describe('getting results out: specifications', () => {
  it('EXP-SPEC-001: a specification names its format, its version, the bio.viz version, the chart, every setting that is data and every filter in force as a column, an operator and values; the page’s connection and way back, and anything not data, are not written (#68)', () => {
    const written = writeSpecification({
      chart: 'cross-tab',
      version: pkg.version,
      settings: {
        ...CROSS_TAB,
        row_by: 'ARM',
        title: '{rows} by {columns}',
        connection: { run: () => null },
        back: { label: 'Back', action: () => null },
        cuts: [{ measure: 'CRP', visit: 'Baseline', cut: 'median' }]
      },
      filters: [
        { column: 'SEX', values: ['F'] },
        { column: 'AGE', values: [35, '57'] }
      ]
    });
    expect(Object.keys(written)).toEqual([
      'format',
      'format_version',
      'bio_viz_version',
      'chart',
      'settings',
      'filters'
    ]);
    expect(written).toMatchObject({
      format: 'bio.viz specification',
      format_version: 1,
      bio_viz_version: pkg.version,
      chart: 'cross-tab',
      filters: [
        { column: 'SEX', operator: 'in', values: ['F'] },
        { column: 'AGE', operator: 'in', values: [35, '57'] }
      ]
    });
    expect(Object.keys(written.settings)).not.toContain('connection');
    expect(Object.keys(written.settings)).not.toContain('back');
    expect(written.settings).toMatchObject({ row_by: 'ARM', title: '{rows} by {columns}' });
    // Every other setting is written, defaults and all.
    for (const key of Object.keys(CROSS_TAB).filter(
      (name) => !['connection', 'back'].includes(name)
    )) {
      expect(written.settings, key).toHaveProperty(key);
    }
    // What is written is JSON, and the schema holds it.
    expect(JSON.parse(JSON.stringify(written))).toEqual(written);
    expect(validate(written), JSON.stringify(validate.errors)).toBe(true);
    expect(FILTER_OPERATORS).toEqual(['in']);
  });

  it('EXP-SPEC-002: nothing in a specification is evaluated: code-like text in a setting or a filter is read as that text; a function, a number JSON cannot hold, undefined or an object that is not plain is refused with a sentence that says where it is (#68)', () => {
    const codeLike = {
      title: '${globalThis.pwned = 1}',
      subtitle: '<script>globalThis.pwned = 2</script>',
      footnotes: ['{{constructor.constructor("globalThis.pwned = 3")()}}', '`${n}`']
    };
    const text = JSON.stringify(
      spec({
        settings: { ...codeLike, row_by: 'ARM' },
        filters: [{ column: 'SEX', operator: 'in', values: ['${1+1}', '<b>F</b>'] }]
      })
    );
    const read = readSpecification(text, CHARTS);
    expect(read.settings).toMatchObject(codeLike);
    expect(read.settings.filters).toEqual([
      { value_col: 'SEX', start: ['${1+1}', '<b>F</b>'], multiple: true }
    ]);
    expect(globalThis.pwned).toBe(undefined);
    // A key that would reach an object's prototype is no setting.
    expect(
      refusal(() =>
        readSpecification(
          '{"format":"bio.viz specification","format_version":1,"chart":"cross-tab","settings":{"__proto__":{"row_by":"ARM"}}}',
          CHARTS
        )
      )
    ).toBe(
      'bio.viz: this specification of the cross-tab chart holds `__proto__`, which is not a setting of that chart in this version.'
    );
    for (const [value, said] of [
      [() => 'ARM', 'the specification.settings.row_by is a function, which is not data'],
      [Number.NaN, 'the specification.settings.row_by is NaN, which is not a number JSON holds'],
      [undefined, 'the specification.settings.row_by is undefined, which is not data'],
      [new Date(0), 'the specification.settings.row_by is a Date, which is not data']
    ]) {
      expect(
        refusal(() => readSpecification(spec({ settings: { row_by: value } }), CHARTS))
      ).toMatch(new RegExp(`^bio\\.viz: ${said.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    }
    expect(notData({ a: [1, 'b', { c: null }] }, 'x')).toBe(null);
    expect(refusal(() => readSpecification('{not json', CHARTS))).toMatch(
      /^bio\.viz: a specification given as text must be JSON: /
    );
  });

  it('EXP-SPEC-003: a specification is refused, with a sentence that names what is wrong, when it is not one, is of another format version, names a chart bio.viz does not have, holds a setting the chart does not have in this version, or a filter whose operator is not `in`; one written by another version is read when its settings are still settings (#68)', () => {
    expect(refusal(() => readSpecification(spec({ format: 'other' }), CHARTS))).toBe(
      'bio.viz: this is not a bio.viz specification: its `format` must be "bio.viz specification".'
    );
    expect(refusal(() => readSpecification(spec({ format_version: 2 }), CHARTS))).toBe(
      'bio.viz: this specification is of format version 2, and this version of bio.viz reads version 1.'
    );
    expect(refusal(() => readSpecification(spec({ chart: 'pie' }), CHARTS))).toBe(
      'bio.viz: this specification names the chart "pie", which bio.viz does not have. Its charts are cross-tab, stratified-survival.'
    );
    expect(
      refusal(() =>
        readSpecification(
          spec({ bio_viz_version: '9.0.0', settings: { row_by: 'ARM', margins: true, bins: 4 } }),
          CHARTS
        )
      )
    ).toBe(
      'bio.viz: this specification of the cross-tab chart, written by bio.viz 9.0.0, holds `margins`, `bins`, which are not settings of that chart in this version.'
    );
    expect(
      refusal(() => readSpecification(spec({ settings: { connection: null } }), CHARTS))
    ).toMatch(/holds `connection`, which is not a setting of that chart in this version\.$/);
    expect(
      refusal(() =>
        readSpecification(
          spec({ filters: [{ column: 'SEX', operator: '==', values: ['F'] }] }),
          CHARTS
        )
      )
    ).toBe(
      'bio.viz: filter 1, on SEX, has the operator "=="; the operators are "in": in, the values it lets through.'
    );
    expect(
      refusal(() =>
        readSpecification(
          spec({ filters: [{ column: 'SEX', operator: 'in', values: [] }] }),
          CHARTS
        )
      )
    ).toBe('bio.viz: filter 1, on SEX, must list the values it lets through: text or numbers.');
    expect(refusal(() => readSpecification(spec({ extra: 1 }), CHARTS))).toBe(
      'bio.viz: a specification has no `extra`: it holds format, format_version, bio_viz_version, chart, settings, filters.'
    );
    // Another version, whose settings are still settings, is read.
    const older = readSpecification(
      spec({
        bio_viz_version: '0.0.9',
        filters: [{ column: 'SEX', operator: 'in', values: ['F'] }]
      }),
      CHARTS
    );
    expect(older).toEqual({
      chart: 'cross-tab',
      version: '0.0.9',
      settings: { row_by: 'ARM', col_by: 'RESPONSE', filters: [{ value_col: 'SEX', start: 'F' }] }
    });
    // A filter in force lays where it starts onto the filter the settings offer.
    expect(
      readSpecification(
        spec({
          settings: { filters: [{ value_col: 'SEX', label: 'Sex' }, 'ARM'] },
          filters: [{ column: 'SEX', operator: 'in', values: ['M'] }]
        }),
        CHARTS
      ).settings.filters
    ).toEqual([{ value_col: 'SEX', label: 'Sex', start: 'M' }, 'ARM']);
    // The real charts' reader, and the chart's own sentence for a bad value.
    expect(readChartSpecification(spec()).chart).toBe('cross-tab');
    expect(refusal(() => fromSpecification(null, spec(), { title: 'x' }))).toBe(
      "bio.viz: fromSpecification takes the page's connection and back beside the specification, and `title` is not one: give it in the specification's settings."
    );
  });

  it('EXP-SPEC-004: the format has a JSON schema, committed and written from each chart’s own settings, so it names exactly the settings each chart has; it holds a written specification and refuses an unknown chart, an unknown setting of a chart, an unknown operator and a member that is not one (#68)', () => {
    expect(readFileSync(new URL(`../../../${SCHEMA_FILE}`, import.meta.url), 'utf8')).toBe(
      schemaText()
    );
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.properties.chart.enum).toEqual([
      'group-comparison',
      'association-scatter',
      'correlation-matrix',
      'biomarker-screen',
      'cross-tab',
      'stratified-survival'
    ]);
    expect(validate(spec())).toBe(true);
    for (const bad of [
      spec({ chart: 'pie' }),
      spec({ settings: { margins: true } }),
      spec({ chart: 'stratified-survival', settings: { row_by: 'ARM' } }),
      spec({ filters: [{ column: 'SEX', operator: '==', values: ['F'] }] }),
      spec({ filters: [{ column: 'SEX', operator: 'in', values: [] }] }),
      spec({ format_version: 2 }),
      spec({ extra: 1 })
    ]) {
      expect(validate(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
