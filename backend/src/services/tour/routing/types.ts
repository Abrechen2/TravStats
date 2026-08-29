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
 * The set of leg modes a road router can meaningfully answer.
 * Road, foot, and bike are self-directed: the traveller or vehicle follows
 * a path the router can compute. Ferry and rail are excluded by design.
 */
export type RoutableMode = Extract<LegMode, "road" | "foot" | "bike">;

/**
 * Check whether a given leg mode can be routed by a road router.
 *
 * Road, foot, and bike are self-directed: the traveller or the vehicle follows
 * a path the router can compute. Ferry and rail are not routable: a ferry
 * crosses water no road router knows (it would return a road detour around the
 * body of water), and a train follows dedicated track the traveller does not
 * choose. Asking a road router for either mode returns a plausible number that
 * is silently wrong — the wrong answer looks right and gets added to the tour
 * total. This guard prevents that silent error by being a type guard: after
 * this check, TypeScript knows the mode is RoutableMode and can safely index
 * PROFILE_BY_MODE. Before the check, it cannot — forgetting the gate is a
 * compile error, not a silent road detour.
 */
export function isRoutableMode(mode: LegMode): mode is RoutableMode {
  return mode === "road" || mode === "foot" || mode === "bike";
}

/**
 * Map routable leg modes to the profile string each routing provider expects.
 * Deliberately has no entry for ferry or rail — calling code that forgets the
 * isRoutableMode gate will get a type error instead of a working-looking profile.
 *
 * A motorhome is not a car: where a provider offers a heavy-vehicle profile,
 * use it. Motorhomes have different speed/route characteristics (low clearance,
 * weight limits, fuel consumption) than light passenger cars.
 */
export const PROFILE_BY_MODE: Record<RoutableMode, string> = {
  road: "hgv",        // Heavy goods vehicle, not "car"
  foot: "foot",
  bike: "bike",
};
