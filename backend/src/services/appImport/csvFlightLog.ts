/**
 * Flight-log CSV exports: JetLovers, FlightMemory, Logmyflight.
 *
 * SYNTHETIC FORMAT — no real export of these three apps is available here.
 * They share one shape (a flight diary: date, flight, from, to, times, aircraft,
 * seat), so one reader serves all three; the source only chooses how an
 * ambiguous `03/04/2026` is read (FlightMemory is German: day first;
 * Logmyflight is US-centric: month first; JetLovers writes ISO dates).
 * Headers are matched case-insensitively against several spellings, German
 * ones included, and a file with none of the key columns is `invalid_file`.
 */

import { parse } from "csv-parse/sync";
import {
  MAX_APP_RECORDS,
  emptyParse,
  type AppParse,
  type AppSource,
  type FlightRecord,
} from "./types";
import { TooManyRecordsError } from "../checkinImport/types";

type Field =
  | "date"
  | "dep"
  | "arr"
  | "depTime"
  | "arrTime"
  | "flightNumber"
  | "airline"
  | "from"
  | "to"
  | "aircraft"
  | "registration"
  | "seat"
  | "seatClass"
  | "reason"
  | "note";

const COLUMNS: Record<Field, readonly string[]> = {
  date: ["date", "flight date", "datum", "departure date"],
  dep: ["departure", "departure datetime", "departure time (local)", "std"],
  arr: ["arrival", "arrival datetime", "arrival time (local)", "sta"],
  depTime: [
    "dep time",
    "dep. time",
    "departure time",
    "off block",
    "abflug",
    "abflugzeit",
    "abflug zeit",
  ],
  arrTime: [
    "arr time",
    "arr. time",
    "arrival time",
    "on block",
    "ankunft",
    "ankunftszeit",
    "ankunft zeit",
  ],
  flightNumber: [
    "flight",
    "flight number",
    "flight no",
    "flight no.",
    "flightnumber",
    "flug",
    "flugnummer",
  ],
  airline: ["airline", "carrier", "fluggesellschaft", "airline name"],
  from: ["from", "origin", "departure airport", "dep airport", "von", "from (iata)"],
  to: ["to", "destination", "arrival airport", "arr airport", "nach", "to (iata)"],
  aircraft: ["aircraft", "aircraft type", "type", "flugzeug", "flugzeugtyp"],
  registration: ["registration", "reg", "reg.", "tail number", "kennzeichen"],
  seat: ["seat", "seat number", "sitz", "sitzplatz"],
  seatClass: ["class", "cabin", "cabin class", "klasse"],
  reason: ["reason", "purpose", "trip type", "flugzweck", "grund"],
  note: ["note", "notes", "comment", "comments", "remarks", "notiz", "bemerkung"],
};

type DateOrder = "dmy" | "mdy";
const DATE_ORDER: Record<string, DateOrder> = {
  flightmemory: "dmy",
  logmyflight: "mdy",
  jetlovers: "dmy",
};

const pad = (n: string | number): string => String(n).padStart(2, "0");

/** A day cell -> `YYYY-MM-DD`, or null when it is not a date. */
export function dayOf(raw: string, order: DateOrder): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(raw);
  const dotted = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(raw);
  let y: string, m: string, d: string;
  if (iso) [, y, m, d] = iso;
  else if (dotted) {
    const [, a, b, year] = dotted;
    // A first part above 12 can only be the day, whatever the source's habit.
    const dayFirst = raw.includes(".") || +a > 12 || (order === "dmy" && +b <= 12);
    [d, m, y] = dayFirst ? [a, b, year] : [b, a, year];
  } else return null;
  const dt = new Date(Date.UTC(+y, +m - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d) {
    return null;
  }
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** `8:05`, `08:05`, `08:05:00`, `8:05 PM` -> `HH:mm`; null when it is not a time. */
export function clockOf(raw: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i.exec(raw.trim());
  if (!m) return null;
  let h = +m[1];
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0);
  }
  if (h > 23 || +m[2] > 59) return null;
  return `${pad(h)}:${m[2]}`;
}

/** `FRA`, `Frankfurt (FRA)`, `FRA/EDDF`, `EDDF (FRA)` -> `FRA`; undefined when no code is in it. */
export function iataIn(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const bracket = /\(([A-Za-z]{3})\)/.exec(raw);
  if (bracket) return bracket[1].toUpperCase();
  const token = raw
    .trim()
    .split(/[\s/,;-]+/)
    .find((t) => /^[A-Za-z]{3}$/.test(t));
  return token?.toUpperCase();
}

const CLASSES: Record<string, string> = {
  y: "economy",
  economy: "economy",
  eco: "economy",
  coach: "economy",
  w: "premium_economy",
  "premium economy": "premium_economy",
  premium_economy: "premium_economy",
  "premium eco": "premium_economy",
  c: "business",
  j: "business",
  business: "business",
  f: "first",
  first: "first",
};
const REASONS: Record<string, string> = {
  b: "business",
  business: "business",
  geschäftlich: "business",
  p: "private",
  private: "private",
  privat: "private",
  l: "private",
  leisure: "private",
  v: "vacation",
  vacation: "vacation",
  urlaub: "vacation",
};

/** The clock of a combined datetime (`2026-03-04T08:05`, `04.03.2026 8:05 PM`). */
const timePart = (v: string): string => v.slice(v.search(/[T ]/) + 1).trim();

