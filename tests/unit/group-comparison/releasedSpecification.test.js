import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { readChartSpecification } from '../../../src/specification.js';
import { DEFAULT_SETTINGS, syncSettings } from '../../../src/group-comparison/configure.js';
import { levelOf } from '../../../src/group-comparison/level.js';
import { SCHEMA_FILE } from '../../../tools/write-specification-schema.mjs';

// Specifications the released chart wrote (#84): bio.viz v0.2.0's own
// `chart.specification()`, for four views, written to a fixture by
// tools/write-released-specifications.mjs from the git tag. This version must
// still read them. What each then draws, and asks R, is tested in a browser.

const read = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const released = read('../../fixtures/group-comparison-specifications-0.2.0.json');
const validate = new Ajv2020({ allErrors: true }).compile(read(`../../../${SCHEMA_FILE}`));

describe('group comparison: a specification the released chart wrote', () => {
  it('GC-TILE-010: every specification bio.viz v0.2.0 wrote is read as it stands, held by this version’s schema, and taken by the chart’s settings; the two settings its overview paged by are read, and the settings this version adds keep their defaults (#84)', () => {
    expect(released.made_by).toMatchObject({
      tool: 'tools/write-released-specifications.mjs',
      tag: 'v0.2.0',
      bio_viz_version: '0.2.0',
      bundle: 'dist/bio.viz-0.2.0/bio.viz.js'
    });
    expect(released.made_by.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(released.cases).toHaveLength(4);
    const added = [
      'unscheduled_visits',
      'unscheduled_visit_pattern',
      'unscheduled_visit_values',
      'tile_summary',
      'tile_min_spread'
    ];
    for (const entry of released.cases) {
      const { specification } = entry;
      expect(specification.bio_viz_version, entry.name).toBe('0.2.0');
      expect(specification.chart).toBe('group-comparison');
      // The released chart knew none of what this version adds.
      for (const key of added) expect(specification.settings).not.toHaveProperty(key);
      expect(specification.settings).toHaveProperty('overview_limit');
      expect(specification.settings).toHaveProperty('page');

      expect(validate(specification), JSON.stringify(validate.errors)).toBe(true);
      // Read as an object and as its JSON text alike, with nothing refused.
      for (const given of [specification, JSON.stringify(specification)]) {
        const found = readChartSpecification(given);
        expect(found.chart).toBe('group-comparison');
        expect(found.version).toBe('0.2.0');
        const settings = syncSettings(found.settings);
        for (const key of added) expect(settings[key], key).toEqual(DEFAULT_SETTINGS[key]);
        expect(settings.overview_limit).toBe(specification.settings.overview_limit);
        expect(settings.page).toBe(specification.settings.page);
        // The level it opens on is the one the released chart drew at.
        expect(levelOf({ measure: settings.start_value }), entry.name).toBe(
          entry.drew.overview ? 'biomarkers' : 'visits'
        );
      }
    }
    // The four views: one visit, a panel per visit, and the overview on its
    // first page and on another.
    expect(released.cases.map((entry) => [entry.name, entry.drew.panels.length])).toEqual([
      ['one-visit', 1],
      ['one-biomarker-two-visits', 2],
      ['every-biomarker', 0],
      ['every-biomarker-second-page', 0]
    ]);
    expect(released.cases[3].specification.settings).toMatchObject({ overview_limit: 4, page: 1 });
    expect(released.cases[3].drew.overview).toMatchObject({ page: 1, pages: 3 });
    // And what the released chart asked R, a question a panel.
    expect(released.cases.map((entry) => entry.asked.length)).toEqual([1, 2, 0, 0]);
  });
});
