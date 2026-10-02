// The browser form's engine: R itself, compiled to WebAssembly by the webR
// project, running on the reader's machine. This file is the only one that
// knows webR's API.
//
// webR is not part of the bundle and is not an npm dependency. It is fetched
// with a dynamic `import()` of a URL the first time a result is asked for, from
// the public CDN by default or from wherever the page says it serves its own
// copy. The version is pinned: a copy served elsewhere must be the same one.
//
// An engine is an object with two methods, which is all the connection asks of
// it — so a test, or a different way of reaching R, can stand in for this one:
//
//   start({ baseUrl, packages, source, sourceUrl })  load R, once
//   call(name, { data, args })                        run one function; returns
//                                                     plain JavaScript, throws
//                                                     an Error with R's message

export const WEBR_VERSION = '0.6.0';
export const WEBR_BASE_URL = `https://webr.r-wasm.org/v${WEBR_VERSION}/`;

// Base R only: no package is needed to pass a table in or a result out.
//
// `.bioviz_call` makes a data frame of the columns and calls the named function
// with the data frame first and the arguments after it. The call is made by
// name, with the data frame referred to as `data`, so R's messages read
// `rank_sum(data, value = "AVAL")` rather than carrying the whole table. An R
// error is caught and handed back as its message, exactly as R worded it.
// `.bioviz_plain` leaves the result as nested lists and vectors, which webR
// hands to JavaScript as they are: factors and dates become text, and a data
// frame becomes a list of its columns.
const R_HELPERS = `
.bioviz_plain <- function(x) {
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

// Left for the page to resolve when it runs. The URL is a variable so that no
// bundler tries to find webR, here or in an application that bundles bio.viz.
const importFromUrl = (url) => import(/* @vite-ignore */ url);

async function fetchTextFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

// A location relative to the page is resolved against the page, not against
// wherever this script was loaded from.
function resolveBase(baseUrl) {
  const withSlash = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return typeof document === 'undefined' ? withSlash : new URL(withSlash, document.baseURI).href;
}

// An array of records to one array per column. Every column gets a value for
// every row; a value that is absent, undefined or not-a-number goes to R as NA.
// A reshaping only: no value is computed or changed.
export function recordsToColumns(records) {
  const columns = {};
  const rows = Array.isArray(records) ? records : [];
  rows.forEach((record, index) => {
    for (const name of Object.keys(record || {})) {
      if (!(name in columns)) columns[name] = new Array(rows.length).fill(null);
      const value = record[name];
      columns[name][index] = value === undefined || Number.isNaN(value) ? null : value;
    }
  });
  return columns;
}

const ATOMIC = new Set(['logical', 'integer', 'double', 'character']);
const allNamed = (names) =>
  Array.isArray(names) && names.length > 0 && names.every((name) => name !== null && name !== '');

// webR's tree for an R value to plain JavaScript:
//
//   NULL                      null
//   NA                        null
//   unnamed vector, length 1  a number, string or boolean
//   unnamed vector, otherwise an array
//   named vector              an object, whatever its length
//   named list                an object
//   unnamed list              an array, whatever its length
//
// So an R function that must return an array even for one element returns an
// unnamed list. Anything else (a function, an environment) has no plain form
// and is an error rather than a guess.
export function toPlain(node) {
  if (!node || node.type === 'null') return null;
  if (node.type === 'list') {
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

// A JavaScript object to an R named list, at every depth. Said outright because
// webR reads a bare object as a data frame, which an object of single values —
// a set of arguments — is not.
async function toRList(shelter, object) {
  const members = {};
  for (const [name, value] of Object.entries(object)) {
    members[name] =
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? await toRList(shelter, value)
        : value;
  }
  return new shelter.RList(members);
}

// `importModule` and `fetchText` exist so tests can stand in for the network.
export function createWebREngine({
  importModule = importFromUrl,
  fetchText = fetchTextFromUrl
} = {}) {
  let webR = null;

  return {
    async start({ baseUrl = WEBR_BASE_URL, packages = [], source, sourceUrl } = {}) {
      const base = resolveBase(baseUrl);
      const { WebR, ChannelType } = await importModule(`${base}webr.mjs`);
      // The PostMessage channel works on any static host. The faster channel
      // needs cross-origin isolation headers that GitHub Pages cannot set, and
      // behaviour should not differ by host — so it is used everywhere.
      const instance = new WebR({
        baseUrl: base,
        channelType: ChannelType.PostMessage,
        interactive: false
      });
      try {
        await instance.init();
        if (packages.length > 0) {
          await instance.installPackages(packages, { quiet: true });
          // Attached as well as installed: a package that failed to install is
          // an error here, at the start, not in the middle of a chart.
          for (const name of packages) {
            await instance.evalRVoid(`library(${JSON.stringify(name)}, character.only = TRUE)`);
          }
        }
        await instance.evalRVoid(R_HELPERS);
        const code = sourceUrl ? await fetchText(sourceUrl) : source;
        if (code) await instance.evalRVoid(code);
      } catch (error) {
        // Do not leave a worker running behind a start that failed.
        if (typeof instance.close === 'function') instance.close();
        throw error;
      }
      webR = instance;
    },

    async call(name, { data, args } = {}) {
      const columns = recordsToColumns(data);
      const hasColumns = Object.keys(columns).length > 0;
      const hasArgs = args && Object.keys(args).length > 0;
      const code =
        `.bioviz_call(.bioviz_name, ` +
        `${hasColumns ? '.bioviz_columns' : 'NULL'}, ${hasArgs ? '.bioviz_args' : 'NULL'})`;

      const shelter = await new webR.Shelter();
      try {
        // The values travel as bindings of this one evaluation, so two calls in
        // flight never see each other's data.
        const env = { '.bioviz_name': name };
        if (hasColumns) env['.bioviz_columns'] = await toRList(shelter, columns);
        if (hasArgs) env['.bioviz_args'] = await toRList(shelter, args);
        const result = await shelter.evalR(code, { env });
        const answer = toPlain(await result.toJs());
        if (!answer || answer.ok !== true) {
          throw new Error(
            answer && typeof answer.message === 'string' && answer.message !== ''
              ? answer.message
              : 'R stopped without a message'
          );
        }
        return answer.value === undefined ? null : answer.value;
      } finally {
        await shelter.purge();
      }
    }
  };
}
