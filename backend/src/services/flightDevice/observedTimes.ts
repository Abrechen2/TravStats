import { prisma } from "../../db";
import type { Flight, Prisma } from "../../prisma";
import logger from "../../utils/logger";
import { calculateChanges, createPendingUpdate, type FlightChange } from "../flightAutoUpdate";
import { markFlownOnReportedLanding } from "../flightLandedStatus";
import { applyPendingUpdate, type FlightDataSnapshot } from "../pendingUpdateService";
import type { ObservedTimes } from "../../schemas/flightDevice";
import { DEVICE_GPS_SOURCE } from "./deviceSource";
import { nearSchedule, scheduledInstants } from "./flightWindow";

/**
 * A paired phone's observed takeoff and landing (forgejo#194), routed through
 * the path a live-data provider's report takes since 2.7.0-rc.2:
 *
 *   1. a past observed landing ends "scheduled" at once
 *      (`markFlownOnReportedLanding`) — the status is derived, not the user's;
 *   2. the times become a pending flight update with `apiSource: device_gps`
 *      (`createPendingUpdate`), reviewed under the user's own rule.
 *
 * The review rule is the provider's with ONE tightening: even with approval
 * switched off, a phone's observation only FILLS an empty actual time. One that
 * would replace a value already there — typed by the user, reported by a
 * provider, or an earlier observation already applied — always waits for
 * review. A phone's clock and fix are good evidence, not authority over what
 * the user wrote.
 */

/** A device clock running a little ahead is not a time traveller. */
export const OBSERVED_FUTURE_SKEW_MS = 5 * 60_000;

export type ObservationRefusal =
  | { code: "OBSERVED_TIME_IN_FUTURE"; status: 400; field: string }
  | { code: "OBSERVED_TIME_OUTSIDE_FLIGHT"; status: 422; field: string }
  | { code: "OBSERVED_AIRPORT_MISMATCH"; status: 422; field: string };

type CheckedFlight = Pick<
  Flight,
  | "departureTime"
  | "arrivalTime"
  | "depTimeSemantics"
  | "arrTimeSemantics"
  | "depIata"
  | "depIcao"
  | "arrIata"
  | "arrIcao"
>;

/** Whether the code the phone named is one of the flight's own for that end. */
function sameAirport(named: string | undefined, iata: string | null, icao: string | null): boolean {
  if (!named) return true;
  const own = [iata, icao].filter((c): c is string => Boolean(c)).map((c) => c.toUpperCase());
  // A flight that names no airport at this end has nothing to contradict.
  return own.length === 0 || own.includes(named);
}

/**
 * Why this observation cannot be about this flight, or null when it can.
 * Checked in order: the clock, the airport, then the schedule.
 */
export async function refuseObservation(
  flight: CheckedFlight,
  observed: ObservedTimes,
  now: Date
): Promise<ObservationRefusal | null> {
  const latest = now.getTime() + OBSERVED_FUTURE_SKEW_MS;
  for (const end of ["departure", "arrival"] as const) {
    const at = observed[end]?.at;
    if (at && at.getTime() > latest) {
      return { code: "OBSERVED_TIME_IN_FUTURE", status: 400, field: `${end}.at` };
    }
  }
  // A landing somewhere else is a diversion. The app reports that; the server
  // must never record it as an arrival at the booked destination.
  if (!sameAirport(observed.departure?.airport, flight.depIata, flight.depIcao)) {
    return { code: "OBSERVED_AIRPORT_MISMATCH", status: 422, field: "departure.airport" };
  }
  if (!sameAirport(observed.arrival?.airport, flight.arrIata, flight.arrIcao)) {
    return { code: "OBSERVED_AIRPORT_MISMATCH", status: 422, field: "arrival.airport" };
  }
  const scheduled = await scheduledInstants(flight);
  if (observed.departure && !nearSchedule(observed.departure.at, scheduled.departure)) {
    return { code: "OBSERVED_TIME_OUTSIDE_FLIGHT", status: 422, field: "departure.at" };
  }
  if (observed.arrival && !nearSchedule(observed.arrival.at, scheduled.arrival)) {
    return { code: "OBSERVED_TIME_OUTSIDE_FLIGHT", status: 422, field: "arrival.at" };
  }
  return null;
}

