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
 * (no cruises, stops, route sections, journal entries, photos, notes, or
 * description). Anything curated by hand is never offered for dissolution
 * — a trip whose only content is a hand-made route section must not be
 * offered either, since dissolving it cascades that section away.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { linkRowsFor, resolveCompanions } from "./companionService";
import { AppError } from "../middleware/errorHandler";
import logger from "../utils/logger";
import { recomputeTripStatus } from "./tripStatusService";
import { mergeImmichAlbums, mergeTripPhotos } from "./trip/mergeTripRelations";

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

/**
 * What "this trip holds nothing" means — the ONE definition, used both to
 * offer a trip as a candidate and to let the delete through.
 *
 * It used to name six relations and two text fields, all of them from before
 * the app had more than flights. A trip with a hotel stay, a place visit, a
 * linked Immich album or an AI summary counted as empty, so a deliberately
 * confirmed cleanup could remove curated non-flight trips — and the dialog
 * pre-selects everything it is offered (audit finding AUD-031).
 *
 * The rule is the trip model's own relation list plus every field a person can
 * only have filled in by hand. `bookings` is deliberately absent: a legacy
 * one-booking auto-trip is exactly what this feature exists to clear away.
 */
export const EMPTY_TRIP_COUNTS = {
  flights: true,
  cruises: true,
  stops: true,
  routes: true,
  journalEntries: true,
  photos: true,
  lodgingStays: true,
  placeVisits: true,
  immichAlbums: true,
} as const;

/** The same rule as a Prisma `where` fragment, so a DELETE re-checks it in the
 *  database rather than trusting a list assembled a moment earlier. */
export const EMPTY_TRIP_WHERE = {
  cruises: { none: {} },
  stops: { none: {} },
  routes: { none: {} },
  journalEntries: { none: {} },
  photos: { none: {} },
  lodgingStays: { none: {} },
  placeVisits: { none: {} },
  immichAlbums: { none: {} },
  notes: null,
  description: null,
  summary: null,
  category: null,
  icon: null,
  coverImageUrl: null,
  tags: { isEmpty: true },
  companions: { isEmpty: true },
} satisfies Prisma.TripWhereInput;

interface EmptinessProbe {
  notes: string | null;
  description: string | null;
  summary: string | null;
  category: string | null;
  icon: string | null;
  coverImageUrl: string | null;
  tags: string[];
  companions: string[];
  _count: Record<keyof typeof EMPTY_TRIP_COUNTS, number>;
}

function isTripEmpty(t: EmptinessProbe): boolean {
  const holdsNothing = (Object.keys(EMPTY_TRIP_COUNTS) as Array<keyof typeof EMPTY_TRIP_COUNTS>)
    .filter((k) => k !== "flights")
    .every((k) => t._count[k] === 0);
  return (
    holdsNothing &&
    !t.notes &&
    !t.description &&
    !t.summary &&
    !t.category &&
    !t.icon &&
    !t.coverImageUrl &&
    t.tags.length === 0 &&
    t.companions.length === 0
  );
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
      summary: true,
      category: true,
      icon: true,
      coverImageUrl: true,
      tags: true,
      companions: true,
      _count: { select: EMPTY_TRIP_COUNTS },
    },
    orderBy: { startDate: "desc" },
  });

  return trips
    .filter((t) => t._count.flights <= MICRO_TRIP_MAX_FLIGHTS && isTripEmpty(t))
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
 *
 * No recomputeTripStatus() call here: dissolution only DELETES trip rows.
 * Flights/cruises/bookings.tripId all use `onDelete: SetNull` (see
 * schema.prisma), so they end up unlinked (tripId = null), not relinked to
 * a surviving trip — there is no target trip whose derived status could be
 * stale.
 */
