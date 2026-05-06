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

  it("collapses past + scheduled on the same pair into ONE arc with hasUpcoming flagged", () => {
    // 2024 flown FRA-JFK + 2026 scheduled FRA-JFK share a canonical route
    // key. The old layer drew two arcs at the same arcHeight=1.0 that
    // perfectly overlapped (Madagascar regression). The new layer collapses
    // them into a single ArcDatum; the "scheduled" signal is rendered by a
    // separate UpcomingArcLayer (custom shader) — the data layer keeps
    // sourceColor === targetColor (uniform heatmap) and just flags
    // hasUpcoming.
    const flownFlight: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "fl-past", status: "flown" },
    };
    const scheduledFlight: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "fl-future", status: "scheduled" },
    };
    const { arcs } = buildRouteData([flownFlight, scheduledFlight], 1);

    expect(arcs).toHaveLength(1);
    expect(arcs[0].count).toBe(2);
    expect(arcs[0].flightIds).toEqual(["fl-past", "fl-future"]);
    expect(arcs[0].hasUpcoming).toBe(true);
    // Uniform colour at the data layer; the shader paints blue at the ends.
    expect(arcs[0].sourceColor).toEqual(arcs[0].targetColor);
  });

  it("flags hasUpcoming on pure-scheduled routes and keeps colour uniform", () => {
    const scheduled: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "sched-1", status: "scheduled" },
    };
    const { arcs } = buildRouteData([scheduled], 1);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].hasUpcoming).toBe(true);
    expect(arcs[0].sourceColor).toEqual(arcs[0].targetColor);
  });

  it("does not flag hasUpcoming on routes without any scheduled flight", () => {
    const flown: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "flown-1", status: "flown" },
    };
    const { arcs } = buildRouteData([flown], 1);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].hasUpcoming).toBe(false);
    expect(arcs[0].sourceColor).toEqual(arcs[0].targetColor);
  });

  it("colours pure-historical routes grey and flags isHistorical", () => {
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
  it("returns 6 layers: regular arc, upcoming arc, ring-inner, ring-outer, dot, labels", () => {
    const layers = createRoutesLayers([mockFlight], 1);
    expect(layers).toHaveLength(6);
  });

  it("includes both routes-arc and routes-arc-upcoming so each route is rendered exactly once", () => {
    const scheduled: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "sched-1", status: "scheduled" },
    };
    const layers = createRoutesLayers([mockFlight, scheduled], 1);
    const ids = layers.map((l) => l.id);
    expect(ids).toContain("routes-arc");
    expect(ids).toContain("routes-arc-upcoming");
    expect(ids).toContain("routes-ring-inner");
    expect(ids).toContain("routes-ring-outer");
    expect(ids).toContain("routes-dot");
    expect(ids).toContain("routes-labels");
    // Earlier rejected attempts — keep out of the layer set:
    expect(ids).not.toContain("routes-upcoming-marker");
    expect(ids).not.toContain("routes-upcoming-casing");
  });

  it("partitions arcs: routes-arc gets non-upcoming, routes-arc-upcoming gets the rest", () => {
    const flown: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "fl-1", status: "flown" },
    };
    const scheduled: GeoJSONFeature = {
      ...mockFlight,
      properties: {
        ...mockFlight.properties,
        id: "sch-1",
        status: "scheduled",
        // Different airport pair to keep them as separate canonical routes.
        departureAirport: { iata: "MUC", name: "Munich", lat: 48.35, lon: 11.78 },
        arrivalAirport: { iata: "LAX", name: "LAX", lat: 33.94, lon: -118.4 },
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [11.78, 48.35],
          [-118.4, 33.94],
        ],
      },
    };
    const layers = createRoutesLayers([flown, scheduled], 1);
    const regular = layers.find((l) => l.id === "routes-arc");
    const upcoming = layers.find((l) => l.id === "routes-arc-upcoming");
    expect((regular?.props as { data?: unknown[] }).data).toHaveLength(1);
    expect((upcoming?.props as { data?: unknown[] }).data).toHaveLength(1);
  });
});
