/**
 * Decode boarding-pass 2D barcodes directly FROM an image.
 *
 * Boarding-pass OCR (Tesseract) is unreliable for the structured fields; the
 * 2D barcode every pass carries is deterministic and error-corrected. So when
 * a user uploads a photo or a Wallet screenshot we read the barcode(s) out of
 * the image and feed them to the BCBP decoder, exactly like a live camera scan.
 *
 * Formats: PDF417 (paper), Aztec (most Wallet passes), QR (some airlines'
 * digital passes). The search itself — full frame, then cropped, thresholded
 * and upscaled candidate regions — lives in `barcodeScan/`.
 */
import { scanBoardingPassBarcodes, type BarcodeScan } from "./barcodeScan";

export type { BarcodeScan, FoundBarcode } from "./barcodeScan";

function stripDataUrl(s: string): string {
  const i = s.indexOf("base64,");
  return i >= 0 ? s.slice(i + 7) : s;
}

/** Every barcode in the image, with how the search went. Never throws. */
export async function scanBarcodesFromImageBase64(imageBase64: string): Promise<BarcodeScan> {
  return scanBoardingPassBarcodes(Buffer.from(stripDataUrl(imageBase64), "base64"));
}

/**
 * The first barcode, preferring a BCBP boarding pass ("M" prefix), or null.
 * Kept for single-barcode callers; never throws.
 */
export async function decodeBarcodeFromImageBase64(imageBase64: string): Promise<string | null> {
  const { codes } = await scanBarcodesFromImageBase64(imageBase64);
  const bcbp = codes.find((c) => c.text[0] === "M");
  return bcbp?.text ?? codes[0]?.text ?? null;
}
