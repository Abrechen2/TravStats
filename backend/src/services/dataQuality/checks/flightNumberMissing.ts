import type { FlightRecord } from "../recordGather";
import type { DataQualityFinding } from "../types";

/**
 * A flight that names its carrier but carries no flight number (forgejo#282).
 *
 * The rule, stated so the user can argue with it: a number is EXPECTED when
 *
 * - the flight names an airline (name, IATA or ICAO code) — a scheduled
 *   commercial service is flown under a number; a flight with no carrier is
 *   read as private or general aviation and never asked about;
 * - it is not a special flight (`specialType`: sightseeing, training, ferry …),
 *   and not marked cargo;
 * - its status is `scheduled` or `flown`. A `historical` flight is an entry
 *   from memory or an old logbook where the number was often never known,
 *   and a `cancelled` one did not happen.
 *
 * The question is "do you know the number?" — the flight keeps counting
 * exactly as it does, and a number nobody has is answered with "Das stimmt so".
 */
const EXPECTS_NUMBER = new Set(["scheduled", "flown"]);

export function findMissingFlightNumbers(flights: readonly FlightRecord[]): DataQualityFinding[] {
  return flights
    .filter(
      (f) =>
        f.flightNumber === null &&
        f.airline !== null &&
        f.specialType === null &&
        f.isCargo !== true &&
        EXPECTS_NUMBER.has(f.status)
    )
    .map((f) => ({
      entityType: "flight" as const,
      entityId: f.id,
      kind: "flight_number_missing" as const,
      details: { airline: f.airline as string, status: f.status },
    }));
}
