import { prisma } from "../db";
import { deriveTripStatus, tripDateBounds } from "../shared/statusDerivation";

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
      flights: { select: { departureTime: true, arrivalTime: true } },
      cruises: { select: { startDate: true, endDate: true } },
    },
  });
  if (!trip) return;
  if (trip.startDate != null || trip.endDate != null) return;

  const bounds = tripDateBounds(trip.flights, trip.cruises);
  if (bounds.earliestStart == null && bounds.latestEnd == null) return;

  await prisma.trip.update({
    where: { id: tripId },
    data: { startDate: bounds.earliestStart, endDate: bounds.latestEnd },
  });
}

export async function recomputeTripStatus(tripId: string): Promise<void> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      status: true,
      flights: { select: { departureTime: true, arrivalTime: true } },
      cruises: { select: { startDate: true, endDate: true } },
    },
  });
  if (!trip) return;

  const bounds = tripDateBounds(trip.flights, trip.cruises);
  const derived = deriveTripStatus(bounds);
  if (derived == null || derived === trip.status) return;

  await prisma.trip.update({ where: { id: tripId }, data: { status: derived } });
}
