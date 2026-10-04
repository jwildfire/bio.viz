// The correlation matrix: every pair among a set of variables, as a grid, with
// R's coefficient in each cell; and the way into the association scatter.
//
//   BioViz.correlationMatrix('#chart', {}).init({ results, participants });
//
// The variables are several biomarkers at one visit, or one biomarker at
// several visits. Below the diagonal a pair is a mark, sized and coloured by
// its coefficient; above it, the coefficient as a number. A cell opens the
// association scatter for its pair, in place, with a way back.
//
// The lifecycle is safety.viz's (init, setData, setSettings, render, resize,
// destroy), and the chart is built as the other two are: from safety.viz's kit,
// found on the page when a chart is made, with its frame from the core and the
// parts every chart shares from src/shared/.
//
// The chart computes no coefficient: not for a number, not for a mark's size or
// colour, and not for an order. It hands R the frame through the connection
// and draws what comes back. It prints no p-value: R returns none for a grid.

import { associationScatter } from './association-scatter.js';
import { createConnection } from './r/connection.js';
import { UNUSED } from './core/reasons.js';
import { VALUE_TYPES } from './core/variable.js';
import {
  METHODS,
  MODES,
  SCATTER_LIMIT,
  VIEWS,
  syncSettings
} from './correlation-matrix/configure.js';
import {
  COEFFICIENT_NAMES,
  METHOD_LABELS,
  cellText,
  createStatisticDesk,
  matrixRequest,
  scopeText
} from './correlation-matrix/statistic.js';
import {
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
} from './correlation-matrix/structureData.js';
import {
  VALUE_LABELS,
  addFilterControls,
  downloadCsv,
  filtersForScope,
  findKit,
  lineStyles,
  mountShell,
  readGiven,
  writeStatistic,
  drawSafely,
  checkTables,
  writeTitles,
  specificationOf,
  startFilters
} from './shared/chartHost.js';
import { coreSettings } from './shared/settings.js';
import {
  NOBODY_PASSES,
  categoryColumns,
  filterColumns,
  listMeasures,
  listVisits
} from './shared/tables.js';
import { settingOf } from './shared/variables.js';

const MODULE_CLASS = 'bv-correlation-matrix';
const STYLE_ID = 'bio-viz-correlation-matrix-styles';
const C = `.${MODULE_CLASS}`;
const STYLES = `${lineStyles(C)}
${C} .bv-matrix{margin:0 0 .6rem;border:1px solid #d8dee4;border-radius:10px;background:#fff;padding:.8rem}
${C} .bv-matrix-title{margin:0 0 .6rem;font-size:.92rem;font-weight:600;color:#1f2933}
${C} .bv-matrix-scroll{max-width:100%;overflow-x:auto}
${C} .bv-matrix-grid{display:grid;grid-template-columns:fit-content(var(--bv-label)) repeat(var(--bv-n),var(--bv-cell));gap:2px;width:max-content;font-size:.78rem;color:#1f2933}
${C} .bv-col-head{writing-mode:vertical-rl;transform:rotate(180deg);max-height:var(--bv-label);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;justify-self:center;align-self:end;padding:.3rem 0;line-height:1.1}
${C} .bv-row-head{box-sizing:border-box;max-width:var(--bv-label);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;align-self:center;justify-self:end;padding:0 .4rem 0 0}
${C} .bv-cell,${C} .bv-diagonal{box-sizing:border-box;width:var(--bv-cell);height:var(--bv-cell)}
${C} .bv-diagonal{background:#eef1f4;border-radius:3px}
${C} .bv-cell{appearance:none;margin:0;padding:0;border:1px solid #e3e8ee;border-radius:3px;background:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;font:inherit;font-variant-numeric:tabular-nums;color:inherit;overflow:hidden}
${C} .bv-cell:hover{border-color:#0b62a4}
${C} .bv-cell:focus-visible{outline:2px solid #0b62a4;outline-offset:1px}
${C} .bv-cell[data-status=withheld],${C} .bv-cell[data-status=refused],${C} .bv-cell[data-status=error]{background:repeating-linear-gradient(45deg,#f6f8fa,#f6f8fa 4px,#e6eaee 4px,#e6eaee 8px);color:#52616f}
${C} .bv-mark{display:block;width:var(--bv-size);height:var(--bv-size);border-radius:50%;background:var(--bv-color)}
${C} .bv-mark[data-sign=negative]{background:radial-gradient(circle closest-side,transparent 0 54%,var(--bv-color) 56% 100%)}
${C} .bv-cell[data-side=number] .bv-mark,${C} .bv-cell[data-side=mark] .bv-num{display:none}
${C} .bv-matrix-grid.bv-compact{gap:1px}
${C} .bv-compact .bv-cell[data-side=number] .bv-mark{display:block}
${C} .bv-compact .bv-cell[data-side=number] .bv-num{display:none}
${C} .bv-mini{position:relative;width:100%;height:100%}
${C} .bv-key{display:flex;flex-wrap:wrap;align-items:center;gap:.3rem .9rem;margin:.7rem 0 0;font-size:.78rem;color:#52616f}
${C} .bv-key-item{display:inline-flex;align-items:center;gap:.3rem}
${C} .bv-key-mark{display:inline-flex;align-items:center;justify-content:center;width:1.5rem;height:1.5rem}
${C} .bv-key p{margin:0;flex-basis:100%}
${C} .bv-pairs{margin-top:1rem;font-size:.85rem}
${C} .bv-pairs summary{cursor:pointer;font-weight:600;margin:0 0 .4rem}
${C} .bv-pairs-tools{margin:0 0 .4rem}
${C} .bv-pairs-tools button{padding:.3rem .6rem;border:1px solid #d8dee4;border-radius:6px;background:#fff;color:#1f2933;font:inherit;font-size:.8rem;cursor:pointer}
${C} .bv-pairs table{width:100%;border-collapse:collapse;background:#fff;table-layout:fixed}
${C} .bv-pairs th,${C} .bv-pairs td{border-bottom:1px solid #e3e8ee;padding:.4rem .5rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}
${C} .bv-pairs thead th{border-bottom:2px solid #d8dee4;font-size:.8rem;font-weight:600;color:#52616f;overflow-wrap:normal}
${C} .bv-pairs th[scope=row]{font-weight:400}
${C} .bv-pairs thead th:nth-child(1){width:38%}
${C} .bv-pairs thead th:nth-child(2){width:5rem}
${C} .bv-pair{appearance:none;border:0;background:none;padding:0;font:inherit;color:#0b62a4;text-decoration:underline;cursor:pointer;text-align:left}
${C} .bv-pair:focus-visible{outline:2px solid #0b62a4;outline-offset:2px}
${C} .bv-pair-warned{color:#8a5a00;font-weight:600}
${C} .bv-pairs-note{margin:.5rem 0 0;font-size:.8rem;color:#52616f}
${C} .bv-control-note{display:block;margin:.2rem 0 0;font-size:.75rem;color:#52616f}
${C} .sv-control input[type=number]{width:100%}
@media (max-width:600px){
${C} .bv-matrix{padding:.5rem}
${C}.sv-collapsed .sv-sidebar-title{display:inline}
${C}.sv-collapsed .sv-sidebar{padding:.5rem .9rem}
}`;

