import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import * as bioViz from '../../../src/main.js';
import { PORTFOLIO_SCHEMA, readRecord, verifyVendored } from '../../../scripts/vendor-lib.mjs';
import * as groupComparison from '../../../src/group-comparison/configure.js';
import * as associationScatter from '../../../src/association-scatter/configure.js';
import * as correlationMatrix from '../../../src/correlation-matrix/configure.js';
import * as biomarkerScreen from '../../../src/biomarker-screen/configure.js';
import * as crossTab from '../../../src/cross-tab/configure.js';

// The chart list (#32, obot.roadmap#366): bio.viz's charts in safety.viz's
// portfolio manifest format, version 2, so safety.viz's demo app can list and
// draw them beside its own. The format is safety.viz's; its schema is copied
// here with a record of the commit, and nothing about it is redefined. The
// list is useful only while it agrees with the charts, so the agreement is a
// test: add a chart, rename a column setting or change its default, and this
// file fails until the list says the same thing.

const read = (relative) =>
  JSON.parse(readFileSync(new URL(`../../../${relative}`, import.meta.url), 'utf8'));
const pkg = read('package.json');
const manifest = read('src/data/portfolio.json');
const schemaDir = fileURLToPath(new URL(`../../../${PORTFOLIO_SCHEMA.directory}`, import.meta.url));
const schema = read(`${PORTFOLIO_SCHEMA.directory}/portfolio.json`);
const config = read('site/config.json');
const distUrl = (file) => new URL(`../../../dist/bio.viz-${pkg.version}/${file}`, import.meta.url);

// What each chart's settings are, from its own configuration.
const CONFIGURATIONS = {
  'group-comparison': groupComparison,
  'association-scatter': associationScatter,
  'correlation-matrix': correlationMatrix,
  'biomarker-screen': biomarkerScreen,
  'cross-tab': crossTab
};

// The column-name settings a chart declares, by safety.viz's rule for its own
// schemas (scripts/portfolio-lib.mjs there): every setting whose key ends in
// `_col` or carries `_col_`.
const columnSettings = (defaults) => Object.keys(defaults).filter((key) => /_col(_|$)/.test(key));

// A setting is required when the chart refuses to be made without a column for it.
const refusesNull = (configuration, key) => {
  try {
    configuration.syncSettings({ [key]: null });
    return false;
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    return true;
  }
};

// The available charts, but for one that says why it is left out of the list.
const charts = config.modules.filter(
  (entry) => entry.kind === 'chart' && entry.status === 'available' && entry.portfolio !== false
);
const leftOut = config.modules.filter((entry) => entry.portfolio === false);
const exportName = (module) => module.replace(/-(\w)/g, (match, letter) => letter.toUpperCase());

