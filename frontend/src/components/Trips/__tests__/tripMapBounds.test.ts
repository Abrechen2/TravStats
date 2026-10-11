import { describe, expect, it } from "vitest";
import { tripBoundsPoints, type TripBoundsSources } from "../tripMapBounds";
import { busPathPoints } from "../tripBusLayer";
import type { TripBusJourney } from "../../../types/bus";

const none: TripBoundsSources = {
  flightArcs: [],
  cruisePaths: [],
  stopPoints: [],
  lodgings: [],
  tourPaths: [],
  extraPoints: [],
};

describe("tripBoundsPoints", () => {
  it("is empty for a trip with nothing on the map — the case the notice is for", () => {
    expect(tripBoundsPoints(none)).toEqual([]);
  });

  it("counts every kind of thing the map draws", () => {
    const pts = tripBoundsPoints({
      flightArcs: [{ source: [1, 1], target: [2, 2] }],
      cruisePaths: [{ path: [[3, 3]] }],
      stopPoints: [{ position: [4, 4] }],
      lodgings: [
        { lat: 6, lon: 5 },
        { lat: null, lon: 9 },
      ],
      tourPaths: [{ path: [[7, 7]] }],
      extraPoints: [[8, 8]],
    });
    expect(pts).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 6],
      [7, 7],
      [8, 8],
    ]);
  });

  // Found on the 2.7.0-beta.20 beta: a trip whose only geo data were three bus
  // rides in Korea got the "no geo data" notice and a camera on the Atlantic,
  // because the lines were drawn through extraLayers and never reached this list.
  it("a trip made only of bus rides is not empty and is framed around them", () => {
    const rides = [
      { id: "r1", depLat: 37.5, depLon: 127.0, arrLat: 38.2, arrLon: 128.6, geometry: null },
      { id: "r2", depLat: 35.8, depLon: 127.1, arrLat: 35.1, arrLon: 129.0, geometry: null },
    ] as unknown as TripBusJourney[];
    const pts = tripBoundsPoints({ ...none, extraPoints: busPathPoints(rides) });
    expect(pts).toHaveLength(4);
    expect(pts).toContainEqual([127.0, 37.5]);
    expect(pts).toContainEqual([129.0, 35.1]);
  });
});
