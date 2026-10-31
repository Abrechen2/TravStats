import { describe, expect, it } from "vitest";
import type { Layer } from "@deck.gl/core";
import {
  ALL_ROUTES_VISIBLE,
  routeDomainOfLayerId,
  routesBlockedReason,
  routesVisibleFromStored,
  withoutHiddenRoutes,
} from "../mapRoutes";
import { buildRouteData, createRoutesLayers } from "../../components/layers/routesLayer";
import { buildRailDeckLayers } from "../../components/layers/railPathsLayer";
import { buildTerminalRideLines } from "../../components/Dashboard/tabs/terminalRideMapOverlay";
import type { GeoJSONFeature } from "../../types";

const ids = (layers: readonly Layer[]): string[] => layers.map((l) => l.id);
const fake = (id: string): Layer => ({ id }) as unknown as Layer;
const off = (domain: keyof typeof ALL_ROUTES_VISIBLE) => ({
  ...ALL_ROUTES_VISIBLE,
  [domain]: false,
});

const flight = {
  type: "Feature",
  properties: {
    id: "f1",
    airline: "LH",
    flightNumber: "LH1",
    departureAirport: { iata: "FRA", name: "Frankfurt", lat: 50.03, lon: 8.57 },
    arrivalAirport: { iata: "JFK", name: "New York", lat: 40.64, lon: -73.78 },
    departureTime: "2024-05-01T08:00:00Z",
    arrivalTime: "2024-05-01T19:00:00Z",
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
} as unknown as GeoJSONFeature;

describe("route switches: each domain's switch removes only its own line layers", () => {
  it("flight off drops the arcs (both shapes) but keeps airport dots, rings and IATA labels", () => {
    for (const routeShape of ["arc", "flat"] as const) {
      const layers = createRoutesLayers(
        buildRouteData([flight], 1),
        undefined,
        undefined,
        0.3,
        [],
        undefined,
        5,
        {
          routeShape,
        }
      );
      const kept = ids(withoutHiddenRoutes(layers, off("flight")));
      expect(kept, routeShape).toEqual(
        expect.arrayContaining([
          "routes-dot",
          "routes-ring-inner",
          "routes-ring-outer",
          "routes-labels",
        ])
      );
      expect(
        kept.filter((id) => /^routes-(arc|path)/.test(id)),
        routeShape
      ).toEqual([]);
      expect(ids(layers).length).toBeGreaterThan(kept.length);
    }
  });

  it("cruise off drops sea routes and arrows but keeps port dots and labels", () => {
    const layers = ["cruise-arcs", "cruise-arc-arrows", "cruise-ports", "cruise-ports-labels"].map(
      fake
    );
    expect(ids(withoutHiddenRoutes(layers, off("cruise")))).toEqual([
      "cruise-ports",
      "cruise-ports-labels",
    ]);
  });

  it("rail off drops the track but keeps the stations", () => {
    const layers = buildRailDeckLayers(
      [
        {
          path: [
            [0, 0],
            [1, 1],
          ],
          traced: true,
        },
      ] as never,
      [{ position: [0, 0] }] as never,
      { color: [1, 2, 3], idPrefix: "all-rail" }
    );
    expect(ids(layers)).toEqual(["all-rail-paths", "all-rail-stations"]);
    expect(ids(withoutHiddenRoutes(layers, off("rail")))).toEqual(["all-rail-stations"]);
    expect(ids(withoutHiddenRoutes(layers, off("bus")))).toEqual(ids(layers));
  });

  it("bus and ferry each drop their own road/crossing and keep their terminals", () => {
    const ride = { id: "r", depLat: 1, depLon: 1, arrLat: 2, arrLon: 2, geometry: null } as never;
    for (const [domain, prefix] of [
      ["bus", "all-bus"],
      ["ferry", "all-ferry"],
    ] as const) {
      const layers = buildTerminalRideLines([ride], "#c49a6c", false, prefix, true);
      expect(ids(withoutHiddenRoutes(layers, off(domain)))).toEqual([`${prefix}-terminals`]);
      const other = domain === "bus" ? "ferry" : "bus";
      expect(ids(withoutHiddenRoutes(layers, off(other)))).toEqual(ids(layers));
    }
  });

  it("the globe's flight arcs go with the flight switch, its airport dots stay", () => {
    const layers = [
      "globe-flight-arcs",
      "globe-flight-arcs-antipodal",
      "globe-airport-dots",
      "globe-cruise-paths",
      "globe-port-dots",
    ].map(fake);
    expect(ids(withoutHiddenRoutes(layers, off("flight")))).toEqual([
      "globe-airport-dots",
      "globe-cruise-paths",
      "globe-port-dots",
    ]);
    expect(ids(withoutHiddenRoutes(layers, off("cruise")))).not.toContain("globe-cruise-paths");
  });

  it("leaves markers, labels, heatmaps and unknown layers alone and returns a copy", () => {
    const layers = ["heatmap", "lodging-pins", "place-pins", "text", "trips"].map(fake);
    expect(ids(withoutHiddenRoutes(layers, ALL_ROUTES_VISIBLE))).toEqual(ids(layers));
    expect(withoutHiddenRoutes(layers, ALL_ROUTES_VISIBLE)).not.toBe(layers);
    expect(
      ids(
        withoutHiddenRoutes(layers, {
          ...ALL_ROUTES_VISIBLE,
          flight: false,
          cruise: false,
          rail: false,
        })
      )
    ).toEqual(ids(layers));
  });

  it("classifies a tour path as nobody's: tours and roadtrips are split by datum, not id", () => {
    expect(routeDomainOfLayerId("dashboard-tour-paths")).toBeNull();
  });
});

describe("the stored switches", () => {
  it("draw everything for an account that never touched them", () => {
    expect(routesVisibleFromStored(undefined)).toEqual(ALL_ROUTES_VISIBLE);
    expect(routesVisibleFromStored("garbage")).toEqual(ALL_ROUTES_VISIBLE);
    expect(routesVisibleFromStored({ flight: 0, rail: "no" })).toEqual(ALL_ROUTES_VISIBLE);
  });

  it("hide only a domain stored as an explicit false", () => {
    expect(routesVisibleFromStored({ flight: false, cruise: true })).toEqual({
      ...ALL_ROUTES_VISIBLE,
      flight: false,
    });
  });
});

describe("modes that are nothing but routes", () => {
  it("name the reason instead of going empty", () => {
    expect(routesBlockedReason("all", "journey")).toBe("journey");
    expect(routesBlockedReason("flight", "trips")).toBe("trips");
    expect(routesBlockedReason("tour", "routes")).toBe("tour");
    expect(routesBlockedReason("flight", "routes")).toBeNull();
    expect(routesBlockedReason("roadtrip", "globe")).toBeNull();
  });
});
