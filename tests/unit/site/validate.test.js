import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateSiteLinks } from '../../../scripts/site-lib.mjs';

// Built-in validation: the site build must fail on a broken internal link, so a
// broken site can never publish. Carried over from safety.viz.

function makeSite(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'site-validate-'));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return dir;
}

describe('site validation: internal links', () => {
  it('flags internal links and asset references that do not resolve (#1)', () => {
    const dir = makeSite({
      'index.html': '<a href="check/index.html">check</a> <img src="missing.png">',
      'check/index.html': '<link rel="stylesheet" href="../site.css">'
    });
    const errors = validateSiteLinks(dir);
    expect(errors).toHaveLength(2);
    expect(errors.join('\n')).toContain('missing.png');
    expect(errors.join('\n')).toContain('site.css');
  });

  it('passes a site whose internal links all resolve, ignoring external and fragment links (#1)', () => {
    const dir = makeSite({
      'index.html':
        '<link rel="stylesheet" href="site.css">' +
        '<a href="check/index.html#timings">check</a>' +
        '<a href="https://github.com/jwildfire/bio.viz">repo</a>' +
        '<a href="#top">top</a>',
      'site.css': 'body {}',
      'check/index.html': '<a href="../index.html">home</a>'
    });
    expect(validateSiteLinks(dir)).toEqual([]);
  });
});
