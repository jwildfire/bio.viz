import { describe, it, expect } from 'vitest';
import { syncSettings } from '../../../src/correlation-matrix/configure.js';
import {
  CELL_LEAST,
  NUMBERS_FROM,
  buildMatrix,
  cellSize,
  cellsOf,
  markOf,
  matrixVariables,
  numberOf,
  pairKey,
  pointsOf,
  shownCount,
  unitOfGrid
} from '../../../src/correlation-matrix/structureData.js';
import { frame } from '../../../src/core/index.js';
import { listMeasures, listVisits } from '../../../src/shared/tables.js';
import { participants, readStudyTable, results, written } from '../core/study.js';

// What the correlation matrix draws (#27), worked out from the vendored
// synthetic study with no page: the grid's variables, the frame R is handed,
// where each pair's cell is, and what a coefficient looks like as a mark.

const settings = syncSettings({ baseline_visits: 'Baseline' });
const tables = { results, participants };
const offered = {
  measures: listMeasures(results, settings),
  visits: listVisits(results, settings).all
};
const VIEW = {
  mode: 'biomarkers',
  visit: 'Baseline',
  biomarkers: null,
  measure: 'IL-6',
  visits: null,
  valueType: 'raw',
  filters: {}
};
const build = (view = {}, given = tables, config = settings) =>
  buildMatrix(given, config, { ...VIEW, ...view }, offered);
const labels = (model) => model.variables.map((entry) => entry.label);
const BIOMARKERS = [
  'CRP',
  'D-dimer',
  'Ferritin',
  'IFN-gamma',
  'IL-1beta',
  'IL-2',
  'IL-6',
  'IL-8',
  'IL-10',
  'LDH',
  'TNF-alpha',
  'VEGF'
];
// The fixture of thirty-six biomarkers (#17): more than the grid draws at a time.
const many = readStudyTable('../../../tests/e2e/fixtures/data/results-many-biomarkers.csv');
const manyOffered = {
  measures: listMeasures(many, settings),
  visits: listVisits(many, settings).all
};

