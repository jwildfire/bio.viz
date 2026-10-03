// Vendors safety.viz's portfolio manifest format: copies
// src/data/schema/portfolio.json into src/data/schema/ byte for byte, and
// writes SOURCE.json beside it with the safety.viz commit, its version, and the
// file's checksum and size. bio.viz's chart list (src/data/portfolio.json) is
// written in that format, and tests/unit/core/portfolio.test.js validates it
// against this copy. Nothing here edits it.
//
//   node tools/vendor-portfolio-schema.mjs
//       copy from the head of safety.viz's `dev` branch on GitHub
//   node tools/vendor-portfolio-schema.mjs --ref <branch or commit>
//       copy from another branch, or from one commit
//   node tools/vendor-portfolio-schema.mjs --from <path to a safety.viz clone>
//       read a local clone instead of GitHub (its `origin/dev` unless --ref)
//   node tools/vendor-portfolio-schema.mjs --check
//       change nothing: fail if the file and its record disagree (no network;
//       `npm test` makes the same check)
//   node tools/vendor-portfolio-schema.mjs --check-source
//       change nothing: also fetch the recorded commit's file from safety.viz
//       and fail if the vendored file differs from it
//
// Run by hand when safety.viz's manifest format changes, then rerun `npm test`:
// the chart list must still validate. The output is committed.

import { runVendorCli } from '../scripts/vendor-cli.mjs';
import { PORTFOLIO_SCHEMA } from '../scripts/vendor-lib.mjs';

await runVendorCli(PORTFOLIO_SCHEMA, {
  // The version and the licence are safety.viz's own, read from its
  // package.json at the commit. The record says the commit is on `dev` only
  // when it was copied from the head of `dev`.
  async describe({ commit, readAt, option }) {
    const pkg = JSON.parse((await readAt(commit, 'package.json')).toString('utf8'));
    const ref = option('--ref');
    const more = { version: pkg.version };
    if (!ref || /^(origin\/)?dev$/.test(ref)) more.merged_to_dev = true;
    return pkg.license ? { license: pkg.license, more } : { more };
  }
});
