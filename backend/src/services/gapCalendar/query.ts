import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { MAX_ACCURACY_M } from "../locationEvidence/anomaly";
import type { HomePeriod } from "../../utils/homeAirport";
import { FOLD_BAND_M } from "../travtrack/legs/fold";
import type { DayFacts } from "./classify";

/**
 * The gap calendar's one statement per request (spec 2026-11-22-gap-calendar):
 * `generate_series` makes the year's days, every logbook domain contributes
 * its spans as local days, the fixes are grouped by local day, and the answer
 * is one facts row per day — never a row per fix or per entry. How many
 * queries a request costs does not depend on how much the account holds.
 *
 * A fix's local day is its instant read in the profile zone. An entry's span
 * is read the way its own table keeps it (a trip's `start_day`, a stay's
 * hotel-local dates, a flight's tagged instants in the airport's zone); a zone
 * Postgres does not know falls back to the profile zone instead of failing
 * the whole calendar.
 */

export interface YearFacts {
  /** The zone the days were read in (the profile zone, or UTC when Postgres does not know it). */
  zone: string;
  /** Earliest local day with an entry or a fix, in any year; null when there is none. */
  firstDay: string | null;
  days: Array<{ day: string; facts: DayFacts }>;
}

/**
 * One end of a silence: the nearest GOOD fix (plausible, outside every privacy circle) on one
 * side of the local day `d`, read through the same filters the day view uses.
 */
function silenceEnd(userId: string, side: "before" | "after", at: string): Prisma.Sql {
  const [cmp, order] = side === "before" ? ["<", "DESC"] : [">=", "ASC"];
  return Prisma.sql`
    SELECT p.t, p.lat, p.lon, ${localDay("p.t", PROFILE)} AS day
    FROM travtrack_points p
    WHERE p.user_id = ${userId} AND p.t ${Prisma.raw(cmp)} ${Prisma.raw(at)}
      AND NOT COALESCE(p.accuracy_m > ${MAX_ACCURACY_M}, false)
      AND NOT (abs(p.lat) < ${NULL_ISLAND_DEG} AND abs(p.lon) < ${NULL_ISLAND_DEG})
      AND NOT EXISTS (
        SELECT 1 FROM circles c
        WHERE (c.until_at IS NULL OR p.t < c.until_at)
          AND ${HAVERSINE("p.lat", "p.lon", "c.lat", "c.lon")} <= c.radius_m)
    ORDER BY p.t ${Prisma.raw(order)} LIMIT 1`;
}

/** Same bound as `anomaly.ts`'s null island (`NULL_ISLAND_DEG`, not exported). */
const NULL_ISLAND_DEG = 0.0001;

/** `col` (a UTC `timestamp`) as the local calendar day in zone expression `z`. */
const localDay = (col: string, z: Prisma.Sql): Prisma.Sql =>
  Prisma.sql`((${Prisma.raw(col)} AT TIME ZONE 'UTC') AT TIME ZONE ${z})::date`;

/** `zoneCol` when Postgres knows it, else the profile zone. */
const zoneOr = (zoneCol: string): Prisma.Sql =>
  Prisma.sql`(CASE WHEN ${Prisma.raw(zoneCol)} IN (SELECT name FROM vz) THEN ${Prisma.raw(zoneCol)} ELSE (SELECT z FROM pz) END)`;

const PROFILE = Prisma.sql`(SELECT z FROM pz)`;

