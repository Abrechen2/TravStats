import { localDay, toInstant } from "../../shared/time/instant";
import {
  fakeUtcToInstant,
  isPlaceholderPrecision,
  placeholderDayOf,
  startOfDayAt,
} from "../../shared/time/legacyValues";
import {
  TIME_PRECISIONS,
  serializeTime,
  type TimePrecision,
  type TimeValue,
  type ZoneSource,
} from "../../shared/time/wire";
import type { FlightTimes } from "../../schemas/times";

/**
 * A flight's `times` (ADR 0002 phase 4): departure and arrival as TimeValues
 * at their airports.
 *
 * The zone is the one the flight was WRITTEN with (`dep_timezone`,
 * `arr_timezone`, frozen since phase 2 and filled by the phase-3b backfill).
 * Only a row that has none — the backfill could not resolve its airport then —
 * is read in today's catalogue zone, and says so with `zoneSource:
 * "catalogue"`: that value moves when the catalogue is corrected, a stored
 * one does not. With neither, `zone` is null and the UTC reading is labelled
 * as such (`serializeTime`).
 *
 * The legacy column is read by its semantics tag, because until phase 6 it
 * still holds what the tag says:
 *
 * | tag | the column holds | TimeValue |
 * |---|---|---|
 * | `UTC` | a real instant | that instant, precision as stored (minute) |
 * | `LEGACY_FAKE_UTC` | the airport's wall clock as if it were UTC | the wall clock read at the airport; a clock the zone skipped keeps its date only (`unknown`) |
 * | `DATE_ONLY` | a local wall clock for a day (noon from the form, midnight from the cruise import), written through the airport's zone | the start of that local day at the airport, precision `day` |
 * | `UNKNOWN` | never classified; a year-/month-only entry holds midnight UTC on the 1st | the stored value, precision `unknown` (date only); the placeholder at the start of its own day (`placeholderDayOf`) |
 */

export interface FlightTimeColumns {
  departureTime: Date | null;
  arrivalTime: Date | null;
  depTimeSemantics: string;
  arrTimeSemantics: string;
  depTimezone: string | null;
  arrTimezone: string | null;
  depPrecision: string | null;
  arrPrecision: string | null;
  actualDeparture: Date | null;
  actualArrival: Date | null;
  runwayDepartureTime: Date | null;
  runwayArrivalTime: Date | null;
}

/** Today's catalogue zone of each airport — consulted only for a row without a stored zone. */
export interface CatalogueZones {
  dep: string | null;
  arr: string | null;
}

const isPrecision = (value: string | null): value is TimePrecision =>
  value !== null && (TIME_PRECISIONS as readonly string[]).includes(value);

function endTime(
  time: Date | null,
  semantics: string,
  stored: { zone: string | null; precision: string | null },
  catalogueZone: string | null
): TimeValue | null {
  if (!time) return null;
  const zone = stored.zone ?? catalogueZone;
  const source: ZoneSource = stored.zone ? "stored" : "catalogue";

  if (semantics === "LEGACY_FAKE_UTC") {
    // Read as UTC, a fake-UTC value shows exactly its wall clock — which is
    // what a row with no zone has to offer: the date is known, the instant not.
    if (!zone) return serializeTime(time, null, "unknown");
    const reading = fakeUtcToInstant(time, zone);
    if (reading.status === "converted") {
      return serializeTime(reading.utc, zone, "minute", source);
    }
    const placed = toInstant(reading.local, zone, { origin: "machine" }).utc;
    return serializeTime(placed, zone, "unknown", source);
  }
  if (semantics === "DATE_ONLY") {
    // The local day of the stored instant in its zone: a date-only flight is
    // WRITTEN as a local wall clock through that zone (the form's noon, the
    // cruise import's midnight), so its UTC date is the day before east of UTC
    // for a midnight write and at UTC+13/+14 for a noon one (forgejo#273,
    // `shared/time/dateOnlyFlights.json`). No zone: the stored date, labelled.
    const day = zone ? localDay(time, zone) : time.toISOString().slice(0, 10);
    return zone
      ? serializeTime(startOfDayAt(day, zone), zone, "day", source)
      : serializeTime(new Date(`${day}T00:00:00.000Z`), null, "day");
  }
  // A year-/month-only placeholder (midnight UTC on the 1st, `UNKNOWN`) names
  // a day no zone may move: shown as the start of that day at the airport, so
  // "2015" does not read as 31 December 2014 west of UTC (forgejo#256).
  const placeholder = placeholderDayOf(time, semantics, stored.precision);
  if (placeholder !== null) {
    return zone
      ? serializeTime(startOfDayAt(placeholder, zone), zone, "unknown", source)
      : serializeTime(time, null, "unknown");
  }
  const precision: TimePrecision =
    semantics === "UTC"
      ? isPrecision(stored.precision)
        ? stored.precision
        : "minute"
      : isPlaceholderPrecision(stored.precision)
        ? (stored.precision as TimePrecision)
        : "unknown";
  return serializeTime(time, zone, precision, source);
}

/** A provider's reading (real UTC, never a wall clock) at one end's zone. */
function reported(
  time: Date | null,
  stored: string | null,
  catalogue: string | null
): TimeValue | null {
  if (!time) return null;
  return serializeTime(time, stored ?? catalogue, "minute", stored ? "stored" : "catalogue");
}

export function flightTimes(flight: FlightTimeColumns, catalogue: CatalogueZones): FlightTimes {
  const dep = (time: Date | null) => reported(time, flight.depTimezone, catalogue.dep);
  const arr = (time: Date | null) => reported(time, flight.arrTimezone, catalogue.arr);
  return {
    departure: endTime(
      flight.departureTime,
      flight.depTimeSemantics,
      { zone: flight.depTimezone, precision: flight.depPrecision },
      catalogue.dep
    ),
    arrival: endTime(
      flight.arrivalTime,
      flight.arrTimeSemantics,
      { zone: flight.arrTimezone, precision: flight.arrPrecision },
      catalogue.arr
    ),
    actualDeparture: dep(flight.actualDeparture),
    actualArrival: arr(flight.actualArrival),
    runwayDeparture: dep(flight.runwayDepartureTime),
    runwayArrival: arr(flight.runwayArrivalTime),
  };
}
