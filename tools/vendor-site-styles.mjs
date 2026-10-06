// Vendors safety.viz's site styles (#91): copies site/site.css and
// site/shell.html into site/vendor/safety.viz-site/ byte for byte, and writes
// SOURCE.json beside them with the safety.viz commit, its version, and each
// file's checksum and size. Every page of this site loads that stylesheet
// before site/site.css, and site/shell.html follows that shell;
// tests/unit/site/siteStyles.test.js holds both. Nothing here edits either.
//
//   node tools/vendor-site-styles.mjs
//       copy from the head of safety.viz's `dev` branch on GitHub
//   node tools/vendor-site-styles.mjs --ref <branch or commit>
//       copy from another branch, or from one commit
//   node tools/vendor-site-styles.mjs --from <path to a safety.viz clone>
//       read a local clone instead of GitHub (its `origin/dev` unless --ref)
//   node tools/vendor-site-styles.mjs --check
//       change nothing: fail if a file and its record disagree (no network;
//       `npm test` and the site build make the same check)
//   node tools/vendor-site-styles.mjs --check-source
//       change nothing: also fetch the recorded commit's files from safety.viz
//       and fail if a vendored file differs from them
//
// Run by hand when safety.viz's site changes its look, then rerun `npm test`
// and look at the pages: the test names what site/shell.html must take from the
// new shell, and a class this site's pages use may have changed. Ask for the
// site's screenshot baselines again (CONTRIBUTING.md). The output is committed.

import { runVendorCli } from '../scripts/vendor-cli.mjs';
import { SITE_STYLES } from '../scripts/vendor-lib.mjs';

await runVendorCli(SITE_STYLES, {
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
