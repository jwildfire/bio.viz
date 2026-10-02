// What every chart does with safety.viz's kit on a page, written once: finding
// the kit, the shell and its slots, the tables a chart is given, the filters,
// the record listing and its CSV download, the participant profile's rail, and
// the statistics line's words on the page.
//
// Nothing of safety.viz and no Chart.js is imported here: the kit is found on
// the page when a chart is made. Each function takes the chart it works for,
// which holds `kit`, `settings`, `tables`, `state`, `host` and the shell's
// slots; a chart's own file decides what is drawn and what R is asked.

// safety.viz's categorical palette, so a group keeps one colour across the two
// libraries' charts on a page.
export const PALETTE = [
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

/** What a control calls each value type of a biomarker at a visit. */
export const VALUE_LABELS = Object.freeze({
  raw: 'Result',
  baseline: 'Baseline',
  change: 'Change from baseline',
  fold_change: 'Fold change from baseline',
  percent_change: 'Percent change from baseline'
});

/** What a control calls each scale of an axis. */
export const SCALE_LABELS = Object.freeze({ linear: 'Linear', log: 'Logarithmic' });

export const hexToRgba = (hex, alpha) => {
  const value = hex.replace('#', '');
  const part = (at) => parseInt(value.slice(at, at + 2), 16);
  return `rgba(${part(0)}, ${part(2)}, ${part(4)}, ${alpha})`;
};

// A value for reading: four significant figures, without trailing zeros.
export const shown = (value) =>
  Number.isFinite(value) ? String(Number(value.toPrecision(4))) : '';

const isRecordTable = (table) =>
  Array.isArray(table) &&
  table.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row));

// The kit, from the page. safety.viz is loaded beside this bundle, never
// bundled into it, so a page that forgot it is told so in plain words.
// `chart` is the chart in words: "the group comparison chart".
export function findKit(chart) {
  const kit = globalThis.SafetyViz && globalThis.SafetyViz.kit;
  if (!kit || typeof kit.renderShell !== 'function' || typeof kit.Chart !== 'function') {
    throw new Error(
      `bio.viz: ${chart} is built from safety.viz's kit, and \`SafetyViz.kit\` ` +
        "was not found. Load safety.viz's bundle on the page before bio.viz makes a chart."
    );
  }
  return kit;
}

export function applyStyles(id, styles) {
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = styles;
  document.head.append(style);
}

// The styles of the statistics line, the listing and the rail, for one chart's
// root class: every chart prints a result the same way.
export const lineStyles = (root) => `
${root} .bv-statistic{margin:.6rem 0 0;font-size:.85rem;color:#1f2933;max-width:100%}
${root} .bv-statistic:empty{display:none}
${root} .bv-statistic p{margin:0 0 .3rem}
${root} .bv-statistic[data-state=waiting],${root} .bv-statistic[data-state=none]{color:#52616f;font-style:italic}
${root} .bv-stat-remark,${root} .bv-stat-scope{font-size:.8rem;color:#52616f}
${root} .bv-stat-remark[data-kind=warning]{color:#8a4b00}
${root} .bv-stat-pairs{border-collapse:collapse;margin:.2rem 0 .5rem;font-size:.8rem;width:100%;max-width:36rem}
${root} .bv-stat-pairs caption{text-align:left;padding:0 0 .25rem;caption-side:top}
${root} .bv-stat-pairs th,${root} .bv-stat-pairs td{text-align:left;font-weight:400;padding:.2rem .6rem .2rem 0;border-top:1px solid #d9dee3;vertical-align:top;overflow-wrap:anywhere}
${root} .bv-stat-pairs thead th{font-weight:600;border-top:0}
${root} .bv-stat-pairs td:nth-child(2){white-space:nowrap}
${root} .bv-stat-method{display:block;color:#52616f}
${root} .bv-panel-canvas{height:300px;position:relative}
${root} .bv-panel-note{margin:0 0 .4rem;font-size:.8rem;color:#52616f}
${root} .sv-listing table{table-layout:fixed}
${root} .sv-listing th,${root} .sv-listing td{white-space:normal;overflow-wrap:anywhere}
${root} .sv-rail{max-width:100%;overflow-x:auto}`;

