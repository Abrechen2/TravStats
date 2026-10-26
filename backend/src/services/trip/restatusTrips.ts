import { prisma, type DbTransaction } from "../../db";
import { recomputeTripStatus } from "../tripStatusService";

/**
 * A ride extends its trip's span, so every rail, bus and ferry write
 * re-derives the status of the trip it was in and the trip it is in now
 * (owner decision 6 of the rail spec). Each trip once, none for a ride
 * without one. Pass the transaction when the write is still open, so the
 * derivation reads the rows it is about to commit.
 *
 * One home: rail, bus and ferry each carried an identical copy.
 */
export async function restatusTrips(
  tripIds: ReadonlyArray<string | null | undefined>,
  db: Pick<DbTransaction, "trip" | "userSettings"> = prisma
): Promise<void> {
  for (const id of new Set(tripIds.filter((t): t is string => Boolean(t)))) {
    await recomputeTripStatus(id, db);
  }
}