describe('correlation matrix: the variables of the grid', () => {
  it('CM-DATA-001: across biomarkers the variables are the biomarkers chosen, in the control’s order, each at the one visit with the one value type, named v1, v2, … (#27)', () => {
    expect(offered.measures).toEqual(BIOMARKERS);
    const opening = build();
    expect(labels(opening)).toEqual(BIOMARKERS);
    expect(opening.variables.map((entry) => entry.name)).toEqual(
      BIOMARKERS.map((_, index) => `v${index + 1}`)
    );
    expect(opening).toMatchObject({
      chosen: 12,
      of: 'biomarkers',
      heading: 'Result at Baseline, biomarker against biomarker',
      message: null
    });
    for (const [index, entry] of opening.variables.entries()) {
      expect(entry.axis).toEqual({
        kind: 'measure',
        measure: BIOMARKERS[index],
        value: 'raw',
        visit: 'Baseline'
      });
    }
    // Those chosen are drawn in the control's order, whatever order they were chosen in.
    const three = build({ biomarkers: ['TNF-alpha', 'CRP', 'IL-10'], visit: 'Week 4' });
    expect(labels(three)).toEqual(['CRP', 'IL-10', 'TNF-alpha']);
    expect(three.variables.map((entry) => entry.name)).toEqual(['v1', 'v2', 'v3']);
    expect(three.variables.every((entry) => entry.axis.visit === 'Week 4')).toBe(true);
    expect(three.heading).toBe('Result at Week 4, biomarker against biomarker');
    // A baseline value is read with no visit, and the heading names none.
    const atBaseline = build({ valueType: 'baseline', visit: 'Week 4' });
    expect(atBaseline.heading).toBe('Baseline value, biomarker against biomarker');
    expect(atBaseline.variables[0].axis).toEqual({
      kind: 'measure',
      measure: 'CRP',
      value: 'baseline',
      visit: null
    });
    // The unit is printed only when every variable has the same one.
    expect(unitOfGrid(results, settings, opening.variables)).toBe(null);
    expect(unitOfGrid(results, settings, build({ biomarkers: ['IL-6', 'IL-10'] }).variables)).toBe(
      'pg/mL'
    );
    const week4 = (valueType) => build({ valueType, visit: 'Week 4' }).variables;
    expect(unitOfGrid(results, settings, week4('percent_change'))).toBe('%');
    expect(unitOfGrid(results, settings, week4('fold_change'))).toBe(null);
  });

  it('CM-DATA-002: across visits the variables are the visits chosen of one biomarker, in visit order; for a change the one baseline visit is left out and named, and a baseline value has nothing to relate (#27)', () => {
    expect(offered.visits).toEqual(['Baseline', 'Week 2', 'Week 4', 'Week 8', 'Week 12']);
    const across = build({ mode: 'visits' });
    expect(labels(across)).toEqual(offered.visits);
    expect(across).toMatchObject({
      chosen: 5,
      of: 'visits',
      heading: 'IL-6: result, visit against visit',
      notDrawn: [],
      message: null
    });
    expect(across.variables[2]).toEqual({
      name: 'v3',
      label: 'Week 4',
      axis: { kind: 'measure', measure: 'IL-6', value: 'raw', visit: 'Week 4' }
    });
    // Visit order, not the order they were chosen in.
    expect(labels(build({ mode: 'visits', visits: ['Week 12', 'Baseline', 'Week 4'] }))).toEqual([
      'Baseline',
      'Week 4',
      'Week 12'
    ]);
    // A change at the baseline visit is nought for everyone: it is no variable.
    for (const valueType of ['change', 'fold_change', 'percent_change']) {
      const changed = build({ mode: 'visits', valueType, measure: 'TNF-alpha' });
      expect(labels(changed), valueType).toEqual(['Week 2', 'Week 4', 'Week 8', 'Week 12']);
      expect(changed.variables[0].name).toBe('v1');
      expect(changed.notDrawn).toEqual(['Baseline']);
      expect(changed.chosen).toBe(4);
      expect(changed.baselineVisits).toEqual(['Baseline']);
    }
    expect(build({ mode: 'visits', valueType: 'change' }).heading).toBe(
      'IL-6: change from baseline, visit against visit'
    );
    // With no baseline named, it is the first visit that is left out.
    const unnamed = buildMatrix(
      tables,
      syncSettings(),
      { ...VIEW, mode: 'visits', valueType: 'change' },
      offered
    );
    expect(unnamed.notDrawn).toEqual(['Baseline']);
    // With two baseline visits their mean is not any one visit's value: both are variables.
    const two = buildMatrix(
      tables,
      syncSettings({ baseline_visits: ['Baseline', 'Week 2'] }),
      { ...VIEW, mode: 'visits', valueType: 'change' },
      offered
    );
    expect(labels(two)).toEqual(offered.visits);
    expect(two.notDrawn).toEqual([]);
    // A baseline value has no visit.
    const none = build({ mode: 'visits', valueType: 'baseline' });
    expect(none.variables).toEqual([]);
    expect(none.records).toEqual([]);
    expect(none.message).toBe(
      'A baseline value has no visit, so there is nothing to relate across visits. Choose ' +
        'another value, or relate biomarkers at one visit.'
    );
  });

  it('CM-DATA-004: with fewer than two variables, or for a change at the one baseline visit, there is no grid and the chart says why and what to choose (#27)', () => {
    const one = build({ biomarkers: ['IL-6'] });
    expect(one.records).toEqual([]);
    expect(one.message).toBe('Choose two or more biomarkers: a grid relates one to another.');
    expect(build({ mode: 'visits', visits: ['Week 4'] }).message).toBe(
      'Choose two or more visits: a grid relates one to another.'
    );
    // Two visits chosen, one of them the baseline of a change: one variable is left.
    expect(
      build({ mode: 'visits', valueType: 'change', visits: ['Baseline', 'Week 4'] }).message
    ).toBe('Choose two or more visits: a grid relates one to another.');
    const flat = build({ valueType: 'change' });
    expect(flat.variables).toEqual([]);
    expect(flat.notDrawn).toEqual(['Baseline']);
    expect(flat.message).toBe(
      'This value is a change at the baseline visit, where it is the same for everyone. ' +
        'Choose a later visit to draw.'
    );
    // Two are a grid.
    expect(build({ biomarkers: ['IL-6', 'CRP'] }).message).toBe(null);
    expect(matrixVariables(settings, { ...VIEW, biomarkers: ['IL-6', 'CRP'] }, offered)).toEqual(
      expect.objectContaining({ chosen: 2, message: null })
    );
  });
});

