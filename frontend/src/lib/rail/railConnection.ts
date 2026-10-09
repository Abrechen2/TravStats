import { railArrival, railDeparture, type RailLike } from "../entityTimes";
import { railDurationMinutes } from "../railTime";
import type { RailJourney, RailStatus } from "../../types/rail";

/**
 * What a ride with changes of trains shows as ONE entry (forgejo#187). These
 * read the legs the server already grouped — they decide nothing about which
 * legs belong together, and they count nothing: every figure elsewhere keeps
 * counting legs.
 */

type Leg = Pick<
  RailJourney,
  | "depStationName"
  | "arrStationName"
  | "departureTime"
  | "arrivalTime"
  | "depTimezone"
  | "arrTimezone"
  | "trainCategory"
  | "trainNumber"
  | "status"
  | "times"
>;

/** Start, every station changed at, destination — in travel order. */
export function connectionStations(legs: readonly Leg[]): string[] {
  if (legs.length === 0) return [];
  return [legs[0].depStationName, ...legs.map((leg) => leg.arrStationName)];
}

/** "ICE 101", "EC 7" — one per leg that names a train; nothing invented. */
export function connectionTrains(legs: readonly Leg[]): string[] {
  return legs
    .map((leg) => [leg.trainCategory, leg.trainNumber].filter(Boolean).join(" "))
    .filter((train) => train !== "");
}

/**
 * The ride from its first departure to its last arrival, shaped like a single
 * journey so the list's own span formatter reads it.
 */
export function connectionSpan(legs: readonly Leg[]): RailLike | null {
  if (legs.length === 0) return null;
  const first = legs[0];
  const last = legs[legs.length - 1];
  return {
    departureTime: first.departureTime,
    depTimezone: first.depTimezone,
    arrivalTime: last.arrivalTime,
    arrTimezone: last.arrTimezone,
    times: { departure: railDeparture(first), arrival: railArrival(last) },
  };
}

/**
 * Minutes from the first departure to the last arrival, waits included. Null
 * when either end is not known to the minute — an unknown duration is not 0.
 */
export function connectionDurationMinutes(legs: readonly Leg[]): number | null {
  const span = connectionSpan(legs);
  const departure = span && railDeparture(span);
  return departure ? railDurationMinutes(departure, railArrival(span)) : null;
}

/**
 * The status all legs share. Null when they disagree (one train cancelled,
 * the next still to come): the entry then states none rather than picking one.
 */
export function connectionStatus(legs: readonly Leg[]): RailStatus | null {
  if (legs.length === 0) return null;
  return legs.every((leg) => leg.status === legs[0].status) ? legs[0].status : null;
}
