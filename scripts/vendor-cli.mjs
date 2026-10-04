// The command line behind the two vendoring tools (tools/vendor-*.mjs): fetch
// files from one commit of another repository, write them unchanged with a
// record beside them, or check what is there against the record or against the
// source.
//
//   (no flag)          copy from the head of the source's `dev` branch
//   --ref <ref>        copy from another branch, or from one commit
//   --from <clone>     read a local clone instead of GitHub (its `origin/dev`
//                      unless --ref)
//   --check            change nothing: fail if a file and its record disagree
//                      (no network; `npm test` makes the same check)
//   --check-source     change nothing: also fetch the recorded commit's files
//                      from the source and fail if a vendored file differs
//
// Each tool passes what it vendors, and may add to the record (`describe`).

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRecord,
  readRecord,
  verifyAgainstSource,
  verifyVendored,
  writeVendored
} from './vendor-lib.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// stderr is kept out of the terminal: a failure is reported once.
const git = (gitArgs) =>
  execFileSync('git', gitArgs, { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * @param {object} source What is vendored: { name, repository, directory, files }.
 * @param {object} [options]
 * @param {Function} [options.describe] Given `{ commit, readAt, option }`,
 *   returns `{ files, license, more }`: the files to copy when their paths
 *   depend on the commit, and what else to record.
 */
export async function runVendorCli(source, { describe } = {}) {
  const directory = path.join(rootDir, source.directory);
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const from = option('--from');
  const slug = source.repository.replace('https://github.com/', '');

  async function fetchBytes(commit, file) {
    const url = `https://raw.githubusercontent.com/${slug}/${commit}/${file}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
    return Buffer.from(await response.arrayBuffer());
  }

  // The full commit a ref names, from a local clone or from GitHub.
  function resolveCommit(ref) {
    if (/^[0-9a-f]{40}$/.test(ref)) return ref;
    if (from) {
      return git(['-C', from, 'rev-parse', `${ref}^{commit}`])
        .toString()
        .trim();
    }
    const listed = git(['ls-remote', `${source.repository}.git`, `refs/heads/${ref}`]).toString();
    const commit = listed.split(/\s+/)[0];
    if (!/^[0-9a-f]{40}$/.test(commit)) {
      throw new Error(`${source.repository} has no branch named "${ref}".`);
    }
    return commit;
  }

  function readAt(commit, file) {
    if (!from) return fetchBytes(commit, file);
    try {
      return git(['-C', from, 'show', `${commit}:${file}`]);
    } catch {
      throw new Error(
        `${from} cannot give ${file} at ${commit.slice(0, 7)}: fetch the clone, or leave --from out.`
      );
    }
  }

  function report(problems, passed) {
    if (problems.length) {
      console.error(`✗ ${source.directory} does not match its source record:`);
      problems.forEach((problem) => console.error(`  - ${problem}`));
      process.exit(1);
    }
    console.log(passed);
  }

  try {
    if (flag('--check') || flag('--check-source')) {
      const problems = verifyVendored(directory);
      if (!problems.length && flag('--check-source')) {
        problems.push(...(await verifyAgainstSource(directory, readAt)));
      }
      const record = problems.length ? null : readRecord(directory);
      const count = record && `${record.files.length} file${record.files.length === 1 ? '' : 's'}`;
      const match = record && (record.files.length === 1 ? 'matches its' : 'match their');
      report(
        problems,
        record &&
          `✓ ${source.directory}: ${count} ${match} recorded checksum${record.files.length === 1 ? '' : 's'}` +
            (flag('--check-source')
              ? ` and equal${record.files.length === 1 ? 's' : ''} ${slug} at ${record.commit.slice(0, 7)}` +
                (record.release ? ` and at ${record.release.tag}` : '') +
                ', byte for byte.'
              : ` (copied from ${slug} at ${record.commit.slice(0, 7)}).`)
      );
      return;
    }

    const ref = option('--ref') || (from ? 'origin/dev' : 'dev');
    const commit = resolveCommit(ref);
    const described = describe ? await describe({ commit, readAt, option, flag }) : {};
    const files = described.files || source.files;
    // Everything is read before anything is written, so a failed fetch leaves
    // the folder as it was.
    const sources = new Map();
    for (const { source: file } of files) sources.set(file, await readAt(commit, file));

    const vendored = buildRecord({
      study: { ...source, files },
      ref: ref.replace(/^origin\//, ''),
      commit,
      license: described.license,
      more: described.more,
      read: (file) => sources.get(file)
    });
    writeVendored(directory, vendored);
    for (const entry of vendored.record.files) {
      const rows = entry.rows === undefined ? `${entry.bytes} bytes` : `${entry.rows} rows`;
      console.log(`✓ Wrote ${source.directory}/${entry.file} — ${rows}`);
    }
    console.log(`✓ Wrote ${source.directory}/SOURCE.json — ${slug} at ${commit}`);
    report(verifyVendored(directory), '✓ Every file matches its record.');
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}
