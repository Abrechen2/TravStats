// Issue #183 — flight routes can render FLAT on the map surface (like cruise
// routes) instead of as 3D arcs. The arcs "funnel" into an unreadable knot when
// you zoom into a home airport with many departures.
//
// What these tests pin down:
//   - the default is unchanged ("arc") — nobody's map changes on update
//   - "arc" mode builds exactly today's layer stack (no regression)
//   - "flat" mode builds a surface PATH, not an arc
//   - the SHAPE never changes the COLOUR — every colour mode resolves to the
//     same RGB in both shapes
//   - a mixed route (flown + upcoming) still distinguishes flown from upcoming
//     in flat mode: planned-coloured tips around a flown-coloured core, the
//     flat translation of UpcomingArcLayer's edge→core→edge shader gradient
//   - the setting survives a reload (mapAppearance localStorage blob)

import { describe, it, expect, beforeEach } from "vitest";
import { buildRouteData, createRoutesLayers } from "./routesLayer";
import { buildFlatRoutes, FLAT_ROUTES_LAYER_ID } from "./flatRoutesLayer";
import {
  DEFAULT_FLIGHT_COLORS,
  resolveFlightTipColor,
  tintForTier,
  type FlightColorConfig,
} from "../../lib/flightColor";
import {
  DEFAULT_FLIGHT_ROUTE_SHAPE,
  FLIGHT_ROUTE_SHAPES,
  flightRouteShapeFromStored,
} from "../../lib/flightRouteShape";
import { loadMapAppearance, saveMapAppearance } from "../map/mapAppearance";
import type { GeoJSONFeature } from "../../types";
import type { Rgb } from "../../lib/cruiseColor";

const FLOWN: Rgb = [10, 200, 30];
const PLANNED: Rgb = [200, 20, 180];
const BASE: Rgb = [60, 120, 240];

const colors = {
  ...DEFAULT_FLIGHT_COLORS,
  past: FLOWN,
  upcoming: PLANNED,
  frequency: BASE,
  solid: [7, 7, 7] as Rgb,
};

const statusCfg: FlightColorConfig = { mode: "status", colors };
const frequencyCfg: FlightColorConfig = { mode: "frequency", colors };
const solidCfg: FlightColorConfig = { mode: "solid", colors };

// FRA → JFK: long enough that a great circle visibly departs from the chord.
const FRA: [number, number] = [8.57, 50.03];
const JFK: [number, number] = [-73.78, 40.64];

function feat(
  id: string,
  status: string,
  dep: [number, number] = FRA,
  arr: [number, number] = JFK
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

function layerIds(flights: GeoJSONFeature[], shape: "arc" | "flat"): string[] {
  return createRoutesLayers(
    buildRouteData(flights, 1, statusCfg),
    undefined,
    undefined,
    1,
    [],
    undefined,
    5,
    { routeShape: shape },
    statusCfg
  ).map((l) => l.id);
}

describe("flightRouteShape — the setting itself", () => {
  it("offers exactly the two shapes", () => {
    expect([...FLIGHT_ROUTE_SHAPES]).toEqual(["arc", "flat"]);
  });

  it("defaults to the 3D arc — an existing user's map does not change", () => {
    expect(DEFAULT_FLIGHT_ROUTE_SHAPE).toBe("arc");
    expect(flightRouteShapeFromStored({})).toBe("arc");
  });

  it("falls back to the arc when the stored value is garbage", () => {
    expect(flightRouteShapeFromStored({ flightRouteShape: "spaghetti" })).toBe("arc");
    expect(flightRouteShapeFromStored({ flightRouteShape: 7 })).toBe("arc");
  });

  it("reads back a stored shape", () => {
    expect(flightRouteShapeFromStored({ flightRouteShape: "flat" })).toBe("flat");
  });
});

describe("flightRouteShape — persists across a reload (mapAppearance blob)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("has no shape stored for a fresh user, so the arc default applies", () => {
    expect(loadMapAppearance().flightRouteShape).toBeUndefined();
    expect(flightRouteShapeFromStored(loadMapAppearance() as Record<string, unknown>)).toBe("arc");
  });

  it("survives a reload once the user picks flat", () => {
    saveMapAppearance({ flightRouteShape: "flat" });
    // Simulate a reload: nothing in memory, everything re-read from storage.
    expect(loadMapAppearance().flightRouteShape).toBe("flat");
    expect(flightRouteShapeFromStored(loadMapAppearance() as Record<string, unknown>)).toBe("flat");
  });

  it("does not clobber the rest of the appearance blob", () => {
    saveMapAppearance({ flightRouteWidth: 1.4, styleId: "voyager" });
    saveMapAppearance({ flightRouteShape: "flat" });
    const stored = loadMapAppearance();
    expect(stored.flightRouteShape).toBe("flat");
    expect(stored.flightRouteWidth).toBe(1.4);
    expect(stored.styleId).toBe("voyager");
  });
});

