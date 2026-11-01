/**
 * Träwelling export (CSV and JSON) -> rides.
 *
 * JSON: the status objects of Träwelling's export / API (`{data: [...]}` or a
 * bare array), each with a `train` (newer: `transport`) holding `origin` and
 * `destination` stops. CSV: one status per line; column names are matched
 * through alias lists because the CSV header has changed between versions.
 * A record that carries no two stations or no departure is a reject with a
 * code, not a silently shorter list.
 */

import { parse } from "csv-parse/sync";
import { modeFromTraewellingCategory } from "./modes";
import { timeFromText } from "./time";
import type { CheckinParse, CheckinRide, CheckinStop } from "./types";

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const t = String(v).trim();
  return t === "" ? undefined : t;
};
const num = (v: unknown): number | undefined => {
  const t = str(v);
  if (t === undefined) return undefined;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
};
const digits = (v: unknown): string | undefined => {
  const t = str(v);
  return t && /^\d{5,8}$/.test(t) ? t : undefined;
};

function labelOf(dep: CheckinStop, arr: CheckinStop, line?: string, row?: number): string {
  const route = [dep.name, arr.name].filter(Boolean).join(" → ");
  return [line, route].filter(Boolean).join(" ") || `#${row}`;
}

/** Finish a ride from the pieces both formats produce. */
function build(
  row: number,
  fields: {
    category?: string;
    lineName?: string;
    journeyNumber?: string;
    body?: string;
    dep: CheckinStop;
    arr: CheckinStop;
    depRaw: unknown;
    arrRaw: unknown;
  },
  out: CheckinParse
): void {
  const label = labelOf(fields.dep, fields.arr, fields.lineName, row);
  const depTime = timeFromText(fields.depRaw);
  const arrTime = timeFromText(fields.arrRaw);
  if (depTime === null || arrTime === null) {
    out.rejects.push({ row, label, reason: "invalid_date" });
    return;
  }
  if (!fields.dep.name && !fields.dep.code) {
    out.rejects.push({ row, label, reason: "missing_departure_station" });
    return;
  }
  if (!fields.arr.name && !fields.arr.code) {
    out.rejects.push({ row, label, reason: "missing_arrival_station" });
    return;
  }
  if (!depTime) {
    out.rejects.push({ row, label, reason: "missing_departure_time" });
    return;
  }
  const ride: CheckinRide = {
    row,
    label,
    mode: modeFromTraewellingCategory(fields.category),
    category: fields.category,
    lineName: fields.lineName,
    trainNumber: fields.journeyNumber,
    notes: fields.body,
    dep: { ...fields.dep, time: depTime },
    arr: { ...fields.arr, time: arrTime },
  };
  out.rides.push(ride);
}

function stopFromJson(stop: unknown, kind: "dep" | "arr"): { stop: CheckinStop; raw: unknown } {
  const s = isRec(stop) ? stop : {};
  const planned = kind === "dep" ? s.departurePlanned : s.arrivalPlanned;
  const real = kind === "dep" ? s.departure : s.arrival;
  return {
    stop: {
      name: str(s.name),
      code: digits(s.evaIdentifier ?? s.eva ?? s.id),
      lat: num(s.latitude ?? s.lat),
      lon: num(s.longitude ?? s.lon),
    },
    // The planned time is the ticket's; the real one only where nothing else is.
    raw: planned ?? real,
  };
}

