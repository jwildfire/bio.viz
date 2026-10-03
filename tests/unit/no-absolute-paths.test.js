import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A machine-specific path in a source or test file passes locally and fails
// everywhere else: green on the author's machine, "Failed to resolve import" on
// the CI runner, where the file silently contributes no records to the evidence
// set. Carried over from safety.viz, which learned it the hard way.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCANNED = ['src', 'tests', 'scripts', 'site'];

function jsFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|mjs)$/.test(entry.name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

// An absolute POSIX path inside a quoted string, or a Windows drive letter.
const ABSOLUTE = /(['"`])(\/(Users|home|var|tmp|opt|private)\/|[A-Za-z]:[\\/])/;

describe('repo hygiene', () => {
  it('no source or test file carries a machine-specific absolute path (#1)', () => {
    const offenders = [];
    for (const dir of SCANNED) {
      const full = path.join(ROOT, dir);
      if (!fs.existsSync(full)) continue;
      for (const file of jsFiles(full)) {
        fs.readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, index) => {
            if (ABSOLUTE.test(line)) {
              offenders.push(`${path.relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
            }
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
