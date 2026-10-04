// The biomarker screen: one row per biomarker for a comparison chosen once, with
// R's estimate and its interval on one shared axis and R's p-values beside it,
// unadjusted and adjusted across the rows; and the way into the single charts.
//
//   BioViz.biomarkerScreen('#chart', {}).init({ results, participants, outcomes });
//
// The comparison is a standardised difference between two groups, a
// correlation with one fixed variable, or, with an outcomes table, a hazard
// ratio for high against low on an endpoint, each biomarker cut at its median.
// A row opens the matching single chart for its biomarker, in place, with a way
// back: the group comparison for a difference, the association scatter for a
// correlation, the stratified survival chart for a hazard ratio.
//
// The lifecycle is safety.viz's (init, setData, setSettings, render, resize,
// destroy), and the chart is built as the other three are: from safety.viz's
// kit, found on the page when a chart is made, with its frame from the core and
// the parts every chart shares from src/shared/.
//
// The chart computes no estimate, interval, p-value or adjustment: it hands R
// the frame through the connection, once per screen, and draws and prints what
// comes back. It orders the rows by numbers R returned, or by name.

import { associationScatter } from './association-scatter.js';
import { groupComparison } from './group-comparison.js';
import { stratifiedSurvival } from './stratified-survival.js';
import { createConnection } from './r/connection.js';
import { UNUSED } from './core/reasons.js';
import { VALUE_TYPES } from './core/variable.js';
import {
  ADJUSTMENTS,
  COMPARISONS,
  METHODS,
  SORTS,
  syncSettings
} from './biomarker-screen/configure.js';
import {
  ADJUSTMENT_LABELS,
  COMPARISON_LABELS,
  ESTIMATE_NAMES,
  HAZARD_GROUPS,
  METHOD_LABELS,
  createStatisticDesk,
  scopeText,
  screenRequest
} from './biomarker-screen/statistic.js';
import {
  SORT_LABELS,
  axisRange,
  buildScreen,
  groupsOf,
  placeOf,
  sortRows,
  variableName
} from './biomarker-screen/structureData.js';
import {
  VALUE_LABELS,
  addFilterControls,
  shown,
  downloadCsv,
  filtersForScope,
  findKit,
  lineStyles,
  mountShell,
  readGiven,
  readOutcomesGiven,
  renderPager,
  writeStatistic,
  drawSafely,
  checkTables
} from './shared/chartHost.js';
import { OUTCOME_DEFAULTS, checkOutcomes, listEndpoints } from './shared/outcomes.js';
import { pageCount, pageOf } from './shared/paging.js';
import { coreSettings } from './shared/settings.js';
import {
  NOBODY_PASSES,
  categoryColumns,
  columnLevels,
  filterColumns,
  listMeasures,
  listVisits,
  numberColumns
} from './shared/tables.js';
import { axisOf, settingOf } from './shared/variables.js';

