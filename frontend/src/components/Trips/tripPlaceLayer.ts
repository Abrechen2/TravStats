// The trip map's place-visit layer: the places visited on this trip, drawn
// with the dashboard's own place pins (`buildPlacePins`) so a dot cannot drift
// from the colour, size or visited/planned shape the dashboard gives it, and
// opening the same place card when clicked. Names stay off: a trip map already
// carries stop, hotel and station labels, and the click card names the place.

import type { Layer } from "@deck.gl/core";
import { buildPlacePins } from "../layers/placePinsLayer";
import { pinnedFromPlace } from "../map/cards/buildFlatPinned";
import { useMapCardSelectionStore } from "../../store/mapCardSelectionStore";
import type { PlaceColorConfig } from "../../lib/placeColor";
import type { Place } from "../../types/place";
import type { LngLat } from "./tripMapBounds";

/** A place once, however many times the trip visited it. */
function distinctPlaces(placeVisits: readonly { place: Place }[]): Place[] {
  const byId = new Map<string, Place>();
  for (const { place } of placeVisits) byId.set(place.id, place);
  return [...byId.values()];
}

export function buildTripPlaceLayers(
  placeVisits: readonly { place: Place }[],
  colors: PlaceColorConfig
): Layer[] {
  const places = distinctPlaces(placeVisits);
  const byId = new Map(places.map((p) => [p.id, p]));
  return (
    buildPlacePins(places, 1, undefined, {
      colors,
      labelsMode: "off",
      onPinClick: (placeId) => {
        const place = byId.get(placeId);
        if (place) useMapCardSelectionStore.getState().select(pinnedFromPlace(place));
      },
    }) ?? []
  );
}

/** The points the camera must frame so a place is never drawn where it does not look. */
export function tripPlacePoints(placeVisits: readonly { place: Place }[]): LngLat[] {
  return distinctPlaces(placeVisits)
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map((p): LngLat => [p.lon, p.lat]);
}
