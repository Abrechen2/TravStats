import { describe, it, expect } from "vitest";
import type { Feature, Point } from "geojson";
import {
  NATIVE_IDS,
  NativeBuildCache,
  buildNativeGlobe,
  type NativeGlobeInput,
} from "../nativeGlobeLayers";
import {
  DEFAULT_LODGING_COLOR_CONFIG,
  DEFAULT_LODGING_COLORS,
  resolveLodgingColor,
  type LodgingColorConfig,
} from "../../../../lib/lodgingColor";
import {
  DEFAULT_PLACE_COLOR_CONFIG,
  DEFAULT_PLACE_COLORS,
  type PlaceColorConfig,
} from "../../../../lib/placeColor";
import { ALL_ROUTES_VISIBLE } from "../../../../lib/mapRoutes";
import { cssRgba } from "../nativeGeo";
import type { Lodging } from "../../../../types/lodging";
import type { Place } from "../../../../types/place";
import type { CruisePathDatum, PointDatum } from "../../globeLayerTypes";
import { PathLayer } from "@deck.gl/layers";

/**
 * forgejo#331: the globe's ground data is native MapLibre layers, so it sits
 * on the surface. A unit test cannot see a floating dot — the browser look
 * does — but it can hold the things that make one impossible: no altitude in
 * any geometry, no deck.gl layer, and the colours the user chose.
 */

function lodging(id: string, over: Partial<Lodging> = {}): Lodging {
  return { id, name: "Hotel " + id, lat: 50, lon: 8, chainId: null, ...over } as unknown as Lodging;
}
function place(id: string, over: Partial<Place> = {}): Place {
  return { id, name: "Place " + id, lat: 48, lon: 11, visited: true, ...over } as unknown as Place;
}
const airport = (iata: string, lng: number, lat: number): PointDatum => ({
  position: [lng, lat],
  size: 1,
  iata,
  name: iata,
});

function input(over: Partial<NativeGlobeInput> = {}): NativeGlobeInput {
  return {
    nightCells: [],
    showNight: false,
    cruisePaths: [],
    cruiseWidthScale: 1,
    airportPoints: [],
    airportColor: [251, 191, 36],
    airportRadius: 5,
    portPoints: [],
    portColor: [111, 160, 214],
    portRadius: 5,
    lodgings: [],
    lodgingColors: DEFAULT_LODGING_COLOR_CONFIG,
    lodgingRadius: 5,
    places: [],
    placeColors: DEFAULT_PLACE_COLOR_CONFIG,
    placeRadius: 5,
    extraLayers: [],
    routesVisible: ALL_ROUTES_VISIBLE,
    lite: false,
    ...over,
  };
}

const points = (spec: ReturnType<typeof buildNativeGlobe>, id: string) =>
  spec.sources[id].features as Feature<Point, Record<string, unknown>>[];

describe("buildNativeGlobe: nothing floats", () => {
  it("draws only native circle / line / fill layers, and no geometry carries an altitude", () => {
    const spec = buildNativeGlobe(
      input({
        airportPoints: [airport("MUC", 11.78, 48.35)],
        portPoints: [airport("HAM", 9.9, 53.5)],
        lodgings: [lodging("a")],
        places: [place("a")],
        cruisePaths: [
          {
            cruiseId: "c1",
            cruiseLabel: "AIDA",
            status: "completed",
            color: [1, 2, 3],
            path: [
              [8, 50],
              [9, 51],
            ],
          },
        ],
        showNight: true,
        nightCells: [
          {
            polygon: [
              [0, 0],
              [2.5, 0],
              [2.5, 2.5],
              [0, 2.5],
            ],
            shade: 0.5,
          },
        ],
      })
    );
    expect(new Set(spec.layers.map((l) => l.type))).toEqual(new Set(["circle", "line", "fill"]));
    for (const fc of Object.values(spec.sources)) {
      for (const f of fc.features) {
        const g = f.geometry;
        const flat =
          g.type === "Point"
            ? [g.coordinates]
            : g.type === "LineString"
              ? g.coordinates
              : g.type === "Polygon"
                ? g.coordinates.flat()
                : [];
        for (const c of flat) expect(c).toHaveLength(2);
      }
    }
  });

  it("stacks night shade under lines under dots, with places on top", () => {
    const spec = buildNativeGlobe(
      input({
        showNight: true,
        nightCells: [
          {
            polygon: [
              [0, 0],
              [1, 0],
              [1, 1],
            ],
            shade: 1,
          },
        ],
        cruisePaths: [
          {
            cruiseId: "c1",
            cruiseLabel: "x",
            status: "completed",
            color: [1, 2, 3],
            path: [
              [8, 50],
              [9, 51],
            ],
          },
        ],
        airportPoints: [airport("MUC", 11, 48)],
        places: [place("a")],
      })
    );
    expect(spec.layers.map((l) => l.id)).toEqual([
      NATIVE_IDS.night,
      NATIVE_IDS.cruise,
      NATIVE_IDS.airports,
      NATIVE_IDS.places,
    ]);
  });
});

