import type { CruiseRouteFeatureCollection } from "../../lib/api/cruise";
import type { CruiseColorConfig } from "../../lib/cruiseColor";
import {
  indexCruiseLegs,
  withCruiseLegHover,
  type CruiseLegSource,
} from "../map/cards/journeys/cruiseLegJourneys";
import type { TripCruisePath } from "./TripMapGlobeLayers";
import { resolveTripCruiseColor } from "./tripMapColors";

type TripCruise = CruiseLegSource & { color?: string | null };

/**
 * The trip map's cruise legs: one path per leg the sea router drew, each in its
 * cruise's colour from the cruise colour store, carrying the journey hover a
 * flight route has — both ports and how often the leg was sailed
 * (forgejo#323). Split from `TripMap.tsx`, which is at the 800-line limit.
 */
export function buildTripCruisePaths(
  cruises: readonly TripCruise[],
  geometry: ReadonlyMap<string, CruiseRouteFeatureCollection>,
  colors: CruiseColorConfig
): TripCruisePath[] {
  const byId = new Map(cruises.map((c) => [c.id, c]));
  const out: TripCruisePath[] = [];
  for (const [cruiseId, fc] of geometry.entries()) {
    const cruise = byId.get(cruiseId);
    for (const feat of fc.features) {
      if (feat.geometry.coordinates.length < 2) continue;
      out.push({
        cruiseId,
        path: feat.geometry.coordinates,
        label: cruise?.cruiseLine ?? "Cruise",
        color: cruise ? resolveTripCruiseColor(cruise, colors) : colors.colors.past,
        fromPortId: feat.properties.fromPortId,
        toPortId: feat.properties.toPortId,
      });
    }
  }
  return withCruiseLegHover(out, indexCruiseLegs(cruises));
}
