/**
 * Records -> rows of the spreadsheet importer's flights sheet.
 *
 * What a log does not say is worked out here, where the airports are known:
 * a flight's clocks are the airports' wall clocks, so they become instants in
 * each airport's zone, and an arrival whose date the source did not give is
 * moved forward by whole days until it is after the departure (NRT 17:00 ->
 * LAX 10:00 is the same date; a red-eye is the next).
 */

import { findOrCreateAirport } from "../airportLookup";
import { wallClockToInstant } from "../rides/rideEnds";
import { zoneOf } from "../../shared/time/zoneOf";
import type { AppReject, FlightRecord } from "./types";

type Airport = NonNullable<Awaited<ReturnType<typeof findOrCreateAirport>>>;
const MAX_ARRIVAL_SHIFT_DAYS = 2;

export interface BuiltFlights {
  rows: Array<Record<string, string>>;
  rowNumbers: number[];
  /** Per sheet row: remarks for the preview line. */
  notes: Map<number, string>;
  rejects: AppReject[];
  /** The same flight as an earlier line of the file. */
  duplicates: AppReject[];
}

const zoneOfAirport = (a: Airport): string | null =>
  zoneOf({ catalogueZone: a.timezone, lat: a.lat, lon: a.lon });

export async function buildFlightRows(records: FlightRecord[]): Promise<BuiltFlights> {
  const built: BuiltFlights = {
    rows: [],
    rowNumbers: [],
    notes: new Map(),
    rejects: [],
    duplicates: [],
  };
  const airports = new Map<string, Promise<Airport | null>>();
  const airportOf = (iata: string) => {
    let hit = airports.get(iata);
    if (!hit) airports.set(iata, (hit = findOrCreateAirport(iata)));
    return hit;
  };
  const seen = new Set<string>();

  for (const rec of records) {
    const reject = (reason: string) =>
      built.rejects.push({ sheet: "flights", row: rec.row, label: rec.label, reason });
    if (!rec.depIata || !rec.arrIata) {
      reject("missing_airport_code");
      continue;
    }
    // The importer needs an identity for a NEW flight; say which part is missing.
    if (!rec.flightNumber) {
      reject("missing_flight_number");
      continue;
    }
    const [dep, arr] = [await airportOf(rec.depIata), await airportOf(rec.arrIata)];
    if (!dep || !arr) {
      reject("unknown_airport");
      continue;
    }

    let departure: Date | undefined = rec.depInstant;
    let arrival: Date | undefined = rec.arrInstant;
    try {
      if (!departure && rec.depLocal)
        departure = wallClockToInstant(rec.depLocal, zoneOfAirport(dep));
      if (!arrival && rec.arrLocal) arrival = wallClockToInstant(rec.arrLocal, zoneOfAirport(arr));
    } catch {
      reject("invalid_date");
      continue;
    }
    if (
      [departure, arrival].some((d) => d && Number.isNaN(d.getTime())) ||
      (!departure && !(rec.dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(rec.dateOnly)))
    ) {
      reject("invalid_date");
      continue;
    }
    if (departure && arrival && arrival <= departure) {
      if (!rec.arrDayGuessed || !rec.arrLocal) {
        reject("invalid_date");
        continue;
      }
      // Move the arrival's CALENDAR date and read it in the arrival zone again:
      // adding 24 elapsed hours would change the clock across a DST change.
      let shifted = arrival;
      for (let n = 1; n <= MAX_ARRIVAL_SHIFT_DAYS && shifted <= departure; n++) {
        const next = new Date(`${rec.arrLocal.slice(0, 10)}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + n);
        shifted = wallClockToInstant(
          `${next.toISOString().slice(0, 10)}${rec.arrLocal.slice(10)}`,
          zoneOfAirport(arr)
        );
      }
      if (shifted <= departure) {
        reject("invalid_date");
        continue;
      }
      arrival = shifted;
    }

    const depCode = dep.iata ?? rec.depIata;
    const arrCode = arr.iata ?? rec.arrIata;
    const day = (departure ?? new Date(`${rec.dateOnly}T00:00:00Z`)).toISOString().slice(0, 10);
    const key = [rec.flightNumber, depCode, arrCode, day].join("|").toLowerCase();
    if (seen.has(key)) {
      built.duplicates.push({
        sheet: "flights",
        row: rec.row,
        label: rec.label,
        reason: "duplicate_in_file",
      });
      continue;
    }
    seen.add(key);

    const row: Record<string, string> = {
      airline: rec.airline ?? rec.flightNumber.slice(0, 2),
      flightNumber: rec.flightNumber,
      depIata: depCode,
      arrIata: arrCode,
      departureTime: departure ? departure.toISOString() : (rec.dateOnly as string),
    };
    if (arrival) row.arrivalTime = arrival.toISOString();
    const optional: Array<[string, string | undefined]> = [
      ["aircraft", rec.aircraft],
      ["aircraftRegistration", rec.registration],
      ["seatNumber", rec.seat],
      ["seatClass", rec.seatClass],
      ["category", rec.category],
      ["bookingReference", rec.bookingReference],
      ["notes", rec.notes],
    ];
    for (const [k, v] of optional) if (v) row[k] = v;
    if (!departure) built.notes.set(rec.row, "time_unknown");
    built.rows.push(row);
    built.rowNumbers.push(rec.row);
  }
  return built;
}
