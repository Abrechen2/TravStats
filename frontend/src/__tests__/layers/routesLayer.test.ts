import { describe, it, expect } from "vitest";
import {
  buildRouteData,
  createRoutesLayers,
  SCHEDULED_BLUE,
  MIXED_RED_HIGH,
} from "../../components/layers/routesLayer";
import type { ArcDatum } from "../../components/layers/layerTypes";
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
    expect(arcs[0].hasPastFlown).toBe(false);
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
    expect(arcs[0].hasPastFlown).toBe(true);
    expect(arcs[0].sourceColor).toEqual(arcs[0].targetColor);
  });

  it("renders pure-scheduled routes (upcoming, never flown) as solid sky-blue", () => {
    const scheduledOnly: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "sched-only-1", status: "scheduled" },
    };
    const { arcs } = buildRouteData([scheduledOnly], 1);
    expect(arcs).toHaveLength(1);
    const arc = arcs[0];
    expect(arc.hasUpcoming).toBe(true);
    expect(arc.hasPastFlown).toBe(false);
    expect(arc.sourceColor[0]).toBe(SCHEDULED_BLUE[0]);
    expect(arc.sourceColor[1]).toBe(SCHEDULED_BLUE[1]);
    expect(arc.sourceColor[2]).toBe(SCHEDULED_BLUE[2]);
    expect(arc.sourceColor).toEqual(arc.targetColor);
  });

  it("renders mixed routes (flown + scheduled) with hardcoded red core", () => {
    // Single canonical pair, frequency = 2 (one flown + one scheduled). With
    // a one-route dataset, q50 = 2, so count <= q50 → MIXED_RED_LOW. To
    // exercise MIXED_RED_HIGH we need count > q50, which requires a second
    // shorter route in the dataset.
    const flown: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "mix-flown-1", status: "flown" },
    };
    const scheduled: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "mix-sched-1", status: "scheduled" },
    };
    const otherFlown: GeoJSONFeature = {
      ...mockFlight,
      properties: {
        ...mockFlight.properties,
        id: "other-flown-1",
        status: "flown",
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
    const { arcs } = buildRouteData([flown, scheduled, otherFlown], 1);
    const mixedArc = arcs.find((a) => a.flightIds.includes("mix-flown-1"));
    expect(mixedArc).toBeDefined();
    expect(mixedArc!.hasUpcoming).toBe(true);
    expect(mixedArc!.hasPastFlown).toBe(true);
    // mixed pair has count = 2, other has count = 1 → q50 = 1, so 2 > q50
    // → MIXED_RED_HIGH (red-600).
    expect(mixedArc!.sourceColor[0]).toBe(MIXED_RED_HIGH[0]);
    expect(mixedArc!.sourceColor[1]).toBe(MIXED_RED_HIGH[1]);
    expect(mixedArc!.sourceColor[2]).toBe(MIXED_RED_HIGH[2]);
    expect(mixedArc!.sourceColor).toEqual(mixedArc!.targetColor);
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

describe("issue #120 — IATA-less airports still render", () => {
  // 1986-era / small airfields often have only an ICAO code (depIata is
  // nullable on the Flight row), but valid coordinates (depLat/depLon are
  // non-nullable, so the flight saves). The old render gate dropped any
  // flight without an IATA on BOTH dep and arr, making these flights
  // invisible despite having valid geometry. The gate must instead fall
  // back to ICAO, then to a coordinate-derived key.
  const icaoOnlyFlight: GeoJSONFeature = {
    type: "Feature",
    properties: {
      id: "1986-daytona",
      airline: "Eastern",
      flightNumber: "EA101",
      departureAirport: { icao: "KDAB", name: "Daytona Beach", lat: 29.18, lon: -81.06 },
      arrivalAirport: { icao: "KATL", name: "Atlanta", lat: 33.64, lon: -84.43 },
      departureTime: "1986-06-15T14:00:00Z",
      arrivalTime: "1986-06-15T15:30:00Z",
      status: "flown",
      distance: 600,
    },
    geometry: {
      type: "LineString",
      coordinates: [
        [-81.06, 29.18],
        [-84.43, 33.64],
      ],
    },
  };

  it("renders a flight whose airports have ICAO but no IATA", () => {
    const { arcs, points } = buildRouteData([icaoOnlyFlight], 1);
    expect(arcs).toHaveLength(1);
    expect(points).toHaveLength(2);
  });

  it("falls back to coordinates when neither IATA nor ICAO is present", () => {
    const coordOnly: GeoJSONFeature = {
      ...icaoOnlyFlight,
      properties: {
        ...icaoOnlyFlight.properties,
        id: "coord-only",
        departureAirport: { name: "Old Field A", lat: 29.18, lon: -81.06 },
        arrivalAirport: { name: "Old Field B", lat: 33.64, lon: -84.43 },
      },
    };
    const { arcs, points } = buildRouteData([coordOnly], 1);
    expect(arcs).toHaveLength(1);
    expect(points).toHaveLength(2);
  });

  it("still collapses bidirectional ICAO-only routes into one arc", () => {
    const reverse: GeoJSONFeature = {
      ...icaoOnlyFlight,
      properties: {
        ...icaoOnlyFlight.properties,
        id: "1986-return",
        departureAirport: icaoOnlyFlight.properties.arrivalAirport,
        arrivalAirport: icaoOnlyFlight.properties.departureAirport,
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-84.43, 33.64],
          [-81.06, 29.18],
        ],
      },
    };
    const { arcs } = buildRouteData([icaoOnlyFlight, reverse], 1);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].count).toBe(2);
  });
});

