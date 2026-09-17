import { isCurrencyCode } from "../../../shared/currencies";
import { parseAmount } from "../documentTotal";
import {
  CURRENCY_SYMBOLS,
  parseGermanDate,
  type LodgingCurrency,
  type ParsedLodgingBooking,
} from "../bookingComTemplate";
import type { FieldRule, LodgingFieldRules, LodgingTemplate, TransformName } from "./types";

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const DAY_MS = 86_400_000;

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // A date the calendar rejects (31 November) comes back as another day.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * "November 25, 2022", "25 November 2022", "01, Oct. 2018", "Oct 01".
 *
 * A year-less form is legal and common — Hilton prints "Check In: Oct 01" and
 * puts the year only in the subject — so this returns the month and day and
 * lets the caller supply the year (`yearFrom`). Without that the stay lands
 * in whichever year the import happens to run in, which is the class of bug
 * `referenceDate` exists to prevent on the flight side (#285).
 */
export function parseEnglishDate(raw: string, fallbackYear?: number): string | null {
  const text = raw.replace(/\./g, " ").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  const month = (token: string): number | undefined => MONTHS[token.slice(0, 3).toLowerCase()];

  // "November 25 2022" / "Nov 25" (month first)
  let m = /^([A-Za-z]{3,9})\s+(\d{1,2})(?:\s+(\d{4}))?$/.exec(text);
  if (m) {
    const mo = month(m[1]);
    const year = m[3] ? Number(m[3]) : fallbackYear;
    return mo && year ? iso(year, mo, Number(m[2])) : null;
  }

  // "25 November 2022" / "01 Oct 2018" (day first)
  m = /^(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{4}))?$/.exec(text);
  if (m) {
    const mo = month(m[2]);
    const year = m[3] ? Number(m[3]) : fallbackYear;
    return mo && year ? iso(year, mo, Number(m[1])) : null;
  }

  return null;
}

function applyTransform(
  value: string,
  transform: TransformName | undefined,
  fallbackYear?: number
): string | number | null {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;
  switch (transform) {
    case "englishDate":
      return parseEnglishDate(text, fallbackYear);
    // The German reader lives in `bookingComTemplate.ts` and is reused rather
    // than copied: two month tables that must agree is how the continents
    // helper's two copies drifted.
    case "germanDate":
      return parseGermanDate(text);
    case "money":
      return parseAmount(text);
    case "integer": {
      const digits = /\d+/.exec(text);
      return digits ? Number(digits[0]) : null;
    }
    case "currency": {
      const token = text.toUpperCase();
      return CURRENCY_SYMBOLS[text] ?? (isCurrencyCode(token) ? token : null);
    }
    case "text":
    default:
      return text.replace(/[,;]$/, "").trim();
  }
}

function readField(
  haystack: string,
  rule: FieldRule,
  subjectYear: number | undefined
): string | number | null {
  for (const pattern of rule.patterns) {
    const match = new RegExp(pattern, rule.flags ?? "i").exec(haystack);
    if (!match) continue;
    // Capture 1 by convention; a rule that needs more builds them into one
    // group, so a template never depends on group NUMBERING across patterns.
    const captured = match[1];
    if (captured === undefined) continue;
    const value = applyTransform(
      captured,
      rule.transform,
      rule.yearFrom === "subjectYear" ? subjectYear : undefined
    );
    if (value !== null && value !== "") return value;
  }
  return null;
}

/** The year named anywhere in the subject, for a body that dates without one. */
function yearFromSubject(subject: string): number | undefined {
  const m = /\b(20\d{2})\b/.exec(subject);
  return m ? Number(m[1]) : undefined;
}

export function templateMatches(template: LodgingTemplate, haystack: string): boolean {
  const text = haystack.toLowerCase();
  const has = (needle: string): boolean => text.includes(needle.toLowerCase());
  return template.match.markers.every(has) && template.match.anchors.some(has);
}

/**
 * Read a document with one declarative template, or decline it.
 *
 * Declining is a result: `required` names what the reader must find, and a
 * template that matched the sender but cannot produce a stay returns null so
 * the document falls through to the next reader — rather than proposing a
 * booking with a name and no dates, which a human accepts by habit.
 */
export function applyLodgingTemplate(
  template: LodgingTemplate,
  subject: string,
  body: string
): ParsedLodgingBooking | null {
  const haystack = `${subject}\n${body}`;
  if (!templateMatches(template, haystack)) return null;

  const subjectYear = yearFromSubject(subject);
  const read: Partial<Record<keyof LodgingFieldRules, string | number>> = {};
  for (const [field, rule] of Object.entries(template.fields) as Array<
    [keyof LodgingFieldRules, FieldRule]
  >) {
    const value = readField(haystack, rule, subjectYear);
    if (value !== null) read[field] = value;
  }

  for (const field of template.required) {
    if (read[field] === undefined) return null;
  }

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
  if (Date.parse(checkOut) < Date.parse(checkIn) && template.fields.checkOut?.yearFrom) {
    const [y, rest] = [checkOut.slice(0, 4), checkOut.slice(4)];
    checkOut = `${Number(y) + 1}${rest}`;
  }
  // Still inconsistent means the document was not understood. Declining is
  // the result; a stay that ends before it starts would be proposed to the
  // user as fact, and the import's own date guard would then reject the row.
  if (Date.parse(checkOut) < Date.parse(checkIn)) return null;

  const nights = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / DAY_MS);

  const currency = str("currency") as LodgingCurrency | null;
  const totalPrice = num("totalPrice");
  const pricePerNight = num("pricePerNight");
  // The same guard the commit applies: an amount whose unit the document
  // never stated is not a price, and writing it against a default currency
  // states something the sender did not.
  const priced = currency !== null;

  const missing: string[] = [];
  const note = (field: string, value: unknown): void => {
    if (value === null) missing.push(field);
  };
  note("city", str("city"));
  note("totalPrice", priced ? totalPrice : null);
  note("confirmationNumber", str("confirmationNumber"));

  return {
    hotelName: str("hotelName") ?? "",
    checkIn,
    checkOut,
    nights,
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
    type: template.classify?.type ?? null,
    chainName: template.classify?.chainName ?? null,
    confirmationNumber: str("confirmationNumber"),
    parserTemplate: template.name,
    // Deliberately below the two Booking.com figures (80 / 95). These readers
    // are younger and measured against a handful of mails each; the number
    // should say that until the corpus says otherwise.
    parserConfidence: missing.length === 0 ? 75 : 65,
    missing,
  };
}
