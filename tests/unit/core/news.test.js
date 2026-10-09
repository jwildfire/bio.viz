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

// What an upcoming section holds until something merges.
const NOTHING_YET = '_Nothing merged yet._';

// ---- The length of a release's notes (#117) --------------------------------------
//
// @jwildfire, 2026-10-06, on notes of 2,088 words: "Release notes are way too
// wordy. … The details go in the demo page." The limits and the headings are
// those of obot.agent's release-notes skill, and the words are counted as its
// checker (check-notes.mjs) counts them, as a reader meets them: a link counts
// as its text, and the issue and pull-request links that close a bullet or a
// paragraph are not counted. This is a second count of the same rule, kept
// short, so the suite needs neither the network nor a copy of the checker.
const LIMITS = { section: 600, intro: 80, bullets: 6, new: 70, notice: 100, also: 60, tests: 100 };
const HEADINGS = [
  "What's new",
  'Deprecated',
  'Removed',
  'Also in this release',
  'Tests and provenance'
];
const CITATION = /(?:[\s,;(]*(?:PR\s+)?\[[^\]]*#\d+\]\([^)]*\)[\s,;).]*)+$/;
const words = (text) =>
  text
    .replace(CITATION, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`]/g, '')
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

// A section's parts: what comes before the first `##` heading, and what is
// under each, as bullets and as lines of prose, each with its count.
function partsOf(body) {
  const parts = [{ heading: null, lines: [] }];
  for (const line of body.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    const heading = /^## (.+?)\s*$/.exec(line);
    if (heading) parts.push({ heading: heading[1], lines: [] });
    else if (line.trim() !== '') parts.at(-1).lines.push(line);
  }
  return parts.map(({ heading, lines }) => ({
    heading,
    bullets: lines.filter((line) => line.startsWith('- ')).map((line) => line.slice(2)),
    prose: lines.filter((line) => !line.startsWith('- '))
  }));
}
const sum = (numbers) => numbers.reduce((total, number) => total + number, 0);
const countOf = (part) => sum([...part.bullets, ...part.prose].map(words));

// What is over a limit or out of shape in a section, in words; none when the
// section is within every limit. A released section opens on its demo page and
// says what the release is; an upcoming one need not yet.
function overLimit({ heading, body }, { released }) {
  const found = [];
  const [opening, ...under] = partsOf(body);
  const [first, ...intro] = opening.prose;
  if (released && !/^\*\*See it move:\*\*.*\]\(https:\/\//.test(first || '')) {
    found.push('does not open on a "See it move" line that links the demo page');
  }
  if (released && !intro.length) found.push('has no introduction');
  if (sum(intro.map(words)) > LIMITS.intro) found.push('introduction over its limit');
  if (opening.bullets.length) found.push('a bullet before the first heading');
  const order = under.map((part) => HEADINGS.indexOf(part.heading));
  if (order.includes(-1)) found.push('a heading that is not one of the five');
  if (order.some((at, index) => index > 0 && at < order[index - 1]))
    found.push('headings out of order');
  for (const part of under) {
    if (part.heading === 'Tests and provenance') {
      if (countOf(part) > LIMITS.tests) found.push('Tests and provenance over its limit');
      continue;
    }
    const isNew = part.heading === "What's new";
    const notice = part.heading === 'Deprecated' || part.heading === 'Removed';
    const limit = isNew ? LIMITS.new : notice ? LIMITS.notice : LIMITS.also;
    if (isNew && part.bullets.length > LIMITS.bullets) found.push("too many What's new bullets");
    for (const bullet of part.bullets) {
      if (words(bullet) > limit)
        found.push(`${words(bullet)} words, limit ${limit}: ${bullet.slice(0, 40)}`);
      if (!/^\*\*[^*]+\*\*/.test(bullet)) found.push(`no claim in bold: ${bullet.slice(0, 40)}`);
    }
  }
  const total = sum([opening, ...under].map(countOf));
  if (total > LIMITS.section) found.push(`${total} words, limit ${LIMITS.section}`);
  return { heading, total, found };
}

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
    // The first section is one of three, by where the release is. After a
    // release the next one is open, with no number yet, so it is named for the
    // development version, above the release (#82, #117). While a release is
    // prepared the section is the package's version, upcoming (#108); and it
    // is that version, released, once it is promoted with nothing above it.
    const development = `# bio.viz v${pkg.version}.9000 (Upcoming)`;
    expect([
      development,
      `# bio.viz v${pkg.version} (Upcoming)`,
      `# bio.viz v${pkg.version}`
    ]).toContain(all[0].heading);
    if (all[0].heading === development) expect(all[1].heading).toBe(`# bio.viz v${pkg.version}`);
    expect(all.slice(1).filter((section) => /\.9000/.test(section.heading))).toEqual([]);
    // It says that nothing has merged, or it reads as release notes, under
    // headings.
    if (all[0].body.trim() !== NOTHING_YET) expect(all[0].body).toMatch(/^## What's new$/m);
    // The releases stay in the log, newest first.
    expect(released.map((section) => section.heading).slice(-2)).toEqual([
      '# bio.viz v0.2.0',
      '# bio.viz v0.1.0'
    ]);
  });

  it('CORE-NEWS-002: the newest released section and the upcoming one are within the limits of a release’s notes, counted as a reader meets the words, under the five headings in their order; the released one opens on its demo page and says what the release is (#117)', () => {
    // The count is the checker's: a link is its text, and the links that
    // close a bullet are not counted.
    expect(words('**Say it.** See the [live demo](https://example.org/a/b) now.')).toBe(7);
    expect(
      words(
        '**A claim.** One more sentence. [obot.roadmap#367](https://github.com/a/b/issues/367), [#84](https://github.com/a/b/issues/84), PR [#87](https://github.com/a/b/pull/87)'
      )
    ).toBe(5);
    expect(words('held within 1 part in 10^8 at `9eda3a8`, no more')).toBe(10);

    const all = sections(read('NEWS.md'));
    const upcoming = all.filter((section) => section.heading.endsWith('(Upcoming)'));
    const [newest] = all.filter((section) => !section.heading.endsWith('(Upcoming)'));
    // The newest release, as it was published.
    expect(overLimit(newest, { released: true })).toMatchObject({ found: [] });
    // What is being written for the next one, already at that length. The
    // demo page it opens on comes with the release: once the package is the
    // section's version, the release is being prepared and it opens as a
    // released one does.
    for (const section of upcoming) {
      if (section.body.trim() === NOTHING_YET) continue;
      const preparing = section.heading === `# bio.viz v${pkg.version} (Upcoming)`;
      expect(overLimit(section, { released: preparing })).toMatchObject({ found: [] });
    }
    // The notes of v0.3.0 are the first held to this, at the count the
    // skill's own checker prints for them.
    const v030 = all.find((section) => section.heading === '# bio.viz v0.3.0');
    expect(overLimit(v030, { released: true })).toEqual({
      heading: '# bio.viz v0.3.0',
      total: 504,
      found: []
    });
    // And a section over a limit is found: the same notes with a seventh
    // bullet of 71 words under What's new.
    const long = `- **${Array.from({ length: 71 }, () => 'word').join(' ')}.**`;
    const padded = v030.body.replace("## What's new\n\n", `## What's new\n\n${long}\n${long}\n`);
    expect(overLimit({ ...v030, body: padded }, { released: true }).found).toEqual([
      "too many What's new bullets",
      expect.stringMatching(/^71 words, limit 70/),
      expect.stringMatching(/^71 words, limit 70/),
      expect.stringMatching(/words, limit 600$/)
    ]);
  });
});
