// A small Markdown renderer for the pages the site builds from files in the
// repository: a module's reference file, and requirement text. It covers what
// those files use (headings, paragraphs, lists, tables, fenced code, inline
// code, links, bold and italic) and nothing else. Modelled on safety.viz's
// renderer, with fenced code added and tables that restack on a narrow screen.

export function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// Inline Markdown to HTML. Code spans are set aside first, so nothing inside
// one is read as a link or as emphasis.
export function mdInline(text) {
  const spans = [];
  const held = (html) => `\u0000${spans.push(html) - 1}\u0000`;
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, (match, code) => held(`<code>${code}</code>`))
    .replace(/\[([^\]]+)\]\(([^()\s]+)\)/g, (match, label, href) =>
      held(`<a href="${href}">`).concat(label, held('</a>'))
    )
    .replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (match, href) =>
      held(`<a href="${href}">${href}</a>`)
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\u0000(\d+)\u0000/g, (match, index) => spans[Number(index)]);
}

// The words of a piece of inline Markdown, with the marks removed.
export function mdText(text) {
  return String(text)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1');
}

// GitHub's heading anchor: lower case, punctuation dropped, spaces to dashes.
// A link written for the file on GitHub therefore works on the site too.
export function slugify(text) {
  return (
    mdText(text)
      .toLowerCase()
      .replace(/[^\w\- ]/g, '')
      .replace(/ /g, '-') || 'section'
  );
}

// Repeated headings get -1, -2, … as GitHub numbers them.
function headingSlugger() {
  const seen = new Map();
  return (text) => {
    const base = slugify(text);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  };
}

const FENCE = /^```\s*([\w-]*)\s*$/;
const HEADING = /^(#{1,4})\s+(.*)$/;

// Every heading of a document, in order, with the id `mdBlock` gives it. Lines
// inside a code fence are not headings.
export function extractHeadings(markdown) {
  const slug = headingSlugger();
  const headings = [];
  let fenced = false;
  for (const line of String(markdown).split('\n')) {
    if (FENCE.test(line)) fenced = !fenced;
    const heading = !fenced && line.match(HEADING);
    if (heading) {
      headings.push({ level: heading[1].length, text: heading[2], id: slug(heading[2]) });
    }
  }
  return headings;
}

// A table row's cells. An escaped pipe (`\|`) is a pipe inside a cell.
function splitCells(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim());
}

const isDelimiter = (line) =>
  Boolean(line) && line.includes('|') && line.includes('-') && /^[\s|:-]+$/.test(line.trim());

const isTableStart = (lines, i) =>
  Boolean(lines[i]) && lines[i].trim().startsWith('|') && isDelimiter(lines[i + 1]);

// Each body cell carries its column's heading in `data-label`: on a narrow
// screen the stylesheet stacks the cells and prints that label beside each, so
// a wide table never needs a sideways scroll.
function renderTable(lines, start) {
  const headers = splitCells(lines[start]);
  let end = start + 2;
  const rows = [];
  while (end < lines.length && lines[end].trim().startsWith('|')) {
    rows.push(splitCells(lines[end]));
    end += 1;
  }
  const head = headers.map((cell) => `<th scope="col">${mdInline(cell)}</th>`).join('');
  const body = rows
    .map(
      (cells) =>
        `<tr>${cells
          .map(
            (cell, column) =>
              `<td data-label="${escapeHtml(mdText(headers[column] || ''))}">${mdInline(cell)}</td>`
          )
          .join('')}</tr>`
    )
    .join('\n');
  return {
    html: `<table class="doc-table"><thead><tr>${head}</tr></thead>\n<tbody>${body}</tbody></table>`,
    end
  };
}

// Block Markdown to HTML. Headings get ids, so a contents list and links
// within the file can point at them.
export function mdBlock(markdown) {
  const html = [];
  const slug = headingSlugger();
  let list = null;
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${mdInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((item) => `<li>${mdInline(item)}</li>`).join('');
      html.push(`<${list.tag}>${items}</${list.tag}>`);
    }
    list = null;
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };
  const item = (tag, text) => {
    flushParagraph();
    if (!list || list.tag !== tag) {
      flushList();
      list = { tag, items: [] };
    }
    list.items.push(text);
  };

  const lines = String(markdown).split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const fence = line.match(FENCE);
    if (fence) {
      flush();
      const code = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      const language = fence[1] ? ` class="language-${fence[1]}"` : '';
      html.push(`<pre><code${language}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (isTableStart(lines, i)) {
      flush();
      const table = renderTable(lines, i);
      html.push(table.html);
      i = table.end - 1;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flush();
      const level = heading[1].length;
      html.push(`<h${level} id="${slug(heading[2])}">${mdInline(heading[2])}</h${level}>`);
    } else if (/^-\s+/.test(line)) {
      item('ul', line.replace(/^-\s+/, ''));
    } else if (/^\d+\.\s+/.test(line)) {
      item('ol', line.replace(/^\d+\.\s+/, ''));
    } else if (/^\s+\S/.test(line) && list) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else if (!line.trim()) {
      flush();
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flush();
  return html.join('\n');
}

// A reference file is written to be read on GitHub, where a relative link
// points at another file of the repository. On the site that file is not there.
// A link to another module's reference file is pointed at that module's page
// (`pages` maps the file name to the page); any other relative link is pointed
// back at the repository. Links to a heading and links with a scheme are left
// alone.
export function rewriteRelativeLinks(markdown, { repoUrl, fromDir = 'docs', pages = {} }) {
  return String(markdown).replace(/\]\(([^()\s]+)\)/g, (match, target) => {
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) return match;
    const [file, fragment] = target.split('#');
    if (pages[file]) return `](${pages[file]}${fragment ? `#${fragment}` : ''})`;
    const segments = [];
    for (const segment of `${fromDir}/${target}`.split('/')) {
      if (segment === '..') segments.pop();
      else if (segment && segment !== '.') segments.push(segment);
    }
    return `](${repoUrl}/blob/HEAD/${segments.join('/')})`;
  });
}
