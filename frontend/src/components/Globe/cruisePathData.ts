import { resolveCruiseArcColor, type CruiseColorConfig } from "../../lib/cruiseColor";
import type { Cruise } from "../../types/cruise";
import type { CruiseRouteFeatureCollection } from "../../lib/api/cruise";
import type { PortPointWindow } from "./globePointData";
import * as cruiseLegs from "../map/cards/journeys/cruiseLegJourneys";
import type { CruisePathDatum } from "./globeLayerTypes";
import {
  legProgress,
  legVisibleFilter,
  truncatePolyline,
  type CruiseLegDates,
} from "./timeSliderUtils";

/** Cruise legs as globe path data, trimmed/filtered by the time slider. */
export function buildCruisePaths(
  cruises: readonly Cruise[],
  cruiseGeometry: ReadonlyMap<string, CruiseRouteFeatureCollection>,
  cruiseLegDatesByCruise: ReadonlyMap<string, CruiseLegDates[]>,
  cruiseColorConfig: CruiseColorConfig,
  slider: PortPointWindow
): CruisePathDatum[] {
  const {
    mode: sliderMode,
    current: sliderCurrent,
    filterStart: sliderFilterStart,
    filterEnd: sliderFilterEnd,
  } = slider;
  const out: CruisePathDatum[] = [];
  for (const cruise of cruises) {
    const fc = cruiseGeometry.get(cruise.id);
    if (!fc) continue;
    const label = cruise.ship?.name ?? cruise.shipNameOverride ?? cruise.cruiseLine ?? "Cruise";
    const legDates = cruiseLegDatesByCruise.get(cruise.id) ?? [];
    // Resolved once per cruise — same helper the flat map's
    // cruiseArcsLayer.ts uses, so both renderers agree pixel-for-pixel on
    // every mode. There is no override path: the user's config is the only
    // input (the old `cruiseRouteColor ?? …` override IS the "solid" mode now).
    const color = resolveCruiseArcColor(cruise, cruiseColorConfig);
    const base = { cruiseId: cruise.id, cruiseLabel: label, status: cruise.status, color };
    // Index legs by "from:to" so we can pair geometry to date in O(1).
    const dateByPair = new Map<string, CruiseLegDates>();
    for (const ld of legDates) dateByPair.set(`${ld.fromPortId}:${ld.toPortId}`, ld);

    for (const feature of fc.features) {
      const path = feature.geometry.coordinates as [number, number][];
      if (path.length < 2) continue;
      const { fromPortId, toPortId } = feature.properties;
      const leg = (p: [number, number][]) => ({ ...base, path: p, fromPortId, toPortId });

      if (sliderMode === "live" && sliderCurrent) {
        const ld = dateByPair.get(
          `${feature.properties.fromPortId}:${feature.properties.toPortId}`
        );
        if (ld) {
          const p = legProgress(ld, sliderCurrent);
          if (p === 0) continue; // not yet sailed
          if (p < 1) {
            // truncatePolyline expects [lat, lng]; MapLibre paths are
            // [lng, lat]. Swap → truncate → swap back so the
            // haversine inside the helper sees real latitudes.
            const swapped = path.map(([lng, lat]) => [lat, lng] as [number, number]);
            const partialSwapped = truncatePolyline(swapped, p);
            if (partialSwapped.length < 2) continue;
            const partial = partialSwapped.map(([lat, lng]) => [lng, lat] as [number, number]);
            out.push(leg(partial));
            continue;
          }
          // p >= 1: full leg falls through to push-full below
        }
      }

      if (sliderMode === "filter" && sliderFilterStart && sliderFilterEnd) {
        const ld = dateByPair.get(
          `${feature.properties.fromPortId}:${feature.properties.toPortId}`
        );
        if (ld && !legVisibleFilter(ld, sliderFilterStart, sliderFilterEnd)) continue;
      }

      out.push(leg(path));
    }
  }
  return cruiseLegs.withCruiseLegHover(out, cruiseLegs.indexCruiseLegs(cruises));
}
