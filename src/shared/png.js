// The PNG a chart is downloaded as (#67): the chart's frame, its title,
// subtitle and footnotes with what it draws between them, drawn into an image
// at a stated resolution, with the title, the footnotes and the resolution
// written into the file itself.
//
// The frame is drawn as the page draws it: a copy of the chart's elements,
// every style written onto it, its Chart.js canvases as the pictures they hold,
// inside an SVG image, which a canvas then draws. Nothing is fetched, so the
// canvas the image is drawn on stays readable.
//
// `pngChunks`, `readPng` and `crc32` are pure; `drawFrame` needs a page.

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable = null;
/**
 * The CRC-32 a PNG chunk ends with, of its type and data.
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const utf8 = (text) => new TextEncoder().encode(text);

function chunk(type, data) {
  const body = new Uint8Array(4 + data.length);
  body.set(utf8(type), 0);
  body.set(data, 4);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc32(body));
  return out;
}

// An international text chunk: a keyword, and UTF-8 text, uncompressed.
function itxt(keyword, text) {
  const head = utf8(keyword);
  const value = utf8(text);
  const data = new Uint8Array(head.length + 5 + value.length);
  data.set(head, 0);
  // Null separator, not compressed, compression method 0, empty language tag
  // and empty translated keyword, each ended by a null.
  data.set([0, 0, 0, 0, 0], head.length);
  data.set(value, head.length + 5);
  return chunk('iTXt', data);
}

// The physical size of a pixel: so many pixels per metre each way.
function phys(perMetre) {
  const data = new Uint8Array(9);
  const view = new DataView(data.buffer);
  view.setUint32(0, perMetre);
  view.setUint32(4, perMetre);
  data[8] = 1;
  return chunk('pHYs', data);
}

/** A CSS pixel's size: 96 to the inch, as the web counts them. */
export const CSS_PIXELS_PER_INCH = 96;

/**
 * A PNG with its resolution and text written in, after its header chunk.
 * @param {Uint8Array} png The PNG a canvas wrote.
 * @param {object} parts
 * @param {number} parts.scale Image pixels per CSS pixel.
 * @param {object} parts.text Keyword to text: `Title`, `Description` and so on.
 * @returns {Uint8Array}
 */
export function pngChunks(png, { scale, text }) {
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (png[i] !== PNG_SIGNATURE[i]) throw new Error('bio.viz: not a PNG.');
  }
  // The header chunk is first: 8 bytes of signature, then 4 + 4 + 13 + 4.
  const afterHeader = 8 + 25;
  const extra = [
    phys(Math.round((scale * CSS_PIXELS_PER_INCH) / 0.0254)),
    ...Object.entries(text)
      .filter(([, value]) => typeof value === 'string' && value !== '')
      .map(([keyword, value]) => itxt(keyword, value))
  ];
  const size = extra.reduce((total, part) => total + part.length, png.length);
  const out = new Uint8Array(size);
  out.set(png.subarray(0, afterHeader), 0);
  let at = afterHeader;
  for (const part of extra) {
    out.set(part, at);
    at += part.length;
  }
  out.set(png.subarray(afterHeader), at);
  return out;
}

/**
 * What a PNG says of itself: its size in pixels, its pixels per metre, and its
 * text chunks.
 * @param {Uint8Array} png
 * @returns {{width: number, height: number, perMetre: ?number, text: object}}
 */
export function readPng(png) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const decoder = new TextDecoder();
  const info = { width: view.getUint32(16), height: view.getUint32(20), perMetre: null, text: {} };
  let at = 8;
  while (at < png.length) {
    const length = view.getUint32(at);
    const type = decoder.decode(png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === 'pHYs') info.perMetre = new DataView(data.buffer, data.byteOffset).getUint32(0);
    if (type === 'iTXt' || type === 'tEXt') {
      const zero = data.indexOf(0);
      const keyword = decoder.decode(data.subarray(0, zero));
      let rest = data.subarray(zero + 1);
      if (type === 'iTXt') {
        rest = rest.subarray(2);
        rest = rest.subarray(rest.indexOf(0) + 1);
        rest = rest.subarray(rest.indexOf(0) + 1);
      }
      info.text[keyword] = decoder.decode(rest);
    }
    at += 12 + length;
  }
  return info;
}

// ---- Drawing the frame ---------------------------------------------------------

// The heights the page laid an element out at. An element that holds text has
// its height found again by the copy, because the picture's text may be set a
// little differently and a box held at the page's height would cut it off or
// scroll. An element that holds no text, a mark (a disc, a line, a dot, a key)
// or a picture, keeps the size it is drawn at (#70 review).
const HEIGHTS = new Set(['height', 'block-size', 'max-height', 'max-block-size']);
// What scrolls in the page is drawn whole in the picture.
const OVERFLOWS = new Set([
  'overflow',
  'overflow-x',
  'overflow-y',
  'overflow-block',
  'overflow-inline'
]);

