// Vendors the synthetic biomarker study from gsm.bio: copies its three CSV
// files into site/data/synthetic-study/ byte for byte, and writes SOURCE.json
// beside them with the gsm.bio commit and each file's checksum, size, columns
// and row count. Nothing is retyped, regenerated or reshaped: gsm.bio makes the
// study (data-raw/synthetic-study.R there) and this only copies it.
//
//   node tools/vendor-synthetic-study.mjs
//       copy from the head of gsm.bio's `dev` branch on GitHub
//   node tools/vendor-synthetic-study.mjs --ref <branch or commit>
//       copy from another branch, or from one commit
//   node tools/vendor-synthetic-study.mjs --from <path to a gsm.bio clone>
//       read a local clone instead of GitHub (its `origin/dev` unless --ref)
//   node tools/vendor-synthetic-study.mjs --check
//       change nothing: fail if a file and its record disagree (no network;
//       `npm test` makes the same check)
//   node tools/vendor-synthetic-study.mjs --check-source
//       change nothing: also fetch the recorded commit's files from gsm.bio
//       and fail if a vendored file differs from them
//
// Run by hand when gsm.bio's study changes; the output is committed, so nothing
// here runs when the site is built.

import { runVendorCli } from '../scripts/vendor-cli.mjs';
import { STUDY } from '../scripts/vendor-lib.mjs';

await runVendorCli(STUDY, {
  // The licence is read from gsm.bio's own DESCRIPTION at the commit.
  async describe({ commit, readAt }) {
    const description = (await readAt(commit, 'DESCRIPTION')).toString('utf8');
    return { license: (description.match(/^License:\s*(.+)$/m) || [])[1] || null };
  }
});
