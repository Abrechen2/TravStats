import { parseApi, type ParseEmailResult, type ParsePdfResult } from "../../../lib/api/parse";
import type { NewEntryDomain } from "../../../lib/api/documents";
import { fileToBase64, isPdfFile } from "../../../lib/fileBase64";
import { parseFailureMessage } from "../../../lib/parseErrorCopy";
import { detectedOtherDomain } from "../../import/documentHandoff";
import { rentalEmptyParseKey } from "../../import/adapters/rentalAdapter";
import { emptyParseMessageKey } from "../../rail/railImportModel";
import type { RailParseFallbackCode } from "../../../types/rail";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** What a parse route read from a kept document, tagged with the route it came from. */
export type DocumentReading =
  { kind: "pdf"; result: ParsePdfResult } | { kind: "email"; result: ParseEmailResult };

/** The outcome of reading a document on the inbox, before anything is opened. */
export type ReadingOutcome =
  { found: true; reading: DocumentReading | null } | { found: false; reason: string };

/** The extensions the mail route reads; a PDF goes to the PDF route. */
const MAIL_EXTENSIONS = [".eml", ".msg", ".txt"];

function isMail(file: File): boolean {
  const name = file.name.toLowerCase();
  return MAIL_EXTENSIONS.some((ext) => name.endsWith(ext)) || file.type === "message/rfc822";
}

/** How many records a reading holds for the domain it was asked for. */
function foundCount(domain: NewEntryDomain, result: unknown): number {
  const r = result as Record<string, unknown>;
  const len = (key: string): number => (Array.isArray(r[key]) ? (r[key] as unknown[]).length : 0);
  switch (domain) {
    case "flight":
      return len("flights") + len("surfaceBookings");
    case "cruise":
      return len("cruises");
    case "lodging":
    case "rental":
      return len("candidates");
    case "rail": {
      const bookings = Array.isArray(r.bookings) ? (r.bookings as { legs?: unknown[] }[]) : [];
      return bookings.filter((b) => (b.legs?.length ?? 0) > 0).length;
    }
  }
}

/** Why a reading came back empty, in the reader's language — never server prose. */
function emptyReason(domain: NewEntryDomain, result: unknown, t: Translate): string {
  const r = result as Record<string, unknown>;
  switch (domain) {
    case "flight":
      return t(r.llmUnreachable ? "flights:form.llmUnreachable" : "flights:form.noFlightsInEmail");
    case "cruise":
      return t("cruise:import.noCruises");
    case "lodging":
      return t("lodging:import.noBookings");
    case "rail":
      return t(emptyParseMessageKey(r.fallbackCode as RailParseFallbackCode | undefined), {
        reference: typeof r.orderReference === "string" ? r.orderReference : "",
      });
    case "rental":
      return t(rentalEmptyParseKey(r.fallbackCode as string | undefined));
  }
}

/**
 * Read a kept document for one domain BEFORE leaving the inbox ("Neu anlegen
 * aus Dokument"). It used to be read only after the jump to the dashboard, so a
 * document the parser found nothing in left the user on an empty form with the
 * document gone from view and the reason in a toast. Now the outcome is known
 * here: found → the import dialog opens with this reading; nothing → the reason
 * stays on screen next to "create empty with the document".
 *
 * A format the parse routes do not take for this domain (an image for anything
 * but a flight's boarding pass) is answered as an empty reading with its reason;
 * a flight image goes on unread, because only the flight form reads images.
 * A failed request (network, 4xx/5xx, timeout) is also an empty reading, with
 * the reason the import dialog would have given.
 */
export async function readDocumentFor(
  file: File,
  domain: NewEntryDomain,
  t: Translate
): Promise<ReadingOutcome> {
  const pdf = isPdfFile(file);
  if (!pdf && !isMail(file)) {
    if (domain === "flight") return { found: true, reading: null };
    return {
      found: false,
      reason: t("import:email.unsupportedFormat", {
        formats: [...MAIL_EXTENSIONS, ".pdf"].join(", "),
      }),
    };
  }
  let reading: DocumentReading;
  try {
    if (pdf) {
      const base64 = await fileToBase64(file);
      reading = { kind: "pdf", result: await parseApi.parsePdf(base64, domain as "flight") };
    } else {
      reading = { kind: "email", result: await parseApi.parseEmailFile(file, domain) };
    }
  } catch (err: unknown) {
    return {
      found: false,
      reason: parseFailureMessage(
        err,
        t,
        pdf ? "import:pdf.parseError" : "import:email.parseError"
      ),
    };
  }
  const other = detectedOtherDomain(reading.result);
  if (other && other !== domain) {
    return { found: false, reason: t(`import:wrongDialog.${other}`) };
  }
  if (foundCount(domain, reading.result) === 0) {
    return { found: false, reason: emptyReason(domain, reading.result, t) };
  }
  return { found: true, reading };
}
