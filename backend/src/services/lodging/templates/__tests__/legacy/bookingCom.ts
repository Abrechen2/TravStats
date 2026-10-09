// PARITY REFERENCE ONLY (plan 2026-10-09 P4b): the compiled-in Booking.com reader the v2
// template lodging/bookingcom.json replaced. Production reads the template; tests compare
// the two. Its generic parts (types, German dates, currency symbols, the address split)
// stayed in production: `lodging/parsedLodgingBooking.ts`, `v2/addressParts.ts`.
import { parseAmount as parseMoney } from "../../../documentTotal";
import { isCurrencyCode } from "../../../../../shared/currencies";
import {
  CURRENCY_SYMBOLS,
  parseGermanDate,
  parseLage,
  type LodgingCurrency,
  type ParsedLodgingBooking,
} from "../../../parsedLodgingBooking";

const TEMPLATE_NAME = "booking.com";

/**
 * A confirmation says "Bestätigungsnummer:"; a CHANGED booking says
 * "Reservierungsnummer" and no colon.
 *
 * Measured 2026-09-17 (forgejo#122): of the twelve lodging mails the template
 * path reads nothing from, one is a Booking.com mail the template would parse
 * perfectly — "Ihre geänderte Buchung in der Unterkunft …". Same brand, same
 * inline layout, same `Anreise`/`Abreise`/`Ihre Buchung`/`Gesamtpreis` lines;
 * only the number's label differs. That is the one kind of mail a user most
 * needs read, because the stay already exists and the dates have moved.
 *
 * "Buchungsnummer" stays out on purpose — that is what a direct hotel booking
 * says, and those must fall through rather than be read by a Booking.com
 * template. The brand check below is what actually keeps them out, but the
 * label list should not invite them either.
 */
const CONFIRMATION_RE = /(?:Bestätigungs|Reservierungs)nummer:?\s*‌?\s*(\d{6,})/;

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

/**
 * Every label Booking.com puts on a line of its own in the stacked layout.
 * Used only as a STOP list: a bare label may never be read as another label's
 * value. Without it, a confirmation that omits a field entirely would report
 * the following label as that field's content — a plausible-looking wrong
 * value, which is worse than the honest gap the parser already handles.
 */
const KNOWN_LABELS = new Set([
  "Anreise",
  "Abreise",
  "Ihre Buchung",
  "Sie haben gebucht für",
  "Lage",
  "Telefon",
  "Kontakt",
  "Stornierungsbedingungen",
  "Stornierungsgebühren",
  "Preisangaben",
  "Gesamtpreis",
  "Buchungsinformationen",
  "Zahlungsangaben",
  // Only a changed booking carries these four, and they sit directly above
  // "Ihre Buchung" — a stacked read of that label must not return one of them.
  "Reservierungsnummer",
  "PIN-Code",
  "Gebucht von",
  "Ihre Änderungen",
]);

/**
 * Booking.com ships the same confirmation in TWO layouts, and both are in the
 * wild right now:
 *
 *   inline   "Anreise\tMittwoch, 26. Juni 2024 (ab 15:00)"
 *   stacked  "Anreise"  /  "Mittwoch, 26. Juni 2024 (ab 15:00)"
 *
 * Measured against 95 real confirmations on 2026-08-13: 71 inline, 22 stacked
 * (the remaining 2 are direct hotel bookings, correctly not our business). The
 * stacked ones ALL fell through to the LLM — with Ollama off, that means the
 * user got manual entry for a mail the template could read perfectly well.
 *
 * Inline keeps priority; the stacked read only happens when the label owns its
 * line, and only when the next non-empty line is not itself a label.
 */
