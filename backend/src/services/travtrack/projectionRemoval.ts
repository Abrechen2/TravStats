/**
 * What a removal of TravTrack history does to the projections derived from it
 * (TravTrack plan E6, E5): the `travtrack` country days of the removed days —
 * the UTC days of the points that went, collected before they went
 * (`removedHistory.ts`) — are deleted in the removal's own transaction, and
 * those days and their neighbours are marked dirty: the next projection run
 * re-derives whatever of a day is left, and a neighbour re-reads its edge,
 * whose context fixes may have been among the removed ones (`dirtyDays.ts`).
 * Dawarich's rows are another source and never touched.
 */
import type { DbTransaction } from "../../db";
import type { PointsRemovedCause } from "./deleteRange";
import { markTravTrackDaysDirty, utcDayOf } from "./dirtyDays";

const DAY_MS = 86_400_000;

const dayMs = (day: string) => Date.parse(`${day}T00:00:00.000Z`);

/** Deletes the `travtrack` country days of `days`; marks them and their neighbours dirty. */
export async function projectionsOnHistoryDeleted(
  tx: DbTransaction,
  userId: string,
  days: readonly string[]
): Promise<void> {
  if (days.length === 0) return;
  await tx.countryDay.deleteMany({
    where: {
      userId,
      source: "travtrack",
      date: { in: days.map((d) => new Date(dayMs(d))) },
    },
  });
  const marked = new Set<string>();
  for (const day of days) {
    const ms = dayMs(day);
    marked.add(utcDayOf(ms - DAY_MS));
    marked.add(day);
    marked.add(utcDayOf(ms + DAY_MS));
  }
  await markTravTrackDaysDirty(tx, userId, [...marked].sort());
}

/** The removal hook (`onPointsRemoved`): every cause names the days it emptied. */
export function projectionsOnPointsRemoved(
  tx: DbTransaction,
  userId: string,
  cause: PointsRemovedCause
): Promise<void> {
  return projectionsOnHistoryDeleted(tx, userId, cause.days);
}
