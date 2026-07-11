import { describe, it, expect } from "vitest";
import { buildRouteData, createRoutesLayers } from "./routesLayer";
import { resolveFlightArcColor } from "../Globe/buildGlobeLayers";
import {
  buildFlightLegend,
  DEFAULT_FLIGHT_COLORS,
  HISTORICAL_ROUTE_COLOR,
  tintForTier,
  washOut,
  type FlightColorConfig,
} from "../../lib/flightColor";
import type { GeoJSONFeature } from "../../types";
import type { Rgb } from "../../lib/cruiseColor";

// The user's picked colours — deliberately nothing like any of the old
// hardcoded constants, so a stale code path can't accidentally pass.
const FLOWN: Rgb = [10, 200, 30];
const PLANNED: Rgb = [200, 20, 180];
const BASE: Rgb = [60, 120, 240];

const colors = {
  ...DEFAULT_FLIGHT_COLORS,
  past: FLOWN,
  upcoming: PLANNED,
  frequency: BASE,
  solid: FLOWN,
};

const statusCfg: FlightColorConfig = { mode: "status", colors };
const frequencyCfg: FlightColorConfig = { mode: "frequency", colors };
const solidCfg: FlightColorConfig = { mode: "solid", colors };

function feat(
  id: string,
  status: string,
  dep: [number, number] = [0, 0],
  arr: [number, number] = [1, 1]
): GeoJSONFeature {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [dep, arr] },
    properties: {
      id,
      status,
      departureTime: "2024-01-01T00:00:00Z",
      departureAirport: { iata: `D${dep.join("")}`, icao: null, name: "D" },
      arrivalAirport: { iata: `A${arr.join("")}`, icao: null, name: "A" },
    },
  } as unknown as GeoJSONFeature;
}

const rgbOf = (c: readonly number[]): Rgb => [c[0], c[1], c[2]];

/** Colour of the (single) arc built for `flights` under `cfg`. */
function arcColor(flights: GeoJSONFeature[], cfg: FlightColorConfig, flightId?: string): Rgb {
  const { arcs } = buildRouteData(flights, 1, cfg);
  const arc = flightId ? arcs.find((a) => a.flightIds.includes(flightId)) : arcs[0];
  if (!arc) throw new Error("no arc built");
  return rgbOf(arc.sourceColor);
}

// A dataset where the FRA-JFK pair is flown 4× (top frequency tier) and three
// other pairs are flown once (bottom tier) — so quantiles actually separate.
function frequentDataset(): GeoJSONFeature[] {
  const hot = Array.from({ length: 4 }, (_, i) => feat(`hot-${i}`, "flown", [0, 0], [1, 1]));
  const cold = [
    feat("cold-1", "flown", [2, 2], [3, 3]),
    feat("cold-2", "flown", [4, 4], [5, 5]),
    feat("cold-3", "flown", [6, 6], [7, 7]),
  ];
  return [...hot, ...cold];
}

describe("flightColorMode — the user's colours reach the arcs", () => {
  // THE REPORTED BUG. The "Alle" view used to force FLIGHT_STATUS_PAST_COLOR
  // via `statusTwoTone`, discarding whatever the user picked. There is no
  // override path left: the config is the only input.
  it("uses the user's flown colour in the Alle view (status mode)", () => {
    expect(arcColor([feat("1", "flown")], statusCfg)).toEqual(FLOWN);
  });

  it("uses the user's planned colour for a never-flown route (status mode)", () => {
    expect(arcColor([feat("1", "scheduled")], statusCfg)).toEqual(PLANNED);
  });

  it("treats a MIXED route (flown + scheduled) as flown in status mode", () => {
    const flights = [feat("a", "flown"), feat("b", "scheduled")];
    expect(arcColor(flights, statusCfg)).toEqual(FLOWN);
  });

  it("colours a historical route with the flown colour in status mode", () => {
    expect(arcColor([feat("1", "historical")], statusCfg)).toEqual(FLOWN);
  });

  it("solid mode paints EVERY route the one colour — flown, planned, historical", () => {
    expect(arcColor([feat("1", "flown")], solidCfg)).toEqual(FLOWN);
    expect(arcColor([feat("2", "scheduled")], solidCfg)).toEqual(FLOWN);
    expect(arcColor([feat("3", "historical")], solidCfg)).toEqual(FLOWN);
  });

  it("frequency mode scales the base colour with how often the route was flown", () => {
    const flights = frequentDataset();
    const hot = arcColor(flights, frequencyCfg, "hot-0");
    const cold = arcColor(flights, frequencyCfg, "cold-1");
    // Both are tints of the SAME base colour…
    expect(hot).toEqual(tintForTier(BASE, 3));
    expect(cold).toEqual(tintForTier(BASE, 0));
    // …and the frequently-flown one is the brighter of the two.
    expect(hot[2]).toBeGreaterThan(cold[2]);
  });

  it("frequency mode renders a planned route as a washed-out tint of the base", () => {
    expect(arcColor([feat("1", "scheduled")], frequencyCfg)).toEqual(washOut(BASE));
  });

  it("frequency mode keeps historical routes grey (the pre-mode behaviour it inherits)", () => {
    expect(arcColor([feat("1", "historical")], frequencyCfg)).toEqual(HISTORICAL_ROUTE_COLOR);
  });

  it("tints the mixed-route arc tips with the user's planned colour", () => {
    const flights = [feat("a", "flown"), feat("b", "scheduled")];
    const layers = createRoutesLayers(
      buildRouteData(flights, 1, statusCfg),
      undefined,
      undefined,
      1,
      [],
      undefined,
      5,
      {},
      statusCfg
    );
    const upcoming = layers.find((l) => l.id === "routes-arc-upcoming");
    const props = upcoming?.props as unknown as { edgeColor: Rgb };
    expect(props.edgeColor).toEqual(PLANNED);
  });
});

