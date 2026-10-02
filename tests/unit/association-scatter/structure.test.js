import { describe, it, expect } from 'vitest';
import { syncSettings } from '../../../src/association-scatter/configure.js';
import {
  VARIABLE_WORDS,
  axisOf,
  axisOffered,
  axisTitle,
  brushed,
  buildScatter,
  domainOf,
  flatAtBaseline,
  identityLine,
  numberColumns,
  openingAxes,
  plotted,
  sameAxis,
  settingOf,
  variableOf
} from '../../../src/association-scatter/structureData.js';
import { DROPPED, frame } from '../../../src/core/index.js';
import { categoryColumns, listMeasures, listVisits } from '../../../src/shared/tables.js';
import { participants, results, written } from '../core/study.js';

// What the association scatter draws (#26), worked out from the vendored
// synthetic study with no page: the points of each panel, who was left out and
// why, where the axes run, the line y = x and the participants of a region.

const settings = syncSettings({ baseline_visits: 'Baseline' });
const tables = { results, participants };
const at = (measure, visit, value = 'raw') => ({ kind: 'measure', measure, value, visit });
const PLANTED = {
  x: at('TNF-alpha', 'Baseline'),
  y: at('IL-10', 'Baseline'),
  colorBy: '',
  panelBy: '',
  xScale: 'linear',
  yScale: 'linear',
  filters: {}
};
const build = (view = {}, given = tables, config = settings) =>
  buildScatter(given, config, { ...PLANTED, ...view });
const offered = {
  measures: listMeasures(results, settings),
  visits: listVisits(results, settings).all,
  numbers: numberColumns(tables, settings)
};

