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

/** Repeats `feat` `count` times on the same dep/arr pair (with distinct
 * ids) so the route aggregates to the given flight count. */
function repeat(
  count: number,
  status: string,
  dep: [number, number],
  arr: [number, number],
  idPrefix: string
): GeoJSONFeature[] {
  return Array.from({ length: count }, (_, i) => feat(`${idPrefix}${i}`, status, dep, arr));
}

// A five-route mix that spreads the frequency quartiles across a
// meaningful range (sorted counts: [1, 1, 2, 5, 10] → q25=1, q50=2, q75=5)
// so the two-tone frequency tests below land on distinct, non-degenerate
// intensities instead of the trivial single-route case.
function scenarioFlights(): GeoJSONFeature[] {
  return [
    ...repeat(10, "historical", [0, 0], [1, 1], "high"), // count=10 — high-frequency past
    ...repeat(1, "flown", [2, 2], [3, 3], "low"), // count=1 — low-frequency past
    ...repeat(1, "flown", [4, 4], [5, 5], "mixedA"),
    ...repeat(1, "scheduled", [4, 4], [5, 5], "mixedB"), // count=2 — mixed, mid-frequency
    ...repeat(1, "scheduled", [6, 6], [7, 7], "sched"), // count=1 — low-frequency scheduled
    ...repeat(5, "historical", [8, 8], [9, 9], "mid"), // count=5 — mid/high boundary
  ];
}

function arcAt(
  arcs: ReturnType<typeof buildRouteData>["arcs"],
  dep: [number, number]
): (typeof arcs)[number] {
  const found = arcs.find((a) => a.sourcePosition[0] === dep[0] && a.sourcePosition[1] === dep[1]);
  if (!found) throw new Error(`no arc found for dep ${dep.join(",")}`);
  return found;
}

describe("buildRouteData statusTwoTone — frequency-modulated intensity", () => {
  it("colors a HIGH-frequency past route (count above q75) vivid orange", () => {
    const { arcs } = buildRouteData(scenarioFlights(), 1, undefined, undefined, true);
    // count=10, q75=5 → intensity=1 → FLIGHT_PAST_HIGH
    expect(rgb(arcAt(arcs, [0, 0]).sourceColor)).toEqual([249, 115, 22]);
  });

  it("colors a low-frequency past route amber-ish (not the vivid orange)", () => {
    const { arcs } = buildRouteData(scenarioFlights(), 1, undefined, undefined, true);
    // count=1, q25=1 → intensity floor 0.2 → near FLIGHT_PAST_LOW, not HIGH
    const color = rgb(arcAt(arcs, [2, 2]).sourceColor);
    expect(color).toEqual([242, 158, 61]);
    expect(color).not.toEqual([249, 115, 22]);
  });

  it("colors a mixed route (flown + scheduled) within the orange family, scaled by its own frequency", () => {
    const { arcs } = buildRouteData(scenarioFlights(), 1, undefined, undefined, true);
    // count=2, q25=1, q50=2, q75=5 → ratio = 0.2 + 0.8*(2-1)/(5-1) = 0.4
    const color = rgb(arcAt(arcs, [4, 4]).sourceColor);
    expect(color).toEqual([244, 147, 51]);
    // Must not fall back to the hardcoded red core used outside two-tone.
    expect(color).not.toEqual([248, 113, 113]);
    expect(color).not.toEqual([220, 38, 38]);
  });

  it("colors a low-frequency pure-scheduled route soft blue (not the flat sky-blue)", () => {
    const { arcs } = buildRouteData(scenarioFlights(), 1, undefined, undefined, true);
    // count=1, q25=1 → intensity floor 0.2 → near FLIGHT_SCHEDULED_LOW
    const color = rgb(arcAt(arcs, [6, 6]).sourceColor);
    expect(color).toEqual([120, 196, 239]);
    expect(color).not.toEqual([80, 200, 255]);
  });

  it("without two-tone, historical stays grey (regression guard)", () => {
    const { arcs } = buildRouteData([feat("1", "historical", [0, 0], [1, 1])], 1);
    expect(rgb(arcs[0].sourceColor)).toEqual([150, 150, 150]);
  });
});
