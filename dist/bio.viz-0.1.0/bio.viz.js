var BioViz = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/main.js
  var main_exports = {};
  __export(main_exports, {
    core: () => core_exports,
    r: () => r_exports,
    version: () => version
  });

  // src/r/index.js
  var r_exports = {};
  __export(r_exports, {
    WEBR_BASE_URL: () => WEBR_BASE_URL,
    WEBR_VERSION: () => WEBR_VERSION,
    createConnection: () => createConnection,
    formatStatistic: () => formatStatistic
  });

  // src/r/canonical.js
  function order(value) {
    if (Array.isArray(value)) return value.map((item) => item === void 0 ? null : order(item));
    if (value && typeof value === "object") {
      const sorted = {};
      for (const key of Object.keys(value).sort()) {
        if (value[key] !== void 0) sorted[key] = order(value[key]);
      }
      return sorted;
    }
    return value;
  }
  function canonicalJson(value) {
    return JSON.stringify(order(value === void 0 ? null : value));
  }
  var isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

  // src/r/storedResults.js
  var keyFor = (name, args, dataId) => JSON.stringify([name, canonicalJson(args ?? {}), canonicalJson(dataId)]);
  var describe = (value) => typeof value === "string" ? `"${value}"` : canonicalJson(value);
  function createStore(results) {
    if (results === void 0 || results === null) return null;
    if (!Array.isArray(results)) {
      throw new TypeError("bio.viz: `results` must be an array of stored results.");
    }
    const entries = /* @__PURE__ */ new Map();
    results.forEach((entry, index) => {
      const where = `bio.viz: stored result ${index}`;
      if (!isPlainObject(entry)) throw new TypeError(`${where} must be an object.`);
      const { name, args, dataId, rows, value } = entry;
      if (typeof name !== "string" || name.trim() === "") {
        throw new TypeError(`${where} needs \`name\`, the R function that produced it.`);
      }
      if (args !== void 0 && !isPlainObject(args)) {
        throw new TypeError(`${where} (${name}): \`args\` must be an object of named arguments.`);
      }
      if (dataId === void 0 || dataId === null || dataId === "") {
        throw new TypeError(
          `${where} (${name}) needs \`dataId\`, the identity of the data it was computed on.`
        );
      }
      if (rows !== void 0 && (!Number.isInteger(rows) || rows < 0)) {
        throw new TypeError(`${where} (${name}): \`rows\` must be a whole number of rows.`);
      }
      if (value === void 0) {
        throw new TypeError(`${where} (${name}) needs \`value\`, what the function returned.`);
      }
      const key = keyFor(name, args, dataId);
      if (entries.has(key)) {
        throw new TypeError(
          `${where} (${name}) has the same name, arguments and data identity as an earlier one.`
        );
      }
      entries.set(key, { rows, value });
    });
    return entries;
  }
  function lookUp(store, name, { data, args, dataId }) {
    const miss = (detail) => ({
      hit: false,
      message: `Statistics are unavailable: no stored result for ${name} ${detail}.`
    });
    if (dataId === void 0 || dataId === null || dataId === "") {
      return miss("can be matched, because no data identity was given with the call");
    }
    const entry = store.get(keyFor(name, args, dataId));
    if (!entry) return miss(`with these arguments on the data ${describe(dataId)}`);
    if (entry.rows !== void 0) {
      const given2 = Array.isArray(data) ? data.length : "none";
      if (given2 !== entry.rows) {
        return miss(
          `fits the data given: it was computed on ${entry.rows} rows, and ${given2} were given`
        );
      }
    }
    return { hit: true, value: structuredClone(entry.value) };
  }

  // src/r/webREngine.js
  var WEBR_VERSION = "0.6.0";
  var WEBR_BASE_URL = `https://webr.r-wasm.org/v${WEBR_VERSION}/`;
  var R_HELPERS = `
.bioviz_column <- function(x) {
  if (is.factor(x)) return(as.character(x))
  if (inherits(x, "Date") || inherits(x, "POSIXt")) return(format(x))
  if (is.list(x)) return(lapply(unname(x), .bioviz_plain))
  as.vector(x)
}
.bioviz_plain <- function(x) {
  if (is.data.frame(x)) {
    return(list(.bioviz_frame = nrow(x), columns = lapply(x, .bioviz_column)))
  }
  if (is.factor(x)) return(as.character(x))
  if (inherits(x, "Date") || inherits(x, "POSIXt")) return(format(x))
  if (is.list(x)) return(lapply(x, .bioviz_plain))
  x
}
.bioviz_call <- function(name, columns = NULL, args = NULL) {
  tryCatch({
    data <- if (is.null(columns)) {
      data.frame()
    } else {
      as.data.frame(columns, stringsAsFactors = FALSE, check.names = FALSE)
    }
    value <- do.call(name, c(list(quote(data)), as.list(args)))
    list(ok = TRUE, value = .bioviz_plain(value))
  }, error = function(e) list(ok = FALSE, message = conditionMessage(e)))
}
`;
  var importFromUrl = (url) => import(
    /* @vite-ignore */
    url
  );
  async function fetchTextFromUrl(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return response.text();
  }
  function resolveBase(baseUrl) {
    const withSlash = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return typeof document === "undefined" ? withSlash : new URL(withSlash, document.baseURI).href;
  }
  function recordsToColumns(records) {
    const columns = {};
    const rows = Array.isArray(records) ? records : [];
    rows.forEach((record, index) => {
      for (const name of Object.keys(record || {})) {
        if (!(name in columns)) columns[name] = new Array(rows.length).fill(null);
        const value = record[name];
        columns[name][index] = value === void 0 || Number.isNaN(value) ? null : value;
      }
    });
    return columns;
  }
  var ATOMIC = /* @__PURE__ */ new Set(["logical", "integer", "double", "character"]);
  var allNamed = (names) => Array.isArray(names) && names.length > 0 && names.every((name) => name !== null && name !== "");
  var FRAME = ".bioviz_frame";
  function frameRows(node) {
    const count = node.values[0].values[0];
    const columns = node.values[1];
    const names = columns.names || [];
    const values = columns.values.map(
      (column) => column.type === "list" ? column.values.map(toPlain) : column.values
    );
    return Array.from(
      { length: count },
      (unused, row) => Object.fromEntries(names.map((name, column) => [name, values[column][row] ?? null]))
    );
  }
  function toPlain(node) {
    if (!node || node.type === "null") return null;
    if (node.type === "list") {
      if (Array.isArray(node.names) && node.names[0] === FRAME) return frameRows(node);
      const values = node.values.map(toPlain);
      if (!allNamed(node.names)) return values;
      return Object.fromEntries(node.names.map((name, index) => [name, values[index]]));
    }
    if (ATOMIC.has(node.type)) {
      if (allNamed(node.names)) {
        return Object.fromEntries(node.names.map((name, index) => [name, node.values[index]]));
      }
      return node.values.length === 1 ? node.values[0] : [...node.values];
    }
    throw new Error(`bio.viz: R returned a ${node.type}, which has no plain JavaScript form`);
  }
  async function toRList(shelter, object) {
    const members = {};
    for (const [name, value] of Object.entries(object)) {
      members[name] = value !== null && typeof value === "object" && !Array.isArray(value) ? await toRList(shelter, value) : value;
    }
    return new shelter.RList(members);
  }
  function createWebREngine({
    importModule = importFromUrl,
    fetchText = fetchTextFromUrl
  } = {}) {
    let webR = null;
    return {
      async start({ baseUrl = WEBR_BASE_URL, packages = [], source, sourceUrl } = {}) {
        const base = resolveBase(baseUrl);
        const { WebR, ChannelType } = await importModule(`${base}webr.mjs`);
        const instance = new WebR({
          baseUrl: base,
          channelType: ChannelType.PostMessage,
          interactive: false
        });
        try {
          await instance.init();
          if (packages.length > 0) {
            await instance.installPackages(packages, { quiet: true });
            for (const name of packages) {
              await instance.evalRVoid(`library(${JSON.stringify(name)}, character.only = TRUE)`);
            }
          }
          await instance.evalRVoid(R_HELPERS);
          const code = sourceUrl ? await fetchText(sourceUrl) : source;
          if (code) await instance.evalRVoid(code);
        } catch (error) {
          if (typeof instance.close === "function") instance.close();
          throw error;
        }
        webR = instance;
      },
      async call(name, { data, args } = {}) {
        const columns = recordsToColumns(data);
        const hasColumns = Object.keys(columns).length > 0;
        const hasArgs = args && Object.keys(args).length > 0;
        const code = `.bioviz_call(.bioviz_name, ${hasColumns ? ".bioviz_columns" : "NULL"}, ${hasArgs ? ".bioviz_args" : "NULL"})`;
        const shelter = await new webR.Shelter();
        try {
          const env = { ".bioviz_name": name };
          if (hasColumns) env[".bioviz_columns"] = await toRList(shelter, columns);
          if (hasArgs) env[".bioviz_args"] = await toRList(shelter, args);
          const result = await shelter.evalR(code, { env });
          const answer = toPlain(await result.toJs());
          if (!answer || answer.ok !== true) {
            throw new Error(
              answer && typeof answer.message === "string" && answer.message !== "" ? answer.message : "R stopped without a message"
            );
          }
          return answer.value === void 0 ? null : answer.value;
        } finally {
          await shelter.purge();
        }
      }
    };
  }

  // src/r/connection.js
  var PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9.]*$/;
  var unavailable = (reason, message) => ({ status: "unavailable", reason, message });
  var failed = (message) => ({ status: "error", message });
  function messageOf(thrown) {
    if (thrown instanceof Error && thrown.message) return thrown.message;
    if (typeof thrown === "string" && thrown !== "") return thrown;
    if (thrown && typeof thrown.message === "string" && thrown.message !== "") return thrown.message;
    return "R stopped without a message";
  }
  function readBrowser(browser) {
    if (browser === void 0 || browser === null) return null;
    if (!isPlainObject(browser)) {
      throw new TypeError("bio.viz: `browser` must be an object of settings.");
    }
    const { baseUrl = WEBR_BASE_URL, packages = [], source, sourceUrl, engine } = browser;
    if (typeof baseUrl !== "string" || baseUrl === "") {
      throw new TypeError("bio.viz: `browser.baseUrl` must be the URL webR is served from.");
    }
    if (!Array.isArray(packages)) {
      throw new TypeError("bio.viz: `browser.packages` must be an array of R package names.");
    }
    for (const name of packages) {
      if (typeof name !== "string" || !PACKAGE_NAME.test(name)) {
        throw new TypeError(`bio.viz: \`browser.packages\` holds an invalid package name: ${name}`);
      }
    }
    if (source !== void 0 && typeof source !== "string") {
      throw new TypeError("bio.viz: `browser.source` must be R source text.");
    }
    if (sourceUrl !== void 0 && typeof sourceUrl !== "string") {
      throw new TypeError("bio.viz: `browser.sourceUrl` must be the URL of a file of R source.");
    }
    if (source !== void 0 && sourceUrl !== void 0) {
      throw new TypeError("bio.viz: give `browser.source` or `browser.sourceUrl`, not both.");
    }
    if (engine !== void 0 && (!engine || typeof engine.start !== "function" || typeof engine.call !== "function")) {
      throw new TypeError("bio.viz: `browser.engine` must have `start` and `call` methods.");
    }
    return {
      engine: engine || createWebREngine(),
      config: { baseUrl, packages: [...packages], source, sourceUrl }
    };
  }
  function misuse(name, request) {
    if (typeof name !== "string" || name.trim() === "") {
      return "bio.viz: run() needs the name of an R function.";
    }
    if (!isPlainObject(request)) {
      return "bio.viz: run() takes the name and an object: { data, args, dataId }.";
    }
    if (request.data !== void 0 && !Array.isArray(request.data)) {
      return "bio.viz: `data` must be an array of records, one object per row.";
    }
    if (request.args !== void 0 && !isPlainObject(request.args)) {
      return "bio.viz: `args` must be an object of named arguments.";
    }
    return null;
  }
  function createConnection(options = {}) {
    if (!isPlainObject(options)) {
      throw new TypeError("bio.viz: createConnection takes an object of settings.");
    }
    const store = createStore(options.results);
    const browser = readBrowser(options.browser);
    let starting = null;
    function started() {
      if (!starting) {
        starting = Promise.resolve().then(() => browser.engine.start({ ...browser.config })).catch((error) => {
          starting = null;
          throw error;
        });
      }
      return starting;
    }
    async function run(name, request = {}) {
      try {
        const problem = misuse(name, request);
        if (problem) return failed(problem);
        const { data, args, dataId } = request;
        let missed = null;
        if (store) {
          const found = lookUp(store, name, { data, args, dataId });
          if (found.hit) return { status: "ok", value: found.value, form: "precomputed" };
          missed = found.message;
        }
        if (!browser) {
          return missed ? unavailable("not-precomputed", missed) : unavailable(
            "no-r-attached",
            "Statistics are unavailable: no R is attached to this chart."
          );
        }
        try {
          await started();
        } catch (error) {
          return unavailable(
            "load-failed",
            `Statistics are unavailable: R could not be started (${messageOf(error)}).`
          );
        }
        try {
          const value = await browser.engine.call(name, { data, args });
          return { status: "ok", value, form: "browser" };
        } catch (error) {
          return failed(messageOf(error));
        }
      } catch (error) {
        return failed(messageOf(error));
      }
    }
    return Object.freeze({ run });
  }

  // src/r/formatStatistic.js
  var text = (value) => typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  var isCount = (value) => Number.isInteger(value) && value >= 0;
  function formatCounts(counts) {
    if (isCount(counts)) return `n = ${counts}`;
    if (!counts || typeof counts !== "object" || Array.isArray(counts)) return null;
    const groups = Object.entries(counts);
    if (groups.length === 0 || !groups.every(([, n]) => isCount(n))) return null;
    return groups.map(([group, n]) => group === "n" ? `n = ${n}` : `${group} n = ${n}`).join(", ");
  }
  function formatP(p) {
    const rounded = p.toFixed(3);
    if (p < 1e-3 || rounded === "0.000") return "p < 0.001";
    if (rounded === "1.000") return "p > 0.999";
    return `p = ${rounded}`;
  }
  var refused = (what) => ({ status: "refused", text: `p-value not shown: ${what}.` });
  function formatStatistic(statistic) {
    const result = statistic && typeof statistic === "object" ? statistic : {};
    const method = text(result.method);
    const counts = formatCounts(result.counts);
    const reason = text(result.reason);
    if (reason) {
      const lead = method ? `${method}: not computed, ${reason}` : `Not computed, ${reason}`;
      return { status: "withheld", text: counts ? `${lead} (${counts}).` : `${lead}.` };
    }
    const p = result.p_value;
    if (typeof p !== "number" || !(p >= 0 && p <= 1)) {
      return refused("the result has no p-value between 0 and 1");
    }
    if (!method) return refused("the result does not name its method");
    if (!counts) return refused("the result does not give the counts it used");
    const adjustment = text(result.adjustment);
    const label2 = adjustment && adjustment.toLowerCase() !== "none" ? `Exploratory, adjusted (${adjustment}).` : "Exploratory, unadjusted.";
    return { status: "shown", text: `${method}: ${formatP(p)} (${counts}). ${label2}` };
  }

  // src/core/index.js
  var core_exports = {};
  __export(core_exports, {
    BASELINE_STATS: () => BASELINE_STATS,
    DEFAULT_SETTINGS: () => DEFAULT_SETTINGS,
    DROPPED: () => DROPPED,
    UNUSED: () => UNUSED,
    VALUE_TYPES: () => VALUE_TYPES,
    frame: () => frame,
    label: () => label,
    variable: () => variable,
    visits: () => visits
  });

  // src/core/variable.js
  var VALUE_TYPES = Object.freeze([
    "raw",
    "baseline",
    "change",
    "fold_change",
    "percent_change"
  ]);
  var KEYS = ["measure", "visit", "value", "col", "type", "cut"];
  var isText = (value) => typeof value === "string" && value.trim() !== "";
  var given = (value) => value !== void 0 && value !== null;
  var refuse = (message) => {
    throw new TypeError(`bio.viz: ${message}`);
  };
  function variable(spec) {
    if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
      refuse(
        "a variable must be an object: { measure, visit, value } for a biomarker at a visit, or { col } for a column."
      );
    }
    const written = JSON.stringify(spec);
    const unknown = Object.keys(spec).filter((key) => key !== "kind" && !KEYS.includes(key));
    if (unknown.length) {
      refuse(
        `the variable ${written} has a key that is not known: ${unknown.join(", ")}. A variable takes ${KEYS.filter((key) => key !== "cut").join(", ")}.`
      );
    }
    if (given(spec.cut)) {
      refuse(
        `the variable ${written} asks for a cut, and the cut rule is not available yet: it arrives with cross-tabulation. Until then a group comes from a column.`
      );
    }
    const hasMeasure = given(spec.measure);
    const hasColumn2 = given(spec.col);
    if (hasMeasure === hasColumn2) {
      refuse(
        `the variable ${written} must name a biomarker (\`measure\`) or a column (\`col\`), and it names ${hasMeasure ? "both" : "neither"}.`
      );
    }
    if (hasColumn2) {
      if (!isText(spec.col)) refuse(`the variable ${written}: \`col\` must be the name of a column.`);
      for (const key of ["visit", "value"]) {
        if (given(spec[key])) {
          refuse(`the variable ${written} is a column, and a column takes no \`${key}\`.`);
        }
      }
      if (given(spec.type) && spec.type !== "number") {
        refuse(
          `the variable ${written}: \`type\` can only be 'number', to read the column as a number.`
        );
      }
      return Object.freeze({ kind: "column", col: spec.col, type: spec.type ?? null });
    }
    if (!isText(spec.measure)) {
      refuse(`the variable ${written}: \`measure\` must be the name of a biomarker.`);
    }
    if (given(spec.type)) {
      refuse(
        `the variable ${written} is a biomarker, which is always a number: it takes no \`type\`.`
      );
    }
    const value = spec.value ?? "raw";
    if (!VALUE_TYPES.includes(value)) {
      refuse(
        `the variable ${written}: \`value\` must be one of ${VALUE_TYPES.join(", ")}, and it is ${JSON.stringify(spec.value)}.`
      );
    }
    if (value === "baseline") {
      if (given(spec.visit)) {
        refuse(
          `the variable ${written} is a baseline value, which is read at the baseline visits named in settings: it takes no \`visit\`.`
        );
      }
      return Object.freeze({ kind: "measure", measure: spec.measure, visit: null, value });
    }
    if (!isText(spec.visit)) {
      refuse(`the variable ${written} must name its visit: \`visit\` is missing or empty.`);
    }
    return Object.freeze({ kind: "measure", measure: spec.measure, visit: spec.visit, value });
  }
  var WORDS = {
    change: "change from baseline",
    fold_change: "fold change from baseline",
    percent_change: "percent change from baseline"
  };
  function label(spec) {
    const read = variable(spec);
    if (read.kind === "column") return read.col;
    if (read.value === "baseline") return `${read.measure} at baseline`;
    const at = `${read.measure} at ${read.visit}`;
    return read.value === "raw" ? at : `${at}, ${WORDS[read.value]}`;
  }

  // src/core/reasons.js
  var DROPPED = Object.freeze({
    NOT_IN_PARTICIPANT_TABLE: "Not in the participant table",
    NO_RESULT: "No result at the visit",
    MISSING_RESULT: "Result at the visit is missing or not a number",
    NO_BASELINE: "No baseline result",
    MISSING_BASELINE: "Baseline result is missing or not a number",
    ZERO_BASELINE: "Baseline is zero",
    NEGATIVE_BASELINE: "Baseline is negative",
    EMPTY_COLUMN: "Column is empty",
    VARYING_COLUMN: "Column has more than one value for the participant",
    NOT_A_NUMBER: "Column value is not a number"
  });
  var UNUSED = Object.freeze({
    NO_ID: "Row has no participant id",
    DUPLICATE_PARTICIPANT: "Later row for a participant already in the participant table",
    DUPLICATE_RESULT: "Later result for the same participant, biomarker and visit",
    MISSING_RESULT: "Result is missing or not a number"
  });

  // src/core/settings.js
  var BASELINE_STATS = Object.freeze(["mean", "min", "max", "first"]);
  var DEFAULT_SETTINGS = Object.freeze({
    id_col: "USUBJID",
    measure_col: "TEST",
    value_col: "STRESN",
    visit_col: "VISIT",
    visit_order_col: "VISITNUM",
    participant_id_col: null,
    baseline_visits: null,
    baseline_stat: "mean",
    required: null
  });
  var isText2 = (value) => typeof value === "string" && value.trim() !== "";
  var isPlainObject2 = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  var refuse2 = (message) => {
    throw new TypeError(`bio.viz: ${message}`);
  };
  function textList(value, name) {
    const list = typeof value === "string" ? [value] : value;
    if (!Array.isArray(list) || list.length === 0 || !list.every(isText2)) {
      refuse2(`\`${name}\` must be a name, or a list of names, and none of them empty.`);
    }
    return [...new Set(list)];
  }
  function readSettings(overrides) {
    if (overrides !== void 0 && overrides !== null && !isPlainObject2(overrides)) {
      refuse2("settings must be an object.");
    }
    const given2 = overrides || {};
    for (const key of Object.keys(given2)) {
      if (!(key in DEFAULT_SETTINGS)) {
        refuse2(
          `\`${key}\` is not a setting. The settings are ${Object.keys(DEFAULT_SETTINGS).join(", ")}.`
        );
      }
    }
    const settings = { ...DEFAULT_SETTINGS };
    for (const [key, value] of Object.entries(given2)) {
      if (value !== void 0) settings[key] = value;
    }
    for (const key of ["id_col", "measure_col", "value_col", "visit_col"]) {
      if (!isText2(settings[key])) refuse2(`\`${key}\` must be the name of a column.`);
    }
    for (const key of ["visit_order_col", "participant_id_col"]) {
      if (settings[key] !== null && !isText2(settings[key])) {
        refuse2(`\`${key}\` must be the name of a column, or null.`);
      }
    }
    if (settings.baseline_visits !== null) {
      settings.baseline_visits = textList(settings.baseline_visits, "baseline_visits");
    }
    if (!BASELINE_STATS.includes(settings.baseline_stat)) {
      refuse2(`\`baseline_stat\` must be one of ${BASELINE_STATS.join(", ")}.`);
    }
    if (settings.required !== null) {
      if (!Array.isArray(settings.required) || !settings.required.every(isText2)) {
        refuse2("`required` must be a list of the names of variables, or null for all of them.");
      }
      settings.required = [...new Set(settings.required)];
    }
    return settings;
  }

  // src/core/frame.js
  var refuse3 = (message) => {
    throw new TypeError(`bio.viz: ${message}`);
  };
  var isPlainObject3 = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  var isBlank = (value) => value === void 0 || value === null || typeof value === "number" && Number.isNaN(value) || typeof value === "string" && value.trim() === "";
  function toNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" || value.trim() === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  var hasColumn = (rows, column) => rows.some((row) => row !== null && column in row);
  function readTable(table, name) {
    if (!Array.isArray(table) || !table.every(isPlainObject3)) {
      refuse3(`\`${name}\` must be an array of records, one object per row.`);
    }
    return table;
  }
  function needColumn(rows, column, setting, table) {
    if (!hasColumn(rows, column)) {
      refuse3(`the ${table} table has no column \`${column}\` (\`${setting}\`).`);
    }
  }
  function visitsInOrder(results, settings) {
    const byName = (a, b) => String(a).localeCompare(String(b), void 0, { numeric: true });
    const ordered = settings.visit_order_col !== null && hasColumn(results, settings.visit_order_col);
    const order2 = /* @__PURE__ */ new Map();
    for (const row of results) {
      const visit = row[settings.visit_col];
      if (isBlank(visit) || order2.has(String(visit))) continue;
      if (toNumber(row[settings.value_col]) === null) continue;
      order2.set(String(visit), ordered ? toNumber(row[settings.visit_order_col]) : null);
    }
    return [...order2.keys()].sort((a, b) => {
      const [first, second] = [order2.get(a), order2.get(b)];
      if (first !== null && second !== null && first !== second) return first - second;
      return byName(a, b);
    });
  }
  function visits(results, settings) {
    const config = readSettings(settings);
    const rows = readTable(results, "results");
    if (!rows.length) return [];
    needColumn(rows, config.visit_col, "visit_col", "results");
    needColumn(rows, config.value_col, "value_col", "results");
    return visitsInOrder(rows, config);
  }
  var STATS = {
    mean: (values) => values.reduce((sum, value) => sum + value, 0) / values.length,
    min: (values) => Math.min(...values),
    max: (values) => Math.max(...values),
    first: (values) => values[0]
  };
  function frame(tables, variables, settings) {
    const config = readSettings(settings);
    if (!isPlainObject3(tables))
      refuse3("frame() takes the tables as an object: { results, participants }.");
    for (const key of Object.keys(tables)) {
      if (!["results", "participants"].includes(key)) {
        refuse3(`frame() takes the tables \`results\` and \`participants\`, not \`${key}\`.`);
      }
    }
    const results = readTable(tables.results, "results");
    const participantTable = tables.participants === void 0 || tables.participants === null ? null : readTable(tables.participants, "participants");
    if (!isPlainObject3(variables) || Object.keys(variables).length === 0) {
      refuse3("frame() takes the variables as an object, each under the name of its field.");
    }
    const idCol = config.id_col;
    const named = Object.entries(variables).map(([name, spec]) => {
      if (name.trim() === "" || name !== name.trim()) {
        refuse3("a variable needs a name with no space at either end: it is the name of its field.");
      }
      if (name === idCol) {
        refuse3(`a variable cannot be named \`${name}\`: that field holds the participant's id.`);
      }
      return { name, variable: variable(spec) };
    });
    const required = new Set(
      config.required === null ? named.map(({ name }) => name) : config.required
    );
    for (const name of required) {
      if (!named.some((entry) => entry.name === name)) {
        refuse3(`\`required\` names \`${name}\`, which is not one of the variables.`);
      }
    }
    const unusedCounts = /* @__PURE__ */ new Map();
    const unused = (reason, table, n = 1) => {
      const key = `${table}\0${reason}`;
      unusedCounts.set(key, (unusedCounts.get(key) || 0) + n);
    };
    needColumn(results, idCol, "id_col", "results");
    const measures = named.filter(({ variable: variable2 }) => variable2.kind === "measure");
    const needsBaseline = measures.some(({ variable: variable2 }) => variable2.value !== "raw");
    if (measures.length) {
      needColumn(results, config.measure_col, "measure_col", "results");
      needColumn(results, config.visit_col, "visit_col", "results");
      needColumn(results, config.value_col, "value_col", "results");
    }
    const participantIdCol = config.participant_id_col || idCol;
    if (participantTable) {
      needColumn(participantTable, participantIdCol, "participant_id_col", "participant");
    }
    const columnSource = /* @__PURE__ */ new Map();
    for (const { variable: variable2 } of named) {
      if (variable2.kind !== "column") continue;
      if (participantTable && hasColumn(participantTable, variable2.col)) {
        columnSource.set(variable2.col, "participants");
      } else if (hasColumn(results, variable2.col)) {
        columnSource.set(variable2.col, "results");
      } else {
        refuse3(
          `no table has the column \`${variable2.col}\`: it is not in the ${participantTable ? "participant table or the " : ""}results table.`
        );
      }
    }
    const resultRows = /* @__PURE__ */ new Map();
    for (const row of results) {
      if (isBlank(row[idCol])) {
        unused(UNUSED.NO_ID, "results");
        continue;
      }
      const id = String(row[idCol]);
      if (!resultRows.has(id)) resultRows.set(id, []);
      resultRows.get(id).push(row);
    }
    const participantRow = /* @__PURE__ */ new Map();
    let ids = [...resultRows.keys()];
    let notInTable = 0;
    if (participantTable) {
      for (const row of participantTable) {
        if (isBlank(row[participantIdCol])) {
          unused(UNUSED.NO_ID, "participants");
        } else if (participantRow.has(String(row[participantIdCol]))) {
          unused(UNUSED.DUPLICATE_PARTICIPANT, "participants");
        } else {
          participantRow.set(String(row[participantIdCol]), row);
        }
      }
      notInTable = ids.filter((id) => !participantRow.has(id)).length;
      ids = [...participantRow.keys()];
    }
    let baselineVisits = null;
    if (needsBaseline) {
      baselineVisits = config.baseline_visits || visitsInOrder(results, config).slice(0, 1);
    }
    const consulted = /* @__PURE__ */ new Map();
    for (const { variable: variable2 } of measures) {
      if (!consulted.has(variable2.measure)) consulted.set(variable2.measure, /* @__PURE__ */ new Set());
      const visits2 = consulted.get(variable2.measure);
      if (variable2.visit !== null) visits2.add(variable2.visit);
      if (variable2.value !== "raw") baselineVisits.forEach((visit) => visits2.add(visit));
    }
    const cells = /* @__PURE__ */ new Map();
    const cellKey = (id, measure, visit) => `${id}\0${measure}\0${visit}`;
    for (const id of ids) {
      for (const row of resultRows.get(id) || []) {
        const measure = String(row[config.measure_col]);
        const visit = String(row[config.visit_col]);
        if (!consulted.has(measure) || !consulted.get(measure).has(visit)) continue;
        const key = cellKey(id, measure, visit);
        if (!cells.has(key)) cells.set(key, { rows: 0, values: [] });
        const cell = cells.get(key);
        cell.rows += 1;
        const number = toNumber(row[config.value_col]);
        if (number === null) {
          unused(UNUSED.MISSING_RESULT, "results");
        } else {
          if (cell.values.length) unused(UNUSED.DUPLICATE_RESULT, "results");
          cell.values.push(number);
        }
      }
    }
    const resultAt = (id, measure, visit) => {
      const cell = cells.get(cellKey(id, measure, visit));
      if (!cell) return { reason: DROPPED.NO_RESULT };
      if (!cell.values.length) return { reason: DROPPED.MISSING_RESULT };
      return { value: cell.values[0] };
    };
    const baselineOf = (id, measure) => {
      const found = baselineVisits.map((visit) => resultAt(id, measure, visit));
      const values = found.filter((entry) => "value" in entry).map((entry) => entry.value);
      if (values.length) return { value: STATS[config.baseline_stat](values) };
      const missing = found.some((entry) => entry.reason === DROPPED.MISSING_RESULT);
      return { reason: missing ? DROPPED.MISSING_BASELINE : DROPPED.NO_BASELINE };
    };
    const measureValue = (id, { measure, visit, value }) => {
      if (value === "raw") return resultAt(id, measure, visit);
      if (value === "baseline") return baselineOf(id, measure);
      const at = resultAt(id, measure, visit);
      if ("reason" in at) return at;
      const baseline = baselineOf(id, measure);
      if ("reason" in baseline) return baseline;
      if (value === "change") return { value: at.value - baseline.value };
      if (baseline.value === 0) return { reason: DROPPED.ZERO_BASELINE };
      if (baseline.value < 0) return { reason: DROPPED.NEGATIVE_BASELINE };
      if (value === "fold_change") return { value: at.value / baseline.value };
      return { value: 100 * (at.value - baseline.value) / baseline.value };
    };
    const columnValue = (id, { col, type }) => {
      let found;
      if (columnSource.get(col) === "participants") {
        found = participantRow.get(id)[col];
        if (isBlank(found)) return { reason: DROPPED.EMPTY_COLUMN };
      } else {
        const distinct = /* @__PURE__ */ new Map();
        for (const row of resultRows.get(id) || []) {
          if (!isBlank(row[col]) && !distinct.has(String(row[col])))
            distinct.set(String(row[col]), row[col]);
        }
        if (distinct.size === 0) return { reason: DROPPED.EMPTY_COLUMN };
        if (distinct.size > 1) return { reason: DROPPED.VARYING_COLUMN };
        [found] = distinct.values();
      }
      if (type !== "number") return { value: found };
      const number = toNumber(found);
      return number === null ? { reason: DROPPED.NOT_A_NUMBER } : { value: number };
    };
    const data = [];
    const droppedCounts = /* @__PURE__ */ new Map();
    for (const id of ids) {
      const source = participantRow.get(id) || (resultRows.get(id) || [])[0];
      const record = { [idCol]: source[participantRow.has(id) ? participantIdCol : idCol] };
      let leftOut = null;
      for (const { name, variable: variable2 } of named) {
        const found = variable2.kind === "measure" ? measureValue(id, variable2) : columnValue(id, variable2);
        if ("value" in found) {
          record[name] = found.value;
        } else if (required.has(name)) {
          leftOut = { name, reason: found.reason };
          break;
        } else {
          record[name] = null;
        }
      }
      if (leftOut) {
        const key = `${leftOut.name}\0${leftOut.reason}`;
        droppedCounts.set(key, (droppedCounts.get(key) || 0) + 1);
      } else {
        data.push(record);
      }
    }
    const reasons = Object.values(DROPPED);
    const dropped = [];
    if (notInTable) {
      dropped.push({ reason: DROPPED.NOT_IN_PARTICIPANT_TABLE, variable: null, n: notInTable });
    }
    for (const { name } of named) {
      for (const reason of reasons) {
        const n = droppedCounts.get(`${name}\0${reason}`);
        if (n) dropped.push({ reason, variable: name, n });
      }
    }
    const unusedList = [];
    for (const table of ["results", "participants"]) {
      for (const reason of Object.values(UNUSED)) {
        const n = unusedCounts.get(`${table}\0${reason}`);
        if (n) unusedList.push({ reason, table, n });
      }
    }
    return {
      data,
      id_col: idCol,
      variables: Object.fromEntries(named.map(({ name, variable: variable2 }) => [name, variable2])),
      participants: ids.length + notInTable,
      dropped,
      unused: unusedList,
      baseline_visits: baselineVisits
    };
  }

  // src/main.js
  var version = "0.1.0";
  return __toCommonJS(main_exports);
})();
//# sourceMappingURL=bio.viz.js.map
