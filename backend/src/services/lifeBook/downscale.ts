import jpeg from "jpeg-js";
import { decodePng, isPng } from "./pngDecode";

/**
 * Shrinks one photograph for the life book: decode, box-filter to a longest
 * edge of `maxEdge`, re-encode as JPEG. Pure JavaScript on purpose (jpeg-js
 * and a small PNG reader): the image ships no native image library, and a book is built in a
 * background job where a second or two per photo does not matter.
 *
 * The phone's EXIF orientation is honoured for the three rotations; jpeg-js
 * ignores it, and an unrotated portrait photo in a chronicle reads as a defect
 * nobody can see until the book is printed. Mirrored variants are not handled
 * (cameras do not write them).
 *
 * Null when the bytes are neither a JPEG nor a PNG, are too large to decode
 * safely, or cannot be decoded — the caller counts the photo as skipped.
 */

export const MAX_DECODE_BYTES = 25 * 1024 * 1024;
const MAX_DECODE_PIXELS = 60_000_000;
const JPEG_QUALITY = 72;

interface Raster {
  width: number;
  height: number;
  /** RGBA, row-major. */
  data: Uint8Array;
}

/** EXIF orientation tag (1..8) of a JPEG, 1 when absent or unreadable. */
export function exifOrientation(bytes: Buffer): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let pos = 2;
  while (pos + 4 < bytes.length) {
    if (bytes[pos] !== 0xff) return 1;
    const marker = bytes[pos + 1];
    const len = bytes.readUInt16BE(pos + 2);
    if (marker === 0xe1 && bytes.toString("latin1", pos + 4, pos + 10) === "Exif\0\0") {
      const tiff = pos + 10;
      const little = bytes.toString("latin1", tiff, tiff + 2) === "II";
      const u16 = (o: number) => (little ? bytes.readUInt16LE(o) : bytes.readUInt16BE(o));
      const u32 = (o: number) => (little ? bytes.readUInt32LE(o) : bytes.readUInt32BE(o));
      if (tiff + 8 > bytes.length) return 1;
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > bytes.length) return 1;
      const count = u16(ifd);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > bytes.length) return 1;
        if (u16(entry) === 0x0112) {
          const value = u16(entry + 8);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    if (marker === 0xda) return 1;
    pos += 2 + len;
  }
  return 1;
}

function decode(bytes: Buffer, mimetype: string): Raster | null {
  const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
  if (isPng(bytes) || (!isJpeg && mimetype.toLowerCase() === "image/png")) {
    return decodePng(bytes, MAX_DECODE_PIXELS);
  }
  if (!isJpeg) return null;
  const decoded = jpeg.decode(bytes, {
    useTArray: true,
    formatAsRGBA: true,
    maxResolutionInMP: MAX_DECODE_PIXELS / 1_000_000,
    maxMemoryUsageInMB: 512,
  });
  return { width: decoded.width, height: decoded.height, data: decoded.data as Uint8Array };
}

export function downscaleToJpeg(
  bytes: Buffer,
  mimetype: string,
  maxEdge: number
): { data: Buffer; mimetype: "image/jpeg" } | null {
  if (bytes.length === 0 || bytes.length > MAX_DECODE_BYTES) return null;
  try {
    const src = decode(bytes, mimetype);
    if (!src || src.width < 1 || src.height < 1) return null;
    const orientation = exifOrientation(bytes);
    const swap = orientation === 6 || orientation === 8;
    const rotW = swap ? src.height : src.width;
    const rotH = swap ? src.width : src.height;
    const scale = Math.min(1, maxEdge / Math.max(rotW, rotH));
    const outW = Math.max(1, Math.round(rotW * scale));
    const outH = Math.max(1, Math.round(rotH * scale));
    const out = Buffer.alloc(outW * outH * 4);
    for (let y = 0; y < outH; y++) {
      const y0 = Math.floor((y * rotH) / outH);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * rotH) / outH));
      for (let x = 0; x < outW; x++) {
        const x0 = Math.floor((x * rotW) / outW);
        const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * rotW) / outW));
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let ry = y0; ry < y1; ry++) {
          for (let rx = x0; rx < x1; rx++) {
            // Position in the unrotated source for a rotated-frame pixel.
            let sx = rx;
            let sy = ry;
            if (orientation === 3) {
              sx = src.width - 1 - rx;
              sy = src.height - 1 - ry;
            } else if (orientation === 6) {
              sx = ry;
              sy = src.height - 1 - rx;
            } else if (orientation === 8) {
              sx = src.width - 1 - ry;
              sy = rx;
            }
            const i = (sy * src.width + sx) * 4;
            r += src.data[i];
            g += src.data[i + 1];
            b += src.data[i + 2];
            n++;
          }
        }
        const o = (y * outW + x) * 4;
        out[o] = Math.round(r / n);
        out[o + 1] = Math.round(g / n);
        out[o + 2] = Math.round(b / n);
        out[o + 3] = 255;
      }
    }
    const encoded = jpeg.encode({ data: out, width: outW, height: outH }, JPEG_QUALITY);
    return { data: Buffer.from(encoded.data), mimetype: "image/jpeg" };
  } catch {
    return null;
  }
}
