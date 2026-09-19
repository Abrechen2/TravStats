import { rgb, tokens } from "../theme/tokens";
import { LIST_PALETTE_RGB } from "./listPalette";
import { describe, it, expect } from "vitest";
import {
  DEFAULT_FLIGHT_COLORS,
  DEFAULT_FLIGHT_COLOR_CONFIG,
  FLIGHT_COLOR_PRESETS,
  buildFlightLegend,
  flightColorFromStored,
  frequencyTier,
  resolveFlightColor,
  resolveFlightTipColor,
  tierFromQuartile,
  tintForTier,
  washOut,
  type FlightColorConfig,
} from "./flightColor";
import type { Rgb } from "./cruiseColor";

const BASE: Rgb = [60, 120, 240];
const cfg = (partial: Partial<FlightColorConfig>): FlightColorConfig => ({
  mode: "status",
  colors: DEFAULT_FLIGHT_COLORS,
  ...partial,
});

describe("defaults", () => {
  it("defaults to status mode with the domain colour (flown) + info (planned)", () => {
    expect(DEFAULT_FLIGHT_COLOR_CONFIG.mode).toBe("status");
    // Derived, not written out: the claim is that the default IS the token,
    // and a literal here is a second copy of the value it is checking. Planned
    // was coral until 2.7.0; `info` is what the rest of the system says for
    // "not yet happened".
    expect(DEFAULT_FLIGHT_COLOR_CONFIG.colors.past).toEqual(rgb(tokens.domainColor.flight));
    expect(DEFAULT_FLIGHT_COLOR_CONFIG.colors.upcoming).toEqual(rgb(tokens.color.info));
  });

  it("offers the shared palette, led by the domain's own colour", () => {
    // Six hand-assembled swatch lists became one in 2.7.0. The retired
    // sky-blue that used to be pinned here is not on it any more; the free
    // colour input beside the swatches is what someone who wants it back uses.
    expect(FLIGHT_COLOR_PRESETS[0]).toEqual(rgb(tokens.domainColor.flight));
    expect(FLIGHT_COLOR_PRESETS.slice(1)).toEqual(LIST_PALETTE_RGB);
  });

  it("offers no hue the system reserves for a meaning", () => {
    // A map reads colour as meaning: a route painted in the exact blue that
    // means "planned" breaks the legend for whoever picked it. `listColor`
    // excludes accent, bad, info, good and the cruise teal for that reason.
    const reserved = [tokens.color.bad, tokens.color.info, tokens.color.good].map(rgb);
    for (const hue of reserved) {
      expect(LIST_PALETTE_RGB).not.toContainEqual(hue);
    }
  });
});

describe("frequency tiers", () => {
  it("bands a count against the dataset quantiles", () => {
    expect(frequencyTier(1, 1, 2, 4)).toBe(0);
    expect(frequencyTier(2, 1, 2, 4)).toBe(1);
    expect(frequencyTier(3, 1, 2, 4)).toBe(2);
    expect(frequencyTier(9, 1, 2, 4)).toBe(3);
  });

  it("maps the globe's 1-based quartile onto the same tier, clamped", () => {
    expect(tierFromQuartile(1)).toBe(0);
    expect(tierFromQuartile(4)).toBe(3);
    expect(tierFromQuartile(0)).toBe(0);
    expect(tierFromQuartile(9)).toBe(3);
  });

  it("ramps intensity monotonically and keeps the base colour at tier 2", () => {
    const stops = ([0, 1, 2, 3] as const).map((t) => tintForTier(BASE, t));
    expect(stops[2]).toEqual(BASE);
    const luma = (c: Rgb): number => c[0] + c[1] + c[2];
    expect(luma(stops[0])).toBeLessThan(luma(stops[1]));
    expect(luma(stops[1])).toBeLessThan(luma(stops[2]));
    expect(luma(stops[2])).toBeLessThan(luma(stops[3]));
  });

  it("never produces an out-of-range channel", () => {
    for (const t of [0, 1, 2, 3] as const) {
      for (const c of tintForTier([255, 255, 255], t)) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
    }
  });

  it("washes a planned route out toward white without changing family", () => {
    const w = washOut(BASE);
    expect(w[0]).toBeGreaterThan(BASE[0]);
    expect(w[2]).toBeGreaterThan(BASE[2]);
    // Blue still dominates red — it's the same hue, just paler.
    expect(w[2]).toBeGreaterThan(w[0]);
  });
});