describe('correlation matrix: the frame', () => {
  it('CM-DATA-003: the frame is the core’s with none of the variables required: a participant with some of the values is kept with a gap, one with none is left out and counted, and the filters choose participants first (#27)', () => {
    const opening = build();
    expect(opening).toMatchObject({ participants: 200, empty: 0, filtered: 200 });
    expect(opening.records).toHaveLength(200);
    expect(Object.keys(opening.records[0])).toEqual([
      'USUBJID',
      ...BIOMARKERS.map((_, index) => `v${index + 1}`)
    ]);
    // A value is the participant's own result, as the file has it.
    for (const record of opening.records.slice(0, 20)) {
      BIOMARKERS.forEach((measure, index) => {
        expect(record[`v${index + 1}`]).toBe(Number(written(record.USUBJID, measure, 'Baseline')));
      });
    }
    // It is the core's frame, asked for with nothing required.
    const made = frame(
      tables,
      Object.fromEntries(
        opening.variables.map((entry) => [
          entry.name,
          { measure: entry.axis.measure, value: 'raw', visit: 'Baseline' }
        ])
      ),
      { baseline_visits: ['Baseline'], required: [] }
    );
    expect(opening.records).toEqual(made.data);

    // At Week 4 some participants have no result for some biomarkers: they are
    // kept, with a gap for each, so each pair has its own participants.
    const changed = build({ visit: 'Week 4', valueType: 'change' });
    expect(changed.participants).toBe(200);
    expect(changed.records).toHaveLength(187);
    expect(changed.empty).toBe(13);
    const names = changed.variables.map((entry) => entry.name);
    const gaps = changed.records.filter((record) => names.some((name) => record[name] === null));
    expect(gaps).toHaveLength(36);
    for (const record of gaps) {
      expect(names.some((name) => record[name] !== null)).toBe(true);
    }
    // The first participant has no D-dimer at Week 4, and every other value.
    const first = changed.records[0];
    expect(first.USUBJID).toBe('BIO-001');
    expect(written('BIO-001', 'D-dimer', 'Week 4')).toBe('');
    expect(first.v2).toBe(null);
    expect(names.filter((name) => first[name] === null)).toEqual(['v2']);
    // The 13 left out have no result at Week 4 for any biomarker.
    const kept = new Set(changed.records.map((record) => record.USUBJID));
    const left = participants.filter((row) => !kept.has(row.USUBJID));
    expect(left).toHaveLength(13);
    for (const row of left) {
      for (const measure of BIOMARKERS) {
        expect(written(row.USUBJID, measure, 'Week 4') || '').toBe('');
      }
    }
    // A pair's points are the participants who have both of its values.
    const [first2, second] = changed.variables;
    const points = pointsOf(changed.records, first2, second);
    expect(points).toHaveLength(
      changed.records.filter((record) => record.v1 !== null && record.v2 !== null).length
    );
    expect(points).toHaveLength(177);
    // The column's variable is along the bottom and the row's up the side.
    const whole = changed.records.find((record) => record.v1 !== null && record.v2 !== null);
    expect(points[0]).toEqual({ x: whole.v1, y: whole.v2 });

    // A filter chooses participants before the frame is made.
    const women = build({ filters: { SEX: 'F' } });
    expect(women).toMatchObject({ participants: 91, filtered: 91, empty: 0 });
    expect(women.records).toHaveLength(91);
    const sexOf = new Map(participants.map((row) => [row.USUBJID, row.SEX]));
    expect(women.records.every((record) => sexOf.get(record.USUBJID) === 'F')).toBe(true);
    // With the results table alone there is nobody to filter, and the frame is the same.
    const alone = build({}, { results });
    expect(alone.filtered).toBe(null);
    expect(alone.records).toEqual(opening.records);
  });
});

