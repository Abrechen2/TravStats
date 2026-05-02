import { describe, it, expect } from "vitest";
import { buildRouteData, createRoutesLayers } from "../../components/layers/routesLayer";
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

  it("renders past flown + scheduled on the same airport pair as two distinct arcs", () => {
    // Madagascar regression: 2024 flown ADD-TNR + 2026 scheduled ADD-TNR
    // share a route key. Past iteration drew a single mixed arc that fell
    // through to the heatmap branch and turned red. Now they should render
    // as two arcs — the past one keeps its heatmap colour, the scheduled
    // one stays cyan.
    const flownFlight: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "fl-past", status: "flown" },
    };
    const scheduledFlight: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "fl-future", status: "scheduled" },
    };
    const { arcs } = buildRouteData([flownFlight, scheduledFlight], 1);

    expect(arcs).toHaveLength(2);
    const scheduledArc = arcs.find((a) => a.isScheduled);
    const pastArc = arcs.find((a) => !a.isScheduled);
    expect(scheduledArc).toBeDefined();
    expect(pastArc).toBeDefined();

    // Scheduled arc must always be cyan/teal, regardless of past history.
    expect(scheduledArc!.sourceColor[0]).toBe(100);
    expect(scheduledArc!.sourceColor[1]).toBe(200);
    expect(scheduledArc!.sourceColor[2]).toBe(220);
    expect(scheduledArc!.flightIds).toEqual(["fl-future"]);

    // Past arc reflects only the flown count (1), not the scheduled one.
    expect(pastArc!.count).toBe(1);
    expect(pastArc!.flightIds).toEqual(["fl-past"]);
  });

  it("colours pure-scheduled routes cyan", () => {
    const scheduled: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "sched-1", status: "scheduled" },
    };
    const { arcs } = buildRouteData([scheduled], 1);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].isScheduled).toBe(true);
    expect(arcs[0].sourceColor[0]).toBe(100);
    expect(arcs[0].sourceColor[1]).toBe(200);
    expect(arcs[0].sourceColor[2]).toBe(220);
  });

  it("colours pure-historical routes grey", () => {
    const historical: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "hist-1", status: "historical" },
    };
    const { arcs } = buildRouteData([historical], 1);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].isHistorical).toBe(true);
    expect(arcs[0].sourceColor[0]).toBe(150);
    expect(arcs[0].sourceColor[1]).toBe(150);
    expect(arcs[0].sourceColor[2]).toBe(150);
  });
});

describe("createRoutesLayers", () => {
  it("returns 5 layers: arc, ring-inner, ring-outer, dot, labels", () => {
    const layers = createRoutesLayers([mockFlight], 1);
    expect(layers).toHaveLength(5);
  });

  it("layer ids include routes-ring-inner and routes-ring-outer", () => {
    const layers = createRoutesLayers([mockFlight], 1);
    const ids = layers.map((l) => l.id);
    expect(ids).toContain("routes-ring-inner");
    expect(ids).toContain("routes-ring-outer");
    expect(ids).toContain("routes-dot");
    expect(ids).toContain("routes-arc");
    expect(ids).toContain("routes-labels");
  });
});
