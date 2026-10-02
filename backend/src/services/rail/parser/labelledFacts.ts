import { amountOf, currencyOf, travelClassOf } from "./ticketText";
import type { ParsedRailBooking } from "./types";

/**
 * The booking-level facts a rail document states under a LABEL — operator,
 * booking number, class, total — read deterministically from the text.
 *
 * forgejo#161: a plain confirmation ("Deutsche Bahn, ICE 578 / Buchungsnummer:
 * QARAIL20261002 / 2. Klasse / Gesamtpreis: 59,90 EUR") came back with its
 * legs but without any of those four. No template knows that layout, so the
 * model read it — and the model never returns an operator at all, and drops a
 * reference or a total whenever its answer misses a field the check needs.
 * What the document labels plainly does not need a model's sample.
 *
 * These only FILL a gap (`withLabelledFacts`): a value a template or the model
 * already read, and the text proved, is never replaced. Each reader abstains
 * — null — when the label is absent or ambiguous.
 */

/** Operators a ticket names, each with the one spelling it is stored under. */
const OPERATORS: ReadonlyArray<[RegExp, string]> = [
  [/(?<![\p{L}])(?:Deutsche\s+Bahn|DB\s+Fernverkehr|DB\s+Regio)(?![\p{L}])/u, "Deutsche Bahn"],
  [/(?<![\p{L}])(?:ÖBB|OEBB|Österreichische\s+Bundesbahnen)(?![\p{L}])/u, "ÖBB"],
  [/(?<![\p{L}])(?:SBB|Schweizerische\s+Bundesbahnen)(?![\p{L}])/u, "SBB"],
  [/(?<![\p{L}])SNCF(?![\p{L}])/u, "SNCF"],
  [/(?<![\p{L}])Trenitalia(?![\p{L}])/u, "Trenitalia"],
  [/(?<![\p{L}])Eurostar(?![\p{L}])/u, "Eurostar"],
  [/(?<![\p{L}])FlixTrain(?![\p{L}])/iu, "FlixTrain"],
  [/(?<![\p{L}])WESTbahn(?![\p{L}])/iu, "WESTbahn"],
  [/(?<![\p{L}])Renfe(?![\p{L}])/iu, "Renfe"],
];

/** The one operator the text names; null when it names none — or several. */
export function operatorIn(text: string): string | null {
  const named = new Set(OPERATORS.filter(([re]) => re.test(text)).map(([, name]) => name));
  return named.size === 1 ? [...named][0] : null;
}

const REFERENCE_LABEL =
  /\b(?:Buchungsnummer|Auftragsnummer|Buchungscode|Reservierungsnummer|Bestellnummer|Booking\s+(?:reference|number|code)|Order\s+(?:number|reference)|Reference\s+number|Confirmation\s+number|PNR)\b\s*(?:Nr\.?|No\.?)?\s*[:#]?\s*([A-Za-z0-9-]+)/i;

/** A reference is upper-case letters, digits and dashes — never a word of prose. */
const REFERENCE_SHAPE = /^[A-Z0-9][A-Z0-9-]{4,29}$/;

/** The labelled booking or order number, copied verbatim. */
export function referenceIn(text: string): string | null {
  const match = REFERENCE_LABEL.exec(text);
  return match && REFERENCE_SHAPE.test(match[1]) ? match[1] : null;
}

const CURRENCY_TOKEN = "EUR|€|CHF|GBP|£";
const TOTAL_LABEL = new RegExp(
  String.raw`\b(?:Gesamtpreis|Gesamtbetrag|Gesamtsumme|Endpreis|Summe|Grand\s+total|Total\s+price|Total\s+amount|Amount\s+paid|Total)\b\s*:?\s*(?:(${CURRENCY_TOKEN})\s*)?(\d[\d.,]*\d|\d)\s*(${CURRENCY_TOKEN})?`,
  "i"
);

/** The labelled total and its currency — both, or neither. */
export function totalIn(text: string): { price: number; currency: string } | null {
  const match = TOTAL_LABEL.exec(text);
  if (!match) return null;
  const currency = currencyOf(match[1] ?? match[3] ?? "");
  const price = amountOf(match[2]);
  return currency && price !== null ? { price, currency } : null;
}

/** `booking` with each missing labelled fact filled from `text`. */
export function withLabelledFacts(booking: ParsedRailBooking, text: string): ParsedRailBooking {
  const total = booking.price === null ? totalIn(text) : null;
  return {
    ...booking,
    operator: booking.operator ?? operatorIn(text),
    bookingReference: booking.bookingReference ?? referenceIn(text),
    travelClass: booking.travelClass ?? travelClassOf(text),
    ...(total ? { price: total.price, currency: total.currency } : {}),
  };
}
