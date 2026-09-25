import { Prisma } from "../prisma";
import { EARTH_RADIUS_KM } from "../shared/geo/haversine";

/**
 * SQL fragments for "near this point" and "on this local day", shared by every
 * service that asks the logbook where something happened. One home, so "within
 * 300 m" means the same thing to the visit-date chips as to the photo
 * suggestions built on them.
 */

export interface GeoAnchor {
  lat: number;
  lon: number;
}

/**
 * Great-circle distance in SQL, behind a bounding box the planner can use on
 * the plain lat/lon columns. The same constant as `shared/geo/haversine.ts`, so
 * "within 300 m" means the same thing here as everywhere else.
 */
export function withinKm(
  latCol: Prisma.Sql,
  lonCol: Prisma.Sql,
  p: GeoAnchor,
  km: number
): Prisma.Sql {
  // Every number goes in as float8: the driver otherwise lets Postgres infer
  // the parameter's type from its first use, and 6371.0088 became an integer.
  const f = (n: number): Prisma.Sql => Prisma.sql`${n}::float8`;
  const dLat = (km / EARTH_RADIUS_KM) * (180 / Math.PI);
  // Near the poles the longitude box degenerates; drop it there rather than
  // excluding points that are genuinely close.
  const cosLat = Math.cos((p.lat * Math.PI) / 180);
  const lonBox =
    cosLat > 0.01
      ? Prisma.sql`AND ${lonCol} BETWEEN ${f(p.lon - dLat / cosLat)} AND ${f(p.lon + dLat / cosLat)}`
      : Prisma.empty;
  return Prisma.sql`
    ${latCol} BETWEEN ${f(p.lat - dLat)} AND ${f(p.lat + dLat)} ${lonBox}
    AND ${f(EARTH_RADIUS_KM)} * 2 * asin(sqrt(
      power(sin(radians(${latCol} - ${f(p.lat)}) / 2), 2)
      + cos(radians(${f(p.lat)})) * cos(radians(${latCol}))
        * power(sin(radians(${lonCol} - ${f(p.lon)}) / 2), 2)
    )) <= ${f(km)}`;
}

/**
 * The local calendar day of a stored UTC instant. Without a zone the UTC day is
 * the honest fallback — it is what the column says.
 */
export function localDay(col: Prisma.Sql, tz: string | null): Prisma.Sql {
  return tz
    ? Prisma.sql`to_char((${col} AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD')`
    : Prisma.sql`to_char(${col}, 'YYYY-MM-DD')`;
}
