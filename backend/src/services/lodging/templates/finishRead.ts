import type { LodgingCurrency, ParsedLodgingBooking } from "../parsedLodgingBooking";
import type { LodgingFieldRules } from "./types";
import type { LodgingReportableField as ReportableField } from "../../parsers/templates/v2/outputSchemas";

/** What a declarative reader extracted, field by field; an absent key was not read. */
export type LodgingRead = Partial<Record<keyof LodgingFieldRules, string | number>>;

export interface FinishOptions {
  /** `parserTemplate` on the result: the reader's short name ("koa", "hilton"). */
  parserTemplate: string;
  /** The check-out was dated with a borrowed year, so a stay over New Year may move it by one. */
  checkOutYearBorrowed: boolean;
  type: ParsedLodgingBooking["type"] | null;
  chainName: string | null;
  /** The night count the document prints; it wins over the date span when present. */
  printedNights?: number | null;
  /** Fields whose absence `missing` reports, in this order. Default: city, total, number. */
  report?: readonly ReportableField[];
  /** `parserConfidence` with nothing missing / with something missing. Default 75 / 65. */
  confidence?: { complete: number; partial: number };
}

const DEFAULT_REPORT: readonly ReportableField[] = ["city", "totalPrice", "confirmationNumber"];

const DAY_MS = 86_400_000;

/**
 * The longest span a lodging confirmation can plausibly describe.
 *
 * A year of hotel nights is not a booking; it is a date read wrongly. The
 * number is deliberately generous — long stays exist — and it exists only to
 * catch a repair that produced something worse than the problem.
 */
const MAX_PLAUSIBLE_NIGHTS = 365;

/**
 * Turns what a declarative reader extracted into a stay, or declines.
 *
 * Shared by the user-template engine (`engine.ts`) and the v2 template
 * adapter (`v2Lodging.ts`), so a stay means the same thing whichever kind of
 * template read it: the New Year repair, the plausibility bound, the
 * "no currency, no price" guard and the confidence figure live here once.
 */
export function finishLodgingRead(
  read: LodgingRead,
  options: FinishOptions
): ParsedLodgingBooking | null {
  const str = (field: keyof LodgingFieldRules): string | null => {
    const value = read[field];
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  const num = (field: keyof LodgingFieldRules): number | null => {
    const value = read[field];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };

  const checkIn = str("checkIn");
  let checkOut = str("checkOut");
  if (!checkIn || !checkOut) return null;

  // A stay over New Year, dated without years. Hilton writes "Check In: Dec
  // 30" / "Check Out: Jan 02" and puts one year in the subject, so both dates
  // borrow it and the stay comes out ending before it began. The year-less
  // half is the one to move, and only by one: a checkout more than a year
  // after the checkin is not a hotel stay, it is a misread.
  if (Date.parse(checkOut) < Date.parse(checkIn) && options.checkOutYearBorrowed) {
    const [y, rest] = [checkOut.slice(0, 4), checkOut.slice(4)];
    checkOut = `${Number(y) + 1}${rest}`;
  }
  // Still inconsistent means the document was not understood. Declining is
  // the result; a stay that ends before it starts would be proposed to the
  // user as fact, and the import's own date guard would then reject the row.
  if (Date.parse(checkOut) < Date.parse(checkIn)) return null;

  const nights = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / DAY_MS);

  // The repair above turns one wrong year into a plausible-looking stay when
  // the year it borrowed belonged to the CHECK-OUT: "Your Jan 02 2025
  // Confirmation" over "Dec 30"/"Jan 02" becomes 2025-12-30 → 2026-01-02, a
  // 368-night booking that reads like data. Nobody books a hotel for a year,
  // so a span that long is the misread saying so, and the document falls
  // through to a reader — or a human — that can do better.
  if (nights > MAX_PLAUSIBLE_NIGHTS) return null;

  const currency = str("currency") as LodgingCurrency | null;
  const totalPrice = num("totalPrice");
  const pricePerNight = num("pricePerNight");
  // The same guard the commit applies: an amount whose unit the document
  // never stated is not a price, and writing it against a default currency
  // states something the sender did not.
  const priced = currency !== null;

  const readValue: Record<ReportableField, unknown> = {
    roomCategory: str("roomCategory"),
    address: str("address"),
    postcode: str("postcode"),
    city: str("city"),
    country: str("country"),
    totalPrice: priced ? totalPrice : null,
    pricePerNight: priced ? pricePerNight : null,
    guests: num("guests"),
    confirmationNumber: str("confirmationNumber"),
  };
  const missing = (options.report ?? DEFAULT_REPORT).filter((field) => readValue[field] === null);
  // Deliberately below Booking.com's figures (95 / 80) by default. These readers
  // are younger and measured against a handful of mails each; the number
  // should say that until the corpus says otherwise.
  const confidence = options.confidence ?? { complete: 75, partial: 65 };

  return {
    hotelName: str("hotelName") ?? "",
    checkIn,
    checkOut,
    // The printed night count is authoritative; the date span is the fallback.
    nights: options.printedNights ?? nights,
    roomCategory: str("roomCategory"),
    address: str("address"),
    postcode: str("postcode"),
    city: str("city"),
    country: str("country"),
    totalPrice: priced ? totalPrice : null,
    pricePerNight: priced ? pricePerNight : null,
    currency,
    board: null,
    guests: num("guests"),
    type: options.type,
    chainName: options.chainName,
    confirmationNumber: str("confirmationNumber"),
    parserTemplate: options.parserTemplate,
    parserConfidence: missing.length === 0 ? confidence.complete : confidence.partial,
    missing,
  };
}
