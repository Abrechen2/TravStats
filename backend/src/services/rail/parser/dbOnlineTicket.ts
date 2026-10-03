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
 *
 * Since spring 2024 the same ticket extracts differently (measured on a
 * tester's tickets of 15.01.2024, old, and 19.04.2024, new): the header reads
 * "… Reservierung - Einfache Fahrt am 19.04.2024", and the table comes out of
 * the PDF column by column —
 *
 *   Köln Hbf
 *   Augsburg Hbf
 *   19.04.
 *   19.04.
 *   ab 19:55
 *   an 23:58
 *   5
 *   4
 *   ICE 615 1 Sitzplatz, Wg. 12, Pl. 133, …
 *
 * so a section that yields no row-wise leg is read as columns
 * (`legsOfColumns`), one block of columns per train. The columns are paired
 * by position, which is only sound while they are equally long: anything else
 * reads as nothing and goes to the model, rather than putting a time beside
 * the wrong station.
 */

const SECTION =
  /Ihre Reiseverbindung und Reservierung\s+(?:-\s+)?(Hinfahrt|R(?:ü|ue)ckfahrt|Einfache Fahrt)\s+am\s+(\d{1,2}\.\d{1,2}\.\d{4})/i;
const STOP = /^(.+?)\s+(\d{1,2})\.(\d{1,2})\.\s+(ab|an)\s+(\d{1,2}:\d{2})(?:\s+.*)?$/;
/** The product column: a category and a number ("ICE 1507", "S 8", "RE 8,"). */
const PRODUCT = /^([A-Za-z]{1,5})\s?(\d{1,6})\b/;
const RESERVATION = /Wg\.\s*([\w-]+),\s*Pl\.\s*([\d\s]+?)(?:,|$)/;
/** The 2024 layout's cells, each on a line of its own. */
const DATE_CELL = /^(\d{1,2})\.(\d{1,2})\.$/;
const TIME_CELL = /^(ab|an)\s+(\d{1,2}:\d{2})$/;
const TABLE_HEAD = /^Halt\s+Datum\s+Zeit/;
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

/** The run of rows from `start` that match `cell`. */
function cellRun(rows: string[], start: number, cell: RegExp): RegExpExecArray[] {
  const run: RegExpExecArray[] = [];
  for (let i = start; i < rows.length; i++) {
    const match = cell.exec(rows[i]);
    if (!match) break;
    run.push(match);
  }
  return run;
}

interface ColumnBlock {
  /** Index of the block's first station row. */
  start: number;
  names: string[];
  dates: RegExpExecArray[];
  times: RegExpExecArray[];
  /** Index of the first row after the block's times. */
  end: number;
}

/**
 * The 2024 extraction: per train, a column of stations, a column of dates, a
 * column of times, the platforms, then the product line —
 *
 *   Augsburg Hbf / Hannover Hbf / 14.02. / 14.02. / ab 08:47 / an 12:58 / 1 / 8
 *   ICE 1586 1 Sitzplatz, Wg. 24, Pl. 47, …
 *   Hannover Hbf / Bielefeld Hbf / 14.02. / 14.02. / ab 13:40 / an 14:39 / 11 / 4
 *   IC 2048 1 Sitzplatz, …
 *
 * — one such block per train (measured on a tester's ticket of 14.02.2025
 * with a change in Hannover; rc.5 assumed ONE block for the whole journey and
 * read only its first train). A block is found from its dates: a run of k
 * date cells has its k stations directly above and its k times directly
 * below. Stop i is station i on date i at time i, which is only sound while
 * the three are equally long and no block reaches into the one before it —
 * anything else reads as nothing and goes to the model.
 */
/** A platform ("5", "11 A-C"), a product line, or a reservation's wrapped tail. */
function isBlockTrailer(row: string): boolean {
  return (
    /^\d{1,3}(\s+[A-Z](-[A-Z])?)?$/.test(row) || PRODUCT.test(row) || /,|Res\.?\s?-?Nr/.test(row)
  );
}

function columnBlocks(body: string[]): ColumnBlock[] | null {
  const blocks: ColumnBlock[] = [];
  let i = 0;
  while (i < body.length) {
    if (!DATE_CELL.test(body[i])) {
      i++;
      continue;
    }
    const dates = cellRun(body, i, DATE_CELL);
    const times = cellRun(body, i + dates.length, TIME_CELL);
    const start = i - dates.length;
    const floor = blocks.length > 0 ? blocks[blocks.length - 1].end : 0;
    if (times.length !== dates.length || start < floor) return null;
    // What stands between the block before and this one's stations must be
    // that block's platforms, product and reservation — a row that is none
    // of these is a station that lost its date, and the pairing is off by one.
    if (!body.slice(floor, start).every((row) => blocks.length > 0 && isBlockTrailer(row))) {
      return null;
    }
    const end = i + dates.length + times.length;
    blocks.push({ start, names: body.slice(start, i), dates, times, end });
    i = end;
  }
  return blocks;
}

/**
 * A train is given to a block's legs only when the block prints exactly as
 * many product lines as it has legs — otherwise which train ran where is not
 * printed in an order this can prove, and the legs keep their times without one.
 */
function legsOfColumns(
  rows: string[],
  sectionDay: string,
  direction: ParsedRailLeg["direction"]
): ParsedRailLeg[] {
  const body = rows.filter((row) => !TABLE_HEAD.test(row));
  const blocks = columnBlocks(body);
  if (!blocks) return [];
  return blocks.flatMap((block, b) => {
    const stops = block.names.map(
      (name, i) =>
        `${name} ${block.dates[i][1]}.${block.dates[i][2]}. ${block.times[i][1]} ${block.times[i][2]}`
    );
    const legs = legsOfSection(stops, sectionDay, direction);
    const products = body
      .slice(block.end, b + 1 < blocks.length ? blocks[b + 1].start : body.length)
      .map(productOf)
      .filter((p): p is NonNullable<ReturnType<typeof productOf>> => p !== null);
    if (products.length !== legs.length) return legs;
    return legs.map((leg, i) => ({ ...leg, ...products[i] }));
  });
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
    const direction = /^R/i.test(section[1]) ? "return" : "outbound";
    const rowWise = legsOfSection(rows, sectionDay, direction);
    legs.push(...(rowWise.length > 0 ? rowWise : legsOfColumns(rows, sectionDay, direction)));
  }
  if (legs.length === 0) return null;

  // "Summe 122,50€ …" until 2024, "Gesamtpreis 91,60 €." since.
  const sum =
    /^Summe\s+([\d.,]+)\s*€/m.exec(text) ?? /^Gesamtpreis\s+(\d[\d.]*,\d{2})\s*€/m.exec(text);
  const price = sum ? amountOf(sum[1]) : null;
  const tariff = /^(.+?\((?:Einfache Fahrt|Hin- und Rückfahrt)\))\s*$/m.exec(text);
  return {
    bookingReference: dbBookingReference(text),
    travelClass: travelClassOf(/^Klasse\b.*$/m.exec(text)?.[0] ?? ""),
    tariff: tariff ? tariff[1].trim() : null,
    price,
    currency: price !== null ? "EUR" : null,
    // `isDbOnlineTicket` has already said whose ticket this is; the 2024
    // layout no longer prints "DB Fernverkehr AG", the one line the labelled
    // facts would have read the operator from.
    operator: "Deutsche Bahn",
    legs,
    source: "db-online-ticket",
  };
}
