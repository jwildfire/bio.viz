// The association scatter: two variables against one another, one point per
// participant, with R's correlation coefficient beneath.
//
//   BioViz.associationScatter('#chart', {
//     x: { measure: 'TNF-alpha', visit: 'Baseline' },
//     y: { measure: 'IL-10', visit: 'Baseline' }
//   }).init({ results, participants });
//
// The lifecycle is safety.viz's (init, setData, setSettings, render, resize,
// destroy), as the group comparison chart's is, and the chart is built the same
// way: from safety.viz's kit, found on the page when a chart is made, with the
// rows of every panel from the core's frame. What the two charts share is in
// src/shared/.
//
// The chart computes no statistic: no coefficient, no interval, no p-value, no
// fitted line and no band. It chooses what to ask R for, asks through the
// connection, and prints and draws what comes back. The line y = x is the one
// line it draws by itself, because that line is not an estimate of anything.

import { createConnection } from './r/connection.js';
import { UNUSED } from './core/reasons.js';
import { VALUE_TYPES } from './core/variable.js';
import { FITS, METHODS, SCALES, syncSettings } from './association-scatter/configure.js';
import {
  FITS_FROM_R,
  FIT_LABELS,
  METHOD_LABELS,
  correlationRequest,
  createStatisticDesk,
  describeFit,
  fitCurves,
  fitRequest,
  fitScopeText,
  scaleText,
  scopeText
} from './association-scatter/statistic.js';
import {
  VARIABLE_WORDS,
  axisOffered,
  axisTitle,
  brushed,
  buildScatter,
  domainOf,
  flatAtBaseline,
  identityLine,
  numberColumns,
  openingAxes,
  settingOf
} from './association-scatter/structureData.js';
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
  mountToolbar,
  toolbarStyles,
  writeStatistic,
  drawSafely,
  checkTables
} from './shared/chartHost.js';
import {
  NOBODY_PASSES,
  categoryColumns,
  filterColumns,
  listMeasures,
  listVisits
} from './shared/tables.js';

const NONE = '';
const MODULE_CLASS = 'bv-association-scatter';
const STYLE_ID = 'bio-viz-association-scatter-styles';
const STYLES = `${lineStyles(`.${MODULE_CLASS}`)}
.${MODULE_CLASS} .sv-chart-wrap canvas,.${MODULE_CLASS} .bv-panel-canvas canvas{cursor:crosshair}
.${MODULE_CLASS} canvas.bv-region-on{touch-action:none}
.${MODULE_CLASS} .bv-stat-remark[data-kind=scale]{color:#1f2933}
${toolbarStyles(`.${MODULE_CLASS}`)}
.${MODULE_CLASS} .bv-fit{margin:.5rem 0 0}
.${MODULE_CLASS} .bv-stat-pairs{max-width:46rem}
.${MODULE_CLASS} .bv-stat-pairs th[scope=row]{overflow-wrap:normal}
.${MODULE_CLASS} .bv-stat-pairs td:last-child{white-space:nowrap}
.${MODULE_CLASS} .bv-control-note{display:block;margin:.2rem 0 0;font-size:.75rem;color:#52616f}
@media (max-width:600px){
.${MODULE_CLASS} .sv-chart-wrap{height:380px;padding:.5rem}
.${MODULE_CLASS}.sv-collapsed .sv-sidebar-title{display:inline}
.${MODULE_CLASS}.sv-collapsed .sv-sidebar{padding:.5rem .9rem}
}`;

// What the footnote says before anything is listed.
const HINT_POINTER =
  'Drag across the points to list the participants in a region. Click a point to list its ' +
  'participant and open their profile.';
const HINT_TOUCH =
  'Tap a point to list its participant and open their profile. To list a region, tap Select a ' +
  'region, then drag on the chart.';
const HINT_REGION =
  'Selecting a region: drag on the chart to list the participants inside it. The page does not ' +
  'scroll from the chart until you tap Select a region again.';

// Said when an axis is a change read at the one baseline visit.
const NOTHING_AT_BASELINE =
  'An axis is a change at the baseline visit, where it is the same for everyone. Choose a later ' +
  'visit to draw.';

// A drag shorter than this many pixels is a click.
const CLICK_SLOP = 4;

const plural = (n, word = 'participant') => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The live chart. Made by `associationScatter()`, not directly.
 */