describe("the legend cannot diverge from the map", () => {
  // Both sides are driven from the same exported resolver, so we assert they
  // AGREE rather than asserting two hardcoded lists match.
  it("status mode: the two legend swatches equal the two arc colours", () => {
    const rows = buildFlightLegend(statusCfg);
    expect(rows).toHaveLength(2);
    const past = rows.find((r) => r.slot === "past");
    const upcoming = rows.find((r) => r.slot === "upcoming");
    expect(past?.kind === "swatch" && past.color).toEqual(
      arcColor([feat("1", "flown")], statusCfg)
    );
    expect(upcoming?.kind === "swatch" && upcoming.color).toEqual(
      arcColor([feat("2", "scheduled")], statusCfg)
    );
  });

  it("frequency mode: one ramp row whose stops are the arc colours per tier", () => {
    const rows = buildFlightLegend(frequencyCfg);
    expect(rows).toHaveLength(1);
    const ramp = rows[0];
    if (ramp.kind !== "ramp") throw new Error("expected a ramp row");
    const flights = frequentDataset();
    expect(ramp.stops[3]).toEqual(arcColor(flights, frequencyCfg, "hot-0"));
    expect(ramp.stops[0]).toEqual(arcColor(flights, frequencyCfg, "cold-1"));
  });

  it("solid mode: exactly one row, equal to the one arc colour", () => {
    const rows = buildFlightLegend(solidCfg);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.kind === "swatch" && row.color).toEqual(arcColor([feat("1", "flown")], solidCfg));
  });

  it("every legend row's colour tracks a colour change (no stale copy)", () => {
    const repainted: FlightColorConfig = {
      mode: "status",
      colors: { ...colors, past: [1, 2, 3], upcoming: [4, 5, 6] },
    };
    const rows = buildFlightLegend(repainted);
    const past = rows.find((r) => r.slot === "past");
    expect(past?.kind === "swatch" && past.color).toEqual([1, 2, 3]);
    expect(past?.kind === "swatch" && past.color).toEqual(
      arcColor([feat("1", "flown")], repainted)
    );
  });
});

describe("flat map and globe agree on the same route + mode", () => {
  const cases: Array<[string, FlightColorConfig]> = [
    ["status", statusCfg],
    ["frequency", frequencyCfg],
    ["solid", solidCfg],
  ];

  for (const [name, cfg] of cases) {
    it(`${name}: a flown route gets the same colour on both renderers`, () => {
      const flights = frequentDataset();
      const flat = arcColor(flights, cfg, "hot-0");
      // The globe pre-computes a quartile per route; the hottest route is
      // quartile 4 → tier 3, the same band the flat map derives from counts.
      const globe = resolveFlightArcColor({ status: "past", quartile: 4 }, cfg);
      expect(globe).toEqual(flat);
    });

    it(`${name}: a planned route gets the same colour on both renderers`, () => {
      const flat = arcColor([feat("1", "scheduled")], cfg);
      const globe = resolveFlightArcColor({ status: "scheduled", quartile: 1 }, cfg);
      expect(globe).toEqual(flat);
    });
  }
});
