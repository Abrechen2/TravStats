import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { toInstant } from "../../shared/time/instant";
import { fromDbDate, toDbDate } from "../../shared/time/localDate";
import { profileZoneOf } from "../../shared/time/profileZone";
import { tripDaySpan } from "../notes/tripNotes";
import type { TripTimeColumns } from "../trips/timesDto";
import type { TimeValue } from "../../shared/time/wire";
import { getAirportTimezone } from "../../utils/timezone";
import { flightTimes } from "../flights/timesDto";
import { recorderWindow } from "../flightDevice/flightWindow";

/**
 * Where a trip recording may lie (forgejo#316): inside the trip's days, and
 * outside every flight's recorder window.
 *
 * - The trip's days run from 00:00 of its first local day to the end of its
 *   last (23:59:59.999), each end read in its own zone — the zone the trip's
 *   span was derived in (`startZone`/`endZone`). A span the user typed carries
 *   no zone; the profile zone answers then, the zone the user lives the
 *   trip's dates in.
 * - The trip's CLOCK — the one its days are listed and filtered on — is the
 *   start zone, else the end zone, else the profile zone. One zone for the
 *   whole recording, so "day 3" is the same day for every point of it.
 */

export const TRIP_RECORDING_TRIP_SELECT = {
  id: true,
  name: true,
  startDate: true,
  endDate: true,
  startDay: true,
  endDay: true,
  startZone: true,
  endZone: true,
} as const;

export type RecordingTrip = TripTimeColumns & { id: string; name: string };

export interface TripRecordingBounds {
  /** First instant of the first day, inclusive. */
  fromMs: number;
  /** First instant AFTER the last day, exclusive. */
  untilMs: number;
  /** The trip's clock: the zone its days are named in. */
  zone: string;
  /** Recorder windows of the trip's flights, `[fromMs, toMs]` inclusive. */
  flightWindows: Array<[number, number]>;
}

const DAY_MS = 86_400_000;

const nextDay = (day: string): string => fromDbDate(new Date(toDbDate(day).getTime() + DAY_MS));

/** A machine reading: a midnight that a zone skips is placed, never refused. */
const midnight = (day: string, zone: string): number =>
  toInstant(`${day}T00:00:00`, zone, { origin: "machine" }).utc.getTime();

/** The zone the trip's days are named in; the profile zone only when the trip has none. */
export async function tripClockZone(userId: string, trip: TripTimeColumns): Promise<string> {
  return trip.startZone ?? trip.endZone ?? (await profileZoneOf(userId)).zone;
}

/**
 * The trip's span as instants, or null when the trip has no first or no last
 * day — a span the server cannot state places no point (abstention, not a
 * guess at which fixes belong to it).
 */
export async function tripSpanInstants(
  userId: string,
  trip: TripTimeColumns
): Promise<Pick<TripRecordingBounds, "fromMs" | "untilMs" | "zone"> | null> {
  const profile = trip.startZone && trip.endZone ? "UTC" : (await profileZoneOf(userId)).zone;
  return tripSpanInstantsIn(trip, profile);
}

/**
 * The trip's span as instants with `profileZone` answering for a missing trip
 * zone — for a span recorded in the past, read in the profile zone in force
 * then, not today's (TravTrack T7). Null when the trip has no first or no
 * last day.
 */
export function tripSpanInstantsIn(
  trip: TripTimeColumns,
  profileZone: string
): Pick<TripRecordingBounds, "fromMs" | "untilMs" | "zone"> | null {
  const span = tripDaySpan(trip);
  if (!span) return null;
  const startZone = trip.startZone ?? profileZone;
  const endZone = trip.endZone ?? profileZone;
  return {
    fromMs: midnight(span.start, startZone),
    untilMs: midnight(nextDay(span.end), endZone),
    zone: trip.startZone ?? trip.endZone ?? profileZone,
  };
}

/**
 * A scheduled end as a real instant, or null when it is a placeholder: a
 * date-only flight stores noon (`DATE_ONLY`), a year-only one midnight on the
 * 1st (`UNKNOWN`). Those locate the flight on the calendar, never at a minute,
 * and a window armed around them would drop real ground points as "in flight".
 */
const minuteInstant = (value: TimeValue | null): Date | null =>
  value && value.precision === "minute" ? new Date(value.utc) : null;

/** The columns a flight's recorder window is placed by. */
export const FLIGHT_WINDOW_SELECT = {
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
  onlineCheckInOpensAt: true,
  onlineCheckInZone: true,
  depIata: true,
  depIcao: true,
  arrIata: true,
  arrIcao: true,
} as const;

export type FlightWindowColumns = Prisma.FlightGetPayload<{ select: typeof FLIGHT_WINDOW_SELECT }>;

/**
 * One flight's recorder window, or null when it armed none — no real clock
 * on either end. The clocks are read through `flightTimes()`, the project's
 * one reader of a flight's times (ADR 0002).
 */
export async function flightRecorderWindow(
  f: FlightWindowColumns
): Promise<[number, number] | null> {
  const [dep, arr] = await Promise.all([
    getAirportTimezone(f.depIata ?? f.depIcao),
    getAirportTimezone(f.arrIata ?? f.arrIcao),
  ]);
  const times = flightTimes(f, { dep, arr });
  return recorderWindow({
    departure: minuteInstant(times.departure),
    arrival: minuteInstant(times.arrival),
  });
}

/** The recorder windows of these flights; those that armed nothing are left out. */
export async function flightRecorderWindows(
  flights: readonly FlightWindowColumns[]
): Promise<Array<[number, number]>> {
  const windows = await Promise.all(flights.map(flightRecorderWindow));
  return windows.filter((w): w is [number, number] => w !== null);
}

/** The recorder windows of the trip's flights; a cancelled flight armed nothing. */
export async function tripFlightWindows(
  userId: string,
  tripId: string
): Promise<Array<[number, number]>> {
  const flights = await prisma.flight.findMany({
    where: { tripId, userId, status: { not: "cancelled" } },
    select: FLIGHT_WINDOW_SELECT,
  });
  return flightRecorderWindows(flights);
}

export async function tripRecordingBounds(
  userId: string,
  trip: RecordingTrip
): Promise<TripRecordingBounds | null> {
  const span = await tripSpanInstants(userId, trip);
  if (!span) return null;
  return { ...span, flightWindows: await tripFlightWindows(userId, trip.id) };
}

export type PointVerdict = "accepted" | "outsideTrip" | "inFlight";

/** Which of the three a point at `tMs` is. Outside the trip wins over in-flight. */
export function classifyPoint(tMs: number, bounds: TripRecordingBounds): PointVerdict {
  if (tMs < bounds.fromMs || tMs >= bounds.untilMs) return "outsideTrip";
  return bounds.flightWindows.some(([from, to]) => tMs >= from && tMs <= to)
    ? "inFlight"
    : "accepted";
}