describe('the chart list', () => {
  it('CORE-MAN-001: BioViz.portfolio is the chart list, the same object in the source and in both committed bundles (#32)', async () => {
    expect(bioViz.portfolio).toEqual(manifest);
    expect(manifest.version).toBe(2);
    const context = {};
    vm.runInNewContext(readFileSync(distUrl('bio.viz.js'), 'utf8'), context);
    expect(JSON.parse(JSON.stringify(context.BioViz.portfolio))).toEqual(manifest);
    const esm = await import(/* @vite-ignore */ distUrl('bio.viz.esm.js').href);
    expect(esm.portfolio).toEqual(manifest);
  });

  it('CORE-MAN-002: the chart list validates against safety.viz’s manifest schema at the recorded commit (#32)', () => {
    const validate = new Ajv2020({ allErrors: true }).compile(schema);
    const valid = validate(manifest);
    expect(validate.errors || []).toEqual([]);
    expect(valid).toBe(true);
    expect(manifest.$schema).toBe('./schema/portfolio.json');
    // The check fails on a list that breaks the format: an entry with a setting
    // the format does not know, and a table read from no standard domain.
    const broken = structuredClone(manifest);
    broken.modules['group-comparison'].settings.id_col.default = 'USUBJID';
    broken.modules['group-comparison'].tables.results.domain = 'results';
    expect(validate(broken)).toBe(false);
  });

  it('CORE-MAN-003: the copied schema matches its record, which names safety.viz’s dev branch and a commit on it (#32)', () => {
    expect(verifyVendored(schemaDir)).toEqual([]);
    const record = readRecord(schemaDir);
    expect(record).toMatchObject({
      schema: PORTFOLIO_SCHEMA.name,
      repository: 'https://github.com/jwildfire/safety.viz',
      ref: 'dev',
      merged_to_dev: true
    });
    expect(record.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(record.files.map((entry) => [entry.file, entry.source])).toEqual([
      ['portfolio.json', 'src/data/schema/portfolio.json']
    ]);
    // Version 2 is the format this list is written in.
    expect(schema.properties.version.enum).toContain(2);
  });

  it('CORE-MAN-004: there is one entry for each available chart in site/config.json, under its title and its export, and no other (#32)', () => {
    expect(Object.keys(manifest.modules)).toEqual(charts.map((entry) => entry.module));
    for (const chart of charts) {
      const entry = manifest.modules[chart.module];
      expect(entry.title, chart.module).toBe(chart.title);
      expect(entry.export, chart.module).toBe(exportName(chart.module));
      expect(typeof bioViz[entry.export], chart.module).toBe('function');
    }
    // Every chart the bundle exports is listed, but for one the registry says
    // is left out, and says why.
    // `fromSpecification` (#68) makes whichever chart a specification names; it
    // is no chart of its own.
    const exported = Object.keys(bioViz).filter(
      (key) => typeof bioViz[key] === 'function' && key !== 'fromSpecification'
    );
    expect(Object.values(manifest.modules).map((entry) => entry.export)).toEqual(
      exported.filter((name) => !leftOut.some((entry) => exportName(entry.module) === name))
    );
    expect(leftOut.map((entry) => entry.module)).toEqual(['stratified-survival']);
    expect(leftOut[0].portfolioNote).toMatch(/outcomes table/);
  });

  it('CORE-MAN-004: every entry names bio.viz, is listed in the declared biomarker group, and takes the results table from labs and vitals and the participant table, optional, from the subject-level file (#32)', () => {
    expect(manifest.groups).toEqual({ biomarkers: { label: 'Biomarkers', order: 0 } });
    expect(manifest.domains).toBe(undefined);
    for (const [module, entry] of Object.entries(manifest.modules)) {
      expect(entry, module).toMatchObject({
        library: pkg.name,
        group: 'biomarkers',
        domains: ['bds'],
        optionalDomains: ['subject'],
        tables: {
          results: { domain: 'bds', required: true },
          participants: { domain: 'subject', required: false }
        }
      });
      // The tables' domains are the entry's domains, as safety.viz's app checks.
      const tables = Object.values(entry.tables);
      expect(tables.filter((table) => table.required).map((table) => table.domain)).toEqual(
        entry.domains
      );
      expect(tables.filter((table) => !table.required).map((table) => table.domain)).toEqual(
        entry.optionalDomains
      );
    }
  });

  it('CORE-MAN-005: each entry’s settings are its chart’s column-name settings, with the chart’s defaults, required where the chart refuses no column (#32)', () => {
    for (const [module, entry] of Object.entries(manifest.modules)) {
      const configuration = CONFIGURATIONS[module];
      expect(configuration, `${module} has no configuration in this test`).toBeTruthy();
      const defaults = configuration.DEFAULT_SETTINGS;
      expect(Object.keys(entry.settings), module).toEqual(columnSettings(defaults));
      for (const [key, setting] of Object.entries(entry.settings)) {
        const where = `${module}.${key}`;
        expect(setting.required, where).toBe(refusesNull(configuration, key));
        if (key === 'participant_id_col') {
          // Its default, null, means the participant table names the participant
          // as the results table does. In the list that is the same standard
          // column, read from the subject-level file, so the app passes the
          // subject-level file's own name for it when the two files differ.
          expect(defaults[key], where).toBe(null);
          expect(setting, where).toEqual({
            domain: 'subject',
            column: entry.settings.id_col.column,
            required: false
          });
          continue;
        }
        expect(setting.column, where).toBe(defaults[key]);
        expect(setting.domain, where).toBe('bds');
      }
    }
  });

  it('CORE-MAN-005: a chart that refuses a null column is passed nothing for an unmapped one (#32)', () => {
    for (const [module, entry] of Object.entries(manifest.modules)) {
      const configuration = CONFIGURATIONS[module];
      const refuses = Object.keys(entry.settings).some((key) => refusesNull(configuration, key));
      expect(refuses, module).toBe(true);
      expect(entry.unmappedSettings, module).toBe('omit');
    }
  });
});
