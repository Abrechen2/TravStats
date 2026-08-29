import type { LegMode, TourGeometry } from "../../types/tour";

/**
 * Turns the geometry endpoint's output into `PathLayer` data.
 *
 * Colour comes from the LEG's mode, never the section's: a road tour with
 * one ferry crossing has to show that crossing as a ferry, or the map
 * claims the van drove across the Skagerrak.
 *
 * Hex values mirror the mode palette in `tokens`; a straight leg is dashed
 * because a chord is a placeholder and should not look like a measurement.
 */
export const TOUR_MODE_RGB: Record<LegMode, [number, number, number]> = {
  road: [141, 191, 106],
  ferry: [111, 160, 214],
  rail: [168, 148, 214],
  foot: [217, 180, 92],
  bike: [176, 209, 107],
};

export interface TourPathDatum {
  legId: string;
  path: Array<[number, number]>;
  color: [number, number, number];
  dashed: boolean;
  label: string;
}

export function buildTourPaths(
  geometries: readonly { routeId: string; name: string; geometry: TourGeometry }[],
): TourPathDatum[] {
  const out: TourPathDatum[] = [];
  for (const g of geometries) {
    for (const f of g.geometry.features) {
      const path = f.geometry.coordinates;
      if (path.length < 2) continue;
      out.push({
        legId: f.properties.legId,
        path,
        color: TOUR_MODE_RGB[f.properties.mode] ?? TOUR_MODE_RGB.road,
        dashed: f.properties.source === "straight",
        label: `${g.name} · ${Math.round(f.properties.distanceKm)} km`,
      });
    }
  }
  return out;
}
