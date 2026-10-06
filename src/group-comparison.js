// The group comparison chart: one value across the levels of a category, as
// boxes, violins or points, with the number in each group beneath.
//
//   BioViz.groupComparison('#chart', { group_by: 'ARM' }).init({ results, participants });
//
// It opens on a tile per biomarker, each a line per group through the group's
// median at every scheduled visit. A tile opens that biomarker over time: one
// picture, visit along the bottom and the groups side by side at each, with
// the number in each group and R's test of the groups under each visit. A
// visit there opens that visit alone, with its marks, a second grouping, its
// panels and pairwise comparisons. Which of the three is drawn is decided in
// src/group-comparison/level.js.
//
// The lifecycle is safety.viz's (init, setData, setSettings, render, resize,
// destroy), so a page drives both libraries the same way.
//
// The chart is built from safety.viz's kit, which the page loads beside this
// bundle: the control sidebar, the filters, the record listing, the participant
// rail, the box drawing and the Chart.js constructor are all `SafetyViz.kit`'s.
// Nothing of safety.viz and no Chart.js is bundled here; this file imports
// neither, and finds the kit on the page when a chart is made.
//
// The rows of every cell come from the core's frame. The chart computes no
// test: it chooses which test to ask R for, its statistics line asks R through
// the connection, and it prints what comes back through the shared formatters.

import { createConnection } from './r/connection.js';
import { visits as visitsInOrder } from './core/frame.js';
import { UNUSED } from './core/reasons.js';
import { scheduledResults } from './core/unscheduled.js';
import {
  PALETTE,
  SCALE_LABELS,
  VALUE_LABELS,
  addFilterControls,
  buildProfileFeed,
  clearListing,
  filtersForScope,
  findKit,
  hexToRgba,
  lineStyles,
  mountShell,
  railSettings,
  readGiven,
  selectParticipant,
  showListing,
  shown,
  syncHost,
  writeStatistic,
  mountToolbar,
  toolbarStyles,
  drawSafely,
  checkTables,
  writeTitles,
  specificationOf,
  startFilters
} from './shared/chartHost.js';
import { VALUE_TYPES, label as variableLabel } from './core/variable.js';
import { cutNote, isCut } from './shared/cut.js';
import { NOBODY_PASSES } from './shared/tables.js';
import { coreSettings } from './shared/settings.js';
import {
  MARKS,
  TILE_SUMMARIES,
  TIME_MARKS,
  VISIT_ADJUSTMENTS,
  Y_SCALES,
  syncSettings
} from './group-comparison/configure.js';
import { LEVELS, hasOverTime, levelOf } from './group-comparison/level.js';
import { buildOverTime, markOf, timeDomain } from './group-comparison/overTime.js';
import {
  NO_TEST_CHOSEN,
  TEST_LABELS,
  createStatisticDesk,
  fitTest,
  groupsOf,
  levelsScope,
  noTestText,
  overTimeRequest,
  plain,
  scopeText,
  statisticRequest,
  testsFor
} from './group-comparison/statistic.js';
import {
  buildPanels,
  categoryColumns,
  columnLevels,
  filterColumns,
  jitter,
  listMeasures,
  listVisits,
  measureVisits,
  yTitle
} from './group-comparison/structureData.js';
import { buildTiles } from './group-comparison/tiles.js';

const NONE = '';

// A cut variable in the Group and Panel controls: the settings' `group_by` and
// `panel_by`, when either is a cut variable, are each offered under a key of
// their own, after the columns.
const CUT_KEY = 'bv-cut:';

// The Biomarker control's entry for every biomarker, as safety.viz's histogram
// has one for every measure. In the chart's state it is a biomarker of null.
const OVERVIEW = 'bv_overview';

const MARK_LABELS = { box: 'Box', violin: 'Violin', points: 'Points' };
const SUMMARY_LABELS = { median: 'Medians', mean: 'Means' };
// What a tile's lines go through, at the head of the key above the tiles.
const SUMMARY_WORDS = { median: 'Median', mean: 'Mean' };
const VALUE_WORDS = {
  raw: 'result',
  baseline: 'baseline value',
  change: 'change from baseline',
  fold_change: 'fold change from baseline',
  percent_change: 'percent change from baseline'
};
// Said under a control that the trend tiles do not read.
const NOT_ON_TILES = 'Applies when one biomarker is open.';
// Said under Colour by and Panel by on the tiles and on one biomarker over
// time, which take no second grouping and no panels.
const AT_ONE_VISIT = 'Applies once a biomarker and a visit are open.';

// One biomarker over time: what the Draw as control calls each form, what the
// key above the picture calls it, and what its marks are.
const TIME_MARK_LABELS = {
  box: 'Boxes',
  mean_se: 'Means with standard errors',
  median_iqr: 'Medians with quartiles'
};
const TIME_MARK_WORDS = {
  box: 'Boxes of the',
  mean_se: 'Mean and standard error of the',
  median_iqr: 'Median and quartiles of the'
};
const TIME_MARK_NOTES = {
  box:
    'Each box runs from the 25th to the 75th percentile, with a line at the median and a dot at ' +
    'the mean; its whiskers end at the 5th and 95th percentiles.',
  mean_se:
    'Each point is a group’s mean at a visit, and its bar reaches one standard error either ' +
    'side: the standard deviation over the square root of the number in the group.',
  median_iqr:
    'Each point is a group’s median at a visit, and its bar reaches from the 25th to the 75th ' +
    'percentile.'
};
const ADJUSTMENT_LABELS = { none: 'None', holm: 'Holm', BH: 'Benjamini-Hochberg' };
// What the row of tests says in one cell across every visit, while it has no
// result for any: the sentence itself is on the statistics line beneath.
const ROW_WORDS = {
  waiting: 'Waiting for R…',
  unavailable: 'Statistics unavailable',
  error: 'R reported an error',
  withheld: 'Not computed',
  refused: 'Not shown',
  none: 'No test'
};
// What one visit's cell says when it has no p-value.
const CELL_WORDS = { withheld: 'not computed', error: 'error', refused: 'not shown' };
// A visit's column is never narrower than this, in pixels: narrower, and the
// picture and the table under it scroll together inside the chart.
const VISIT_WIDTH = 50;

const STYLE_ID = 'bio-viz-group-comparison-styles';
// The statistics line, the listing and the rail are styled as every chart's
// are; the rest is this chart's own.
const STYLES = `${lineStyles('.bv-group-comparison')}
${toolbarStyles('.bv-group-comparison')}
.bv-group-comparison .sv-chart-wrap canvas,.bv-group-comparison .bv-panel-canvas canvas{cursor:pointer}
.bv-group-comparison .sv-multiples.bv-tiles{display:block}
.bv-group-comparison .bv-tile-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:.6rem}
.bv-group-comparison .bv-tile{display:flex;flex-direction:column;align-items:stretch;gap:.15rem;min-width:0;margin:0;padding:.5rem .55rem .45rem;border:1px solid #d8dee4;border-radius:8px;background:#fff;color:#1f2933;font:inherit;text-align:left;cursor:pointer}
.bv-group-comparison .bv-tile:hover{border-color:#0b62a4;box-shadow:0 1px 4px rgba(11,98,164,.18)}
.bv-group-comparison .bv-tile:focus-visible{outline:2px solid #0b62a4;outline-offset:1px}
.bv-group-comparison .bv-tile-name{display:block;font-size:.85rem;font-weight:600;line-height:1.2;overflow-wrap:anywhere}
.bv-group-comparison .bv-tile-canvas{display:block;position:relative;height:74px}
.bv-group-comparison .bv-tile-visits{display:flex;justify-content:space-between;gap:.4rem;font-size:.66rem;line-height:1.2;color:#52616f}
.bv-group-comparison .bv-tile-visits[data-single]{justify-content:center}
.bv-group-comparison .bv-tile-range{display:block;margin-top:.1rem;font-size:.72rem;line-height:1.25;color:#3e4c59;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.bv-group-comparison .bv-tile-empty{display:block;font-size:.72rem;color:#52616f}
.bv-group-comparison .bv-tile-caption{margin:0 0 .6rem;font-size:.8rem;color:#52616f}
.bv-group-comparison .bv-legend{display:flex;flex-wrap:wrap;gap:.2rem 1rem;margin:0 0 .3rem;font-size:.8rem;color:#1f2933}
.bv-group-comparison .bv-legend-swatch{display:inline-block;width:.75em;height:.75em;margin-right:.35em;border-radius:2px}
.bv-group-comparison .bv-control-note{display:block;margin:.2rem 0 0;font-size:.75rem;color:#52616f}
.bv-group-comparison .bv-trail ol{display:flex;flex-wrap:wrap;align-items:center;gap:.3rem .35rem;margin:0;padding:0;list-style:none;font-size:.85rem;color:#1f2933}
.bv-group-comparison .bv-trail li{display:flex;align-items:center;gap:.35rem}
.bv-group-comparison .bv-trail li+li::before{content:'›';color:#52616f}
.bv-group-comparison .bv-trail [aria-current]{font-weight:600;overflow-wrap:anywhere}
.bv-group-comparison .sv-multiples.bv-time{display:block}
.bv-group-comparison .bv-time-scroll{overflow-x:auto;border:1px solid #d8dee4;border-radius:10px;background:#fff;padding:.6rem .5rem .5rem}
.bv-group-comparison .bv-time-canvas{position:relative;height:360px}
.bv-group-comparison .bv-time-canvas canvas{cursor:pointer}
.bv-group-comparison .bv-time-table{width:100%;table-layout:fixed;border-collapse:collapse;margin:.1rem 0 0;font-size:.78rem;line-height:1.25;color:#1f2933;font-variant-numeric:tabular-nums}
.bv-group-comparison .bv-time-table caption{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.bv-group-comparison .bv-time-table th,.bv-group-comparison .bv-time-table td{padding:.22rem .05rem;text-align:center;vertical-align:top;font-weight:400}
.bv-group-comparison .bv-time-table th[scope=row],.bv-group-comparison .bv-time-table thead th{overflow-wrap:anywhere}
.bv-group-comparison .bv-time-table th[scope=row]{padding-right:.4rem;text-align:right;color:#3e4c59}
.bv-group-comparison .bv-time-table tbody tr{border-top:1px solid #eef1f4}
.bv-group-comparison .bv-time-table thead th{font-weight:600}
.bv-group-comparison .bv-time-visit{display:block;width:100%;margin:0;padding:.2rem .1rem;border:1px solid transparent;border-radius:6px;background:none;color:#0b62a4;font:inherit;font-weight:600;line-height:1.2;cursor:pointer;overflow-wrap:anywhere}
.bv-group-comparison .bv-time-visit:hover{border-color:#0b62a4;background:#eaf2fb}
.bv-group-comparison .bv-time-visit:focus-visible{outline:2px solid #0b62a4;outline-offset:1px}
.bv-group-comparison .bv-time-still{display:block;padding:.2rem .1rem;border:1px solid transparent;color:#3e4c59}
.bv-group-comparison .bv-time-sub{display:block;font-size:.7rem;color:#52616f}
.bv-group-comparison .bv-time-table tr[data-row=test] td{font-weight:600}
.bv-group-comparison .bv-time-table tr[data-row=test] td[data-status]:not([data-status=shown]),.bv-group-comparison .bv-time-table tr[data-row=test] td[colspan]{font-weight:400;font-style:italic;color:#52616f}
.bv-group-comparison .bv-stat-level{margin:0 0 .3rem}
@media (max-width:600px){
.bv-group-comparison .bv-time-canvas{height:300px}
.bv-group-comparison .bv-time-scroll{padding:.4rem .25rem .35rem}
.bv-group-comparison .bv-time-table{font-size:.7rem}
.bv-group-comparison .bv-time-visit,.bv-group-comparison .bv-time-still{padding:.2rem 0}
.bv-group-comparison .bv-tile-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem}
.bv-group-comparison .sv-chart-wrap{height:380px;padding:.5rem}
.bv-group-comparison.sv-collapsed .sv-sidebar-title{display:inline}
.bv-group-comparison.sv-collapsed .sv-sidebar{padding:.5rem .9rem}
}`;

