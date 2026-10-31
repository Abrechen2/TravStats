// forgejo#352: the globe's live playback rebuilds the arc data ten times a
// second. A route's great-circle waypoints must be tessellated once, not on
// every tick, however many flights around it came or went.

import { describe, expect, it } from "vitest";
import { buildGlobeArcData } from "../globeArcData";
import type { GeoJSONFeature } from "../../../types";

const flight = (id: string, from: [string, number, number], to: [string, number, number]) =>
  ({
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [from[1], from[2]],
        [to[1], to[2]],
      ],
    },
    properties: {
      id,
      status: "flown",
      departureTime: "2024-01-01T00:00:00Z",
      departureAirport: { iata: from[0], name: from[0] },
      arrivalAirport: { iata: to[0], name: to[0] },
    },
  }) as unknown as GeoJSONFeature;

const FRA: [string, number, number] = ["FRA", 8.57, 50.03];
const JFK: [string, number, number] = ["JFK", -73.78, 40.64];
const MUC: [string, number, number] = ["MUC", 11.79, 48.35];

describe("buildGlobeArcData waypoint reuse", () => {
  it("hands a route the same waypoints on the next build, even as other flights come and go", () => {
    const first = buildGlobeArcData([flight("a", FRA, JFK)], 1, false, 1);
    const second = buildGlobeArcData([flight("a", FRA, JFK), flight("b", MUC, JFK)], 1, false, 1);
    const fraJfk = (d: typeof first) => d.arcsData.find((a) => a.departure.iata === "FRA");
    expect(fraJfk(first)?.waypoints.length).toBeGreaterThan(2);
    expect(fraJfk(second)?.waypoints).toBe(fraJfk(first)?.waypoints);
    expect(second.arcsData).toHaveLength(2);
  });

  it("does not share waypoints between different altitude factors", () => {
    const low = buildGlobeArcData([flight("a", FRA, JFK)], 1, false, 1);
    const high = buildGlobeArcData([flight("a", FRA, JFK)], 1, false, 2);
    expect(high.arcsData[0].waypoints).not.toBe(low.arcsData[0].waypoints);
  });
});
