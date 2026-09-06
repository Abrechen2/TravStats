import { rgb, tokens } from "../theme/tokens";
import { describe, it, expect } from "vitest";
import {
  CRUISE_COLOR_MODES,
  CRUISE_DISTINCT_PALETTE,
  DEFAULT_CRUISE_COLORS,
  DEFAULT_CRUISE_COLOR_CONFIG,
  buildCruiseLegend,
  cruiseColorFromStored,
  deriveCruiseColor,
  resolveCruiseArcColor,
  resolveCruiseColor,
  type CruiseColorConfig,
  type Rgb,
} from "./cruiseColor";

const SAILED: Rgb = [10, 200, 30];
const PLANNED: Rgb = [200, 20, 180];
const SOLID: Rgb = [60, 120, 240];

const colors = { past: SAILED, planned: PLANNED, solid: SOLID };
const statusCfg: CruiseColorConfig = { mode: "status", colors };
const perCruiseCfg: CruiseColorConfig = { mode: "perCruise", colors };
const solidCfg: CruiseColorConfig = { mode: "solid", colors };

const cruise = (
  id: string,
  status: string,
  color?: string | null
): { id: string; status: string; color?: string | null } => ({ id, status, color });

describe("deriveCruiseColor", () => {
  it("is stable for the same id", () => {
    expect(deriveCruiseColor("abc")).toEqual(deriveCruiseColor("abc"));
  });
  it("returns a palette color", () => {
    expect(CRUISE_DISTINCT_PALETTE).toContainEqual(deriveCruiseColor("abc"));
  });
  it("spreads different ids across the palette (not all identical)", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"];
    const distinct = new Set(ids.map((i) => deriveCruiseColor(i).join(",")));
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe("resolveCruiseColor", () => {
  it("uses cruise.color hex when present", () => {
    expect(resolveCruiseColor({ id: "x", color: "#ff8800" })).toEqual([255, 136, 0]);
  });
  it("falls back to derived when color is null/absent/invalid", () => {
    expect(resolveCruiseColor({ id: "x", color: null })).toEqual(deriveCruiseColor("x"));
    expect(resolveCruiseColor({ id: "x", color: "not-a-hex" })).toEqual(deriveCruiseColor("x"));
    expect(resolveCruiseColor({ id: "x" })).toEqual(deriveCruiseColor("x"));
  });
});

describe("defaults", () => {
  it("defaults to status mode with the domain colour (sailed) + info (planned)", () => {
    expect(DEFAULT_CRUISE_COLOR_CONFIG.mode).toBe("status");
    // Both were literals of their own until 2.7.0 — a blue that meant `info`
    // everywhere else, and a cyan that is the platinum tier colour.
    expect(DEFAULT_CRUISE_COLOR_CONFIG.colors.past).toEqual(rgb(tokens.domainColor.cruise));
    expect(DEFAULT_CRUISE_COLOR_CONFIG.colors.planned).toEqual(rgb(tokens.color.info));
  });

  it("offers exactly three modes — no frequency mode for cruises", () => {
    expect([...CRUISE_COLOR_MODES]).toEqual(["status", "perCruise", "solid"]);
  });
});

describe("resolveCruiseArcColor", () => {
  it("status mode: the user's sailed colour for a sailed cruise", () => {
    expect(resolveCruiseArcColor(cruise("c1", "flown"), statusCfg)).toEqual(SAILED);
  });

  it("status mode: the user's planned colour for a scheduled cruise", () => {
    expect(resolveCruiseArcColor(cruise("c1", "scheduled"), statusCfg)).toEqual(PLANNED);
  });

  it("perCruise mode: two different cruises get two different colours", () => {
    const a = resolveCruiseArcColor(cruise("c1", "flown"), perCruiseCfg);
    const b = resolveCruiseArcColor(cruise("nine", "flown"), perCruiseCfg);
    expect(a).not.toEqual(b);
    expect(CRUISE_DISTINCT_PALETTE).toContainEqual(a);
    expect(CRUISE_DISTINCT_PALETTE).toContainEqual(b);
  });

  it("perCruise mode: a cruise's own stored colour wins over the derived hue", () => {
    expect(resolveCruiseArcColor(cruise("c3", "flown", "#ff8800"), perCruiseCfg)).toEqual([
      255, 136, 0,
    ]);
  });

  it("perCruise mode ignores status — a planned cruise keeps its own hue", () => {
    expect(resolveCruiseArcColor(cruise("c1", "scheduled"), perCruiseCfg)).toEqual(
      resolveCruiseArcColor(cruise("c1", "flown"), perCruiseCfg)
    );
  });

  it("solid mode: one colour for every cruise, sailed or planned", () => {
    expect(resolveCruiseArcColor(cruise("c1", "flown"), solidCfg)).toEqual(SOLID);
    expect(resolveCruiseArcColor(cruise("c2", "scheduled"), solidCfg)).toEqual(SOLID);
    expect(resolveCruiseArcColor(cruise("c3", "flown", "#ff8800"), solidCfg)).toEqual(SOLID);
  });
});

describe("buildCruiseLegend", () => {
  it("status mode: two swatch rows equal to the two arc colours", () => {
    const rows = buildCruiseLegend(statusCfg);
    expect(rows.map((r) => r.slot)).toEqual(["past", "planned"]);
    const past = rows[0];
    const planned = rows[1];
    expect(past.kind === "swatch" && past.color).toEqual(
      resolveCruiseArcColor(cruise("c1", "flown"), statusCfg)
    );
    expect(planned.kind === "swatch" && planned.color).toEqual(
      resolveCruiseArcColor(cruise("c1", "scheduled"), statusCfg)
    );
  });

  it("solid mode: exactly one row, equal to the one arc colour", () => {
    const rows = buildCruiseLegend(solidCfg);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.kind === "swatch" && row.color).toEqual(
      resolveCruiseArcColor(cruise("c1", "flown"), solidCfg)
    );
  });

  it("perCruise mode: one honest multi-swatch row, never one row per cruise", () => {
    const rows = buildCruiseLegend(perCruiseCfg);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.slot).toBe("perCruise");
    if (row.kind !== "multi") throw new Error("expected a multi row");
    expect(row.stops.length).toBeGreaterThan(1);
    // Every sample stop is a colour the mode can actually paint.
    for (const stop of row.stops) expect(CRUISE_DISTINCT_PALETTE).toContainEqual(stop);
  });

  it("legend rows track a colour change — no stale copy of the colour values", () => {
    const repainted: CruiseColorConfig = {
      mode: "status",
      colors: { ...colors, past: [1, 2, 3], planned: [4, 5, 6] },
    };
    const rows = buildCruiseLegend(repainted);
    const past = rows.find((r) => r.slot === "past");
    expect(past?.kind === "swatch" && past.color).toEqual([1, 2, 3]);
    expect(past?.kind === "swatch" && past.color).toEqual(
      resolveCruiseArcColor(cruise("c1", "flown"), repainted)
    );
  });
});

describe("localStorage migration (cruiseColorFromStored)", () => {
  it("cruiseRouteColor === <rgb>  ⇒  solid mode with THAT colour (a deliberate pick)", () => {
    const out = cruiseColorFromStored({ cruiseRouteColor: [12, 34, 56] });
    expect(out.mode).toBe("solid");
    expect(out.colors.solid).toEqual([12, 34, 56]);
  });

  it("cruiseRouteColor === null  ⇒  status mode with the default pair", () => {
    const out = cruiseColorFromStored({ cruiseRouteColor: null, cruiseRouteWidth: 1 });
    expect(out.mode).toBe("status");
    expect(out.colors.past).toEqual(DEFAULT_CRUISE_COLORS.past);
    expect(out.colors.planned).toEqual(DEFAULT_CRUISE_COLORS.planned);
  });

  it("key absent  ⇒  status mode with the default pair", () => {
    const out = cruiseColorFromStored({});
    expect(out).toEqual(DEFAULT_CRUISE_COLOR_CONFIG);
  });

  it("an already-migrated blob wins over the legacy field", () => {
    const out = cruiseColorFromStored({
      cruiseRouteColor: [9, 9, 9],
      cruiseColorMode: "perCruise",
      cruiseColors: { ...DEFAULT_CRUISE_COLORS, solid: [1, 2, 3] },
    });
    expect(out.mode).toBe("perCruise");
    expect(out.colors.solid).toEqual([1, 2, 3]);
  });

  it("falls back to defaults on a corrupt blob instead of throwing", () => {
    expect(cruiseColorFromStored({ cruiseColorMode: "nonsense" })).toEqual(
      DEFAULT_CRUISE_COLOR_CONFIG
    );
    const partial = cruiseColorFromStored({
      cruiseColorMode: "status",
      cruiseColors: { past: [1, 2, 3] },
    });
    expect(partial.colors.past).toEqual([1, 2, 3]);
    expect(partial.colors.planned).toEqual(DEFAULT_CRUISE_COLORS.planned);
  });
});
