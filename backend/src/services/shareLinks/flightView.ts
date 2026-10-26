import { prisma } from "../../db";
import { now } from "../../shared/time/clock";
import type { TimeValue } from "../../shared/time/wire";
import {
  SHARE_LINK_FLIGHT_GRACE_MS,
  type FlightView,
  type ShareLinkField,
} from "../../schemas/shareLinks";
import { enrichFlightsForClients } from "../flightAirportFacts";
import type { FlightTimes } from "../../schemas/times";
import { lastViewablePosition } from "../travtrack/flightTrackView";

/**
 * The public view of one flight — the family flight link (companion#40).
 *
 * Built FIELD BY FIELD from the owner's selection: there is no "flight minus
 * the private columns" anywhere here, so a column added to `Flight` tomorrow
 * reaches a stranger only if someone writes a line for it below.
 */

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
  // Read only because the shared time builder (`enrichFlightsForClients`)
  // expects every time column; the public view is built from the allow-list
  // and never carries the check-in opening (forgejo#285).
  onlineCheckInOpensAt: true,
  onlineCheckInZone: true,
} as const;

export async function loadOwnedFlightTimes(
  userId: string,
  flightId: string
): Promise<{ flight: FlightRow; times: FlightTimes } | null> {
  const flight = await prisma.flight.findFirst({
    where: { id: flightId, userId },
    select: FLIGHT_VIEW_SELECT,
  });
  if (!flight) return null;
  const [enriched] = await enrichFlightsForClients([flight]);
  return { flight, times: enriched.times };
}

type FlightRow = {
  userId: string;
  status: string;
  airline: string | null;
  flightNumber: string | null;
  aircraft: string | null;
  depIata: string | null;
  depIcao: string | null;
  depName: string | null;
  arrIata: string | null;
  arrIcao: string | null;
  arrName: string | null;
};

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

/**
 * When a flight link stops working by itself: two hours after the arrival, or
 * a day after the departure when no arrival is known. Null when the flight
 * names neither — the owner's own expiry is then the only end.
 */
export function flightAutoExpiry(times: FlightTimes): Date | null {
  const { departure, arrival } = phaseTimes(times);
  if (arrival) return new Date(Date.parse(arrival.utc) + SHARE_LINK_FLIGHT_GRACE_MS);
  if (departure) return new Date(Date.parse(departure.utc) + 24 * 3_600_000);
  return null;
}

export function flightProgress(
  status: string,
  times: FlightTimes,
  at: Date
): NonNullable<FlightView["progress"]> {
  const { departure, arrival, basis } = phaseTimes(times);
  const eta = arrival ?? times.arrival;
  if (status === "cancelled") return { phase: "cancelled", fraction: null, eta: null, basis };
  if (!departure || !arrival) return { phase: "unknown", fraction: null, eta, basis };
  const dep = Date.parse(departure.utc);
  const arr = Date.parse(arrival.utc);
  const t = at.getTime();
  if (t < dep) return { phase: "scheduled", fraction: 0, eta, basis };
  if (t >= arr) return { phase: "landed", fraction: 1, eta, basis };
  const fraction = arr > dep ? Math.round(((t - dep) / (arr - dep)) * 1000) / 1000 : null;
  return { phase: "inFlight", fraction, eta, basis };
}

export async function buildFlightView(
  flightId: string,
  loaded: { flight: FlightRow; times: FlightTimes },
  fields: ReadonlySet<ShareLinkField<"flight">>,
  ownerFirstName: string | null
): Promise<FlightView> {
  const { flight, times } = loaded;
  const view: FlightView = {};
  if (fields.has("owner")) view.owner = ownerFirstName;
  if (fields.has("flightNumber")) {
    view.flightNumber = { airline: flight.airline, number: flight.flightNumber };
  }
  if (fields.has("route")) {
    view.route = {
      from: { code: flight.depIata ?? flight.depIcao, name: flight.depName },
      to: { code: flight.arrIata ?? flight.arrIcao, name: flight.arrName },
    };
  }
  if (fields.has("schedule")) {
    view.schedule = { departure: times.departure, arrival: times.arrival };
  }
  if (fields.has("progress")) view.progress = flightProgress(flight.status, times, now());
  if (fields.has("aircraft")) view.aircraft = flight.aircraft;
  // Through the privacy cut like every other read of a recording (TravTrack
  // plan T5): a position inside one of the owner's zones is never shown.
  if (fields.has("lastPosition")) {
    view.lastPosition = await lastViewablePosition(flight.userId, flightId);
  }
  return view;
}
