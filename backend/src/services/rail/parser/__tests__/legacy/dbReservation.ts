// PARITY REFERENCE ONLY (plan 2026-10-09 P4b): a compiled-in Deutsche Bahn reader the v2
// templates in the template repository's rail/ replaced. Production reads the templates.

import { dbBookingReference, isDeutscheBahnDocument, parseDbConfirmation } from "./dbConfirmation";
import { parseDbOnlineTicket } from "./dbOnlineTicket";
import { travelClassOf } from "../../ticketText";
import type { ParsedRailBooking, ParsedRailLeg } from "../../types";

/**
 * A DB seat reservation booked AFTER the ticket (forgejo#203): a document of
 * its own that names trains, stations and seats but sells no ride. Read as a
 * ticket it would create a second journey for a ride already in the logbook,
 * so it is recognised first and its legs only ever ATTACH a coach and seat to
 * journeys that exist (`../reservationMatch.ts`).
 *
 * HYPOTHESIS, all of it: no real DB reservation document is in the repository
 * or in any corpus this was measured on. The layouts assumed are the two DB
 * already prints for tickets, with a reservation's own wording around them —
 *
 *  - the PDF: a title line "Sitzplatzreservierung" / "Reservierung" /
 *    "Online-Reservierung", the sentence that it is valid only with a ticket,
 *    and the Online-Ticket's itinerary table ("Ihre Reiseverbindung und
 *    Reservierung …", row-wise or the 2024 column-wise extraction) whose
 *    product line carries "Wg. 12, Pl. 133";
 *  - the mail: the 2020s "Buchungsbestätigung" whose only Leistung is
 *    "Sitzplatzreservierung", with "Wagen 12, Platz 133" under the ride.
 *
 * Whatever the first real sample shows, the rule that must survive is the
 * conservative one: a document that also sells a FARE (a "Fahrkarte" title, a
 * Flexpreis/Sparpreis line, "(Einfache Fahrt)") is a ticket, even when it
 * mentions a reservation — that is the ticket-with-seat every booking carries.
 */

/** A reservation's own words — any one of them marks the document. */
const RESERVATION_MARKERS: readonly RegExp[] = [
  /^(?:Online-)?(?:Sitzplatz)?[Rr]eservierung\s*$/m,
  /^Sitzplatzreservierung\b/m,
  /(?:gilt|g(?:ü|ue)ltig)\s+nur\s+(?:in\s+Verbindung\s+)?mit\s+(?:einer|einem)\s+g(?:ü|ue)ltigen\s+Fahr(?:karte|schein|ausweis)/i,
];

/** What only a ticket prints: a fare. One of these makes the document a ticket. */
const FARE_MARKERS: readonly RegExp[] = [
  /^(?:[A-Z]{1,5}(?:\/[A-Z]{1,5})?\s+)?Fahrkarte\s*$/m,
  /^Online-Ticket\s*$/m,
  /\((?:Einfache Fahrt|Hin- und R(?:ü|ue)ckfahrt)\)/,
  /^(?:Flexpreis|(?:Super )?Sparpreis|Normalpreis|Einzelfahrkarte|Deutschland-Ticket)\b/m,
];

export function isDbReservationDocument(text: string): boolean {
  return (
    isDeutscheBahnDocument(text) &&
    RESERVATION_MARKERS.some((re) => re.test(text)) &&
    !FARE_MARKERS.some((re) => re.test(text))
  );
}

/** "Wg. 12, Pl. 133" (the PDF) or "Wagen 12, Platz 133" / "Plätze 61 62" (the mail). */
const SEAT_LINE =
  /(?:Wg\.|Wagen)\s*([\w-]+),\s*(?:Pl\.|Pl(?:ä|ae)tze|Platz)\s*(\d+(?:\s+\d+)*)(?=\s*(?:,|$))/m;

function seatOf(text: string): Pick<ParsedRailLeg, "coach" | "seat"> {
  const match = SEAT_LINE.exec(text);
  return match
    ? { coach: match[1], seat: match[2].trim().replace(/\s+/g, " ") }
    : { coach: null, seat: null };
}

const VON_LINE = /^\s*von\s+.+?,\s*\d{1,2}\.\d{1,2}\.\d{4}\s+\d{1,2}:\d{2}\s*Uhr/im;

/**
 * The mail prints each ride as a "von … / nach …" pair; the seat stands in the
 * ride's block, before the next "von". The blocks are paired with the legs by
 * position, which is sound only while there are as many as there are legs —
 * otherwise no seat is given to any of them rather than one to the wrong ride.
 */
function withMailSeats(text: string, legs: ParsedRailLeg[]): ParsedRailLeg[] {
  const blocks = text.split(new RegExp(`(?=${VON_LINE.source})`, "im")).slice(1);
  if (blocks.length !== legs.length) return legs;
  return legs.map((leg, i) => ({ ...leg, ...seatOf(blocks[i]) }));
}

export function parseDbReservation(text: string): ParsedRailBooking | null {
  if (!isDbReservationDocument(text)) return null;
  const table = parseDbOnlineTicket(text);
  const mail = table ? null : parseDbConfirmation(text);
  const legs = table ? table.legs : mail ? withMailSeats(text, mail.legs) : [];
  if (legs.length === 0) return null;
  return {
    bookingReference: dbBookingReference(text),
    travelClass: travelClassOf(/^(?:Klasse\b.*|Sitzplatzreservierung.*)$/m.exec(text)?.[0] ?? ""),
    tariff: null,
    // A reservation fee is not the price of the ride it is attached to.
    price: null,
    currency: null,
    operator: "Deutsche Bahn",
    legs,
    source: "db-reservation",
    documentKind: "reservation",
  };
}