const MODULE_CLASS = 'bv-biomarker-screen';
const STYLE_ID = 'bio-viz-biomarker-screen-styles';
const C = `.${MODULE_CLASS}`;
const STYLES = `${lineStyles(C)}
${C} .bv-screen{margin:0 0 .6rem;border:1px solid #d8dee4;border-radius:10px;background:#fff;padding:.8rem}
${C} .bv-screen-title{margin:0 0 .3rem;font-size:.92rem;font-weight:600;color:#1f2933}
${C} .bv-screen-caption{margin:0 0 .6rem;font-size:.8rem;color:#52616f}
${C} .bv-screen-names{margin:.2rem 0 0;font-size:.85rem;color:#52616f}
${C} .bv-screen-head,${C} .bv-screen-row{display:grid;grid-template-columns:minmax(5.5rem,9rem) minmax(8rem,1fr) 11.8rem 5.4rem 5.8rem 5.6rem;align-items:center;gap:0 .6rem}
${C} .bv-screen-head{font-size:.75rem;font-weight:600;color:#52616f;border-bottom:2px solid #d8dee4;padding:0 .4rem .3rem}
${C} .bv-screen-row{appearance:none;width:100%;margin:0;border:0;border-bottom:1px solid #e3e8ee;background:#fff;padding:.35rem .4rem;font:inherit;font-size:.85rem;color:#1f2933;text-align:left;cursor:pointer;font-variant-numeric:tabular-nums}
${C} .bv-screen-row:hover{background:#f4f8fc}
${C} .bv-screen-row:focus-visible{outline:2px solid #0b62a4;outline-offset:-2px}
${C} .bv-screen-name{font-weight:600;overflow-wrap:anywhere}
${C} .bv-track{position:relative;height:1.3rem}
${C} .bv-ticks{position:relative;height:1rem}
${C} .bv-tick{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
${C} .bv-zero{position:absolute;top:0;bottom:0;width:0;border-left:1px dashed #7b8794}
${C} .bv-interval{position:absolute;top:50%;height:2px;margin-top:-1px;background:#0b62a4}
${C} .bv-estimate{position:absolute;top:50%;width:.6rem;height:.6rem;margin:-.3rem 0 0 -.3rem;border-radius:50%;background:#0b62a4}
${C} .bv-screen-row[data-status=withheld] .bv-screen-value,${C} .bv-screen-row[data-status=error] .bv-screen-value,${C} .bv-screen-row[data-status=refused] .bv-screen-value{grid-column:3 / span 4;color:#52616f}
${C} .bv-screen-tools{margin:.6rem 0 0}
${C} .bv-screen-tools button,${C} .bv-overview-pager button{font:inherit;font-size:.8rem;padding:.3rem .6rem;border:1px solid #d8dee4;border-radius:6px;background:#fff;color:#1f2933;cursor:pointer}
${C} .bv-overview-pager button:disabled{color:#9aa5b1;cursor:default}
${C} .bv-overview-pager{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem .7rem;margin:0 0 .6rem;font-size:.85rem;color:#1f2933}
${C} .bv-control-note{display:block;margin:.2rem 0 0;font-size:.75rem;color:#52616f}
${C} .bv-narrow{display:none}
@media (max-width:600px){
${C} .bv-narrow{display:inline;color:#52616f}
${C} .bv-screen{padding:.5rem}
${C} .bv-screen-head{grid-template-columns:1fr;padding:0 .2rem .3rem}
${C} .bv-screen-head > :not(.bv-ticks){display:none}
${C} .bv-screen-row{grid-template-columns:1fr;gap:.15rem .6rem;padding:.45rem .2rem}
${C} .bv-screen-row[data-status] .bv-screen-value{grid-column:auto}
${C} .bv-screen-row .bv-screen-p,${C} .bv-screen-row .bv-screen-n{font-size:.8rem}
${C}.sv-collapsed .sv-sidebar-title{display:inline}
${C}.sv-collapsed .sv-sidebar{padding:.5rem .9rem}
}`;

const BACK = 'Back to the biomarker screen';
/** What the Compare control says when there is no outcomes table to compare on. */
export const NO_OUTCOMES =
  'A hazard ratio needs an outcomes table: give `outcomes`, one row per participant and ' +
  'endpoint, with a time and a flag, as `init({ results, participants, outcomes })`.';
const HAZARD_NOTE =
  'Each biomarker is cut at its median, as R’s Analyze_Screen cuts it, a value on the median ' +
  'low: the hazard ratio is the high group’s hazard over the low group’s.';
const HINT =
  'Click a row, or press Enter on it, to open that biomarker in its own chart. The estimates ' +
  'share one axis without units, with nought marked.';
const COLUMN = 'c:';
const MEASURE = 'm:';

/**
 * The live chart. Made by `biomarkerScreen()`, not directly.
 */
class BiomarkerScreen {
  constructor(element, settings) {
    this.kit = findKit('the biomarker screen');
    this.element = typeof element === 'string' ? document.querySelector(element) : element;
    if (!this.element) throw new Error(`bio.viz: biomarker screen target not found: ${element}`);
    this.settings = syncSettings(settings);
    this.tables = { results: [], participants: null, outcomes: null };
    this.model = null;
    this.endpoints = [];
    this.measures = [];
    this.visits = [];
    this.categories = [];
    this.numbers = [];
    this.filterSpecs = [];
    this.state = {};
    this.asked = [];
    this.answer = null;
    this.drilled = null;
    this.connect();
    this.renderShell();
  }