const detectDelimiter = (text: string): string => {
  const head = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (c: string) => head.split(c).length;
  return count(";") > count(",") && count(";") >= count("\t")
    ? ";"
    : count("\t") > count(",")
      ? "\t"
      : ",";
};

export function parseFlightLogCsv(source: AppSource, text: string): AppParse {
  const out = emptyParse();
  const order = DATE_ORDER[source] ?? "dmy";
  let records: Array<Record<string, string>>;
  let header: string[] = [];
  try {
    records = parse(text.replace(/^\uFEFF/, ""), {
      columns: (h: string[]) => {
        header = h.map((x) => x.trim().toLowerCase());
        return header;
      },
      skip_empty_lines: true,
      relax_column_count: true,
      // One more than the cap: enough to know the file is too big.
      to: MAX_APP_RECORDS + 1,
      delimiter: detectDelimiter(text),
    });
  } catch {
    out.rejects.push({ sheet: "flights", row: 1, label: "#1", reason: "invalid_file" });
    return out;
  }
  if (records.length > MAX_APP_RECORDS) throw new TooManyRecordsError(MAX_APP_RECORDS);

  const has = (f: Field) => COLUMNS[f].some((n) => header.includes(n));
  if (!(has("from") && has("to") && (has("date") || has("dep")))) {
    out.rejects.push({ sheet: "flights", row: 1, label: "#1", reason: "invalid_file" });
    return out;
  }
  const pick = (r: Record<string, string>, f: Field): string | undefined => {
    for (const n of COLUMNS[f]) {
      const v = r[n]?.trim();
      if (v) return v;
    }
    return undefined;
  };

  records.forEach((r, index) => {
    const row = index + 2; // the header is line 1
    const flightNumber = pick(r, "flightNumber")?.replace(/\s+/g, "").toUpperCase();
    const fromRaw = pick(r, "from");
    const toRaw = pick(r, "to");
    const label =
      [flightNumber, [iataIn(fromRaw), iataIn(toRaw)].filter(Boolean).join("-")]
        .filter((x) => x && x !== "-")
        .join(" ") || `#${row}`;
    const reject = (reason: string) => out.rejects.push({ sheet: "flights", row, label, reason });

    const depIata = iataIn(fromRaw);
    const arrIata = iataIn(toRaw);
    if (!depIata || !arrIata) return reject("missing_airport_code");

    // The day, and the clocks. A combined datetime column wins over date + time.
    // "Departure" is a full datetime in one export and a bare clock in another.
    const hasDate = (v: string | undefined) => !!v && /\d{1,4}[-./]\d{1,2}[-./]\d{1,4}/.test(v);
    const rawDep = pick(r, "dep");
    const rawArr = pick(r, "arr");
    const combinedDep = hasDate(rawDep) ? rawDep : undefined;
    const depTimeCell = pick(r, "depTime") ?? (hasDate(rawDep) ? undefined : rawDep);
    const arrTimeCell = pick(r, "arrTime") ?? (hasDate(rawArr) ? undefined : rawArr);
    const combinedArr = hasDate(rawArr) ? rawArr : undefined;
    const dateCell = pick(r, "date") ?? combinedDep;
    const day = dateCell ? dayOf(dateCell, order) : null;
    if (!day) return reject("invalid_date");
    const depClock = clockOf(
      (combinedDep && /[T ]\d/.test(combinedDep) ? timePart(combinedDep) : depTimeCell) ?? ""
    );
    const arrCell = combinedArr && /[T ]\d/.test(combinedArr) ? combinedArr : undefined;
    const arrClock = clockOf((arrCell ? timePart(arrCell) : arrTimeCell) ?? "");
    // A time that is written but unreadable is refused, not read as "no time".
    const depText = combinedDep && /[T ]\d/.test(combinedDep) ? timePart(combinedDep) : depTimeCell;
    if (depText && !depClock) return reject("invalid_date");
    const arrText = arrCell ? timePart(arrCell) : arrTimeCell;
    if (arrText && !arrClock) return reject("invalid_date");

    const rec: FlightRecord = {
      row,
      label,
      airline: pick(r, "airline"),
      flightNumber,
      depIata,
      arrIata,
      aircraft: pick(r, "aircraft"),
      registration: pick(r, "registration")?.toUpperCase(),
      seat: pick(r, "seat"),
      seatClass: CLASSES[(pick(r, "seatClass") ?? "").toLowerCase()],
      category: REASONS[(pick(r, "reason") ?? "").toLowerCase()],
      notes: pick(r, "note"),
    };
    if (depClock) {
      rec.depLocal = `${day}T${depClock}`;
      if (arrClock) {
        // The log has the arrival's clock, not its date: an arrival clock at or
        // before the departure clock is the next day (a red-eye).
        const arrDay = arrCell ? dayOf(arrCell, order) : day;
        if (!arrDay) return reject("invalid_date");
        rec.arrLocal = `${arrDay}T${arrClock}`;
        // Only the zones can say whether it is the next day (NRT 17:00 -> LAX
        // 10:00 lands on the same date): `build.ts` moves it by whole days.
        rec.arrDayGuessed = !arrCell;
      }
    } else {
      rec.dateOnly = day;
    }
    out.flights.push(rec);
  });
  return out;
}
