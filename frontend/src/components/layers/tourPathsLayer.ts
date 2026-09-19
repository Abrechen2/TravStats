import type { TourGeometry } from "../../types/tour";
import { TOUR_COLOR } from "../../shared/domains";

/**
 * Turns the geometry endpoint's output into `PathLayer` data.
 *
 * Every leg is the tour colour. This file used to hold five — one per means of
 * transport — with a comment arguing that "a colour is a claim about how a leg
 * was travelled", which is why an unrecognised mode got a neutral grey rather
 * than borrowing road's green. The owner settled it differently on 2026-09-05:
 * tours are ONE domain with ONE colour, and the means of transport is carried
 * by the ICON. The concern the five colours answered dissolves with them — a
 * hue that says nothing about the mode cannot make a false claim about it.
 *
 * `isPlaceholder` stays, and it is a different kind of statement: a `straight`
 * (unrouted) leg is a chord standing in for a measurement, so `TripMap.tsx`
 * draws it lighter and thinner. That is a claim about the DATA, not about the
 * vehicle, and it survives.
 */
const hex = TOUR_COLOR.slice(1);
const value = parseInt(hex, 16);

/** The one tour colour, as deck.gl wants it. Derived, so no second literal. */
export const TOUR_RGB: [number, number, number] = [
  (value >> 16) & 255,
  (value >> 8) & 255,
  value & 255,
];

export interface TourPathDatum {
  legId: string;
  path: Array<[number, number]>;
  color: [number, number, number];
  isPlaceholder: boolean;
  label: string;
}

export function buildTourPaths(
  geometries: readonly { routeId: string; name: string; geometry: TourGeometry }[]
): TourPathDatum[] {
  const out: TourPathDatum[] = [];
  for (const g of geometries) {
    for (const f of g.geometry.features) {
      const path = f.geometry.coordinates;
      if (path.length < 2) continue;
      out.push({
        legId: f.properties.legId,
        path,
        color: TOUR_RGB,
        isPlaceholder: f.properties.source === "straight",
        label: `${g.name} · ${Math.round(f.properties.distanceKm)} km`,
      });
    }
  }
  return out;
}