describe("arc mode — the layer stack is unchanged from today", () => {
  const flights = [
    feat("flown", "flown"),
    feat("sched", "scheduled", [11.78, 48.35], [2.55, 49.01]),
  ];

  it("builds the same 7 layers whether the shape is omitted or explicitly arc", () => {
    const implicit = createRoutesLayers(buildRouteData(flights, 1, statusCfg)).map((l) => l.id);
    expect(implicit).toEqual(layerIds(flights, "arc"));
    expect(implicit).toEqual([
      "routes-arc",
      "routes-arc-scheduled",
      "routes-arc-upcoming",
      "routes-ring-inner",
      "routes-ring-outer",
      "routes-dot",
      "routes-labels",
    ]);
  });

  it("never mounts the flat path layer in arc mode", () => {
    expect(layerIds(flights, "arc")).not.toContain(FLAT_ROUTES_LAYER_ID);
  });
});

describe("flat mode — routes render as a surface path, not an arc", () => {
  const flights = [
    feat("flown", "flown"),
    feat("sched", "scheduled", [11.78, 48.35], [2.55, 49.01]),
  ];

  it("swaps the three arc layers for one PathLayer and keeps the airport stack", () => {
    const ids = layerIds(flights, "flat");
    expect(ids).toContain(FLAT_ROUTES_LAYER_ID);
    expect(ids).not.toContain("routes-arc");
    expect(ids).not.toContain("routes-arc-scheduled");
    expect(ids).not.toContain("routes-arc-upcoming");
    // Airport markers + labels are shape-independent — still there.
    expect(ids).toContain("routes-ring-inner");
    expect(ids).toContain("routes-ring-outer");
    expect(ids).toContain("routes-dot");
    expect(ids).toContain("routes-labels");
  });

  it("gives every datum a multi-vertex path (a surface line, not source/target)", () => {
    const routes = buildFlatRoutes(buildRouteData(flights, 1, statusCfg).arcs, statusCfg);
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(r.path.length).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(r.path[0])).toBe(true);
    }
  });

  it("follows the GREAT CIRCLE, not a straight chord (FRA-JFK bows north)", () => {
    const routes = buildFlatRoutes(
      buildRouteData([feat("f", "flown")], 1, statusCfg).arcs,
      statusCfg
    );
    const path = routes[0].path;
    // Straight-chord latitude at the same longitude as the path's midpoint.
    const mid = path[Math.floor(path.length / 2)];
    const f = (mid[0] - FRA[0]) / (JFK[0] - FRA[0]);
    const chordLat = FRA[1] + f * (JFK[1] - FRA[1]);
    // A great circle between two northern-hemisphere airports arcs poleward.
    expect(mid[1]).toBeGreaterThan(chordLat + 1);
    // Endpoints stay exactly on the airports.
    expect(path[0]).toEqual(FRA);
    expect(path[path.length - 1]).toEqual(JFK);
  });
});