export function parseTraewellingJson(text: string): CheckinParse {
  const out: CheckinParse = { rides: [], rejects: [] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    out.rejects.push({ row: 1, label: "#1", reason: "invalid_file" });
    return out;
  }
  const list = Array.isArray(data)
    ? data
    : isRec(data) && Array.isArray(data.data)
      ? data.data
      : null;
  if (!list) {
    out.rejects.push({ row: 1, label: "#1", reason: "invalid_file" });
    return out;
  }
  list.forEach((item, index) => {
    const row = index + 1;
    const status = isRec(item) ? item : {};
    const train = isRec(status.train)
      ? status.train
      : isRec(status.transport)
        ? status.transport
        : null;
    if (!train) {
      out.rejects.push({ row, label: `#${row}`, reason: "not_a_journey" });
      return;
    }
    const dep = stopFromJson(train.origin, "dep");
    const arr = stopFromJson(train.destination, "arr");
    const trip = isRec(train.trip) ? train.trip : {};
    build(
      row,
      {
        category: str(train.category ?? trip.category),
        lineName: str(train.lineName ?? trip.lineName),
        journeyNumber: str(train.journeyNumber ?? train.number ?? trip.number),
        body: str(status.body),
        dep: dep.stop,
        arr: arr.stop,
        depRaw: dep.raw,
        arrRaw: arr.raw,
      },
      out
    );
  });
  return out;
}

const COLUMNS = {
  category: ["category", "journey_type", "type", "train_category"],
  line: ["line", "line_name", "linename", "name"],
  number: ["journey_number", "journeynumber", "number", "train_number"],
  depName: ["origin", "origin_name", "from", "departure_station"],
  depCode: ["origin_eva", "origin_evaidentifier", "origin_id", "from_eva"],
  depLat: ["origin_lat", "origin_latitude"],
  depLon: ["origin_lon", "origin_longitude"],
  depTime: [
    "departure_planned",
    "departureplanned",
    "planned_departure",
    "departure",
    "origin_departure",
  ],
  arrName: ["destination", "destination_name", "to", "arrival_station"],
  arrCode: ["destination_eva", "destination_evaidentifier", "destination_id", "to_eva"],
  arrLat: ["destination_lat", "destination_latitude"],
  arrLon: ["destination_lon", "destination_longitude"],
  arrTime: [
    "arrival_planned",
    "arrivalplanned",
    "planned_arrival",
    "arrival",
    "destination_arrival",
  ],
  body: ["body", "message", "comment", "note"],
} as const;

export function parseTraewellingCsv(text: string): CheckinParse {
  const out: CheckinParse = { rides: [], rejects: [] };
  let records: Record<string, string>[];
  try {
    records = parse(text.replace(/^\uFEFF/, ""), {
      columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      relax_column_count: true,
      delimiter: [",", ";"],
    });
  } catch {
    out.rejects.push({ row: 1, label: "#1", reason: "invalid_file" });
    return out;
  }
  const pick = (r: Record<string, string>, names: readonly string[]) => {
    for (const n of names) if (str(r[n]) !== undefined) return r[n];
    return undefined;
  };
  records.forEach((r, index) => {
    const row = index + 2; // header is line 1
    const hasStations =
      pick(r, COLUMNS.depName) !== undefined || pick(r, COLUMNS.depCode) !== undefined;
    if (!hasStations && Object.keys(r).length > 0 && pick(r, COLUMNS.arrName) === undefined) {
      out.rejects.push({ row, label: `#${row}`, reason: "not_a_journey" });
      return;
    }
    build(
      row,
      {
        category: str(pick(r, COLUMNS.category)),
        lineName: str(pick(r, COLUMNS.line)),
        journeyNumber: str(pick(r, COLUMNS.number)),
        body: str(pick(r, COLUMNS.body)),
        dep: {
          name: str(pick(r, COLUMNS.depName)),
          code: digits(pick(r, COLUMNS.depCode)),
          lat: num(pick(r, COLUMNS.depLat)),
          lon: num(pick(r, COLUMNS.depLon)),
        },
        arr: {
          name: str(pick(r, COLUMNS.arrName)),
          code: digits(pick(r, COLUMNS.arrCode)),
          lat: num(pick(r, COLUMNS.arrLat)),
          lon: num(pick(r, COLUMNS.arrLon)),
        },
        depRaw: pick(r, COLUMNS.depTime),
        arrRaw: pick(r, COLUMNS.arrTime),
      },
      out
    );
  });
  return out;
}