/** The flight as the pending-update queue snapshots it (`createPendingUpdate`). */
function snapshotOf(flight: Flight): FlightDataSnapshot {
  return {
    airline: flight.airline,
    aircraft: flight.aircraft,
    gate: flight.gate,
    terminal: flight.terminal,
    depIata: flight.depIata,
    depIcao: flight.depIcao,
    arrIata: flight.arrIata,
    arrIcao: flight.arrIcao,
    departureTime: flight.departureTime?.toISOString() ?? null,
    arrivalTime: flight.arrivalTime?.toISOString() ?? null,
    actualDeparture: flight.actualDeparture?.toISOString() ?? null,
    actualArrival: flight.actualArrival?.toISOString() ?? null,
    status: flight.status,
  };
}

export interface ObservationContext {
  userId: string;
  /** `ApiToken.deviceId` of the paired phone; null from a browser session. */
  deviceId: string | null;
}

export interface ObservationOutcome {
  /** unchanged: nothing differs from the flight · pending: waits for review · applied: written */
  outcome: "unchanged" | "pending" | "applied";
  pendingUpdateId: string | null;
  /** This observation ended "scheduled". */
  markedFlown: boolean;
  changes: FlightChange[];
}

/**
 * Records a checked observation (see `refuseObservation`) against an OWNED
 * flight. Throws when the suggestion cannot be stored — a phone that is told
 * "fine" while nothing was kept would never send it again.
 */
export async function recordObservedTimes(
  flight: Flight,
  observed: ObservedTimes,
  context: ObservationContext
): Promise<ObservationOutcome> {
  const arrival = observed.arrival?.at.toISOString() ?? null;
  const markedFlown = await markFlownOnReportedLanding(flight, arrival, DEVICE_GPS_SOURCE);
  const current: Flight = markedFlown ? { ...flight, status: "flown" } : flight;

  const original = snapshotOf(current);
  const proposed: FlightDataSnapshot = {
    ...original,
    actualDeparture: observed.departure?.at.toISOString() ?? original.actualDeparture,
    actualArrival: arrival ?? original.actualArrival,
  };
  const changes = calculateChanges(original, proposed);
  if (changes.length === 0) {
    return { outcome: "unchanged", pendingUpdateId: null, markedFlown, changes };
  }

  const metadata = {
    evidence: DEVICE_GPS_SOURCE,
    via: context.deviceId ? "paired_device" : "session",
    deviceId: context.deviceId,
    observationId: observed.observationId ?? null,
    departureAirport: observed.departure?.airport ?? null,
    arrivalAirport: observed.arrival?.airport ?? null,
  } satisfies Prisma.InputJsonObject;
  const pendingUpdateId = await createPendingUpdate(
    current,
    proposed,
    changes,
    DEVICE_GPS_SOURCE,
    metadata
  );
  if (!pendingUpdateId) throw new Error("The observed times could not be stored");

  const settings = await prisma.userSettings.findUnique({
    where: { userId: context.userId },
    select: { autoUpdateRequireApproval: true },
  });
  const onlyFills = changes.every((c) => c.type === "added");
  if (settings?.autoUpdateRequireApproval === false && onlyFills) {
    const applied = await applyPendingUpdate(pendingUpdateId, context.userId);
    if (applied) {
      logger.info({
        operation: "flight.observedTimes.applied",
        flightId: flight.id,
        pendingUpdateId,
      });
      return { outcome: "applied", pendingUpdateId, markedFlown, changes };
    }
    logger.warn({
      operation: "flight.observedTimes.autoApplyFailed",
      flightId: flight.id,
      pendingUpdateId,
    });
  }
  logger.info({ operation: "flight.observedTimes.pending", flightId: flight.id, pendingUpdateId });
  return { outcome: "pending", pendingUpdateId, markedFlown, changes };
}
