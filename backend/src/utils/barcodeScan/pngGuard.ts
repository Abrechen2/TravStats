/**
 * A PNG is decoded only when its decompressed size is provably bounded.
 *
 * pngjs has no size limit of its own, and reading the IHDR dimensions alone
 * is not enough (security review, 2026-11-22): a second IHDR, an interlaced
 * image or a header that lies about the pixel count can still inflate far
 * past what the first IHDR promised. So the chunks are walked here, the
 * header is checked (exactly one IHDR, first, not interlaced, within the
 * pixel cap), and the IDAT stream is inflated with `maxOutputLength` set to
 * exactly the bytes those dimensions allow — a stream that wants more throws
 * instead of allocating.
 */
import { inflateSync } from "zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Samples per pixel by PNG colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export type PngVerdict =
  | { readonly ok: true; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly reason: string };

export function inspectPng(bytes: Buffer, maxPixels: number): PngVerdict {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE)) {
    return { ok: false, reason: "not a PNG" };
  }
  let header: { width: number; height: number; bitDepth: number; colorType: number } | null = null;
  const idat: Buffer[] = [];
  let offset = 8;
  let first = true;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) return { ok: false, reason: "truncated chunk" };
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      if (!first || header !== null) return { ok: false, reason: "IHDR not unique or not first" };
      if (length !== 13) return { ok: false, reason: "bad IHDR" };
      if (data[12] !== 0) return { ok: false, reason: "interlaced" };
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
      };
    } else if (first) {
      return { ok: false, reason: "IHDR not first" };
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    first = false;
    offset = dataEnd + 4; // skip CRC
  }
  if (!header) return { ok: false, reason: "no IHDR" };
  const { width, height, bitDepth, colorType } = header;
  const channels = CHANNELS[colorType];
  if (!channels || ![1, 2, 4, 8, 16].includes(bitDepth)) {
    return { ok: false, reason: "unsupported pixel format" };
  }
  if (width === 0 || height === 0 || width * height > maxPixels) {
    return { ok: false, reason: "too many pixels" };
  }
  // One filter byte per row plus the packed samples — what the dimensions allow.
  const rawBytes = height * (1 + Math.ceil((width * channels * bitDepth) / 8));
  try {
    const inflated = inflateSync(Buffer.concat(idat), { maxOutputLength: rawBytes });
    if (inflated.length !== rawBytes) return { ok: false, reason: "pixel data size mismatch" };
  } catch {
    return { ok: false, reason: "pixel data larger than the header allows" };
  }
  return { ok: true, width, height };
}