describe("buildNativeGlobe: markers and the user's colours", () => {
  it("draws one lodging pin per lodging that has both coordinates, at its own position", () => {
    const spec = buildNativeGlobe(
      input({
        lodgings: [
          lodging("a"),
          lodging("b"),
          lodging("c", { lat: null }),
          lodging("d", { lon: null }),
        ],
      })
    );
    const f = points(spec, NATIVE_IDS.lodgings);
    expect(f).toHaveLength(2);
    expect(f[0].geometry.coordinates).toEqual([8, 50]);
    expect(spec.targets.get(NATIVE_IDS.lodgings)?.data).toHaveLength(2);
  });

  it("takes a lodging's colour from the user's lodging colour config, not a constant", () => {
    const CHAIN: [number, number, number] = [10, 20, 30];
    const INDEPENDENT: [number, number, number] = [200, 100, 50];
    const colors: LodgingColorConfig = {
      mode: "chain",
      colors: { ...DEFAULT_LODGING_COLORS, chain: CHAIN, independent: INDEPENDENT },
    };
    const spec = buildNativeGlobe(
      input({ lodgings: [lodging("a", { chainId: 7 }), lodging("b")], lodgingColors: colors })
    );
    const f = points(spec, NATIVE_IDS.lodgings);
    expect(f[0].properties.f).toBe(cssRgba([...CHAIN, 230]));
    expect(f[1].properties.f).toBe(cssRgba([...INDEPENDENT, 230]));
    // …and it is the shared resolver doing it, not a copy of the palette.
    expect(f[1].properties.f).toBe(cssRgba([...resolveLodgingColor(lodging("b"), colors), 230]));
  });

  it("repaints when the colour MODE changes, even if the lodging array is the same", () => {
    const lodgings = [lodging("a", { chainId: 7 })];
    const cache = new NativeBuildCache();
    const base = input({ lodgings });
    const solid = buildNativeGlobe(base, cache);
    const chain = buildNativeGlobe(
      { ...base, lodgingColors: { mode: "chain", colors: DEFAULT_LODGING_COLORS } },
      cache
    );
    expect(chain.sources[NATIVE_IDS.lodgings]).not.toBe(solid.sources[NATIVE_IDS.lodgings]);
  });

  it("draws a wishlist place hollow and a visited one filled — shape, not hue", () => {
    const spec = buildNativeGlobe(
      input({
        places: [place("a"), place("b", { visited: false }), place("c", { lat: Number.NaN })],
      })
    );
    const f = points(spec, NATIVE_IDS.places);
    expect(f).toHaveLength(2);
    expect(f[0].properties.f).toBe(cssRgba([...DEFAULT_PLACE_COLORS.solid, 230]));
    expect(f[0].properties.sw).toBe(1);
    // A wishlist entry: no fill at all, the colour moves to the ring.
    expect(f[1].properties.f).toBe("rgba(0,0,0,0)");
    expect(f[1].properties.s).toBe(cssRgba([...DEFAULT_PLACE_COLORS.solid, 235]));
    expect(f[1].properties.sw).toBe(2);
  });

  it("uses the list colour the caller resolved, in list mode", () => {
    const LIST: [number, number, number] = [9, 99, 199];
    const colors: PlaceColorConfig = { mode: "list", colors: DEFAULT_PLACE_COLORS };
    const spec = buildNativeGlobe(
      input({ places: [place("a")], placeColors: colors, placeListColors: new Map([["a", LIST]]) })
    );
    expect(points(spec, NATIVE_IDS.places)[0].properties.f).toBe(cssRgba([...LIST, 230]));
  });

  it("paints airports and ports with the colour and size the user picked", () => {
    const spec = buildNativeGlobe(
      input({
        airportPoints: [airport("MUC", 11, 48)],
        airportColor: [1, 2, 3],
        airportRadius: 7,
        portPoints: [airport("HAM", 9, 53)],
        portColor: [4, 5, 6],
        portRadius: 3,
      })
    );
    const paint = (id: string) =>
      (spec.layers.find((l) => l.id === id) as unknown as { paint: Record<string, unknown> }).paint;
    expect(paint(NATIVE_IDS.airports)["circle-radius"]).toBe(7);
    expect(JSON.stringify(paint(NATIVE_IDS.airports)["circle-color"])).toContain(
      cssRgba([1, 2, 3, 230])
    );
    expect(paint(NATIVE_IDS.ports)["circle-radius"]).toBe(3);
  });

  it("draws no layer for a marker size of 0 — the slider's 'off'", () => {
    const spec = buildNativeGlobe(
      input({ airportPoints: [airport("MUC", 11, 48)], airportRadius: 0 })
    );
    expect(spec.layers).toHaveLength(0);
  });

  it("lite mode drops the hover highlight, normal mode keeps it", () => {
    const withIt = buildNativeGlobe(input({ airportPoints: [airport("MUC", 11, 48)] }));
    const lite = buildNativeGlobe(input({ airportPoints: [airport("MUC", 11, 48)], lite: true }));
    const colorOf = (s: typeof withIt) =>
      JSON.stringify(
        (s.layers[0] as unknown as { paint: Record<string, unknown> }).paint["circle-color"]
      );
    expect(colorOf(withIt)).toContain("feature-state");
    expect(colorOf(lite)).not.toContain("feature-state");
  });
});