function findValue(lines: string[], label: string): string | null {
  const inline = new RegExp(`^${label}[\\s\\u00a0]+(.+)$`);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(inline);
    if (m) return m[1].trim();

    if (lines[i] !== label) continue;
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      const next = lines[j];
      if (next === "") continue;
      return KNOWN_LABELS.has(next) ? null : next;
    }
  }
  return null;
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
  const inline = /^Ihre Buchung[\s]+(\d+)\s+N(?:acht|ächte)\s*,\s*(.+)$/;
  // Stacked layout (see findValue): "Ihre Buchung" alone, "2 Nächte, 1 Zimmer"
  // on the next line. The shape check does the disambiguating here — the
  // unrelated "Ihre Buchung wird mit Booking.com bezahlt" line cannot produce
  // a "<N> Nacht(e), <room>" follower, so no label stop-list is needed.
  const value = /^(\d+)\s+N(?:acht|ächte)\s*,\s*(.+)$/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(inline);
    if (m) return { nights: Number(m[1]), room: m[2].trim() };

    if (lines[i] !== "Ihre Buchung") continue;
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      if (lines[j] === "") continue;
      const stacked = lines[j].match(value);
      if (stacked) return { nights: Number(stacked[1]), room: stacked[2].trim() };
      break;
    }
  }
  return { nights: null, room: null };
}

/**
 * "€ 1.234,50" -> 1234.5 · "CHF 292,83" -> 292.83 · "NOK 3.380" -> 3380 ·
 * "US$628,70" -> 628.7 · "S$ 1.324,90" -> 1324.9.
 *
 * The three-letter branch is validated against ISO-4217 rather than a list, so
 * a booking in a currency nobody anticipated still yields its price. The check
 * matters: it is what keeps a line like "TEL 1.234,50" from being read as an
 * amount in the imaginary currency TEL.
 */
function parseAmount(line: string): { amount: number; currency: LodgingCurrency } | null {
  // The symbol alternative comes first so "US$" is read as a symbol rather
  // than as the (non-existent) code "US".
  const m = line.match(/^([A-Z]{1,2}\$|[€$£¥]|[A-Z]{3})\s*([\d.,]+)$/);
  if (!m) return null;
  const token = m[1];
  const currency = CURRENCY_SYMBOLS[token] ?? (isCurrencyCode(token) ? token : null);
  if (!currency) return null;
  // The shared money reader, not a German-only replace: stripping every dot
  // as a grouping mark read "US$ 135.87" as 13587 dollars and "EUR 1,234.50"
  // as 1.2345 — both with `missing: []`, both accepted as a clean template
  // hit (AUD-052). A currency says nothing about which separator the
  // printer used for the decimals.
  const numeric = parseMoney(m[2]);
  if (numeric === null) return null;
  return { amount: numeric, currency };
}

/**
 * The literal word "Gesamtpreis" also appears mid-sentence in the cancellation
 * prose ("… des Gesamtpreises …"), so we anchor on a line that is EXACTLY the
 * label and take the next non-empty line as the amount.
 *
 * Booking.com labels the same figure "Preis" in some confirmations and
 * "Gesamtpreis" in others — 9 of the owner's 95 samples used the short form and
 * silently lost their total (measured 2026-08-13). Both are accepted; the
 * exact-line anchor keeps the prose out either way.
 */
const TOTAL_LABELS = new Set(["Gesamtpreis", "Preis"]);

function findTotal(lines: string[]): { amount: number; currency: LodgingCurrency } | null {
  for (let i = 0; i < lines.length; i++) {
    if (!TOTAL_LABELS.has(lines[i])) continue;
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
  if (m) return m[1].trim();
  // A changed booking names the property in prose instead: "Ihre geänderte
  // Buchung in der Unterkunft City Premiere Hotel Apartments". The body
  // fallback cannot help there — that mail puts the name on the SAME line as
  // the property link, so the line after it is the hotel's name in Arabic.
  const changed = subject.match(/in der Unterkunft\s+(.+)$/i);
  return changed ? changed[1].trim() : null;
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
  body: string
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
        (24 * 60 * 60 * 1000)
    )
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
    // The Booking.com template does not read these three yet; the LLM path
    // does. Null keeps the shape honest rather than inventing a default.
    pricePerNight: null,
    board: null,
    guests: null,
    type: null,
    chainName: null,
    currency: total?.currency ?? null,
    confirmationNumber: confirmation ? confirmation[1] : null,
    parserTemplate: TEMPLATE_NAME,
    parserConfidence: missing.length === 0 ? 95 : 80,
    missing,
  };
}
