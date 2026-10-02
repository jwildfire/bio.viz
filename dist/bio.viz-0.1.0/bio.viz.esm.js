var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/r/index.js
var r_exports = {};
__export(r_exports, {
  WEBR_BASE_URL: () => WEBR_BASE_URL,
  WEBR_VERSION: () => WEBR_VERSION,
  createConnection: () => createConnection,
  formatComparison: () => formatComparison,
  formatEstimate: () => formatEstimate,
  formatStatistic: () => formatStatistic
});

// src/r/canonical.js
function order(value) {
  if (Array.isArray(value)) return value.map((item) => item === void 0 ? null : order(item));
  if (value && typeof value === "object") {
    const sorted2 = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== void 0) sorted2[key] = order(value[key]);
    }
    return sorted2;
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
var ADJUSTMENTS = {
  holm: "Holm",
  hochberg: "Hochberg",
  hommel: "Hommel",
  bonferroni: "Bonferroni",
  BH: "Benjamini-Hochberg",
  fdr: "Benjamini-Hochberg",
  BY: "Benjamini-Yekutieli"
};
function adjustmentName(adjustment) {
  const named = text(adjustment);
  if (!named || named.toLowerCase() === "none") return null;
  return Object.hasOwn(ADJUSTMENTS, named) ? ADJUSTMENTS[named] : named;
}
var formatLabel = (adjustment) => adjustment ? `Exploratory, adjusted (${adjustment}).` : "Exploratory, unadjusted.";
var ENDS_A_SENTENCE = /[.!?]$/;
var SAYS_NOT_COMPUTED = /^not computed\b/i;
var withCounts = (lead, counts) => {
  if (ENDS_A_SENTENCE.test(lead)) return counts ? `${lead} Counts: ${counts}.` : lead;
  return counts ? `${lead} (${counts}).` : `${lead}.`;
};
var refused = (what) => ({ status: "refused", text: `p-value not shown: ${what}.` });
function read(statistic) {
  const result = statistic && typeof statistic === "object" ? statistic : {};
  const method = text(result.method);
  const counts = formatCounts(result.counts);
  const reason = text(result.reason);
  if (result.status === "error") {
    return {
      status: "error",
      text: withCounts(`R reported an error: ${reason || "no message"}`, counts)
    };
  }
  if (reason) {
    const lead = SAYS_NOT_COMPUTED.test(reason) ? reason : method ? `${method}: not computed, ${reason}` : `Not computed, ${reason}`;
    return { status: "withheld", text: withCounts(lead, counts) };
  }
  const p = result.p_value;
  if (typeof p !== "number" || !(p >= 0 && p <= 1)) {
    return refused("the result has no p-value between 0 and 1");
  }
  if (!method) return refused("the result does not name its method");
  if (!counts) return refused("the result does not give the counts it used");
  const adjustment = adjustmentName(result.adjustment);
  const label2 = formatLabel(adjustment);
  const shown2 = formatP(p);
  return {
    status: "shown",
    text: `${method}: ${shown2} (${counts}). ${label2}`,
    method,
    p: shown2,
    adjustment,
    label: label2
  };
}
function formatStatistic(statistic) {
  const { status, text: sentence2 } = read(statistic);
  return { status, text: sentence2 };
}
var figure = (value) => String(Number(value.toPrecision(4)));
var isNumber = (value) => typeof value === "number" && Number.isFinite(value);
function formatEstimate(estimate) {
  const row = estimate && typeof estimate === "object" ? estimate : {};
  const refuse5 = (what) => ({ status: "refused", text: `Estimate not shown: ${what}.` });
  const name = text(row.name);
  if (!name) return refuse5("it has no name");
  if (!isNumber(row.estimate)) return refuse5(`${name} is not a number`);
  const group = text(row.group);
  const lead = `${name}${group ? ` (${group})` : ""}: ${figure(row.estimate)}`;
  const bounds = [row.lower, row.upper, row.level];
  const absent = (value) => value === void 0 || value === null;
  if (bounds.every(absent)) return { status: "shown", text: `${lead}.` };
  if (!bounds.every(isNumber) || !(row.level > 0 && row.level < 1)) {
    return refuse5(`the interval of ${name} is incomplete`);
  }
  const percent = Number((row.level * 100).toPrecision(12));
  return {
    status: "shown",
    text: `${lead}, ${percent}% confidence interval ${figure(row.lower)} to ${figure(row.upper)}.`
  };
}
function formatComparison(comparison) {
  const row = comparison && typeof comparison === "object" ? comparison : {};
  const groups = [text(row.group_1), text(row.group_2)];
  const n = [row.n_1, row.n_2];
  const named = groups.every(Boolean);
  const counted = named && n.every(isCount);
  const parts = read({
    status: row.status,
    method: row.method,
    p_value: row.p_value,
    adjustment: row.adjustment,
    reason: row.reason,
    counts: counted ? { [groups[0]]: n[0], [groups[1]]: n[1] } : void 0
  });
  const pair = { groups: named ? groups : null, n: counted ? n : null };
  const shown2 = named && parts.status === "shown";
  const result = named ? parts.text : refused("the comparison does not name its two groups").text;
  return {
    status: named ? parts.status : "refused",
    text: named ? `${groups[0]} and ${groups[1]}: ${result}` : result,
    result,
    ...pair,
    method: shown2 ? parts.method : null,
    p: shown2 ? parts.p : null,
    adjustment: shown2 ? parts.adjustment : null,
    label: shown2 ? parts.label : null
  };
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
  const read2 = variable(spec);
  if (read2.kind === "column") return read2.col;
  if (read2.value === "baseline") return `${read2.measure} at baseline`;
  const at = `${read2.measure} at ${read2.visit}`;
  return read2.value === "raw" ? at : `${at}, ${WORDS[read2.value]}`;
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
  mean: (values) => values.reduce((sum2, value) => sum2 + value, 0) / values.length,
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

// src/shared/chartHost.js
var PALETTE = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#9333ea",
  "#dc2626",
  "#0891b2",
  "#65a30d",
  "#db2777",
  "#4b5563",
  "#ca8a04"
];
var hexToRgba = (hex, alpha) => {
  const value = hex.replace("#", "");
  const part = (at) => parseInt(value.slice(at, at + 2), 16);
  return `rgba(${part(0)}, ${part(2)}, ${part(4)}, ${alpha})`;
};
var shown = (value) => Number.isFinite(value) ? String(Number(value.toPrecision(4))) : "";
var isRecordTable = (table) => Array.isArray(table) && table.every((row) => row !== null && typeof row === "object" && !Array.isArray(row));
function findKit(chart) {
  const kit = globalThis.SafetyViz && globalThis.SafetyViz.kit;
  if (!kit || typeof kit.renderShell !== "function" || typeof kit.Chart !== "function") {
    throw new Error(
      `bio.viz: ${chart} is built from safety.viz's kit, and \`SafetyViz.kit\` was not found. Load safety.viz's bundle on the page before bio.viz makes a chart.`
    );
  }
  return kit;
}
function applyStyles(id, styles) {
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = styles;
  document.head.append(style);
}
var lineStyles = (root) => `
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
function mountShell(chart, { moduleClass, styleId, styles, listingFile }) {
  const { kit } = chart;
  Object.assign(
    chart,
    kit.renderShell(chart.element, {
      moduleClass,
      onToggle: () => chart.resize()
    })
  );
  applyStyles(styleId, styles);
  chart.statLine = kit.createElement("div", "bv-statistic");
  chart.statLine.setAttribute("role", "status");
  chart.footnote.after(chart.statLine);
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
    listingSearch: "",
    listingSort: null,
    listingSelectedId: null,
    page: 1,
    profileRows: [],
    onListingRowClick: (row) => selectParticipant(chart, row[chart.settings.id_col])
  };
  chart.listingWrap.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest && event.target.closest("button");
      if (!button || button.textContent !== "Export: CSV") return;
      event.stopPropagation();
      event.preventDefault();
      downloadListing(chart, listingFile);
    },
    true
  );
  if (globalThis.matchMedia && globalThis.matchMedia("(max-width: 600px)").matches) {
    chart.sidebarToggle.click();
  }
}
function readGiven(chart, data) {
  const tables = Array.isArray(data) ? { results: data } : data || {};
  try {
    if (!isRecordTable(tables.results)) {
      throw new TypeError("bio.viz: `results` must be an array of records, one object per row.");
    }
    if (tables.participants != null && !isRecordTable(tables.participants)) {
      throw new TypeError(
        "bio.viz: `participants` must be an array of records, one object per row."
      );
    }
    for (const key of ["id_col", "measure_col", "value_col", "visit_col"]) {
      const column = chart.settings[key];
      if (tables.results.length && !tables.results.some((row) => column in row)) {
        throw new TypeError(`bio.viz: the results table has no column \`${column}\` (\`${key}\`).`);
      }
    }
  } catch (error) {
    chart.destroyCharts();
    chart.element.innerHTML = "";
    chart.element.append(chart.kit.createElement("div", "sv-warning", error.message));
    throw error;
  }
  return {
    results: tables.results,
    participants: tables.participants && tables.participants.length ? tables.participants : null
  };
}
function syncHost(chart) {
  chart.host.settings.profile = chart.settings.profile;
  chart.host.settings.id_col = chart.settings.id_col;
  chart.host.settings.page_size = chart.settings.page_size;
}
function addFilterControls(chart, { addSection, addControl }, onChange) {
  const { kit, state } = chart;
  if (!chart.filterSpecs.length) return;
  const filters = addSection("Filters");
  const idCol = chart.settings.participant_id_col || chart.settings.id_col;
  chart.filterSpecs.forEach((spec) => {
    const values = [
      ...new Set(
        chart.tables.participants.map((row) => row[spec.value_col]).filter((entry) => entry !== void 0 && entry !== null && entry !== "").map(String)
      )
    ].sort((a, b) => a.localeCompare(b, void 0, { numeric: true }));
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
function filtersForScope(chart) {
  return chart.filterSpecs.map((spec) => ({ label: spec.label, selection: chart.state.filters[spec.value_col] })).filter(({ selection }) => selection !== null && selection !== void 0 && selection !== "").map(({ label: label2, selection }) => ({
    label: label2,
    values: (Array.isArray(selection) ? selection : [selection]).map(String)
  })).filter(({ values }) => values.length);
}
function statTable({ caption, head, rows }, kit) {
  const table = kit.createElement("table", "bv-stat-pairs");
  table.append(kit.createElement("caption", null, caption));
  const header = document.createElement("tr");
  head.forEach((title) => {
    const cell = kit.createElement("th", null, title);
    cell.scope = "col";
    header.append(cell);
  });
  const thead = document.createElement("thead");
  thead.append(header);
  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const line = document.createElement("tr");
    line.dataset.status = row.status;
    const lead = kit.createElement("th", null, row.head);
    lead.scope = "row";
    if (row.sub) lead.append(kit.createElement("span", "bv-stat-method", row.sub));
    line.append(lead, ...row.cells.map((cell) => kit.createElement("td", null, cell)));
    tbody.append(line);
  });
  table.append(thead, tbody);
  return table;
}
function writeStatistic(kit, line, description) {
  line.dataset.state = description.state;
  line.innerHTML = "";
  line.append(kit.createElement("p", "bv-stat-result", description.text));
  description.estimates.forEach(
    (said) => line.append(kit.createElement("p", "bv-stat-estimate", said))
  );
  if (description.table) line.append(statTable(description.table, kit));
  description.remarks.forEach(({ kind, text: text2 }) => {
    const remark = kit.createElement("p", "bv-stat-remark", text2);
    remark.dataset.kind = kind;
    line.append(remark);
  });
  if (description.scope) line.append(kit.createElement("p", "bv-stat-scope", description.scope));
}
function showListing(chart, { columns, rows }) {
  const { host, settings } = chart;
  const participantIdCol = settings.participant_id_col || settings.id_col;
  const byId = new Map(
    (chart.tables.participants || []).map((row) => [String(row[participantIdCol]), row])
  );
  host.settings.details = columns;
  host.currentTableData = rows.map((row) => ({
    ...byId.get(String(row[settings.id_col])) || {},
    ...row
  }));
  host.listingSearch = "";
  host.listingSort = null;
  host.page = 1;
  chart.kit.renderListing(host);
}
function selectParticipant(chart, id) {
  const { host } = chart;
  host.listingSelectedId = id == null ? null : String(id);
  if (host.currentTableData.length) chart.kit.renderListing(host);
  chart.root.dispatchEvent(
    new CustomEvent("participantsSelected", {
      detail: { data: id == null ? [] : [String(id)] },
      bubbles: true
    })
  );
}
function clearListing(chart) {
  const { host } = chart;
  host.currentTableData = [];
  host.listingSelectedId = null;
  chart.listingWrap.innerHTML = "";
  chart.kit.resetProfileRail(host);
}
function downloadListing(chart, file) {
  const { host, kit } = chart;
  let rows = kit.searchRows([...host.currentTableData], host.settings.details, host.listingSearch);
  if (host.listingSort) rows = kit.sortRows(rows, host.listingSort);
  const blob = new Blob([kit.buildCsv(rows, host.settings.details)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file;
  link.click();
  URL.revokeObjectURL(url);
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
function railSettings(chart, axisType) {
  const { settings } = chart;
  const details = settings.profile_details || chart.categories.filter((entry) => entry.table !== "results" || !chart.tables.participants).map(({ value_col, label: label2 }) => ({ value_col, label: label2 }));
  const rail = {
    ...railColumns(settings),
    details,
    // Every biomarker is a measure the rail shows, not only the four liver
    // tests it was made for.
    measure_values: Object.fromEntries(chart.measures.map((measure) => [measure, measure])),
    axis_type: axisType === "log" ? "log" : "linear",
    on_clear: () => selectParticipant(chart, null)
  };
  if (settings.normal_col_high) return rail;
  const none = { relative_uln: null, relative_baseline: null };
  return {
    ...rail,
    display: "relative_baseline",
    display_options: [{ value: "relative_baseline", label: "Multiple of first result" }],
    cuts: { defaults: none, TB: none, ALP: none }
  };
}
function buildProfileFeed(chart, settingsOf) {
  const { settings, host, kit } = chart;
  host.profileRows = [];
  if (!settings.profile) return;
  const participantIdCol = settings.participant_id_col || settings.id_col;
  const byId = new Map(
    (chart.tables.participants || []).map((row) => [String(row[participantIdCol]), row])
  );
  const ranged = Boolean(settings.normal_col_high);
  const feed = chart.tables.results.map((row) => ({
    ...byId.get(String(row[settings.id_col])) || {},
    ...row,
    ...ranged ? {} : { __bv_no_reference_range: 1 }
  }));
  host.profileRows = kit.buildProfileRows(feed, {
    ...railColumns(settings),
    normal_col_high: ranged ? settings.normal_col_high : "__bv_no_reference_range"
  });
  kit.mountProfileRail(host, settingsOf);
}

// src/shared/settings.js
var isText3 = (value) => typeof value === "string" && value.trim() !== "";
var isPlainObject4 = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var refuse4 = (message) => {
  throw new TypeError(`bio.viz: ${message}`);
};
function fieldSpec(value, setting) {
  if (isText3(value)) return { value_col: value, label: value };
  if (isPlainObject4(value) && isText3(value.value_col)) {
    return {
      ...value,
      value_col: value.value_col,
      label: isText3(value.label) ? value.label : value.value_col
    };
  }
  return refuse4(
    `\`${setting}\` holds something that is not a column name or { value_col, label }.`
  );
}
function fieldList(value, setting) {
  if (value === null || value === void 0) return null;
  const list = Array.isArray(value) ? value : [value];
  return list.map((entry) => fieldSpec(entry, setting));
}
function textList2(value, setting) {
  if (value === null || value === void 0) return null;
  const list = Array.isArray(value) ? value : [value];
  if (!list.length || !list.every((entry) => isText3(entry) || typeof entry === "number")) {
    refuse4(`\`${setting}\` must be a name, or a list of names.`);
  }
  return [...new Set(list.map(String))];
}
var columnOrNull = (settings, key) => {
  if (settings[key] !== null && !isText3(settings[key])) {
    refuse4(`\`${key}\` must be the name of a column, or null.`);
  }
};
function coreSettings(settings) {
  return {
    id_col: settings.id_col,
    measure_col: settings.measure_col,
    value_col: settings.value_col,
    visit_col: settings.visit_col,
    visit_order_col: settings.visit_order_col,
    participant_id_col: settings.participant_id_col,
    baseline_visits: settings.baseline_visits,
    baseline_stat: settings.baseline_stat
  };
}
function layOver(defaults, overrides, chart) {
  if (overrides !== void 0 && overrides !== null && !isPlainObject4(overrides)) {
    refuse4(`${chart} takes its settings as an object.`);
  }
  const given2 = overrides || {};
  for (const key of Object.keys(given2)) {
    if (!(key in defaults)) {
      refuse4(
        `\`${key}\` is not a setting of ${chart}. Its settings are ${Object.keys(defaults).join(", ")}.`
      );
    }
  }
  const settings = { ...defaults };
  for (const [key, value] of Object.entries(given2)) {
    if (value !== void 0) settings[key] = value;
  }
  return settings;
}
function checkShared(settings, baselineStats) {
  for (const key of ["id_col", "measure_col", "value_col", "visit_col"]) {
    if (!isText3(settings[key])) refuse4(`\`${key}\` must be the name of a column.`);
  }
  if (!baselineStats.includes(settings.baseline_stat)) {
    refuse4(`\`baseline_stat\` must be one of ${baselineStats.join(", ")}.`);
  }
  if (typeof settings.profile !== "boolean") refuse4("`profile` must be true or false.");
  if (settings.waiting_note !== null && !isText3(settings.waiting_note)) {
    refuse4("`waiting_note` must be a sentence, or null for none.");
  }
  if (settings.connection !== null && (typeof settings.connection !== "object" || typeof settings.connection.run !== "function")) {
    refuse4("`connection` must be a connection to R (BioViz.r.createConnection), or null.");
  }
}

// src/group-comparison/configure.js
var MARKS = Object.freeze(["box", "violin", "points"]);
var Y_SCALES = Object.freeze(["linear", "log"]);
var TESTS = Object.freeze(["t", "wilcoxon", "anova", "kruskal", "none"]);
var DEFAULT_SETTINGS2 = Object.freeze({
  // Columns of the results table, and of the participant table.
  id_col: "USUBJID",
  measure_col: "TEST",
  value_col: "STRESN",
  visit_col: "VISIT",
  visit_order_col: "VISITNUM",
  unit_col: "STRESU",
  participant_id_col: null,
  // How a baseline is found (the core's rules).
  baseline_visits: null,
  baseline_stat: "mean",
  // What the chart opens on.
  start_value: null,
  visits: null,
  value_type: "raw",
  group_by: null,
  levels: null,
  color_by: null,
  panel_by: null,
  mark: "box",
  y_scale: "linear",
  // What the controls offer.
  measures: null,
  groups: null,
  max_levels: 12,
  filters: null,
  // The overview of every biomarker: the most drawn at a time.
  overview_limit: 12,
  // The listing of participants.
  details: null,
  page_size: 10,
  // The statistics line.
  connection: null,
  statistic: "Analyze_GroupDifference",
  test: "t",
  pairwise: false,
  waiting_note: null,
  // safety.viz's participant profile.
  profile: true,
  profile_details: null,
  studyday_col: null,
  normal_col_high: null,
  normal_col_low: null
});
function syncSettings(overrides) {
  const settings = layOver(DEFAULT_SETTINGS2, overrides, "the group comparison chart");
  checkShared(settings, BASELINE_STATS);
  for (const key of [
    "visit_order_col",
    "unit_col",
    "participant_id_col",
    "start_value",
    "group_by",
    "color_by",
    "panel_by",
    "studyday_col",
    "normal_col_high",
    "normal_col_low"
  ]) {
    columnOrNull(settings, key);
  }
  if (!VALUE_TYPES.includes(settings.value_type)) {
    refuse4(`\`value_type\` must be one of ${VALUE_TYPES.join(", ")}.`);
  }
  if (!MARKS.includes(settings.mark)) refuse4(`\`mark\` must be one of ${MARKS.join(", ")}.`);
  if (!Y_SCALES.includes(settings.y_scale)) {
    refuse4(`\`y_scale\` must be one of ${Y_SCALES.join(", ")}.`);
  }
  for (const key of ["page_size", "max_levels", "overview_limit"]) {
    if (!Number.isInteger(settings[key]) || settings[key] < 1) {
      refuse4(`\`${key}\` must be a whole number, one or more.`);
    }
  }
  if (!TESTS.includes(settings.test)) refuse4(`\`test\` must be one of ${TESTS.join(", ")}.`);
  if (typeof settings.pairwise !== "boolean") refuse4("`pairwise` must be true or false.");
  if (settings.statistic !== null && !isText3(settings.statistic)) {
    refuse4("`statistic` must be the name of an R function, or null for no statistics line.");
  }
  settings.baseline_visits = textList2(settings.baseline_visits, "baseline_visits");
  settings.visits = textList2(settings.visits, "visits");
  settings.levels = textList2(settings.levels, "levels");
  settings.measures = textList2(settings.measures, "measures");
  settings.groups = fieldList(settings.groups, "groups");
  settings.filters = fieldList(settings.filters, "filters");
  settings.details = fieldList(settings.details, "details");
  settings.profile_details = fieldList(settings.profile_details, "profile_details");
  return settings;
}

// src/shared/statisticLine.js
var WAITING = "Statistics: waiting for R\u2026";
var NOT_STORED = "Statistics are unavailable for this view: the page holds no stored result for it, and no R is attached to compute one.";
var sentence = (state, said) => ({
  state,
  text: said,
  estimates: [],
  remarks: [],
  scope: null
});
function byCodePoint(a, b) {
  const [first, second] = [[...a], [...b]];
  const shared = Math.min(first.length, second.length);
  for (let index = 0; index < shared; index += 1) {
    const difference = first[index].codePointAt(0) - second[index].codePointAt(0);
    if (difference !== 0) return difference;
  }
  return first.length - second.length;
}
var sorted = (values) => [...new Set(values.map(String))].sort(byCodePoint);
function filtersInForce(filters) {
  const inForce = {};
  for (const [column, selection] of Object.entries(filters || {})) {
    if (selection === null || selection === void 0 || selection === "") continue;
    const values = Array.isArray(selection) ? selection : [selection];
    if (values.length) inForce[column] = sorted(values);
  }
  return inForce;
}
function filtersSaid(filters) {
  if (!filters || !filters.length) return null;
  return `Filters: ${filters.map(({ label: label2, values }) => `${label2} is ${values.join(" or ")}`).join("; ")}.`;
}
var texts = (value) => (Array.isArray(value) ? value : value === void 0 || value === null ? [] : [value]).filter(
  (entry) => typeof entry === "string" && entry.trim() !== ""
);
var remarksOf = (value) => [
  ...texts(value.warnings).map((said) => ({ kind: "warning", text: `R warned: ${said}` })),
  ...texts(value.notes).map((said) => ({ kind: "note", text: `R\u2019s note: ${said}` }))
];
function failureOf(result) {
  if (result && result.status === "unavailable") {
    return {
      state: "unavailable",
      text: result.reason === "not-precomputed" ? NOT_STORED : result.message
    };
  }
  const message = result && typeof result.message === "string" ? result.message : "no message";
  return { state: "error", text: `R reported an error: ${message}` };
}
function createDesk({
  connection,
  note = null,
  describe: describe2,
  waiting = (said) => sentence("waiting", said)
}) {
  let current = 0;
  let answered = false;
  const withNote = (said) => note && !answered ? `${said} ${note}` : said;
  return {
    idle: withNote,
    begin() {
      current += 1;
      const round = current;
      let noted = false;
      return {
        ask({ name, data, args, dataId }, show, context) {
          show(waiting(noted ? WAITING : withNote(WAITING)));
          noted = true;
          return connection.run(name, { data, args, dataId }).then((result) => {
            if (result && result.status === "ok" && result.form !== "precomputed") answered = true;
            if (round !== current) return false;
            show(describe2(result, context), result);
            return true;
          });
        }
      };
    }
  };
}

// src/group-comparison/statistic.js
var NO_TEST_CHOSEN = "Statistics: no test chosen.";
var TEST_LABELS = Object.freeze({
  t: "Welch t-test",
  wilcoxon: "Wilcoxon rank-sum test",
  anova: "One-way ANOVA",
  kruskal: "Kruskal-Wallis test",
  none: "None"
});
function testsFor(groups) {
  if (groups === 2) return ["t", "wilcoxon"];
  if (groups > 2) return ["anova", "kruskal"];
  return [];
}
var COUNTERPART = { t: "anova", anova: "t", wilcoxon: "kruskal", kruskal: "wilcoxon" };
function fitTest(test, groups) {
  if (test === "none") return "none";
  const offered = testsFor(groups);
  if (!offered.length) return null;
  return offered.includes(test) ? test : COUNTERPART[test];
}
var groupsOf = (records) => sorted(records.map((record) => record.x));
function statisticRequest({ name, test, pairwise, settings, state, panel }) {
  const groups = groupsOf(panel.records);
  const filters = filtersInForce(state.filters);
  const dataId = {
    chart: "group-comparison",
    measure: state.measure,
    value_type: state.valueType,
    ...panel.visit === null || panel.visit === void 0 ? {} : { visit: panel.visit },
    ...settings.baseline_visits ? { baseline_visits: [...settings.baseline_visits] } : {},
    baseline_stat: settings.baseline_stat,
    ...state.groupBy ? { group_by: state.groupBy } : {},
    groups,
    ...state.colorBy ? { color_by: state.colorBy } : {},
    ...state.panelBy ? { panel_by: state.panelBy, panel: panel.panelLevel } : {},
    ...Object.keys(filters).length ? { filters } : {},
    ...state.yScale === "log" ? { positive_only: true } : {}
  };
  return {
    name,
    data: panel.records,
    args: {
      strValueCol: "y",
      strGroupCol: "x",
      strMethod: test,
      // Pairs exist only among more than two groups.
      bPairwise: Boolean(pairwise) && groups.length > 2
    },
    dataId,
    rows: panel.records.length
  };
}
var present = (value) => value !== void 0 && value !== null;
function pairsOf(value) {
  const rows = Array.isArray(value.rows) ? value.rows.filter((row) => "group_1" in row) : [];
  if (!rows.length) return null;
  const formatted = rows.map(formatComparison);
  const shown2 = formatted.filter((row) => row.status === "shown");
  const methods = [...new Set(shown2.map((row) => row.method))];
  const labels = [...new Set(shown2.map((row) => row.label))];
  const adjustments = [...new Set(shown2.map((row) => row.adjustment))];
  const by = methods.length === 1 ? `, each by ${methods[0]}` : methods.length > 1 ? ", each by the test named with it" : "";
  return {
    caption: `Pairwise comparisons${by}.${labels.length ? ` ${labels.join(" ")}` : ""}`,
    head: [
      "Pair",
      "n",
      adjustments.length === 1 && adjustments[0] ? `p, adjusted (${adjustments[0]})` : "p"
    ],
    rows: formatted.map((row) => ({
      status: row.status,
      pair: row.groups ? `${row.groups[0]} and ${row.groups[1]}` : "",
      n: row.n ? `${row.n[0]}, ${row.n[1]}` : "",
      // A pair with no p-value says why in its place.
      p: row.status === "shown" ? row.p : row.result,
      method: methods.length > 1 && row.status === "shown" ? row.method : null
    }))
  };
}
var plain = (state, said) => ({ ...sentence(state, said), pairs: null });
function describeAnswer(result, context = {}) {
  if (result && result.status === "ok") {
    const value = result.value && typeof result.value === "object" ? result.value : {};
    const formatted = formatStatistic(value);
    const described = plain(formatted.status, formatted.text);
    if (formatted.status === "shown") {
      described.estimates = (Array.isArray(value.estimates) ? value.estimates : []).filter((row) => row && present(row.lower) && present(row.upper)).map((row) => formatEstimate(row).text);
      described.pairs = pairsOf(value);
    }
    described.remarks = remarksOf(value);
    described.scope = context.scope || null;
    return described;
  }
  const failure = failureOf(result);
  return plain(failure.state, failure.text);
}
function noTestText(groups, several) {
  const lead = `Statistics: no test${several ? " in this panel" : ""}. A test compares two or more groups, and `;
  if (!groups) return `${lead}no column makes a group.`;
  if (groups.length === 1) return `${lead}only ${groups[0]} has values${several ? " here" : ""}.`;
  return `${lead}none is drawn.`;
}
function scopeText({ group, n, panel, color, filters = [] }) {
  const said = [
    `This test compares the levels of ${group} on the ${n} participant${n === 1 ? "" : "s"} ` + (panel ? `drawn in this panel (${panel}).` : "drawn.")
  ];
  if (panel) {
    said.push("Each panel has a test of its own, and they are not adjusted for one another.");
  }
  if (color) {
    said.push(`Colour by ${color} is not part of it: each level of ${group} is tested whole.`);
  }
  if (filters.length) said.push(filtersSaid(filters));
  return said.join(" ");
}
function createStatisticDesk({ connection, note = null }) {
  return createDesk({
    connection,
    note,
    describe: describeAnswer,
    waiting: (said) => plain("waiting", said)
  });
}

// src/shared/tables.js
var isBlank2 = (value) => value === void 0 || value === null || typeof value === "number" && Number.isNaN(value) || typeof value === "string" && value.trim() === "";
var naturally = (a, b) => String(a).localeCompare(String(b), void 0, { numeric: true });
function levelsOf(values) {
  return [...new Set(values.filter((value) => !isBlank2(value)).map(String))].sort(naturally);
}
function listMeasures(results, settings) {
  const present2 = levelsOf(results.map((row) => row[settings.measure_col]));
  if (!settings.measures) return present2;
  const listed = settings.measures.filter((measure) => present2.includes(measure));
  return listed.length ? listed : present2;
}
function unitOf(results, settings, measure) {
  if (!settings.unit_col) return null;
  const units = levelsOf(
    results.filter((row) => String(row[settings.measure_col]) === measure).map((row) => row[settings.unit_col])
  );
  return units.length === 1 ? units[0] : null;
}
function categoryColumns({ results, participants }, settings) {
  if (settings.groups) {
    return settings.groups.map((spec) => ({ ...spec, table: "given" }));
  }
  const columns = [];
  const taken = /* @__PURE__ */ new Set();
  const offer = (name, table) => {
    taken.add(name);
    columns.push({ value_col: name, label: name, table });
  };
  const fewEnough = (values) => {
    const levels = /* @__PURE__ */ new Set();
    for (const value of values) {
      if (isBlank2(value)) continue;
      levels.add(String(value));
      if (levels.size > settings.max_levels) return false;
    }
    return levels.size > 0;
  };
  if (participants && participants.length) {
    const idCol = settings.participant_id_col || settings.id_col;
    for (const name of Object.keys(participants[0])) {
      if (name === idCol) continue;
      if (fewEnough(participants.map((row) => row[name]))) offer(name, "participants");
    }
  }
  const mapped = new Set(
    [
      settings.id_col,
      settings.measure_col,
      settings.value_col,
      settings.visit_col,
      settings.visit_order_col,
      settings.unit_col,
      settings.studyday_col,
      settings.normal_col_high,
      settings.normal_col_low
    ].filter(Boolean)
  );
  for (const name of results.length ? Object.keys(results[0]) : []) {
    if (mapped.has(name) || taken.has(name)) continue;
    const byParticipant = /* @__PURE__ */ new Map();
    let constant = true;
    for (const row of results) {
      if (isBlank2(row[name])) continue;
      const id = String(row[settings.id_col]);
      const value = String(row[name]);
      if (!byParticipant.has(id)) byParticipant.set(id, value);
      else if (byParticipant.get(id) !== value) {
        constant = false;
        break;
      }
    }
    if (constant && fewEnough(byParticipant.values())) offer(name, "results");
  }
  return columns;
}
function filterColumns({ participants }, settings, categories) {
  if (!participants || !participants.length) return [];
  if (settings.filters) {
    return settings.filters.filter((spec) => spec.value_col in participants[0]);
  }
  return categories.filter((column) => column.table === "participants").map(({ value_col, label: label2 }) => ({ value_col, label: label2 }));
}
function listVisits(results, settings) {
  const config = coreSettings(settings);
  const all = visits(results, config);
  const asked = (settings.visits || []).filter((visit) => all.includes(visit));
  return { all, start: asked.length ? asked : all };
}
function columnLevels({ results, participants }, column) {
  const rows = participants && participants.some((row) => column in row) ? participants : results;
  return levelsOf(rows.map((row) => row[column]));
}
var matches = (value, selection) => selection === null || selection === void 0 || (Array.isArray(selection) ? selection.map(String).includes(String(value)) : String(selection) === String(value));
function keepFiltered({ results, participants }, settings, filters, filterMatches) {
  const test = filterMatches || matches;
  if (!participants) return { results, participants: null };
  const idCol = settings.id_col;
  const participantIdCol = settings.participant_id_col || idCol;
  const kept = participants.filter(
    (row) => Object.entries(filters || {}).every(([column, selection]) => test(row[column], selection))
  );
  const ids = new Set(kept.map((row) => String(row[participantIdCol])));
  return {
    participants: kept,
    results: results.filter((row) => ids.has(String(row[idCol])))
  };
}

// src/group-comparison/structureData.js
function quantile(sorted2, p) {
  if (!sorted2.length) return NaN;
  const position = (sorted2.length - 1) * p;
  const below = Math.floor(position);
  const above = Math.ceil(position);
  if (below === above) return sorted2[below];
  return sorted2[below] + (sorted2[above] - sorted2[below]) * (position - below);
}
var sum = (values) => values.reduce((total, value) => total + value, 0);
function summarize(values) {
  const sorted2 = [...values].sort((a, b) => a - b);
  return {
    n: sorted2.length,
    min: sorted2.length ? sorted2[0] : NaN,
    q5: quantile(sorted2, 0.05),
    q25: quantile(sorted2, 0.25),
    median: quantile(sorted2, 0.5),
    q75: quantile(sorted2, 0.75),
    q95: quantile(sorted2, 0.95),
    max: sorted2.length ? sorted2[sorted2.length - 1] : NaN,
    mean: sorted2.length ? sum(sorted2) / sorted2.length : NaN
  };
}
function bandwidth(values) {
  const n = values.length;
  if (n < 2) return NaN;
  const sorted2 = [...values].sort((a, b) => a - b);
  const mean = sum(sorted2) / n;
  const deviation = Math.sqrt(sum(sorted2.map((value) => (value - mean) ** 2)) / (n - 1));
  const spread = (quantile(sorted2, 0.75) - quantile(sorted2, 0.25)) / 1.34;
  let lesser = Math.min(deviation, spread);
  if (lesser === 0) lesser = deviation || Math.abs(sorted2[0]) || 1;
  return 0.9 * lesser * n ** -0.2;
}
function density(values, points = 64) {
  const width = bandwidth(values);
  const least = Math.min(...values);
  const greatest = Math.max(...values);
  if (!Number.isFinite(width) || !(greatest > least)) return null;
  const at = Array.from(
    { length: points },
    (_, index) => least + (greatest - least) * index / (points - 1)
  );
  const scale = 1 / (values.length * width * Math.sqrt(2 * Math.PI));
  return {
    bandwidth: width,
    at,
    density: at.map(
      (height) => scale * sum(values.map((value) => Math.exp(-0.5 * ((height - value) / width) ** 2)))
    )
  };
}
function jitter(id) {
  let hash = 2166136261;
  for (const character of String(id)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967295 * 2 - 1;
}
var RELATIVE = /* @__PURE__ */ new Set(["change", "fold_change", "percent_change"]);
function visitsDrawn(visits2, valueType, baselineVisits) {
  if (!RELATIVE.has(valueType) || !baselineVisits || baselineVisits.length !== 1) return visits2;
  return visits2.filter((visit) => visit !== baselineVisits[0]);
}
var EVERYONE = "All participants";
var BAND = 0.8;
function slots(colours) {
  const slot = BAND / colours;
  return {
    offsets: Array.from({ length: colours }, (_, index) => -BAND / 2 + slot * (index + 0.5)),
    halfWidth: slot * 0.4
  };
}
function tickLabel(level, cells) {
  const total = sum(cells.map((cell) => cell.n));
  const lines = [String(level), `n = ${total}`];
  if (cells.length > 1) lines.push(cells.map((cell) => cell.n).join(" \xB7 "));
  return lines;
}
function buildPanels({ results, participants }, settings, state, options = {}) {
  const config = coreSettings(settings);
  const { participants: kept, results: rows } = keepFiltered(
    { results, participants },
    settings,
    state.filters,
    options.filterMatches
  );
  const needsVisit = state.valueType !== "baseline";
  const baselineVisits = RELATIVE.has(state.valueType) ? config.baseline_visits || visits(rows, config).slice(0, 1) : [];
  const drawnVisits = visitsDrawn(state.visits, state.valueType, baselineVisits);
  const visitList = needsVisit ? drawnVisits : [null];
  const yOf = (visit) => needsVisit ? { measure: state.measure, visit, value: state.valueType } : { measure: state.measure, value: "baseline" };
  const variablesFor = (visit) => ({
    y: yOf(visit),
    ...state.groupBy ? { x: { col: state.groupBy } } : {},
    ...state.colorBy ? { color: { col: state.colorBy } } : {},
    ...state.panelBy ? { panel: { col: state.panelBy } } : {}
  });
  const framed = visitList.map((visit) => {
    const made = frame(
      { results: rows, participants: kept || void 0 },
      variablesFor(visit),
      config
    );
    const all = state.groupBy ? made.data : made.data.map((record) => ({ ...record, x: EVERYONE }));
    const positive = state.yScale === "log" ? all.filter((record) => record.y > 0) : all;
    return { visit, made, data: positive, nonPositive: made.data.length - positive.length };
  });
  const everyRecord = framed.flatMap((entry) => entry.data);
  const levels = levelsOf(everyRecord.map((record) => record.x));
  const shownLevels = state.levels ? levels.filter((level) => state.levels.includes(level)) : levels;
  const colors = state.colorBy ? levelsOf(everyRecord.map((record) => record.color)) : [null];
  const panelLevels = state.panelBy ? levelsOf(everyRecord.map((record) => record.panel)) : [null];
  const { offsets, halfWidth } = slots(colors.length);
  const logged = state.yScale === "log";
  const panels = [];
  for (const { visit, made, data, nonPositive } of framed) {
    for (const panelLevel of panelLevels) {
      const inPanel = data.filter(
        (record) => shownLevels.includes(String(record.x)) && (panelLevel === null || String(record.panel) === panelLevel)
      );
      const cells = [];
      shownLevels.forEach((level, levelIndex) => {
        colors.forEach((color, colorIndex) => {
          const records = inPanel.filter(
            (record) => String(record.x) === level && (color === null || String(record.color) === color)
          );
          const values2 = records.map((record) => record.y);
          const outline = state.mark === "violin" && values2.length ? density(logged ? values2.map(Math.log10) : values2) : null;
          cells.push({
            level,
            levelIndex,
            color,
            colorIndex,
            x: levelIndex + offsets[colorIndex],
            halfWidth,
            records,
            n: records.length,
            stats: summarize(values2),
            density: outline && {
              bandwidth: outline.bandwidth,
              at: logged ? outline.at.map((height) => 10 ** height) : outline.at,
              density: outline.density
            }
          });
        });
      });
      const title = [needsVisit && visitList.length > 1 ? visit : null, panelLevel].filter((part) => part !== null).join(" \xB7 ");
      panels.push({
        key: `${visit ?? "baseline"}\0${panelLevel ?? ""}`,
        title,
        visit,
        panelLevel,
        variable: yOf(visit),
        records: inPanel,
        cells,
        ticks: shownLevels.map(
          (level) => tickLabel(
            level,
            cells.filter((cell) => cell.level === level)
          )
        ),
        participants: made.participants,
        dropped: made.dropped,
        unused: made.unused,
        nonPositive
      });
    }
  }
  const values = panels.flatMap((panel) => panel.records.map((record) => record.y));
  return {
    panels,
    levels,
    shownLevels,
    colors,
    panelLevels,
    halfWidth,
    baselineVisits: framed.length ? framed[0].made.baseline_visits : baselineVisits.length ? baselineVisits : null,
    // The baseline visit that was chosen and not drawn, when there is one.
    visitsNotDrawn: needsVisit ? state.visits.filter((visit) => !drawnVisits.includes(visit)) : [],
    extent: values.length ? [Math.min(...values), Math.max(...values)] : null,
    filtered: kept ? kept.length : null
  };
}
var VALUE_WORDS = {
  raw: "",
  change: ", change from baseline",
  fold_change: ", fold change from baseline",
  percent_change: ", percent change from baseline"
};
function yTitle(results, settings, state) {
  const { measure, valueType, visits: visits2 } = state;
  let words;
  if (valueType === "baseline") words = label({ measure, value: "baseline" });
  else if (visits2.length === 1) {
    words = label({ measure, visit: visits2[0], value: valueType });
  } else {
    words = `${measure}${VALUE_WORDS[valueType]}`;
  }
  if (valueType === "fold_change") return words;
  if (valueType === "percent_change") return `${words} (%)`;
  const unit = unitOf(results, settings, measure);
  return unit ? `${words} (${unit})` : words;
}
function overviewPage(measures, limit, page = 0) {
  const total = measures.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const at = Math.min(Math.max(0, Math.trunc(Number(page)) || 0), pages - 1);
  const shown2 = measures.slice(at * limit, (at + 1) * limit);
  return {
    measures: shown2,
    page: at,
    pages,
    from: total ? at * limit + 1 : 0,
    to: at * limit + shown2.length,
    total
  };
}
function overviewCount({ from, to, total, pages }) {
  if (!total) return "No biomarker to show.";
  if (pages === 1) {
    return total === 1 ? "The one biomarker is shown." : `All ${total} biomarkers are shown.`;
  }
  const which = from === to ? `the ${ordinal(from)}` : `${from} to ${to}`;
  return `${to - from + 1} of ${total} biomarkers shown: ${which}, in the Biomarker control\u2019s order.`;
}
var ordinal = (n) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  return `${n}${suffix}`;
};
function buildOverview(tables, settings, state, measures, options = {}) {
  return measures.map((measure) => {
    const row = { ...state, measure, panelBy: "" };
    return {
      measure,
      title: yTitle(tables.results, settings, { ...row, visits: [] }),
      model: buildPanels(tables, settings, row, options)
    };
  });
}

// src/group-comparison.js
var NONE = "";
var OVERVIEW = "bv_overview";
var VALUE_LABELS = {
  raw: "Result",
  baseline: "Baseline",
  change: "Change from baseline",
  fold_change: "Fold change from baseline",
  percent_change: "Percent change from baseline"
};
var MARK_LABELS = { box: "Box", violin: "Violin", points: "Points" };
var SCALE_LABELS = { linear: "Linear", log: "Logarithmic" };
var STYLE_ID = "bio-viz-group-comparison-styles";
var STYLES = `${lineStyles(".bv-group-comparison")}
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
var NOTHING_AFTER_BASELINE = "The only visit chosen is the baseline visit, where this value is the same for everyone. Choose a later visit to draw.";
var GroupComparison = class {
  constructor(element, settings) {
    this.kit = findKit("the group comparison chart");
    this.element = typeof element === "string" ? document.querySelector(element) : element;
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
    this.connection = this.settings.connection || createConnection();
    this.desk = createStatisticDesk({
      connection: this.connection,
      note: this.settings.waiting_note
    });
  }
  renderShell() {
    mountShell(this, {
      moduleClass: "bv-group-comparison",
      styleId: STYLE_ID,
      styles: STYLES,
      listingFile: "bio.viz-group-comparison-listing.csv"
    });
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
    const given2 = settings || {};
    this.settings = syncSettings({ ...this.settings, ...given2 });
    syncHost(this);
    if ("connection" in given2 || "waiting_note" in given2) this.connect();
    this.readTables();
    const opening = this.seedState();
    const moved = {
      start_value: "measure",
      visits: "visits",
      value_type: "valueType",
      group_by: "groupBy",
      levels: "levels",
      color_by: "colorBy",
      panel_by: "panelBy",
      mark: "mark",
      y_scale: "yScale",
      test: "test",
      pairwise: "pairwise",
      filters: "filters",
      // Another limit is other pages: the overview starts at its first.
      overview_limit: "page"
    };
    for (const [setting, key] of Object.entries(moved)) {
      if (setting in given2) this.state[key] = opening[key];
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
    this.filterSpecs = filterColumns(this.tables, this.settings, this.categories).map(
      (spec) => this.kit.normalizeFilterSpec(spec)
    );
    const named = this.settings.start_value;
    if (results.length && named !== null && !this.measures.includes(named)) {
      console.warn(
        `The initial biomarker [${named}] does not exist. Defaulting to the all-biomarkers overview.`
      );
    }
  }
  // Whether the overview of every biomarker is what is drawn.
  isOverview() {
    return this.state.measure === null || this.state.measure === void 0;
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
      groupBy: has(settings.group_by) ? settings.group_by : categories.length ? categories[0].value_col : NONE,
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
    this.controls.innerHTML = "";
    const { addSection, addControl, addReset } = kit.controlBuilders(this.controls);
    const redraw = (rebuild) => {
      if (rebuild) this.buildControls();
      this.render();
    };
    const select = (name, labelText, options, selected, onChange, parent) => {
      const input = document.createElement("select");
      input.dataset.control = name;
      options.forEach(([value2, text2]) => kit.option(input, value2, text2, value2 === selected));
      input.onchange = () => onChange(input.value);
      return addControl(labelText, input, parent);
    };
    const overview = this.isOverview();
    const value = addSection("Value");
    select(
      "measure",
      "Biomarker",
      [[OVERVIEW, "All Biomarkers"], ...this.measures.map((measure) => [measure, measure])],
      overview ? OVERVIEW : state.measure,
      // The controls differ between the overview and one biomarker.
      (next) => this.selectMeasure(next === OVERVIEW ? null : next),
      value
    );
    select(
      "value-type",
      "Value",
      VALUE_TYPES.map((type) => [type, VALUE_LABELS[type]]),
      state.valueType,
      (next) => {
        state.valueType = next;
        redraw(true);
      },
      value
    );
    if (state.valueType !== "baseline") {
      const visits2 = kit.multiSelect({
        values: this.visits.all,
        selected: state.visits.length === this.visits.all.length ? null : state.visits,
        onChange: (next) => {
          const chosen = next === null ? this.visits.all : next;
          state.visits = this.visits.all.filter((visit) => chosen.includes(visit));
          redraw(false);
        }
      });
      visits2.dataset.control = "visits";
      addControl("Visit", visits2, value);
    }
    const columns = this.categories.map((entry) => [entry.value_col, entry.label]);
    const group = addSection("Groups");
    if (columns.length) {
      select(
        "group-by",
        "Group by",
        columns,
        state.groupBy,
        (next) => {
          state.groupBy = next;
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
      picker.dataset.control = "levels";
      addControl("Levels", picker, group);
      const optional = [[NONE, "None"], ...columns];
      select(
        "color-by",
        "Colour by",
        optional,
        state.colorBy,
        (next) => {
          state.colorBy = next;
          redraw(false);
        },
        group
      );
      const panelBy = select(
        "panel-by",
        "Panel by",
        optional,
        state.panelBy,
        (next) => {
          state.panelBy = next;
          redraw(false);
        },
        group
      );
      if (overview) {
        panelBy.disabled = true;
        panelBy.after(
          kit.createElement(
            "small",
            "bv-control-note",
            "Applies when one biomarker is open. In the overview each biomarker\u2019s panels are its visits."
          )
        );
      }
    } else {
      group.append(
        kit.createElement(
          "p",
          "sv-warning bv-no-groups",
          "No column can make a group. Give a participant table, or carry a column on the results rows."
        )
      );
    }
    const display = addSection("Display");
    select(
      "mark",
      "Draw as",
      MARKS.map((mark) => [mark, MARK_LABELS[mark]]),
      state.mark,
      (next) => {
        state.mark = next;
        redraw(false);
      },
      display
    );
    select(
      "y-scale",
      "Scale",
      Y_SCALES.map((scale) => [scale, SCALE_LABELS[scale]]),
      state.yScale,
      (next) => {
        state.yScale = next;
        redraw(false);
      },
      display
    );
    this.testControl = null;
    this.pairwiseControl = null;
    if (this.settings.statistic && !overview) {
      const statistics = addSection("Statistics");
      const test = document.createElement("select");
      test.dataset.control = "test";
      test.onchange = () => {
        state.test = test.value;
        redraw(false);
      };
      this.testControl = addControl("Test", test, statistics);
      const pairwise = document.createElement("input");
      pairwise.type = "checkbox";
      pairwise.dataset.control = "pairwise";
      pairwise.setAttribute("aria-label", "Pairwise comparisons");
      pairwise.onchange = () => {
        state.pairwise = pairwise.checked;
        redraw(false);
      };
      this.pairwiseControl = addControl("Pairwise comparisons", pairwise, statistics);
    }
    addFilterControls(this, { addSection, addControl }, () => redraw(false));
    addReset(() => {
      this.state = this.seedState();
      this.buildControls();
      this.render();
    });
  }
  // Every level of the group column in the tables, whatever the filters are set to.
  levelsOffered() {
    if (!this.state.groupBy) return [];
    if (this.isOverview()) return columnLevels(this.tables, this.state.groupBy);
    const model = buildPanels(
      this.tables,
      this.settings,
      { ...this.state, levels: null, colorBy: NONE, panelBy: NONE, filters: {}, yScale: "linear" },
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
    select.innerHTML = "";
    select.disabled = !offered.length;
    if (offered.length) {
      [...offered, "none"].forEach(
        (test) => kit.option(select, test, TEST_LABELS[test], test === fitted)
      );
    } else {
      kit.option(select, "none", "None: a test needs two or more groups", true);
    }
    pairwise.checked = state.pairwise;
    pairwise.parentElement.style.display = groups > 2 && fitted !== "none" ? "" : "none";
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
    this.notes.innerHTML = "";
    this.multiplesWrap.innerHTML = "";
    this.statLine.textContent = "";
    this.statLine.dataset.state = "empty";
    this.multiplesWrap.classList.remove("bv-overview");
    this.chartWrap.classList.remove("sv-hidden");
    this.model = null;
    this.overview = null;
    this.syncTestControls(0);
    const { results } = this.tables;
    const needsVisit = this.state.valueType !== "baseline";
    if (!results.length || !this.measures.length) {
      this.footnote.textContent = "No results to draw.";
      return;
    }
    if (needsVisit && !this.state.visits.length) {
      this.footnote.textContent = "Choose a visit to draw.";
      return;
    }
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
      this.footnote.textContent = model.panels.length ? "No participant has a value to draw for this choice." : NOTHING_AFTER_BASELINE;
      return;
    }
    this.footnote.textContent = this.state.mark === "points" ? "Click a point to list its participant and open their profile." : `Click a ${this.state.mark} to list its participants.`;
    const title = yTitle(results, this.settings, this.state);
    const domain = this.domain(model);
    if (model.panels.length === 1) {
      const [panel] = model.panels;
      this.drawPanel(this.canvas, panel, model, { title, domain });
      this.askStatistic(round, panel, model, this.statLine);
      return;
    }
    this.chartWrap.classList.add("sv-hidden");
    model.panels.forEach((panel) => {
      const card = this.kit.createElement("div", "sv-multiple bv-panel");
      card.dataset.panel = panel.title;
      card.append(this.kit.createElement("h3", null, panel.title));
      card.append(
        this.kit.createElement(
          "p",
          "bv-panel-note",
          `${panel.records.length} participant${panel.records.length === 1 ? "" : "s"} drawn.`
        )
      );
      const wrap = this.kit.createElement("div", "bv-panel-canvas");
      const canvas = document.createElement("canvas");
      wrap.append(canvas);
      const line = this.kit.createElement("div", "bv-statistic");
      line.setAttribute("role", "status");
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
    this.chartWrap.classList.add("sv-hidden");
    this.multiplesWrap.classList.add("bv-overview");
    this.updateOverviewNotes(rows);
    const pager = () => this.overviewPager(page);
    this.multiplesWrap.append(pager());
    const drawn = rows.filter((row) => row.model.panels.some((panel) => panel.records.length));
    if (!drawn.length) {
      this.footnote.textContent = rows.some((row) => row.model.panels.length) ? "No participant has a value to draw for this choice." : NOTHING_AFTER_BASELINE;
      return;
    }
    this.footnote.textContent = "Click a biomarker to view it alone, with a test under each visit.";
    const colors = drawn[0].model.colors;
    if (colors.length > 1 || colors[0] !== null) {
      const legend = kit.createElement("p", "bv-legend");
      legend.append(kit.createElement("span", null, `${this.labelOf(state.colorBy)}:`));
      colors.forEach((color, index) => {
        const entry = kit.createElement("span");
        const swatch = kit.createElement("span", "bv-legend-swatch");
        swatch.style.background = this.colorOf(index);
        entry.append(swatch, document.createTextNode(color));
        legend.append(entry);
      });
      this.multiplesWrap.append(legend);
    }
    const groups = Math.max(...rows.map((row) => row.model.shownLevels.length), 1);
    const narrow = this.root.clientWidth < 600;
    const least = narrow ? 120 : 132;
    this.multiplesWrap.style.setProperty(
      "--bv-panel-min",
      `${Math.min(300, Math.max(least, groups * (narrow ? 44 : 52) + 30))}px`
    );
    rows.forEach(({ measure, title, model }) => {
      const row = kit.createElement("div", "sv-multiple sv-overview-panel bv-overview-row");
      row.dataset.measure = measure;
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      row.setAttribute("aria-label", `View ${measure}`);
      const open = () => this.openFromOverview(measure);
      row.onclick = open;
      row.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      };
      row.append(kit.createElement("h3", null, title));
      const panels = kit.createElement("div", "bv-overview-panels");
      row.append(panels);
      this.multiplesWrap.append(row);
      const shown2 = model.panels.filter((panel) => panel.records.length);
      if (!shown2.length) {
        row.append(kit.createElement("p", "bv-panel-note", "No participant has a value to draw."));
        return;
      }
      const domain = this.domain({ extent: this.reach(model) });
      model.panels.forEach((panel) => {
        const cell = kit.createElement("div", "bv-overview-panel");
        cell.dataset.visit = panel.visit ?? "";
        cell.append(kit.createElement("h4", null, panel.title || panel.visit || "Baseline value"));
        const wrap = kit.createElement("div", "bv-overview-canvas");
        const canvas = document.createElement("canvas");
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
    const { kit } = this;
    const pager = kit.createElement("div", "bv-overview-pager");
    pager.append(kit.createElement("span", "bv-overview-count", overviewCount(page)));
    if (page.pages === 1) return pager;
    const go = (label2, to, name) => {
      const button = kit.createElement("button", null, label2);
      button.type = "button";
      button.dataset.go = name;
      button.disabled = to < 0 || to >= page.pages;
      button.onclick = () => {
        this.state.page = to;
        this.render();
        if (this.root.getBoundingClientRect().top < 0) this.root.scrollIntoView();
      };
      return button;
    };
    pager.append(
      go("Previous", page.page - 1, "previous"),
      kit.createElement("span", "bv-overview-page", `Page ${page.page + 1} of ${page.pages}`),
      go("Next", page.page + 1, "next")
    );
    return pager;
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
    const add = (text2) => this.notes.append(kit.createElement("span", null, text2));
    const [first] = rows;
    if (!first) return;
    const { model } = first;
    if (model.filtered !== null && model.filtered < this.tables.participants.length) {
      add(`${model.filtered} of ${this.tables.participants.length} participants pass the filters.`);
    }
    if (state.levels) {
      const offered = this.levelsOffered();
      const shown2 = offered.filter((level) => state.levels.includes(level));
      if (shown2.length < offered.length) add(`${shown2.length} of ${offered.length} levels shown.`);
    }
    if (state.valueType === "baseline") {
      add("A baseline value has no visit: each biomarker has one panel.");
    }
    this.addBaselineNote(model, add);
  }
  // The baseline visit of a value worked out against one, and that it is not
  // drawn when it was chosen: there the value is the same for everyone.
  addBaselineNote(model, add) {
    if (!model.baselineVisits || this.state.valueType === "raw") return;
    const notDrawn = model.visitsNotDrawn.length ? ` It is not drawn: there the ${VALUE_LABELS[this.state.valueType].toLowerCase()} is the same for everyone.` : "";
    add(`Baseline visit: ${model.baselineVisits.join(", ")}.${notDrawn}`);
  }
  // How far a biomarker's marks reach across its panels. A box is drawn from
  // its whiskers, the 5th and 95th percentiles; a violin and points reach the
  // least and greatest value.
  reach(model) {
    if (this.state.mark !== "box") return model.extent;
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
    if (this.state.yScale === "log") {
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
    const groupLabel = state.groupBy ? this.labelOf(state.groupBy) : "";
    const coloured = model.colors.length > 1 || model.colors[0] !== null;
    const datasets = model.colors.map((color, colorIndex) => {
      const hex = this.colorOf(colorIndex);
      const cells = panel.cells.filter((cell) => cell.colorIndex === colorIndex && cell.n);
      const data = state.mark === "points" ? cells.flatMap(
        (cell) => cell.records.map((record) => ({
          x: cell.x + jitter(record[this.settings.id_col]) * cell.halfWidth * 0.85,
          y: record.y,
          cell,
          record
        }))
      ) : (
        // One unseen point per cell, at its median, for the tooltip to hang on.
        cells.map((cell) => ({ x: cell.x, y: cell.stats.median, cell }))
      );
      return {
        label: color === null ? groupLabel || "All participants" : color,
        data,
        showLine: false,
        backgroundColor: hexToRgba(hex, 0.55),
        borderColor: hex,
        pointRadius: state.mark === "points" ? compact ? 1.5 : 3 : 0,
        pointHoverRadius: state.mark === "points" ? 5 : 0,
        pointHitRadius: state.mark === "points" ? 4 : 14
      };
    });
    const chart = new this.kit.Chart(canvas.getContext("2d"), {
      type: "scatter",
      data: { datasets },
      options: {
        animation: false,
        maintainAspectRatio: false,
        responsive: true,
        interaction: { mode: "nearest", intersect: true },
        ...compact ? { events: [], layout: { padding: { top: 4, right: 4 } } } : { onClick: (event) => this.onChartClick(chart, panel, event) },
        plugins: {
          legend: {
            display: coloured && !compact,
            position: "top",
            title: { display: coloured, text: this.labelOf(state.colorBy) }
          },
          tooltip: {
            enabled: !compact,
            callbacks: {
              title: () => "",
              label: (context) => this.tooltip(context.raw)
            }
          }
        },
        scales: {
          x: {
            type: "linear",
            min: -0.5,
            max: model.shownLevels.length - 0.5,
            grid: { display: false },
            title: { display: Boolean(groupLabel) && !compact, text: groupLabel },
            ticks: {
              autoSkip: false,
              // A small panel turns its labels when they would run together.
              maxRotation: compact ? 50 : 0,
              ...compact ? { font: { size: 10 }, padding: 2 } : {},
              callback: (value) => Number.isInteger(value) ? panel.ticks[value] ?? "" : ""
            },
            afterBuildTicks: (axis) => {
              axis.ticks = model.shownLevels.map((_, index) => ({ value: index }));
            }
          },
          y: {
            type: state.yScale === "log" ? "logarithmic" : "linear",
            min: domain[0],
            max: domain[1],
            // The ends of the axis are room about the data, not round numbers.
            ticks: {
              includeBounds: false,
              ...compact ? { font: { size: 10 }, maxTicksLimit: 4 } : {}
            },
            title: { display: !compact, text: title }
          }
        }
      },
      plugins: [this.markPlugin(panel)]
    });
    chart.$panel = panel;
    chart.$model = model;
    canvas.setAttribute("role", "img");
    canvas.setAttribute(
      "aria-label",
      `${title}${panel.title ? `, ${panel.title}` : ""}: ` + panel.ticks.map((lines) => `${lines[0]} ${lines[1]}`).join("; ")
    );
    this.charts.push(chart);
    return chart;
  }
  // The marks: safety.viz's box for a box, an outline drawn here for a violin,
  // and nothing more than the points themselves for points.
  markPlugin(panel) {
    const cells = panel.cells.filter((cell) => cell.n);
    if (this.state.mark === "box") {
      return this.kit.boxWhiskerPlugin(
        "gc",
        () => cells.map((cell) => ({
          x: cell.x,
          halfWidth: cell.halfWidth,
          stats: cell.stats,
          color: this.colorOf(cell.colorIndex)
        }))
      );
    }
    if (this.state.mark !== "violin") return { id: "gc-no-marks" };
    return {
      id: `gc-violin-${Math.random().toString(36).slice(2)}`,
      afterDatasetsDraw: (chart) => {
        const { ctx, scales, chartArea } = chart;
        const yOf = (value) => Math.max(chartArea.top, Math.min(chartArea.bottom, scales.y.getPixelForValue(value)));
        ctx.save();
        for (const cell of cells) {
          const color = this.colorOf(cell.colorIndex);
          const centre = scales.x.getPixelForValue(cell.x);
          const half = scales.x.getPixelForValue(cell.x + cell.halfWidth) - centre;
          ctx.strokeStyle = color;
          ctx.fillStyle = hexToRgba(color, 0.35);
          ctx.lineWidth = 1.5;
          if (cell.density) {
            const widest = Math.max(...cell.density.density);
            const widths = cell.density.density.map((value) => value / widest * half);
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
    if (!raw || !raw.cell) return "";
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
    const add = (text2, warning) => this.notes.append(kit.createElement("span", warning ? "sv-warning" : null, text2));
    const several = model.panels.length > 1;
    const byVisit = /* @__PURE__ */ new Map();
    model.panels.forEach((panel) => {
      const entry = byVisit.get(panel.visit) || { drawn: 0, panel };
      entry.drawn += panel.records.length;
      byVisit.set(panel.visit, entry);
    });
    for (const [visit, { drawn, panel }] of byVisit) {
      const where = several && visit !== null ? `${visit}: ` : "";
      add(`${where}${drawn} of ${panel.participants} participants drawn.`);
      panel.dropped.forEach((entry) => add(`${where}${entry.n} left out: ${entry.reason}.`, true));
      if (panel.nonPositive) {
        add(
          `${where}${panel.nonPositive} left out: zero or less, which a logarithmic scale cannot show.`,
          true
        );
      }
      panel.unused.filter((entry) => entry.reason !== UNUSED.MISSING_RESULT).forEach(
        (entry) => add(`${where}${entry.n} row${entry.n === 1 ? "" : "s"} not used: ${entry.reason}.`, true)
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
    if (test === "none") {
      show(plain("none", this.desk.idle(NO_TEST_CHOSEN)));
      return;
    }
    const inPanel = groupsOf(panel.records);
    if (test === null || inPanel.length < 2) {
      show(plain("none", noTestText(this.state.groupBy ? inPanel : null, model.panels.length > 1)));
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
    if (this.state.mark === "points") {
      const [hit] = chart.getElementsAtEventForMode(
        event.native,
        "nearest",
        { intersect: true },
        false
      );
      if (!hit) return;
      const { cell: cell2, record } = chart.data.datasets[hit.datasetIndex].data[hit.index];
      this.showListing(panel, cell2, [record]);
      this.select(record[this.settings.id_col]);
      return;
    }
    const x = chart.scales.x.getValueForPixel(event.x);
    const y = chart.scales.y.getValueForPixel(event.y);
    const cell = panel.cells.find((candidate) => {
      if (!candidate.n || Math.abs(x - candidate.x) > candidate.halfWidth) return false;
      const { stats } = candidate;
      const [low, high] = this.state.mark === "box" ? [stats.q5, stats.q95] : [stats.min, stats.max];
      return y >= low && y <= high;
    });
    if (cell) this.showListing(panel, cell, cell.records);
  }
  // The columns of the listing: the ones named in settings, or the participant,
  // the group, the colour and the panel, and the value drawn.
  listingColumns() {
    if (this.settings.details) return this.settings.details;
    const { state, settings } = this;
    const columns = [{ value_col: settings.id_col, label: "Participant" }];
    if (state.groupBy) columns.push({ value_col: "x", label: this.labelOf(state.groupBy) });
    if (state.colorBy) columns.push({ value_col: "color", label: this.labelOf(state.colorBy) });
    if (state.panelBy) columns.push({ value_col: "panel", label: this.labelOf(state.panelBy) });
    columns.push({ value_col: "y", label: "Value" });
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
    const where = panel.title ? ` (${panel.title})` : "";
    this.footnote.textContent = `${name}${where}: ${records.length} participant${records.length === 1 ? "" : "s"} listed. Click a row to open the participant's profile.`;
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
    this.desk.begin();
    this.destroyCharts();
    this.kit.unmountProfileRail(this.host);
    this.element.innerHTML = "";
  }
};
function groupComparison(element, settings) {
  return new GroupComparison(element, settings);
}

// src/main.js
var version = "0.1.0";
export {
  core_exports as core,
  groupComparison,
  r_exports as r,
  version
};
//# sourceMappingURL=bio.viz.esm.js.map
