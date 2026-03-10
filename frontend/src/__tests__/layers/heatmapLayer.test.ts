import { describe, it, expect } from "vitest";
import { buildHeatmapData } from "../../components/layers/heatmapLayer";
import type { GeoJSONFeature } from "../../types";

const makeFlight = (
  depIata: string,
  depLon: number,
  depLat: number,
  arrIata: string,
  arrLon: number,
  arrLat: number
): GeoJSONFeature => ({
  type: "Feature",
  properties: {
    id: `${depIata}-${arrIata}`,
    airline: "LH",
    flightNumber: "LH1",
    departureAirport: { iata: depIata, lat: depLat, lon: depLon },
    arrivalAirport: { iata: arrIata, lat: arrLat, lon: arrLon },
    departureTime: "2024-01-01T10:00:00Z",
    arrivalTime: "2024-01-01T14:00:00Z",
    status: "flown",
    distance: 100,
  },
  geometry: {
    type: "LineString",
    coordinates: [
      [depLon, depLat],
      [arrLon, arrLat],
    ],
  },
});

describe("buildHeatmapData", () => {
  it("returns one point per unique airport", () => {
    const points = buildHeatmapData([makeFlight("FRA", 8.5, 50.0, "JFK", -73.78, 40.64)]);
    expect(points).toHaveLength(2);
  });

  it("accumulates weight for repeated airports", () => {
    const flights = [
      makeFlight("FRA", 8.5, 50.0, "JFK", -73.78, 40.64),
      makeFlight("FRA", 8.5, 50.0, "CDG", 2.55, 49.01),
    ];
    const points = buildHeatmapData(flights);
    const fra = points.find((p) => p.position[0] === 8.5);
    expect(fra?.weight).toBe(2);
  });

  it("skips flights with missing geometry coordinates", () => {
    const flight: GeoJSONFeature = {
      type: "Feature",
      properties: {
        id: "f1",
        airline: "LH",
        flightNumber: "LH1",
        departureAirport: { iata: "FRA", lat: 50.03, lon: 8.57 },
        arrivalAirport: { iata: "JFK", lat: 40.64, lon: -73.78 },
        departureTime: "",
        arrivalTime: "",
        status: "flown",
        distance: 100,
      },
      geometry: { type: "LineString", coordinates: [] },
    };
    const points = buildHeatmapData([flight]);
    expect(points).toHaveLength(0); // entire flight skipped — no coords
  });
});
