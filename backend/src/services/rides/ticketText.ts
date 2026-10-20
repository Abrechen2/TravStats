import { z } from "zod";
import { readDocumentForParse } from "../documents/parseRetention";
import { extractTextFromPdf } from "../pdfParser";
import { extractEmailFromFile } from "../emailExtractor";
import logger from "../../utils/logger";

/**
 * What a ticket preview reads (ferry, and bus since forgejo#309): a document
 * the user already uploaded, or pasted text — exactly one of them.
 */
export const ticketPreviewRequest = z.union([
  z.object({ documentId: z.string().uuid() }).strict(),
  z.object({ text: z.string().trim().min(1).max(60000) }).strict(),
]);
export type TicketPreviewRequest = z.infer<typeof ticketPreviewRequest>;

/**
 * The text of a ticket preview's input. A kept PDF whose text layer cannot be
 * read is answered as "no text" (the caller says so), but the broken file is
 * named in the log under `operation`.
 */
export async function readTicketText(
  userId: string,
  input: TicketPreviewRequest,
  operation: string
): Promise<string> {
  if (!("documentId" in input)) return input.text;
  const { document, buffer } = await readDocumentForParse(userId, input.documentId, [
    "pdf",
    "eml",
    "emailText",
  ]);
  if (document.format === "pdf") {
    try {
      return await extractTextFromPdf(buffer);
    } catch (error) {
      logger.warn(
        {
          operation,
          documentId: input.documentId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Ticket PDF could not be read"
      );
      return "";
    }
  }
  if (document.format === "eml") return extractEmailFromFile(buffer, "ticket.eml").text;
  return buffer.toString("utf8");
}
