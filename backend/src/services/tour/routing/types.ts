import { Coord, LegMode } from "../tourDistance";

/**
 * Request to a routing provider to compute a path between two points.
 */
export interface RouteRequest {
  from: Coord;
  to: Coord;
  mode: LegMode;
  /**
   * The roadtrip's vehicle, when the leg belongs to one (`TripRoute.vehicle`).
   * A provider may refine its profile by it — a bicycle roadtrip's road leg is
   * ridden, not driven. Absent or null means "no vehicle known".
   */
  vehicle?: string | null;
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
 * Why a leg ended up a straight chord instead of a routed line. Carried in the
 * routing endpoints' responses so a client can say WHY ("the point is not near
 * a road", "the key was refused") instead of a bare "no route found" — a
 * tester pressed "Strecke berechnen" and saw nothing happen, because every one
 * of these collapsed into the same silent straight line (2026-09-26).
 *
 *  - `no_provider` — the instance has no routing provider configured.
 *  - `unroutable_mode` — ferry or rail; never sent to a road router.
 *  - `provider_error` — network error, 5xx, unreadable answer, or an adapter
 *    that reports failure without a cause.
 *  - `no_route` — the provider found no route between the two points.
 *  - `point_not_near_road` — a stop is too far from anything routable.
 *  - `rate_limited` — the provider's quota answered 429.
 *  - `auth` — the provider refused the key (401/403).
 *  - `untrustworthy` — the provider answered, but its line did not anchor at
 *    the stops or its distance was implausible (see `routeLeg.ts`).
 */
export const ROUTE_FALLBACK_REASONS = [
  "no_provider",
  "unroutable_mode",
  "provider_error",
  "no_route",
  "point_not_near_road",
  "rate_limited",
  "auth",
  "untrustworthy",
] as const;
export type RouteFallbackReason = (typeof ROUTE_FALLBACK_REASONS)[number];

/** A provider's "could not route this", with the cause it could identify. */
export interface RouteFailure {
  failure: RouteFallbackReason;
}

export function isRouteFailure(value: RouteResult | RouteFailure | null): value is RouteFailure {
  return value !== null && "failure" in value;
}

/**
 * A routing provider that can answer route queries.
 *
 * Never throws for a routing failure. `null` is "could not route this" with no
 * cause known (read as `provider_error`); a `RouteFailure` names the cause.
 */
export interface RouteProvider {
  readonly id: RoutingProviderId;
  route(req: RouteRequest): Promise<RouteResult | RouteFailure | null>;
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
