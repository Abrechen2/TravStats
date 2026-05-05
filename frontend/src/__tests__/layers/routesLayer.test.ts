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

  it("collapses past + scheduled on the same airport pair into ONE arc plus an upcoming marker", () => {
    // 2024 flown ADD-TNR + 2026 scheduled ADD-TNR share a canonical route
    // key. The old layer drew two arcs at the same arcHeight=1.0 that
    // perfectly overlapped (Madagascar regression). The new layer collapses
    // them to a single arc carrying both flightIds, with the "has-upcoming"
    // signal moved to a midpoint marker (shape, not arc colour).
    const flownFlight: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "fl-past", status: "flown" },
    };
    const scheduledFlight: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "fl-future", status: "scheduled" },
    };
    const { arcs, upcomingMarkers } = buildRouteData([flownFlight, scheduledFlight], 1);

    expect(arcs).toHaveLength(1);
    expect(arcs[0].count).toBe(2);
    expect(arcs[0].flightIds).toEqual(["fl-past", "fl-future"]);
    expect(arcs[0].hasUpcoming).toBe(true);

    // Heatmap colour, NOT the legacy cyan that scheduled arcs used to force.
    // sourceColor === targetColor so the arc reads as a single visual unit.
    expect(arcs[0].sourceColor).toEqual(arcs[0].targetColor);

    // Marker emitted for the route, anchored near the midpoint.
    expect(upcomingMarkers).toHaveLength(1);
    expect(upcomingMarkers[0].flightIds).toEqual(["fl-past", "fl-future"]);
    // FRA-JFK midpoint is roughly (-32.6, 45.3); allow some slack.
    expect(upcomingMarkers[0].position[0]).toBeGreaterThan(-40);
    expect(upcomingMarkers[0].position[0]).toBeLessThan(-25);
    expect(upcomingMarkers[0].position[1]).toBeGreaterThan(40);
    expect(upcomingMarkers[0].position[1]).toBeLessThan(50);
  });

  it("emits an upcoming marker for pure-scheduled routes", () => {
    const scheduled: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "sched-1", status: "scheduled" },
    };
    const { arcs, upcomingMarkers } = buildRouteData([scheduled], 1);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].hasUpcoming).toBe(true);
    expect(upcomingMarkers).toHaveLength(1);
    expect(upcomingMarkers[0].flightIds).toEqual(["sched-1"]);
  });

  it("emits no upcoming marker for routes without a scheduled flight", () => {
    const flown: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "flown-1", status: "flown" },
    };
    const { upcomingMarkers } = buildRouteData([flown], 1);
    expect(upcomingMarkers).toHaveLength(0);
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
  const routeData = buildRouteData([mockFlight], 1);

  it("returns 6 layers: arc, upcoming-marker, ring-inner, ring-outer, dot, labels", () => {
    const layers = createRoutesLayers(routeData);
    expect(layers).toHaveLength(6);
  });

  it("layer ids include routes-upcoming-marker and the airport ring/dot/label set", () => {
    const layers = createRoutesLayers(routeData);
    const ids = layers.map((l) => l.id);
    expect(ids).toContain("routes-arc");
    expect(ids).toContain("routes-upcoming-marker");
    expect(ids).toContain("routes-ring-inner");
    expect(ids).toContain("routes-ring-outer");
    expect(ids).toContain("routes-dot");
    expect(ids).toContain("routes-labels");
  });
});
