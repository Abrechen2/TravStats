import { profileZoneOf } from "../shared/time/profileZone";
import { prisma } from "../db";
import { deriveTripStatus, tripDateBounds, tripStatusBounds } from "../shared/statusDerivation";
import { flightEnds, segmentTripDays, typedTripDays } from "./timeModel/tripColumns";

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
    },
  });
  if (!trip) return;
  if (trip.startDate != null || trip.endDate != null) return;

  // A ride has the flight's shape (departure, arrival), so it joins them.
  const bounds = tripDateBounds([...trip.flights, ...trip.railJourneys], trip.cruises);
  if (bounds.earliestStart == null && bounds.latestEnd == null) return;

  // The local days of the first departure and the last arrival (ADR 0002,
  // owner decision on open point 1). A cruise's ends are days already, so a
  // span that includes one keeps its UTC days without a zone.
  const { starts, ends } = flightEnds([...trip.flights, ...trip.railJourneys]);
  const days =
    trip.cruises.length > 0
      ? typedTripDays({ startDate: bounds.earliestStart, endDate: bounds.latestEnd })
      : segmentTripDays(starts, ends);
  await prisma.trip.update({
    where: { id: tripId },
    data: { startDate: bounds.earliestStart, endDate: bounds.latestEnd, ...days },
  });
}

export async function recomputeTripStatus(tripId: string): Promise<void> {
  const trip = await prisma.trip.findUnique({
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
      railJourneys: { select: { departureTime: true, arrivalTime: true } },
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
    railJourneys: trip.railJourneys,
    rentals: trip.rentalBookings,
    ownStartDate: trip.startDate,
    ownEndDate: trip.endDate,
    zone: (await profileZoneOf(trip.userId)).zone,
  });
  const derived = deriveTripStatus(bounds);
  if (derived == null || derived === trip.status) return;

  await prisma.trip.update({ where: { id: tripId }, data: { status: derived } });
}