// Said when the only visit chosen is the baseline visit of a change.
const NOTHING_AFTER_BASELINE =
  'The only visit chosen is the baseline visit, where this value is the same for everyone. ' +
  'Choose a later visit to draw.';

const NO_VALUE = 'No participant has a value to draw for this choice.';

// Why nothing is drawn of one biomarker: nobody passes the filters; or nobody
// that does has a value for this choice; or the only visit chosen is the
// baseline visit of a change.
function nothingDrawn(model) {
  if (model.filtered === 0) return NOBODY_PASSES;
  return model.noRows || model.panels.length ? NO_VALUE : NOTHING_AFTER_BASELINE;
}

// Names in a sentence: all of a few, or the first three and how many more.
function listed(names) {
  if (names.length <= 4) return names.join(', ');
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

/**
 * The live chart. Made by `groupComparison()`, not directly.
 */
class GroupComparison {
  constructor(element, settings) {
    this.kit = findKit('the group comparison chart');
    this.element = typeof element === 'string' ? document.querySelector(element) : element;
    if (!this.element) throw new Error(`bio.viz: group comparison target not found: ${element}`);
    this.settings = syncSettings(settings);
    this.tables = { results: [], participants: null };
    this.drawTables = this.tables;
    this.unscheduled = { results: [], visits: [] };
    this.hiddenVisits = [];
    this.charts = [];
    this.model = null;
    this.measures = [];
    this.visits = [];
    this.categories = [];
    this.filterSpecs = [];
    this.state = {};
    this.asked = [];
    this.tiles = null;
    this.overTime = null;
    this.connect();
    this.renderShell();
  }

  // The connection the statistics line asks: the one given in settings, or one
  // with no R attached, which answers that statistics are unavailable.
  connect() {
    // A desk that is replaced answers nothing more: an answer to a question
    // asked of the old connection is never shown.
    if (this.desk) this.desk.retire();
    this.connection = this.settings.connection || createConnection();
    this.desk = createStatisticDesk({
      connection: this.connection,
      note: this.settings.waiting_note
    });
  }

  renderShell() {
    mountShell(this, {
      moduleClass: 'bv-group-comparison',
      styleId: STYLE_ID,
      styles: STYLES,
      listingFile: 'bio.viz-group-comparison-listing.csv'
    });
    // The way back, when another chart opened this one in its place.
    mountToolbar(this);
  }

  /**
   * Load the tables and draw: the same as `setData`.
   * @param {{results: object[], participants?: object[]}} data The tables.
   * @returns {GroupComparison} The chart, for chaining.
   */
  init(data) {
    return this.setData(data);
  }

  /**
   * Replace the tables and draw again. The controls are rebuilt from the new
   * tables and return to what the settings open on.
   * @param {{results: object[], participants?: object[]}} data The tables: the
   *   results table, and the participant table when there is one. A bare array
   *   is taken as the results table.
   * @param {object} [settings] Settings to change with the tables, when the new
   *   tables need them: a participant table whose id column has another name
   *   comes with `participant_id_col`. The tables are checked against these.
   * @returns {GroupComparison} The chart, for chaining.
   */
  setData(data, settings) {
    if (settings === undefined || settings === null) {
      this.tables = readGiven(this, data);
    } else {
      // The tables and the settings that read them change together: the
      // tables are checked against the new settings, which are then laid over.
      this.tables = readGiven(this, data, syncSettings({ ...this.settings, ...settings }));
      this.setSettings(settings);
    }
    this.readTables();
    this.readVisits(this.settings.unscheduled_visits);
    this.state = this.seedState();
    this.buildProfileFeed();
    this.buildControls();
    this.render();
    return this;
  }

  /**
   * Lay new settings over the current ones and draw again. A setting that says
   * what the chart opens on (`start_value`, `visits`, `value_type`, `group_by`,
   * `levels`, `color_by`, `panel_by`, `mark`, `time_mark`, `y_scale`,
   * `tile_summary`, `unscheduled_visits`, `test`, `pairwise`,
   * `visit_adjustment`) moves its control: `start_value: null` returns to the
   * tiles of every biomarker, and `visits: null` with a biomarker named to that
   * biomarker over time.
   * @param {object} settings The settings to change.
   * @returns {GroupComparison} The chart, for chaining.
   */
  setSettings(settings) {
    const given = settings || {};
    const next = syncSettings({ ...this.settings, ...given });
    // The tables must still have the columns the new settings name; if not, the
    // settings are refused and nothing changes.
    checkTables(this.tables, next);
    this.settings = next;
    syncHost(this);
    if ('back' in given) mountToolbar(this);
    if ('connection' in given || 'waiting_note' in given) this.connect();
    const offered = this.visits.all || [];
    this.readTables();
    // The switch as the settings now give it, or as the control was left.
    this.readVisits(
      'unscheduled_visits' in given ? next.unscheduled_visits : this.state.unscheduledVisits
    );
    const opening = this.seedState();
    const moved = {
      start_value: 'measure',
      visits: 'visits',
      value_type: 'valueType',
      group_by: 'groupBy',
      levels: 'levels',
      color_by: 'colorBy',
      panel_by: 'panelBy',
      mark: 'mark',
      time_mark: 'timeMark',
      y_scale: 'yScale',
      tile_summary: 'tileSummary',
      unscheduled_visits: 'unscheduledVisits',
      test: 'test',
      pairwise: 'pairwise',
      visit_adjustment: 'visitAdjustment',
      filters: 'filters'
    };
    for (const [setting, key] of Object.entries(moved)) {
      if (setting in given) this.state[key] = opening[key];
    }
    this.repairState(opening);
    // A visit the settings bring back, by switching unscheduled visits on or by
    // another rule for which they are, is drawn: it joins the visits chosen.
    if (!('visits' in given)) this.chooseNewVisits(offered);
    this.buildProfileFeed();
    this.kit.syncProfileRail(this.host, () => this.railSettings());
    this.buildControls();
    this.render();
    return this;
  }

  // What the controls can offer, read from the tables.
  readTables() {
    const { results } = this.tables;
    this.measures = results.length ? listMeasures(results, this.settings) : [];
    // The results at scheduled visits, and the visits the rule names
    // (src/core/unscheduled.js); readVisits says which of the two is drawn.
    const found = scheduledResults(results, this.settings);
    const named = new Set(found.visits);
    this.unscheduled = {
      results: found.results,
      // Those with a result to draw, in visit order: what the switch brings back.
      visits:
        results.length && named.size
          ? visitsInOrder(results, coreSettings(this.settings)).filter((visit) => named.has(visit))
          : []
    };
    this.categories = results.length ? categoryColumns(this.tables, this.settings) : [];
    // The cut variables the settings name, each once.
    this.cutOptions = [];
    for (const by of [this.settings.group_by, this.settings.panel_by]) {
      if (!isCut(by)) continue;
      const written = JSON.stringify(by);
      if (this.cutOptions.some((entry) => JSON.stringify(entry.spec) === written)) continue;
      this.cutOptions.push({
        key: `${CUT_KEY}${this.cutOptions.length}`,
        spec: by,
        label: variableLabel(by)
      });
    }
    this.filterSpecs = filterColumns(this.tables, this.settings, this.categories).map((spec) =>
      this.kit.normalizeFilterSpec(spec)
    );
    // As safety.viz's histogram does: a biomarker the table does not have opens
    // on every biomarker, and says so where a developer will see it.
    const start = this.settings.start_value;
    if (results.length && start !== null && !this.measures.includes(start)) {
      console.warn(
        `The initial biomarker [${start}] does not exist. Defaulting to the all-biomarkers overview.`
      );
    }
  }

  // The tables the chart draws from and the visits it offers, with unscheduled
  // visits drawn (`shown`) or left out. Left out, their rows are set aside
  // before anything is listed or framed, so they are in no level of the chart:
  // not in a tile, not in the Visit control, not a panel, and not the baseline
  // a change is measured from. The participant profile is safety.viz's own
  // chart of one participant, and is given every result.
  readVisits(shown) {
    const results = shown ? this.tables.results : this.unscheduled.results;
    this.drawTables = { results, participants: this.tables.participants };
    this.visits = results.length ? listVisits(results, this.settings) : { all: [], start: [] };
    this.hiddenVisits = shown ? [] : this.unscheduled.visits;
  }

  // Which level is drawn: every biomarker; one biomarker over time, when
  // every visit it has is chosen; or one biomarker's visits, a panel each.
  level() {
    return levelOf(this.state, this.measureVisits());
  }

  // Whether the tiles of every biomarker are what is drawn.
  atTiles() {
    return this.level() === LEVELS.BIOMARKERS;
  }

  // The visits the open biomarker has values at, in visit order: read once
  // for a biomarker and a table, because every control and every draw asks.
  measureVisits() {
    const { measure } = this.state;
    if (measure === null || measure === undefined) return [];
    const { results } = this.drawTables;
    const kept = this.visitsOf;
    if (kept && kept.results === results && kept.measure === measure) return kept.visits;
    const visits = measureVisits(results, this.settings, measure);
    this.visitsOf = { results, measure, visits };
    return visits;
  }

  // What R's counts are of, when the automatic footnote has many to say: one
  // biomarker over time is answered a count per visit.
  get footnoteCounts() {
    return this.overTime ? 'visits' : undefined;
  }

  // Opens one biomarker, or every biomarker (null), from the Biomarker control
  // or from a tile.
  selectMeasure(measure) {
    this.state.measure = measure;
    this.buildControls();
    this.render();
  }

  // The key a cut variable is held under in the Group and Panel controls.
  cutKey(by) {
    const written = JSON.stringify(by);
    return this.cutOptions.find((entry) => JSON.stringify(entry.spec) === written).key;
  }

  // Whether a Group or Panel control can hold a value: a column offered, or a
  // cut variable the settings name.
  offers(value) {
    return (
      this.categories.some((entry) => entry.value_col === value) ||
      this.cutOptions.some((entry) => entry.key === value)
    );
  }

  // A Group or Panel control's value as the core takes it: a column's name, or
  // the cut variable.
  groupingOf(value) {
    const found = this.cutOptions.find((entry) => entry.key === value);
    return found ? found.spec : value;
  }

  // The state with the group and the panel as the drawing takes them.
  drawingState(state = this.state) {
    return {
      ...state,
      groupBy: this.groupingOf(state.groupBy),
      panelBy: this.groupingOf(state.panelBy)
    };
  }

  // What the chart opens on: the settings, where the tables have what they name.
  seedState() {
    const { settings, categories, measures } = this;
    const has = (column) => categories.some((entry) => entry.value_col === column);
    let groupBy = NONE;
    if (isCut(settings.group_by)) groupBy = this.cutKey(settings.group_by);
    else if (has(settings.group_by)) groupBy = settings.group_by;
    else if (categories.length) groupBy = categories[0].value_col;
    let panelBy = NONE;
    if (isCut(settings.panel_by)) panelBy = this.cutKey(settings.panel_by);
    else if (has(settings.panel_by)) panelBy = settings.panel_by;
    return {
      // No biomarker named, or one the table does not have: every biomarker.
      measure: measures.includes(settings.start_value) ? settings.start_value : null,
      visits: [...this.visits.start],
      valueType: settings.value_type,
      groupBy,
      levels: settings.levels,
      colorBy: has(settings.color_by) ? settings.color_by : NONE,
      panelBy,
      mark: settings.mark,
      timeMark: settings.time_mark,
      yScale: settings.y_scale,
      tileSummary: settings.tile_summary,
      unscheduledVisits: settings.unscheduled_visits,
      test: settings.test,
      pairwise: settings.pairwise,
      visitAdjustment: settings.visit_adjustment,
      filters: startFilters(this)
    };
  }

  // After the tables or the settings change, a control may hold something that
  // is no longer offered; it returns to what the chart opens on.
  repairState(opening) {
    const has = (column) => this.categories.some((entry) => entry.value_col === column);
    if (this.state.measure !== null && !this.measures.includes(this.state.measure)) {
      this.state.measure = opening.measure;
    }
    this.state.visits = this.state.visits.filter((visit) => this.visits.all.includes(visit));
    if (!this.state.visits.length) this.state.visits = opening.visits;
    if (this.state.groupBy && !this.offers(this.state.groupBy)) {
      this.state.groupBy = opening.groupBy;
    }
    if (this.state.colorBy && !has(this.state.colorBy)) this.state.colorBy = NONE;
    if (this.state.panelBy && !this.offers(this.state.panelBy)) this.state.panelBy = NONE;
  }

  labelOf(column) {
    const cut = this.cutOptions.find((entry) => entry.key === column);
    if (cut) return cut.label;
    const found = this.categories.find((entry) => entry.value_col === column);
    return found ? found.label : column;
  }

  // ---- Controls ---------------------------------------------------------------

  buildControls() {
    const { kit, state } = this;
    this.controls.innerHTML = '';
    const { addSection, addControl, addReset } = kit.controlBuilders(this.controls);
    const redraw = (rebuild) => {
      if (rebuild) this.buildControls();
      this.render();
    };
    const select = (name, labelText, options, selected, onChange, parent) => {
      const input = document.createElement('select');
      input.dataset.control = name;
      options.forEach(([value, text]) => kit.option(input, value, text, value === selected));
      input.onchange = () => onChange(input.value);
      return addControl(labelText, input, parent);
    };

    const level = this.level();
    const tiles = level === LEVELS.BIOMARKERS;
    const overTime = level === LEVELS.OVER_TIME;
    // A control the level drawn does not read is switched off there, and says
    // where it applies; what it is set to is kept.
    const switchOff = (control, words) => {
      const input = control.matches('select,input') ? control : control.querySelector('select');
      input.disabled = true;
      control.after(kit.createElement('small', 'bv-control-note', words));
    };
    // The tiles and one biomarker over time take no second grouping and no panels.
    const atOneVisit = (control) => {
      if (tiles || overTime) switchOff(control, AT_ONE_VISIT);
    };
    const value = addSection('Value');
    select(
      'measure',
      'Biomarker',
      [[OVERVIEW, 'All Biomarkers'], ...this.measures.map((measure) => [measure, measure])],
      tiles ? OVERVIEW : state.measure,
      // The controls differ between the tiles and one biomarker.
      (next) => this.selectMeasure(next === OVERVIEW ? null : next),
      value
    );
    select(
      'value-type',
      'Value',
      VALUE_TYPES.map((type) => [type, VALUE_LABELS[type]]),
      state.valueType,
      (next) => {
        state.valueType = next;
        // A baseline value has no visit, so the Visit control comes and goes.
        redraw(true);
      },
      value
    );
    if (state.valueType !== 'baseline') {
      // With one biomarker open, the visits it has values at; on the tiles,
      // every visit. An unscheduled visit is offered only when they are drawn.
      const offered = this.visitsOffered();
      const shown = state.visits.filter((visit) => offered.includes(visit));
      const visits = kit.multiSelect({
        values: offered,
        selected: shown.length === offered.length ? null : shown,
        onChange: (next) => {
          const chosen = next === null ? offered : next;
          const before = this.level();
          // A visit the biomarker lacks keeps its place for another biomarker.
          state.visits = this.visits.all.filter(
            (visit) => chosen.includes(visit) || !offered.includes(visit)
          );
          // Every visit of a biomarker is its picture over time, and fewer are
          // panels: the controls differ between the two, and are made again
          // with this one left open where the reader was choosing.
          if (this.level() === before) {
            redraw(false);
            return;
          }
          const active = document.activeElement;
          const at = active && visits.contains(active) ? active.value : null;
          redraw(true);
          const again = this.controls.querySelector('[data-control="visits"]');
          if (!again) return;
          again.open = true;
          const box = [...again.querySelectorAll('input')].find((input) => input.value === at);
          if (at !== null && box) box.focus();
        }
      });
      visits.dataset.control = 'visits';
      addControl('Visit', visits, value);
    }

    const columns = this.categories.map((entry) => [entry.value_col, entry.label]);
    const cuts = this.cutOptions.map((entry) => [entry.key, entry.label]);
    const group = addSection('Groups');
    if (columns.length || cuts.length) {
      select(
        'group-by',
        'Group by',
        [...columns, ...cuts],
        state.groupBy,
        (next) => {
          state.groupBy = next;
          // The levels are the new column's.
          state.levels = null;
          redraw(true);
        },
        group
      );
      // A cut's groups move with the filters, so they are all drawn: the Levels
      // control is for a column.
      if (isCut(this.groupingOf(state.groupBy))) {
        group.append(
          kit.createElement('small', 'bv-control-note', 'Every group a cut makes is drawn.')
        );
      } else {
        const levels = this.levelsOffered();
        const picker = kit.multiSelect({
          values: levels,
          selected: state.levels ? levels.filter((level) => state.levels.includes(level)) : null,
          onChange: (next) => {
            state.levels = next;
            redraw(false);
          }
        });
        picker.dataset.control = 'levels';
        addControl('Levels', picker, group);
      }
      const optional = [[NONE, 'None'], ...columns];
      atOneVisit(
        select(
          'color-by',
          'Colour by',
          optional,
          state.colorBy,
          (next) => {
            state.colorBy = next;
            redraw(false);
          },
          group
        )
      );
      const panelBy = select(
        'panel-by',
        'Panel by',
        [...optional, ...cuts],
        state.panelBy,
        (next) => {
          state.panelBy = next;
          redraw(false);
        },
        group
      );
      atOneVisit(panelBy);
    } else {
      group.append(
        kit.createElement(
          'p',
          'sv-warning bv-no-groups',
          'No column can make a group. Give a participant table, or carry a column on the results rows.'
        )
      );
    }

    const display = addSection('Display');
    // What a tile's lines go through: a control of the tiles alone.
    if (tiles) {
      select(
        'tile-summary',
        'Tiles draw',
        TILE_SUMMARIES.map((summary) => [summary, SUMMARY_LABELS[summary]]),
        state.tileSummary,
        (next) => {
          state.tileSummary = next;
          redraw(false);
        },
        display
      );
    }
    if (overTime) {
      // One biomarker over time has forms of its own; the single view's mark
      // is kept for when a visit is opened.
      select(
        'time-mark',
        'Draw as',
        TIME_MARKS.map((mark) => [mark, TIME_MARK_LABELS[mark]]),
        state.timeMark,
        (next) => {
          state.timeMark = next;
          redraw(false);
        },
        display
      );
    } else {
      const mark = select(
        'mark',
        'Draw as',
        MARKS.map((entry) => [entry, MARK_LABELS[entry]]),
        state.mark,
        (next) => {
          state.mark = next;
          redraw(false);
        },
        display
      );
      if (tiles) switchOff(mark, NOT_ON_TILES);
    }
    select(
      'y-scale',
      'Scale',
      Y_SCALES.map((scale) => [scale, SCALE_LABELS[scale]]),
      state.yScale,
      (next) => {
        state.yScale = next;
        redraw(false);
      },
      display
    );

    // Unscheduled visits, as safety.viz's results over time chart switches
    // them: there only when the results have a visit the rule names, so the
    // control is never one that could do nothing.
    if (this.unscheduled.visits.length) {
      const unscheduled = document.createElement('input');
      unscheduled.type = 'checkbox';
      unscheduled.dataset.control = 'unscheduled-visits';
      unscheduled.checked = Boolean(state.unscheduledVisits);
      unscheduled.setAttribute('aria-label', 'Show unscheduled visits');
      unscheduled.onchange = () => this.showUnscheduled(unscheduled.checked);
      const inline = kit.createElement('div', 'sv-control-inline');
      inline.append(unscheduled, document.createTextNode('Show'));
      addControl('Unscheduled visits', inline, display);
    }

    // What R is asked: the test, and whether every pair of groups is compared
    // as well. The tests offered are the ones that fit the number of groups
    // drawn, so they are filled in when the chart is drawn (syncTestControls).
    this.testControl = null;
    this.pairwiseControl = null;
    this.adjustControl = null;
    // The tiles print no test, so they offer none: the section is there once a
    // biomarker is open. Over time it is there when a function is named that
    // answers a row of visits.
    if (this.settings.statistic && !tiles && (!overTime || this.settings.statistic_by_visit)) {
      const statistics = addSection('Statistics');
      const test = document.createElement('select');
      test.dataset.control = 'test';
      test.onchange = () => {
        state.test = test.value;
        redraw(false);
      };
      this.testControl = addControl('Test', test, statistics);
      if (overTime) {
        // The p-values under the visits, adjusted across them by R or not: the
        // pairs of groups are compared once a visit is open.
        this.adjustControl = select(
          'visit-adjustment',
          'Adjust across visits',
          VISIT_ADJUSTMENTS.map((entry) => [entry, ADJUSTMENT_LABELS[entry]]),
          state.visitAdjustment,
          (next) => {
            state.visitAdjustment = next;
            redraw(false);
          },
          statistics
        );
      } else {
        const pairwise = document.createElement('input');
        pairwise.type = 'checkbox';
        pairwise.dataset.control = 'pairwise';
        pairwise.setAttribute('aria-label', 'Pairwise comparisons');
        pairwise.onchange = () => {
          state.pairwise = pairwise.checked;
          redraw(false);
        };
        this.pairwiseControl = addControl('Pairwise comparisons', pairwise, statistics);
      }
    }

    // Filters choose participants, so there are filters only with a participant table.
    addFilterControls(this, { addSection, addControl }, () => redraw(false));

    addReset(() => {
      this.readVisits(this.settings.unscheduled_visits);
      this.state = this.seedState();
      this.buildControls();
      this.render();
    });
  }

  // Switches unscheduled visits on or off, from the control. A visit that
  // comes back is drawn: it joins the visits chosen, as every visit is chosen
  // when the chart opens.
  showUnscheduled(shown) {
    const offered = this.visits.all;
    this.state.unscheduledVisits = shown;
    this.readVisits(shown);
    this.chooseNewVisits(offered);
    this.buildControls();
    this.render();
  }

  // Adds to the visits chosen the ones now offered that were not `offered`
  // before, and drops any no longer offered.
  chooseNewVisits(offered) {
    const chosen = this.state.visits || [];
    this.state.visits = this.visits.all.filter(
      (visit) => chosen.includes(visit) || !offered.includes(visit)
    );
  }

  // Why a specification's visits are not all drawn, when the reason is that
  // some are unscheduled and left out: said in place of "not in the tables",
  // which they are (src/shared/chartHost.js, noticesOf).
  noticeOf(setting, asked, drawn) {
    if (setting !== 'visits' || !Array.isArray(asked)) return null;
    const left = asked.filter((visit) => this.hiddenVisits.includes(visit));
    if (!left.length) return null;
    const kept = drawn || [];
    const absent = asked.filter((visit) => !left.includes(visit) && !kept.includes(visit));
    return (
      `Visits: ${listed(left)} ${left.length === 1 ? 'is an unscheduled visit' : 'are unscheduled visits'}, ` +
      `left out unless \`unscheduled_visits\` is true, so the chart draws ${kept.length ? kept.join(', ') : 'none'}.` +
      (absent.length
        ? ` ${absent.join(', ')} ${absent.length === 1 ? 'is' : 'are'} not in the tables.`
        : '')
    );
  }

  // The visits the Visit control offers: the open biomarker's, or every visit
  // on the tiles.
  visitsOffered() {
    const { measure } = this.state;
    if (measure === null || measure === undefined) return this.visits.all;
    return this.measureVisits();
  }

  // Every level of the group column in the tables, whatever the filters are set to.
  levelsOffered() {
    if (!this.state.groupBy) return [];
    // On the tiles no one biomarker says which levels have a value: the levels
    // are the column's own.
    if (this.atTiles()) return columnLevels(this.drawTables, this.state.groupBy);
    // A failure here is the drawing's to say: the chart is drawn next, through
    // drawSafely, which says it in the footnote. The control offers nothing.
    try {
      const model = buildPanels(
        this.drawTables,
        this.settings,
        {
          ...this.drawingState(),
          levels: null,
          colorBy: NONE,
          panelBy: NONE,
          filters: {},
          yScale: 'linear'
        },
        { filterMatches: this.kit.filterMatches }
      );
      return model.levels;
    } catch {
      return [];
    }
  }

  // The Test control offers the tests that fit the number of groups drawn, and
  // nothing else: a test that does not fit is never asked of R. The pairwise
  // switch is there only when there are pairs to compare.
  syncTestControls(groups) {
    const { testControl: control, pairwiseControl: pairwise, kit, state } = this;
    if (!control) return;
    const select = control.matches('select') ? control : control.querySelector('select');
    const offered = testsFor(groups);
    const fitted = fitTest(state.test, groups);
    select.innerHTML = '';
    select.disabled = !offered.length;
    if (offered.length) {
      [...offered, 'none'].forEach((test) =>
        kit.option(select, test, TEST_LABELS[test], test === fitted)
      );
    } else {
      kit.option(select, 'none', 'None: a test needs two or more groups', true);
    }
    if (pairwise) {
      pairwise.checked = state.pairwise;
      pairwise.parentElement.style.display = groups > 2 && fitted !== 'none' ? '' : 'none';
    }
    // An adjustment is of p-values: with no test there is nothing to adjust.
    if (this.adjustControl) {
      const adjust = this.adjustControl.matches('select')
        ? this.adjustControl
        : this.adjustControl.querySelector('select');
      adjust.disabled = !offered.length || fitted === 'none';
    }
  }

  // ---- Drawing ----------------------------------------------------------------

  /**
   * Draw everything again from the tables, the settings and the controls. The
   * listing and the participant rail are emptied, and the statistics line is
   * cleared and asked for again: nothing stays on screen that describes rows
   * the chart no longer shows.
   * @returns {void}
   */
  render() {
    drawSafely(this, () => this.draw());
  }

  // Everything render() draws. drawSafely says so in the element when it fails.
  draw() {
    const round = this.desk.begin();
    this.asked = [];
    this.destroyCharts();
    this.clearSelection();
    this.notes.innerHTML = '';
    this.multiplesWrap.innerHTML = '';
    this.statLine.textContent = '';
    this.statLine.dataset.state = 'empty';
    this.multiplesWrap.classList.remove('bv-tiles', 'bv-time');
    this.chartWrap.classList.remove('sv-hidden');
    this.model = null;
    this.tiles = null;
    this.overTime = null;
    this.timeRow = null;
    this.syncTestControls(0);
    const level = this.level();
    this.root.dataset.level = level;
    this.writeTrail(level);
    this.noteHiddenVisits();

    const { results } = this.drawTables;
    const needsVisit = this.state.valueType !== 'baseline';
    if (!results.length || !this.measures.length) {
      this.footnote.textContent = 'No results to draw.';
      return;
    }
    const offered = this.visitsOffered();
    if (needsVisit && !this.state.visits.some((visit) => offered.includes(visit))) {
      this.footnote.textContent = 'Choose a visit to draw.';
      return;
    }
    // No biomarker chosen: every biomarker, a tile each. They print no test and
    // ask R for nothing.
    if (level === LEVELS.BIOMARKERS) {
      this.drawTiles();
      return;
    }
    // A biomarker and every visit it has: the biomarker over time, in one
    // picture, with one request to R for the test under every visit.
    if (level === LEVELS.OVER_TIME) {
      this.drawOverTime(round);
      return;
    }

    const model = buildPanels(this.drawTables, this.settings, this.drawingState(), {
      filterMatches: this.kit.filterMatches
    });
    this.model = model;
    this.syncTestControls(this.groupsDrawn(model));
    this.updateNotes(model);
    const drawn = model.panels.filter((panel) => panel.records.length);
    if (!drawn.length) {
      this.footnote.textContent = nothingDrawn(model);
      return;
    }
    this.footnote.textContent = [
      this.state.mark === 'points'
        ? 'Click a point to list its participant and open their profile.'
        : `Click a ${this.state.mark} to list its participants.`,
      ...this.cutNotes(model)
    ].join(' ');

    const title = yTitle(results, this.settings, this.state);
    const domain = this.domain(model);
    if (model.panels.length === 1) {
      const [panel] = model.panels;
      this.drawPanel(this.canvas, panel, model, { title, domain });
      this.askStatistic(round, panel, model, this.statLine);
      return;
    }

    // Several panels: one small chart each, in a grid that drops to one column
    // on a narrow screen, all on the same value axis.
    this.chartWrap.classList.add('sv-hidden');
    model.panels.forEach((panel) => {
      const card = this.kit.createElement('div', 'sv-multiple bv-panel');
      card.dataset.panel = panel.title;
      card.append(this.kit.createElement('h3', null, panel.title));
      card.append(
        this.kit.createElement(
          'p',
          'bv-panel-note',
          `${panel.records.length} participant${panel.records.length === 1 ? '' : 's'} drawn.`
        )
      );
      const wrap = this.kit.createElement('div', 'bv-panel-canvas');
      const canvas = document.createElement('canvas');
      wrap.append(canvas);
      const line = this.kit.createElement('div', 'bv-statistic');
      line.setAttribute('role', 'status');
      card.append(wrap, line);
      this.multiplesWrap.append(card);
      if (panel.records.length) {
        this.drawPanel(canvas, panel, model, { title, domain });
        this.askStatistic(round, panel, model, line);
      }
    });
  }

  // ---- The trend tiles ---------------------------------------------------------

  // Every biomarker, a tile each, in the Biomarker control's order; in a tile
  // one line per group through the group's median (or mean) at each visit
  // chosen, on the biomarker's own value axis, whose range is printed under
  // it. One key above them all. A tile is a button: a click, or Enter or Space
  // on it, opens its biomarker. Each tile is one small Chart.js chart, and
  // every biomarker is drawn: there are no pages.
  drawTiles() {
    const { kit, state, settings } = this;
    const built = buildTiles(this.drawTables, settings, this.drawingState(), this.measures, {
      filterMatches: kit.filterMatches
    });
    this.tiles = built;
    this.chartWrap.classList.add('sv-hidden');
    this.multiplesWrap.classList.add('bv-tiles');
    this.updateTileNotes(built);
    if (!built.tiles.some((tile) => tile.axis)) {
      this.footnote.textContent = built.filtered === 0 ? NOBODY_PASSES : NO_VALUE;
      return;
    }
    this.footnote.textContent = [
      'Click a biomarker to view it across the visits, with a test under each.',
      ...this.cutNotes(built)
    ].join(' ');

    // One key for all the tiles: what a line goes through, and each group in
    // its colour. A tile carries no legend of its own.
    const key = kit.createElement('p', 'bv-legend bv-tile-key');
    const by = state.groupBy ? ` by ${this.labelOf(state.groupBy)}` : '';
    key.append(
      kit.createElement(
        'span',
        null,
        `${SUMMARY_WORDS[state.tileSummary]} ${VALUE_WORDS[state.valueType]}${by}:`
      )
    );
    built.groups.forEach((group) => {
      const entry = kit.createElement('span');
      entry.dataset.group = group.level;
      const swatch = kit.createElement('span', 'bv-legend-swatch');
      swatch.style.background = this.colorOf(group.index);
      entry.append(swatch, document.createTextNode(group.level));
      key.append(entry);
    });
    const spread = settings.tile_min_spread;
    const caption = kit.createElement(
      'p',
      'bv-tile-caption',
      'Each biomarker has its own value axis, printed under its tile.' +
        (spread > 0
          ? ` It is never narrower than ${shown(spread)} standard deviation${spread === 1 ? '' : 's'} ` +
            'of the results at the baseline visit, so lines that differ by less stay close to flat.'
          : '')
    );
    const grid = kit.createElement('div', 'bv-tile-grid');
    this.multiplesWrap.append(key, caption, grid);

    this.tileSeries = (this.tileSeries || 0) + 1;
    built.tiles.forEach((tile, index) => {
      const button = kit.createElement('button', 'bv-tile');
      button.type = 'button';
      button.dataset.measure = tile.measure;
      button.setAttribute('aria-label', `View ${tile.measure}`);
      button.onclick = () => this.openFromTile(tile.measure);
      button.append(kit.createElement('span', 'bv-tile-name', tile.measure));
      grid.append(button);
      if (!tile.axis) {
        button.append(
          kit.createElement('span', 'bv-tile-empty', 'No participant has a value to draw.')
        );
        return;
      }
      const wrap = kit.createElement('span', 'bv-tile-canvas');
      const canvas = document.createElement('canvas');
      wrap.append(canvas);
      // Where the line starts and ends: the first and the last visit drawn.
      const visits = kit.createElement('span', 'bv-tile-visits');
      const named = tile.visits.map((visit) => visit ?? 'Baseline value');
      if (named.length === 1) visits.dataset.single = 'true';
      [...new Set([named[0], named[named.length - 1]])].forEach((visit) =>
        visits.append(kit.createElement('span', null, visit))
      );
      const range = kit.createElement('span', 'bv-tile-range', tile.range);
      range.id = `bv-tile-range-${this.tileSeries}-${index}`;
      button.setAttribute('aria-describedby', range.id);
      button.append(wrap, visits, range);
      const chart = this.drawTile(canvas, tile);
      chart.$measure = tile.measure;
      chart.$tile = tile;
    });
  }

  // One tile's chart: a line per group through its points, in visit order
  // along the tile, with nothing that answers the pointer, because the tile it
  // is in is what is clicked. A group with no value at a visit has no point
  // there, and its line runs on to its next value.
  drawTile(canvas, tile) {
    const { state } = this;
    const last = tile.visits.length - 1;
    const datasets = tile.lines.map((line) => {
      const hex = this.colorOf(line.index);
      return {
        label: line.level,
        data: line.points
          .map((point, at) => ({ x: at, y: point.value }))
          .filter((point) => point.y !== null),
        borderColor: hex,
        backgroundColor: hex,
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 2,
        tension: 0
      };
    });
    const chart = new this.kit.Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { datasets },
      options: {
        animation: false,
        maintainAspectRatio: false,
        responsive: true,
        parsing: false,
        events: [],
        layout: { padding: { top: 2, right: 5, bottom: 2, left: 5 } },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: {
            type: 'linear',
            min: last ? -0.15 : -0.5,
            max: last ? last + 0.15 : 0.5,
            display: false
          },
          y: {
            type: state.yScale === 'log' ? 'logarithmic' : 'linear',
            min: tile.axis.min,
            max: tile.axis.max,
            display: false
          }
        }
      },
      plugins: [this.tileFrame(tile)]
    });
    const said = tile.lines
      .map(
        (line) =>
          `${line.level} ${line.points.map((point) => (point.value === null ? 'none' : shown(point.value))).join(', ')}`
      )
      .join('; ');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute(
      'aria-label',
      `${tile.measure}, ${SUMMARY_WORDS[state.tileSummary].toLowerCase()} ${VALUE_WORDS[state.valueType]} at ` +
        `${tile.visits.map((visit) => visit ?? 'baseline').join(', ')}: ${said}`
    );
    this.charts.push(chart);
    return chart;
  }

  // What a tile draws beside its lines: the line it stands on, and, for a
  // value worked out against a baseline, a dashed line where no change is.
  tileFrame(tile) {
    return {
      id: 'gc-tile-frame',
      beforeDatasetsDraw: (chart) => {
        const { ctx, chartArea, scales } = chart;
        ctx.save();
        ctx.strokeStyle = '#c5ccd3';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(chartArea.left, chartArea.bottom);
        ctx.lineTo(chartArea.right, chartArea.bottom);
        ctx.stroke();
        const { reference } = tile;
        if (reference !== null && reference > tile.axis.min && reference < tile.axis.max) {
          const y = scales.y.getPixelForValue(reference);
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(chartArea.left, y);
          ctx.lineTo(chartArea.right, y);
          ctx.stroke();
        }
        ctx.restore();
      }
    };
  }

  // Opens a biomarker from its tile: over time, when every visit is chosen.
  // Its view replaces the tiles, so the page is brought back to the chart's
  // top, and the keyboard's place is put on the Biomarker control when it is
  // on screen.
  openFromTile(measure) {
    this.selectMeasure(measure);
    if (this.root.getBoundingClientRect().top < 0) this.root.scrollIntoView();
    const control = this.controls.querySelector('select[data-control="measure"]');
    if (control && control.offsetParent !== null) control.focus();
  }

  // ---- Where the view is ----------------------------------------------------------

  // The level drawn, named above the chart once a biomarker is open, each
  // level above it a button that leads back: every biomarker, then this
  // biomarker over time, then the visit or visits open.
  writeTrail(level) {
    const { kit, state } = this;
    if (!this.toolbar) return;
    const old = this.toolbar.querySelector('.bv-trail');
    if (old) old.remove();
    if (level === LEVELS.BIOMARKERS) return;
    const trail = kit.createElement('nav', 'bv-trail');
    trail.setAttribute('aria-label', 'Where this view is');
    trail.dataset.level = level;
    const list = document.createElement('ol');
    const step = (text, onClick) => {
      const item = document.createElement('li');
      if (onClick) {
        const button = kit.createElement('button', null, text);
        button.type = 'button';
        button.onclick = onClick;
        item.append(button);
      } else {
        const here = kit.createElement('span', null, text);
        here.setAttribute('aria-current', 'true');
        item.append(here);
      }
      list.append(item);
    };
    step('All biomarkers', () => this.selectMeasure(null));
    const offered = this.visitsOffered();
    if (level === LEVELS.OVER_TIME) {
      step(`${state.measure} over time`);
    } else {
      const chosen = state.visits.filter((visit) => offered.includes(visit));
      const where =
        state.valueType === 'baseline'
          ? 'baseline value'
          : chosen.length
            ? listed(chosen)
            : 'no visit chosen';
      if (hasOverTime(state, offered)) {
        step(`${state.measure} over time`, () => this.openOverTime());
        step(where);
      } else {
        step(`${state.measure}, ${where}`);
      }
    }
    trail.append(list);
    this.toolbar.append(trail);
  }

  // Leads back from a visit to the biomarker over time: every visit it has is
  // chosen again, as All in the Visit control does.
  openOverTime() {
    const offered = this.visitsOffered();
    const chosen = this.state.visits || [];
    this.state.visits = this.visits.all.filter(
      (visit) => chosen.includes(visit) || offered.includes(visit)
    );
    this.buildControls();
    this.render();
  }

  // Opens one visit of the biomarker drawn over time: the single-visit view,
  // with its marks, its second grouping, its panels and its pairwise
  // comparisons. The view replaces the picture, so the page is brought back to
  // the chart's top, and the keyboard's place is put on the Visit control.
  openVisit(visit) {
    const offered = this.visitsOffered();
    // A visit the biomarker lacks keeps its place for another biomarker.
    this.state.visits = this.visits.all.filter(
      (entry) => entry === visit || !offered.includes(entry)
    );
    this.buildControls();
    this.render();
    if (this.root.getBoundingClientRect().top < 0) this.root.scrollIntoView();
    const control = this.controls.querySelector('[data-control="visits"] summary');
    if (control && control.offsetParent !== null) control.focus();
  }

  // ---- One biomarker over time ---------------------------------------------------

  // One biomarker across every visit it has, in one picture: visit along the
  // bottom, evenly spaced in visit order, and at each visit the groups side by
  // side in their colours. Under the axis, lined up with the visits, a table:
  // each visit's name, which opens that visit alone; the number in each group
  // there; and R's test of the groups there, asked for in one request. The
  // picture and the table are one block, which scrolls sideways inside the
  // chart when the visits are too many for its width.
  drawOverTime(round) {
    const { kit, state, settings } = this;
    const built = buildOverTime(this.drawTables, settings, this.drawingState(), {
      filterMatches: kit.filterMatches
    });
    this.overTime = built;
    this.model = built.model;
    this.chartWrap.classList.add('sv-hidden');
    this.syncTestControls(this.groupsDrawn(built.model));
    this.updateNotes(built.model);
    const domain = timeDomain(built, state.timeMark, state.yScale);
    if (!domain) {
      this.footnote.textContent = nothingDrawn(built.model);
      return;
    }
    this.multiplesWrap.classList.add('bv-time');
    this.footnote.textContent = [
      'Click a visit to view it alone, with its marks, a second grouping and pairwise comparisons.',
      ...this.cutNotes(built)
    ].join(' ');

    // The key: what is drawn, and each group in its colour.
    const key = kit.createElement('p', 'bv-legend bv-time-key');
    const by = state.groupBy ? ` by ${this.labelOf(state.groupBy)}` : '';
    key.append(
      kit.createElement(
        'span',
        null,
        `${TIME_MARK_WORDS[state.timeMark]} ${VALUE_WORDS[state.valueType]}${by}:`
      )
    );
    built.groups.forEach((group) => {
      const entry = kit.createElement('span');
      entry.dataset.group = group.level;
      const swatch = kit.createElement('span', 'bv-legend-swatch');
      swatch.style.background = this.colorOf(group.index);
      entry.append(swatch, document.createTextNode(group.level));
      key.append(entry);
    });
    const caption = kit.createElement(
      'p',
      'bv-tile-caption bv-time-caption',
      TIME_MARK_NOTES[state.timeMark]
    );

    const scroll = kit.createElement('div', 'bv-time-scroll');
    const inner = kit.createElement('div', 'bv-time-inner');
    const wrap = kit.createElement('div', 'bv-time-canvas');
    const canvas = document.createElement('canvas');
    wrap.append(canvas);
    const table = this.timeTable(built);
    inner.append(wrap, table.element);
    scroll.append(inner);
    this.multiplesWrap.append(key, caption, scroll);
    // The statistics line of this level is under the table its tests are in.
    if (this.timeRow) {
      const line = kit.createElement('div', 'bv-statistic bv-time-line');
      line.setAttribute('role', 'status');
      this.multiplesWrap.append(line);
      this.timeRow.line = line;
    }

    // The table's first column is as wide as its longest heading, within a
    // third of the block, and the picture's value axis is made as wide, so a
    // visit's column in the table is under its place in the picture.
    const widest = Math.max(
      0,
      ...table.heads.map((head) => Math.ceil(head.getBoundingClientRect().width))
    );
    const gutter = Math.min(widest + 10, Math.max(64, Math.floor(scroll.clientWidth / 3)));
    table.heads.forEach((head) => {
      head.style.whiteSpace = 'normal';
    });
    inner.style.minWidth = `${gutter + built.visits.length * VISIT_WIDTH + 8}px`;
    const chart = this.drawTimeChart(canvas, built, { domain, gutter, table });
    chart.$overTime = built;
    this.askOverTime(round, built);
  }

  // The table under the picture: a column per visit, a row of the visits'
  // names, a row per group of the number drawn there, and the row of tests.
  timeTable(built) {
    const { kit, state, settings } = this;
    const table = kit.createElement('table', 'bv-time-table');
    const tested = settings.statistic && settings.statistic_by_visit;
    table.append(
      kit.createElement(
        'caption',
        null,
        `${state.measure} at each visit: the number in each group` +
          (tested ? ', and R’s test of the groups.' : '.')
      )
    );
    const columns = document.createElement('colgroup');
    const gutter = document.createElement('col');
    const tail = document.createElement('col');
    columns.append(gutter, ...built.visits.map(() => document.createElement('col')), tail);
    table.append(columns);
    const heads = [];
    // A row's heading, kept on one line while it is measured.
    const heading = (row, text, sub) => {
      const cell = document.createElement('th');
      cell.scope = 'row';
      const words = kit.createElement('span', 'bv-time-head');
      words.style.whiteSpace = 'nowrap';
      words.style.display = 'inline-block';
      words.append(...[].concat(text));
      if (sub) words.append(sub);
      cell.append(words);
      heads.push(words);
      row.append(cell);
      return cell;
    };

    const head = document.createElement('thead');
    const names = document.createElement('tr');
    names.dataset.row = 'visits';
    const corner = document.createElement('th');
    corner.scope = 'col';
    const cornerWords = kit.createElement('span', 'bv-time-head', 'Visit');
    cornerWords.style.whiteSpace = 'nowrap';
    cornerWords.style.display = 'inline-block';
    corner.append(cornerWords);
    heads.push(cornerWords);
    names.append(corner);
    built.columns.forEach((column) => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.dataset.visit = column.visit;
      if (column.tested) {
        const button = kit.createElement('button', 'bv-time-visit', column.visit);
        button.type = 'button';
        button.dataset.visit = column.visit;
        button.setAttribute('aria-label', `View ${state.measure} at ${column.visit}`);
        button.onclick = () => this.openVisit(column.visit);
        cell.append(button);
      } else {
        // The baseline visit of a change has nothing to compare when opened
        // alone: it is named, and is not a button.
        const still = kit.createElement('span', 'bv-time-still', column.visit);
        still.title = `${column.visit} is the baseline visit: there the ${VALUE_WORDS[state.valueType]} is the same for everyone.`;
        cell.append(still);
      }
      names.append(cell);
    });
    names.append(document.createElement('td'));
    head.append(names);

    const body = document.createElement('tbody');
    built.groups.forEach((group) => {
      const row = document.createElement('tr');
      row.dataset.row = 'n';
      row.dataset.group = group.level;
      const swatch = kit.createElement('span', 'bv-legend-swatch');
      swatch.style.background = this.colorOf(group.index);
      heading(row, [swatch, document.createTextNode(group.level)]);
      built.columns.forEach((column) => {
        const cell = column.cells.find((entry) => entry.level === group.level);
        const count = kit.createElement('td', null, `n = ${cell.n}`);
        count.dataset.visit = column.visit;
        row.append(count);
      });
      row.append(document.createElement('td'));
      body.append(row);
    });
    if (tested) {
      const row = document.createElement('tr');
      row.dataset.row = 'test';
      const sub = kit.createElement('span', 'bv-time-sub', 'p-value');
      const lead = heading(row, 'Test', sub);
      body.append(row);
      this.timeRow = { row, lead, sub, built };
    }
    table.append(head, body);
    return { element: table, heads, gutter, tail };
  }

  // The picture: one Chart.js chart, a dataset per group. Boxes are the kit's;
  // a mean or a median is a point with a bar through it, joined across the
  // visits by its group's line.
  drawTimeChart(canvas, built, { domain, gutter, table }) {
    const { state } = this;
    const mark = state.timeMark;
    const joined = mark !== 'box';
    const last = built.visits.length - 1;
    const title = yTitle(this.drawTables.results, this.settings, state);
    const datasets = built.groups.map((group) => {
      const hex = this.colorOf(group.index);
      const data = built.columns
        .map((column) => {
          const cell = column.cells.find((entry) => entry.level === group.level);
          const made = markOf(cell, mark);
          return made ? { x: cell.x, y: made.centre, made, cell, column } : null;
        })
        .filter(Boolean);
      return {
        label: group.level,
        data,
        showLine: joined,
        borderColor: hex,
        backgroundColor: hex,
        borderWidth: 2,
        tension: 0,
        // A box's point is unseen, at its median, for the tooltip to hang on.
        pointRadius: joined ? 3.5 : 0,
        pointHoverRadius: joined ? 5 : 0,
        pointHitRadius: 14
      };
    });
    const chart = new this.kit.Chart(canvas.getContext('2d'), {
      type: 'scatter',
      data: { datasets },
      options: {
        animation: false,
        maintainAspectRatio: false,
        responsive: true,
        parsing: false,
        interaction: { mode: 'nearest', intersect: true },
        onClick: (event) => this.onTimeClick(chart, event),
        layout: { padding: { top: 4, right: 8, bottom: 0, left: 0 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: () => '',
              label: (context) => this.timeTooltip(context.raw)
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            min: -0.5,
            max: last + 0.5,
            grid: { display: false },
            // The visits are named in the table beneath, each over its column.
            ticks: { display: false },
            afterBuildTicks: (axis) => {
              axis.ticks = built.visits.map((_, index) => ({ value: index }));
            }
          },
          y: {
            type: state.yScale === 'log' ? 'logarithmic' : 'linear',
            min: domain[0],
            max: domain[1],
            ticks: { includeBounds: false },
            title: { display: true, text: title },
            // As wide as the table's first column, so the visits line up.
            afterFit: (axis) => {
              axis.width = Math.max(axis.width, gutter);
            }
          }
        }
      },
      plugins: [this.timeFrame(built, table), this.timeMarks(built)]
    });
    const said = built.groups
      .map(
        (group, index) =>
          `${group.level} ${datasets[index].data.map((point) => shown(point.y)).join(', ')}`
      )
      .join('; ');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute(
      'aria-label',
      `${title}, ${TIME_MARK_LABELS[mark].toLowerCase()} at ${built.visits.join(', ')}: ${said}`
    );
    this.charts.push(chart);
    return chart;
  }

  // What the picture draws beside its marks: a faint line between one visit
  // and the next, a dashed line where no change is, and, once the chart is
  // laid out, the widths of the table's columns, so each visit's column is
  // under its place along the axis.
  timeFrame(built, table) {
    const reference = { change: 0, percent_change: 0, fold_change: 1 }[this.state.valueType];
    return {
      id: 'gc-time-frame',
      afterLayout: (chart) => {
        const { chartArea, width } = chart;
        if (!chartArea) return;
        table.gutter.style.width = `${chartArea.left}px`;
        table.tail.style.width = `${Math.max(width - chartArea.right, 0)}px`;
      },
      beforeDatasetsDraw: (chart) => {
        const { ctx, chartArea, scales } = chart;
        ctx.save();
        ctx.strokeStyle = '#eef1f4';
        ctx.lineWidth = 1;
        for (let at = 1; at < built.visits.length; at += 1) {
          const x = scales.x.getPixelForValue(at - 0.5);
          ctx.beginPath();
          ctx.moveTo(x, chartArea.top);
          ctx.lineTo(x, chartArea.bottom);
          ctx.stroke();
        }
        if (reference !== undefined && reference > scales.y.min && reference < scales.y.max) {
          const y = scales.y.getPixelForValue(reference);
          ctx.strokeStyle = '#9aa5b1';
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(chartArea.left, y);
          ctx.lineTo(chartArea.right, y);
          ctx.stroke();
        }
        ctx.restore();
      }
    };
  }

  // The marks of the picture: safety.viz's box for a box, and for a mean or a
  // median the bar through its point, from the lower end to the upper, with a
  // short cap at each.
  timeMarks(built) {
    const mark = this.state.timeMark;
    const cells = built.columns.flatMap((column) => column.cells.filter((cell) => cell.n));
    if (mark === 'box') {
      return this.kit.boxWhiskerPlugin('gc-time', () =>
        cells.map((cell) => ({
          x: cell.x,
          halfWidth: cell.halfWidth,
          stats: cell.stats,
          color: this.colorOf(cell.index)
        }))
      );
    }
    return {
      id: 'gc-time-bars',
      beforeDatasetsDraw: (chart) => {
        const { ctx, scales, chartArea } = chart;
        const yOf = (value) =>
          Math.max(chartArea.top, Math.min(chartArea.bottom, scales.y.getPixelForValue(value)));
        ctx.save();
        ctx.lineWidth = 1.5;
        for (const cell of cells) {
          const made = markOf(cell, mark);
          if (made.upper === made.lower) continue;
          const x = scales.x.getPixelForValue(cell.x);
          const cap = Math.min(5, (scales.x.getPixelForValue(cell.x + cell.halfWidth) - x) * 0.5);
          ctx.strokeStyle = this.colorOf(cell.index);
          ctx.beginPath();
          ctx.moveTo(x, yOf(made.lower));
          ctx.lineTo(x, yOf(made.upper));
          for (const end of [made.lower, made.upper]) {
            ctx.moveTo(x - cap, yOf(end));
            ctx.lineTo(x + cap, yOf(end));
          }
          ctx.stroke();
        }
        ctx.restore();
      }
    };
  }

  timeTooltip(raw) {
    if (!raw || !raw.cell) return '';
    const { cell, column } = raw;
    const { stats } = cell;
    const lead = `${cell.level} at ${column.visit}: n = ${stats.n}`;
    if (this.state.timeMark === 'mean_se') {
      return [
        lead,
        `Mean ${shown(stats.mean)}`,
        cell.se === null
          ? 'One participant: no standard error'
          : `Standard error ${shown(cell.se)}, from ${shown(raw.made.lower)} to ${shown(raw.made.upper)}`
      ];
    }
    return [
      lead,
      `Median ${shown(stats.median)}`,
      `Quartiles ${shown(stats.q25)} to ${shown(stats.q75)}`,
      ...(this.state.timeMark === 'box'
        ? [
            `5th to 95th percentile ${shown(stats.q5)} to ${shown(stats.q95)}`,
            `Mean ${shown(stats.mean)}`
          ]
        : [])
    ];
  }

  // A click anywhere in a visit's part of the picture opens that visit, as its
  // name in the table does; the baseline visit of a change is not opened.
  onTimeClick(chart, event) {
    const built = chart.$overTime;
    const { chartArea, scales } = chart;
    if (!built || event.x < chartArea.left || event.x > chartArea.right) return;
    const column = built.columns[Math.round(scales.x.getValueForPixel(event.x))];
    if (column && column.tested) this.openVisit(column.visit);
  }

  // Asks R for the test at every visit, in one request, and fills the row of
  // tests when it answers. With no test chosen, or fewer than two groups, R is
  // not asked, and the row says so.
  askOverTime(round, built) {
    const { settings, state } = this;
    if (!this.timeRow) return;
    const groups = this.groupsDrawn(built.model);
    const test = fitTest(state.test, groups);
    if (test === 'none') {
      this.showLevels(plain('none', this.desk.idle(NO_TEST_CHOSEN)), 'No test chosen');
      return;
    }
    if (test === null) {
      this.showLevels(
        plain(
          'none',
          noTestText(state.groupBy ? built.groups.map((group) => group.level) : null, false)
        )
      );
      return;
    }
    this.timeRow.test = test;
    const request = overTimeRequest({
      name: settings.statistic_by_visit,
      test,
      adjustment: state.visitAdjustment,
      settings,
      state: this.drawingState(),
      built,
      unscheduled: Boolean(state.unscheduledVisits) && this.unscheduled.visits.length > 0
    });
    const asked = {
      panel: '',
      name: request.name,
      args: request.args,
      dataId: request.dataId,
      rows: request.rows,
      answer: null
    };
    this.asked.push(asked);
    round.ask(
      request,
      (description, answer) => {
        if (answer) asked.answer = answer;
        writeTitles(this);
        this.showLevels(description);
      },
      {
        levels: true,
        scope: levelsScope({
          group: this.labelOf(state.groupBy),
          untested: built.untested,
          value: VALUE_WORDS[state.valueType],
          filters: filtersForScope(this)
        })
      }
    );
  }

  // Writes the row of tests and the statistics line beneath from one
  // description. With a result for the visits, each visit's cell holds its
  // p-value as R returned it, or says that it has none, and the row's heading
  // names the adjustment R made; the line names the method, gives R's reason
  // for each visit it did not compute, R's own remarks and what the tests
  // cover. With none, one cell across the visits says so in a few words, and
  // the line says it in full.
  showLevels(description, words) {
    const { kit } = this;
    const { row, lead, sub, built, test, line } = this.timeRow;
    while (lead.nextSibling) lead.nextSibling.remove();
    row.dataset.state = description.state;
    const head = lead.querySelector('.bv-time-head');
    head.firstChild.textContent = test ? TEST_LABELS[test] : 'Test';
    const levels = description.levels;
    if (!levels) {
      sub.textContent = 'p-value';
      const cell = kit.createElement('td', null, words || ROW_WORDS[description.state] || '');
      cell.colSpan = built.columns.length;
      row.append(cell);
    } else {
      const adjusted = levels.find((level) => level.status === 'shown' && level.adjustment);
      sub.textContent = adjusted ? `p, adjusted (${adjusted.adjustment})` : 'p, unadjusted';
      built.columns.forEach((column) => {
        const cell = document.createElement('td');
        cell.dataset.visit = column.visit;
        const level = levels.find((entry) => entry.by === column.visit);
        if (!column.tested) {
          cell.dataset.status = 'untested';
          cell.textContent = 'not tested';
          cell.title = `${column.visit} is the baseline visit: there the ${VALUE_WORDS[this.state.valueType]} is the same for everyone.`;
        } else if (!level) {
          cell.dataset.status = 'missing';
          cell.textContent = 'no answer';
        } else {
          cell.dataset.status = level.status;
          cell.textContent = level.status === 'shown' ? level.p : CELL_WORDS[level.status];
          // The whole sentence, with the method and each group's count.
          cell.title = level.text;
        }
        row.append(cell);
      });
    }
    row.append(document.createElement('td'));
    writeStatistic(kit, line, { ...description, table: null });
    // A visit that has no p-value says why, under the result.
    const after = line.querySelector('.bv-stat-result');
    [...(description.details || [])].reverse().forEach((said) => {
      after.after(kit.createElement('p', 'bv-stat-level', said));
    });
  }

  // Above the tiles: what applies to every one of them. The counts of who was
  // drawn and left out are a biomarker's own, and are given when it is opened.
  updateTileNotes(built) {
    const { kit, state } = this;
    const add = (text) => this.notes.append(kit.createElement('span', null, text));
    if (built.filtered !== null && built.filtered < this.tables.participants.length) {
      add(`${built.filtered} of ${this.tables.participants.length} participants pass the filters.`);
    }
    if (state.levels) {
      const offered = this.levelsOffered();
      const kept = offered.filter((level) => state.levels.includes(level));
      if (kept.length < offered.length) add(`${kept.length} of ${offered.length} levels shown.`);
    }
    if (state.valueType === 'baseline') {
      add('A baseline value has no visit: each group is one point.');
    } else if (state.valueType !== 'raw' && built.baselineVisits) {
      add(`Baseline visit: ${built.baselineVisits.join(', ')}.`);
    }
  }

  // Says how many unscheduled visits are left out, and which, whatever level
  // is drawn; nothing when they are drawn or there are none.
  noteHiddenVisits() {
    const hidden = this.hiddenVisits;
    if (!hidden.length) return;
    const one = hidden.length === 1;
    const note = this.kit.createElement(
      'span',
      'bv-hidden-visits',
      `${hidden.length} unscheduled visit${one ? '' : 's'} not drawn: ${listed(hidden)}. ` +
        `Switch on Unscheduled visits to draw ${one ? 'it' : 'them'}.`
    );
    note.dataset.hidden = String(hidden.length);
    this.notes.append(note);
  }

  // The baseline visit of a value worked out against one, and that it is not
  // drawn when it was chosen: there the value is the same for everyone.
  addBaselineNote(model, add) {
    if (!model.baselineVisits || this.state.valueType === 'raw') return;
    const same = `there the ${VALUE_LABELS[this.state.valueType].toLowerCase()} is the same for everyone.`;
    let said = '';
    if (model.visitsNotDrawn.length) said = ` It is not drawn: ${same}`;
    // Over time it is drawn, where every group starts, and is not tested.
    else if (this.overTime && this.overTime.untested.length) said = ` It is not tested: ${same}`;
    add(`Baseline visit: ${model.baselineVisits.join(', ')}.${said}`);
  }

  // The value axis: the extent of what is drawn, with a little room. On a
  // logarithmic axis the room is a ratio, so the lower end stays above zero.
  domain(model) {
    const [least, greatest] = model.extent;
    if (this.state.yScale === 'log') {
      const factor = greatest > least ? (greatest / least) ** 0.05 : 1.05;
      return [least / factor, greatest * factor];
    }
    const room = (greatest - least) * 0.05 || Math.abs(greatest) * 0.05 || 1;
    return [least - room, greatest + room];
  }

  colorOf(index) {
    return PALETTE[index % PALETTE.length];
  }

  drawPanel(canvas, panel, model, { title, domain }) {
    const { state } = this;
    const groupLabel = state.groupBy ? this.labelOf(state.groupBy) : '';
    const coloured = model.colors.length > 1 || model.colors[0] !== null;

    const datasets = model.colors.map((color, colorIndex) => {
      const hex = this.colorOf(colorIndex);
      const cells = panel.cells.filter((cell) => cell.colorIndex === colorIndex && cell.n);
      const data =
        state.mark === 'points'
          ? cells.flatMap((cell) =>
              cell.records.map((record) => ({
                x: cell.x + jitter(record[this.settings.id_col]) * cell.halfWidth * 0.85,
                y: record.y,
                cell,
                record
              }))
            )
          : // One unseen point per cell, at its median, for the tooltip to hang on.
            cells.map((cell) => ({ x: cell.x, y: cell.stats.median, cell }));
      return {
        label: color === null ? groupLabel || 'All participants' : color,
        data,
        showLine: false,
        backgroundColor: hexToRgba(hex, 0.55),
        borderColor: hex,
        pointRadius: state.mark === 'points' ? 3 : 0,
        pointHoverRadius: state.mark === 'points' ? 5 : 0,
        pointHitRadius: state.mark === 'points' ? 4 : 14
      };
    });

    const chart = new this.kit.Chart(canvas.getContext('2d'), {
      type: 'scatter',
      data: { datasets },
      options: {
        animation: false,
        maintainAspectRatio: false,
        responsive: true,
        interaction: { mode: 'nearest', intersect: true },
        onClick: (event) => this.onChartClick(chart, panel, event),
        plugins: {
          legend: {
            display: coloured,
            position: 'top',
            title: { display: coloured, text: this.labelOf(state.colorBy) }
          },
          tooltip: {
            callbacks: {
              title: () => '',
              label: (context) => this.tooltip(context.raw)
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            min: -0.5,
            max: model.shownLevels.length - 0.5,
            grid: { display: false },
            title: { display: Boolean(groupLabel), text: groupLabel },
            ticks: {
              autoSkip: false,
              // A panel turns its labels when they would run together, as a
              // narrow visit panel's long group names would; labels that fit
              // stay level.
              maxRotation: 90,
              callback: (value) => (Number.isInteger(value) ? (panel.ticks[value] ?? '') : '')
            },
            afterBuildTicks: (axis) => {
              axis.ticks = model.shownLevels.map((_, index) => ({ value: index }));
            }
          },
          y: {
            type: state.yScale === 'log' ? 'logarithmic' : 'linear',
            min: domain[0],
            max: domain[1],
            // The ends of the axis are room about the data, not round numbers.
            ticks: { includeBounds: false },
            title: { display: true, text: title }
          }
        }
      },
      plugins: [this.markPlugin(panel)]
    });
    chart.$panel = panel;
    chart.$model = model;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute(
      'aria-label',
      `${title}${panel.title ? `, ${panel.title}` : ''}: ` +
        panel.ticks.map((lines) => `${lines[0]} ${lines[1]}`).join('; ')
    );
    this.charts.push(chart);
    return chart;
  }

  // The marks: safety.viz's box for a box, an outline drawn here for a violin,
  // and nothing more than the points themselves for points.
  markPlugin(panel) {
    const cells = panel.cells.filter((cell) => cell.n);
    if (this.state.mark === 'box') {
      return this.kit.boxWhiskerPlugin('gc', () =>
        cells.map((cell) => ({
          x: cell.x,
          halfWidth: cell.halfWidth,
          stats: cell.stats,
          color: this.colorOf(cell.colorIndex)
        }))
      );
    }
    if (this.state.mark !== 'violin') return { id: 'gc-no-marks' };
    return {
      id: `gc-violin-${Math.random().toString(36).slice(2)}`,
      afterDatasetsDraw: (chart) => {
        const { ctx, scales, chartArea } = chart;
        const yOf = (value) =>
          Math.max(chartArea.top, Math.min(chartArea.bottom, scales.y.getPixelForValue(value)));
        ctx.save();
        for (const cell of cells) {
          const color = this.colorOf(cell.colorIndex);
          const centre = scales.x.getPixelForValue(cell.x);
          const half = scales.x.getPixelForValue(cell.x + cell.halfWidth) - centre;
          ctx.strokeStyle = color;
          ctx.fillStyle = hexToRgba(color, 0.35);
          ctx.lineWidth = 1.5;
          if (cell.density) {
            // Every violin is as wide as its slot at its widest.
            const widest = Math.max(...cell.density.density);
            const widths = cell.density.density.map((value) => (value / widest) * half);
            ctx.beginPath();
            cell.density.at.forEach((height, index) => {
              const y = yOf(height);
              if (index === 0) ctx.moveTo(centre - widths[index], y);
              else ctx.lineTo(centre - widths[index], y);
            });
            for (let index = cell.density.at.length - 1; index >= 0; index -= 1) {
              ctx.lineTo(centre + widths[index], yOf(cell.density.at[index]));
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
          // The median, as a line across the violin; all there is to draw for a
          // cell with one value, or with every value the same.
          ctx.beginPath();
          ctx.lineWidth = 2;
          ctx.moveTo(centre - half * 0.5, yOf(cell.stats.median));
          ctx.lineTo(centre + half * 0.5, yOf(cell.stats.median));
          ctx.stroke();
        }
        ctx.restore();
      }
    };
  }

  tooltip(raw) {
    if (!raw || !raw.cell) return '';
    const { cell } = raw;
    const name = cell.color === null ? cell.level : `${cell.level}, ${cell.color}`;
    if (raw.record) return `${raw.record[this.settings.id_col]}: ${shown(raw.record.y)} (${name})`;
    const { stats } = cell;
    return [
      `${name}: n = ${stats.n}`,
      `Median ${shown(stats.median)}`,
      `Quartiles ${shown(stats.q25)} to ${shown(stats.q75)}`,
      `5th to 95th percentile ${shown(stats.q5)} to ${shown(stats.q95)}`,
      `Least ${shown(stats.min)}, greatest ${shown(stats.max)}`,
      `Mean ${shown(stats.mean)}`
    ];
  }

  // The participants seen and drawn, and why any was left out.
  updateNotes(model) {
    const { kit, state } = this;
    const add = (text, warning) =>
      this.notes.append(kit.createElement('span', warning ? 'sv-warning' : null, text));
    const several = model.panels.length > 1;
    const byVisit = new Map();
    model.panels.forEach((panel) => {
      const entry = byVisit.get(panel.visit) || { drawn: 0, panel };
      entry.drawn += panel.records.length;
      byVisit.set(panel.visit, entry);
    });
    for (const [visit, { drawn, panel }] of byVisit) {
      const where = several && visit !== null ? `${visit}: ` : '';
      add(`${where}${drawn} of ${panel.participants} participants drawn.`);
      panel.dropped.forEach((entry) => add(`${where}${entry.n} left out: ${entry.reason}.`, true));
      if (panel.nonPositive) {
        add(
          `${where}${panel.nonPositive} left out: zero or less, which a logarithmic scale cannot show.`,
          true
        );
      }
      // A row with no usable result is already told above, by the participant
      // it left without a value; the rest (duplicates, rows with no id) are not.
      panel.unused
        .filter((entry) => entry.reason !== UNUSED.MISSING_RESULT)
        .forEach((entry) =>
          add(`${where}${entry.n} row${entry.n === 1 ? '' : 's'} not used: ${entry.reason}.`, true)
        );
    }
    if (model.filtered !== null && model.filtered < this.tables.participants.length) {
      add(`${model.filtered} of ${this.tables.participants.length} participants pass the filters.`);
    }
    if (state.levels && model.shownLevels.length < model.levels.length) {
      add(`${model.shownLevels.length} of ${model.levels.length} levels shown.`);
    }
    this.addBaselineNote(model, add);
  }

  // ---- The statistics line ----------------------------------------------------

  // How many groups the chart draws: the levels on the axis. With no column to
  // group by everyone is one group, and there is nothing to compare.
  groupsDrawn(model) {
    return this.state.groupBy ? model.shownLevels.length : 0;
  }

  // What one panel's test covers, said under its result.
  scope(panel, model) {
    const { state } = this;
    return scopeText({
      group: this.labelOf(state.groupBy),
      n: panel.records.length,
      panel: model.panels.length > 1 ? panel.title : null,
      color: state.colorBy ? this.labelOf(state.colorBy) : null,
      filters: filtersForScope(this)
    });
  }

  // Asks R for one panel's test and prints the answer under the panel. Each
  // panel asks for itself, on its own rows, and is answered for itself.
  askStatistic(round, panel, model, line) {
    if (!this.settings.statistic) return;
    const show = (description) => this.showStatistic(line, description);
    const test = fitTest(this.state.test, this.groupsDrawn(model));
    if (test === 'none') {
      show(plain('none', this.desk.idle(NO_TEST_CHOSEN)));
      return;
    }
    // A test compares two or more groups. A panel with fewer is told so here:
    // R is not asked a question it could only refuse.
    const inPanel = groupsOf(panel.records);
    if (test === null || inPanel.length < 2) {
      show(plain('none', noTestText(this.state.groupBy ? inPanel : null, model.panels.length > 1)));
      return;
    }
    const request = statisticRequest({
      name: this.settings.statistic,
      test,
      pairwise: this.state.pairwise,
      settings: this.settings,
      state: this.drawingState(),
      panel,
      // The rows framed hold unscheduled visits only when the results have
      // some and they are switched on.
      unscheduled: Boolean(this.state.unscheduledVisits) && this.unscheduled.visits.length > 0
    });
    const asked = {
      panel: panel.title,
      name: request.name,
      args: request.args,
      dataId: request.dataId,
      rows: request.rows,
      answer: null
    };
    this.asked.push(asked);
    round.ask(
      request,
      (description, answer) => {
        if (answer) asked.answer = answer;
        writeTitles(this);
        show(description);
      },
      { scope: this.scope(panel, model) }
    );
  }

  // Writes one description on a line: the result, the estimates R gave an
  // interval for, the pairwise comparisons, what R said about its answer, and
  // what the test covers.
  showStatistic(line, description) {
    const { pairs } = description;
    writeStatistic(this.kit, line, {
      ...description,
      // The pairwise comparisons, as the table every chart's line can carry:
      // each pair, with its method beneath where the pairs' methods differ.
      table: pairs && {
        caption: pairs.caption,
        head: pairs.head,
        rows: pairs.rows.map((row) => ({
          status: row.status,
          head: row.pair,
          sub: row.method,
          cells: [row.n, row.p]
        }))
      }
    });
  }

  /**
   * What the controls now read, as the settings the chart would open on with
   * them: the part of its specification the controls hold (#68).
   * @returns {object}
   */
  viewSettings() {
    const { state } = this;
    return {
      start_value: state.measure ?? null,
      visits: [...state.visits],
      value_type: state.valueType,
      group_by: state.groupBy ? this.groupingOf(state.groupBy) : null,
      levels: state.levels ?? null,
      color_by: state.colorBy || null,
      panel_by: state.panelBy ? this.groupingOf(state.panelBy) : null,
      mark: state.mark,
      time_mark: state.timeMark,
      y_scale: state.yScale,
      tile_summary: state.tileSummary,
      unscheduled_visits: Boolean(state.unscheduledVisits),
      test: state.test,
      pairwise: state.pairwise,
      visit_adjustment: state.visitAdjustment
    };
  }

  /**
   * The chart's specification: its name, the bio.viz version, every setting
   * as the controls now read, and every filter in force, as JSON data, which
   * `BioViz.fromSpecification` makes the same chart from (#68).
   * @returns {object}
   */
  specification() {
    return specificationOf(this);
  }

  /**
   * The table the chart drew from, one row per participant drawn, for the
   * table download (#67): which field of a row each column holds, and its
   * heading. On the trend tiles, one row per participant, biomarker and visit:
   * the values each point is the median or the mean of (#78, #84). For one
   * biomarker over time, one row per participant and visit (#85).
   * @returns {{columns: Array<{value_col: string, label: string}>, rows: object[]}}
   */
  tableOf() {
    const { model, state, settings, tiles } = this;
    if (!model && tiles) return this.tilesTable();
    if (!model || !model.panels) return { columns: [], rows: [] };
    const visits = model.panels.some((panel) => panel.visit !== null && panel.visit !== undefined);
    const columns = [{ value_col: settings.id_col, label: 'Participant' }];
    if (visits) columns.push({ value_col: 'visit', label: 'Visit' });
    if (state.groupBy) columns.push({ value_col: 'x', label: this.labelOf(state.groupBy) });
    if (state.colorBy) columns.push({ value_col: 'color', label: this.labelOf(state.colorBy) });
    if (state.panelBy) columns.push({ value_col: 'panel', label: this.labelOf(state.panelBy) });
    columns.push({
      value_col: 'y',
      label: `${state.measure}, ${VALUE_LABELS[state.valueType] || state.valueType}`
    });
    const rows = model.panels.flatMap((panel) =>
      panel.records.map((record) => ({ ...record, visit: panel.visit }))
    );
    return { columns, rows };
  }

  // The tiles' table: every value behind a point of any tile, each row naming
  // its biomarker and its visit. The tiles draw no colour and no panel column;
  // the values are of the one value type the controls choose.
  tilesTable() {
    const { tiles, state, settings } = this;
    const visits = state.valueType !== 'baseline';
    const columns = [
      { value_col: settings.id_col, label: 'Participant' },
      { value_col: 'biomarker', label: 'Biomarker' }
    ];
    if (visits) columns.push({ value_col: 'visit', label: 'Visit' });
    if (state.groupBy) columns.push({ value_col: 'x', label: this.labelOf(state.groupBy) });
    columns.push({ value_col: 'y', label: VALUE_LABELS[state.valueType] || state.valueType });
    const rows = tiles.tiles.flatMap((tile) =>
      tile.records.map((record) => ({ ...record, biomarker: tile.measure }))
    );
    return { columns, rows };
  }

  /** The placeholders a download's file name is made of, after the chart's name. */
  get viewFields() {
    return ['measure', 'visits', 'group'];
  }

  /**
   * What the title, subtitle and footnotes' placeholders hold for the view now
   * drawn, beside `{date}`, `{version}` and `{filters}` (#66).
   * @returns {object}
   */
  placeholders() {
    const { state, model, tiles } = this;
    // The participants drawn: in the one biomarker's panels, or, on the tiles,
    // behind a point of any of them.
    const records = model
      ? model.panels.flatMap((panel) => panel.records)
      : tiles
        ? tiles.tiles.flatMap((tile) => tile.records)
        : [];
    const ids = new Set();
    for (const record of records) ids.add(record[this.settings.id_col] ?? record.id);
    return {
      measure: state.measure ?? 'every biomarker',
      visits: (state.visits || []).join(', '),
      value: VALUE_LABELS[state.valueType] || state.valueType,
      group: state.groupBy ? this.labelOf(state.groupBy) : '',
      n: model || tiles ? ids.size : ''
    };
  }

  /**
   * What the chart has asked R for the panels now drawn, and what R answered:
   * one entry per panel that asked, in the order the panels are drawn. One
   * biomarker over time is one entry, the request for the test at every visit,
   * whose `panel` is empty. A request is exactly what the connection was
   * given, so it is the key a stored result must carry to be found.
   * @returns {Array<{panel: string, name: string, args: object, dataId: object,
   *   rows: number, answer: ?object}>} `answer` is what the connection resolved
   *   to, or null while R has not answered.
   */
  statistics() {
    return structuredClone(this.asked);
  }

  // ---- Listing and participant profile ---------------------------------------

  onChartClick(chart, panel, event) {
    if (this.state.mark === 'points') {
      const [hit] = chart.getElementsAtEventForMode(
        event.native,
        'nearest',
        { intersect: true },
        false
      );
      if (!hit) return;
      const { cell, record } = chart.data.datasets[hit.datasetIndex].data[hit.index];
      this.showListing(panel, cell, [record]);
      this.select(record[this.settings.id_col]);
      return;
    }
    const x = chart.scales.x.getValueForPixel(event.x);
    const y = chart.scales.y.getValueForPixel(event.y);
    const cell = panel.cells.find((candidate) => {
      if (!candidate.n || Math.abs(x - candidate.x) > candidate.halfWidth) return false;
      const { stats } = candidate;
      // A box reaches from whisker to whisker; a violin from least to greatest.
      const [low, high] =
        this.state.mark === 'box' ? [stats.q5, stats.q95] : [stats.min, stats.max];
      return y >= low && y <= high;
    });
    if (cell) this.showListing(panel, cell, cell.records);
  }

  // The columns of the listing: the ones named in settings, or the participant,
  // the group, the colour and the panel, and the value drawn.
  listingColumns() {
    if (this.settings.details) return this.settings.details;
    const { state, settings } = this;
    const columns = [{ value_col: settings.id_col, label: 'Participant' }];
    if (state.groupBy) columns.push({ value_col: 'x', label: this.labelOf(state.groupBy) });
    if (state.colorBy) columns.push({ value_col: 'color', label: this.labelOf(state.colorBy) });
    if (state.panelBy) columns.push({ value_col: 'panel', label: this.labelOf(state.panelBy) });
    columns.push({ value_col: 'y', label: 'Value' });
    return columns;
  }

  // How each cut variable on the chart was cut, a sentence each.
  cutNotes(model) {
    return ['x', 'panel']
      .filter((field) => model.cuts && model.cuts[field])
      .map((field) => cutNote(model.cuts[field].spec, model.cuts[field]));
  }

  showListing(panel, cell, records) {
    this.clearSelection();
    showListing(this, {
      columns: this.listingColumns(),
      rows: records.map((record) => ({ ...record, y: shown(record.y) }))
    });
    this.listed = { panel, cell };
    const name = cell.color === null ? cell.level : `${cell.level}, ${cell.color}`;
    const where = panel.title ? ` (${panel.title})` : '';
    this.footnote.textContent =
      `${name}${where}: ${records.length} participant${records.length === 1 ? '' : 's'} listed. ` +
      "Click a row to open the participant's profile.";
  }

  // Select one participant, or none: mark the listing's row and raise
  // safety.viz's selection event, which the participant rail opens on and any
  // other chart on the page can listen for.
  select(id) {
    selectParticipant(this, id);
  }

  // Empties the listing and the rail without raising an event: the chart is
  // about to show other rows.
  clearSelection() {
    this.listed = null;
    clearListing(this);
  }

  // The rows safety.viz's participant rail reads, and the rail, mounted.
  buildProfileFeed() {
    buildProfileFeed(this, () => this.railSettings());
  }

  railSettings() {
    return railSettings(this, this.state.yScale);
  }

  // ---- Lifecycle --------------------------------------------------------------

  /**
   * Fit the chart to its container, for a page that changes the container's
   * size without resizing the window.
   * @returns {void}
   */
  resize() {
    this.charts.forEach((chart) => chart.resize());
  }

  destroyCharts() {
    this.charts.forEach((chart) => chart.destroy());
    this.charts = [];
  }

  /**
   * Take the chart down: its Chart.js charts, its participant rail and
   * everything in its element. A destroyed chart cannot be used again; make a
   * new one.
   * @returns {void}
   */
  destroy() {
    // Any answer still on its way from R is for a chart that is gone.
    this.desk.begin();
    this.destroyCharts();
    this.kit.unmountProfileRail(this.host);
    this.element.innerHTML = '';
  }
}

/**
 * Make a group comparison chart in an element. The controls are drawn at once;
 * give the tables to `init` on the chart that is returned.
 *
 * @param {string|HTMLElement} element The element, or a CSS selector for it.
 * @param {object} [settings] Settings to lay over the defaults.
 * @returns {GroupComparison} The chart: `init`, `setData`, `setSettings`,
 *   `render`, `resize`, `destroy`.
 */
export function groupComparison(element, settings) {
  return new GroupComparison(element, settings);
}
