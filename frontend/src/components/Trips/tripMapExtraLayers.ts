import { useMemo } from "react";
import type { Layer } from "@deck.gl/core";
import { occludeExtraLayers } from "../Globe/occludeExtraLayers";
import type {
  EarthOcclusionExtension,
  EarthOcclusionExtensionProps,
} from "../Globe/EarthOcclusionExtension";
import { withStationLabels } from "../map/labelObstacles";
import type { TripProjection } from "./TripMapGlobeLayers";

/**
 * The trip map's own layers and the caller's (`extraLayers`: rail, ferry,
 * rental, bus, the recording), as the map draws them. On the globe the
 * caller's clip at the horizon like the map's own (Codex review before
 * 2.7.0-beta.23 — a line on the far hemisphere drew through the planet),
 * through the same `occludeExtraLayers` the dashboard globe applies; memoised,
 * so a re-render does not hand deck.gl freshly cloned layers. Bus terminal
 * names place around the stop/hotel labels; on the globe, the HTML overlay
 * draws them (forgejo#320). Split from `TripMap.tsx`, which is at the
 * 800-line limit.
 */
export function useTripLayers(
  own: Layer[],
  extraLayers: readonly Layer[] | undefined,
  projection: TripProjection,
  ext: EarthOcclusionExtension,
  props: EarthOcclusionExtensionProps
): Layer[] {
  const onGlobe = projection === "globe";
  const extras = useMemo(
    () => (extraLayers && onGlobe ? occludeExtraLayers(extraLayers, ext, props) : extraLayers),
    [extraLayers, onGlobe, ext, props]
  );
  return withStationLabels(own, extras, onGlobe);
}
