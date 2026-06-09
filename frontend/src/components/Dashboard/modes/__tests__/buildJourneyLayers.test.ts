import { describe, it, expect } from "vitest";
import { groupByTripId } from "../buildJourneyLayers";
import type { GeoJSONFeature } from "../../../../types";
import type { Cruise } from "../../../../types/cruise";

/**
 * Helper that manufactures a GeoJSON feature with an injected `tripId`
 * in its properties. In production, the backend does not yet expose
 * `tripId` on the GeoJSON endpoint; these fixtures exercise the helper
 * in a future-ready way.
 */
function flightFeature(id: string, tripId: string | null): GeoJSONFeature {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
    properties: { id, tripId },
  } as unknown as GeoJSONFeature;
}

function cruise(id: string, tripId: string | null): Cruise {
  return { id, tripId, stops: [] } as unknown as Cruise;
}

describe("groupByTripId", () => {
  it("groups flight features + cruises by shared tripId", () => {
    const flights = [
      flightFeature("f1", "t1"),
      flightFeature("f2", "t1"),
      flightFeature("f3", null),
    ];
    const cruises = [cruise("c1", "t1"), cruise("c2", "t2")];
    const groups = groupByTripId(flights, cruises);

    expect(Object.keys(groups).sort()).toEqual(["t1", "t2"]);
    expect(groups.t1.flights.length).toBe(2);
    expect(groups.t1.cruises.map((c) => c.id)).toEqual(["c1"]);
    expect(groups.t2.cruises.map((c) => c.id)).toEqual(["c2"]);
    expect(groups.t2.flights.length).toBe(0);
  });

  it("ignores entries without tripId", () => {
    const groups = groupByTripId([flightFeature("x", null)], [cruise("y", null)]);
    expect(Object.keys(groups).length).toBe(0);
  });

  it("returns an empty record when both arrays are empty", () => {
    expect(Object.keys(groupByTripId([], [])).length).toBe(0);
  });

  it("handles only flights (no cruises)", () => {
    const flights = [flightFeature("f1", "trip-a"), flightFeature("f2", "trip-a")];
    const groups = groupByTripId(flights, []);
    expect(groups["trip-a"].flights.length).toBe(2);
    expect(groups["trip-a"].cruises.length).toBe(0);
  });

  it("handles only cruises (no flights)", () => {
    const groups = groupByTripId([], [cruise("c1", "trip-b")]);
    expect(groups["trip-b"].cruises.length).toBe(1);
    expect(groups["trip-b"].flights.length).toBe(0);
  });

  it("ignores empty-string tripId (treated same as null)", () => {
    const groups = groupByTripId([flightFeature("f1", "")], [cruise("c1", "")]);
    expect(Object.keys(groups).length).toBe(0);
  });
});
