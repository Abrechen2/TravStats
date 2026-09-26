import logger from "../../utils/logger";
import type { ParserSupportedDomain } from "../../shared/domains";
import { extractEmailFromFile } from "../emailExtractor";
import { parseDocument } from "../parsing/parseDocument";
import { hasUsableText } from "../parsing/usableText";
import { extractTextFromPdf } from "../pdfParser";
import { readDocumentForParse, recordParse } from "./parseRetention";
import { valuesOf, type ExtractedValues, type LegHints } from "./documentValues";

/**
 * "Take the values from this receipt" — the parser pipeline run on a document
 * that is ALREADY kept, answering only the handful of fields an entry's cost
 * block has room for.
 *
 * It reuses what the parse routes use, in the same order: the kept bytes
 * (`readDocumentForParse`, so ownership and the 415 for an unreadable format
 * are theirs), the same text extraction, and `parseDocument`, which reads the
 * user's parser settings (LLM on or off, templates) itself. The reading is
 * recorded on the document exactly as a parse by id would record it.
 *
 * It never writes an entry. The answer is a proposal; the form, or the detail
 * page after the user ticks the boxes, is what saves anything.
 */

/** The formats the text parsers read. An image needs OCR, which is its own, slower route. */
export const EXTRACTABLE_FORMATS = ["pdf", "eml", "emailText"] as const;

export interface ExtractValuesResult {
  domain: ParserSupportedDomain;
  parserUsed: string | null;
  /** Null when the parser read nothing usable — said plainly, not as empty fields. */
  values: ExtractedValues | null;
  /** Why `values` is null: no text at all (a scan), or text with nothing in it. */
  reason: "noText" | "nothingFound" | null;
}

export interface ExtractValuesInput extends LegHints {
  domain: ParserSupportedDomain;
}

export type { ExtractedValues, SeatClass } from "./documentValues";

interface DocumentText {
  text: string;
  subject?: string;
  html?: string;
  referenceDate?: Date;
  source: "email" | "document";
  attachments?: NonNullable<ReturnType<typeof extractEmailFromFile>["attachments"]>;
}

async function readText(userId: string, documentId: string): Promise<DocumentText> {
  const { document, buffer } = await readDocumentForParse(userId, documentId, EXTRACTABLE_FORMATS);
  if (document.format === "pdf") {
    try {
      return { text: await extractTextFromPdf(buffer), source: "document" };
    } catch (err) {
      // A kept PDF whose text layer cannot be read is, to the user, a PDF with
      // no text — the same answer a scan gets, and the same advice applies.
      logger.warn({ err, documentId }, "[Extract values] PDF text extraction failed");
      return { text: "", source: "document" };
    }
  }
  if (document.format === "eml") {
    const mail = extractEmailFromFile(buffer, "document.eml");
    return {
      text: mail.text,
      subject: mail.subject || undefined,
      ...(mail.html ? { html: mail.html } : {}),
      ...(mail.sentAt ? { referenceDate: mail.sentAt } : {}),
      ...(mail.attachments ? { attachments: mail.attachments } : {}),
      source: "email",
    };
  }
  return { text: buffer.toString("utf8"), source: "email" };
}

export async function extractDocumentValues(
  userId: string,
  documentId: string,
  input: ExtractValuesInput
): Promise<ExtractValuesResult> {
  const read = await readText(userId, documentId);
  if (!hasUsableText(read.text)) {
    return { domain: input.domain, parserUsed: null, values: null, reason: "noText" };
  }

  const outcome = await parseDocument({ ...read, domain: input.domain, userId });
  await recordParse({
    userId,
    documentId,
    parsedDomain: outcome.domain,
    parsedPayload: outcome.body,
  });

  const values = valuesOf(outcome.body, input);
  const found = Object.values(values).some((v) => v !== null);
  return {
    domain: outcome.domain,
    parserUsed: outcome.body.parserUsed,
    values: found ? values : null,
    reason: found ? null : "nothingFound",
  };
}
