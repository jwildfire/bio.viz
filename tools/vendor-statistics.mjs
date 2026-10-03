// Vendors gsm.bio's statistics functions: copies inst/statistics/statistics.R
// into site/vendor/gsm.bio/ byte for byte, and writes SOURCE.json beside it
// with the gsm.bio commit, its version and licence, and the file's checksum and
// size. It is the one file R in the browser is given: a chart's page hands it
// to the connection as `sourceUrl`, and tools/r-group-statistics.R sources the
// same copy in desktop R, so the expected results and the page run one source.
// Nothing here edits it.
//
//   node tools/vendor-statistics.mjs
//       copy from the head of gsm.bio's `dev` branch on GitHub
//   node tools/vendor-statistics.mjs --ref <branch or commit>
//       copy from another branch, or from one commit
//   node tools/vendor-statistics.mjs --from <path to a gsm.bio clone>
//       read a local clone instead of GitHub (its `origin/dev` unless --ref)
//   node tools/vendor-statistics.mjs --check
//       change nothing: fail if the file and its record disagree (no network;
//       `npm test` and the site build make the same check)
//   node tools/vendor-statistics.mjs --check-source
//       change nothing: also fetch the recorded commit's file from gsm.bio and
//       fail if the vendored file differs from it
//
// Run by hand when gsm.bio's statistics change, then rerun `npm run fixtures`:
// the expected results are what desktop R gives with this file. The output is
// committed.

import { runVendorCli } from '../scripts/vendor-cli.mjs';
import { STATISTICS } from '../scripts/vendor-lib.mjs';

await runVendorCli(STATISTICS, {
  // The version and the licence are gsm.bio's own, read from its DESCRIPTION at
  // the commit.
  async describe({ commit, readAt }) {
    const description = (await readAt(commit, 'DESCRIPTION')).toString('utf8');
    const field = (name) =>
      (description.match(new RegExp(`^${name}:\\s*(.+)$`, 'm')) || [])[1] || null;
    return { license: field('License'), more: { version: field('Version') } };
  }
});
