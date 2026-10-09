/**
 * The references a new flight may carry, checked against the caller — split
 * out of `routes/flights.ts`, which is frozen at its size.
 *
 * Prisma only enforces that a referenced row EXISTS, never whose it is; each
 * check here is the AUD-038 rule for one reference.
 */
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";

/**
 * The import batch a mail-imported flight belongs to. A batch of someone
 * else's is simply not found, and the flight is created unbatched: the row
 * the user asked for matters more than the undo record.
 */
export async function ownedImportBatchId(
  userId: string,
  importBatchId: string | null | undefined
): Promise<string | null> {
  if (!importBatchId) return null;
  const batch = await prisma.importBatch.findFirst({
    where: { id: importBatchId, userId, domain: "flight" },
    select: { id: true },
  });
  return batch?.id ?? null;
}

/**
 * The trip a new flight is filed on (#355). Unlike the batch, a trip that is
 * not the caller's is refused: the user asked for the flight to be ON that
 * trip, and a flight quietly filed nowhere is the bug this exists to end.
 */
export async function ownedTripId(
  userId: string,
  tripId: string | null | undefined
): Promise<string | null> {
  if (!tripId) return null;
  const trip = await prisma.trip.findFirst({ where: { id: tripId, userId }, select: { id: true } });
  if (!trip) throw new AppError("Trip not found", 404, "TRIP_NOT_FOUND", "tripId");
  return trip.id;
}

/**
 * The batch form of `ownedTripId`: every distinct trip the rows name, in one
 * query. The first row naming a trip that is not the caller's refuses the
 * whole batch, and `row` (0-based) says which one.
 */
export async function ownedTripIds(
  userId: string,
  tripIds: ReadonlyArray<string | null | undefined>
): Promise<void> {
  const named = [...new Set(tripIds.filter((id): id is string => !!id))];
  if (named.length === 0) return;
  const owned = new Set(
    (
      await prisma.trip.findMany({
        where: { id: { in: named }, userId },
        select: { id: true },
      })
    ).map((t) => t.id)
  );
  const row = tripIds.findIndex((id) => !!id && !owned.has(id));
  if (row >= 0) throw new AppError("Trip not found", 404, "TRIP_NOT_FOUND", "tripId", { row });
}
