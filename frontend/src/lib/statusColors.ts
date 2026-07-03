import type { Rgb } from "./cruiseColor";

/**
 * Shared flight-status tint constants for the "Alle" two-tone scheme.
 * Both the flat map (`components/layers/routesLayer.ts`) and the globe
 * (`components/Globe/buildGlobeLayers.ts`) import from here so the two
 * renderers can never drift on what "past" vs. "scheduled" looks like.
 */

/** Flight domain orange (#f0a947). Historical, mixed and regular
 *  past-only routes all collapse into this single hue when
 *  `statusTwoTone` is active. */
export const FLIGHT_STATUS_PAST_COLOR: Rgb = [240, 169, 71];
/** Sky-blue — pure-scheduled (never-flown) flight routes in the single
 *  flight-domain view. NOT used by the two-tone "Alle" view (see
 *  `FLIGHT_STATUS_UPCOMING_COLOR`) — keep this unchanged so the single
 *  view's scheduled routes stay visually identical. */
export const FLIGHT_STATUS_SCHEDULED_COLOR: Rgb = [80, 200, 255];
/** Coral (#fb7185) — pure-scheduled (never-flown) flight routes, but ONLY
 *  in the two-tone "Alle" (multi-domain) view. Warm to pair with the
 *  orange past-color and stay visually distinct from the cool cruise
 *  blues/cyans that share the same map. */
export const FLIGHT_STATUS_UPCOMING_COLOR: Rgb = [251, 113, 133];
