import { describe, it, expect } from 'vitest';
import {
  extractHeadings,
  mdBlock,
  mdInline,
  mdText,
  rewriteRelativeLinks,
  slugify
} from '../../../scripts/markdown-lib.mjs';

// The Markdown renderer behind the API reference pages and requirement text
// (#7). It covers what the reference files use, and these tests say what that
// is.

describe('markdown: inline', () => {
  it('renders code, links, bold and italic, and escapes everything else (#7)', () => {
    expect(mdInline('Call `run(name)` & read [the rules](#rules), **never** *alone* <b>')).toBe(
      'Call <code>run(name)</code> &amp; read <a href="#rules">the rules</a>, ' +
        '<strong>never</strong> <em>alone</em> &lt;b&gt;'
    );
  });

  it('reads nothing inside a code span as a link or as emphasis (#7)', () => {
    expect(mdInline('`a[b](c)` and `**x**` and `p_value * 2 * n`')).toBe(
      '<code>a[b](c)</code> and <code>**x**</code> and <code>p_value * 2 * n</code>'
    );
  });

  it('keeps a code span inside a link label, and links a bare address in angle brackets (#7)', () => {
    expect(mdInline('[`docs/x.md`](https://example.org/x) <https://example.org/y>')).toBe(
      '<a href="https://example.org/x"><code>docs/x.md</code></a> ' +
        '<a href="https://example.org/y">https://example.org/y</a>'
    );
  });

  it('mdText strips the marks and keeps the words (#7)', () => {
    expect(mdText('`createConnection(options)` and [stored results](#stored-results)')).toBe(
      'createConnection(options) and stored results'
    );
  });
});

describe('markdown: blocks', () => {
  it('CORE-SITE-009: headings get the anchors GitHub gives them, repeated ones numbered (#7)', () => {
    expect(slugify('Stored results')).toBe('stored-results');
    expect(slugify('`createConnection(options)`')).toBe('createconnectionoptions');
    const markdown = '# Title\n\n## Stored results\n\ntext\n\n## Stored results\n\n### `run()`\n';
    expect(extractHeadings(markdown)).toEqual([
      { level: 1, text: 'Title', id: 'title' },
      { level: 2, text: 'Stored results', id: 'stored-results' },
      { level: 2, text: 'Stored results', id: 'stored-results-1' },
      { level: 3, text: '`run()`', id: 'run' }
    ]);
    const html = mdBlock(markdown);
    expect(html).toContain('<h2 id="stored-results">Stored results</h2>');
    expect(html).toContain('<h2 id="stored-results-1">Stored results</h2>');
    expect(html).toContain('<h3 id="run"><code>run()</code></h3>');
  });

  it('CORE-SITE-009: a fenced block is code, escaped and left as written, and a # inside it is not a heading (#7)', () => {
    const markdown = 'Before.\n\n```js\n# not a heading\nconst a = "<b>" && `x`;\n```\n\nAfter.';
    expect(mdBlock(markdown)).toBe(
      '<p>Before.</p>\n' +
        '<pre><code class="language-js"># not a heading\n' +
        'const a = &quot;&lt;b&gt;&quot; &amp;&amp; `x`;</code></pre>\n' +
        '<p>After.</p>'
    );
    expect(extractHeadings(markdown)).toEqual([]);
  });

  it('CORE-SITE-009: a table keeps each column heading on every cell, so it can restack on a narrow screen (#7)', () => {
    const html = mdBlock(
      [
        '| Option | Meaning |',
        '| --- | --- |',
        '| `results` | Stored results. |',
        '| `a \\| b` | Either. |'
      ].join('\n')
    );
    // `api` is safety.viz's class for a reference's table; `doc-table` is the
    // one the site's own stylesheet restacks.
    expect(html).toContain('<table class="api doc-table">');
    expect(html).toContain('<th scope="col">Option</th><th scope="col">Meaning</th>');
    expect(html).toContain(
      '<tr><td data-label="Option"><code>results</code></td>' +
        '<td data-label="Meaning">Stored results.</td></tr>'
    );
    // An escaped pipe is a pipe inside the cell, not a third column.
    expect(html).toContain('<td data-label="Option"><code>a | b</code></td>');
  });

  it('CORE-SITE-009: paragraphs join their lines, and bullet and numbered lists keep theirs apart (#7)', () => {
    const html = mdBlock('One\ntwo.\n\n- first\n  continued\n- second\n\n1. step\n2. next\n');
    expect(html).toBe(
      '<p>One two.</p>\n<ul><li>first continued</li><li>second</li></ul>\n' +
        '<ol><li>step</li><li>next</li></ol>'
    );
  });

  it('a relative link points at the repository, and a link to another reference file at its page (#7)', () => {
    const options = {
      repoUrl: 'https://github.com/jwildfire/bio.viz',
      pages: { 'r-connection.md': '../r-connection/api.html' }
    };
    expect(
      rewriteRelativeLinks(
        '[a](../tools/x.mjs) [b](#here) [c](https://example.org) [d](r-connection.md#stored-results)',
        options
      )
    ).toBe(
      '[a](https://github.com/jwildfire/bio.viz/blob/HEAD/tools/x.mjs) [b](#here) ' +
        '[c](https://example.org) [d](../r-connection/api.html#stored-results)'
    );
  });
});
