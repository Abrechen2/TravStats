import { extractTextFromPdf } from "../pdfParser";

/**
 * The text of a mail's PDF attachment, extracted at most once per Buffer.
 *
 * One mail runs through several readers — domain detection, then the rail,
 * rental, flight-PDF or package reader — and each used to open the same PDF
 * again (forgejo#383, PERF-30). They all receive the very same `content`
 * Buffer from the parse input, so the Buffer is the key; the WeakMap lets the
 * text go with the attachment. A failed extraction is memoised too, so every
 * reader sees the same error it would have raised itself and logs it its own
 * way.
 */
const extractions = new WeakMap<Buffer, Promise<string>>();

export function extractAttachmentText(content: Buffer): Promise<string> {
  let pending = extractions.get(content);
  if (!pending) {
    pending = extractTextFromPdf(content);
    extractions.set(content, pending);
  }
  return pending;
}