/**
 * safety.viz's shell in the chart's element, with the chart's class on it, and
 * what the kit's listing and participant rail read and keep (`chart.host`).
 * The shell's slots are put on the chart: `root`, `controls`, `notes`,
 * `chartWrap`, `canvas`, `multiplesWrap`, `footnote`, `listingWrap`,
 * `railWrap`, `sidebarToggle`; and `statLine`, the statistics line under them.
 *
 * @param {object} chart The chart.
 * @param {object} parts
 * @param {string} parts.moduleClass The chart's class on the shell's root.
 * @param {string} parts.styleId The id of the chart's style element.
 * @param {string} parts.styles The chart's styles.
 * @param {string} parts.listingFile The name the listing's CSV is downloaded under.
 */
export function mountShell(chart, { moduleClass, styleId, styles, listingFile }) {
  const { kit } = chart;
  Object.assign(
    chart,
    kit.renderShell(chart.element, {
      moduleClass,
      onToggle: () => chart.resize()
    })
  );
  applyStyles(styleId, styles);
  chart.statLine = kit.createElement('div', 'bv-statistic');
  chart.statLine.setAttribute('role', 'status');
  chart.footnote.after(chart.statLine);

  // What the kit's listing and participant rail read and keep.
  chart.host = {
    settings: {
      profile: chart.settings.profile,
      id_col: chart.settings.id_col,
      page_size: chart.settings.page_size,
      details: []
    },
    root: chart.root,
    railWrap: chart.railWrap,
    listingWrap: chart.listingWrap,
    currentTableData: [],
    listingSearch: '',
    listingSort: null,
    listingSelectedId: null,
    page: 1,
    profileRows: [],
    onListingRowClick: (row) => selectParticipant(chart, row[chart.settings.id_col])
  };

  // The listing's own export names its file for another chart; this one
  // downloads the same rows under this chart's name.
  chart.listingWrap.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest && event.target.closest('button');
      if (!button || button.textContent !== 'Export: CSV') return;
      event.stopPropagation();
      event.preventDefault();
      downloadListing(chart, listingFile);
    },
    true
  );

  // On a phone the controls would push the chart off the first screen: they
  // start folded away, one tap from open.
  if (globalThis.matchMedia && globalThis.matchMedia('(max-width: 600px)').matches) {
    chart.sidebarToggle.click();
  }
}

/**
 * The tables a chart was given, checked: `{ results, participants }`, or a
 * bare array taken as the results table. Tables the chart cannot read are
 * refused with a `TypeError`, and its message is shown in the chart's element.
 *
 * @param {object} chart The chart.
 * @param {object|object[]} data What `init` or `setData` was given.
 * @returns {{results: object[], participants: ?object[]}} The tables.
 */
export function readGiven(chart, data) {
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
      const column = chart.settings[key];
      if (tables.results.length && !tables.results.some((row) => column in row)) {
        throw new TypeError(`bio.viz: the results table has no column \`${column}\` (\`${key}\`).`);
      }
    }
  } catch (error) {
    chart.destroyCharts();
    chart.element.innerHTML = '';
    chart.element.append(chart.kit.createElement('div', 'sv-warning', error.message));
    throw error;
  }
  return {
    results: tables.results,
    participants: tables.participants && tables.participants.length ? tables.participants : null
  };
}

/** The settings the kit's listing and rail read, after the chart's settings change. */
export function syncHost(chart) {
  chart.host.settings.profile = chart.settings.profile;
  chart.host.settings.id_col = chart.settings.id_col;
  chart.host.settings.page_size = chart.settings.page_size;
}

// ---- Filters -----------------------------------------------------------------

/**
 * The Filters section of the sidebar: one control per filter. Filters choose
 * participants, so there are filters only with a participant table.
 * @param {object} chart The chart.
 * @param {object} builders The kit's `controlBuilders` for the sidebar.
 * @param {Function} onChange Called when a filter changes.
 */