describe("buildNativeGlobe: cruise paths", () => {
  const leg = (id: string, path: [number, number][], over: Partial<CruisePathDatum> = {}) =>
    ({
      cruiseId: id,
      cruiseLabel: "Cruise",
      status: "completed" as const,
      color: [1, 2, 3] as [number, number, number],
      path,
      ...over,
    }) as CruisePathDatum;

  it("deduplicates identical legs on the main globe without reducing source journey counts", () => {
    const cruisePaths = Array.from({ length: 10 }, (_, i) =>
      leg(`c${i}`, [
        [8, 50],
        [9, 51],
      ])
    );
    const spec = buildNativeGlobe(input({ cruisePaths }));
    const data = spec.targets.get(NATIVE_IDS.cruise)?.data as {
      count: number;
      memberIds: string[];
    }[];
    expect(data).toHaveLength(1);
    expect(data[0].count).toBe(10);
    expect(data[0].memberIds).toHaveLength(10);
    expect(spec.sources[NATIVE_IDS.cruise].features).toHaveLength(1);
    expect(cruisePaths).toHaveLength(10);
  });

  it("dims a planned (scheduled) cruise against a sailed one, in the same hue", () => {
    const spec = buildNativeGlobe(
      input({
        cruisePaths: [
          leg("a", [
            [8, 50],
            [9, 51],
          ]),
          leg(
            "b",
            [
              [20, 50],
              [21, 51],
            ],
            { status: "scheduled" }
          ),
        ],
      })
    );
    const colors = spec.sources[NATIVE_IDS.cruise].features.map(
      (f) => (f.properties as { c: string }).c
    );
    expect(colors).toEqual(["rgba(1,2,3,0.902)", "rgba(1,2,3,0.588)"]);
  });

  it("splits a leg that crosses the anti-meridian into two features of the same cruise", () => {
    const spec = buildNativeGlobe(
      input({
        cruisePaths: [
          leg("a", [
            [170, 10],
            [-170, 20],
          ]),
        ],
      })
    );
    const features = spec.sources[NATIVE_IDS.cruise].features;
    expect(features).toHaveLength(2);
    expect(features.map((f) => (f.properties as { i: number }).i)).toEqual([0, 0]);
    expect(new Set(features.map((f) => f.id)).size).toBe(2);
  });

  it("scales the line width by the user's cruise width multiplier", () => {
    const spec = buildNativeGlobe(
      input({
        cruiseWidthScale: 2,
        cruisePaths: [
          leg("a", [
            [8, 50],
            [9, 51],
          ]),
        ],
      })
    );
    const width = (spec.layers[0] as unknown as { paint: Record<string, unknown> }).paint[
      "line-width"
    ];
    expect(width).toBe(4);
  });
});

