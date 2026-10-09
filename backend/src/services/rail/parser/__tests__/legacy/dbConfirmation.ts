// PARITY REFERENCE ONLY (plan 2026-10-09 P4b): a compiled-in Deutsche Bahn reader the v2
// templates in the template repository's rail/ replaced. Production reads the templates.

import {
  amountOf,
  cleanStationName,
  clockTime,
  currencyOf,
  germanDate,
  travelClassOf,
  trainTokenIn,
  wallClock,
} from "../../ticketText";
import type { ParsedRailBooking, ParsedRailLeg } from "../../types";

/**
 * Deutsche Bahn's booking MAILS, three generations, each read only where its
 * own layout proves itself. Measured against a private corpus of DB mails
 * from 2006 to 2025 (counts in the corpus test, never contents):
 *
 *  - 2020s "Buchungsbestätigung": `von X, dd.mm.yyyy hh:mm Uhr` / `nach Y, …`
 *    pairs under "Leistungen". One pair per ride; several are a connection.
 *  - 2010–2015 postal orders ("…stellen Ihnen die Fahrkarte per Post zu"):
 *    `dd.mm.yyyy: X hh:mm - Y hh:mm`, one line per direction — the whole
 *    journey, changes included, so no train number.
 *  - 2008 "Verbindungsauskunft zur Leistung": one line per train with
 *    `(ICE 870), Abfahrt X: hh:mm Uhr, …, Ankunft Y: hh:mm Uhr`.
 *
 * Only a mail that says it BOOKED something is read (`isDbBookingDocument`).
 *
 * Most bahn.de mails between 2007 and 2019 print NO itinerary at all — it
 * sits in the attached Online-Ticket PDF (`dbOnlineTicket.ts`) and the
 * calendar file (`icsCalendar.ts`). Such a mail yields its booking reference
 * and total here and its legs there.
 */

/** DB's own name on the document: the templates below trust nothing else. */
export function isDeutscheBahnDocument(text: string): boolean {
  return /Deutsche(n)? Bahn|bahn\.de|DB Fernverkehr|DB Vertrieb|DB Regio|DEUTSCHE BAHN/i.test(text);
}

/**
 * The sentence that makes a DB mail a BOOKING — every generation words it
 * differently. A delay alert names an order and prints an ab/an table, an
 * offer names an order and a total, and a loyalty newsletter names neither;
 * none of them says the ride was booked, and none of them may become one.
 */
const BOOKING_STATEMENT =
  /(wie folgt gebucht|Ihre Buchung (wurde|erfolgte|wird)|Ihre Bestellung (erfolgte|wird unter)|Eingang Ihrer Bestellung|vielen Dank f(ü|ue)r Ihre[nr]? (Online-Ticket-)?(Buchung|Fahrkartenkauf|Fahrkartenbestellung)|Auftragsbest(ä|ae)tigung zum Auftrag)/i;

export function isDbBookingDocument(text: string): boolean {
  return isDeutscheBahnDocument(text) && BOOKING_STATEMENT.test(text.replace(/\s+/g, " "));
}

/** "Auftragsnummer 123456789012", "Auftragsnummer: Q7X2KT", "(Auftrag ZZ12AB)". */
export function dbBookingReference(text: string): string | null {
  const match =
    /Auftragsnummer:?\s+([A-Z0-9]{6,14})\b/.exec(text) ??
    /Auftrag(?:sbestätigung zum Auftrag)?\s+([A-Z0-9]{6,14})\b/.exec(text);
  return match ? match[1] : null;
}

/**
 * The amount DB labels as the total. "Gesamtpreis Reservierungen" is a
 * subtotal and is skipped; so is any amount not labelled at all.
 */
export function dbTotal(text: string): { price: number; currency: string } | null {
  // A sentence may wrap anywhere; the labelled line may not.
  const flat = text.replace(/\s+/g, " ");
  const candidates: Array<RegExpExecArray | null> = [
    /Gesamtpreis(?:es)? dieser Reise in Höhe von ([\d.,]+) ?(EUR|€|CHF)/.exec(flat),
    /^\s*Gesamtpreis:\s*([\d.,]+)\s*(EUR|€|CHF)/m.exec(text),
    /Den Betrag in Höhe von ([\d.,]+) ?(EUR|€|CHF)/.exec(flat),
  ];
  for (const match of candidates) {
    if (!match) continue;
    const price = amountOf(match[1]);
    const currency = currencyOf(match[2]);
    if (price !== null && currency) return { price, currency };
  }
  return null;
}

