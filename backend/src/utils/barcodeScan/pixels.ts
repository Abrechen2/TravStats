/**
 * Pixel work for the boarding-pass barcode scan — pure functions over a
 * single-channel 8-bit image, no native dependency.
 *
 * zxing reads a whole photo well when the barcode fills a good part of it. A
 * paper boarding pass photographed on a table does not: on the photo that
 * prompted this (two United passes on one image, 2289 × 2055 px) each PDF417
 * covers about 3 % of the frame and is printed faintly, and zxing over the
 * full image found NOTHING. The same barcodes decode once they are cropped,
 * thresholded and — for the fainter one — upscaled and thresholded against the
 * local mean. These helpers are those steps.
 */
import * as jpeg from "jpeg-js";
import { PNG } from "pngjs";

/** One byte per pixel, row-major. */
export interface Gray {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Above this many pixels the decoder refuses to allocate (a 50 MP photo). */
const MAX_DECODED_PIXELS = 40_000_000;

const isPng = (b: Buffer): boolean =>
  b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b: Buffer): boolean => b.length > 3 && b[0] === 0xff && b[1] === 0xd8;

/**
 * JPEG or PNG bytes to grayscale. Null for any other format (WebP, HEIC) —
 * the caller still hands those bytes to zxing whole, which decodes them on its
 * own; only the cropping steps need pixels in hand.
 */
export function decodeToGray(bytes: Buffer): Gray | null {
  let rgba: { data: Uint8Array | Buffer; width: number; height: number };
  if (isJpeg(bytes)) {
    rgba = jpeg.decode(bytes, {
      useTArray: true,
      maxResolutionInMP: MAX_DECODED_PIXELS / 1_000_000,
      maxMemoryUsageInMB: 1024,
    });
  } else if (isPng(bytes)) {
    rgba = PNG.sync.read(bytes);
  } else {
    return null;
  }
  return rgbaToGray(rgba.data, rgba.width, rgba.height);
}

export function rgbaToGray(rgba: Uint8Array | Buffer, width: number, height: number): Gray {
  const data = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    // Rec. 601 luma in integer arithmetic; alpha is composited onto white so a
    // transparent PNG margin reads as paper, not as ink.
    const a = rgba[p + 3];
    const luma = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
    data[i] = Math.round((luma * a + 255 * (255 - a)) / 255);
  }
  return { data, width, height };
}

/** zxing's pixmap input: RGBA, four bytes per pixel. */
export function grayToRgba(g: Gray): { data: Uint8ClampedArray; width: number; height: number } {
  const out = new Uint8ClampedArray(g.width * g.height * 4);
  for (let i = 0, p = 0; i < g.data.length; i++, p += 4) {
    out[p] = out[p + 1] = out[p + 2] = g.data[i];
    out[p + 3] = 255;
  }
  return { data: out, width: g.width, height: g.height };
}

export function crop(g: Gray, box: Box): Gray {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(g.width, Math.ceil(box.x + box.width));
  const y1 = Math.min(g.height, Math.ceil(box.y + box.height));
  const width = Math.max(0, x1 - x0);
  const height = Math.max(0, y1 - y0);
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    data.set(g.data.subarray((y0 + y) * g.width + x0, (y0 + y) * g.width + x0 + width), y * width);
  }
  return { data, width, height };
}

/** Area-average downscale by an integer factor (factor 1 returns the input). */
export function downscale(g: Gray, factor: number): Gray {
  if (factor <= 1) return g;
  const width = Math.max(1, Math.floor(g.width / factor));
  const height = Math.max(1, Math.floor(g.height / factor));
  const data = new Uint8Array(width * height);
  const n = factor * factor;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * g.width + x * factor;
        for (let dx = 0; dx < factor; dx++) sum += g.data[row + dx];
      }
      data[y * width + x] = Math.round(sum / n);
    }
  }
  return { data, width, height };
}

/** Bilinear upscale by an integer factor — thin PDF417 modules need room. */
export function upscale(g: Gray, factor: number): Gray {
  if (factor <= 1) return g;
  const width = g.width * factor;
  const height = g.height * factor;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(g.height - 1, (y + 0.5) / factor - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(g.height - 1, y0 + 1);
    const fy = Math.max(0, sy - y0);
    for (let x = 0; x < width; x++) {
      const sx = Math.min(g.width - 1, (x + 0.5) / factor - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(g.width - 1, x0 + 1);
      const fx = Math.max(0, sx - x0);
      const top = g.data[y0 * g.width + x0] * (1 - fx) + g.data[y0 * g.width + x1] * fx;
      const bottom = g.data[y1 * g.width + x0] * (1 - fx) + g.data[y1 * g.width + x1] * fx;
      data[y * width + x] = Math.round(top * (1 - fy) + bottom * fy);
    }
  }
  return { data, width, height };
}

/** Otsu's global threshold — the classic split of a two-tone histogram. */
export function otsuLevel(g: Gray): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of g.data) hist[v]++;
  const total = g.data.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let level = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      level = t;
    }
  }
  return level;
}

/** Everything darker than `level` becomes ink (0), the rest paper (255). */
export function threshold(g: Gray, level: number): Gray {
  const data = new Uint8Array(g.data.length);
  for (let i = 0; i < data.length; i++) data[i] = g.data[i] < level ? 0 : 255;
  return { ...g, data };
}

/**
 * Ink where a pixel is `offset` darker than the mean of its neighbourhood
 * (radius `r`), computed with an integral image. A faded print with a washed-
 * out half — the second United pass — has no single level that separates ink
 * from paper everywhere; a local one does.
 */
export function localMeanThreshold(g: Gray, r: number, offset: number): Gray {
  const { width: w, height: h } = g;
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += g.data[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r);
    const yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r);
      const xb = Math.min(w, x + r + 1);
      const sum =
        integral[yb * (w + 1) + xb] -
        integral[ya * (w + 1) + xb] -
        integral[yb * (w + 1) + xa] +
        integral[ya * (w + 1) + xa];
      const mean = sum / ((yb - ya) * (xb - xa));
      data[y * w + x] = g.data[y * w + x] < mean - offset ? 0 : 255;
    }
  }
  return { data, width: w, height: h };
}
