// The connection to R: the one way a chart asks for a statistic.
//
//   const connection = createConnection({ results, browser });
//   const result = await connection.run('rank_sum', { data, args, dataId });
//
// `run` always resolves, to one of three results:
//
//   { status: 'ok', value, form }             what R returned; form says which
//                                             form answered, and a stored
//                                             result carries `computedBy` when
//                                             the connection was told it
//   { status: 'unavailable', reason, message } no R answered; the chart still
//                                             draws and prints the message
//   { status: 'error', message }              R ran and reported an error
//
// Two forms sit behind it and either or both may be configured. Precomputed:
// results shipped with the page, looked up without loading anything. Browser:
// R started in the page the first time a result is needed that was not stored.
// With neither, every answer is `unavailable`.
//
// A connection keeps its state to itself — its stored results and its one R
// session — so it can be handed to any chart, in this library or another, as a
// setting.

import { isPlainObject } from './canonical.js';
import { createStore, lookUp } from './storedResults.js';
import { createWebREngine, WEBR_BASE_URL } from './webREngine.js';

const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9.]*$/;

const unavailable = (reason, message) => ({ status: 'unavailable', reason, message });
const failed = (message) => ({ status: 'error', message });

// Whatever was thrown, as a sentence: an Error's message, a bare string, or a
// plain statement that nothing was said.
function messageOf(thrown) {
  if (thrown instanceof Error && thrown.message) return thrown.message;
  if (typeof thrown === 'string' && thrown !== '') return thrown;
  if (thrown && typeof thrown.message === 'string' && thrown.message !== '') return thrown.message;
  return 'R stopped without a message';
}

function readBrowser(browser) {
  if (browser === undefined || browser === null) return null;
  if (!isPlainObject(browser)) {
    throw new TypeError('bio.viz: `browser` must be an object of settings.');
  }
  const { baseUrl = WEBR_BASE_URL, packages = [], source, sourceUrl, engine } = browser;
  if (typeof baseUrl !== 'string' || baseUrl === '') {
    throw new TypeError('bio.viz: `browser.baseUrl` must be the URL webR is served from.');
  }
  if (!Array.isArray(packages)) {
    throw new TypeError('bio.viz: `browser.packages` must be an array of R package names.');
  }
  for (const name of packages) {
    if (typeof name !== 'string' || !PACKAGE_NAME.test(name)) {
      throw new TypeError(`bio.viz: \`browser.packages\` holds an invalid package name: ${name}`);
    }
  }
  if (source !== undefined && typeof source !== 'string') {
    throw new TypeError('bio.viz: `browser.source` must be R source text.');
  }
  if (sourceUrl !== undefined && typeof sourceUrl !== 'string') {
    throw new TypeError('bio.viz: `browser.sourceUrl` must be the URL of a file of R source.');
  }
  if (source !== undefined && sourceUrl !== undefined) {
    throw new TypeError('bio.viz: give `browser.source` or `browser.sourceUrl`, not both.');
  }
  if (
    engine !== undefined &&
    (!engine || typeof engine.start !== 'function' || typeof engine.call !== 'function')
  ) {
    throw new TypeError('bio.viz: `browser.engine` must have `start` and `call` methods.');
  }
  return {
    engine: engine || createWebREngine(),
    config: { baseUrl, packages: [...packages], source, sourceUrl }
  };
}

// Which R computed the stored results: `{ r_version, gsm_bio_version,
// computed_at }`, each text, as gsm.bio's widget writes it, or nothing.
function readComputedBy(computedBy) {
  if (computedBy === undefined || computedBy === null) return null;
  const text = (value) => typeof value === 'string' && value.trim() !== '';
  if (
    !isPlainObject(computedBy) ||
    !text(computedBy.r_version) ||
    (computedBy.gsm_bio_version !== undefined && !text(computedBy.gsm_bio_version)) ||
    (computedBy.computed_at !== undefined && !text(computedBy.computed_at))
  ) {
    throw new TypeError(
      'bio.viz: `computedBy` must be { r_version, gsm_bio_version, computed_at }, each text: ' +
        'which R computed the stored results.'
    );
  }
  const { r_version, gsm_bio_version, computed_at } = computedBy;
  return Object.freeze({
    r_version,
    ...(gsm_bio_version === undefined ? {} : { gsm_bio_version }),
    ...(computed_at === undefined ? {} : { computed_at })
  });
}

