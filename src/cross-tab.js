// The cross-tabulation: is this category associated with that one? A two-way
// table of counts with its totals and percentages, beside stacked bars of the
// same numbers, and R's chi-square or Fisher's exact test of the table.
//
//   BioViz.crossTab('#chart', { row_by: 'ARM', col_by: 'RESPONSE' }).init({ results, participants });
//
// Either way, the categories are a column's, or a biomarker or a number cut
// into groups by the shared cut rule. A cell lists its participants in the
// kit's listing, and a row of the listing opens safety.viz's participant
// profile.
//
// The lifecycle is safety.viz's (init, setData, setSettings, render, resize,
// destroy), and the chart is built as the other charts are: from safety.viz's
// kit, found on the page when a chart is made, with its frame from the core and
// the parts every chart shares from src/shared/.
//
// The chart counts, totals and works out percentages, which describe the
// table; it computes no test statistic or p-value. The test is R's, asked for
// through the connection, once per table, and printed as R returned it, with
// R's own warning when an expected count is too small for chi-square.

import { createConnection } from './r/connection.js';
import { UNUSED } from './core/reasons.js';
import { label as variableLabel } from './core/variable.js';
import { PERCENTS, TESTS, syncSettings } from './cross-tab/configure.js';
import {
  NO_TEST_CHOSEN,
  NOT_TWO_WAY,
  TEST_LABELS,
  contingencyRequest,
  createStatisticDesk,
  scopeText
} from './cross-tab/statistic.js';
import { buildTable, percentText } from './cross-tab/structureData.js';
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
  selectParticipant,
  showListing,
  syncHost,
  toolbarStyles,
  writeStatistic
} from './shared/chartHost.js';
import { cutNote, isCut } from './shared/cut.js';
import { NOBODY_PASSES, categoryColumns, filterColumns, listMeasures } from './shared/tables.js';

const MODULE_CLASS = 'bv-cross-tab';
const STYLE_ID = 'bio-viz-cross-tab-styles';
const C = `.${MODULE_CLASS}`;
const STYLES = `${lineStyles(C)}
${toolbarStyles(C)}
${C} .bv-crosstab-wrap{margin:0 0 .8rem;max-width:100%;overflow-x:auto}
${C} .bv-crosstab{border-collapse:collapse;font-size:.85rem;color:#1f2933;font-variant-numeric:tabular-nums}
${C} .bv-crosstab caption{caption-side:top;text-align:left;font-weight:600;padding:0 0 .4rem}
${C} .bv-crosstab th,${C} .bv-crosstab td{border:1px solid #d8dee4;padding:.3rem .55rem;text-align:right;vertical-align:top}
${C} .bv-crosstab thead th,${C} .bv-crosstab tbody th{background:#f6f8fa;font-weight:600}
${C} .bv-crosstab tbody th,${C} .bv-crosstab .bv-corner{text-align:left}
${C} .bv-crosstab .bv-total{background:#fbfcfd;font-weight:600}
${C} .bv-crosstab td.bv-cell{padding:0}
${C} .bv-cell button{display:block;width:100%;margin:0;border:0;background:transparent;padding:.3rem .55rem;font:inherit;text-align:right;color:inherit;cursor:pointer}
${C} .bv-cell button:hover{background:#f4f8fc}
${C} .bv-cell button:focus-visible{outline:2px solid #0b62a4;outline-offset:-2px}
${C} .bv-percent{display:block;font-size:.75rem;color:#52616f}
${C} .bv-chart-wrap{height:var(--bv-bars-height,220px);position:relative}
${C} .bv-control-note{display:block;margin:.2rem 0 0;font-size:.75rem;color:#52616f}`;

const HINT =
  'Click a count to list its participants and open a participant’s profile. The bars are the ' +
  'same table, as percentages.';
const CUT_KEY = 'bv-cut:';
const PERCENT_LABELS = Object.freeze({
  row: 'Of each row',
  col: 'Of each column',
  none: 'None'
});

/**
 * The live chart. Made by `crossTab()`, not directly.
 */
