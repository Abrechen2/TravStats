import type { FLIGHT_PHASES } from "../../schemas/shareLinkItinerary";
import type { FlightTimes } from "../../schemas/times";
import type { TimeValue } from "../../shared/time/wire";

/**
 * A flight on a trip itinerary (forgejo#302): the columns it may carry and its
 * phase by the clock. The single-flight link that used to live beside this is
 * retired (owner decision 2026-11-22); the trip itinerary carries flights now.
 *
 * Nothing here selects "a flight minus the private columns": a column added
 * to `Flight` tomorrow reaches a stranger only if someone names it below.
 */

type FlightPhase = (typeof FLIGHT_PHASES)[number];

/** Exactly the columns the view can ever need — and nothing it could leak by accident. */
export const FLIGHT_VIEW_SELECT = {
  id: true,
  userId: true,
  status: true,
  airline: true,
  flightNumber: true,
  aircraft: true,
  depIata: true,
  depIcao: true,
  depName: true,
  arrIata: true,
  arrIcao: true,
  arrName: true,
  departureTime: true,
  arrivalTime: true,
  depTimeSemantics: true,
  arrTimeSemantics: true,
  depTimezone: true,
  arrTimezone: true,
  depPrecision: true,
  arrPrecision: true,
  actualDeparture: true,
  actualArrival: true,
  runwayDepartureTime: true,
  runwayArrivalTime: true,
  // Departure terminal and gate, shown on the itinerary when stored.
  terminal: true,
  gate: true,
  // Read only because the shared time builder (`enrichFlightsForClients`)
  // expects every time column; the public view is built from the allow-list
  // and never carries the check-in opening (forgejo#285).
  onlineCheckInOpensAt: true,
  onlineCheckInZone: true,
} as const;

/** A time the clock can be compared with; a day-only or unknown reading is not one. */
const exact = (value: TimeValue | null): TimeValue | null =>
  value && value.precision === "minute" ? value : null;

/** Departure and arrival behind the phase: a provider's report wins over the schedule. */
export function phaseTimes(times: FlightTimes): {
  departure: TimeValue | null;
  arrival: TimeValue | null;
  basis: "schedule" | "reported";
} {
  const reportedDeparture = exact(times.runwayDeparture) ?? exact(times.actualDeparture);
  const reportedArrival = exact(times.runwayArrival) ?? exact(times.actualArrival);
  return {
    departure: reportedDeparture ?? exact(times.departure),
    arrival: reportedArrival ?? exact(times.arrival),
    basis: reportedDeparture || reportedArrival ? "reported" : "schedule",
  };
}

/** The phase by the clock; a reported time wins over the schedule. */
export function flightPhase(status: string, times: FlightTimes, at: Date): { phase: FlightPhase } {
  const { departure, arrival } = phaseTimes(times);
  if (status === "cancelled") return { phase: "cancelled" };
  if (!departure || !arrival) return { phase: "unknown" };
  const dep = Date.parse(departure.utc);
  const arr = Date.parse(arrival.utc);
  const t = at.getTime();
  if (t < dep) return { phase: "scheduled" };
  if (t >= arr) return { phase: "landed" };
  return { phase: "inFlight" };
}
