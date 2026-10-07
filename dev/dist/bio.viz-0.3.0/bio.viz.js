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
    associationScatter: () => associationScatter,
    biomarkerScreen: () => biomarkerScreen,
    core: () => core_exports,
    correlationMatrix: () => correlationMatrix,
    crossTab: () => crossTab,
    fromSpecification: () => fromSpecification,
    groupComparison: () => groupComparison,
    output: () => output_exports,
    portfolio: () => portfolio_default,
    r: () => r_exports,
    stratifiedSurvival: () => stratifiedSurvival,
    version: () => version
  });

  // src/r/index.js
  var r_exports = {};
  __export(r_exports, {
    WEBR_BASE_URL: () => WEBR_BASE_URL,
    WEBR_VERSION: () => WEBR_VERSION,
    createConnection: () => createConnection,
    formatComparison: () => formatComparison,
    formatEstimate: () => formatEstimate,
    formatGroup: () => formatGroup,
    formatLevel: () => formatLevel,
    formatMedian: () => formatMedian,
    formatPair: () => formatPair,
    formatScreenRow: () => formatScreenRow,
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
  var NON_FINITE = { Inf: Infinity, "-Inf": -Infinity, NaN: Number.NaN };
  var NUMBER_MEMBERS = /* @__PURE__ */ new Set([
    "estimate",
    "lower",
    "upper",
    "value",
    "statistic",
    "p_value",
    "p_unadjusted",
    "expected",
    "median",
    "hazard_ratio",
    "hr_lower",
    "hr_upper",
    "hr_p_value"
  ]);
  var asNumber = (member) => typeof member === "string" && Object.hasOwn(NON_FINITE, member) ? NON_FINITE[member] : member;
  function readNonFinite(value) {
    if (Array.isArray(value)) {
      value.forEach(readNonFinite);
    } else if (isPlainObject(value)) {
      for (const [key, member] of Object.entries(value)) {
        if (NUMBER_MEMBERS.has(key)) {
          value[key] = Array.isArray(member) && member.every((item) => typeof item !== "object") ? member.map(asNumber) : asNumber(member);
        }
        readNonFinite(value[key]);
      }
    }
    return value;
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
    return { hit: true, value: readNonFinite(structuredClone(entry.value)) };
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
  function readComputedBy(computedBy) {
    if (computedBy === void 0 || computedBy === null) return null;
    const text2 = (value) => typeof value === "string" && value.trim() !== "";
    if (!isPlainObject(computedBy) || !text2(computedBy.r_version) || computedBy.gsm_bio_version !== void 0 && !text2(computedBy.gsm_bio_version) || computedBy.computed_at !== void 0 && !text2(computedBy.computed_at)) {
      throw new TypeError(
        "bio.viz: `computedBy` must be { r_version, gsm_bio_version, computed_at }, each text: which R computed the stored results."
      );
    }
    const { r_version, gsm_bio_version, computed_at } = computedBy;
    return Object.freeze({
      r_version,
      ...gsm_bio_version === void 0 ? {} : { gsm_bio_version },
      ...computed_at === void 0 ? {} : { computed_at }
    });
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
    const computedBy = readComputedBy(options.computedBy);
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
          if (found.hit) {
            return computedBy ? {
              status: "ok",
              value: found.value,
              form: "precomputed",
              computedBy: { ...computedBy }
            } : { status: "ok", value: found.value, form: "precomputed" };
          }
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
  var P_ROUNDING = 1e-9;
  var isP = (p) => typeof p === "number" && p >= 0 && p <= 1 + P_ROUNDING;
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
    const named2 = text(adjustment);
    if (!named2 || named2.toLowerCase() === "none") return null;
    return Object.hasOwn(ADJUSTMENTS, named2) ? ADJUSTMENTS[named2] : named2;
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
    if (!isP(p)) {
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
  var isNumberOrInfinite = (value) => isNumber(value) || value === Infinity || value === -Infinity;
  var bound = (value) => {
    if (value === Infinity) return "infinity";
    if (value === -Infinity) return "minus infinity";
    return figure(value);
  };
  function formatEstimate(estimate) {
    const row = estimate && typeof estimate === "object" ? estimate : {};
    const refuse8 = (what) => ({ status: "refused", text: `Estimate not shown: ${what}.` });
    const name = text(row.name);
    if (!name) return refuse8("it has no name");
    if (!isNumberOrInfinite(row.estimate)) return refuse8(`${name} is not a number`);
    const group = text(row.group);
    const said2 = row.estimate === Infinity ? "infinite" : bound(row.estimate);
    const lead = `${name}${group ? ` (${group})` : ""}: ${said2}`;
    const bounds = [row.lower, row.upper, row.level];
    const absent = (value) => value === void 0 || value === null;
    if (bounds.every(absent)) return { status: "shown", text: `${lead}.` };
    if (!isNumberOrInfinite(row.lower) || !isNumberOrInfinite(row.upper) || !isNumber(row.level) || !(row.level > 0 && row.level < 1)) {
      return refuse8(`the interval of ${name} is incomplete`);
    }
    const percent = Number((row.level * 100).toPrecision(12));
    return {
      status: "shown",
      text: `${lead}, ${percent}% confidence interval ${bound(row.lower)} to ${bound(row.upper)}.`
    };
  }
  function formatMedian(estimate) {
    const row = estimate && typeof estimate === "object" ? estimate : {};
    const refuse8 = (what) => ({ status: "refused", text: `Estimate not shown: ${what}.` });
    const name = text(row.name);
    if (!name) return refuse8("it has no name");
    const absent = (value) => value === void 0 || value === null;
    for (const part of ["estimate", "lower", "upper"]) {
      if (!absent(row[part]) && !isNumber(row[part])) return refuse8(`${name} is not a number`);
    }
    if (!(row.level > 0 && row.level < 1)) return refuse8(`the interval of ${name} has no level`);
    const said2 = (value) => absent(value) ? "not reached" : figure(value);
    const group = text(row.group);
    const percent = Number((row.level * 100).toPrecision(12));
    const interval = absent(row.lower) && absent(row.upper) ? "not reached" : `${said2(row.lower)} to ${said2(row.upper)}`;
    return {
      status: "shown",
      text: `${name}${group ? ` (${group})` : ""}: ${said2(row.estimate)}, ${percent}% confidence interval ${interval}.`
    };
  }
  function formatComparison(comparison) {
    const row = comparison && typeof comparison === "object" ? comparison : {};
    const groups = [text(row.group_1), text(row.group_2)];
    const n = [row.n_1, row.n_2];
    const named2 = groups.every(Boolean);
    const counted = named2 && n.every(isCount);
    const parts = read({
      status: row.status,
      method: row.method,
      p_value: row.p_value,
      adjustment: row.adjustment,
      reason: row.reason,
      counts: counted ? { [groups[0]]: n[0], [groups[1]]: n[1] } : void 0
    });
    const pair = { groups: named2 ? groups : null, n: counted ? n : null };
    const shown2 = named2 && parts.status === "shown";
    const result = named2 ? parts.text : refused("the comparison does not name its two groups").text;
    return {
      status: named2 ? parts.status : "refused",
      text: named2 ? `${groups[0]} and ${groups[1]}: ${result}` : result,
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
    const refuse8 = (what) => whole("refused", `Estimate not shown: ${what}.`);
    if (!isNumber(given2.estimate)) return refuse8("the group\u2019s estimate is not a number");
    const bounds = [given2.lower, given2.upper, given2.level];
    const absent = (value) => value === void 0 || value === null;
    let ends = null;
    let level = null;
    if (!bounds.every(absent)) {
      if (!bounds.every(isNumber) || !(given2.level > 0 && given2.level < 1)) {
        return refuse8("the interval of the group\u2019s estimate is incomplete");
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
    const whole = (status, said2) => ({
      status,
      text: said2,
      pair,
      n: counted ? given2.counts : null,
      estimate: null,
      interval: null,
      bounds: null,
      level: null
    });
    const refuse8 = (what) => whole("refused", `Estimate not shown: ${what}.`);
    if (!pair) return refuse8("the row does not name its two variables");
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
    if (!counted) return refuse8("the pair does not give the number of complete pairs it used");
    if (!isNumber(given2.estimate)) return refuse8("the pair\u2019s estimate is not a number");
    const bounds = [given2.lower, given2.upper, given2.level];
    const absent = (value) => value === void 0 || value === null;
    let ends = null;
    let level = null;
    if (!bounds.every(absent)) {
      if (!bounds.every(isNumber) || !(given2.level > 0 && given2.level < 1)) {
        return refuse8("the interval of the pair\u2019s estimate is incomplete");
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
  function formatScreenRow(row, groups = null) {
    const given2 = row && typeof row === "object" ? row : {};
    const biomarker = text(given2.biomarker);
    const named2 = Array.isArray(groups) && groups.length === 2 && groups.every(text);
    const twoCounts = named2 && isCount(given2.n_1) && isCount(given2.n_2);
    const counts = twoCounts ? { [groups[0]]: given2.n_1, [groups[1]]: given2.n_2 } : isCount(given2.counts) ? given2.counts : void 0;
    const n = formatCounts(counts);
    const none = {
      estimate: null,
      interval: null,
      bounds: null,
      level: null,
      method: null,
      p: null,
      adjusted: null,
      adjustment: null,
      over: null,
      label: null
    };
    const whole = (status, result2) => ({
      status,
      text: biomarker ? `${biomarker}: ${result2}` : result2,
      result: result2,
      biomarker,
      n,
      ...none
    });
    if (!biomarker) return whole("refused", refused("the row does not name its biomarker").text);
    const raw = read({
      status: given2.status,
      method: given2.method,
      p_value: given2.p_unadjusted,
      reason: given2.reason,
      counts
    });
    if (raw.status !== "shown") return whole(raw.status, raw.text);
    const refuse8 = (what) => whole("refused", `Row not shown: ${what}.`);
    const adjustment = adjustmentName(given2.adjustment);
    if (!adjustment) return refuse8("the row does not name the adjustment of its p-value");
    if (!isCount(given2.adjusted_over) || given2.adjusted_over < 1) {
      return refuse8("the row does not say how many rows its p-value was adjusted across");
    }
    const p = given2.p_value;
    if (!isP(p)) {
      return refuse8("the adjusted p-value is not a number between 0 and 1");
    }
    if (!isNumber(given2.estimate)) return refuse8("the estimate is not a number");
    const bounds = [given2.lower, given2.upper, given2.level];
    const absent = (value) => value === void 0 || value === null;
    let ends = null;
    let level = null;
    if (!bounds.every(absent)) {
      if (!bounds.every(isNumber) || !(given2.level > 0 && given2.level < 1)) {
        return refuse8("the interval of the estimate is incomplete");
      }
      level = `${Number((given2.level * 100).toPrecision(12))}%`;
      ends = `${figure(given2.lower)} to ${figure(given2.upper)}`;
    }
    const interval = ends ? `${level} confidence interval ${ends}` : null;
    const estimate = figure(given2.estimate);
    const adjusted = formatP(p);
    const label2 = formatLabel(adjustment);
    const over = given2.adjusted_over;
    const result = `${estimate}${interval ? `, ${interval}` : ""}. ${raw.method}: ${raw.p} unadjusted, ${adjusted} adjusted across ${over} biomarker${over === 1 ? "" : "s"} (${n}). ${label2}`;
    return {
      status: "shown",
      text: `${biomarker}: ${result}`,
      result,
      biomarker,
      n,
      estimate,
      interval,
      bounds: ends,
      level,
      method: raw.method,
      p: raw.p,
      adjusted,
      adjustment,
      over,
      label: label2
    };
  }
  function formatLevel(row, of = "level") {
    const given2 = row && typeof row === "object" ? row : {};
    const by = text(given2.by);
    const groups = [];
    const n = [];
    for (let at = 1; Object.hasOwn(given2, `group_${at}`); at += 1) {
      groups.push(text(given2[`group_${at}`]));
      n.push(given2[`n_${at}`]);
    }
    const named2 = groups.length >= 2 && groups.every(Boolean);
    const counted = named2 && n.every(isCount);
    const none = { method: null, p: null, unadjusted: null, adjustment: null, over: null };
    const whole = (status, result2) => ({
      status,
      text: by ? `${by}: ${result2}` : result2,
      result: result2,
      by,
      groups: named2 ? groups : null,
      n: counted ? n : null,
      ...none,
      label: null
    });
    if (!by) return whole("refused", refused("the row does not name its level").text);
    if (!named2) return whole("refused", refused("the row does not name its groups").text);
    const parts = read({
      status: given2.status,
      method: given2.method,
      p_value: given2.p_value,
      adjustment: given2.adjustment,
      reason: given2.reason,
      counts: counted ? Object.fromEntries(groups.map((group, at) => [group, n[at]])) : void 0
    });
    if (parts.status !== "shown") return whole(parts.status, parts.text);
    const raw = given2.p_unadjusted;
    if (!isP(raw)) {
      return whole("refused", refused("the row has no unadjusted p-value between 0 and 1").text);
    }
    const unadjusted = formatP(raw);
    let result = parts.text;
    let over = null;
    if (parts.adjustment) {
      if (!isCount(given2.adjusted_over) || given2.adjusted_over < 1) {
        return whole(
          "refused",
          refused("the row does not say how many levels its p-value was adjusted across").text
        );
      }
      over = given2.adjusted_over;
      const counts = formatCounts(Object.fromEntries(groups.map((group, at) => [group, n[at]])));
      result = `${parts.method}: ${unadjusted} unadjusted, ${parts.p} adjusted across ${over} ${of}${over === 1 ? "" : "s"} (${counts}). ${parts.label}`;
    }
    return {
      status: "shown",
      text: `${by}: ${result}`,
      result,
      by,
      groups,
      n,
      method: parts.method,
      p: parts.p,
      unadjusted,
      adjustment: parts.adjustment,
      over,
      label: parts.label
    };
  }

  // src/core/index.js
  var core_exports = {};
  __export(core_exports, {
    BASELINE_STATS: () => BASELINE_STATS,
    CUTS: () => CUTS,
    DEFAULT_SETTINGS: () => DEFAULT_SETTINGS,
    DROPPED: () => DROPPED,
    UNSCHEDULED_DEFAULTS: () => UNSCHEDULED_DEFAULTS,
    UNUSED: () => UNUSED,
    VALUE_TYPES: () => VALUE_TYPES,
    cutGroup: () => cutGroup,
    cutLabels: () => cutLabels,
    cutPoints: () => cutPoints,
    cutWords: () => cutWords,
    frame: () => frame,
    isUnscheduledVisit: () => isUnscheduledVisit,
    label: () => label,
    scheduledResults: () => scheduledResults,
    variable: () => variable,
    visits: () => visits
  });

  // src/core/cut.js
  var CUTS = Object.freeze(["median", "tertiles", "quartiles"]);
  var PROBS = { median: [0.5], tertiles: [1 / 3, 2 / 3], quartiles: [1 / 4, 2 / 4, 3 / 4] };
  var isMissing = (value) => typeof value !== "number" || !Number.isFinite(value);
  function quantile7(sorted2, p) {
    const index = 1 + (sorted2.length - 1) * p;
    const lo = Math.floor(index);
    const hi = Math.ceil(index);
    const below = sorted2[lo - 1];
    const above = sorted2[hi - 1];
    if (!(index > lo) || above === below) return below;
    const h = index - lo;
    return (1 - h) * below + h * above;
  }
  function roundHalfEven(value) {
    const floor = Math.floor(value);
    const rest = value - floor;
    if (rest > 0.5) return floor + 1;
    if (rest < 0.5) return floor;
    return floor % 2 === 0 ? floor : floor + 1;
  }
  function powDi(x, n) {
    let base = x;
    let power = 1;
    let left = Math.abs(n);
    for (; ; ) {
      if (left % 2 === 1) power *= base;
      left = Math.floor(left / 2);
      if (left === 0) break;
      base *= base;
    }
    return n < 0 ? 1 / power : power;
  }
  var MAX10E = 308;
  function signif(x, digits) {
    if (x === 0 || !Number.isFinite(x)) return x;
    const sign = x < 0 ? -1 : 1;
    const size = Math.abs(x);
    const l10 = Math.log10(size);
    let e10 = digits - 1 - Math.floor(l10);
    if (Math.abs(l10) < MAX10E - 2) {
      let p102 = 1;
      if (e10 > MAX10E) {
        p102 = powDi(10, e10 - MAX10E);
        e10 = MAX10E;
      }
      if (e10 > 0) {
        const scale2 = powDi(10, e10);
        return sign * (roundHalfEven(size * scale2 * p102) / scale2) / p102;
      }
      const scale = powDi(10, -e10);
      return sign * (roundHalfEven(size / scale) * scale);
    }
    const e2 = digits + (e10 > 0 ? 1 : 6);
    const p10 = powDi(10, e2);
    const P10 = powDi(10, e10 - e2);
    let scaled = size * p10 * P10;
    if (MAX10E - l10 >= powDi(10, -digits)) scaled += 0.5;
    return sign * (Math.floor(scaled) / p10) / P10;
  }
  function writePoint(point) {
    let rounded = signif(point, 4);
    if (!Number.isFinite(rounded)) rounded = point;
    if (rounded === 0) return "0";
    const sign = rounded < 0 ? "-" : "";
    const size = Math.abs(rounded);
    if (Number.isInteger(size)) return sign + BigInt(size).toString();
    const [mantissa, exponent] = size.toExponential(3).split("e");
    const digits = mantissa.replace(".", "").replace(/0+$/, "");
    const place = Number(exponent) + 1;
    if (place <= 0) return `${sign}0.${"0".repeat(-place)}${digits}`;
    if (place >= digits.length) return sign + digits + "0".repeat(place - digits.length);
    return `${sign}${digits.slice(0, place)}.${digits.slice(place)}`;
  }
  function boundLabels(points) {
    if (!points.length) return [];
    const bounds = points.map(writePoint);
    return [
      `\u2264 ${bounds[0]}`,
      ...bounds.slice(1).map((bound2, index) => `> ${bounds[index]}, \u2264 ${bound2}`),
      `> ${bounds[bounds.length - 1]}`
    ];
  }
  function cutLabels(points) {
    return [...new Set(boundLabels(points))];
  }
  function cutPoints(values, cut) {
    const present4 = values.filter((value) => !isMissing(value)).sort((a, b) => a - b);
    const typed = Array.isArray(cut);
    let asked;
    if (typed) asked = [...cut];
    else asked = present4.length ? PROBS[cut].map((p) => quantile7(present4, p)) : [];
    const points = asked.filter((point, index) => asked.indexOf(point) === index);
    const labels = cutLabels(points);
    return {
      cut: typed ? [...cut] : cut,
      n: present4.length,
      asked,
      points,
      repeated: points.length < asked.length,
      merged: points.length > 0 && labels.length < points.length + 1,
      labels
    };
  }
  function cutGroup(value, points) {
    if (isMissing(value)) return null;
    const labels = boundLabels(points);
    return cutLabels(points).indexOf(labels[points.filter((point) => point < value).length]);
  }

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
        `the variable ${written} has a key that is not known: ${unknown.join(", ")}. A variable takes ${KEYS.join(", ")}.`
      );
    }
    const cut = given(spec.cut) ? readCut(spec.cut, written) : null;
    const done = (read2) => Object.freeze(cut === null ? read2 : { ...read2, cut });
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
      if (cut !== null && spec.type !== "number") {
        refuse(
          `the variable ${written} cuts a column, so it must be read as a number: add \`type: 'number'\`.`
        );
      }
      return done({ kind: "column", col: spec.col, type: spec.type ?? null });
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
      return done({ kind: "measure", measure: spec.measure, visit: null, value });
    }
    if (!isText(spec.visit)) {
      refuse(`the variable ${written} must name its visit: \`visit\` is missing or empty.`);
    }
    return done({ kind: "measure", measure: spec.measure, visit: spec.visit, value });
  }
  function readCut(cut, written) {
    if (typeof cut === "string" && CUTS.includes(cut)) return cut;
    if (!Array.isArray(cut)) {
      refuse(
        `the variable ${written}: \`cut\` must be ${CUTS.map((name) => `'${name}'`).join(", ")} or a list of cut points in ascending order, and it is ${JSON.stringify(cut)}.`
      );
    }
    if (!cut.length) {
      refuse(`the variable ${written}: \`cut\` is an empty list: give one cut point or more.`);
    }
    for (const point of cut) {
      if (typeof point !== "number" || !Number.isFinite(point)) {
        refuse(
          `the variable ${written}: a cut point must be a finite number, and ${typeof point === "number" ? String(point) : JSON.stringify(point)} is not one.`
        );
      }
    }
    for (let index = 1; index < cut.length; index += 1) {
      if (!(cut[index] > cut[index - 1])) {
        refuse(
          `the variable ${written}: the cut points must be in ascending order, each greater than the one before: ${cut[index - 1]} then ${cut[index]}.`
        );
      }
    }
    for (let index = 1; index < cut.length; index += 1) {
      const bound2 = writePoint(cut[index]);
      if (bound2 === writePoint(cut[index - 1])) {
        refuse(
          `the variable ${written}: the cut points ${cut[index - 1]} and ${cut[index]} are both written ${bound2} to four significant digits, so the groups they make could not be told apart: give points that differ in their first four significant digits.`
        );
      }
    }
    return Object.freeze([...cut]);
  }
  var WORDS = {
    change: "change from baseline",
    fold_change: "fold change from baseline",
    percent_change: "percent change from baseline"
  };
  var listed = (items) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
  function cutWords(cut) {
    return Array.isArray(cut) ? `cut at ${listed(cut.map(writePoint))}` : `cut at the ${cut}`;
  }
  function label(spec) {
    const read2 = variable(spec);
    let words;
    if (read2.kind === "column") words = read2.col;
    else if (read2.value === "baseline") words = `${read2.measure} at baseline`;
    else {
      const at = `${read2.measure} at ${read2.visit}`;
      words = read2.value === "raw" ? at : `${at}, ${WORDS[read2.value]}`;
    }
    return read2.cut === void 0 ? words : `${words}, ${cutWords(read2.cut)}`;
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
    const usable = /* @__PURE__ */ new Set();
    const number = /* @__PURE__ */ new Map();
    for (const row of results) {
      const visit = row[settings.visit_col];
      if (isBlank(visit)) continue;
      const name = String(visit);
      if (toNumber(row[settings.value_col]) !== null) usable.add(name);
      const order2 = ordered ? toNumber(row[settings.visit_order_col]) : null;
      if (order2 !== null && (!number.has(name) || order2 < number.get(name))) number.set(name, order2);
    }
    return [...usable].sort((a, b) => {
      const [first, second] = [number.get(a), number.get(b)];
      const numbered = (first !== void 0) - (second !== void 0);
      if (numbered !== 0) return -numbered;
      if (first !== void 0 && first !== second) return first - second;
      return byName(a, b) || (a < b ? -1 : a > b ? 1 : 0);
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
    mean: (values) => values.reduce((sum3, value) => sum3 + value, 0) / values.length,
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
    const named2 = Object.entries(variables).map(([name, spec]) => {
      if (name.trim() === "" || name !== name.trim()) {
        refuse3("a variable needs a name with no space at either end: it is the name of its field.");
      }
      if (name === idCol) {
        refuse3(`a variable cannot be named \`${name}\`: that field holds the participant's id.`);
      }
      return { name, variable: variable(spec) };
    });
    const required = new Set(
      config.required === null ? named2.map(({ name }) => name) : config.required
    );
    for (const name of required) {
      if (!named2.some((entry) => entry.name === name)) {
        refuse3(`\`required\` names \`${name}\`, which is not one of the variables.`);
      }
    }
    const unusedCounts = /* @__PURE__ */ new Map();
    const unused = (reason, table, n = 1) => {
      const key = `${table}\0${reason}`;
      unusedCounts.set(key, (unusedCounts.get(key) || 0) + n);
    };
    needColumn(results, idCol, "id_col", "results");
    const measures = named2.filter(({ variable: variable2 }) => variable2.kind === "measure");
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
    for (const { variable: variable2 } of named2) {
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
      for (const { name, variable: variable2 } of named2) {
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
    for (const { name } of named2) {
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
      variables: Object.fromEntries(named2.map(({ name, variable: variable2 }) => [name, variable2])),
      participants: ids.length + notInTable,
      dropped,
      unused: unusedList,
      baseline_visits: baselineVisits
    };
  }

  // src/core/unscheduled.js
  var UNSCHEDULED_DEFAULTS = Object.freeze({
    unscheduled_visits: false,
    unscheduled_visit_pattern: "/unscheduled|early termination/i",
    unscheduled_visit_values: null
  });
  function parsePattern(pattern) {
    const match = /^\/(.*)\/([a-z]*)$/i.exec(String(pattern));
    return match ? new RegExp(match[1], match[2]) : new RegExp(String(pattern));
  }
  function isUnscheduledVisit(visit, settings = {}) {
    if (Array.isArray(settings.unscheduled_visit_values)) {
      return settings.unscheduled_visit_values.map(String).includes(String(visit));
    }
    if (settings.unscheduled_visit_pattern) {
      return parsePattern(settings.unscheduled_visit_pattern).test(String(visit));
    }
    return false;
  }
  var isBlank2 = (value) => value === void 0 || value === null || typeof value === "number" && Number.isNaN(value) || typeof value === "string" && value.trim() === "";
  function scheduledResults(results, settings) {
    const verdicts = /* @__PURE__ */ new Map();
    const visits2 = [];
    const kept = [];
    for (const row of results) {
      const visit = row[settings.visit_col];
      if (isBlank2(visit)) {
        kept.push(row);
        continue;
      }
      const name = String(visit);
      if (!verdicts.has(name)) {
        verdicts.set(name, isUnscheduledVisit(name, settings));
        if (verdicts.get(name)) visits2.push(name);
      }
      if (!verdicts.get(name)) kept.push(row);
    }
    return visits2.length ? { results: kept, visits: visits2, rows: results.length - kept.length } : { results, visits: visits2, rows: 0 };
  }

  // src/output.js
  var output_exports = {};
  __export(output_exports, {
    FILTER_OPERATORS: () => FILTER_OPERATORS,
    SPECIFICATION_FORMAT: () => SPECIFICATION_FORMAT,
    SPECIFICATION_VERSION: () => SPECIFICATION_VERSION,
    TITLE_DEFAULTS: () => TITLE_DEFAULTS,
    automaticFootnote: () => automaticFootnote,
    countsText: () => countsText,
    fillParts: () => fillParts,
    fillText: () => fillText,
    parseCsv: () => parseCsv,
    placeholdersIn: () => placeholdersIn,
    readSpecification: () => readChartSpecification,
    toCsv: () => toCsv
  });

  // src/shared/titles.js
  var isText3 = (value) => typeof value === "string" && value.trim() !== "";
  var refuse4 = (message) => {
    throw new TypeError(`bio.viz: ${message}`);
  };
  var VERSION = true ? "0.3.0" : "unbuilt";
  var DEVELOPMENT = true ? true : true;
  var VERSION_SAID = DEVELOPMENT ? `${VERSION} with development changes` : VERSION;
  var TITLE_DEFAULTS = Object.freeze({ title: null, subtitle: null, footnotes: null });
  var DOWNLOAD_DEFAULTS = Object.freeze({ downloads: true, png_scale: 2 });
  function checkDownloads(settings) {
    if (typeof settings.downloads !== "boolean") refuse4("`downloads` must be true or false.");
    const scale = settings.png_scale;
    if (typeof scale !== "number" || !Number.isFinite(scale) || scale < 1 || scale > 4) {
      refuse4("`png_scale` must be a number from 1 to 4: image pixels per CSS pixel.");
    }
  }
  var PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  function fillText(template, values = {}) {
    return fillParts(template, values).map((part) => part.text).join("");
  }
  function fillParts(template, values = {}) {
    const text2 = String(template);
    const parts = [];
    const push = (piece, value) => {
      if (piece === "") return;
      const last = parts[parts.length - 1];
      if (!value && last && !last.value) last.text += piece;
      else parts.push({ text: piece, value });
    };
    let at = 0;
    for (const match of text2.matchAll(PLACEHOLDER)) {
      push(text2.slice(at, match.index), false);
      const [written, name] = match;
      if (Object.prototype.hasOwnProperty.call(values, name)) {
        const value = values[name];
        push(value === null || value === void 0 ? "" : String(value), true);
      } else push(written, false);
      at = match.index + written.length;
    }
    push(text2.slice(at), false);
    return parts;
  }
  var placeholdersIn = (template) => [
    ...new Set([...String(template).matchAll(PLACEHOLDER)].map((match) => match[1]))
  ];
  function checkTitles(settings) {
    for (const key of ["title", "subtitle"]) {
      if (settings[key] !== null && typeof settings[key] !== "string") {
        refuse4(`\`${key}\` must be text, which may hold placeholders such as {n}, or null for none.`);
      }
    }
    const { footnotes } = settings;
    if (footnotes === null) return;
    const list = Array.isArray(footnotes) ? footnotes : [footnotes];
    if (!list.every((entry) => typeof entry === "string")) {
      refuse4("`footnotes` must be text, or a list of texts, or null for none.");
    }
    settings.footnotes = list.filter((entry) => entry.trim() !== "");
  }
  var NOTHING_ASKED = "No statistic was asked of R.";
  var STILL_WAITING = "Statistics: waiting for R.";
  var dateDrawn = (when = /* @__PURE__ */ new Date()) => when.toISOString().slice(0, 10);
  var countOf = (count) => {
    if (typeof count === "number") return Number.isFinite(count) ? count : null;
    if (typeof count === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(count)) return Number(count);
    return null;
  };
  function countsText(counts, of = "groups") {
    const one = countOf(counts);
    if (one !== null) return `n = ${one}`;
    if (counts === null || typeof counts !== "object" || Array.isArray(counts)) return null;
    const entries = [];
    for (const [group, count] of Object.entries(counts)) {
      const read2 = countOf(count);
      if (read2 !== null) entries.push([group, read2]);
    }
    if (!entries.length) return null;
    if (entries.length <= 4)
      return entries.map(([group, count]) => `${group} n = ${count}`).join(", ");
    let least = Infinity;
    let most = -Infinity;
    for (const [, count] of entries) {
      if (count < least) least = count;
      if (count > most) most = count;
    }
    return `${least === most ? `n = ${least}` : `n = ${least} to ${most}`} across ${entries.length} ${of}`;
  }
  var ADJUSTMENT_NAMES = Object.freeze({
    BH: "Benjamini-Hochberg",
    fdr: "Benjamini-Hochberg",
    BY: "Benjamini-Yekutieli",
    holm: "Holm",
    hochberg: "Hochberg",
    hommel: "Hommel",
    bonferroni: "Bonferroni"
  });
  function methodsOf(value) {
    const methods = [];
    const adjustments = [];
    const take = (entry) => {
      if (!entry || typeof entry !== "object") return;
      if (isText3(entry.method) && !methods.includes(entry.method)) methods.push(entry.method);
      if (isText3(entry.adjustment) && entry.adjustment !== "none") {
        const said2 = ADJUSTMENT_NAMES[entry.adjustment] || entry.adjustment;
        if (!adjustments.includes(said2)) adjustments.push(said2);
      }
    };
    take(value);
    for (const list of Object.values(value)) {
      if (Array.isArray(list)) list.forEach(take);
    }
    return { methods, adjustments };
  }
  function sourceText(answer) {
    if (answer.form === "browser") return "computed by R in this browser";
    if (answer.form !== "precomputed") return "computed by R";
    const by = answer.computedBy;
    if (!by || !isText3(by.r_version)) return "stored with the page";
    const gsmBio = isText3(by.gsm_bio_version) ? ` with gsm.bio ${by.gsm_bio_version}` : "";
    const when = isText3(by.computed_at) && /^\d{4}-\d{2}-\d{2}/.test(by.computed_at) ? ` on ${by.computed_at.slice(0, 10)}` : "";
    return `computed by R ${by.r_version}${gsmBio}${when}, stored with the page`;
  }
  function answerText(answer, of) {
    const value = answer.value && typeof answer.value === "object" ? answer.value : {};
    const { methods, adjustments } = methodsOf(value);
    const [first, ...rest] = methods;
    const method = !first ? "no statistic" : rest.length ? `${first}, with ${rest.join(" and ")}` : first;
    const counts = countsText(value.counts, of);
    return (counts ? `${method} (${counts})` : method) + (adjustments.length ? `, p-values adjusted by ${adjustments.join(" and ")}` : "");
  }
  function automaticFootnote({ date, version: version2, asked = [], of }) {
    const drawn = `Drawn on ${date} by bio.viz ${version2}.`;
    if (!asked.length) return `${drawn} ${NOTHING_ASKED}`;
    if (asked.some((entry) => !entry.answer)) return `${drawn} ${STILL_WAITING}`;
    const answers = asked.map((entry) => entry.answer);
    const ok = answers.filter((answer) => answer.status === "ok");
    if (!ok.length) {
      const failed2 = answers.find((answer) => answer.status === "error");
      return failed2 ? `${drawn} Statistics: R reported an error.` : `${drawn} Statistics: unavailable, as the line under the chart says.`;
    }
    const sources = [...new Set(ok.map(sourceText))];
    const said2 = ok.map((answer) => answerText(answer, of)).join("; ");
    const missing = answers.length - ok.length;
    return `${drawn} Statistics: ${said2}; ${sources.join("; ")}.` + (missing ? ` ${missing} of ${answers.length} could not be computed.` : "");
  }

  // src/shared/csv.js
  var NEEDS_QUOTES = /[",\r\n]/;
  function csvField(value) {
    if (value === null || value === void 0) return "";
    let text2;
    if (typeof value === "number") {
      text2 = Number.isNaN(value) ? "NaN" : value === Infinity ? "Inf" : value === -Infinity ? "-Inf" : String(value);
    } else if (typeof value === "boolean") text2 = value ? "TRUE" : "FALSE";
    else text2 = String(value);
    return NEEDS_QUOTES.test(text2) ? `"${text2.replace(/"/g, '""')}"` : text2;
  }
  function toCsv(rows, columns) {
    const lines = [columns.map((column) => csvField(column.label)).join(",")];
    for (const row of rows) {
      lines.push(columns.map((column) => csvField(row[column.value_col])).join(","));
    }
    return `${lines.join("\r\n")}\r
`;
  }
  function parseCsv(text2) {
    const records = [];
    let record = [];
    let field = "";
    let quoted = false;
    let index = 0;
    const end = () => {
      record.push(field);
      field = "";
    };
    while (index < text2.length) {
      const char = text2[index];
      if (quoted) {
        if (char === '"' && text2[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        if (char === '"') quoted = false;
        else field += char;
        index += 1;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === ",") end();
      else if (char === "\r" && text2[index + 1] === "\n") {
        end();
        records.push(record);
        record = [];
        index += 2;
        continue;
      } else if (char === "\n") {
        end();
        records.push(record);
        record = [];
      } else field += char;
      index += 1;
    }
    if (field !== "" || record.length) {
      end();
      records.push(record);
    }
    return records;
  }
  var isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  var OWN = ["asked", "function", "part", "item"];
  var refuse5 = (message) => {
    throw new TypeError(`bio.viz: ${message}`);
  };
  function scalars(value, prefix, out = {}) {
    const put = (name, entry) => {
      if (Object.prototype.hasOwnProperty.call(out, name)) {
        refuse5(`R\u2019s answer has two members written \`${name}\` in the statistics file.`);
      }
      out[name] = entry;
    };
    if (Array.isArray(value)) {
      if (value.every((entry) => !isObject(entry) && !Array.isArray(entry))) {
        if (value.length)
          put(prefix, value.map((entry) => entry === null ? "NA" : String(entry)).join(" | "));
        return out;
      }
      value.forEach((entry, at) => {
        const name = `${prefix}/${at + 1}`;
        if (isObject(entry) || Array.isArray(entry)) scalars(entry, name, out);
        else put(name, entry);
      });
      return out;
    }
    for (const [key, entry] of Object.entries(value)) {
      const name = prefix ? `${prefix}/${key}` : key;
      if (isObject(entry) || Array.isArray(entry)) scalars(entry, name, out);
      else put(name, entry);
    }
    return out;
  }
  function membersOf(object, parts) {
    const out = {};
    for (const [key, entry] of Object.entries(object)) {
      if (OWN.includes(key) || key === "data" || key.startsWith("data/")) {
        refuse5(`R\u2019s answer has a member \`${key}\`, which the statistics file names itself.`);
      }
      if (parts && Array.isArray(entry) && entry.some(isObject)) continue;
      if (isObject(entry) || Array.isArray(entry)) scalars(entry, key, out);
      else out[key] = entry;
    }
    return out;
  }
  function statisticsTable(asked) {
    const rows = [];
    asked.forEach((entry, index) => {
      const answer = entry.answer;
      if (!answer || answer.status !== "ok" || !isObject(answer.value)) return;
      const about = {
        asked: index + 1,
        function: entry.name,
        ...isObject(entry.dataId) || Array.isArray(entry.dataId) ? scalars(entry.dataId, "data") : { data: entry.dataId }
      };
      const value = answer.value;
      rows.push({ ...about, part: "result", ...membersOf(value, true) });
      for (const [key, list] of Object.entries(value)) {
        if (!Array.isArray(list) || !list.some(isObject)) continue;
        list.forEach((part, at) => {
          if (isObject(part))
            rows.push({ ...about, part: key, item: at + 1, ...membersOf(part, false) });
        });
      }
    });
    const order2 = [];
    const seen = /* @__PURE__ */ new Set();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) {
          seen.add(key);
          order2.push(key);
        }
      }
    }
    return { columns: order2.map((key) => ({ value_col: key, label: key })), rows };
  }

  // src/group-comparison/configure.js
  var configure_exports = {};
  __export(configure_exports, {
    DEFAULT_SETTINGS: () => DEFAULT_SETTINGS2,
    MARKS: () => MARKS,
    TESTS: () => TESTS,
    TILE_SUMMARIES: () => TILE_SUMMARIES,
    TIME_MARKS: () => TIME_MARKS,
    VISIT_ADJUSTMENTS: () => VISIT_ADJUSTMENTS,
    Y_SCALES: () => Y_SCALES,
    coreSettings: () => coreSettings,
    fieldSpec: () => fieldSpec,
    syncSettings: () => syncSettings
  });

  // src/shared/settings.js
  var isText4 = (value) => typeof value === "string" && value.trim() !== "";
  var isPlainObject4 = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  var refuse6 = (message) => {
    throw new TypeError(`bio.viz: ${message}`);
  };
  function fieldSpec(value, setting) {
    if (isText4(value)) return { value_col: value, label: value };
    if (isPlainObject4(value) && isText4(value.value_col)) {
      return {
        ...value,
        value_col: value.value_col,
        label: isText4(value.label) ? value.label : value.value_col
      };
    }
    return refuse6(
      `\`${setting}\` holds something that is not a column name or { value_col, label }.`
    );
  }
  function fieldList(value, setting) {
    if (value === null || value === void 0) return null;
    const list = Array.isArray(value) ? value : [value];
    return list.map((entry) => fieldSpec(entry, setting));
  }
  function textList2(value, setting, { empty = false } = {}) {
    if (value === null || value === void 0) return null;
    const list = Array.isArray(value) ? value : [value];
    if (!list.length && !empty || !list.every((entry) => isText4(entry) || typeof entry === "number")) {
      refuse6(`\`${setting}\` must be a name, or a list of names.`);
    }
    return [...new Set(list.map(String))];
  }
  var columnOrNull = (settings, key) => {
    if (settings[key] !== null && !isText4(settings[key])) {
      refuse6(`\`${key}\` must be the name of a column, or null.`);
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
      refuse6(`${chart} takes its settings as an object.`);
    }
    const given2 = overrides || {};
    for (const key of Object.keys(given2)) {
      if (!(key in defaults)) {
        refuse6(
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
      if (!isText4(settings[key])) refuse6(`\`${key}\` must be the name of a column.`);
    }
    if (!baselineStats.includes(settings.baseline_stat)) {
      refuse6(`\`baseline_stat\` must be one of ${baselineStats.join(", ")}.`);
    }
    if ("profile" in settings && typeof settings.profile !== "boolean") {
      refuse6("`profile` must be true or false.");
    }
    if (settings.waiting_note !== null && !isText4(settings.waiting_note)) {
      refuse6("`waiting_note` must be a sentence, or null for none.");
    }
    if (settings.connection !== null && (typeof settings.connection !== "object" || typeof settings.connection.run !== "function")) {
      refuse6("`connection` must be a connection to R (BioViz.r.createConnection), or null.");
    }
    checkTitles(settings);
    checkDownloads(settings);
  }
  function checkBack(settings) {
    if (settings.back !== null && (!isPlainObject4(settings.back) || !isText4(settings.back.label) || typeof settings.back.action !== "function")) {
      refuse6("`back` must be { label, action }, a sentence and a function, or null for none.");
    }
  }
  function variableSetting(value, setting) {
    if (value === null || value === void 0) return null;
    if (!isPlainObject4(value)) {
      refuse6(
        `\`${setting}\` must be a variable: { measure, visit, value } for a biomarker at a visit, or { col } for a participant-level number; or null.`
      );
    }
    const read2 = variable("col" in value && value.col != null ? { ...value, type: "number" } : value);
    if (read2.cut !== void 0) {
      refuse6(
        `\`${setting}\` is read as a number, so it takes no \`cut\`: a cut makes groups. Leave \`cut\` out.`
      );
    }
    return read2.kind === "column" ? { col: read2.col } : {
      measure: read2.measure,
      value: read2.value,
      ...read2.visit === null ? {} : { visit: read2.visit }
    };
  }

  // src/shared/cut.js
  function writtenCut(spec) {
    const read2 = variable(spec);
    const cut = Array.isArray(read2.cut) ? [...read2.cut] : read2.cut;
    if (read2.kind === "column") return { col: read2.col, type: read2.type, cut };
    return read2.value === "baseline" ? { measure: read2.measure, value: read2.value, cut } : { measure: read2.measure, visit: read2.visit, value: read2.value, cut };
  }
  function checkGrouping(settings, key) {
    const value = settings[key];
    if (!isPlainObject4(value)) return;
    if (value.cut === void 0 || value.cut === null) {
      refuse6(
        `\`${key}\` is a variable with no cut. A biomarker or a number makes groups only when it is cut: add \`cut: 'median'\`, 'tertiles', 'quartiles' or the cut points.`
      );
    }
    settings[key] = writtenCut(value);
  }
  var isCut = (by) => isPlainObject4(by);
  function cutOf({ results, participants }, spec, settings) {
    const made = frame(
      { results, participants: participants || void 0 },
      { v: spec },
      { ...coreSettings(settings), required: [] }
    );
    return {
      spec: writtenCut(spec),
      ...cutPoints(
        made.data.map((record) => record.v),
        spec.cut
      )
    };
  }
  function groupLabel(value, cut) {
    const index = cutGroup(value, cut.points);
    return index === null ? null : cut.labels[index];
  }
  var listed2 = (items) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
  function cutNote(spec, cut) {
    const plain5 = writtenCut(spec);
    delete plain5.cut;
    const words = label(plain5);
    if (Array.isArray(cut.cut)) return `${words} is cut at ${listed2(cut.points.map(writePoint))}.`;
    if (!cut.n) return `${words} has no value to cut, so it makes no groups.`;
    const asked = cut.asked.map(writePoint);
    const sentence2 = `${words} is cut at its ${cut.cut}, ${listed2(asked)}, worked out on the ${cut.n} participant${cut.n === 1 ? "" : "s"} with a value.`;
    const said2 = [sentence2];
    if (cut.repeated) {
      said2.push(
        `The points repeat, so they make ${cut.points.length + 1} groups, not ${cut.asked.length + 1}.`
      );
    }
    if (cut.merged) {
      said2.push(
        `The points differ only past four significant digits, so groups whose bounds are written alike are one: ${cut.labels.length} groups, not ${cut.points.length + 1}.`
      );
    }
    return said2.join(" ");
  }

  // src/group-comparison/configure.js
  var MARKS = Object.freeze(["box", "violin", "points"]);
  var Y_SCALES = Object.freeze(["linear", "log"]);
  var TILE_SUMMARIES = Object.freeze(["median", "mean"]);
  var TIME_MARKS = Object.freeze(["box", "mean_se", "median_iqr"]);
  var VISIT_ADJUSTMENTS = Object.freeze(["none", "holm", "BH"]);
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
    // One biomarker over time, drawn when a biomarker is chosen with every visit
    // it has: what the picture is drawn as.
    time_mark: "box",
    // What the controls offer.
    measures: null,
    groups: null,
    max_levels: 12,
    filters: null,
    // Unscheduled visits, under safety.viz's names and defaults: left out of the
    // chart at every level until switched on (src/core/unscheduled.js).
    ...UNSCHEDULED_DEFAULTS,
    // The trend tiles, drawn when no biomarker is chosen: what a line goes
    // through, and the least a tile's value axis spans, in standard deviations
    // of the results at the baseline visit.
    tile_summary: "median",
    tile_min_spread: 1.25,
    // Of the overview v0.2.0 drew, a page of biomarkers at a time. The tiles
    // draw every biomarker, so neither applies to them; both are still read and
    // checked, so settings and a specification written for v0.2.0 are not refused.
    overview_limit: 12,
    page: 0,
    // The listing of participants.
    details: null,
    page_size: 10,
    // The statistics line.
    connection: null,
    statistic: "Analyze_GroupDifference",
    test: "t",
    pairwise: false,
    // Under one biomarker over time: the R function that answers the test at
    // every visit in one request, and how R adjusts the p-values across them.
    statistic_by_visit: "Analyze_GroupDifferenceBy",
    visit_adjustment: "none",
    waiting_note: null,
    // A way back, when another chart opened this one in its place.
    back: null,
    // safety.viz's participant profile.
    profile: true,
    profile_details: null,
    studyday_col: null,
    normal_col_high: null,
    normal_col_low: null,
    // The title, subtitle and footnotes, with placeholders (src/shared/titles.js).
    ...TITLE_DEFAULTS,
    // The downloads under the chart, and the PNG's resolution (src/shared/png.js).
    ...DOWNLOAD_DEFAULTS
  });
  function syncSettings(overrides) {
    const settings = layOver(DEFAULT_SETTINGS2, overrides, "the group comparison chart");
    checkShared(settings, BASELINE_STATS);
    checkBack(settings);
    for (const key of [
      "visit_order_col",
      "unit_col",
      "participant_id_col",
      "start_value",
      "color_by",
      "studyday_col",
      "normal_col_high",
      "normal_col_low"
    ]) {
      columnOrNull(settings, key);
    }
    for (const key of ["group_by", "panel_by"]) {
      if (isCut(settings[key])) checkGrouping(settings, key);
      else columnOrNull(settings, key);
    }
    if (!VALUE_TYPES.includes(settings.value_type)) {
      refuse6(`\`value_type\` must be one of ${VALUE_TYPES.join(", ")}.`);
    }
    if (!MARKS.includes(settings.mark)) refuse6(`\`mark\` must be one of ${MARKS.join(", ")}.`);
    if (!TIME_MARKS.includes(settings.time_mark)) {
      refuse6(`\`time_mark\` must be one of ${TIME_MARKS.join(", ")}.`);
    }
    if (!Y_SCALES.includes(settings.y_scale)) {
      refuse6(`\`y_scale\` must be one of ${Y_SCALES.join(", ")}.`);
    }
    for (const key of ["page_size", "max_levels", "overview_limit"]) {
      if (!Number.isInteger(settings[key]) || settings[key] < 1) {
        refuse6(`\`${key}\` must be a whole number, one or more.`);
      }
    }
    if (!Number.isInteger(settings.page) || settings.page < 0) {
      refuse6("`page` must be a whole number, from 0.");
    }
    if (!TILE_SUMMARIES.includes(settings.tile_summary)) {
      refuse6(`\`tile_summary\` must be one of ${TILE_SUMMARIES.join(", ")}.`);
    }
    if (typeof settings.tile_min_spread !== "number" || !Number.isFinite(settings.tile_min_spread) || settings.tile_min_spread < 0) {
      refuse6(
        "`tile_min_spread` must be a number, zero or more: how many standard deviations of the results at the baseline visit a tile\u2019s value axis spans at the least."
      );
    }
    if (typeof settings.unscheduled_visits !== "boolean") {
      refuse6("`unscheduled_visits` must be true or false.");
    }
    if (settings.unscheduled_visit_pattern !== null) {
      if (!isText4(settings.unscheduled_visit_pattern)) {
        refuse6(
          "`unscheduled_visit_pattern` must be a regular expression written as text, `/source/flags` or a plain source, or null for none."
        );
      }
      try {
        isUnscheduledVisit("", { unscheduled_visit_pattern: settings.unscheduled_visit_pattern });
      } catch (error) {
        refuse6(
          `\`unscheduled_visit_pattern\` is not a regular expression a browser reads: ${error.message}.`
        );
      }
    }
    if (!TESTS.includes(settings.test)) refuse6(`\`test\` must be one of ${TESTS.join(", ")}.`);
    if (typeof settings.pairwise !== "boolean") refuse6("`pairwise` must be true or false.");
    if (settings.statistic !== null && !isText4(settings.statistic)) {
      refuse6("`statistic` must be the name of an R function, or null for no statistics line.");
    }
    if (settings.statistic_by_visit !== null && !isText4(settings.statistic_by_visit)) {
      refuse6(
        "`statistic_by_visit` must be the name of an R function, or null for no test under the visits."
      );
    }
    if (!VISIT_ADJUSTMENTS.includes(settings.visit_adjustment)) {
      refuse6(
        `\`visit_adjustment\` must be one of ${VISIT_ADJUSTMENTS.join(", ")}: the name R\u2019s p.adjust() gives the adjustment of the p-values across the visits.`
      );
    }
    settings.baseline_visits = textList2(settings.baseline_visits, "baseline_visits");
    settings.visits = textList2(settings.visits, "visits", { empty: true });
    settings.levels = textList2(settings.levels, "levels", { empty: true });
    settings.unscheduled_visit_values = textList2(
      settings.unscheduled_visit_values,
      "unscheduled_visit_values",
      { empty: true }
    );
    settings.measures = textList2(settings.measures, "measures");
    settings.groups = fieldList(settings.groups, "groups");
    settings.filters = fieldList(settings.filters, "filters");
    settings.details = fieldList(settings.details, "details");
    settings.profile_details = fieldList(settings.profile_details, "profile_details");
    return settings;
  }

  // src/association-scatter/configure.js
  var configure_exports2 = {};
  __export(configure_exports2, {
    DEFAULT_SETTINGS: () => DEFAULT_SETTINGS3,
    FITS: () => FITS,
    METHODS: () => METHODS,
    SCALES: () => SCALES,
    syncSettings: () => syncSettings2
  });
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
    normal_col_low: null,
    // The title, subtitle and footnotes, with placeholders (src/shared/titles.js).
    ...TITLE_DEFAULTS,
    // The downloads under the chart, and the PNG's resolution (src/shared/png.js).
    ...DOWNLOAD_DEFAULTS
  });
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
        refuse6(`\`${key}\` must be one of ${SCALES.join(", ")}.`);
      }
    }
    if (!FITS.includes(settings.fit)) refuse6(`\`fit\` must be one of ${FITS.join(", ")}.`);
    if (!METHODS.includes(settings.method)) {
      refuse6(`\`method\` must be one of ${METHODS.join(", ")}.`);
    }
    for (const key of ["page_size", "max_levels"]) {
      if (!Number.isInteger(settings[key]) || settings[key] < 1) {
        refuse6(`\`${key}\` must be a whole number, one or more.`);
      }
    }
    if (settings.statistic !== null && !isText4(settings.statistic)) {
      refuse6("`statistic` must be the name of an R function, or null for no statistics line.");
    }
    if (settings.fit_statistic !== null && !isText4(settings.fit_statistic)) {
      refuse6(
        "`fit_statistic` must be the name of an R function, or null for no linear or smooth line."
      );
    }
    checkBack(settings);
    settings.x = variableSetting(settings.x, "x");
    settings.y = variableSetting(settings.y, "y");
    settings.baseline_visits = textList2(settings.baseline_visits, "baseline_visits");
    settings.measures = textList2(settings.measures, "measures");
    settings.numbers = fieldList(settings.numbers, "numbers");
    settings.groups = fieldList(settings.groups, "groups");
    settings.filters = fieldList(settings.filters, "filters");
    settings.details = fieldList(settings.details, "details");
    settings.profile_details = fieldList(settings.profile_details, "profile_details");
    return settings;
  }

  // src/correlation-matrix/configure.js
  var configure_exports3 = {};
  __export(configure_exports3, {
    DEFAULT_SETTINGS: () => DEFAULT_SETTINGS4,
    METHODS: () => METHODS2,
    MODES: () => MODES,
    SCATTER_LIMIT: () => SCATTER_LIMIT,
    VIEWS: () => VIEWS,
    syncSettings: () => syncSettings3
  });
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
    scatter: null,
    // The title, subtitle and footnotes, with placeholders (src/shared/titles.js).
    ...TITLE_DEFAULTS,
    // The downloads under the chart, and the PNG's resolution (src/shared/png.js).
    ...DOWNLOAD_DEFAULTS
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
      if (settings[key] !== null && !isText4(settings[key])) {
        refuse6(`\`${key}\` must be the name of ${what}, or null.`);
      }
    }
    if (!MODES.includes(settings.mode)) refuse6(`\`mode\` must be one of ${MODES.join(", ")}.`);
    if (!VIEWS.includes(settings.view)) refuse6(`\`view\` must be one of ${VIEWS.join(", ")}.`);
    if (!VALUE_TYPES.includes(settings.value_type)) {
      refuse6(`\`value_type\` must be one of ${VALUE_TYPES.join(", ")}.`);
    }
    if (!METHODS2.includes(settings.method)) {
      refuse6(`\`method\` must be one of ${METHODS2.join(", ")}.`);
    }
    if (!Number.isInteger(settings.max_levels) || settings.max_levels < 1) {
      refuse6("`max_levels` must be a whole number, one or more.");
    }
    if (!Number.isInteger(settings.limit) || settings.limit < 2) {
      refuse6("`limit` must be a whole number, two or more.");
    }
    if (settings.min_pairs !== null && !(typeof settings.min_pairs === "number" && Number.isFinite(settings.min_pairs) && settings.min_pairs > 0)) {
      refuse6("`min_pairs` must be a number above zero, or null for R\u2019s own minimum.");
    }
    if (settings.statistic !== null && !isText4(settings.statistic)) {
      refuse6("`statistic` must be the name of an R function, or null for no coefficients.");
    }
    if (settings.scatter !== null && !isPlainObject4(settings.scatter)) {
      refuse6("`scatter` must be an object of settings for the association scatter, or null.");
    }
    settings.baseline_visits = textList2(settings.baseline_visits, "baseline_visits");
    settings.biomarkers = textList2(settings.biomarkers, "biomarkers", { empty: true });
    settings.visits = textList2(settings.visits, "visits", { empty: true });
    settings.measures = textList2(settings.measures, "measures");
    settings.filters = fieldList(settings.filters, "filters");
    return settings;
  }

  // src/biomarker-screen/configure.js
  var configure_exports4 = {};
  __export(configure_exports4, {
    ADJUSTMENTS: () => ADJUSTMENTS2,
    COMPARISONS: () => COMPARISONS,
    DEFAULT_SETTINGS: () => DEFAULT_SETTINGS5,
    METHODS: () => METHODS3,
    SORTS: () => SORTS,
    syncSettings: () => syncSettings4
  });

  // src/shared/statisticLine.js
  var WAITING = "Statistics: waiting for R\u2026";
  var NOT_STORED = "Statistics are unavailable for this view: the page holds no stored result for it, and no R is attached to compute one.";
  var sentence = (state, said2) => ({
    state,
    text: said2,
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
    ...texts(value.warnings).map((said2) => ({ kind: "warning", text: `R warned: ${said2}` })),
    ...texts(value.notes).map((said2) => ({ kind: "note", text: `R\u2019s note: ${said2}` }))
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
  var ANSWERED = /* @__PURE__ */ new WeakSet();
  var hasAnswered = (connection) => connection !== null && typeof connection === "object" && ANSWERED.has(connection);
  function createDesk({
    connection,
    note = null,
    describe: describe2,
    waiting = (said2) => sentence("waiting", said2)
  }) {
    let current = 0;
    let retired = false;
    const withNote = (said2) => note && !hasAnswered(connection) ? `${said2} ${note}` : said2;
    return {
      idle: withNote,
      retire() {
        retired = true;
      },
      begin() {
        current += 1;
        const round = current;
        let noted = false;
        return {
          ask({ name, data, args, dataId }, show, context) {
            show(waiting(noted ? WAITING : withNote(WAITING), context));
            noted = true;
            return connection.run(name, { data, args, dataId }).then((result) => {
              const ran = result && result.status === "ok" && result.form !== "precomputed";
              if (ran && connection !== null && typeof connection === "object") {
                ANSWERED.add(connection);
              }
              if (retired || round !== current) return false;
              show(describe2(result, context), result);
              return true;
            });
          }
        };
      }
    };
  }

  // src/shared/tables.js
  var isBlank3 = (value) => value === void 0 || value === null || typeof value === "number" && Number.isNaN(value) || typeof value === "string" && value.trim() === "";
  var naturally = (a, b) => String(a).localeCompare(String(b), void 0, { numeric: true });
  function levelsOf(values) {
    return [...new Set(values.filter((value) => !isBlank3(value)).map(String))].sort(naturally);
  }
  var partsOf = (text2) => text2.match(/[0-9]+|[^0-9]+/g) || [];
  var lowerAscii = (text2) => text2.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  var isLetter = (part) => /^[A-Za-z]/.test(part) || part.codePointAt(0) >= 128;
  function categoryOrder(a, b) {
    const [first, second] = [String(a), String(b)];
    const [partsA, partsB] = [partsOf(first), partsOf(second)];
    const shared = Math.min(partsA.length, partsB.length);
    for (let index = 0; index < shared; index += 1) {
      const [partA, partB] = [partsA[index], partsB[index]];
      const [digitsA, digitsB] = [/^[0-9]/.test(partA), /^[0-9]/.test(partB)];
      if (digitsA && digitsB) {
        const difference = Number(partA) - Number(partB);
        if (difference !== 0) return Math.sign(difference);
      } else if (digitsA !== digitsB) {
        const sign = isLetter(digitsA ? partB : partA) ? -1 : 1;
        return digitsA ? sign : -sign;
      } else {
        const order2 = Math.sign(byCodePoint(lowerAscii(partA), lowerAscii(partB)));
        if (order2 !== 0) return order2;
      }
    }
    if (partsA.length !== partsB.length) return Math.sign(partsA.length - partsB.length);
    return -Math.sign(byCodePoint(first, second));
  }
  function categoriesOf(values) {
    return [...new Set(values.filter((value) => !isBlank3(value)).map(String))].sort(categoryOrder);
  }
  function listMeasures(results, settings) {
    const present4 = levelsOf(results.map((row) => row[settings.measure_col]));
    if (!settings.measures) return present4;
    const listed4 = settings.measures.filter((measure) => present4.includes(measure));
    return listed4.length ? listed4 : present4;
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
        if (isBlank3(value)) continue;
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
        if (isBlank3(row[name])) continue;
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
      const id = settings.participant_id_col || settings.id_col;
      return settings.filters.filter(
        (spec) => Object.hasOwn(participants[0], spec.value_col) && spec.value_col !== id
      );
    }
    return categories.filter((column) => column.table === "participants").map(({ value_col, label: label2 }) => ({ value_col, label: label2 }));
  }
  function listVisits(results, settings) {
    const config = coreSettings(settings);
    const all = visits(results, config);
    if (Array.isArray(settings.visits) && !settings.visits.length) return { all, start: [] };
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
    const idOf = (row, column) => isBlank3(row[column]) ? null : String(row[column]);
    const keptIds = new Set(kept.map((row) => idOf(row, participantIdCol)));
    const filteredOut = new Set(
      participants.map((row) => idOf(row, participantIdCol)).filter((id) => id !== null && !keptIds.has(id))
    );
    return {
      participants: kept,
      // When the filters keep nobody, nobody passes: no results are framed, so a
      // row for someone the table does not have cannot make a frame of no one.
      results: kept.length ? results.filter((row) => !filteredOut.has(idOf(row, idCol))) : []
    };
  }
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
        if (isBlank3(value)) continue;
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
        if (isBlank3(row[name])) continue;
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

  // src/shared/outcomes.js
  var OUTCOME_DEFAULTS = Object.freeze({
    outcome_id_col: null,
    endpoint_col: "PARAMCD",
    endpoint_label_col: "PARAM",
    time_col: "AVAL",
    censor_col: "CNSR",
    event_col: null,
    endpoint: null
  });
  var LEFT_OUT = Object.freeze({
    NO_OUTCOME: "No outcome for the endpoint",
    SEVERAL_OUTCOMES: "More than one outcome row for the endpoint",
    MISSING_OUTCOME: "Time or flag is missing or not a number",
    NOT_A_FLAG: "Flag is not 0 or 1",
    NEGATIVE_TIME: "Time is negative"
  });
  function flaggedSettings(given2) {
    const settings = given2 || {};
    return settings.event_col !== void 0 && settings.event_col !== null && !("censor_col" in settings) ? { ...settings, censor_col: null } : settings;
  }
  function laidOver(current, given2) {
    return { ...current, ...flaggedSettings(given2) };
  }
  function checkOutcomeSettings(settings) {
    for (const key of ["outcome_id_col", "endpoint_label_col", "censor_col", "event_col"]) {
      columnOrNull(settings, key);
    }
    for (const key of ["endpoint_col", "time_col"]) {
      if (!isText4(settings[key])) refuse6(`\`${key}\` must be the name of a column.`);
    }
    if (settings.censor_col === null === (settings.event_col === null)) {
      refuse6(
        "Name exactly one of `censor_col` (1 = censored, as ADaM\u2019s CNSR) and `event_col` (1 = event); give the other as null."
      );
    }
    if (settings.endpoint !== null && !isText4(settings.endpoint)) {
      refuse6("`endpoint` must be the name of an endpoint, or null for the first.");
    }
  }
  function flagOf(settings) {
    return settings.censor_col !== null ? { col: settings.censor_col, field: "censor" } : { col: settings.event_col, field: "event" };
  }
  function checkOutcomes(outcomes, settings) {
    if (!outcomes.length) return;
    const flag = flagOf(settings);
    const needed = [
      ["endpoint_col", settings.endpoint_col],
      [
        settings.outcome_id_col ? "outcome_id_col" : "id_col",
        settings.outcome_id_col || settings.id_col
      ],
      ["time_col", settings.time_col],
      [flag.field === "censor" ? "censor_col" : "event_col", flag.col]
    ];
    for (const [key, column] of needed) {
      if (!outcomes.some((row) => column in row)) {
        refuse6(`the outcomes table has no column \`${column}\` (\`${key}\`).`);
      }
    }
  }
  function listEndpoints(outcomes, settings) {
    return levelsOf(outcomes.map((row) => row[settings.endpoint_col])).map((endpoint) => {
      const labelled = settings.endpoint_label_col ? outcomes.find(
        (row) => String(row[settings.endpoint_col]) === endpoint && !isBlank3(row[settings.endpoint_label_col])
      ) : null;
      return {
        endpoint,
        label: labelled ? String(labelled[settings.endpoint_label_col]) : endpoint
      };
    });
  }
  var OUTCOME_UNUSED = Object.freeze({
    NO_PARTICIPANT: "Outcome row for no such participant"
  });
  var numberOf = (value) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (value === "TRUE" || value === "true") return 1;
    if (value === "FALSE" || value === "false") return 0;
    if (typeof value !== "string" || value.trim() === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  function outcomesOf(outcomes, settings, endpoint, known = null) {
    const idCol = settings.outcome_id_col || settings.id_col;
    const flag = flagOf(settings);
    const byId = /* @__PURE__ */ new Map();
    let strangers = 0;
    for (const row of outcomes) {
      if (String(row[settings.endpoint_col]) !== endpoint) continue;
      if (isBlank3(row[idCol]) || known && !known.has(String(row[idCol]))) {
        strangers += 1;
        continue;
      }
      const id = String(row[idCol]);
      byId.set(id, [...byId.get(id) || [], row]);
    }
    const outcomeOf = (id) => {
      const found = byId.get(String(id)) || [];
      if (!found.length) return { reason: LEFT_OUT.NO_OUTCOME };
      if (found.length > 1) return { reason: LEFT_OUT.SEVERAL_OUTCOMES };
      const time = numberOf(found[0][settings.time_col]);
      const flagged = numberOf(found[0][flag.col]);
      if (time === null || flagged === null) return { reason: LEFT_OUT.MISSING_OUTCOME };
      if (flagged !== 0 && flagged !== 1) return { reason: LEFT_OUT.NOT_A_FLAG };
      if (time < 0) return { reason: LEFT_OUT.NEGATIVE_TIME };
      return {
        time,
        flag: flagged,
        event: flag.field === "censor" ? flagged === 0 : flagged === 1
      };
    };
    outcomeOf.strangers = strangers;
    return outcomeOf;
  }

  // src/biomarker-screen/configure.js
  var COMPARISONS = Object.freeze(["difference", "correlation", "hazard"]);
  var METHODS3 = Object.freeze(["pearson", "spearman"]);
  var ADJUSTMENTS2 = Object.freeze(["BH", "holm"]);
  var SORTS = Object.freeze(["estimate", "name", "adjusted"]);
  var DEFAULT_SETTINGS5 = Object.freeze({
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
    // What the chart opens on: every biomarker, at one visit, with one value type.
    comparison: "difference",
    visit: null,
    value_type: "raw",
    // A difference: the column of groups, and the two groups, first minus second.
    group_by: null,
    levels: null,
    // A correlation: the variable every biomarker is correlated with.
    with: null,
    method: "pearson",
    // A hazard ratio: the outcomes table's columns, read either way round, and
    // the endpoint the rows are of. Each biomarker is cut at its median, high
    // against low, as R's Analyze_Screen cuts it.
    outcome_id_col: OUTCOME_DEFAULTS.outcome_id_col,
    endpoint_col: OUTCOME_DEFAULTS.endpoint_col,
    endpoint_label_col: OUTCOME_DEFAULTS.endpoint_label_col,
    time_col: OUTCOME_DEFAULTS.time_col,
    censor_col: OUTCOME_DEFAULTS.censor_col,
    event_col: OUTCOME_DEFAULTS.event_col,
    endpoint: OUTCOME_DEFAULTS.endpoint,
    // Across the rows.
    adjustment: "BH",
    sort: "estimate",
    // The most rows on a page.
    limit: 20,
    // The page of rows it opens on, from 0 (#71 review).
    page: 0,
    // What the controls offer.
    measures: null,
    groups: null,
    numbers: null,
    max_levels: 12,
    filters: null,
    // The statistics.
    connection: null,
    statistic: "Analyze_Screen",
    waiting_note: null,
    // The charts a row opens, and settings laid under what the screen carries across.
    group_comparison: null,
    association_scatter: null,
    stratified_survival: null,
    // The title, subtitle and footnotes, with placeholders (src/shared/titles.js).
    ...TITLE_DEFAULTS,
    // The downloads under the chart, and the PNG's resolution (src/shared/png.js).
    ...DOWNLOAD_DEFAULTS
  });
  function syncSettings4(overrides) {
    const settings = layOver(DEFAULT_SETTINGS5, flaggedSettings(overrides), "the biomarker screen");
    checkShared(settings, BASELINE_STATS);
    checkOutcomeSettings(settings);
    for (const key of ["visit_order_col", "unit_col", "participant_id_col", "group_by"]) {
      columnOrNull(settings, key);
    }
    if (settings.visit !== null && !isText4(settings.visit)) {
      refuse6("`visit` must be the name of a visit, or null.");
    }
    if (!COMPARISONS.includes(settings.comparison)) {
      refuse6(`\`comparison\` must be one of ${COMPARISONS.join(", ")}.`);
    }
    if (!VALUE_TYPES.includes(settings.value_type)) {
      refuse6(`\`value_type\` must be one of ${VALUE_TYPES.join(", ")}.`);
    }
    if (!METHODS3.includes(settings.method)) {
      refuse6(`\`method\` must be one of ${METHODS3.join(", ")}.`);
    }
    if (!ADJUSTMENTS2.includes(settings.adjustment)) {
      refuse6(`\`adjustment\` must be one of ${ADJUSTMENTS2.join(", ")}.`);
    }
    if (!SORTS.includes(settings.sort)) refuse6(`\`sort\` must be one of ${SORTS.join(", ")}.`);
    if (!Number.isInteger(settings.page) || settings.page < 0) {
      refuse6("`page` must be a whole number, from 0: the page of rows it opens on.");
    }
    if (!Number.isInteger(settings.limit) || settings.limit < 1) {
      refuse6("`limit` must be a whole number, one or more.");
    }
    if (!Number.isInteger(settings.max_levels) || settings.max_levels < 1) {
      refuse6("`max_levels` must be a whole number, one or more.");
    }
    if (settings.statistic !== null && !isText4(settings.statistic)) {
      refuse6("`statistic` must be the name of an R function, or null for no statistics.");
    }
    for (const key of ["group_comparison", "association_scatter", "stratified_survival"]) {
      if (settings[key] !== null && !isPlainObject4(settings[key])) {
        refuse6(`\`${key}\` must be an object of settings for the chart a row opens, or null.`);
      }
    }
    settings.levels = textList2(settings.levels, "levels");
    if (settings.levels && settings.levels.length !== 2) {
      refuse6("`levels` must name two groups, the first and the second, or be null.");
    }
    settings.with = variableSetting(settings.with, "with");
    settings.baseline_visits = textList2(settings.baseline_visits, "baseline_visits");
    settings.measures = textList2(settings.measures, "measures");
    settings.groups = fieldList(settings.groups, "groups");
    settings.numbers = fieldList(settings.numbers, "numbers");
    settings.filters = fieldList(settings.filters, "filters");
    return settings;
  }

  // src/cross-tab/configure.js
  var configure_exports5 = {};
  __export(configure_exports5, {
    DEFAULT_SETTINGS: () => DEFAULT_SETTINGS6,
    PERCENTS: () => PERCENTS,
    TESTS: () => TESTS2,
    syncSettings: () => syncSettings5
  });
  var PERCENTS = Object.freeze(["row", "col", "none"]);
  var TESTS2 = Object.freeze(["chisq", "fisher", "none"]);
  var DEFAULT_SETTINGS6 = Object.freeze({
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
    // What the chart opens on: the table's two variables, each a column or a cut
    // variable, and what the percentages are of.
    row_by: null,
    col_by: null,
    percent: "row",
    // Cut variables the Rows and Columns controls offer beside the columns.
    cuts: null,
    // What the controls offer.
    measures: null,
    groups: null,
    max_levels: 12,
    filters: null,
    // The listing of participants.
    details: null,
    page_size: 10,
    // The statistics line.
    connection: null,
    statistic: "Analyze_Contingency",
    test: "chisq",
    waiting_note: null,
    // A way back, when another chart opened this one in its place.
    back: null,
    // safety.viz's participant profile.
    profile: true,
    profile_details: null,
    studyday_col: null,
    normal_col_high: null,
    normal_col_low: null,
    // The title, subtitle and footnotes, with placeholders (src/shared/titles.js).
    ...TITLE_DEFAULTS,
    // The downloads under the chart, and the PNG's resolution (src/shared/png.js).
    ...DOWNLOAD_DEFAULTS
  });
  function syncSettings5(overrides) {
    const settings = layOver(DEFAULT_SETTINGS6, overrides, "the cross-tabulation");
    checkShared(settings, BASELINE_STATS);
    checkBack(settings);
    for (const key of [
      "visit_order_col",
      "unit_col",
      "participant_id_col",
      "studyday_col",
      "normal_col_high",
      "normal_col_low"
    ]) {
      columnOrNull(settings, key);
    }
    for (const key of ["row_by", "col_by"]) {
      if (isCut(settings[key])) checkGrouping(settings, key);
      else columnOrNull(settings, key);
    }
    if (settings.cuts !== null) {
      if (!Array.isArray(settings.cuts)) refuse6("`cuts` must be a list of cut variables, or null.");
      settings.cuts = settings.cuts.map((spec, index) => {
        const holder = { [`cuts[${index}]`]: spec };
        if (!isCut(spec)) {
          refuse6(
            `\`cuts[${index}]\` must be a cut variable: { measure, visit, cut } or { col, type: 'number', cut }.`
          );
        }
        checkGrouping(holder, `cuts[${index}]`);
        return holder[`cuts[${index}]`];
      });
    }
    if (!PERCENTS.includes(settings.percent)) {
      refuse6(`\`percent\` must be one of ${PERCENTS.join(", ")}.`);
    }
    if (!TESTS2.includes(settings.test)) refuse6(`\`test\` must be one of ${TESTS2.join(", ")}.`);
    for (const key of ["page_size", "max_levels"]) {
      if (!Number.isInteger(settings[key]) || settings[key] < 1) {
        refuse6(`\`${key}\` must be a whole number, one or more.`);
      }
    }
    if (settings.statistic !== null && !isText4(settings.statistic)) {
      refuse6("`statistic` must be the name of an R function, or null for no statistics line.");
    }
    settings.baseline_visits = textList2(settings.baseline_visits, "baseline_visits");
    settings.measures = textList2(settings.measures, "measures");
    settings.groups = fieldList(settings.groups, "groups");
    settings.filters = fieldList(settings.filters, "filters");
    settings.details = fieldList(settings.details, "details");
    settings.profile_details = fieldList(settings.profile_details, "profile_details");
    return settings;
  }

  // src/stratified-survival/configure.js
  var configure_exports6 = {};
  __export(configure_exports6, {
    DEFAULT_SETTINGS: () => DEFAULT_SETTINGS7,
    flagOf: () => flagOf,
    syncSettings: () => syncSettings6
  });
  var DEFAULT_SETTINGS7 = Object.freeze({
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
    // Columns of the outcomes table: one row per participant and endpoint, with
    // the time and a flag, either way round: censored (ADaM's CNSR, 1 =
    // censored) or an event (1 = event). Exactly one of the two is named. And
    // the endpoint the chart opens on: null means the first.
    outcome_id_col: OUTCOME_DEFAULTS.outcome_id_col,
    endpoint_col: OUTCOME_DEFAULTS.endpoint_col,
    endpoint_label_col: OUTCOME_DEFAULTS.endpoint_label_col,
    time_col: OUTCOME_DEFAULTS.time_col,
    censor_col: OUTCOME_DEFAULTS.censor_col,
    event_col: OUTCOME_DEFAULTS.event_col,
    endpoint: OUTCOME_DEFAULTS.endpoint,
    // The groups, a column or a cut variable. Null means the first category column.
    group_by: null,
    // Cut variables the Group control offers beside the columns.
    cuts: null,
    // The times the at-risk strip counts at. Null means the axis's ticks.
    at_risk_times: null,
    // What the controls offer.
    measures: null,
    groups: null,
    max_levels: 12,
    filters: null,
    // The listing of participants.
    details: null,
    page_size: 10,
    // The statistics line.
    connection: null,
    statistic: "Analyze_Survival",
    waiting_note: null,
    // A way back, when another chart opened this one in its place.
    back: null,
    // safety.viz's participant profile.
    profile: true,
    profile_details: null,
    studyday_col: null,
    normal_col_high: null,
    normal_col_low: null,
    // The title, subtitle and footnotes, with placeholders (src/shared/titles.js).
    ...TITLE_DEFAULTS,
    // The downloads under the chart, and the PNG's resolution (src/shared/png.js).
    ...DOWNLOAD_DEFAULTS
  });
  function syncSettings6(overrides) {
    const settings = layOver(
      DEFAULT_SETTINGS7,
      flaggedSettings(overrides),
      "the stratified survival chart"
    );
    checkShared(settings, BASELINE_STATS);
    checkBack(settings);
    checkOutcomeSettings(settings);
    for (const key of [
      "visit_order_col",
      "unit_col",
      "participant_id_col",
      "studyday_col",
      "normal_col_high",
      "normal_col_low"
    ]) {
      columnOrNull(settings, key);
    }
    if (isCut(settings.group_by)) checkGrouping(settings, "group_by");
    else columnOrNull(settings, "group_by");
    if (settings.cuts !== null) {
      if (!Array.isArray(settings.cuts)) refuse6("`cuts` must be a list of cut variables, or null.");
      settings.cuts = settings.cuts.map((spec, index) => {
        const holder = { [`cuts[${index}]`]: spec };
        if (!isCut(spec)) {
          refuse6(
            `\`cuts[${index}]\` must be a cut variable: { measure, visit, cut } or { col, type: 'number', cut }.`
          );
        }
        checkGrouping(holder, `cuts[${index}]`);
        return holder[`cuts[${index}]`];
      });
    }
    if (settings.at_risk_times !== null) {
      const times = settings.at_risk_times;
      if (!Array.isArray(times) || !times.length || !times.every((time) => typeof time === "number" && Number.isFinite(time) && time >= 0) || times.some((time, index) => index > 0 && !(time > times[index - 1]))) {
        refuse6("`at_risk_times` must be a list of times, none below 0, in ascending order, or null.");
      }
      settings.at_risk_times = [...times];
    }
    for (const key of ["page_size", "max_levels"]) {
      if (!Number.isInteger(settings[key]) || settings[key] < 1) {
        refuse6(`\`${key}\` must be a whole number, one or more.`);
      }
    }
    if (settings.statistic !== null && !isText4(settings.statistic)) {
      refuse6("`statistic` must be the name of an R function, or null for no statistics line.");
    }
    settings.baseline_visits = textList2(settings.baseline_visits, "baseline_visits");
    settings.measures = textList2(settings.measures, "measures");
    settings.groups = fieldList(settings.groups, "groups");
    settings.filters = fieldList(settings.filters, "filters");
    settings.details = fieldList(settings.details, "details");
    settings.profile_details = fieldList(settings.profile_details, "profile_details");
    return settings;
  }

  // src/shared/png.js
  var PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
  var crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let crc = 4294967295;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
    return (crc ^ 4294967295) >>> 0;
  }
  var utf8 = (text2) => new TextEncoder().encode(text2);
  function chunk(type, data) {
    const body = new Uint8Array(4 + data.length);
    body.set(utf8(type), 0);
    body.set(data, 4);
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(body, 4);
    view.setUint32(8 + data.length, crc32(body));
    return out;
  }
  function itxt(keyword, text2) {
    const head = utf8(keyword);
    const value = utf8(text2);
    const data = new Uint8Array(head.length + 5 + value.length);
    data.set(head, 0);
    data.set([0, 0, 0, 0, 0], head.length);
    data.set(value, head.length + 5);
    return chunk("iTXt", data);
  }
  function phys(perMetre) {
    const data = new Uint8Array(9);
    const view = new DataView(data.buffer);
    view.setUint32(0, perMetre);
    view.setUint32(4, perMetre);
    data[8] = 1;
    return chunk("pHYs", data);
  }
  var CSS_PIXELS_PER_INCH = 96;
  function pngChunks(png, { scale, text: text2 }) {
    for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
      if (png[i] !== PNG_SIGNATURE[i]) throw new Error("bio.viz: not a PNG.");
    }
    const afterHeader = 8 + 25;
    const extra = [
      phys(Math.round(scale * CSS_PIXELS_PER_INCH / 0.0254)),
      ...Object.entries(text2).filter(([, value]) => typeof value === "string" && value !== "").map(([keyword, value]) => itxt(keyword, value))
    ];
    const size = extra.reduce((total, part) => total + part.length, png.length);
    const out = new Uint8Array(size);
    out.set(png.subarray(0, afterHeader), 0);
    let at = afterHeader;
    for (const part of extra) {
      out.set(part, at);
      at += part.length;
    }
    out.set(png.subarray(afterHeader), at);
    return out;
  }
  var HEIGHTS = /* @__PURE__ */ new Set(["height", "block-size", "max-height", "max-block-size"]);
  var OVERFLOWS = /* @__PURE__ */ new Set([
    "overflow",
    "overflow-x",
    "overflow-y",
    "overflow-block",
    "overflow-inline"
  ]);
  var holdsText = (element) => /\S/.test(element.textContent || "");
  function copyStyles(from, to) {
    const style = getComputedStyle(from);
    const reflow = from.tagName !== "CANVAS" && from.tagName !== "IMG" && holdsText(from);
    let text2 = "";
    for (let i = 0; i < style.length; i += 1) {
      const name = style[i];
      if (reflow && HEIGHTS.has(name)) continue;
      if (OVERFLOWS.has(name)) continue;
      text2 += `${name}:${style.getPropertyValue(name)};`;
    }
    to.setAttribute("style", `${text2}overflow:visible;`);
  }
  function copyTree(from, to) {
    if (from.nodeType !== 1) return;
    copyStyles(from, to);
    if (from.tagName === "CANVAS") return;
    const a = from.children;
    const b = to.children;
    for (let i = 0; i < a.length; i += 1) copyTree(a[i], b[i]);
  }
  async function drawFrame(frame2, { leaveOut, scale, text: text2 }) {
    const copy2 = frame2.cloneNode(true);
    copyTree(frame2, copy2);
    const canvases = frame2.querySelectorAll("canvas");
    const copies = copy2.querySelectorAll("canvas");
    canvases.forEach((canvas2, i) => {
      const picture = document.createElement("img");
      picture.setAttribute("style", copies[i].getAttribute("style") || "");
      picture.width = canvas2.clientWidth;
      picture.height = canvas2.clientHeight;
      picture.src = canvas2.width && canvas2.height ? canvas2.toDataURL("image/png") : "";
      copies[i].replaceWith(picture);
    });
    const all = [...frame2.querySelectorAll("*")];
    const copied = [...copy2.querySelectorAll("*")];
    const dropped = all.map((element, i) => element.tagName !== "CANVAS" && leaveOut(element) ? copied[i] : null).filter(Boolean);
    dropped.forEach((element) => element.remove());
    copy2.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
    const width = Math.ceil(frame2.getBoundingClientRect().width);
    copy2.style.width = `${width}px`;
    copy2.style.height = "auto";
    copy2.style.minHeight = "0";
    copy2.style.margin = "0";
    copy2.style.background = "#ffffff";
    const holder = document.createElement("div");
    holder.setAttribute(
      "style",
      `position:absolute;left:-100000px;top:0;width:${width}px;background:#fff`
    );
    holder.append(copy2);
    document.body.append(holder);
    await Promise.all(
      [...copy2.querySelectorAll("img")].map(
        (picture) => picture.complete ? null : new Promise((done) => picture.onload = picture.onerror = done)
      )
    );
    const height = Math.ceil(copy2.getBoundingClientRect().height);
    const holderBox = holder.getBoundingClientRect();
    let right = width;
    for (const element of copy2.querySelectorAll("*")) {
      const box = element.getBoundingClientRect();
      if (box.width && box.height) right = Math.max(right, Math.ceil(box.right - holderBox.left));
    }
    const drawnWidth = right;
    holder.remove();
    const markup = new XMLSerializer().serializeToString(copy2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${drawnWidth}" height="${height}"><foreignObject x="0" y="0" width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;background:#fff">${markup}</div></foreignObject></svg>`;
    const image = new Image();
    await new Promise((done, fail) => {
      image.onload = done;
      image.onerror = () => fail(
        new Error("bio.viz: the chart could not be drawn as a picture, as the browser read it.")
      );
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(drawnWidth * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, drawnWidth, height);
    const written = await new Promise((done, fail) => {
      try {
        canvas.toBlob(
          (blob) => blob ? done(blob) : fail(
            new Error(
              "bio.viz: the picture could not be written, which a browser does when it is too large. Try a smaller png_scale."
            )
          ),
          "image/png"
        );
      } catch (error) {
        fail(new Error(`bio.viz: the picture could not be read back (${error.message}).`));
      }
    });
    const bytes = pngChunks(new Uint8Array(await written.arrayBuffer()), { scale, text: text2 });
    return {
      blob: new Blob([bytes], { type: "image/png" }),
      width: canvas.width,
      height: canvas.height
    };
  }

  // src/shared/specification.js
  var SPECIFICATION_FORMAT = "bio.viz specification";
  var SPECIFICATION_VERSION = 1;
  var FILTER_OPERATORS = Object.freeze(["in"]);
  var PAGE_SETTINGS = Object.freeze(["connection", "back"]);
  var NO_COLUMN = Object.freeze(["__proto__", "constructor", "prototype"]);
  var MOST_NESTED = 64;
  var refuse7 = (message) => {
    throw new TypeError(`bio.viz: ${message}`);
  };
  var isPlainObject5 = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  var isText5 = (value) => typeof value === "string" && value.trim() !== "";
  function notData(value, where) {
    if (value === null || typeof value === "boolean" || typeof value === "string") return null;
    if (typeof value === "number") {
      return Number.isFinite(value) ? null : `${where} is ${String(value)}, which is not a number JSON holds`;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        const found = notData(value[i], `${where}[${i}]`);
        if (found) return found;
      }
      return null;
    }
    if (isPlainObject5(value)) {
      for (const [key, entry] of Object.entries(value)) {
        const found = notData(entry, `${where}.${key}`);
        if (found) return found;
      }
      return null;
    }
    const kind = typeof value === "function" ? "a function" : value === void 0 ? "undefined" : `a ${typeof value === "object" ? value.constructor?.name || "object" : typeof value}`;
    return `${where} is ${kind}, which is not data: a specification holds only text, numbers, true, false, null, lists and objects`;
  }
  var copy = (value) => JSON.parse(JSON.stringify(value));
  function snapshot(value, where = "the specification", depth = 0) {
    if (value === null || typeof value !== "object") return value;
    if (depth > MOST_NESTED) {
      refuse7(
        `the specification is nested more than ${MOST_NESTED} deep, which no chart\u2019s settings are.`
      );
    }
    const array = Array.isArray(value);
    if (!array && !isPlainObject5(value)) {
      const problem = notData(value, where);
      if (problem) refuse7(`${problem}.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const read2 = (key, descriptor, at) => {
      if ("get" in descriptor || "set" in descriptor) {
        refuse7(
          `${at} is a getter or a setter, which is not data: a specification holds only text, numbers, true, false, null, lists and objects.`
        );
      }
      return snapshot(descriptor.value, at, depth + 1);
    };
    if (array) {
      const length = descriptors.length ? descriptors.length.value : 0;
      const out2 = [];
      for (let i = 0; i < length; i += 1) {
        const descriptor = descriptors[i];
        out2.push(descriptor ? read2(i, descriptor, `${where}[${i}]`) : void 0);
      }
      return out2;
    }
    const out = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable) continue;
      Object.defineProperty(out, key, {
        value: read2(key, descriptor, `${where}.${key}`),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    return out;
  }
  function writeSpecification({ chart, version: version2, settings, filters = [] }) {
    const written = {};
    for (const [key, value] of Object.entries(settings)) {
      if (PAGE_SETTINGS.includes(key) || notData(value, key)) continue;
      written[key] = copy(value);
    }
    return {
      format: SPECIFICATION_FORMAT,
      format_version: SPECIFICATION_VERSION,
      bio_viz_version: version2,
      chart,
      settings: written,
      filters: filters.map(({ column, values }) => ({
        column,
        operator: "in",
        values: values.map((entry) => typeof entry === "number" ? entry : String(entry))
      }))
    };
  }
  function readSpecification(specification, charts) {
    let spec = specification;
    if (typeof spec !== "string") spec = snapshot(spec);
    if (typeof spec === "string") {
      try {
        spec = JSON.parse(spec);
      } catch (error) {
        refuse7(`a specification given as text must be JSON: ${error.message}.`);
      }
    }
    if (!isPlainObject5(spec))
      refuse7("a specification is an object: { format, chart, settings, filters }.");
    const problem = notData(spec, "the specification");
    if (problem) refuse7(`${problem}.`);
    if (spec.format !== SPECIFICATION_FORMAT) {
      refuse7(
        `this is not a bio.viz specification: its \`format\` must be "${SPECIFICATION_FORMAT}".`
      );
    }
    if (spec.format_version !== SPECIFICATION_VERSION) {
      refuse7(
        `this specification is of format version ${JSON.stringify(spec.format_version)}, and this version of bio.viz reads version ${SPECIFICATION_VERSION}.`
      );
    }
    const known = ["format", "format_version", "bio_viz_version", "chart", "settings", "filters"];
    const extra = Object.keys(spec).filter((key) => !known.includes(key));
    if (extra.length) {
      refuse7(`a specification has no \`${extra[0]}\`: it holds ${known.join(", ")}.`);
    }
    if (!isText5(spec.bio_viz_version)) {
      refuse7("a specification\u2019s `bio_viz_version` is text, the version that wrote it.");
    }
    if (!isText5(spec.chart) || !Object.prototype.hasOwnProperty.call(charts, spec.chart)) {
      refuse7(
        `this specification names the chart ${JSON.stringify(spec.chart)}, which bio.viz does not have. Its charts are ${Object.keys(charts).join(", ")}.`
      );
    }
    const defaults = charts[spec.chart];
    const settings = spec.settings === void 0 ? {} : spec.settings;
    if (!isPlainObject5(settings)) refuse7("a specification\u2019s `settings` is an object of settings.");
    const unknown = Object.keys(settings).filter(
      (key) => !Object.prototype.hasOwnProperty.call(defaults, key) || PAGE_SETTINGS.includes(key)
    );
    if (unknown.length) {
      const names = unknown.map((key) => `\`${key}\``).join(", ");
      refuse7(
        `this specification of the ${spec.chart} chart${isText5(spec.bio_viz_version) ? `, written by bio.viz ${spec.bio_viz_version},` : ""} holds ${names}, which ${unknown.length === 1 ? "is not a setting" : "are not settings"} of that chart in this version.`
      );
    }
    if ("filters" in settings && settings.filters !== null && !Array.isArray(settings.filters)) {
      refuse7("the setting `filters` of a specification is a list of filters, or null.");
    }
    for (const [key, value] of Object.entries(settings)) {
      if (typeof value === "string" && NO_COLUMN.includes(value)) {
        refuse7(`\`${key}\` names \`${value}\`, which is no column\u2019s name.`);
      }
    }
    const filters = spec.filters === void 0 ? [] : spec.filters;
    if (!Array.isArray(filters))
      refuse7("a specification\u2019s `filters` is a list of { column, operator, values }.");
    const read2 = copy(settings);
    filters.forEach((filter, index) => {
      const where = `filter ${index + 1}`;
      if (!isPlainObject5(filter)) refuse7(`${where} must be { column, operator, values }.`);
      const keys = Object.keys(filter).filter(
        (key) => !["column", "operator", "values"].includes(key)
      );
      if (keys.length)
        refuse7(`${where} has \`${keys[0]}\`: a filter is { column, operator, values }.`);
      if (!isText5(filter.column)) refuse7(`${where} must name its column.`);
      if (NO_COLUMN.includes(filter.column)) {
        refuse7(`${where} is on \`${filter.column}\`, which is no column\u2019s name.`);
      }
      const before = filters.findIndex((other) => other && other.column === filter.column);
      if (before < index) {
        refuse7(
          `${where} is on ${filter.column}, which filter ${before + 1} is already on: a column is filtered once.`
        );
      }
      if (!FILTER_OPERATORS.includes(filter.operator)) {
        refuse7(
          `${where}, on ${filter.column}, has the operator ${JSON.stringify(filter.operator)}; the operators are ${FILTER_OPERATORS.map((entry) => `"${entry}"`).join(", ")}: in, the values it lets through.`
        );
      }
      if (!Array.isArray(filter.values) || !filter.values.every((value) => typeof value === "string" || typeof value === "number")) {
        refuse7(
          `${where}, on ${filter.column}, must list the values it lets through: text or numbers.`
        );
      }
      const twice = filter.values.map(String).find((value, at2, all) => all.indexOf(value) !== at2);
      if (twice !== void 0) {
        refuse7(`${where}, on ${filter.column}, names ${twice} twice: a value is listed once.`);
      }
      const specs = Array.isArray(read2.filters) ? read2.filters : read2.filters ? [read2.filters] : [];
      const at = specs.findIndex(
        (entry) => typeof entry === "string" ? entry === filter.column : entry && entry.value_col === filter.column
      );
      const values = filter.values.map(String);
      const started = {
        ...at >= 0 && typeof specs[at] === "object" ? specs[at] : { value_col: filter.column },
        start: values.length === 1 ? values[0] : values,
        ...values.length !== 1 ? { multiple: true } : {}
      };
      if (at >= 0) specs[at] = started;
      else specs.push(started);
      read2.filters = specs;
    });
    return {
      chart: spec.chart,
      settings: read2,
      version: spec.bio_viz_version,
      filters: filters.map(({ column, values }) => ({ column, values: values.map(String) }))
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
  var ownTable = (table) => `
${table}{box-sizing:border-box;width:auto;margin:0;background:none;font-family:inherit;font-size:inherit;line-height:normal}
${table} caption,${table} th,${table} td{box-sizing:content-box}
${table} th,${table} td{border:0;padding:1px;background:none;color:inherit;font-family:inherit;font-size:inherit;letter-spacing:normal;text-transform:none;vertical-align:inherit}
${table} th{font-weight:700;text-align:center}
${table} td{text-align:inherit}`;
  var ownHeading = (heading, weight = 700) => `${heading}{box-sizing:content-box;font-family:inherit;font-weight:${weight};line-height:normal}`;
  var lineStyles = (root) => `
${root} .bv-statistic{margin:.6rem 0 0;font-size:.85rem;color:#1f2933;max-width:100%}
${root} .bv-statistic:empty{display:none}
${root} .bv-statistic p{margin:0 0 .3rem}
${root} .bv-statistic[data-state=waiting],${root} .bv-statistic[data-state=none]{color:#52616f;font-style:italic}
${root} .bv-stat-remark,${root} .bv-stat-scope{font-size:.8rem;color:#52616f}
${root} .bv-stat-remark[data-kind=warning]{color:#8a4b00}
${ownTable(`${root} .bv-stat-pairs`)}
${root} .bv-stat-pairs{border-collapse:collapse;margin:.2rem 0 .5rem;font-size:.8rem;width:100%;max-width:36rem}
${root} .bv-stat-pairs caption{text-align:left;padding:0 0 .25rem;caption-side:top}
${root} .bv-stat-pairs th,${root} .bv-stat-pairs td{text-align:left;font-weight:400;padding:.2rem .6rem .2rem 0;border-top:1px solid #d9dee3;vertical-align:top;overflow-wrap:anywhere}
${root} .bv-stat-pairs thead th{font-weight:600;border-top:0}
${root} .bv-stat-pairs td:nth-child(2){white-space:nowrap}
${root} .bv-stat-method{display:block;color:#52616f}
${ownHeading(`${root} .bv-panel h3`)}
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
${root} .bv-downloads button:focus-visible{outline:2px solid #0b62a4;outline-offset:1px}
${root} .bv-notices{margin:0 0 .6rem;padding:.4rem .6rem;border-left:3px solid #d97706;background:#fff8eb;font-size:.8rem;color:#5c3b00}
${root} .bv-notices:empty{display:none}
${root} .bv-download-error{flex-basis:100%;margin:.2rem 0 0;color:#9b1c1c;font-weight:600}`;
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
    chart.footnote.classList.add("bv-no-picture");
    chart.listingWrap.classList.add("bv-no-picture");
    chart.titleBlock = kit.createElement("div", "bv-titles");
    chart.main.prepend(chart.titleBlock);
    chart.notices = [];
    chart.noticeBlock = kit.createElement("div", "bv-notices bv-no-picture");
    chart.noticeBlock.setAttribute("role", "status");
    chart.titleBlock.after(chart.noticeBlock);
    chart.footBlock = kit.createElement("div", "bv-foot");
    chart.listingWrap.before(chart.footBlock);
    chart.module = moduleClass.replace(/^bv-/, "");
    mountDownloads(chart);
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
  function checkTables(tables, settings) {
    for (const key of ["id_col", "measure_col", "value_col", "visit_col"]) {
      const column = settings[key];
      if (tables.results.length && !tables.results.some((row) => column in row)) {
        throw new TypeError(`bio.viz: the results table has no column \`${column}\` (\`${key}\`).`);
      }
    }
    const participantIdCol = settings.participant_id_col || settings.id_col;
    if (tables.participants != null && tables.participants.length && !tables.participants.some((row) => participantIdCol in row)) {
      throw new TypeError(
        `bio.viz: the participant table has no column \`${participantIdCol}\`, which names the participant (\`participant_id_col\`, or \`id_col\` when that is not set).`
      );
    }
    if (!tables.results.length) return;
    const cuts = GROUPINGS.map((key) => [key, settings[key]]);
    (Array.isArray(settings.cuts) ? settings.cuts : []).forEach(
      (spec, index) => cuts.push([`cuts[${index}]`, spec])
    );
    for (const [key, spec] of cuts) {
      if (!spec || typeof spec !== "object" || Array.isArray(spec)) continue;
      if (typeof spec.measure === "string") {
        if (!tables.results.some((row) => row[settings.measure_col] === spec.measure)) {
          throw new TypeError(
            `bio.viz: \`${key}\` cuts the biomarker ${spec.measure}, which the results table does not have.`
          );
        }
      } else if (typeof spec.col === "string") {
        const has = (rows) => Boolean(rows) && rows.some((row) => spec.col in row);
        if (!has(tables.results) && !has(tables.participants)) {
          throw new TypeError(
            `bio.viz: \`${key}\` cuts the column ${spec.col}, which neither the results table nor the participant table has.`
          );
        }
      }
    }
  }
  var GROUPINGS = ["group_by", "panel_by", "row_by", "col_by"];
  function readGiven(chart, data, settings = chart.settings) {
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
      checkTables(tables, settings);
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
  function readOutcomesGiven(chart, outcomes, settings) {
    if (outcomes === void 0 || outcomes === null) return null;
    try {
      if (!isRecordTable(outcomes)) {
        throw new TypeError("bio.viz: `outcomes` must be an array of records, one object per row.");
      }
      checkOutcomes(outcomes, settings);
    } catch (error) {
      chart.destroyCharts();
      chart.element.innerHTML = "";
      chart.element.append(chart.kit.createElement("div", "sv-warning", error.message));
      throw error;
    }
    return outcomes.length ? outcomes : null;
  }
  function drawSafely(chart, draw) {
    chart.footnote.classList.remove("bv-failure");
    try {
      draw();
      writeTitles(chart);
    } catch (error) {
      if (chart.desk) chart.desk.begin();
      chart.asked = [];
      chart.model = null;
      if ("answer" in chart) chart.answer = null;
      chart.destroyCharts();
      clearListing(chart);
      for (const wrap of [
        chart.notes,
        chart.multiplesWrap,
        chart.listingWrap,
        chart.gridWrap,
        chart.screenWrap
      ]) {
        if (wrap) wrap.innerHTML = "";
      }
      if (chart.chartWrap) chart.chartWrap.classList.add("sv-hidden");
      chart.statLine.textContent = "";
      chart.statLine.dataset.state = "empty";
      const message = String(error && error.message || error).replace(/^bio\.viz: /, "");
      chart.footnote.textContent = `This chart could not be drawn: ${message}`;
      chart.footnote.classList.add("bv-failure");
      console.error(error);
      writeTitles(chart);
    }
  }
  function sharedPlaceholders(chart) {
    const filters = chart.filterSpecs && chart.state && chart.state.filters ? filtersForScope(chart) : [];
    return {
      date: dateDrawn(),
      version: VERSION_SAID,
      filters: filters.length ? filters.map(({ label: label2, values }) => `${label2} is ${values.join(" or ")}`).join("; ") : "none"
    };
  }
  function placeholderValues(chart) {
    let own = {};
    try {
      own = typeof chart.placeholders === "function" ? chart.placeholders() || {} : {};
    } catch (error) {
      console.error("bio.viz: the chart\u2019s placeholders could not be read.", error);
      own = {};
    }
    return { ...sharedPlaceholders(chart), ...own };
  }
  function titlesOf(chart) {
    const parts = partsOf2(chart);
    const joined = (runs) => runs === null ? null : runs.map((run) => run.text).join("");
    return {
      title: joined(parts.title),
      subtitle: joined(parts.subtitle),
      footnotes: parts.footnotes.map(joined)
    };
  }
  function partsOf2(chart) {
    const { settings } = chart;
    const values = placeholderValues(chart);
    const filled = (template) => typeof template !== "string" || template.trim() === "" ? null : fillParts(template, values);
    return {
      title: filled(settings.title),
      subtitle: filled(settings.subtitle),
      footnotes: [
        ...(settings.footnotes || []).map(filled).filter(Boolean),
        [
          {
            text: automaticFootnote({
              date: values.date,
              version: VERSION_SAID,
              asked: chart.asked || [],
              of: chart.footnoteCounts
            }),
            value: false
          }
        ]
      ]
    };
  }
  function writeRuns(kit, element, runs) {
    for (const run of runs) {
      if (run.value) {
        const isolated = document.createElement("bdi");
        isolated.textContent = run.text;
        element.append(isolated);
      } else element.append(document.createTextNode(run.text));
    }
  }
  function writeTitles(chart) {
    if (!chart.titleBlock || !chart.footBlock) return;
    const { kit } = chart;
    const said2 = partsOf2(chart);
    chart.titleBlock.innerHTML = "";
    if (said2.title !== null) {
      const title = kit.createElement("div", "bv-title");
      title.setAttribute("role", "heading");
      title.setAttribute("aria-level", "2");
      writeRuns(kit, title, said2.title);
      chart.titleBlock.append(title);
    }
    if (said2.subtitle !== null) {
      const subtitle = kit.createElement("p", "bv-subtitle");
      writeRuns(kit, subtitle, said2.subtitle);
      chart.titleBlock.append(subtitle);
    }
    chart.footBlock.innerHTML = "";
    said2.footnotes.forEach((runs, index) => {
      const line = kit.createElement("p", "bv-foot-line");
      writeRuns(kit, line, runs);
      if (index === said2.footnotes.length - 1) line.dataset.automatic = "true";
      chart.footBlock.append(line);
    });
    syncDownloads(chart);
    writeNotices(chart);
  }
  var SETTING_NAMES = Object.freeze({
    row_by: "Rows",
    col_by: "Columns",
    group_by: "Groups",
    color_by: "Colour",
    panel_by: "Panels",
    start_value: "Biomarker",
    measure: "Biomarker",
    biomarkers: "Biomarkers",
    visit: "Visit",
    visits: "Visits",
    endpoint: "Endpoint",
    comparison: "Compare",
    x: "X axis",
    y: "Y axis",
    with: "With"
  });
  var said = (value) => typeof value === "string" ? value : Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value.join(", ") : JSON.stringify(value);
  function noticesOf(chart) {
    const { requested, settings } = chart;
    if (!requested) return [];
    const notices = [];
    const view = typeof chart.viewSettings === "function" ? chart.viewSettings() : {};
    for (const key of Object.keys(view)) {
      if (!Object.hasOwn(requested.settings, key)) continue;
      const asked = settings[key];
      if (asked === null || asked === void 0) continue;
      const drawn = view[key];
      if (JSON.stringify(asked) === JSON.stringify(drawn)) continue;
      const name = SETTING_NAMES[key] || `\`${key}\``;
      const own = typeof chart.noticeOf === "function" ? chart.noticeOf(key, asked, drawn) : null;
      notices.push({
        kind: "setting",
        name: key,
        asked,
        drawn,
        said: own || `${name}: ${said(asked)} is not in the tables, so the chart draws ${drawn === null || drawn === void 0 ? "none" : said(drawn)}.`
      });
    }
    const id = settings.participant_id_col || settings.id_col;
    for (const filter of requested.filters || []) {
      const spec = (chart.filterSpecs || []).find((entry) => entry.value_col === filter.column);
      if (!spec) {
        notices.push({
          kind: "filter",
          name: filter.column,
          asked: filter.values,
          drawn: null,
          said: filter.column === id ? `Filter ${filter.column}: the participant id is not a filter.` : `Filter ${filter.column}: the participant table has no such column, so it is not a filter.`
        });
        continue;
      }
      const now = (chart.state.filters || {})[filter.column];
      const drawn = now === null || now === void 0 || now === "" ? null : (Array.isArray(now) ? now : [now]).map(String);
      if (drawn !== null && JSON.stringify(drawn) === JSON.stringify(filter.values)) continue;
      const missing = filter.values.filter((value) => !(drawn || []).includes(value));
      notices.push({
        kind: "filter",
        name: filter.column,
        asked: filter.values,
        drawn,
        said: `Filter ${filter.column}: ${missing.join(", ")} ${missing.length === 1 ? "is not one of its values" : "are not among its values"}, so it is at ${drawn === null ? "All" : drawn.join(", ")}.`
      });
    }
    return notices;
  }
  function writeNotices(chart) {
    if (!chart.noticeBlock) return;
    if (chart.requested && !chart.noticed && chart.tables && chart.tables.results.length) {
      chart.noticed = true;
      chart.notices = noticesOf(chart);
    }
    chart.noticeBlock.textContent = chart.notices.length ? `Not drawn as the specification asks: ${chart.notices.map((notice) => notice.said).join(" ")}` : "";
  }
  var DOWNLOAD_LABELS = Object.freeze({
    png: "PNG",
    statistics: "Statistics (CSV)",
    table: "Table (CSV)"
  });
  var slug = (text2) => String(text2).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^(.{0,60})(?:-.*)?$/, (whole, kept) => whole.length <= 60 ? whole : kept).replace(/-+$/g, "");
  function downloadName(chart, kind) {
    const values = placeholderValues(chart);
    const view = (chart.viewFields || []).map((name) => values[name]).filter((value) => value !== null && value !== void 0 && String(value).trim() !== "").join(" ");
    const base = ["bio.viz", chart.module, slug(view)].filter(Boolean).join("-");
    return kind === "png" ? `${base}.png` : `${base}-${kind}.csv`;
  }
  async function downloadFile(chart, kind) {
    const name = downloadName(chart, kind);
    if (kind === "statistics") {
      const { columns, rows } = statisticsTable(chart.asked || []);
      return { name, blob: new Blob([toCsv(rows, columns)], { type: "text/csv;charset=utf-8" }) };
    }
    if (kind === "table") {
      const { columns, rows } = typeof chart.tableOf === "function" ? chart.tableOf() : { columns: [], rows: [] };
      return { name, blob: new Blob([toCsv(rows, columns)], { type: "text/csv;charset=utf-8" }) };
    }
    if (kind === "png") {
      const said2 = titlesOf(chart);
      const scale = chart.settings.png_scale;
      const charts = (chart.charts || []).filter(
        (made) => made && made.options && typeof made.resize === "function"
      );
      const ratios = charts.map((made) => made.options.devicePixelRatio);
      const sharpen = (ratio) => charts.forEach((made, i) => {
        made.options.devicePixelRatio = ratio === null ? ratios[i] : ratio;
        made.resize();
      });
      sharpen(Math.max(scale, globalThis.devicePixelRatio || 1));
      try {
        const { blob } = await drawFrame(chart.main, {
          scale,
          // What a reader works the chart with is marked to be left out.
          leaveOut: (element) => element.classList.contains("bv-no-picture"),
          text: {
            Title: [said2.title, said2.subtitle].filter(Boolean).join(" \u2014 "),
            Description: said2.footnotes.join("\n"),
            Software: `bio.viz ${VERSION_SAID}`
          }
        });
        return { name, blob };
      } finally {
        sharpen(null);
      }
    }
    throw new TypeError(
      `bio.viz: a download is \`png\`, \`statistics\` or \`table\`, not \`${kind}\`.`
    );
  }
  function mountDownloads(chart) {
    const { kit } = chart;
    chart.downloadBar = kit.createElement("div", "bv-downloads bv-no-picture");
    chart.downloadBar.append(kit.createElement("span", "bv-downloads-label", "Download:"));
    chart.downloadButtons = {};
    for (const [kind, label2] of Object.entries(DOWNLOAD_LABELS)) {
      const button = kit.createElement("button", null, label2);
      button.type = "button";
      button.dataset.download = kind;
      button.onclick = async () => {
        button.disabled = true;
        sayFailure(chart, null);
        try {
          const { name, blob } = await downloadFile(chart, kind);
          saveFile(blob, name);
        } catch (error) {
          sayFailure(
            chart,
            `The ${kind === "png" ? "PNG" : `${kind} file`} could not be made: ${String(error && error.message || error).replace(/^bio\.viz: /, "")}`
          );
          console.error(error);
        } finally {
          syncDownloads(chart);
        }
      };
      chart.downloadButtons[kind] = button;
      chart.downloadBar.append(button);
    }
    chart.footBlock.after(chart.downloadBar);
    chart.fileOf = (kind) => downloadFile(chart, kind);
  }
  function sayFailure(chart, said2) {
    const old = chart.downloadBar.querySelector(".bv-download-error");
    if (old) old.remove();
    if (!said2) return;
    const line = chart.kit.createElement("p", "bv-download-error", said2);
    line.setAttribute("role", "alert");
    chart.downloadBar.append(line);
  }
  function syncDownloads(chart) {
    if (!chart.downloadBar) return;
    chart.downloadBar.hidden = !chart.settings.downloads;
    const answered = (chart.asked || []).some(
      (entry) => entry.answer && entry.answer.status === "ok"
    );
    const table = typeof chart.tableOf === "function" ? chart.tableOf() : { rows: [] };
    const { png, statistics } = chart.downloadButtons;
    if (!(chart.asked || []).length) statistics.remove();
    else if (!statistics.isConnected) png.after(statistics);
    const waiting = (chart.asked || []).some((entry) => !entry.answer);
    statistics.disabled = !answered;
    statistics.title = answered ? "" : waiting ? "Waiting for R\u2019s answer." : "R returned no statistics for this view.";
    if (!statistics.title) statistics.removeAttribute("title");
    chart.downloadButtons.table.disabled = !table.rows.length;
    chart.downloadButtons.png.disabled = false;
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
    const drawn = chart.filterSpecs.filter((spec) => spec.value_col !== idCol);
    kit.reconcileFilters(
      state.filters,
      drawn,
      (spec) => [
        ...new Set(
          chart.tables.participants.map((row) => row[spec.value_col]).filter((entry) => entry !== void 0 && entry !== null && entry !== "").map(String)
        )
      ].sort((a, b) => a.localeCompare(b, void 0, { numeric: true }))
    ).forEach(({ spec, values, selected }) => {
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
      (said2) => line.append(kit.createElement("p", "bv-stat-estimate", said2))
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
    saveFile(new Blob([toCsv(rows, columns)], { type: "text/csv;charset=utf-8" }), file);
  }
  function saveFile(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
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
  function renderPager(kit, page, count, go) {
    const pager = kit.createElement("div", "bv-overview-pager");
    pager.append(kit.createElement("span", "bv-overview-count", count));
    if (page.pages === 1) return pager;
    const button = (label2, to, name) => {
      const made = kit.createElement("button", "bv-no-picture", label2);
      made.type = "button";
      made.dataset.go = name;
      made.disabled = to < 0 || to >= page.pages;
      made.onclick = () => go(to);
      return made;
    };
    pager.append(
      button("Previous", page.page - 1, "previous"),
      kit.createElement("span", "bv-overview-page", `Page ${page.page + 1} of ${page.pages}`),
      button("Next", page.page + 1, "next")
    );
    return pager;
  }
  function mountToolbar(chart) {
    const { kit, settings } = chart;
    if (!chart.toolbar) {
      chart.toolbar = kit.createElement("div", "bv-toolbar bv-no-picture");
      chart.notes.before(chart.toolbar);
    }
    chart.toolbar.innerHTML = "";
    if (settings.back) {
      const back = kit.createElement("button", "bv-back", settings.back.label);
      back.type = "button";
      back.onclick = () => settings.back.action(chart);
      chart.toolbar.append(back);
    }
    return chart.toolbar;
  }
  var toolbarStyles = (C5) => `${C5} .bv-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem .7rem;margin:0 0 .6rem}
${C5} .bv-toolbar:empty{display:none}
${C5} .bv-toolbar button{font:inherit;font-size:.85rem;padding:.35rem .75rem;border:1px solid #b8c0cc;border-radius:6px;background:#fff;color:#1f2933;cursor:pointer}
${C5} .bv-toolbar button[aria-pressed=true]{border-color:#0b62a4;background:#eaf2fb;color:#0b3d63;box-shadow:inset 0 0 0 1px #0b62a4}
${C5} .bv-toolbar button:focus-visible{outline:2px solid #0b62a4;outline-offset:1px}`;
  function specificationOf(chart) {
    const settings = {
      ...chart.settings,
      ...typeof chart.viewSettings === "function" ? chart.viewSettings() : {}
    };
    const specs = chart.filterSpecs || [];
    if (specs.length || settings.filters !== null) {
      settings.filters = specs.map((spec) => ({
        value_col: spec.value_col,
        label: spec.label,
        ...spec.all === false ? { all: false } : {},
        ...spec.multiple ? { multiple: true } : {}
      }));
    }
    const filters = specs.map((spec) => ({
      column: spec.value_col,
      selection: (chart.state.filters || {})[spec.value_col]
    })).filter(({ selection }) => selection !== null && selection !== void 0 && selection !== "").map(({ column, selection }) => ({
      column,
      values: (Array.isArray(selection) ? selection : [selection]).map(String)
    }));
    return writeSpecification({ chart: chart.module, version: VERSION, settings, filters });
  }
  function startFilters(chart) {
    const state = chart.kit.initFilterState(chart.filterSpecs);
    for (const spec of chart.settings.filters || []) {
      if (spec && spec.multiple && Array.isArray(spec.start) && !spec.start.length && Object.hasOwn(state, spec.value_col)) {
        state[spec.value_col] = [];
      }
    }
    return state;
  }
  function cutsOffered(options, drawn) {
    const written = new Set(drawn.map((entry) => JSON.stringify(entry)));
    const cuts = [];
    for (const { spec } of options || []) {
      const key = JSON.stringify(spec);
      if (written.has(key) || cuts.some((entry) => JSON.stringify(entry) === key)) continue;
      cuts.push(spec);
    }
    return cuts.length ? cuts : null;
  }

  // src/group-comparison/level.js
  var LEVELS = Object.freeze({
    BIOMARKERS: "biomarkers",
    OVER_TIME: "over-time",
    VISITS: "visits"
  });
  function hasOverTime(state, offered = []) {
    const { measure, valueType } = state || {};
    if (measure === null || measure === void 0) return false;
    return valueType !== "baseline" && offered.length > 1;
  }
  function levelOf(state, offered = []) {
    const { measure, visits: visits2 } = state || {};
    if (measure === null || measure === void 0) return LEVELS.BIOMARKERS;
    if (!hasOverTime(state, offered)) return LEVELS.VISITS;
    const chosen = new Set(visits2 || []);
    return offered.every((visit) => chosen.has(visit)) ? LEVELS.OVER_TIME : LEVELS.VISITS;
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
  function measureVisits(results, settings, measure) {
    const config = coreSettings(settings);
    const rows = results.filter((row) => String(row[config.measure_col]) === String(measure));
    return rows.length ? visits(rows, config) : [];
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
        cuts: {},
        // No row to frame, as against rows that frame to no panel.
        noRows: true
      };
    }
    const baselineVisits = RELATIVE.has(state.valueType) ? config.baseline_visits || visits(rows, config).slice(0, 1) : [];
    const atMeasure = options.everyVisit ? state.visits : measureVisits(results, settings, state.measure);
    const asked = state.visits.filter((visit) => atMeasure.includes(visit));
    const drawnVisits = options.keepBaseline ? asked : visitsDrawn(asked, state.valueType, baselineVisits);
    const visitList = needsVisit ? drawnVisits : [null];
    const yOf = (visit) => needsVisit ? { measure: state.measure, visit, value: state.valueType } : { measure: state.measure, value: "baseline" };
    const cuts = {};
    for (const [field, by] of [
      ["x", state.groupBy],
      ["panel", state.panelBy]
    ]) {
      if (isCut(by)) cuts[field] = cutOf({ results: rows, participants: kept }, by, settings);
    }
    const grouping3 = (by) => isCut(by) ? by : { col: by };
    const variablesFor = (visit) => ({
      y: yOf(visit),
      ...state.groupBy ? { x: grouping3(state.groupBy) } : {},
      ...state.colorBy ? { color: { col: state.colorBy } } : {},
      ...state.panelBy ? { panel: grouping3(state.panelBy) } : {}
    });
    const grouped = (record) => {
      const out = { ...record };
      for (const [field, cut] of Object.entries(cuts)) out[field] = groupLabel(record[field], cut);
      return out;
    };
    const cutLevels = (cut, field, records) => cut.labels.filter((group) => records.some((record) => record[field] === group));
    const framed = visitList.map((visit) => {
      const made = frame(
        { results: rows, participants: kept || void 0 },
        variablesFor(visit),
        config
      );
      const data = made.data.map(grouped);
      const all = state.groupBy ? data : data.map((record) => ({ ...record, x: EVERYONE }));
      const positive = state.yScale === "log" ? all.filter((record) => record.y > 0) : all;
      return { visit, made, data: positive, nonPositive: made.data.length - positive.length };
    });
    const everyRecord = framed.flatMap((entry) => entry.data);
    const levels = cuts.x ? cutLevels(cuts.x, "x", everyRecord) : levelsOf(everyRecord.map((record) => record.x));
    const shownLevels = state.levels && !cuts.x ? levels.filter((level) => state.levels.includes(level)) : levels;
    const colors = state.colorBy ? levelsOf(everyRecord.map((record) => record.color)) : [null];
    let panelLevels = [null];
    if (cuts.panel) panelLevels = cutLevels(cuts.panel, "panel", everyRecord);
    else if (state.panelBy) panelLevels = levelsOf(everyRecord.map((record) => record.panel));
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
      visitsNotDrawn: needsVisit ? asked.filter((visit) => !drawnVisits.includes(visit)) : [],
      extent: values.length ? [Math.min(...values), Math.max(...values)] : null,
      filtered: kept ? kept.length : null,
      // How each cut variable was cut, for the footnote: `x`, `panel`.
      cuts
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

  // src/group-comparison/tiles.js
  var ROOM = 0.1;
  var sum2 = (values) => values.reduce((total, value) => total + value, 0);
  function standardDeviation(values) {
    const n = values.length;
    if (n < 2) return NaN;
    const mean = sum2(values) / n;
    return Math.sqrt(sum2(values.map((value) => (value - mean) ** 2)) / (n - 1));
  }
  function yardstick(values, valueType, yScale) {
    const n = values.length;
    const sd = standardDeviation(values);
    const mean = n ? sum2(values) / n : NaN;
    let size = null;
    if (yScale === "log") {
      if (valueType !== "change" && valueType !== "percent_change") {
        size = standardDeviation(values.filter((value) => value > 0).map(Math.log10));
      }
    } else if (valueType === "fold_change" || valueType === "percent_change") {
      size = mean === 0 ? NaN : sd / Math.abs(mean) * (valueType === "percent_change" ? 100 : 1);
    } else {
      size = sd;
    }
    return { n, sd, mean, size: Number.isFinite(size) ? size : null };
  }
  function tileAxis(points, yScale, least, options = {}) {
    const log = yScale === "log";
    const values = points.filter((value) => Number.isFinite(value) && (!log || value > 0));
    if (!values.length) return null;
    const to = log ? Math.log10 : (value) => value;
    const from = log ? (value) => 10 ** value : (value) => value;
    let low = to(Math.min(...values));
    let high = to(Math.max(...values));
    const floored = least > 0 && high - low < least;
    if (floored) {
      const middle = (low + high) / 2;
      low = middle - least / 2;
      high = middle + least / 2;
    }
    const bounded = !log && Number.isFinite(options.lowest);
    if (bounded && low < options.lowest) {
      high += options.lowest - low;
      low = options.lowest;
    }
    const room = (high - low) * ROOM || (log ? Math.log10(1.05) : Math.abs(high) * 0.05 || 1);
    const min = bounded ? Math.max(options.lowest, low - room) : low - room;
    return { min: from(min), max: from(high + room), floored };
  }
  function axisUnit(results, settings, measure, valueType) {
    if (valueType === "fold_change") return null;
    if (valueType === "percent_change") return "%";
    return unitOf(results, settings, measure);
  }
  function rangeText({ min, max }, unit, yScale) {
    const span = max - min;
    const decimals = span > 0 ? Math.min(8, Math.max(0, 2 - Math.ceil(Math.log10(span)))) : 2;
    const said2 = (value) => {
      if (yScale === "log") return String(Number(value.toPrecision(3)));
      const text2 = value.toFixed(decimals);
      return Number(text2) === 0 ? 0 .toFixed(decimals) : text2;
    };
    return `${said2(min)} to ${said2(max)}${unit ? ` ${unit}` : ""}`;
  }
  var REFERENCE = { change: 0, percent_change: 0, fold_change: 1 };
  function buildTiles(tables, settings, state, measures, options = {}) {
    const config = coreSettings(settings);
    const summary = state.tileSummary === "mean" ? "mean" : "median";
    const { results: left, participants: kept } = keepFiltered(
      tables,
      settings,
      state.filters,
      options.filterMatches
    );
    const baselineVisits = config.baseline_visits || (left.length ? visits(left, config).slice(0, 1) : []);
    const fixed = baselineVisits.length ? { ...settings, baseline_visits: baselineVisits } : settings;
    const byMeasure = /* @__PURE__ */ new Map();
    for (const row of tables.results) {
      const name = String(row[config.measure_col]);
      if (!byMeasure.has(name)) byMeasure.set(name, []);
      byMeasure.get(name).push(row);
    }
    const cutMeasure = isCut(state.groupBy) && typeof state.groupBy.measure === "string" ? state.groupBy.measure : null;
    const cutRows = cutMeasure === null ? [] : byMeasure.get(cutMeasure) || [];
    const built = measures.map((measure) => {
      const own = byMeasure.get(String(measure)) || [];
      const framed = {
        results: cutRows.length && cutMeasure !== String(measure) ? [...own, ...cutRows] : own,
        participants: tables.participants
      };
      const drawn = { ...state, measure, colorBy: "", panelBy: "", mark: "box" };
      const model = buildPanels(framed, fixed, drawn, {
        ...options,
        everyVisit: true,
        keepBaseline: true
      });
      const atBaseline = buildPanels(
        framed,
        fixed,
        { ...drawn, valueType: "baseline", yScale: "linear" },
        options
      );
      const baselineValues = atBaseline.panels.flatMap(
        (panel) => panel.records.map((record) => record.y)
      );
      return { measure, model, measured: yardstick(baselineValues, state.valueType, state.yScale) };
    });
    const cut = built.map((entry) => entry.model.cuts && entry.model.cuts.x).find(Boolean);
    const present4 = (key) => new Set(built.flatMap((entry) => entry.model[key]));
    const every = cut ? cut.labels.filter((label2) => present4("levels").has(label2)) : levelsOf([...present4("levels")]);
    const shownLevels = present4("shownLevels");
    const groups = every.map((level, index) => ({ level, index })).filter((group) => shownLevels.has(group.level));
    const raw = state.valueType === "raw" || state.valueType === "baseline";
    const tiles = built.map(({ measure, model, measured }) => {
      const lines = groups.filter((group) => model.shownLevels.includes(group.level)).map((group) => ({
        ...group,
        points: model.panels.map((panel) => {
          const cell = panel.cells.find((candidate) => candidate.level === group.level);
          const n = cell ? cell.n : 0;
          const median = n ? cell.stats.median : null;
          const mean = n ? cell.stats.mean : null;
          return { visit: panel.visit, n, median, mean, value: summary === "mean" ? mean : median };
        })
      }));
      const records = model.panels.flatMap(
        (panel) => panel.records.map((record) => ({ ...record, visit: panel.visit }))
      );
      const least = measured.size === null ? 0 : settings.tile_min_spread * measured.size;
      const lowest = raw && records.length && records.every((record) => record.y >= 0) ? { lowest: 0 } : {};
      const unit = axisUnit(tables.results, settings, measure, state.valueType);
      const axis = tileAxis(
        lines.flatMap((line) => line.points.map((point) => point.value)),
        state.yScale,
        least,
        lowest
      );
      return {
        measure,
        unit,
        visits: model.panels.map((panel) => panel.visit),
        lines,
        records,
        baseline: {
          visits: baselineVisits.length ? baselineVisits : null,
          n: measured.n,
          sd: measured.sd,
          mean: measured.mean
        },
        least,
        axis,
        // The axis in words, printed under the tile.
        range: axis ? rangeText(axis, unit, state.yScale) : null,
        reference: state.valueType in REFERENCE ? REFERENCE[state.valueType] : null
      };
    });
    return {
      tiles,
      groups,
      filtered: kept ? kept.length : null,
      baselineVisits: baselineVisits.length ? baselineVisits : null,
      cuts: built.length ? built[0].model.cuts || {} : {}
    };
  }

  // src/group-comparison/overTime.js
  var ROOM2 = 0.08;
  function markOf(cell, mark) {
    if (!cell || !cell.n) return null;
    const { stats } = cell;
    if (mark === "mean_se") {
      const reach = cell.se === null ? 0 : cell.se;
      return { centre: stats.mean, lower: stats.mean - reach, upper: stats.mean + reach };
    }
    if (mark === "median_iqr") return { centre: stats.median, lower: stats.q25, upper: stats.q75 };
    return { centre: stats.median, lower: stats.q5, upper: stats.q95 };
  }
  function timeDomain(built, mark, yScale) {
    const marks = built.columns.flatMap(
      (column) => column.cells.map((cell) => markOf(cell, mark)).filter(Boolean)
    );
    if (!marks.length) return null;
    const reach = (made, end) => yScale === "log" && !(made[end] > 0) ? made.centre : made[end];
    const least = Math.min(...marks.map((made) => reach(made, "lower")));
    const greatest = Math.max(...marks.map((made) => reach(made, "upper")));
    if (yScale === "log") {
      const factor = greatest > least ? (greatest / least) ** ROOM2 : 1 + ROOM2;
      return [least / factor, greatest * factor];
    }
    const room = (greatest - least) * ROOM2 || Math.abs(greatest) * ROOM2 || 1;
    return [least - room, greatest + room];
  }
  function buildOverTime(tables, settings, state, options = {}) {
    const model = buildPanels(
      tables,
      settings,
      { ...state, colorBy: "", panelBy: "", mark: "box" },
      { ...options, keepBaseline: true }
    );
    const groups = model.shownLevels.map((level) => ({ level, index: model.levels.indexOf(level) }));
    const { offsets, halfWidth } = slots(Math.max(groups.length, 1));
    const visits2 = model.panels.map((panel) => panel.visit);
    const tested = visitsDrawn(visits2, state.valueType, model.baselineVisits);
    const columns = model.panels.map((panel, at) => ({
      visit: panel.visit,
      at,
      tested: tested.includes(panel.visit),
      panel,
      cells: groups.map((group, slot) => {
        const cell = panel.cells.find((candidate) => candidate.level === group.level);
        const values = cell.records.map((record) => record.y);
        const deviation = standardDeviation(values);
        const sd = Number.isFinite(deviation) ? deviation : null;
        return {
          level: group.level,
          index: group.index,
          x: at + offsets[slot],
          halfWidth,
          n: cell.n,
          stats: cell.stats,
          sd,
          se: sd === null ? null : sd / Math.sqrt(cell.n),
          records: cell.records
        };
      })
    }));
    return {
      model,
      visits: visits2,
      groups,
      halfWidth,
      columns,
      tested,
      untested: visits2.filter((visit) => !tested.includes(visit)),
      baselineVisits: model.baselineVisits,
      filtered: model.filtered,
      cuts: model.cuts,
      noRows: Boolean(model.noRows)
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
  function statisticRequest({
    name,
    test,
    pairwise,
    settings,
    state,
    panel,
    unscheduled = false
  }) {
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
      ...state.yScale === "log" ? { positive_only: true } : {},
      ...unscheduled ? { unscheduled_visits: true } : {}
    };
    const args = {
      strValueCol: "y",
      strGroupCol: "x",
      strMethod: test,
      // Pairs exist only among more than two groups.
      bPairwise: Boolean(pairwise) && groups.length > 2
    };
    if (isCut(state.groupBy)) {
      args.chrGroups = [...new Set(panel.cells.filter((cell) => cell.n).map((cell) => cell.level))];
    }
    return {
      name,
      data: panel.records,
      args,
      dataId,
      rows: panel.records.length
    };
  }
  function overTimeRequest({
    name,
    test,
    adjustment,
    settings,
    state,
    built,
    unscheduled = false
  }) {
    const tested = built.columns.filter((column) => column.tested);
    const visits2 = tested.map((column) => column.visit);
    const data = tested.flatMap(
      (column) => column.panel.records.map((record) => ({ ...record, visit: column.visit }))
    );
    const filters = filtersInForce(state.filters);
    const dataId = {
      chart: "group-comparison",
      measure: state.measure,
      value_type: state.valueType,
      visits: visits2,
      ...settings.baseline_visits ? { baseline_visits: [...settings.baseline_visits] } : {},
      baseline_stat: settings.baseline_stat,
      ...state.groupBy ? { group_by: state.groupBy } : {},
      groups: groupsOf(data),
      ...Object.keys(filters).length ? { filters } : {},
      ...state.yScale === "log" ? { positive_only: true } : {},
      ...unscheduled ? { unscheduled_visits: true } : {}
    };
    const args = {
      strValueCol: "y",
      strGroupCol: "x",
      strByCol: "visit",
      strMethod: test,
      // The visits in visit order: R would sort their names otherwise.
      chrBy: visits2,
      strPAdjust: adjustment
    };
    if (isCut(state.groupBy)) args.chrGroups = built.groups.map((group) => group.level);
    return { name, data, args, dataId, rows: data.length };
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
  var plain = (state, said2) => ({ ...sentence(state, said2), pairs: null });
  function describeAnswer(result, context = {}) {
    if (result && result.status === "ok") {
      const value = result.value && typeof result.value === "object" ? result.value : {};
      const formatted = formatStatistic(value);
      const described = plain(formatted.status, formatted.text);
      if (formatted.status === "shown") {
        described.estimates = (Array.isArray(value.estimates) ? value.estimates : []).filter((row) => row && (present(row.lower) || present(row.upper))).map((row) => formatEstimate(row).text);
        described.pairs = pairsOf(value);
      }
      described.remarks = remarksOf(value);
      described.scope = context.scope || null;
      return described;
    }
    const failure = failureOf(result);
    return plain(failure.state, failure.text);
  }
  function describeLevels(result, context = {}) {
    if (!(result && result.status === "ok")) {
      const failure = failureOf(result);
      return { ...plain(failure.state, failure.text), details: [], levels: null };
    }
    const value = result.value && typeof result.value === "object" ? result.value : {};
    const rows = Array.isArray(value.rows) ? value.rows.filter((row) => row && typeof row === "object" && "by" in row) : [];
    const whole = formatStatistic(value);
    if (!rows.length) {
      const said2 = whole.status === "shown" ? plain("refused", "p-values not shown: the result has no row for any visit.") : plain(whole.status, whole.text);
      return { ...said2, details: [], remarks: remarksOf(value), levels: null };
    }
    const levels = rows.map((row) => ({ ...formatLevel(row, "visit"), visit: row.by }));
    const shown2 = levels.filter((level) => level.status === "shown");
    const methods = [...new Set(shown2.map((level) => level.method))];
    const count = (visits2) => visits2 === 1 ? "1 visit" : `${visits2} visits`;
    let state = "shown";
    let text2;
    if (!shown2.length) {
      state = whole.status === "shown" ? "withheld" : whole.status;
      text2 = whole.status === "shown" ? "No visit has a p-value." : whole.text;
    } else {
      const lead = methods.length === 1 ? `${methods[0]} at each visit` : "A test at each visit, named with it beneath";
      const [{ label: label2, adjustment, over }] = shown2;
      const labelled = adjustment ? `${label2.replace(/\.$/, "")} across ${count(over)}.` : label2;
      text2 = `${lead}, on the participants drawn there: ${count(shown2.length)} tested. ${labelled}`;
    }
    return {
      ...plain(state, text2),
      // A visit with no p-value says why, as R worded it; and where the visits'
      // tests differ in name, each visit's whole sentence is given.
      details: levels.filter((level) => level.status !== "shown" || methods.length > 1).map((level) => level.text),
      remarks: remarksOf(value),
      scope: context.scope || null,
      levels
    };
  }
  function levelsScope({ group, untested = [], value = "value", filters = [] }) {
    const named2 = group.includes(",") ? `${group},` : group;
    const said2 = [
      `Each visit has a test of its own, of the levels of ${named2} on the participants drawn at that visit.`
    ];
    if (untested.length) {
      said2.push(
        `${untested.join(", ")} is not tested: it is the baseline visit, where the ${value} is the same for everyone.`
      );
    }
    if (filters.length) said2.push(filtersSaid(filters));
    return said2.join(" ");
  }
  function noTestText(groups, several) {
    const lead = `Statistics: no test${several ? " in this panel" : ""}. A test compares two or more groups, and `;
    if (!groups) return `${lead}no column makes a group.`;
    if (groups.length === 1) return `${lead}only ${groups[0]} has values${several ? " here" : ""}.`;
    return `${lead}none is drawn.`;
  }
  function scopeText({ group, n, panel, color, filters = [] }) {
    const named2 = group.includes(",") ? `${group},` : group;
    const said2 = [
      `This test compares the levels of ${named2} on the ${n} participant${n === 1 ? "" : "s"} ` + (panel ? `drawn in this panel (${panel}).` : "drawn.")
    ];
    if (panel) {
      said2.push("Each panel has a test of its own, and they are not adjusted for one another.");
    }
    if (color) {
      said2.push(`Colour by ${color} is not part of it: each level of ${named2} is tested whole.`);
    }
    if (filters.length) said2.push(filtersSaid(filters));
    return said2.join(" ");
  }
  function createStatisticDesk({ connection, note = null }) {
    return createDesk({
      connection,
      note,
      // An answer for a row of visits reads as a row of results, one per visit.
      describe: (result, context) => context && context.levels ? describeLevels(result, context) : describeAnswer(result, context),
      waiting: (said2) => plain("waiting", said2)
    });
  }

  // src/group-comparison.js
  var NONE = "";
  var CUT_KEY = "bv-cut:";
  var OVERVIEW = "bv_overview";
  var MARK_LABELS = { box: "Box", violin: "Violin", points: "Points" };
  var SUMMARY_LABELS = { median: "Medians", mean: "Means" };
  var SUMMARY_WORDS = { median: "Median", mean: "Mean" };
  var VALUE_WORDS2 = {
    raw: "result",
    baseline: "baseline value",
    change: "change from baseline",
    fold_change: "fold change from baseline",
    percent_change: "percent change from baseline"
  };
  var NOT_ON_TILES = "Applies when one biomarker is open.";
  var AT_ONE_VISIT = "Applies once a biomarker and a visit are open.";
  var TIME_MARK_LABELS = {
    box: "Boxes",
    mean_se: "Means with standard errors",
    median_iqr: "Medians with quartiles"
  };
  var TIME_MARK_WORDS = {
    box: "Boxes of the",
    mean_se: "Mean and standard error of the",
    median_iqr: "Median and quartiles of the"
  };
  var TIME_MARK_NOTES = {
    box: "Each box runs from the 25th to the 75th percentile, with a line at the median and a dot at the mean; its whiskers end at the 5th and 95th percentiles.",
    mean_se: "Each point is a group\u2019s mean at a visit, and its bar reaches one standard error either side: the standard deviation over the square root of the number in the group.",
    median_iqr: "Each point is a group\u2019s median at a visit, and its bar reaches from the 25th to the 75th percentile."
  };
  var ADJUSTMENT_LABELS = { none: "None", holm: "Holm", BH: "Benjamini-Hochberg" };
  var ROW_WORDS = {
    waiting: "Waiting for R\u2026",
    unavailable: "Statistics unavailable",
    error: "R reported an error",
    withheld: "Not computed",
    refused: "Not shown",
    none: "No test"
  };
  var CELL_WORDS = { withheld: "not computed", error: "error", refused: "not shown" };
  var VISIT_WIDTH = 50;
  var GUTTER_LEAST = 64;
  var NAME_ROOM = 5;
  var NAME_SCALE_LEAST = 0.75;
  var STYLE_ID = "bio-viz-group-comparison-styles";
  var STYLES = `${lineStyles(".bv-group-comparison")}
${toolbarStyles(".bv-group-comparison")}
.bv-group-comparison .sv-chart-wrap canvas,.bv-group-comparison .bv-panel-canvas canvas{cursor:pointer}
.bv-group-comparison .sv-multiples.bv-tiles{display:block}
.bv-group-comparison .bv-tile-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:.6rem}
.bv-group-comparison .bv-tile{display:flex;flex-direction:column;align-items:stretch;gap:.15rem;min-width:0;margin:0;padding:.5rem .55rem .45rem;border:1px solid #d8dee4;border-radius:8px;background:#fff;color:#1f2933;font:inherit;text-align:left;cursor:pointer}
.bv-group-comparison .bv-tile:hover{border-color:#0b62a4;box-shadow:0 1px 4px rgba(11,98,164,.18)}
.bv-group-comparison .bv-tile:focus-visible{outline:2px solid #0b62a4;outline-offset:1px}
.bv-group-comparison .bv-tile-name{display:block;font-size:.85rem;font-weight:600;line-height:1.2;overflow-wrap:anywhere}
.bv-group-comparison .bv-tile-canvas{display:block;position:relative;height:74px}
.bv-group-comparison .bv-tile-visits{display:flex;justify-content:space-between;gap:.4rem;font-size:.66rem;line-height:1.2;color:#52616f}
.bv-group-comparison .bv-tile-visits[data-single]{justify-content:center}
.bv-group-comparison .bv-tile-range{display:block;margin-top:.1rem;font-size:.72rem;line-height:1.25;color:#3e4c59;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.bv-group-comparison .bv-tile-empty{display:block;font-size:.72rem;color:#52616f}
.bv-group-comparison .bv-tile-caption{margin:0 0 .6rem;font-size:.8rem;color:#52616f}
.bv-group-comparison .bv-legend{display:flex;flex-wrap:wrap;gap:.2rem 1rem;margin:0 0 .3rem;font-size:.8rem;color:#1f2933}
.bv-group-comparison .bv-legend-swatch{display:inline-block;width:.75em;height:.75em;margin-right:.35em;border-radius:2px}
.bv-group-comparison .bv-control-note{display:block;margin:.2rem 0 0;font-size:.75rem;color:#52616f}
.bv-group-comparison .bv-trail ol{display:flex;flex-wrap:wrap;align-items:center;gap:.3rem .35rem;margin:0;padding:0;list-style:none;font-size:.85rem;color:#1f2933}
.bv-group-comparison .bv-trail li{display:flex;align-items:center;gap:.35rem}
.bv-group-comparison .bv-trail li+li::before{content:'\u203A';color:#52616f}
.bv-group-comparison .bv-trail [aria-current]{font-weight:600;overflow-wrap:anywhere}
.bv-group-comparison .sv-multiples.bv-time{display:block}
.bv-group-comparison .bv-time-scroll{overflow-x:auto;border:1px solid #d8dee4;border-radius:10px;background:#fff;padding:.6rem .5rem .5rem}
.bv-group-comparison .bv-time-canvas{position:relative;height:360px}
.bv-group-comparison .bv-time-canvas canvas{cursor:pointer}
.bv-group-comparison .bv-time-table{width:100%;table-layout:fixed;border-collapse:collapse;margin:.1rem 0 0;background:none;font-size:.78rem;line-height:1.25;color:#1f2933;font-variant-numeric:tabular-nums}
.bv-group-comparison .bv-time-table caption{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.bv-group-comparison .bv-time-table th,.bv-group-comparison .bv-time-table td{padding:.22rem .05rem;border:0;background:none;color:inherit;font-family:inherit;font-size:inherit;font-weight:400;letter-spacing:normal;text-transform:none;text-align:center;vertical-align:top}
.bv-group-comparison .bv-time-table th[scope=row]{overflow-wrap:anywhere}
.bv-group-comparison .bv-time-table th[scope=row]{padding-right:.4rem;text-align:right;color:#3e4c59}
.bv-group-comparison .bv-time-table tbody tr{border-top:1px solid #eef1f4}
.bv-group-comparison .bv-time-table thead th{font-weight:600}
.bv-group-comparison .bv-time-visit{display:block;width:100%;margin:0;padding:.2rem .1rem;border:1px solid transparent;border-radius:6px;background:none;color:#0b62a4;font:inherit;font-weight:600;line-height:1.2;cursor:pointer}
.bv-group-comparison .bv-time-visit:hover{border-color:#0b62a4;background:#eaf2fb}
.bv-group-comparison .bv-time-visit:focus-visible{outline:2px solid #0b62a4;outline-offset:1px}
.bv-group-comparison .bv-time-still{display:block;padding:.2rem .1rem;border:1px solid transparent;color:#3e4c59}
.bv-group-comparison .bv-time-sub{display:block;font-size:.7rem;color:#52616f}
.bv-group-comparison .bv-time-table tr[data-row=test] td{font-weight:600}
.bv-group-comparison .bv-time-table tr[data-row=test] td[data-status]:not([data-status=shown]),.bv-group-comparison .bv-time-table tr[data-row=test] td[colspan]{font-weight:400;font-style:italic;color:#52616f}
.bv-group-comparison .bv-stat-level{margin:0 0 .3rem}
@media (max-width:600px){
.bv-group-comparison .bv-time-canvas{height:300px}
.bv-group-comparison .bv-time-scroll{padding:.4rem .25rem .35rem}
.bv-group-comparison .bv-time-table{font-size:.7rem}
.bv-group-comparison .bv-time-visit,.bv-group-comparison .bv-time-still{padding:.2rem 0}
.bv-group-comparison .bv-tile-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem}
.bv-group-comparison .sv-chart-wrap{height:380px;padding:.5rem}
.bv-group-comparison.sv-collapsed .sv-sidebar-title{display:inline}
.bv-group-comparison.sv-collapsed .sv-sidebar{padding:.5rem .9rem}
}`;
  var NOTHING_AFTER_BASELINE = "The only visit chosen is the baseline visit, where this value is the same for everyone. Choose a later visit to draw.";
  var NO_VALUE = "No participant has a value to draw for this choice.";
  function nothingDrawn(model) {
    if (model.filtered === 0) return NOBODY_PASSES;
    return model.noRows || model.panels.length ? NO_VALUE : NOTHING_AFTER_BASELINE;
  }
  function listed3(names) {
    if (names.length <= 4) return names.join(", ");
    return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  }
  var GroupComparison = class {
    constructor(element, settings) {
      this.kit = findKit("the group comparison chart");
      this.element = typeof element === "string" ? document.querySelector(element) : element;
      if (!this.element) throw new Error(`bio.viz: group comparison target not found: ${element}`);
      this.settings = syncSettings(settings);
      this.tables = { results: [], participants: null };
      this.drawTables = this.tables;
      this.unscheduled = { results: [], visits: [] };
      this.hiddenVisits = [];
      this.charts = [];
      this.model = null;
      this.measures = [];
      this.visits = [];
      this.categories = [];
      this.filterSpecs = [];
      this.state = {};
      this.asked = [];
      this.tiles = null;
      this.overTime = null;
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
        moduleClass: "bv-group-comparison",
        styleId: STYLE_ID,
        styles: STYLES,
        listingFile: "bio.viz-group-comparison-listing.csv"
      });
      mountToolbar(this);
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
     * @param {object} [settings] Settings to change with the tables, when the new
     *   tables need them: a participant table whose id column has another name
     *   comes with `participant_id_col`. The tables are checked against these.
     * @returns {GroupComparison} The chart, for chaining.
     */
    setData(data, settings) {
      if (settings === void 0 || settings === null) {
        this.tables = readGiven(this, data);
      } else {
        this.tables = readGiven(this, data, syncSettings({ ...this.settings, ...settings }));
        this.setSettings(settings);
      }
      this.readTables();
      this.readVisits(this.settings.unscheduled_visits);
      this.state = this.seedState();
      this.buildProfileFeed();
      this.buildControls();
      this.render();
      return this;
    }
    /**
     * Lay new settings over the current ones and draw again. A setting that says
     * what the chart opens on (`start_value`, `visits`, `value_type`, `group_by`,
     * `levels`, `color_by`, `panel_by`, `mark`, `time_mark`, `y_scale`,
     * `tile_summary`, `unscheduled_visits`, `test`, `pairwise`,
     * `visit_adjustment`) moves its control: `start_value: null` returns to the
     * tiles of every biomarker, and `visits: null` with a biomarker named to that
     * biomarker over time.
     * @param {object} settings The settings to change.
     * @returns {GroupComparison} The chart, for chaining.
     */
    setSettings(settings) {
      const given2 = settings || {};
      const next = syncSettings({ ...this.settings, ...given2 });
      checkTables(this.tables, next);
      this.settings = next;
      syncHost(this);
      if ("back" in given2) mountToolbar(this);
      if ("connection" in given2 || "waiting_note" in given2) this.connect();
      const offered = this.visits.all || [];
      this.readTables();
      this.readVisits(
        "unscheduled_visits" in given2 ? next.unscheduled_visits : this.state.unscheduledVisits
      );
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
        time_mark: "timeMark",
        y_scale: "yScale",
        tile_summary: "tileSummary",
        unscheduled_visits: "unscheduledVisits",
        test: "test",
        pairwise: "pairwise",
        visit_adjustment: "visitAdjustment",
        filters: "filters"
      };
      for (const [setting, key] of Object.entries(moved)) {
        if (setting in given2) this.state[key] = opening[key];
      }
      this.repairState(opening);
      if (!("visits" in given2)) this.chooseNewVisits(offered);
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
      const found = scheduledResults(results, this.settings);
      const named2 = new Set(found.visits);
      this.unscheduled = {
        results: found.results,
        // Those with a result to draw, in visit order: what the switch brings back.
        visits: results.length && named2.size ? visits(results, coreSettings(this.settings)).filter((visit) => named2.has(visit)) : []
      };
      this.categories = results.length ? categoryColumns(this.tables, this.settings) : [];
      this.cutOptions = [];
      for (const by of [this.settings.group_by, this.settings.panel_by]) {
        if (!isCut(by)) continue;
        const written = JSON.stringify(by);
        if (this.cutOptions.some((entry) => JSON.stringify(entry.spec) === written)) continue;
        this.cutOptions.push({
          key: `${CUT_KEY}${this.cutOptions.length}`,
          spec: by,
          label: label(by)
        });
      }
      this.filterSpecs = filterColumns(this.tables, this.settings, this.categories).map(
        (spec) => this.kit.normalizeFilterSpec(spec)
      );
      const start = this.settings.start_value;
      if (results.length && start !== null && !this.measures.includes(start)) {
        console.warn(
          `The initial biomarker [${start}] does not exist. Defaulting to the all-biomarkers overview.`
        );
      }
    }
    // The tables the chart draws from and the visits it offers, with unscheduled
    // visits drawn (`shown`) or left out. Left out, their rows are set aside
    // before anything is listed or framed, so they are in no level of the chart:
    // not in a tile, not in the Visit control, not a panel, and not the baseline
    // a change is measured from. The participant profile is safety.viz's own
    // chart of one participant, and is given every result.
    readVisits(shown2) {
      const results = shown2 ? this.tables.results : this.unscheduled.results;
      this.drawTables = { results, participants: this.tables.participants };
      this.visits = results.length ? listVisits(results, this.settings) : { all: [], start: [] };
      this.hiddenVisits = shown2 ? [] : this.unscheduled.visits;
    }
    // Which level is drawn: every biomarker; one biomarker over time, when
    // every visit it has is chosen; or one biomarker's visits, a panel each.
    level() {
      return levelOf(this.state, this.measureVisits());
    }
    // Whether the tiles of every biomarker are what is drawn.
    atTiles() {
      return this.level() === LEVELS.BIOMARKERS;
    }
    // The visits the open biomarker has values at, in visit order: read once
    // for a biomarker, a table and the settings, because every control and every
    // draw asks. The settings name the columns the visits are read from, and
    // are a new object whenever they change (setSettings), so a change to them
    // reads the visits again.
    measureVisits() {
      const { measure } = this.state;
      if (measure === null || measure === void 0) return [];
      const { results } = this.drawTables;
      const { settings } = this;
      const kept = this.visitsOf;
      if (kept && kept.results === results && kept.settings === settings && kept.measure === measure) {
        return kept.visits;
      }
      const visits2 = measureVisits(results, settings, measure);
      this.visitsOf = { results, settings, measure, visits: visits2 };
      return visits2;
    }
    // What R's counts are of, when the automatic footnote has many to say: one
    // biomarker over time is answered a count per visit.
    get footnoteCounts() {
      return this.overTime ? "visits" : void 0;
    }
    // Opens one biomarker, or every biomarker (null), from the Biomarker control
    // or from a tile.
    selectMeasure(measure) {
      this.state.measure = measure;
      this.buildControls();
      this.render();
    }
    // The key a cut variable is held under in the Group and Panel controls.
    cutKey(by) {
      const written = JSON.stringify(by);
      return this.cutOptions.find((entry) => JSON.stringify(entry.spec) === written).key;
    }
    // Whether a Group or Panel control can hold a value: a column offered, or a
    // cut variable the settings name.
    offers(value) {
      return this.categories.some((entry) => entry.value_col === value) || this.cutOptions.some((entry) => entry.key === value);
    }
    // A Group or Panel control's value as the core takes it: a column's name, or
    // the cut variable.
    groupingOf(value) {
      const found = this.cutOptions.find((entry) => entry.key === value);
      return found ? found.spec : value;
    }
    // The state with the group and the panel as the drawing takes them.
    drawingState(state = this.state) {
      return {
        ...state,
        groupBy: this.groupingOf(state.groupBy),
        panelBy: this.groupingOf(state.panelBy)
      };
    }
    // What the chart opens on: the settings, where the tables have what they name.
    seedState() {
      const { settings, categories, measures } = this;
      const has = (column) => categories.some((entry) => entry.value_col === column);
      let groupBy = NONE;
      if (isCut(settings.group_by)) groupBy = this.cutKey(settings.group_by);
      else if (has(settings.group_by)) groupBy = settings.group_by;
      else if (categories.length) groupBy = categories[0].value_col;
      let panelBy = NONE;
      if (isCut(settings.panel_by)) panelBy = this.cutKey(settings.panel_by);
      else if (has(settings.panel_by)) panelBy = settings.panel_by;
      return {
        // No biomarker named, or one the table does not have: every biomarker.
        measure: measures.includes(settings.start_value) ? settings.start_value : null,
        visits: [...this.visits.start],
        valueType: settings.value_type,
        groupBy,
        levels: settings.levels,
        colorBy: has(settings.color_by) ? settings.color_by : NONE,
        panelBy,
        mark: settings.mark,
        timeMark: settings.time_mark,
        yScale: settings.y_scale,
        tileSummary: settings.tile_summary,
        unscheduledVisits: settings.unscheduled_visits,
        test: settings.test,
        pairwise: settings.pairwise,
        visitAdjustment: settings.visit_adjustment,
        filters: startFilters(this)
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
      if (this.state.groupBy && !this.offers(this.state.groupBy)) {
        this.state.groupBy = opening.groupBy;
      }
      if (this.state.colorBy && !has(this.state.colorBy)) this.state.colorBy = NONE;
      if (this.state.panelBy && !this.offers(this.state.panelBy)) this.state.panelBy = NONE;
    }
    labelOf(column) {
      const cut = this.cutOptions.find((entry) => entry.key === column);
      if (cut) return cut.label;
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
      const level = this.level();
      const tiles = level === LEVELS.BIOMARKERS;
      const overTime = level === LEVELS.OVER_TIME;
      const switchOff = (control, words) => {
        const input = control.matches("select,input") ? control : control.querySelector("select");
        input.disabled = true;
        control.after(kit.createElement("small", "bv-control-note", words));
      };
      const atOneVisit = (control) => {
        if (tiles || overTime) switchOff(control, AT_ONE_VISIT);
      };
      const value = addSection("Value");
      select(
        "measure",
        "Biomarker",
        [[OVERVIEW, "All Biomarkers"], ...this.measures.map((measure) => [measure, measure])],
        tiles ? OVERVIEW : state.measure,
        // The controls differ between the tiles and one biomarker.
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
        const offered = this.visitsOffered();
        const shown2 = state.visits.filter((visit) => offered.includes(visit));
        const visits2 = kit.multiSelect({
          values: offered,
          selected: shown2.length === offered.length ? null : shown2,
          onChange: (next) => {
            const chosen = next === null ? offered : next;
            const before = this.level();
            state.visits = this.visitsChosen(chosen, offered);
            if (this.level() === before) {
              redraw(false);
              return;
            }
            const active = document.activeElement;
            const at = active && visits2.contains(active) ? active.value : null;
            redraw(true);
            const again = this.controls.querySelector('[data-control="visits"]');
            if (!again) return;
            again.open = true;
            const box = [...again.querySelectorAll("input")].find((input) => input.value === at);
            if (at !== null && box) box.focus();
          }
        });
        visits2.dataset.control = "visits";
        addControl("Visit", visits2, value);
      }
      const columns = this.categories.map((entry) => [entry.value_col, entry.label]);
      const cuts = this.cutOptions.map((entry) => [entry.key, entry.label]);
      const group = addSection("Groups");
      if (columns.length || cuts.length) {
        select(
          "group-by",
          "Group by",
          [...columns, ...cuts],
          state.groupBy,
          (next) => {
            state.groupBy = next;
            state.levels = null;
            redraw(true);
          },
          group
        );
        if (isCut(this.groupingOf(state.groupBy))) {
          group.append(
            kit.createElement("small", "bv-control-note", "Every group a cut makes is drawn.")
          );
        } else {
          const levels = this.levelsOffered();
          const picker = kit.multiSelect({
            values: levels,
            selected: state.levels ? levels.filter((level2) => state.levels.includes(level2)) : null,
            onChange: (next) => {
              state.levels = next;
              redraw(false);
            }
          });
          picker.dataset.control = "levels";
          addControl("Levels", picker, group);
        }
        const optional = [[NONE, "None"], ...columns];
        atOneVisit(
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
          )
        );
        const panelBy = select(
          "panel-by",
          "Panel by",
          [...optional, ...cuts],
          state.panelBy,
          (next) => {
            state.panelBy = next;
            redraw(false);
          },
          group
        );
        atOneVisit(panelBy);
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
      if (tiles) {
        select(
          "tile-summary",
          "Tiles draw",
          TILE_SUMMARIES.map((summary) => [summary, SUMMARY_LABELS[summary]]),
          state.tileSummary,
          (next) => {
            state.tileSummary = next;
            redraw(false);
          },
          display
        );
      }
      if (overTime) {
        select(
          "time-mark",
          "Draw as",
          TIME_MARKS.map((mark) => [mark, TIME_MARK_LABELS[mark]]),
          state.timeMark,
          (next) => {
            state.timeMark = next;
            redraw(false);
          },
          display
        );
      } else {
        const mark = select(
          "mark",
          "Draw as",
          MARKS.map((entry) => [entry, MARK_LABELS[entry]]),
          state.mark,
          (next) => {
            state.mark = next;
            redraw(false);
          },
          display
        );
        if (tiles) switchOff(mark, NOT_ON_TILES);
      }
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
      if (this.unscheduled.visits.length) {
        const unscheduled = document.createElement("input");
        unscheduled.type = "checkbox";
        unscheduled.dataset.control = "unscheduled-visits";
        unscheduled.checked = Boolean(state.unscheduledVisits);
        unscheduled.setAttribute("aria-label", "Show unscheduled visits");
        unscheduled.onchange = () => this.showUnscheduled(unscheduled.checked);
        const inline = kit.createElement("div", "sv-control-inline");
        inline.append(unscheduled, document.createTextNode("Show"));
        addControl("Unscheduled visits", inline, display);
      }
      this.testControl = null;
      this.pairwiseControl = null;
      this.adjustControl = null;
      if (this.settings.statistic && !tiles && (!overTime || this.settings.statistic_by_visit)) {
        const statistics = addSection("Statistics");
        const test = document.createElement("select");
        test.dataset.control = "test";
        test.onchange = () => {
          state.test = test.value;
          redraw(false);
        };
        this.testControl = addControl("Test", test, statistics);
        if (overTime) {
          this.adjustControl = select(
            "visit-adjustment",
            "Adjust across visits",
            VISIT_ADJUSTMENTS.map((entry) => [entry, ADJUSTMENT_LABELS[entry]]),
            state.visitAdjustment,
            (next) => {
              state.visitAdjustment = next;
              redraw(false);
            },
            statistics
          );
        } else {
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
      }
      addFilterControls(this, { addSection, addControl }, () => redraw(false));
      addReset(() => {
        this.readVisits(this.settings.unscheduled_visits);
        this.state = this.seedState();
        this.buildControls();
        this.render();
      });
    }
    // Switches unscheduled visits on or off, from the control. A visit that
    // comes back is drawn: it joins the visits chosen, as every visit is chosen
    // when the chart opens.
    showUnscheduled(shown2) {
      const offered = this.visits.all;
      this.state.unscheduledVisits = shown2;
      this.readVisits(shown2);
      this.chooseNewVisits(offered);
      this.buildControls();
      this.render();
    }
    // Adds to the visits chosen the ones now offered that were not `offered`
    // before, and drops any no longer offered.
    chooseNewVisits(offered) {
      const chosen = this.state.visits || [];
      this.state.visits = this.visits.all.filter(
        (visit) => chosen.includes(visit) || !offered.includes(visit)
      );
    }
    // Why a specification's visits are not all drawn, when the reason is that
    // some are unscheduled and left out: said in place of "not in the tables",
    // which they are (src/shared/chartHost.js, noticesOf).
    noticeOf(setting, asked, drawn) {
      if (setting !== "visits" || !Array.isArray(asked)) return null;
      const left = asked.filter((visit) => this.hiddenVisits.includes(visit));
      if (!left.length) return null;
      const kept = drawn || [];
      const absent = asked.filter((visit) => !left.includes(visit) && !kept.includes(visit));
      return `Visits: ${listed3(left)} ${left.length === 1 ? "is an unscheduled visit" : "are unscheduled visits"}, left out unless \`unscheduled_visits\` is true, so the chart draws ${kept.length ? kept.join(", ") : "none"}.` + (absent.length ? ` ${absent.join(", ")} ${absent.length === 1 ? "is" : "are"} not in the tables.` : "");
    }
    // The visits chosen, for the ones ticked among those offered: the ones
    // ticked and no others, in visit order. A visit the open biomarker has no
    // value at is not offered, and is never added to them: it would be named in
    // the title and drawn on the tiles afterwards, though nobody chose it. With
    // every visit offered ticked, which the control reads as All, every visit
    // is chosen, so the next biomarker opened is drawn across all of its own.
    visitsChosen(ticked, offered = this.visitsOffered()) {
      const { all } = this.visits;
      if (offered.every((visit) => ticked.includes(visit))) return [...all];
      return all.filter((visit) => ticked.includes(visit));
    }
    // The visits drawn: those chosen that the open biomarker has values at, or
    // on the tiles every one chosen. They are what a title names.
    visitsDrawn() {
      const offered = this.visitsOffered();
      return (this.state.visits || []).filter((visit) => offered.includes(visit));
    }
    // The visits the Visit control offers: the open biomarker's, or every visit
    // on the tiles.
    visitsOffered() {
      const { measure } = this.state;
      if (measure === null || measure === void 0) return this.visits.all;
      return this.measureVisits();
    }
    // Every level of the group column in the tables, whatever the filters are set to.
    levelsOffered() {
      if (!this.state.groupBy) return [];
      if (this.atTiles()) return columnLevels(this.drawTables, this.state.groupBy);
      try {
        const model = buildPanels(
          this.drawTables,
          this.settings,
          {
            ...this.drawingState(),
            levels: null,
            colorBy: NONE,
            panelBy: NONE,
            filters: {},
            yScale: "linear"
          },
          { filterMatches: this.kit.filterMatches }
        );
        return model.levels;
      } catch {
        return [];
      }
    }
    // The Test control offers the tests that fit the number of groups drawn, and
    // nothing else: a test that does not fit is never asked of R. The pairwise
    // switch is there only when there are pairs to compare.
    syncTestControls(groups) {
      const { testControl: control, pairwiseControl: pairwise, kit, state } = this;
      if (!control) return;
      const select = control.matches("select") ? control : control.querySelector("select");
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
      if (pairwise) {
        pairwise.checked = state.pairwise;
        pairwise.parentElement.style.display = groups > 2 && fitted !== "none" ? "" : "none";
      }
      if (this.adjustControl) {
        const adjust = this.adjustControl.matches("select") ? this.adjustControl : this.adjustControl.querySelector("select");
        adjust.disabled = !offered.length || fitted === "none";
      }
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
      drawSafely(this, () => this.draw());
    }
    // Everything render() draws. drawSafely says so in the element when it fails.
    draw() {
      const round = this.desk.begin();
      this.asked = [];
      this.destroyCharts();
      this.clearSelection();
      this.notes.innerHTML = "";
      this.multiplesWrap.innerHTML = "";
      this.statLine.textContent = "";
      this.statLine.dataset.state = "empty";
      this.multiplesWrap.classList.remove("bv-tiles", "bv-time");
      this.chartWrap.classList.remove("sv-hidden");
      this.model = null;
      this.tiles = null;
      this.overTime = null;
      this.timeRow = null;
      this.syncTestControls(0);
      const level = this.level();
      this.root.dataset.level = level;
      this.writeTrail(level);
      this.noteHiddenVisits();
      const { results } = this.drawTables;
      const needsVisit = this.state.valueType !== "baseline";
      if (!results.length || !this.measures.length) {
        this.footnote.textContent = "No results to draw.";
        return;
      }
      const offered = this.visitsOffered();
      if (needsVisit && !this.state.visits.some((visit) => offered.includes(visit))) {
        this.footnote.textContent = "Choose a visit to draw.";
        return;
      }
      if (level === LEVELS.BIOMARKERS) {
        this.drawTiles();
        return;
      }
      if (level === LEVELS.OVER_TIME) {
        this.drawOverTime(round);
        return;
      }
      const model = buildPanels(this.drawTables, this.settings, this.drawingState(), {
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
      this.footnote.textContent = [
        this.state.mark === "points" ? "Click a point to list its participant and open their profile." : `Click a ${this.state.mark} to list its participants.`,
        ...this.cutNotes(model)
      ].join(" ");
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
    // ---- The trend tiles ---------------------------------------------------------
    // Every biomarker, a tile each, in the Biomarker control's order; in a tile
    // one line per group through the group's median (or mean) at each visit
    // chosen, on the biomarker's own value axis, whose range is printed under
    // it. One key above them all. A tile is a button: a click, or Enter or Space
    // on it, opens its biomarker. Each tile is one small Chart.js chart, and
    // every biomarker is drawn: there are no pages.
    drawTiles() {
      const { kit, state, settings } = this;
      const built = buildTiles(this.drawTables, settings, this.drawingState(), this.measures, {
        filterMatches: kit.filterMatches
      });
      this.tiles = built;
      this.chartWrap.classList.add("sv-hidden");
      this.multiplesWrap.classList.add("bv-tiles");
      this.updateTileNotes(built);
      if (!built.tiles.some((tile) => tile.axis)) {
        this.footnote.textContent = built.filtered === 0 ? NOBODY_PASSES : NO_VALUE;
        return;
      }
      this.footnote.textContent = [
        "Click a biomarker to view it across the visits, with a test under each.",
        ...this.cutNotes(built)
      ].join(" ");
      const key = kit.createElement("p", "bv-legend bv-tile-key");
      const by = state.groupBy ? ` by ${this.labelOf(state.groupBy)}` : "";
      key.append(
        kit.createElement(
          "span",
          null,
          `${SUMMARY_WORDS[state.tileSummary]} ${VALUE_WORDS2[state.valueType]}${by}:`
        )
      );
      built.groups.forEach((group) => {
        const entry = kit.createElement("span");
        entry.dataset.group = group.level;
        const swatch = kit.createElement("span", "bv-legend-swatch");
        swatch.style.background = this.colorOf(group.index);
        entry.append(swatch, document.createTextNode(group.level));
        key.append(entry);
      });
      const spread = settings.tile_min_spread;
      const caption = kit.createElement(
        "p",
        "bv-tile-caption",
        "Each biomarker has its own value axis, printed under its tile." + (spread > 0 ? ` It is never narrower than ${shown(spread)} standard deviation${spread === 1 ? "" : "s"} of the results at the baseline visit, so lines that differ by less stay close to flat.` : "")
      );
      const grid = kit.createElement("div", "bv-tile-grid");
      this.multiplesWrap.append(key, caption, grid);
      this.tileSeries = (this.tileSeries || 0) + 1;
      built.tiles.forEach((tile, index) => {
        const button = kit.createElement("button", "bv-tile");
        button.type = "button";
        button.dataset.measure = tile.measure;
        button.setAttribute("aria-label", `View ${tile.measure}`);
        button.onclick = () => this.openFromTile(tile.measure);
        button.append(kit.createElement("span", "bv-tile-name", tile.measure));
        grid.append(button);
        if (!tile.axis) {
          button.append(
            kit.createElement("span", "bv-tile-empty", "No participant has a value to draw.")
          );
          return;
        }
        const wrap = kit.createElement("span", "bv-tile-canvas");
        const canvas = document.createElement("canvas");
        wrap.append(canvas);
        const visits2 = kit.createElement("span", "bv-tile-visits");
        const named2 = tile.visits.map((visit) => visit ?? "Baseline value");
        if (named2.length === 1) visits2.dataset.single = "true";
        [.../* @__PURE__ */ new Set([named2[0], named2[named2.length - 1]])].forEach(
          (visit) => visits2.append(kit.createElement("span", null, visit))
        );
        const range = kit.createElement("span", "bv-tile-range", tile.range);
        range.id = `bv-tile-range-${this.tileSeries}-${index}`;
        button.setAttribute("aria-describedby", range.id);
        button.append(wrap, visits2, range);
        const chart = this.drawTile(canvas, tile);
        chart.$measure = tile.measure;
        chart.$tile = tile;
      });
    }
    // One tile's chart: a line per group through its points, in visit order
    // along the tile, with nothing that answers the pointer, because the tile it
    // is in is what is clicked. A group with no value at a visit has no point
    // there, and its line runs on to its next value.
    drawTile(canvas, tile) {
      const { state } = this;
      const last = tile.visits.length - 1;
      const datasets = tile.lines.map((line) => {
        const hex = this.colorOf(line.index);
        return {
          label: line.level,
          data: line.points.map((point, at) => ({ x: at, y: point.value })).filter((point) => point.y !== null),
          borderColor: hex,
          backgroundColor: hex,
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 2,
          tension: 0
        };
      });
      const chart = new this.kit.Chart(canvas.getContext("2d"), {
        type: "line",
        data: { datasets },
        options: {
          animation: false,
          maintainAspectRatio: false,
          responsive: true,
          parsing: false,
          events: [],
          layout: { padding: { top: 2, right: 5, bottom: 2, left: 5 } },
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: {
            x: {
              type: "linear",
              min: last ? -0.15 : -0.5,
              max: last ? last + 0.15 : 0.5,
              display: false
            },
            y: {
              type: state.yScale === "log" ? "logarithmic" : "linear",
              min: tile.axis.min,
              max: tile.axis.max,
              display: false
            }
          }
        },
        plugins: [this.tileFrame(tile)]
      });
      const said2 = tile.lines.map(
        (line) => `${line.level} ${line.points.map((point) => point.value === null ? "none" : shown(point.value)).join(", ")}`
      ).join("; ");
      canvas.setAttribute("role", "img");
      canvas.setAttribute(
        "aria-label",
        `${tile.measure}, ${SUMMARY_WORDS[state.tileSummary].toLowerCase()} ${VALUE_WORDS2[state.valueType]} at ${tile.visits.map((visit) => visit ?? "baseline").join(", ")}: ${said2}`
      );
      this.charts.push(chart);
      return chart;
    }
    // What a tile draws beside its lines: the line it stands on, and, for a
    // value worked out against a baseline, a dashed line where no change is.
    tileFrame(tile) {
      return {
        id: "gc-tile-frame",
        beforeDatasetsDraw: (chart) => {
          const { ctx, chartArea, scales } = chart;
          ctx.save();
          ctx.strokeStyle = "#c5ccd3";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(chartArea.left, chartArea.bottom);
          ctx.lineTo(chartArea.right, chartArea.bottom);
          ctx.stroke();
          const { reference } = tile;
          if (reference !== null && reference > tile.axis.min && reference < tile.axis.max) {
            const y = scales.y.getPixelForValue(reference);
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(chartArea.left, y);
            ctx.lineTo(chartArea.right, y);
            ctx.stroke();
          }
          ctx.restore();
        }
      };
    }
    // Opens a biomarker from its tile: over time, when every visit is chosen.
    // Its view replaces the tiles, so the page is brought back to the chart's
    // top, and the keyboard's place is put on the Biomarker control when it is
    // on screen.
    openFromTile(measure) {
      this.selectMeasure(measure);
      if (this.root.getBoundingClientRect().top < 0) this.root.scrollIntoView();
      this.keepPlace('select[data-control="measure"]');
    }
    // ---- Where the view is ----------------------------------------------------------
    // The level drawn, named above the chart once a biomarker is open, each
    // level above it a button that leads back: every biomarker, then this
    // biomarker over time, then the visit or visits open.
    writeTrail(level) {
      const { kit, state } = this;
      if (!this.toolbar) return;
      const old = this.toolbar.querySelector(".bv-trail");
      if (old) old.remove();
      if (level === LEVELS.BIOMARKERS) return;
      const trail = kit.createElement("nav", "bv-trail");
      trail.setAttribute("aria-label", "Where this view is");
      trail.dataset.level = level;
      const list = document.createElement("ol");
      const step = (text2, onClick) => {
        const item = document.createElement("li");
        if (onClick) {
          const button = kit.createElement("button", null, text2);
          button.type = "button";
          button.onclick = onClick;
          item.append(button);
        } else {
          const here = kit.createElement("span", null, text2);
          here.setAttribute("aria-current", "true");
          here.tabIndex = -1;
          item.append(here);
        }
        list.append(item);
      };
      step("All biomarkers", () => this.openTiles());
      const offered = this.visitsOffered();
      if (level === LEVELS.OVER_TIME) {
        step(`${state.measure} over time`);
      } else {
        const chosen = state.visits.filter((visit) => offered.includes(visit));
        const where = state.valueType === "baseline" ? "baseline value" : chosen.length ? listed3(chosen) : "no visit chosen";
        if (hasOverTime(state, offered)) {
          step(`${state.measure} over time`, () => this.openOverTime());
          step(where);
        } else {
          step(`${state.measure}, ${where}`);
        }
      }
      trail.append(list);
      this.toolbar.append(trail);
    }
    // Leads back from a visit to the biomarker over time: every visit is chosen
    // again, as All in the Visit control does.
    openOverTime() {
      this.state.visits = [...this.visits.all];
      this.buildControls();
      this.render();
      this.keepPlace();
    }
    // Leads back from a biomarker to every biomarker, from the trail. The trail
    // leads up the levels, so the tiles are drawn across every visit, as its way
    // back to the biomarker over time restores them: left on the one visit that
    // was open, each tile would be a single point. All Biomarkers in the
    // Biomarker control is the other way there, and keeps the visits chosen.
    openTiles() {
      this.state.visits = [...this.visits.all];
      this.selectMeasure(null);
      this.keepPlace('select[data-control="measure"]');
    }
    // Puts the keyboard's place where the view now drawn is, after a button that
    // the draw removed was pressed: nothing else holds it, and the browser would
    // drop it to the page. It goes to a control of the sidebar, when one is named
    // and is on screen; or to the trail's entry for the level drawn; or, on the
    // tiles, which have no trail, to the first tile.
    keepPlace(control) {
      const visible = (element) => element && element.offsetParent !== null;
      const named2 = control ? this.controls.querySelector(control) : null;
      const here = this.toolbar ? this.toolbar.querySelector(".bv-trail [aria-current]") : null;
      const target = [named2, here, this.root.querySelector(".bv-tile")].find(visible);
      if (target) target.focus();
    }
    // Opens one visit of the biomarker drawn over time: the single-visit view,
    // with its marks, its second grouping, its panels and its pairwise
    // comparisons. The view replaces the picture, so the page is brought back to
    // the chart's top, and the keyboard's place is put on the Visit control.
    openVisit(visit) {
      this.state.visits = [visit];
      this.buildControls();
      this.render();
      if (this.root.getBoundingClientRect().top < 0) this.root.scrollIntoView();
      this.keepPlace('[data-control="visits"] summary');
    }
    // ---- One biomarker over time ---------------------------------------------------
    // One biomarker across every visit it has, in one picture: visit along the
    // bottom, evenly spaced in visit order, and at each visit the groups side by
    // side in their colours. Under the axis, lined up with the visits, a table:
    // each visit's name, which opens that visit alone; the number in each group
    // there; and R's test of the groups there, asked for in one request. The
    // picture and the table are one block, which scrolls sideways inside the
    // chart when the visits are too many for its width.
    drawOverTime(round) {
      const { kit, state, settings } = this;
      const built = buildOverTime(this.drawTables, settings, this.drawingState(), {
        filterMatches: kit.filterMatches
      });
      this.overTime = built;
      this.model = built.model;
      this.chartWrap.classList.add("sv-hidden");
      this.syncTestControls(this.groupsDrawn(built.model));
      this.updateNotes(built.model);
      const domain = timeDomain(built, state.timeMark, state.yScale);
      if (!domain) {
        this.footnote.textContent = nothingDrawn(built.model);
        return;
      }
      this.multiplesWrap.classList.add("bv-time");
      this.footnote.textContent = [
        "Click a visit to view it alone, with its marks, a second grouping and pairwise comparisons.",
        ...this.cutNotes(built)
      ].join(" ");
      const key = kit.createElement("p", "bv-legend bv-time-key");
      const by = state.groupBy ? ` by ${this.labelOf(state.groupBy)}` : "";
      key.append(
        kit.createElement(
          "span",
          null,
          `${TIME_MARK_WORDS[state.timeMark]} ${VALUE_WORDS2[state.valueType]}${by}:`
        )
      );
      built.groups.forEach((group) => {
        const entry = kit.createElement("span");
        entry.dataset.group = group.level;
        const swatch = kit.createElement("span", "bv-legend-swatch");
        swatch.style.background = this.colorOf(group.index);
        entry.append(swatch, document.createTextNode(group.level));
        key.append(entry);
      });
      const caption = kit.createElement(
        "p",
        "bv-tile-caption bv-time-caption",
        TIME_MARK_NOTES[state.timeMark]
      );
      const scroll = kit.createElement("div", "bv-time-scroll");
      const inner = kit.createElement("div", "bv-time-inner");
      const wrap = kit.createElement("div", "bv-time-canvas");
      const canvas = document.createElement("canvas");
      wrap.append(canvas);
      const table = this.timeTable(built);
      inner.append(wrap, table.element);
      scroll.append(inner);
      this.multiplesWrap.append(key, caption, scroll);
      if (this.timeRow) {
        const line = kit.createElement("div", "bv-statistic bv-time-line");
        line.setAttribute("role", "status");
        this.multiplesWrap.append(line);
        this.timeRow.line = line;
      }
      const widest = Math.max(
        0,
        ...table.heads.map((head) => Math.ceil(head.getBoundingClientRect().width))
      );
      const count = built.visits.length;
      const third = Math.max(GUTTER_LEAST, Math.floor(scroll.clientWidth / 3));
      const room = inner.clientWidth - count * VISIT_WIDTH - 8;
      const gutter = Math.min(widest + 10, third, Math.max(GUTTER_LEAST, room));
      table.heads.forEach((head) => {
        head.style.whiteSpace = "normal";
      });
      const least = gutter + count * VISIT_WIDTH + 8;
      const column = (Math.max(inner.clientWidth, least) - gutter - 8) / count;
      const word = this.widestWord(table.names[0].parentElement, built.visits);
      let needed = word + NAME_ROOM;
      if (needed > column) {
        const scale = Math.max(NAME_SCALE_LEAST, (column - NAME_ROOM) / word);
        table.names.forEach((name) => {
          name.style.fontSize = `${scale}em`;
        });
        needed = word * scale + NAME_ROOM;
      }
      inner.style.minWidth = `${Math.ceil(gutter + count * Math.max(VISIT_WIDTH, needed) + 8)}px`;
      const chart = this.drawTimeChart(canvas, built, { domain, gutter, table });
      chart.$overTime = built;
      this.askOverTime(round, built);
    }
    // The width of the longest single word among the visits' names, set as a
    // visit's name is set in the table's heading.
    widestWord(cell, visits2) {
      const probe = this.kit.createElement("span", "bv-time-visit");
      probe.style.cssText = "position:absolute;visibility:hidden;display:inline-block;width:auto;padding:0;border:0;white-space:nowrap";
      cell.append(probe);
      let widest = 0;
      for (const word of new Set(visits2.flatMap((visit) => String(visit).split(/\s+/)))) {
        probe.textContent = word;
        widest = Math.max(widest, probe.getBoundingClientRect().width);
      }
      probe.remove();
      return widest;
    }
    // The table under the picture: a column per visit, a row of the visits'
    // names, a row per group of the number drawn there, and the row of tests.
    timeTable(built) {
      const { kit, state, settings } = this;
      const table = kit.createElement("table", "bv-time-table");
      const tested = settings.statistic && settings.statistic_by_visit;
      table.append(
        kit.createElement(
          "caption",
          null,
          `${state.measure} at each visit: the number in each group` + (tested ? ", and R\u2019s test of the groups." : ".")
        )
      );
      const columns = document.createElement("colgroup");
      const gutter = document.createElement("col");
      const tail = document.createElement("col");
      columns.append(gutter, ...built.visits.map(() => document.createElement("col")), tail);
      table.append(columns);
      const heads = [];
      const heading = (row, text2, sub) => {
        const cell = document.createElement("th");
        cell.scope = "row";
        const words = kit.createElement("span", "bv-time-head");
        words.style.whiteSpace = "nowrap";
        words.style.display = "inline-block";
        words.append(...[].concat(text2));
        if (sub) words.append(sub);
        cell.append(words);
        heads.push(words);
        row.append(cell);
        return cell;
      };
      const head = document.createElement("thead");
      const names = document.createElement("tr");
      names.dataset.row = "visits";
      const corner = document.createElement("th");
      corner.scope = "col";
      const cornerWords = kit.createElement("span", "bv-time-head", "Visit");
      cornerWords.style.whiteSpace = "nowrap";
      cornerWords.style.display = "inline-block";
      corner.append(cornerWords);
      heads.push(cornerWords);
      names.append(corner);
      const visitNames = [];
      built.columns.forEach((column) => {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.dataset.visit = column.visit;
        if (column.tested) {
          const button = kit.createElement("button", "bv-time-visit", column.visit);
          button.type = "button";
          button.dataset.visit = column.visit;
          button.setAttribute("aria-label", `View ${state.measure} at ${column.visit}`);
          button.onclick = () => this.openVisit(column.visit);
          cell.append(button);
          visitNames.push(button);
        } else {
          const still = kit.createElement("span", "bv-time-still", column.visit);
          still.title = `${column.visit} is the baseline visit: there the ${VALUE_WORDS2[state.valueType]} is the same for everyone.`;
          cell.append(still);
          visitNames.push(still);
        }
        names.append(cell);
      });
      names.append(document.createElement("td"));
      head.append(names);
      const body = document.createElement("tbody");
      built.groups.forEach((group) => {
        const row = document.createElement("tr");
        row.dataset.row = "n";
        row.dataset.group = group.level;
        const swatch = kit.createElement("span", "bv-legend-swatch");
        swatch.style.background = this.colorOf(group.index);
        heading(row, [swatch, document.createTextNode(group.level)]);
        built.columns.forEach((column) => {
          const cell = column.cells.find((entry) => entry.level === group.level);
          const count = kit.createElement("td", null, `n = ${cell.n}`);
          count.dataset.visit = column.visit;
          row.append(count);
        });
        row.append(document.createElement("td"));
        body.append(row);
      });
      if (tested) {
        const row = document.createElement("tr");
        row.dataset.row = "test";
        const sub = kit.createElement("span", "bv-time-sub", "p-value");
        const lead = heading(row, "Test", sub);
        body.append(row);
        this.timeRow = { row, lead, sub, built };
      }
      table.append(head, body);
      return { element: table, heads, names: visitNames, gutter, tail };
    }
    // The picture: one Chart.js chart, a dataset per group. Boxes are the kit's;
    // a mean or a median is a point with a bar through it, joined across the
    // visits by its group's line.
    drawTimeChart(canvas, built, { domain, gutter, table }) {
      const { state } = this;
      const mark = state.timeMark;
      const joined = mark !== "box";
      const last = built.visits.length - 1;
      const title = yTitle(this.drawTables.results, this.settings, state);
      const datasets = built.groups.map((group) => {
        const hex = this.colorOf(group.index);
        const data = built.columns.map((column) => {
          const cell = column.cells.find((entry) => entry.level === group.level);
          const made = markOf(cell, mark);
          return made ? { x: cell.x, y: made.centre, made, cell, column } : null;
        }).filter(Boolean);
        return {
          label: group.level,
          data,
          showLine: joined,
          borderColor: hex,
          backgroundColor: hex,
          borderWidth: 2,
          tension: 0,
          // A box's point is unseen, at its median, for the tooltip to hang on.
          pointRadius: joined ? 3.5 : 0,
          pointHoverRadius: joined ? 5 : 0,
          pointHitRadius: 14
        };
      });
      const chart = new this.kit.Chart(canvas.getContext("2d"), {
        type: "scatter",
        data: { datasets },
        options: {
          animation: false,
          maintainAspectRatio: false,
          responsive: true,
          parsing: false,
          interaction: { mode: "nearest", intersect: true },
          onClick: (event) => this.onTimeClick(chart, event),
          layout: { padding: { top: 4, right: 8, bottom: 0, left: 0 } },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: () => "",
                label: (context) => this.timeTooltip(context.raw)
              }
            }
          },
          scales: {
            x: {
              type: "linear",
              min: -0.5,
              max: last + 0.5,
              grid: { display: false },
              // The visits are named in the table beneath, each over its column.
              ticks: { display: false },
              afterBuildTicks: (axis) => {
                axis.ticks = built.visits.map((_, index) => ({ value: index }));
              }
            },
            y: {
              type: state.yScale === "log" ? "logarithmic" : "linear",
              min: domain[0],
              max: domain[1],
              ticks: { includeBounds: false },
              title: { display: true, text: title },
              // As wide as the table's first column, so the visits line up.
              afterFit: (axis) => {
                axis.width = Math.max(axis.width, gutter);
              }
            }
          }
        },
        plugins: [this.timeFrame(built, table), this.timeMarks(built)]
      });
      const said2 = built.groups.map(
        (group, index) => `${group.level} ${datasets[index].data.map((point) => shown(point.y)).join(", ")}`
      ).join("; ");
      canvas.setAttribute("role", "img");
      canvas.setAttribute(
        "aria-label",
        `${title}, ${TIME_MARK_LABELS[mark].toLowerCase()} at ${built.visits.join(", ")}: ${said2}`
      );
      this.charts.push(chart);
      return chart;
    }
    // What the picture draws beside its marks: a faint line between one visit
    // and the next, a dashed line where no change is, and, once the chart is
    // laid out, the widths of the table's columns, so each visit's column is
    // under its place along the axis.
    timeFrame(built, table) {
      const reference = { change: 0, percent_change: 0, fold_change: 1 }[this.state.valueType];
      return {
        id: "gc-time-frame",
        afterLayout: (chart) => {
          const { chartArea, width } = chart;
          if (!chartArea) return;
          table.gutter.style.width = `${chartArea.left}px`;
          table.tail.style.width = `${Math.max(width - chartArea.right, 0)}px`;
        },
        beforeDatasetsDraw: (chart) => {
          const { ctx, chartArea, scales } = chart;
          ctx.save();
          ctx.strokeStyle = "#eef1f4";
          ctx.lineWidth = 1;
          for (let at = 1; at < built.visits.length; at += 1) {
            const x = scales.x.getPixelForValue(at - 0.5);
            ctx.beginPath();
            ctx.moveTo(x, chartArea.top);
            ctx.lineTo(x, chartArea.bottom);
            ctx.stroke();
          }
          if (reference !== void 0 && reference > scales.y.min && reference < scales.y.max) {
            const y = scales.y.getPixelForValue(reference);
            ctx.strokeStyle = "#9aa5b1";
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(chartArea.left, y);
            ctx.lineTo(chartArea.right, y);
            ctx.stroke();
          }
          ctx.restore();
        }
      };
    }
    // The marks of the picture: safety.viz's box for a box, and for a mean or a
    // median the bar through its point, from the lower end to the upper, with a
    // short cap at each.
    timeMarks(built) {
      const mark = this.state.timeMark;
      const cells = built.columns.flatMap((column) => column.cells.filter((cell) => cell.n));
      if (mark === "box") {
        return this.kit.boxWhiskerPlugin(
          "gc-time",
          () => cells.map((cell) => ({
            x: cell.x,
            halfWidth: cell.halfWidth,
            stats: cell.stats,
            color: this.colorOf(cell.index)
          }))
        );
      }
      return {
        id: "gc-time-bars",
        beforeDatasetsDraw: (chart) => {
          const { ctx, scales, chartArea } = chart;
          const yOf = (value) => Math.max(chartArea.top, Math.min(chartArea.bottom, scales.y.getPixelForValue(value)));
          ctx.save();
          ctx.lineWidth = 1.5;
          for (const cell of cells) {
            const made = markOf(cell, mark);
            if (made.upper === made.lower) continue;
            const x = scales.x.getPixelForValue(cell.x);
            const cap = Math.min(5, (scales.x.getPixelForValue(cell.x + cell.halfWidth) - x) * 0.5);
            ctx.strokeStyle = this.colorOf(cell.index);
            ctx.beginPath();
            ctx.moveTo(x, yOf(made.lower));
            ctx.lineTo(x, yOf(made.upper));
            for (const end of [made.lower, made.upper]) {
              ctx.moveTo(x - cap, yOf(end));
              ctx.lineTo(x + cap, yOf(end));
            }
            ctx.stroke();
          }
          ctx.restore();
        }
      };
    }
    timeTooltip(raw) {
      if (!raw || !raw.cell) return "";
      const { cell, column } = raw;
      const { stats } = cell;
      const lead = `${cell.level} at ${column.visit}: n = ${stats.n}`;
      if (this.state.timeMark === "mean_se") {
        return [
          lead,
          `Mean ${shown(stats.mean)}`,
          cell.se === null ? "One participant: no standard error" : `Standard error ${shown(cell.se)}, from ${shown(raw.made.lower)} to ${shown(raw.made.upper)}`
        ];
      }
      return [
        lead,
        `Median ${shown(stats.median)}`,
        `Quartiles ${shown(stats.q25)} to ${shown(stats.q75)}`,
        ...this.state.timeMark === "box" ? [
          `5th to 95th percentile ${shown(stats.q5)} to ${shown(stats.q95)}`,
          `Mean ${shown(stats.mean)}`
        ] : []
      ];
    }
    // A click anywhere in a visit's part of the picture opens that visit, as its
    // name in the table does; the baseline visit of a change is not opened.
    onTimeClick(chart, event) {
      const built = chart.$overTime;
      const { chartArea, scales } = chart;
      if (!built || event.x < chartArea.left || event.x > chartArea.right) return;
      const column = built.columns[Math.round(scales.x.getValueForPixel(event.x))];
      if (column && column.tested) this.openVisit(column.visit);
    }
    // Asks R for the test at every visit, in one request, and fills the row of
    // tests when it answers. With no test chosen, or fewer than two groups, R is
    // not asked, and the row says so.
    askOverTime(round, built) {
      const { settings, state } = this;
      if (!this.timeRow) return;
      const groups = this.groupsDrawn(built.model);
      const test = fitTest(state.test, groups);
      if (test === "none") {
        this.showLevels(plain("none", this.desk.idle(NO_TEST_CHOSEN)), "No test chosen");
        return;
      }
      if (test === null) {
        this.showLevels(
          plain(
            "none",
            noTestText(state.groupBy ? built.groups.map((group) => group.level) : null, false)
          )
        );
        return;
      }
      this.timeRow.test = test;
      const request = overTimeRequest({
        name: settings.statistic_by_visit,
        test,
        adjustment: state.visitAdjustment,
        settings,
        state: this.drawingState(),
        built,
        unscheduled: Boolean(state.unscheduledVisits) && this.unscheduled.visits.length > 0
      });
      const asked = {
        panel: "",
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
          this.showLevels(description);
        },
        {
          levels: true,
          scope: levelsScope({
            group: this.labelOf(state.groupBy),
            untested: built.untested,
            value: VALUE_WORDS2[state.valueType],
            filters: filtersForScope(this)
          })
        }
      );
    }
    // Writes the row of tests and the statistics line beneath from one
    // description. With a result for the visits, each visit's cell holds its
    // p-value as R returned it, or says that it has none, and the row's heading
    // names the adjustment R made; the line names the method, gives R's reason
    // for each visit it did not compute, R's own remarks and what the tests
    // cover. With none, one cell across the visits says so in a few words, and
    // the line says it in full.
    showLevels(description, words) {
      const { kit } = this;
      const { row, lead, sub, built, test, line } = this.timeRow;
      while (lead.nextSibling) lead.nextSibling.remove();
      row.dataset.state = description.state;
      const head = lead.querySelector(".bv-time-head");
      head.firstChild.textContent = test ? TEST_LABELS[test] : "Test";
      const levels = description.levels;
      if (!levels) {
        sub.textContent = "p-value";
        const cell = kit.createElement("td", null, words || ROW_WORDS[description.state] || "");
        cell.colSpan = built.columns.length;
        row.append(cell);
      } else {
        const adjusted = levels.find((level) => level.status === "shown" && level.adjustment);
        sub.textContent = adjusted ? `p, adjusted (${adjusted.adjustment})` : "p, unadjusted";
        built.columns.forEach((column) => {
          const cell = document.createElement("td");
          cell.dataset.visit = column.visit;
          const level = levels.find((entry) => entry.visit === column.visit);
          if (!column.tested) {
            cell.dataset.status = "untested";
            cell.textContent = "not tested";
            cell.title = `${column.visit} is the baseline visit: there the ${VALUE_WORDS2[this.state.valueType]} is the same for everyone.`;
          } else if (!level) {
            cell.dataset.status = "missing";
            cell.textContent = "no answer";
          } else {
            cell.dataset.status = level.status;
            cell.textContent = level.status === "shown" ? level.p : CELL_WORDS[level.status];
            cell.title = level.text;
          }
          row.append(cell);
        });
      }
      row.append(document.createElement("td"));
      writeStatistic(kit, line, { ...description, table: null });
      const after = line.querySelector(".bv-stat-result");
      [...description.details || []].reverse().forEach((said2) => {
        after.after(kit.createElement("p", "bv-stat-level", said2));
      });
    }
    // Above the tiles: what applies to every one of them. The counts of who was
    // drawn and left out are a biomarker's own, and are given when it is opened.
    updateTileNotes(built) {
      const { kit, state } = this;
      const add = (text2) => this.notes.append(kit.createElement("span", null, text2));
      if (built.filtered !== null && built.filtered < this.tables.participants.length) {
        add(`${built.filtered} of ${this.tables.participants.length} participants pass the filters.`);
      }
      if (state.levels) {
        const offered = this.levelsOffered();
        const kept = offered.filter((level) => state.levels.includes(level));
        if (kept.length < offered.length) add(`${kept.length} of ${offered.length} levels shown.`);
      }
      if (state.valueType === "baseline") {
        add("A baseline value has no visit: each group is one point.");
      } else if (state.valueType !== "raw" && built.baselineVisits) {
        add(`Baseline visit: ${built.baselineVisits.join(", ")}.`);
      }
    }
    // Says how many unscheduled visits are left out, and which, whatever level
    // is drawn; nothing when they are drawn or there are none.
    noteHiddenVisits() {
      const hidden = this.hiddenVisits;
      if (!hidden.length) return;
      const one = hidden.length === 1;
      const note = this.kit.createElement(
        "span",
        "bv-hidden-visits",
        `${hidden.length} unscheduled visit${one ? "" : "s"} not drawn: ${listed3(hidden)}. Switch on Unscheduled visits to draw ${one ? "it" : "them"}.`
      );
      note.dataset.hidden = String(hidden.length);
      this.notes.append(note);
    }
    // The baseline visit of a value worked out against one, and that it is not
    // drawn when it was chosen: there the value is the same for everyone.
    addBaselineNote(model, add) {
      if (!model.baselineVisits || this.state.valueType === "raw") return;
      const same = `there the ${VALUE_LABELS[this.state.valueType].toLowerCase()} is the same for everyone.`;
      let said2 = "";
      if (model.visitsNotDrawn.length) said2 = ` It is not drawn: ${same}`;
      else if (this.overTime && this.overTime.untested.length) said2 = ` It is not tested: ${same}`;
      add(`Baseline visit: ${model.baselineVisits.join(", ")}.${said2}`);
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
    drawPanel(canvas, panel, model, { title, domain }) {
      const { state } = this;
      const groupLabel2 = state.groupBy ? this.labelOf(state.groupBy) : "";
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
          label: color === null ? groupLabel2 || "All participants" : color,
          data,
          showLine: false,
          backgroundColor: hexToRgba(hex, 0.55),
          borderColor: hex,
          pointRadius: state.mark === "points" ? 3 : 0,
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
          onClick: (event) => this.onChartClick(chart, panel, event),
          plugins: {
            legend: {
              display: coloured,
              position: "top",
              title: { display: coloured, text: this.labelOf(state.colorBy) }
            },
            tooltip: {
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
              title: { display: Boolean(groupLabel2), text: groupLabel2 },
              ticks: {
                autoSkip: false,
                // A panel turns its labels when they would run together, as a
                // narrow visit panel's long group names would; labels that fit
                // stay level.
                maxRotation: 90,
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
              ticks: { includeBounds: false },
              title: { display: true, text: title }
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
      const overTime = this.level() === LEVELS.OVER_TIME;
      if (overTime) this.addVisitsNote(byVisit, add);
      for (const [visit, { drawn, panel }] of overTime ? [] : byVisit) {
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
    // The notes of one biomarker over time, for all its visits at once: the
    // range of participants drawn at a visit, and each reason anyone was left
    // out with its count added up over the visits. Every number is a sum, or the
    // least and greatest, of what the visits' own notes print.
    addVisitsNote(byVisit, add) {
      const visits2 = [...byVisit.values()];
      if (!visits2.length) return;
      const range = (numbers) => {
        const least = Math.min(...numbers);
        const greatest = Math.max(...numbers);
        return least === greatest ? `${least}` : `${least} to ${greatest}`;
      };
      add(
        `${range(visits2.map((visit) => visit.drawn))} of ${range(visits2.map((visit) => visit.panel.participants))} participants drawn at each visit.`
      );
      const total = (lists) => {
        const sums = /* @__PURE__ */ new Map();
        lists.flat().forEach((entry) => sums.set(entry.reason, (sums.get(entry.reason) || 0) + entry.n));
        return [...sums].map(([reason, n]) => `${n}, ${reason}`);
      };
      const over = `added up over the ${visits2.length} visit${visits2.length === 1 ? "" : "s"}`;
      const left = total(
        visits2.map(({ panel }) => [
          ...panel.dropped,
          ...panel.nonPositive ? [
            {
              reason: "zero or less, which a logarithmic scale cannot show",
              n: panel.nonPositive
            }
          ] : []
        ])
      );
      if (left.length) {
        add(`Left out, ${over}: ${left.join("; ")}. Open a visit for its own counts.`, true);
      }
      const unused = total(
        visits2.map(
          ({ panel }) => panel.unused.filter((entry) => entry.reason !== UNUSED.MISSING_RESULT)
        )
      );
      if (unused.length) add(`Rows not used, ${over}: ${unused.join("; ")}.`, true);
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
        state: this.drawingState(),
        panel,
        // The rows framed hold unscheduled visits only when the results have
        // some and they are switched on.
        unscheduled: Boolean(this.state.unscheduledVisits) && this.unscheduled.visits.length > 0
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
          writeTitles(this);
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
     * What the controls now read, as the settings the chart would open on with
     * them: the part of its specification the controls hold (#68).
     * @returns {object}
     */
    viewSettings() {
      const { state } = this;
      return {
        start_value: state.measure ?? null,
        visits: [...state.visits],
        value_type: state.valueType,
        group_by: state.groupBy ? this.groupingOf(state.groupBy) : null,
        levels: state.levels ?? null,
        color_by: state.colorBy || null,
        panel_by: state.panelBy ? this.groupingOf(state.panelBy) : null,
        mark: state.mark,
        time_mark: state.timeMark,
        y_scale: state.yScale,
        tile_summary: state.tileSummary,
        unscheduled_visits: Boolean(state.unscheduledVisits),
        test: state.test,
        pairwise: state.pairwise,
        visit_adjustment: state.visitAdjustment
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
     * heading. On the trend tiles, one row per participant, biomarker and visit:
     * the values each point is the median or the mean of (#78, #84). For one
     * biomarker over time, one row per participant and visit (#85).
     * @returns {{columns: Array<{value_col: string, label: string}>, rows: object[]}}
     */
    tableOf() {
      const { model, state, settings, tiles } = this;
      if (!model && tiles) return this.tilesTable();
      if (!model || !model.panels) return { columns: [], rows: [] };
      const visits2 = model.panels.some((panel) => panel.visit !== null && panel.visit !== void 0);
      const columns = [{ value_col: settings.id_col, label: "Participant" }];
      if (visits2) columns.push({ value_col: "visit", label: "Visit" });
      if (state.groupBy) columns.push({ value_col: "x", label: this.labelOf(state.groupBy) });
      if (state.colorBy) columns.push({ value_col: "color", label: this.labelOf(state.colorBy) });
      if (state.panelBy) columns.push({ value_col: "panel", label: this.labelOf(state.panelBy) });
      columns.push({
        value_col: "y",
        label: `${state.measure}, ${VALUE_LABELS[state.valueType] || state.valueType}`
      });
      const rows = model.panels.flatMap(
        (panel) => panel.records.map((record) => ({ ...record, visit: panel.visit }))
      );
      return { columns, rows };
    }
    // The tiles' table: every value behind a point of any tile, each row naming
    // its biomarker and its visit. The tiles draw no colour and no panel column;
    // the values are of the one value type the controls choose.
    tilesTable() {
      const { tiles, state, settings } = this;
      const visits2 = state.valueType !== "baseline";
      const columns = [
        { value_col: settings.id_col, label: "Participant" },
        { value_col: "biomarker", label: "Biomarker" }
      ];
      if (visits2) columns.push({ value_col: "visit", label: "Visit" });
      if (state.groupBy) columns.push({ value_col: "x", label: this.labelOf(state.groupBy) });
      columns.push({ value_col: "y", label: VALUE_LABELS[state.valueType] || state.valueType });
      const rows = tiles.tiles.flatMap(
        (tile) => tile.records.map((record) => ({ ...record, biomarker: tile.measure }))
      );
      return { columns, rows };
    }
    /** The placeholders a download's file name is made of, after the chart's name. */
    get viewFields() {
      return ["measure", "visits", "group"];
    }
    /**
     * What the title, subtitle and footnotes' placeholders hold for the view now
     * drawn, beside `{date}`, `{version}` and `{filters}` (#66).
     * @returns {object}
     */
    placeholders() {
      const { state, model, tiles } = this;
      const records = model ? model.panels.flatMap((panel) => panel.records) : tiles ? tiles.tiles.flatMap((tile) => tile.records) : [];
      const ids = /* @__PURE__ */ new Set();
      for (const record of records) ids.add(record[this.settings.id_col] ?? record.id);
      return {
        measure: state.measure ?? "every biomarker",
        visits: this.visitsDrawn().join(", "),
        value: VALUE_LABELS[state.valueType] || state.valueType,
        group: state.groupBy ? this.labelOf(state.groupBy) : "",
        n: model || tiles ? ids.size : ""
      };
    }
    /**
     * What the chart has asked R for the panels now drawn, and what R answered:
     * one entry per panel that asked, in the order the panels are drawn. One
     * biomarker over time is one entry, the request for the test at every visit,
     * whose `panel` is empty. A request is exactly what the connection was
     * given, so it is the key a stored result must carry to be found.
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
    // How each cut variable on the chart was cut, a sentence each.
    cutNotes(model) {
      return ["x", "panel"].filter((field) => model.cuts && model.cuts[field]).map((field) => cutNote(model.cuts[field].spec, model.cuts[field]));
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
  function variableOf(axis) {
    if (axis.kind === "column") return { col: axis.col, type: "number" };
    return axis.value === "baseline" ? { measure: axis.measure, value: "baseline" } : { measure: axis.measure, visit: axis.visit, value: axis.value };
  }
  function settingOf(axis) {
    if (axis.kind === "column") return { col: axis.col };
    return {
      measure: axis.measure,
      value: axis.value,
      ...axis.value === "baseline" ? {} : { visit: axis.visit }
    };
  }
  var sameAxis = (a, b) => JSON.stringify(settingOf(a)) === JSON.stringify(settingOf(b));

  // src/association-scatter/structureData.js
  var RELATIVE2 = /* @__PURE__ */ new Set(["change", "fold_change", "percent_change"]);
  function axisOffered(axis, { measures, visits: visits2, numbers }) {
    if (!axis) return false;
    if (axis.kind === "column") return numbers.some((entry) => entry.value_col === axis.col);
    if (!measures.includes(axis.measure)) return false;
    return axis.value === "baseline" || visits2.includes(axis.visit);
  }
  function openingAxes(settings, offered) {
    const { measures, visits: visits2, numbers } = offered;
    const missing = [];
    const named2 = (key) => {
      if (!settings[key]) return null;
      const axis = axisOf(settings[key]);
      if (axisOffered(axis, offered)) return axis;
      missing.push(key);
      return null;
    };
    const at = (measure, visit) => ({ kind: "measure", measure, value: "raw", visit });
    const first = measures.length && visits2.length ? at(measures[0], visits2[0]) : numbers.length ? { kind: "column", col: numbers[0].value_col } : null;
    const x = named2("x") || first;
    let y = named2("y");
    if (!y && x) {
      if (measures.length > 1 && visits2.length) y = at(measures[1], visits2[0]);
      else if (measures.length && visits2.length > 1) y = at(measures[0], visits2[1]);
      else if (numbers.length) y = { kind: "column", col: numbers[0].value_col };
      else y = x;
    }
    return { x, y, missing };
  }
  function axisTitle(results, settings, axis, numbers = []) {
    if (axis.kind === "column") {
      const found = numbers.find((entry) => entry.value_col === axis.col);
      return found ? found.label : axis.col;
    }
    const words = label(variableOf(axis));
    if (axis.value === "fold_change") return words;
    if (axis.value === "percent_change") return `${words} (%)`;
    const unit = unitOf(results, settings, axis.measure);
    return unit ? `${words} (${unit})` : words;
  }
  function flatAtBaseline(axis, results, settings) {
    if (axis.kind !== "measure" || !RELATIVE2.has(axis.value)) return false;
    const config = coreSettings(settings);
    const baseline = config.baseline_visits || visits(results, config).slice(0, 1);
    return baseline.length === 1 && baseline[0] === axis.visit;
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
  var plain2 = (state, said2) => ({ ...sentence(state, said2), table: null });
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
    const said2 = [
      `This coefficient is of the ${n} participant${n === 1 ? "" : "s"} ` + (panel ? `drawn in this panel (${panel}).` : "drawn.")
    ];
    if (panel) {
      said2.push(
        "Each panel has a coefficient of its own, and they are not adjusted for one another."
      );
    }
    if (color) {
      said2.push(
        `It takes every level of ${color} together; the table gives each level its own, and they are not adjusted for one another.`
      );
    }
    if (filters.length) said2.push(filtersSaid(filters));
    return said2.join(" ");
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
      waiting: (said2, context) => plain2("waiting", isFit(context) ? said2.replace(/^Statistics/, "Fitted line") : said2)
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
      if (this.desk) this.desk.retire();
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
      this.touch = Boolean(globalThis.matchMedia && globalThis.matchMedia("(pointer: coarse)").matches) || (globalThis.navigator ? globalThis.navigator.maxTouchPoints > 0 : false);
      this.buildToolbar();
    }
    buildToolbar() {
      const { kit } = this;
      mountToolbar(this);
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
     * @param {object} [settings] Settings to change with the tables, when the new
     *   tables need them: a participant table whose id column has another name
     *   comes with `participant_id_col`. The tables are checked against these.
     * @returns {AssociationScatter} The chart, for chaining.
     */
    setData(data, settings) {
      if (settings === void 0 || settings === null) {
        this.tables = readGiven(this, data);
      } else {
        this.tables = readGiven(this, data, syncSettings2({ ...this.settings, ...settings }));
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
     * what the chart opens on (`x`, `y`, `color_by`, `panel_by`, `x_scale`,
     * `y_scale`, `fit`, `method`, `filters`) moves its control, so
     * `setSettings({ x, y })` opens the chart on another pair of variables.
     * @param {object} settings The settings to change.
     * @returns {AssociationScatter} The chart, for chaining.
     */
    setSettings(settings) {
      const given2 = settings || {};
      const next = syncSettings2({ ...this.settings, ...given2 });
      checkTables(this.tables, next);
      this.settings = next;
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
        filters: startFilters(this)
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
    titleOf(axis) {
      return axisTitle(this.tables.results, this.settings, axis, this.numbers);
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
        const axis = state[key];
        if (!axis) return;
        const section = addSection(title);
        const named2 = (text2) => `${title}: ${text2}`;
        const variables = [
          ...this.measures.map((measure) => [`m:${measure}`, measure]),
          ...this.numbers.map((entry) => [`c:${entry.value_col}`, `${entry.label} (participant)`])
        ];
        select(
          `${key}-variable`,
          named2("Variable"),
          variables,
          axis.kind === "column" ? `c:${axis.col}` : `m:${axis.measure}`,
          (next) => {
            const name = next.slice(2);
            state[key] = next.startsWith("c:") ? { kind: "column", col: name } : {
              kind: "measure",
              measure: name,
              value: axis.kind === "measure" ? axis.value : "raw",
              visit: axis.kind === "measure" ? axis.visit : this.visits[0] ?? null
            };
            redraw(true);
          },
          section
        );
        if (axis.kind === "measure") {
          select(
            `${key}-value`,
            named2("Value"),
            VALUE_TYPES.map((type) => [type, VALUE_LABELS[type]]),
            axis.value,
            (next) => {
              axis.value = next;
              axis.visit = next === "baseline" ? null : axis.visit ?? this.visits[0] ?? null;
              redraw(true);
            },
            section
          );
          if (axis.value !== "baseline") {
            select(
              `${key}-visit`,
              named2("Visit"),
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
          named2("Scale"),
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
      drawSafely(this, () => this.draw());
    }
    // Everything render() draws. drawSafely says so in the element when it fails.
    draw() {
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
      if (model.baselineVisits && [state.x, state.y].some((axis) => axis.value !== "raw")) {
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
            writeTitles(this);
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
          writeTitles(this);
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
     * What the controls now read, as the settings the chart would open on with
     * them: the part of its specification the controls hold (#68).
     * @returns {object}
     */
    viewSettings() {
      const { state } = this;
      return {
        ...state.x ? { x: settingOf(state.x) } : {},
        ...state.y ? { y: settingOf(state.y) } : {},
        color_by: state.colorBy || null,
        panel_by: state.panelBy || null,
        x_scale: state.xScale,
        y_scale: state.yScale,
        fit: state.fit,
        method: state.method
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
      if (!model || !model.panels) return { columns: [], rows: [] };
      const columns = [
        { value_col: settings.id_col, label: "Participant" },
        { value_col: "x", label: this.titleOf(state.x) },
        { value_col: "y", label: this.titleOf(state.y) }
      ];
      if (state.colorBy) columns.push({ value_col: "color", label: this.labelOf(state.colorBy) });
      if (state.panelBy) columns.push({ value_col: "panel", label: this.labelOf(state.panelBy) });
      return { columns, rows: model.panels.flatMap((panel) => panel.records) };
    }
    /** The placeholders a download's file name is made of, after the chart's name. */
    get viewFields() {
      return ["y", "x"];
    }
    /**
     * What the title, subtitle and footnotes' placeholders hold for the view now
     * drawn, beside `{date}`, `{version}` and `{filters}` (#66).
     * @returns {object}
     */
    placeholders() {
      const { state, model } = this;
      return {
        x: state.x ? this.titleOf(state.x) : "",
        y: state.y ? this.titleOf(state.y) : "",
        n: model ? model.drawn : ""
      };
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

  // src/correlation-matrix/structureData.js
  var RELATIVE3 = /* @__PURE__ */ new Set(["change", "fold_change", "percent_change"]);
  var VALUE_WORDS3 = {
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
    const named2 = (list) => list.map((entry, index) => ({ name: `v${index + 1}`, label: entry.label, axis: entry.axis }));
    if (state.mode === "visits") {
      const heading2 = `${state.measure}: ${VALUE_WORDS3[value].toLowerCase()}, visit against visit`;
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
        variables: named2(
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
    const heading = `${VALUE_WORDS3[value]}${at}, biomarker against biomarker`;
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
      variables: named2(
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
    const [{ axis }] = variables;
    if (axis.value === "fold_change") return null;
    if (axis.value === "percent_change") return "%";
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
      dropped: [],
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
      // With no variable required, who is left out is who the participant table
      // does not have.
      dropped: made.dropped,
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
  function markOf2(estimate) {
    const strength = Math.min(1, Math.abs(estimate));
    const lightness = Math.round(86 - 54 * strength);
    const negative = estimate < 0;
    return {
      sign: negative ? "negative" : "positive",
      size: Math.round(14 + 78 * strength),
      color: negative ? `hsl(18, 82%, ${lightness}%)` : `hsl(217, 78%, ${lightness}%)`
    };
  }
  function numberOf2(estimate) {
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
  var plain3 = (state, said2) => ({ ...sentence(state, said2), table: null, pairs: null });
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
    const said2 = formatted.status === "shown" ? `${lead}: ${name} ${formatted.text}` : `${lead}: ${formatted.text}`;
    return warning ? `${said2} R warned: ${warning}.` : said2;
  }
  function scopeText3({ n, filters = [] }) {
    const said2 = [
      `${n} participant${n === 1 ? " is" : "s are"} in the frame. A cell is of the ones who have both of its values, so each cell has its own count, and the cells are not adjusted for one another.`
    ];
    if (filters.length) said2.push(filtersSaid(filters));
    return said2.join(" ");
  }
  function createStatisticDesk3({ connection, note = null }) {
    return createDesk({
      connection,
      note,
      describe: describeMatrix,
      waiting: (said2) => plain3("waiting", said2)
    });
  }

  // src/correlation-matrix.js
  var MODULE_CLASS2 = "bv-correlation-matrix";
  var STYLE_ID3 = "bio-viz-correlation-matrix-styles";
  var C = `.${MODULE_CLASS2}`;
  var STYLES3 = `${lineStyles(C)}
${C} .bv-matrix{margin:0 0 .6rem;border:1px solid #d8dee4;border-radius:10px;background:#fff;padding:.8rem}
${ownHeading(`${C} .bv-matrix-title`, 600)}
${C} .bv-matrix-title{margin:0 0 .6rem;font-size:.92rem;color:#1f2933}
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
${ownTable(`${C} .bv-pairs-table`)}
/* The list is in the kit's listing, whose headings are small capitals: the
   chart states them itself, where it leaned on the kit's rule before (#97). */
${C} .bv-pairs table{width:100%;border-collapse:collapse;background:#fff;table-layout:fixed}
${C} .bv-pairs th,${C} .bv-pairs td{border-bottom:1px solid #e3e8ee;padding:.4rem .5rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}
${C} .bv-pairs th{font-size:.75rem;letter-spacing:.03em;text-transform:uppercase;color:#52616f}
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
      if (this.desk) this.desk.retire();
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
     * @param {object} [settings] Settings to change with the tables, when the new
     *   tables need them: a participant table whose id column has another name
     *   comes with `participant_id_col`. The tables are checked against these.
     * @returns {CorrelationMatrix} The chart, for chaining.
     */
    setData(data, settings) {
      this.close();
      if (settings === void 0 || settings === null) {
        this.tables = readGiven(this, data);
      } else {
        this.tables = readGiven(this, data, syncSettings3({ ...this.settings, ...settings }));
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
      const given2 = settings || {};
      const next = syncSettings3({ ...this.settings, ...given2 });
      checkTables(this.tables, next);
      this.close();
      this.settings = next;
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
        if (Array.isArray(chosen) && !chosen.length) return [];
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
      drawSafely(this, () => this.draw());
    }
    // Everything render() draws. drawSafely says so in the element when it fails.
    draw() {
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
          writeTitles(this);
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
      model.dropped.forEach((entry) => add(`${entry.n} left out: ${entry.reason}.`, true));
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
        const said2 = `${cellText(pair, labels, name)} Open the scatter.`;
        button.setAttribute("aria-label", said2);
        button.title = said2;
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
        button.append(kit.createElement("span", "bv-num", numberOf2(pair.estimate)));
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
      const { sign, size, color } = markOf2(estimate);
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
        item.append(box, document.createTextNode(numberOf2(value)));
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
      const tools = kit.createElement("div", "bv-pairs-tools bv-no-picture");
      const download = kit.createElement("button", null, "Download: CSV");
      download.type = "button";
      download.onclick = () => downloadCsv(
        kit,
        rows.map((row) => ({ ...row, warning: row.warning || "" })),
        columns,
        "bio.viz-correlation-matrix-pairs.csv"
      );
      tools.append(download);
      const table = kit.createElement("table", "bv-pairs-table");
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
          { value_col: settings.id_col, label: "Participant" },
          ...model.variables.map((variable2) => ({ value_col: variable2.name, label: variable2.label }))
        ],
        rows: model.records
      };
    }
    /** The placeholders a download's file name is made of, after the chart's name. */
    get viewFields() {
      return ["heading"];
    }
    /**
     * What the title, subtitle and footnotes' placeholders hold for the view now
     * drawn, beside `{date}`, `{version}` and `{filters}` (#66).
     * @returns {object}
     */
    placeholders() {
      const { state, model } = this;
      return {
        heading: model && model.heading ? model.heading : "",
        variables: model && model.variables ? model.variables.length : "",
        visit: state.visit ?? "",
        value: VALUE_LABELS[state.valueType] || state.valueType || "",
        n: model && model.records ? model.records.length : ""
      };
    }
    /** What R's counts are of, for the footnote the chart writes. */
    get footnoteCounts() {
      return "variables";
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

  // src/stratified-survival/drag.js
  var dropPoint = (value) => Number(writePoint(value));
  function movePoints(points, index, value, { drop = false, min = -Infinity, max = Infinity } = {}) {
    if (!Number.isFinite(value) || index < 0 || index >= points.length) return null;
    const inside = Math.min(max, Math.max(min, value));
    const point = drop ? Math.min(max, Math.max(min, dropPoint(inside))) : inside;
    const below = index > 0 ? points[index - 1] : -Infinity;
    const above = index < points.length - 1 ? points[index + 1] : Infinity;
    if (!(point > below && point < above)) return null;
    const written = writePoint(point);
    if (index > 0 && writePoint(below) === written || index < points.length - 1 && writePoint(above) === written) {
      return null;
    }
    return points.map((each, i) => i === index ? point : each);
  }

  // src/stratified-survival/statistic.js
  var ONE_GROUP = "Statistics: no test. The log-rank test compares two or more groups, and one is drawn.";
  var keyOrder = (by, levels) => isCut(by) ? [...levels].reverse() : [...levels];
  var readsBaseline = (by) => isCut(by) && typeof by.measure === "string" && by.value !== void 0 && by.value !== "raw";
  function survivalRequest({ name, settings, state, model }) {
    const filters = filtersInForce(state.filters);
    const { field } = flagOf(settings);
    const baseline = readsBaseline(state.groupBy);
    return {
      name,
      data: model.records.map((record) => ({
        [settings.id_col]: record[settings.id_col],
        time: record.time,
        group: record.group,
        [field]: record.flag
      })),
      args: {
        strTimeCol: "time",
        strGroupCol: "group",
        ...field === "censor" ? { strCensorCol: "censor" } : { strEventCol: "event" },
        chrGroups: keyOrder(state.groupBy, model.levels)
      },
      dataId: {
        chart: "stratified-survival",
        endpoint: state.endpoint,
        group_by: state.groupBy,
        ...baseline && settings.baseline_visits ? { baseline_visits: [...settings.baseline_visits] } : {},
        ...baseline ? { baseline_stat: settings.baseline_stat } : {},
        ...Object.keys(filters).length ? { filters } : {}
      },
      rows: model.records.length
    };
  }
  function describeAnswer2(result, context = {}) {
    if (result && result.status === "ok") {
      const value = result.value && typeof result.value === "object" ? result.value : {};
      const formatted = formatStatistic(value);
      const described = sentence(formatted.status, formatted.text);
      if (formatted.status === "shown") {
        const rows = (Array.isArray(value.estimates) ? value.estimates : []).filter(
          (row) => row && typeof row === "object"
        );
        const order2 = context.levels || [];
        const place = (row) => {
          const at = order2.indexOf(row.group);
          return at < 0 ? order2.length : at;
        };
        const medians = rows.filter((row) => row.name === "Median");
        medians.sort((a, b) => place(a) - place(b));
        described.estimates = [
          ...medians.map((row) => formatMedian(row).text),
          ...rows.filter((row) => row.name !== "Median").map(
            (row) => formatEstimate(
              // For a cut, R's first group is the higher: the ratio says so.
              row.name === "Hazard ratio" && context.highOverLow ? { ...row, name: "Hazard ratio, high over low" } : row
            ).text
          )
        ];
      }
      described.remarks = remarksOf(value);
      described.scope = context.scope || null;
      return described;
    }
    const failure = failureOf(result);
    return sentence(failure.state, failure.text);
  }
  function scopeText4({ n, endpoint, filters = [] }) {
    const said2 = [`This test is of the ${n} participant${n === 1 ? "" : "s"} drawn, on ${endpoint}.`];
    if (filters.length) said2.push(filtersSaid(filters));
    return said2.join(" ");
  }
  function createStatisticDesk4({ connection, note = null }) {
    return createDesk({ connection, note, describe: describeAnswer2 });
  }

  // src/stratified-survival/structureData.js
  var grouping = (by) => isCut(by) ? by : { col: by };
  function timeTicks(last) {
    if (!(last > 0)) return [0];
    const rough = last / 5;
    const power = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((candidate) => candidate >= rough);
    const ticks = [];
    for (let i = 0; i * step <= last * (1 + 1e-12); i += 1) {
      ticks.push(Number((i * step).toPrecision(12)));
    }
    return ticks;
  }
  function histogramOf(values, count = 24) {
    if (!values.length) return [];
    const low = Math.min(...values);
    const high = Math.max(...values);
    if (low === high) return [{ from: low, to: high, n: values.length }];
    const width = (high - low) / count;
    const bars = Array.from({ length: count }, (_, i) => ({
      from: low + i * width,
      to: i === count - 1 ? high : low + (i + 1) * width,
      n: 0
    }));
    for (const value of values) {
      bars[Math.min(count - 1, Math.floor((value - low) / width))].n += 1;
    }
    return bars;
  }
  function buildSurvival({ results, participants, outcomes }, settings, state, { kmEstimate, filterMatches }) {
    const config = coreSettings(settings);
    const idCol = config.id_col;
    const { participants: kept, results: rows } = keepFiltered(
      { results, participants },
      settings,
      state.filters,
      filterMatches
    );
    const empty = {
      records: [],
      levels: [],
      curves: [],
      times: [0],
      cut: null,
      values: [],
      bars: [],
      participants: kept ? kept.length : 0,
      dropped: [],
      unused: [],
      filtered: kept ? kept.length : null,
      last: 0
    };
    if (!rows.length || !state.groupBy || state.endpoint === null) return empty;
    const participantIdCol = settings.participant_id_col || idCol;
    const known = new Set(
      (participants || results).map((row) => row[participants ? participantIdCol : idCol]).filter((id) => !isBlank3(id)).map(String)
    );
    const outcomeOf = outcomesOf(outcomes, settings, state.endpoint, known);
    const strangers = outcomeOf.strangers;
    const hasOutcome = (id) => !isBlank3(id) && !outcomeOf(id).reason;
    const cut = isCut(state.groupBy) ? cutOf(
      kept ? {
        results: rows,
        participants: kept.filter((row) => hasOutcome(row[participantIdCol]))
      } : { results: rows.filter((row) => hasOutcome(row[idCol])), participants: null },
      state.groupBy,
      settings
    ) : null;
    const made = frame(
      { results: rows, participants: kept || void 0 },
      { group: grouping(state.groupBy) },
      config
    );
    const left = /* @__PURE__ */ new Map();
    const leave = (reason) => left.set(reason, (left.get(reason) || 0) + 1);
    const records = [];
    const values = [];
    for (const record of made.data) {
      const id = String(record[idCol]);
      const outcome = outcomeOf(id);
      if (outcome.reason) {
        leave(outcome.reason);
        continue;
      }
      if (cut) values.push(record.group);
      records.push({
        [idCol]: id,
        group: cut ? groupLabel(record.group, cut) : String(record.group),
        // The value a cut was made from, for the table download (#70 review).
        ...cut ? { value: record.group } : {},
        time: outcome.time,
        flag: outcome.flag,
        event: outcome.event
      });
    }
    const levels = cut ? cut.labels.filter((label2) => records.some((record) => record.group === label2)) : categoriesOf(records.map((record) => record.group));
    const last = records.reduce((most, record) => Math.max(most, record.time), 0);
    const times = settings.at_risk_times || timeTicks(last);
    const curves = levels.map((level) => {
      const members = records.filter((record) => record.group === level);
      const estimate = kmEstimate(
        members.map((record) => ({ id: record[idCol], time: record.time, event: record.event }))
      );
      return {
        level,
        n: members.length,
        events: members.filter((record) => record.event).length,
        estimate,
        risk: estimate.riskTableAt(times)
      };
    });
    return {
      ...empty,
      records,
      levels,
      curves,
      times,
      cut,
      values,
      bars: cut ? histogramOf(values) : [],
      participants: made.participants,
      dropped: [...made.dropped, ...[...left].map(([reason, n]) => ({ reason, n }))],
      unused: [
        ...made.unused,
        ...strangers ? [{ reason: OUTCOME_UNUSED.NO_PARTICIPANT, n: strangers }] : []
      ],
      last
    };
  }
  function atRisk(model, level, time) {
    return model.records.filter((record) => record.group === level && record.time >= time);
  }

  // src/stratified-survival.js
  var MODULE_CLASS3 = "bv-stratified-survival";
  var EXPERIMENTAL_NOTE = "This chart is experimental: its curves are safety.viz\u2019s Kaplan\u2013Meier estimator, kmEstimate, which awaits its clinical review. It is tested and documented, but its behaviour and settings may change.";
  var STYLE_ID4 = "bio-viz-stratified-survival-styles";
  var C2 = `.${MODULE_CLASS3}`;
  var STYLES4 = `${lineStyles(C2)}
${toolbarStyles(C2)}
${C2} .bv-chart-wrap{height:var(--bv-curves-height,340px);position:relative}
${C2} .bv-risk-wrap{margin:.5rem 0 .8rem;max-width:100%;overflow-x:auto}
${ownTable(`${C2} .bv-risk`)}
${C2} .bv-risk{border-collapse:collapse;font-size:.8rem;color:#1f2933;font-variant-numeric:tabular-nums}
${C2} .bv-risk caption{caption-side:top;text-align:left;font-weight:600;padding:0 0 .3rem}
${C2} .bv-risk th,${C2} .bv-risk td{border:1px solid #d8dee4;padding:0;text-align:right;white-space:nowrap}
${C2} .bv-risk thead th{background:#f6f8fa;font-weight:600;padding:.2rem .5rem}
${C2} .bv-risk tbody th{text-align:left;background:#f6f8fa}
${C2} .bv-risk button{display:block;width:100%;margin:0;border:0;background:transparent;padding:.25rem .5rem;font:inherit;text-align:inherit;color:inherit;cursor:pointer}
${C2} .bv-risk button:hover{background:#f4f8fc}
${C2} .bv-risk button:focus-visible{outline:2px solid #0b62a4;outline-offset:-2px}
${C2} .bv-swatch{display:inline-block;width:.7rem;height:.7rem;margin-right:.35rem;border-radius:2px;vertical-align:-1px}
${C2} .bv-hist{margin:0 0 .6rem}
${C2} .bv-hist-canvas{height:150px;position:relative;touch-action:pan-y}
${C2} .bv-cut-handle{position:absolute;width:18px;margin-left:-9px;cursor:ew-resize;border-radius:3px}
${C2} .bv-cut-handle:focus-visible{outline:2px solid #0b62a4;outline-offset:0}
${C2} .bv-hist-canvas canvas{cursor:ew-resize}
${C2} .bv-hist-canvas canvas:focus-visible{outline:2px solid #0b62a4;outline-offset:2px}
${C2} .bv-cut-counts{margin:.25rem 0 0;font-size:.8rem;color:#52616f}
${C2} .bv-control-note{display:block;margin:.2rem 0 0;font-size:.75rem;color:#52616f}`;
  var HINT2 = "Click a curve, or a count of the at-risk strip, to list its participants and open a participant\u2019s profile.";
  var DRAG_HINT = "Drag a cut line on the histogram to move it: the curves follow, and R is asked when it is let go.";
  var MOVING = "Statistics: R is asked when the cut line is let go. The curves are drawn for the cut where it is now.";
  var NEEDS_OUTCOMES = "This chart needs an outcomes table: give `outcomes`, one row per participant and endpoint, with a time and a flag, as `init({ results, participants, outcomes })`.";
  var CUT_KEY2 = "bv-cut:";
  var MOVED_KEY = "bv-cut:moved";
  var GRIP = 10;
  var TOUCH_GRIP = 24;
  var BUDGE = 3;
  var SETTLE = 400;
  var uncutLabel = (spec) => {
    const plain5 = { ...spec };
    delete plain5.cut;
    return label(plain5);
  };
  var StratifiedSurvival = class {
    constructor(element, settings) {
      this.kit = findKit("the stratified survival chart");
      this.element = typeof element === "string" ? document.querySelector(element) : element;
      if (!this.element) {
        throw new Error(`bio.viz: stratified survival target not found: ${element}`);
      }
      this.settings = syncSettings6(settings);
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
      this.desk = createStatisticDesk4({
        connection: this.connection,
        note: this.settings.waiting_note
      });
    }
    renderShell() {
      mountShell(this, {
        moduleClass: MODULE_CLASS3,
        styleId: STYLE_ID4,
        styles: STYLES4,
        listingFile: "bio.viz-stratified-survival-listing.csv"
      });
      const { kit } = this;
      const banner = kit.createElement("div", "sv-experimental");
      banner.setAttribute("role", "note");
      banner.append(
        kit.createElement("span", "sv-prototype-tag", "Experimental"),
        kit.createElement("span", "sv-prototype-text", EXPERIMENTAL_NOTE)
      );
      this.main.prepend(banner);
      this.riskWrap = kit.createElement("div", "bv-risk-wrap");
      this.histWrap = kit.createElement("div", "bv-hist");
      this.histBox = kit.createElement("div", "bv-hist-canvas");
      this.histCanvas = document.createElement("canvas");
      this.histCanvas.tabIndex = 0;
      this.histBox.append(this.histCanvas);
      this.cutCounts = kit.createElement("p", "bv-cut-counts");
      this.histWrap.append(this.histBox, this.cutCounts);
      this.chartWrap.after(this.riskWrap);
      this.riskWrap.after(this.histWrap);
      this.listenToHistogram();
      this.canvas.addEventListener("click", (event) => {
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
      const next = settings === void 0 || settings === null ? this.settings : syncSettings6(laidOver(this.settings, settings));
      const given2 = Array.isArray(data) ? { results: data } : data || {};
      const read2 = readGiven(this, given2, next);
      const outcomes = readOutcomesGiven(this, given2.outcomes, next);
      this.tables = { ...read2, outcomes };
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
      const given2 = settings || {};
      const next = syncSettings6(laidOver(this.settings, given2));
      checkTables(this.tables, next);
      if (this.tables.outcomes) checkOutcomes(this.tables.outcomes, next);
      this.settings = next;
      syncHost(this);
      if ("back" in given2) mountToolbar(this);
      if ("connection" in given2 || "waiting_note" in given2) this.connect();
      this.readTables();
      const opening = this.seedState();
      const moved = { endpoint: "endpoint", group_by: "groupBy", filters: "filters" };
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
    // What the controls can offer, read from the tables and the settings.
    readTables() {
      const { results, outcomes } = this.tables;
      const { settings } = this;
      this.measures = results.length ? listMeasures(results, settings) : [];
      this.categories = results.length ? categoryColumns(this.tables, settings) : [];
      this.filterSpecs = filterColumns(this.tables, settings, this.categories).map(
        (spec) => this.kit.normalizeFilterSpec(spec)
      );
      this.endpoints = outcomes ? listEndpoints(outcomes, settings) : [];
      const moved = this.cutOptions.find((entry) => entry.key === MOVED_KEY);
      this.cutOptions = [];
      for (const by of [settings.group_by, ...settings.cuts || []]) {
        if (!isCut(by)) continue;
        const written = JSON.stringify(by);
        if (this.cutOptions.some((entry) => JSON.stringify(entry.spec) === written)) continue;
        this.cutOptions.push({
          key: `${CUT_KEY2}${this.cutOptions.length}`,
          spec: by,
          label: label(by)
        });
      }
      if (moved) this.cutOptions.push(moved);
    }
    cutKey(by) {
      const written = JSON.stringify(by);
      return this.cutOptions.find((entry) => JSON.stringify(entry.spec) === written).key;
    }
    offers(value) {
      return this.categories.some((entry) => entry.value_col === value) || this.cutOptions.some((entry) => entry.key === value);
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
      const named2 = endpoints.find((entry) => entry.endpoint === settings.endpoint);
      return {
        endpoint: named2 ? named2.endpoint : endpoints[0] ? endpoints[0].endpoint : null,
        groupBy,
        filters: startFilters(this)
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
      this.controls.innerHTML = "";
      const { addSection, addControl, addReset } = kit.controlBuilders(this.controls);
      const redraw = () => this.render();
      const select = (name, labelText, options2, selected, onChange, parent) => {
        const input = document.createElement("select");
        input.dataset.control = name;
        input.setAttribute("aria-label", labelText);
        options2.forEach(([value, text2]) => kit.option(input, value, text2, value === selected));
        input.onchange = () => onChange(input.value);
        return addControl(labelText, input, parent);
      };
      const view = addSection("View");
      if (this.endpoints.length) {
        select(
          "endpoint",
          "Endpoint",
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
          "group-by",
          "Groups",
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
          view.append(kit.createElement("small", "bv-control-note", DRAG_HINT));
        }
      } else {
        view.append(
          kit.createElement(
            "p",
            "sv-warning bv-no-groups",
            "No column can make a group. Give a participant table, or carry a column on the results rows."
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
      this.notes.innerHTML = "";
      this.riskWrap.innerHTML = "";
      this.multiplesWrap.innerHTML = "";
      this.cutCounts.textContent = "";
      this.clearHandles();
      this.histWrap.classList.add("sv-hidden");
      this.statLine.textContent = "";
      this.statLine.dataset.state = "empty";
      this.chartWrap.classList.add("sv-hidden");
      this.model = null;
      const { kit, settings, state } = this;
      if (!this.tables.outcomes) {
        this.footnote.textContent = NEEDS_OUTCOMES;
        return;
      }
      if (!this.tables.results.length) {
        this.footnote.textContent = "No results to draw.";
        return;
      }
      if (!state.groupBy) {
        this.footnote.textContent = "Choose the groups.";
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
        this.footnote.textContent = "No participant has a group and an outcome for the endpoint.";
        return;
      }
      this.drawCurves(model);
      this.drawRisk(model);
      this.drawHistogram(model);
      this.footnote.textContent = [HINT2, ...this.cutNotes(model)].join(" ");
      if (!settings.statistic) return;
      const show = (description) => writeStatistic(kit, this.statLine, description);
      if (!ask) {
        show({ state: "none", text: this.desk.idle(MOVING), estimates: [], remarks: [] });
        return;
      }
      if (model.levels.length < 2) {
        show({ state: "none", text: ONE_GROUP, estimates: [], remarks: [] });
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
          scope: scopeText4({
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
      const add = (text2, warning) => this.notes.append(kit.createElement("span", warning ? "sv-warning" : null, text2));
      if (model.participants) {
        add(`${model.records.length} of ${model.participants} participants drawn.`);
      }
      model.dropped.forEach((entry) => add(`${entry.n} left out: ${entry.reason}.`, true));
      model.unused.filter((entry) => entry.reason !== UNUSED.MISSING_RESULT).forEach(
        (entry) => add(`${entry.n} row${entry.n === 1 ? "" : "s"} not used: ${entry.reason}.`, true)
      );
      if (model.filtered !== null && model.filtered < this.tables.participants.length) {
        add(`${model.filtered} of ${this.tables.participants.length} participants pass the filters.`);
      }
    }
    cutNotes(model) {
      if (!model.cut) return [];
      const said2 = [cutNote(model.cut.spec, model.cut)];
      if (!Array.isArray(model.cut.cut)) {
        said2.push(
          "Only participants with an outcome for the endpoint are cut, as R\u2019s Analyze_Screen cuts them."
        );
      }
      return said2;
    }
    colorOf(index) {
      return PALETTE[index % PALETTE.length];
    }
    // The curves: each group's estimate as steps from 1 at time 0, to its last
    // time, with a mark at each censored time.
    drawCurves(model) {
      const { kit, state } = this;
      this.chartWrap.classList.remove("sv-hidden");
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
          kind: "curve",
          data: steps,
          stepped: "after",
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
          kind: "censor",
          data: curve.estimate.censorTimes.map((mark) => ({ x: mark.time, y: mark.surv })),
          showLine: false,
          pointStyle: "line",
          rotation: 90,
          pointRadius: 5,
          pointBorderWidth: 1.5,
          borderColor: color,
          backgroundColor: color
        });
      });
      const chart = new kit.Chart(this.canvas.getContext("2d"), {
        type: "line",
        data: { datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          parsing: false,
          interaction: { mode: "nearest", intersect: false },
          plugins: {
            legend: {
              position: "bottom",
              // A curve and its censor marks are one: the legend names them
              // and hides neither.
              onClick: () => {
              },
              labels: { filter: (item) => datasets[item.datasetIndex].kind === "curve" },
              title: { display: true, text: this.labelOf(state.groupBy) }
            },
            tooltip: {
              filter: (item) => datasets[item.datasetIndex].kind === "curve",
              callbacks: {
                label: (item) => `${datasets[item.datasetIndex].level}: ${Number(item.raw.y.toPrecision(4))} at ${Number(item.raw.x.toPrecision(4))}`
              }
            }
          },
          scales: {
            x: {
              type: "linear",
              min: 0,
              max: model.times[model.times.length - 1] >= model.last ? model.times[model.times.length - 1] : model.last,
              afterBuildTicks: (axis) => {
                axis.ticks = model.times.map((value) => ({ value }));
              },
              title: { display: true, text: this.endpointLabel(state.endpoint) }
            },
            y: {
              min: 0,
              max: 1,
              title: { display: true, text: "Kaplan\u2013Meier estimate" }
            }
          }
        }
      });
      this.canvas.setAttribute(
        "aria-label",
        `Kaplan\u2013Meier curves by ${this.labelOf(state.groupBy)}: ` + model.curves.map((curve) => `${curve.level}, ${curve.n} participants, ${curve.events} events`).join("; ")
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
      const table = kit.createElement("table", "bv-risk");
      table.append(kit.createElement("caption", null, "Number at risk"));
      const head = kit.createElement("thead");
      const top = kit.createElement("tr");
      const corner = kit.createElement("th", null, this.labelOf(this.state.groupBy));
      corner.scope = "col";
      top.append(corner);
      model.times.forEach((time) => {
        const th = kit.createElement("th", null, String(time));
        th.scope = "col";
        top.append(th);
      });
      head.append(top);
      table.append(head);
      const body = kit.createElement("tbody");
      model.curves.forEach((curve, index) => {
        const tr = kit.createElement("tr");
        const th = kit.createElement("th");
        th.scope = "row";
        const name = kit.createElement("button");
        name.type = "button";
        name.dataset.group = curve.level;
        const swatch = kit.createElement("span", "bv-swatch");
        swatch.style.background = this.colorOf(index);
        name.append(swatch, document.createTextNode(curve.level));
        name.setAttribute("aria-label", `${curve.level}: ${curve.n} participants. List them.`);
        name.onclick = () => this.listGroup(curve.level);
        th.append(name);
        tr.append(th);
        curve.risk.forEach((cell) => {
          const td = kit.createElement("td");
          const button = kit.createElement("button", null, String(cell.atRisk));
          button.type = "button";
          button.dataset.group = curve.level;
          button.dataset.time = String(cell.time);
          button.setAttribute(
            "aria-label",
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
      this.histWrap.classList.remove("sv-hidden");
      const points = model.cut.points;
      const low = model.bars[0].from;
      const high = model.bars[model.bars.length - 1].to;
      const lines = {
        id: "bvCutLines",
        afterDatasetsDraw: (chart2) => {
          const { ctx, chartArea, scales } = chart2;
          ctx.save();
          ctx.strokeStyle = "#1f2933";
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
      const chart = new kit.Chart(this.histCanvas.getContext("2d"), {
        type: "bar",
        data: {
          datasets: [
            {
              label: "Participants",
              data: model.bars.map((bar) => ({ x: (bar.from + bar.to) / 2, y: bar.n })),
              backgroundColor: hexToRgba("#52616f", 0.45),
              borderColor: "#52616f",
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
              type: "linear",
              min: low,
              max: high,
              offset: false,
              title: { display: true, text: uncutLabel(model.cut.spec) }
            },
            y: {
              beginAtZero: true,
              ticks: { precision: 0 },
              title: { display: true, text: "Participants" }
            }
          }
        },
        plugins: [lines]
      });
      this.charts.push(chart);
      this.histChart = chart;
      const counts = model.cut.labels.map(
        (label2, index) => `${label2}: ${model.values.filter((value) => cutGroup(value, points) === index).length}`
      );
      this.cutCounts.textContent = `Values each side of the cut: ${counts.join(" \xB7 ")}.`;
      this.histCanvas.setAttribute(
        "aria-label",
        `Histogram of ${uncutLabel(model.cut.spec)}, cut at ${points.map((point) => writePoint(point)).join(" and ")}.`
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
        const handle = kit.createElement("div", "bv-cut-handle");
        handle.tabIndex = 0;
        handle.dataset.index = String(index);
        handle.setAttribute("role", "slider");
        handle.setAttribute(
          "aria-label",
          `${uncutLabel(model.cut.spec)}: cut point ${index + 1} of ${points.length}`
        );
        handle.setAttribute("aria-orientation", "horizontal");
        handle.setAttribute("aria-valuemin", String(index > 0 ? points[index - 1] : min));
        handle.setAttribute(
          "aria-valuemax",
          String(index < points.length - 1 ? points[index + 1] : max)
        );
        handle.setAttribute("aria-valuenow", String(point));
        handle.setAttribute("aria-valuetext", writePoint(point));
        handle.style.left = `${chart.scales.x.getPixelForValue(point)}px`;
        handle.style.top = `${top}px`;
        handle.style.height = `${bottom - top}px`;
        handle.addEventListener("keydown", (event) => this.keyCut(event, index));
        handle.addEventListener("keyup", () => this.settleCut());
        handle.addEventListener("blur", () => {
          if (!this.redrawing) this.keyIndex = null;
        });
        this.histBox.append(handle);
        if (this.keyIndex === index) handle.focus();
      });
    }
    // Takes the sliders away, as a redraw does, without letting their focus go.
    clearHandles() {
      this.redrawing = true;
      this.histBox.querySelectorAll(".bv-cut-handle").forEach((handle) => handle.remove());
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
      const box = this.histBox;
      const valueAt = (event) => {
        const chart = this.histChart;
        if (!chart) return null;
        const box2 = canvas.getBoundingClientRect();
        return chart.scales.x.getValueForPixel(event.clientX - box2.left);
      };
      box.addEventListener("pointerdown", (event) => {
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
        const grip = event.pointerType === "touch" ? TOUCH_GRIP : GRIP;
        if (nearest < 0 || distance > grip) return;
        event.preventDefault();
        if (box.setPointerCapture) box.setPointerCapture(event.pointerId);
        this.holdCut(nearest);
        this.drag.grab = { x: event.clientX, offset: points[nearest] - valueAt(event), moved: false };
      });
      box.addEventListener("pointermove", (event) => {
        if (!this.drag || !this.drag.grab) return;
        const { grab } = this.drag;
        if (!grab.moved && Math.abs(event.clientX - grab.x) < BUDGE) return;
        const value = valueAt(event);
        if (value === null) return;
        grab.moved = true;
        this.moveCut(this.drag.index, value + grab.offset);
        if (this.drag) this.drag.grab = grab;
      });
      const letGo = () => {
        if (!this.drag || !this.drag.grab) return;
        const { index, points, grab } = this.drag;
        if (!grab.moved) {
          this.drag = null;
          return;
        }
        this.dropCut(index, points[index]);
      };
      box.addEventListener("pointerup", letGo);
      box.addEventListener("pointercancel", letGo);
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
      else if (event.key === "Home") target = index > 0 ? points[index - 1] : min;
      else if (event.key === "End") target = index < points.length - 1 ? points[index + 1] : max;
      else return;
      event.preventDefault();
      clearTimeout(this.settleTimer);
      this.keyIndex = index;
      if (this.drag && this.drag.index !== index) this.drag = null;
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
      const from = this.drag ? this.drag.points : this.model && this.model.cut && this.model.cut.points;
      const range = this.cutRange(this.drag ? this.drag.model : this.model);
      this.drag = null;
      clearTimeout(this.settleTimer);
      const spec = this.groupingOf(this.state.groupBy);
      const points = from && isCut(spec) ? movePoints(from, index, value, { drop: true, ...range }) : null;
      if (!points) {
        this.render();
        return null;
      }
      const typed = { ...spec, cut: points };
      this.cutOptions = this.cutOptions.filter((entry) => entry.key !== MOVED_KEY);
      const named2 = this.cutOptions.find(
        (entry) => JSON.stringify(entry.spec) === JSON.stringify(typed)
      );
      if (named2) {
        this.state.groupBy = named2.key;
      } else {
        this.cutOptions.push({ key: MOVED_KEY, spec: typed, label: label(typed) });
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
          outcome: record.event ? "Event" : "Censored"
        }))
      });
      this.footnote.textContent = `${what}: ${records.length} participant${records.length === 1 ? "" : "s"} listed. Click a row to open the participant's profile.`;
    }
    listingColumns() {
      if (this.settings.details) return this.settings.details;
      return [
        { value_col: this.settings.id_col, label: "Participant" },
        { value_col: "group", label: this.labelOf(this.state.groupBy) },
        { value_col: "time", label: "Time" },
        { value_col: "outcome", label: "Outcome" }
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
      return railSettings(this, "linear");
    }
    /**
     * What the controls now read, as the settings the chart would open on with
     * them: the part of its specification the controls hold (#68).
     * @returns {object}
     */
    viewSettings() {
      const { state } = this;
      const group = state.groupBy ? this.groupingOf(state.groupBy) : null;
      return {
        endpoint: state.endpoint,
        group_by: group,
        // Every cut the Groups control offers stays offered, the one a moved line
        // left among them (#71 review).
        cuts: cutsOffered(this.cutOptions, [group])
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
      const valued = model.cut ? (({ cut, ...variable2 }) => variable2)(model.cut.spec) : null;
      return {
        columns: [
          { value_col: settings.id_col, label: "Participant" },
          { value_col: "group", label: this.labelOf(state.groupBy) },
          ...valued ? [{ value_col: "value", label: label(valued) }] : [],
          { value_col: "time", label: "Time" },
          { value_col: "event", label: "Event" }
        ],
        rows: model.records
      };
    }
    /** The placeholders a download's file name is made of, after the chart's name. */
    get viewFields() {
      return ["endpoint", "group"];
    }
    /**
     * What the title, subtitle and footnotes' placeholders hold for the view now
     * drawn, beside `{date}`, `{version}` and `{filters}` (#66).
     * @returns {object}
     */
    placeholders() {
      const { state, model } = this;
      return {
        endpoint: state.endpoint ? this.endpointLabel(state.endpoint) : "",
        group: state.groupBy ? this.labelOf(state.groupBy) : "",
        n: model && model.records ? model.records.length : ""
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
      this.element.innerHTML = "";
    }
  };
  function stratifiedSurvival(element, settings) {
    return new StratifiedSurvival(element, settings);
  }

  // src/biomarker-screen/statistic.js
  var COMPARISON_LABELS = Object.freeze({
    difference: "Difference between two groups",
    correlation: "Correlation with one variable",
    hazard: "Hazard ratio, high against low"
  });
  var HAZARD_GROUPS = Object.freeze(["High", "Low"]);
  var METHOD_LABELS3 = Object.freeze({ pearson: "Pearson", spearman: "Spearman" });
  var ADJUSTMENT_LABELS2 = Object.freeze({ BH: "Benjamini-Hochberg", holm: "Holm" });
  var ESTIMATE_NAMES = Object.freeze({
    difference: "Standardised difference (Hedges\u2019 g)",
    correlation: { pearson: "Pearson\u2019s r", spearman: "Spearman\u2019s rho" },
    hazard: "Hazard ratio, High / Low"
  });
  function screenRequest({ name, settings, state, model }) {
    const filters = filtersInForce(state.filters);
    const difference = state.comparison === "difference";
    const hazard = state.comparison === "hazard";
    const flag = hazard ? flagOf(settings).field : null;
    const of = () => {
      if (difference) return { strGroupCol: state.groupBy, chrGroups: [...state.levels] };
      if (hazard) {
        return {
          strTimeCol: "time",
          ...flag === "censor" ? { strCensorCol: "censor" } : { strEventCol: "event" }
        };
      }
      return { strWithCol: model.extra, strCorMethod: state.method };
    };
    return {
      name,
      data: model.records,
      args: {
        chrCols: model.rows.map((row) => row.name),
        strComparison: state.comparison,
        ...of(),
        strPAdjust: state.adjustment
      },
      dataId: {
        chart: "biomarker-screen",
        value_type: state.valueType,
        ...state.valueType === "baseline" ? {} : { visit: state.visit },
        ...settings.baseline_visits ? { baseline_visits: [...settings.baseline_visits] } : {},
        baseline_stat: settings.baseline_stat,
        // What the column correlated with is: its name in the frame is a label.
        ...state.comparison === "correlation" ? { with: settingOf(state.with) } : {},
        // What the rows' outcome is: the endpoint of the outcomes table.
        ...hazard ? { endpoint: state.endpoint } : {},
        ...Object.keys(filters).length ? { filters } : {}
      },
      rows: model.records.length
    };
  }
  var plain4 = (state, said2) => ({ ...sentence(state, said2), table: null, rows: null });
  function rowsOf(value, groups = null) {
    const rows = Array.isArray(value && value.rows) ? value.rows : [];
    const number = (given2) => typeof given2 === "number" && Number.isFinite(given2) ? given2 : null;
    const words = (given2) => typeof given2 === "string" && given2.trim() !== "" ? given2 : null;
    return rows.filter((row) => row && typeof row.biomarker === "string").map((row, order2) => {
      const formatted = formatScreenRow(row, groups);
      const shown2 = formatted.status === "shown";
      return {
        biomarker: row.biomarker,
        formatted,
        // R's numbers, for drawing and ordering, and only for a row R computed.
        estimate: shown2 ? number(row.estimate) : null,
        lower: shown2 ? number(row.lower) : null,
        upper: shown2 ? number(row.upper) : null,
        raw: shown2 ? number(row.p_unadjusted) : null,
        adjusted: shown2 ? number(row.p_value) : null,
        // The counts R used: in each group for a difference, and in all.
        n: Number.isInteger(row.counts) ? row.counts : null,
        groupCounts: Number.isInteger(row.n_1) && Number.isInteger(row.n_2) ? [row.n_1, row.n_2] : null,
        // R says which rows it adjusted across: those it gave a number of rows for.
        inAdjustment: Number.isInteger(row.adjusted_over),
        reason: words(row.reason),
        warning: words(row.warning),
        order: order2
      };
    });
  }
  function describeScreen(result, context = {}) {
    if (!result || result.status !== "ok") {
      const failure = failureOf(result);
      return plain4(failure.state, failure.text);
    }
    const value = result.value && typeof result.value === "object" ? result.value : {};
    const reason = typeof value.reason === "string" && value.reason.trim() ? value.reason : null;
    const rows = rowsOf(value, context.groups || null);
    const shown2 = rows.filter((row) => row.formatted.status === "shown");
    const overs = [...new Set(rows.map((row) => row.formatted.over).filter((over) => over !== null))];
    const names = [
      ...new Set(rows.map((row) => row.formatted.adjustment).filter((name) => name !== null))
    ];
    let described;
    if (value.status === "error") {
      described = plain4("error", `R reported an error: ${reason || "no message"}`);
      described.rows = rows.length ? rows : null;
    } else if (reason) {
      described = plain4("withheld", reason);
      described.rows = rows;
    } else if (typeof value.method !== "string" || value.method.trim() === "") {
      described = plain4("refused", "Rows not shown: the result does not name its method.");
    } else if (overs.length > 1 || names.length > 1) {
      described = plain4("refused", "Rows not shown: the rows were not adjusted as one family.");
    } else {
      const over = overs[0] ?? 0;
      const across = over && names.length ? ` The adjusted p-values are adjusted by ${names[0]} across the ${over} biomarker${over === 1 ? "" : "s"} that have a p-value.` : "";
      described = plain4(
        "shown",
        `${value.method}, one row per biomarker: ${shown2.length} of ${rows.length} computed.${across}`
      );
      described.rows = rows;
      described.over = over;
      described.adjustment = names[0] ?? null;
    }
    described.remarks = remarksOf(value);
    described.scope = context.scope || null;
    return described;
  }
  function scopeText5({ n, filters = [] }) {
    const said2 = [
      `${n} participant${n === 1 ? " is" : "s are"} in the frame. A row is of the ones who have its biomarker, so each row has its own counts.`
    ];
    if (filters.length) said2.push(filtersSaid(filters));
    return said2.join(" ");
  }
  function createStatisticDesk5({ connection, note = null }) {
    return createDesk({
      connection,
      note,
      describe: describeScreen,
      waiting: (said2) => plain4("waiting", said2)
    });
  }

  // src/biomarker-screen/structureData.js
  var RELATIVE4 = /* @__PURE__ */ new Set(["change", "fold_change", "percent_change"]);
  var VALUE_WORDS4 = {
    raw: "Result",
    baseline: "Baseline value",
    change: "Change from baseline",
    fold_change: "Fold change from baseline",
    percent_change: "Percent change from baseline"
  };
  function variableName(axis) {
    if (axis.kind === "column") return axis.col;
    if (axis.value === "baseline") return `${axis.measure}, baseline value`;
    if (axis.value === "raw") return `${axis.measure} at ${axis.visit}`;
    return `${axis.measure}, ${VALUE_WORDS4[axis.value].toLowerCase()} at ${axis.visit}`;
  }
  function groupsOf2(tables, column, chosen) {
    const offered = column ? columnLevels(tables, column) : [];
    if (chosen && chosen.length === 2 && chosen.every((level) => offered.includes(level))) {
      return { levels: [...chosen], offered };
    }
    return { levels: offered.length >= 2 ? offered.slice(0, 2) : [], offered };
  }
  function screenRows(settings, state, offered, results = []) {
    const value = state.valueType;
    const config = coreSettings(settings);
    const baseline = RELATIVE4.has(value) ? config.baseline_visits || visits(results, config).slice(0, 1) : [];
    const at = value === "baseline" ? "" : ` at ${state.visit}`;
    const words = `${VALUE_WORDS4[value]}${at}`;
    const endpoint = (offered.endpoints || []).find((entry) => entry.endpoint === state.endpoint);
    const heading = state.comparison === "difference" ? `${words}: ${state.levels.length === 2 ? `${state.levels[0]} against ${state.levels[1]}` : "two groups"}, standardised difference` : state.comparison === "hazard" ? `${words}: hazard ratio, high against low, on ${endpoint ? endpoint.label : "an endpoint"}` : `${words}: correlation with ${state.with ? variableName(state.with) : "a variable"}`;
    const none = (message) => ({ rows: [], heading, left: null, message });
    if (baseline.length === 1 && baseline[0] === state.visit) {
      return none(
        "This value is a change at the baseline visit, where it is the same for everyone. Choose a later visit to screen."
      );
    }
    if (state.comparison === "difference") {
      if (!state.groupBy)
        return none("Choose a column of groups: a difference compares two of them.");
      if (state.levels.length !== 2) {
        return none("The column of groups has fewer than two groups: a difference compares two.");
      }
    } else if (state.comparison === "hazard") {
      if (!endpoint)
        return none("Choose an endpoint: a hazard ratio is of an endpoint of the outcomes table.");
    } else if (!state.with) {
      return none("Choose the variable every biomarker is correlated with.");
    }
    let left = null;
    const rows = [];
    for (const measure of offered.measures) {
      const axis = axisOf({ measure, value, visit: value === "baseline" ? null : state.visit });
      if (state.comparison === "correlation" && sameAxis(axis, state.with)) {
        left = `${variableName(axis)} is the variable every row is correlated with, and is not a row of its own.`;
        continue;
      }
      rows.push({ name: measure, axis });
    }
    if (!rows.length) return { rows, heading, left, message: "No biomarker to screen." };
    return { rows, heading, left, message: null };
  }
  function buildScreen({ results, participants, outcomes = null }, settings, state, offered, options = {}) {
    const { participants: kept, results: rows } = keepFiltered(
      { results, participants },
      settings,
      state.filters,
      options.filterMatches
    );
    const drawn = screenRows(settings, state, offered, results);
    const hazard = state.comparison === "hazard";
    const extra = state.comparison === "difference" ? { name: state.groupBy, variable: state.groupBy ? { col: state.groupBy } : null } : hazard ? { name: null, variable: null } : {
      name: state.with ? variableName(state.with) : null,
      variable: state.with ? variableOf(state.with) : null
    };
    const outcomeFields = hazard ? ["time", flagOf(settings).field] : [];
    const model = {
      ...drawn,
      extra: extra.name,
      outcomeFields,
      outcomeGaps: [],
      records: [],
      participants: kept ? kept.length : 0,
      empty: 0,
      dropped: [],
      unused: [],
      baselineVisits: null,
      filtered: kept ? kept.length : null
    };
    if (drawn.message || !rows.length) return model;
    const names = [
      settings.id_col,
      ...drawn.rows.map((row) => row.name),
      ...hazard ? outcomeFields : [extra.name]
    ];
    const twice = names.find((name, index) => names.indexOf(name) !== index);
    if (twice !== void 0) {
      return {
        ...model,
        rows: [],
        message: `Two columns of the frame would be named ${twice}: rename the biomarker or the column.`
      };
    }
    const fields = drawn.rows.map((row, index) => ({ key: `v${index + 1}`, name: row.name }));
    const extraKey = "v0";
    const made = frame(
      { results: rows, participants: kept || void 0 },
      {
        ...Object.fromEntries(
          fields.map((field, index) => [field.key, variableOf(drawn.rows[index].axis)])
        ),
        ...extra.variable ? { [extraKey]: extra.variable } : {}
      },
      // None is required: a participant with some of the biomarkers is in the
      // frame, and R counts who each row has.
      { ...coreSettings(settings), required: [] }
    );
    const outcomeOf = hazard ? outcomesOf(outcomes || [], settings, state.endpoint) : null;
    const named2 = made.data.map((record) => {
      const row = {
        [settings.id_col]: record[settings.id_col],
        ...Object.fromEntries(fields.map((field) => [field.name, record[field.key]]))
      };
      if (!hazard) return { ...row, [extra.name]: record[extraKey] };
      const outcome = outcomeOf(record[settings.id_col]);
      return {
        ...row,
        time: outcome.reason ? null : outcome.time,
        [outcomeFields[1]]: outcome.reason ? null : outcome.flag
      };
    });
    const records = named2.filter((record) => drawn.rows.some((row) => record[row.name] !== null));
    const gaps = /* @__PURE__ */ new Map();
    if (hazard) {
      for (const record of records) {
        const outcome = outcomeOf(record[settings.id_col]);
        if (outcome.reason) gaps.set(outcome.reason, (gaps.get(outcome.reason) || 0) + 1);
      }
    }
    return {
      ...model,
      records,
      participants: made.participants,
      empty: named2.length - records.length,
      // With no biomarker required, who is left out is who the participant table
      // does not have.
      dropped: made.dropped,
      unused: made.unused,
      outcomeGaps: [...gaps].map(([reason, n]) => ({ reason, n })),
      baselineVisits: made.baseline_visits
    };
  }
  var SORT_LABELS = Object.freeze({
    estimate: "Estimate, largest first",
    name: "Biomarker name",
    adjusted: "Adjusted p-value, smallest first"
  });
  function sortRows(rows, sort) {
    const by = (key, descending) => (a, b) => {
      const [x, y] = [a[key], b[key]];
      if (x === null && y === null) return a.order - b.order;
      if (x === null) return 1;
      if (y === null) return -1;
      if (x === y) return a.order - b.order;
      return descending ? x < y ? 1 : -1 : x < y ? -1 : 1;
    };
    const compare = sort === "name" ? (a, b) => naturally(a.biomarker, b.biomarker) || a.order - b.order : sort === "adjusted" ? by("adjusted", false) : by("estimate", true);
    return [...rows].sort(compare);
  }
  function axisRange(rows, comparison) {
    const values = rows.flatMap((row) => [row.estimate, row.lower, row.upper]).filter((value) => typeof value === "number" && Number.isFinite(value));
    if (comparison === "hazard") {
      const positive = values.filter((value) => value > 0);
      const least = Math.min(1, ...positive);
      const most = Math.max(1, ...positive);
      let min = 0.5;
      while (min > least) min /= 2;
      let max = 2;
      while (max < most) max *= 2;
      const ticks2 = [];
      for (let at = min; at <= max; at *= 2) ticks2.push(at);
      return { min, max, ticks: ticks2, log: true, reference: 1 };
    }
    if (comparison === "correlation") {
      return { min: -1, max: 1, ticks: [-1, -0.5, 0, 0.5, 1] };
    }
    const reach = Math.max(0.5, ...values.map((value) => Math.abs(value)));
    const step = reach <= 1 ? 0.5 : reach <= 2.5 ? 1 : 2;
    const end = Math.ceil(reach / step) * step;
    const ticks = [];
    for (let at = -end; at <= end + 1e-9; at += step) ticks.push(Number(at.toFixed(2)));
    return { min: -end, max: end, ticks };
  }
  var placeOf = (value, { min, max, log = false }) => {
    const at = log ? (Math.log2(value) - Math.log2(min)) / (Math.log2(max) - Math.log2(min)) : (value - min) / (max - min);
    return Math.min(100, Math.max(0, at * 100));
  };

  // src/shared/paging.js
  function pageOf(items, limit, page = 0) {
    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const at = Math.min(Math.max(0, Math.trunc(Number(page)) || 0), pages - 1);
    const shown2 = items.slice(at * limit, (at + 1) * limit);
    return {
      items: shown2,
      page: at,
      pages,
      from: total ? at * limit + 1 : 0,
      to: at * limit + shown2.length,
      total
    };
  }
  var ordinal = (n) => {
    const tens = n % 100;
    const suffix = tens >= 11 && tens <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
    return `${n}${suffix}`;
  };
  function pageCount({ from, to, total, pages }, order2) {
    if (!total) return "No biomarker to show.";
    if (pages === 1) {
      return total === 1 ? "The one biomarker is shown." : `All ${total} biomarkers are shown.`;
    }
    const which = from === to ? `the ${ordinal(from)}` : `${from} to ${to}`;
    return `${to - from + 1} of ${total} biomarkers shown: ${which}, ${order2}.`;
  }

  // src/biomarker-screen.js
  var MODULE_CLASS4 = "bv-biomarker-screen";
  var STYLE_ID5 = "bio-viz-biomarker-screen-styles";
  var C3 = `.${MODULE_CLASS4}`;
  var STYLES5 = `${lineStyles(C3)}
${C3} .bv-screen{margin:0 0 .6rem;border:1px solid #d8dee4;border-radius:10px;background:#fff;padding:.8rem}
${ownHeading(`${C3} .bv-screen-title`, 600)}
${C3} .bv-screen-title{margin:0 0 .3rem;font-size:.92rem;color:#1f2933}
${C3} .bv-screen-caption{margin:0 0 .6rem;font-size:.8rem;color:#52616f}
${C3} .bv-screen-names{margin:.2rem 0 0;font-size:.85rem;color:#52616f}
${C3} .bv-screen-head,${C3} .bv-screen-row{display:grid;grid-template-columns:minmax(5.5rem,9rem) minmax(8rem,1fr) 11.8rem 5.4rem 5.8rem 5.6rem;align-items:center;gap:0 .6rem}
${C3} .bv-screen-head{font-size:.75rem;font-weight:600;color:#52616f;border-bottom:2px solid #d8dee4;padding:0 .4rem .3rem}
${C3} .bv-screen-row{appearance:none;width:100%;margin:0;border:0;border-bottom:1px solid #e3e8ee;background:#fff;padding:.35rem .4rem;font:inherit;font-size:.85rem;color:#1f2933;text-align:left;cursor:pointer;font-variant-numeric:tabular-nums}
${C3} .bv-screen-row:hover{background:#f4f8fc}
${C3} .bv-screen-row:focus-visible{outline:2px solid #0b62a4;outline-offset:-2px}
${C3} .bv-screen-name{font-weight:600;overflow-wrap:anywhere}
${C3} .bv-track{position:relative;height:1.3rem}
${C3} .bv-ticks{position:relative;height:1rem}
${C3} .bv-tick{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
${C3} .bv-zero{position:absolute;top:0;bottom:0;width:0;border-left:1px dashed #7b8794}
${C3} .bv-interval{position:absolute;top:50%;height:2px;margin-top:-1px;background:#0b62a4}
${C3} .bv-estimate{position:absolute;top:50%;width:.6rem;height:.6rem;margin:-.3rem 0 0 -.3rem;border-radius:50%;background:#0b62a4}
${C3} .bv-screen-row[data-status=withheld] .bv-screen-value,${C3} .bv-screen-row[data-status=error] .bv-screen-value,${C3} .bv-screen-row[data-status=refused] .bv-screen-value{grid-column:3 / span 4;color:#52616f}
${C3} .bv-screen-tools{margin:.6rem 0 0}
${C3} .bv-screen-tools button,${C3} .bv-overview-pager button{font:inherit;font-size:.8rem;padding:.3rem .6rem;border:1px solid #d8dee4;border-radius:6px;background:#fff;color:#1f2933;cursor:pointer}
${C3} .bv-overview-pager button:disabled{color:#9aa5b1;cursor:default}
${C3} .bv-overview-pager{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem .7rem;margin:0 0 .6rem;font-size:.85rem;color:#1f2933}
${C3} .bv-control-note{display:block;margin:.2rem 0 0;font-size:.75rem;color:#52616f}
${C3} .bv-narrow{display:none}
@media (max-width:600px){
${C3} .bv-narrow{display:inline;color:#52616f}
${C3} .bv-screen{padding:.5rem}
${C3} .bv-screen-head{grid-template-columns:1fr;padding:0 .2rem .3rem}
${C3} .bv-screen-head > :not(.bv-ticks){display:none}
${C3} .bv-screen-row{grid-template-columns:1fr;gap:.15rem .6rem;padding:.45rem .2rem}
${C3} .bv-screen-row[data-status] .bv-screen-value{grid-column:auto}
${C3} .bv-screen-row .bv-screen-p,${C3} .bv-screen-row .bv-screen-n{font-size:.8rem}
${C3}.sv-collapsed .sv-sidebar-title{display:inline}
${C3}.sv-collapsed .sv-sidebar{padding:.5rem .9rem}
}`;
  var BACK2 = "Back to the biomarker screen";
  var NO_OUTCOMES = "A hazard ratio needs an outcomes table: give `outcomes`, one row per participant and endpoint, with a time and a flag, as `init({ results, participants, outcomes })`.";
  var HAZARD_NOTE = "Each biomarker is cut at its median, as R\u2019s Analyze_Screen cuts it, a value on the median low: the hazard ratio is the high group\u2019s hazard over the low group\u2019s.";
  var OPEN_HINT = "Click a row, or press Enter on it, to open that biomarker in its own chart. The estimates ";
  var HINT3 = OPEN_HINT + "share one axis without units, with nought marked.";
  var HAZARD_HINT = OPEN_HINT + "share one logarithmic axis without units, with 1, no difference, marked.";
  var COLUMN = "c:";
  var MEASURE = "m:";
  var BiomarkerScreen = class {
    constructor(element, settings) {
      this.kit = findKit("the biomarker screen");
      this.element = typeof element === "string" ? document.querySelector(element) : element;
      if (!this.element) throw new Error(`bio.viz: biomarker screen target not found: ${element}`);
      this.settings = syncSettings4(settings);
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
      if (this.desk) this.desk.retire();
      this.connection = this.settings.connection || createConnection();
      this.desk = createStatisticDesk5({
        connection: this.connection,
        note: this.settings.waiting_note
      });
    }
    renderShell() {
      const { kit } = this;
      mountShell(this, {
        moduleClass: MODULE_CLASS4,
        styleId: STYLE_ID5,
        styles: STYLES5,
        listingFile: "bio.viz-biomarker-screen-rows.csv"
      });
      this.chartWrap.classList.add("sv-hidden");
      this.screenWrap = kit.createElement("div", "bv-screen");
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
      const given2 = Array.isArray(data) ? { results: data } : data || {};
      if (settings === void 0 || settings === null) {
        this.tables = {
          ...readGiven(this, given2),
          outcomes: readOutcomesGiven(this, given2.outcomes, this.settings)
        };
      } else {
        const next = syncSettings4(laidOver(this.settings, settings));
        this.tables = {
          ...readGiven(this, given2, next),
          outcomes: readOutcomesGiven(this, given2.outcomes, next)
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
      const given2 = settings || {};
      const next = syncSettings4(laidOver(this.settings, given2));
      checkTables(this.tables, next);
      if (this.tables.outcomes) checkOutcomes(this.tables.outcomes, next);
      this.close();
      this.settings = next;
      if ("connection" in given2 || "waiting_note" in given2) this.connect();
      this.readTables();
      const opening = this.seedState();
      const moved = {
        comparison: ["comparison"],
        visit: ["visit"],
        value_type: ["valueType"],
        group_by: ["groupBy", "levels"],
        levels: ["levels"],
        with: ["with"],
        method: ["method"],
        endpoint: ["endpoint"],
        adjustment: ["adjustment"],
        sort: ["sort", "page"],
        filters: ["filters"]
      };
      for (const [setting, keys] of Object.entries(moved)) {
        if (setting in given2) keys.forEach((key) => this.state[key] = opening[key]);
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
      this.filterSpecs = filterColumns(this.tables, settings, this.categories).map(
        (spec) => this.kit.normalizeFilterSpec(spec)
      );
      this.endpoints = this.tables.outcomes ? listEndpoints(this.tables.outcomes, settings) : [];
      if (this.tables.outcomes && settings.endpoint !== null && !this.endpoints.some((entry) => entry.endpoint === settings.endpoint)) {
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
      return COMPARISONS.filter((entry) => entry !== "hazard" || this.endpoints.length);
    }
    // The columns of groups a difference can compare: the category columns with
    // two groups or more.
    groupColumns() {
      return this.categories.filter((spec) => columnLevels(this.tables, spec.value_col).length >= 2);
    }
    // Whether the tables have a variable to correlate with.
    hasVariable(axis) {
      if (!axis) return false;
      if (axis.kind === "column") return this.numbers.some((spec) => spec.value_col === axis.col);
      return this.measures.includes(axis.measure) && (axis.value === "baseline" || this.visits.includes(axis.visit));
    }
    // What the chart opens on: the settings, where the tables have what they name.
    seedState() {
      const { settings, visits: visits2 } = this;
      const columns = this.groupColumns().map((spec) => spec.value_col);
      const groupBy = columns.includes(settings.group_by) ? settings.group_by : columns[0] ?? null;
      const given2 = settings.with ? axisOf(settings.with) : null;
      const fallback = this.numbers.length ? axisOf({ col: this.numbers[0].value_col }) : this.measures.length && visits2.length ? axisOf({ measure: this.measures[0], value: "raw", visit: visits2[0] }) : null;
      const endpoint = this.endpoints.some((entry) => entry.endpoint === settings.endpoint) ? settings.endpoint : this.endpoints[0] ? this.endpoints[0].endpoint : null;
      this.pageFromSettings = true;
      return {
        comparison: this.comparisons().includes(settings.comparison) ? settings.comparison : "difference",
        endpoint,
        visit: visits2.includes(settings.visit) ? settings.visit : visits2[0] ?? null,
        valueType: settings.value_type,
        groupBy,
        levels: groupsOf2(this.tables, groupBy, settings.levels).levels,
        with: this.hasVariable(given2) ? given2 : fallback,
        method: settings.method,
        adjustment: settings.adjustment,
        sort: settings.sort,
        page: settings.page,
        filters: startFilters(this)
      };
    }
    // After the tables or the settings change, a control may hold something that
    // is no longer offered; it returns to what the chart opens on.
    repairState(opening) {
      const { state } = this;
      if (!this.visits.includes(state.visit)) state.visit = opening.visit;
      const columns = this.groupColumns().map((spec) => spec.value_col);
      if (!columns.includes(state.groupBy)) state.groupBy = opening.groupBy;
      state.levels = groupsOf2(this.tables, state.groupBy, state.levels).levels;
      if (!this.hasVariable(state.with)) state.with = opening.with;
      if (!this.comparisons().includes(state.comparison)) state.comparison = "difference";
      if (!this.endpoints.some((entry) => entry.endpoint === state.endpoint)) {
        state.endpoint = opening.endpoint;
      }
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
      const screen = addSection("Screen");
      select(
        "comparison",
        "Compare",
        this.comparisons().map((entry) => [entry, COMPARISON_LABELS[entry]]),
        state.comparison,
        (next) => {
          state.comparison = next;
          redraw(true);
        },
        screen
      );
      if (!this.endpoints.length) {
        screen.append(kit.createElement("small", "bv-control-note bv-no-outcomes", NO_OUTCOMES));
      }
      select(
        "value-type",
        "Value",
        VALUE_TYPES.map((type) => [type, VALUE_LABELS[type]]),
        state.valueType,
        (next) => {
          state.valueType = next;
          redraw(true);
        },
        screen
      );
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
          screen
        );
      }
      if (state.comparison === "difference") {
        const columns = this.groupColumns();
        select(
          "group-by",
          "Group by",
          columns.map((spec) => [spec.value_col, spec.label]),
          state.groupBy,
          (next) => {
            state.groupBy = next;
            state.levels = groupsOf2(this.tables, next, null).levels;
            redraw(true);
          },
          screen
        );
        const levels = state.groupBy ? columnLevels(this.tables, state.groupBy) : [];
        ["First group", "Second group"].forEach((labelText, index) => {
          select(
            index === 0 ? "first" : "second",
            labelText,
            levels.map((level) => [level, level]),
            state.levels[index],
            (next) => {
              const other = 1 - index;
              if (state.levels[other] === next) state.levels[other] = state.levels[index];
              state.levels[index] = next;
              redraw(true);
            },
            screen
          );
        });
        screen.append(
          kit.createElement(
            "small",
            "bv-control-note",
            "The difference is the first group\u2019s mean less the second\u2019s, in pooled standard deviations: swap the groups to turn the axis round."
          )
        );
      } else if (state.comparison === "hazard") {
        select(
          "endpoint",
          "Endpoint",
          this.endpoints.map((entry) => [entry.endpoint, entry.label]),
          state.endpoint,
          (next) => {
            state.endpoint = next;
            redraw(true);
          },
          screen
        );
        screen.append(kit.createElement("small", "bv-control-note", HAZARD_NOTE));
      } else {
        const options = [
          ...this.numbers.map((spec) => [`${COLUMN}${spec.value_col}`, spec.label]),
          ...this.measures.map((measure) => [`${MEASURE}${measure}`, measure])
        ];
        const current = state.with && state.with.kind === "column" ? `${COLUMN}${state.with.col}` : state.with ? `${MEASURE}${state.with.measure}` : null;
        select(
          "with",
          "Correlate with",
          options,
          current,
          (next) => {
            state.with = next.startsWith(COLUMN) ? axisOf({ col: next.slice(COLUMN.length) }) : axisOf({
              measure: next.slice(MEASURE.length),
              value: "raw",
              visit: state.with && state.with.kind === "measure" && state.with.visit ? state.with.visit : state.visit
            });
            redraw(true);
          },
          screen
        );
        if (state.with && state.with.kind === "measure") {
          select(
            "with-visit",
            "At visit",
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
          "method",
          "Method",
          METHODS3.map((method) => [method, METHOD_LABELS3[method]]),
          state.method,
          (next) => {
            state.method = next;
            redraw(false);
          },
          screen
        );
      }
      if (this.settings.statistic) {
        const statistics = addSection("Statistics");
        select(
          "adjustment",
          "Adjustment",
          ADJUSTMENTS2.map((entry) => [entry, ADJUSTMENT_LABELS2[entry]]),
          state.adjustment,
          (next) => {
            state.adjustment = next;
            redraw(false);
          },
          statistics
        );
      }
      const display = addSection("Display");
      select(
        "sort",
        "Sort",
        SORTS.map((entry) => [entry, SORT_LABELS[entry]]),
        state.sort,
        (next) => {
          state.sort = next;
          state.page = 0;
          this.drawRows();
        },
        display
      );
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
      if (this.pageFromSettings) this.pageFromSettings = false;
      else this.state.page = 0;
      this.notes.innerHTML = "";
      this.screenWrap.innerHTML = "";
      this.screenWrap.hidden = true;
      this.listingWrap.innerHTML = "";
      this.statLine.textContent = "";
      this.statLine.dataset.state = "empty";
      this.model = null;
      const { kit, state, settings } = this;
      if (!this.tables.results.length || !this.measures.length) {
        this.footnote.textContent = "No results to draw.";
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
        this.footnote.textContent = "No participant has a value for any biomarker of this screen.";
        return;
      }
      this.footnote.textContent = state.comparison === "hazard" ? HAZARD_HINT : HINT3;
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
          writeTitles(this);
          writeStatistic(kit, this.statLine, description);
          this.answer = description;
          this.drawRows();
        },
        {
          groups: state.comparison === "difference" ? state.levels : state.comparison === "hazard" ? [...HAZARD_GROUPS] : null,
          scope: scopeText5({ n: model.records.length, filters: filtersForScope(this) })
        }
      );
    }
    // Above the screen: who is in the frame, and what was left out of it.
    updateNotes(model) {
      const { kit, state } = this;
      const add = (text2, warning) => this.notes.append(kit.createElement("span", warning ? "sv-warning" : null, text2));
      if (model.rows.length && model.participants) {
        add(`${model.records.length} of ${model.participants} participants in the frame.`);
        if (model.empty)
          add(`${model.empty} left out: no value for any biomarker of the screen.`, true);
      }
      model.dropped.forEach((entry) => add(`${entry.n} left out: ${entry.reason}.`, true));
      model.unused.filter((entry) => entry.reason !== UNUSED.MISSING_RESULT).forEach(
        (entry) => add(`${entry.n} row${entry.n === 1 ? "" : "s"} not used: ${entry.reason}.`, true)
      );
      if (model.filtered !== null && model.filtered < this.tables.participants.length) {
        add(`${model.filtered} of ${this.tables.participants.length} participants pass the filters.`);
      }
      (model.outcomeGaps || []).forEach(
        (entry) => add(
          `${entry.n} with no outcome to use: ${entry.reason}. R leaves them out of every row.`,
          true
        )
      );
      if (model.left) add(model.left);
      if (model.baselineVisits && state.valueType !== "raw") {
        add(`Baseline visit: ${model.baselineVisits.join(", ")}.`);
      }
    }
    // The estimate's name, as the axis and the caption call it.
    estimateName() {
      const { state } = this;
      if (state.comparison === "hazard") {
        const endpoint = this.endpoints.find((entry) => entry.endpoint === state.endpoint);
        return `${ESTIMATE_NAMES.hazard}, on ${endpoint ? endpoint.label : state.endpoint}`;
      }
      return state.comparison === "difference" ? `${ESTIMATE_NAMES.difference}, ${state.levels[0]} less ${state.levels[1]}` : `${ESTIMATE_NAMES.correlation[state.method]} with ${variableName(state.with)}`;
    }
    // The screen: its heading, and either the rows R returned, sorted and paged,
    // or, before R has answered and with no R, the biomarkers it is of.
    drawRows() {
      if (!this.model || this.model.message || !this.model.records.length) return;
      const { kit, model, state } = this;
      const wrap = this.screenWrap;
      wrap.innerHTML = "";
      wrap.hidden = false;
      this.listingWrap.innerHTML = "";
      wrap.append(kit.createElement("h3", "bv-screen-title", model.heading));
      const rows = this.answer && this.answer.rows ? this.answer.rows : null;
      if (!rows) {
        wrap.append(
          kit.createElement(
            "p",
            "bv-screen-names",
            `${model.rows.length} biomarker${model.rows.length === 1 ? "" : "s"} to screen: ${model.rows.map((row) => row.name).join(", ")}.`
          )
        );
        return;
      }
      const sorted2 = sortRows(rows, state.sort);
      const page = pageOf(sorted2, this.settings.limit, state.page);
      state.page = page.page;
      const order2 = `by ${SORT_LABELS[state.sort].toLowerCase()}; ${this.settings.limit} to a page`;
      const pager = () => renderPager(kit, page, pageCount(page, order2), (to) => {
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
          "p",
          "bv-screen-caption",
          `Each row: ${this.estimateName()}${level ? `, with its ${level} confidence interval` : ""}` + (range.log ? " on one logarithmic axis, with 1, no difference, marked. " : " on one axis without units. ") + (method ? `p: ${method}, unadjusted, and adjusted by ${adjustment} across the ${over} biomarker${over === 1 ? "" : "s"} with a p-value. Exploratory, adjusted (${adjustment}).` : "")
        )
      );
      wrap.append(pager());
      const head = kit.createElement("div", "bv-screen-head");
      head.setAttribute("aria-hidden", "true");
      const ticks = kit.createElement("div", "bv-ticks");
      const every = range.ticks.length > 7 ? 2 : 1;
      const anchor = Math.max(range.ticks.indexOf(range.reference ?? 0), 0);
      range.ticks.forEach((tick, index) => {
        if ((index - anchor) % every !== 0) return;
        const label2 = kit.createElement("span", "bv-tick", shown(tick).replace("-", "\u2212"));
        const at = placeOf(tick, range);
        label2.style.left = `${at}%`;
        if (at === 0) label2.style.transform = "none";
        if (at === 100) label2.style.transform = "translateX(-100%)";
        ticks.append(label2);
      });
      head.append(
        kit.createElement("span", null, "Biomarker"),
        ticks,
        kit.createElement("span", null, "Estimate (interval)"),
        kit.createElement("span", null, "p, unadjusted"),
        kit.createElement("span", null, `p, ${adjustment || "adjusted"}`),
        kit.createElement("span", null, this.countsHeading())
      );
      wrap.append(head);
      const list = kit.createElement("div", "bv-screen-rows");
      page.items.forEach((row) => list.append(this.rowOf(row, range)));
      wrap.append(list);
      const tools = kit.createElement("div", "bv-screen-tools bv-no-picture");
      const download = kit.createElement("button", null, "Download: CSV");
      download.type = "button";
      download.onclick = () => this.download(sorted2);
      tools.append(download);
      wrap.append(tools);
    }
    // One row: a button that opens its biomarker. Its estimate and interval are
    // drawn where R's numbers put them on the shared axis.
    rowOf(row, range) {
      const { kit } = this;
      const { formatted } = row;
      const button = kit.createElement("button", "bv-screen-row");
      button.type = "button";
      button.dataset.biomarker = row.biomarker;
      button.dataset.status = formatted.status;
      const opens = {
        difference: "the group comparison",
        correlation: "the association scatter",
        hazard: "the stratified survival chart"
      }[this.state.comparison];
      const outside = row.inAdjustment ? "" : " Not in the adjustment.";
      button.setAttribute("aria-label", `${formatted.text}${outside} Open in ${opens}.`);
      button.onclick = () => this.openRow(row.biomarker);
      button.append(kit.createElement("span", "bv-screen-name", row.biomarker));
      const track = kit.createElement("span", "bv-track");
      const zero = kit.createElement("span", "bv-zero");
      zero.style.left = `${placeOf(range.reference ?? 0, range)}%`;
      track.append(zero);
      if (formatted.status === "shown" && row.estimate !== null) {
        if (row.lower !== null && row.upper !== null) {
          const line = kit.createElement("span", "bv-interval");
          const [from, to] = [placeOf(row.lower, range), placeOf(row.upper, range)];
          line.style.left = `${from}%`;
          line.style.width = `${to - from}%`;
          track.append(line);
        }
        const mark = kit.createElement("span", "bv-estimate");
        mark.style.left = `${placeOf(row.estimate, range)}%`;
        track.append(mark);
      }
      button.append(track);
      if (formatted.status === "shown") {
        button.append(
          kit.createElement(
            "span",
            "bv-screen-value",
            `${formatted.estimate}${formatted.bounds ? ` (${formatted.bounds})` : ""}`
          ),
          this.labelled("bv-screen-p", "Unadjusted: ", formatted.p),
          this.labelled(
            "bv-screen-p bv-screen-adjusted",
            `${formatted.adjustment}: `,
            formatted.adjusted
          ),
          this.labelled("bv-screen-n", `${this.countsHeading()}: `, this.countsOf(row))
        );
      } else {
        button.append(
          kit.createElement("span", "bv-screen-value", `${row.reason || formatted.result}${outside}`)
        );
      }
      return button;
    }
    // A cell with its column's name before it, said where the columns are not
    // drawn: on a narrow screen, where a row stacks.
    labelled(className, label2, value) {
      const cell = this.kit.createElement("span", className);
      cell.append(this.kit.createElement("span", "bv-narrow", label2), document.createTextNode(value));
      return cell;
    }
    // What the counts column holds: each group's, for a difference, or the one count.
    countsHeading() {
      const { state } = this;
      if (state.comparison === "hazard") return `n, ${HAZARD_GROUPS.join(" / ")}`;
      return state.comparison === "difference" && state.levels.length === 2 ? `n, ${state.levels[0]} / ${state.levels[1]}` : "n";
    }
    // A row's counts, as R gave them.
    countsOf(row) {
      if (this.state.comparison !== "correlation" && row.groupCounts)
        return row.groupCounts.join(" / ");
      return row.n === null ? "" : String(row.n);
    }
    // Every row, in the order shown, as a CSV file.
    download(rows) {
      downloadCsv(
        this.kit,
        rows.map((row) => ({
          biomarker: row.biomarker,
          estimate: row.formatted.estimate ?? "",
          interval: row.formatted.bounds ?? "",
          p: row.formatted.p ?? "",
          adjusted: row.formatted.adjusted ?? "",
          n: this.countsOf(row),
          reason: row.formatted.status === "shown" ? "" : row.reason || row.formatted.result
        })),
        // The headings hold no comma: the kit writes a heading as it is.
        [
          { value_col: "biomarker", label: "Biomarker" },
          { value_col: "estimate", label: "Estimate" },
          { value_col: "interval", label: "Confidence interval" },
          { value_col: "p", label: "p unadjusted" },
          { value_col: "adjusted", label: `p adjusted (${this.answer.adjustment || "none"})` },
          { value_col: "n", label: this.countsHeading().replace(", ", " ") },
          { value_col: "reason", label: "Not computed" }
        ],
        "bio.viz-biomarker-screen-rows.csv"
      );
    }
    /**
     * What the controls now read, as the settings the chart would open on with
     * them: the part of its specification the controls hold (#68).
     * @returns {object}
     */
    viewSettings() {
      const { state } = this;
      return {
        comparison: state.comparison,
        endpoint: state.endpoint,
        visit: state.visit,
        value_type: state.valueType,
        group_by: state.groupBy,
        levels: state.levels ? [...state.levels] : null,
        with: state.with ? settingOf(state.with) : null,
        method: state.method,
        adjustment: state.adjustment,
        sort: state.sort,
        page: state.page || 0
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
      if (!model || !model.records || !model.rows) return { columns: [], rows: [] };
      const OUTCOME = { time: "Time", censor: "Censored", event: "Event" };
      return {
        columns: [
          { value_col: settings.id_col, label: "Participant" },
          ...model.rows.map((row) => ({ value_col: row.name, label: row.name })),
          ...model.extra ? [{ value_col: model.extra, label: model.extra }] : [],
          ...(model.outcomeFields || []).map((field) => ({
            value_col: field,
            label: OUTCOME[field] || field
          }))
        ],
        rows: model.records
      };
    }
    /** The placeholders a download's file name is made of, after the chart's name. */
    get viewFields() {
      return ["heading"];
    }
    /**
     * What the title, subtitle and footnotes' placeholders hold for the view now
     * drawn, beside `{date}`, `{version}` and `{filters}` (#66).
     * @returns {object}
     */
    placeholders() {
      const { state, model } = this;
      const endpoint = this.endpoints.find((entry) => entry.endpoint === state.endpoint);
      return {
        heading: model && model.heading ? model.heading : "",
        comparison: COMPARISON_LABELS[state.comparison] || "",
        visit: state.visit ?? "",
        endpoint: state.comparison === "hazard" && endpoint ? endpoint.label : "",
        biomarkers: model && model.rows ? model.rows.length : "",
        n: model && model.records ? model.records.length : ""
      };
    }
    /** What R's counts are of, for the footnote the chart writes. */
    get footnoteCounts() {
      return "biomarkers";
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
          `bio.viz: open() takes a biomarker of the screen, by its name: ${rows.map((row) => row.name).join(", ")}.`
        );
      }
      return this.openRow(String(biomarker));
    }
    openRow(biomarker) {
      this.close();
      const { settings, state, kit } = this;
      const row = this.model.rows.find((entry) => entry.name === biomarker);
      const holder = kit.createElement("div", "bv-screen-drill");
      this.root.classList.add("sv-hidden");
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
        back: { label: BACK2, action: () => this.close() }
      };
      const outcomes = Object.fromEntries(
        Object.keys(OUTCOME_DEFAULTS).map((key) => [key, settings[key]])
      );
      const chart = state.comparison === "hazard" ? stratifiedSurvival(holder, {
        ...carried,
        ...outcomes,
        ...settings.stratified_survival || {},
        // What the screen carries across: the biomarker at its visit and
        // value, cut at its median, the endpoint, the connection and filters.
        group_by: {
          measure: biomarker,
          value: state.valueType,
          ...state.valueType === "baseline" ? {} : { visit: state.visit },
          cut: "median"
        },
        endpoint: state.endpoint,
        ...common
      }).init(this.tables) : state.comparison === "difference" ? groupComparison(holder, {
        ...carried,
        ...settings.group_comparison || {},
        // What the screen carries across: the biomarker, its visit and
        // value, the two groups, Welch's test, the connection and filters.
        start_value: biomarker,
        visits: state.valueType === "baseline" ? null : [state.visit],
        value_type: state.valueType,
        group_by: state.groupBy,
        levels: [...state.levels],
        test: "t",
        ...common
      }).init(this.tables) : associationScatter(holder, {
        ...carried,
        numbers: settings.numbers,
        ...settings.association_scatter || {},
        // The biomarker along the bottom and the variable up the side, with
        // the same coefficient.
        x: settingOf(row.axis),
        y: settingOf(state.with),
        method: state.method,
        ...common
      }).init(this.tables);
      this.drilled = { chart, holder, biomarker };
      const back = holder.querySelector(".bv-back");
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
      this.root.classList.remove("sv-hidden");
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
    destroyCharts() {
    }
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
      this.desk.begin();
      if (this.drilled) {
        this.drilled.chart.destroy();
        this.drilled = null;
      }
      this.element.innerHTML = "";
    }
  };
  function biomarkerScreen(element, settings) {
    return new BiomarkerScreen(element, settings);
  }

  // src/cross-tab/statistic.js
  var TEST_LABELS2 = Object.freeze({
    chisq: "Chi-square test",
    fisher: "Fisher's exact test",
    none: "None"
  });
  var NO_TEST_CHOSEN2 = "Statistics: no test chosen.";
  var NOT_TWO_WAY = "Statistics: no test. A test of a two-way table needs two or more categories each way.";
  var readsBaseline2 = (by) => isCut(by) && typeof by.measure === "string" && by.value !== void 0 && by.value !== "raw";
  function contingencyRequest({ name, test, settings, state, model }) {
    const filters = filtersInForce(state.filters);
    const baseline = [state.rowBy, state.colBy].some(readsBaseline2);
    return {
      name,
      data: model.records,
      args: {
        strRowCol: "row",
        strColCol: "col",
        strMethod: test,
        // The categories in the order the table draws them: a cut's low to
        // high, a column's by name with numbers as numbers, the same in every
        // browser language. Fisher's odds ratio is of the table in this order.
        chrRowGroups: [...model.rowLevels],
        chrColGroups: [...model.colLevels]
      },
      dataId: {
        chart: "cross-tab",
        row_by: state.rowBy,
        col_by: state.colBy,
        ...baseline && settings.baseline_visits ? { baseline_visits: [...settings.baseline_visits] } : {},
        ...baseline ? { baseline_stat: settings.baseline_stat } : {},
        ...Object.keys(filters).length ? { filters } : {}
      },
      rows: model.records.length
    };
  }
  var present3 = (value) => value !== void 0 && value !== null;
  function named(value, names) {
    if (!names) return value;
    const rename = (said2, lead) => said2.replace(
      new RegExp(`(${lead}|; )(row|col) = `, "g"),
      (_, before, field) => `${before}${names[field] || field} = `
    );
    const out = { ...value };
    if (typeof value.reason === "string") out.reason = rename(value.reason, "^Not computed: ");
    if (Array.isArray(value.notes)) {
      out.notes = value.notes.map(
        (note) => (
          // Only the list of categories is renamed, from where it starts.
          typeof note === "string" && note.includes(BELOW_MINIMUM) ? note.slice(0, note.indexOf(BELOW_MINIMUM)) + rename(note.slice(note.indexOf(BELOW_MINIMUM)), BELOW_MINIMUM) : note
        )
      );
    }
    return out;
  }
  var BELOW_MINIMUM = "Below it here: ";
  function oriented(row, groups) {
    const rows = groups && Array.isArray(groups.rows) ? groups.rows : [];
    const cols = groups && Array.isArray(groups.cols) ? groups.cols : [];
    if (row.name !== "odds ratio" || row.group || rows.length !== 2 || cols.length !== 2) return row;
    return {
      ...row,
      group: `${rows[0]} / ${rows[1]}, odds of ${cols[0]} against ${cols[1]}`
    };
  }
  function describeAnswer3(result, context = {}) {
    if (result && result.status === "ok") {
      const value = named(
        result.value && typeof result.value === "object" ? result.value : {},
        context.names
      );
      const formatted = formatStatistic(value);
      const described = sentence(formatted.status, formatted.text);
      if (formatted.status === "shown") {
        described.estimates = (Array.isArray(value.estimates) ? value.estimates : []).filter((row) => row && (present3(row.lower) || present3(row.upper))).map((row) => formatEstimate(oriented(row, context.groups)).text);
      }
      described.remarks = remarksOf(value);
      described.scope = context.scope || null;
      return described;
    }
    const failure = failureOf(result);
    return sentence(failure.state, failure.text);
  }
  function scopeText6({ n, filters = [] }) {
    const said2 = [`This test is of the ${n} participant${n === 1 ? "" : "s"} in the table.`];
    if (filters.length) said2.push(filtersSaid(filters));
    return said2.join(" ");
  }
  function createStatisticDesk6({ connection, note = null }) {
    return createDesk({ connection, note, describe: describeAnswer3 });
  }

  // src/cross-tab/structureData.js
  var grouping2 = (by) => isCut(by) ? by : { col: by };
  function buildTable({ results, participants }, settings, state, options = {}) {
    const config = coreSettings(settings);
    const { participants: kept, results: rows } = keepFiltered(
      { results, participants },
      settings,
      state.filters,
      options.filterMatches
    );
    const empty = {
      records: [],
      rowLevels: [],
      colLevels: [],
      counts: [],
      rowTotals: [],
      colTotals: [],
      total: 0,
      percents: { row: [], col: [] },
      cuts: {},
      cutValues: { row: null, col: null },
      participants: kept ? kept.length : 0,
      dropped: [],
      unused: [],
      filtered: kept ? kept.length : null
    };
    if (!rows.length || !state.rowBy || !state.colBy) return empty;
    const cuts = {};
    for (const [field, by] of [
      ["row", state.rowBy],
      ["col", state.colBy]
    ]) {
      if (isCut(by)) cuts[field] = cutOf({ results: rows, participants: kept }, by, settings);
    }
    const made = frame(
      { results: rows, participants: kept || void 0 },
      { row: grouping2(state.rowBy), col: grouping2(state.colBy) },
      config
    );
    const cutValues = { row: null, col: null };
    for (const field of ["row", "col"]) if (cuts[field]) cutValues[field] = {};
    const records = made.data.map((record) => {
      const out = { [config.id_col]: record[config.id_col] };
      for (const field of ["row", "col"]) {
        out[field] = cuts[field] ? groupLabel(record[field], cuts[field]) : String(record[field]);
        if (cuts[field]) cutValues[field][record[config.id_col]] = record[field];
      }
      return out;
    });
    const levelsFor = (field) => cuts[field] ? cuts[field].labels.filter((label2) => records.some((record) => record[field] === label2)) : categoriesOf(records.map((record) => record[field]));
    const rowLevels = levelsFor("row");
    const colLevels = levelsFor("col");
    const counts = rowLevels.map(
      (row) => colLevels.map(
        (col) => records.filter((record) => record.row === row && record.col === col).length
      )
    );
    const sum3 = (values) => values.reduce((total, value) => total + value, 0);
    const rowTotals = counts.map(sum3);
    const colTotals = colLevels.map((_, j) => sum3(counts.map((row) => row[j])));
    return {
      ...empty,
      records,
      cutValues,
      rowLevels,
      colLevels,
      counts,
      rowTotals,
      colTotals,
      total: sum3(rowTotals),
      percents: {
        row: counts.map((row, i) => row.map((n) => 100 * n / rowTotals[i])),
        col: counts.map((row) => row.map((n, j) => 100 * n / colTotals[j]))
      },
      cuts,
      participants: made.participants,
      dropped: made.dropped,
      unused: made.unused
    };
  }
  function percentText(value) {
    const quarters = value * 4;
    if (Number.isInteger(quarters) && quarters % 2 !== 0) {
      const tenths = Math.floor(value * 10);
      const even = tenths % 2 === 0 ? tenths : tenths + 1;
      return `${(even / 10).toFixed(1)}%`;
    }
    return `${value.toFixed(1)}%`;
  }

  // src/cross-tab.js
  var MODULE_CLASS5 = "bv-cross-tab";
  var STYLE_ID6 = "bio-viz-cross-tab-styles";
  var C4 = `.${MODULE_CLASS5}`;
  var STYLES6 = `${lineStyles(C4)}
${toolbarStyles(C4)}
${C4} .bv-crosstab-wrap{margin:0 0 .8rem;max-width:100%;overflow-x:auto}
${ownTable(`${C4} .bv-crosstab`)}
${C4} .bv-crosstab{border-collapse:collapse;font-size:.85rem;color:#1f2933;font-variant-numeric:tabular-nums}
${C4} .bv-crosstab caption{caption-side:top;text-align:left;font-weight:600;padding:0 0 .4rem}
${C4} .bv-crosstab th,${C4} .bv-crosstab td{border:1px solid #d8dee4;padding:.3rem .55rem;text-align:right;vertical-align:top}
${C4} .bv-crosstab thead th,${C4} .bv-crosstab tbody th{background:#f6f8fa;font-weight:600}
${C4} .bv-crosstab tbody th,${C4} .bv-crosstab .bv-corner{text-align:left}
${C4} .bv-crosstab .bv-total{background:#fbfcfd;font-weight:600}
${C4} .bv-crosstab td.bv-cell{padding:0}
${C4} .bv-cell button{display:block;width:100%;margin:0;border:0;background:transparent;padding:.3rem .55rem;font:inherit;text-align:right;color:inherit;cursor:pointer}
${C4} .bv-cell button:hover{background:#f4f8fc}
${C4} .bv-cell button:focus-visible{outline:2px solid #0b62a4;outline-offset:-2px}
${C4} .bv-percent{display:block;font-size:.75rem;color:#52616f}
${C4} .bv-chart-wrap{height:var(--bv-bars-height,220px);position:relative}
${C4} .bv-control-note{display:block;margin:.2rem 0 0;font-size:.75rem;color:#52616f}`;
  var HINT4 = "Click a count to list its participants and open a participant\u2019s profile. The bars are the same table, as percentages.";
  var CUT_KEY3 = "bv-cut:";
  var CUT_WHO = "Every participant the filters keep with a value is cut, whether or not they have a category the other way.";
  var PERCENT_LABELS = Object.freeze({
    row: "Of each row",
    col: "Of each column",
    none: "None"
  });
  var CrossTab = class {
    constructor(element, settings) {
      this.kit = findKit("the cross-tabulation");
      this.element = typeof element === "string" ? document.querySelector(element) : element;
      if (!this.element) throw new Error(`bio.viz: cross-tabulation target not found: ${element}`);
      this.settings = syncSettings5(settings);
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
      if (this.desk) this.desk.retire();
      this.connection = this.settings.connection || createConnection();
      this.desk = createStatisticDesk6({
        connection: this.connection,
        note: this.settings.waiting_note
      });
    }
    renderShell() {
      mountShell(this, {
        moduleClass: MODULE_CLASS5,
        styleId: STYLE_ID6,
        styles: STYLES6,
        listingFile: "bio.viz-cross-tab-listing.csv"
      });
      this.tableWrap = this.kit.createElement("div", "bv-crosstab-wrap");
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
      if (settings === void 0 || settings === null) {
        this.tables = readGiven(this, data);
      } else {
        this.tables = readGiven(this, data, syncSettings5({ ...this.settings, ...settings }));
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
      const given2 = settings || {};
      const next = syncSettings5({ ...this.settings, ...given2 });
      checkTables(this.tables, next);
      this.settings = next;
      syncHost(this);
      if ("back" in given2) mountToolbar(this);
      if ("connection" in given2 || "waiting_note" in given2) this.connect();
      this.readTables();
      const opening = this.seedState();
      const moved = {
        row_by: "rowBy",
        col_by: "colBy",
        percent: "percent",
        test: "test",
        filters: "filters"
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
    // What the controls can offer, read from the tables and the settings.
    readTables() {
      const { results } = this.tables;
      const { settings } = this;
      this.measures = results.length ? listMeasures(results, settings) : [];
      this.categories = results.length ? categoryColumns(this.tables, settings) : [];
      this.filterSpecs = filterColumns(this.tables, settings, this.categories).map(
        (spec) => this.kit.normalizeFilterSpec(spec)
      );
      this.cutOptions = [];
      for (const by of [settings.row_by, settings.col_by, ...settings.cuts || []]) {
        if (!isCut(by)) continue;
        const written = JSON.stringify(by);
        if (this.cutOptions.some((entry) => JSON.stringify(entry.spec) === written)) continue;
        this.cutOptions.push({
          key: `${CUT_KEY3}${this.cutOptions.length}`,
          spec: by,
          label: label(by)
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
      return this.categories.some((entry) => entry.value_col === value) || this.cutOptions.some((entry) => entry.key === value);
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
        filters: startFilters(this)
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
      this.controls.innerHTML = "";
      const { addSection, addControl, addReset } = kit.controlBuilders(this.controls);
      const redraw = () => this.render();
      const select = (name, labelText, options2, selected, onChange, parent) => {
        const input = document.createElement("select");
        input.dataset.control = name;
        input.setAttribute("aria-label", labelText);
        options2.forEach(([value, text2]) => kit.option(input, value, text2, value === selected));
        input.onchange = () => onChange(input.value);
        return addControl(labelText, input, parent);
      };
      const options = [
        ...this.categories.map((entry) => [entry.value_col, entry.label]),
        ...this.cutOptions.map((entry) => [entry.key, entry.label])
      ];
      const table = addSection("Table");
      if (options.length) {
        select(
          "row-by",
          "Rows",
          options,
          state.rowBy,
          (next) => {
            state.rowBy = next;
            redraw();
          },
          table
        );
        select(
          "col-by",
          "Columns",
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
            "p",
            "sv-warning bv-no-groups",
            "No column can make a category. Give a participant table, or carry a column on the results rows."
          )
        );
      }
      select(
        "percent",
        "Percentages",
        PERCENTS.map((entry) => [entry, PERCENT_LABELS[entry]]),
        state.percent,
        (next) => {
          state.percent = next;
          drawSafely(this, () => this.redrawPercentages());
        },
        table
      );
      if (this.settings.statistic) {
        const statistics = addSection("Statistics");
        select(
          "test",
          "Test",
          TESTS2.map((entry) => [entry, TEST_LABELS2[entry]]),
          state.test,
          (next) => {
            state.test = next;
            redraw();
          },
          statistics
        );
      }
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
      this.notes.innerHTML = "";
      this.tableWrap.innerHTML = "";
      this.multiplesWrap.innerHTML = "";
      this.statLine.textContent = "";
      this.statLine.dataset.state = "empty";
      this.chartWrap.classList.add("sv-hidden");
      this.model = null;
      const { kit, settings, state } = this;
      if (!this.tables.results.length) {
        this.footnote.textContent = "No results to draw.";
        return;
      }
      if (!state.rowBy || !state.colBy) {
        this.footnote.textContent = "Choose the rows and the columns of the table.";
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
        this.footnote.textContent = "No participant has a category each way.";
        return;
      }
      this.drawTable(model);
      this.drawBars(model);
      this.footnote.textContent = [HINT4, ...this.cutNotes(model)].join(" ");
      if (!settings.statistic) return;
      const show = (description) => writeStatistic(kit, this.statLine, description);
      if (state.test === "none") {
        show({ state: "none", text: this.desk.idle(NO_TEST_CHOSEN2), estimates: [], remarks: [] });
        return;
      }
      if (model.rowLevels.length < 2 || model.colLevels.length < 2) {
        show({ state: "none", text: NOT_TWO_WAY, estimates: [], remarks: [] });
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
          writeTitles(this);
          show(description);
        },
        {
          scope: scopeText6({ n: model.total, filters: filtersForScope(this) }),
          names: { row: this.labelOf(state.rowBy), col: this.labelOf(state.colBy) },
          groups: { rows: request.args.chrRowGroups, cols: request.args.chrColGroups }
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
      this.tableWrap.innerHTML = "";
      this.multiplesWrap.innerHTML = "";
      this.drawTable(this.model);
      this.drawBars(this.model);
      this.footnote.textContent = [HINT4, ...this.cutNotes(this.model)].join(" ");
    }
    // Above the table: who is in it, and what was left out of it.
    updateNotes(model) {
      const { kit } = this;
      const add = (text2, warning) => this.notes.append(kit.createElement("span", warning ? "sv-warning" : null, text2));
      if (model.participants) {
        add(`${model.total} of ${model.participants} participants in the table.`);
      }
      model.dropped.forEach((entry) => add(`${entry.n} left out: ${entry.reason}.`, true));
      model.unused.filter((entry) => entry.reason !== UNUSED.MISSING_RESULT).forEach(
        (entry) => add(`${entry.n} row${entry.n === 1 ? "" : "s"} not used: ${entry.reason}.`, true)
      );
      if (model.filtered !== null && model.filtered < this.tables.participants.length) {
        add(`${model.filtered} of ${this.tables.participants.length} participants pass the filters.`);
      }
    }
    // How each cut variable was cut, a sentence each.
    // How each cut variable was cut and, for points worked out from the values,
    // whose values: every participant the filters keep with one, whether or not
    // they have a category the other way (#78 review).
    cutNotes(model) {
      return ["row", "col"].filter((field) => model.cuts[field]).map((field) => {
        const cut = model.cuts[field];
        const said2 = cutNote(cut.spec, cut);
        if (Array.isArray(cut.cut) || !cut.n) return said2;
        return `${said2} ${CUT_WHO}`;
      });
    }
    // The two-way table: a count in each cell, with its percentage when one is
    // chosen, the row and the column totals, and the grand total. A cell is a
    // button that lists its participants.
    drawTable(model) {
      const { kit, state } = this;
      const rowLabel = this.labelOf(state.rowBy);
      const colLabel = this.labelOf(state.colBy);
      const table = kit.createElement("table", "bv-crosstab");
      table.append(kit.createElement("caption", null, `${rowLabel} by ${colLabel}`));
      const head = kit.createElement("thead");
      const top = kit.createElement("tr");
      const corner = kit.createElement("th", "bv-corner", `${rowLabel} \\ ${colLabel}`);
      corner.scope = "col";
      top.append(corner);
      model.colLevels.forEach((level) => {
        const th = kit.createElement("th", null, level);
        th.scope = "col";
        top.append(th);
      });
      const totalHead = kit.createElement("th", "bv-total", "Total");
      totalHead.scope = "col";
      top.append(totalHead);
      head.append(top);
      table.append(head);
      const percentOf = (i, j) => state.percent === "row" ? model.percents.row[i][j] : state.percent === "col" ? model.percents.col[i][j] : null;
      const body = kit.createElement("tbody");
      model.rowLevels.forEach((row, i) => {
        const tr = kit.createElement("tr");
        const th = kit.createElement("th", null, row);
        th.scope = "row";
        tr.append(th);
        model.colLevels.forEach((col, j) => {
          const td = kit.createElement("td", "bv-cell");
          const button = kit.createElement("button");
          button.type = "button";
          button.dataset.row = row;
          button.dataset.col = col;
          const n = model.counts[i][j];
          const percent = percentOf(i, j);
          button.append(document.createTextNode(String(n)));
          if (percent !== null)
            button.append(kit.createElement("span", "bv-percent", percentText(percent)));
          button.setAttribute(
            "aria-label",
            `${rowLabel} ${row}, ${colLabel} ${col}: ${n} participant${n === 1 ? "" : "s"}${percent === null ? "" : `, ${percentText(percent)} of the ${state.percent === "row" ? "row" : "column"}`}. List them.`
          );
          button.onclick = () => this.listCell(row, col);
          td.append(button);
          tr.append(td);
        });
        tr.append(kit.createElement("td", "bv-total", String(model.rowTotals[i])));
        body.append(tr);
      });
      table.append(body);
      const foot = kit.createElement("tfoot");
      const totals = kit.createElement("tr");
      const label2 = kit.createElement("th", "bv-total", "Total");
      label2.scope = "row";
      totals.append(label2);
      model.colTotals.forEach((n) => totals.append(kit.createElement("td", "bv-total", String(n))));
      totals.append(kit.createElement("td", "bv-total", String(model.total)));
      foot.append(totals);
      table.append(foot);
      this.tableWrap.append(table);
    }
    // The stacked bars: the same table as percentages, each row's split by the
    // columns, or, with column percentages, each column's split by the rows.
    drawBars(model) {
      const { kit, state } = this;
      const byColumns = state.percent === "col";
      const bars = byColumns ? model.colLevels : model.rowLevels;
      const parts = byColumns ? model.rowLevels : model.colLevels;
      const share = (bar, part) => byColumns ? model.percents.col[part][bar] : model.percents.row[bar][part];
      this.chartWrap.classList.remove("sv-hidden");
      this.chartWrap.style.setProperty(
        "--bv-bars-height",
        `${Math.max(140, 56 + bars.length * 44)}px`
      );
      const chart = new kit.Chart(this.canvas.getContext("2d"), {
        type: "bar",
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
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: {
              position: "bottom",
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
                text: `Percentage of each ${byColumns ? "column" : "row"}`
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
        "aria-label",
        `Stacked bars, percentage of each ${byColumns ? "column" : "row"}: ` + bars.map(
          (bar, b) => `${bar}: ${parts.map((part, p) => `${part} ${percentText(share(b, p))}`).join(", ")}`
        ).join("; ")
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
      this.footnote.textContent = `${this.labelOf(this.state.rowBy)} ${row}, ${this.labelOf(this.state.colBy)} ${col}: ${records.length} participant${records.length === 1 ? "" : "s"} listed. Click a row to open the participant's profile.`;
      return records;
    }
    listingColumns() {
      if (this.settings.details) return this.settings.details;
      return [
        { value_col: this.settings.id_col, label: "Participant" },
        { value_col: "row", label: this.labelOf(this.state.rowBy) },
        { value_col: "col", label: this.labelOf(this.state.colBy) }
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
      return railSettings(this, "linear");
    }
    /**
     * What the controls now read, as the settings the chart would open on with
     * them: the part of its specification the controls hold (#68).
     * @returns {object}
     */
    viewSettings() {
      const { state } = this;
      const row = this.groupingOf(state.rowBy);
      const col = this.groupingOf(state.colBy);
      return {
        row_by: row,
        col_by: col,
        // Every cut the Rows and Columns controls offer stays offered (#71 review).
        cuts: cutsOffered(this.cutOptions, [row, col]),
        percent: state.percent,
        test: state.test
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
      const columns = [{ value_col: settings.id_col, label: "Participant" }];
      const values = model.cutValues || {};
      for (const [field, by] of [
        ["row", state.rowBy],
        ["col", state.colBy]
      ]) {
        columns.push({ value_col: field, label: this.labelOf(by) });
        if (values[field]) {
          const { cut, ...variable2 } = this.groupingOf(by);
          columns.push({ value_col: `${field}Value`, label: label(variable2) });
        }
      }
      const rows = model.records.map((record) => ({
        ...record,
        ...values.row ? { rowValue: values.row[record[settings.id_col]] } : {},
        ...values.col ? { colValue: values.col[record[settings.id_col]] } : {}
      }));
      return { columns, rows };
    }
    /** The placeholders a download's file name is made of, after the chart's name. */
    get viewFields() {
      return ["rows", "columns"];
    }
    /**
     * What the title, subtitle and footnotes' placeholders hold for the view now
     * drawn, beside `{date}`, `{version}` and `{filters}` (#66).
     * @returns {object}
     */
    placeholders() {
      const { state, model } = this;
      return {
        rows: state.rowBy ? this.labelOf(state.rowBy) : "",
        columns: state.colBy ? this.labelOf(state.colBy) : "",
        n: model ? model.total : ""
      };
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
      this.desk.begin();
      this.destroyCharts();
      this.kit.unmountProfileRail(this.host);
      this.element.innerHTML = "";
    }
  };
  function crossTab(element, settings) {
    return new CrossTab(element, settings);
  }

  // src/specification.js
  var CHARTS = {
    "group-comparison": { ...configure_exports, make: groupComparison },
    "association-scatter": { ...configure_exports2, make: associationScatter },
    "correlation-matrix": { ...configure_exports3, make: correlationMatrix },
    "biomarker-screen": { ...configure_exports4, make: biomarkerScreen },
    "cross-tab": { ...configure_exports5, make: crossTab },
    "stratified-survival": { ...configure_exports6, make: stratifiedSurvival }
  };
  var CHART_SETTINGS = Object.freeze(
    Object.fromEntries(Object.entries(CHARTS).map(([name, entry]) => [name, entry.DEFAULT_SETTINGS]))
  );
  function readChecked(specification) {
    const read2 = readSpecification(specification, CHART_SETTINGS);
    CHARTS[read2.chart].syncSettings(JSON.parse(JSON.stringify(read2.settings)));
    return read2;
  }
  function fromSpecification(element, specification, page = {}) {
    const read2 = readChecked(specification);
    const { chart, settings } = read2;
    const given2 = page === null || page === void 0 ? {} : page;
    const others = Object.keys(given2).filter((key) => !PAGE_SETTINGS.includes(key));
    if (others.length) {
      throw new TypeError(
        `bio.viz: fromSpecification takes the page's ${PAGE_SETTINGS.join(" and ")} beside the specification, and \`${others[0]}\` is not one: give it in the specification's settings.`
      );
    }
    const made = CHARTS[chart].make(element, { ...settings, ...given2 });
    made.requested = { settings: read2.settings, filters: read2.filters };
    return made;
  }
  var readChartSpecification = (specification) => {
    const { chart, settings, version: version2 } = readChecked(specification);
    return { chart, settings, version: version2 };
  };

  // src/data/portfolio.json
  var portfolio_default = {
    $schema: "./schema/portfolio.json",
    version: 2,
    description: "bio.viz's charts, listed in safety.viz's portfolio manifest format (version 2) so that safety.viz's demo app can list and draw them beside its own. Each chart takes two named tables: the results, from the labs and vitals file, and the participants, from the subject-level file, which is optional. Each setting is the key in the chart's own settings (src/<chart>/configure.js), with the standard column it defaults to and whether the chart cannot be made without it; the participant table's id column is read from the subject-level file, so the two files may name the participant differently. A setting of a table this list cannot name, the biomarker screen's outcomes table, has no column and is not required: the app passes nothing for it and the chart keeps its own default. The standard domains are the app's, and every column named here is a column of its domain there. A test holds this list to the charts and to those domains (tests/unit/core/portfolio.test.js).",
    groups: {
      biomarkers: {
        label: "Biomarkers",
        order: 0
      }
    },
    modules: {
      "group-comparison": {
        library: "bio.viz",
        export: "groupComparison",
        title: "Group comparison",
        group: "biomarkers",
        domains: ["bds"],
        optionalDomains: ["subject"],
        tables: {
          results: {
            domain: "bds",
            required: true
          },
          participants: {
            domain: "subject",
            required: false
          }
        },
        unmappedSettings: "omit",
        settings: {
          id_col: {
            domain: "bds",
            column: "USUBJID",
            required: true
          },
          measure_col: {
            domain: "bds",
            column: "TEST",
            required: true
          },
          value_col: {
            domain: "bds",
            column: "STRESN",
            required: true
          },
          visit_col: {
            domain: "bds",
            column: "VISIT",
            required: true
          },
          visit_order_col: {
            domain: "bds",
            column: "VISITNUM",
            required: false
          },
          unit_col: {
            domain: "bds",
            column: "STRESU",
            required: false
          },
          participant_id_col: {
            domain: "subject",
            column: "USUBJID",
            required: false
          },
          studyday_col: {
            domain: "bds",
            column: null,
            required: false
          },
          normal_col_high: {
            domain: "bds",
            column: null,
            required: false
          },
          normal_col_low: {
            domain: "bds",
            column: null,
            required: false
          }
        }
      },
      "association-scatter": {
        library: "bio.viz",
        export: "associationScatter",
        title: "Association scatter",
        group: "biomarkers",
        domains: ["bds"],
        optionalDomains: ["subject"],
        tables: {
          results: {
            domain: "bds",
            required: true
          },
          participants: {
            domain: "subject",
            required: false
          }
        },
        unmappedSettings: "omit",
        settings: {
          id_col: {
            domain: "bds",
            column: "USUBJID",
            required: true
          },
          measure_col: {
            domain: "bds",
            column: "TEST",
            required: true
          },
          value_col: {
            domain: "bds",
            column: "STRESN",
            required: true
          },
          visit_col: {
            domain: "bds",
            column: "VISIT",
            required: true
          },
          visit_order_col: {
            domain: "bds",
            column: "VISITNUM",
            required: false
          },
          unit_col: {
            domain: "bds",
            column: "STRESU",
            required: false
          },
          participant_id_col: {
            domain: "subject",
            column: "USUBJID",
            required: false
          },
          studyday_col: {
            domain: "bds",
            column: null,
            required: false
          },
          normal_col_high: {
            domain: "bds",
            column: null,
            required: false
          },
          normal_col_low: {
            domain: "bds",
            column: null,
            required: false
          }
        }
      },
      "correlation-matrix": {
        library: "bio.viz",
        export: "correlationMatrix",
        title: "Correlation matrix",
        group: "biomarkers",
        domains: ["bds"],
        optionalDomains: ["subject"],
        tables: {
          results: {
            domain: "bds",
            required: true
          },
          participants: {
            domain: "subject",
            required: false
          }
        },
        unmappedSettings: "omit",
        settings: {
          id_col: {
            domain: "bds",
            column: "USUBJID",
            required: true
          },
          measure_col: {
            domain: "bds",
            column: "TEST",
            required: true
          },
          value_col: {
            domain: "bds",
            column: "STRESN",
            required: true
          },
          visit_col: {
            domain: "bds",
            column: "VISIT",
            required: true
          },
          visit_order_col: {
            domain: "bds",
            column: "VISITNUM",
            required: false
          },
          unit_col: {
            domain: "bds",
            column: "STRESU",
            required: false
          },
          participant_id_col: {
            domain: "subject",
            column: "USUBJID",
            required: false
          }
        }
      },
      "biomarker-screen": {
        library: "bio.viz",
        export: "biomarkerScreen",
        title: "Biomarker screen",
        group: "biomarkers",
        domains: ["bds"],
        optionalDomains: ["subject"],
        tables: {
          results: {
            domain: "bds",
            required: true
          },
          participants: {
            domain: "subject",
            required: false
          }
        },
        unmappedSettings: "omit",
        settings: {
          id_col: {
            domain: "bds",
            column: "USUBJID",
            required: true
          },
          measure_col: {
            domain: "bds",
            column: "TEST",
            required: true
          },
          value_col: {
            domain: "bds",
            column: "STRESN",
            required: true
          },
          visit_col: {
            domain: "bds",
            column: "VISIT",
            required: true
          },
          visit_order_col: {
            domain: "bds",
            column: "VISITNUM",
            required: false
          },
          unit_col: {
            domain: "bds",
            column: "STRESU",
            required: false
          },
          participant_id_col: {
            domain: "subject",
            column: "USUBJID",
            required: false
          },
          outcome_id_col: {
            domain: "bds",
            column: null,
            required: false
          },
          endpoint_col: {
            domain: "bds",
            column: null,
            required: false
          },
          endpoint_label_col: {
            domain: "bds",
            column: null,
            required: false
          },
          time_col: {
            domain: "bds",
            column: null,
            required: false
          },
          censor_col: {
            domain: "bds",
            column: null,
            required: false
          },
          event_col: {
            domain: "bds",
            column: null,
            required: false
          }
        }
      },
      "cross-tab": {
        library: "bio.viz",
        export: "crossTab",
        title: "Cross-tabulation",
        group: "biomarkers",
        domains: ["bds"],
        optionalDomains: ["subject"],
        tables: {
          results: {
            domain: "bds",
            required: true
          },
          participants: {
            domain: "subject",
            required: false
          }
        },
        unmappedSettings: "omit",
        settings: {
          id_col: {
            domain: "bds",
            column: "USUBJID",
            required: true
          },
          measure_col: {
            domain: "bds",
            column: "TEST",
            required: true
          },
          value_col: {
            domain: "bds",
            column: "STRESN",
            required: true
          },
          visit_col: {
            domain: "bds",
            column: "VISIT",
            required: true
          },
          visit_order_col: {
            domain: "bds",
            column: "VISITNUM",
            required: false
          },
          unit_col: {
            domain: "bds",
            column: "STRESU",
            required: false
          },
          participant_id_col: {
            domain: "subject",
            column: "USUBJID",
            required: false
          },
          studyday_col: {
            domain: "bds",
            column: null,
            required: false
          },
          normal_col_high: {
            domain: "bds",
            column: null,
            required: false
          },
          normal_col_low: {
            domain: "bds",
            column: null,
            required: false
          }
        }
      }
    }
  };

  // src/main.js
  var version = "0.3.0";
  return __toCommonJS(main_exports);
})();
//# sourceMappingURL=bio.viz.js.map
