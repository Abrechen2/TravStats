import { isCurrencyCode } from "../../shared/currencies";
import logger from "../../utils/logger";
import type { ParserSupportedDomain } from "../../shared/domains";
import { extractEmailFromFile } from "../emailExtractor";
import { parseAmount } from "../lodging/documentTotal";
import { parseDocument, type ParsedDocumentBody } from "../parsing/parseDocument";
import { hasUsableText } from "../parsing/usableText";
import { extractTextFromPdf } from "../pdfParser";
import { readDocumentForParse, recordParse } from "./parseRetention";

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

export type SeatClass = "economy" | "premium_economy" | "business" | "first";

export interface ExtractedValues {
  price: number | null;
  currency: string | null;
  bookingReference: string | null;
  /** Flights only. */
  seatNumber: string | null;
  /** Flights only, mapped onto the four classes a flight stores. */
  seatClass: SeatClass | null;
}

export interface ExtractValuesResult {
  domain: ParserSupportedDomain;
  parserUsed: string | null;
  /** Null when the parser read nothing usable — said plainly, not as empty fields. */
  values: ExtractedValues | null;
  /** Why `values` is null: no text at all (a scan), or text with nothing in it. */
  reason: "noText" | "nothingFound" | null;
}

export interface ExtractValuesInput {
  domain: ParserSupportedDomain;
  /** Picks the leg out of a multi-flight booking. */
  flightNumber?: string;
  /** `YYYY-MM-DD`, the same purpose, when the number alone is ambiguous. */
  departureDate?: string;
}

const EMPTY: ExtractedValues = {
  price: null,
  currency: null,
  bookingReference: null,
  seatNumber: null,
  seatClass: null,
};

/** The same mapping the flight review dialog applies to a parsed class. */
export function toSeatClass(raw: string | undefined | null): SeatClass | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("first")) return "first";
  if (lower.includes("business")) return "business";
  if (lower.includes("premium")) return "premium_economy";
  if (lower.includes("economy")) return "economy";
  return null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const currency = (value: unknown): string | null => {
  const code = text(value)?.toUpperCase() ?? null;
  return code !== null && isCurrencyCode(code) ? code : null;
};

const amount = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  const parsed = typeof value === "string" ? parseAmount(value) : null;
  return parsed !== null && parsed > 0 ? parsed : null;
};

const compact = (value: string | undefined): string =>
  (value ?? "").replace(/\s+/g, "").toUpperCase();

type FlightBody = Extract<ParsedDocumentBody, { domain: "flight" }>;
type ParsedLeg = FlightBody["flights"][number];

/**
 * The leg this entry is. By flight number, then by departure day; with one
 * leg, that leg. Several legs and no match is an abstention for the per-leg
 * fields — the seat of the outbound flight is not the seat of the return.
 */
function pickLeg(legs: ParsedLeg[], input: ExtractValuesInput): ParsedLeg | null {
  if (legs.length === 1) return legs[0];
  const number = compact(input.flightNumber);
  const byNumber = number ? legs.filter((l) => compact(l.flightNumber) === number) : [];
  const byDay = input.departureDate
    ? (byNumber.length > 0 ? byNumber : legs).filter((l) =>
        (l.departureTime ?? "").startsWith(input.departureDate!)
      )
    : [];
  if (byDay.length === 1) return byDay[0];
  return byNumber.length === 1 ? byNumber[0] : null;
}

/** One value shared by every leg, or null when the legs disagree. */
function shared<T>(legs: ParsedLeg[], read: (leg: ParsedLeg) => T | null): T | null {
  const values = [...new Set(legs.map(read).filter((v): v is T => v !== null))];
  return values.length === 1 ? values[0] : null;
}

function flightValues(body: FlightBody, input: ExtractValuesInput): ExtractedValues {
  const leg = pickLeg(body.flights, input);
  const booking = (l: ParsedLeg): string | null => text(l.bookingReference) ?? text(l.pnr);
  return {
    price: leg ? amount(leg.price) : shared(body.flights, (l) => amount(l.price)),
    currency: leg ? currency(leg.currency) : shared(body.flights, (l) => currency(l.currency)),
    bookingReference: leg ? booking(leg) : shared(body.flights, booking),
    seatNumber: leg ? text(leg.seat) : null,
    seatClass: leg ? toSeatClass(leg.seatClass) : null,
  };
}

function valuesOf(body: ParsedDocumentBody, input: ExtractValuesInput): ExtractedValues {
  if (body.domain === "flight") return flightValues(body, input);
  // A confirmation for two cruises or two stays names two prices; which one
  // this entry is cannot be told from the document alone.
  if (body.domain === "cruise") {
    if (body.cruises.length !== 1) return EMPTY;
    const cruise = body.cruises[0].input;
    return {
      ...EMPTY,
      price: amount(cruise.price),
      currency: currency(cruise.currency),
      bookingReference: text(cruise.bookingReference),
    };
  }
  if (body.candidates.length !== 1) return EMPTY;
  const stay = body.candidates[0].stay;
  if (!stay) return EMPTY;
  return {
    ...EMPTY,
    price: amount(stay.totalPrice),
    currency: currency(stay.currency),
    bookingReference: text(stay.bookingReference),
  };
}

interface DocumentText {
  text: string;
  subject?: string;
  html?: string;
  referenceDate?: Date;
  source: "email" | "document";
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