class CrossTab {
  constructor(element, settings) {
    this.kit = findKit('the cross-tabulation');
    this.element = typeof element === 'string' ? document.querySelector(element) : element;
    if (!this.element) throw new Error(`bio.viz: cross-tabulation target not found: ${element}`);
    this.settings = syncSettings(settings);
    this.tables = { results: [], participants: null };
    this.charts = [];
    this.model = null;
    this.measures = [];
    this.categories = [];
    this.cutOptions = [];
    this.filterSpecs = [];
    this.state = {};
    this.asked = [];
    this.connect();
    this.renderShell();
  }

  // The connection the statistics line asks: the one given in settings, or one
  // with no R attached, which answers that statistics are unavailable.
  connect() {
    // A desk that is replaced answers nothing more.
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
      listingFile: 'bio.viz-cross-tab-listing.csv'
    });
    this.tableWrap = this.kit.createElement('div', 'bv-crosstab-wrap');
    this.chartWrap.before(this.tableWrap);
    mountToolbar(this);
  }

  /**
   * Load the tables and draw: the same as `setData`.
   * @param {{results: object[], participants?: object[]}} data The tables.
   * @returns {CrossTab} The chart, for chaining.
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
   * @returns {CrossTab} The chart, for chaining.
   */
  setData(data, settings) {
    if (settings === undefined || settings === null) {
      this.tables = readGiven(this, data);
    } else {
      // The tables and the settings that read them change together.
      this.tables = readGiven(this, data, syncSettings({ ...this.settings, ...settings }));
      this.setSettings(settings);
    }
    this.readTables();
    this.state = this.seedState();
    this.buildProfileFeed();
    this.buildControls();
    this.render();
    return this;
  }

  /**
   * Lay new settings over the current ones and draw again. A setting that says
   * what the chart opens on (`row_by`, `col_by`, `percent`, `test`, `filters`)
   * moves its control.
   * @param {object} settings The settings to change.
   * @returns {CrossTab} The chart, for chaining.
   */
  setSettings(settings) {
    const given = settings || {};
    const next = syncSettings({ ...this.settings, ...given });
    // The tables must still have the columns the new settings name.
    checkTables(this.tables, next);
    this.settings = next;
    syncHost(this);
    if ('back' in given) mountToolbar(this);
    if ('connection' in given || 'waiting_note' in given) this.connect();
    this.readTables();
    const opening = this.seedState();
    const moved = {
      row_by: 'rowBy',
      col_by: 'colBy',
      percent: 'percent',
      test: 'test',
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

  // What the controls can offer, read from the tables and the settings.
  readTables() {
    const { results } = this.tables;
    const { settings } = this;
    this.measures = results.length ? listMeasures(results, settings) : [];
    this.categories = results.length ? categoryColumns(this.tables, settings) : [];
    this.filterSpecs = filterColumns(this.tables, settings, this.categories).map((spec) =>
      this.kit.normalizeFilterSpec(spec)
    );
    // The cut variables the settings name, each once, offered after the columns.
    this.cutOptions = [];
    for (const by of [settings.row_by, settings.col_by, ...(settings.cuts || [])]) {
      if (!isCut(by)) continue;
      const written = JSON.stringify(by);
      if (this.cutOptions.some((entry) => JSON.stringify(entry.spec) === written)) continue;
      this.cutOptions.push({
        key: `${CUT_KEY}${this.cutOptions.length}`,
        spec: by,
        label: variableLabel(by)
      });
    }
  }

  cutKey(by) {
    const written = JSON.stringify(by);
    return this.cutOptions.find((entry) => JSON.stringify(entry.spec) === written).key;
  }

  // Whether a Rows or Columns control can hold a value: a column offered, or a
  // cut variable the settings name.
  offers(value) {
    return (
      this.categories.some((entry) => entry.value_col === value) ||
      this.cutOptions.some((entry) => entry.key === value)
    );
  }

  // A control's value as the table takes it: a column's name, or the cut variable.
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

  // The state with the rows and the columns as the table takes them.
  drawingState(state = this.state) {
    return { ...state, rowBy: this.groupingOf(state.rowBy), colBy: this.groupingOf(state.colBy) };
  }

  // What the chart opens on: the settings, where the tables have what they
  // name; otherwise the first two category columns.
  seedState() {
    const { settings, categories } = this;
    const has = (column) => categories.some((entry) => entry.value_col === column);
    const opening = (by, fallback) => {
      if (isCut(by)) return this.cutKey(by);
      if (has(by)) return by;
      return fallback;
    };
    const rowBy = opening(settings.row_by, categories[0] ? categories[0].value_col : null);
    const other = categories.find((entry) => entry.value_col !== rowBy);
    const colBy = opening(settings.col_by, other ? other.value_col : null);
    return {
      rowBy,
      colBy,
      percent: settings.percent,
      test: settings.test,
      filters: this.kit.initFilterState(this.filterSpecs)
    };
  }

  // After the tables or the settings change, a control may hold something that
  // is no longer offered; it returns to what the chart opens on.
  repairState(opening) {
    if (!this.offers(this.state.rowBy)) this.state.rowBy = opening.rowBy;
    if (!this.offers(this.state.colBy)) this.state.colBy = opening.colBy;
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

    const options = [
      ...this.categories.map((entry) => [entry.value_col, entry.label]),
      ...this.cutOptions.map((entry) => [entry.key, entry.label])
    ];
    const table = addSection('Table');
    if (options.length) {
      select(
        'row-by',
        'Rows',
        options,
        state.rowBy,
        (next) => {
          state.rowBy = next;
          redraw();
        },
        table
      );
      select(
        'col-by',
        'Columns',
        options,
        state.colBy,
        (next) => {
          state.colBy = next;
          redraw();
        },
        table
      );
    } else {
      table.append(
        kit.createElement(
          'p',
          'sv-warning bv-no-groups',
          'No column can make a category. Give a participant table, or carry a column on the results rows.'
        )
      );
    }
    select(
      'percent',
      'Percentages',
      PERCENTS.map((entry) => [entry, PERCENT_LABELS[entry]]),
      state.percent,
      (next) => {
        state.percent = next;
        // What the percentages are of describes the same table: R is not
        // asked again, and its answer stays.
        drawSafely(this, () => this.redrawPercentages());
      },
      table
    );

    if (this.settings.statistic) {
      const statistics = addSection('Statistics');
      select(
        'test',
        'Test',
        TESTS.map((entry) => [entry, TEST_LABELS[entry]]),
        state.test,
        (next) => {
          state.test = next;
          redraw();
        },
        statistics
      );
    }

    // Filters choose participants, so there are filters only with a participant table.
    addFilterControls(this, { addSection, addControl }, () => redraw());

    addReset(() => {
      this.state = this.seedState();
      this.buildControls();
      this.render();
    });
  }

  // ---- Drawing ----------------------------------------------------------------

  /**
   * Draw everything again from the tables, the settings and the controls, and
   * ask R again. The table, the bars, the line and the listing are cleared
   * first: nothing stays on screen that describes another table.
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
    this.tableWrap.innerHTML = '';
    this.multiplesWrap.innerHTML = '';
    this.statLine.textContent = '';
    this.statLine.dataset.state = 'empty';
    this.chartWrap.classList.add('sv-hidden');
    this.model = null;

    const { kit, settings, state } = this;
    if (!this.tables.results.length) {
      this.footnote.textContent = 'No results to draw.';
      return;
    }
    if (!state.rowBy || !state.colBy) {
      this.footnote.textContent = 'Choose the rows and the columns of the table.';
      return;
    }
    const drawing = this.drawingState();
    const model = buildTable(this.tables, settings, drawing, { filterMatches: kit.filterMatches });
    this.model = model;
    this.updateNotes(model);
    if (model.filtered === 0) {
      this.footnote.textContent = NOBODY_PASSES;
      return;
    }
    if (!model.total) {
      this.footnote.textContent = 'No participant has a category each way.';
      return;
    }
    this.drawTable(model);
    this.drawBars(model);
    this.footnote.textContent = [HINT, ...this.cutNotes(model)].join(' ');

    if (!settings.statistic) return;
    const show = (description) => writeStatistic(kit, this.statLine, description);
    if (state.test === 'none') {
      show({ state: 'none', text: this.desk.idle(NO_TEST_CHOSEN), estimates: [], remarks: [] });
      return;
    }
    if (model.rowLevels.length < 2 || model.colLevels.length < 2) {
      show({ state: 'none', text: NOT_TWO_WAY, estimates: [], remarks: [] });
      return;
    }
    const request = contingencyRequest({
      name: settings.statistic,
      test: state.test,
      settings,
      state: drawing,
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
        show(description);
      },
      {
        scope: scopeText({ n: model.total, filters: filtersForScope(this) }),
        names: { row: this.labelOf(state.rowBy), col: this.labelOf(state.colBy) }
      }
    );
  }

  // The table and the bars again, with the percentages of the rows or the
  // columns, from the table already worked out. Nothing else changes: the
  // statistics line keeps R's answer for this table, and R is not asked again.
  redrawPercentages() {
    if (!this.model || !this.model.total) {
      this.render();
      return;
    }
    this.destroyCharts();
    this.clearSelection();
    this.tableWrap.innerHTML = '';
    this.multiplesWrap.innerHTML = '';
    this.drawTable(this.model);
    this.drawBars(this.model);
    this.footnote.textContent = [HINT, ...this.cutNotes(this.model)].join(' ');
  }

  // Above the table: who is in it, and what was left out of it.
  updateNotes(model) {
    const { kit } = this;
    const add = (text, warning) =>
      this.notes.append(kit.createElement('span', warning ? 'sv-warning' : null, text));
    if (model.participants) {
      add(`${model.total} of ${model.participants} participants in the table.`);
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

  // How each cut variable was cut, a sentence each.
  cutNotes(model) {
    return ['row', 'col']
      .filter((field) => model.cuts[field])
      .map((field) => cutNote(model.cuts[field].spec, model.cuts[field]));
  }

  // The two-way table: a count in each cell, with its percentage when one is
  // chosen, the row and the column totals, and the grand total. A cell is a
  // button that lists its participants.
  drawTable(model) {
    const { kit, state } = this;
    const rowLabel = this.labelOf(state.rowBy);
    const colLabel = this.labelOf(state.colBy);
    const table = kit.createElement('table', 'bv-crosstab');
    table.append(kit.createElement('caption', null, `${rowLabel} by ${colLabel}`));
    const head = kit.createElement('thead');
    const top = kit.createElement('tr');
    const corner = kit.createElement('th', 'bv-corner', `${rowLabel} \\ ${colLabel}`);
    corner.scope = 'col';
    top.append(corner);
    model.colLevels.forEach((level) => {
      const th = kit.createElement('th', null, level);
      th.scope = 'col';
      top.append(th);
    });
    const totalHead = kit.createElement('th', 'bv-total', 'Total');
    totalHead.scope = 'col';
    top.append(totalHead);
    head.append(top);
    table.append(head);

    const percentOf = (i, j) =>
      state.percent === 'row'
        ? model.percents.row[i][j]
        : state.percent === 'col'
          ? model.percents.col[i][j]
          : null;
    const body = kit.createElement('tbody');
    model.rowLevels.forEach((row, i) => {
      const tr = kit.createElement('tr');
      const th = kit.createElement('th', null, row);
      th.scope = 'row';
      tr.append(th);
      model.colLevels.forEach((col, j) => {
        const td = kit.createElement('td', 'bv-cell');
        const button = kit.createElement('button');
        button.type = 'button';
        button.dataset.row = row;
        button.dataset.col = col;
        const n = model.counts[i][j];
        const percent = percentOf(i, j);
        button.append(document.createTextNode(String(n)));
        if (percent !== null)
          button.append(kit.createElement('span', 'bv-percent', percentText(percent)));
        button.setAttribute(
          'aria-label',
          `${rowLabel} ${row}, ${colLabel} ${col}: ${n} participant${n === 1 ? '' : 's'}` +
            `${percent === null ? '' : `, ${percentText(percent)} of the ${state.percent === 'row' ? 'row' : 'column'}`}. List them.`
        );
        button.onclick = () => this.listCell(row, col);
        td.append(button);
        tr.append(td);
      });
      tr.append(kit.createElement('td', 'bv-total', String(model.rowTotals[i])));
      body.append(tr);
    });
    table.append(body);
    const foot = kit.createElement('tfoot');
    const totals = kit.createElement('tr');
    const label = kit.createElement('th', 'bv-total', 'Total');
    label.scope = 'row';
    totals.append(label);
    model.colTotals.forEach((n) => totals.append(kit.createElement('td', 'bv-total', String(n))));
    totals.append(kit.createElement('td', 'bv-total', String(model.total)));
    foot.append(totals);
    table.append(foot);
    this.tableWrap.append(table);
  }

  // The stacked bars: the same table as percentages, each row's split by the
  // columns, or, with column percentages, each column's split by the rows.
  drawBars(model) {
    const { kit, state } = this;
    const byColumns = state.percent === 'col';
    const bars = byColumns ? model.colLevels : model.rowLevels;
    const parts = byColumns ? model.rowLevels : model.colLevels;
    const share = (bar, part) =>
      byColumns ? model.percents.col[part][bar] : model.percents.row[bar][part];
    this.chartWrap.classList.remove('sv-hidden');
    this.chartWrap.style.setProperty(
      '--bv-bars-height',
      `${Math.max(140, 56 + bars.length * 44)}px`
    );
    const chart = new kit.Chart(this.canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: bars,
        datasets: parts.map((part, p) => ({
          label: part,
          data: bars.map((_, b) => share(b, p)),
          backgroundColor: hexToRgba(PALETTE[p % PALETTE.length], 0.75),
          borderColor: PALETTE[p % PALETTE.length],
          borderWidth: 1
        }))
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: {
            position: 'bottom',
            title: {
              display: true,
              text: this.labelOf(byColumns ? state.rowBy : state.colBy)
            }
          },
          tooltip: {
            callbacks: {
              label: (item) => `${item.dataset.label}: ${percentText(item.raw)}`
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            min: 0,
            max: 100,
            title: {
              display: true,
              text: `Percentage of each ${byColumns ? 'column' : 'row'}`
            }
          },
          y: {
            stacked: true,
            title: { display: true, text: this.labelOf(byColumns ? state.colBy : state.rowBy) }
          }
        }
      }
    });
    this.canvas.setAttribute(
      'aria-label',
      `Stacked bars, percentage of each ${byColumns ? 'column' : 'row'}: ` +
        bars
          .map(
            (bar, b) =>
              `${bar}: ${parts.map((part, p) => `${part} ${percentText(share(b, p))}`).join(', ')}`
          )
          .join('; ')
    );
    this.charts.push(chart);
  }

  // ---- Listing and participant profile -------------------------------------------

  /**
   * List the participants of one cell, as a click on its count does.
   * @param {string} row The cell's row category.
   * @param {string} col The cell's column category.
   * @returns {Array<object>} The participants listed.
   */
  listCell(row, col) {
    if (!this.model) return [];
    const records = this.model.records.filter(
      (record) => record.row === String(row) && record.col === String(col)
    );
    this.clearSelection();
    showListing(this, { columns: this.listingColumns(), rows: records });
    this.listed = { row: String(row), col: String(col) };
    this.footnote.textContent =
      `${this.labelOf(this.state.rowBy)} ${row}, ${this.labelOf(this.state.colBy)} ${col}: ` +
      `${records.length} participant${records.length === 1 ? '' : 's'} listed. ` +
      "Click a row to open the participant's profile.";
    return records;
  }

  listingColumns() {
    if (this.settings.details) return this.settings.details;
    return [
      { value_col: this.settings.id_col, label: 'Participant' },
      { value_col: 'row', label: this.labelOf(this.state.rowBy) },
      { value_col: 'col', label: this.labelOf(this.state.colBy) }
    ];
  }

  // Select one participant, or none: mark the listing's row and raise
  // safety.viz's selection event, which the participant rail opens on.
  select(id) {
    selectParticipant(this, id);
  }

  // Empties the listing and the rail without raising an event.
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
   * What the chart has asked R for the table now drawn, and what R answered:
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
   * Fit the bars to their container, for a page that changes the container's
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
   * Take the chart down: its bars, its participant rail and everything in its
   * element. A destroyed chart cannot be used again; make a new one.
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
 * Make a cross-tabulation in an element. The controls are drawn at once; give
 * the tables to `init` on the chart that is returned.
 *
 * @param {string|HTMLElement} element The element, or a CSS selector for it.
 * @param {object} [settings] Settings to lay over the defaults.
 * @returns {CrossTab} The chart: `init`, `setData`, `setSettings`, `render`,
 *   `resize`, `destroy`, `statistics`, `listCell`.
 */
export function crossTab(element, settings) {
  return new CrossTab(element, settings);
}