describe("the shape must not change the colour — parity across all colour modes", () => {
  const cases: Array<[string, FlightColorConfig]> = [
    ["status", statusCfg],
    ["frequency", frequencyCfg],
    ["solid", solidCfg],
  ];

  for (const [name, cfg] of cases) {
    it(`${name}: a flown route has the same RGBA as an arc and as a flat path`, () => {
      const flights = [feat("f", "flown")];
      const { arcs } = buildRouteData(flights, 1, cfg);
      const flat = buildFlatRoutes(arcs, cfg);
      expect(flat).toHaveLength(1);
      expect(flat[0].color).toEqual(arcs[0].sourceColor);
    });

    it(`${name}: a pure-scheduled route has the same RGBA in both shapes`, () => {
      const flights = [feat("s", "scheduled")];
      const { arcs } = buildRouteData(flights, 1, cfg);
      const flat = buildFlatRoutes(arcs, cfg);
      expect(flat).toHaveLength(1);
      expect(flat[0].color).toEqual(arcs[0].sourceColor);
    });

    it(`${name}: a MIXED route's core has the same RGBA as the arc body`, () => {
      const flights = [feat("a", "flown"), feat("b", "scheduled")];
      const { arcs } = buildRouteData(flights, 1, cfg);
      const flat = buildFlatRoutes(arcs, cfg);
      const core = flat.filter((r) => r.segment === "core");
      expect(core).toHaveLength(1);
      expect(core[0].color).toEqual(arcs[0].sourceColor);
    });

    it(`${name}: a MIXED route's flat tips carry the SAME colour the arc shader paints`, () => {
      const flights = [feat("a", "flown"), feat("b", "scheduled")];
      const { arcs } = buildRouteData(flights, 1, cfg);
      const flat = buildFlatRoutes(arcs, cfg);
      const tips = flat.filter((r) => r.segment === "upcoming");
      expect(tips).toHaveLength(2);
      for (const tip of tips) {
        expect(rgbOf(tip.color)).toEqual(resolveFlightTipColor(cfg));
      }
    });
  }

  it("frequency mode: the flat path tracks the route's own tier, not a fixed tint", () => {
    // 4× on the hot pair, 1× on three cold pairs — the quantiles separate.
    const hot = Array.from({ length: 4 }, (_, i) => feat(`hot-${i}`, "flown", [0, 0], [1, 1]));
    const cold = [
      feat("cold-1", "flown", [2, 2], [3, 3]),
      feat("cold-2", "flown", [4, 4], [5, 5]),
      feat("cold-3", "flown", [6, 6], [7, 7]),
    ];
    const { arcs } = buildRouteData([...hot, ...cold], 1, frequencyCfg);
    const flat = buildFlatRoutes(arcs, frequencyCfg);
    const hotPath = flat.find((r) => r.flightIds.includes("hot-0"));
    const coldPath = flat.find((r) => r.flightIds.includes("cold-1"));
    expect(rgbOf(hotPath!.color)).toEqual(tintForTier(BASE, 3));
    expect(rgbOf(coldPath!.color)).toEqual(tintForTier(BASE, 0));
  });
});

describe("flat mode — a mixed route still shows flown vs upcoming", () => {
  const mixed = [feat("a", "flown"), feat("b", "scheduled")];

  it("splits a mixed route into planned tip → flown core → planned tip", () => {
    const { arcs } = buildRouteData(mixed, 1, statusCfg);
    const flat = buildFlatRoutes(arcs, statusCfg);
    expect(flat.map((r) => r.segment)).toEqual(["upcoming", "core", "upcoming"]);

    const [head, core, tail] = flat;
    // The distinction is VISIBLE: tips are the planned colour, core the flown
    // one, and in status mode those are two different colours.
    expect(rgbOf(core.color)).toEqual(FLOWN);
    expect(rgbOf(head.color)).toEqual(PLANNED);
    expect(rgbOf(tail.color)).toEqual(PLANNED);
    expect(rgbOf(head.color)).not.toEqual(rgbOf(core.color));

    // The three sub-paths tile the route end to end, with no gap: the head
    // starts at the departure airport, the tail ends at the arrival airport,
    // and the shared vertices match exactly.
    expect(head.path[0]).toEqual(FRA);
    expect(tail.path[tail.path.length - 1]).toEqual(JFK);
    expect(head.path[head.path.length - 1]).toEqual(core.path[0]);
    expect(core.path[core.path.length - 1]).toEqual(tail.path[0]);
  });

  it("does NOT split a route that is only flown, or only scheduled", () => {
    const flownOnly = buildFlatRoutes(
      buildRouteData([feat("a", "flown")], 1, statusCfg).arcs,
      statusCfg
    );
    expect(flownOnly.map((r) => r.segment)).toEqual(["core"]);
    const schedOnly = buildFlatRoutes(
      buildRouteData([feat("b", "scheduled")], 1, statusCfg).arcs,
      statusCfg
    );
    expect(schedOnly.map((r) => r.segment)).toEqual(["core"]);
  });

  it("keeps the route's identity on every sub-path so clicks + tooltips still work", () => {
    const { arcs } = buildRouteData(mixed, 1, statusCfg);
    const flat = buildFlatRoutes(arcs, statusCfg);
    for (const r of flat) {
      expect(r.flightIds).toEqual(["a", "b"]);
      expect(r.count).toBe(2);
      // The tooltip tints its "flown Nx" line from sourceColor — every
      // sub-path must report the ROUTE's colour, not the tip's.
      expect(r.sourceColor).toEqual(arcs[0].sourceColor);
      expect(r.departure).toEqual(arcs[0].departure);
    }
  });
});
