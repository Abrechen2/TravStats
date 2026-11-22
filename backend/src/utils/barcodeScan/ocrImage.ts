/**
 * The only bytes Tesseract is ever given: a bounded image.
 *
 * Tesseract decodes whatever it receives with its own image library, which
 * has no decompression limit — the PNG bomb `pngGuard` refuses would still
 * have reached it through OCR (coordinator review, 2026-11-22). So:
 *
 * - JPEG and PNG are decoded HERE under the caps (`decodeToGray`) and handed
 *   on re-encoded as a plain grayscale PNG, whose size the cap bounds;
 * - GIF and WebP (the other formats the upload validator admits) cannot be
 *   decoded in JS here, so every frame/canvas dimension in their headers is
 *   checked against the same pixel cap before the bytes pass;
 * - anything else, or a header that cannot be read, is refused.
 */
import { PNG } from "pngjs";
import { decodeToGray, ImageRefusedError, MAX_DECODED_PIXELS } from "./pixels";

const within = (w: number, h: number): boolean => w > 0 && h > 0 && w * h <= MAX_DECODED_PIXELS;

/** Logical screen and every image descriptor of a GIF, walked block by block. */
function gifWithinCap(b: Buffer): boolean {
  if (b.length < 13 || !within(b.readUInt16LE(6), b.readUInt16LE(8))) return false;
  let p = 13;
  if (b[10] & 0x80) p += 3 * (1 << ((b[10] & 0x07) + 1));
  const skipSubBlocks = (): boolean => {
    while (p < b.length) {
      const size = b[p++];
      if (size === 0) return true;
      p += size;
    }
    return false;
  };
  let frames = 0;
  while (p < b.length) {
    const marker = b[p++];
    if (marker === 0x3b) return frames > 0;
    if (marker === 0x21) {
      p++; // label
      if (!skipSubBlocks()) return false;
    } else if (marker === 0x2c) {
      if (p + 9 > b.length || !within(b.readUInt16LE(p + 4), b.readUInt16LE(p + 6))) return false;
      const packed = b[p + 8];
      p += 9;
      if (packed & 0x80) p += 3 * (1 << ((packed & 0x07) + 1));
      p++; // LZW minimum code size
      if (!skipSubBlocks()) return false;
      frames++;
    } else {
      return false;
    }
  }
  return false;
}

/** The canvas of a WebP (VP8X, lossless VP8L or lossy VP8). */
function webpWithinCap(b: Buffer): boolean {
  if (
    b.length < 30 ||
    b.toString("latin1", 0, 4) !== "RIFF" ||
    b.toString("latin1", 8, 12) !== "WEBP"
  ) {
    return false;
  }
  const kind = b.toString("latin1", 12, 16);
  const d = 20; // chunk payload
  if (kind === "VP8X") return within(1 + b.readUIntLE(d + 4, 3), 1 + b.readUIntLE(d + 7, 3));
  if (kind === "VP8L") {
    if (b[d] !== 0x2f) return false;
    const bits = b.readUInt32LE(d + 1);
    return within((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (kind === "VP8 ") {
    if (b[d + 3] !== 0x9d || b[d + 4] !== 0x01 || b[d + 5] !== 0x2a) return false;
    return within(b.readUInt16LE(d + 6) & 0x3fff, b.readUInt16LE(d + 8) & 0x3fff);
  }
  return false;
}

export function boundedOcrImage(bytes: Buffer): Buffer {
  const gray = decodeToGray(bytes); // throws ImageRefusedError over the caps
  if (gray) {
    const png = new PNG({
      width: gray.width,
      height: gray.height,
      colorType: 0,
      inputColorType: 0,
      inputHasAlpha: false,
    });
    png.data = Buffer.from(gray.data);
    return PNG.sync.write(png, {
      colorType: 0,
      inputColorType: 0,
      inputHasAlpha: false,
      deflateLevel: 1,
    });
  }
  if (bytes.subarray(0, 4).toString("latin1") === "GIF8") {
    if (gifWithinCap(bytes)) return bytes;
    throw new ImageRefusedError("GIF over the limits or malformed");
  }
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF") {
    if (webpWithinCap(bytes)) return bytes;
    throw new ImageRefusedError("WebP over the limits or malformed");
  }
  throw new ImageRefusedError("format not accepted for OCR");
}
