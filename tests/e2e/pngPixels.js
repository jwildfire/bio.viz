import { inflateSync } from 'node:zlib';

// A PNG's pixels, read back in the test, so a downloaded picture is held to
// what it shows and not only to what it says of itself (#70 review). Reads the
// PNGs a canvas writes: 8 bits a channel, RGBA or RGB, not interlaced, with any
// of the five row filters.
export function pixelsOf(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const data = [];
  while (at < bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const depth = body[8];
      const colour = body[9];
      if (depth !== 8 || body[12] !== 0 || ![2, 6].includes(colour)) {
        throw new Error(
          `pixelsOf reads 8-bit RGB or RGBA PNGs, not depth ${depth} colour ${colour}.`
        );
      }
      channels = colour === 6 ? 4 : 3;
    }
    if (type === 'IDAT') data.push(Buffer.from(body));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const out = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let value = row[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = value & 0xff;
    }
  }
  const pixel = (x, y) => {
    const i = (Math.round(y) * width + Math.round(x)) * channels;
    return [out[i], out[i + 1], out[i + 2]];
  };
  // Whether any pixel within `r` of (x, y) is not near white.
  const inked = (x, y, r = 2) => {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        if (pixel(px, py).some((channel) => channel < 235)) return true;
      }
    }
    return false;
  };
  return { width, height, pixel, inked };
}