describe('correlation matrix: how many variables are drawn', () => {
  it('CM-LIMIT-001: no more than `limit` variables are drawn, the first of those chosen, and the chart says how many of how many and how to bring others in; thirty-six biomarkers open on twelve (#27)', () => {
    expect(manyOffered.measures).toHaveLength(36);
    const state = { ...VIEW };
    const drawn = buildMatrix({ results: many, participants }, settings, state, manyOffered);
    expect(labels(drawn)).toEqual(manyOffered.measures.slice(0, 12));
    expect(drawn.chosen).toBe(36);
    expect(drawn.variables.at(-1).name).toBe('v12');
    expect(shownCount(drawn, settings.limit)).toBe(
      '12 of 36 biomarkers shown: the first 12 of those chosen, in the Biomarkers control’s ' +
        'order. The grid draws at most 12 at a time: untick biomarkers under Biomarkers to bring ' +
        'others in.'
    );
    // Unticking the first three brings the next three in.
    const later = buildMatrix(
      { results: many, participants },
      settings,
      { ...state, biomarkers: manyOffered.measures.slice(3) },
      manyOffered
    );
    expect(labels(later)).toEqual(manyOffered.measures.slice(3, 15));
    expect(later.chosen).toBe(33);
    // The limit is a setting.
    for (const limit of [2, 6, 24, 36, 50]) {
      const config = syncSettings({ baseline_visits: 'Baseline', limit });
      const model = buildMatrix({ results: many, participants }, config, state, manyOffered);
      expect(model.variables, String(limit)).toHaveLength(Math.min(limit, 36));
      expect(shownCount(model, limit)).toMatch(
        limit >= 36 ? /^All 36 biomarkers chosen are shown\.$/ : new RegExp(`^${limit} of 36 `)
      );
    }
    // With no more chosen than the limit, all are shown, and it says so.
    expect(shownCount(build(), 12)).toBe('All 12 biomarkers chosen are shown.');
    expect(shownCount(build({ mode: 'visits' }), 12)).toBe('All 5 visits chosen are shown.');
    // The limit holds across visits as well, in visit order.
    const three = buildMatrix(
      tables,
      syncSettings({ baseline_visits: 'Baseline', limit: 3 }),
      { ...VIEW, mode: 'visits' },
      offered
    );
    expect(labels(three)).toEqual(['Baseline', 'Week 2', 'Week 4']);
    expect(shownCount(three, 3)).toBe(
      '3 of 5 visits shown: the first 3 of those chosen, in the Visits control’s order. The ' +
        'grid draws at most 3 at a time: untick visits under Visits to bring others in.'
    );
    // On the fixture only the participants with a value are in the frame.
    expect(drawn).toMatchObject({ participants: 200, empty: 160 });
    expect(drawn.records).toHaveLength(40);
  });

  it('CM-LIMIT-003: a cell is as wide as the room allows, between 18 pixels and 72; below 34 it cannot hold a number (#27)', () => {
    expect([CELL_LEAST, NUMBERS_FROM]).toEqual([18, 34]);
    // At a desk, about 920 pixels: twelve hold their numbers, twenty-four and thirty-six do not.
    expect(cellSize(920, 12)).toBe(72);
    expect(cellSize(920, 24)).toBe(38);
    expect(cellSize(894, 24)).toBeGreaterThanOrEqual(NUMBERS_FROM);
    expect(cellSize(770, 24)).toBeLessThan(NUMBERS_FROM);
    expect(cellSize(920, 36)).toBe(25);
    // On a phone, about 250 pixels: six hold their numbers, twelve do not.
    expect(cellSize(250, 6)).toBeGreaterThanOrEqual(NUMBERS_FROM);
    expect(cellSize(250, 12)).toBe(20);
    expect(cellSize(250, 12)).toBeLessThan(NUMBERS_FROM);
    // Never narrower than a target a finger or a pointer can find, never wider than it need be.
    expect(cellSize(250, 36)).toBe(CELL_LEAST);
    expect(cellSize(0, 12)).toBe(CELL_LEAST);
    expect(cellSize(2000, 3)).toBe(72);
    expect(cellSize(900, 6, 150)).toBe(150);
    // The cells grow as the square of the variables.
    for (const [count, pairs] of [
      [12, 66],
      [24, 276],
      [36, 630]
    ]) {
      const cells = cellsOf(Array.from({ length: count }, (_, index) => ({ name: `v${index}` })));
      expect(new Set(cells.flat().map((cell) => cell.key)).size - 1).toBe(pairs);
    }
  });
});

