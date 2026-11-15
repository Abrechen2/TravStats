/**
 * TripIt: the API/JSON document and the iCal feed.
 *
 * SYNTHETIC FORMAT — built from TripIt's documented object model (the v1 API's
 * `AirObject` / `LodgingObject` / `RailObject`, each with `Segment` entries and
 * `{date, time, timezone, utc_offset}` date-times) and from the iCal feed
 * TripIt publishes. No real account export is in the repository. The iCal feed
 * carries prose in its summaries, so only flights ("Flight ... (LH 400)" with
 * the airports named in the location or description) and stays ("Stay at ...")
 * are read; every other event is rejected as `unsupported_event` rather than
 * guessed at.
 *
 * TripIt's JSON (an XML heritage) writes a single child as an object and
 * several as an array — `asArray` takes both.
 */

import { z } from "zod";
import { isValidZone } from "../../shared/time/zonedParts";
import { wallClockToInstant } from "../rides/rideEnds";
import { TooManyRecordsError } from "../checkinImport/types";
import { MAX_APP_RECORDS, emptyParse, type AppParse } from "./types";

const asArray = <T>(v: T | T[] | undefined | null): T[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];

const text = z.union([z.string(), z.number()]).transform((v) => String(v).trim());
const optText = text.optional();

const dateTime = z
  .object({ date: optText, time: optText, timezone: optText, utc_offset: optText })
  .passthrough();

const airSegment = z
  .object({
    StartDateTime: dateTime.optional(),
    EndDateTime: dateTime.optional(),
    start_airport_code: optText,
    end_airport_code: optText,
    marketing_airline: optText,
    marketing_airline_code: optText,
    marketing_flight_number: optText,
    operating_airline: optText,
    operating_airline_code: optText,
    operating_flight_number: optText,
    aircraft_display_name: optText,
    aircraft: optText,
    seats: optText,
    service_class: optText,
  })
  .passthrough();
const airObject = z
  .object({
    Segment: z.union([airSegment, z.array(airSegment)]).optional(),
    supplier_conf_num: optText,
    notes: optText,
  })
  .passthrough();

const railSegment = z
  .object({
    StartDateTime: dateTime.optional(),
    EndDateTime: dateTime.optional(),
    start_station_name: optText,
    end_station_name: optText,
    carrier_name: optText,
    train_number: optText,
    train_type: optText,
  })
  .passthrough();
const railObject = z
  .object({ Segment: z.union([railSegment, z.array(railSegment)]).optional(), notes: optText })
  .passthrough();

const lodgingObject = z
  .object({
    supplier_name: optText,
    StartDateTime: dateTime.optional(),
    EndDateTime: dateTime.optional(),
    Address: z
      .object({
        address: optText,
        city: optText,
        country: optText,
        latitude: optText,
        longitude: optText,
      })
      .passthrough()
      .optional(),
    notes: optText,
  })
  .passthrough();