describe('association scatter: the points', () => {
  it('AS-DATA-001: one point per participant, from the core’s frame with x and y as two variables; a participant missing either is left out and counted by reason and by axis (#26)', () => {
    const planted = build();
    expect(planted.panels).toHaveLength(1);
    expect(planted.participants).toBe(200);
    expect(planted.drawn).toBe(200);
    expect(planted.dropped).toEqual([]);
    const [panel] = planted.panels;
    expect(new Set(panel.records.map((record) => record.USUBJID)).size).toBe(200);
    // A point is the participant's own two results, as the file has them.
    for (const record of panel.records.slice(0, 25)) {
      expect(record.x).toBe(Number(written(record.USUBJID, 'TNF-alpha', 'Baseline')));
      expect(record.y).toBe(Number(written(record.USUBJID, 'IL-10', 'Baseline')));
    }
    // The rows are the core's frame of the two variables, and nothing else.
    const framed = frame(
      tables,
      {
        x: { measure: 'TNF-alpha', visit: 'Baseline' },
        y: { measure: 'IL-10', visit: 'Baseline' }
      },
      { baseline_visits: ['Baseline'] }
    );
    expect(panel.records).toEqual(framed.data);

    // The same biomarker at two visits: a participant with no result at either
    // is left out once, under the first axis that could not be worked out.
    const visits = build({ x: at('IL-6', 'Week 4'), y: at('IL-6', 'Week 12') });
    expect(visits.participants).toBe(200);
    expect(visits.dropped).toEqual([
      { reason: DROPPED.NO_RESULT, variable: 'x', n: 13 },
      { reason: DROPPED.MISSING_RESULT, variable: 'x', n: 1 },
      { reason: DROPPED.NO_RESULT, variable: 'y', n: 12 },
      { reason: DROPPED.MISSING_RESULT, variable: 'y', n: 4 }
    ]);
    expect(visits.drawn).toBe(200 - 13 - 1 - 12 - 4);
    expect(visits.panels[0].records).toHaveLength(visits.drawn);
    expect(VARIABLE_WORDS).toEqual({ x: 'x axis', y: 'y axis', color: 'colour', panel: 'panel' });
  });

  it('AS-DATA-002: either axis is a biomarker at a visit with any value type, or a participant-level number (#26)', () => {
    const model = build({
      x: { kind: 'column', col: 'AGE' },
      y: at('IL-6', 'Week 4', 'change')
    });
    expect(model.drawn).toBe(186);
    expect(model.baselineVisits).toEqual(['Baseline']);
    const byId = new Map(participants.map((row) => [row.USUBJID, row]));
    for (const record of model.panels[0].records.slice(0, 25)) {
      // The age is a number, read from the participant table's text.
      expect(record.x).toBe(Number(byId.get(record.USUBJID).AGE));
      expect(record.y).toBeCloseTo(
        Number(written(record.USUBJID, 'IL-6', 'Week 4')) -
          Number(written(record.USUBJID, 'IL-6', 'Baseline')),
        12
      );
    }
    // And the other way about, with a baseline value, which has no visit.
    const turned = build({ x: at('CRP', null, 'baseline'), y: { kind: 'column', col: 'BMIBL' } });
    expect(turned.drawn).toBe(200);
    expect(turned.panels[0].records[0].x).toBe(Number(written('BIO-001', 'CRP', 'Baseline')));
    expect(turned.panels[0].records[0].y).toBe(Number(byId.get('BIO-001').BMIBL));

    // An axis is written three ways, and they say the same thing.
    const axis = at('IL-6', 'Week 4', 'change');
    expect(variableOf(axis)).toEqual({ measure: 'IL-6', visit: 'Week 4', value: 'change' });
    expect(settingOf(axis)).toEqual({ measure: 'IL-6', value: 'change', visit: 'Week 4' });
    expect(axisOf(settingOf(axis))).toEqual(axis);
    expect(variableOf({ kind: 'column', col: 'AGE' })).toEqual({ col: 'AGE', type: 'number' });
    expect(settingOf(at('CRP', null, 'baseline'))).toEqual({ measure: 'CRP', value: 'baseline' });
    expect(axisOf({ measure: 'CRP', value: 'baseline' })).toEqual(at('CRP', null, 'baseline'));
    expect(sameAxis(axis, at('IL-6', 'Week 4', 'change'))).toBe(true);
    expect(sameAxis(axis, at('IL-6', 'Week 4'))).toBe(false);
  });

  it('AS-DATA-003: a colour splits the points by its levels, and panels by one further variable are one panel per level, each holding its own participants (#26)', () => {
    const model = build({ colorBy: 'ARM', panelBy: 'SEX' });
    expect(model.colors).toEqual(['Placebo', 'Treatment']);
    expect(model.panelLevels).toEqual(['F', 'M']);
    expect(model.panels.map((panel) => [panel.title, panel.records.length])).toEqual([
      ['F', 91],
      ['M', 109]
    ]);
    const bySex = new Map(participants.map((row) => [row.USUBJID, row]));
    for (const panel of model.panels) {
      for (const record of panel.records) {
        expect(bySex.get(record.USUBJID).SEX).toBe(panel.panelLevel);
        expect(record.color).toBe(bySex.get(record.USUBJID).ARM);
      }
      // How many of the panel's points each colour has, in the colours' order.
      expect(panel.counts).toEqual(
        model.colors.map((color) => panel.records.filter((record) => record.color === color).length)
      );
      expect(panel.counts.reduce((sum, n) => sum + n, 0)).toBe(panel.records.length);
    }
    // Every panel is on the same two axes: the extent is of all of them.
    const all = model.panels.flatMap((panel) => panel.records);
    expect(model.extent.x).toEqual([
      Math.min(...all.map((record) => record.x)),
      Math.max(...all.map((record) => record.x))
    ]);
    // With neither, everyone is one panel and one colour.
    const plain = build();
    expect(plain.colors).toEqual([null]);
    expect(plain.panelLevels).toEqual([null]);
    expect(plain.panels[0].counts).toEqual([200]);
    expect(Object.keys(plain.panels[0].records[0])).toEqual(['USUBJID', 'x', 'y']);
  });

  it('AS-DATA-004: each axis has its own scale, and on a logarithmic one a value of zero or less is left out and counted for that axis (#26)', () => {
    const change = { x: at('CRP', 'Baseline'), y: at('IL-6', 'Week 4', 'change') };
    const linear = build(change);
    expect(linear.drawn).toBe(186);
    expect(linear.nonPositive).toEqual({ x: 0, y: 0 });
    const loggedY = build({ ...change, yScale: 'log' });
    const fallen = linear.panels[0].records.filter((record) => !(record.y > 0)).length;
    expect(fallen).toBeGreaterThan(0);
    expect(loggedY.nonPositive).toEqual({ x: 0, y: fallen });
    expect(loggedY.drawn).toBe(186 - fallen);
    expect(loggedY.panels[0].records.every((record) => record.y > 0)).toBe(true);
    // The x axis alone: CRP is above zero for everyone, so nobody is left out,
    // and a negative change stays on its linear axis.
    const loggedX = build({ ...change, xScale: 'log' });
    expect(loggedX.nonPositive).toEqual({ x: 0, y: 0 });
    expect(loggedX.drawn).toBe(186);
    // A participant below zero on both is counted once, for x.
    const both = build({
      x: at('IL-6', 'Week 4', 'change'),
      y: at('IL-6', 'Week 8', 'change'),
      xScale: 'log',
      yScale: 'log'
    });
    const plainBoth = build({
      x: at('IL-6', 'Week 4', 'change'),
      y: at('IL-6', 'Week 8', 'change')
    });
    const records = plainBoth.panels[0].records;
    expect(both.nonPositive.x).toBe(records.filter((record) => !(record.x > 0)).length);
    expect(both.nonPositive.y).toBe(
      records.filter((record) => record.x > 0 && !(record.y > 0)).length
    );
    expect(both.drawn).toBe(records.length - both.nonPositive.x - both.nonPositive.y);

    // A value as an axis plots it, and the room about the data on each scale.
    expect(plotted(100, 'log')).toBe(2);
    expect(plotted(100, 'linear')).toBe(100);
    expect(domainOf([10, 20], 'linear')).toEqual([9.5, 20.5]);
    const [low, high] = domainOf([1, 100], 'log');
    expect(low).toBeGreaterThan(0);
    expect(low).toBeCloseTo(100 ** -0.05, 12);
    expect(high).toBeCloseTo(100 * 100 ** 0.05, 12);
    expect(domainOf([5, 5], 'linear')).toEqual([4.75, 5.25]);
  });

  it('AS-DATA-005: a filter chooses participants: the ones filtered out are not drawn and not counted as missing, and a filter that lets nobody through draws nothing (#26)', () => {
    const women = build({ filters: { SEX: 'F' } });
    expect(women.filtered).toBe(91);
    expect(women.participants).toBe(91);
    expect(women.drawn).toBe(91);
    expect(women.dropped).toEqual([]);
    const sexOf = new Map(participants.map((row) => [row.USUBJID, row.SEX]));
    expect(women.panels[0].records.every((record) => sexOf.get(record.USUBJID) === 'F')).toBe(true);
    expect(build().filtered).toBe(200);
    // Nobody: no panel, no extent and no error.
    const nobody = build({ filters: { SEX: 'Neither' } });
    expect(nobody).toMatchObject({
      panels: [],
      drawn: 0,
      participants: 0,
      filtered: 0,
      extent: null
    });
    // With no participant table there is nothing to filter by.
    expect(build({}, { results, participants: null }).filtered).toBe(null);
  });

  it('AS-DATA-006: with the results table alone the points are the ones the participant table would give, and a column carried on the results rows can be a colour or an axis (#26)', () => {
    const alone = build({}, { results, participants: null });
    expect(alone.drawn).toBe(200);
    expect(alone.panels[0].records).toEqual(build().panels[0].records);

    const byId = new Map(participants.map((row) => [row.USUBJID, row]));
    const carried = results.map((row) => ({
      ...row,
      ARM: byId.get(row.USUBJID).ARM,
      AGE: byId.get(row.USUBJID).AGE
    }));
    const given = { results: carried, participants: null };
    expect(categoryColumns(given, settings).map((entry) => entry.value_col)).toEqual(['ARM']);
    expect(numberColumns(given, settings)).toEqual([
      { value_col: 'AGE', label: 'AGE', table: 'results' }
    ]);
    const model = build({ x: { kind: 'column', col: 'AGE' }, colorBy: 'ARM' }, given);
    expect(model.colors).toEqual(['Placebo', 'Treatment']);
    expect(model.panels[0].records[0]).toEqual({
      USUBJID: 'BIO-001',
      x: Number(byId.get('BIO-001').AGE),
      y: Number(written('BIO-001', 'IL-10', 'Baseline')),
      color: byId.get('BIO-001').ARM
    });
  });

  it('AS-DATA-007: an axis is named for its variable, with the unit its values are in; a fold change has no unit, a percent change is in percent, and a column is named by its label (#26)', () => {
    const title = (axis, numbers) => axisTitle(results, settings, axis, numbers);
    expect(title(at('TNF-alpha', 'Baseline'))).toBe('TNF-alpha at Baseline (pg/mL)');
    expect(title(at('IL-6', 'Week 4', 'change'))).toBe(
      'IL-6 at Week 4, change from baseline (pg/mL)'
    );
    expect(title(at('IL-6', null, 'baseline'))).toBe('IL-6 at baseline (pg/mL)');
    expect(title(at('IL-6', 'Week 4', 'fold_change'))).toBe(
      'IL-6 at Week 4, fold change from baseline'
    );
    expect(title(at('IL-6', 'Week 4', 'percent_change'))).toBe(
      'IL-6 at Week 4, percent change from baseline (%)'
    );
    expect(title({ kind: 'column', col: 'AGE' })).toBe('AGE');
    expect(title({ kind: 'column', col: 'AGE' }, [{ value_col: 'AGE', label: 'Age' }])).toBe('Age');
  });

  it('AS-DATA-008: a change, a fold change or a percent change read at the one baseline visit is the same for everyone, and is said to be nothing to draw (#26)', () => {
    expect(flatAtBaseline(at('IL-6', 'Baseline', 'change'), results, settings)).toBe(true);
    expect(flatAtBaseline(at('IL-6', 'Baseline', 'fold_change'), results, settings)).toBe(true);
    expect(flatAtBaseline(at('IL-6', 'Week 4', 'change'), results, settings)).toBe(false);
    // The result itself at Baseline differs between participants, and so does a
    // baseline value; a column has no baseline.
    expect(flatAtBaseline(at('IL-6', 'Baseline'), results, settings)).toBe(false);
    expect(flatAtBaseline(at('IL-6', null, 'baseline'), results, settings)).toBe(false);
    expect(flatAtBaseline({ kind: 'column', col: 'AGE' }, results, settings)).toBe(false);
    // With no baseline visit named, it is the first visit.
    expect(flatAtBaseline(at('IL-6', 'Baseline', 'change'), results, syncSettings())).toBe(true);
    // With several baseline visits a value at one of them is measured against
    // all of them, and differs between participants.
    const two = syncSettings({ baseline_visits: ['Baseline', 'Week 2'] });
    expect(flatAtBaseline(at('IL-6', 'Baseline', 'change'), results, two)).toBe(false);
  });
});

