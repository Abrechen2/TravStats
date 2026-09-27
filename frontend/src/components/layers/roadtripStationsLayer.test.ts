import { describe, expect, it } from "vitest";
import { ScatterplotLayer } from "@deck.gl/layers";

import { buildRoadtripStationLayers, type RoadtripStationPoint } from "./roadtripStationsLayer";

/**
 * Tester 2026-09-26: the dashboard's Roadtrips tab drew only the lines. Now it
 * also marks the roadtrip's own stations — the stays, free nights and
 * pass-throughs — each in the state's colour, lifted on the globe like the
 * lines so they are not buried in the terrain.
 */
const COLORS = {
  stay: [10, 20, 30] as [number, number, number],
  free: [40, 50, 60] as [number, number, number],
  pass: [70, 80, 90] as [number, number, number],
};
const STATIONS: RoadtripStationPoint[] = [
  { id: "a", title: "Hamburg", lat: 53.55, lon: 9.99, state: "pass", roadtripName: "Nord" },
  { id: "b", title: "Mosvangen", lat: 58.95, lon: 5.72, state: "stay", roadtripName: "Nord" },
  { id: "c", title: "bei Odda", lat: 60.07, lon: 6.55, state: "free", roadtripName: "Nord" },
];

describe("roadtrip station markers", () => {
  it("draws one marker per station, coloured by what the station was", () => {
    const [layer] = buildRoadtripStationLayers(STATIONS, COLORS, 0);
    expect(layer).toBeInstanceOf(ScatterplotLayer);
    const props = layer.props as unknown as {
      data: RoadtripStationPoint[];
      getFillColor: (d: RoadtripStationPoint) => number[];
      getPosition: (d: RoadtripStationPoint) => number[];
    };
    expect(props.data).toHaveLength(3);
    expect(STATIONS.map((s) => props.getFillColor(s).slice(0, 3))).toEqual([
      COLORS.pass,
      COLORS.stay,
      COLORS.free,
    ]);
    expect(props.getPosition(STATIONS[0])).toEqual([9.99, 53.55]);
  });

  it("lifts the markers on the globe to the lines' altitude", () => {
    const [layer] = buildRoadtripStationLayers(STATIONS, COLORS, 5000);
    const props = layer.props as unknown as {
      getPosition: (d: RoadtripStationPoint) => number[];
    };
    expect(props.getPosition(STATIONS[1])).toEqual([5.72, 58.95, 5000]);
  });

  it("draws nothing without stations", () => {
    expect(buildRoadtripStationLayers([], COLORS, 0)).toEqual([]);
  });
});
