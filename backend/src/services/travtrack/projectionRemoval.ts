/**
 * What a removal of TravTrack history does to the projections derived from it
 * (TravTrack plan E6; E5 builds the rest of the removal handler): the
 * `travtrack` country days of the removed days are deleted in the removal's
 * own transaction, and those days are marked dirty, so the next projection run
 * re-derives whatever of them is left. Dawarich's rows are another source and
 * never touched.
 *
 * EXTENSION POINT for E5: E5 computes the removed points' days before they
 * go (`cause.removed.days`) and calls `projectionsOnHistoryDeleted` with
 * them. Until then the days come from the cause itself:
 *   - a range: every UTC day it touches. Its inner days lost all their points,
 *     its two edge days may keep some; all are deleted and marked.
 *   - a zone: which days it emptied is not known after the delete, so every
 *     day holding a `travtrack` country row is marked dirty (not deleted) and
 *     re-derived over the following runs. Correct, only slower than E5's.
 */
import type { DbTransaction } from "../../db";
import type { PointsRemovedCause } from "./deleteRange";
import { markTravTrackDaysDirty, utcDayOf } from "./dirtyDays";

const DAY_MS = 86_400_000;

const midnight = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;

/** Deletes the `travtrack` country days of `days` and marks them dirty. */
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
      date: { in: days.map((d) => new Date(`${d}T00:00:00.000Z`)) },
    },
  });
  await markTravTrackDaysDirty(tx, userId, days);
}

/** The removal hook (`onPointsRemoved`), until E5 hands over `removed.days`. */
export async function projectionsOnPointsRemoved(
  tx: DbTransaction,
  userId: string,
  cause: PointsRemovedCause
): Promise<void> {
  if (cause.kind === "range") {
    const fromMs = cause.from.getTime();
    const toMs = cause.to.getTime();
    if (!(toMs > fromMs)) return;
    const first = midnight(fromMs);
    const endExclusive = midnight(toMs - 1) + DAY_MS;
    // Inner days lost every point: delete their rows in one statement,
    // however long the range. Only the two edge days can keep a point, so
    // only they need re-deriving.
    await tx.countryDay.deleteMany({
      where: {
        userId,
        source: "travtrack",
        date: { gte: new Date(first), lt: new Date(endExclusive) },
      },
    });
    // The edge days may keep points; their outer neighbours read them as context.
    await markTravTrackDaysDirty(tx, userId, [
      utcDayOf(first - DAY_MS),
      utcDayOf(first),
      utcDayOf(endExclusive - DAY_MS),
      utcDayOf(endExclusive),
    ]);
    return;
  }
  const held = await tx.countryDay.findMany({
    where: { userId, source: "travtrack" },
    select: { date: true },
    distinct: ["date"],
  });
  await markTravTrackDaysDirty(
    tx,
    userId,
    held.map((r) => r.date.toISOString().slice(0, 10))
  );
}
