import { PDFParse } from "pdf-parse";

import logger from "../utils/logger";

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF

/*
 * Its own module rather than a function in pdfParser.ts: a dozen suites stub
 * pdfParser with only the two functions the parse routes use, and a document
 * upload reaching this through the stub would find nothing there.
 */

/**
 * How many pages a PDF has, from its page tree (forgejo#132 item 4). Null —
 * unknown, never 0 — when the bytes are not a PDF or the reader cannot open
 * them; the failure is logged, and the caller keeps the document regardless.
 */
export async function countPdfPages(buffer: Buffer): Promise<number | null> {
  if (buffer.length < 4 || !buffer.subarray(0, 4).equals(PDF_MAGIC)) return null;
  const parser = new PDFParse({ data: buffer });
  try {
    const { total } = await parser.getInfo();
    return Number.isInteger(total) && total > 0 ? total : null;
  } catch (err: unknown) {
    logger.warn(
      { operation: "pdf_page_count", err },
      "[PDF Parser] Page count unreadable; stored as unknown"
    );
    return null;
  } finally {
    await parser.destroy();
  }
}
