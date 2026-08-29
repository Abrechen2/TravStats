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
 * a provider's own profile map. Before the check, it cannot — forgetting the
 * gate is a compile error, not a silent road detour.
 *
 * There is deliberately no shared `PROFILE_BY_MODE` here: OpenRouteService,
 * GraphHopper and a self-hosted OSRM each use their own profile vocabulary
 * (e.g. ORS's heavy-vehicle profile is `driving-hgv`, GraphHopper's is
 * `truck`, and a custom OSRM instance's is whatever the operator named it).
 * A single shared string for "the heavy-vehicle profile" would be right for
 * at most one provider and silently wrong for the others. Each adapter
 * (`openRouteService.ts`, `graphHopper.ts`, `customOsrm.ts`) keeps its own
 * `Record<RoutableMode, string>`, sourced from that provider's documentation.
 */
export function isRoutableMode(mode: LegMode): mode is RoutableMode {
  return mode === "road" || mode === "foot" || mode === "bike";
}
