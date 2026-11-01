import type { CruisePathDatum } from "./globeLayerTypes";

// Alpha applied to a cruise path. Planned (scheduled) cruises render
// dimmer than past ones — matching the flat map's `cruiseArcsLayer`
// PLANNED_ALPHA so the two renderers agree on how "not yet sailed" reads.
const CRUISE_PATH_ALPHA = 230;
const CRUISE_PATH_PLANNED_ALPHA = 150;

/**
 * Resolve a cruise leg's render color (RGB + alpha). Mirrors the flat
 * map's `cruiseArcsLayer` planned-dimming: scheduled cruises get a
 * lower alpha so "not yet sailed" reads the same on the globe as on the
 * flat map. The hue is already resolved upstream in GlobeView's
 * `cruisePaths` builder (a user color override wins, else `colorMode`'s
 * status/per-cruise palette) — this only layers on the status-dependent
 * opacity.
 */
export function resolveCruisePathColor(
  d: Pick<CruisePathDatum, "color" | "status">
): [number, number, number, number] {
  const alpha = d.status === "scheduled" ? CRUISE_PATH_PLANNED_ALPHA : CRUISE_PATH_ALPHA;
  return [d.color[0], d.color[1], d.color[2], alpha];
}
