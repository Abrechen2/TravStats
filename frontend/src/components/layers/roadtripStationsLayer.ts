import { ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";

import { markerDotRadiusProps } from "./markerDotStyle";

/** A station as the dashboard map marks it — from `GET /roadtrips` `stations`. */
export interface RoadtripStationPoint {
  id: string;
  title: string;
  lat: number;
  lon: number;
  state: "stay" | "free" | "pass";
  roadtripName: string;
}

export type StationStateColors = Record<RoadtripStationPoint["state"], [number, number, number]>;

/**
 * The roadtrip's own stations on the dashboard map (tester 2026-09-26): the
 * lines alone did not say where the nights were. A layer of its own, built
 * from the list endpoint's `stations`, so it carries over unchanged to a map
 * that shows every domain at once. Route corrections never reach it — the
 * server leaves them out of that list.
 *
 * `altitudeM` lifts the markers to the lines' height on the globe
 * (`TOUR_PATH_GLOBE_ALTITUDE_M`); 0 on the flat map. `sizeScale` is the map
 * panel's roadtrip station slider (forgejo#198) — 0 draws no stations at all.
 */
export function buildRoadtripStationLayers(
  stations: readonly RoadtripStationPoint[],
  colors: StationStateColors,
  altitudeM = 0,
  sizeScale = 1
): Layer[] {
  if (stations.length === 0 || sizeScale <= 0) return [];
  return [
    new ScatterplotLayer<RoadtripStationPoint>({
      id: "dashboard-roadtrip-stations",
      data: stations as RoadtripStationPoint[],
      getPosition: (d) => (altitudeM === 0 ? [d.lon, d.lat] : [d.lon, d.lat, altitudeM]),
      getFillColor: (d) => [...colors[d.state], 255] as [number, number, number, number],
      getLineColor: [13, 17, 23, 255],
      stroked: true,
      lineWidthMinPixels: 1.5,
      ...markerDotRadiusProps(sizeScale),
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 90],
    }),
  ];
}
