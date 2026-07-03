import { describe, it, expect } from "vitest";
import { buildCruiseArcs } from "./cruiseArcsLayer";
import type { Cruise } from "../../types";

function cruise(id: string, status: string, color?: string): Cruise {
  return {
    id,
    status,
    departurePort: { id: 1, lat: 0, lon: 0, name: "A" },
    arrivalPort: { id: 2, lat: 1, lon: 1, name: "B" },
    stops: [],
    color,
  } as unknown as Cruise;
}

describe("buildCruiseArcs colorMode", () => {
  it("status mode: past cruise = blue", () => {
    const arcs = buildCruiseArcs([cruise("c1", "flown")], new Map(), { colorMode: "status" });
    expect(arcs[0].color).toEqual([74, 144, 217]);
  });
  it("status mode: scheduled cruise = cyan (planned)", () => {
    const arcs = buildCruiseArcs([cruise("c1", "scheduled")], new Map(), { colorMode: "status" });
    expect(arcs[0].color).toEqual([34, 211, 238]);
  });
  it("perCruise mode: distinct cruises get distinct colors", () => {
    const a = buildCruiseArcs([cruise("c1", "flown")], new Map(), { colorMode: "perCruise" });
    const b = buildCruiseArcs([cruise("c2", "flown")], new Map(), { colorMode: "perCruise" });
    // both defined, and a user-set color overrides derivation:
    const custom = buildCruiseArcs([cruise("c3", "flown", "#ff8800")], new Map(), {
      colorMode: "perCruise",
    });
    expect(custom[0].color).toEqual([255, 136, 0]);
    expect(a[0].color).toBeDefined();
    expect(b[0].color).toBeDefined();
  });
});
