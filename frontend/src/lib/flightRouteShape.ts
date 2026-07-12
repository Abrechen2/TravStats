// How flight routes are DRAWN on the flat 2D map (#183).
//
// The 3D arcs read well from a distance, but zoomed into a home airport with
// many departures they converge into a "funnel" of overlapping curves that is
// visually noisy and impossible to trace. Cruise routes already render flat on
// the map surface and stay legible at any zoom, so flights get the same option:
//
//   - "arc"  — deck.gl ArcLayer, the 3D bow. TODAY'S BEHAVIOUR AND THE DEFAULT:
//              nobody's map changes on update.
//   - "flat" — deck.gl PathLayer along the great circle, hugging the map
//              surface exactly like a cruise route.
//
// This is a SHAPE, orthogonal to the COLOUR (`lib/flightColor.ts`). Every
// colour mode must resolve to the identical RGB in both shapes — the shape
// picks the geometry, the colour config picks the hue, and neither overrides
// the other. The renderer enforces that by feeding both shapes from the same
// `ArcDatum[]` (see `layers/flatRoutesLayer.ts`).
//
// Globe-only note: this setting is flat-map-only and the globe control panel
// does not expose it. On a globe an arc IS the point — a "flat" route there
// would just be a great circle glued to the sphere, which is what the globe's
// own route rendering already means.

/** The two ways a flight route can be drawn on the flat map. */
export type FlightRouteShape = "arc" | "flat";

/** Render order of the shape picker in the flat-map control panel. */
export const FLIGHT_ROUTE_SHAPES = ["arc", "flat"] as const;

/** Today's behaviour. Changing this changes every existing user's map. */
export const DEFAULT_FLIGHT_ROUTE_SHAPE: FlightRouteShape = "arc";

export function isFlightRouteShape(v: unknown): v is FlightRouteShape {
  return v === "arc" || v === "flat";
}

/**
 * Derive the route shape from a persisted appearance blob. Anything missing or
 * unrecognised (hand-edited localStorage, a value from a future version) falls
 * back to the arc — the shape the user already knows.
 */
export function flightRouteShapeFromStored(raw: Record<string, unknown>): FlightRouteShape {
  return isFlightRouteShape(raw.flightRouteShape)
    ? raw.flightRouteShape
    : DEFAULT_FLIGHT_ROUTE_SHAPE;
}
