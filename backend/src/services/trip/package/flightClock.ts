/**
 * A stored flight departure on the server's one reading (`localWallClockOf`),
 * for the import matchers: a real instant (`UTC`, `DATE_ONLY`, `UNKNOWN`) is
 * converted through its zone; a `LEGACY_FAKE_UTC` value stores the wall clock
 * itself and is read by its own components. Reading the latter as an instant
 * moved a Los Angeles 6 July to 5 July, so a re-import created the same flight
 * a second time (forgejo#279). Without a zone the stored components are the
 * best available reading.
 */
import { toLocal } from "../../../shared/time/instant";
import { localWallClockOf, type FlightTimeSemantics } from "../../../utils/timezone";

export interface StoredDepartureClock {
  depTimezone: string | null;
  depTimeSemantics: string | null;
}

const SEMANTICS: readonly FlightTimeSemantics[] = [
  "UTC",
  "DATE_ONLY",
  "LEGACY_FAKE_UTC",
  "UNKNOWN",
];

const asSemantics = (value: string | null): FlightTimeSemantics =>
  SEMANTICS.find((s) => s === value) ?? "UNKNOWN";

/** The local calendar day (`YYYY-MM-DD`) the flight departed. */
export function flightDepartureDay(departure: Date | string, flight: StoredDepartureClock): string {
  return localWallClockOf(
    new Date(departure),
    flight.depTimezone,
    asSemantics(flight.depTimeSemantics)
  ).date;
}

/** The local departure day of a flight that may carry no departure at all. */
export function fileFlightDay(
  flight: StoredDepartureClock & { departureTime: string | null }
): string | null {
  return flight.departureTime ? flightDepartureDay(flight.departureTime, flight) : null;
}

/** `HH:MM` on the same clock; null when only the date is known. */
export function flightDepartureTime(
  departure: Date | string,
  flight: StoredDepartureClock
): string | null {
  const semantics = asSemantics(flight.depTimeSemantics);
  if (semantics === "DATE_ONLY") return null;
  const stored = new Date(departure);
  if (semantics === "LEGACY_FAKE_UTC" || !flight.depTimezone) {
    return stored.toISOString().slice(11, 16);
  }
  return toLocal(stored, flight.depTimezone).local.slice(11, 16);
}