const lines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

/** The next day, for an arrival clock that reads earlier than its departure. */
function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** An arrival printed as a clock only: on the departure's day, or the next. */
export function arrivalAfter(day: string, depTime: string, arrTime: string | null): string | null {
  if (!arrTime) return null;
  return wallClock(arrTime < depTime ? nextDay(day) : day, arrTime);
}

function directionOf(line: string): ParsedRailLeg["direction"] | undefined {
  if (/^Hinfahrt\b/i.test(line)) return "outbound";
  if (/^R(ü|ue)ckfahrt\b/i.test(line)) return "return";
  return undefined;
}

const emptyLeg = {
  trainCategory: null,
  trainNumber: null,
  coach: null,
  seat: null,
} as const;

const VON = /^von\s+(.+?),\s*(\d{1,2}\.\d{1,2}\.\d{4})\s+(\d{1,2}:\d{2})\s*Uhr\b(.*)$/i;
const NACH = /^nach\s+(.+?),\s*(\d{1,2}\.\d{1,2}\.\d{4})\s+(\d{1,2}:\d{2})\s*Uhr\b(.*)$/i;
/** How far apart a "von" line and its "nach" line may sit. */
const MAX_GAP = 3;

/**
 * The 2020s layout. A train number is taken only from the two leg lines and
 * what stands between them — never from elsewhere in the mail — because the
 * short-distance ticket this was measured on prints none, and a train named in
 * the small print is not the train this leg is on. (That long-distance mails
 * print `ICE 578` in exactly this place is a HYPOTHESIS: no such sample exists.)
 */
export function parseDbConfirmation(text: string): ParsedRailBooking | null {
  if (!isDbBookingDocument(text)) return null;
  const all = lines(text);
  const legs: ParsedRailLeg[] = [];
  let direction: ParsedRailLeg["direction"] = null;
  let tariffLine: string | null = null;

  for (let i = 0; i < all.length; i++) {
    direction = directionOf(all[i]) ?? direction;
    const von = VON.exec(all[i]);
    if (!von) continue;
    const nachIndex = all.slice(i + 1, i + 1 + MAX_GAP).findIndex((l) => NACH.test(l));
    if (nachIndex < 0) continue;
    const nach = NACH.exec(all[i + 1 + nachIndex])!;
    const between = [von[4], ...all.slice(i + 1, i + 1 + nachIndex), nach[4]].join(" ");
    const train = trainTokenIn(between);
    const depDay = germanDate(von[2]);
    const arrDay = germanDate(nach[2]);
    const departureLocal = wallClock(depDay, clockTime(von[3]));
    if (!departureLocal) continue;
    if (legs.length === 0 && i > 0 && /Klasse|fahrkarte|preis|ticket/i.test(all[i - 1])) {
      tariffLine = all[i - 1];
    }
    legs.push({
      ...emptyLeg,
      depStationName: cleanStationName(von[1]),
      arrStationName: cleanStationName(nach[1]),
      departureLocal,
      arrivalLocal: wallClock(arrDay, clockTime(nach[3])),
      trainCategory: train?.category ?? null,
      trainNumber: train?.number ?? null,
      direction,
    });
    i += 1 + nachIndex;
  }
  if (legs.length === 0) return null;

  const total = dbTotal(text);
  return {
    bookingReference: dbBookingReference(text),
    travelClass: travelClassOf(tariffLine ?? "") ?? travelClassOf(text),
    // "Einzelfahrkarte Kurzstrecke, 2. Klasse" → the fare, without the class.
    tariff: tariffLine ? tariffLine.replace(/,?\s*[12]\.\s*Klasse.*$/i, "").trim() || null : null,
    price: total?.price ?? null,
    currency: total?.currency ?? null,
    operator: null,
    legs,
    source: "db-confirmation",
  };
}

const REISEDATEN =
  /^(\d{1,2}\.\d{1,2}\.\d{4}):\s+(.+?)\s+(\d{1,2}:\d{2})\s+-\s+(.+?)\s+(\d{1,2}:\d{2})$/;