/** Every domain's covered span as `(d_from, d_to)` local days. One branch per table. */
function spans(userId: string): Prisma.Sql {
  const tripLike = (table: string, live: Prisma.Sql) => Prisma.sql`
    SELECT COALESCE(start_day, ${localDay("start_date", PROFILE)}) AS d_from,
           COALESCE(end_day, ${localDay("end_date", PROFILE)},
                    start_day, ${localDay("start_date", PROFILE)}) AS d_to
    FROM ${Prisma.raw(table)}
    WHERE user_id = ${userId} AND ${live}
      AND (start_day IS NOT NULL OR start_date IS NOT NULL)`;
  const journey = (table: string) => Prisma.sql`
    SELECT ${localDay("departure_time", zoneOr("dep_timezone"))} AS d_from,
           COALESCE(${localDay("arrival_time", zoneOr("arr_timezone"))},
                    ${localDay("departure_time", zoneOr("dep_timezone"))}) AS d_to
    FROM ${Prisma.raw(table)}
    WHERE user_id = ${userId} AND status <> 'cancelled'
      AND COALESCE(dep_precision, 'minute') NOT IN ('month', 'year')`;
  return Prisma.sql`
    ${tripLike("trips", Prisma.sql`TRUE`)}
    UNION ALL ${tripLike("cruises", Prisma.sql`status <> 'cancelled'`)}
    UNION ALL
    SELECT COALESCE(check_in_date, check_in::date) AS d_from,
           COALESCE(check_out_date, check_out::date, check_in_date, check_in::date) AS d_to
    FROM lodging_stays
    WHERE user_id = ${userId} AND status <> 'cancelled' AND date_precision = 'DAY'
      AND (check_in_date IS NOT NULL OR check_in IS NOT NULL)
    UNION ALL
    SELECT CASE WHEN dep_time_semantics = 'UTC'
                THEN ${localDay("departure_time", zoneOr("dep_timezone"))}
                ELSE departure_time::date END AS d_from,
           COALESCE(
             CASE WHEN arr_time_semantics = 'UTC'
                  THEN ${localDay("arrival_time", zoneOr("arr_timezone"))}
                  ELSE arrival_time::date END,
             CASE WHEN dep_time_semantics = 'UTC'
                  THEN ${localDay("departure_time", zoneOr("dep_timezone"))}
                  ELSE departure_time::date END) AS d_to
    FROM flights
    WHERE user_id = ${userId} AND status <> 'cancelled' AND departure_time IS NOT NULL
      -- A month- or year-precision flight stores the 1st of the period as a placeholder; it covers
      -- no specific day. The legacy shape (UNKNOWN semantics, 1st at 00:00) is the same placeholder.
      AND COALESCE(dep_precision, 'minute') NOT IN ('month', 'year')
      AND NOT (dep_time_semantics = 'UNKNOWN' AND COALESCE(dep_precision, '') NOT IN ('minute', 'day')
               AND departure_time::time = TIME '00:00' AND EXTRACT(DAY FROM departure_time) = 1)
    UNION ALL ${journey("rail_journeys")}
    UNION ALL ${journey("bus_journeys")}
    UNION ALL ${journey("ferry_journeys")}
    UNION ALL
    SELECT ${localDay("pickup_time", zoneOr("pickup_timezone"))} AS d_from,
           ${localDay("return_time", zoneOr("return_timezone"))} AS d_to
    FROM rental_bookings
    WHERE user_id = ${userId} AND status <> 'cancelled'
      AND pickup_precision NOT IN ('month', 'year')
    UNION ALL
    SELECT d AS d_from, d AS d_to FROM (
      SELECT CASE WHEN visited_at_utc IS NOT NULL
                  THEN ${localDay("visited_at_utc", zoneOr("visited_zone"))}
                  ELSE visited_at::date END AS d
      FROM place_visits
      WHERE user_id = ${userId}
        AND (visited_at_utc IS NOT NULL OR visited_at IS NOT NULL)
        AND COALESCE(visited_precision, 'day') NOT IN ('month', 'year')
    ) v`;
}

export function homePeriodsJson(periods: readonly HomePeriod[]): string {
  return JSON.stringify(
    periods
      .filter((p) => p.residence !== null)
      .map((p) => ({
        from: p.fromDate,
        to: p.toDate,
        lat: p.residence!.lat,
        lon: p.residence!.lon,
      }))
  );
}

type Row = {
  zone: string;
  first_day: string | null;
  day: string;
  entries: number;
  good: number;
  home: number;
  zone_fixes: number;
  bad: number;
  silent_home: boolean;
  silent_place: boolean;
};

const HAVERSINE = (aLat: string, aLon: string, bLat: string, bLon: string): Prisma.Sql =>
  Prisma.raw(
    `2 * 6371008.8 * asin(least(1, sqrt(power(sin(radians(${bLat} - ${aLat}) / 2), 2) + ` +
      `cos(radians(${aLat})) * cos(radians(${bLat})) * power(sin(radians(${bLon} - ${aLon}) / 2), 2))))`
  );