describe("resolveFlightColor", () => {
  it("status mode: flown vs. planned, ignoring frequency", () => {
    const c = cfg({ mode: "status" });
    expect(resolveFlightColor({ tier: 0, pureScheduled: false }, c)).toEqual(c.colors.past);
    expect(resolveFlightColor({ tier: 3, pureScheduled: false }, c)).toEqual(c.colors.past);
    expect(resolveFlightColor({ tier: 0, pureScheduled: true }, c)).toEqual(c.colors.upcoming);
  });

  it("solid mode: one colour, whatever the route is", () => {
    const c = cfg({ mode: "solid", colors: { ...DEFAULT_FLIGHT_COLORS, solid: BASE } });
    expect(resolveFlightColor({ tier: 0, pureScheduled: false }, c)).toEqual(BASE);
    expect(resolveFlightColor({ tier: 3, pureScheduled: true, isHistorical: true }, c)).toEqual(
      BASE
    );
  });

  it("frequency mode: tier-scaled base, washed planned, grey historical", () => {
    const c = cfg({ mode: "frequency", colors: { ...DEFAULT_FLIGHT_COLORS, frequency: BASE } });
    expect(resolveFlightColor({ tier: 3, pureScheduled: false }, c)).toEqual(tintForTier(BASE, 3));
    expect(resolveFlightColor({ tier: 1, pureScheduled: true }, c)).toEqual(washOut(BASE));
    expect(resolveFlightColor({ tier: 1, pureScheduled: false, isHistorical: true }, c)).toEqual([
      150, 150, 150,
    ]);
  });

  it("resolves the mixed-route tip colour from the same config", () => {
    const status = cfg({ mode: "status" });
    expect(resolveFlightTipColor(status)).toEqual(status.colors.upcoming);
    const solid = cfg({ mode: "solid", colors: { ...DEFAULT_FLIGHT_COLORS, solid: BASE } });
    // Solid means solid — the tips are the same colour as the core, i.e. invisible.
    expect(resolveFlightTipColor(solid)).toEqual(BASE);
  });
});

describe("buildFlightLegend", () => {
  it("renders two swatch rows in status mode", () => {
    const rows = buildFlightLegend(cfg({ mode: "status" }));
    expect(rows.map((r) => r.slot)).toEqual(["past", "upcoming"]);
    expect(rows.every((r) => r.kind === "swatch")).toBe(true);
  });

  it("renders a single 4-stop ramp row in frequency mode", () => {
    const rows = buildFlightLegend(cfg({ mode: "frequency" }));
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("ramp");
    expect(rows[0].kind === "ramp" && rows[0].stops).toHaveLength(4);
  });

  it("renders a single swatch row in solid mode", () => {
    const rows = buildFlightLegend(cfg({ mode: "solid" }));
    expect(rows).toHaveLength(1);
    expect(rows[0].slot).toBe("solid");
  });
});

describe("localStorage migration (flightColorFromStored)", () => {
  it("routeColor === null  ⇒  status mode with the default colour pair (was written on every mount, so it's not a deliberate pick)", () => {
    const out = flightColorFromStored({ routeColor: null, flightRouteWidth: 1 });
    expect(out.mode).toBe("status");
    expect(out.colors.past).toEqual(DEFAULT_FLIGHT_COLORS.past);
    expect(out.colors.upcoming).toEqual(DEFAULT_FLIGHT_COLORS.upcoming);
  });

  it("routeColor === <rgb>  ⇒  solid mode with THAT colour", () => {
    const out = flightColorFromStored({ routeColor: [12, 34, 56] });
    expect(out.mode).toBe("solid");
    expect(out.colors.solid).toEqual([12, 34, 56]);
  });

  it("nothing stored  ⇒  status mode with the default pair", () => {
    const out = flightColorFromStored({});
    expect(out.mode).toBe("status");
    expect(out.colors.past).toEqual(rgb(tokens.domainColor.flight));
    expect(out.colors.upcoming).toEqual(rgb(tokens.color.info));
  });

  it("an already-migrated blob wins over the legacy field", () => {
    const out = flightColorFromStored({
      routeColor: null,
      flightColorMode: "solid",
      flightColors: { ...DEFAULT_FLIGHT_COLORS, solid: [1, 2, 3] },
    });
    expect(out.mode).toBe("solid");
    expect(out.colors.solid).toEqual([1, 2, 3]);
  });

  it("falls back to defaults on a corrupt blob instead of throwing", () => {
    const out = flightColorFromStored({
      flightColorMode: "nonsense",
      flightColors: { past: "not-a-colour" },
    });
    expect(out).toEqual(DEFAULT_FLIGHT_COLOR_CONFIG);
    const partial = flightColorFromStored({
      flightColorMode: "status",
      flightColors: { past: [1, 2, 3] },
    });
    expect(partial.colors.past).toEqual([1, 2, 3]);
    expect(partial.colors.upcoming).toEqual(DEFAULT_FLIGHT_COLORS.upcoming);
  });
});
