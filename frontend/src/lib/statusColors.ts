import type { Rgb } from "./cruiseColor";

/**
 * Shared flight-status tint constants — the DEFAULTS of the two user-settable
 * colours in `flightColorMode: "status"` (see `lib/flightColor.ts`). Both the
 * flat map (`components/layers/routesLayer.ts`) and the globe
 * (`components/Globe/buildGlobeLayers.ts`) resolve through `flightColor.ts`,
 * which seeds itself from here, so the two renderers can never drift on what
 * "flown" vs. "planned" looks like out of the box.
 */

/** Flight domain orange (#f0a947) — default colour of an already-flown route
 *  (historical, mixed and regular past-only all collapse into it). */
export const FLIGHT_STATUS_PAST_COLOR: Rgb = [240, 169, 71];

/** Coral (#fb7185) — default colour of a planned (never-flown) route. Warm, to
 *  pair with the orange past-colour and stay visually distinct from the cool
 *  cruise blues/cyans that share the same map.
 *
 *  NOTE: the flight-only view used to default this to sky-blue [80,200,255]
 *  (the retired `FLIGHT_STATUS_SCHEDULED_COLOR`) while the "Alle" view used
 *  coral — two hidden defaults for one concept. Both views now default to
 *  coral; sky-blue lives on as a quick-pick preset in
 *  `FLIGHT_COLOR_PRESETS` (`lib/flightColor.ts`). */
export const FLIGHT_STATUS_UPCOMING_COLOR: Rgb = [251, 113, 133];
