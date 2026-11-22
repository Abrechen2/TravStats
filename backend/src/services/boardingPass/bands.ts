/**
 * Several boarding passes on one photo: which part of the image belongs to
 * which barcode.
 *
 * OCR of the whole United photo read both passes into one text, and the regex
 * reader took the flight number of the first and the route of the second
 * (UA633 ORD→MUC — a flight that does not exist). Each pass's barcode marks
 * where that pass is, so the image is cut into one band per barcode — rows
 * when the passes are stacked, columns when they lie side by side — with each
 * boundary halfway between neighbouring barcodes, and every band is read on
 * its own.
 */
import { PNG } from "pngjs";
import { crop, decodeToGray, type Box, type Gray } from "../../utils/barcodeScan/pixels";

export function passBands(width: number, height: number, boxes: readonly Box[]): Box[] {
  if (boxes.length < 2) return [{ x: 0, y: 0, width, height }];
  const centres = boxes.map((b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }));
  const spreadY = Math.max(...centres.map((c) => c.y)) - Math.min(...centres.map((c) => c.y));
  const spreadX = Math.max(...centres.map((c) => c.x)) - Math.min(...centres.map((c) => c.x));
  const stacked = spreadY >= spreadX;
  const key = (c: { x: number; y: number }): number => (stacked ? c.y : c.x);
  const order = centres.map((c, i) => ({ i, k: key(c) })).sort((a, b) => a.k - b.k);
  const extent = stacked ? height : width;
  const bands: Box[] = new Array(boxes.length);
  order.forEach((entry, n) => {
    const start = n === 0 ? 0 : (order[n - 1].k + entry.k) / 2;
    const end = n === order.length - 1 ? extent : (entry.k + order[n + 1].k) / 2;
    bands[entry.i] = stacked
      ? { x: 0, y: Math.floor(start), width, height: Math.ceil(end - start) }
      : { x: Math.floor(start), y: 0, width: Math.ceil(end - start), height };
  });
  return bands;
}

function grayToPngBase64(g: Gray): string {
  const png = new PNG({
    width: g.width,
    height: g.height,
    colorType: 0,
    inputColorType: 0,
    inputHasAlpha: false,
  });
  png.data = Buffer.from(g.data);
  // Fast deflate: the band only travels from here to the OCR worker.
  return PNG.sync
    .write(png, {
      colorType: 0,
      inputColorType: 0,
      inputHasAlpha: false,
      deflateLevel: 1,
      filterType: 0,
    })
    .toString("base64");
}

/**
 * One PNG per barcode, cut from the image, for OCR. Null when the image is
 * not a JPEG/PNG we can cut — the caller then reads the whole image once.
 */
export function cropPassBands(imageBase64: string, boxes: readonly Box[]): string[] | null {
  const gray = decodeToGray(Buffer.from(imageBase64, "base64"));
  if (!gray) return null;
  return passBands(gray.width, gray.height, boxes).map((band) => grayToPngBase64(crop(gray, band)));
}
