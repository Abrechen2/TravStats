/**
 * Find EVERY boarding-pass barcode in a photo — PDF417 (paper), Aztec (most
 * Wallet passes) or QR — and say how hard it looked.
 *
 * Order, cheapest first:
 *  1. zxing over the whole image as sent (what a Wallet screenshot needs);
 *  2. each textured block `findBarcodeRegions` points at, cropped, with
 *     variants: as is, Otsu threshold, a high fixed threshold for faint print,
 *     and a local-mean threshold — each at 1× and, for small crops, 2×.
 *     zxing's own `tryRotate` covers the 90° turn of a stub barcode.
 *
 * Stops looking in a region at its first boarding-pass hit, and stops
 * altogether at the time budget — a photo with no barcode must still reach
 * OCR in reasonable time.
 */
import { readBarcodes, type ReadResult } from "zxing-wasm/reader";
import logger from "../logger";
import {
  crop,
  decodeToGray,
  downscale,
  grayToRgba,
  localMeanThreshold,
  otsuLevel,
  threshold,
  upscale,
  type Box,
  type Gray,
} from "./pixels";
import { findBarcodeRegions } from "./regions";

const FORMATS = ["PDF417", "Aztec", "QRCode"];
/** Wall-clock budget for the region search; the full-frame pass always runs. */
const SEARCH_BUDGET_MS = 20_000;
/** Crops whose long side is below this get a 2× variant. */
const UPSCALE_BELOW_PX = 1400;
/** Above this long side the analysis grid works on a downscaled copy. */
const ANALYSIS_MAX_SIDE = 2400;
/** A fixed level for faint dot-matrix print: only near-paper counts as paper. */
const FAINT_PRINT_LEVEL = 215;
/**
 * Local-mean thresholds, both ways: +15 keeps only clearly dark ink (a crisp
 * print on a busy background), -15 counts everything not clearly paper as ink
 * — the setting that decoded the faded second United pass, measured.
 */
const LOCAL_INK_OFFSET = 15;

export interface FoundBarcode {
  readonly text: string;
  readonly format: string;
  /** Where on the ORIGINAL image the symbol sits, when known. */
  readonly box?: Box;
}

export interface BarcodeScan {
  /** Distinct symbols, top-to-bottom then left-to-right. */
  readonly codes: readonly FoundBarcode[];
  /** False when the bytes were not a JPEG/PNG we could crop (zxing still saw them whole). */
  readonly imageDecoded: boolean;
  readonly regionsTried: number;
  readonly attempts: number;
  readonly budgetExhausted: boolean;
  /** Set when zxing itself failed (not "found nothing") — the stage's own error. */
  readonly error?: string;
}

const looksLikeBoardingPass = (text: string): boolean => text.length >= 58 && text[0] === "M";

function boxOf(r: ReadResult, offset: Box, scale: number): Box | undefined {
  const p = r.position;
  if (!p) return undefined;
  const xs = [p.topLeft.x, p.topRight.x, p.bottomLeft.x, p.bottomRight.x];
  const ys = [p.topLeft.y, p.topRight.y, p.bottomLeft.y, p.bottomRight.y];
  const x = Math.min(...xs) / scale + offset.x;
  const y = Math.min(...ys) / scale + offset.y;
  return {
    x,
    y,
    width: (Math.max(...xs) - Math.min(...xs)) / scale,
    height: (Math.max(...ys) - Math.min(...ys)) / scale,
  };
}

async function decodeGray(g: Gray): Promise<ReadResult[]> {
  // zxing reads any {data, width, height} RGBA pixmap; Node has no ImageData
  // class, so the reader's parameter type is satisfied by a cast.
  return readBarcodes(grayToRgba(g) as unknown as Parameters<typeof readBarcodes>[0], {
    formats: FORMATS as never,
    tryHarder: true,
    tryRotate: true,
    maxNumberOfSymbols: 8,
  });
}

