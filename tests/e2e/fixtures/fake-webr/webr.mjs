// A stand-in for webR's `webr.mjs`, so the connection's browser form can be
// tested with no network and no R. It mimics only the slice of the webR 0.6.0
// API that src/r/webREngine.js uses: ChannelType, WebR (init, installPackages,
// evalRVoid, close) and Shelter (RList, evalR with an `env`, purge), plus the tree
// shape `toJs()` returns. It computes nothing statistical: a test registers the
// "R functions" it wants as JavaScript stubs that return canned trees.
//
// Real webR is exercised by the R check page, not here.
//
// Shared state lives on globalThis.__fakeWebR so a test (or a page) can read
// what the engine did:
//   evaluations  how many times this module was evaluated
//   instances    every WebR constructed, each with its `options` and call `log`
//   functions    name -> (columns, args) => tree, the stub "R functions"

const state = (globalThis.__fakeWebR ??= { evaluations: 0, instances: [], functions: {} });
state.evaluations += 1;

export const ChannelType = { Automatic: 0, SharedArrayBuffer: 1, ServiceWorker: 2, PostMessage: 3 };

export class WebR {
  constructor(options) {
    this.options = options;
    this.log = [];
    this.attached = [];
    state.instances.push(this);
  }

  async init() {
    this.log.push(['init']);
  }

  async installPackages(packages, options) {
    this.log.push(['installPackages', packages, options]);
  }

  async evalRVoid(code) {
    this.log.push(['evalRVoid', code]);
    const attach = code.match(/^library\("([^"]+)", character\.only = TRUE\)$/);
    if (attach) {
      // As in R: attaching a package that did not install is an error.
      if (attach[1] === 'notapackage') {
        throw new Error(`there is no package called ‘${attach[1]}’`);
      }
      this.attached.push(attach[1]);
    }
    if (code.includes('stop(')) throw new Error('error in the R source');
  }

  close() {
    this.log.push(['close']);
  }

  get Shelter() {
    const webR = this;
    return class Shelter {
      // webR builds an R named list from an object's members. Here the list is
      // the object itself, tagged so a test can see that one was asked for.
      get RList() {
        return class RList {
          constructor(members) {
            webR.log.push(['RList', Object.keys(members)]);
            return unwrap(members);
          }
        };
      }

      async evalR(code, options = {}) {
        webR.log.push(['evalR', code, options]);
        const env = options.env || {};
        const name = env['.bioviz_name'];
        const fn = state.functions[name];
        // As the helper in R does: an error comes back as a value, with the
        // message R gave and nothing added.
        let answer;
        try {
          if (!fn) throw new Error(`could not find function "${name}"`);
          answer = okTree(fn(env['.bioviz_columns'], env['.bioviz_args']));
        } catch (error) {
          answer = errorTree(error.message);
        }
        return { toJs: async () => answer };
      }

      async purge() {
        webR.log.push(['purge']);
      }
    };
  }
}

const unwrap = (members) =>
  Object.fromEntries(Object.entries(members).map(([name, value]) => [name, value]));

// list(ok = TRUE, value = <tree>) and list(ok = FALSE, message = "…"), in the
// shape toJs() gives them.
const okTree = (value) => ({
  type: 'list',
  names: ['ok', 'value'],
  values: [{ type: 'logical', names: null, values: [true] }, value]
});
const errorTree = (message) => ({
  type: 'list',
  names: ['ok', 'message'],
  values: [
    { type: 'logical', names: null, values: [false] },
    { type: 'character', names: null, values: [message] }
  ]
});
