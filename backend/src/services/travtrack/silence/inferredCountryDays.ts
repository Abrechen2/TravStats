import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import { localDay } from "../../../shared/time/instant";
import { profileZoneOf } from "../../../shared/time/profileZone";
import { MAX_ACCURACY_M } from "../../locationEvidence/anomaly";
import { replaceCountryDays, utcMidnight } from "../../countryDays/store";
import { privacyCircleSet } from "../privacyCircles";
import { distanceM } from "../classify";
import { judgeSilence, type SilenceEnd } from "./stationary";
import { interrupted, placesFor } from "./stationaryCoverage";

/**
 * Country days for silences spent standing at a known place (TravTrack home silence). A quiet
 * stretch at home sends no point, so the passport saw no day there. Every UTC day that lies
 * WHOLLY inside a silence whose two good end fixes are in one known place, with nothing
 * contradicting it (`interrupted`), becomes a `travtrack-inferred` row: the country of that
 * place, `pointCount` 0 — nothing was recorded. A separate source, so a reader that wants only
 * evidenced days leaves it out; never merged into the `travtrack` rows.
 *
 * Recomputed over a rolling window, replace-not-upsert, so a silence that later turns out to
 * contain a fix, or whose ends change, loses its rows. Days are UTC days like every country day
 * (ADR 0002 Q3); only a day wholly inside the silence counts, so the local-day edge never
 * claims a day the owner might have spent elsewhere.
 */

export const INFERRED_WINDOW_DAYS = 120;
const DAY_MS = 86_400_000;
const NULL_ISLAND_DEG = 0.0001;

type GapRow = {
  b_t: Date;
  b_lat: number;
  b_lon: number;
  a_t: Date;
  a_lat: number;
  a_lon: number;
};

export type InferredResult = { gaps: number; written: number };

/** Pairs of consecutive good fixes at least a day apart, newest data last, ending inside the window. */
async function gapsSince(userId: string, since: Date): Promise<GapRow[]> {
  const circlesAt = await privacyCircleSet(userId);
  const rows = await prisma.$queryRaw<
    Array<{ t: Date; lat: number; lon: number; prev_t: Date; prev_lat: number; prev_lon: number }>
  >(Prisma.sql`
    SELECT t, lat, lon, prev_t, prev_lat, prev_lon FROM (
      SELECT t, lat, lon,
             LAG(t) OVER w AS prev_t, LAG(lat) OVER w AS prev_lat, LAG(lon) OVER w AS prev_lon
      FROM travtrack_points
      WHERE user_id = ${userId} AND t >= ${new Date(since.getTime() - 400 * DAY_MS)}
        AND NOT COALESCE(accuracy_m > ${MAX_ACCURACY_M}, false)
        AND NOT (abs(lat) < ${NULL_ISLAND_DEG} AND abs(lon) < ${NULL_ISLAND_DEG})
      WINDOW w AS (ORDER BY t, seq)
    ) x
    WHERE prev_t IS NOT NULL AND t >= ${since} AND t - prev_t >= interval '1 day'
    ORDER BY t`);
  // Privacy circles are checked here, per fix, as the day view does; a pair with a hidden end is
  // skipped (its true neighbour is the hidden fix, not the one SQL paired it with).
  return rows
    .filter(
      (r) =>
        !circlesAt(r.t.getTime()).some((z) => distanceM(r, z) <= z.radiusM) &&
        !circlesAt(r.prev_t.getTime()).some(
          (z) => distanceM({ lat: r.prev_lat, lon: r.prev_lon }, z) <= z.radiusM
        )
    )
    .map((r) => ({
      b_t: r.prev_t,
      b_lat: r.prev_lat,
      b_lon: r.prev_lon,
      a_t: r.t,
      a_lat: r.lat,
      a_lon: r.lon,
    }));
}

export async function projectInferredCountryDays(
  userId: string,
  countryAt: (lat: number, lon: number) => string | null,
  now: Date = new Date()
): Promise<InferredResult> {
  const startDay = utcMidnight(
    new Date(now.getTime() - INFERRED_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10)
  );
  const endExclusive = utcMidnight(now.toISOString().slice(0, 10));
  const { zone } = await profileZoneOf(userId);
  const byDate = new Map<string, string>();
  const gaps = await gapsSince(userId, startDay);
  for (const g of gaps) {
    const before: SilenceEnd = { tMs: g.b_t.getTime(), lat: g.b_lat, lon: g.b_lon };
    const after: SilenceEnd = { tMs: g.a_t.getTime(), lat: g.a_lat, lon: g.a_lon };
    const span = { fromMs: before.tMs, untilMs: after.tMs };
    if (await interrupted(userId, span)) continue;
    const { places } = await placesFor(userId, span, localDay(new Date(before.tMs), zone), [
      before,
      after,
    ]);
    const verdict = judgeSilence(before, after, places);
    if (verdict.kind !== "stationary") continue;
    const code = countryAt(verdict.place.lat, verdict.place.lon);
    if (!code) continue;
    // Whole UTC days inside the silence, within the window and never today or later.
    for (
      let d = Math.ceil(before.tMs / DAY_MS) * DAY_MS;
      d + DAY_MS <= after.tMs && d < endExclusive.getTime();
      d += DAY_MS
    ) {
      if (d >= startDay.getTime()) byDate.set(new Date(d).toISOString().slice(0, 10), code);
    }
  }
  const observations = [...byDate].map(([date, countryCode]) => ({
    date,
    countryCode,
    pointCount: 0,
    airportPointCount: 0,
    spanKm: 0,
  }));
  const { written } = await replaceCountryDays(
    userId,
    "travtrack-inferred",
    { startAt: startDay, endAtExclusive: endExclusive },
    observations
  );
  return { gaps: gaps.length, written };
}