function variantsOf(region: Gray): Array<{ gray: Gray; scale: number }> {
  const long = Math.max(region.width, region.height);
  const scales = long < UPSCALE_BELOW_PX ? [1, 2] : [1];
  const out: Array<{ gray: Gray; scale: number }> = [];
  for (const scale of scales) {
    const g = upscale(region, scale);
    const radius = Math.max(8, Math.round(Math.min(g.width, g.height) / 10));
    out.push(
      { gray: g, scale },
      { gray: threshold(g, otsuLevel(g)), scale },
      { gray: threshold(g, FAINT_PRINT_LEVEL), scale },
      { gray: localMeanThreshold(g, radius, LOCAL_INK_OFFSET), scale },
      { gray: localMeanThreshold(g, radius, -LOCAL_INK_OFFSET), scale }
    );
  }
  return out;
}

export async function scanBoardingPassBarcodes(imageBytes: Buffer): Promise<BarcodeScan> {
  const found = new Map<string, FoundBarcode>();
  let attempts = 0;
  const keep = (r: ReadResult, offset: Box, scale: number): void => {
    if (typeof r.text !== "string" || r.text === "" || found.has(r.text)) return;
    found.set(r.text, { text: r.text, format: String(r.format), box: boxOf(r, offset, scale) });
  };
  const origin: Box = { x: 0, y: 0, width: 0, height: 0 };

  try {
    attempts++;
    const whole = await readBarcodes(new Blob([new Uint8Array(imageBytes)]), {
      formats: FORMATS as never,
      tryHarder: true,
      maxNumberOfSymbols: 8,
    });
    for (const r of whole) keep(r, origin, 1);
  } catch (err) {
    logger.warn({ err }, "[BarcodeScan] full-frame decode failed");
    return finish(found, false, 0, attempts, false, describe(err));
  }

  let gray: Gray | null;
  try {
    gray = decodeToGray(imageBytes);
  } catch (err) {
    logger.warn({ err }, "[BarcodeScan] image could not be decoded for cropping");
    gray = null;
  }
  if (gray === null) return finish(found, false, 0, attempts, false);

  const factor = Math.max(1, Math.ceil(Math.max(gray.width, gray.height) / ANALYSIS_MAX_SIDE));
  const regions = findBarcodeRegions(downscale(gray, factor)).map((r) => ({
    x: r.x * factor,
    y: r.y * factor,
    width: r.width * factor,
    height: r.height * factor,
  }));

  const started = Date.now();
  let regionsTried = 0;
  let budgetExhausted = false;
  for (const region of regions) {
    if (alreadyCovered(region, found)) continue;
    regionsTried++;
    const cropped = crop(gray, region);
    for (const { gray: variant, scale } of variantsOf(cropped)) {
      if (Date.now() - started > SEARCH_BUDGET_MS) {
        budgetExhausted = true;
        break;
      }
      attempts++;
      let results: ReadResult[];
      try {
        results = await decodeGray(variant);
      } catch (err) {
        logger.debug({ err }, "[BarcodeScan] region variant decode threw");
        continue;
      }
      for (const r of results) keep(r, region, scale);
      if (results.some((r) => looksLikeBoardingPass(r.text))) break;
    }
    if (budgetExhausted) break;
  }

  return finish(found, true, regionsTried, attempts, budgetExhausted);
}

/** A region whose centre lies inside a symbol already read adds nothing. */
function alreadyCovered(region: Box, found: Map<string, FoundBarcode>): boolean {
  const cx = region.x + region.width / 2;
  const cy = region.y + region.height / 2;
  for (const f of found.values()) {
    const b = f.box;
    if (b && cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height) return true;
  }
  return false;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function finish(
  found: Map<string, FoundBarcode>,
  imageDecoded: boolean,
  regionsTried: number,
  attempts: number,
  budgetExhausted: boolean,
  error?: string
): BarcodeScan {
  const codes = [...found.values()].sort((a, b) => {
    const ay = a.box?.y ?? 0;
    const by = b.box?.y ?? 0;
    // Same band (overlapping vertically): left to right.
    const sameBand = a.box && b.box && Math.abs(ay - by) < Math.min(a.box.height, b.box.height) / 2;
    return sameBand ? (a.box?.x ?? 0) - (b.box?.x ?? 0) : ay - by;
  });
  return {
    codes,
    imageDecoded,
    regionsTried,
    attempts,
    budgetExhausted,
    ...(error ? { error } : {}),
  };
}
