import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION_SAID } from '../../../src/shared/titles.js';

// The evidence pictures (#78 review). A picture is compared with what the page
// draws within a pixel tolerance, and a footnote that names another version
// changes too few pixels to fail it. So beside each picture the browser suite
// keeps the versions of bio.viz the capture drew (tests/e2e/evidence.js), and
// this holds every one of them to the package's version, read as text.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const EVIDENCE = path.join(ROOT, 'docs', 'evidence');
const modules = readdirSync(EVIDENCE, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const filesOf = (module) => readdirSync(path.join(EVIDENCE, module)).sort();

describe('evidence pictures: the version each one draws', () => {
  it('CORE-SITE-017: every committed evidence picture, the gallery’s among them, has the record of the versions of bio.viz it draws, each the package’s version as the footnote says it, written for its own bytes (sha256), with the pictures it shows named; no record is left without its picture (#78)', () => {
    const said = `bio.viz ${VERSION_SAID}`;
    const problems = [];
    let pictures = 0;
    for (const module of modules) {
      const files = filesOf(module);
      for (const file of files.filter((name) => name.endsWith('.png'))) {
        pictures += 1;
        const record = path.join(EVIDENCE, module, file.replace(/\.png$/, '.drawn.json'));
        if (!existsSync(record)) {
          problems.push(`${module}/${file}: no record of the versions it draws`);
          continue;
        }
        const { versions, sha256, embeds = [] } = JSON.parse(readFileSync(record, 'utf8'));
        // The record is of this picture's bytes: one swapped in from another
        // commit, however few of its pixels differ, is not the one recorded.
        const bytes = readFileSync(path.join(EVIDENCE, module, file));
        const hash = createHash('sha256').update(bytes).digest('hex');
        if (sha256 !== hash) {
          problems.push(
            `${module}/${file}: its bytes are not the picture its record was written for`
          );
        }
        // A capture that shows other pictures names them, and each is held to
        // the version by its own record.
        for (const embedded of embeds) {
          const [owner, name] = embedded.split('/');
          if (!existsSync(path.join(EVIDENCE, owner, name.replace(/\.png$/, '.drawn.json')))) {
            problems.push(`${module}/${file}: shows ${embedded}, which has no record`);
          }
        }
        for (const version of versions) {
          if (version !== said)
            problems.push(`${module}/${file}: draws "${version}", not "${said}"`);
        }
      }
      for (const file of files.filter((name) => name.endsWith('.drawn.json'))) {
        if (!files.includes(file.replace(/\.drawn\.json$/, '.png'))) {
          problems.push(`${module}/${file}: a record with no picture`);
        }
      }
    }
    expect(pictures).toBeGreaterThan(90);
    expect(problems).toEqual([]);
    // The gallery's page is a picture of the charts' pictures: it names all six.
    const gallery = JSON.parse(
      readFileSync(path.join(EVIDENCE, 'core', 'CORE-SITE-003-gallery.drawn.json'), 'utf8')
    );
    expect(
      gallery.embeds.filter((name) => name.endsWith('-as-the-gallery-shows-it.png'))
    ).toHaveLength(6);
    // Every gallery picture draws its footnote, so its record names a version.
    for (const module of modules) {
      for (const file of filesOf(module).filter((name) =>
        name.endsWith('-as-the-gallery-shows-it.drawn.json')
      )) {
        const { versions } = JSON.parse(readFileSync(path.join(EVIDENCE, module, file), 'utf8'));
        expect(versions, `${module}/${file}`).toEqual([said]);
      }
    }
  });
});
