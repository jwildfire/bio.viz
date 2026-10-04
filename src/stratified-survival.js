// The stratified survival chart: do participants with high and low levels of
// this biomarker have different outcomes? Kaplan-Meier curves per group, with
// censor marks and an at-risk strip, above a small histogram of the biomarker
// showing where the cut falls and how many land each side.
//
//   BioViz.stratifiedSurvival('#chart', {
//     group_by: { measure: 'CRP', visit: 'Baseline', cut: 'median' }
//   }).init({ results, participants, outcomes });
//
// The groups are a column's, or a biomarker or a number cut by the shared cut
// rule. A cut's line on the histogram can be dragged: the curves follow it at
// once, and when it is let go the cut becomes a typed point and R is asked
// again. A curve, or a cell of the at-risk strip, lists its participants in the
// kit's listing, and a row of the listing opens safety.viz's participant
// profile.
//
// The lifecycle is safety.viz's (init, setData, setSettings, render, resize,
// destroy), and the chart is built as the other charts are: from safety.viz's
// kit, found on the page when a chart is made, with its frame from the core and
// the parts every chart shares from src/shared/.
//
// The curves are the kit's `kmEstimate`, the descriptive product-limit
// estimate, drawn as steps; no confidence band is worked out or drawn here.
// Every number the statistics line prints is R's, from one call per view to
// gsm.bio's Analyze_Survival: the log-rank test, each group's median with its
// interval and, for two groups, the hazard ratio with its interval.

import { createConnection } from './r/connection.js';
import { cutGroup, writePoint } from './core/cut.js';
import { UNUSED } from './core/reasons.js';
import { label as variableLabel } from './core/variable.js';
import { syncSettings } from './stratified-survival/configure.js';
import { movePoints } from './stratified-survival/drag.js';
import {
  ONE_GROUP,
  createStatisticDesk,
  scopeText,
  survivalRequest
} from './stratified-survival/statistic.js';
import { atRisk, buildSurvival, listEndpoints } from './stratified-survival/structureData.js';
import {
  PALETTE,
  addFilterControls,
  buildProfileFeed,
  checkTables,
  clearListing,
  drawSafely,
  filtersForScope,
  findKit,
  hexToRgba,
  lineStyles,
  mountShell,
  mountToolbar,
  railSettings,
  readGiven,
  readOutcomesGiven,
  selectParticipant,
  showListing,
  syncHost,
  toolbarStyles,
  writeStatistic,
  writeTitles,
  specificationOf
} from './shared/chartHost.js';
import { cutNote, isCut } from './shared/cut.js';
import { checkOutcomes, laidOver } from './shared/outcomes.js';
import { refuse } from './shared/settings.js';
import { NOBODY_PASSES, categoryColumns, filterColumns, listMeasures } from './shared/tables.js';

const MODULE_CLASS = 'bv-stratified-survival';
const STYLE_ID = 'bio-viz-stratified-survival-styles';
const C = `.${MODULE_CLASS}`;
const STYLES = `${lineStyles(C)}
${toolbarStyles(C)}
${C} .bv-chart-wrap{height:var(--bv-curves-height,340px);position:relative}
${C} .bv-risk-wrap{margin:.5rem 0 .8rem;max-width:100%;overflow-x:auto}
${C} .bv-risk{border-collapse:collapse;font-size:.8rem;color:#1f2933;font-variant-numeric:tabular-nums}
${C} .bv-risk caption{caption-side:top;text-align:left;font-weight:600;padding:0 0 .3rem}
${C} .bv-risk th,${C} .bv-risk td{border:1px solid #d8dee4;padding:0;text-align:right;white-space:nowrap}
${C} .bv-risk thead th{background:#f6f8fa;font-weight:600;padding:.2rem .5rem}
${C} .bv-risk tbody th{text-align:left;background:#f6f8fa}
${C} .bv-risk button{display:block;width:100%;margin:0;border:0;background:transparent;padding:.25rem .5rem;font:inherit;text-align:inherit;color:inherit;cursor:pointer}
${C} .bv-risk button:hover{background:#f4f8fc}
${C} .bv-risk button:focus-visible{outline:2px solid #0b62a4;outline-offset:-2px}
${C} .bv-swatch{display:inline-block;width:.7rem;height:.7rem;margin-right:.35rem;border-radius:2px;vertical-align:-1px}
${C} .bv-hist{margin:0 0 .6rem}
${C} .bv-hist-canvas{height:150px;position:relative;touch-action:pan-y}
${C} .bv-cut-handle{position:absolute;width:18px;margin-left:-9px;cursor:ew-resize;border-radius:3px}
${C} .bv-cut-handle:focus-visible{outline:2px solid #0b62a4;outline-offset:0}
${C} .bv-hist-canvas canvas{cursor:ew-resize}
${C} .bv-hist-canvas canvas:focus-visible{outline:2px solid #0b62a4;outline-offset:2px}
${C} .bv-cut-counts{margin:.25rem 0 0;font-size:.8rem;color:#52616f}
${C} .bv-control-note{display:block;margin:.2rem 0 0;font-size:.75rem;color:#52616f}`;

const HINT =
  'Click a curve, or a count of the at-risk strip, to list its participants and open a ' +
  'participant’s profile.';