describe('association scatter: the line y = x, and a region', () => {
  it('AS-DATA-009: the identity line is y = x across the part of the two axes they share: two ends of a ruler, and no statistic (#26)', () => {
    expect(identityLine([0, 10], [2, 20])).toEqual([
      { x: 2, y: 2 },
      { x: 10, y: 10 }
    ]);
    // Axes that share no value have no part of the line.
    expect(identityLine([0, 1], [5, 9])).toBe(null);
    expect(identityLine([0, 5], [5, 9])).toBe(null);
    // Two logarithmic axes: still two ends, a straight line on the page.
    expect(identityLine([1, 100], [0.5, 50], { x: 'log', y: 'log' })).toEqual([
      { x: 1, y: 1 },
      { x: 50, y: 50 }
    ]);
    // One logarithmic and one linear: a curve, every point of it on y = x,
    // from one end of the shared stretch to the other.
    const curve = identityLine([1, 100], [-5, 50], { x: 'log', y: 'linear' });
    expect(curve.length).toBeGreaterThan(20);
    expect(curve.every((point) => point.x === point.y)).toBe(true);
    expect(curve[0].x).toBe(1);
    expect(curve[curve.length - 1].x).toBeCloseTo(50, 10);
    for (let index = 1; index < curve.length; index += 1) {
      expect(curve[index].x).toBeGreaterThan(curve[index - 1].x);
    }
    // It reads no data: the same line whatever is drawn.
    expect(identityLine.length).toBeLessThanOrEqual(3);
  });

  it('AS-DATA-010: a region holds the participants whose point is inside it on both axes, edges included, however its corners are given (#26)', () => {
    const records = [
      { USUBJID: 'A', x: 1, y: 1 },
      { USUBJID: 'B', x: 2, y: 5 },
      { USUBJID: 'C', x: 3, y: 2 },
      { USUBJID: 'D', x: 4, y: 9 }
    ];
    const ids = (region) => brushed(records, region).map((record) => record.USUBJID);
    expect(ids({ x: [2, 3], y: [2, 5] })).toEqual(['B', 'C']);
    expect(ids({ x: [3, 2], y: [5, 2] })).toEqual(['B', 'C']);
    expect(ids({ x: [0, 10], y: [0, 10] })).toEqual(['A', 'B', 'C', 'D']);
    expect(ids({ x: [2.1, 2.9], y: [0, 10] })).toEqual([]);
    // On the study: the region's participants are a subset of the panel's.
    const [panel] = build().panels;
    const inside = brushed(panel.records, { x: [12, 14], y: [6, 8] });
    expect(inside.length).toBeGreaterThan(0);
    expect(inside.length).toBeLessThan(panel.records.length);
    expect(inside.every((r) => r.x >= 12 && r.x <= 14 && r.y >= 6 && r.y <= 8)).toBe(true);
    expect(
      panel.records.filter((r) => r.x >= 12 && r.x <= 14 && r.y >= 6 && r.y <= 8)
    ).toHaveLength(inside.length);
  });
});