describe("buildNativeGlobe: switches and filters", () => {
  const cruise = [
    {
      cruiseId: "c",
      cruiseLabel: "x",
      status: "completed" as const,
      color: [1, 2, 3] as [number, number, number],
      path: [
        [8, 50],
        [9, 51],
      ] as [number, number][],
    },
  ];

  it("drops the cruise lines — and only them — when the user switched cruise routes off", () => {
    const spec = buildNativeGlobe(
      input({
        cruisePaths: cruise,
        portPoints: [airport("HAM", 9, 53)],
        routesVisible: { ...ALL_ROUTES_VISIBLE, cruise: false },
      })
    );
    expect(spec.layers.map((l) => l.id)).toEqual([NATIVE_IDS.ports]);
  });

  it("drops a caller's rail lines when rail routes are off, keeping its stations", () => {
    const rail = new PathLayer({
      id: "dashboard-rail-paths",
      data: [
        {
          path: [
            [1, 1],
            [2, 2],
          ],
        },
      ],
      getPath: (d: { path: [number, number][] }) => d.path,
      widthUnits: "pixels",
    });
    const on = buildNativeGlobe(input({ extraLayers: [rail] }));
    const off = buildNativeGlobe(
      input({ extraLayers: [rail], routesVisible: { ...ALL_ROUTES_VISIBLE, rail: false } })
    );
    expect(on.layers.map((l) => l.id)).toContain("dashboard-rail-paths");
    expect(off.layers.map((l) => l.id)).not.toContain("dashboard-rail-paths");
    expect(off.remainingExtras).toHaveLength(0);
  });

  it("draws the night shade only while it is switched on", () => {
    const cells = [
      {
        polygon: [
          [0, 0],
          [1, 0],
          [1, 1],
        ] as [number, number][],
        shade: 0.4,
      },
    ];
    expect(buildNativeGlobe(input({ nightCells: cells, showNight: false })).layers).toHaveLength(0);
    const on = buildNativeGlobe(input({ nightCells: cells, showNight: true }));
    expect(on.layers[0]).toMatchObject({ id: NATIVE_IDS.night, type: "fill" });
    // The ring is closed, and the shade rides on the feature.
    const ring = (
      on.sources[NATIVE_IDS.night].features[0].geometry as { coordinates: number[][][] }
    ).coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect((on.sources[NATIVE_IDS.night].features[0].properties as { shade: number }).shade).toBe(
      0.4
    );
  });

  it("lists hit targets dots-first, top-most first, so a pin wins over a line beneath it", () => {
    const spec = buildNativeGlobe(
      input({
        cruisePaths: cruise,
        airportPoints: [airport("MUC", 11, 48)],
        places: [place("a")],
      })
    );
    expect(spec.hitOrder).toEqual([NATIVE_IDS.places, NATIVE_IDS.airports, NATIVE_IDS.cruise]);
  });

  it("keeps an unchanged source's GeoJSON identical across rebuilds, so MapLibre is not re-fed it", () => {
    const cache = new NativeBuildCache();
    const airports = [airport("MUC", 11, 48)];
    const a = buildNativeGlobe(input({ airportPoints: airports }), cache);
    const b = buildNativeGlobe(input({ airportPoints: airports, airportRadius: 9 }), cache);
    expect(b.sources[NATIVE_IDS.airports]).toBe(a.sources[NATIVE_IDS.airports]);
  });
});