const DRAG_HINT =
  'Drag a cut line on the histogram to move it: the curves follow, and R is asked when it is let go.';
/** The line while a cut line is held: R is asked when it is let go. */
export const MOVING =
  'Statistics: R is asked when the cut line is let go. The curves are drawn for the cut where it is now.';
/** What the chart says when it is given no outcomes table. */
export const NEEDS_OUTCOMES =
  'This chart needs an outcomes table: give `outcomes`, one row per participant and endpoint, ' +
  'with a time and a flag, as `init({ results, participants, outcomes })`.';
const CUT_KEY = 'bv-cut:';
const MOVED_KEY = 'bv-cut:moved';
// How near a cut line, in pixels, a press must be to take hold of it: with a
// mouse, and with a finger.
const GRIP = 10;
const TOUCH_GRIP = 24;
// How far, in pixels, a pointer held on a line must move before it drags it:
// less is a click, which leaves the line where it is.
const BUDGE = 3;
// How long, in milliseconds, the keys must rest before R is asked for a line
// moved from the keyboard.
const SETTLE = 400;

// A cut variable in words, without its cut: the variable the histogram shows.
const uncutLabel = (spec) => {
  const plain = { ...spec };
  delete plain.cut;
  return variableLabel(plain);
};

/**
 * The live chart. Made by `stratifiedSurvival()`, not directly.
 */
class StratifiedSurvival {
  constructor(element, settings) {
    this.kit = findKit('the stratified survival chart');
    this.element = typeof element === 'string' ? document.querySelector(element) : element;
    if (!this.element) {
      throw new Error(`bio.viz: stratified survival target not found: ${element}`);
    }
    this.settings = syncSettings(settings);
    this.tables = { results: [], participants: null, outcomes: null };
    this.charts = [];
    this.model = null;
    this.measures = [];
    this.categories = [];
    this.cutOptions = [];
    this.endpoints = [];
    this.filterSpecs = [];
    this.state = {};
    this.asked = [];
    this.drag = null;
    this.connect();
    this.renderShell();
  }

  // The connection the statistics line asks: the one given in settings, or one
  // with no R attached, which answers that statistics are unavailable.
  connect() {
    if (this.desk) this.desk.retire();
    this.connection = this.settings.connection || createConnection();
    this.desk = createStatisticDesk({
      connection: this.connection,
      note: this.settings.waiting_note
    });
  }

  renderShell() {
    mountShell(this, {
      moduleClass: MODULE_CLASS,
      styleId: STYLE_ID,
      styles: STYLES,
      listingFile: 'bio.viz-stratified-survival-listing.csv'
    });
    const { kit } = this;
    this.riskWrap = kit.createElement('div', 'bv-risk-wrap');
    this.histWrap = kit.createElement('div', 'bv-hist');
    this.histBox = kit.createElement('div', 'bv-hist-canvas');
    this.histCanvas = document.createElement('canvas');
    this.histCanvas.tabIndex = 0;
    this.histBox.append(this.histCanvas);
    this.cutCounts = kit.createElement('p', 'bv-cut-counts');
    this.histWrap.append(this.histBox, this.cutCounts);
    this.chartWrap.after(this.riskWrap);
    this.riskWrap.after(this.histWrap);
    this.listenToHistogram();
    // A click on a curve lists its group: on the step the curve draws at that
    // time, within a few pixels; a click away from every curve lists nothing.
    this.canvas.addEventListener('click', (event) => {
      const level = this.curveAt(event);
      if (level !== null) this.listGroup(level);
    });
    mountToolbar(this);
  }

  /**
   * Load the tables and draw: the same as `setData`.
   * @param {{results: object[], participants?: object[], outcomes?: object[]}} data
   * @returns {StratifiedSurvival} The chart, for chaining.
   */
  init(data) {
    return this.setData(data);
  }

  /**
   * Replace the tables and draw again. The controls are rebuilt from the new
   * tables and return to what the settings open on.
   * @param {{results: object[], participants?: object[], outcomes?: object[]}} data
   *   The tables: the results table, the participant table when there is one,
   *   and the outcomes table. A bare array is taken as the results table.
   * @param {object} [settings] Settings to change with the tables, when the new
   *   tables need them. The tables are checked against these.
   * @returns {StratifiedSurvival} The chart, for chaining.
   */
  setData(data, settings) {
    const next =
      settings === undefined || settings === null
        ? this.settings
        : syncSettings(laidOver(this.settings, settings));
    const given = Array.isArray(data) ? { results: data } : data || {};
    const read = readGiven(this, given, next);
    const outcomes = readOutcomesGiven(this, given.outcomes, next);
    this.tables = { ...read, outcomes };
    if (next !== this.settings) this.setSettings(settings);
    this.readTables();
    this.state = this.seedState();
    this.buildProfileFeed();
    this.buildControls();
    this.render();
    return this;
  }