export async function gapCalendarFacts(input: {
  userId: string;
  zone: string;
  from: string;
  to: string;
  homePeriods: readonly HomePeriod[];
  homeRadiusM: number;
}): Promise<YearFacts> {
  const { userId, zone, from, to } = input;
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    WITH vz AS MATERIALIZED (SELECT name FROM pg_timezone_names),
    pz AS (SELECT CASE WHEN ${zone} IN (SELECT name FROM vz) THEN ${zone} ELSE 'UTC' END AS z),
    -- A span across the date line can end on an earlier local day than it began: order the ends.
    all_spans AS MATERIALIZED (
      SELECT LEAST(d_from, d_to) AS d_from, GREATEST(d_from, d_to) AS d_to FROM (${spans(userId)}) s
    ),
    bounds AS (
      SELECT LEAST(
        (SELECT min(d_from) FROM all_spans),
        (SELECT ${localDay("t", PROFILE)} FROM travtrack_points
           WHERE user_id = ${userId} ORDER BY t LIMIT 1)
      ) AS first_day
    ),
    days AS (
      SELECT g::date AS day
      FROM generate_series(${from}::date, ${to}::date, interval '1 day') g
    ),
    entry_days AS (
      SELECT d.day, count(*)::int AS n
      FROM days d JOIN all_spans s ON d.day BETWEEN s.d_from AND s.d_to
      GROUP BY d.day
    ),
    circles AS (
      SELECT lat, lon, radius_m, NULL::timestamp AS until_at
        FROM travtrack_privacy_zones WHERE user_id = ${userId}
      UNION ALL
      SELECT lat, lon, radius_m, until_at
        FROM travtrack_zone_tombstones WHERE user_id = ${userId}
    ),
    homes AS (
      SELECT * FROM jsonb_to_recordset(${input.homePeriods.length ? homePeriodsJson(input.homePeriods) : "[]"}::jsonb)
        AS h("from" date, "to" date, lat float8, lon float8)
    ),
    fixes AS (
      SELECT ${localDay("p.t", PROFILE)} AS day, p.t, p.lat, p.lon,
             -- a fix without an accuracy is not a bad one: COALESCE keeps NULL out of the verdict
             (COALESCE(p.accuracy_m > ${MAX_ACCURACY_M}, false)
              OR (abs(p.lat) < ${NULL_ISLAND_DEG} AND abs(p.lon) < ${NULL_ISLAND_DEG})) AS bad
      FROM travtrack_points p
      WHERE p.user_id = ${userId}
        AND p.t >= (${from}::date - 1)::timestamp AND p.t < (${to}::date + 2)::timestamp
    ),
    judged AS (
      SELECT f.day, f.bad,
        EXISTS (
          SELECT 1 FROM circles c
          WHERE (c.until_at IS NULL OR f.t < c.until_at)
            AND ${HAVERSINE("f.lat", "f.lon", "c.lat", "c.lon")} <= c.radius_m
        ) AS in_zone,
        EXISTS (
          SELECT 1 FROM homes h
          WHERE f.day >= h."from" AND (h."to" IS NULL OR f.day < h."to")
            AND ${HAVERSINE("f.lat", "f.lon", "h.lat", "h.lon")} <= ${input.homeRadiusM}
        ) AS at_home
      FROM fixes f WHERE f.day BETWEEN ${from}::date AND ${to}::date
    ),
    fix_days AS (
      SELECT day,
        count(*) FILTER (WHERE NOT in_zone AND NOT bad)::int AS good,
        count(*) FILTER (WHERE NOT in_zone AND NOT bad AND at_home)::int AS home,
        count(*) FILTER (WHERE in_zone)::int AS zone_fixes,
        count(*) FILTER (WHERE NOT in_zone AND bad)::int AS bad
      FROM judged GROUP BY day
    ),
    -- A day with no fix and no entry. Quiet at home sends no points (iOS suspends the app), so
    -- the day is home when the last good fix before it and the first after it are both at home
    -- and nothing between them contradicts it: no entry, no reported pause, no deleted span.
    bare AS (
      SELECT d.day,
             ((d.day::timestamp) AT TIME ZONE (SELECT z FROM pz)) AT TIME ZONE 'UTC' AS start_utc,
             ((d.day + 1)::timestamp AT TIME ZONE (SELECT z FROM pz)) AT TIME ZONE 'UTC' AS end_utc
      FROM days d
      WHERE NOT EXISTS (SELECT 1 FROM fix_days x WHERE x.day = d.day)
        AND NOT EXISTS (SELECT 1 FROM entry_days e WHERE e.day = d.day)
    ),
    -- Work and custom places without a window (the day view's rule: a window has no clock here).
    spots AS (
      SELECT f.lat, f.lon, f.radius_m FROM travtrack_fixed_places f
      WHERE f.user_id = ${userId} AND f."window" IS NULL
        -- a place inside a privacy circle is never used to explain anything
        AND NOT EXISTS (
          SELECT 1 FROM circles c
          WHERE ${HAVERSINE("f.lat", "f.lon", "c.lat", "c.lon")} <= c.radius_m)
    ),
    silent AS (
      SELECT b.day,
        EXISTS (
          SELECT 1 FROM homes h
          WHERE b.day >= h."from" AND (h."to" IS NULL OR b.day < h."to")
            AND ${HAVERSINE("pv.lat", "pv.lon", "h.lat", "h.lon")} <= ${input.homeRadiusM + FOLD_BAND_M}
            AND ${HAVERSINE("nx.lat", "nx.lon", "h.lat", "h.lon")} <= ${input.homeRadiusM + FOLD_BAND_M}) AS at_home
      FROM bare b
      CROSS JOIN LATERAL (${silenceEnd(userId, "before", "b.start_utc")}) pv
      CROSS JOIN LATERAL (${silenceEnd(userId, "after", "b.end_utc")}) nx
      WHERE (
          EXISTS (
            SELECT 1 FROM homes h
            WHERE b.day >= h."from" AND (h."to" IS NULL OR b.day < h."to")
              AND ${HAVERSINE("pv.lat", "pv.lon", "h.lat", "h.lon")} <= ${input.homeRadiusM + FOLD_BAND_M}
              AND ${HAVERSINE("nx.lat", "nx.lon", "h.lat", "h.lon")} <= ${input.homeRadiusM + FOLD_BAND_M})
          OR EXISTS (
            SELECT 1 FROM spots k
            WHERE ${HAVERSINE("pv.lat", "pv.lon", "k.lat", "k.lon")} <= k.radius_m + ${FOLD_BAND_M}
              AND ${HAVERSINE("nx.lat", "nx.lon", "k.lat", "k.lon")} <= k.radius_m + ${FOLD_BAND_M}))
        AND NOT EXISTS (SELECT 1 FROM all_spans s WHERE s.d_from <= nx.day AND s.d_to >= pv.day)
        AND NOT EXISTS (
          SELECT 1 FROM travtrack_deleted_ranges r
          WHERE r.user_id = ${userId} AND r.from_at < nx.t AND r.to_at > pv.t)
        AND NOT EXISTS (
          SELECT 1 FROM travtrack_deleted_points dp
          WHERE dp.user_id = ${userId}
            AND dp.t_s > floor(extract(epoch FROM pv.t)) AND dp.t_s < ceil(extract(epoch FROM nx.t)))
        AND NOT EXISTS (
          SELECT 1 FROM travtrack_points q
          WHERE q.user_id = ${userId} AND q.t > pv.t AND q.t < nx.t)
        AND NOT EXISTS (
          SELECT 1 FROM travtrack_gaps g
          WHERE g.user_id = ${userId} AND g.from_at < nx.t AND g.to_at > pv.t)
    )
    SELECT (SELECT z FROM pz) AS zone,
           to_char((SELECT first_day FROM bounds), 'YYYY-MM-DD') AS first_day,
           to_char(d.day, 'YYYY-MM-DD') AS day,
           COALESCE(e.n, 0) AS entries, COALESCE(x.good, 0) AS good,
           COALESCE(x.home, 0) AS home, COALESCE(x.zone_fixes, 0) AS zone_fixes,
           COALESCE(x.bad, 0) AS bad,
           (sh.day IS NOT NULL AND sh.at_home) AS silent_home,
           (sh.day IS NOT NULL AND NOT sh.at_home) AS silent_place
    FROM days d
    LEFT JOIN silent sh ON sh.day = d.day
    LEFT JOIN entry_days e ON e.day = d.day
    LEFT JOIN fix_days x ON x.day = d.day
    ORDER BY d.day`);
  return {
    zone: rows[0]?.zone ?? zone,
    firstDay: rows[0]?.first_day ?? null,
    days: rows.map((r) => ({
      day: r.day,
      facts: {
        entries: r.entries,
        goodFixes: r.good,
        homeFixes: r.home,
        zoneFixes: r.zone_fixes,
        badFixes: r.bad,
        silentHome: r.silent_home,
        silentPlace: r.silent_place,
      },
    })),
  };
}
