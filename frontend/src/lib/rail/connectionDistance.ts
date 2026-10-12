import type { RailJourney } from "../../types/rail";

/** Never mistake missing distances for zero or a mixed estimate for a measured route. */
export function connectionDistance(
  legs: readonly Pick<RailJourney, "distanceKm" | "distanceSource">[]
): {
  km: number | null;
  missing: number;
  mixed: boolean;
  source: string | null;
} {
  const known = legs.filter(
    (leg) => leg.distanceKm !== null && Number.isFinite(leg.distanceKm) && leg.distanceKm >= 0
  );
  const sources = new Set(known.map((leg) => leg.distanceSource));
  return {
    km: known.length ? known.reduce((sum, leg) => sum + leg.distanceKm!, 0) : null,
    missing: legs.length - known.length,
    mixed: sources.size > 1,
    source: sources.size === 1 ? [...sources][0] : null,
  };
}
