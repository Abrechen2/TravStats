import type { Flight, FlightInput } from "../../types";
import { flightsApi } from "../../lib/api/flights";
import { flightDeparture } from "../../lib/entityTimes";
import { addDays, dayOf } from "../../shared/time";

/**
 * The fly & cruise flights of a booking, stored without ever storing one
 * twice (forgejo#225, re-review residual of I4).
 *
 * A flight that failed AFTER its cruise was stored used to be lost for good:
 * the next read of the booking answers 409 for the cruise, and an
 * already-imported booking's flights are skipped. Now every flight that is
 * not stored is named, and a retry first asks the logbook whether it is there
 * — by flight number and departure day, or by route and day where the booking
 * gave no number — and creates only what is missing.
 */

/** Why a flight of the booking is not in the logbook after this import. */
export type FlightGapReason = "failed" | "missing" | "unchecked";

export interface FlightGapItem {
  flight: FlightInput;
  reason: FlightGapReason;
}

/** The booking's departure day of a flight, `YYYY-MM-DD`. */
const dayOfInput = (flight: FlightInput): string => (flight.departureLocal ?? "").slice(0, 10);

const normalize = (value: string | null | undefined): string =>
  (value ?? "").replace(/\s+/g, "").toUpperCase();

function sameFlight(stored: Flight, wanted: FlightInput): boolean {
  const departure = flightDeparture(stored);
  if (!departure || dayOf(departure) !== dayOfInput(wanted)) return false;
  const number = normalize(wanted.flightNumber);
  if (number) return normalize(stored.flightNumber) === number;
  return (
    normalize(stored.depIata) === normalize(wanted.departure.iata) &&
    normalize(stored.arrIata) === normalize(wanted.arrival.iata)
  );
}

/**
 * Whether the logbook already holds this flight. The server's date filter
 * reads UTC instants, so a day either side is asked and the airport's own
 * departure day decides.
 */
export async function flightIsStored(flight: FlightInput): Promise<boolean> {
  const day = dayOfInput(flight);
  if (!day) return false;
  const { flights } = await flightsApi.getAll({
    ...(normalize(flight.flightNumber) ? { flightNumber: flight.flightNumber ?? undefined } : {}),
    fromDate: `${addDays(day, -1)}T00:00:00.000Z`,
    toDate: `${addDays(day, 2)}T00:00:00.000Z`,
    limit: 100,
  });
  return flights.some((stored) => sameFlight(stored, flight));
}

/**
 * Stores the given flights one by one; a refused one does not stop the rest.
 * With `checkFirst`, a flight the logbook already holds is not created again
 * — and one that cannot be checked is left alone and reported, never guessed.
 */
export async function storeFlights(
  flights: readonly FlightInput[],
  options: { checkFirst: boolean; failedReason: FlightGapReason }
): Promise<{ ids: string[]; present: number; gap: FlightGapItem[] }> {
  const ids: string[] = [];
  const gap: FlightGapItem[] = [];
  let present = 0;
  for (const flight of flights) {
    if (options.checkFirst) {
      let stored: boolean;
      try {
        stored = await flightIsStored(flight);
      } catch {
        gap.push({ flight, reason: "unchecked" });
        continue;
      }
      if (stored) {
        present += 1;
        continue;
      }
    }
    try {
      const created = await flightsApi.create(flight, { force: true });
      if (created.id) ids.push(created.id);
    } catch {
      gap.push({ flight, reason: options.failedReason });
    }
  }
  return { ids, present, gap };
}

/**
 * The flights of bookings the server already held: those the logbook lacks
 * are OFFERED, not created — a user may have deleted them on purpose.
 */
export async function missingFlights(flights: readonly FlightInput[]): Promise<FlightGapItem[]> {
  const gap: FlightGapItem[] = [];
  for (const flight of flights) {
    try {
      if (!(await flightIsStored(flight))) gap.push({ flight, reason: "missing" });
    } catch {
      gap.push({ flight, reason: "unchecked" });
    }
  }
  return gap;
}