class AssociationScatter {
  constructor(element, settings) {
    this.kit = findKit('the association scatter');
    this.element = typeof element === 'string' ? document.querySelector(element) : element;
    if (!this.element) throw new Error(`bio.viz: association scatter target not found: ${element}`);
    this.settings = syncSettings(settings);
    this.tables = { results: [], participants: null };
    this.charts = [];
    this.model = null;
    this.measures = [];
    this.visits = [];
    this.numbers = [];
    this.categories = [];
    this.filterSpecs = [];
    this.state = {};
    this.asked = [];
    this.selection = null;
    this.regionMode = false;
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
    const { kit } = this;
    mountShell(this, {
      moduleClass: MODULE_CLASS,
      styleId: STYLE_ID,
      styles: STYLES,
      listingFile: 'bio.viz-association-scatter-listing.csv'
    });
    // Above the chart: the way back to a chart that opened this one, and, where
    // a finger is the pointer, the switch that makes a drag select a region.
    // Whether a finger can be the pointer here: a drag with one scrolls the
    // page, so a region is selected only once it has been asked for.
    this.touch =
      Boolean(globalThis.matchMedia && globalThis.matchMedia('(pointer: coarse)').matches) ||
      (globalThis.navigator ? globalThis.navigator.maxTouchPoints > 0 : false);
    this.buildToolbar();
  }

  buildToolbar() {
    const { kit } = this;
    // The way back, when another chart opened this one, is every chart's.
    mountToolbar(this);
    this.regionButton = null;
    if (this.touch) {
      const region = kit.createElement('button', 'bv-region', 'Select a region');
      region.type = 'button';
      region.setAttribute('aria-pressed', String(this.regionMode));
      region.onclick = () => this.setRegionMode(!this.regionMode);
      this.regionButton = region;
      this.toolbar.append(region);
    }
  }

  // With a finger, a drag on the chart scrolls the page unless this is on.
  setRegionMode(on) {
    this.regionMode = Boolean(on);
    if (this.regionButton) this.regionButton.setAttribute('aria-pressed', String(this.regionMode));
    this.charts.forEach((chart) => chart.canvas.classList.toggle('bv-region-on', this.regionMode));
    if (!this.selection && this.model) this.footnote.textContent = this.hint();
  }

  hint() {
    if (!this.touch) return HINT_POINTER;
    return this.regionMode ? HINT_REGION : HINT_TOUCH;
  }

  /**
   * Load the tables and draw: the same as `setData`.
   * @param {{results: object[], participants?: object[]}} data The tables.
   * @returns {AssociationScatter} The chart, for chaining.
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
   * @returns {AssociationScatter} The chart, for chaining.
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
   * what the chart opens on (`x`, `y`, `color_by`, `panel_by`, `x_scale`,
   * `y_scale`, `fit`, `method`, `filters`) moves its control, so
   * `setSettings({ x, y })` opens the chart on another pair of variables.
   * @param {object} settings The settings to change.
   * @returns {AssociationScatter} The chart, for chaining.
   */
  setSettings(settings) {
    const given = settings || {};
    const next = syncSettings({ ...this.settings, ...given });
    // The tables must still have the columns the new settings name; if not, the
    // settings are refused and nothing changes.
    checkTables(this.tables, next);
    this.settings = next;
    syncHost(this);
    if ('connection' in given || 'waiting_note' in given) this.connect();
    this.readTables();
    const opening = this.seedState();
    const moved = {
      x: 'x',
      y: 'y',
      color_by: 'colorBy',
      panel_by: 'panelBy',
      x_scale: 'xScale',
      y_scale: 'yScale',
      fit: 'fit',
      method: 'method',
      filters: 'filters'
    };
    for (const [setting, key] of Object.entries(moved)) {
      if (setting in given) this.state[key] = opening[key];
    }
    this.repairState(opening);
    this.buildProfileFeed();
    this.kit.syncProfileRail(this.host, () => this.railSettings());
    this.buildToolbar();
    this.buildControls();
    this.render();
    return this;
  }

  // What the controls can offer, read from the tables.
  readTables() {
    const { results } = this.tables;
    const { settings } = this;
    this.measures = results.length ? listMeasures(results, settings) : [];
    this.visits = results.length ? listVisits(results, settings).all : [];
    this.numbers = results.length ? numberColumns(this.tables, settings) : [];
    this.categories = results.length ? categoryColumns(this.tables, settings) : [];
    this.filterSpecs = filterColumns(this.tables, settings, this.categories).map((spec) =>
      this.kit.normalizeFilterSpec(spec)
    );
    this.opening = openingAxes(settings, this.offered());
    // A variable the tables do not have gives way to the chart's own choice,
    // and says so where a developer will see it.
    if (results.length) {
      this.opening.missing.forEach((key) =>
        console.warn(
          `The initial ${key} variable ${JSON.stringify(settings[key])} cannot be drawn from ` +
            'these tables. Defaulting to the first variables the tables have.'
        )
      );
    }
  }

  offered() {
    return { measures: this.measures, visits: this.visits, numbers: this.numbers };
  }

