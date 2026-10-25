/**
 * What a removal of TravTrack history does to the projections derived from it
 * (TravTrack plan E6, E5): the removed days — the UTC days of the points that
 * went, collected before they went (`removedHistory.ts`) — AND their
 * neighbours lose their `travtrack` country days in the removal's own
 * transaction, and all of them are marked dirty. A neighbour's rows were
 * derived with the removed points as edge context (`dirtyDays.ts`), so they
 * are as stale as the day's own (Codex review of E5/E6): left standing, a
 * question run or a country accept could publish from them under the new
 * generation. The next projection run re-derives whatever is left; until then
 * nothing reads those days (`unprojectedDaysIn`). Dawarich's rows are another
 * source and never touched. The explored map's cells (L1) and the monthly
 * values (L3) of the same days go the same way.
 */
import type { DbTransaction } from "../../db";
import type { PointsRemovedCause } from "./deleteRange";
import { markTravTrackDaysDirty, removalDays } from "./dirtyDays";
import { exploredOnHistoryDeleted } from "./explored/project";
import { monthsOnHistoryDeleted } from "./months/project";

const dayMs = (day: string) => Date.parse(`${day}T00:00:00.000Z`);

/** Deletes the `travtrack` country days of `days` and their neighbours, and marks them dirty. */
export async function projectionsOnHistoryDeleted(
  tx: DbTransaction,
  userId: string,
  days: readonly string[]
): Promise<void> {
  const affected = removalDays(days);
  if (affected.length === 0) return;
  await tx.countryDay.deleteMany({
    where: {
      userId,
      source: "travtrack",
      date: { in: affected.map((d) => new Date(dayMs(d))) },
    },
  });
  // The explored map's cells of the same days (L1), in the same transaction.
  await exploredOnHistoryDeleted(tx, userId, days);
  // The monthly values of their months (L3), likewise.
  await monthsOnHistoryDeleted(tx, userId, days);
  await markTravTrackDaysDirty(tx, userId, affected);
}

/** The removal hook (`onPointsRemoved`): every cause names the days it emptied. */
export function projectionsOnPointsRemoved(
  tx: DbTransaction,
  userId: string,
  cause: PointsRemovedCause
): Promise<void> {
  return projectionsOnHistoryDeleted(tx, userId, cause.days);
}