  /**
   * Lay new settings over the current ones and draw again. A setting that says
   * what the chart opens on (`endpoint`, `group_by`, `filters`) moves its
   * control.
   * @param {object} settings The settings to change.
   * @returns {StratifiedSurvival} The chart, for chaining.
   */
  setSettings(settings) {
    const given = settings || {};
    const next = syncSettings(laidOver(this.settings, given));
    checkTables(this.tables, next);
    if (this.tables.outcomes) checkOutcomes(this.tables.outcomes, next);
    this.settings = next;
    syncHost(this);
    if ('back' in given) mountToolbar(this);
    if ('connection' in given || 'waiting_note' in given) this.connect();
    this.readTables();
    const opening = this.seedState();
    const moved = { endpoint: 'endpoint', group_by: 'groupBy', filters: 'filters' };
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

  // What the controls can offer, read from the tables and the settings.
  readTables() {
    const { results, outcomes } = this.tables;
    const { settings } = this;
    this.measures = results.length ? listMeasures(results, settings) : [];
    this.categories = results.length ? categoryColumns(this.tables, settings) : [];
    this.filterSpecs = filterColumns(this.tables, settings, this.categories).map((spec) =>
      this.kit.normalizeFilterSpec(spec)
    );
    this.endpoints = outcomes ? listEndpoints(outcomes, settings) : [];
    // The cut variables the settings name, each once, offered after the
    // columns; and the cut a line was last dropped at, when there is one.
    const moved = this.cutOptions.find((entry) => entry.key === MOVED_KEY);
    this.cutOptions = [];
    for (const by of [settings.group_by, ...(settings.cuts || [])]) {
      if (!isCut(by)) continue;
      const written = JSON.stringify(by);
      if (this.cutOptions.some((entry) => JSON.stringify(entry.spec) === written)) continue;
      this.cutOptions.push({
        key: `${CUT_KEY}${this.cutOptions.length}`,
        spec: by,
        label: variableLabel(by)
      });
    }
    if (moved) this.cutOptions.push(moved);
  }

  cutKey(by) {
    const written = JSON.stringify(by);
    return this.cutOptions.find((entry) => JSON.stringify(entry.spec) === written).key;
  }

  offers(value) {
    return (
      this.categories.some((entry) => entry.value_col === value) ||
      this.cutOptions.some((entry) => entry.key === value)
    );
  }

  // The Group control's value as the chart takes it: a column's name, or the
  // cut variable.
  groupingOf(value) {
    const found = this.cutOptions.find((entry) => entry.key === value);
    return found ? found.spec : value;
  }

  labelOf(value) {
    const cut = this.cutOptions.find((entry) => entry.key === value);
    if (cut) return cut.label;
    const found = this.categories.find((entry) => entry.value_col === value);
    return found ? found.label : value;
  }

  endpointLabel(endpoint) {
    const found = this.endpoints.find((entry) => entry.endpoint === endpoint);
    return found ? found.label : endpoint;
  }

  // The state with the groups as the chart takes them.
  drawingState(state = this.state) {
    return { ...state, groupBy: this.groupingOf(state.groupBy) };
  }

  // What the chart opens on: the settings, where the tables have what they
  // name; otherwise the first endpoint and the first category column.
  seedState() {
    const { settings, categories, endpoints } = this;
    const has = (column) => categories.some((entry) => entry.value_col === column);
    let groupBy = categories[0] ? categories[0].value_col : null;
    if (isCut(settings.group_by)) groupBy = this.cutKey(settings.group_by);
    else if (has(settings.group_by)) groupBy = settings.group_by;
    const named = endpoints.find((entry) => entry.endpoint === settings.endpoint);
    return {
      endpoint: named ? named.endpoint : endpoints[0] ? endpoints[0].endpoint : null,
      groupBy,
      filters: this.kit.initFilterState(this.filterSpecs)
    };
  }

  repairState(opening) {
    if (!this.offers(this.state.groupBy)) this.state.groupBy = opening.groupBy;
    if (!this.endpoints.some((entry) => entry.endpoint === this.state.endpoint)) {
      this.state.endpoint = opening.endpoint;
    }
  }

  // ---- Controls ---------------------------------------------------------------

  buildControls() {
    const { kit, state } = this;
    this.controls.innerHTML = '';
    const { addSection, addControl, addReset } = kit.controlBuilders(this.controls);
    const redraw = () => this.render();
    const select = (name, labelText, options, selected, onChange, parent) => {
      const input = document.createElement('select');
      input.dataset.control = name;
      input.setAttribute('aria-label', labelText);
      options.forEach(([value, text]) => kit.option(input, value, text, value === selected));
      input.onchange = () => onChange(input.value);
      return addControl(labelText, input, parent);
    };

    const view = addSection('View');
    if (this.endpoints.length) {
      select(
        'endpoint',
        'Endpoint',
        this.endpoints.map((entry) => [entry.endpoint, entry.label]),
        state.endpoint,
        (next) => {
          state.endpoint = next;
          redraw();
        },
        view
      );
    }
    const options = [
      ...this.categories.map((entry) => [entry.value_col, entry.label]),
      ...this.cutOptions.map((entry) => [entry.key, entry.label])
    ];
    if (options.length) {
      select(
        'group-by',
        'Groups',
        options,
        state.groupBy,
        (next) => {
          state.groupBy = next;
          this.buildControls();
          redraw();
        },
        view
      );
      if (isCut(this.groupingOf(state.groupBy))) {
        view.append(kit.createElement('small', 'bv-control-note', DRAG_HINT));
      }
    } else {
      view.append(
        kit.createElement(
          'p',
          'sv-warning bv-no-groups',
          'No column can make a group. Give a participant table, or carry a column on the results rows.'
        )
      );
    }

    addFilterControls(this, { addSection, addControl }, () => redraw());

    addReset(() => {
      this.cutOptions = this.cutOptions.filter((entry) => entry.key !== MOVED_KEY);
      this.state = this.seedState();
      this.buildControls();
      this.render();
    });
  }

  // ---- Drawing ----------------------------------------------------------------

  /**
   * Draw everything again from the tables, the settings and the controls, and
   * ask R again. The curves, the strip, the histogram, the line and the listing
   * are cleared first: nothing stays on screen that describes another view.
   * @returns {void}
   */
  render() {
    drawSafely(this, () => this.draw());
  }

  // Everything render() draws. drawSafely says so in the element when it fails.
  draw({ ask = true } = {}) {
    const round = this.desk.begin();
    this.asked = [];
    this.destroyCharts();
    this.clearSelection();
    this.notes.innerHTML = '';
    this.riskWrap.innerHTML = '';
    this.multiplesWrap.innerHTML = '';
    this.cutCounts.textContent = '';
    this.clearHandles();
    this.histWrap.classList.add('sv-hidden');
    this.statLine.textContent = '';
    this.statLine.dataset.state = 'empty';
    this.chartWrap.classList.add('sv-hidden');
    this.model = null;

    const { kit, settings, state } = this;
    if (!this.tables.outcomes) {
      this.footnote.textContent = NEEDS_OUTCOMES;
      return;
    }
    if (!this.tables.results.length) {
      this.footnote.textContent = 'No results to draw.';
      return;
    }
    if (!state.groupBy) {
      this.footnote.textContent = 'Choose the groups.';
      return;
    }
    const drawing = this.viewState();
    const model = buildSurvival(this.tables, settings, drawing, {
      kmEstimate: kit.kmEstimate,
      filterMatches: kit.filterMatches
    });
    this.model = model;
    this.updateNotes(model);
    if (model.filtered === 0) {
      this.footnote.textContent = NOBODY_PASSES;
      return;
    }
    if (!model.records.length) {
      this.footnote.textContent = 'No participant has a group and an outcome for the endpoint.';
      return;
    }
    this.drawCurves(model);
    this.drawRisk(model);
    this.drawHistogram(model);
    this.footnote.textContent = [HINT, ...this.cutNotes(model)].join(' ');

    if (!settings.statistic) return;
    const show = (description) => writeStatistic(kit, this.statLine, description);
    if (!ask) {
      show({ state: 'none', text: this.desk.idle(MOVING), estimates: [], remarks: [] });
      return;
    }
    if (model.levels.length < 2) {
      show({ state: 'none', text: ONE_GROUP, estimates: [], remarks: [] });
      return;
    }
    const request = survivalRequest({ name: settings.statistic, settings, state: drawing, model });
    const asked = {
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
      {
        scope: scopeText({
          n: model.records.length,
          endpoint: this.endpointLabel(state.endpoint),
          filters: filtersForScope(this)
        }),
        levels: model.levels,
        highOverLow: isCut(drawing.groupBy)
      }
    );
  }

  // The view the chart draws: the controls, with a cut line held where it is.
  viewState() {
    const drawing = this.drawingState();
    if (this.drag && this.drag.points && isCut(drawing.groupBy)) {
      return { ...drawing, groupBy: { ...drawing.groupBy, cut: [...this.drag.points] } };
    }
    return drawing;
  }

  // Above the curves: who is drawn, and who was left out.
  updateNotes(model) {
    const { kit } = this;
    const add = (text, warning) =>
      this.notes.append(kit.createElement('span', warning ? 'sv-warning' : null, text));
    if (model.participants) {
      add(`${model.records.length} of ${model.participants} participants drawn.`);
    }
    model.dropped.forEach((entry) => add(`${entry.n} left out: ${entry.reason}.`, true));
    model.unused
      .filter((entry) => entry.reason !== UNUSED.MISSING_RESULT)
      .forEach((entry) =>
        add(`${entry.n} row${entry.n === 1 ? '' : 's'} not used: ${entry.reason}.`, true)
      );
    if (model.filtered !== null && model.filtered < this.tables.participants.length) {
      add(`${model.filtered} of ${this.tables.participants.length} participants pass the filters.`);
    }
  }

  cutNotes(model) {
    if (!model.cut) return [];
    const said = [cutNote(model.cut.spec, model.cut)];
    if (!Array.isArray(model.cut.cut)) {
      said.push(
        'Only participants with an outcome for the endpoint are cut, as R’s Analyze_Screen cuts them.'
      );
    }
    return said;
  }

  colorOf(index) {
    return PALETTE[index % PALETTE.length];
  }

  // The curves: each group's estimate as steps from 1 at time 0, to its last
  // time, with a mark at each censored time.
  drawCurves(model) {
    const { kit, state } = this;
    this.chartWrap.classList.remove('sv-hidden');
    const datasets = [];
    model.curves.forEach((curve, index) => {
      const color = this.colorOf(index);
      const steps = [
        { x: 0, y: 1 },
        ...curve.estimate.points.map((p) => ({ x: p.time, y: p.surv }))
      ];
      const final = steps[steps.length - 1];
      if (curve.estimate.maxTime > final.x) steps.push({ x: curve.estimate.maxTime, y: final.y });
      datasets.push({
        label: `${curve.level} (n = ${curve.n})`,
        level: curve.level,
        kind: 'curve',
        data: steps,
        stepped: 'after',
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        pointRadius: 0,
        pointHitRadius: 6,
        fill: false
      });
      datasets.push({
        label: `${curve.level}: censored`,
        level: curve.level,
        kind: 'censor',
        data: curve.estimate.censorTimes.map((mark) => ({ x: mark.time, y: mark.surv })),
        showLine: false,
        pointStyle: 'line',
        rotation: 90,
        pointRadius: 5,
        pointBorderWidth: 1.5,
        borderColor: color,
        backgroundColor: color
      });
    });
    const chart = new kit.Chart(this.canvas.getContext('2d'), {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            // A curve and its censor marks are one: the legend names them
            // and hides neither.
            onClick: () => {},
            labels: { filter: (item) => datasets[item.datasetIndex].kind === 'curve' },
            title: { display: true, text: this.labelOf(state.groupBy) }
          },
          tooltip: {
            filter: (item) => datasets[item.datasetIndex].kind === 'curve',
            callbacks: {
              label: (item) =>
                `${datasets[item.datasetIndex].level}: ${Number(item.raw.y.toPrecision(4))} at ${Number(item.raw.x.toPrecision(4))}`
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            min: 0,
            max:
              model.times[model.times.length - 1] >= model.last
                ? model.times[model.times.length - 1]
                : model.last,
            afterBuildTicks: (axis) => {
              axis.ticks = model.times.map((value) => ({ value }));
            },
            title: { display: true, text: this.endpointLabel(state.endpoint) }
          },
          y: {
            min: 0,
            max: 1,
            title: { display: true, text: 'Kaplan–Meier estimate' }
          }
        }
      }
    });
    this.canvas.setAttribute(
      'aria-label',
      `Kaplan–Meier curves by ${this.labelOf(state.groupBy)}: ` +
        model.curves
          .map((curve) => `${curve.level}, ${curve.n} participants, ${curve.events} events`)
          .join('; ')
    );
    this.charts.push(chart);
    this.curvesChart = chart;
  }

  // The group whose curve passes within a few pixels of a pointer event, or
  // null: the curve's height at that time is its last step at or before it.
  curveAt(event) {
    const chart = this.curvesChart;
    if (!chart || !this.model) return null;
    const box = this.canvas.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const { left, right, top, bottom } = chart.chartArea;
    if (x < left || x > right || y < top - 6 || y > bottom + 6) return null;
    const time = chart.scales.x.getValueForPixel(x);
    let best = null;
    let nearest = 8;
    for (const curve of this.model.curves) {
      if (time > curve.estimate.maxTime) continue;
      const step = [...curve.estimate.points].reverse().find((point) => point.time <= time);
      const away = Math.abs(chart.scales.y.getPixelForValue(step ? step.surv : 1) - y);
      if (away <= nearest) {
        nearest = away;
        best = curve.level;
      }
    }
    return best;
  }

  // The at-risk strip: for each group, how many are at risk at each time of
  // the axis. A group's name lists its participants, and a count lists the
  // participants it counts.
  drawRisk(model) {
    const { kit } = this;
    const table = kit.createElement('table', 'bv-risk');
    table.append(kit.createElement('caption', null, 'Number at risk'));
    const head = kit.createElement('thead');
    const top = kit.createElement('tr');
    const corner = kit.createElement('th', null, this.labelOf(this.state.groupBy));
    corner.scope = 'col';
    top.append(corner);
    model.times.forEach((time) => {
      const th = kit.createElement('th', null, String(time));
      th.scope = 'col';
      top.append(th);
    });
    head.append(top);
    table.append(head);
    const body = kit.createElement('tbody');
    model.curves.forEach((curve, index) => {
      const tr = kit.createElement('tr');
      const th = kit.createElement('th');
      th.scope = 'row';
      const name = kit.createElement('button');
      name.type = 'button';
      name.dataset.group = curve.level;
      const swatch = kit.createElement('span', 'bv-swatch');
      swatch.style.background = this.colorOf(index);
      name.append(swatch, document.createTextNode(curve.level));
      name.setAttribute('aria-label', `${curve.level}: ${curve.n} participants. List them.`);
      name.onclick = () => this.listGroup(curve.level);
      th.append(name);
      tr.append(th);
      curve.risk.forEach((cell) => {
        const td = kit.createElement('td');
        const button = kit.createElement('button', null, String(cell.atRisk));
        button.type = 'button';
        button.dataset.group = curve.level;
        button.dataset.time = String(cell.time);
        button.setAttribute(
          'aria-label',
          `${curve.level}, at risk at ${cell.time}: ${cell.atRisk}. List them.`
        );
        button.onclick = () => this.listAtRisk(curve.level, cell.time);
        td.append(button);
        tr.append(td);
      });
      body.append(tr);
    });
    table.append(body);
    this.riskWrap.append(table);
  }

  // The histogram of a cut variable's values, with a line at each cut point
  // and how many values fall in each group.
  drawHistogram(model) {
    if (!model.cut || !model.bars.length) return;
    const { kit } = this;
    this.histWrap.classList.remove('sv-hidden');
    const points = model.cut.points;
    const low = model.bars[0].from;
    const high = model.bars[model.bars.length - 1].to;
    const lines = {
      id: 'bvCutLines',
      afterDatasetsDraw: (chart) => {
        const { ctx, chartArea, scales } = chart;
        ctx.save();
        ctx.strokeStyle = '#1f2933';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        points.forEach((point) => {
          const x = scales.x.getPixelForValue(point);
          ctx.beginPath();
          ctx.moveTo(x, chartArea.top);
          ctx.lineTo(x, chartArea.bottom);
          ctx.stroke();
        });
        ctx.restore();
      }
    };
    const chart = new kit.Chart(this.histCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        datasets: [
          {
            label: 'Participants',
            data: model.bars.map((bar) => ({ x: (bar.from + bar.to) / 2, y: bar.n })),
            backgroundColor: hexToRgba('#52616f', 0.45),
            borderColor: '#52616f',
            borderWidth: 1,
            barPercentage: 1,
            categoryPercentage: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: {
            type: 'linear',
            min: low,
            max: high,
            offset: false,
            title: { display: true, text: uncutLabel(model.cut.spec) }
          },
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
            title: { display: true, text: 'Participants' }
          }
        }
      },
      plugins: [lines]
    });
    this.charts.push(chart);
    this.histChart = chart;
    const counts = model.cut.labels.map(
      (label, index) =>
        `${label}: ${model.values.filter((value) => cutGroup(value, points) === index).length}`
    );
    this.cutCounts.textContent = `Values each side of the cut: ${counts.join(' · ')}.`;
    this.histCanvas.setAttribute(
      'aria-label',
      `Histogram of ${uncutLabel(model.cut.spec)}, cut at ` +
        `${points.map((point) => writePoint(point)).join(' and ')}.`
    );
    this.drawHandles(chart, model);
  }

  // A slider over each cut line, for the keyboard: it takes the focus, says
  // where its line is and how far it can go, and its arrow keys move the line.
  drawHandles(chart, model) {
    const { kit } = this;
    this.clearHandles();
    const points = model.cut.points;
    const { min, max } = this.cutRange(model);
    const { top, bottom } = chart.chartArea;
    points.forEach((point, index) => {
      const handle = kit.createElement('div', 'bv-cut-handle');
      handle.tabIndex = 0;
      handle.dataset.index = String(index);
      handle.setAttribute('role', 'slider');
      handle.setAttribute(
        'aria-label',
        `${uncutLabel(model.cut.spec)}: cut point ${index + 1} of ${points.length}`
      );
      handle.setAttribute('aria-orientation', 'horizontal');
      handle.setAttribute('aria-valuemin', String(index > 0 ? points[index - 1] : min));
      handle.setAttribute(
        'aria-valuemax',
        String(index < points.length - 1 ? points[index + 1] : max)
      );
      handle.setAttribute('aria-valuenow', String(point));
      handle.setAttribute('aria-valuetext', writePoint(point));
      handle.style.left = `${chart.scales.x.getPixelForValue(point)}px`;
      handle.style.top = `${top}px`;
      handle.style.height = `${bottom - top}px`;
      handle.addEventListener('keydown', (event) => this.keyCut(event, index));
      handle.addEventListener('keyup', () => this.settleCut());
      // Leaving the slider leaves it: a redraw that replaces it does not.
      handle.addEventListener('blur', () => {
        if (!this.redrawing) this.keyIndex = null;
      });
      this.histBox.append(handle);
      if (this.keyIndex === index) handle.focus();
    });
  }

  // Takes the sliders away, as a redraw does, without letting their focus go.
  clearHandles() {
    this.redrawing = true;
    this.histBox.querySelectorAll('.bv-cut-handle').forEach((handle) => handle.remove());
    this.redrawing = false;
  }

  // The least and the greatest value cut: a line stays between them.
  cutRange(model = this.model) {
    if (!model || !model.bars.length) return { min: -Infinity, max: Infinity };
    return { min: model.bars[0].from, max: model.bars[model.bars.length - 1].to };
  }

  // ---- Moving a cut line ---------------------------------------------------------

  listenToHistogram() {
    const canvas = this.histCanvas;
    // The box holds the canvas and the sliders over its lines: a press on a
    // slider is a press on its line.
    const box = this.histBox;
    const valueAt = (event) => {
      const chart = this.histChart;
      if (!chart) return null;
      const box = canvas.getBoundingClientRect();
      return chart.scales.x.getValueForPixel(event.clientX - box.left);
    };
    box.addEventListener('pointerdown', (event) => {
      const chart = this.histChart;
      if (!chart || !this.model || !this.model.cut) return;
      const x = event.clientX - canvas.getBoundingClientRect().left;
      const points = this.model.cut.points;
      let nearest = -1;
      let distance = Infinity;
      points.forEach((point, index) => {
        const away = Math.abs(chart.scales.x.getPixelForValue(point) - x);
        if (away < distance) {
          distance = away;
          nearest = index;
        }
      });
      const grip = event.pointerType === 'touch' ? TOUCH_GRIP : GRIP;
      if (nearest < 0 || distance > grip) return;
      event.preventDefault();
      if (box.setPointerCapture) box.setPointerCapture(event.pointerId);
      this.holdCut(nearest);
      // The line moves by as much as the pointer does from where it took hold,
      // not to the pointer: a press beside the line does not move it.
      this.drag.grab = { x: event.clientX, offset: points[nearest] - valueAt(event), moved: false };
    });
    box.addEventListener('pointermove', (event) => {
      if (!this.drag || !this.drag.grab) return;
      const { grab } = this.drag;
      if (!grab.moved && Math.abs(event.clientX - grab.x) < BUDGE) return;
      const value = valueAt(event);
      if (value === null) return;
      grab.moved = true;
      this.moveCut(this.drag.index, value + grab.offset);
      // moveCut keeps the hold; the grab is carried with it.
      if (this.drag) this.drag.grab = grab;
    });
    const letGo = () => {
      if (!this.drag || !this.drag.grab) return;
      const { index, points, grab } = this.drag;
      if (!grab.moved) {
        // A click: the line stays where it is, and R is not asked.
        this.drag = null;
        return;
      }
      this.dropCut(index, points[index]);
    };
    box.addEventListener('pointerup', letGo);
    box.addEventListener('pointercancel', letGo);
  }

  // A key on a line's slider: the arrows move it by one bar of the histogram,
  // Page Up and Page Down by five, Home and End to as far as it can go. The
  // curves follow at once; R is asked once the keys have rested.
  keyCut(event, index) {
    if (!this.model || !this.model.cut || !this.model.bars.length) return;
    const [first] = this.model.bars;
    const bar = first.to - first.from;
    const points = this.drag ? this.drag.points : this.model.cut.points;
    const { min, max } = this.cutRange();
    const steps = {
      ArrowLeft: -bar,
      ArrowDown: -bar,
      ArrowRight: bar,
      ArrowUp: bar,
      PageDown: -5 * bar,
      PageUp: 5 * bar
    };
    let target;
    if (event.key in steps) target = points[index] + steps[event.key];
    else if (event.key === 'Home') target = index > 0 ? points[index - 1] : min;
    else if (event.key === 'End') target = index < points.length - 1 ? points[index + 1] : max;
    else return;
    event.preventDefault();
    clearTimeout(this.settleTimer);
    this.keyIndex = index;
    if (this.drag && this.drag.index !== index) this.drag = null;
    // As far as the line can go: short of its neighbours, inside the values.
    const below = index > 0 ? points[index - 1] : -Infinity;
    const above = index < points.length - 1 ? points[index + 1] : Infinity;
    const room = Math.max(below, Math.min(above, target));
    const nudge = (above - below) * 1e-9 || 1e-9;
    const placed = room <= below ? below + nudge : room >= above ? above - nudge : room;
    this.moveCut(index, placed);
  }

  // The keys have stopped: after a short rest, the line is let go where it is.
  settleCut() {
    clearTimeout(this.settleTimer);
    if (!this.drag || this.drag.grab) return;
    const { index } = this.drag;
    this.settleTimer = setTimeout(() => {
      if (!this.drag || this.drag.grab || this.drag.index !== index) return;
      this.dropCut(index, this.drag.points[index]);
    }, SETTLE);
  }

  // Take hold of a cut line: the line stops showing R's answer for the old cut.
  holdCut(index) {
    if (!this.model || !this.model.cut) return;
    this.drag = { index, points: [...this.model.cut.points], model: this.model };
  }

  /**
   * Move a cut line, as dragging it does: the curves, the strip and the
   * histogram follow at once, and R is not asked until the line is let go.
   * @param {number} index Which cut point.
   * @param {number} value Where it is now, on the variable's scale.
   * @returns {?number[]} The cut points drawn, or null when the line cannot go
   *   there.
   */
  moveCut(index, value) {
    if (!this.drag) this.holdCut(index);
    if (!this.drag) return null;
    const points = movePoints(this.drag.points, index, value, this.cutRange(this.drag.model));
    if (!points) return null;
    this.drag = { ...this.drag, index, points };
    drawSafely(this, () => this.draw({ ask: false }));
    return points;
  }

  /**
   * Let a cut line go, as dropping it does: the cut becomes typed points, the
   * moved one where its label writes it, the Group control holds it, and R is
   * asked for the new groups.
   * @param {number} index Which cut point.
   * @param {number} value Where it was let go, on the variable's scale.
   * @returns {?number[]} The typed points, or null when the line cannot go there.
   */
  dropCut(index, value) {
    const from = this.drag
      ? this.drag.points
      : this.model && this.model.cut && this.model.cut.points;
    const range = this.cutRange(this.drag ? this.drag.model : this.model);
    this.drag = null;
    clearTimeout(this.settleTimer);
    const spec = this.groupingOf(this.state.groupBy);
    const points =
      from && isCut(spec) ? movePoints(from, index, value, { drop: true, ...range }) : null;
    if (!points) {
      this.render();
      return null;
    }
    const typed = { ...spec, cut: points };
    this.cutOptions = this.cutOptions.filter((entry) => entry.key !== MOVED_KEY);
    const named = this.cutOptions.find(
      (entry) => JSON.stringify(entry.spec) === JSON.stringify(typed)
    );
    if (named) {
      this.state.groupBy = named.key;
    } else {
      this.cutOptions.push({ key: MOVED_KEY, spec: typed, label: variableLabel(typed) });
      this.state.groupBy = MOVED_KEY;
    }
    this.buildControls();
    this.render();
    return points;
  }

  // ---- Listing and participant profile -------------------------------------------

  /**
   * List the participants of one group, as a click on its curve does.
   * @param {string} level The group.
   * @returns {Array<object>} The participants listed.
   */
  listGroup(level) {
    if (!this.model) return [];
    const records = this.model.records.filter((record) => record.group === String(level));
    this.showRecords(records, `${this.labelOf(this.state.groupBy)} ${level}`);
    this.listed = { group: String(level), time: null };
    return records;
  }

  /**
   * List the participants of a group at risk at a time, as a click on a count
   * of the at-risk strip does.
   * @param {string} level The group.
   * @param {number} time The time.
   * @returns {Array<object>} The participants listed.
   */
  listAtRisk(level, time) {
    if (!this.model) return [];
    const records = atRisk(this.model, String(level), Number(time));
    this.showRecords(records, `${this.labelOf(this.state.groupBy)} ${level}, at risk at ${time}`);
    this.listed = { group: String(level), time: Number(time) };
    return records;
  }

  showRecords(records, what) {
    this.clearSelection();
    showListing(this, {
      columns: this.listingColumns(),
      rows: records.map((record) => ({
        ...record,
        outcome: record.event ? 'Event' : 'Censored'
      }))
    });
    this.footnote.textContent =
      `${what}: ${records.length} participant${records.length === 1 ? '' : 's'} listed. ` +
      "Click a row to open the participant's profile.";
  }

  listingColumns() {
    if (this.settings.details) return this.settings.details;
    return [
      { value_col: this.settings.id_col, label: 'Participant' },
      { value_col: 'group', label: this.labelOf(this.state.groupBy) },
      { value_col: 'time', label: 'Time' },
      { value_col: 'outcome', label: 'Outcome' }
    ];
  }

  select(id) {
    selectParticipant(this, id);
  }

  clearSelection() {
    this.listed = null;
    clearListing(this);
  }

  buildProfileFeed() {
    buildProfileFeed(this, () => this.railSettings());
  }

  railSettings() {
    return railSettings(this, 'linear');
  }

  /**
   * What the controls now read, as the settings the chart would open on with
   * them: the part of its specification the controls hold (#68).
   * @returns {object}
   */
  viewSettings() {
    const { state } = this;
    return {
      endpoint: state.endpoint,
      group_by: state.groupBy ? this.groupingOf(state.groupBy) : null
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
   * heading.
   * @returns {{columns: Array<{value_col: string, label: string}>, rows: object[]}}
   */
  tableOf() {
    const { model, state, settings } = this;
    if (!model || !model.records) return { columns: [], rows: [] };
    return {
      columns: [
        { value_col: settings.id_col, label: 'Participant' },
        { value_col: 'group', label: this.labelOf(state.groupBy) },
        { value_col: 'time', label: 'Time' },
        { value_col: 'event', label: 'Event' }
      ],
      rows: model.records
    };
  }

  /** The placeholders a download's file name is made of, after the chart's name. */
  get viewFields() {
    return ['endpoint', 'group'];
  }

  /**
   * What the title, subtitle and footnotes' placeholders hold for the view now
   * drawn, beside `{date}`, `{version}` and `{filters}` (#66).
   * @returns {object}
   */
  placeholders() {
    const { state, model } = this;
    return {
      endpoint: state.endpoint ? this.endpointLabel(state.endpoint) : '',
      group: state.groupBy ? this.labelOf(state.groupBy) : '',
      n: model && model.records ? model.records.length : ''
    };
  }

  /**
   * What the chart has asked R for the view now drawn, and what R answered:
   * one entry, or none when nothing is asked. The request is exactly what the
   * connection was given, so it is the key a stored result must carry.
   * @returns {Array<{name: string, args: object, dataId: object, rows: number,
   *   answer: ?object}>}
   */
  statistics() {
    return structuredClone(this.asked);
  }

  // ---- Lifecycle --------------------------------------------------------------

  /**
   * Fit the curves and the histogram to their containers.
   * @returns {void}
   */
  resize() {
    this.charts.forEach((chart) => chart.resize());
  }

  destroyCharts() {
    this.charts.forEach((chart) => chart.destroy());
    this.charts = [];
    this.curvesChart = null;
    this.histChart = null;
  }

  /**
   * Take the chart down: its curves, its histogram, its participant rail and
   * everything in its element. A destroyed chart cannot be used again.
   * @returns {void}
   */
  destroy() {
    this.desk.begin();
    this.destroyCharts();
    this.kit.unmountProfileRail(this.host);
    this.element.innerHTML = '';
  }
}

/**
 * Make a stratified survival chart in an element. The controls are drawn at
 * once; give the tables to `init` on the chart that is returned.
 *
 * @param {string|HTMLElement} element The element, or a CSS selector for it.
 * @param {object} [settings] Settings to lay over the defaults.
 * @returns {StratifiedSurvival} The chart: `init`, `setData`, `setSettings`,
 *   `render`, `resize`, `destroy`, `statistics`, `listGroup`, `listAtRisk`,
 *   `moveCut`, `dropCut`.
 */
export function stratifiedSurvival(element, settings) {
  return new StratifiedSurvival(element, settings);
}
