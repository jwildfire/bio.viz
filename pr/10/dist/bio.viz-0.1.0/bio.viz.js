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
      const given = Array.isArray(data) ? data.length : "none";
      if (given !== entry.rows) {
        return miss(
          `fits the data given: it was computed on ${entry.rows} rows, and ${given} were given`
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
    const label = adjustment && adjustment.toLowerCase() !== "none" ? `Exploratory, adjusted (${adjustment}).` : "Exploratory, unadjusted.";
    return { status: "shown", text: `${method}: ${formatP(p)} (${counts}). ${label}` };
  }

  // src/main.js
  var version = "0.1.0";
  return __toCommonJS(main_exports);
})();
//# sourceMappingURL=bio.viz.js.map
