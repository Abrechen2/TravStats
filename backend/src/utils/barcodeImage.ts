/**
 * Decode a boarding-pass 2D barcode directly FROM an image.
 *
 * Boarding-pass OCR (Tesseract) is unreliable — it returns low-confidence
 * garbage for the structured fields. The 2D barcode every boarding pass carries
 * is deterministic and error-corrected, so when a user uploads a photo or a
 * Wallet screenshot we read the barcode out of the image and feed it to the
 * BCBP decoder, exactly like a live camera scan.
 *
 * Formats cover every boarding-pass variant: PDF417 (paper), Aztec (most
 * mobile/Wallet passes) and QRCode (some airlines' digital passes).
 */
import logger from "./logger";

interface ZxingResult {
  text: string;
  format: string;
}
type ReadBarcodes = (
  input: Blob,
  options: { formats: string[]; tryHarder: boolean }
) => Promise<ZxingResult[]>;

// zxing-wasm is ESM-only, but the backend compiles to CommonJS. A plain
// `import()` would be downleveled by tsc to `require()`, which throws on an
// ESM-only package. The Function indirection keeps a *native* dynamic import at
// runtime so Node's ESM loader handles it.
// eslint-disable-next-line no-new-func
const esmImport = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<{ readBarcodes: ReadBarcodes }>;

function stripDataUrl(s: string): string {
  const i = s.indexOf("base64,");
  return i >= 0 ? s.slice(i + 7) : s;
}

/**
 * Returns the decoded barcode string (typically an IATA BCBP "M…" string) or
 * null if no PDF417 / Aztec / QR barcode could be read. Never throws.
 */
export async function decodeBarcodeFromImageBase64(imageBase64: string): Promise<string | null> {
  try {
    const { readBarcodes } = await esmImport("zxing-wasm/reader");
    const blob = new Blob([Buffer.from(stripDataUrl(imageBase64), "base64")]);
    const results = await readBarcodes(blob, {
      formats: ["PDF417", "Aztec", "QRCode"],
      tryHarder: true,
    });
    // Prefer a result that looks like a BCBP boarding pass ("M" prefix).
    const bcbp = results.find((r) => typeof r.text === "string" && r.text[0] === "M");
    return bcbp?.text ?? results[0]?.text ?? null;
  } catch (err) {
    logger.warn({ err }, "[BarcodeImage] barcode decode from image failed");
    return null;
  }
}