describe('association scatter: what the controls offer', () => {
  it('AS-CTRL-001: the participant-level numbers an axis can take are the columns in which every written value is a number and more than one value occurs; the setting `numbers` is the list when given (#26)', () => {
    expect(numberColumns(tables, settings)).toEqual([
      { value_col: 'AGE', label: 'AGE', table: 'participants' },
      { value_col: 'BMIBL', label: 'BMIBL', table: 'participants' }
    ]);
    // A category is not a number, a blank is not a value, and one value is no axis.
    const people = [
      { USUBJID: 'A', ARM: 'Placebo', DOSE: '10', SITE: '7', WEIGHT: '70.5', NOTE: '' },
      { USUBJID: 'B', ARM: 'Treatment', DOSE: '20', SITE: '7', WEIGHT: '', NOTE: '' },
      { USUBJID: 'C', ARM: 'Treatment', DOSE: 'high', SITE: '7', WEIGHT: '81', NOTE: '' }
    ];
    expect(
      numberColumns({ results, participants: people }, settings).map((entry) => entry.value_col)
    ).toEqual(['WEIGHT']);
    // The results table as vendored carries no participant-level number.
    expect(numberColumns({ results, participants: null }, settings)).toEqual([]);
    const named = syncSettings({ numbers: [{ value_col: 'AGE', label: 'Age' }] });
    expect(numberColumns(tables, named)).toEqual([
      { value_col: 'AGE', label: 'Age', table: 'given' }
    ]);
  });

  it('AS-CTRL-002: with no variable named the chart opens on the first two biomarkers at the first visit; a variable that is named is the one it opens on, and one the tables lack gives way and is reported (#26)', () => {
    expect(offered.measures.slice(0, 2)).toEqual(['CRP', 'D-dimer']);
    expect(offered.visits[0]).toBe('Baseline');
    expect(openingAxes(settings, offered)).toEqual({
      x: at('CRP', 'Baseline'),
      y: at('D-dimer', 'Baseline'),
      missing: []
    });
    // The setting `measures` is the Biomarker control's order, and so the first two.
    const ordered = syncSettings({ measures: ['IL-6', 'CRP'] });
    expect(
      openingAxes(ordered, { ...offered, measures: listMeasures(results, ordered) })
    ).toMatchObject({ x: at('IL-6', 'Baseline'), y: at('CRP', 'Baseline') });
    // One biomarker: the same biomarker at the first two visits. One visit as
    // well: the first participant-level number. Nothing else: itself.
    expect(openingAxes(settings, { ...offered, measures: ['IL-6'] })).toMatchObject({
      x: at('IL-6', 'Baseline'),
      y: at('IL-6', 'Week 2')
    });
    expect(
      openingAxes(settings, { ...offered, measures: ['IL-6'], visits: ['Baseline'] })
    ).toMatchObject({ x: at('IL-6', 'Baseline'), y: { kind: 'column', col: 'AGE' } });
    expect(
      openingAxes(settings, { measures: ['IL-6'], visits: ['Baseline'], numbers: [] })
    ).toMatchObject({ x: at('IL-6', 'Baseline'), y: at('IL-6', 'Baseline') });
    expect(openingAxes(settings, { measures: [], visits: [], numbers: [] })).toEqual({
      x: null,
      y: null,
      missing: []
    });

    // Named: the planted pair, a baseline value, a column.
    const planted = syncSettings({
      x: { measure: 'TNF-alpha', visit: 'Baseline' },
      y: { measure: 'IL-10', visit: 'Baseline' }
    });
    expect(openingAxes(planted, offered)).toEqual({
      x: at('TNF-alpha', 'Baseline'),
      y: at('IL-10', 'Baseline'),
      missing: []
    });
    const mixed = syncSettings({ x: { col: 'AGE' }, y: { measure: 'IL-6', value: 'baseline' } });
    expect(openingAxes(mixed, offered)).toMatchObject({
      x: { kind: 'column', col: 'AGE' },
      y: at('IL-6', null, 'baseline'),
      missing: []
    });
    // What the tables lack: a biomarker, a visit, a column that is not a number.
    const lacking = syncSettings({
      x: { measure: 'IL-17', visit: 'Baseline' },
      y: { measure: 'IL-10', visit: 'Week 99' }
    });
    expect(openingAxes(lacking, offered)).toEqual({
      x: at('CRP', 'Baseline'),
      y: at('D-dimer', 'Baseline'),
      missing: ['x', 'y']
    });
    expect(openingAxes(syncSettings({ x: { col: 'ARM' } }), offered).missing).toEqual(['x']);
    expect(axisOffered({ kind: 'column', col: 'ARM' }, offered)).toBe(false);
    expect(axisOffered({ kind: 'column', col: 'AGE' }, offered)).toBe(true);
    expect(axisOffered(null, offered)).toBe(false);
  });
});
