import { describe, it, expect } from "vitest";
import { buildRouteData } from "./routesLayer";
import type { GeoJSONFeature } from "../../types";

function feat(id: string, status: string, dep: [number, number], arr: [number, number]): GeoJSONFeature {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [dep, arr] },
    properties: {
      id, status,
      departureTime: "2024-01-01T00:00:00Z",
      departureAirport: { iata: dep.join("_"), icao: null, name: "D" },
      arrivalAirport: { iata: arr.join("_"), icao: null, name: "A" },
    },
  } as unknown as GeoJSONFeature;
}

const rgb = (c: readonly number[]) => [c[0], c[1], c[2]];

describe("buildRouteData statusTwoTone", () => {
  it("colors historical routes orange (not grey) in two-tone", () => {
    const { arcs } = buildRouteData([feat("1", "historical", [0, 0], [1, 1])], 1, undefined, undefined, true);
    expect(rgb(arcs[0].sourceColor)).toEqual([240, 169, 71]);
  });
  it("colors mixed routes orange core (not red) in two-tone", () => {
    const flights = [feat("1", "flown", [0, 0], [1, 1]), feat("2", "scheduled", [0, 0], [1, 1])];
    const { arcs } = buildRouteData(flights, 1, undefined, undefined, true);
    expect(rgb(arcs[0].sourceColor)).toEqual([240, 169, 71]);
  });
  it("colors scheduled routes coral in two-tone (not blue)", () => {
    const { arcs } = buildRouteData([feat("1", "scheduled", [0, 0], [1, 1])], 1, undefined, undefined, true);
    expect(rgb(arcs[0].sourceColor)).toEqual([251, 113, 133]);
  });
  it("without two-tone, historical stays grey (regression guard)", () => {
    const { arcs } = buildRouteData([feat("1", "historical", [0, 0], [1, 1])], 1);
    expect(rgb(arcs[0].sourceColor)).toEqual([150, 150, 150]);
  });
  it("without two-tone, scheduled routes stay blue (single flight view unchanged)", () => {
    const { arcs } = buildRouteData([feat("1", "scheduled", [0, 0], [1, 1])], 1);
    expect(rgb(arcs[0].sourceColor)).toEqual([80, 200, 255]);
  });
  it("colors a past-only (all-flown, non-historical) route orange in two-tone with NO paletteOverride", () => {
    // Proves the regular past-only `else` branch self-gates on statusTwoTone
    // alone — it must not depend on a paletteOverride (e.g. flightRouteColor)
    // being passed in to land on the flight-domain orange.
    const { arcs } = buildRouteData([feat("1", "flown", [0, 0], [1, 1])], 1, undefined, undefined, true);
    expect(rgb(arcs[0].sourceColor)).toEqual([240, 169, 71]);
  });
});
