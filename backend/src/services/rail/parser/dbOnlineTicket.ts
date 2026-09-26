import { dbBookingReference, isDeutscheBahnDocument } from "./dbConfirmation";
import {
  amountOf,
  cleanStationName,
  clockTime,
  germanDate,
  isoDay,
  travelClassOf,
  wallClock,
} from "./ticketText";
import type { ParsedRailBooking, ParsedRailLeg } from "./types";

/**
 * DB's "Online-Ticket" PDF, the one layout that carries the itinerary per
 * TRAIN — stable from 2010 to 2019 in the corpus it was measured on:
 *
 *   Ihre Reiseverbindung und Reservierung Hinfahrt am 02.05.2016
 *   Halt Datum Zeit Gleis Fahrt Reservierung        ("Produkte" since 2016)
 *   Osnabrück Hbf 02.05. ab 07:12 3
 *   Bremen Hbf 02.05. an 08:05 11
 *   IC 2217 1 Sitzplatz, Wg. 7, Pl. 45, 1 Fenster, …
 *
 * An "ab" row opens a leg, the next "an" row closes it, and the product line
 * that follows names the train and — when reserved — the coach and seat. It
 * arrives attached to the booking mail, or on its own through /parse-pdf.
 */

const SECTION =
  /Ihre Reiseverbindung und Reservierung\s+(Hinfahrt|R(?:ü|ue)ckfahrt)\s+am\s+(\d{1,2}\.\d{1,2}\.\d{4})/i;
const STOP = /^(.+?)\s+(\d{1,2})\.(\d{1,2})\.\s+(ab|an)\s+(\d{1,2}:\d{2})(?:\s+.*)?$/;
/** The product column: a category and a number ("ICE 1507", "S 8", "RE 8,"). */
const PRODUCT = /^([A-Za-z]{1,5})\s?(\d{1,6})\b/;
const RESERVATION = /Wg\.\s*([\w-]+),\s*Pl\.\s*([\d\s]+?)(?:,|$)/;
const SECTION_END = /^(Hinweise|Wichtige Nutzungshinweise|Bitte informieren Sie sich)/;

export function isDbOnlineTicket(text: string): boolean {
  return isDeutscheBahnDocument(text) && SECTION.test(text) && /Halt\s+Datum\s+Zeit/.test(text);
}

/** The row's year: the section's, or the next one for a January row in a December trip. */
function rowDay(day: number, month: number, sectionDay: string): string | null {
  const year = Number(sectionDay.slice(0, 4));
  const sectionMonth = Number(sectionDay.slice(5, 7));
  return isoDay(day, month, month < sectionMonth - 6 ? year + 1 : year);
}

interface OpenLeg {
  name: string;
  departureLocal: string;
}

function productOf(
  line: string
): Pick<ParsedRailLeg, "trainCategory" | "trainNumber" | "coach" | "seat"> | null {
  const product = PRODUCT.exec(line);
  if (!product) return null;
  const reservation = RESERVATION.exec(line);
  return {
    trainCategory: product[1],
    trainNumber: product[2],
    coach: reservation ? reservation[1] : null,
    seat: reservation ? reservation[2].trim().replace(/\s+/g, " ") : null,
  };
}

function legsOfSection(
  rows: string[],
  sectionDay: string,
  direction: ParsedRailLeg["direction"]
): ParsedRailLeg[] {
  const legs: ParsedRailLeg[] = [];
  let open: OpenLeg | null = null;
  for (const row of rows) {
    const stop = STOP.exec(row);
    if (stop) {
      const day = rowDay(Number(stop[2]), Number(stop[3]), sectionDay);
      const time = wallClock(day, clockTime(stop[5]));
      if (!time) continue;
      if (stop[4] === "ab") {
        open = { name: cleanStationName(stop[1]), departureLocal: time };
      } else if (open) {
        legs.push({
          depStationName: open.name,
          arrStationName: cleanStationName(stop[1]),
          departureLocal: open.departureLocal,
          arrivalLocal: time,
          trainCategory: null,
          trainNumber: null,
          coach: null,
          seat: null,
          direction,
        });
        open = null;
      }
      continue;
    }
    // A product line belongs to the leg just closed, and only its first line
    // names the train; "Nichtraucher, Handy" is its continuation.
    const last = legs[legs.length - 1];
    if (last && last.trainNumber === null && last.trainCategory === null) {
      const product = productOf(row);
      if (product) legs[legs.length - 1] = { ...last, ...product };
    }
  }
  return legs;
}

export function parseDbOnlineTicket(text: string): ParsedRailBooking | null {
  if (!isDbOnlineTicket(text)) return null;
  const all = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const legs: ParsedRailLeg[] = [];
  for (let i = 0; i < all.length; i++) {
    const section = SECTION.exec(all[i]);
    if (!section) continue;
    const sectionDay = germanDate(section[2]);
    if (!sectionDay) continue;
    const rows: string[] = [];
    for (let j = i + 1; j < all.length; j++) {
      if (SECTION.test(all[j]) || SECTION_END.test(all[j])) break;
      rows.push(all[j]);
    }
    const direction = /^Hin/i.test(section[1]) ? "outbound" : "return";
    legs.push(...legsOfSection(rows, sectionDay, direction));
  }
  if (legs.length === 0) return null;

  const sum = /^Summe\s+([\d.,]+)\s*€/m.exec(text);
  const price = sum ? amountOf(sum[1]) : null;
  const tariff = /^(.+?\((?:Einfache Fahrt|Hin- und Rückfahrt)\))\s*$/m.exec(text);
  return {
    bookingReference: dbBookingReference(text),
    travelClass: travelClassOf(/^Klasse:.*$/m.exec(text)?.[0] ?? ""),
    tariff: tariff ? tariff[1].trim() : null,
    price,
    currency: price !== null ? "EUR" : null,
    operator: null,
    legs,
    source: "db-online-ticket",
  };
}
