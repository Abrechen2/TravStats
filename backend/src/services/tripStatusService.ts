import { profileZoneOf } from "../shared/time/profileZone";
import { RAIL_CLOCK_SELECT, rideStatusSpan } from "../shared/railClock";
import { prisma, type DbTransaction } from "../db";
import { deriveTripStatus, tripStatusBounds } from "../shared/statusDerivation";
import { segmentTripSpan } from "./timeModel/tripColumns";

/**
 * Recompute a single trip's status from its linked flights/cruises date
 * bounds (spec 2026-07-17-status-from-dates). Every write path that
 * mutates a trip's segments (assign/remove flights, booking flightIds
 * link, PNR auto-trip creation, trip auto-detection) calls this after the
 * mutation so the stored status stays converged without waiting for the
 * hourly sweep (services/statusSweep.ts, which shares the same
 * `tripDateBounds` + `deriveTripStatus` derivation).
 *
 * No-op when the trip has no dated segments (derivation returns null — a
 * fresh trip keeps whatever status it was created/left with) or the
 * derived status already matches the stored one.
 */
/**
 * Fill a trip's startDate/endDate from its linked segments — but ONLY when
 * both are still empty. Called at the silent auto-creation sites (trip
 * detection; the batch import sets the bounds inline at create), never from
 * sweeps or generic recomputes: a date the user set by hand is a plan and
 * must not be "corrected" from flight data (blocked board item
 * trip-plan-vs-actual owns that separation).
 */
export async function fillTripDatesFromSegments(tripId: string): Promise<void> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      startDate: true,
      endDate: true,
      flights: {
        select: {
          departureTime: true,
          arrivalTime: true,
          depTimezone: true,
          arrTimezone: true,
          depLat: true,
          depLon: true,
          arrLat: true,
          arrLon: true,
        },
      },
      cruises: { select: { startDate: true, endDate: true } },
      railJourneys: {
        select: {
          departureTime: true,
          arrivalTime: true,
          depTimezone: true,
          arrTimezone: true,
          depLat: true,
          depLon: true,
          arrLat: true,
          arrLon: true,
        },
      },
      ferryJourneys: { select: RAIL_CLOCK_SELECT },
      busJourneys: {
        select: {
          departureTime: true,
          arrivalTime: true,
          depTimezone: true,
          arrTimezone: true,
          depLat: true,
          depLon: true,
          arrLat: true,
          arrLon: true,
        },
      },
    },
  });
  if (!trip) return;
  if (trip.startDate != null || trip.endDate != null) return;

  // A ride has the flight's shape (departure, arrival), so it joins them.
  const span = segmentTripSpan(
    [...trip.flights, ...trip.railJourneys, ...trip.busJourneys, ...trip.ferryJourneys],
    trip.cruises
  );
  if (!span) return;
  await prisma.trip.update({ where: { id: tripId }, data: span });
}

/**
 * `client` lets a caller inside a transaction (sharing propagation, ride
 * create with receipts) read the rows it has just written instead of the
 * committed state.
 */
export async function recomputeTripStatus(
  tripId: string,
  client: Pick<DbTransaction, "trip" | "userSettings"> = prisma
): Promise<void> {
  const trip = await client.trip.findUnique({
    where: { id: tripId },
    select: {
      userId: true,
      status: true,
      startDate: true,
      endDate: true,
      flights: { select: { departureTime: true, arrivalTime: true } },
      cruises: { select: { startDate: true, endDate: true } },
      lodgingStays: { select: { checkIn: true, checkOut: true } },
      routes: {
        where: { kind: "roadtrip" },
        select: { stops: { select: { startDate: true, endDate: true } } },
      },
      railJourneys: { select: RAIL_CLOCK_SELECT },
      ferryJourneys: { select: RAIL_CLOCK_SELECT },
      busJourneys: { select: RAIL_CLOCK_SELECT },
      rentalBookings: {
        where: { status: { not: "cancelled" } },
        select: { pickupTime: true, returnTime: true },
      },
    },
  });
  if (!trip) return;

  // Segments first, the trip's own dates as the fallback — see the rule in
  // `tripStatusBounds`. A trip with neither used to keep whatever status it
  // was created with, for ever (AUD-024).
  const bounds = tripStatusBounds({
    flights: trip.flights,
    cruises: trip.cruises,
    lodgingStays: trip.lodgingStays,
    roadtrips: trip.routes,
    // Bus rides carry rail's clock columns and join its bounds (spec 2026-10-07 §8).
    railJourneys: [...trip.railJourneys, ...trip.busJourneys, ...trip.ferryJourneys].map(
      rideStatusSpan
    ),
    rentals: trip.rentalBookings,
    ownStartDate: trip.startDate,
    ownEndDate: trip.endDate,
    // Through `client` too: inside a transaction a global read would take a
    // second pool connection while the first holds locks.
    zone: (await profileZoneOf(trip.userId, client)).zone,
  });
  const derived = deriveTripStatus(bounds);
  if (derived == null || derived === trip.status) return;

  await client.trip.update({ where: { id: tripId }, data: { status: derived } });
}
