import { describe, it, expect } from "vitest";
import { computeAirportStats } from "../buildStatsMapLayer";
import type { GeoJSONFeature } from "../../../../types";

function feature(
  dep: string,
  depLat: number,
  depLon: number,
  arr: string,
  arrLat: number,
  arrLon: number
): GeoJSONFeature {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [depLon, depLat],
        [arrLon, arrLat],
      ],
    },
    properties: {
      id: `${dep}-${arr}`,
      airline: "LH",
      flightNumber: "LH001",
      departureAirport: { iata: dep, name: dep, lat: depLat, lon: depLon },
      arrivalAirport: { iata: arr, name: arr, lat: arrLat, lon: arrLon },
      departureTime: null,
      arrivalTime: null,
      status: "flown",
      distance: 0,
    },
  };
}

describe("computeAirportStats", () => {
  it("counts each airport touch exactly once per flight (dep + arr)", () => {
    const flights: GeoJSONFeature[] = [
      feature("FRA", 50, 8, "JFK", 40, -74),
      feature("FRA", 50, 8, "LHR", 51, 0),
      feature("LHR", 51, 0, "FRA", 50, 8),
    ];
    const stats = computeAirportStats(flights);
    const byIata = Object.fromEntries(stats.map((s) => [s.iata, s.count]));
    expect(byIata["FRA"]).toBe(3);
    expect(byIata["JFK"]).toBe(1);
    expect(byIata["LHR"]).toBe(2);
  });

  it("skips features without valid airport info", () => {
    const flights: GeoJSONFeature[] = [
      feature("FRA", 50, 8, "JFK", 40, -74),
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [] },
        properties: {
          id: "bad",
          airline: "",
          flightNumber: "",
          departureAirport: {},
          arrivalAirport: {},
          departureTime: null,
          arrivalTime: null,
          status: "flown",
          distance: 0,
        },
      },
    ];
    const stats = computeAirportStats(flights);
    expect(stats.length).toBe(2);
    expect(stats.every((s) => typeof s.lat === "number" && typeof s.lon === "number")).toBe(true);
  });

  it("returns an empty array for an empty input", () => {
    expect(computeAirportStats([])).toEqual([]);
  });
});