describe('correlation matrix: the cells and a mark', () => {
  it('CM-DATA-005: every pair has a cell on each side of the diagonal, a number above it and a mark below, the diagonal holds nothing, and a pair is found by its variables in either order (#27)', () => {
    const variables = ['v1', 'v2', 'v3', 'v4'].map((name) => ({ name, label: name }));
    const cells = cellsOf(variables);
    expect(cells.map((row) => row.map((cell) => cell.side[0])).map((row) => row.join(''))).toEqual([
      'dnnn',
      'mdnn',
      'mmdn',
      'mmmd'
    ]);
    expect(cells[1][3]).toEqual({ row: 1, column: 3, side: 'number', key: pairKey('v2', 'v4') });
    expect(cells[3][1]).toEqual({ row: 3, column: 1, side: 'mark', key: pairKey('v2', 'v4') });
    expect(cells[2][2]).toEqual({ row: 2, column: 2, side: 'diagonal', key: null });
    expect(pairKey('v9', 'v11')).toBe(pairKey('v11', 'v9'));
    expect(pairKey('v1', 'v12')).not.toBe(pairKey('v11', 'v2'));
    // Each pair once on each side, and nothing else.
    const keys = cells.flat().filter((cell) => cell.key);
    expect(keys).toHaveLength(12);
    for (const side of ['number', 'mark']) {
      const on = keys.filter((cell) => cell.side === side).map((cell) => cell.key);
      expect(new Set(on).size).toBe(6);
      expect(on).toHaveLength(6);
    }
  });

  it('CM-DATA-006: a mark’s width and darkness grow with the size of R’s coefficient, equally for either sign, so it reads without colour; the sign is the hue and the shape; a number is to two decimals with a true minus (#27)', () => {
    expect(markOf(0.5)).toEqual({ sign: 'positive', size: 53, color: 'hsl(217, 78%, 59%)' });
    expect(markOf(-0.5)).toEqual({ sign: 'negative', size: 53, color: 'hsl(18, 82%, 59%)' });
    expect(markOf(0)).toEqual({ sign: 'positive', size: 14, color: 'hsl(217, 78%, 86%)' });
    expect(markOf(1)).toEqual({ sign: 'positive', size: 92, color: 'hsl(217, 78%, 32%)' });
    expect(markOf(-1)).toEqual({ sign: 'negative', size: 92, color: 'hsl(18, 82%, 32%)' });
    const lightness = (mark) => Number(mark.color.match(/(\d+)%\)$/)[1]);
    const hue = (mark) => Number(mark.color.match(/^hsl\((\d+),/)[1]);
    const steps = Array.from({ length: 101 }, (_, index) => index / 100);
    let last = null;
    for (const strength of steps) {
      const [positive, negative] = [markOf(strength), markOf(-strength)];
      // In greyscale the two signs of one size are the same grey and the same
      // width: what tells them apart without colour is the shape.
      expect(positive.size).toBe(negative.size);
      expect(lightness(positive)).toBe(lightness(negative));
      if (strength > 0) {
        expect([positive.sign, negative.sign]).toEqual(['positive', 'negative']);
        expect([hue(positive), hue(negative)]).toEqual([217, 18]);
      }
      // Wider and darker with every step, never the other way.
      if (last) {
        expect(positive.size).toBeGreaterThanOrEqual(last.size);
        expect(lightness(positive)).toBeLessThanOrEqual(lightness(last));
      }
      last = positive;
    }
    // From nought to one a mark is distinctly wider and darker.
    expect(markOf(1).size - markOf(0).size).toBe(78);
    expect(lightness(markOf(0)) - lightness(markOf(1))).toBe(54);
    // A coefficient is from −1 to 1; one beyond is drawn as the limit.
    expect(markOf(1.2)).toEqual(markOf(1));
    // The mark is a function of the one coefficient: the same in, the same out.
    expect(markOf(0.6383822572068255)).toEqual(markOf(0.6383822572068255));
    expect(markOf(0.6383822572068255)).toEqual({
      sign: 'positive',
      size: 64,
      color: 'hsl(217, 78%, 52%)'
    });

    expect(numberOf(0.6383822572068255)).toBe('0.64');
    expect(numberOf(-0.12736757689949876)).toBe('−0.13');
    expect(numberOf(-0.004)).toBe('0.00');
    expect(numberOf(0)).toBe('0.00');
    expect(numberOf(1)).toBe('1.00');
    expect(numberOf(-1)).toBe('−1.00');
  });
});
