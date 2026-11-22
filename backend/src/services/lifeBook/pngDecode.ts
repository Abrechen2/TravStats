import zlib from "zlib";

/**
 * A minimal PNG decoder: 8-bit, non-interlaced, colour types grey, RGB,
 * palette, grey+alpha and RGBA. `pngjs` is a test-only dependency here, and
 * the production image carries no image library beyond what HEIC conversion
 * brings, so the rare PNG upload is read with `zlib` and the five PNG filters.
 * Anything else (16-bit, interlaced) returns null — the photo is then counted
 * as skipped, never faked.
 */

export interface PngRaster {
  width: number;
  height: number;
  /** RGBA, row-major, composited onto white. */
  data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function isPng(bytes: Buffer): boolean {
  return bytes.length > 8 && bytes.subarray(0, 8).equals(SIGNATURE);
}

export function decodePng(bytes: Buffer, maxPixels: number): PngRaster | null {
  if (!isPng(bytes)) return null;
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = -1;
  let interlace = 1;
  let palette: Buffer | null = null;
  let alpha: Buffer | null = null;
  const idat: Buffer[] = [];
  while (pos + 8 <= bytes.length) {
    const len = bytes.readUInt32BE(pos);
    const type = bytes.toString("latin1", pos + 4, pos + 8);
    const body = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colour = body[9];
      interlace = body[12];
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") alpha = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const channels = CHANNELS[colour];
  if (!channels || depth !== 8 || interlace !== 0 || width < 1 || height < 1) return null;
  if (width * height > maxPixels || (colour === 3 && !palette)) return null;

  const stride = width * channels;
  // Bound the inflated size by what the header promises: a few KB of IDAT must not expand into gigabytes.
  const expected = (stride + 1) * height;
  let raw: Buffer;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: expected });
  } catch {
    return null;
  }
  if (raw.length < expected) return null;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? px[y * stride + x - channels] : 0;
      const up = y > 0 ? px[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? px[(y - 1) * stride + x - channels] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) return null;
      px[y * stride + x] = (row[x] + add) & 0xff;
    }
  }

  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let r: number;
    let g: number;
    let b: number;
    let a = 255;
    const o = i * channels;
    if (colour === 0 || colour === 4) {
      r = g = b = px[o];
      if (colour === 4) a = px[o + 1];
    } else if (colour === 3) {
      const idx = px[o];
      r = palette![idx * 3] ?? 0;
      g = palette![idx * 3 + 1] ?? 0;
      b = palette![idx * 3 + 2] ?? 0;
      a = alpha?.[idx] ?? 255;
    } else {
      r = px[o];
      g = px[o + 1];
      b = px[o + 2];
      if (colour === 6) a = px[o + 3];
    }
    const f = a / 255;
    out[i * 4] = Math.round(r * f + 255 * (1 - f));
    out[i * 4 + 1] = Math.round(g * f + 255 * (1 - f));
    out[i * 4 + 2] = Math.round(b * f + 255 * (1 - f));
    out[i * 4 + 3] = 255;
  }
  return { width, height, data: out };
}
