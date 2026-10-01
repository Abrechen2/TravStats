import logger from "../../../utils/logger";
import { extractTextFromPdf } from "../../pdfParser";
import { parseSixtConfirmation } from "./sixtConfirmation";
import { parseSixtInvoice } from "./sixtInvoice";
import type { ParsedRentalCancellation, ParsedRentalDocument } from "./types";

/**
 * Template, else (from package R3) the model, else decline — no generic regex
 * reader (spec 2026-10-01-rental-domain-design §4). A generic "two dates, a
 * station word and a price" reader files airport-parking mails as rentals;
 * the corpus held five of them.
 *
 * Every way of finding nothing carries its own stable code, worded by the
 * client in the reader's language.
 */

export type RentalFallbackCode =
  /** An airport-parking booking — Einfahrt/Ausfahrt, Parkhaus, a QR entry (§4.3). */
  | "parking"
  /** A provider mail without an itinerary: marketing, account, survey. */
  | "noItinerary"
  /** A rental document no template reads (the model path arrives with R3). */
  | "noTemplate"
  /** "On request, not yet confirmed" — not a booking yet. */
  | "notConfirmed"
  /** The document is clearly another domain (a flight, a stay, a cruise). */
  | "otherDomain"
  /** A change, cancellation or invoice for a booking this account does not hold (§4.4, §4.5). */
  | "unknownBooking";

export interface RentalAttachment {
  filename?: string;
  mediaType: string;
  content: Buffer;
}

export interface RentalParseResult {
  document: ParsedRentalDocument | null;
  parserUsed: "template" | "none";
  /** Which reader answered — kept so a wrong reading can be traced. */
  parserTemplate: string | null;
  fallbackCode?: RentalFallbackCode;
  /** English, for the log. The UI reads `fallbackCode`. */
  fallbackReason?: string;
}

const MAX_ATTACHMENTS = 6;
const isPdf = (a: RentalAttachment): boolean =>
  /\.pdf$/i.test(a.filename ?? "") || /application\/pdf/i.test(a.mediaType);

/** The text of the PDFs a mail carries — a Sixt invoice prints its figures only there. */
async function pdfTexts(attachments: readonly RentalAttachment[]): Promise<string[]> {
  const texts: string[] = [];
  for (const attachment of attachments.filter(isPdf).slice(0, MAX_ATTACHMENTS)) {
    try {
      texts.push(await extractTextFromPdf(attachment.content));
    } catch (error) {
      // An unreadable attachment is logged and skipped; the body is still read.
      logger.warn({ operation: "rental_pdf_unreadable", error }, "rental attachment unreadable");
    }
  }
  return texts;
}

/**
 * Airport parking (§4.3): the shape that looks like a rental — an airport, a
 * booking number, two times and a price — and is not one. Its words are
 * entry/exit and car park, never pickup/return of a vehicle.
 */
export function looksLikeParking(text: string): boolean {
  return (
    /\b(Einfahrt|Ausfahrt|Parkhaus|Parkplatz|Parkdeck|car park|parking space|Stellplatz)\b/i.test(
      text
    ) &&
    !/\b(Abholung|Rückgabe|pick-?up|drop-?off|Fahrzeuggruppe|car group|or similar|oder ähnlich)\b/i.test(
      text
    )
  );
}

const PROVIDERS: ReadonlyArray<[RegExp, string]> = [
  [/\bsixt\b/i, "Sixt"],
  [/\beuropcar\b/i, "Europcar"],
  [/\bavis\b/i, "Avis"],
  [/\bhertz\b/i, "Hertz"],
  [/\balamo\b/i, "Alamo"],
  [/\benterprise\b/i, "Enterprise"],
];

/** The provider a sender address names; null for anyone else. */
export function providerOf(from: string | null | undefined): string | null {
  if (!from) return null;
  return PROVIDERS.find(([pattern]) => pattern.test(from))?.[1] ?? null;
}

const CANCELLED =
  /\b(storniert|Stornierungsbestätigung|has been cancell?ed|cancell?ation confirmation|reservation cancell?ed|annul[ée]e)\b/i;
const BOOKING_NUMBER =
  /\b(?:Buchung(?:snummer)?|Reservierung(?:snummer)?|Reservation(?: number)?|Booking(?: number)?|Confirmation(?: number)?)\s*(?:#|:|Nr\.?)?\s*([A-Z0-9-]{6,20})\b/i;

/**
 * A cancellation names a booking and cancels it — it never creates one (§4.4).
 * UNMEASURED: neither corpus holds a cancellation mail, so this reads the
 * generic shape (a provider sender, a cancellation phrase, a labelled booking
 * number) and its tests are synthetic.
 */
export function parseCancellation(
  text: string,
  from: string | null | undefined
): ParsedRentalCancellation | null {
  const provider = providerOf(from);
  if (!provider || !CANCELLED.test(text)) return null;
  const number = BOOKING_NUMBER.exec(text)?.[1];
  if (!number || !/\d/.test(number)) return null;
  return {
    kind: "cancellation",
    source: "sixt-confirmation",
    provider,
    confirmationNumber: number,
  };
}

export async function parseRentalBookingText(
  text: string,
  options: {
    subject?: string;
    from?: string | null;
    attachments?: readonly RentalAttachment[];
  } = {}
): Promise<RentalParseResult> {
  const combined = options.subject ? `${options.subject}\n\n${text}` : text;
  const withPdfs = [combined, ...(await pdfTexts(options.attachments ?? []))].join("\n\n");

  if (looksLikeParking(withPdfs)) {
    return decline("parking", "The document is an airport-parking booking, not a rental");
  }
  if (/\b(auf Anfrage|on request|nicht bestätigt|not yet confirmed)\b/i.test(withPdfs)) {
    return decline("notConfirmed", "The rental is on request and not confirmed yet");
  }

  const invoice = parseSixtInvoice(withPdfs, options.subject);
  if (invoice) return { document: invoice, parserUsed: "template", parserTemplate: "sixt-invoice" };

  const confirmation = parseSixtConfirmation(combined, options.from);
  if (confirmation) {
    return { document: confirmation, parserUsed: "template", parserTemplate: "sixt-confirmation" };
  }

  const cancellation = parseCancellation(combined, options.from);
  if (cancellation) {
    return { document: cancellation, parserUsed: "template", parserTemplate: "cancellation" };
  }

  return providerOf(options.from)
    ? decline("noItinerary", "A provider mail with no booking this reader knows")
    : decline("noTemplate", "No rental template reads this document");
}

function decline(code: RentalFallbackCode, reason: string): RentalParseResult {
  return {
    document: null,
    parserUsed: "none",
    parserTemplate: null,
    fallbackCode: code,
    fallbackReason: reason,
  };
}
