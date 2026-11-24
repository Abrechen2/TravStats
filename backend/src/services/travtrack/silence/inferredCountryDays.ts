import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import { localDay } from "../../../shared/time/instant";
import { profileZoneOf } from "../../../shared/time/profileZone";
import { MAX_ACCURACY_M } from "../../locationEvidence/anomaly";
import { replaceCountryDays, utcMidnight } from "../../countryDays/store";
import { privacyCircleSet } from "../privacyCircles";
import { distanceM } from "../classify";
import { judgeSilence, type SilenceEnd, type StationaryPlace } from "./stationary";
import { interrupted, placesFor } from "./stationaryCoverage";

/**
 * Country days for silences spent standing at a known place (TravTrack home silence). A quiet
 * stretch at home sends no point, so the passport saw no day there. Every UTC day that lies
 * WHOLLY inside a silence whose two good end fixes are in one known place, with nothing
 * contradicting it (`interrupted`), becomes a `travtrack-inferred` row: the country of that
 * place, `pointCount` 0 — nothing was recorded. A separate source, so a reader that wants only
 * evidenced days leaves it out; never merged into the `travtrack` rows.
 *
 * Recomputed incrementally over the silences touching the dirty days (whole history after a deletion), replace-not-upsert, so a silence that later turns out to
 * contain a fix, or whose ends change, loses its rows. Days are UTC days like every country day
 * (ADR 0002 Q3); only a day wholly inside the silence counts, so the local-day edge never
 * claims a day the owner might have spent elsewhere.
 */

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

/** The nearest good fix (plausible, outside every privacy circle) on one side of `atMs`, or null. */
async function goodFixBeyond(
  userId: string,
  side: "before" | "after",
  atMs: number
): Promise<Date | null> {
  const circlesAt = await privacyCircleSet(userId);
  const [cmp, order] = side === "before" ? ["<", "DESC"] : [">=", "ASC"];
  let cursor = atMs;
  // Fixes inside a zone are skipped one batch at a time; a zone-heavy account loops a little.
  for (let round = 0; round < 50; round++) {
    const rows = await prisma.$queryRaw<Array<{ t: Date; lat: number; lon: number }>>(Prisma.sql`
      SELECT t, lat, lon FROM travtrack_points
      WHERE user_id = ${userId} AND t ${Prisma.raw(cmp)} ${new Date(cursor)}
        AND NOT COALESCE(accuracy_m > ${MAX_ACCURACY_M}, false)
        AND NOT (abs(lat) < ${NULL_ISLAND_DEG} AND abs(lon) < ${NULL_ISLAND_DEG})
      ORDER BY t ${Prisma.raw(order)} LIMIT 200`);
    if (rows.length === 0) return null;
    const hit = rows.find(
      (r) => !circlesAt(r.t.getTime()).some((z) => distanceM(r, z) <= z.radiusM)
    );
    if (hit) return hit.t;
    // `before` is `<` (exclusive), `after` is `>=`: step past the last row so a batch never repeats.
    cursor = rows[rows.length - 1].t.getTime() + (side === "after" ? 1 : 0);
  }
  return null;
}

