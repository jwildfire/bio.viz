import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { readChartSpecification } from '../../../src/specification.js';
import { DEFAULT_SETTINGS, syncSettings } from '../../../src/group-comparison/configure.js';
import { levelOf } from '../../../src/group-comparison/level.js';
import { SCHEMA_FILE } from '../../../tools/write-specification-schema.mjs';

// Specifications the released chart wrote (#84): bio.viz v0.2.0's own
// `chart.specification()`, for five views, written to a fixture by
// tools/write-released-specifications.mjs from the git tag. This version must
// still read them. What each then draws, and asks R, is tested in a browser.

const read = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const released = read('../../fixtures/group-comparison-specifications-0.2.0.json');
const validate = new Ajv2020({ allErrors: true }).compile(read(`../../../${SCHEMA_FILE}`));

describe('group comparison: a specification the released chart wrote', () => {
  it('GC-TILE-010: every specification bio.viz v0.2.0 wrote is read as it stands, held by this version’s schema, and taken by the chart’s settings; the two settings its overview paged by are read, the settings this version adds keep their defaults, and the one that names a biomarker and every visit opens on the biomarker over time (#84, #85)', () => {
    expect(released.made_by).toMatchObject({
      tool: 'tools/write-released-specifications.mjs',
      tag: 'v0.2.0',
      bio_viz_version: '0.2.0',
      bundle: 'dist/bio.viz-0.2.0/bio.viz.js'
    });
    expect(released.made_by.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(released.cases).toHaveLength(5);
    const added = [
      'unscheduled_visits',
      'unscheduled_visit_pattern',
      'unscheduled_visit_values',
      'tile_summary',
      'tile_min_spread',
      'time_mark',
      'statistic_by_visit',
      'visit_adjustment',
      // The difference grid (#86). The two settings the released overview paged
      // by, `overview_limit` and `page`, now page the grid, and are read as written.
      'opening_view',
      'grid_groups',
      'statistic_grid'
    ];
    // The visits of the study the released chart drew.
    const STUDY = ['Baseline', 'Week 2', 'Week 4', 'Week 8', 'Week 12'];
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
        // The level it opens on is the one the released chart drew at, but
        // for a biomarker at every visit: that was a panel per visit, and is
        // now the biomarker over time (#85).
        expect(
          levelOf(
            {
              measure: settings.start_value,
              valueType: settings.value_type,
              visits: settings.visits
            },
            STUDY
          ),
          entry.name
        ).toBe(
          entry.drew.overview
            ? 'biomarkers'
            : entry.name === 'one-biomarker-every-visit'
              ? 'over-time'
              : 'visits'
        );
      }
    }
    // The five views: one visit, a panel per visit, the overview on its first
    // page and on another, and one biomarker at every visit.
    expect(released.cases.map((entry) => [entry.name, entry.drew.panels.length])).toEqual([
      ['one-visit', 1],
      ['one-biomarker-two-visits', 2],
      ['every-biomarker', 0],
      ['every-biomarker-second-page', 0],
      ['one-biomarker-every-visit', 5]
    ]);
    expect(released.cases[4].specification.settings.visits).toEqual(STUDY);
    expect(released.cases[3].specification.settings).toMatchObject({ overview_limit: 4, page: 1 });
    expect(released.cases[3].drew.overview).toMatchObject({ page: 1, pages: 3 });
    // And what the released chart asked R, a question a panel.
    expect(released.cases.map((entry) => entry.asked.length)).toEqual([1, 2, 0, 0, 5]);
  });
});
