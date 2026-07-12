import { describe, it, expect } from "vitest";
import { buildCruiseArcs } from "./cruiseArcsLayer";
import {
  DEFAULT_CRUISE_COLORS,
  DEFAULT_CRUISE_COLOR_CONFIG,
  buildCruiseLegend,
  resolveCruiseArcColor,
  type CruiseColorConfig,
  type Rgb,
} from "../../lib/cruiseColor";
import type { Cruise } from "../../types";

// The user's picked colours — deliberately nothing like the old hardcoded
// blue/cyan constants, so a stale code path cannot accidentally pass.
const SAILED: Rgb = [10, 200, 30];
const PLANNED: Rgb = [200, 20, 180];
const SOLID: Rgb = [60, 120, 240];

const colors = { past: SAILED, planned: PLANNED, solid: SOLID };
const statusCfg: CruiseColorConfig = { mode: "status", colors };
const perCruiseCfg: CruiseColorConfig = { mode: "perCruise", colors };
const solidCfg: CruiseColorConfig = { mode: "solid", colors };

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

/** Colour of the (single) arc the flat map builds for `c` under `cfg`. */
function arcColor(c: Cruise, cfg: CruiseColorConfig): Rgb {
  const arcs = buildCruiseArcs([c], new Map(), { colorConfig: cfg });
  if (arcs.length === 0) throw new Error("no arc built");
  return arcs[0].color;
}

describe("buildCruiseArcs — the user's colours reach the arcs", () => {
  it("status mode: the user's sailed colour, not the hardcoded blue", () => {
    expect(arcColor(cruise("c1", "flown"), statusCfg)).toEqual(SAILED);
  });

  it("status mode: the user's planned colour, not the hardcoded cyan", () => {
    expect(arcColor(cruise("c1", "scheduled"), statusCfg)).toEqual(PLANNED);
  });

  it("perCruise mode: two cruises get two different colours", () => {
    expect(arcColor(cruise("c1", "flown"), perCruiseCfg)).not.toEqual(
      arcColor(cruise("nine", "flown"), perCruiseCfg)
    );
  });

  it("solid mode: every cruise gets the one colour, sailed or planned", () => {
    expect(arcColor(cruise("c1", "flown"), solidCfg)).toEqual(SOLID);
    expect(arcColor(cruise("c2", "scheduled"), solidCfg)).toEqual(SOLID);
  });

  it("defaults to the status pair when no config is passed", () => {
    expect(arcColor(cruise("c1", "flown"), DEFAULT_CRUISE_COLOR_CONFIG)).toEqual(
      DEFAULT_CRUISE_COLORS.past
    );
    const arcs = buildCruiseArcs([cruise("c1", "scheduled")], new Map());
    expect(arcs[0].color).toEqual(DEFAULT_CRUISE_COLORS.planned);
  });
});

describe("the cruise legend cannot diverge from the cruise routes", () => {
  // Both sides are driven from the SAME exported resolver, so we assert they
  // agree rather than comparing two hardcoded lists.
  it("status mode: the two legend swatches equal the two arc colours", () => {
    const rows = buildCruiseLegend(statusCfg);
    const past = rows.find((r) => r.slot === "past");
    const planned = rows.find((r) => r.slot === "planned");
    expect(past?.kind === "swatch" && past.color).toEqual(
      arcColor(cruise("c1", "flown"), statusCfg)
    );
    expect(planned?.kind === "swatch" && planned.color).toEqual(
      arcColor(cruise("c1", "scheduled"), statusCfg)
    );
  });

  it("solid mode: the one legend swatch equals the one arc colour", () => {
    const rows = buildCruiseLegend(solidCfg);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.kind === "swatch" && row.color).toEqual(arcColor(cruise("c1", "flown"), solidCfg));
  });

  it("perCruise mode: every legend sample is a colour the arcs can actually take", () => {
    const rows = buildCruiseLegend(perCruiseCfg);
    const row = rows[0];
    if (row.kind !== "multi") throw new Error("expected a multi row");
    // Each sample hue is reachable by some cruise id — the row is a sample of
    // the same palette the arcs draw from, not an invented set of colours.
    const reachable = new Set(
      Array.from({ length: 60 }, (_, i) =>
        arcColor(cruise(`id-${i}`, "flown"), perCruiseCfg).join()
      )
    );
    for (const stop of row.stops) expect(reachable.has(stop.join())).toBe(true);
  });
});

describe("flat map and globe agree on the same cruise + mode", () => {
  const cases: Array<[string, CruiseColorConfig]> = [
    ["status", statusCfg],
    ["perCruise", perCruiseCfg],
    ["solid", solidCfg],
  ];

  for (const [name, cfg] of cases) {
    it(`${name}: a sailed cruise gets the same colour on both renderers`, () => {
      const c = cruise("c1", "flown");
      // The globe (GlobeView#cruisePaths) resolves through resolveCruiseArcColor
      // directly; the flat map goes through buildCruiseArcs. Same function under.
      expect(resolveCruiseArcColor(c, cfg)).toEqual(arcColor(c, cfg));
    });

    it(`${name}: a planned cruise gets the same colour on both renderers`, () => {
      const c = cruise("c2", "scheduled");
      expect(resolveCruiseArcColor(c, cfg)).toEqual(arcColor(c, cfg));
    });
  }
});
