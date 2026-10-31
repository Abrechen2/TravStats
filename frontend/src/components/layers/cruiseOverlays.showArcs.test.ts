import { describe, it, expect } from "vitest";
import { buildCruiseOverlays } from "./cruiseOverlays";
import { DEFAULT_CRUISE_COLOR_CONFIG } from "../../lib/cruiseColor";
import type { Cruise } from "../../types";

const cruise = {
  id: "c1",
  status: "scheduled",
  departurePort: { id: 1, lat: 0, lon: 0, name: "A" },
  arrivalPort: { id: 2, lat: 1, lon: 1, name: "B" },
  stops: [],
} as unknown as Cruise;

const appearance = {
  zoom: 3,
  arcWidthScale: 1,
  arrowSizeScale: 1,
  colorConfig: DEFAULT_CRUISE_COLOR_CONFIG,
  portSizeScale: 1,
  labelsMode: "off",
} as unknown as Parameters<typeof buildCruiseOverlays>[4];

describe("buildCruiseOverlays showArcs (forgejo#389: showCruiseArcs changed nothing)", () => {
  it("draws the route lines by default", () => {
    const { below } = buildCruiseOverlays([cruise], new Map(), null, () => {}, appearance);
    expect(below.length).toBeGreaterThan(0);
  });

  it("draws no route lines when the setting is off, but keeps the ports", () => {
    const on = buildCruiseOverlays([cruise], new Map(), null, () => {}, appearance);
    const off = buildCruiseOverlays([cruise], new Map(), null, () => {}, {
      ...appearance,
      showArcs: false,
    });
    expect(off.below).toHaveLength(0);
    expect(off.above.length).toBe(on.above.length);
  });
});