  // The connection the screen asks: the one given in settings, or one with no R
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
      listingFile: 'bio.viz-biomarker-screen-rows.csv'
    });
    // The rows are drawn as elements, each a button: the shell's canvas is not used.
    this.chartWrap.classList.add('sv-hidden');
    this.screenWrap = kit.createElement('div', 'bv-screen');
    this.screenWrap.hidden = true;
    this.chartWrap.after(this.screenWrap);
  }

  /**
   * Load the tables and draw: the same as `setData`.
   * @param {{results: object[], participants?: object[]}} data The tables.
   * @returns {BiomarkerScreen} The chart, for chaining.
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
   * @returns {BiomarkerScreen} The chart, for chaining.
   */
  setData(data, settings) {
    this.close();
    const given = Array.isArray(data) ? { results: data } : data || {};
    if (settings === undefined || settings === null) {
      this.tables = {
        ...readGiven(this, given),
        outcomes: readOutcomesGiven(this, given.outcomes, this.settings)
      };
    } else {
      // The tables and the settings that read them change together: the
      // tables are checked against the new settings, which are then laid over.
      const next = syncSettings({ ...this.settings, ...settings });
      this.tables = {
        ...readGiven(this, given, next),
        outcomes: readOutcomesGiven(this, given.outcomes, next)
      };
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
   * what the chart opens on (`comparison`, `visit`, `value_type`, `group_by`,
   * `levels`, `with`, `method`, `adjustment`, `sort`, `filters`) moves its
   * control. A chart a row had opened is closed.
   * @param {object} settings The settings to change.
   * @returns {BiomarkerScreen} The chart, for chaining.
   */
  setSettings(settings) {
    const given = settings || {};
    const next = syncSettings({ ...this.settings, ...given });
    // The tables must still have the columns the new settings name; if not, the
    // settings are refused and nothing changes, a chart opened in place included.
    checkTables(this.tables, next);
    if (this.tables.outcomes) checkOutcomes(this.tables.outcomes, next);
    this.close();
    this.settings = next;
    if ('connection' in given || 'waiting_note' in given) this.connect();
    this.readTables();
    const opening = this.seedState();
    const moved = {
      comparison: ['comparison'],
      visit: ['visit'],
      value_type: ['valueType'],
      group_by: ['groupBy', 'levels'],
      levels: ['levels'],
      with: ['with'],
      method: ['method'],
      endpoint: ['endpoint'],
      adjustment: ['adjustment'],
      sort: ['sort', 'page'],
      filters: ['filters']
    };
    for (const [setting, keys] of Object.entries(moved)) {
      if (setting in given) keys.forEach((key) => (this.state[key] = opening[key]));
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
    this.numbers = results.length ? numberColumns(this.tables, settings) : [];
    this.filterSpecs = filterColumns(this.tables, settings, this.categories).map((spec) =>
      this.kit.normalizeFilterSpec(spec)
    );
    this.endpoints = this.tables.outcomes ? listEndpoints(this.tables.outcomes, settings) : [];
    if (
      this.tables.outcomes &&
      settings.endpoint !== null &&
      !this.endpoints.some((entry) => entry.endpoint === settings.endpoint)
    ) {
      console.warn(
        `The initial endpoint [${settings.endpoint}] does not exist. Defaulting to the first.`
      );
    }
    if (results.length && settings.visit !== null && !this.visits.includes(settings.visit)) {
      console.warn(
        `The initial visit [${settings.visit}] does not exist. Defaulting to the first.`
      );
    }
  }

  offered() {
    return { measures: this.measures, visits: this.visits, endpoints: this.endpoints };
  }

  // The comparisons the Compare control offers: a hazard ratio only with an
  // outcomes table to compare on.
  comparisons() {
    return COMPARISONS.filter((entry) => entry !== 'hazard' || this.endpoints.length);
  }

  // The columns of groups a difference can compare: the category columns with
  // two groups or more.
  groupColumns() {
    return this.categories.filter((spec) => columnLevels(this.tables, spec.value_col).length >= 2);
  }

  // Whether the tables have a variable to correlate with.
  hasVariable(axis) {
    if (!axis) return false;
    if (axis.kind === 'column') return this.numbers.some((spec) => spec.value_col === axis.col);
    return (
      this.measures.includes(axis.measure) &&
      (axis.value === 'baseline' || this.visits.includes(axis.visit))
    );
  }

  // What the chart opens on: the settings, where the tables have what they name.
  seedState() {
    const { settings, visits } = this;
    const columns = this.groupColumns().map((spec) => spec.value_col);
    const groupBy = columns.includes(settings.group_by) ? settings.group_by : (columns[0] ?? null);
    const given = settings.with ? axisOf(settings.with) : null;
    const fallback = this.numbers.length
      ? axisOf({ col: this.numbers[0].value_col })
      : this.measures.length && visits.length
        ? axisOf({ measure: this.measures[0], value: 'raw', visit: visits[0] })
        : null;
    const endpoint = this.endpoints.some((entry) => entry.endpoint === settings.endpoint)
      ? settings.endpoint
      : this.endpoints[0]
        ? this.endpoints[0].endpoint
        : null;
    return {
      comparison: this.comparisons().includes(settings.comparison)
        ? settings.comparison
        : 'difference',
      endpoint,
      visit: visits.includes(settings.visit) ? settings.visit : (visits[0] ?? null),
      valueType: settings.value_type,
      groupBy,
      levels: groupsOf(this.tables, groupBy, settings.levels).levels,
      with: this.hasVariable(given) ? given : fallback,
      method: settings.method,
      adjustment: settings.adjustment,
      sort: settings.sort,
      page: 0,
      filters: this.kit.initFilterState(this.filterSpecs)
    };
  }

  // After the tables or the settings change, a control may hold something that
  // is no longer offered; it returns to what the chart opens on.
  repairState(opening) {
    const { state } = this;
    if (!this.visits.includes(state.visit)) state.visit = opening.visit;
    const columns = this.groupColumns().map((spec) => spec.value_col);
    if (!columns.includes(state.groupBy)) state.groupBy = opening.groupBy;
    state.levels = groupsOf(this.tables, state.groupBy, state.levels).levels;
    if (!this.hasVariable(state.with)) state.with = opening.with;
    if (!this.comparisons().includes(state.comparison)) state.comparison = 'difference';
    if (!this.endpoints.some((entry) => entry.endpoint === state.endpoint)) {
      state.endpoint = opening.endpoint;
    }
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

    const screen = addSection('Screen');
    select(
      'comparison',
      'Compare',
      this.comparisons().map((entry) => [entry, COMPARISON_LABELS[entry]]),
      state.comparison,
      (next) => {
        state.comparison = next;
        // The controls beneath are the comparison's own.
        redraw(true);
      },
      screen
    );
    // Without an outcomes table there is no hazard ratio to offer, and the
    // screen says why.
    if (!this.endpoints.length) {
      screen.append(kit.createElement('small', 'bv-control-note bv-no-outcomes', NO_OUTCOMES));
    }
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
      screen
    );
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
        screen
      );
    }

    if (state.comparison === 'difference') {
      const columns = this.groupColumns();
      select(
        'group-by',
        'Group by',
        columns.map((spec) => [spec.value_col, spec.label]),
        state.groupBy,
        (next) => {
          state.groupBy = next;
          state.levels = groupsOf(this.tables, next, null).levels;
          redraw(true);
        },
        screen
      );
      const levels = state.groupBy ? columnLevels(this.tables, state.groupBy) : [];
      ['First group', 'Second group'].forEach((labelText, index) => {
        select(
          index === 0 ? 'first' : 'second',
          labelText,
          levels.map((level) => [level, level]),
          state.levels[index],
          (next) => {
            const other = 1 - index;
            // The same group twice is no difference: the two change places.
            if (state.levels[other] === next) state.levels[other] = state.levels[index];
            state.levels[index] = next;
            redraw(true);
          },
          screen
        );
      });
      screen.append(
        kit.createElement(
          'small',
          'bv-control-note',
          'The difference is the first group’s mean less the second’s, in pooled standard ' +
            'deviations: swap the groups to turn the axis round.'
        )
      );
    } else if (state.comparison === 'hazard') {
      select(
        'endpoint',
        'Endpoint',
        this.endpoints.map((entry) => [entry.endpoint, entry.label]),
        state.endpoint,
        (next) => {
          state.endpoint = next;
          redraw(true);
        },
        screen
      );
      screen.append(kit.createElement('small', 'bv-control-note', HAZARD_NOTE));
    } else {
      const options = [
        ...this.numbers.map((spec) => [`${COLUMN}${spec.value_col}`, spec.label]),
        ...this.measures.map((measure) => [`${MEASURE}${measure}`, measure])
      ];
      const current =
        state.with && state.with.kind === 'column'
          ? `${COLUMN}${state.with.col}`
          : state.with
            ? `${MEASURE}${state.with.measure}`
            : null;
      select(
        'with',
        'Correlate with',
        options,
        current,
        (next) => {
          state.with = next.startsWith(COLUMN)
            ? axisOf({ col: next.slice(COLUMN.length) })
            : axisOf({
                measure: next.slice(MEASURE.length),
                value: 'raw',
                visit:
                  state.with && state.with.kind === 'measure' && state.with.visit
                    ? state.with.visit
                    : state.visit
              });
          redraw(true);
        },
        screen
      );
      if (state.with && state.with.kind === 'measure') {
        select(
          'with-visit',
          'At visit',
          this.visits.map((visit) => [visit, visit]),
          state.with.visit,
          (next) => {
            state.with = axisOf({
              measure: state.with.measure,
              value: state.with.value,
              visit: next
            });
            redraw(false);
          },
          screen
        );
      }
      select(
        'method',
        'Method',
        METHODS.map((method) => [method, METHOD_LABELS[method]]),
        state.method,
        (next) => {
          state.method = next;
          redraw(false);
        },
        screen
      );
    }

    // What R is asked to adjust by, and the order the rows are shown in.
    if (this.settings.statistic) {
      const statistics = addSection('Statistics');
      select(
        'adjustment',
        'Adjustment',
        ADJUSTMENTS.map((entry) => [entry, ADJUSTMENT_LABELS[entry]]),
        state.adjustment,
        (next) => {
          state.adjustment = next;
          redraw(false);
        },
        statistics
      );
    }
    const display = addSection('Display');
    select(
      'sort',
      'Sort',
      SORTS.map((entry) => [entry, SORT_LABELS[entry]]),
      state.sort,
      (next) => {
        state.sort = next;
        state.page = 0;
        // The rows R returned, in another order: R is not asked again.
        this.drawRows();
      },
      display
    );

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
   * Draw everything again from the tables, the settings and the controls, and
   * ask R again. The rows, the line and the list are cleared first: nothing
   * stays on screen that describes rows the chart no longer holds. A chart a
   * row had opened is closed.
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
    this.answer = null;
    this.state.page = 0;
    this.notes.innerHTML = '';
    this.screenWrap.innerHTML = '';
    this.screenWrap.hidden = true;
    this.listingWrap.innerHTML = '';
    this.statLine.textContent = '';
    this.statLine.dataset.state = 'empty';
    this.model = null;

    const { kit, state, settings } = this;
    if (!this.tables.results.length || !this.measures.length) {
      this.footnote.textContent = 'No results to draw.';
      return;
    }
    const model = buildScreen(this.tables, settings, state, this.offered(), {
      filterMatches: kit.filterMatches
    });
    this.model = model;
    this.updateNotes(model);
    if (model.filtered === 0) {
      this.footnote.textContent = NOBODY_PASSES;
      return;
    }
    if (model.message) {
      this.footnote.textContent = model.message;
      return;
    }
    if (!model.records.length) {
      this.footnote.textContent = 'No participant has a value for any biomarker of this screen.';
      return;
    }
    // What R's methods are, and where they differ, R says in its own notes on
    // the statistics line.
    this.footnote.textContent = HINT;
    this.drawRows();
    if (!settings.statistic) return;

    const request = screenRequest({ name: settings.statistic, settings, state, model });
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
        writeStatistic(kit, this.statLine, description);
        // The rows are drawn only from R's own answer for the frame on screen.
        this.answer = description;
        this.drawRows();
      },
      {
        groups:
          state.comparison === 'difference'
            ? state.levels
            : state.comparison === 'hazard'
              ? [...HAZARD_GROUPS]
              : null,
        scope: scopeText({ n: model.records.length, filters: filtersForScope(this) })
      }
    );
  }

  // Above the screen: who is in the frame, and what was left out of it.
  updateNotes(model) {
    const { kit, state } = this;
    const add = (text, warning) =>
      this.notes.append(kit.createElement('span', warning ? 'sv-warning' : null, text));
    if (model.rows.length && model.participants) {
      add(`${model.records.length} of ${model.participants} participants in the frame.`);
      if (model.empty)
        add(`${model.empty} left out: no value for any biomarker of the screen.`, true);
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
    (model.outcomeGaps || []).forEach((entry) =>
      add(
        `${entry.n} with no outcome to use: ${entry.reason}. R leaves them out of every row.`,
        true
      )
    );
    if (model.left) add(model.left);
    if (model.baselineVisits && state.valueType !== 'raw') {
      add(`Baseline visit: ${model.baselineVisits.join(', ')}.`);
    }
  }

  // The estimate's name, as the axis and the caption call it.
  estimateName() {
    const { state } = this;
    if (state.comparison === 'hazard') {
      const endpoint = this.endpoints.find((entry) => entry.endpoint === state.endpoint);
      return `${ESTIMATE_NAMES.hazard}, on ${endpoint ? endpoint.label : state.endpoint}`;
    }
    return state.comparison === 'difference'
      ? `${ESTIMATE_NAMES.difference}, ${state.levels[0]} less ${state.levels[1]}`
      : `${ESTIMATE_NAMES.correlation[state.method]} with ${variableName(state.with)}`;
  }

  // The screen: its heading, and either the rows R returned, sorted and paged,
  // or, before R has answered and with no R, the biomarkers it is of.
  drawRows() {
    if (!this.model || this.model.message || !this.model.records.length) return;
    const { kit, model, state } = this;
    const wrap = this.screenWrap;
    wrap.innerHTML = '';
    wrap.hidden = false;
    this.listingWrap.innerHTML = '';
    wrap.append(kit.createElement('h3', 'bv-screen-title', model.heading));
    const rows = this.answer && this.answer.rows ? this.answer.rows : null;
    if (!rows) {
      wrap.append(
        kit.createElement(
          'p',
          'bv-screen-names',
          `${model.rows.length} biomarker${model.rows.length === 1 ? '' : 's'} to screen: ` +
            `${model.rows.map((row) => row.name).join(', ')}.`
        )
      );
      return;
    }

    const sorted = sortRows(rows, state.sort);
    const page = pageOf(sorted, this.settings.limit, state.page);
    state.page = page.page;
    const order = `by ${SORT_LABELS[state.sort].toLowerCase()}; ${this.settings.limit} to a page`;
    const pager = () =>
      renderPager(kit, page, pageCount(page, order), (to) => {
        state.page = to;
        this.drawRows();
        if (this.root.getBoundingClientRect().top < 0) this.root.scrollIntoView();
      });

    const range = axisRange(rows, state.comparison);
    const level = rows.map((row) => row.formatted.level).find((entry) => entry !== null) || null;
    const { over, adjustment } = this.answer;
    const method = rows.map((row) => row.formatted.method).find((entry) => entry !== null);
    wrap.append(
      kit.createElement(
        'p',
        'bv-screen-caption',
        `Each row: ${this.estimateName()}${level ? `, with its ${level} confidence interval` : ''}` +
          (range.log
            ? ' on one logarithmic axis, with 1, no difference, marked. '
            : ' on one axis without units. ') +
          (method
            ? `p: ${method}, unadjusted, and adjusted by ${adjustment} across the ${over} ` +
              `biomarker${over === 1 ? '' : 's'} with a p-value. Exploratory, adjusted (${adjustment}).`
            : '')
      )
    );
    wrap.append(pager());

    const head = kit.createElement('div', 'bv-screen-head');
    head.setAttribute('aria-hidden', 'true');
    const ticks = kit.createElement('div', 'bv-ticks');
    // A wide axis is labelled at every other tick, so the labels do not crowd.
    const every = range.ticks.length > 7 ? 2 : 1;
    range.ticks.forEach((tick, index) => {
      if (index % every !== 0 && index !== range.ticks.length - 1) return;
      const label = kit.createElement('span', 'bv-tick', shown(tick).replace('-', '−'));
      const at = placeOf(tick, range);
      label.style.left = `${at}%`;
      // The labels at the two ends stay inside the axis.
      if (at === 0) label.style.transform = 'none';
      if (at === 100) label.style.transform = 'translateX(-100%)';
      ticks.append(label);
    });
    head.append(
      kit.createElement('span', null, 'Biomarker'),
      ticks,
      kit.createElement('span', null, 'Estimate (interval)'),
      kit.createElement('span', null, 'p, unadjusted'),
      kit.createElement('span', null, `p, ${adjustment || 'adjusted'}`),
      kit.createElement('span', null, this.countsHeading())
    );
    wrap.append(head);

    const list = kit.createElement('div', 'bv-screen-rows');
    page.items.forEach((row) => list.append(this.rowOf(row, range)));
    wrap.append(list);

    const tools = kit.createElement('div', 'bv-screen-tools');
    const download = kit.createElement('button', null, 'Download: CSV');
    download.type = 'button';
    download.onclick = () => this.download(sorted);
    tools.append(download);
    wrap.append(tools);
  }

  // One row: a button that opens its biomarker. Its estimate and interval are
  // drawn where R's numbers put them on the shared axis.
  rowOf(row, range) {
    const { kit } = this;
    const { formatted } = row;
    const button = kit.createElement('button', 'bv-screen-row');
    button.type = 'button';
    button.dataset.biomarker = row.biomarker;
    button.dataset.status = formatted.status;
    const opens = {
      difference: 'the group comparison',
      correlation: 'the association scatter',
      hazard: 'the stratified survival chart'
    }[this.state.comparison];
    const outside = row.inAdjustment ? '' : ' Not in the adjustment.';
    button.setAttribute('aria-label', `${formatted.text}${outside} Open in ${opens}.`);
    button.onclick = () => this.openRow(row.biomarker);
    button.append(kit.createElement('span', 'bv-screen-name', row.biomarker));
    const track = kit.createElement('span', 'bv-track');
    const zero = kit.createElement('span', 'bv-zero');
    zero.style.left = `${placeOf(range.reference ?? 0, range)}%`;
    track.append(zero);
    if (formatted.status === 'shown' && row.estimate !== null) {
      if (row.lower !== null && row.upper !== null) {
        const line = kit.createElement('span', 'bv-interval');
        const [from, to] = [placeOf(row.lower, range), placeOf(row.upper, range)];
        line.style.left = `${from}%`;
        line.style.width = `${to - from}%`;
        track.append(line);
      }
      const mark = kit.createElement('span', 'bv-estimate');
      mark.style.left = `${placeOf(row.estimate, range)}%`;
      track.append(mark);
    }
    button.append(track);
    if (formatted.status === 'shown') {
      button.append(
        kit.createElement(
          'span',
          'bv-screen-value',
          `${formatted.estimate}${formatted.bounds ? ` (${formatted.bounds})` : ''}`
        ),
        this.labelled('bv-screen-p', 'Unadjusted: ', formatted.p),
        this.labelled(
          'bv-screen-p bv-screen-adjusted',
          `${formatted.adjustment}: `,
          formatted.adjusted
        ),
        this.labelled('bv-screen-n', `${this.countsHeading()}: `, this.countsOf(row))
      );
    } else {
      // R's reason, as R worded it, and no number; and that the row is outside
      // the adjustment, as R says.
      button.append(
        kit.createElement('span', 'bv-screen-value', `${row.reason || formatted.result}${outside}`)
      );
    }
    return button;
  }

  // A cell with its column's name before it, said where the columns are not
  // drawn: on a narrow screen, where a row stacks.
  labelled(className, label, value) {
    const cell = this.kit.createElement('span', className);
    cell.append(this.kit.createElement('span', 'bv-narrow', label), document.createTextNode(value));
    return cell;
  }

  // What the counts column holds: each group's, for a difference, or the one count.
  countsHeading() {
    const { state } = this;
    if (state.comparison === 'hazard') return `n, ${HAZARD_GROUPS.join(' / ')}`;
    return state.comparison === 'difference' && state.levels.length === 2
      ? `n, ${state.levels[0]} / ${state.levels[1]}`
      : 'n';
  }

  // A row's counts, as R gave them.
  countsOf(row) {
    if (this.state.comparison !== 'correlation' && row.groupCounts)
      return row.groupCounts.join(' / ');
    return row.n === null ? '' : String(row.n);
  }

  // Every row, in the order shown, as a CSV file.
  download(rows) {
    downloadCsv(
      this.kit,
      rows.map((row) => ({
        biomarker: row.biomarker,
        estimate: row.formatted.estimate ?? '',
        interval: row.formatted.bounds ?? '',
        p: row.formatted.p ?? '',
        adjusted: row.formatted.adjusted ?? '',
        n: this.countsOf(row),
        reason: row.formatted.status === 'shown' ? '' : row.reason || row.formatted.result
      })),
      // The headings hold no comma: the kit writes a heading as it is.
      [
        { value_col: 'biomarker', label: 'Biomarker' },
        { value_col: 'estimate', label: 'Estimate' },
        { value_col: 'interval', label: 'Confidence interval' },
        { value_col: 'p', label: 'p unadjusted' },
        { value_col: 'adjusted', label: `p adjusted (${this.answer.adjustment || 'none'})` },
        { value_col: 'n', label: this.countsHeading().replace(', ', ' ') },
        { value_col: 'reason', label: 'Not computed' }
      ],
      'bio.viz-biomarker-screen-rows.csv'
    );
  }

  /**
   * What the chart has asked R for the screen now drawn, and what R answered:
   * one entry, or none when nothing is drawn. The request is exactly what the
   * connection was given, so it is the key a stored result must carry to be
   * found.
   * @returns {Array<{name: string, args: object, dataId: object, rows: number,
   *   answer: ?object}>} `answer` is what the connection resolved to, or null
   *   while R has not answered.
   */
  statistics() {
    return structuredClone(this.asked);
  }

  // ---- A row opens a single chart -------------------------------------------------

  /**
   * Open a biomarker's single chart in place of the screen, as a click on its
   * row does: the group comparison for a difference, at the same visit, value,
   * groups and test; the association scatter for a correlation, against the
   * same variable with the same method; or the stratified survival chart for a
   * hazard ratio, the biomarker cut at its median on the same endpoint; with the
   * same connection and filters, and a way back.
   * @param {string} biomarker The biomarker, by its name.
   * @returns {object} The chart that was opened.
   */
  open(biomarker) {
    const rows = this.model ? this.model.rows : [];
    if (!rows.some((row) => row.name === String(biomarker))) {
      throw new TypeError(
        'bio.viz: open() takes a biomarker of the screen, by its name: ' +
          `${rows.map((row) => row.name).join(', ')}.`
      );
    }
    return this.openRow(String(biomarker));
  }

  openRow(biomarker) {
    this.close();
    const { settings, state, kit } = this;
    const row = this.model.rows.find((entry) => entry.name === biomarker);
    const holder = kit.createElement('div', 'bv-screen-drill');
    this.root.classList.add('sv-hidden');
    this.element.append(holder);
    const carried = {
      ...coreSettings(settings),
      unit_col: settings.unit_col,
      measures: settings.measures,
      max_levels: settings.max_levels,
      groups: settings.groups
    };
    const filters = this.filterSpecs.map((spec) => ({
      ...spec,
      start: state.filters[spec.value_col],
      all: true
    }));
    const common = {
      connection: this.connection,
      waiting_note: settings.waiting_note,
      filters,
      back: { label: BACK, action: () => this.close() }
    };
    const outcomes = Object.fromEntries(
      Object.keys(OUTCOME_DEFAULTS).map((key) => [key, settings[key]])
    );
    const chart =
      state.comparison === 'hazard'
        ? stratifiedSurvival(holder, {
            ...carried,
            ...outcomes,
            ...(settings.stratified_survival || {}),
            // What the screen carries across: the biomarker at its visit and
            // value, cut at its median, the endpoint, the connection and filters.
            group_by: {
              measure: biomarker,
              value: state.valueType,
              ...(state.valueType === 'baseline' ? {} : { visit: state.visit }),
              cut: 'median'
            },
            endpoint: state.endpoint,
            ...common
          }).init(this.tables)
        : state.comparison === 'difference'
          ? groupComparison(holder, {
              ...carried,
              ...(settings.group_comparison || {}),
              // What the screen carries across: the biomarker, its visit and
              // value, the two groups, Welch's test, the connection and filters.
              start_value: biomarker,
              visits: state.valueType === 'baseline' ? null : [state.visit],
              value_type: state.valueType,
              group_by: state.groupBy,
              levels: [...state.levels],
              test: 't',
              ...common
            }).init(this.tables)
          : associationScatter(holder, {
              ...carried,
              numbers: settings.numbers,
              ...(settings.association_scatter || {}),
              // The biomarker along the bottom and the variable up the side, with
              // the same coefficient.
              x: settingOf(row.axis),
              y: settingOf(state.with),
              method: state.method,
              ...common
            }).init(this.tables);
    this.drilled = { chart, holder, biomarker };
    const back = holder.querySelector('.bv-back');
    if (back) back.focus();
    return chart;
  }

  /**
   * Close the chart a row opened and show the screen again, as it was: nothing
   * is drawn again and R is not asked again. With none open it does nothing.
   * @returns {BiomarkerScreen} The chart, for chaining.
   */
  close() {
    if (!this.drilled) return this;
    const { chart, holder, biomarker } = this.drilled;
    this.drilled = null;
    chart.destroy();
    holder.remove();
    this.root.classList.remove('sv-hidden');
    // The keyboard's place goes back to the row that was opened.
    const from = this.screenWrap.querySelector(
      `.bv-screen-row[data-biomarker="${CSS.escape(biomarker)}"]`
    );
    if (from) from.focus();
    return this;
  }

  /**
   * The chart a row has opened, or null while the screen is shown.
   * @returns {?object} The group comparison, the association scatter or the
   *   stratified survival chart.
   */
  opened() {
    return this.drilled ? this.drilled.chart : null;
  }

  // ---- Lifecycle --------------------------------------------------------------

  // The screen draws no Chart.js chart of its own: its rows are elements.
  destroyCharts() {}

  /**
   * Fit the chart to its container, for a page that changes the container's
   * size without resizing the window.
   * @returns {void}
   */
  resize() {
    if (this.drilled) this.drilled.chart.resize();
  }

  /**
   * Take the chart down: the screen, a chart a row had opened, and everything
   * in its element. A destroyed chart cannot be used again; make a new one.
   * @returns {void}
   */
  destroy() {
    // Any answer still on its way from R is for a chart that is gone.
    this.desk.begin();
    if (this.drilled) {
      this.drilled.chart.destroy();
      this.drilled = null;
    }
    this.element.innerHTML = '';
  }
}

/**
 * Make a biomarker screen in an element. The controls are drawn at once; give
 * the tables to `init` on the chart that is returned.
 *
 * @param {string|HTMLElement} element The element, or a CSS selector for it.
 * @param {object} [settings] Settings to lay over the defaults.
 * @returns {BiomarkerScreen} The chart: `init`, `setData`, `setSettings`,
 *   `render`, `resize`, `destroy`, `statistics`, `open`, `close`, `opened`.
 */
export function biomarkerScreen(element, settings) {
  return new BiomarkerScreen(element, settings);
}