export async function dissolveMicroTrips(
  userId: string,
  tripIds: string[]
): Promise<{ dissolved: number; skipped: number }> {
  const candidates = await findMicroTripCandidates(userId);
  const allowed = new Set(candidates.map((c) => c.id));
  const ids = tripIds.filter((id) => allowed.has(id));

  // The emptiness rule is re-evaluated by the DELETE itself, so content added
  // between the candidate scan and this statement keeps the trip alive rather
  // than racing it. The flight COUNT still comes from the scan — Prisma cannot
  // express "at most two" in a where clause — and gaining a third flight is not
  // the loss this guards against: dissolving keeps flights either way.
  const result = await prisma.trip.deleteMany({
    where: { id: { in: ids }, userId, ...EMPTY_TRIP_WHERE },
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

  // The merged companions array is a union of every source trip's legacy
  // array, so the target's links must be rebuilt from that same union —
  // not carried over from the target's pre-merge links, which cover only
  // its own original companions. resolveCompanions() uses the top-level
  // Prisma client, so it must run BEFORE the transaction (same reasoning
  // as routes/trips.ts): find-or-create is idempotent and safe outside a
  // transaction, and the resolved ids are only written inside it, so a
  // failure between the two never leaves the array and `companionLinks`
  // disagreeing.
  const unionedCompanionNames = union(trips.map((t) => t.companions));
  const resolvedCompanions = await resolveCompanions(userId, unionedCompanionNames);

  // Reported in the merge log — a folded duplicate is a decision, not a
  // no-op, and the only place it is visible afterwards is this line.
  let mergedDuplicates = { albums: 0, photos: 0 };

  await prisma.$transaction(async (tx) => {
    const move = { where: { tripId: { in: sourceIds } }, data: { tripId: targetId } };
    await tx.flight.updateMany(move);
    await tx.cruise.updateMany(move);
    await tx.booking.updateMany(move);
    await tx.tripStop.updateMany(move);
    // Sections move with their stops. Without this a section stays on a trip
    // that is about to be deleted, and its stops end up on another trip —
    // a route pointing at nothing.
    await tx.tripRoute.updateMany(move);
    await tx.tripJournalEntry.updateMany(move);
    // Hotel stays and place visits are `SetNull` on the trip, so leaving them
    // behind does not delete them — it silently unfiles them, which is the
    // same loss to a user looking for their hotel on the merged trip.
    await tx.lodgingStay.updateMany(move);
    await tx.placeVisit.updateMany(move);
    // Albums BEFORE photos: an album left on a source trip is cascade-deleted
    // with it, and takes the photos this merge just moved with it (AUD-029).
    const duplicateAlbums = await mergeImmichAlbums(tx, sourceIds, targetId);
    // Photo files live in a flat directory keyed by filename, so moving
    // the rows does not break file paths.
    const duplicatePhotos = await mergeTripPhotos(tx, sourceIds, targetId);
    mergedDuplicates = { albums: duplicateAlbums, photos: duplicatePhotos };

    await tx.trip.update({
      where: { id: targetId },
      data: {
        name: name ?? target.name,
        startDate,
        endDate,
        tags: union(trips.map((t) => t.tags)),
        // Dual write: resolved display names keep this legacy array in
        // agreement with `companionLinks` below — a name that appears in
        // two source trips with different spellings collapses in both
        // stores identically (same pattern as routes/trips.ts).
        companions: resolvedCompanions.map((c) => c.displayName),
        countries: union(trips.map((t) => t.countries)),
        coverImageUrl: target.coverImageUrl ?? sources.find((s) => s.coverImageUrl)?.coverImageUrl,
        notes:
          [target.notes, ...sources.map((s) => s.notes)]
            .filter((n): n is string => !!n)
            .join("\n\n") || null,
      },
    });

    // The target's own links only cover its pre-merge companions; the
    // source trips' TripCompanion rows are about to be cascade-deleted
    // along with their trips (onDelete: Cascade), so they are never a
    // basis to build on. Replace wholesale from the unioned+resolved list,
    // same delete-then-recreate pattern as the update handler.
    await tx.tripCompanion.deleteMany({ where: { tripId: targetId } });
    if (resolvedCompanions.length > 0) {
      await tx.tripCompanion.createMany({
        data: linkRowsFor(resolvedCompanions.map((c) => c.id)).map((row) => ({
          ...row,
          tripId: targetId,
        })),
        skipDuplicates: true,
      });
    }

    await tx.trip.deleteMany({ where: { id: { in: sourceIds }, userId } });
  });

  // Segments from every source trip are now linked to the target — its
  // stored status is stale (still whatever it derived to BEFORE the merge
  // widened its date bounds). Recompute AFTER the transaction commits, same
  // pattern as every other segment-relinking write path (assign/remove
  // flights, booking links, trip auto-detection — see tripStatusService.ts).
  await recomputeTripStatus(targetId);

  logger.info({
    operation: "trips_merge",
    message: `Merged ${sources.length} trips into ${targetId}`,
    context: {
      userId,
      targetId,
      merged: sources.length,
      duplicateAlbumsFolded: mergedDuplicates.albums,
      duplicatePhotosDropped: mergedDuplicates.photos,
    },
  });

  return { tripId: targetId, merged: sources.length };
}
