import { describe, it, expect } from "vitest";
import { buildRouteData } from "../../components/layers/routesLayer";
import type { GeoJSONFeature } from "../../types";

const mockFlight: GeoJSONFeature = {
  type: "Feature",
  properties: {
    id: "f1",
    airline: "LH",
    flightNumber: "LH123",
    departureAirport: { iata: "FRA", name: "Frankfurt", lat: 50.03, lon: 8.57 },
    arrivalAirport: { iata: "JFK", name: "New York", lat: 40.64, lon: -73.78 },
    departureTime: "2024-01-01T10:00:00Z",
    arrivalTime: "2024-01-01T14:00:00Z",
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

describe("buildRouteData", () => {
  it("returns arcs and points from flights", () => {
    const { arcs, points } = buildRouteData([mockFlight], 1);
    expect(arcs).toHaveLength(1);
    expect(points.length).toBeGreaterThan(0);
  });

  it("aggregates bidirectional routes (FRA-JFK === JFK-FRA)", () => {
    const reverse: GeoJSONFeature = {
      ...mockFlight,
      properties: {
        ...mockFlight.properties,
        id: "f2",
        departureAirport: mockFlight.properties.arrivalAirport,
        arrivalAirport: mockFlight.properties.departureAirport,
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-73.78, 40.64],
          [8.57, 50.03],
        ],
      },
    };
    const { arcs } = buildRouteData([mockFlight, reverse], 1);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].count).toBe(2);
  });

  it("filters routes below minRouteCount", () => {
    const { arcs } = buildRouteData([mockFlight], 2);
    expect(arcs).toHaveLength(0);
  });

  it("skips flights with missing geometry coordinates", () => {
    const incomplete: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "f3" },
      geometry: { type: "LineString", coordinates: [] },
    };
    const { arcs } = buildRouteData([incomplete], 1);
    expect(arcs).toHaveLength(0);
  });
});
