/**
 * The key format under which a hand-drawn cruise-leg route is stored and
 * found.
 *
 * The distance path (`services/cruiseDistance/cruiseLegService.ts`) and the
 * geometry path (`routes/cruises.ts`) both need to look up the same
 * `CruiseLegRoute` row for the same leg — that agreement is the entire
 * mechanism by which a hand-corrected line and its stored kilometres stay
 * in sync. Two independent copies of this key format is exactly the drift
 * this stage exists to close, so both consumers go through this module
 * instead of building the string themselves.
 */

/** The key under which one leg's hand-drawn route is stored and found. */
export function legRouteKey(fromKind: string, fromRef: string, toKind: string, toRef: string): string {
  return `${fromKind}:${fromRef}:${toKind}:${toRef}`;
}

/** Convenience for the only endpoint kind that exists today. */
export function portLegRouteKey(fromPortId: number, toPortId: number): string {
  return legRouteKey("port", String(fromPortId), "port", String(toPortId));
}

interface LegRouteRow {
  fromKind: string;
  fromRef: string;
  toKind: string;
  toRef: string;
  waypoints: unknown;
}

/**
 * True iff `value` is a usable `[[lon, lat], ...]` polyline: an array of
 * two-element tuples whose entries are both numbers. `Json` columns hold
 * whatever was last written to them — a direct database write or a future
 * importer could land something array-shaped but not coordinate-shaped
 * (e.g. `["a", "b"]`), which `Array.isArray` alone would wave through and
 * which `polylineDistanceKm` would then silently turn into `NaN`.
 */
function isCoordinatePolyline(value: unknown): value is Array<[number, number]> {
  if (!Array.isArray(value)) return false;
  return value.every(
    (point) =>
      Array.isArray(point) &&
      point.length === 2 &&
      typeof point[0] === "number" &&
      typeof point[1] === "number",
  );
}

/**
 * Turn stored override rows into the lookup map both the geometry path and
 * the distance path use. Rows whose `waypoints` column does not hold a
 * usable polyline are skipped — the column is `Json`, so anything could be
 * in it.
 */
export function buildLegRouteOverrideMap(
  rows: ReadonlyArray<LegRouteRow>,
): Map<string, Array<[number, number]>> {
  const overrideByLeg = new Map<string, Array<[number, number]>>();
  for (const row of rows) {
    if (!isCoordinatePolyline(row.waypoints)) continue;
    overrideByLeg.set(legRouteKey(row.fromKind, row.fromRef, row.toKind, row.toRef), row.waypoints);
  }
  return overrideByLeg;
}
