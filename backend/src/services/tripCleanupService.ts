/**
 * Trip cleanup — companion to the trip-detection overhaul ("a trip is a
 * journey, not a booking"). Two operations:
 *
 *  - Dissolve: find "micro-trips" (legacy auto-detection artifacts that
 *    wrap a single booking) and delete the trip rows. Linked flights and
 *    bookings survive — their FKs are `onDelete: SetNull` — so dissolving
 *    never loses logbook data, it only removes the container.
 *
 *  - Merge: combine several trips into one real journey ("Japan 2025").
 *    All linked entities (flights, cruises, bookings, stops, journal
 *    entries, photos) move to the target trip; metadata arrays are
 *    unioned; the date span widens to cover all sources.
 *
 * Candidate criteria are deliberately conservative: a trip qualifies as
 * a micro-trip only when it carries NO user content beyond its flights
 * (no cruises, stops, journal entries, photos, notes, or description).
 * Anything curated by hand is never offered for dissolution.
 */

import { prisma } from "../db";
import { AppError } from "../middleware/errorHandler";
import logger from "../utils/logger";

/** A trip is "micro" when it has at most this many flights. Matches the
 *  shape of the legacy one-booking auto-trips (outbound + return). */
const MICRO_TRIP_MAX_FLIGHTS = 2;

export interface MicroTripCandidate {
  id: string;
  name: string;
  color: string;
  flightCount: number;
  startDate: string | null;
  endDate: string | null;
}

/** List the user's trips that qualify for dissolution. */
export async function findMicroTripCandidates(userId: string): Promise<MicroTripCandidate[]> {
  const trips = await prisma.trip.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      color: true,
      notes: true,
      description: true,
      startDate: true,
      endDate: true,
      _count: {
        select: { flights: true, cruises: true, stops: true, journalEntries: true, photos: true },
      },
    },
    orderBy: { startDate: "desc" },
  });

  return trips
    .filter(
      (t) =>
        t._count.flights <= MICRO_TRIP_MAX_FLIGHTS &&
        t._count.cruises === 0 &&
        t._count.stops === 0 &&
        t._count.journalEntries === 0 &&
        t._count.photos === 0 &&
        !t.notes &&
        !t.description
    )
    .map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      flightCount: t._count.flights,
      startDate: t.startDate ? t.startDate.toISOString() : null,
      endDate: t.endDate ? t.endDate.toISOString() : null,
    }));
}

/**
 * Delete the given trips, keeping their flights/bookings (FKs SetNull).
 * Every id is re-validated against the candidate criteria server-side —
 * a stale client list can never dissolve a trip that gained content in
 * the meantime. Returns how many were dissolved vs. skipped.
 */
export async function dissolveMicroTrips(
  userId: string,
  tripIds: string[]
): Promise<{ dissolved: number; skipped: number }> {
  const candidates = await findMicroTripCandidates(userId);
  const allowed = new Set(candidates.map((c) => c.id));
  const ids = tripIds.filter((id) => allowed.has(id));

  const result = await prisma.trip.deleteMany({
    where: { id: { in: ids }, userId },
  });

  logger.info({
    operation: "trips_dissolve_micro",
    message: `Dissolved ${result.count} micro-trips (${tripIds.length - ids.length} skipped)`,
    context: { userId, requested: tripIds.length, dissolved: result.count },
  });

  return { dissolved: result.count, skipped: tripIds.length - ids.length };
}

export interface MergeTripsInput {
  tripIds: string[];
  /** Optional new name for the merged trip; defaults to the target's name. */
  name?: string;
  /** Which trip survives. Must be one of tripIds; defaults to the first. */
  targetId?: string;
}

/** Merge several trips into one. Returns the surviving trip's id. */
export async function mergeTrips(
  userId: string,
  input: MergeTripsInput
): Promise<{ tripId: string; merged: number }> {
  const { tripIds, name } = input;
  const targetId = input.targetId ?? tripIds[0];
  if (!tripIds.includes(targetId)) {
    throw new AppError("targetId must be one of tripIds", 400);
  }

  const trips = await prisma.trip.findMany({
    where: { id: { in: tripIds }, userId },
  });
  if (trips.length !== tripIds.length) {
    throw new AppError("One or more trips not found", 404);
  }

  const target = trips.find((t) => t.id === targetId)!;
  const sources = trips.filter((t) => t.id !== targetId);
  const sourceIds = sources.map((t) => t.id);

  const union = (arrays: string[][]): string[] => [...new Set(arrays.flat())];
  const dates = trips.flatMap((t) => [t.startDate, t.endDate]).filter((d): d is Date => d !== null);
  const startDate = dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
  const endDate = dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;

  await prisma.$transaction(async (tx) => {
    const move = { where: { tripId: { in: sourceIds } }, data: { tripId: targetId } };
    await tx.flight.updateMany(move);
    await tx.cruise.updateMany(move);
    await tx.booking.updateMany(move);
    await tx.tripStop.updateMany(move);
    await tx.tripJournalEntry.updateMany(move);
    // Photo files live in a flat directory keyed by filename, so moving
    // the rows does not break file paths.
    await tx.tripPhoto.updateMany(move);

    await tx.trip.update({
      where: { id: targetId },
      data: {
        name: name ?? target.name,
        startDate,
        endDate,
        tags: union(trips.map((t) => t.tags)),
        companions: union(trips.map((t) => t.companions)),
        countries: union(trips.map((t) => t.countries)),
        coverImageUrl: target.coverImageUrl ?? sources.find((s) => s.coverImageUrl)?.coverImageUrl,
        notes:
          [target.notes, ...sources.map((s) => s.notes)]
            .filter((n): n is string => !!n)
            .join("\n\n") || null,
      },
    });

    await tx.trip.deleteMany({ where: { id: { in: sourceIds }, userId } });
  });

  logger.info({
    operation: "trips_merge",
    message: `Merged ${sources.length} trips into ${targetId}`,
    context: { userId, targetId, merged: sources.length },
  });

  return { tripId: targetId, merged: sources.length };
}
