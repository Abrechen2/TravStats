import type { ParsedBooking } from "../bookingParser";
import { extractTextFromPdf } from "../pdfParser";
import logger from "../../utils/logger";
import { keepOnlyFlightsWithEvidence } from "./shared/evidence";
import { TemplateParser } from "./text/templateParser";

/** A file that came with a mail — the shape `extractEmailFromFile` hands over. */
export interface MailAttachment {
  filename?: string;
  mediaType: string;
  content: Buffer;
}

/** Attachments beyond this are not read: a booking carries one or two. */
const MAX_PDFS = 6;

const isPdf = (a: MailAttachment): boolean =>
  /\.pdf$/i.test(a.filename ?? "") || /application\/pdf/i.test(a.mediaType);

/** The PDFs of a mail a reader opens, in mail order and at most `MAX_PDFS`. */
export function pdfAttachmentsToRead(attachments: readonly MailAttachment[]): MailAttachment[] {
  return attachments.filter(isPdf).slice(0, MAX_PDFS);
}

/**
 * Flights a mail prints only in its PDF attachment.
 *
 * Air Berlin's booking mails say "anbei erhalten Sie die Rechnung" and name no
 * flight; the itinerary exists only in the attached invoice. Measured
 * 2026-10-01 on a private mailbox: about fifty such mails, every one read as
 * nothing, because the flight parser never opened an attachment (the rail
 * parser has done so since its first version).
 *
 * Deliberately narrow:
 *   - only the built-in templates read the PDF, never the generic regex — a
 *     PDF is full of numbers (VAT ids, invoice numbers, prices), and the regex
 *     reading a number out of one is exactly the phantom flight the evidence
 *     rules exist to stop;
 *   - a template must read every leg whole (number, both airports,
 *     departure), and the legs must carry evidence in the PDF's own text;
 *   - a template that recognises its sender's cancellation in a PDF ends the
 *     search with nothing.
 * A PDF that cannot be read is logged and skipped; the mail's body answer
 * stands.
 */
export async function readFlightsFromPdfAttachments(
  subject: string,
  attachments: readonly MailAttachment[],
  userId?: string
): Promise<ParsedBooking[]> {
  const parser = new TemplateParser();
  for (const attachment of pdfAttachmentsToRead(attachments)) {
    let text: string;
    try {
      text = await extractTextFromPdf(attachment.content);
    } catch (err) {
      logger.warn(
        { file: attachment.filename, err: err instanceof Error ? err.message : String(err) },
        "[Flight Parser] PDF attachment could not be read"
      );
      continue;
    }
    const reading = await parser.read(subject, text, undefined, userId, {
      requireWholeLegs: true,
    });
    if (reading.nonBooking) return [];
    if (reading.flights.length === 0) continue;
    const kept = keepOnlyFlightsWithEvidence(reading.flights, "regex", `${subject}\n${text}`);
    if (kept.length === reading.flights.length) return kept;
  }
  return [];
}

/** A body answer that a PDF may replace: nothing, or legs without a route. */
export function bodyNamesNoRoute(flights: readonly ParsedBooking[]): boolean {
  return flights.every((f) => !(f.departureCode && f.arrivalCode));
}
