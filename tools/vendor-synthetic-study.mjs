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

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STUDY,
  buildRecord,
  readRecord,
  verifyAgainstSource,
  verifyVendored,
  writeVendored
} from '../scripts/vendor-lib.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(rootDir, STUDY.directory);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const from = option('--from');
const slug = STUDY.repository.replace('https://github.com/', '');

// stderr is kept out of the terminal: a failure is reported once, below.
const git = (gitArgs) =>
  execFileSync('git', gitArgs, { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

async function fetchBytes(commit, file) {
  const url = `https://raw.githubusercontent.com/${slug}/${commit}/${file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

// The full commit a ref names, from a local clone or from GitHub.
function resolveCommit(ref) {
  if (/^[0-9a-f]{40}$/.test(ref)) return ref;
  if (from)
    return git(['-C', from, 'rev-parse', `${ref}^{commit}`])
      .toString()
      .trim();
  const listed = git(['ls-remote', `${STUDY.repository}.git`, `refs/heads/${ref}`]).toString();
  const commit = listed.split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`${STUDY.repository} has no branch named "${ref}".`);
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
    console.error(`✗ ${STUDY.directory} does not match its source record:`);
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
    report(
      problems,
      record &&
        `✓ ${STUDY.directory}: ${record.files.length} files match their recorded checksums` +
          (flag('--check-source')
            ? ` and equal ${slug} at ${record.commit.slice(0, 7)}, byte for byte.`
            : ` (copied from ${slug} at ${record.commit.slice(0, 7)}).`)
    );
  } else {
    const ref = option('--ref') || (from ? 'origin/dev' : 'dev');
    const commit = resolveCommit(ref);
    // Everything is read before anything is written, so a failed fetch leaves the
    // folder as it was.
    const sources = new Map();
    for (const { source } of STUDY.files) sources.set(source, await readAt(commit, source));
    const description = (await readAt(commit, 'DESCRIPTION')).toString('utf8');
    const license = (description.match(/^License:\s*(.+)$/m) || [])[1] || null;

    const vendored = buildRecord({
      ref: ref.replace(/^origin\//, ''),
      commit,
      license,
      read: (source) => sources.get(source)
    });
    writeVendored(directory, vendored);
    for (const entry of vendored.record.files) {
      console.log(`✓ Wrote ${STUDY.directory}/${entry.file} — ${entry.rows} rows`);
    }
    console.log(`✓ Wrote ${STUDY.directory}/SOURCE.json — ${slug} at ${commit}`);
    report(verifyVendored(directory), '✓ Every file matches its record.');
  }
} catch (error) {
  console.error(`✗ ${error.message}`);
  process.exit(1);
}