export function addFilterControls(chart, { addSection, addControl }, onChange) {
  const { kit, state } = chart;
  if (!chart.filterSpecs.length) return;
  const filters = addSection('Filters');
  const idCol = chart.settings.participant_id_col || chart.settings.id_col;
  chart.filterSpecs.forEach((spec) => {
    const values = [
      ...new Set(
        chart.tables.participants
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
        onChange();
      }
    });
    control.dataset.filter = spec.value_col;
    addControl(spec.label, control, filters);
  });
}

/** The filters in force, each with its label and the values it lets through, for a sentence. */
export function filtersForScope(chart) {
  return chart.filterSpecs
    .map((spec) => ({ label: spec.label, selection: chart.state.filters[spec.value_col] }))
    .filter(({ selection }) => selection !== null && selection !== undefined && selection !== '')
    .map(({ label, selection }) => ({
      label,
      values: (Array.isArray(selection) ? selection : [selection]).map(String)
    }))
    .filter(({ values }) => values.length);
}

// ---- The statistics line -----------------------------------------------------

// A small table under a result: a caption, a header row, and one row per
// entry, headed by `head` (with `sub` beneath it when given).
function statTable({ caption, head, rows }, kit) {
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
    const lead = kit.createElement('th', null, row.head);
    lead.scope = 'row';
    if (row.sub) lead.append(kit.createElement('span', 'bv-stat-method', row.sub));
    line.append(lead, ...row.cells.map((cell) => kit.createElement('td', null, cell)));
    tbody.append(line);
  });
  table.append(thead, tbody);
  return table;
}

/**
 * Writes one description on a line: the result, the estimates R gave an
 * interval for, a table when there is one, what R said about its answer, and
 * what the result covers.
 *
 * @param {object} kit safety.viz's kit.
 * @param {HTMLElement} line The line.
 * @param {{state: string, text: string, estimates: string[], table: ?object,
 *   remarks: Array<{kind: string, text: string}>, scope: ?string}} description
 *   `table` is `{ caption, head, rows }`, each row `{ status, head, sub, cells }`.
 */
export function writeStatistic(kit, line, description) {
  line.dataset.state = description.state;
  line.innerHTML = '';
  line.append(kit.createElement('p', 'bv-stat-result', description.text));
  description.estimates.forEach((said) =>
    line.append(kit.createElement('p', 'bv-stat-estimate', said))
  );
  if (description.table) line.append(statTable(description.table, kit));
  description.remarks.forEach(({ kind, text }) => {
    const remark = kit.createElement('p', 'bv-stat-remark', text);
    remark.dataset.kind = kind;
    line.append(remark);
  });
  if (description.scope) line.append(kit.createElement('p', 'bv-stat-scope', description.scope));
}

// ---- Listing and participant profile -----------------------------------------

/**
 * Lists records under the chart, in the kit's record listing.
 * @param {object} chart The chart.
 * @param {object} parts
 * @param {Array<{value_col: string, label: string}>} parts.columns The listing's columns.
 * @param {object[]} parts.rows The rows, each with the participant's id.
 */
export function showListing(chart, { columns, rows }) {
  const { host, settings } = chart;
  const participantIdCol = settings.participant_id_col || settings.id_col;
  const byId = new Map(
    (chart.tables.participants || []).map((row) => [String(row[participantIdCol]), row])
  );
  host.settings.details = columns;
  host.currentTableData = rows.map((row) => ({
    ...(byId.get(String(row[settings.id_col])) || {}),
    ...row
  }));
  host.listingSearch = '';
  host.listingSort = null;
  host.page = 1;
  chart.kit.renderListing(host);
}

/**
 * Select one participant, or none: mark the listing's row and raise
 * safety.viz's selection event, which the participant rail opens on and any
 * other chart on the page can listen for.
 * @param {object} chart The chart.
 * @param {?string} id The participant's id, or null for none.
 */