/** Pairs of consecutive good fixes at least a day apart whose later fix lies in `[fromMs, untilMs]`. */
async function gapsBetween(userId: string, fromMs: number, untilMs: number): Promise<GapRow[]> {
  const circlesAt = await privacyCircleSet(userId);
  const rows = await prisma.$queryRaw<
    Array<{ t: Date; lat: number; lon: number; prev_t: Date; prev_lat: number; prev_lon: number }>
  >(Prisma.sql`
    SELECT t, lat, lon, prev_t, prev_lat, prev_lon FROM (
      SELECT t, lat, lon,
             LAG(t) OVER w AS prev_t, LAG(lat) OVER w AS prev_lat, LAG(lon) OVER w AS prev_lon
      FROM travtrack_points
      WHERE user_id = ${userId}
        AND t >= ${new Date(fromMs)} AND t <= ${new Date(untilMs)}
        AND NOT COALESCE(accuracy_m > ${MAX_ACCURACY_M}, false)
        AND NOT (abs(lat) < ${NULL_ISLAND_DEG} AND abs(lon) < ${NULL_ISLAND_DEG})
      WINDOW w AS (ORDER BY t, seq)
    ) x
    WHERE prev_t IS NOT NULL AND t - prev_t >= interval '1 day'
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

/** A silence whose two good ends lie in one known place, with nothing contradicting it. */
export type StationarySilence = { fromMs: number; untilMs: number; place: StationaryPlace };

/**
 * The stationary silences whose ends both lie in `[fromMs, untilMs]` — the country days
 * below and the trip sweep's away days (`locationEvidence/trips/awayPeriods.ts`) read the
 * same ones, so a quiet day at home is home in both.
 */
export async function stationarySilences(
  userId: string,
  fromMs: number,
  untilMs: number,
  zone?: string
): Promise<{ gaps: number; silences: StationarySilence[] }> {
  const dayZone = zone ?? (await profileZoneOf(userId)).zone;
  const gaps = await gapsBetween(userId, fromMs, untilMs);
  const silences: StationarySilence[] = [];
  for (const g of gaps) {
    const before: SilenceEnd = { tMs: g.b_t.getTime(), lat: g.b_lat, lon: g.b_lon };
    const after: SilenceEnd = { tMs: g.a_t.getTime(), lat: g.a_lat, lon: g.a_lon };
    const span = { fromMs: before.tMs, untilMs: after.tMs };
    if (await interrupted(userId, span)) continue;
    const { places } = await placesFor(userId, span, localDay(new Date(before.tMs), dayZone), [
      before,
      after,
    ]);
    const verdict = judgeSilence(before, after, places);
    if (verdict.kind === "stationary") silences.push({ ...span, place: verdict.place });
  }
  return { gaps: gaps.length, silences };
}

/** The UTC days (`YYYY-MM-DD`, inclusive) whose data changed; null recomputes the whole history. */
export type InferredScope = { fromDay: string; toDay: string } | null;

/**
 * A normal run recomputes only the silences touching the dirty days: from the last good fix
 * before the earliest to the first good fix after the latest. After a deletion or a zone change
 * (`inferredRebuildDue`) the scope is null and the whole history is rebuilt once.
 */
export async function projectInferredCountryDays(
  userId: string,
  countryAt: (lat: number, lon: number) => string | null,
  scope: InferredScope = null,
  now: Date = new Date()
): Promise<InferredResult> {
  const today = utcMidnight(now.toISOString().slice(0, 10));
  let fromMs = 0;
  let untilMs = Date.UTC(3000, 0, 1);
  let startAt = new Date(0);
  let endAtExclusive = today;
  if (scope) {
    const scopeFrom = utcMidnight(scope.fromDay).getTime();
    const scopeUntil = utcMidnight(scope.toDay).getTime() + DAY_MS;
    const [before, after] = await Promise.all([
      goodFixBeyond(userId, "before", scopeFrom),
      goodFixBeyond(userId, "after", scopeUntil),
    ]);
    fromMs = before ? before.getTime() : scopeFrom;
    untilMs = after ? after.getTime() : Date.UTC(3000, 0, 1);
    startAt = utcMidnight(new Date(fromMs).toISOString().slice(0, 10));
    endAtExclusive = new Date(
      Math.min(
        today.getTime(),
        utcMidnight(new Date(untilMs).toISOString().slice(0, 10)).getTime() + DAY_MS
      )
    );
  }
  const { zone } = await profileZoneOf(userId);
  const byDate = new Map<string, string>();
  const { gaps, silences } = await stationarySilences(userId, fromMs, untilMs, zone);
  for (const silence of silences) {
    const code = countryAt(silence.place.lat, silence.place.lon);
    if (!code) continue;
    // Whole UTC days inside the silence, within the window and never today or later.
    for (
      let d = Math.ceil(silence.fromMs / DAY_MS) * DAY_MS;
      d + DAY_MS <= silence.untilMs && d < endAtExclusive.getTime();
      d += DAY_MS
    ) {
      if (d >= startAt.getTime()) byDate.set(new Date(d).toISOString().slice(0, 10), code);
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
    { startAt, endAtExclusive },
    observations
  );
  return { gaps, written };
}