const holdsText = (element) => /\S/.test(element.textContent || '');

// Every style the page gives an element, written onto its copy, so the copy
// draws the same with no style sheet.
function copyStyles(from, to) {
  const style = getComputedStyle(from);
  const reflow = from.tagName !== 'CANVAS' && from.tagName !== 'IMG' && holdsText(from);
  let text = '';
  for (let i = 0; i < style.length; i += 1) {
    const name = style[i];
    if (reflow && HEIGHTS.has(name)) continue;
    if (OVERFLOWS.has(name)) continue;
    text += `${name}:${style.getPropertyValue(name)};`;
  }
  to.setAttribute('style', `${text}overflow:visible;`);
}

function copyTree(from, to) {
  if (from.nodeType !== 1) return;
  copyStyles(from, to);
  if (from.tagName === 'CANVAS') return;
  const a = from.children;
  const b = to.children;
  for (let i = 0; i < a.length; i += 1) copyTree(a[i], b[i]);
}

/**
 * Draws a chart's frame into a PNG.
 * @param {HTMLElement} frame The element to draw: the chart's main area.
 * @param {object} parts
 * @param {(element: HTMLElement) => boolean} parts.leaveOut Whether an element
 *   of the frame is left out of the picture: a control, the listing.
 * @param {number} parts.scale Image pixels per CSS pixel.
 * @param {object} parts.text What the file says of itself: `Title`, `Description`.
 * @returns {Promise<{blob: Blob, width: number, height: number}>}
 */
export async function drawFrame(frame, { leaveOut, scale, text }) {
  const copy = frame.cloneNode(true);
  copyTree(frame, copy);
  // Each canvas as the picture it holds.
  const canvases = frame.querySelectorAll('canvas');
  const copies = copy.querySelectorAll('canvas');
  canvases.forEach((canvas, i) => {
    const picture = document.createElement('img');
    picture.setAttribute('style', copies[i].getAttribute('style') || '');
    picture.width = canvas.clientWidth;
    picture.height = canvas.clientHeight;
    picture.src = canvas.width && canvas.height ? canvas.toDataURL('image/png') : '';
    copies[i].replaceWith(picture);
  });
  // What is left out, matched on the page and removed from the copy.
  const all = [...frame.querySelectorAll('*')];
  const copied = [...copy.querySelectorAll('*')];
  const dropped = all
    .map((element, i) => (element.tagName !== 'CANVAS' && leaveOut(element) ? copied[i] : null))
    .filter(Boolean);
  dropped.forEach((element) => element.remove());
  copy.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
  const width = Math.ceil(frame.getBoundingClientRect().width);
  copy.style.width = `${width}px`;
  copy.style.height = 'auto';
  copy.style.minHeight = '0';
  copy.style.margin = '0';
  copy.style.background = '#ffffff';
  // Laid out off the screen, to be measured.
  const holder = document.createElement('div');
  holder.setAttribute(
    'style',
    `position:absolute;left:-100000px;top:0;width:${width}px;background:#fff`
  );
  holder.append(copy);
  document.body.append(holder);
  await Promise.all(
    [...copy.querySelectorAll('img')].map((picture) =>
      picture.complete ? null : new Promise((done) => (picture.onload = picture.onerror = done))
    )
  );
  const height = Math.ceil(copy.getBoundingClientRect().height);
  // As wide as what it holds, what scrolled sideways in the page among it.
  const holderBox = holder.getBoundingClientRect();
  let right = width;
  for (const element of copy.querySelectorAll('*')) {
    const box = element.getBoundingClientRect();
    if (box.width && box.height) right = Math.max(right, Math.ceil(box.right - holderBox.left));
  }
  const drawnWidth = right;
  holder.remove();

  const markup = new XMLSerializer().serializeToString(copy);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${drawnWidth}" height="${height}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;background:#fff">${markup}</div>` +
    `</foreignObject></svg>`;
  const image = new Image();
  await new Promise((done, fail) => {
    image.onload = done;
    image.onerror = () =>
      fail(
        new Error('bio.viz: the chart could not be drawn as a picture, as the browser read it.')
      );
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(drawnWidth * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(scale, scale);
  context.drawImage(image, 0, 0, drawnWidth, height);
  const written = await new Promise((done, fail) => {
    try {
      canvas.toBlob(
        (blob) =>
          blob
            ? done(blob)
            : fail(
                new Error(
                  'bio.viz: the picture could not be written, which a browser does when it is too large. Try a smaller png_scale.'
                )
              ),
        'image/png'
      );
    } catch (error) {
      // A canvas the browser will not let be read.
      fail(new Error(`bio.viz: the picture could not be read back (${error.message}).`));
    }
  });
  const bytes = pngChunks(new Uint8Array(await written.arrayBuffer()), { scale, text });
  return {
    blob: new Blob([bytes], { type: 'image/png' }),
    width: canvas.width,
    height: canvas.height
  };
}
