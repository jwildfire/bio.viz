import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The release log (#56). NEWS.md is newest first, and the GitHub release
// publishes from a version's section when it is tagged, so a section that is
// released must read as released: no "(Upcoming)", and no link to the dev
// site, whose pages move on after the release.

const read = (file) => readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));

// Each `# bio.viz …` section: its heading and its text.
const sections = (text) =>
  text
    .split(/^(?=# bio\.viz )/m)
    .filter((part) => part.startsWith('# bio.viz '))
    .map((part) => {
      const [heading, ...rest] = part.split('\n');
      return { heading, body: rest.join('\n') };
    });

describe('the release log', () => {
  it('CORE-NEWS-001: only the first section may be upcoming; a released section links nothing on the dev site; the newest released section is the package version (#56)', () => {
    const all = sections(read('NEWS.md'));
    expect(all.length).toBeGreaterThanOrEqual(2);
    const upcoming = all.filter((section) => section.heading.endsWith('(Upcoming)'));
    expect(upcoming.length).toBeLessThanOrEqual(1);
    if (upcoming.length) expect(all[0]).toBe(upcoming[0]);
    const released = all.filter((section) => !section.heading.endsWith('(Upcoming)'));
    expect(released.length).toBeGreaterThan(0);
    // While a release is prepared the package is already its version, and its
    // section is the upcoming one; otherwise the newest released section is the
    // package's version (#75).
    if (upcoming.length && upcoming[0].heading === `# bio.viz v${pkg.version} (Upcoming)`) {
      expect(released[0].heading).not.toBe(`# bio.viz v${pkg.version}`);
    } else {
      expect(released[0].heading).toBe(`# bio.viz v${pkg.version}`);
    }
    for (const section of released) {
      expect(section.body, section.heading).not.toMatch(/jwildfire\.github\.io\/bio\.viz\/dev\//);
    }
    // The first section is the package's version (#108): upcoming while the
    // release is prepared, released once the release candidate promotes it.
    // The development version that stood there after v0.2.0 (#82) is gone.
    // It reads as release notes, under headings, and the release before it
    // is the next section.
    expect([`# bio.viz v${pkg.version} (Upcoming)`, `# bio.viz v${pkg.version}`]).toContain(
      all[0].heading
    );
    expect(read('NEWS.md')).not.toMatch(/^# bio\.viz v[\d.]+\.9000/m);
    expect(all[0].body).not.toContain('_Nothing merged yet._');
    expect(all[0].body).toMatch(/^## What's new$/m);
    expect(all[1].heading).toBe('# bio.viz v0.2.0');
  });
});
