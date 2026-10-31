// forgejo#349: every zoom step or selection click calls createRoutesLayers
// again with the same routeData. The three arc datasets were re-filtered and,
// in flat mode, every great circle re-tessellated on each call, so deck.gl saw
// new `data` and re-uploaded all the geometry. The data must be the same
// objects as long as the routeData is.

import { describe, it, expect } from "vitest";
import { buildRouteData, createRoutesLayers } from "./routesLayer";
import { FLAT_ROUTES_LAYER_ID } from "./flatRoutesLayer";
import type { GeoJSONFeature } from "../../types";

function flight(
  id: string,
  from: [string, number, number],
  to: [string, number, number],
  status: string
) {
  return {
    type: "Feature",
    properties: {
      id,
      status,
      departureAirport: { iata: from[0], name: from[0], lat: from[2], lon: from[1] },
      arrivalAirport: { iata: to[0], name: to[0], lat: to[2], lon: to[1] },
      departureTime: "2024-05-01T08:00:00Z",
      arrivalTime: "2024-05-01T19:00:00Z",
      distance: 1000,
    },
    geometry: {
      type: "LineString",
      coordinates: [
        [from[1], from[2]],
        [to[1], to[2]],
      ],
    },
  } as unknown as GeoJSONFeature;
}

const FRA: [string, number, number] = ["FRA", 8.57, 50.03];
const JFK: [string, number, number] = ["JFK", -73.78, 40.64];
const MUC: [string, number, number] = ["MUC", 11.79, 48.35];
const flights = [
  flight("a", FRA, JFK, "flown"),
  flight("b", FRA, JFK, "scheduled"),
  flight("c", MUC, JFK, "scheduled"),
  flight("d", MUC, FRA, "flown"),
];

const dataOf = (layers: ReturnType<typeof createRoutesLayers>): Record<string, unknown> =>
  Object.fromEntries(layers.map((l) => [l.id, (l.props as { data?: unknown }).data]));

describe("createRoutesLayers keeps layer data stable for an unchanged routeData", () => {
  it("hands the three arc layers the same data arrays on a second call", () => {
    const rd = buildRouteData(flights, 1);
    const first = dataOf(createRoutesLayers(rd, undefined, undefined, 0.3, [], undefined, 4));
    const second = dataOf(createRoutesLayers(rd, undefined, undefined, 0.3, ["a"], undefined, 6));
    for (const id of ["routes-arc", "routes-arc-scheduled", "routes-arc-upcoming"]) {
      expect(first[id], id).toBeDefined();
      expect(second[id], `${id} was re-filtered`).toBe(first[id]);
    }
  });

  it("does not re-tessellate flat routes on a second call", () => {
    const rd = buildRouteData(flights, 1);
    const call = (zoom: number) =>
      dataOf(
        createRoutesLayers(rd, undefined, undefined, 0.3, [], undefined, zoom, {
          routeShape: "flat",
        })
      );
    const first = call(4);
    const second = call(7);
    expect(first[FLAT_ROUTES_LAYER_ID]).toBeDefined();
    expect(second[FLAT_ROUTES_LAYER_ID]).toBe(first[FLAT_ROUTES_LAYER_ID]);
  });
});
