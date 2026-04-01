import { PDFParse } from 'pdf-parse';
import logger from '../utils/logger';

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF

/**
 * Extracts plain text from a PDF buffer.
 * Throws if the buffer does not start with the PDF magic number.
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  if (buffer.length < 4 || !buffer.subarray(0, 4).equals(PDF_MAGIC)) {
    throw new Error('Invalid PDF: missing %PDF header');
  }

  const parser = new PDFParse({ data: buffer });
  let result: { text: string; total: number };
  try {
    result = await parser.getText() as { text: string; total: number };
  } catch (err: unknown) {
    logger.error({ operation: 'pdf_text_extraction', err }, '[PDF Parser] pdf-parse failed');
    throw new Error('PDF text extraction failed', { cause: err });
  } finally {
    await parser.destroy();
  }
  const text = result.text;

  logger.debug({
    operation: 'pdf_text_extraction',
    pages: result.total,
    chars: text.length,
  }, '[PDF Parser] Extracted text');

  return text;
}

/**
 * Checks if extracted PDF text looks like an IATA BCBP string.
 * BCBP format: 'M' + number-of-legs digit (1-9) + passenger name.
 */
export function isBcbpText(text: string): boolean {
  return /^M[1-9]/.test(text.trim());
}
