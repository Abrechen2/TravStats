/**
 * Rides read from a check-in export -> rows of the existing rail / bus
 * import sheets, so the preview, the commit, the natural-key dedupe against
 * rides already stored and the write rules are the spreadsheet importer's own
 * (`xlsxImport/rail.ts`, `bus.ts`), not a second copy.
 *
 * What this step adds is the part a spreadsheet already has resolved: the
 * stations. They are matched through the station catalogue (code, then
 * position, then one exact folded name — never a near match), and an instant
 * (`Z` timestamp, epoch) is turned into the station's wall clock in the zone
 * of the matched station. A ride whose station cannot be matched, or that has
 * no usable clock, comes back as a reject with a reason code.
 */

import { instantToWallClock } from "../rail/railJourneyWrite";
import { zoneOf } from "../../shared/time/zoneOf";
import { getCountryResolver } from "../geo/countryFromCoordinates";
import { resolveStation, type StationCells } from "../xlsxImport/railStations";
import type { CheckinReject, CheckinRide, CheckinStop } from "./types";

export type SheetRow = Record<string, string>;

export interface BuiltSheets {
  rail: { rows: SheetRow[]; rowNumbers: number[] };
  bus: { rows: SheetRow[]; rowNumbers: number[] };
  rejects: Array<CheckinReject & { sheet: "rail" | "bus" }>;
  /** Rides that are the same ride as an earlier line of this file. */
  duplicates: Array<CheckinReject & { sheet: "rail" | "bus" }>;
}

interface Resolved {
  name: string;
  code?: string;
  lat: number;
  lon: number;
  zone: string | null;
}

async function resolveStop(
  stop: CheckinStop,
  countryAt: Awaited<ReturnType<typeof getCountryResolver>>
): Promise<Resolved | null> {
  const cells: StationCells = { name: stop.name, code: stop.code, lat: stop.lat, lon: stop.lon };
  const hit = await resolveStation(cells, countryAt);
  if (!hit) return null;
  return {
    name: hit.name,
    code: hit.code ?? undefined,
    lat: hit.lat,
    lon: hit.lon,
    zone: zoneOf({ lat: hit.lat, lon: hit.lon }),
  };
}

/** The station's wall clock `YYYY-MM-DDTHH:mm`; null when an instant has no zone to read in. */
function wallClock(stop: CheckinStop, zone: string | null): string | undefined | null {
  const t = stop.time;
  if (!t) return undefined;
  if ("wall" in t) return t.wall;
  return zone ? instantToWallClock(t.instant, zone) : null;
}

/** The category without the journey number it ends in ("ICE 123" + 123 -> "ICE"). */
function categoryOf(ride: CheckinRide): string | undefined {
  const line = ride.lineName ?? ride.category;
  if (!line) return undefined;
  const no = ride.trainNumber;
  if (no && line.endsWith(no)) return line.slice(0, line.length - no.length).trim() || undefined;
  return line;
}

export async function buildSheets(rides: CheckinRide[]): Promise<BuiltSheets> {
  const countryAt = await getCountryResolver();
  const built: BuiltSheets = {
    rail: { rows: [], rowNumbers: [] },
    bus: { rows: [], rowNumbers: [] },
    rejects: [],
    duplicates: [],
  };
  const seen = new Set<string>();

  for (const ride of rides) {
    const sheet = ride.mode === "bus" ? "bus" : "rail";
    const reject = (reason: string) =>
      built.rejects.push({ row: ride.row, label: ride.label, reason, sheet });
    if (typeof ride.mode === "object") {
      reject(`unsupported_mode:${ride.mode.unsupported}`);
      continue;
    }
    const [dep, arr] = [
      await resolveStop(ride.dep, countryAt),
      await resolveStop(ride.arr, countryAt),
    ];
    if (!dep || !arr) {
      reject("unknown_station");
      continue;
    }
    // A bus stop is not in the rail catalogue, so a bus ride needs the
    // position the export carried; resolveStation only returned one because
    // the cells had it (or the catalogue knew the exact name).
    const departure = wallClock(ride.dep, dep.zone);
    const arrival = wallClock(ride.arr, arr.zone);
    if (departure === null || arrival === null || !departure) {
      reject("invalid_date");
      continue;
    }
    const key = [sheet, dep.name, arr.name, departure, ride.trainNumber ?? ""]
      .join("|")
      .toLowerCase();
    if (seen.has(key)) {
      built.duplicates.push({
        row: ride.row,
        label: ride.label,
        reason: "duplicate_in_file",
        sheet,
      });
      continue;
    }
    seen.add(key);

    const row: SheetRow = {
      departureTime: departure,
      depStationName: dep.name,
      depLat: String(dep.lat),
      depLon: String(dep.lon),
      arrStationName: arr.name,
      arrLat: String(arr.lat),
      arrLon: String(arr.lon),
    };
    if (arrival) row.arrivalTime = arrival;
    if (dep.code) row.depStationCode = dep.code;
    if (arr.code) row.arrStationCode = arr.code;
    if (ride.notes) row.notes = ride.notes;
    if (sheet === "bus") {
      if (ride.lineName) row.lineName = ride.lineName;
    } else {
      row.transitMode = ride.mode;
      const category = categoryOf(ride);
      if (category) row.trainCategory = category;
      if (ride.trainNumber) row.trainNumber = ride.trainNumber;
    }
    built[sheet].rows.push(row);
    built[sheet].rowNumbers.push(ride.row);
  }
  return built;
}
