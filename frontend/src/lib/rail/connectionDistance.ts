import type { RailJourney } from "../../types/rail";

/** Never mistake missing distances for zero or a mixed estimate for a measured route. */
export function connectionDistance(
  legs: readonly (Pick<RailJourney, "distanceKm" | "distanceSource"> &
    Partial<Pick<RailJourney, "geometrySource">>)[]
): {
  km: number | null;
  missing: number;
  mixed: boolean;
  source: string | null;
  geometrySource: string | null;
} {
  const known = legs.filter(
    (leg) => leg.distanceKm !== null && Number.isFinite(leg.distanceKm) && leg.distanceKm >= 0
  );
  const sources = new Set(known.map((leg) => leg.distanceSource));
  const geometrySources = new Set(
    known.filter((leg) => leg.distanceSource === "route").map((leg) => leg.geometrySource ?? null)
  );
  const mixed = sources.size > 1 || geometrySources.size > 1;
  return {
    km: known.length ? known.reduce((sum, leg) => sum + leg.distanceKm!, 0) : null,
    missing: legs.length - known.length,
    mixed,
    source: !mixed && sources.size === 1 ? [...sources][0] : null,
    geometrySource: geometrySources.size === 1 ? [...geometrySources][0] : null,
  };
}