type DateTimeObj = z.infer<typeof dateTime>;
const wallOf = (d: DateTimeObj | undefined): { wall?: string; day?: string } => {
  if (!d?.date || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return {};
  const clock = /^(\d{2}):(\d{2})/.exec(d.time ?? "");
  return clock ? { wall: `${d.date}T${clock[1]}:${clock[2]}`, day: d.date } : { day: d.date };
};

/** TripIt object types that carry a booking this app has no importer sheet for. */
const knownUnsupported =
  /^(Car|Transport|Cruise|Activity|Restaurant|Map|Directions|Note|Parking)Object$/;

export function parseTripitJson(raw: string): AppParse {
  const out = emptyParse();
  let doc: unknown;
  try {
    doc = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    out.rejects.push({ sheet: "other", row: 1, label: "#1", reason: "invalid_file" });
    return out;
  }
  // A list of documents (one per page of the API) is read as one.
  const docs = (Array.isArray(doc) ? doc : [doc]).filter(
    (d): d is Record<string, unknown> => !!d && typeof d === "object" && !Array.isArray(d)
  );
  const root: Record<string, unknown> = {};
  for (const d of docs) {
    for (const [k, v] of Object.entries(d)) {
      if (/Object$/.test(k))
        root[k] = [...asArray(root[k] as unknown[]), ...asArray(v as unknown[])];
    }
  }
  const keys = Object.keys(root);
  if (!keys.some((k) => /Object$/.test(k))) {
    out.rejects.push({ sheet: "other", row: 1, label: "#1", reason: "invalid_file" });
    return out;
  }
  const bad = (sheet: "flights" | "rail" | "lodging", row: number) =>
    out.rejects.push({ sheet, row, label: `#${row}`, reason: "invalid_record" });

  let flightNo = 0;
  for (const obj of asArray(root.AirObject)) {
    const parsed = airObject.safeParse(obj);
    if (!parsed.success) {
      bad("flights", ++flightNo);
      continue;
    }
    for (const seg of asArray(parsed.data.Segment)) {
      flightNo += 1;
      const code = seg.marketing_airline_code ?? seg.operating_airline_code;
      const num = seg.marketing_flight_number ?? seg.operating_flight_number;
      const flightNumber = num
        ? code && !num.startsWith(code)
          ? `${code}${num}`
          : num
        : undefined;
      const dep = wallOf(seg.StartDateTime);
      const arr = wallOf(seg.EndDateTime);
      out.flights.push({
        row: flightNo,
        label: [flightNumber, [seg.start_airport_code, seg.end_airport_code].join("-")]
          .filter(Boolean)
          .join(" "),
        airline: seg.marketing_airline ?? seg.operating_airline ?? code,
        flightNumber,
        depIata: seg.start_airport_code?.toUpperCase(),
        arrIata: seg.end_airport_code?.toUpperCase(),
        depLocal: dep.wall,
        arrLocal: arr.wall,
        dateOnly: dep.wall ? undefined : dep.day,
        aircraft: seg.aircraft_display_name ?? seg.aircraft,
        seat: seg.seats,
        seatClass: seg.service_class?.toLowerCase().replace(/ /g, "_"),
        bookingReference: parsed.data.supplier_conf_num,
        notes: parsed.data.notes,
      });
    }
  }

  let railNo = 0;
  for (const obj of asArray(root.RailObject)) {
    const parsed = railObject.safeParse(obj);
    if (!parsed.success) {
      bad("rail", ++railNo);
      continue;
    }
    for (const seg of asArray(parsed.data.Segment)) {
      railNo += 1;
      const dep = wallOf(seg.StartDateTime);
      const arr = wallOf(seg.EndDateTime);
      out.rides.push({
        row: railNo,
        label:
          [seg.start_station_name, seg.end_station_name].filter(Boolean).join(" → ") ||
          `#${railNo}`,
        mode: "rail",
        category: seg.train_type,
        trainNumber: seg.train_number,
        lineName: seg.carrier_name,
        notes: parsed.data.notes,
        dep: { name: seg.start_station_name, time: dep.wall ? { wall: dep.wall } : undefined },
        arr: { name: seg.end_station_name, time: arr.wall ? { wall: arr.wall } : undefined },
      });
    }
  }

  let lodgingNo = 0;
  const lodgingSeen = new Set<string>();
  for (const obj of asArray(root.LodgingObject)) {
    lodgingNo += 1;
    const parsed = lodgingObject.safeParse(obj);
    const name = parsed.success ? parsed.data.supplier_name : undefined;
    if (!parsed.success || !name) {
      out.rejects.push({
        sheet: "lodging",
        row: lodgingNo,
        label: name ?? `#${lodgingNo}`,
        reason: parsed.success ? "missing_name" : "invalid_record",
      });
      continue;
    }
    const a = parsed.data.Address;
    const checkIn = wallOf(parsed.data.StartDateTime).day;
    const checkOut = wallOf(parsed.data.EndDateTime).day;
    if (!checkIn || !checkOut) {
      out.rejects.push({
        sheet: "lodgingStays",
        row: lodgingNo,
        label: name,
        reason: "invalid_date",
      });
      continue;
    }
    // One lodging per hotel in the file; every booking of it is a stay.
    const key = `${name}|${a?.city ?? ""}`.toLowerCase();
    if (!lodgingSeen.has(key)) {
      lodgingSeen.add(key);
      out.lodging.push({
        row: lodgingNo,
        label: name,
        cells: {
          name,
          address: a?.address ?? "",
          city: a?.city ?? "",
          country: a?.country ?? "",
          lat: a?.latitude ?? "",
          lon: a?.longitude ?? "",
          notes: parsed.data.notes ?? "",
        },
      });
    }
    out.lodgingStays.push({
      row: lodgingNo,
      label: name,
      cells: { lodgingId: name, checkIn, checkOut },
    });
  }

  // Booking kinds with no importer sheet: shown with their kind, never dropped.
  for (const key of keys.filter((k) => knownUnsupported.test(k))) {
    asArray(root[key] as unknown[]).forEach((_, i) =>
      out.rejects.push({
        sheet: "other",
        row: i + 1,
        label: `${key.replace(/Object$/, "")} #${i + 1}`,
        reason: `unsupported_object:${key.replace(/Object$/, "").toLowerCase()}`,
      })
    );
  }
  if (flightNo + railNo + lodgingNo > MAX_APP_RECORDS)
    throw new TooManyRecordsError(MAX_APP_RECORDS);
  return out;
}

// ------------------------------------------------------------------- iCal

interface IcsProp {
  value: string;
  params: Record<string, string>;
}
type IcsEvent = Record<string, IcsProp>;

function unescapeIcs(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

/** RFC 5545: fold continuation lines, split `NAME;PARAM=x:value`. */
function readEvents(raw: string): IcsEvent[] {
  const lines = raw
    .replace(/^\uFEFF/, "")
    .replace(/\r?\n[ \t]/g, "")
    .split(/\r?\n/);
  const events: IcsEvent[] = [];
  let current: IcsEvent | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") current = {};
    else if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
    } else if (current) {
      const colon = line.indexOf(":");
      if (colon < 1) continue;
      const [name, ...paramParts] = line.slice(0, colon).split(";");
      const params: Record<string, string> = {};
      for (const p of paramParts) {
        const [k, v] = p.split("=");
        if (k && v) params[k.toUpperCase()] = v;
      }
      current[name.toUpperCase()] = { value: unescapeIcs(line.slice(colon + 1)), params };
    }
  }
  return events;
}

