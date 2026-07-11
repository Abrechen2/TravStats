import { CURRENCIES } from "../../schemas/lodging";

export type LodgingCurrency = (typeof CURRENCIES)[number];

export interface ParsedLodgingBooking {
  hotelName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  roomCategory: string | null;
  address: string | null;
  postcode: string | null;
  city: string | null;
  country: string | null;
  totalPrice: number | null;
  currency: LodgingCurrency | null;
  confirmationNumber: string | null;
  parserTemplate: string;
  parserConfidence: number;
  missing: string[];
}

const TEMPLATE_NAME = "booking.com";

const GERMAN_MONTHS: Record<string, number> = {
  januar: 1,
  februar: 2,
  märz: 3,
  maerz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12,
};

const CURRENCY_SYMBOLS: Record<string, LodgingCurrency> = {
  "€": "EUR",
  EUR: "EUR",
  CHF: "CHF",
  $: "USD",
  USD: "USD",
  "£": "GBP",
  GBP: "GBP",
};

const CONFIRMATION_RE = /Bestätigungsnummer:\s*‌?\s*(\d{6,})/;

function toLines(body: string): string[] {
  return body
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim());
}

/** A Booking.com confirmation always carries the brand link AND a numeric
 *  "Bestätigungsnummer:". A direct hotel booking (the 7th sample) says
 *  "Buchungsnummer" and never links booking.com — it must fall through to the
 *  LLM, not be mangled by this template. */
export function isBookingComConfirmation(subject: string | undefined, body: string): boolean {
  const haystack = `${subject ?? ""}\n${body}`;
  return /booking\.com/i.test(haystack) && CONFIRMATION_RE.test(haystack);
}

function findValue(lines: string[], label: string): string | null {
  const re = new RegExp(`^${label}[\\s\\u00a0]+(.+)$`);
  for (const line of lines) {
    const m = line.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

/** "Donnerstag, 4. Juni 2026 (ab 14:00)" -> "2026-06-04". */
function parseGermanDate(value: string | null): string | null {
  if (!value) return null;
  const m = value.match(/(\d{1,2})\.\s*([A-Za-zÄÖÜäöüß]+)\s+(\d{4})/);
  if (!m) return null;
  const month = GERMAN_MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const day = Number(m[1]);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * "3 Nächte, Deluxe Zimmer mit Kingsize-Bett" / "1 Nacht, Comfort Zimmer".
 * The label "Ihre Buchung" is not unique — some confirmations also contain an
 * unrelated line "Ihre Buchung wird mit Booking.com bezahlt" earlier in the
 * document — so this scans every line starting with the label and returns the
 * first one that actually matches the "<N> Nacht(e), <room>" shape, instead
 * of taking whichever line happens to come first.
 */
function findBookingLine(lines: string[]): { nights: number | null; room: string | null } {
  const re = /^Ihre Buchung[\s]+(\d+)\s+N(?:acht|ächte)\s*,\s*(.+)$/;
  for (const line of lines) {
    const m = line.match(re);
    if (m) return { nights: Number(m[1]), room: m[2].trim() };
  }
  return { nights: null, room: null };
}

interface AddressParts {
  address: string | null;
  postcode: string | null;
  city: string | null;
  country: string | null;
}

/**
 * "Zilverstraat 6, 2718 RL Zoetermeer, Niederlande"
 * "Anhalter Str. 2, Friedrichshain-Kreuzberg, 10963 Berlin, Deutschland"
 * The last segment is the country; the LAST segment that starts with a postal
 * code carries the city. Everything before it is the street (which may include
 * a district, as in the Berlin sample — preserved rather than dropped).
 */
function parseLage(raw: string | null): AddressParts {
  if (!raw) return { address: null, postcode: null, city: null, country: null };
  const segments = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return { address: null, postcode: null, city: null, country: null };

  const country = segments.length > 1 ? segments[segments.length - 1] : null;
  const rest = country ? segments.slice(0, -1) : segments;

  // NL codes look like "2718 RL"; DE/AT/CH are 4-5 digits.
  const postcodeRe = /^(\d{4,5}(?:\s+[A-Z]{2})?)\s+(.+)$/;
  for (let i = rest.length - 1; i >= 0; i--) {
    const m = rest[i].match(postcodeRe);
    if (m) {
      const address = rest.slice(0, i).join(", ");
      return {
        address: address.length > 0 ? address : null,
        postcode: m[1],
        city: m[2],
        country,
      };
    }
  }
  return {
    address: rest.slice(0, -1).join(", ") || null,
    postcode: null,
    city: rest[rest.length - 1] ?? null,
    country,
  };
}

/** "€ 1.234,50" -> 1234.5 · "CHF 292,83" -> 292.83 · "€ 112" -> 112. */
function parseAmount(line: string): { amount: number; currency: LodgingCurrency } | null {
  const m = line.match(/^(€|CHF|EUR|USD|GBP|\$|£)\s*([\d.,]+)$/);
  if (!m) return null;
  const currency = CURRENCY_SYMBOLS[m[1]];
  if (!currency) return null;
  const numeric = Number(m[2].replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(numeric)) return null;
  return { amount: numeric, currency };
}

/**
 * The literal word "Gesamtpreis" also appears mid-sentence in the cancellation
 * prose ("… des Gesamtpreises …"), so we anchor on a line that is EXACTLY
 * "Gesamtpreis" and take the next non-empty line as the amount.
 */
function findTotal(lines: string[]): { amount: number; currency: LodgingCurrency } | null {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== "Gesamtpreis") continue;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      if (lines[j] === "") continue;
      const parsed = parseAmount(lines[j]);
      if (parsed) return parsed;
      break;
    }
  }
  return null;
}

