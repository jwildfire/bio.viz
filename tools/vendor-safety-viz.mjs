// Vendors safety.viz's script-tag bundle: copies dist/safety.viz-{version}/
// safety.viz.js into site/vendor/safety.viz/ byte for byte, and writes
// SOURCE.json beside it with the safety.viz commit, its version, and the file's
// checksum and size. A chart's page loads this file beside bio.viz's bundle and
// builds from `SafetyViz.kit`; it is never bundled into bio.viz.
//
//   node tools/vendor-safety-viz.mjs
//       copy from the head of safety.viz's `dev` branch on GitHub
//   node tools/vendor-safety-viz.mjs --ref <branch or commit>
//       copy from another branch, or from one commit
//   node tools/vendor-safety-viz.mjs --ref <ref> --unmerged "<why, and what to do later>"
//       record that the commit is not on safety.viz's `dev` branch, and why
//   node tools/vendor-safety-viz.mjs --from <path to a safety.viz clone>
//       read a local clone instead of GitHub
//   node tools/vendor-safety-viz.mjs --check
//       change nothing: fail if the file and its record disagree (no network;
//       `npm test` and the site build make the same check)
//   node tools/vendor-safety-viz.mjs --check-source
//       change nothing: also fetch the recorded commit's file from safety.viz
//       and fail if the vendored file differs from it
//
// Run by hand when safety.viz's kit changes; the output is committed.

import { runVendorCli } from '../scripts/vendor-cli.mjs';
import { SAFETY_VIZ } from '../scripts/vendor-lib.mjs';

await runVendorCli(SAFETY_VIZ, {
  // The version, and so the path of the bundle, is safety.viz's own at the commit.
  async describe({ commit, readAt, option, flag }) {
    const pkg = JSON.parse((await readAt(commit, 'package.json')).toString('utf8'));
    const more = { version: pkg.version };
    if (pkg.license) more.license = pkg.license;
    if (flag('--unmerged')) {
      const note = option('--unmerged');
      if (!note || note.startsWith('--')) {
        throw new Error('--unmerged needs a sentence saying why, and what is to be done later.');
      }
      more.merged_to_dev = false;
      more.note = note;
    } else {
      more.merged_to_dev = true;
    }
    return {
      more,
      files: SAFETY_VIZ.files.map((entry) => ({
        ...entry,
        source: entry.source.replace('{version}', pkg.version)
      }))
    };
  }
});
