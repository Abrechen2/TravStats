/**
 * The shortest extracted text that could plausibly be a travel document.
 *
 * A blank page, a photograph of a wall, a failed scan — and a scanned PDF,
 * whose only text layer is a page number or a scanner's watermark — all come
 * back as a handful of stray glyphs. Handing those to a parser wastes an LLM
 * round trip and answers with an empty result that looks like "we could not
 * read your document" when the truth is "there was no text in it". Below this,
 * the route says so instead.
 *
 * Shared by /parse-image (OCR output) and /parse-pdf (the PDF's text layer).
 * The PDF route used to refuse only EMPTY text, so a scanned hotel invoice with
 * twelve stray characters answered 200 with no candidates and no hint where to
 * send it (sandbox run 2026-09-17, QA-003).
 */
export const MIN_USABLE_TEXT_LENGTH = 40;

export function hasUsableText(text: string): boolean {
  return text.trim().length >= MIN_USABLE_TEXT_LENGTH;
}
