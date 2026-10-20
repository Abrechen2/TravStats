import { prisma } from "../../db";
import { getCachedAirports } from "../airportCache";
import { enrichFlightsForClients } from "../flightAirportFacts";
import { railTimes } from "../rail/timesDto";
import { rentalTimes } from "../rental/timesDto";
import { airportDisplayName } from "../../utils/airportDisplay";
import logger from "../../utils/logger";
import { boundsOfInstants } from "./eventBounds";
import {
  FEED_ROW_LIMIT,
  feedEvent,
  iconOf,
  joined,
  present,
  queryCutoff,
  type FeedContext,
} from "./feedEvent";
import type { IcsEvent } from "./ics";

/**
 * Flights, train, bus and ferry rides and car rentals in the calendar feed
 * (forgejo#310): entries between two instants, each read through its domain's
 * `times` builder.
 */

const TRIP_ICON = "🧳";
const tripLine = (trip: { name: string } | null): string | null =>
  trip ? `${TRIP_ICON} ${trip.name}` : null;

/**
 * The readable name of each airport, codes where the catalogue has none. A
 * failed lookup costs the names, not the feed — the event keeps its codes, and
 * the failure is logged rather than passed off as "no name".
 */
async function airportNames(codes: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (codes.length === 0) return names;
  try {
    for (const [code, airport] of await getCachedAirports(codes)) {
      const name = airportDisplayName(airport);
      if (name) names.set(code.toUpperCase(), name);
    }
  } catch (error) {
    logger.warn({ operation: "calendar_feed_airport_names_failed", error });
  }
  return names;
}

export async function flightEvents(ctx: FeedContext): Promise<IcsEvent[]> {
  const from = queryCutoff(ctx);
  const rows = await prisma.flight.findMany({
    where: {
      userId: ctx.userId,
      status: { not: "cancelled" },
      OR: [{ departureTime: { gte: from } }, { arrivalTime: { gte: from } }],
    },
    orderBy: [{ departureTime: "asc" }, { id: "asc" }],
    take: FEED_ROW_LIMIT,
    select: {
      id: true,
      airline: true,
      airlineIata: true,
      flightNumber: true,
      depIata: true,
      depIcao: true,
      arrIata: true,
      arrIcao: true,
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
      updatedAt: true,
      trip: { select: { name: true } },
    },
  });
  // `times` through the one enrichment every client-bound flight passes: the
  // stored zone first, the catalogue's for a row written before zones existed,
  // and a legacy fake-UTC value read as the airport's wall clock.
  const flights = await enrichFlightsForClients(rows);
  const codes = [
    ...new Set(flights.flatMap((f) => [f.depIata, f.arrIata]).filter((c): c is string => !!c)),
  ];
  const names = await airportNames(codes);
  const end = (code: string | null): string =>
    code ? (names.get(code.toUpperCase()) ?? code) : "—";

  return flights
    .map((f) => {
      // "LH" + "LH2280" must not read "LH LH2280" — most stored numbers carry the prefix.
      const carrier = f.airlineIata ?? f.airline;
      const number =
        f.flightNumber && carrier && !f.flightNumber.toUpperCase().startsWith(carrier.toUpperCase())
          ? `${carrier} ${f.flightNumber}`
          : (f.flightNumber ?? null);
      return feedEvent(
        {
          uid: `flight-${f.id}`,
          summary: joined(" ", iconOf("flight"), `${end(f.depIata)} → ${end(f.arrIata)}`, number),
          bounds: boundsOfInstants(f.times.departure, f.times.arrival),
          location: joined(" → ", f.depIata, f.arrIata) || null,
          details: [f.airline, tripLine(f.trip)],
          path: `/flights/${f.id}`,
          updatedAt: f.updatedAt,
        },
        ctx
      );
    })
    .filter(present);
}

const RIDE_TIME_SELECT = {
  id: true,
  depStationName: true,
  arrStationName: true,
  departureTime: true,
  arrivalTime: true,
  actualDepartureTime: true,
  actualArrivalTime: true,
  depTimezone: true,
  arrTimezone: true,
  depPrecision: true,
  arrPrecision: true,
  operator: true,
  updatedAt: true,
  trip: { select: { name: true } },
} as const;

/** A ride whose arrival may be unknown: found by its departure, or by an arrival inside the window. */
const rideWhere = (ctx: FeedContext) => {
  const from = queryCutoff(ctx);
  return {
    userId: ctx.userId,
    status: { not: "cancelled" },
    OR: [{ departureTime: { gte: from } }, { arrivalTime: { gte: from } }],
  };
};
const RIDE_ORDER = [{ departureTime: "asc" as const }, { id: "asc" as const }];

