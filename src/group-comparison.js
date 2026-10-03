// The group comparison chart: one value across the levels of a category, as
// boxes, violins or points, with the number in each group beneath.
//
//   BioViz.groupComparison('#chart', { group_by: 'ARM' }).init({ results, participants });
//
// It opens on an overview of every biomarker at every visit, one row per
// biomarker, and a row opens that biomarker alone, with its visits as panels
// and R's test under each.
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
import { UNUSED } from './core/reasons.js';
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
  renderPager,
  toolbarStyles,
  drawSafely,
  checkTables
} from './shared/chartHost.js';
import { VALUE_TYPES } from './core/variable.js';
import { NOBODY_PASSES } from './shared/tables.js';
import { MARKS, Y_SCALES, syncSettings } from './group-comparison/configure.js';
import {
  NO_TEST_CHOSEN,
  TEST_LABELS,
  createStatisticDesk,
  fitTest,
  groupsOf,
  noTestText,
  plain,
  scopeText,
  statisticRequest,
  testsFor
} from './group-comparison/statistic.js';
import {
  buildOverview,
  buildPanels,
  categoryColumns,
  columnLevels,
  filterColumns,
  jitter,
  listMeasures,
  listVisits,
  measureVisits,
  overviewCount,
  overviewPage,
  yTitle
} from './group-comparison/structureData.js';

const NONE = '';

// The Biomarker control's entry for the overview of every biomarker, as
// safety.viz's histogram has one for every measure. In the chart's state the
// overview is a biomarker of null.
const OVERVIEW = 'bv_overview';

const MARK_LABELS = { box: 'Box', violin: 'Violin', points: 'Points' };

const STYLE_ID = 'bio-viz-group-comparison-styles';
// The statistics line, the listing and the rail are styled as every chart's
// are; the rest is this chart's own.
const STYLES = `${lineStyles('.bv-group-comparison')}
${toolbarStyles('.bv-group-comparison')}
.bv-group-comparison .sv-chart-wrap canvas,.bv-group-comparison .bv-panel-canvas canvas{cursor:pointer}
.bv-group-comparison .sv-multiples.bv-overview{display:block}
.bv-group-comparison .bv-overview-row{margin:0 0 .8rem}
.bv-group-comparison .bv-overview-panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(var(--bv-panel-min,150px),1fr));gap:.4rem .6rem}
.bv-group-comparison .bv-overview-panel{min-width:0;max-width:340px}
.bv-group-comparison .bv-overview-panel h4{font-size:.78rem;font-weight:600;margin:0 0 .1rem;color:#52616f}
.bv-group-comparison .bv-overview-canvas{height:150px;position:relative}
.bv-group-comparison .bv-overview-pager{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem .7rem;margin:0 0 .8rem;font-size:.85rem;color:#1f2933}
.bv-group-comparison .bv-overview-pager button{font:inherit;padding:.3rem .7rem;border:1px solid #c5ccd3;border-radius:6px;background:#fff;color:#1f2933;cursor:pointer}
.bv-group-comparison .bv-overview-pager button:disabled{color:#9aa5b1;cursor:default}
.bv-group-comparison .bv-legend{display:flex;flex-wrap:wrap;gap:.2rem 1rem;margin:0 0 .6rem;font-size:.8rem;color:#1f2933}
.bv-group-comparison .bv-legend-swatch{display:inline-block;width:.75em;height:.75em;margin-right:.35em;border-radius:2px}
.bv-group-comparison .bv-control-note{display:block;margin:.2rem 0 0;font-size:.75rem;color:#52616f}
@media (max-width:600px){
.bv-group-comparison .bv-overview-canvas{height:118px}
.bv-group-comparison .bv-overview-row{padding:.55rem .6rem}
.bv-group-comparison .sv-chart-wrap{height:380px;padding:.5rem}
.bv-group-comparison.sv-collapsed .sv-sidebar-title{display:inline}
.bv-group-comparison.sv-collapsed .sv-sidebar{padding:.5rem .9rem}
}`;

// Said when the only visit chosen is the baseline visit of a change.
const NOTHING_AFTER_BASELINE =
  'The only visit chosen is the baseline visit, where this value is the same for everyone. ' +
  'Choose a later visit to draw.';

