// What every chart does with safety.viz's kit on a page, written once: finding
// the kit, the shell and its slots, the tables a chart is given, the filters,
// the record listing and its CSV download, the participant profile's rail, and
// the statistics line's words on the page.
//
// Nothing of safety.viz and no Chart.js is imported here: the kit is found on
// the page when a chart is made. Each function takes the chart it works for,
// which holds `kit`, `settings`, `tables`, `state`, `host` and the shell's
// slots; a chart's own file decides what is drawn and what R is asked.

import { checkOutcomes } from './outcomes.js';
import { VERSION, automaticFootnote, dateDrawn, fillText } from './titles.js';
import { statisticsTable, toCsv } from './csv.js';
import { drawFrame } from './png.js';

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
${root} .sv-rail{max-width:100%;overflow-x:auto}
${root} .sv-footnote.bv-failure{color:#9b1c1c;font-weight:600}
${root} .bv-titles{margin:0 0 .6rem;max-width:100%}
${root} .bv-titles:empty{display:none}
${root} .bv-title{margin:0;font-size:1.05rem;font-weight:600;line-height:1.3;color:#1f2933;overflow-wrap:anywhere}
${root} .bv-subtitle{margin:.15rem 0 0;font-size:.9rem;color:#3e4c59;overflow-wrap:anywhere}
${root} .bv-foot{margin:.7rem 0 0;padding:.4rem 0 0;border-top:1px solid #e4e8ec;font-size:.75rem;color:#52616f;max-width:100%}
${root} .bv-foot p{margin:0 0 .2rem;overflow-wrap:anywhere}
${root} .bv-downloads{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem .6rem;margin:.6rem 0 0;font-size:.8rem;color:#52616f}
${root} .bv-downloads[hidden]{display:none}
${root} .bv-downloads button{font:inherit;padding:.3rem .65rem;border:1px solid #b8c0cc;border-radius:6px;background:#fff;color:#1f2933;cursor:pointer}
${root} .bv-downloads button:disabled{color:#8a96a3;cursor:default}
${root} .bv-downloads button:focus-visible{outline:2px solid #0b62a4;outline-offset:1px}`;

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
  // The title and subtitle above everything the chart draws, and its
  // footnotes under it, before the listing (#66).
  chart.titleBlock = kit.createElement('div', 'bv-titles');
  chart.main.prepend(chart.titleBlock);
  chart.footBlock = kit.createElement('div', 'bv-foot');
  chart.listingWrap.before(chart.footBlock);
  // The downloads, under the footnotes and out of the picture (#67).
  chart.module = moduleClass.replace(/^bv-/, '');
  mountDownloads(chart);

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
 * Checks that the tables have the columns the settings name: the results
 * table's id, biomarker, result and visit, and the participant table's id; and
 * that a cut variable in the settings cuts a biomarker the results table has, or
 * a column one of the tables has. What is missing is refused with a `TypeError`
 * that names it. A
 * chart checks this when it is given tables, and when its settings change.
 * @param {{results: object[], participants: ?object[]}} tables The tables.
 * @param {object} settings The settings.
 */
export function checkTables(tables, settings) {
  for (const key of ['id_col', 'measure_col', 'value_col', 'visit_col']) {
    const column = settings[key];
    if (tables.results.length && !tables.results.some((row) => column in row)) {
      throw new TypeError(`bio.viz: the results table has no column \`${column}\` (\`${key}\`).`);
    }
  }
  // A participant table is read by its participant id. Without that column no
  // participant in it could be matched to a result.
  const participantIdCol = settings.participant_id_col || settings.id_col;
  if (
    tables.participants != null &&
    tables.participants.length &&
    !tables.participants.some((row) => participantIdCol in row)
  ) {
    throw new TypeError(
      `bio.viz: the participant table has no column \`${participantIdCol}\`, which names the ` +
        'participant (`participant_id_col`, or `id_col` when that is not set).'
    );
  }
  // A cut variable cuts a biomarker the results table has, or a column one of
  // the tables has: otherwise it could make no group.
  if (!tables.results.length) return;
  const cuts = GROUPINGS.map((key) => [key, settings[key]]);
  (Array.isArray(settings.cuts) ? settings.cuts : []).forEach((spec, index) =>
    cuts.push([`cuts[${index}]`, spec])
  );
  for (const [key, spec] of cuts) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) continue;
    if (typeof spec.measure === 'string') {
      if (!tables.results.some((row) => row[settings.measure_col] === spec.measure)) {
        throw new TypeError(
          `bio.viz: \`${key}\` cuts the biomarker ${spec.measure}, which the results table does ` +
            'not have.'
        );
      }
    } else if (typeof spec.col === 'string') {
      const has = (rows) => Boolean(rows) && rows.some((row) => spec.col in row);
      if (!has(tables.results) && !has(tables.participants)) {
        throw new TypeError(
          `bio.viz: \`${key}\` cuts the column ${spec.col}, which neither the results table nor ` +
            'the participant table has.'
        );
      }
    }
  }
}

// The settings that may hold a cut variable, in any chart.
const GROUPINGS = ['group_by', 'panel_by', 'row_by', 'col_by'];

/**
 * The tables a chart was given, checked: `{ results, participants }`, or a
 * bare array taken as the results table. Tables the chart cannot read are
 * refused with a `TypeError`, and its message is shown in the chart's element.
 *
 * @param {object} chart The chart.
 * @param {object|object[]} data What `init` or `setData` was given.
 * @param {object} [settings] The settings the tables are read with: the
 *   chart's, or the ones `setData` was given with them.
 * @returns {{results: object[], participants: ?object[]}} The tables.
 */
export function readGiven(chart, data, settings = chart.settings) {
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
    checkTables(tables, settings);
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

/**
 * The outcomes table a chart was given, checked: an array of records with the
 * columns the settings name, or null when there is none or it is empty. A
 * table the chart cannot read is refused with a `TypeError`, and its message is
 * shown in the chart's element.
 *
 * @param {object} chart The chart.
 * @param {*} outcomes What `init` or `setData` was given as `outcomes`.
 * @param {object} settings The settings the table is read with.
 * @returns {?object[]} The outcomes table.
 */
export function readOutcomesGiven(chart, outcomes, settings) {
  if (outcomes === undefined || outcomes === null) return null;
  try {
    if (!isRecordTable(outcomes)) {
      throw new TypeError('bio.viz: `outcomes` must be an array of records, one object per row.');
    }
    checkOutcomes(outcomes, settings);
  } catch (error) {
    chart.destroyCharts();
    chart.element.innerHTML = '';
    chart.element.append(chart.kit.createElement('div', 'sv-warning', error.message));
    throw error;
  }
  return outcomes.length ? outcomes : null;
}

/**
 * Draws the chart, and when drawing fails says so in the chart's element
 * instead of leaving a page half drawn. Whatever was drawn is taken away, the
 * statistics round is ended so no answer lands on it, the footnote says why the
 * chart could not be drawn, and the controls stay, so the reader can change
 * what is asked. The error is logged for a developer.
 *
 * @param {object} chart The chart.
 * @param {Function} draw Draws everything the chart shows.
 */
export function drawSafely(chart, draw) {
  chart.footnote.classList.remove('bv-failure');
  try {
    draw();
    writeTitles(chart);
  } catch (error) {
    if (chart.desk) chart.desk.begin();
    chart.asked = [];
    chart.model = null;
    // R's last answer, a listing and the participant rail describe what was
    // drawn before, so none of them stays.
    if ('answer' in chart) chart.answer = null;
    chart.destroyCharts();
    clearListing(chart);
    for (const wrap of [
      chart.notes,
      chart.multiplesWrap,
      chart.listingWrap,
      chart.gridWrap,
      chart.screenWrap
    ]) {
      if (wrap) wrap.innerHTML = '';
    }
    if (chart.chartWrap) chart.chartWrap.classList.add('sv-hidden');
    chart.statLine.textContent = '';
    chart.statLine.dataset.state = 'empty';
    const message = String((error && error.message) || error).replace(/^bio\.viz: /, '');
    chart.footnote.textContent = `This chart could not be drawn: ${message}`;
    chart.footnote.classList.add('bv-failure');
    console.error(error);
    writeTitles(chart);
  }
}

// ---- The title, the subtitle and the footnotes -------------------------------------

/**
 * What every chart's placeholders hold, beside its own: the date drawn, the
 * bio.viz version and the filters in force, in words.
 * @param {object} chart The chart.
 * @returns {object}
 */
export function sharedPlaceholders(chart) {
  const filters =
    chart.filterSpecs && chart.state && chart.state.filters ? filtersForScope(chart) : [];
  return {
    date: dateDrawn(),
    version: VERSION,
    filters: filters.length
      ? filters.map(({ label, values }) => `${label} is ${values.join(' or ')}`).join('; ')
      : 'none'
  };
}

/**
 * The values a chart's title, subtitle and footnotes are filled from: what
 * every chart has, and the chart's own (`chart.placeholders()`).
 * @param {object} chart The chart.
 * @returns {object}
 */
export function placeholderValues(chart) {
  let own = {};
  try {
    own = typeof chart.placeholders === 'function' ? chart.placeholders() || {} : {};
  } catch {
    own = {};
  }
  return { ...sharedPlaceholders(chart), ...own };
}

/**
 * The title, subtitle and footnotes as they read now, filled, with the
 * footnote the chart writes last.
 * @param {object} chart The chart.
 * @returns {{title: ?string, subtitle: ?string, footnotes: string[]}}
 */
export function titlesOf(chart) {
  const { settings } = chart;
  const values = placeholderValues(chart);
  const filled = (template) => (template === null ? null : fillText(template, values));
  return {
    title: filled(settings.title),
    subtitle: filled(settings.subtitle),
    footnotes: [
      ...(settings.footnotes || []).map(filled),
      automaticFootnote({
        date: values.date,
        version: VERSION,
        asked: chart.asked || [],
        of: chart.footnoteCounts
      })
    ]
  };
}

/**
 * Writes the title, the subtitle and the footnotes, as text. A chart calls it
 * when it has drawn, which drawSafely does, and when an answer from R arrives.
 * @param {object} chart The chart, with `titleBlock` and `footBlock`.
 */
export function writeTitles(chart) {
  if (!chart.titleBlock || !chart.footBlock) return;
  const { kit } = chart;
  const said = titlesOf(chart);
  chart.titleBlock.innerHTML = '';
  if (said.title !== null && said.title !== '') {
    const title = kit.createElement('div', 'bv-title');
    title.setAttribute('role', 'heading');
    title.setAttribute('aria-level', '2');
    title.textContent = said.title;
    chart.titleBlock.append(title);
  }
  if (said.subtitle !== null && said.subtitle !== '') {
    const subtitle = kit.createElement('p', 'bv-subtitle');
    subtitle.textContent = said.subtitle;
    chart.titleBlock.append(subtitle);
  }
  chart.footBlock.innerHTML = '';
  said.footnotes.forEach((text, index) => {
    const line = kit.createElement('p', 'bv-foot-line');
    line.textContent = text;
    if (index === said.footnotes.length - 1) line.dataset.automatic = 'true';
    chart.footBlock.append(line);
  });
  syncDownloads(chart);
}

// ---- The downloads -------------------------------------------------------------

/** What each download is called on its button. */
export const DOWNLOAD_LABELS = Object.freeze({
  png: 'PNG',
  statistics: 'Statistics (CSV)',
  table: 'Table (CSV)'
});

// Text as part of a file name: lower case, words joined by hyphens.
const slug = (text) =>
  String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');

/**
 * The name a download is saved under: the chart, the view, and what it is.
 * `bio.viz-cross-tab-arm-by-response.png`, `…-statistics.csv`, `…-table.csv`.
 * @param {object} chart The chart.
 * @param {string} kind `png`, `statistics` or `table`.
 * @returns {string}
 */
export function downloadName(chart, kind) {
  const values = placeholderValues(chart);
  const view = (chart.viewFields || [])
    .map((name) => values[name])
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
    .join(' ');
  const base = ['bio.viz', chart.module, slug(view)].filter(Boolean).join('-');
  return kind === 'png' ? `${base}.png` : `${base}-${kind}.csv`;
}

/**
 * One download of a chart, as a file: the chart's frame as a PNG, the
 * statistics R returned for the view as CSV, or the table the chart drew from
 * as CSV.
 * @param {object} chart The chart.
 * @param {string} kind `png`, `statistics` or `table`.
 * @returns {Promise<{name: string, blob: Blob}>}
 */
export async function downloadFile(chart, kind) {
  const name = downloadName(chart, kind);
  if (kind === 'statistics') {
    const { columns, rows } = statisticsTable(chart.asked || []);
    return { name, blob: new Blob([toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' }) };
  }
  if (kind === 'table') {
    const { columns, rows } =
      typeof chart.tableOf === 'function' ? chart.tableOf() : { columns: [], rows: [] };
    return { name, blob: new Blob([toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' }) };
  }
  if (kind === 'png') {
    const said = titlesOf(chart);
    const leaving = [chart.toolbar, chart.footnote, chart.listingWrap, chart.downloadBar].filter(
      Boolean
    );
    const { blob } = await drawFrame(chart.main, {
      scale: chart.settings.png_scale,
      leaveOut: (element) => leaving.includes(element),
      text: {
        Title: [said.title, said.subtitle].filter(Boolean).join(' — '),
        Description: said.footnotes.join(' '),
        Software: `bio.viz ${VERSION}`
      }
    });
    return { name, blob };
  }
  throw new TypeError(
    `bio.viz: a download is \`png\`, \`statistics\` or \`table\`, not \`${kind}\`.`
  );
}

// The bar under the footnotes: a button for each download.
function mountDownloads(chart) {
  const { kit } = chart;
  chart.downloadBar = kit.createElement('div', 'bv-downloads');
  chart.downloadBar.append(kit.createElement('span', 'bv-downloads-label', 'Download:'));
  chart.downloadButtons = {};
  for (const [kind, label] of Object.entries(DOWNLOAD_LABELS)) {
    const button = kit.createElement('button', null, label);
    button.type = 'button';
    button.dataset.download = kind;
    button.onclick = async () => {
      button.disabled = true;
      try {
        const { name, blob } = await downloadFile(chart, kind);
        saveFile(blob, name);
      } catch (error) {
        console.error(error);
      } finally {
        syncDownloads(chart);
      }
    };
    chart.downloadButtons[kind] = button;
    chart.downloadBar.append(button);
  }
  chart.footBlock.after(chart.downloadBar);
  /**
   * One download, as a file, without saving it: see `downloadFile`.
   * @param {string} kind `png`, `statistics` or `table`.
   */
  chart.fileOf = (kind) => downloadFile(chart, kind);
}

// Which downloads there is something to download for.
function syncDownloads(chart) {
  if (!chart.downloadBar) return;
  chart.downloadBar.hidden = !chart.settings.downloads;
  const answered = (chart.asked || []).some(
    (entry) => entry.answer && entry.answer.status === 'ok'
  );
  const table = typeof chart.tableOf === 'function' ? chart.tableOf() : { rows: [] };
  // A view that asks R nothing has no statistics to offer; one that waits for
  // R's answer offers them once it comes.
  const { png, statistics } = chart.downloadButtons;
  if (!(chart.asked || []).length) statistics.remove();
  else if (!statistics.isConnected) png.after(statistics);
  statistics.disabled = !answered;
  chart.downloadButtons.table.disabled = !table.rows.length;
  chart.downloadButtons.png.disabled = false;
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
  // The participant's id is no filter: it gets no control, and so no restriction.
  const drawn = chart.filterSpecs.filter((spec) => spec.value_col !== idCol);
  // safety.viz's own reconciliation of what each spec asks for with what the
  // data has, as every safety.viz chart calls it: a start the data lacks falls
  // back to All with a warning, `all: false` puts its first value in force, and
  // the state the chart filters by is the selection each control shows.
  kit
    .reconcileFilters(state.filters, drawn, (spec) =>
      [
        ...new Set(
          chart.tables.participants
            .map((row) => row[spec.value_col])
            .filter((entry) => entry !== undefined && entry !== null && entry !== '')
            .map(String)
        )
      ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    )
    .forEach(({ spec, values, selected }) => {
      const control = kit.renderFilterControl({
        spec,
        values,
        selected,
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
  saveFile(new Blob([toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' }), file);
}

/**
 * Saves a file the way safety.viz's kit saves its listing: a link to the file,
 * clicked, and let go.
 * @param {Blob} blob The file.
 * @param {string} name Its name.
 */
export function saveFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
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

// ---- Pages -------------------------------------------------------------------

/**
 * How many items a page shows of how many and, when there is more than one
 * page, the way to the others: Previous, which page of how many, and Next.
 * @param {object} kit safety.viz's kit.
 * @param {{page: number, pages: number}} page A page, as `pageOf` gives it.
 * @param {string} count The sentence of how many are shown (`pageCount`).
 * @param {Function} go Called with the page asked for, counted from zero.
 * @returns {HTMLElement} The pager.
 */
export function renderPager(kit, page, count, go) {
  const pager = kit.createElement('div', 'bv-overview-pager');
  pager.append(kit.createElement('span', 'bv-overview-count', count));
  if (page.pages === 1) return pager;
  const button = (label, to, name) => {
    const made = kit.createElement('button', null, label);
    made.type = 'button';
    made.dataset.go = name;
    made.disabled = to < 0 || to >= page.pages;
    made.onclick = () => go(to);
    return made;
  };
  pager.append(
    button('Previous', page.page - 1, 'previous'),
    kit.createElement('span', 'bv-overview-page', `Page ${page.page + 1} of ${page.pages}`),
    button('Next', page.page + 1, 'next')
  );
  return pager;
}

// ---- The way back ------------------------------------------------------------

/**
 * Above a chart that another chart opened in its place: a button back, which
 * calls the caller's function with the chart. Nothing when the setting `back`
 * is null.
 * @param {object} chart The chart, with its `kit`, `settings` and `notes`.
 * @returns {HTMLElement} The toolbar the button is in, before the notes; other
 *   buttons of the chart's own may be added to it.
 */
export function mountToolbar(chart) {
  const { kit, settings } = chart;
  if (!chart.toolbar) {
    chart.toolbar = kit.createElement('div', 'bv-toolbar');
    chart.notes.before(chart.toolbar);
  }
  chart.toolbar.innerHTML = '';
  if (settings.back) {
    const back = kit.createElement('button', 'bv-back', settings.back.label);
    back.type = 'button';
    back.onclick = () => settings.back.action(chart);
    chart.toolbar.append(back);
  }
  return chart.toolbar;
}

/** The toolbar's look, for a chart's style sheet. */
export const toolbarStyles = (
  C
) => `${C} .bv-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem .7rem;margin:0 0 .6rem}
${C} .bv-toolbar:empty{display:none}
${C} .bv-toolbar button{font:inherit;font-size:.85rem;padding:.35rem .75rem;border:1px solid #b8c0cc;border-radius:6px;background:#fff;color:#1f2933;cursor:pointer}
${C} .bv-toolbar button[aria-pressed=true]{border-color:#0b62a4;background:#eaf2fb;color:#0b3d63;box-shadow:inset 0 0 0 1px #0b62a4}
${C} .bv-toolbar button:focus-visible{outline:2px solid #0b62a4;outline-offset:1px}`;