const MODE_LABELS = {
  biomarkers: 'Biomarkers at one visit',
  visits: 'Visits of one biomarker'
};
const VIEW_LABELS = { grid: 'Grid', scatters: 'Small scatters' };
const BACK = 'Back to the correlation matrix';
const HINT =
  'Click a cell, or press Enter on it, to open that pair in the association scatter. Point at ' +
  'a cell, or move to it with the arrow keys, to read its coefficient and its pair count.';

/**
 * The live chart. Made by `correlationMatrix()`, not directly.
 */
class CorrelationMatrix {
  constructor(element, settings) {
    this.kit = findKit('the correlation matrix');
    this.element = typeof element === 'string' ? document.querySelector(element) : element;
    if (!this.element) throw new Error(`bio.viz: correlation matrix target not found: ${element}`);
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
    this.pairs = null;
    this.opened = null;
    this.focusAt = null;
    this.connect();
    this.renderShell();
  }

  // The connection the grid asks: the one given in settings, or one with no R
  // attached, which answers that statistics are unavailable.
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
      listingFile: 'bio.viz-correlation-matrix-pairs.csv'
    });
    // The grid is drawn as elements, each cell a button: the shell's canvas is
    // not used.
    this.chartWrap.classList.add('sv-hidden');
    this.gridWrap = kit.createElement('div', 'bv-matrix');
    this.gridWrap.hidden = true;
    this.chartWrap.after(this.gridWrap);
    this.onResize = () => this.resize();
    globalThis.addEventListener('resize', this.onResize);
  }

  /**
   * Load the tables and draw: the same as `setData`.
   * @param {{results: object[], participants?: object[]}} data The tables.
   * @returns {CorrelationMatrix} The chart, for chaining.
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
   * @returns {CorrelationMatrix} The chart, for chaining.
   */
  setData(data, settings) {
    this.close();
    if (settings === undefined || settings === null) {
      this.tables = readGiven(this, data);
    } else {
      // The tables and the settings that read them change together: the
      // tables are checked against the new settings, which are then laid over.
      this.tables = readGiven(this, data, syncSettings({ ...this.settings, ...settings }));
      this.setSettings(settings);
    }
    this.readTables();
    this.state = this.seedState();
    this.buildControls();
    this.render();
    return this;
  }

  /**
   * Lay new settings over the current ones and draw again. A setting that says
   * what the chart opens on (`mode`, `visit`, `biomarkers`, `measure`,
   * `visits`, `value_type`, `view`, `method`, `min_pairs`, `filters`) moves its
   * control. A scatter that a cell had opened is closed.
   * @param {object} settings The settings to change.
   * @returns {CorrelationMatrix} The chart, for chaining.
   */
  setSettings(settings) {
    const given = settings || {};
    const next = syncSettings({ ...this.settings, ...given });
    // The tables must still have the columns the new settings name; if not, the
    // settings are refused and nothing changes, a chart opened in place included.
    checkTables(this.tables, next);
    this.close();
    this.settings = next;
    if ('connection' in given || 'waiting_note' in given) this.connect();
    this.readTables();
    const opening = this.seedState();
    const moved = {
      mode: 'mode',
      visit: 'visit',
      biomarkers: 'biomarkers',
      measure: 'measure',
      visits: 'visits',
      value_type: 'valueType',
      view: 'view',
      method: 'method',
      min_pairs: 'minPairs',
      filters: 'filters'
    };
    for (const [setting, key] of Object.entries(moved)) {
      if (setting in given) this.state[key] = opening[key];
    }
    this.repairState(opening);
    this.buildControls();
    this.render();
    return this;
  }

  // What the controls can offer, read from the tables.
  readTables() {
    const { results } = this.tables;
    const { settings } = this;
    this.measures = results.length ? listMeasures(results, settings) : [];
    this.visits = results.length ? listVisits(results, coreSettings(settings)).all : [];
    this.categories = results.length ? categoryColumns(this.tables, settings) : [];
    this.filterSpecs = filterColumns(this.tables, settings, this.categories).map((spec) =>
      this.kit.normalizeFilterSpec(spec)
    );
    // A visit or a biomarker the tables do not have gives way to the first,
    // and says so where a developer will see it.
    for (const [key, list] of [
      ['visit', this.visits],
      ['measure', this.measures]
    ]) {
      if (results.length && settings[key] !== null && !list.includes(settings[key])) {
        console.warn(
          `The initial ${key} [${settings[key]}] does not exist. Defaulting to the first.`
        );
      }
    }
  }

  offered() {
    return { measures: this.measures, visits: this.visits };
  }

  // What the chart opens on: the settings, where the tables have what they name.
  seedState() {
    const { settings, measures, visits } = this;
    // Null is every one, and so is a list of none the tables have; an empty
    // list is a selection of none (#71 review).
    const among = (chosen, list) => {
      if (Array.isArray(chosen) && !chosen.length) return [];
      const kept = (chosen || []).filter((entry) => list.includes(entry));
      return kept.length ? kept : null;
    };
    return {
      mode: settings.mode,
      visit: visits.includes(settings.visit) ? settings.visit : (visits[0] ?? null),
      // Null is every biomarker the control offers; the grid draws the first
      // `limit` of them.
      biomarkers: among(settings.biomarkers, measures),
      measure: measures.includes(settings.measure) ? settings.measure : (measures[0] ?? null),
      visits: among(settings.visits, visits),
      valueType: settings.value_type,
      view: settings.view,
      method: settings.method,
      minPairs: settings.min_pairs,
      filters: startFilters(this)
    };
  }

  // After the tables or the settings change, a control may hold something that
  // is no longer offered; it returns to what the chart opens on.
  repairState(opening) {
    const { state } = this;
    if (!this.visits.includes(state.visit)) state.visit = opening.visit;
    if (!this.measures.includes(state.measure)) state.measure = opening.measure;
    for (const [key, list] of [
      ['biomarkers', this.measures],
      ['visits', this.visits]
    ]) {
      if (state[key]) {
        state[key] = state[key].filter((entry) => list.includes(entry));
        if (!state[key].length) state[key] = opening[key];
      }
    }
  }

  // The grid's variables for what the controls are set to, without the frame.
  drawnVariables() {
    return matrixVariables(this.settings, this.state, this.offered(), this.tables.results);
  }

  // The view drawn: small scatters only for as few variables as they are offered for.
  viewDrawn(count) {
    return this.state.view === 'scatters' && count <= SCATTER_LIMIT ? 'scatters' : 'grid';
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
      return addControl(labelText, input, parent);
    };
    const several = (name, labelText, values, chosen, onChange, parent) => {
      const picker = kit.multiSelect({
        values,
        selected: chosen ? values.filter((value) => chosen.includes(value)) : null,
        onChange
      });
      picker.dataset.control = name;
      return addControl(labelText, picker, parent);
    };

    const variables = addSection('Variables');
    select(
      'mode',
      'Relate',
      MODES.map((mode) => [mode, MODE_LABELS[mode]]),
      state.mode,
      (next) => {
        state.mode = next;
        // The controls beneath are the mode's own.
        redraw(true);
      },
      variables
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
      variables
    );
    if (state.mode === 'biomarkers') {
      if (state.valueType !== 'baseline') {
        select(
          'visit',
          'Visit',
          this.visits.map((visit) => [visit, visit]),
          state.visit,
          (next) => {
            state.visit = next;
            redraw(false);
          },
          variables
        );
      }
      several(
        'biomarkers',
        'Biomarkers',
        this.measures,
        state.biomarkers,
        (next) => {
          state.biomarkers = next;
          redraw(false);
        },
        variables
      );
    } else {
      select(
        'measure',
        'Biomarker',
        this.measures.map((measure) => [measure, measure]),
        state.measure,
        (next) => {
          state.measure = next;
          redraw(false);
        },
        variables
      );
      several(
        'visits',
        'Visits',
        this.visits,
        state.visits,
        (next) => {
          state.visits = next;
          redraw(false);
        },
        variables
      );
    }

    const display = addSection('Display');
    const view = select(
      'view',
      'Draw as',
      VIEWS.map((entry) => [entry, VIEW_LABELS[entry]]),
      state.view,
      (next) => {
        state.view = next;
        redraw(false);
      },
      display
    );
    // A small scatter for every pair is offered for a few variables only: the
    // control follows how many are drawn (syncViewControl).
    const note = kit.createElement('small', 'bv-control-note');
    view.after(note);
    this.viewControl = { input: view.querySelector('select') || view, note };
    this.syncViewControl();

    // What R is asked: the coefficient, and the fewest complete pairs a cell
    // needs. Left empty, the minimum is R's own: none is set here.
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
      const minimum = document.createElement('input');
      minimum.type = 'number';
      minimum.min = '1';
      minimum.step = '1';
      minimum.placeholder = 'R’s own';
      minimum.dataset.control = 'min-pairs';
      minimum.setAttribute('aria-label', 'Minimum pairs for a cell');
      minimum.value = state.minPairs === null ? '' : String(state.minPairs);
      minimum.onchange = () => {
        const asked = Number(minimum.value);
        state.minPairs = minimum.value.trim() !== '' && asked > 0 ? asked : null;
        minimum.value = state.minPairs === null ? '' : String(state.minPairs);
        redraw(false);
      };
      addControl('Minimum pairs for a cell', minimum, statistics);
      minimum.after(
        kit.createElement(
          'small',
          'bv-control-note',
          'A cell with fewer complete pairs shows R’s reason and no number. Left empty, the ' +
            'minimum is R’s own.'
        )
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

  // The Draw as control says what is drawn: the small scatters are offered for
  // a few variables only, and with more the grid is drawn whatever was chosen.
  syncViewControl() {
    if (!this.viewControl) return;
    const { input, note } = this.viewControl;
    const count = this.tables.results.length ? this.drawnVariables().variables.length : 0;
    const offered = count <= SCATTER_LIMIT;
    input.querySelector('option[value="scatters"]').disabled = !offered;
    input.value = this.viewDrawn(count);
    note.textContent =
      `Small scatters are offered for ${SCATTER_LIMIT} variables or fewer` +
      (offered ? '.' : `; ${count} are drawn.`);
  }

  // ---- Drawing ----------------------------------------------------------------

  /**
   * Draw everything again from the tables, the settings and the controls. The
   * grid's numbers and marks, the list of pairs and the statistics line are
   * cleared and asked for again: nothing stays on screen that describes rows
   * the chart no longer holds. A scatter that a cell had opened is closed.
   * @returns {void}
   */
  render() {
    drawSafely(this, () => this.draw());
  }

  // Everything render() draws. drawSafely says so in the element when it fails.
  draw() {
    this.close();
    const round = this.desk.begin();
    this.asked = [];
    this.pairs = null;
    this.destroyCharts();
    this.notes.innerHTML = '';
    this.gridWrap.innerHTML = '';
    this.gridWrap.hidden = true;
    this.listingWrap.innerHTML = '';
    this.statLine.textContent = '';
    this.statLine.dataset.state = 'empty';
    this.model = null;

    const { kit, state, settings } = this;
    this.syncViewControl();
    if (!this.tables.results.length || !this.measures.length) {
      this.footnote.textContent = 'No results to draw.';
      return;
    }
    const model = buildMatrix(this.tables, settings, state, this.offered(), {
      filterMatches: kit.filterMatches
    });
    this.model = model;
    this.updateNotes(model);
    if (model.message) {
      this.footnote.textContent = model.message;
      return;
    }
    if (!model.records.length) {
      this.footnote.textContent =
        model.filtered === 0
          ? NOBODY_PASSES
          : 'No participant has a value for any variable of the grid.';
      return;
    }
    this.footnote.textContent = HINT;
    this.drawGrid();
    if (!settings.statistic) return;

    const request = matrixRequest({
      name: settings.statistic,
      method: state.method,
      minPairs: state.minPairs,
      settings,
      state,
      model
    });
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
        writeStatistic(kit, this.statLine, description);
        // The cells are filled only from R's own answer for the frame on screen.
        this.pairs = description.pairs;
        this.fillGrid();
        this.listPairs();
      },
      {
        variables: model.variables.length,
        scope: scopeText({ n: model.records.length, filters: filtersForScope(this) })
      }
    );
  }

  // Above the grid: how many variables are shown of how many, who is in the
  // frame, and what was left out of it.
  updateNotes(model) {
    const { kit, state } = this;
    const add = (text, warning) =>
      this.notes.append(kit.createElement('span', warning ? 'sv-warning' : null, text));
    if (model.chosen) add(shownCount(model, this.settings.limit));
    if (model.variables.length > 1 && model.participants) {
      add(`${model.records.length} of ${model.participants} participants in the frame.`);
      if (model.empty) {
        add(`${model.empty} left out: no value for any variable of the grid.`, true);
      }
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
    if (model.baselineVisits && state.valueType !== 'raw') {
      const left = model.notDrawn.length
        ? ` It is not drawn: there the ${VALUE_LABELS[state.valueType].toLowerCase()} is the same for everyone.`
        : '';
      add(`Baseline visit: ${model.baselineVisits.join(', ')}.${left}`);
    }
  }

  // The grid's frame: its variables along the top and down the side, and a
  // cell for every pair, each a button that opens the pair. The cells are empty
  // until R answers (fillGrid).
  drawGrid() {
    const { kit, model } = this;
    const { variables } = model;
    const view = this.viewDrawn(variables.length);
    const unit = unitOfGrid(this.tables.results, this.settings, variables);
    this.gridWrap.hidden = false;
    this.gridWrap.append(
      kit.createElement('h3', 'bv-matrix-title', `${model.heading}${unit ? ` (${unit})` : ''}`)
    );
    const scroll = kit.createElement('div', 'bv-matrix-scroll');
    const grid = kit.createElement('div', 'bv-matrix-grid');
    grid.dataset.view = view;
    grid.setAttribute('role', 'group');
    grid.setAttribute(
      'aria-label',
      `Correlation matrix: ${model.heading}, ${variables.length} variables`
    );
    grid.style.setProperty('--bv-n', String(variables.length));
    grid.append(kit.createElement('span', 'bv-corner'));
    variables.forEach((column) => {
      const head = kit.createElement('span', 'bv-col-head', column.label);
      head.title = column.label;
      grid.append(head);
    });
    if (!this.focusAt || this.focusAt.some((at) => at >= variables.length)) this.focusAt = [0, 1];
    cellsOf(variables).forEach((row, i) => {
      const head = kit.createElement('span', 'bv-row-head', variables[i].label);
      head.title = variables[i].label;
      grid.append(head);
      row.forEach((cell) => {
        if (cell.side === 'diagonal') {
          const same = kit.createElement('span', 'bv-diagonal');
          same.dataset.row = String(i);
          grid.append(same);
          return;
        }
        const button = kit.createElement('button', 'bv-cell');
        button.type = 'button';
        button.dataset.row = String(cell.row);
        button.dataset.column = String(cell.column);
        button.dataset.side = cell.side;
        button.dataset.status = 'empty';
        button.tabIndex = cell.row === this.focusAt[0] && cell.column === this.focusAt[1] ? 0 : -1;
        button.onclick = () => this.openCell(cell.row, cell.column);
        button.onkeydown = (event) => this.onCellKey(event, cell.row, cell.column);
        // Under the grid: what the cell holds, while the pointer or the
        // keyboard is on it.
        const say = () => {
          this.footnote.textContent = button.getAttribute('aria-label');
        };
        const hint = () => {
          this.footnote.textContent = HINT;
        };
        button.onfocus = () => {
          this.focusAt = [cell.row, cell.column];
          say();
        };
        button.onmouseenter = say;
        button.onmouseleave = hint;
        button.onblur = hint;
        grid.append(button);
      });
    });
    scroll.append(grid);
    this.gridWrap.append(scroll, this.key(view));
    this.grid = grid;
    this.fillGrid();
    this.fit();
  }

  // The cell for a pair: its row and its column, counted from nought.
  cellAt(row, column) {
    return this.grid
      ? this.grid.querySelector(`.bv-cell[data-row="${row}"][data-column="${column}"]`)
      : null;
  }

  // Puts R's answer in the cells: above the diagonal the number, below it the
  // mark; in a cell R computed nothing for, a dash, and R's reason in its name.
  // Before R has answered, and with no R, every cell is empty and still opens
  // its pair.
  fillGrid() {
    if (!this.grid || !this.model) return;
    const { kit, model, state } = this;
    const { variables } = model;
    const name = COEFFICIENT_NAMES[state.method];
    const scatters = this.grid.dataset.view === 'scatters';
    this.destroyCharts();
    this.grid.querySelectorAll('.bv-cell').forEach((button) => {
      const row = variables[Number(button.dataset.row)];
      const column = variables[Number(button.dataset.column)];
      const pair = this.pairs ? this.pairs.get(pairKey(row.name, column.name)) : null;
      const labels = { row: row.label, column: column.label };
      button.innerHTML = '';
      button.dataset.status = pair ? pair.formatted.status : 'empty';
      const said = `${cellText(pair, labels, name)} Open the scatter.`;
      button.setAttribute('aria-label', said);
      button.title = said;
      const mini = scatters && button.dataset.side === 'mark';
      if (mini) {
        // A small scatter of the pair: the participants who have both values.
        const wrap = kit.createElement('span', 'bv-mini');
        const canvas = document.createElement('canvas');
        wrap.append(canvas);
        button.append(wrap);
        this.charts.push(this.miniScatter(canvas, pointsOf(model.records, column, row)));
        return;
      }
      if (!pair) return;
      if (pair.formatted.status !== 'shown' || pair.estimate === null) {
        const none = kit.createElement('span', 'bv-none', '–');
        none.setAttribute('aria-hidden', 'true');
        button.append(none);
        return;
      }
      // The number, and the mark: each is R's coefficient, shown.
      button.append(kit.createElement('span', 'bv-num', numberOf(pair.estimate)));
      button.append(this.mark(pair.estimate));
    });
    // On the diagonal: how many participants have that variable, as R counted them.
    const answer = this.asked[0] && this.asked[0].answer;
    const counts = answer && answer.value && answer.value.counts;
    this.grid.querySelectorAll('.bv-diagonal').forEach((same) => {
      const variable = variables[Number(same.dataset.row)];
      const n = counts && typeof counts === 'object' ? counts[variable.name] : undefined;
      same.title = Number.isInteger(n)
        ? `${variable.label}: ${n} participant${n === 1 ? ' has' : 's have'} a value.`
        : variable.label;
    });
  }

  mark(estimate) {
    const { sign, size, color } = markOf(estimate);
    const mark = this.kit.createElement('span', 'bv-mark');
    mark.dataset.sign = sign;
    mark.style.setProperty('--bv-size', `${size}%`);
    mark.style.setProperty('--bv-color', color);
    return mark;
  }

  // A pair as points, with no axes and nothing that answers the pointer: the
  // cell it is in is what is clicked.
  miniScatter(canvas, points) {
    return new this.kit.Chart(canvas.getContext('2d'), {
      type: 'scatter',
      data: {
        datasets: [
          {
            data: points,
            pointRadius: 1.5,
            backgroundColor: 'rgba(37, 99, 235, 0.55)',
            borderWidth: 0
          }
        ]
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        responsive: true,
        events: [],
        layout: { padding: 5 },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } }
      }
    });
  }

  // What a mark means: its width and its darkness are the coefficient's size,
  // its colour and its shape the sign.
  key(view) {
    const { kit } = this;
    const key = kit.createElement('div', 'bv-key');
    key.setAttribute('role', 'note');
    if (view === 'scatters') {
      key.append(
        kit.createElement(
          'p',
          null,
          'Below the diagonal a pair is its points: one for each participant who has both ' +
            'values, the column’s variable along the bottom and the row’s up the side, each ' +
            'pair on its own axes. Above it is R’s coefficient, to two decimals. A hatched ' +
            'cell has too few complete pairs for a coefficient.'
        )
      );
      return key;
    }
    [-1, -0.5, 0, 0.5, 1].forEach((value) => {
      const item = kit.createElement('span', 'bv-key-item');
      const box = kit.createElement('span', 'bv-key-mark');
      box.append(this.mark(value));
      item.append(box, document.createTextNode(numberOf(value)));
      key.append(item);
    });
    key.append(
      kit.createElement(
        'p',
        null,
        'Below the diagonal a pair is a mark: the wider and the darker, the stronger the ' +
          'coefficient; a filled blue disc is positive and an orange ring negative. Above it ' +
          'is the coefficient itself, to two decimals, where a cell is wide enough to hold it; ' +
          'where it is not, both sides are marks and the numbers are in the list beneath. ' +
          'A hatched cell has too few complete pairs for a coefficient.'
      )
    );
    return key;
  }

  // Fits the cells to the room there is. A cell too narrow for a number shows
  // its mark on both sides of the diagonal, and the numbers are in the list
  // beneath.
  fit() {
    if (!this.grid || !this.model || this.gridWrap.hidden) return;
    const narrow = this.root.clientWidth < 600;
    const label = narrow ? 84 : 150;
    const count = this.model.variables.length;
    const scatters = this.grid.dataset.view === 'scatters';
    this.grid.style.setProperty('--bv-label', `${label}px`);
    // The labels down the side take what their longest needs, up to the budget.
    const heads = [...this.grid.querySelectorAll('.bv-row-head')];
    const widest = Math.min(
      label,
      Math.ceil(Math.max(0, ...heads.map((head) => head.scrollWidth)))
    );
    // The room the cells have between them: the grid's own width, less the
    // labels down the side and the gaps, which close up where cells hold marks.
    const sizeWith = (gap) =>
      cellSize(
        this.grid.parentElement.clientWidth - widest - gap * count - 2,
        count,
        scatters ? 150 : 72
      );
    let size = sizeWith(2);
    const compact = !scatters && size < NUMBERS_FROM;
    if (compact) size = sizeWith(1);
    this.grid.style.setProperty('--bv-cell', `${size}px`);
    this.grid.classList.toggle('bv-compact', compact);
    this.charts.forEach((chart) => chart.resize());
  }

  // The arrow keys move among the cells; Enter and Space open one, as they
  // press any button.
  onCellKey(event, row, column) {
    const steps = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const count = this.model.variables.length;
    let [i, j] = [row + step[0], column + step[1]];
    // The diagonal holds no pair: step over it.
    if (i === j) [i, j] = [i + step[0], j + step[1]];
    if (i < 0 || j < 0 || i >= count || j >= count) return;
    const from = this.cellAt(row, column);
    const to = this.cellAt(i, j);
    if (!to) return;
    from.tabIndex = -1;
    to.tabIndex = 0;
    to.focus();
  }

  // Under the grid: every pair R returned, in R's order, with its count and its
  // coefficient; the list a narrow screen reads the numbers from.
  listPairs() {
    const { kit, model, state } = this;
    this.listingWrap.innerHTML = '';
    if (!this.pairs || !this.pairs.size) return;
    const name = COEFFICIENT_NAMES[state.method];
    const byName = new Map(model.variables.map((entry, index) => [entry.name, index]));
    const pairs = [...this.pairs.values()].sort((a, b) => a.order - b.order);
    const levels = [
      ...new Set(pairs.map((pair) => pair.formatted.level).filter((level) => level !== null))
    ];
    const head = levels.length === 1 ? `${name} (${levels[0]} confidence interval)` : name;
    const rows = pairs.map((pair) => {
      const [x, y] = [byName.get(pair.x), byName.get(pair.y)];
      const { formatted } = pair;
      const within =
        formatted.bounds && levels.length === 1
          ? ` (${formatted.bounds})`
          : formatted.interval
            ? ` (${formatted.interval})`
            : '';
      return {
        x,
        y,
        status: formatted.status,
        pair: `${model.variables[x].label} and ${model.variables[y].label}`,
        n: formatted.n === null ? '' : String(formatted.n),
        // A pair with no coefficient says why in its place, in R's words; its
        // count is in the column beside it.
        coefficient:
          formatted.status === 'shown'
            ? `${formatted.estimate}${within}`
            : pair.reason || formatted.text,
        warning: pair.warning
      };
    });

    // What R warned of a pair is said once under the table, and marked on each
    // pair it was said of.
    const warnings = [...new Set(rows.map((row) => row.warning).filter(Boolean))];
    const markOfWarning = (warning) => String(warnings.indexOf(warning) + 1);
    const columns = [
      { value_col: 'pair', label: 'Pair' },
      { value_col: 'n', label: 'Complete pairs' },
      { value_col: 'coefficient', label: head },
      ...(warnings.length ? [{ value_col: 'warning', label: 'R’s warning' }] : [])
    ];

    const details = document.createElement('details');
    details.className = 'bv-pairs';
    details.open = true;
    details.append(
      kit.createElement(
        'summary',
        null,
        `Every pair, with its count: ${rows.length}, in the order R returned them`
      )
    );
    // A control: left out of the chart's picture (#70 review).
    const tools = kit.createElement('div', 'bv-pairs-tools bv-no-picture');
    const download = kit.createElement('button', null, 'Download: CSV');
    download.type = 'button';
    download.onclick = () =>
      downloadCsv(
        kit,
        rows.map((row) => ({ ...row, warning: row.warning || '' })),
        columns,
        'bio.viz-correlation-matrix-pairs.csv'
      );
    tools.append(download);
    const table = document.createElement('table');
    const header = document.createElement('tr');
    ['Pair', 'Complete pairs', head].forEach((title) => {
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
      const lead = document.createElement('th');
      lead.scope = 'row';
      const open = kit.createElement('button', 'bv-pair', row.pair);
      open.type = 'button';
      open.setAttribute('aria-label', `${row.pair}: open the scatter`);
      // The pair as its cell below the diagonal has it: the later variable up the side.
      open.onclick = () => this.openCell(Math.max(row.x, row.y), Math.min(row.x, row.y));
      lead.append(open);
      const value = kit.createElement('td', null, row.coefficient);
      if (row.warning) {
        const mark = kit.createElement('sup', 'bv-pair-warned', markOfWarning(row.warning));
        mark.title = `R warned: ${row.warning}`;
        value.append(' ', mark);
      }
      line.append(lead, kit.createElement('td', null, row.n), value);
      tbody.append(line);
    });
    table.append(thead, tbody);
    details.append(tools, table);
    warnings.forEach((warning) => {
      const note = kit.createElement('p', 'bv-pairs-note');
      note.append(
        kit.createElement('sup', null, markOfWarning(warning)),
        ` R warned, of each pair marked: ${warning}`
      );
      details.append(note);
    });
    this.listingWrap.append(details);
  }

  /**
   * What the controls now read, as the settings the chart would open on with
   * them: the part of its specification the controls hold (#68).
   * @returns {object}
   */
  viewSettings() {
    const { state } = this;
    return {
      mode: state.mode,
      visit: state.visit,
      biomarkers: state.biomarkers ? [...state.biomarkers] : null,
      measure: state.measure,
      visits: state.visits ? [...state.visits] : null,
      value_type: state.valueType,
      view: state.view,
      method: state.method,
      min_pairs: state.minPairs
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
    const { model, settings } = this;
    if (!model || !model.records || !model.variables) return { columns: [], rows: [] };
    return {
      columns: [
        { value_col: settings.id_col, label: 'Participant' },
        ...model.variables.map((variable) => ({ value_col: variable.name, label: variable.label }))
      ],
      rows: model.records
    };
  }

  /** The placeholders a download's file name is made of, after the chart's name. */
  get viewFields() {
    return ['heading'];
  }

  /**
   * What the title, subtitle and footnotes' placeholders hold for the view now
   * drawn, beside `{date}`, `{version}` and `{filters}` (#66).
   * @returns {object}
   */
  placeholders() {
    const { state, model } = this;
    return {
      heading: model && model.heading ? model.heading : '',
      variables: model && model.variables ? model.variables.length : '',
      visit: state.visit ?? '',
      value: VALUE_LABELS[state.valueType] || state.valueType || '',
      n: model && model.records ? model.records.length : ''
    };
  }

  /** What R's counts are of, for the footnote the chart writes. */
  get footnoteCounts() {
    return 'variables';
  }

  /**
   * What the chart has asked R for the grid now drawn, and what R answered: one
   * entry, or none when nothing is drawn. The request is exactly what the
   * connection was given, so it is the key a stored result must carry to be
   * found.
   * @returns {Array<{name: string, args: object, dataId: object, rows: number,
   *   answer: ?object}>} `answer` is what the connection resolved to, or null
   *   while R has not answered.
   */
  statistics() {
    return structuredClone(this.asked);
  }

  // ---- A cell opens the association scatter --------------------------------------

  // The pair of a cell, by its row and column: the column's variable goes on
  // the scatter's x axis and the row's on its y axis.
  openCell(row, column) {
    const { variables } = this.model;
    return this.openPair(variables[column], variables[row], [row, column]);
  }

  /**
   * Open the association scatter for a pair of the grid's variables, in place
   * of the grid, as a click on their cell does. The scatter is given the same
   * connection, method and filters, and a way back.
   * @param {string} x The variable for the scatter's x axis, by its label in the
   *   grid: a biomarker's name, or a visit's.
   * @param {string} y The variable for its y axis, the same way.
   * @returns {object} The association scatter that was opened.
   */
  open(x, y) {
    const variables = this.model ? this.model.variables : [];
    const find = (label) => variables.findIndex((entry) => entry.label === String(label));
    const [column, row] = [find(x), find(y)];
    if (column < 0 || row < 0 || column === row) {
      throw new TypeError(
        'bio.viz: open() takes two different variables of the grid, each by its label: ' +
          `${variables.map((entry) => entry.label).join(', ')}.`
      );
    }
    return this.openCell(row, column);
  }

  openPair(x, y, cell) {
    this.close();
    const { settings, state, kit } = this;
    const holder = kit.createElement('div', 'bv-matrix-drill');
    this.root.classList.add('sv-hidden');
    this.element.append(holder);
    const chart = associationScatter(holder, {
      ...coreSettings(settings),
      unit_col: settings.unit_col,
      measures: settings.measures,
      max_levels: settings.max_levels,
      // What the page set for the scatter: its groups, its numbers, its profile.
      ...(settings.scatter || {}),
      // What the grid carries across: the pair, the method, the connection,
      // what the filters are set to, and the way back.
      x: settingOf(x.axis),
      y: settingOf(y.axis),
      method: state.method,
      connection: this.connection,
      waiting_note: settings.waiting_note,
      filters: this.filterSpecs.map((spec) => ({
        ...spec,
        start: state.filters[spec.value_col],
        all: true
      })),
      back: { label: BACK, action: () => this.close() }
    }).init(this.tables);
    this.opened = { chart, holder, cell };
    const back = holder.querySelector('.bv-back');
    if (back) back.focus();
    return chart;
  }

  /**
   * Close the scatter a cell opened and show the grid again, as it was: nothing
   * is drawn again and R is not asked again. With no scatter open it does
   * nothing.
   * @returns {CorrelationMatrix} The chart, for chaining.
   */
  close() {
    if (!this.opened) return this;
    const { chart, holder, cell } = this.opened;
    this.opened = null;
    chart.destroy();
    holder.remove();
    this.root.classList.remove('sv-hidden');
    this.fit();
    // The keyboard's place goes back to the cell that was opened.
    const from = this.cellAt(cell[0], cell[1]);
    if (from) {
      this.grid.querySelectorAll('.bv-cell[tabindex="0"]').forEach((other) => {
        other.tabIndex = -1;
      });
      from.tabIndex = 0;
      from.focus();
    }
    return this;
  }

  /**
   * The association scatter a cell has opened, or null when the grid is shown.
   * @returns {?object} The scatter: its own methods are the association scatter's.
   */
  scatter() {
    return this.opened ? this.opened.chart : null;
  }

  // ---- Lifecycle --------------------------------------------------------------

  /**
   * Fit the grid to its container, for a page that changes the container's
   * size without resizing the window.
   * @returns {void}
   */
  resize() {
    if (this.opened) this.opened.chart.resize();
    else this.fit();
  }

  destroyCharts() {
    this.charts.forEach((chart) => chart.destroy());
    this.charts = [];
  }

  /**
   * Take the chart down: the grid, a scatter a cell had opened, and everything
   * in its element. A destroyed chart cannot be used again; make a new one.
   * @returns {void}
   */
  destroy() {
    // Any answer still on its way from R is for a chart that is gone.
    this.desk.begin();
    if (this.opened) {
      this.opened.chart.destroy();
      this.opened = null;
    }
    this.destroyCharts();
    globalThis.removeEventListener('resize', this.onResize);
    this.element.innerHTML = '';
  }
}

/**
 * Make a correlation matrix in an element. The controls are drawn at once; give
 * the tables to `init` on the chart that is returned.
 *
 * @param {string|HTMLElement} element The element, or a CSS selector for it.
 * @param {object} [settings] Settings to lay over the defaults.
 * @returns {CorrelationMatrix} The chart: `init`, `setData`, `setSettings`,
 *   `render`, `resize`, `destroy`, `statistics`, `open`, `close`, `scatter`.
 */
export function correlationMatrix(element, settings) {
  return new CorrelationMatrix(element, settings);
}