// Why a call cannot be made at all, or null. These are mistakes in the calling
// code; they are answered like any other failure so that a chart never needs a
// try/catch around `run`.
function misuse(name, request) {
  if (typeof name !== 'string' || name.trim() === '') {
    return 'bio.viz: run() needs the name of an R function.';
  }
  if (!isPlainObject(request)) {
    return 'bio.viz: run() takes the name and an object: { data, args, dataId }.';
  }
  if (request.data !== undefined && !Array.isArray(request.data)) {
    return 'bio.viz: `data` must be an array of records, one object per row.';
  }
  if (request.args !== undefined && !isPlainObject(request.args)) {
    return 'bio.viz: `args` must be an object of named arguments.';
  }
  return null;
}

/**
 * Makes a connection to R.
 *
 * @param {object} [options]
 * @param {Array<{name: string, args?: object, dataId: *, rows?: number, value: *}>} [options.results]
 *   The precomputed form: stored results, each found by its function name,
 *   arguments and data identity together.
 * @param {{r_version: string, gsm_bio_version?: string, computed_at?: string}} [options.computedBy]
 *   Which R computed the stored results, as gsm.bio's widget records it:
 *   `r_version` always, `gsm_bio_version` and `computed_at` (ISO 8601) when
 *   known. An answer from them carries it as `computedBy`, and a chart's
 *   footnote names the versions and the date.
 * @param {object} [options.browser] The browser form: R started in the page on
 *   the first run that needs it.
 * @param {string} [options.browser.source] R source text defining the functions
 *   to call; evaluated once.
 * @param {string} [options.browser.sourceUrl] Instead of `source`: the URL of
 *   that file, fetched on the first run.
 * @param {string[]} [options.browser.packages] R packages to install and attach.
 * @param {string} [options.browser.baseUrl] Where webR is served from. Default:
 *   the public CDN for the pinned version.
 * @param {{start: Function, call: Function}} [options.browser.engine] Something
 *   else to reach R with, in place of webR.
 * @returns {{run: function(string, {data?: object[], args?: object, dataId?: *}): Promise<object>}}
 */
export function createConnection(options = {}) {
  if (!isPlainObject(options)) {
    throw new TypeError('bio.viz: createConnection takes an object of settings.');
  }
  const store = createStore(options.results);
  const computedBy = readComputedBy(options.computedBy);
  const browser = readBrowser(options.browser);

  // The one start this connection shares between every call that needs R. A
  // start that fails is forgotten, so the next call tries again.
  let starting = null;
  function started() {
    if (!starting) {
      starting = Promise.resolve()
        .then(() => browser.engine.start({ ...browser.config }))
        .catch((error) => {
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
          return computedBy
            ? {
                status: 'ok',
                value: found.value,
                form: 'precomputed',
                computedBy: { ...computedBy }
              }
            : { status: 'ok', value: found.value, form: 'precomputed' };
        }
        missed = found.message;
      }

      if (!browser) {
        return missed
          ? unavailable('not-precomputed', missed)
          : unavailable(
              'no-r-attached',
              'Statistics are unavailable: no R is attached to this chart.'
            );
      }

      try {
        await started();
      } catch (error) {
        return unavailable(
          'load-failed',
          `Statistics are unavailable: R could not be started (${messageOf(error)}).`
        );
      }

      try {
        const value = await browser.engine.call(name, { data, args });
        return { status: 'ok', value, form: 'browser' };
      } catch (error) {
        return failed(messageOf(error));
      }
    } catch (error) {
      // Nothing above should throw; if it does, the promise still resolves.
      return failed(messageOf(error));
    }
  }

  return Object.freeze({ run });
}