/** `20260301T080000Z` / `;TZID=…:20260301T080000` / `;VALUE=DATE:20260301`. */
function icsTime(p: IcsProp | undefined): {
  instant?: Date;
  wall?: string;
  day?: string;
  badZone?: true;
} {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(p?.value ?? "");
  if (!m) return {};
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] === undefined) return { day };
  if (m[7]) return { instant: new Date(`${day}T${m[4]}:${m[5]}:${m[6] ?? "00"}Z`), day };
  const wall = `${day}T${m[4]}:${m[5]}`;
  // A TZID names the zone the clock was written in: that fixes the instant,
  // whatever zone the airport is in. An unknown one is refused, not guessed.
  const tzid = p?.params.TZID;
  if (tzid) {
    if (!isValidZone(tzid)) return { badZone: true, day };
    return { instant: wallClockToInstant(wall, tzid), day };
  }
  return { wall, day };
}

const FLIGHT_CODE = /\b([A-Z][A-Z0-9]|[A-Z0-9][A-Z])\s?(\d{1,4})\b/;

export function parseTripitIcs(raw: string): AppParse {
  const out = emptyParse();
  if (!/BEGIN:VCALENDAR/.test(raw)) {
    out.rejects.push({ sheet: "other", row: 1, label: "#1", reason: "invalid_file" });
    return out;
  }
  const events = readEvents(raw);
  if (events.length > MAX_APP_RECORDS) throw new TooManyRecordsError(MAX_APP_RECORDS);
  const lodgingSeen = new Set<string>();
  events.forEach((ev, index) => {
    const row = index + 1;
    const summary = ev.SUMMARY?.value.trim() ?? "";
    const label = summary.slice(0, 80) || `#${row}`;
    const where = `${ev.LOCATION?.value ?? ""}\n${ev.DESCRIPTION?.value ?? ""}`;
    const start = icsTime(ev.DTSTART);
    const end = icsTime(ev.DTEND);

    const stay = /^(?:stay at|hotel:?|lodging:?)\s*(.+)$/i.exec(summary);
    if (stay) {
      const name = stay[1].trim();
      if (!start.day || !end.day) {
        out.rejects.push({ sheet: "lodgingStays", row, label, reason: "invalid_date" });
        return;
      }
      if (!lodgingSeen.has(name.toLowerCase())) {
        lodgingSeen.add(name.toLowerCase());
        out.lodging.push({ row, label: name, cells: { name, address: ev.LOCATION?.value ?? "" } });
      }
      out.lodgingStays.push({
        row,
        label: name,
        cells: { lodgingId: name, checkIn: start.day, checkOut: end.day },
      });
      return;
    }

    if (/flight/i.test(summary)) {
      const code = FLIGHT_CODE.exec(summary.replace(/^[^()]*flight[^()]*/i, "") || summary);
      const iata =
        [...where.matchAll(/\(([A-Z]{3})\)/g)].map((m) => m[1]).slice(0, 2).length === 2
          ? [...where.matchAll(/\(([A-Z]{3})\)/g)].map((m) => m[1])
          : (/\b([A-Z]{3})\s+(?:to|→|-)\s+([A-Z]{3})\b/.exec(where)?.slice(1) ?? []);
      if (iata.length < 2) {
        out.rejects.push({ sheet: "flights", row, label, reason: "missing_airport_code" });
        return;
      }
      if (start.badZone || end.badZone) {
        out.rejects.push({ sheet: "flights", row, label, reason: "invalid_date" });
        return;
      }
      out.flights.push({
        row,
        label,
        airline: code?.[1],
        flightNumber: code ? `${code[1]}${code[2]}` : undefined,
        depIata: iata[0],
        arrIata: iata[1],
        depLocal: start.wall,
        arrLocal: end.wall,
        depInstant: start.instant,
        arrInstant: end.instant,
        dateOnly: start.wall || start.instant ? undefined : start.day,
      });
      return;
    }
    out.rejects.push({ sheet: "other", row, label, reason: "unsupported_event" });
  });
  return out;
}

export function parseTripit(raw: string): AppParse {
  return /^\s*BEGIN:VCALENDAR/i.test(raw.replace(/^\uFEFF/, ""))
    ? parseTripitIcs(raw)
    : parseTripitJson(raw);
}