  // What the chart opens on: the settings, where the tables have what they name.
  seedState() {
    const { settings, categories } = this;
    const has = (column) => categories.some((entry) => entry.value_col === column);
    return {
      x: this.opening.x && { ...this.opening.x },
      y: this.opening.y && { ...this.opening.y },
      colorBy: has(settings.color_by) ? settings.color_by : NONE,
      panelBy: has(settings.panel_by) ? settings.panel_by : NONE,
      xScale: settings.x_scale,
      yScale: settings.y_scale,
      fit: settings.fit,
      method: settings.method,
      filters: this.kit.initFilterState(this.filterSpecs)
    };
  }

  // After the tables or the settings change, a control may hold something that
  // is no longer offered; it returns to what the chart opens on.
  repairState(opening) {
    const has = (column) => this.categories.some((entry) => entry.value_col === column);
    for (const key of ['x', 'y']) {
      if (!axisOffered(this.state[key], this.offered())) this.state[key] = opening[key];
    }
    if (this.state.colorBy && !has(this.state.colorBy)) this.state.colorBy = NONE;
    if (this.state.panelBy && !has(this.state.panelBy)) this.state.panelBy = NONE;
  }

  labelOf(column) {
    const found = this.categories.find((entry) => entry.value_col === column);
    return found ? found.label : column;
  }

  titleOf(axis) {
    return axisTitle(this.tables.results, this.settings, axis, this.numbers);
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
      input.setAttribute('aria-label', labelText);
      options.forEach(([value, text]) => kit.option(input, value, text, value === selected));
      input.onchange = () => onChange(input.value);
      return addControl(labelText.replace(/^[XY] axis: /, ''), input, parent);
    };

    // One section per axis: the variable, and for a biomarker its value type
    // and its visit; then the scale.
    const axisControls = (key, title) => {
      const axis = state[key];
      if (!axis) return;
      const section = addSection(title);
      const named = (text) => `${title}: ${text}`;
      const variables = [
        ...this.measures.map((measure) => [`m:${measure}`, measure]),
        ...this.numbers.map((entry) => [`c:${entry.value_col}`, `${entry.label} (participant)`])
      ];
      select(
        `${key}-variable`,
        named('Variable'),
        variables,
        axis.kind === 'column' ? `c:${axis.col}` : `m:${axis.measure}`,
        (next) => {
          const name = next.slice(2);
          state[key] = next.startsWith('c:')
            ? { kind: 'column', col: name }
            : {
                kind: 'measure',
                measure: name,
                value: axis.kind === 'measure' ? axis.value : 'raw',
                visit: axis.kind === 'measure' ? axis.visit : (this.visits[0] ?? null)
              };
          // A column has no value type and no visit, so those controls come and go.
          redraw(true);
        },
        section
      );
      if (axis.kind === 'measure') {
        select(
          `${key}-value`,
          named('Value'),
          VALUE_TYPES.map((type) => [type, VALUE_LABELS[type]]),
          axis.value,
          (next) => {
            axis.value = next;
            // A baseline value has no visit, so the Visit control comes and goes.
            axis.visit = next === 'baseline' ? null : (axis.visit ?? this.visits[0] ?? null);
            redraw(true);
          },
          section
        );
        if (axis.value !== 'baseline') {
          select(
            `${key}-visit`,
            named('Visit'),
            this.visits.map((visit) => [visit, visit]),
            axis.visit,
            (next) => {
              axis.visit = next;
              redraw(false);
            },
            section
          );
        }
      }
      select(
        `${key}-scale`,
        named('Scale'),
        SCALES.map((scale) => [scale, SCALE_LABELS[scale]]),
        state[`${key}Scale`],
        (next) => {
          state[`${key}Scale`] = next;
          redraw(false);
        },
        section
      );
    };
    axisControls('x', 'X axis');
    axisControls('y', 'Y axis');

    const columns = this.categories.map((entry) => [entry.value_col, entry.label]);
    if (columns.length) {
      const group = addSection('Groups');
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
    }

    const display = addSection('Display');
    const fit = select(
      'fit',
      'Fitted line',
      FITS.filter((kind) => this.settings.fit_statistic || !FITS_FROM_R.includes(kind)).map(
        (kind) => [kind, FIT_LABELS[kind]]
      ),
      state.fit,
      (next) => {
        state.fit = next;
        redraw(false);
      },
      display
    );
    fit.after(
      kit.createElement(
        'small',
        'bv-control-note',
        'The identity line is y = x. A linear fit and a smooth are computed by R, with their band.'
      )
    );

    // What R is asked: the coefficient. There is no control that chooses a
    // confidence level, a minimum number of pairs or an adjustment: those are R's.
    if (this.settings.statistic) {
      const statistics = addSection('Statistics');
      select(
        'method',
        'Method',
        METHODS.map((method) => [method, METHOD_LABELS[method]]),
        state.method,
        (next) => {
          state.method = next;
          redraw(false);
        },
        statistics
      );
    }

