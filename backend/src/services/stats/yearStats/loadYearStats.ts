import { prisma } from "../../../db";
import { now as clockNow } from "../../../shared/time/clock";
import { buildYearStats, type RecordedMonth, type YearStats } from "../../../utils/stats/yearStats";
import { providerIs } from "../../locationProvider/provider";
import { loadDistanceEntries } from "./loadEntries";

/**
 * TravTrack's side of the cards: the ground kilometres per UTC month (the projection's
 * `travtrack_month_values`, privacy zones already left out) and the number of stored points.
 * `null` for both when the account's location source is not TravTrack — no recording means
 * "nothing to show", not "0 km recorded".
 */
async function loadRecorded(
  userId: string
): Promise<{ months: RecordedMonth[]; points: number } | null> {
  if (!(await providerIs(userId, "travtrack"))) return null;
  const [rows, points] = await Promise.all([
    prisma.travTrackMonthValue.findMany({
      where: { userId },
      select: { month: true, kmGround: true },
    }),
    prisma.travTrackPoint.count({ where: { userId } }),
  ]);
  return {
    months: rows.map((r) => ({ month: r.month.toISOString().slice(0, 7), km: r.kmGround })),
    points,
  };
}

/** `GET /stats/years` — one query per domain plus two for TravTrack, whatever the year count. */
export async function loadYearStats(userId: string): Promise<YearStats> {
  const [entries, recorded] = await Promise.all([
    loadDistanceEntries(userId, clockNow()),
    loadRecorded(userId),
  ]);
  return buildYearStats({
    entries,
    recordedMonths: recorded?.months ?? null,
    recordedPoints: recorded?.points ?? null,
  });
}