// Why nothing is drawn: nobody passes the filters; or nobody that does has a
// value for this choice; or the only visit chosen is the baseline visit of a
// change. `rows` are the overview's, when it is the overview.
function nothingDrawn(model, rows = [{ model }]) {
  if (model.filtered === 0) return NOBODY_PASSES;
  return model.noRows || rows.some((row) => row.model.panels.length)
    ? 'No participant has a value to draw for this choice.'
    : NOTHING_AFTER_BASELINE;
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
    this.charts = [];
    this.model = null;
    this.measures = [];
    this.visits = [];
    this.categories = [];
    this.filterSpecs = [];
    this.state = {};
    this.asked = [];
    this.overview = null;
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
   * @returns {GroupComparison} The chart, for chaining.
   */
  setData(data) {
    this.tables = readGiven(this, data);
    this.readTables();
    this.state = this.seedState();
    this.buildProfileFeed();
    this.buildControls();
    this.render();
    return this;
  }

  /**
   * Lay new settings over the current ones and draw again. A setting that says
   * what the chart opens on (`start_value`, `visits`, `value_type`, `group_by`,
   * `levels`, `color_by`, `panel_by`, `mark`, `y_scale`, `test`, `pairwise`)
   * moves its control: `start_value: null` returns to the overview of every
   * biomarker.
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
    this.readTables();
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
      y_scale: 'yScale',
      test: 'test',
      pairwise: 'pairwise',
      filters: 'filters',
      // Another limit is other pages: the overview starts at its first.
      overview_limit: 'page'
    };
    for (const [setting, key] of Object.entries(moved)) {
      if (setting in given) this.state[key] = opening[key];
    }
    this.repairState(opening);
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
    this.visits = results.length ? listVisits(results, this.settings) : { all: [], start: [] };
    this.categories = results.length ? categoryColumns(this.tables, this.settings) : [];
    this.filterSpecs = filterColumns(this.tables, this.settings, this.categories).map((spec) =>
      this.kit.normalizeFilterSpec(spec)
    );
    // As safety.viz's histogram does: a biomarker the table does not have opens
    // the overview, and says so where a developer will see it.
    const named = this.settings.start_value;
    if (results.length && named !== null && !this.measures.includes(named)) {
      console.warn(
        `The initial biomarker [${named}] does not exist. Defaulting to the all-biomarkers overview.`
      );
    }
  }

  // Whether the overview of every biomarker is what is drawn.
  isOverview() {
    return this.state.measure === null || this.state.measure === undefined;
  }

  // Opens one biomarker, or the overview (null), from the Biomarker control or
  // from a row of the overview.
  selectMeasure(measure) {
    this.state.measure = measure;
    this.buildControls();
    this.render();
  }

  // What the chart opens on: the settings, where the tables have what they name.
  seedState() {
    const { settings, categories, measures } = this;
    const has = (column) => categories.some((entry) => entry.value_col === column);
    return {
      // No biomarker named, or one the table does not have: the overview.
      measure: measures.includes(settings.start_value) ? settings.start_value : null,
      page: 0,
      visits: [...this.visits.start],
      valueType: settings.value_type,
      groupBy: has(settings.group_by)
        ? settings.group_by
        : categories.length
          ? categories[0].value_col
          : NONE,
      levels: settings.levels,
      colorBy: has(settings.color_by) ? settings.color_by : NONE,
      panelBy: has(settings.panel_by) ? settings.panel_by : NONE,
      mark: settings.mark,
      yScale: settings.y_scale,
      test: settings.test,
      pairwise: settings.pairwise,
      filters: this.kit.initFilterState(this.filterSpecs)
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
    if (this.state.groupBy && !has(this.state.groupBy)) this.state.groupBy = opening.groupBy;
    if (this.state.colorBy && !has(this.state.colorBy)) this.state.colorBy = NONE;
    if (this.state.panelBy && !has(this.state.panelBy)) this.state.panelBy = NONE;
  }

  labelOf(column) {
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

    const overview = this.isOverview();
    const value = addSection('Value');
    select(
      'measure',
      'Biomarker',
      [[OVERVIEW, 'All Biomarkers'], ...this.measures.map((measure) => [measure, measure])],
      overview ? OVERVIEW : state.measure,
      // The controls differ between the overview and one biomarker.
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
      // With one biomarker open, the visits it has values at; in the overview,
      // every visit.
      const offered = this.visitsOffered();
      const shown = state.visits.filter((visit) => offered.includes(visit));
      const visits = kit.multiSelect({
        values: offered,
        selected: shown.length === offered.length ? null : shown,
        onChange: (next) => {
          const chosen = next === null ? offered : next;
          // A visit the biomarker lacks keeps its place for another biomarker.
          state.visits = this.visits.all.filter(
            (visit) => chosen.includes(visit) || !offered.includes(visit)
          );
          redraw(false);
        }
      });
      visits.dataset.control = 'visits';
      addControl('Visit', visits, value);
    }

    const columns = this.categories.map((entry) => [entry.value_col, entry.label]);
    const group = addSection('Groups');
    if (columns.length) {
      select(
        'group-by',
        'Group by',
        columns,
        state.groupBy,
        (next) => {
          state.groupBy = next;
          // The levels are the new column's.
          state.levels = null;
          redraw(true);
        },
        group
      );
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
      const optional = [[NONE, 'None'], ...columns];
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
      );
      const panelBy = select(
        'panel-by',
        'Panel by',
        optional,
        state.panelBy,
        (next) => {
          state.panelBy = next;
          redraw(false);
        },
        group
      );
      // In the overview the panels are the visits of each biomarker: a further
      // panel variable waits until a biomarker is opened, and the control says so.
      if (overview) {
        panelBy.disabled = true;
        panelBy.after(
          kit.createElement(
            'small',
            'bv-control-note',
            'Applies when one biomarker is open. In the overview each biomarker’s panels are its visits.'
          )
        );
      }
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
    select(
      'mark',
      'Draw as',
      MARKS.map((mark) => [mark, MARK_LABELS[mark]]),
      state.mark,
      (next) => {
        state.mark = next;
        redraw(false);
      },
      display
    );
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

    // What R is asked: the test, and whether every pair of groups is compared
    // as well. The tests offered are the ones that fit the number of groups
    // drawn, so they are filled in when the chart is drawn (syncTestControls).
    this.testControl = null;
    this.pairwiseControl = null;
    // The overview prints no test, so it offers none: the section is there once
    // a biomarker is open.
    if (this.settings.statistic && !overview) {
      const statistics = addSection('Statistics');
      const test = document.createElement('select');
      test.dataset.control = 'test';
      test.onchange = () => {
        state.test = test.value;
        redraw(false);
      };
      this.testControl = addControl('Test', test, statistics);
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

    // Filters choose participants, so there are filters only with a participant table.
    addFilterControls(this, { addSection, addControl }, () => redraw(false));

    addReset(() => {
      this.state = this.seedState();
      this.buildControls();
      this.render();
    });
  }

  // The visits the Visit control offers: the open biomarker's, or every visit
  // in the overview.
  visitsOffered() {
    if (this.isOverview()) return this.visits.all;
    return measureVisits(this.tables.results, this.settings, this.state.measure);
  }

  // Every level of the group column in the tables, whatever the filters are set to.
  levelsOffered() {
    if (!this.state.groupBy) return [];
    // In the overview no one biomarker says which levels have a value: the
    // levels are the column's own.
    if (this.isOverview()) return columnLevels(this.tables, this.state.groupBy);
    // A failure here is the drawing's to say: the chart is drawn next, through
    // drawSafely, which says it in the footnote. The control offers nothing.
    try {
      const model = buildPanels(
        this.tables,
        this.settings,
        {
          ...this.state,
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
    const { testControl: select, pairwiseControl: pairwise, kit, state } = this;
    if (!select) return;
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
    pairwise.checked = state.pairwise;
    pairwise.parentElement.style.display = groups > 2 && fitted !== 'none' ? '' : 'none';
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
    this.multiplesWrap.classList.remove('bv-overview');
    this.chartWrap.classList.remove('sv-hidden');
    this.model = null;
    this.overview = null;
    this.syncTestControls(0);

    const { results } = this.tables;
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
    // No biomarker chosen: every biomarker, a row each. It prints no test and
    // asks R for nothing.
    if (this.isOverview()) {
      this.drawOverview();
      return;
    }

    const model = buildPanels(this.tables, this.settings, this.state, {
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
    this.footnote.textContent =
      this.state.mark === 'points'
        ? 'Click a point to list its participant and open their profile.'
        : `Click a ${this.state.mark} to list its participants.`;

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

  // ---- The overview -----------------------------------------------------------

  // Every biomarker, a row each, in the Biomarker control's order; in a row one
  // small panel per visit, all on that biomarker's own value axis. A row is a
  // button: a click, or Enter or Space on it, opens its biomarker. Each panel
  // is its own Chart.js chart, as safety.viz's small multiples are, so the
  // number alive at once is the page's biomarkers times the visits, and
  // `overview_limit` keeps that bounded.
  drawOverview() {
    const { kit, state, settings } = this;
    const page = overviewPage(this.measures, settings.overview_limit, state.page);
    state.page = page.page;
    const rows = buildOverview(this.tables, settings, state, page.measures, {
      filterMatches: kit.filterMatches
    });
    this.overview = { ...page, rows };
    this.chartWrap.classList.add('sv-hidden');
    this.multiplesWrap.classList.add('bv-overview');
    this.updateOverviewNotes(rows);

    const pager = () => this.overviewPager(page);
    this.multiplesWrap.append(pager());
    const drawn = rows.filter((row) => row.model.panels.some((panel) => panel.records.length));
    if (!drawn.length) {
      // Every row of the overview is framed on the same participants.
      this.footnote.textContent = rows.length
        ? nothingDrawn(rows[0].model, rows)
        : NOTHING_AFTER_BASELINE;
      return;
    }
    this.footnote.textContent = 'Click a biomarker to view it alone, with a test under each visit.';

    // With a second grouping, one key for the whole overview: the small panels
    // carry no legend of their own.
    const colors = drawn[0].model.colors;
    if (colors.length > 1 || colors[0] !== null) {
      const legend = kit.createElement('p', 'bv-legend');
      legend.append(kit.createElement('span', null, `${this.labelOf(state.colorBy)}:`));
      colors.forEach((color, index) => {
        const entry = kit.createElement('span');
        const swatch = kit.createElement('span', 'bv-legend-swatch');
        swatch.style.background = this.colorOf(index);
        entry.append(swatch, document.createTextNode(color));
        legend.append(entry);
      });
      this.multiplesWrap.append(legend);
    }

    // A panel is as wide as its groups' labels need, so a row holds as many
    // visits side by side as fit and wraps the rest: five across on a desk,
    // fewer on a phone.
    const groups = Math.max(...rows.map((row) => row.model.shownLevels.length), 1);
    const narrow = this.root.clientWidth < 600;
    const least = narrow ? 120 : 132;
    this.multiplesWrap.style.setProperty(
      '--bv-panel-min',
      `${Math.min(300, Math.max(least, groups * (narrow ? 44 : 52) + 30))}px`
    );

    rows.forEach(({ measure, title, model }) => {
      const row = kit.createElement('div', 'sv-multiple sv-overview-panel bv-overview-row');
      row.dataset.measure = measure;
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.setAttribute('aria-label', `View ${measure}`);
      const open = () => this.openFromOverview(measure);
      row.onclick = open;
      row.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      };
      row.append(kit.createElement('h3', null, title));
      const panels = kit.createElement('div', 'bv-overview-panels');
      row.append(panels);
      this.multiplesWrap.append(row);
      const shown = model.panels.filter((panel) => panel.records.length);
      if (!shown.length) {
        row.append(kit.createElement('p', 'bv-panel-note', 'No participant has a value to draw.'));
        return;
      }
      // One value axis for the biomarker, across its visits: as far as its
      // marks reach, so a small panel is not flattened by a value no mark shows.
      const domain = this.domain({ extent: this.reach(model) });
      model.panels.forEach((panel) => {
        const cell = kit.createElement('div', 'bv-overview-panel');
        cell.dataset.visit = panel.visit ?? '';
        cell.append(kit.createElement('h4', null, panel.title || panel.visit || 'Baseline value'));
        const wrap = kit.createElement('div', 'bv-overview-canvas');
        const canvas = document.createElement('canvas');
        wrap.append(canvas);
        cell.append(wrap);
        panels.append(cell);
        if (panel.records.length) {
          const chart = this.drawPanel(canvas, panel, model, { title, domain, compact: true });
          chart.$measure = measure;
        }
      });
    });
    if (page.pages > 1) this.multiplesWrap.append(pager());
  }

  // How many biomarkers are shown of how many, and, when there are more than
  // one page of them, the way to the rest.
  overviewPager(page) {
    return renderPager(this.kit, page, overviewCount(page), (to) => {
      this.state.page = to;
      this.render();
      // The next page starts at its top.
      if (this.root.getBoundingClientRect().top < 0) this.root.scrollIntoView();
    });
  }

  // Opens a biomarker from its row. The single view replaces the overview, so
  // the page is brought back to the chart's top, and the keyboard's place is
  // put on the Biomarker control when it is on screen.
  openFromOverview(measure) {
    this.selectMeasure(measure);
    if (this.root.getBoundingClientRect().top < 0) this.root.scrollIntoView();
    const control = this.controls.querySelector('select[data-control="measure"]');
    if (control && control.offsetParent !== null) control.focus();
  }

  // Above the overview: what applies to every row. The counts of who was
  // drawn and left out are a biomarker's own, and are given when it is opened.
  updateOverviewNotes(rows) {
    const { kit, state } = this;
    const add = (text) => this.notes.append(kit.createElement('span', null, text));
    const [first] = rows;
    if (!first) return;
    const { model } = first;
    if (model.filtered !== null && model.filtered < this.tables.participants.length) {
      add(`${model.filtered} of ${this.tables.participants.length} participants pass the filters.`);
    }
    if (state.levels) {
      const offered = this.levelsOffered();
      const shown = offered.filter((level) => state.levels.includes(level));
      if (shown.length < offered.length) add(`${shown.length} of ${offered.length} levels shown.`);
    }
    if (state.valueType === 'baseline') {
      add('A baseline value has no visit: each biomarker has one panel.');
    }
    this.addBaselineNote(model, add);
  }

  // The baseline visit of a value worked out against one, and that it is not
  // drawn when it was chosen: there the value is the same for everyone.
  addBaselineNote(model, add) {
    if (!model.baselineVisits || this.state.valueType === 'raw') return;
    const notDrawn = model.visitsNotDrawn.length
      ? ` It is not drawn: there the ${VALUE_LABELS[this.state.valueType].toLowerCase()} is the same for everyone.`
      : '';
    add(`Baseline visit: ${model.baselineVisits.join(', ')}.${notDrawn}`);
  }

  // How far a biomarker's marks reach across its panels. A box is drawn from
  // its whiskers, the 5th and 95th percentiles; a violin and points reach the
  // least and greatest value.
  reach(model) {
    if (this.state.mark !== 'box') return model.extent;
    const cells = model.panels.flatMap((panel) => panel.cells.filter((cell) => cell.n));
    return [
      Math.min(...cells.map((cell) => cell.stats.q5)),
      Math.max(...cells.map((cell) => cell.stats.q95))
    ];
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

  // `compact` is a panel of the overview: small, with no legend, no axis
  // titles and nothing that answers the pointer, because the row it is in is
  // what is clicked.
  drawPanel(canvas, panel, model, { title, domain, compact = false }) {
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
        pointRadius: state.mark === 'points' ? (compact ? 1.5 : 3) : 0,
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
        ...(compact
          ? { events: [], layout: { padding: { top: 4, right: 4 } } }
          : { onClick: (event) => this.onChartClick(chart, panel, event) }),
        plugins: {
          legend: {
            display: coloured && !compact,
            position: 'top',
            title: { display: coloured, text: this.labelOf(state.colorBy) }
          },
          tooltip: {
            enabled: !compact,
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
            title: { display: Boolean(groupLabel) && !compact, text: groupLabel },
            ticks: {
              autoSkip: false,
              // A panel turns its labels when they would run together, as a
              // narrow visit panel's long group names would; labels that fit
              // stay level.
              maxRotation: compact ? 50 : 90,
              ...(compact ? { font: { size: 10 }, padding: 2 } : {}),
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
            ticks: {
              includeBounds: false,
              ...(compact ? { font: { size: 10 }, maxTicksLimit: 4 } : {})
            },
            title: { display: !compact, text: title }
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
      state: this.state,
      panel
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
   * What the chart has asked R for the panels now drawn, and what R answered:
   * one entry per panel that asked, in the order the panels are drawn. A
   * request is exactly what the connection was given, so it is the key a
   * stored result must carry to be found.
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
