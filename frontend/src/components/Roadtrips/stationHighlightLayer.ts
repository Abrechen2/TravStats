import { ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";

interface Point {
  position: [number, number];
}

/**
 * The ring around the station the reader picked in the timeline, so a row
 * and its place on the map are read together. A layer of its own, handed to
 * `TripMap` as an extra: the map stays ignorant of roadtrips.
 */
export function stationHighlightLayer(point: { lat: number; lon: number } | null): Layer[] {
  if (!point) return [];
  return [
    new ScatterplotLayer<Point>({
      id: "roadtrip-selected-station",
      data: [{ position: [point.lon, point.lat] }],
      getPosition: (d) => d.position,
      getRadius: 14,
      radiusUnits: "pixels",
      filled: false,
      stroked: true,
      getLineColor: [244, 236, 224, 255],
      lineWidthUnits: "pixels",
      getLineWidth: 3,
      pickable: false,
    }),
  ];
}