    // Filters choose participants, so there are filters only with a participant table.
    addFilterControls(this, { addSection, addControl }, () => redraw(false));

    addReset(() => {
      this.state = this.seedState();
      this.buildControls();
      this.render();
    });
  }

  // ---- Drawing ----------------------------------------------------------------

  /**
   * Draw everything again from the tables, the settings and the controls. The
   * listing, the brushed region and the participant rail are emptied, and the
   * statistics line and the fitted line are cleared and asked for again:
   * nothing stays on screen that describes rows the chart no longer shows.
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
    this.chartWrap.classList.remove('sv-hidden');
    this.model = null;

    const { results } = this.tables;
    const { state } = this;
    if (!results.length || !state.x || !state.y) {
      this.footnote.textContent = 'No results to draw.';
      return;
    }
    if ([state.x, state.y].some((axis) => flatAtBaseline(axis, results, this.settings))) {
      this.footnote.textContent = NOTHING_AT_BASELINE;
      return;
    }

    const model = buildScatter(this.tables, this.settings, state, {
      filterMatches: this.kit.filterMatches
    });
    this.model = model;
    this.updateNotes(model);
    if (!model.drawn) {
      this.footnote.textContent =
        model.filtered === 0
          ? NOBODY_PASSES
          : 'No participant has a value on both axes for this choice.';
      return;
    }
    this.footnote.textContent = this.hint();

    const view = {
      titles: { x: this.titleOf(state.x), y: this.titleOf(state.y) },
      domains: {
        x: domainOf(model.extent.x, state.xScale),
        y: domainOf(model.extent.y, state.yScale)
      }
    };
    if (model.panels.length === 1) {
      const [panel] = model.panels;
      const chart = this.drawPanel(this.canvas, panel, model, view);
      this.ask(round, chart, panel, model, this.statLine);
      return;
    }

    // Several panels: one chart each, in a grid that drops to one column on a
    // narrow screen, all on the same two axes.
    this.chartWrap.classList.add('sv-hidden');
    model.panels.forEach((panel) => {
      const card = this.kit.createElement('div', 'sv-multiple bv-panel');
      card.dataset.panel = panel.title;
      card.append(this.kit.createElement('h3', null, panel.title));
      card.append(
        this.kit.createElement('p', 'bv-panel-note', `${plural(panel.records.length)} drawn.`)
      );
      const wrap = this.kit.createElement('div', 'bv-panel-canvas');
      const canvas = document.createElement('canvas');
      wrap.append(canvas);
      const line = this.kit.createElement('div', 'bv-statistic');
      line.setAttribute('role', 'status');
      card.append(wrap, line);
      this.multiplesWrap.append(card);
      if (panel.records.length) {
        const chart = this.drawPanel(canvas, panel, model, view);
        this.ask(round, chart, panel, model, line);
      }
    });
  }

  // The axes run to the ends of what is drawn, and both panels of a pair share
  // them. A point that is in the brushed region keeps its colour; the others
  // fade while a region is selected.
  drawPanel(canvas, panel, model, { titles, domains }) {
    const { state, settings } = this;
    const coloured = model.colors.length > 1 || model.colors[0] !== null;
    const narrow = this.root.clientWidth < 600;

    const datasets = model.colors.map((color, colorIndex) => {
      const hex = PALETTE[colorIndex % PALETTE.length];
      const records = panel.records.filter(
        (record) => color === null || String(record.color) === color
      );
      const faded = (context) => {
        const chosen = this.selection;
        if (!chosen || chosen.panel !== panel || !context.raw) return false;
        return !chosen.ids.has(String(context.raw.record[settings.id_col]));
      };
      return {
        label: color === null ? 'All participants' : color,
        data: records.map((record) => ({ x: record.x, y: record.y, record })),
        showLine: false,
        backgroundColor: (context) => hexToRgba(hex, faded(context) ? 0.12 : 0.55),
        borderColor: (context) => hexToRgba(hex, faded(context) ? 0.25 : 1),
        pointRadius: narrow ? 2.5 : 3,
        pointHoverRadius: 5,
        pointHitRadius: 5
      };
    });

    const axisOf = (key) => ({
      type: state[`${key}Scale`] === 'log' ? 'logarithmic' : 'linear',
      min: domains[key][0],
      max: domains[key][1],
      // The ends of the axis are room about the data, not round numbers.
      ticks: { includeBounds: false, ...(narrow ? { maxTicksLimit: 6 } : {}) },
      title: { display: true, text: titles[key] }
    });

    const chart = new this.kit.Chart(canvas.getContext('2d'), {
      type: 'scatter',
      data: { datasets },
      options: {
        animation: false,
        maintainAspectRatio: false,
        responsive: true,
        interaction: { mode: 'nearest', intersect: true },
        plugins: {
          legend: {
            display: coloured,
            position: 'top',
            labels: { usePointStyle: true },
            title: { display: coloured, text: this.labelOf(state.colorBy) },
            // A colour is not switched off from the key: the coefficient below
            // is of every point drawn, and a hidden one would still be in it.
            onClick: () => {}
          },
          tooltip: {
            callbacks: {
              title: () => '',
              label: (context) => this.tooltip(context.raw, titles)
            }
          }
        },
        scales: { x: axisOf('x'), y: axisOf('y') }
      },
      plugins: [this.linePlugin(domains, model.colors), this.regionPlugin(panel)]
    });
    chart.$panel = panel;
    chart.$model = model;
    chart.$fit = null;
    canvas.classList.toggle('bv-region-on', this.regionMode);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute(
      'aria-label',
      `${titles.y} against ${titles.x}${panel.title ? `, ${panel.title}` : ''}: ` +
        `${plural(panel.records.length)} drawn`
    );
    this.attachPointer(chart, panel);
    this.charts.push(chart);
    return chart;
  }

  // The lines under the points. The identity line, y = x, is drawn here from
  // the axes alone. A linear fit or a smooth is drawn from what R returned for
  // the panel (`chart.$fit`): each line's points, and the band about them.
  linePlugin(domains, colors) {
    return {
      id: `as-lines-${Math.random().toString(36).slice(2)}`,
      beforeDatasetsDraw: (chart) => {
        const { ctx, scales, chartArea } = chart;
        const path = (points) => {
          ctx.beginPath();
          points.forEach((point, index) => {
            const [x, y] = [scales.x.getPixelForValue(point.x), scales.y.getPixelForValue(point.y)];
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
        };
        ctx.save();
        ctx.beginPath();
        ctx.rect(
          chartArea.left,
          chartArea.top,
          chartArea.right - chartArea.left,
          chartArea.bottom - chartArea.top
        );
        ctx.clip();
        if (this.state.fit === 'identity') {
          const line = identityLine(domains.x, domains.y, {
            x: this.state.xScale,
            y: this.state.yScale
          });
          chart.$identity = line;
          if (line) {
            path(line);
            ctx.strokeStyle = '#52616f';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            ctx.stroke();
          }
        }
        // R's lines, each R's own points joined, with R's band from `lower` to
        // `upper`. Without a colour: the line of every point, dark, with its
        // band. With a colour: each level's line and band in its colour, and
        // the line of every point dashed over them, without its band, which
        // would hide theirs.
        const lines = chart.$fit || [];
        const grouped = lines.some((line) => line.group !== null);
        lines.forEach((line) => {
          const overall = line.group === null;
          const index = overall ? -1 : colors.indexOf(line.group);
          const hex = overall ? '#1f2933' : PALETTE[Math.max(index, 0) % PALETTE.length];
          if (!(overall && grouped)) {
            path([...line.upper, ...[...line.lower].reverse()]);
            ctx.closePath();
            ctx.fillStyle = hexToRgba(hex, 0.13);
            ctx.fill();
          }
          path(line.curve);
          ctx.setLineDash(overall && grouped ? [5, 4] : []);
          ctx.strokeStyle = hex;
          ctx.lineWidth = overall && !grouped ? 2 : 1.5;
          ctx.stroke();
        });
        ctx.setLineDash([]);
        ctx.restore();
      }
    };
  }

  // The region being dragged, and the one selected, in the values' own units,
  // so it stays on its points when the chart changes size.
  regionPlugin(panel) {
    return {
      id: `as-region-${Math.random().toString(36).slice(2)}`,
      afterDatasetsDraw: (chart) => {
        const chosen = this.selection;
        const region = chart.$dragging || (chosen && chosen.panel === panel ? chosen.region : null);
        if (!region) return;
        const { ctx, scales } = chart;
        const [left, right] = region.x.map((value) => scales.x.getPixelForValue(value));
        const [bottom, top] = region.y.map((value) => scales.y.getPixelForValue(value));
        ctx.save();
        ctx.fillStyle = 'rgba(120, 120, 120, 0.18)';
        ctx.strokeStyle = 'rgba(90, 90, 90, 0.65)';
        ctx.lineWidth = 1;
        ctx.fillRect(left, top, right - left, bottom - top);
        ctx.strokeRect(left, top, right - left, bottom - top);
        ctx.restore();
      }
    };
  }

  tooltip(raw, titles) {
    if (!raw || !raw.record) return '';
    const { record } = raw;
    return [
      `${record[this.settings.id_col]}${record.color === undefined ? '' : ` (${record.color})`}`,
      `${titles.x}: ${shown(record.x)}`,
      `${titles.y}: ${shown(record.y)}`
    ];
  }

  // The participants seen and drawn, and why any was left out.
  updateNotes(model) {
    const { kit, state } = this;
    const add = (text, warning) =>
      this.notes.append(kit.createElement('span', warning ? 'sv-warning' : null, text));
    add(`${model.drawn} of ${plural(model.participants)} drawn.`);
    model.dropped.forEach((entry) => {
      const where = entry.variable ? ` (${VARIABLE_WORDS[entry.variable]})` : '';
      add(`${entry.n} left out: ${entry.reason}${where}.`, true);
    });
    for (const key of ['x', 'y']) {
      if (model.nonPositive[key]) {
        add(
          `${model.nonPositive[key]} left out: zero or less on the ${key} axis, which a ` +
            'logarithmic scale cannot show.',
          true
        );
      }
    }
    // A row with no usable result is already told above, by the participant
    // it left without a value; the rest (duplicates, rows with no id) are not.
    model.unused
      .filter((entry) => entry.reason !== UNUSED.MISSING_RESULT)
      .forEach((entry) =>
        add(`${entry.n} row${entry.n === 1 ? '' : 's'} not used: ${entry.reason}.`, true)
      );
    if (model.filtered !== null && model.filtered < this.tables.participants.length) {
      add(`${model.filtered} of ${this.tables.participants.length} participants pass the filters.`);
    }
    if (model.baselineVisits && [state.x, state.y].some((axis) => axis.value !== 'raw')) {
      add(`Baseline visit: ${model.baselineVisits.join(', ')}.`);
    }
  }

  // ---- The statistics line, and the fitted line ---------------------------------

  // Asks R for one panel: its coefficient, printed under the panel, and, when a
  // linear fit or a smooth is chosen, its line, drawn on the panel. Each panel
  // asks for itself, on its own rows, and is answered for itself.
  ask(round, chart, panel, model, line) {
    const { settings, state, kit } = this;
    const several = model.panels.length > 1;
    // Under the panel: the coefficient, and beneath it what R says of a fitted
    // line. Each is there only when it is asked for, so a line with nothing to
    // say takes no room.
    const lineFromR = FITS_FROM_R.includes(state.fit) && Boolean(settings.fit_statistic);
    const coefficient = kit.createElement('div', 'bv-coefficient');
    const fit = kit.createElement('div', 'bv-fit');
    if (settings.statistic) line.append(coefficient);
    if (lineFromR) line.append(fit);
    // The line's state is its coefficient's, or its fit's while there is no coefficient.
    const show = (target, description) => {
      writeStatistic(kit, target, description);
      line.dataset.state = (settings.statistic ? coefficient : fit).dataset.state || 'empty';
    };
    const record = (request, kind) => {
      const asked = {
        panel: panel.title,
        kind,
        name: request.name,
        args: request.args,
        dataId: request.dataId,
        rows: request.rows,
        answer: null
      };
      this.asked.push(asked);
      return asked;
    };

    const color = state.colorBy ? this.labelOf(state.colorBy) : null;
    const scaleOf = (method) =>
      scaleText({
        xScale: state.xScale,
        yScale: state.yScale,
        x: this.titleOf(state.x),
        y: this.titleOf(state.y),
        method
      });

    if (settings.statistic) {
      const request = correlationRequest({
        name: settings.statistic,
        method: state.method,
        settings,
        state,
        panel
      });
      const asked = record(request, 'coefficient');
      round.ask(
        request,
        (description, answer) => {
          if (answer) asked.answer = answer;
          show(coefficient, description);
        },
        {
          scope: scopeText({
            n: panel.records.length,
            panel: several ? panel.title : null,
            color,
            filters: filtersForScope(this)
          }),
          color,
          scale: scaleOf(state.method)
        }
      );
    }

    if (!lineFromR) return;
    const request = fitRequest({
      name: settings.fit_statistic,
      fit: state.fit,
      settings,
      state,
      panel
    });
    const asked = record(request, 'fit');
    round.ask(
      request,
      (description, answer) => {
        if (answer) asked.answer = answer;
        // The lines are drawn only from R's own answer for the rows on screen.
        chart.$fit = answer ? fitCurves(answer, state) : null;
        chart.draw();
        show(fit, description);
      },
      {
        kind: 'fit',
        fit: state.fit,
        color,
        scope: fitScopeText({
          fit: state.fit,
          n: panel.records.length,
          panel: several ? panel.title : null,
          color
        }),
        scale: scaleOf(state.fit)
      }
    );
  }

  /**
   * What the chart has asked R for the panels now drawn, and what R answered:
   * one entry per request, in the order the panels are drawn, a panel's
   * coefficient before its fitted line. A request is exactly what the
   * connection was given, so it is the key a stored result must carry to be
   * found.
   * @returns {Array<{panel: string, kind: string, name: string, args: object,
   *   dataId: object, rows: number, answer: ?object}>} `kind` is `coefficient`
   *   or `fit`; `answer` is what the connection resolved to, or null while R
   *   has not answered.
   */
  statistics() {
    return structuredClone(this.asked);
  }

  // ---- Region, listing and participant profile ---------------------------------

  // A drag selects a region and a click picks a point. With a mouse or a pen a
  // drag is always a region. With a finger a drag scrolls the page, so it is a
  // region only while Select a region is on.
  attachPointer(chart, panel) {
    const { canvas } = chart;
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const position = (event) => {
      const rect = canvas.getBoundingClientRect();
      const area = chart.chartArea;
      return {
        x: clamp(event.clientX - rect.left, area.left, area.right),
        y: clamp(event.clientY - rect.top, area.top, area.bottom)
      };
    };
    const regionOf = (from, to) => ({
      x: [Math.min(from.x, to.x), Math.max(from.x, to.x)].map((pixel) =>
        chart.scales.x.getValueForPixel(pixel)
      ),
      // The lower pixel is the greater value.
      y: [Math.max(from.y, to.y), Math.min(from.y, to.y)].map((pixel) =>
        chart.scales.y.getValueForPixel(pixel)
      )
    });
    let start = null;
    let pointer = null;
    let dragged = false;
    let swallowClick = false;

    const onDown = (event) => {
      if (event.pointerType === 'touch' && !this.regionMode) return;
      if (event.button) return;
      start = position(event);
      pointer = event.pointerId;
      dragged = false;
      if (canvas.setPointerCapture) {
        try {
          canvas.setPointerCapture(pointer);
        } catch {
          // A pointer that is already gone cannot be captured, and need not be.
        }
      }
    };
    const onMove = (event) => {
      if (!start || event.pointerId !== pointer) return;
      const at = position(event);
      if (!dragged && Math.hypot(at.x - start.x, at.y - start.y) < CLICK_SLOP) return;
      dragged = true;
      chart.$dragging = regionOf(start, at);
      chart.draw();
    };
    const onUp = (event) => {
      if (!start || event.pointerId !== pointer) return;
      const from = start;
      start = null;
      chart.$dragging = null;
      if (!dragged) return;
      // The click that follows a drag is the end of the drag, not a click.
      swallowClick = true;
      setTimeout(() => {
        swallowClick = false;
      }, 0);
      this.selectRegion(panel, regionOf(from, position(event)));
    };
    const onCancel = () => {
      start = null;
      if (chart.$dragging) {
        chart.$dragging = null;
        chart.draw();
      }
    };
    const onClick = (event) => {
      if (swallowClick) {
        swallowClick = false;
        return;
      }
      const [hit] = chart.getElementsAtEventForMode(event, 'nearest', { intersect: true }, false);
      if (!hit) {
        // A click on nothing lets go of what was selected.
        if (this.selection) {
          this.clearSelection();
          this.select(null);
          this.footnote.textContent = this.hint();
        }
        return;
      }
      const { record } = chart.data.datasets[hit.datasetIndex].data[hit.index];
      this.pick(panel, record);
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('click', onClick);
    chart.$detach = () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('click', onClick);
    };
  }

  // The panel a caller names: by its title, or the only one.
  panelNamed(name) {
    if (!this.model) return null;
    const { panels } = this.model;
    if (name === undefined || name === null) return panels.length === 1 ? panels[0] : null;
    return panels.find((panel) => panel.title === String(name)) || null;
  }

  /**
   * Select a region, as a drag across the points does: its participants are
   * listed under the chart. The statistics do not follow it: they stay those
   * of every participant drawn.
   * @param {{x: number[], y: number[], panel?: string}} region The region's two
   *   ends on each axis, in the values' own units, and, when the chart has
   *   panels, the title of the panel it is in.
   * @returns {AssociationScatter} The chart, for chaining.
   */
  brush(region) {
    const given = region || {};
    const panel = this.panelNamed(given.panel);
    const pair = (ends) =>
      Array.isArray(ends) && ends.length === 2 && ends.every((end) => Number.isFinite(end));
    if (!panel || !pair(given.x) || !pair(given.y)) {
      throw new TypeError(
        'bio.viz: brush() takes { x: [from, to], y: [from, to] }, and `panel`, the title of a ' +
          'panel, when the chart has more than one.'
      );
    }
    this.selectRegion(panel, {
      x: [Math.min(...given.x), Math.max(...given.x)],
      y: [Math.min(...given.y), Math.max(...given.y)]
    });
    return this;
  }

  /**
   * Let go of the region and empty the listing.
   * @returns {AssociationScatter} The chart, for chaining.
   */
  clearBrush() {
    this.clearSelection();
    if (this.model && this.model.drawn) this.footnote.textContent = this.hint();
    this.charts.forEach((chart) => chart.update('none'));
    return this;
  }

  selectRegion(panel, region) {
    const records = brushed(panel.records, region);
    this.clearSelection();
    // A drag ends on a point as often as not: its tooltip is not left standing
    // over the region.
    this.charts.forEach((chart) => {
      chart.setActiveElements([]);
      if (chart.tooltip) chart.tooltip.setActiveElements([], { x: 0, y: 0 });
    });
    if (!records.length) {
      this.footnote.textContent = `No participant is in that region. ${this.hint()}`;
      this.charts.forEach((chart) => chart.update('none'));
      return;
    }
    this.selection = {
      panel,
      region,
      ids: new Set(records.map((record) => String(record[this.settings.id_col])))
    };
    this.list(panel, records, 'in the region');
    this.charts.forEach((chart) => chart.update('none'));
  }

  // A point: its participant is listed, and their profile opened.
  pick(panel, record) {
    this.clearSelection();
    const id = String(record[this.settings.id_col]);
    this.selection = { panel, region: null, ids: new Set([id]) };
    this.list(panel, [record], 'at the point');
    this.charts.forEach((chart) => chart.update('none'));
    this.select(id);
  }

  // The columns of the listing: the ones named in settings, or the participant,
  // the two values drawn, the colour and the panel.
  listingColumns() {
    if (this.settings.details) return this.settings.details;
    const { state, settings } = this;
    const columns = [
      { value_col: settings.id_col, label: 'Participant' },
      { value_col: 'x', label: this.titleOf(state.x) },
      { value_col: 'y', label: this.titleOf(state.y) }
    ];
    if (state.colorBy) columns.push({ value_col: 'color', label: this.labelOf(state.colorBy) });
    if (state.panelBy) columns.push({ value_col: 'panel', label: this.labelOf(state.panelBy) });
    return columns;
  }

  list(panel, records, where) {
    showListing(this, {
      columns: this.listingColumns(),
      rows: records.map((record) => ({ ...record, x: shown(record.x), y: shown(record.y) }))
    });
    const drawn = panel.records.length;
    const of = panel.title ? ` in this panel (${panel.title})` : '';
    this.footnote.textContent =
      `${plural(records.length)} ${where} listed, of the ${drawn} drawn${of}. ` +
      (this.settings.statistic
        ? `The statistics are still of all ${drawn}: a region lists participants and does not ` +
          'change what R is asked. '
        : '') +
      "Click a row to open the participant's profile.";
  }

  // Select one participant, or none: mark the listing's row and raise
  // safety.viz's selection event, which the participant rail opens on and any
  // other chart on the page can listen for.
  select(id) {
    selectParticipant(this, id);
  }

  // Empties the listing, the region and the rail without raising an event: the
  // chart is about to show other rows.
  clearSelection() {
    this.selection = null;
    clearListing(this);
  }

  // The rows safety.viz's participant rail reads, and the rail, mounted.
  buildProfileFeed() {
    buildProfileFeed(this, () => this.railSettings());
  }

  railSettings() {
    return railSettings(this, this.state.yScale);
  }

  /**
   * What the chart is drawn on, as settings: the two variables, the colour, the
   * panels, the scales, the line and the method the controls are set to. Given
   * back to `associationScatter` or `setSettings`, it opens the same view.
   * @returns {object} `x`, `y`, `color_by`, `panel_by`, `x_scale`, `y_scale`,
   *   `fit` and `method`.
   */
  view() {
    const { state } = this;
    return {
      x: state.x ? settingOf(state.x) : null,
      y: state.y ? settingOf(state.y) : null,
      color_by: state.colorBy || null,
      panel_by: state.panelBy || null,
      x_scale: state.xScale,
      y_scale: state.yScale,
      fit: state.fit,
      method: state.method
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
    this.charts.forEach((chart) => {
      if (chart.$detach) chart.$detach();
      chart.destroy();
    });
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
 * Make an association scatter in an element. The controls are drawn at once;
 * give the tables to `init` on the chart that is returned.
 *
 * @param {string|HTMLElement} element The element, or a CSS selector for it.
 * @param {object} [settings] Settings to lay over the defaults.
 * @returns {AssociationScatter} The chart: `init`, `setData`, `setSettings`,
 *   `render`, `resize`, `destroy`, `statistics`, `brush`, `clearBrush`, `view`.
 */
export function associationScatter(element, settings) {
  return new AssociationScatter(element, settings);
}
