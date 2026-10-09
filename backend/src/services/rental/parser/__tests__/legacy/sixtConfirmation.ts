// PARITY REFERENCE ONLY (plan 2026-10-09 P4b): the compiled-in reader this provider's
// v2 template file replaced. Production reads the template; tests compare the two.

import { cleanLines, currencyOf, monthNumber, parseAmount, wallClock } from "../../textLines";
import type { ParsedRentalConfirmation } from "../../types";
import type { RENTAL_INCLUSIONS } from "../../../../../schemas/rental";

/**
 * Today's Sixt booking confirmation (spec 2026-10-01-rental-domain-design
 * §1.4), both layouts measured on the owner's corpus:
 *
 * - A (2024–2025, `e.sixt.com`): "Abholung: <station>" and then its date line.
 * - B (2026, `sixt.com`): the date line first, then "Abholung in <station>".
 *
 * Both print the time as "<Wochentag>, <dd>. <Mon>, <yyyy> um <HH:MM>" with no
 * zone — the station's wall clock. No class code, no address: the station is
 * a name ("<City> Flughafen"), placed later by `rentalCandidates.ts`. Values
 * the mail does not print are null; nothing is inferred from a near miss.
 *
 * The 2009–2010 Sixt layout (data only in a PDF) is NOT read here — the spec
 * gives it no template.
 */

const SIXT_SENDER = /\bsixt\b/i;
const CONFIRMED = /(ihre buchung (ist |bei .{1,80} ist )?bestätigt|IHRE BUCHUNG IST BESTÄTIGT)/i;
const NUMBER_IN_SUBJECT = /#\s*(\d{10})\b/;
const NUMBER_LABEL = /^Buchung(?:snummer)?:\s*(\d{10})\b/i;
const DATE_LINE =
  /^(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag),\s*(\d{1,2})\.\s*([A-Za-zÄÖÜäöü]{3,9})\.?,?\s*(\d{4})\s+um\s+(\d{1,2}):(\d{2})/;
const PICKUP_STATION = /^Abholung(?::| in)\s+(.+)$/;
const RETURN_STATION = /^Rückgabe(?::| in)\s+(.+)$/;
const PRICE =
  /^(Im Voraus bezahlter Gesamtbetrag|Mietpreis im Voraus bezahlt|Gesamtsumme bei Abholung)\s+([\d.,]+)\s*(€|EUR)\s*$/i;
const COUNTRY_TAG = /\|country:([A-Z]{2})\|/;
// The French airport phrase in the legal footer of layout A ("Aéroport de
// <City>") names the airport city in the catalogue's spelling where the German
// station name may not; "Flughafen X" is NOT read — "Flughafen Team" is how
// the layout B signature continues.
const AIRPORT_PHRASE = /A[ée]roport de ([A-ZÀ-Ý][a-zà-ÿ]+)/g;

/** Whether a document is a Sixt booking confirmation this template reads. */
export function isSixtConfirmation(text: string, from?: string | null): boolean {
  const sender = from ? SIXT_SENDER.test(from) : /\bSIXT\b/.test(text);
  return sender && CONFIRMED.test(text);
}

function dateOf(line: string): string | null {
  const m = DATE_LINE.exec(line);
  if (!m) return null;
  const month = monthNumber(m[2]);
  if (month === null) return null;
  return wallClock(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]));
}

/**
 * Pickup and return as printed. Each station line is paired with the date
 * line beside it — after it in layout A, before it in layout B — so the
 * reader holds whichever order the mail uses.
 */
function endsOf(
  lines: string[]
): { pickup: ParsedRentalConfirmation["pickup"]; ret: ParsedRentalConfirmation["return"] } | null {
  const find = (pattern: RegExp): { name: string; local: string } | null => {
    const i = lines.findIndex((l) => pattern.test(l));
    if (i < 0) return null;
    const name = (pattern.exec(lines[i]) as RegExpExecArray)[1].trim();
    // "Abholung in X" (layout B) follows its date; "Abholung: X" (A) precedes it.
    const before = / in /.test(lines[i].slice(0, 12));
    const local = before ? dateOf(lines[i - 1] ?? "") : dateOf(lines[i + 1] ?? "");
    return local ? { name, local } : null;
  };
  const pickup = find(PICKUP_STATION);
  const ret = find(RETURN_STATION);
  if (!pickup || !ret) return null;
  return {
    pickup: { stationName: pickup.name, local: pickup.local },
    ret: { stationName: ret.name, local: ret.local },
  };
}

