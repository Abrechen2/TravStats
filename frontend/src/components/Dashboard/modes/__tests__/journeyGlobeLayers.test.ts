import { describe, it, expect } from "vitest";
import { buildJourneyLayers, JOURNEY_GLOBE_ALTITUDE_M } from "../buildJourneyLayers";
import type { GeoJSONFeature } from "../../../../types";

/**
 * The Reise view drew NOTHING on the globe — no route, no trail — while the
 * same trip drew on the flat map (browser verification, beta.12, four trips,
 * twice from a clean load).
 *
 * The cause is a layer TYPE, not missing data: the journey's flight legs are
 * an `ArcLayer`, whose bow is computed in its own vertex shader from source
 * and target in common space, and the globe projection does not give it that.
 * It is why the globe's OWN flight arcs are a `PathLayer` of pre-tessellated
 * great-circle waypoints carrying a z-altitude (`buildGlobeLayers.ts`) rather
 * than an ArcLayer — a rule this builder did not know, because until the
 * journey view could open on the globe at all it never had to.
 *
 * What a unit test can judge: that the globe is handed a layer type the globe
 * can draw, with real altitude on its vertices. What it CANNOT judge is
 * whether the result looks like an arc — that needs a browser, which is where
 * this was found.
 */

function tripFlight(id: string, from: [number, number], to: [number, number]): GeoJSONFeature {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [from, to] },
    properties: {
      id,
      tripId: "t1",
      airline: "Delta Air Lines",
      flightNumber: "DL1",
      departureAirport: { iata: "LIS", lat: from[1], lon: from[0] },
      arrivalAirport: { iata: "FRA", lat: to[1], lon: to[0] },
      departureTime: "2024-05-01T08:00:00Z",
      arrivalTime: "2024-05-01T11:00:00Z",
      status: "flown",
      distance: 2000,
    },
  } as unknown as GeoJSONFeature;
}

const FLIGHTS = [tripFlight("f1", [-9.1, 38.8], [8.6, 50.0])];

describe("the Reise view's flight legs on the globe", () => {
  it("draws SOMETHING for a trip that has flights", () => {
    const layers = buildJourneyLayers(FLIGHTS, [], "t1", undefined, JOURNEY_GLOBE_ALTITUDE_M);
    expect(layers.length).toBeGreaterThan(0);
  });

  it("gives the globe a path layer, not an ArcLayer the globe cannot draw", () => {
    const layers = buildJourneyLayers(FLIGHTS, [], "t1", undefined, JOURNEY_GLOBE_ALTITUDE_M);
    const flightLayer = layers.find((l) => l.id === "journey-flight-arcs");
    expect(flightLayer).toBeDefined();
    expect(flightLayer!.constructor.name).toBe("PathLayer");
  });

  it("bows the path off the sphere, or it z-fights the mesh and draws nothing", () => {
    const layers = buildJourneyLayers(FLIGHTS, [], "t1", undefined, JOURNEY_GLOBE_ALTITUDE_M);
    const flightLayer = layers.find((l) => l.id === "journey-flight-arcs")!;
    const rows = flightLayer.props.data as ReadonlyArray<{ path: [number, number, number][] }>;
    const path = (
      flightLayer.props as unknown as {
        getPath: (d: (typeof rows)[number]) => [number, number, number][];
      }
    ).getPath(rows[0]);

    expect(path.length).toBeGreaterThan(2);
    expect(Math.max(...path.map((p) => p[2]))).toBeGreaterThan(0);
    // Ends sit ON the surface — an arc that starts in the air is not an arc.
    // `peak · sin(0)` leaves floating-point dust rather than a literal zero.
    expect(path[0][2]).toBeCloseTo(0, 6);
    expect(path[path.length - 1][2]).toBeCloseTo(0, 6);
  });

  it("keeps the ArcLayer on the flat map, where it has always drawn", () => {
    const layers = buildJourneyLayers(FLIGHTS, [], "t1", undefined, 0);
    const flightLayer = layers.find((l) => l.id === "journey-flight-arcs");
    expect(flightLayer!.constructor.name).toBe("ArcLayer");
  });
});
