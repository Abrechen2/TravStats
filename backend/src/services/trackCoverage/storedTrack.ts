/**
 * A stored recording read back from its JSON columns — the one reader both
 * track tables go through (`TripRouteTrack` for tours, `CruiseTrack` for
 * cruises), so a malformed column is treated the same way wherever a leg asks
 * whether a recording covers it.
 *
 * The columns are `Json`: a direct database write or a future importer could
 * leave something array-shaped but not coordinate-shaped there. Anything that
 * is not clean is read as absent rather than half-trusted — an unreadable
 * geometry covers nothing, and an unreadable cumulative distance falls back to
 * measuring the simplified line, which is what rows written before that column
 * existed have always done.
 */

export interface StoredTrackColumns {
  geometry: unknown;
  segmentStarts: unknown;
  cumulativeKm: unknown;
}

export interface StoredTrack {
  /** `[[lon, lat], …]`; empty when the column was unreadable. */
  geometry: Array<[number, number]>;
  /** Null when absent or malformed: read as one continuous recording. */
  segmentStarts: number[] | null;
  /** Null when absent, malformed, or not aligned with `geometry`. */
  cumulativeKm: number[] | null;
}

export function numberArrayOrNull(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((v) => typeof v === "number" && Number.isFinite(v))
    ? (value as number[])
    : null;
}

export function isCoordinatePolyline(value: unknown): value is Array<[number, number]> {
  if (!Array.isArray(value)) return false;
  return value.every(
    (point) =>
      Array.isArray(point) &&
      point.length === 2 &&
      typeof point[0] === "number" &&
      typeof point[1] === "number" &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1])
  );
}

export function readStoredTrack(row: StoredTrackColumns): StoredTrack {
  const geometry = isCoordinatePolyline(row.geometry) ? row.geometry : [];
  const cumulative = numberArrayOrNull(row.cumulativeKm);
  return {
    geometry,
    segmentStarts: numberArrayOrNull(row.segmentStarts),
    // A running total that does not line up with the line cannot be indexed
    // by it; trusting it would subtract the wrong vertices.
    cumulativeKm: cumulative !== null && cumulative.length === geometry.length ? cumulative : null,
  };
}
