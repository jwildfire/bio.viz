// The group comparison chart: one value across the levels of a category, as
// boxes, violins or points, with the number in each group beneath.
//
//   BioViz.groupComparison('#chart', { group_by: 'ARM' }).init({ results, participants });
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
import { VALUE_TYPES } from './core/variable.js';
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
  buildPanels,
  categoryColumns,
  filterColumns,
  jitter,
  listMeasures,
  listVisits,
  yTitle
} from './group-comparison/structureData.js';

const NONE = '';

const VALUE_LABELS = {
  raw: 'Result',
  baseline: 'Baseline',
  change: 'Change from baseline',
  fold_change: 'Fold change from baseline',
  percent_change: 'Percent change from baseline'
};
const MARK_LABELS = { box: 'Box', violin: 'Violin', points: 'Points' };
const SCALE_LABELS = { linear: 'Linear', log: 'Logarithmic' };

// safety.viz's categorical palette, so a group keeps one colour across the two
// libraries' charts on a page.
const PALETTE = [
  '#2563eb',
  '#059669',
  '#d97706',
  '#9333ea',
  '#dc2626',
  '#0891b2',
  '#65a30d',
  '#db2777',
  '#4b5563',
  '#ca8a04'
];

const STYLE_ID = 'bio-viz-group-comparison-styles';
const STYLES = `
.bv-group-comparison .bv-statistic{margin:.6rem 0 0;font-size:.85rem;color:#1f2933;max-width:100%}
.bv-group-comparison .bv-statistic:empty{display:none}
.bv-group-comparison .bv-statistic p{margin:0 0 .3rem}
.bv-group-comparison .bv-statistic[data-state=waiting],.bv-group-comparison .bv-statistic[data-state=none]{color:#52616f;font-style:italic}
.bv-group-comparison .bv-stat-remark,.bv-group-comparison .bv-stat-scope{font-size:.8rem;color:#52616f}
.bv-group-comparison .bv-stat-remark[data-kind=warning]{color:#8a4b00}
.bv-group-comparison .bv-stat-pairs{border-collapse:collapse;margin:.2rem 0 .5rem;font-size:.8rem;width:100%;max-width:36rem}
.bv-group-comparison .bv-stat-pairs caption{text-align:left;padding:0 0 .25rem;caption-side:top}
.bv-group-comparison .bv-stat-pairs th,.bv-group-comparison .bv-stat-pairs td{text-align:left;font-weight:400;padding:.2rem .6rem .2rem 0;border-top:1px solid #d9dee3;vertical-align:top;overflow-wrap:anywhere}
.bv-group-comparison .bv-stat-pairs thead th{font-weight:600;border-top:0}
.bv-group-comparison .bv-stat-pairs td:nth-child(2){white-space:nowrap}
.bv-group-comparison .bv-stat-method{display:block;color:#52616f}
.bv-group-comparison .bv-panel-canvas{height:300px;position:relative}
.bv-group-comparison .bv-panel-note{margin:0 0 .4rem;font-size:.8rem;color:#52616f}
.bv-group-comparison .sv-chart-wrap canvas,.bv-group-comparison .bv-panel-canvas canvas{cursor:pointer}
.bv-group-comparison .sv-listing table{table-layout:fixed}
.bv-group-comparison .sv-listing th,.bv-group-comparison .sv-listing td{white-space:normal;overflow-wrap:anywhere}
.bv-group-comparison .sv-rail{max-width:100%;overflow-x:auto}
@media (max-width:600px){
.bv-group-comparison .sv-chart-wrap{height:380px;padding:.5rem}
.bv-group-comparison.sv-collapsed .sv-sidebar-title{display:inline}
.bv-group-comparison.sv-collapsed .sv-sidebar{padding:.5rem .9rem}
}`;

function applyStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.append(style);
}

// The kit, from the page. safety.viz is loaded beside this bundle, never
// bundled into it, so a page that forgot it is told so in plain words.
function findKit() {
  const kit = globalThis.SafetyViz && globalThis.SafetyViz.kit;
  if (!kit || typeof kit.renderShell !== 'function' || typeof kit.Chart !== 'function') {
    throw new Error(
      "bio.viz: the group comparison chart is built from safety.viz's kit, and `SafetyViz.kit` " +
        "was not found. Load safety.viz's bundle on the page before bio.viz makes a chart."
    );
  }
  return kit;
}

const hexToRgba = (hex, alpha) => {
  const value = hex.replace('#', '');
  const part = (at) => parseInt(value.slice(at, at + 2), 16);
  return `rgba(${part(0)}, ${part(2)}, ${part(4)}, ${alpha})`;
};

