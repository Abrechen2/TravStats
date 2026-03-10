import { describe, it, expect } from "vitest";
import { buildTripsData, getTimeRange } from "../../components/layers/tripsLayer";
import type { GeoJSONFeature } from "../../types";

const mockFlight: GeoJSONFeature = {
  type: "Feature",
  properties: {
    id: "f1",
    airline: "LH",
    flightNumber: "LH1",
    departureAirport: { iata: "FRA", lat: 50.03, lon: 8.57 },
    arrivalAirport: { iata: "JFK", lat: 40.64, lon: -73.78 },
    departureTime: "2024-06-01T10:00:00Z",
    arrivalTime: "2024-06-01T18:00:00Z",
    status: "flown",
    distance: 6200,
  },
  geometry: {
    type: "LineString",
    coordinates: [
      [8.57, 50.03],
      [-73.78, 40.64],
    ],
  },
};

describe("buildTripsData", () => {
  it("converts flights to trip paths with timestamps", () => {
    const trips = buildTripsData([mockFlight]);
    expect(trips).toHaveLength(1);
    expect(trips[0].path).toHaveLength(2);
    expect(trips[0].timestamps).toHaveLength(2);
  });

  it("timestamps are Unix seconds (not milliseconds)", () => {
    const trips = buildTripsData([mockFlight]);
    // 2024 dates are > 1.7 billion Unix seconds
    expect(trips[0].timestamps[0]).toBeGreaterThan(1700000000);
    // But < 2 trillion (would indicate milliseconds)
    expect(trips[0].timestamps[0]).toBeLessThan(2000000000000);
  });

  it("departure timestamp < arrival timestamp", () => {
    const trips = buildTripsData([mockFlight]);
    expect(trips[0].timestamps[0]).toBeLessThan(trips[0].timestamps[1]);
  });

  it("skips flights with missing geometry coordinates", () => {
    const incomplete: GeoJSONFeature = {
      ...mockFlight,
      geometry: { type: "LineString", coordinates: [] },
    };
    const trips = buildTripsData([incomplete]);
    expect(trips).toHaveLength(0);
  });
});

describe("getTimeRange", () => {
  it("returns min and max timestamps from trips", () => {
    const trips = buildTripsData([mockFlight]);
    const range = getTimeRange(trips);
    expect(range.min).toBeLessThan(range.max);
    expect(range.min).toBe(trips[0].timestamps[0]);
    expect(range.max).toBe(trips[0].timestamps[1]);
  });
});
