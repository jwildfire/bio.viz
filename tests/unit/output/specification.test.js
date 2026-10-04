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
import {
  CHART_SETTINGS,
  fromSpecification,
  readChartSpecification
} from '../../../src/specification.js';
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
    // A key that would reach an object's prototype is no setting.
    expect(
      refusal(() =>
        readSpecification(
          '{"format":"bio.viz specification","format_version":1,"bio_viz_version":"0.1.0","chart":"cross-tab","settings":{"__proto__":{"row_by":"ARM"}}}',
          CHARTS
        )
      )
    ).toBe(
      'bio.viz: this specification of the cross-tab chart, written by bio.viz 0.1.0, holds `__proto__`, which is not a setting of that chart in this version.'
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
    // An empty list is a filter of several values emptied: it lets nobody through.
    expect(
      readSpecification(spec({ filters: [{ column: 'SEX', operator: 'in', values: [] }] }), CHARTS)
        .settings.filters
    ).toEqual([{ value_col: 'SEX', start: [], multiple: true }]);
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
      settings: { row_by: 'ARM', col_by: 'RESPONSE', filters: [{ value_col: 'SEX', start: 'F' }] },
      filters: [{ column: 'SEX', values: ['F'] }]
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
    expect(schema.properties.chart.enum).toEqual(Object.keys(CHART_SETTINGS));
    expect(validate(spec())).toBe(true);
    for (const bad of [
      spec({ chart: 'pie' }),
      spec({ settings: { margins: true } }),
      spec({ chart: 'stratified-survival', settings: { row_by: 'ARM' } }),
      spec({ filters: [{ column: 'SEX', operator: '==', values: ['F'] }] }),
      spec({ filters: [{ column: 'SEX', operator: 'in', values: ['F', 'F'] }] }),
      spec({ format_version: 2 }),
      spec({ extra: 1 })
    ]) {
      expect(validate(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('getting results out: what the #71 review found', () => {
  const refused = (make) => refusal(make);
  it('EXP-SPEC-017: reading a specification makes every check making the chart makes: a setting’s value the chart refuses is refused with the chart’s own sentence, and an empty selection the chart can draw is read (#71 review)', () => {
    expect(refused(() => readChartSpecification(spec({ settings: { percent: 'evil' } })))).toBe(
      'bio.viz: `percent` must be one of row, col, none.'
    );
    expect(refused(() => readChartSpecification(spec({ settings: { title: 42 } })))).toBe(
      'bio.viz: `title` must be text, which may hold placeholders such as {n}, or null for none.'
    );
    expect(
      readChartSpecification(spec({ chart: 'group-comparison', settings: { visits: [] } })).settings
        .visits
    ).toEqual([]);
    expect(
      readChartSpecification(
        spec({ chart: 'correlation-matrix', settings: { biomarkers: [], visits: [] } })
      ).settings.biomarkers
    ).toEqual([]);
  });

  it('EXP-SPEC-018: an object given as a specification is read once, own data properties only: a getter or a setter is refused, a Proxy’s traps run once each and the copy alone is checked, and nesting deeper than 64 is refused with a sentence (#71 review)', () => {
    const withGetter = spec();
    Object.defineProperty(withGetter.settings, 'row_by', { get: () => 'ARM', enumerable: true });
    expect(refused(() => readSpecification(withGetter, CHARTS))).toBe(
      'bio.viz: the specification.settings.row_by is a getter or a setter, which is not data: a specification holds only text, numbers, true, false, null, lists and objects.'
    );
    let reads = 0;
    const values = ['F'];
    const filter = new Proxy(
      { column: 'SEX', operator: 'in', values },
      {
        get(target, key) {
          if (key === 'values') reads += 1;
          return reads > 1 && key === 'values' ? [() => 'run'] : target[key];
        },
        getOwnPropertyDescriptor(target, key) {
          if (key === 'values') reads += 1;
          const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
          return reads > 1 && key === 'values'
            ? { ...descriptor, value: [() => 'run'] }
            : descriptor;
        }
      }
    );
    const read = readSpecification(spec({ filters: [filter] }), CHARTS);
    expect(reads).toBe(1);
    expect(read.settings.filters).toEqual([{ value_col: 'SEX', start: 'F' }]);
    let deep = 'end';
    for (let i = 0; i < 70; i += 1) deep = [deep];
    expect(refused(() => readSpecification(spec({ settings: { title: deep } }), CHARTS))).toBe(
      'bio.viz: the specification is nested more than 64 deep, which no chart’s settings are.'
    );
  });

  it('EXP-SPEC-019: `__proto__`, `constructor` and `prototype` are no column: a filter on one, or a setting that names one as its column, is refused by the reader and the schema (#71 review)', () => {
    for (const name of ['__proto__', 'constructor', 'prototype']) {
      const bad = spec({ filters: [{ column: name, operator: 'in', values: ['x'] }] });
      expect(refused(() => readSpecification(JSON.parse(JSON.stringify(bad)), CHARTS))).toBe(
        `bio.viz: filter 1 is on \`${name}\`, which is no column’s name.`
      );
      expect(validate(bad), name).toBe(false);
    }
    expect(
      refused(() => readChartSpecification(spec({ settings: { row_by: 'constructor' } })))
    ).toBe('bio.viz: `row_by` names `constructor`, which is no column’s name.');
  });

  it('EXP-SPEC-020: the reader and the schema agree: `bio_viz_version` is text, a filter names one column once with its values each once, a column’s name is not blank, `settings.filters` is a list or null, and the schema gives every setting’s default (#71 review)', () => {
    const cases = [
      [
        spec({ bio_viz_version: 1 }),
        'bio.viz: a specification’s `bio_viz_version` is text, the version that wrote it.'
      ],
      [
        spec({ bio_viz_version: undefined }),
        'bio.viz: a specification’s `bio_viz_version` is text, the version that wrote it.'
      ],
      [
        spec({ filters: [{ column: '  ', operator: 'in', values: ['F'] }] }),
        'bio.viz: filter 1 must name its column.'
      ],
      [
        spec({ filters: [{ column: 'SEX', operator: 'in', values: ['F', 'F'] }] }),
        'bio.viz: filter 1, on SEX, names F twice: a value is listed once.'
      ],
      [
        spec({ settings: { filters: 'SEX' } }),
        'bio.viz: the setting `filters` of a specification is a list of filters, or null.'
      ]
    ];
    for (const [bad, said] of cases) {
      const written = JSON.parse(JSON.stringify(bad));
      expect(
        refused(() => readSpecification(written, CHARTS)),
        said
      ).toBe(said);
      expect(validate(written), said).toBe(false);
    }
    for (const [chart, defaults] of Object.entries(CHART_SETTINGS)) {
      const named = schema.allOf.find((entry) => entry.if.properties.chart.const === chart);
      const settings = named.then.properties.settings.properties;
      for (const [key, value] of Object.entries(defaults)) {
        if (['connection', 'back'].includes(key)) continue;
        expect(settings[key], `${chart} ${key}`).toEqual({ default: value });
      }
    }
  });
});
