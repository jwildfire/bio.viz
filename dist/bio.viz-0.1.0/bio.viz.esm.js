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
  formatGroup: () => formatGroup,
  formatPair: () => formatPair,
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
function formatGroup(row) {
  const given2 = row && typeof row === "object" ? row : {};
  const group = text(given2.group);
  const counted = isCount(given2.counts);
  const none = {
    estimate: null,
    interval: null,
    bounds: null,
    level: null,
    method: null,
    p: null,
    adjustment: null
  };
  const whole = (status, result2) => ({
    status,
    text: group ? `${group}: ${result2}` : result2,
    result: result2,
    group,
    n: counted ? given2.counts : null,
    ...none,
    label: null
  });
  if (!group) return whole("refused", refused("the row does not name its group").text);
  const parts = read({
    status: given2.status,
    method: given2.method,
    p_value: given2.p_value,
    adjustment: given2.adjustment,
    reason: given2.reason,
    counts: counted ? given2.counts : void 0
  });
  if (parts.status !== "shown") return whole(parts.status, parts.text);
  const refuse5 = (what) => whole("refused", `Estimate not shown: ${what}.`);
  if (!isNumber(given2.estimate)) return refuse5("the group\u2019s estimate is not a number");
  const bounds = [given2.lower, given2.upper, given2.level];
  const absent = (value) => value === void 0 || value === null;
  let ends = null;
  let level = null;
  if (!bounds.every(absent)) {
    if (!bounds.every(isNumber) || !(given2.level > 0 && given2.level < 1)) {
      return refuse5("the interval of the group\u2019s estimate is incomplete");
    }
    level = `${Number((given2.level * 100).toPrecision(12))}%`;
    ends = `${figure(given2.lower)} to ${figure(given2.upper)}`;
  }
  const interval = ends ? `${level} confidence interval ${ends}` : null;
  const estimate = figure(given2.estimate);
  const result = `${estimate}${interval ? `, ${interval}` : ""}. ${parts.text}`;
  return {
    status: "shown",
    text: `${group}: ${result}`,
    result,
    group,
    n: given2.counts,
    estimate,
    interval,
    bounds: ends,
    level,
    method: parts.method,
    p: parts.p,
    adjustment: parts.adjustment,
    label: parts.label
  };
}
function formatPair(row) {
  const given2 = row && typeof row === "object" ? row : {};
  const names = [text(given2.x), text(given2.y)];
  const pair = names.every(Boolean) ? names : null;
  const counted = isCount(given2.counts);
  const whole = (status, said) => ({
    status,
    text: said,
    pair,
    n: counted ? given2.counts : null,
    estimate: null,
    interval: null,
    bounds: null,
    level: null
  });
  const refuse5 = (what) => whole("refused", `Estimate not shown: ${what}.`);
  if (!pair) return refuse5("the row does not name its two variables");
  const counts = counted ? `n = ${given2.counts}` : null;
  const reason = text(given2.reason);
  if (given2.status === "error") {
    return whole("error", withCounts(`R reported an error: ${reason || "no message"}`, counts));
  }
  if (reason) {
    return whole(
      "withheld",
      withCounts(SAYS_NOT_COMPUTED.test(reason) ? reason : `Not computed, ${reason}`, counts)
    );
  }
  if (!counted) return refuse5("the pair does not give the number of complete pairs it used");
  if (!isNumber(given2.estimate)) return refuse5("the pair\u2019s estimate is not a number");
  const bounds = [given2.lower, given2.upper, given2.level];
  const absent = (value) => value === void 0 || value === null;
  let ends = null;
  let level = null;
  if (!bounds.every(absent)) {
    if (!bounds.every(isNumber) || !(given2.level > 0 && given2.level < 1)) {
      return refuse5("the interval of the pair\u2019s estimate is incomplete");
    }
    level = `${Number((given2.level * 100).toPrecision(12))}%`;
    ends = `${figure(given2.lower)} to ${figure(given2.upper)}`;
  }
  const interval = ends ? `${level} confidence interval ${ends}` : null;
  const estimate = figure(given2.estimate);
  return {
    status: "shown",
    text: `${estimate}${interval ? `, ${interval}` : ""} (${counts}).`,
    pair,
    n: given2.counts,
    estimate,
    interval,
    bounds: ends,
    level
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
var VALUE_LABELS = Object.freeze({
  raw: "Result",
  baseline: "Baseline",
  change: "Change from baseline",
  fold_change: "Fold change from baseline",
  percent_change: "Percent change from baseline"
});
var SCALE_LABELS = Object.freeze({ linear: "Linear", log: "Logarithmic" });
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
function downloadCsv(kit, rows, columns, file) {
  const blob = new Blob([kit.buildCsv(rows, columns)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file;
  link.click();
  URL.revokeObjectURL(url);
}
function downloadListing(chart, file) {
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
  if ("profile" in settings && typeof settings.profile !== "boolean") {
    refuse4("`profile` must be true or false.");
  }
  if (settings.waiting_note !== null && !isText3(settings.waiting_note)) {
    refuse4("`waiting_note` must be a sentence, or null for none.");
  }
  if (settings.connection !== null && (typeof settings.connection !== "object" || typeof settings.connection.run !== "function")) {
    refuse4("`connection` must be a connection to R (BioViz.r.createConnection), or null.");
  }
}

// src/shared/tables.js
var isBlank2 = (value) => value === void 0 || value === null || typeof value === "number" && Number.isNaN(value) || typeof value === "string" && value.trim() === "";
var naturally = (a, b) => String(a).localeCompare(String(b), void 0, { numeric: true });
function levelsOf(values) {
  return [...new Set(values.filter((value) => !isBlank2(value)).map(String))].sort(naturally);
}
function listMeasures(results, settings) {
  const present3 = levelsOf(results.map((row) => row[settings.measure_col]));
  if (!settings.measures) return present3;
  const listed = settings.measures.filter((measure) => present3.includes(measure));
  return listed.length ? listed : present3;
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
var NOBODY_PASSES = "No participant passes the filters.";
var matches = (value, selection) => selection === null || selection === void 0 || selection === "" || (Array.isArray(selection) ? selection.map(String).includes(String(value)) : String(selection) === String(value));
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
          show(waiting(noted ? WAITING : withNote(WAITING), context));
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
  if (!rows.length) {
    return {
      panels: [],
      levels: [],
      shownLevels: [],
      colors: [null],
      panelLevels: [null],
      halfWidth: slots(1).halfWidth,
      baselineVisits: null,
      visitsNotDrawn: [],
      extent: null,
      filtered: kept ? kept.length : null,
      // No row to frame, as against rows that frame to no panel.
      noRows: true
    };
  }
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
var MARK_LABELS = { box: "Box", violin: "Violin", points: "Points" };
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
function nothingDrawn(model, rows = [{ model }]) {
  if (model.filtered === 0) return NOBODY_PASSES;
  return model.noRows || rows.some((row) => row.model.panels.length) ? "No participant has a value to draw for this choice." : NOTHING_AFTER_BASELINE;
}
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
      this.footnote.textContent = nothingDrawn(model);
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
      this.footnote.textContent = rows.length ? nothingDrawn(rows[0].model, rows) : NOTHING_AFTER_BASELINE;
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
            afterBuildTicks: (axis2) => {
              axis2.ticks = model.shownLevels.map((_, index) => ({ value: index }));
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

// src/association-scatter/configure.js
var SCALES = Object.freeze(["linear", "log"]);
var FITS = Object.freeze(["none", "identity", "linear", "smooth"]);
var METHODS = Object.freeze(["pearson", "spearman"]);
var DEFAULT_SETTINGS3 = Object.freeze({
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
  // What the chart opens on: the variable on each axis.
  x: null,
  y: null,
  color_by: null,
  panel_by: null,
  x_scale: "linear",
  y_scale: "linear",
  fit: "none",
  // What the controls offer.
  measures: null,
  numbers: null,
  groups: null,
  max_levels: 12,
  filters: null,
  // The listing of participants.
  details: null,
  page_size: 10,
  // The statistics line.
  connection: null,
  statistic: "Analyze_Correlation",
  method: "pearson",
  fit_statistic: "Analyze_Fit",
  waiting_note: null,
  // A way back, when another chart opened this one.
  back: null,
  // safety.viz's participant profile.
  profile: true,
  profile_details: null,
  studyday_col: null,
  normal_col_high: null,
  normal_col_low: null
});
function axis(value, setting) {
  if (value === null || value === void 0) return null;
  if (!isPlainObject4(value)) {
    refuse4(
      `\`${setting}\` must be a variable: { measure, visit, value } for a biomarker at a visit, or { col } for a participant-level number; or null.`
    );
  }
  const read2 = variable("col" in value && value.col != null ? { ...value, type: "number" } : value);
  return read2.kind === "column" ? { col: read2.col } : {
    measure: read2.measure,
    value: read2.value,
    ...read2.visit === null ? {} : { visit: read2.visit }
  };
}
function syncSettings2(overrides) {
  const settings = layOver(DEFAULT_SETTINGS3, overrides, "the association scatter");
  checkShared(settings, BASELINE_STATS);
  for (const key of [
    "visit_order_col",
    "unit_col",
    "participant_id_col",
    "color_by",
    "panel_by",
    "studyday_col",
    "normal_col_high",
    "normal_col_low"
  ]) {
    columnOrNull(settings, key);
  }
  for (const key of ["x_scale", "y_scale"]) {
    if (!SCALES.includes(settings[key])) {
      refuse4(`\`${key}\` must be one of ${SCALES.join(", ")}.`);
    }
  }
  if (!FITS.includes(settings.fit)) refuse4(`\`fit\` must be one of ${FITS.join(", ")}.`);
  if (!METHODS.includes(settings.method)) {
    refuse4(`\`method\` must be one of ${METHODS.join(", ")}.`);
  }
  for (const key of ["page_size", "max_levels"]) {
    if (!Number.isInteger(settings[key]) || settings[key] < 1) {
      refuse4(`\`${key}\` must be a whole number, one or more.`);
    }
  }
  if (settings.statistic !== null && !isText3(settings.statistic)) {
    refuse4("`statistic` must be the name of an R function, or null for no statistics line.");
  }
  if (settings.fit_statistic !== null && !isText3(settings.fit_statistic)) {
    refuse4(
      "`fit_statistic` must be the name of an R function, or null for no linear or smooth line."
    );
  }
  if (settings.back !== null && (!isPlainObject4(settings.back) || !isText3(settings.back.label) || typeof settings.back.action !== "function")) {
    refuse4("`back` must be { label, action }, a sentence and a function, or null for none.");
  }
  settings.x = axis(settings.x, "x");
  settings.y = axis(settings.y, "y");
  settings.baseline_visits = textList2(settings.baseline_visits, "baseline_visits");
  settings.measures = textList2(settings.measures, "measures");
  settings.numbers = fieldList(settings.numbers, "numbers");
  settings.groups = fieldList(settings.groups, "groups");
  settings.filters = fieldList(settings.filters, "filters");
  settings.details = fieldList(settings.details, "details");
  settings.profile_details = fieldList(settings.profile_details, "profile_details");
  return settings;
}

// src/shared/variables.js
function axisOf(spec) {
  if (spec.col !== void 0 && spec.col !== null) return { kind: "column", col: spec.col };
  const value = spec.value || "raw";
  return {
    kind: "measure",
    measure: spec.measure,
    value,
    visit: value === "baseline" ? null : spec.visit ?? null
  };
}
function variableOf(axis2) {
  if (axis2.kind === "column") return { col: axis2.col, type: "number" };
  return axis2.value === "baseline" ? { measure: axis2.measure, value: "baseline" } : { measure: axis2.measure, visit: axis2.visit, value: axis2.value };
}
function settingOf(axis2) {
  if (axis2.kind === "column") return { col: axis2.col };
  return {
    measure: axis2.measure,
    value: axis2.value,
    ...axis2.value === "baseline" ? {} : { visit: axis2.visit }
  };
}

// src/association-scatter/structureData.js
var RELATIVE2 = /* @__PURE__ */ new Set(["change", "fold_change", "percent_change"]);
var isNumeric = (value) => {
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
};
function numberColumns({ results, participants }, settings) {
  if (settings.numbers) return settings.numbers.map((spec) => ({ ...spec, table: "given" }));
  const columns = [];
  const taken = /* @__PURE__ */ new Set();
  const numbers = (values) => {
    const distinct = /* @__PURE__ */ new Set();
    for (const value of values) {
      if (isBlank2(value)) continue;
      if (!isNumeric(value)) return false;
      distinct.add(Number(value));
    }
    return distinct.size > 1;
  };
  if (participants && participants.length) {
    const idCol = settings.participant_id_col || settings.id_col;
    for (const name of Object.keys(participants[0])) {
      if (name === idCol) continue;
      taken.add(name);
      if (numbers(participants.map((row) => row[name]))) {
        columns.push({ value_col: name, label: name, table: "participants" });
      }
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
    if (constant && numbers(byParticipant.values())) {
      columns.push({ value_col: name, label: name, table: "results" });
    }
  }
  return columns;
}
function axisOffered(axis2, { measures, visits: visits2, numbers }) {
  if (!axis2) return false;
  if (axis2.kind === "column") return numbers.some((entry) => entry.value_col === axis2.col);
  if (!measures.includes(axis2.measure)) return false;
  return axis2.value === "baseline" || visits2.includes(axis2.visit);
}
function openingAxes(settings, offered) {
  const { measures, visits: visits2, numbers } = offered;
  const missing = [];
  const named = (key) => {
    if (!settings[key]) return null;
    const axis2 = axisOf(settings[key]);
    if (axisOffered(axis2, offered)) return axis2;
    missing.push(key);
    return null;
  };
  const at = (measure, visit) => ({ kind: "measure", measure, value: "raw", visit });
  const first = measures.length && visits2.length ? at(measures[0], visits2[0]) : numbers.length ? { kind: "column", col: numbers[0].value_col } : null;
  const x = named("x") || first;
  let y = named("y");
  if (!y && x) {
    if (measures.length > 1 && visits2.length) y = at(measures[1], visits2[0]);
    else if (measures.length && visits2.length > 1) y = at(measures[0], visits2[1]);
    else if (numbers.length) y = { kind: "column", col: numbers[0].value_col };
    else y = x;
  }
  return { x, y, missing };
}
function axisTitle(results, settings, axis2, numbers = []) {
  if (axis2.kind === "column") {
    const found = numbers.find((entry) => entry.value_col === axis2.col);
    return found ? found.label : axis2.col;
  }
  const words = label(variableOf(axis2));
  if (axis2.value === "fold_change") return words;
  if (axis2.value === "percent_change") return `${words} (%)`;
  const unit = unitOf(results, settings, axis2.measure);
  return unit ? `${words} (${unit})` : words;
}
function flatAtBaseline(axis2, results, settings) {
  if (axis2.kind !== "measure" || !RELATIVE2.has(axis2.value)) return false;
  const config = coreSettings(settings);
  const baseline = config.baseline_visits || visits(results, config).slice(0, 1);
  return baseline.length === 1 && baseline[0] === axis2.visit;
}
var VARIABLE_WORDS = Object.freeze({
  x: "x axis",
  y: "y axis",
  color: "colour",
  panel: "panel"
});
function buildScatter({ results, participants }, settings, state, options = {}) {
  const config = coreSettings(settings);
  const { participants: kept, results: rows } = keepFiltered(
    { results, participants },
    settings,
    state.filters,
    options.filterMatches
  );
  const empty = {
    panels: [],
    colors: [null],
    panelLevels: [null],
    participants: kept ? kept.length : 0,
    drawn: 0,
    dropped: [],
    unused: [],
    nonPositive: { x: 0, y: 0 },
    baselineVisits: null,
    extent: null,
    filtered: kept ? kept.length : null
  };
  if (!rows.length) return empty;
  const made = frame(
    { results: rows, participants: kept || void 0 },
    {
      x: variableOf(state.x),
      y: variableOf(state.y),
      ...state.colorBy ? { color: { col: state.colorBy } } : {},
      ...state.panelBy ? { panel: { col: state.panelBy } } : {}
    },
    config
  );
  const nonPositive = { x: 0, y: 0 };
  const data = made.data.filter((record) => {
    if (state.xScale === "log" && !(record.x > 0)) {
      nonPositive.x += 1;
      return false;
    }
    if (state.yScale === "log" && !(record.y > 0)) {
      nonPositive.y += 1;
      return false;
    }
    return true;
  });
  const colors = state.colorBy ? levelsOf(data.map((record) => record.color)) : [null];
  const panelLevels = state.panelBy ? levelsOf(data.map((record) => record.panel)) : [null];
  const panels = panelLevels.map((panelLevel) => {
    const records = data.filter(
      (record) => panelLevel === null || String(record.panel) === panelLevel
    );
    return {
      key: panelLevel ?? "",
      title: panelLevel ?? "",
      panelLevel,
      records,
      // How many of the panel's points each colour has, in the colours' order.
      counts: colors.map(
        (color) => records.filter((record) => color === null || String(record.color) === color).length
      )
    };
  });
  const extent = data.length ? {
    x: [
      Math.min(...data.map((record) => record.x)),
      Math.max(...data.map((record) => record.x))
    ],
    y: [
      Math.min(...data.map((record) => record.y)),
      Math.max(...data.map((record) => record.y))
    ]
  } : null;
  return {
    panels,
    colors,
    panelLevels,
    participants: made.participants,
    drawn: data.length,
    dropped: made.dropped,
    unused: made.unused,
    nonPositive,
    baselineVisits: made.baseline_visits,
    extent,
    filtered: kept ? kept.length : null
  };
}
var plotted = (value, scale) => scale === "log" ? Math.log10(value) : value;
function domainOf([least, greatest], scale) {
  if (scale === "log") {
    const factor = greatest > least ? (greatest / least) ** 0.05 : 1.05;
    return [least / factor, greatest * factor];
  }
  const room = (greatest - least) * 0.05 || Math.abs(greatest) * 0.05 || 1;
  return [least - room, greatest + room];
}
function identityLine(xDomain, yDomain, scales = { x: "linear", y: "linear" }) {
  const from = Math.max(xDomain[0], yDomain[0]);
  const to = Math.min(xDomain[1], yDomain[1]);
  if (!(to > from)) return null;
  if (scales.x === scales.y) {
    return [
      { x: from, y: from },
      { x: to, y: to }
    ];
  }
  const steps = 48;
  return Array.from({ length: steps + 1 }, (_, index) => {
    const at = from * (to / from) ** (index / steps);
    return { x: at, y: at };
  });
}
function brushed(records, region) {
  const [x0, x1] = [Math.min(...region.x), Math.max(...region.x)];
  const [y0, y1] = [Math.min(...region.y), Math.max(...region.y)];
  return records.filter(
    (record) => record.x >= x0 && record.x <= x1 && record.y >= y0 && record.y <= y1
  );
}

// src/association-scatter/statistic.js
var METHOD_LABELS = Object.freeze({
  pearson: "Pearson",
  spearman: "Spearman"
});
var FIT_LABELS = Object.freeze({
  none: "None",
  identity: "Identity (y = x)",
  linear: "Linear",
  smooth: "Smooth"
});
var FITS_FROM_R = Object.freeze(["linear", "smooth"]);
var COEFFICIENTS = { cor: "Pearson\u2019s r", rho: "Spearman\u2019s rho" };
var coefficient = (name) => Object.hasOwn(COEFFICIENTS, name) ? COEFFICIENTS[name] : name;
function rowsForR(settings, state, panel) {
  return panel.records.map((record) => ({
    [settings.id_col]: record[settings.id_col],
    x: plotted(record.x, state.xScale),
    y: plotted(record.y, state.yScale),
    ...state.colorBy ? { color: record.color } : {},
    ...state.panelBy ? { panel: record.panel } : {}
  }));
}
function viewId(settings, state, panel) {
  const filters = filtersInForce(state.filters);
  return {
    chart: "association-scatter",
    x: settingOf(state.x),
    y: settingOf(state.y),
    ...settings.baseline_visits ? { baseline_visits: [...settings.baseline_visits] } : {},
    baseline_stat: settings.baseline_stat,
    ...state.colorBy ? { color_by: state.colorBy, groups: sorted(panel.records.map((record) => record.color)) } : {},
    ...state.panelBy ? { panel_by: state.panelBy, panel: panel.panelLevel } : {},
    ...Object.keys(filters).length ? { filters } : {},
    ...state.xScale === "log" ? { x_scale: "log" } : {},
    ...state.yScale === "log" ? { y_scale: "log" } : {}
  };
}
function correlationRequest({ name, method, settings, state, panel }) {
  return {
    name,
    data: rowsForR(settings, state, panel),
    args: {
      strXCol: "x",
      strYCol: "y",
      strMethod: method,
      // A coefficient within each colour, when there is a colour.
      ...state.colorBy ? { strGroupCol: "color" } : {}
    },
    dataId: viewId(settings, state, panel),
    rows: panel.records.length
  };
}
var plain2 = (state, said) => ({ ...sentence(state, said), table: null });
function groupsTable(value, { color, name }) {
  const rows = Array.isArray(value.rows) ? value.rows.filter((row) => row && "group" in row) : [];
  if (!rows.length) return null;
  const formatted = rows.map(formatGroup);
  const shown2 = formatted.filter((row) => row.status === "shown");
  const methods = [...new Set(shown2.map((row) => row.method))];
  const labels = [...new Set(shown2.map((row) => row.label))];
  const levels = [...new Set(shown2.map((row) => row.level).filter(Boolean))];
  const by = methods.length === 1 ? `, each by ${methods[0]}` : "";
  const head = name || "Coefficient";
  return {
    caption: `Within each level of ${color}${by}.` + (labels.length ? ` ${labels.join(" ")}` : ""),
    head: [
      color,
      "n",
      levels.length === 1 ? `${head} (${levels[0]} confidence interval)` : head,
      "p"
    ],
    rows: formatted.map((row, index) => {
      const warned = typeof rows[index].warning === "string" ? rows[index].warning : null;
      const within = row.bounds && levels.length === 1 ? ` (${row.bounds})` : row.interval ? ` (${row.interval})` : "";
      return {
        status: row.status,
        head: row.group || "",
        // What R said of this level alone, and its method where the levels' differ.
        sub: [
          methods.length > 1 && row.status === "shown" ? row.method : null,
          warned ? `R warned: ${warned}` : null
        ].filter(Boolean).join(" ") || null,
        cells: row.status === "shown" ? [String(row.n), `${row.estimate}${within}`, row.p] : (
          // A level with no coefficient says why in its place.
          [row.n === null ? "" : String(row.n), row.result, ""]
        )
      };
    })
  };
}
function describeCorrelation(result, context = {}) {
  if (!result || result.status !== "ok") {
    const failure = failureOf(result);
    return plain2(failure.state, failure.text);
  }
  const value = result.value && typeof result.value === "object" ? result.value : {};
  const formatted = formatStatistic(value);
  const described = plain2(formatted.status, formatted.text);
  if (formatted.status === "shown") {
    const estimates = (Array.isArray(value.estimates) ? value.estimates : []).filter(Boolean);
    described.estimates = estimates.map(
      (row) => formatEstimate({ ...row, name: coefficient(row.name) }).text
    );
    if (context.color) {
      described.table = groupsTable(value, {
        color: context.color,
        name: estimates.length ? coefficient(estimates[0].name) : null
      });
    }
  }
  described.remarks = [
    ...remarksOf(value),
    ...context.scale ? [{ kind: "scale", text: context.scale }] : []
  ];
  described.scope = context.scope || null;
  return described;
}
var ON_A_LOGARITHM = {
  pearson: "Pearson\u2019s coefficient is of the values as plotted, not of the values themselves.",
  spearman: "Spearman\u2019s coefficient is computed on ranks, which a logarithm does not change.",
  linear: "The line is fitted to the values as plotted, so it is straight on these axes, and its slope and intercept are of the logarithms.",
  smooth: "The curve is fitted to the values as plotted."
};
function scaleText({ xScale, yScale, x, y, method }) {
  const logged = [xScale === "log" ? x : null, yScale === "log" ? y : null].filter(Boolean);
  if (!logged.length) return null;
  const which = logged.length === 2 ? "Both axes are logarithmic" : `The ${xScale === "log" ? "x" : "y"} axis is logarithmic`;
  const given2 = logged.map((name) => `the base-10 logarithm of ${name}`).join(" and ");
  return `${which}: R was given ${given2}. ${ON_A_LOGARITHM[method] || ""}`.trim();
}
function scopeText2({ n, panel, color, filters = [] }) {
  const said = [
    `This coefficient is of the ${n} participant${n === 1 ? "" : "s"} ` + (panel ? `drawn in this panel (${panel}).` : "drawn.")
  ];
  if (panel) {
    said.push(
      "Each panel has a coefficient of its own, and they are not adjusted for one another."
    );
  }
  if (color) {
    said.push(
      `It takes every level of ${color} together; the table gives each level its own, and they are not adjusted for one another.`
    );
  }
  if (filters.length) said.push(filtersSaid(filters));
  return said.join(" ");
}
function fitRequest({ name, fit, settings, state, panel }) {
  return {
    name,
    data: rowsForR(settings, state, panel),
    args: {
      strXCol: "x",
      strYCol: "y",
      strMethod: fit,
      // A line within each colour as well, when there is a colour.
      ...state.colorBy ? { strGroupCol: "color" } : {}
    },
    dataId: viewId(settings, state, panel),
    rows: panel.records.length
  };
}
var FIT_WORDS = { linear: "linear fit", smooth: "smooth" };
var present2 = (value) => value !== void 0 && value !== null;
var isCount2 = (value) => Number.isInteger(value) && value >= 0;
function fitsByGroup(value) {
  const rows = Array.isArray(value.rows) ? value.rows.filter(Boolean) : [];
  const estimates = Array.isArray(value.estimates) ? value.estimates.filter(Boolean) : [];
  const groups = [...new Set(rows.map((row) => row.group).filter(present2))];
  return groups.map((group) => ({
    group,
    answer: rows.find((row) => row.group === group),
    estimate: (name) => estimates.find((row) => row.group === group && row.name === name) || {}
  }));
}
function fitTable(value, color) {
  const fits = fitsByGroup(value);
  if (!fits.length) return null;
  const formatted = fits.map(({ group, answer, estimate }) => {
    const of = (name) => formatGroup({
      group,
      counts: answer.counts,
      method: answer.method,
      p_value: answer.p_value,
      adjustment: answer.adjustment,
      status: answer.status,
      reason: answer.reason,
      estimate: estimate(name).estimate,
      lower: estimate(name).lower,
      upper: estimate(name).upper,
      level: estimate(name).level
    });
    return { slope: of("Slope"), intercept: of("Intercept"), warning: answer.warning };
  });
  const shown2 = formatted.filter((row) => row.slope.status === "shown");
  const methods = [...new Set(shown2.map((row) => row.slope.method))];
  const labels = [...new Set(shown2.map((row) => row.slope.label))];
  const levels = [...new Set(shown2.map((row) => row.slope.level).filter(Boolean))];
  const interval = levels.length === 1 ? ` (${levels[0]} confidence interval)` : "";
  const cell = (part) => `${part.estimate}${part.bounds ? ` (${part.bounds})` : ""}`;
  return {
    caption: `The line within each level of ${color}` + (methods.length === 1 ? `, each by ${methods[0]}` : "") + `.${labels.length ? ` ${labels.join(" ")}` : ""}`,
    head: [color, "n", `Slope${interval}`, `Intercept${interval}`, "p, slope"],
    rows: formatted.map(({ slope, intercept, warning }) => ({
      status: slope.status,
      head: slope.group || "",
      sub: typeof warning === "string" ? `R warned: ${warning}` : null,
      cells: slope.status === "shown" && intercept.status === "shown" ? [String(slope.n), cell(slope), cell(intercept), slope.p] : [slope.n === null ? "" : String(slope.n), slope.result, "", ""]
    }))
  };
}
function describeFit(result, context = {}) {
  const words = FIT_WORDS[context.fit] || "fitted line";
  if (!result || result.status !== "ok") {
    const failure = failureOf(result);
    return plain2(failure.state, `The ${words} is not drawn. ${failure.text}`);
  }
  const value = result.value && typeof result.value === "object" ? result.value : {};
  const smooth = context.fit === "smooth" && (value.status === void 0 || value.status === "ok");
  let described;
  if (smooth) {
    const method = typeof value.method === "string" ? value.method : "Smooth";
    described = isCount2(value.counts) ? plain2("shown", `${method}: the curve and its band are R\u2019s (n = ${value.counts}).`) : plain2("refused", "Smooth not shown: the result does not give the counts it used.");
  } else {
    const formatted = formatStatistic(value);
    described = plain2(formatted.status, formatted.text);
  }
  if (described.state !== "shown") described.text = `The ${words} is not drawn. ${described.text}`;
  if (described.state === "shown") {
    const estimates = (Array.isArray(value.estimates) ? value.estimates : []).filter(Boolean);
    const overall = estimates.filter((row) => !present2(row.group));
    const slopeFirst = [...overall].sort(
      (a, b) => Number(b.name === "Slope") - Number(a.name === "Slope")
    );
    const rSquared = (Array.isArray(value.statistic) ? value.statistic : []).find(
      (row) => row && row.name === "r.squared"
    );
    described.estimates = [
      ...slopeFirst.map((row) => formatEstimate(row).text),
      ...rSquared ? [formatEstimate({ name: "R-squared", estimate: rSquared.value }).text] : []
    ];
    if (context.color && !smooth) described.table = fitTable(value, context.color);
  }
  const withheld = smooth && context.color ? fitsByGroup(value).filter(({ answer }) => answer.status && answer.status !== "ok").map(({ group, answer }) => ({
    kind: "withheld",
    text: formatGroup({ ...answer, group }).text
  })) : [];
  described.remarks = [
    ...withheld,
    ...remarksOf(value),
    ...context.scale ? [{ kind: "scale", text: context.scale }] : []
  ];
  described.scope = context.scope || null;
  return described;
}
function fitCurves(result, state) {
  if (!result || result.status !== "ok" || !result.value) return null;
  const rows = Array.isArray(result.value.rows) ? result.value.rows : [];
  const isPoint = (row) => row && [row.x, row.fit, row.lower, row.upper].every((part) => typeof part === "number");
  const placed = (value, scale) => scale === "log" ? 10 ** value : value;
  const lines = /* @__PURE__ */ new Map();
  for (const row of rows.filter(isPoint)) {
    const group = present2(row.group) ? String(row.group) : null;
    if (!lines.has(group)) lines.set(group, { group, curve: [], lower: [], upper: [] });
    const line = lines.get(group);
    const x = placed(row.x, state.xScale);
    line.curve.push({ x, y: placed(row.fit, state.yScale) });
    line.lower.push({ x, y: placed(row.lower, state.yScale) });
    line.upper.push({ x, y: placed(row.upper, state.yScale) });
  }
  return lines.size ? [...lines.values()] : null;
}
function fitScopeText({ fit, n, panel, color }) {
  const words = FIT_WORDS[fit] || "fitted line";
  const whom = `the ${n} participant${n === 1 ? "" : "s"} ` + (panel ? `drawn in this panel (${panel})` : "drawn");
  if (!color) {
    return `The line is R\u2019s ${words} of y on x for ${whom}, with R\u2019s band about it.`;
  }
  return `Each level of ${color} has R\u2019s ${words} of y on x in its colour, with R\u2019s band about it. The dashed line is the ${words} of ${whom} together, drawn without its band.`;
}
function createStatisticDesk2({ connection, note = null }) {
  const isFit = (context) => Boolean(context && context.kind === "fit");
  return createDesk({
    connection,
    note,
    describe: (result, context) => isFit(context) ? describeFit(result, context) : describeCorrelation(result, context),
    waiting: (said, context) => plain2("waiting", isFit(context) ? said.replace(/^Statistics/, "Fitted line") : said)
  });
}

// src/association-scatter.js
var NONE2 = "";
var MODULE_CLASS = "bv-association-scatter";
var STYLE_ID2 = "bio-viz-association-scatter-styles";
var STYLES2 = `${lineStyles(`.${MODULE_CLASS}`)}
.${MODULE_CLASS} .sv-chart-wrap canvas,.${MODULE_CLASS} .bv-panel-canvas canvas{cursor:crosshair}
.${MODULE_CLASS} canvas.bv-region-on{touch-action:none}
.${MODULE_CLASS} .bv-stat-remark[data-kind=scale]{color:#1f2933}
.${MODULE_CLASS} .bv-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem .7rem;margin:0 0 .6rem}
.${MODULE_CLASS} .bv-toolbar:empty{display:none}
.${MODULE_CLASS} .bv-toolbar button{font:inherit;font-size:.85rem;padding:.35rem .75rem;border:1px solid #b8c0cc;border-radius:6px;background:#fff;color:#1f2933;cursor:pointer}
.${MODULE_CLASS} .bv-toolbar button[aria-pressed=true]{border-color:#0b62a4;background:#eaf2fb;color:#0b3d63;box-shadow:inset 0 0 0 1px #0b62a4}
.${MODULE_CLASS} .bv-toolbar button:focus-visible{outline:2px solid #0b62a4;outline-offset:1px}
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
var HINT_POINTER = "Drag across the points to list the participants in a region. Click a point to list its participant and open their profile.";
var HINT_TOUCH = "Tap a point to list its participant and open their profile. To list a region, tap Select a region, then drag on the chart.";
var HINT_REGION = "Selecting a region: drag on the chart to list the participants inside it. The page does not scroll from the chart until you tap Select a region again.";
var NOTHING_AT_BASELINE = "An axis is a change at the baseline visit, where it is the same for everyone. Choose a later visit to draw.";
var CLICK_SLOP = 4;
var plural = (n, word = "participant") => `${n} ${word}${n === 1 ? "" : "s"}`;
var AssociationScatter = class {
  constructor(element, settings) {
    this.kit = findKit("the association scatter");
    this.element = typeof element === "string" ? document.querySelector(element) : element;
    if (!this.element) throw new Error(`bio.viz: association scatter target not found: ${element}`);
    this.settings = syncSettings2(settings);
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
    this.connection = this.settings.connection || createConnection();
    this.desk = createStatisticDesk2({
      connection: this.connection,
      note: this.settings.waiting_note
    });
  }
  renderShell() {
    const { kit } = this;
    mountShell(this, {
      moduleClass: MODULE_CLASS,
      styleId: STYLE_ID2,
      styles: STYLES2,
      listingFile: "bio.viz-association-scatter-listing.csv"
    });
    this.toolbar = kit.createElement("div", "bv-toolbar");
    this.notes.before(this.toolbar);
    this.touch = Boolean(globalThis.matchMedia && globalThis.matchMedia("(pointer: coarse)").matches) || (globalThis.navigator ? globalThis.navigator.maxTouchPoints > 0 : false);
    this.buildToolbar();
  }
  buildToolbar() {
    const { kit, settings } = this;
    this.toolbar.innerHTML = "";
    if (settings.back) {
      const back = kit.createElement("button", "bv-back", settings.back.label);
      back.type = "button";
      back.onclick = () => settings.back.action(this);
      this.toolbar.append(back);
    }
    this.regionButton = null;
    if (this.touch) {
      const region = kit.createElement("button", "bv-region", "Select a region");
      region.type = "button";
      region.setAttribute("aria-pressed", String(this.regionMode));
      region.onclick = () => this.setRegionMode(!this.regionMode);
      this.regionButton = region;
      this.toolbar.append(region);
    }
  }
  // With a finger, a drag on the chart scrolls the page unless this is on.
  setRegionMode(on) {
    this.regionMode = Boolean(on);
    if (this.regionButton) this.regionButton.setAttribute("aria-pressed", String(this.regionMode));
    this.charts.forEach((chart) => chart.canvas.classList.toggle("bv-region-on", this.regionMode));
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
    const given2 = settings || {};
    this.settings = syncSettings2({ ...this.settings, ...given2 });
    syncHost(this);
    if ("connection" in given2 || "waiting_note" in given2) this.connect();
    this.readTables();
    const opening = this.seedState();
    const moved = {
      x: "x",
      y: "y",
      color_by: "colorBy",
      panel_by: "panelBy",
      x_scale: "xScale",
      y_scale: "yScale",
      fit: "fit",
      method: "method",
      filters: "filters"
    };
    for (const [setting, key] of Object.entries(moved)) {
      if (setting in given2) this.state[key] = opening[key];
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
    this.filterSpecs = filterColumns(this.tables, settings, this.categories).map(
      (spec) => this.kit.normalizeFilterSpec(spec)
    );
    this.opening = openingAxes(settings, this.offered());
    if (results.length) {
      this.opening.missing.forEach(
        (key) => console.warn(
          `The initial ${key} variable ${JSON.stringify(settings[key])} cannot be drawn from these tables. Defaulting to the first variables the tables have.`
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
      colorBy: has(settings.color_by) ? settings.color_by : NONE2,
      panelBy: has(settings.panel_by) ? settings.panel_by : NONE2,
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
    for (const key of ["x", "y"]) {
      if (!axisOffered(this.state[key], this.offered())) this.state[key] = opening[key];
    }
    if (this.state.colorBy && !has(this.state.colorBy)) this.state.colorBy = NONE2;
    if (this.state.panelBy && !has(this.state.panelBy)) this.state.panelBy = NONE2;
  }
  labelOf(column) {
    const found = this.categories.find((entry) => entry.value_col === column);
    return found ? found.label : column;
  }
  titleOf(axis2) {
    return axisTitle(this.tables.results, this.settings, axis2, this.numbers);
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
      input.setAttribute("aria-label", labelText);
      options.forEach(([value, text2]) => kit.option(input, value, text2, value === selected));
      input.onchange = () => onChange(input.value);
      return addControl(labelText.replace(/^[XY] axis: /, ""), input, parent);
    };
    const axisControls = (key, title) => {
      const axis2 = state[key];
      if (!axis2) return;
      const section = addSection(title);
      const named = (text2) => `${title}: ${text2}`;
      const variables = [
        ...this.measures.map((measure) => [`m:${measure}`, measure]),
        ...this.numbers.map((entry) => [`c:${entry.value_col}`, `${entry.label} (participant)`])
      ];
      select(
        `${key}-variable`,
        named("Variable"),
        variables,
        axis2.kind === "column" ? `c:${axis2.col}` : `m:${axis2.measure}`,
        (next) => {
          const name = next.slice(2);
          state[key] = next.startsWith("c:") ? { kind: "column", col: name } : {
            kind: "measure",
            measure: name,
            value: axis2.kind === "measure" ? axis2.value : "raw",
            visit: axis2.kind === "measure" ? axis2.visit : this.visits[0] ?? null
          };
          redraw(true);
        },
        section
      );
      if (axis2.kind === "measure") {
        select(
          `${key}-value`,
          named("Value"),
          VALUE_TYPES.map((type) => [type, VALUE_LABELS[type]]),
          axis2.value,
          (next) => {
            axis2.value = next;
            axis2.visit = next === "baseline" ? null : axis2.visit ?? this.visits[0] ?? null;
            redraw(true);
          },
          section
        );
        if (axis2.value !== "baseline") {
          select(
            `${key}-visit`,
            named("Visit"),
            this.visits.map((visit) => [visit, visit]),
            axis2.visit,
            (next) => {
              axis2.visit = next;
              redraw(false);
            },
            section
          );
        }
      }
      select(
        `${key}-scale`,
        named("Scale"),
        SCALES.map((scale) => [scale, SCALE_LABELS[scale]]),
        state[`${key}Scale`],
        (next) => {
          state[`${key}Scale`] = next;
          redraw(false);
        },
        section
      );
    };
    axisControls("x", "X axis");
    axisControls("y", "Y axis");
    const columns = this.categories.map((entry) => [entry.value_col, entry.label]);
    if (columns.length) {
      const group = addSection("Groups");
      const optional = [[NONE2, "None"], ...columns];
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
      select(
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
    }
    const display = addSection("Display");
    const fit = select(
      "fit",
      "Fitted line",
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
        "small",
        "bv-control-note",
        "The identity line is y = x. A linear fit and a smooth are computed by R, with their band."
      )
    );
    if (this.settings.statistic) {
      const statistics = addSection("Statistics");
      select(
        "method",
        "Method",
        METHODS.map((method) => [method, METHOD_LABELS[method]]),
        state.method,
        (next) => {
          state.method = next;
          redraw(false);
        },
        statistics
      );
    }
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
    const round = this.desk.begin();
    this.asked = [];
    this.destroyCharts();
    this.clearSelection();
    this.notes.innerHTML = "";
    this.multiplesWrap.innerHTML = "";
    this.statLine.textContent = "";
    this.statLine.dataset.state = "empty";
    this.chartWrap.classList.remove("sv-hidden");
    this.model = null;
    const { results } = this.tables;
    const { state } = this;
    if (!results.length || !state.x || !state.y) {
      this.footnote.textContent = "No results to draw.";
      return;
    }
    if ([state.x, state.y].some((axis2) => flatAtBaseline(axis2, results, this.settings))) {
      this.footnote.textContent = NOTHING_AT_BASELINE;
      return;
    }
    const model = buildScatter(this.tables, this.settings, state, {
      filterMatches: this.kit.filterMatches
    });
    this.model = model;
    this.updateNotes(model);
    if (!model.drawn) {
      this.footnote.textContent = model.filtered === 0 ? NOBODY_PASSES : "No participant has a value on both axes for this choice.";
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
    this.chartWrap.classList.add("sv-hidden");
    model.panels.forEach((panel) => {
      const card = this.kit.createElement("div", "sv-multiple bv-panel");
      card.dataset.panel = panel.title;
      card.append(this.kit.createElement("h3", null, panel.title));
      card.append(
        this.kit.createElement("p", "bv-panel-note", `${plural(panel.records.length)} drawn.`)
      );
      const wrap = this.kit.createElement("div", "bv-panel-canvas");
      const canvas = document.createElement("canvas");
      wrap.append(canvas);
      const line = this.kit.createElement("div", "bv-statistic");
      line.setAttribute("role", "status");
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
        label: color === null ? "All participants" : color,
        data: records.map((record) => ({ x: record.x, y: record.y, record })),
        showLine: false,
        backgroundColor: (context) => hexToRgba(hex, faded(context) ? 0.12 : 0.55),
        borderColor: (context) => hexToRgba(hex, faded(context) ? 0.25 : 1),
        pointRadius: narrow ? 2.5 : 3,
        pointHoverRadius: 5,
        pointHitRadius: 5
      };
    });
    const axisOf2 = (key) => ({
      type: state[`${key}Scale`] === "log" ? "logarithmic" : "linear",
      min: domains[key][0],
      max: domains[key][1],
      // The ends of the axis are room about the data, not round numbers.
      ticks: { includeBounds: false, ...narrow ? { maxTicksLimit: 6 } : {} },
      title: { display: true, text: titles[key] }
    });
    const chart = new this.kit.Chart(canvas.getContext("2d"), {
      type: "scatter",
      data: { datasets },
      options: {
        animation: false,
        maintainAspectRatio: false,
        responsive: true,
        interaction: { mode: "nearest", intersect: true },
        plugins: {
          legend: {
            display: coloured,
            position: "top",
            labels: { usePointStyle: true },
            title: { display: coloured, text: this.labelOf(state.colorBy) },
            // A colour is not switched off from the key: the coefficient below
            // is of every point drawn, and a hidden one would still be in it.
            onClick: () => {
            }
          },
          tooltip: {
            callbacks: {
              title: () => "",
              label: (context) => this.tooltip(context.raw, titles)
            }
          }
        },
        scales: { x: axisOf2("x"), y: axisOf2("y") }
      },
      plugins: [this.linePlugin(domains, model.colors), this.regionPlugin(panel)]
    });
    chart.$panel = panel;
    chart.$model = model;
    chart.$fit = null;
    canvas.classList.toggle("bv-region-on", this.regionMode);
    canvas.setAttribute("role", "img");
    canvas.setAttribute(
      "aria-label",
      `${titles.y} against ${titles.x}${panel.title ? `, ${panel.title}` : ""}: ${plural(panel.records.length)} drawn`
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
        if (this.state.fit === "identity") {
          const line = identityLine(domains.x, domains.y, {
            x: this.state.xScale,
            y: this.state.yScale
          });
          chart.$identity = line;
          if (line) {
            path(line);
            ctx.strokeStyle = "#52616f";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            ctx.stroke();
          }
        }
        const lines = chart.$fit || [];
        const grouped = lines.some((line) => line.group !== null);
        lines.forEach((line) => {
          const overall = line.group === null;
          const index = overall ? -1 : colors.indexOf(line.group);
          const hex = overall ? "#1f2933" : PALETTE[Math.max(index, 0) % PALETTE.length];
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
        ctx.fillStyle = "rgba(120, 120, 120, 0.18)";
        ctx.strokeStyle = "rgba(90, 90, 90, 0.65)";
        ctx.lineWidth = 1;
        ctx.fillRect(left, top, right - left, bottom - top);
        ctx.strokeRect(left, top, right - left, bottom - top);
        ctx.restore();
      }
    };
  }
  tooltip(raw, titles) {
    if (!raw || !raw.record) return "";
    const { record } = raw;
    return [
      `${record[this.settings.id_col]}${record.color === void 0 ? "" : ` (${record.color})`}`,
      `${titles.x}: ${shown(record.x)}`,
      `${titles.y}: ${shown(record.y)}`
    ];
  }
  // The participants seen and drawn, and why any was left out.
  updateNotes(model) {
    const { kit, state } = this;
    const add = (text2, warning) => this.notes.append(kit.createElement("span", warning ? "sv-warning" : null, text2));
    add(`${model.drawn} of ${plural(model.participants)} drawn.`);
    model.dropped.forEach((entry) => {
      const where = entry.variable ? ` (${VARIABLE_WORDS[entry.variable]})` : "";
      add(`${entry.n} left out: ${entry.reason}${where}.`, true);
    });
    for (const key of ["x", "y"]) {
      if (model.nonPositive[key]) {
        add(
          `${model.nonPositive[key]} left out: zero or less on the ${key} axis, which a logarithmic scale cannot show.`,
          true
        );
      }
    }
    model.unused.filter((entry) => entry.reason !== UNUSED.MISSING_RESULT).forEach(
      (entry) => add(`${entry.n} row${entry.n === 1 ? "" : "s"} not used: ${entry.reason}.`, true)
    );
    if (model.filtered !== null && model.filtered < this.tables.participants.length) {
      add(`${model.filtered} of ${this.tables.participants.length} participants pass the filters.`);
    }
    if (model.baselineVisits && [state.x, state.y].some((axis2) => axis2.value !== "raw")) {
      add(`Baseline visit: ${model.baselineVisits.join(", ")}.`);
    }
  }
  // ---- The statistics line, and the fitted line ---------------------------------
  // Asks R for one panel: its coefficient, printed under the panel, and, when a
  // linear fit or a smooth is chosen, its line, drawn on the panel. Each panel
  // asks for itself, on its own rows, and is answered for itself.
  ask(round, chart, panel, model, line) {
    const { settings, state, kit } = this;
    const several = model.panels.length > 1;
    const lineFromR = FITS_FROM_R.includes(state.fit) && Boolean(settings.fit_statistic);
    const coefficient2 = kit.createElement("div", "bv-coefficient");
    const fit = kit.createElement("div", "bv-fit");
    if (settings.statistic) line.append(coefficient2);
    if (lineFromR) line.append(fit);
    const show = (target, description) => {
      writeStatistic(kit, target, description);
      line.dataset.state = (settings.statistic ? coefficient2 : fit).dataset.state || "empty";
    };
    const record = (request2, kind) => {
      const asked2 = {
        panel: panel.title,
        kind,
        name: request2.name,
        args: request2.args,
        dataId: request2.dataId,
        rows: request2.rows,
        answer: null
      };
      this.asked.push(asked2);
      return asked2;
    };
    const color = state.colorBy ? this.labelOf(state.colorBy) : null;
    const scaleOf = (method) => scaleText({
      xScale: state.xScale,
      yScale: state.yScale,
      x: this.titleOf(state.x),
      y: this.titleOf(state.y),
      method
    });
    if (settings.statistic) {
      const request2 = correlationRequest({
        name: settings.statistic,
        method: state.method,
        settings,
        state,
        panel
      });
      const asked2 = record(request2, "coefficient");
      round.ask(
        request2,
        (description, answer) => {
          if (answer) asked2.answer = answer;
          show(coefficient2, description);
        },
        {
          scope: scopeText2({
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
    const asked = record(request, "fit");
    round.ask(
      request,
      (description, answer) => {
        if (answer) asked.answer = answer;
        chart.$fit = answer ? fitCurves(answer, state) : null;
        chart.draw();
        show(fit, description);
      },
      {
        kind: "fit",
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
      x: [Math.min(from.x, to.x), Math.max(from.x, to.x)].map(
        (pixel) => chart.scales.x.getValueForPixel(pixel)
      ),
      // The lower pixel is the greater value.
      y: [Math.max(from.y, to.y), Math.min(from.y, to.y)].map(
        (pixel) => chart.scales.y.getValueForPixel(pixel)
      )
    });
    let start = null;
    let pointer = null;
    let dragged = false;
    let swallowClick = false;
    const onDown = (event) => {
      if (event.pointerType === "touch" && !this.regionMode) return;
      if (event.button) return;
      start = position(event);
      pointer = event.pointerId;
      dragged = false;
      if (canvas.setPointerCapture) {
        try {
          canvas.setPointerCapture(pointer);
        } catch {
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
      const [hit] = chart.getElementsAtEventForMode(event, "nearest", { intersect: true }, false);
      if (!hit) {
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
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("click", onClick);
    chart.$detach = () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("click", onClick);
    };
  }
  // The panel a caller names: by its title, or the only one.
  panelNamed(name) {
    if (!this.model) return null;
    const { panels } = this.model;
    if (name === void 0 || name === null) return panels.length === 1 ? panels[0] : null;
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
    const given2 = region || {};
    const panel = this.panelNamed(given2.panel);
    const pair = (ends) => Array.isArray(ends) && ends.length === 2 && ends.every((end) => Number.isFinite(end));
    if (!panel || !pair(given2.x) || !pair(given2.y)) {
      throw new TypeError(
        "bio.viz: brush() takes { x: [from, to], y: [from, to] }, and `panel`, the title of a panel, when the chart has more than one."
      );
    }
    this.selectRegion(panel, {
      x: [Math.min(...given2.x), Math.max(...given2.x)],
      y: [Math.min(...given2.y), Math.max(...given2.y)]
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
    this.charts.forEach((chart) => chart.update("none"));
    return this;
  }
  selectRegion(panel, region) {
    const records = brushed(panel.records, region);
    this.clearSelection();
    this.charts.forEach((chart) => {
      chart.setActiveElements([]);
      if (chart.tooltip) chart.tooltip.setActiveElements([], { x: 0, y: 0 });
    });
    if (!records.length) {
      this.footnote.textContent = `No participant is in that region. ${this.hint()}`;
      this.charts.forEach((chart) => chart.update("none"));
      return;
    }
    this.selection = {
      panel,
      region,
      ids: new Set(records.map((record) => String(record[this.settings.id_col])))
    };
    this.list(panel, records, "in the region");
    this.charts.forEach((chart) => chart.update("none"));
  }
  // A point: its participant is listed, and their profile opened.
  pick(panel, record) {
    this.clearSelection();
    const id = String(record[this.settings.id_col]);
    this.selection = { panel, region: null, ids: /* @__PURE__ */ new Set([id]) };
    this.list(panel, [record], "at the point");
    this.charts.forEach((chart) => chart.update("none"));
    this.select(id);
  }
  // The columns of the listing: the ones named in settings, or the participant,
  // the two values drawn, the colour and the panel.
  listingColumns() {
    if (this.settings.details) return this.settings.details;
    const { state, settings } = this;
    const columns = [
      { value_col: settings.id_col, label: "Participant" },
      { value_col: "x", label: this.titleOf(state.x) },
      { value_col: "y", label: this.titleOf(state.y) }
    ];
    if (state.colorBy) columns.push({ value_col: "color", label: this.labelOf(state.colorBy) });
    if (state.panelBy) columns.push({ value_col: "panel", label: this.labelOf(state.panelBy) });
    return columns;
  }
  list(panel, records, where) {
    showListing(this, {
      columns: this.listingColumns(),
      rows: records.map((record) => ({ ...record, x: shown(record.x), y: shown(record.y) }))
    });
    const drawn = panel.records.length;
    const of = panel.title ? ` in this panel (${panel.title})` : "";
    this.footnote.textContent = `${plural(records.length)} ${where} listed, of the ${drawn} drawn${of}. ` + (this.settings.statistic ? `The statistics are still of all ${drawn}: a region lists participants and does not change what R is asked. ` : "") + "Click a row to open the participant's profile.";
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
    this.desk.begin();
    this.destroyCharts();
    this.kit.unmountProfileRail(this.host);
    this.element.innerHTML = "";
  }
};
function associationScatter(element, settings) {
  return new AssociationScatter(element, settings);
}

// src/correlation-matrix/configure.js
var MODES = Object.freeze(["biomarkers", "visits"]);
var VIEWS = Object.freeze(["grid", "scatters"]);
var METHODS2 = Object.freeze(["pearson", "spearman"]);
var SCATTER_LIMIT = 6;
var DEFAULT_SETTINGS4 = Object.freeze({
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
  mode: "biomarkers",
  visit: null,
  biomarkers: null,
  measure: null,
  visits: null,
  value_type: "raw",
  view: "grid",
  // The most variables drawn at a time.
  limit: 12,
  // What the controls offer.
  measures: null,
  max_levels: 12,
  filters: null,
  // The statistics.
  connection: null,
  statistic: "Analyze_CorrelationMatrix",
  method: "pearson",
  min_pairs: null,
  waiting_note: null,
  // The association scatter a cell opens.
  scatter: null
});
function syncSettings3(overrides) {
  const settings = layOver(DEFAULT_SETTINGS4, overrides, "the correlation matrix");
  checkShared(settings, BASELINE_STATS);
  for (const key of ["visit_order_col", "unit_col", "participant_id_col"]) {
    columnOrNull(settings, key);
  }
  for (const [key, what] of [
    ["visit", "a visit"],
    ["measure", "a biomarker"]
  ]) {
    if (settings[key] !== null && !isText3(settings[key])) {
      refuse4(`\`${key}\` must be the name of ${what}, or null.`);
    }
  }
  if (!MODES.includes(settings.mode)) refuse4(`\`mode\` must be one of ${MODES.join(", ")}.`);
  if (!VIEWS.includes(settings.view)) refuse4(`\`view\` must be one of ${VIEWS.join(", ")}.`);
  if (!VALUE_TYPES.includes(settings.value_type)) {
    refuse4(`\`value_type\` must be one of ${VALUE_TYPES.join(", ")}.`);
  }
  if (!METHODS2.includes(settings.method)) {
    refuse4(`\`method\` must be one of ${METHODS2.join(", ")}.`);
  }
  if (!Number.isInteger(settings.max_levels) || settings.max_levels < 1) {
    refuse4("`max_levels` must be a whole number, one or more.");
  }
  if (!Number.isInteger(settings.limit) || settings.limit < 2) {
    refuse4("`limit` must be a whole number, two or more.");
  }
  if (settings.min_pairs !== null && !(typeof settings.min_pairs === "number" && Number.isFinite(settings.min_pairs) && settings.min_pairs > 0)) {
    refuse4("`min_pairs` must be a number above zero, or null for R\u2019s own minimum.");
  }
  if (settings.statistic !== null && !isText3(settings.statistic)) {
    refuse4("`statistic` must be the name of an R function, or null for no coefficients.");
  }
  if (settings.scatter !== null && !isPlainObject4(settings.scatter)) {
    refuse4("`scatter` must be an object of settings for the association scatter, or null.");
  }
  settings.baseline_visits = textList2(settings.baseline_visits, "baseline_visits");
  settings.biomarkers = textList2(settings.biomarkers, "biomarkers");
  settings.visits = textList2(settings.visits, "visits");
  settings.measures = textList2(settings.measures, "measures");
  settings.filters = fieldList(settings.filters, "filters");
  return settings;
}

// src/correlation-matrix/structureData.js
var RELATIVE3 = /* @__PURE__ */ new Set(["change", "fold_change", "percent_change"]);
var VALUE_WORDS2 = {
  raw: "Result",
  baseline: "Baseline value",
  change: "Change from baseline",
  fold_change: "Fold change from baseline",
  percent_change: "Percent change from baseline"
};
function matrixVariables(settings, state, offered, results = []) {
  const value = state.valueType;
  const config = coreSettings(settings);
  const baseline = RELATIVE3.has(value) ? config.baseline_visits || visits(results, config).slice(0, 1) : [];
  const flat = (visit) => baseline.length === 1 && baseline[0] === visit;
  const none = (of, heading2, message, chosen2 = 0, notDrawn = []) => ({
    variables: [],
    chosen: chosen2,
    of,
    heading: heading2,
    notDrawn,
    message
  });
  const named = (list) => list.map((entry, index) => ({ name: `v${index + 1}`, label: entry.label, axis: entry.axis }));
  if (state.mode === "visits") {
    const heading2 = `${state.measure}: ${VALUE_WORDS2[value].toLowerCase()}, visit against visit`;
    if (value === "baseline") {
      return none(
        "visits",
        heading2,
        "A baseline value has no visit, so there is nothing to relate across visits. Choose another value, or relate biomarkers at one visit."
      );
    }
    const chosen2 = state.visits ? offered.visits.filter((visit) => state.visits.includes(visit)) : offered.visits;
    const drawn = chosen2.filter((visit) => !flat(visit));
    return {
      variables: named(
        drawn.slice(0, settings.limit).map((visit) => ({
          label: visit,
          axis: { kind: "measure", measure: state.measure, value, visit }
        }))
      ),
      chosen: drawn.length,
      of: "visits",
      heading: heading2,
      notDrawn: chosen2.filter(flat),
      message: drawn.length < 2 ? "Choose two or more visits: a grid relates one to another." : null
    };
  }
  const at = value === "baseline" ? "" : ` at ${state.visit}`;
  const heading = `${VALUE_WORDS2[value]}${at}, biomarker against biomarker`;
  if (flat(state.visit)) {
    return none(
      "biomarkers",
      heading,
      "This value is a change at the baseline visit, where it is the same for everyone. Choose a later visit to draw.",
      0,
      [state.visit]
    );
  }
  const chosen = state.biomarkers ? offered.measures.filter((measure) => state.biomarkers.includes(measure)) : offered.measures;
  return {
    variables: named(
      chosen.slice(0, settings.limit).map((measure) => ({
        label: measure,
        axis: {
          kind: "measure",
          measure,
          value,
          visit: value === "baseline" ? null : state.visit
        }
      }))
    ),
    chosen: chosen.length,
    of: "biomarkers",
    heading,
    notDrawn: [],
    message: chosen.length < 2 ? "Choose two or more biomarkers: a grid relates one to another." : null
  };
}
function shownCount({ variables, chosen, of }, limit) {
  const shown2 = variables.length;
  const control = of === "visits" ? "Visits" : "Biomarkers";
  if (shown2 >= chosen) return `All ${chosen} ${of} chosen are shown.`;
  return `${shown2} of ${chosen} ${of} shown: the first ${shown2} of those chosen, in the ${control} control\u2019s order. The grid draws at most ${limit} at a time: untick ${of} under ${control} to bring others in.`;
}
function unitOfGrid(results, settings, variables) {
  if (!variables.length) return null;
  const [{ axis: axis2 }] = variables;
  if (axis2.value === "fold_change") return null;
  if (axis2.value === "percent_change") return "%";
  const units = new Set(variables.map((entry) => unitOf(results, settings, entry.axis.measure)));
  return units.size === 1 ? [...units][0] : null;
}
function buildMatrix({ results, participants }, settings, state, offered, options = {}) {
  const { participants: kept, results: rows } = keepFiltered(
    { results, participants },
    settings,
    state.filters,
    options.filterMatches
  );
  const drawn = matrixVariables(settings, state, offered, results);
  const model = {
    ...drawn,
    records: [],
    participants: kept ? kept.length : 0,
    empty: 0,
    unused: [],
    baselineVisits: null,
    filtered: kept ? kept.length : null
  };
  if (!rows.length || drawn.variables.length < 2) return model;
  const made = frame(
    { results: rows, participants: kept || void 0 },
    Object.fromEntries(drawn.variables.map((entry) => [entry.name, variableOf(entry.axis)])),
    // None is required: a participant with some of the values is in the frame.
    { ...coreSettings(settings), required: [] }
  );
  const records = made.data.filter(
    (record) => drawn.variables.some((entry) => record[entry.name] !== null)
  );
  return {
    ...model,
    records,
    participants: made.participants,
    empty: made.data.length - records.length,
    unused: made.unused,
    baselineVisits: made.baseline_visits
  };
}
function pointsOf(records, column, row) {
  return records.filter((record) => record[column.name] !== null && record[row.name] !== null).map((record) => ({ x: record[column.name], y: record[row.name] }));
}
var pairKey = (a, b) => [a, b].sort().join("\0");
function cellsOf(variables) {
  return variables.map(
    (row, i) => variables.map((column, j) => ({
      row: i,
      column: j,
      side: i === j ? "diagonal" : j > i ? "number" : "mark",
      key: i === j ? null : pairKey(row.name, column.name)
    }))
  );
}
function markOf(estimate) {
  const strength = Math.min(1, Math.abs(estimate));
  const lightness = Math.round(86 - 54 * strength);
  const negative = estimate < 0;
  return {
    sign: negative ? "negative" : "positive",
    size: Math.round(14 + 78 * strength),
    color: negative ? `hsl(18, 82%, ${lightness}%)` : `hsl(217, 78%, ${lightness}%)`
  };
}
function numberOf(estimate) {
  const fixed = estimate.toFixed(2);
  return (fixed === "-0.00" ? "0.00" : fixed).replace("-", "\u2212");
}
var CELL_LEAST = 18;
var NUMBERS_FROM = 34;
function cellSize(room, count, greatest = 72) {
  return Math.max(CELL_LEAST, Math.min(greatest, Math.floor(room / count)));
}

// src/correlation-matrix/statistic.js
var METHOD_LABELS2 = Object.freeze({
  pearson: "Pearson",
  spearman: "Spearman"
});
var COEFFICIENT_NAMES = Object.freeze({
  pearson: "Pearson\u2019s r",
  spearman: "Spearman\u2019s rho"
});
function matrixRequest({ name, method, minPairs, settings, state, model }) {
  const filters = filtersInForce(state.filters);
  return {
    name,
    data: model.records,
    args: {
      chrCols: model.variables.map((entry) => entry.name),
      strMethod: method,
      // The minimum is R's: it is sent only when the reader set one.
      ...minPairs === null || minPairs === void 0 ? {} : { nMinPairs: minPairs }
    },
    dataId: {
      chart: "correlation-matrix",
      // The grid's variables in order, each as the settings write a variable:
      // the first is the column `v1` of the frame, the second `v2`, and so on.
      variables: model.variables.map((entry) => settingOf(entry.axis)),
      ...settings.baseline_visits ? { baseline_visits: [...settings.baseline_visits] } : {},
      baseline_stat: settings.baseline_stat,
      ...Object.keys(filters).length ? { filters } : {}
    },
    rows: model.records.length
  };
}
var plain3 = (state, said) => ({ ...sentence(state, said), table: null, pairs: null });
function pairsOf2(value) {
  const rows = Array.isArray(value && value.rows) ? value.rows : [];
  const pairs = /* @__PURE__ */ new Map();
  rows.forEach((row, order2) => {
    if (!row || typeof row.x !== "string" || typeof row.y !== "string") return;
    pairs.set(pairKey(row.x, row.y), {
      x: row.x,
      y: row.y,
      formatted: formatPair(row),
      // The coefficient itself, for the mark: R's number, and nothing else.
      estimate: typeof row.estimate === "number" ? row.estimate : null,
      // R's reason for a pair it computed nothing for, as R worded it.
      reason: typeof row.reason === "string" && row.reason.trim() !== "" ? row.reason : null,
      warning: typeof row.warning === "string" && row.warning.trim() !== "" ? row.warning : null,
      order: order2
    });
  });
  return pairs;
}
function describeMatrix(result, context = {}) {
  if (!result || result.status !== "ok") {
    const failure = failureOf(result);
    return plain3(failure.state, failure.text);
  }
  const value = result.value && typeof result.value === "object" ? result.value : {};
  const reason = typeof value.reason === "string" && value.reason.trim() ? value.reason : null;
  let described;
  if (value.status === "error") {
    described = plain3("error", `R reported an error: ${reason || "no message"}`);
  } else if (reason) {
    described = plain3("withheld", reason);
    described.pairs = pairsOf2(value);
  } else if (typeof value.method !== "string" || value.method.trim() === "") {
    described = plain3("refused", "Coefficients not shown: the result does not name its method.");
  } else {
    const pairs = pairsOf2(value);
    described = plain3(
      "shown",
      `${value.method}, pair by pair: ${pairs.size} pair${pairs.size === 1 ? "" : "s"} of ${context.variables} variables, each on the participants who have both of its values.`
    );
    described.pairs = pairs;
  }
  described.remarks = remarksOf(value);
  described.scope = context.scope || null;
  return described;
}
function cellText(pair, labels, name) {
  const lead = `${labels.row} and ${labels.column}`;
  if (!pair) return `${lead}.`;
  const { formatted, warning } = pair;
  const said = formatted.status === "shown" ? `${lead}: ${name} ${formatted.text}` : `${lead}: ${formatted.text}`;
  return warning ? `${said} R warned: ${warning}.` : said;
}
function scopeText3({ n, filters = [] }) {
  const said = [
    `${n} participant${n === 1 ? " is" : "s are"} in the frame. A cell is of the ones who have both of its values, so each cell has its own count, and the cells are not adjusted for one another.`
  ];
  if (filters.length) said.push(filtersSaid(filters));
  return said.join(" ");
}
function createStatisticDesk3({ connection, note = null }) {
  return createDesk({
    connection,
    note,
    describe: describeMatrix,
    waiting: (said) => plain3("waiting", said)
  });
}

// src/correlation-matrix.js
var MODULE_CLASS2 = "bv-correlation-matrix";
var STYLE_ID3 = "bio-viz-correlation-matrix-styles";
var C = `.${MODULE_CLASS2}`;
var STYLES3 = `${lineStyles(C)}
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
var MODE_LABELS = {
  biomarkers: "Biomarkers at one visit",
  visits: "Visits of one biomarker"
};
var VIEW_LABELS = { grid: "Grid", scatters: "Small scatters" };
var BACK = "Back to the correlation matrix";
var HINT = "Click a cell, or press Enter on it, to open that pair in the association scatter. Point at a cell, or move to it with the arrow keys, to read its coefficient and its pair count.";
var CorrelationMatrix = class {
  constructor(element, settings) {
    this.kit = findKit("the correlation matrix");
    this.element = typeof element === "string" ? document.querySelector(element) : element;
    if (!this.element) throw new Error(`bio.viz: correlation matrix target not found: ${element}`);
    this.settings = syncSettings3(settings);
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
    this.connection = this.settings.connection || createConnection();
    this.desk = createStatisticDesk3({
      connection: this.connection,
      note: this.settings.waiting_note
    });
  }
  renderShell() {
    const { kit } = this;
    mountShell(this, {
      moduleClass: MODULE_CLASS2,
      styleId: STYLE_ID3,
      styles: STYLES3,
      listingFile: "bio.viz-correlation-matrix-pairs.csv"
    });
    this.chartWrap.classList.add("sv-hidden");
    this.gridWrap = kit.createElement("div", "bv-matrix");
    this.gridWrap.hidden = true;
    this.chartWrap.after(this.gridWrap);
    this.onResize = () => this.resize();
    globalThis.addEventListener("resize", this.onResize);
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
   * @returns {CorrelationMatrix} The chart, for chaining.
   */
  setData(data) {
    this.close();
    this.tables = readGiven(this, data);
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
    const given2 = settings || {};
    this.close();
    this.settings = syncSettings3({ ...this.settings, ...given2 });
    if ("connection" in given2 || "waiting_note" in given2) this.connect();
    this.readTables();
    const opening = this.seedState();
    const moved = {
      mode: "mode",
      visit: "visit",
      biomarkers: "biomarkers",
      measure: "measure",
      visits: "visits",
      value_type: "valueType",
      view: "view",
      method: "method",
      min_pairs: "minPairs",
      filters: "filters"
    };
    for (const [setting, key] of Object.entries(moved)) {
      if (setting in given2) this.state[key] = opening[key];
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
    this.filterSpecs = filterColumns(this.tables, settings, this.categories).map(
      (spec) => this.kit.normalizeFilterSpec(spec)
    );
    for (const [key, list] of [
      ["visit", this.visits],
      ["measure", this.measures]
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
    const { settings, measures, visits: visits2 } = this;
    const among = (chosen, list) => {
      const kept = (chosen || []).filter((entry) => list.includes(entry));
      return kept.length ? kept : null;
    };
    return {
      mode: settings.mode,
      visit: visits2.includes(settings.visit) ? settings.visit : visits2[0] ?? null,
      // Null is every biomarker the control offers; the grid draws the first
      // `limit` of them.
      biomarkers: among(settings.biomarkers, measures),
      measure: measures.includes(settings.measure) ? settings.measure : measures[0] ?? null,
      visits: among(settings.visits, visits2),
      valueType: settings.value_type,
      view: settings.view,
      method: settings.method,
      minPairs: settings.min_pairs,
      filters: this.kit.initFilterState(this.filterSpecs)
    };
  }
  // After the tables or the settings change, a control may hold something that
  // is no longer offered; it returns to what the chart opens on.
  repairState(opening) {
    const { state } = this;
    if (!this.visits.includes(state.visit)) state.visit = opening.visit;
    if (!this.measures.includes(state.measure)) state.measure = opening.measure;
    for (const [key, list] of [
      ["biomarkers", this.measures],
      ["visits", this.visits]
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
    return this.state.view === "scatters" && count <= SCATTER_LIMIT ? "scatters" : "grid";
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
      input.setAttribute("aria-label", labelText);
      options.forEach(([value, text2]) => kit.option(input, value, text2, value === selected));
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
    const variables = addSection("Variables");
    select(
      "mode",
      "Relate",
      MODES.map((mode) => [mode, MODE_LABELS[mode]]),
      state.mode,
      (next) => {
        state.mode = next;
        redraw(true);
      },
      variables
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
      variables
    );
    if (state.mode === "biomarkers") {
      if (state.valueType !== "baseline") {
        select(
          "visit",
          "Visit",
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
        "biomarkers",
        "Biomarkers",
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
        "measure",
        "Biomarker",
        this.measures.map((measure) => [measure, measure]),
        state.measure,
        (next) => {
          state.measure = next;
          redraw(false);
        },
        variables
      );
      several(
        "visits",
        "Visits",
        this.visits,
        state.visits,
        (next) => {
          state.visits = next;
          redraw(false);
        },
        variables
      );
    }
    const display = addSection("Display");
    const view = select(
      "view",
      "Draw as",
      VIEWS.map((entry) => [entry, VIEW_LABELS[entry]]),
      state.view,
      (next) => {
        state.view = next;
        redraw(false);
      },
      display
    );
    const note = kit.createElement("small", "bv-control-note");
    view.after(note);
    this.viewControl = { input: view.querySelector("select") || view, note };
    this.syncViewControl();
    if (this.settings.statistic) {
      const statistics = addSection("Statistics");
      select(
        "method",
        "Method",
        METHODS2.map((method) => [method, METHOD_LABELS2[method]]),
        state.method,
        (next) => {
          state.method = next;
          redraw(false);
        },
        statistics
      );
      const minimum = document.createElement("input");
      minimum.type = "number";
      minimum.min = "1";
      minimum.step = "1";
      minimum.placeholder = "R\u2019s own";
      minimum.dataset.control = "min-pairs";
      minimum.setAttribute("aria-label", "Minimum pairs for a cell");
      minimum.value = state.minPairs === null ? "" : String(state.minPairs);
      minimum.onchange = () => {
        const asked = Number(minimum.value);
        state.minPairs = minimum.value.trim() !== "" && asked > 0 ? asked : null;
        minimum.value = state.minPairs === null ? "" : String(state.minPairs);
        redraw(false);
      };
      addControl("Minimum pairs for a cell", minimum, statistics);
      minimum.after(
        kit.createElement(
          "small",
          "bv-control-note",
          "A cell with fewer complete pairs shows R\u2019s reason and no number. Left empty, the minimum is R\u2019s own."
        )
      );
    }
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
    note.textContent = `Small scatters are offered for ${SCATTER_LIMIT} variables or fewer` + (offered ? "." : `; ${count} are drawn.`);
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
    this.close();
    const round = this.desk.begin();
    this.asked = [];
    this.pairs = null;
    this.destroyCharts();
    this.notes.innerHTML = "";
    this.gridWrap.innerHTML = "";
    this.gridWrap.hidden = true;
    this.listingWrap.innerHTML = "";
    this.statLine.textContent = "";
    this.statLine.dataset.state = "empty";
    this.model = null;
    const { kit, state, settings } = this;
    this.syncViewControl();
    if (!this.tables.results.length || !this.measures.length) {
      this.footnote.textContent = "No results to draw.";
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
      this.footnote.textContent = model.filtered === 0 ? NOBODY_PASSES : "No participant has a value for any variable of the grid.";
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
        writeStatistic(kit, this.statLine, description);
        this.pairs = description.pairs;
        this.fillGrid();
        this.listPairs();
      },
      {
        variables: model.variables.length,
        scope: scopeText3({ n: model.records.length, filters: filtersForScope(this) })
      }
    );
  }
  // Above the grid: how many variables are shown of how many, who is in the
  // frame, and what was left out of it.
  updateNotes(model) {
    const { kit, state } = this;
    const add = (text2, warning) => this.notes.append(kit.createElement("span", warning ? "sv-warning" : null, text2));
    if (model.chosen) add(shownCount(model, this.settings.limit));
    if (model.variables.length > 1 && model.participants) {
      add(`${model.records.length} of ${model.participants} participants in the frame.`);
      if (model.empty) {
        add(`${model.empty} left out: no value for any variable of the grid.`, true);
      }
    }
    model.unused.filter((entry) => entry.reason !== UNUSED.MISSING_RESULT).forEach(
      (entry) => add(`${entry.n} row${entry.n === 1 ? "" : "s"} not used: ${entry.reason}.`, true)
    );
    if (model.filtered !== null && model.filtered < this.tables.participants.length) {
      add(`${model.filtered} of ${this.tables.participants.length} participants pass the filters.`);
    }
    if (model.baselineVisits && state.valueType !== "raw") {
      const left = model.notDrawn.length ? ` It is not drawn: there the ${VALUE_LABELS[state.valueType].toLowerCase()} is the same for everyone.` : "";
      add(`Baseline visit: ${model.baselineVisits.join(", ")}.${left}`);
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
      kit.createElement("h3", "bv-matrix-title", `${model.heading}${unit ? ` (${unit})` : ""}`)
    );
    const scroll = kit.createElement("div", "bv-matrix-scroll");
    const grid = kit.createElement("div", "bv-matrix-grid");
    grid.dataset.view = view;
    grid.setAttribute("role", "group");
    grid.setAttribute(
      "aria-label",
      `Correlation matrix: ${model.heading}, ${variables.length} variables`
    );
    grid.style.setProperty("--bv-n", String(variables.length));
    grid.append(kit.createElement("span", "bv-corner"));
    variables.forEach((column) => {
      const head = kit.createElement("span", "bv-col-head", column.label);
      head.title = column.label;
      grid.append(head);
    });
    if (!this.focusAt || this.focusAt.some((at) => at >= variables.length)) this.focusAt = [0, 1];
    cellsOf(variables).forEach((row, i) => {
      const head = kit.createElement("span", "bv-row-head", variables[i].label);
      head.title = variables[i].label;
      grid.append(head);
      row.forEach((cell) => {
        if (cell.side === "diagonal") {
          const same = kit.createElement("span", "bv-diagonal");
          same.dataset.row = String(i);
          grid.append(same);
          return;
        }
        const button = kit.createElement("button", "bv-cell");
        button.type = "button";
        button.dataset.row = String(cell.row);
        button.dataset.column = String(cell.column);
        button.dataset.side = cell.side;
        button.dataset.status = "empty";
        button.tabIndex = cell.row === this.focusAt[0] && cell.column === this.focusAt[1] ? 0 : -1;
        button.onclick = () => this.openCell(cell.row, cell.column);
        button.onkeydown = (event) => this.onCellKey(event, cell.row, cell.column);
        const say = () => {
          this.footnote.textContent = button.getAttribute("aria-label");
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
    return this.grid ? this.grid.querySelector(`.bv-cell[data-row="${row}"][data-column="${column}"]`) : null;
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
    const scatters = this.grid.dataset.view === "scatters";
    this.destroyCharts();
    this.grid.querySelectorAll(".bv-cell").forEach((button) => {
      const row = variables[Number(button.dataset.row)];
      const column = variables[Number(button.dataset.column)];
      const pair = this.pairs ? this.pairs.get(pairKey(row.name, column.name)) : null;
      const labels = { row: row.label, column: column.label };
      button.innerHTML = "";
      button.dataset.status = pair ? pair.formatted.status : "empty";
      const said = `${cellText(pair, labels, name)} Open the scatter.`;
      button.setAttribute("aria-label", said);
      button.title = said;
      const mini = scatters && button.dataset.side === "mark";
      if (mini) {
        const wrap = kit.createElement("span", "bv-mini");
        const canvas = document.createElement("canvas");
        wrap.append(canvas);
        button.append(wrap);
        this.charts.push(this.miniScatter(canvas, pointsOf(model.records, column, row)));
        return;
      }
      if (!pair) return;
      if (pair.formatted.status !== "shown" || pair.estimate === null) {
        const none = kit.createElement("span", "bv-none", "\u2013");
        none.setAttribute("aria-hidden", "true");
        button.append(none);
        return;
      }
      button.append(kit.createElement("span", "bv-num", numberOf(pair.estimate)));
      button.append(this.mark(pair.estimate));
    });
    const answer = this.asked[0] && this.asked[0].answer;
    const counts = answer && answer.value && answer.value.counts;
    this.grid.querySelectorAll(".bv-diagonal").forEach((same) => {
      const variable2 = variables[Number(same.dataset.row)];
      const n = counts && typeof counts === "object" ? counts[variable2.name] : void 0;
      same.title = Number.isInteger(n) ? `${variable2.label}: ${n} participant${n === 1 ? " has" : "s have"} a value.` : variable2.label;
    });
  }
  mark(estimate) {
    const { sign, size, color } = markOf(estimate);
    const mark = this.kit.createElement("span", "bv-mark");
    mark.dataset.sign = sign;
    mark.style.setProperty("--bv-size", `${size}%`);
    mark.style.setProperty("--bv-color", color);
    return mark;
  }
  // A pair as points, with no axes and nothing that answers the pointer: the
  // cell it is in is what is clicked.
  miniScatter(canvas, points) {
    return new this.kit.Chart(canvas.getContext("2d"), {
      type: "scatter",
      data: {
        datasets: [
          {
            data: points,
            pointRadius: 1.5,
            backgroundColor: "rgba(37, 99, 235, 0.55)",
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
    const key = kit.createElement("div", "bv-key");
    key.setAttribute("role", "note");
    if (view === "scatters") {
      key.append(
        kit.createElement(
          "p",
          null,
          "Below the diagonal a pair is its points: one for each participant who has both values, the column\u2019s variable along the bottom and the row\u2019s up the side, each pair on its own axes. Above it is R\u2019s coefficient, to two decimals. A hatched cell has too few complete pairs for a coefficient."
        )
      );
      return key;
    }
    [-1, -0.5, 0, 0.5, 1].forEach((value) => {
      const item = kit.createElement("span", "bv-key-item");
      const box = kit.createElement("span", "bv-key-mark");
      box.append(this.mark(value));
      item.append(box, document.createTextNode(numberOf(value)));
      key.append(item);
    });
    key.append(
      kit.createElement(
        "p",
        null,
        "Below the diagonal a pair is a mark: the wider and the darker, the stronger the coefficient; a filled blue disc is positive and an orange ring negative. Above it is the coefficient itself, to two decimals, where a cell is wide enough to hold it; where it is not, both sides are marks and the numbers are in the list beneath. A hatched cell has too few complete pairs for a coefficient."
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
    const label2 = narrow ? 84 : 150;
    const count = this.model.variables.length;
    const scatters = this.grid.dataset.view === "scatters";
    this.grid.style.setProperty("--bv-label", `${label2}px`);
    const heads = [...this.grid.querySelectorAll(".bv-row-head")];
    const widest = Math.min(
      label2,
      Math.ceil(Math.max(0, ...heads.map((head) => head.scrollWidth)))
    );
    const sizeWith = (gap) => cellSize(
      this.grid.parentElement.clientWidth - widest - gap * count - 2,
      count,
      scatters ? 150 : 72
    );
    let size = sizeWith(2);
    const compact = !scatters && size < NUMBERS_FROM;
    if (compact) size = sizeWith(1);
    this.grid.style.setProperty("--bv-cell", `${size}px`);
    this.grid.classList.toggle("bv-compact", compact);
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
    this.listingWrap.innerHTML = "";
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
      const within = formatted.bounds && levels.length === 1 ? ` (${formatted.bounds})` : formatted.interval ? ` (${formatted.interval})` : "";
      return {
        x,
        y,
        status: formatted.status,
        pair: `${model.variables[x].label} and ${model.variables[y].label}`,
        n: formatted.n === null ? "" : String(formatted.n),
        // A pair with no coefficient says why in its place, in R's words; its
        // count is in the column beside it.
        coefficient: formatted.status === "shown" ? `${formatted.estimate}${within}` : pair.reason || formatted.text,
        warning: pair.warning
      };
    });
    const warnings = [...new Set(rows.map((row) => row.warning).filter(Boolean))];
    const markOfWarning = (warning) => String(warnings.indexOf(warning) + 1);
    const columns = [
      { value_col: "pair", label: "Pair" },
      { value_col: "n", label: "Complete pairs" },
      { value_col: "coefficient", label: head },
      ...warnings.length ? [{ value_col: "warning", label: "R\u2019s warning" }] : []
    ];
    const details = document.createElement("details");
    details.className = "bv-pairs";
    details.open = true;
    details.append(
      kit.createElement(
        "summary",
        null,
        `Every pair, with its count: ${rows.length}, in the order R returned them`
      )
    );
    const tools = kit.createElement("div", "bv-pairs-tools");
    const download = kit.createElement("button", null, "Download: CSV");
    download.type = "button";
    download.onclick = () => downloadCsv(
      kit,
      rows.map((row) => ({ ...row, warning: row.warning || "" })),
      columns,
      "bio.viz-correlation-matrix-pairs.csv"
    );
    tools.append(download);
    const table = document.createElement("table");
    const header = document.createElement("tr");
    ["Pair", "Complete pairs", head].forEach((title) => {
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
      const lead = document.createElement("th");
      lead.scope = "row";
      const open = kit.createElement("button", "bv-pair", row.pair);
      open.type = "button";
      open.setAttribute("aria-label", `${row.pair}: open the scatter`);
      open.onclick = () => this.openCell(Math.max(row.x, row.y), Math.min(row.x, row.y));
      lead.append(open);
      const value = kit.createElement("td", null, row.coefficient);
      if (row.warning) {
        const mark = kit.createElement("sup", "bv-pair-warned", markOfWarning(row.warning));
        mark.title = `R warned: ${row.warning}`;
        value.append(" ", mark);
      }
      line.append(lead, kit.createElement("td", null, row.n), value);
      tbody.append(line);
    });
    table.append(thead, tbody);
    details.append(tools, table);
    warnings.forEach((warning) => {
      const note = kit.createElement("p", "bv-pairs-note");
      note.append(
        kit.createElement("sup", null, markOfWarning(warning)),
        ` R warned, of each pair marked: ${warning}`
      );
      details.append(note);
    });
    this.listingWrap.append(details);
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
    const find = (label2) => variables.findIndex((entry) => entry.label === String(label2));
    const [column, row] = [find(x), find(y)];
    if (column < 0 || row < 0 || column === row) {
      throw new TypeError(
        `bio.viz: open() takes two different variables of the grid, each by its label: ${variables.map((entry) => entry.label).join(", ")}.`
      );
    }
    return this.openCell(row, column);
  }
  openPair(x, y, cell) {
    this.close();
    const { settings, state, kit } = this;
    const holder = kit.createElement("div", "bv-matrix-drill");
    this.root.classList.add("sv-hidden");
    this.element.append(holder);
    const chart = associationScatter(holder, {
      ...coreSettings(settings),
      unit_col: settings.unit_col,
      measures: settings.measures,
      max_levels: settings.max_levels,
      // What the page set for the scatter: its groups, its numbers, its profile.
      ...settings.scatter || {},
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
    const back = holder.querySelector(".bv-back");
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
    this.root.classList.remove("sv-hidden");
    this.fit();
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
    this.desk.begin();
    if (this.opened) {
      this.opened.chart.destroy();
      this.opened = null;
    }
    this.destroyCharts();
    globalThis.removeEventListener("resize", this.onResize);
    this.element.innerHTML = "";
  }
};
function correlationMatrix(element, settings) {
  return new CorrelationMatrix(element, settings);
}

// src/main.js
var version = "0.1.0";
export {
  associationScatter,
  core_exports as core,
  correlationMatrix,
  groupComparison,
  r_exports as r,
  version
};
//# sourceMappingURL=bio.viz.esm.js.map