export function selectParticipant(chart, id) {
  const { host } = chart;
  host.listingSelectedId = id == null ? null : String(id);
  if (host.currentTableData.length) chart.kit.renderListing(host);
  chart.root.dispatchEvent(
    new CustomEvent('participantsSelected', {
      detail: { data: id == null ? [] : [String(id)] },
      bubbles: true
    })
  );
}

/**
 * Empties the listing and the rail without raising an event: the chart is
 * about to show other rows.
 * @param {object} chart The chart.
 */
export function clearListing(chart) {
  const { host } = chart;
  host.currentTableData = [];
  host.listingSelectedId = null;
  chart.listingWrap.innerHTML = '';
  chart.kit.resetProfileRail(host);
}

/**
 * Downloads rows as a CSV file, written by the kit.
 * @param {object} kit safety.viz's kit.
 * @param {object[]} rows The rows.
 * @param {Array<{value_col: string, label: string}>} columns The columns, in order.
 * @param {string} file The name the file is downloaded under.
 */
export function downloadCsv(kit, rows, columns, file) {
  const blob = new Blob([kit.buildCsv(rows, columns)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file;
  link.click();
  URL.revokeObjectURL(url);
}

/** Downloads the rows the listing shows, searched and sorted as it shows them, as CSV. */
export function downloadListing(chart, file) {
  const { host, kit } = chart;
  let rows = kit.searchRows([...host.currentTableData], host.settings.details, host.listingSearch);
  if (host.listingSort) rows = kit.sortRows(rows, host.listingSort);
  downloadCsv(kit, rows, host.settings.details, file);
}

function railColumns(settings) {
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

/**
 * The settings safety.viz's participant rail is opened with.
 * @param {object} chart The chart: its `categories`, `measures` and `tables`.
 * @param {string} axisType `log` or `linear`: the scale of the rail's value axis.
 * @returns {object} The rail's settings.
 */
export function railSettings(chart, axisType) {
  const { settings } = chart;
  const details =
    settings.profile_details ||
    chart.categories
      .filter((entry) => entry.table !== 'results' || !chart.tables.participants)
      .map(({ value_col, label }) => ({ value_col, label }));
  const rail = {
    ...railColumns(settings),
    details,
    // Every biomarker is a measure the rail shows, not only the four liver
    // tests it was made for.
    measure_values: Object.fromEntries(chart.measures.map((measure) => [measure, measure])),
    axis_type: axisType === 'log' ? 'log' : 'linear',
    on_clear: () => selectParticipant(chart, null)
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

/**
 * The rows safety.viz's participant rail reads: every result, with the
 * participant's own columns beside it for the rail's header; and the rail,
 * mounted.
 *
 * The rail was made for laboratory results that carry a reference range, and
 * keeps only rows with an upper limit of normal above zero. Biomarker results
 * often have none. When no `normal_col_high` is mapped the rows are given a
 * stand-in so the rail keeps them, and the rail is told (railSettings) to show
 * each result as a multiple of the participant's first result and to draw no
 * reference range: nothing on screen claims one.
 *
 * @param {object} chart The chart.
 * @param {Function} settingsOf Gives the rail's settings when it opens.
 */
export function buildProfileFeed(chart, settingsOf) {
  const { settings, host, kit } = chart;
  host.profileRows = [];
  if (!settings.profile) return;
  const participantIdCol = settings.participant_id_col || settings.id_col;
  const byId = new Map(
    (chart.tables.participants || []).map((row) => [String(row[participantIdCol]), row])
  );
  const ranged = Boolean(settings.normal_col_high);
  const feed = chart.tables.results.map((row) => ({
    ...(byId.get(String(row[settings.id_col])) || {}),
    ...row,
    ...(ranged ? {} : { __bv_no_reference_range: 1 })
  }));
  host.profileRows = kit.buildProfileRows(feed, {
    ...railColumns(settings),
    normal_col_high: ranged ? settings.normal_col_high : '__bv_no_reference_range'
  });
  kit.mountProfileRail(host, settingsOf);
}