/**
 * The postal orders of 2010–2015: under "Ihre Verbindung:" or "Reisedaten:",
 * one `dd.mm.yyyy: X hh:mm - Y hh:mm` line per direction. Each line is the
 * whole journey including changes, so it becomes one leg without a train —
 * which is what the document says, and nothing more.
 */
export function parseDbPostalOrder(text: string): ParsedRailBooking | null {
  if (!isDbBookingDocument(text)) return null;
  const legs: ParsedRailLeg[] = [];
  for (const line of lines(text)) {
    const m = REISEDATEN.exec(line);
    if (!m) continue;
    const day = germanDate(m[1]);
    const depTime = clockTime(m[3]);
    const departureLocal = wallClock(day, depTime);
    if (!day || !depTime || !departureLocal) continue;
    legs.push({
      ...emptyLeg,
      depStationName: cleanStationName(m[2]),
      arrStationName: cleanStationName(m[4]),
      departureLocal,
      arrivalLocal: arrivalAfter(day, depTime, clockTime(m[5])),
      direction: null,
    });
  }
  if (legs.length === 0) return null;
  const total = dbTotal(text);
  const fareLine = lines(text).find((l) => /^(Einfache Fahrt|Hin- und Rückfahrt)\b/.test(l));
  return {
    bookingReference: dbBookingReference(text),
    travelClass: travelClassOf(fareLine ?? text),
    tariff: fareLine ? fareLine.split(",").slice(0, 2).join(",").trim() || null : null,
    price: total?.price ?? null,
    currency: total?.currency ?? null,
    operator: null,
    legs,
    source: "db-postal-order",
  };
}

const CONNECTION_ROW =
  /^.+?,\s*(\d{1,2}\.\d{1,2}\.\d{2,4}),\s*\(([^)]+)\),\s*Abfahrt\s+(.+?):\s*(\d{1,2}:\d{2})\s*Uhr(?:,\s*Gleis[^,]*)?,\s*Ankunft\s+(.+?):\s*(\d{1,2}:\d{2})\s*Uhr/;

/**
 * The 2008 "Verbindungsauskunft": one row per train, walks ("(Fußweg)") have
 * no Abfahrt and are skipped. The station names come from "Abfahrt X:" and
 * "Ankunft Y:", never from the "A-B" head of the row, which cannot be split
 * ("Kiel Hbf-Hamburg Hbf Gl.5-8").
 */
export function parseDbConnectionInfo(text: string): ParsedRailBooking | null {
  if (!isDbBookingDocument(text) || !/Verbindungsauskunft/.test(text)) return null;
  const legs: ParsedRailLeg[] = [];
  let direction: ParsedRailLeg["direction"] = null;
  for (const line of lines(text)) {
    direction = directionOf(line) ?? direction;
    const m = CONNECTION_ROW.exec(line);
    if (!m) continue;
    const day = germanDate(m[1]);
    const depTime = clockTime(m[4]);
    const departureLocal = wallClock(day, depTime);
    if (!day || !depTime || !departureLocal) continue;
    const train = trainTokenIn(m[2]);
    legs.push({
      ...emptyLeg,
      depStationName: cleanStationName(m[3]),
      arrStationName: cleanStationName(m[5]),
      departureLocal,
      arrivalLocal: arrivalAfter(day, depTime, clockTime(m[6])),
      trainCategory: train?.category ?? null,
      trainNumber: train?.number ?? null,
      direction,
    });
  }
  if (legs.length === 0) return null;
  const total = dbTotal(text);
  return {
    bookingReference: dbBookingReference(text),
    travelClass: travelClassOf(text),
    tariff: null,
    price: total?.price ?? null,
    currency: total?.currency ?? null,
    operator: null,
    legs,
    source: "db-connection-info",
  };
}

/**
 * What a DB mail says about the ORDER when it prints no legs: the reference
 * and the total. Null when it names neither — then it is not an order mail.
 */
export function dbOrderFacts(
  text: string
): Pick<ParsedRailBooking, "bookingReference" | "price" | "currency" | "travelClass"> | null {
  if (!isDbBookingDocument(text)) return null;
  const bookingReference = dbBookingReference(text);
  const total = dbTotal(text);
  if (!bookingReference && !total) return null;
  return {
    bookingReference,
    price: total?.price ?? null,
    currency: total?.currency ?? null,
    travelClass: null,
  };
}