/** Subject: "🛄 Danke! Ihre Buchung ist bestätigt: NH Ludwigsburg". */
function hotelNameFromSubject(subject: string | undefined): string | null {
  if (!subject) return null;
  const m = subject.match(/bestätigt:\s*(.+)$/i);
  return m ? m[1].trim() : null;
}

/** Fallback: the first non-empty line after the property's booking.com link. */
function hotelNameFromBody(lines: string[]): string | null {
  const linkIndex = lines.findIndex((l) => /booking\.com\/hotel\//i.test(l));
  if (linkIndex < 0) return null;
  for (let i = linkIndex + 1; i < Math.min(linkIndex + 5, lines.length); i++) {
    if (lines[i].length > 0) return lines[i];
  }
  return null;
}

export function parseBookingComEmail(
  subject: string | undefined,
  body: string,
): ParsedLodgingBooking | null {
  if (!isBookingComConfirmation(subject, body)) return null;

  const lines = toLines(body);
  const hotelName = hotelNameFromSubject(subject) ?? hotelNameFromBody(lines);
  if (!hotelName) return null;

  const checkIn = parseGermanDate(findValue(lines, "Anreise"));
  const checkOut = parseGermanDate(findValue(lines, "Abreise"));
  if (!checkIn || !checkOut) return null;

  const { nights, room } = findBookingLine(lines);
  const lage = parseLage(findValue(lines, "Lage"));
  const total = findTotal(lines);
  const confirmation = `${subject ?? ""}\n${body}`.match(CONFIRMATION_RE);

  const nightsFromDates = Math.max(
    0,
    Math.round(
      (Date.parse(`${checkOut}T00:00:00.000Z`) - Date.parse(`${checkIn}T00:00:00.000Z`)) /
        (24 * 60 * 60 * 1000),
    ),
  );

  const missing: string[] = [];
  if (!room) missing.push("roomCategory");
  if (!lage.city) missing.push("city");
  if (!total) missing.push("totalPrice");
  if (!confirmation) missing.push("confirmationNumber");

  return {
    hotelName,
    checkIn,
    checkOut,
    // The printed night count is authoritative; the date delta is the fallback.
    nights: nights ?? nightsFromDates,
    roomCategory: room,
    address: lage.address,
    postcode: lage.postcode,
    city: lage.city,
    country: lage.country,
    totalPrice: total?.amount ?? null,
    currency: total?.currency ?? null,
    confirmationNumber: confirmation ? confirmation[1] : null,
    parserTemplate: TEMPLATE_NAME,
    parserConfidence: missing.length === 0 ? 95 : 80,
    missing,
  };
}
