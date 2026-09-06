import { rgb, tokens } from "../../../theme/tokens";
import { describe, it, expect } from "vitest";
import { resolveFlightArcColor, resolveCruisePathColor } from "../buildGlobeLayers";
import {
  DEFAULT_FLIGHT_COLORS,
  DEFAULT_FLIGHT_COLOR_CONFIG,
  tintForTier,
  washOut,
  type FlightColorConfig,
} from "../../../lib/flightColor";
import type { Rgb } from "../../../lib/cruiseColor";

const FLOWN: Rgb = [10, 200, 30];
const PLANNED: Rgb = [200, 20, 180];
const BASE: Rgb = [60, 120, 240];
const colors = { ...DEFAULT_FLIGHT_COLORS, past: FLOWN, upcoming: PLANNED, frequency: BASE };

describe("resolveFlightArcColor", () => {
  it("status mode honours the user's colours (it must NOT force the defaults)", () => {
    const cfg: FlightColorConfig = { mode: "status", colors };
    expect(resolveFlightArcColor({ status: "past", quartile: 2 }, cfg)).toEqual(FLOWN);
    expect(resolveFlightArcColor({ status: "scheduled", quartile: 2 }, cfg)).toEqual(PLANNED);
  });

  it("solid mode paints every arc the one colour", () => {
    const cfg: FlightColorConfig = { mode: "solid", colors: { ...colors, solid: BASE } };
    expect(resolveFlightArcColor({ status: "past", quartile: 1 }, cfg)).toEqual(BASE);
    expect(resolveFlightArcColor({ status: "scheduled", quartile: 4 }, cfg)).toEqual(BASE);
  });

  it("frequency mode scales the base colour with the arc's quartile", () => {
    const cfg: FlightColorConfig = { mode: "frequency", colors };
    expect(resolveFlightArcColor({ status: "past", quartile: 1 }, cfg)).toEqual(
      tintForTier(BASE, 0)
    );
    expect(resolveFlightArcColor({ status: "past", quartile: 4 }, cfg)).toEqual(
      tintForTier(BASE, 3)
    );
    expect(resolveFlightArcColor({ status: "scheduled", quartile: 3 }, cfg)).toEqual(washOut(BASE));
  });

  it("defaults (no user customisation) are the domain colour and info", () => {
    expect(
      resolveFlightArcColor({ status: "past", quartile: 2 }, DEFAULT_FLIGHT_COLOR_CONFIG)
    ).toEqual(rgb(tokens.domainColor.flight));
    expect(
      resolveFlightArcColor({ status: "scheduled", quartile: 2 }, DEFAULT_FLIGHT_COLOR_CONFIG)
    ).toEqual(rgb(tokens.color.info));
  });
});

describe("resolveCruisePathColor", () => {
  const CRUISE_PAST = rgb(tokens.domainColor.cruise);
  const CRUISE_PLANNED = rgb(tokens.color.info);

  it("renders a past cruise at full alpha", () => {
    expect(resolveCruisePathColor({ status: "flown", color: CRUISE_PAST })).toEqual([
      ...CRUISE_PAST,
      230,
    ]);
  });

  it("dims a planned (scheduled) cruise — parity with the flat map", () => {
    expect(resolveCruisePathColor({ status: "scheduled", color: CRUISE_PLANNED })).toEqual([
      ...CRUISE_PLANNED,
      150,
    ]);
  });

  it("keeps a per-cruise hue but still dims it when scheduled", () => {
    const perCruise: [number, number, number] = [232, 131, 116];
    expect(resolveCruisePathColor({ status: "scheduled", color: perCruise })).toEqual([
      232, 131, 116, 150,
    ]);
  });
});