// A value for reading: four significant figures, without trailing zeros.
const shown = (value) => (Number.isFinite(value) ? String(Number(value.toPrecision(4))) : '');

const isRecordTable = (table) =>
  Array.isArray(table) &&
  table.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row));

/**
 * The live chart. Made by `groupComparison()`, not directly.
 */
class GroupComparison {
  constructor(element, settings) {
    this.kit = findKit();
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
    this.connect();
    this.renderShell();
  }

  // The connection the statistics line asks: the one given in settings, or one
  // with no R attached, which answers that statistics are unavailable.
  connect() {
    this.connection = this.settings.connection || createConnection();
    this.desk = createStatisticDesk({
      connection: this.connection,
      note: this.settings.waiting_note
    });
  }

  renderShell() {
    const { kit } = this;
    Object.assign(
      this,
      kit.renderShell(this.element, {
        moduleClass: 'bv-group-comparison',
        onToggle: () => this.resize()
      })
    );
    applyStyles();
    this.statLine = kit.createElement('div', 'bv-statistic');
    this.statLine.setAttribute('role', 'status');
    this.footnote.after(this.statLine);

    // What the kit's listing and participant rail read and keep.
    this.host = {
      settings: {
        profile: this.settings.profile,
        id_col: this.settings.id_col,
        page_size: this.settings.page_size,
        details: []
      },
      root: this.root,
      railWrap: this.railWrap,
      listingWrap: this.listingWrap,
      currentTableData: [],
      listingSearch: '',
      listingSort: null,
      listingSelectedId: null,
      page: 1,
      profileRows: [],
      onListingRowClick: (row) => this.select(row[this.settings.id_col])
    };

    // The listing's own export names its file for another chart; this one
    // downloads the same rows under this chart's name.
    this.listingWrap.addEventListener(
      'click',
      (event) => {
        const button = event.target.closest && event.target.closest('button');
        if (!button || button.textContent !== 'Export: CSV') return;
        event.stopPropagation();
        event.preventDefault();
        this.downloadListing();
      },
      true
    );

    // On a phone the controls would push the chart off the first screen: they
    // start folded away, one tap from open.
    if (globalThis.matchMedia && globalThis.matchMedia('(max-width: 600px)').matches) {
      this.sidebarToggle.click();
    }
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
    const tables = Array.isArray(data) ? { results: data } : data || {};
    try {
      if (!isRecordTable(tables.results)) {
        throw new TypeError('bio.viz: `results` must be an array of records, one object per row.');
      }
      if (tables.participants != null && !isRecordTable(tables.participants)) {
        throw new TypeError(
          'bio.viz: `participants` must be an array of records, one object per row.'
        );
      }
      for (const key of ['id_col', 'measure_col', 'value_col', 'visit_col']) {
        const column = this.settings[key];
        if (tables.results.length && !tables.results.some((row) => column in row)) {
          throw new TypeError(
            `bio.viz: the results table has no column \`${column}\` (\`${key}\`).`
          );
        }
      }
    } catch (error) {
      this.destroyCharts();
      this.element.innerHTML = '';
      this.element.append(this.kit.createElement('div', 'sv-warning', error.message));
      throw error;
    }
    this.tables = {
      results: tables.results,
      participants: tables.participants && tables.participants.length ? tables.participants : null
    };
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
   * moves its control.
   * @param {object} settings The settings to change.
   * @returns {GroupComparison} The chart, for chaining.
   */
  setSettings(settings) {
    const given = settings || {};
    this.settings = syncSettings({ ...this.settings, ...given });
    this.host.settings.profile = this.settings.profile;
    this.host.settings.id_col = this.settings.id_col;
    this.host.settings.page_size = this.settings.page_size;
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
      filters: 'filters'
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
  }

  // What the chart opens on: the settings, where the tables have what they name.
  seedState() {
    const { settings, categories, measures } = this;
    const has = (column) => categories.some((entry) => entry.value_col === column);
    return {
      measure: measures.includes(settings.start_value) ? settings.start_value : measures[0],
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
    if (!this.measures.includes(this.state.measure)) this.state.measure = opening.measure;
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

    const value = addSection('Value');
    select(
      'measure',
      'Biomarker',
      this.measures.map((measure) => [measure, measure]),
      state.measure,
      (next) => {
        state.measure = next;
        redraw(false);
      },
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
      const visits = kit.multiSelect({
        values: this.visits.all,
        selected: state.visits.length === this.visits.all.length ? null : state.visits,
        onChange: (next) => {
          const chosen = next === null ? this.visits.all : next;
          state.visits = this.visits.all.filter((visit) => chosen.includes(visit));
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
      select(
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
    if (this.settings.statistic) {
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
    if (this.filterSpecs.length) {
      const filters = addSection('Filters');
      const idCol = this.settings.participant_id_col || this.settings.id_col;
      this.filterSpecs.forEach((spec) => {
        const values = [
          ...new Set(
            this.tables.participants
              .map((row) => row[spec.value_col])
              .filter((entry) => entry !== undefined && entry !== null && entry !== '')
              .map(String)
          )
        ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        if (spec.value_col === idCol) return;
        const control = kit.renderFilterControl({
          spec,
          values,
          selected: state.filters[spec.value_col],
          onChange: (next) => {
            state.filters[spec.value_col] = next;
            redraw(false);
          }
        });
        control.dataset.filter = spec.value_col;
        addControl(spec.label, control, filters);
      });
    }

    addReset(() => {
      this.state = this.seedState();
      this.buildControls();
      this.render();
    });
  }

  // Every level of the group column in the tables, whatever the filters are set to.
  levelsOffered() {
    if (!this.state.groupBy) return [];
    const model = buildPanels(
      this.tables,
      this.settings,
      { ...this.state, levels: null, colorBy: NONE, panelBy: NONE, filters: {}, yScale: 'linear' },
      { filterMatches: this.kit.filterMatches }
    );
    return model.levels;
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
    const round = this.desk.begin();
    this.asked = [];
    this.destroyCharts();
    this.clearSelection();
    this.notes.innerHTML = '';
    this.multiplesWrap.innerHTML = '';
    this.statLine.textContent = '';
    this.statLine.dataset.state = 'empty';
    this.chartWrap.classList.remove('sv-hidden');
    this.model = null;
    this.syncTestControls(0);

    const { results } = this.tables;
    const needsVisit = this.state.valueType !== 'baseline';
    if (!results.length || !this.state.measure) {
      this.footnote.textContent = 'No results to draw.';
      return;
    }
    if (needsVisit && !this.state.visits.length) {
      this.footnote.textContent = 'Choose a visit to draw.';
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
      this.footnote.textContent = 'No participant has a value to draw for this choice.';
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
              maxRotation: 0,
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
    if (model.baselineVisits && state.valueType !== 'raw') {
      add(`Baseline visit: ${model.baselineVisits.join(', ')}.`);
    }
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
    const filters = this.filterSpecs
      .map((spec) => ({ label: spec.label, selection: state.filters[spec.value_col] }))
      .filter(({ selection }) => selection !== null && selection !== undefined && selection !== '')
      .map(({ label, selection }) => ({
        label,
        values: (Array.isArray(selection) ? selection : [selection]).map(String)
      }))
      .filter(({ values }) => values.length);
    return scopeText({
      group: this.labelOf(state.groupBy),
      n: panel.records.length,
      panel: model.panels.length > 1 ? panel.title : null,
      color: state.colorBy ? this.labelOf(state.colorBy) : null,
      filters
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
    const { kit } = this;
    line.dataset.state = description.state;
    line.innerHTML = '';
    line.append(kit.createElement('p', 'bv-stat-result', description.text));
    description.estimates.forEach((said) =>
      line.append(kit.createElement('p', 'bv-stat-estimate', said))
    );
    if (description.pairs) line.append(this.pairsTable(description.pairs));
    description.remarks.forEach(({ kind, text }) => {
      const remark = kit.createElement('p', 'bv-stat-remark', text);
      remark.dataset.kind = kind;
      line.append(remark);
    });
    if (description.scope) line.append(kit.createElement('p', 'bv-stat-scope', description.scope));
  }

  pairsTable({ caption, head, rows }) {
    const { kit } = this;
    const table = kit.createElement('table', 'bv-stat-pairs');
    table.append(kit.createElement('caption', null, caption));
    const header = document.createElement('tr');
    head.forEach((title) => {
      const cell = kit.createElement('th', null, title);
      cell.scope = 'col';
      header.append(cell);
    });
    const thead = document.createElement('thead');
    thead.append(header);
    const tbody = document.createElement('tbody');
    rows.forEach((row) => {
      const line = document.createElement('tr');
      line.dataset.status = row.status;
      const pair = kit.createElement('th', null, row.pair);
      pair.scope = 'row';
      if (row.method) pair.append(kit.createElement('span', 'bv-stat-method', row.method));
      line.append(pair, kit.createElement('td', null, row.n), kit.createElement('td', null, row.p));
      tbody.append(line);
    });
    table.append(thead, tbody);
    return table;
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
    const { host, settings } = this;
    this.clearSelection();
    const participantIdCol = settings.participant_id_col || settings.id_col;
    const byId = new Map(
      (this.tables.participants || []).map((row) => [String(row[participantIdCol]), row])
    );
    host.settings.details = this.listingColumns();
    host.currentTableData = records.map((record) => ({
      ...(byId.get(String(record[settings.id_col])) || {}),
      ...record,
      y: shown(record.y)
    }));
    host.listingSearch = '';
    host.listingSort = null;
    host.page = 1;
    this.listed = { panel, cell };
    const name = cell.color === null ? cell.level : `${cell.level}, ${cell.color}`;
    const where = panel.title ? ` (${panel.title})` : '';
    this.footnote.textContent =
      `${name}${where}: ${records.length} participant${records.length === 1 ? '' : 's'} listed. ` +
      "Click a row to open the participant's profile.";
    this.kit.renderListing(host);
  }

  // Select one participant, or none: mark the listing's row and raise
  // safety.viz's selection event, which the participant rail opens on and any
  // other chart on the page can listen for.
  select(id) {
    const { host } = this;
    host.listingSelectedId = id == null ? null : String(id);
    if (host.currentTableData.length) this.kit.renderListing(host);
    this.root.dispatchEvent(
      new CustomEvent('participantsSelected', {
        detail: { data: id == null ? [] : [String(id)] },
        bubbles: true
      })
    );
  }

  // Empties the listing and the rail without raising an event: the chart is
  // about to show other rows.
  clearSelection() {
    const { host } = this;
    host.currentTableData = [];
    host.listingSelectedId = null;
    this.listed = null;
    this.listingWrap.innerHTML = '';
    this.kit.resetProfileRail(host);
  }

  downloadListing() {
    const { host, kit } = this;
    let rows = kit.searchRows(
      [...host.currentTableData],
      host.settings.details,
      host.listingSearch
    );
    if (host.listingSort) rows = kit.sortRows(rows, host.listingSort);
    const blob = new Blob([kit.buildCsv(rows, host.settings.details)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'bio.viz-group-comparison-listing.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  // The rows safety.viz's participant rail reads: every result, with the
  // participant's own columns beside it for the rail's header.
  //
  // The rail was made for laboratory results that carry a reference range, and
  // keeps only rows with an upper limit of normal above zero. Biomarker results
  // often have none. When no `normal_col_high` is mapped the rows are given a
  // stand-in so the rail keeps them, and the rail is told (railSettings) to
  // show each result as a multiple of the participant's first result and to
  // draw no reference range: nothing on screen claims one.
  buildProfileFeed() {
    const { settings, host, kit } = this;
    host.profileRows = [];
    if (!settings.profile) return;
    const participantIdCol = settings.participant_id_col || settings.id_col;
    const byId = new Map(
      (this.tables.participants || []).map((row) => [String(row[participantIdCol]), row])
    );
    const ranged = Boolean(settings.normal_col_high);
    const feed = this.tables.results.map((row) => ({
      ...(byId.get(String(row[settings.id_col])) || {}),
      ...row,
      ...(ranged ? {} : { __bv_no_reference_range: 1 })
    }));
    host.profileRows = kit.buildProfileRows(feed, {
      ...this.railColumns(),
      normal_col_high: ranged ? settings.normal_col_high : '__bv_no_reference_range'
    });
    kit.mountProfileRail(host, () => this.railSettings());
  }

  railColumns() {
    const { settings } = this;
    return {
      id_col: settings.id_col,
      measure_col: settings.measure_col,
      value_col: settings.value_col,
      unit_col: settings.unit_col,
      visit_col: settings.visit_col,
      visitn_col: settings.visit_order_col,
      studyday_col: settings.studyday_col,
      normal_col_high: settings.normal_col_high,
      normal_col_low: settings.normal_col_low
    };
  }

  railSettings() {
    const { settings } = this;
    const details =
      settings.profile_details ||
      this.categories
        .filter((entry) => entry.table !== 'results' || !this.tables.participants)
        .map(({ value_col, label }) => ({ value_col, label }));
    const rail = {
      ...this.railColumns(),
      details,
      // Every biomarker is a measure the rail shows, not only the four liver
      // tests it was made for.
      measure_values: Object.fromEntries(this.measures.map((measure) => [measure, measure])),
      axis_type: this.state.yScale === 'log' ? 'log' : 'linear',
      on_clear: () => this.select(null)
    };
    if (settings.normal_col_high) return rail;
    const none = { relative_uln: null, relative_baseline: null };
    return {
      ...rail,
      display: 'relative_baseline',
      display_options: [{ value: 'relative_baseline', label: 'Multiple of first result' }],
      cuts: { defaults: none, TB: none, ALP: none }
    };
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
