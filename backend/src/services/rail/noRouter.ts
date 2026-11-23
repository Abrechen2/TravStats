import { railRoutingBaseUrl } from "./openRailRouting";

/**
 * Why a ride is drawn straight when the reason is the instance itself: no rail
 * router (OpenRailRouting) is configured, or the admin switched it off. A read
 * answer, never a stored column — it goes away the day a router is set, with
 * no row to update. Null for every line that is not the plain chord.
 */
export type RailGeometryReason = "noRouter";

/** True when journeys cannot be routed on this instance. Read once per response. */
export async function railRouterMissing(): Promise<boolean> {
  return (await railRoutingBaseUrl()) === null;
}

/** The ride with `geometryReason` beside its line source. */
export function withGeometryReason<T extends { geometrySource: string }>(
  ride: T,
  routerMissing: boolean
): T & { geometryReason: RailGeometryReason | null } {
  return {
    ...ride,
    geometryReason: routerMissing && ride.geometrySource === "straight" ? "noRouter" : null,
  };
}
