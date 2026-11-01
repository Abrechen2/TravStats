/**
 * Träwelling export (CSV and JSON) -> rides.
 *
 * Shapes taken from the upstream source (github.com/Traewelling/traewelling,
 * branch develop, commit 6051078ef102, checked 2026-11-01):
 *  - JSON: `app/Http/Controllers/Backend/Export/Format/JsonExportController.php`
 *    -> `{meta, data: ExportStatusResource[]}`; per status
 *    `app/Http/Resources/Export/ExportStatusResource.php` (`body`, `checkin`) and
 *    `ExportCheckinResource.php` (`category`, `lineName`, `journeyNumber`,
 *    `origin`/`destination` = `ExportStopoverResource` with `id`, `name`,
 *    `departurePlanned|Real`, `arrivalPlanned|Real`; `tripOrigin`/`tripDestination`
 *    = `StationResource` with `latitude`/`longitude`/`identifiers`). A stopover's
 *    `id` is Träwelling's internal station id, NOT an EVA number: the EVA comes
 *    from the matching trip station's `de_db_ibnr` identifier, if loaded.
 *  - CSV: `app/Http/Controllers/Backend/Export/ExportController.php`
 *    (`exportCsv`) with `app/Enum/ExportableColumn.php`: machine headings are the
 *    enum values (`journey_type`, `line_name`, `origin_name`, `origin_coordinates`
 *    = "lat,lon", `departure_planned` ISO 8601 ...); the "human" CSV prints the
 *    translated titles (`lang/{en,de}.json`, `export.title.*`) instead.
 * A record that carries no two stations or no departure is a reject with a
 * code, not a silently shorter list.
 */

import { parse } from "csv-parse/sync";
import { modeFromTraewellingCategory } from "./modes";
import { timeFromText } from "./time";
import {
  MAX_CHECKIN_RECORDS,
  TooManyRecordsError,
  type CheckinParse,
  type CheckinRide,
  type CheckinStop,
} from "./types";

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

/** The trip station the stopover points at (same internal id), for position and EVA. */
function tripStation(stopover: Rec, candidates: unknown[]): Rec | null {
  const id = str(stopover.id);
  if (id === undefined) return null;
  for (const c of candidates) if (isRec(c) && str(c.id) === id) return c;
  return null;
}

function ibnrOf(station: Rec | null): string | undefined {
  if (!station || !Array.isArray(station.identifiers)) return undefined;
  for (const i of station.identifiers) {
    if (isRec(i) && i.type === "de_db_ibnr") return digits(i.identifier);
  }
  return undefined;
}

function stopFromJson(
  stop: unknown,
  kind: "dep" | "arr",
  tripStations: unknown[],
  manual: unknown
): { stop: CheckinStop; raw: unknown } {
  const s = isRec(stop) ? stop : {};
  const station = tripStation(s, tripStations);
  const planned = kind === "dep" ? s.departurePlanned : s.arrivalPlanned;
  const real = kind === "dep" ? s.departureReal : s.arrivalReal;
  return {
    stop: {
      name: str(s.name),
      code: ibnrOf(station),
      lat: num(station?.latitude),
      lon: num(station?.longitude),
    },
    // The planned time is the ticket's; the real one, then a manual entry,
    // only where nothing else is.
    raw: planned ?? real ?? manual,
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
  if (list.length > MAX_CHECKIN_RECORDS) throw new TooManyRecordsError();
  list.forEach((item, index) => {
    const row = index + 1;
    const status = isRec(item) ? item : {};
    const checkin = isRec(status.checkin) ? status.checkin : null;
    if (!checkin) {
      out.rejects.push({ row, label: `#${row}`, reason: "not_a_journey" });
      return;
    }
    const tripStations = [checkin.tripOrigin, checkin.tripDestination];
    const dep = stopFromJson(checkin.origin, "dep", tripStations, checkin.manualDeparture);
    const arr = stopFromJson(checkin.destination, "arr", tripStations, checkin.manualArrival);
    build(
      row,
      {
        category: str(checkin.category),
        lineName: str(checkin.lineName),
        journeyNumber: str(checkin.manualJourneyNumber ?? checkin.journeyNumber ?? checkin.number),
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

/**
 * Machine headings first (`ExportableColumn` values), then the translated
 * titles of the "human" CSV (`export.title.*` in lang/en.json and lang/de.json),
 * all lower-cased.
 */
const COLUMNS = {
  category: ["journey_type", "category", "kategorie"],
  line: ["line_name", "line", "linie"],
  number: ["journey_number", "journey number", "fahrtnummer"],
  depName: ["origin_name", "departure station name", "abfahrtsstation name"],
  depCoords: ["origin_coordinates", "departure station coordinates", "abfahrtsstation koordinaten"],
  depTime: ["departure_planned", "departure planned", "abfahrt geplant"],
  depReal: ["departure_real", "departure real-time", "abfahrt real"],
  arrName: ["destination_name", "destination station name", "zielstation name"],
  arrCoords: [
    "destination_coordinates",
    "destination station coordinates",
    "zielstation koordinaten",
  ],
  arrTime: ["arrival_planned", "arrival planned", "ankunft geplant"],
  arrReal: ["arrival_real", "arrival real-time", "ankunft real"],
  body: ["body", "status text", "status-nachricht"],
} as const;

/** "lat,lon" (the export prints both in one cell). */
function coordsOf(cell: string | undefined): { lat?: number; lon?: number } {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(cell ?? "");
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : {};
}

export function parseTraewellingCsv(text: string): CheckinParse {
  const out: CheckinParse = { rides: [], rejects: [] };
  let records: Record<string, string>[];
  let headerCols: string[] = [];
  try {
    records = parse(text.replace(/^\uFEFF/, ""), {
      columns: (header: string[]) => {
        headerCols = header.map((h) => h.trim().toLowerCase());
        return headerCols;
      },
      skip_empty_lines: true,
      // One more than the cap: enough to know the file is too big, without
      // reading the rest of it.
      to: MAX_CHECKIN_RECORDS + 1,
      relax_column_count: true,
      delimiter:
        text.split(/\r?\n/, 1)[0].split(";").length > text.split(/\r?\n/, 1)[0].split(",").length
          ? ";"
          : ",",
    });
  } catch {
    out.rejects.push({ row: 1, label: "#1", reason: "invalid_file" });
    return out;
  }
  if (records.length > MAX_CHECKIN_RECORDS) throw new TooManyRecordsError();
  const known: readonly string[] = [...COLUMNS.depName, ...COLUMNS.arrName];
  if (!headerCols.some((h) => known.includes(h))) {
    out.rejects.push({ row: 1, label: "#1", reason: "invalid_file" });
    return out;
  }
  const pick = (r: Record<string, string>, names: readonly string[]) => {
    for (const n of names) if (str(r[n]) !== undefined) return r[n];
    return undefined;
  };
  records.forEach((r, index) => {
    const row = index + 2; // header is line 1
    if (pick(r, COLUMNS.depName) === undefined && pick(r, COLUMNS.arrName) === undefined) {
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
          ...coordsOf(pick(r, COLUMNS.depCoords)),
        },
        arr: {
          name: str(pick(r, COLUMNS.arrName)),
          ...coordsOf(pick(r, COLUMNS.arrCoords)),
        },
        depRaw: pick(r, COLUMNS.depTime) ?? pick(r, COLUMNS.depReal),
        arrRaw: pick(r, COLUMNS.arrTime) ?? pick(r, COLUMNS.arrReal),
      },
      out
    );
  });
  return out;
}
