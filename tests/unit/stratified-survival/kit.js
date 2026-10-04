import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// safety.viz's kit, from the vendored script-tag bundle, run with no page: the
// chart's curves are the kit's estimator, so the tests use that one and no
// other. The bundle defines the global `SafetyViz`.
const code = readFileSync(
  new URL('../../../site/vendor/safety.viz/safety.viz.js', import.meta.url),
  'utf8'
);
const context = vm.createContext({ console, setTimeout, clearTimeout });
vm.runInContext(`${code}\n;globalThis.SafetyViz = SafetyViz;`, context);

export const kit = context.SafetyViz.kit;