/** The line after a heading — the car group block prints the model there. */
function after(lines: string[], heading: RegExp): string | null {
  const i = lines.findIndex((l) => heading.test(l));
  return i >= 0 && lines[i + 1] ? lines[i + 1] : null;
}

/** "Peugeot 208, Opel Corsa oder ähnlich" → "Peugeot 208, Opel Corsa"; the promise, not a car. */
function exampleOf(lines: string[]): string | null {
  const line = after(lines, /^(Fahrzeugkategorie|Fahrzeuggruppe)$/i);
  const m = line ? /^(.+?)\s+oder ähnlich$/i.exec(line) : null;
  return m ? m[1].trim() : null;
}

type Inclusion = (typeof RENTAL_INCLUSIONS)[number];

/**
 * What the mail lists as INCLUDED — never what it merely offers ("Hinzufügen",
 * "(Nicht enthalten)", an upsell paragraph). The excess wording ("Selbstbeteiligung
 * … bei Unfall oder Diebstahl" in the included list) is collision + theft cover.
 */
function inclusionsOf(lines: string[]): Inclusion[] {
  // Only the "already in your booking" block counts: the same protection
  // names appear above it as offers ("Schutzpaket buchen"), measured on a mail
  // that booked no protection at all.
  const start = lines.findIndex((l) =>
    /^(Ihre Buchungsübersicht|Extras, die bereits in Ihrer Buchung enthalten sind)$/i.test(l)
  );
  if (start < 0) return [];
  const found = new Set<Inclusion>();
  for (const line of lines.slice(start + 1)) {
    if (PRICE.test(line) || /^Informationen zur Zahlung$/i.test(line)) break;
    if (/^24\/7 Pannenhilfe$/i.test(line)) found.add("roadside");
    if (/^Selbstbeteiligung bis(?: zu)? [\d.]+ ?EUR (bei|für)/i.test(line)) {
      found.add("cdw");
      found.add("tp");
    }
  }
  return [...found];
}

function placeHints(text: string): ParsedRentalConfirmation["placeHints"] {
  const words = new Set<string>();
  for (const m of text.matchAll(AIRPORT_PHRASE)) words.add(m[1].trim());
  return { country: COUNTRY_TAG.exec(text)?.[1] ?? null, airportWords: [...words] };
}

/** Reads a Sixt confirmation; null when the document is not one this template knows. */
export function parseSixtConfirmation(
  text: string,
  from?: string | null
): ParsedRentalConfirmation | null {
  if (!isSixtConfirmation(text, from)) return null;
  const lines = cleanLines(text);
  const number =
    lines.map((l) => NUMBER_LABEL.exec(l)?.[1]).find(Boolean) ?? NUMBER_IN_SUBJECT.exec(text)?.[1];
  const ends = endsOf(lines);
  if (!number || !ends) return null;

  const priceLine = lines.map((l) => PRICE.exec(l)).find(Boolean) ?? null;
  const price = priceLine ? parseAmount(priceLine[2]) : null;
  return {
    kind: "confirmation",
    source: "sixt-confirmation",
    provider: "Sixt",
    confirmationNumber: number,
    pickup: ends.pickup,
    return: ends.ret,
    vehicleClass: null,
    vehicleExample: exampleOf(lines),
    acrissCode: null,
    paymentTiming: priceLine
      ? /bei Abholung/i.test(priceLine[1])
        ? "pay_at_counter"
        : "prepaid"
      : null,
    price,
    currency: priceLine && price !== null ? currencyOf(priceLine[3]) : null,
    mileagePolicy: lines.some((l) => /^Unbegrenzte Kilometer$/i.test(l)) ? "unlimited" : null,
    inclusions: inclusionsOf(lines),
    placeHints: placeHints(text),
  };
}