describe("createRoutesLayers", () => {
  it("returns 7 layers: regular arc, scheduled arc, upcoming arc, ring-inner, ring-outer, dot, labels", () => {
    const layers = createRoutesLayers(buildRouteData([mockFlight], 1));
    expect(layers).toHaveLength(7);
  });

  it("includes routes-arc, routes-arc-scheduled, and routes-arc-upcoming so each route is rendered exactly once", () => {
    const scheduled: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "sched-1", status: "scheduled" },
    };
    const layers = createRoutesLayers(buildRouteData([mockFlight, scheduled], 1));
    const ids = layers.map((l) => l.id);
    expect(ids).toContain("routes-arc");
    expect(ids).toContain("routes-arc-scheduled");
    expect(ids).toContain("routes-arc-upcoming");
    expect(ids).toContain("routes-ring-inner");
    expect(ids).toContain("routes-ring-outer");
    expect(ids).toContain("routes-dot");
    expect(ids).toContain("routes-labels");
    // Earlier rejected attempts — keep out of the layer set:
    expect(ids).not.toContain("routes-upcoming-marker");
    expect(ids).not.toContain("routes-upcoming-casing");
  });

  it("partitions arcs: regular → routes-arc, pure-scheduled → routes-arc-scheduled, mixed → routes-arc-upcoming", () => {
    const flown: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "fl-1", status: "flown" },
    };
    // Pure-scheduled — never-flown MUC-LAX with a single scheduled flight.
    const scheduledOnly: GeoJSONFeature = {
      ...mockFlight,
      properties: {
        ...mockFlight.properties,
        id: "sch-1",
        status: "scheduled",
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
    // Mixed — flown FRA-CDG + scheduled FRA-CDG on the same canonical pair.
    const mixedFlown: GeoJSONFeature = {
      ...mockFlight,
      properties: {
        ...mockFlight.properties,
        id: "mix-fl-1",
        status: "flown",
        departureAirport: { iata: "FRA", name: "Frankfurt", lat: 50.03, lon: 8.57 },
        arrivalAirport: { iata: "CDG", name: "Paris", lat: 49.01, lon: 2.55 },
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [8.57, 50.03],
          [2.55, 49.01],
        ],
      },
    };
    const mixedScheduled: GeoJSONFeature = {
      ...mixedFlown,
      properties: { ...mixedFlown.properties, id: "mix-sch-1", status: "scheduled" },
    };
    const layers = createRoutesLayers(
      buildRouteData([flown, scheduledOnly, mixedFlown, mixedScheduled], 1)
    );
    const regular = layers.find((l) => l.id === "routes-arc");
    const pureScheduled = layers.find((l) => l.id === "routes-arc-scheduled");
    const mixed = layers.find((l) => l.id === "routes-arc-upcoming");
    expect((regular?.props as { data?: unknown[] }).data).toHaveLength(1);
    expect((pureScheduled?.props as { data?: unknown[] }).data).toHaveLength(1);
    expect((mixed?.props as { data?: unknown[] }).data).toHaveLength(1);
  });

  it("caps arc width at 4 px even at very high frequency", () => {
    // 100 flights on a single canonical pair → sqrt(100) * 1.0 = 10, but the
    // cap should clamp it at 4. Drive getWidth via the shared sharedArcProps
    // so we exercise the production code path.
    const flights: GeoJSONFeature[] = Array.from({ length: 100 }, (_, i) => ({
      ...mockFlight,
      properties: { ...mockFlight.properties, id: `flood-${i}`, status: "flown" },
    }));
    const layers = createRoutesLayers(buildRouteData(flights, 1));
    const regularLayer = layers.find((l) => l.id === "routes-arc");
    expect(regularLayer).toBeDefined();
    const props = regularLayer!.props as unknown as {
      data: ArcDatum[];
      getWidth: (d: ArcDatum) => number;
    };
    expect(props.data).toHaveLength(1);
    const width = props.getWidth(props.data[0]);
    expect(width).toBeLessThanOrEqual(4);
    expect(width).toBeGreaterThan(0);
  });
});

describe("arc visibility floor (single far-flung routes stay visible)", () => {
  it("gives a single flown route a solidly opaque alpha (>= 160)", () => {
    const single: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "lonely", status: "flown" },
    };
    const { arcs } = buildRouteData([single], 1);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].sourceColor[3]).toBeGreaterThanOrEqual(160);
  });

  it("sets a 2px minimum width floor on the regular arc layer", () => {
    const single: GeoJSONFeature = {
      ...mockFlight,
      properties: { ...mockFlight.properties, id: "lonely2", status: "flown" },
    };
    const layers = createRoutesLayers(buildRouteData([single], 1));
    const regular = layers.find((l) => l.id === "routes-arc");
    expect(regular).toBeDefined();
    const props = regular!.props as unknown as { widthMinPixels: number };
    expect(props.widthMinPixels).toBeGreaterThanOrEqual(2);
  });
});
