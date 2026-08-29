import { Coord, LegMode } from "../tourDistance";

/**
 * Request to a routing provider to compute a path between two points.
 */
export interface RouteRequest {
  from: Coord;
  to: Coord;
  mode: LegMode;
}

/**
 * Geometry and distance for a routed path.
 */
export interface RouteResult {
  /** GeoJSON coordinate order: [lon, lat] tuples. */
  waypoints: Array<[number, number]>;
  /** Distance in kilometres. */
  distanceKm: number;
  /** Time in minutes to traverse this leg; null if unavailable. */
  drivingMinutes: number | null;
}

/**
 * A routing provider that can answer route queries.
 */
export interface RouteProvider {
  readonly id: RoutingProviderId;
  route(req: RouteRequest): Promise<RouteResult | null>;
}

export const ROUTING_PROVIDER_IDS = ["openrouteservice", "graphhopper", "custom"] as const;
export type RoutingProviderId = (typeof ROUTING_PROVIDER_IDS)[number];

/**
 * Check whether a given leg mode can be routed by a road router.
 *
 * Road, foot, and bike are self-directed: the traveller or the vehicle follows
 * a path the router can compute. Ferry and rail are not routable: a ferry
 * crosses water no road router knows (it would return a road detour around the
 * body of water), and a train follows dedicated track the traveller does not
 * choose. Asking a road router for either mode returns a plausible number that
 * is silently wrong — the wrong answer looks right and gets added to the tour
 * total. This guard prevents that silent error.
 */
export function isRoutableMode(mode: LegMode): boolean {
  return mode === "road" || mode === "foot" || mode === "bike";
}

/**
 * Map LegMode to the profile string each routing provider expects.
 * A motorhome is not a car: where a provider offers a heavy-vehicle profile,
 * use it. Motorhomes have different speed/route characteristics (low clearance,
 * weight limits, fuel consumption) than light passenger cars.
 */
export const PROFILE_BY_MODE: Record<LegMode, string> = {
  road: "hgv",        // Heavy goods vehicle, not "car"
  foot: "foot",
  bike: "bike",
  ferry: "hgv",       // Should never be routed, but we map it for completeness
  rail: "hgv",        // Should never be routed, but we map it for completeness
};