export async function railEvents(ctx: FeedContext): Promise<IcsEvent[]> {
  const rows = await prisma.railJourney.findMany({
    where: rideWhere(ctx),
    orderBy: RIDE_ORDER,
    take: FEED_ROW_LIMIT,
    select: { ...RIDE_TIME_SELECT, trainCategory: true, trainNumber: true },
  });
  return rows
    .map((r) => {
      const times = railTimes(r);
      const train = joined(" ", r.trainCategory, r.trainNumber);
      return feedEvent(
        {
          uid: `rail-${r.id}`,
          summary: joined(" ", iconOf("rail"), `${r.depStationName} → ${r.arrStationName}`, train),
          bounds: boundsOfInstants(times.departure, times.arrival),
          location: r.depStationName,
          details: [r.operator, tripLine(r.trip)],
          path: `/rail/${r.id}`,
          updatedAt: r.updatedAt,
        },
        ctx
      );
    })
    .filter(present);
}

export async function busEvents(ctx: FeedContext): Promise<IcsEvent[]> {
  const rows = await prisma.busJourney.findMany({
    where: rideWhere(ctx),
    orderBy: RIDE_ORDER,
    take: FEED_ROW_LIMIT,
    select: { ...RIDE_TIME_SELECT, lineName: true },
  });
  return rows
    .map((r) => {
      const times = railTimes(r);
      return feedEvent(
        {
          uid: `bus-${r.id}`,
          summary: joined(
            " ",
            iconOf("bus"),
            `${r.depStationName} → ${r.arrStationName}`,
            r.lineName
          ),
          bounds: boundsOfInstants(times.departure, times.arrival),
          location: r.depStationName,
          details: [r.operator, tripLine(r.trip)],
          path: `/bus/${r.id}`,
          updatedAt: r.updatedAt,
        },
        ctx
      );
    })
    .filter(present);
}

export async function ferryEvents(ctx: FeedContext): Promise<IcsEvent[]> {
  const rows = await prisma.ferryJourney.findMany({
    where: rideWhere(ctx),
    orderBy: RIDE_ORDER,
    take: FEED_ROW_LIMIT,
    select: { ...RIDE_TIME_SELECT, vesselName: true },
  });
  return rows
    .map((r) => {
      const times = railTimes(r);
      return feedEvent(
        {
          uid: `ferry-${r.id}`,
          summary: joined(" ", iconOf("ferry"), `${r.depStationName} → ${r.arrStationName}`),
          bounds: boundsOfInstants(times.departure, times.arrival),
          location: r.depStationName,
          details: [joined(" · ", r.operator, r.vesselName), tripLine(r.trip)],
          path: `/ferry/${r.id}`,
          updatedAt: r.updatedAt,
        },
        ctx
      );
    })
    .filter(present);
}

export async function rentalEvents(ctx: FeedContext): Promise<IcsEvent[]> {
  const rows = await prisma.rentalBooking.findMany({
    where: {
      userId: ctx.userId,
      status: { not: "cancelled" },
      returnTime: { gte: queryCutoff(ctx) },
    },
    orderBy: [{ pickupTime: "asc" }, { id: "asc" }],
    take: FEED_ROW_LIMIT,
    select: {
      id: true,
      provider: true,
      pickupStationName: true,
      returnStationName: true,
      vehicleClass: true,
      pickupTime: true,
      returnTime: true,
      actualPickupTime: true,
      actualReturnTime: true,
      pickupTimezone: true,
      returnTimezone: true,
      pickupPrecision: true,
      returnPrecision: true,
      actualPickupPrecision: true,
      actualReturnPrecision: true,
      freeCancellationUntil: true,
      freeCancellationOn: true,
      freeCancellationZone: true,
      paymentDueOn: true,
      updatedAt: true,
      trip: { select: { name: true } },
    },
  });
  return rows
    .map((r) => {
      const times = rentalTimes(r);
      return feedEvent(
        {
          uid: `rental-${r.id}`,
          summary: joined(" ", iconOf("rental"), joined(" · ", r.provider, r.pickupStationName)),
          bounds: boundsOfInstants(times.pickup, times.return),
          location: r.pickupStationName,
          details: [
            r.returnStationName !== r.pickupStationName ? `→ ${r.returnStationName}` : null,
            r.vehicleClass,
            tripLine(r.trip),
          ],
          path: `/rentals/${r.id}`,
          updatedAt: r.updatedAt,
        },
        ctx
      );
    })
    .filter(present);
}
