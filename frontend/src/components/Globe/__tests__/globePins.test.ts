import { describe, it, expect, vi } from "vitest";
import { buildGlobeLayers, type BuildGlobeLayersOptions } from "../buildGlobeLayers";
import { EarthOcclusionExtension } from "../EarthOcclusionExtension";
import { lodgingLabelPoints, placeLabelPoints } from "../globePinLabels";
import {
  DEFAULT_LODGING_COLOR_CONFIG,
  DEFAULT_LODGING_COLORS,
  resolveLodgingColor,
  type LodgingColorConfig,
} from "../../../lib/lodgingColor";
import {
  DEFAULT_PLACE_COLOR_CONFIG,
  DEFAULT_PLACE_COLORS,
  type PlaceColorConfig,
} from "../../../lib/placeColor";
import { rgbCss } from "../../../lib/flightColor";
import type { Lodging } from "../../../types/lodging";
import type { Place } from "../../../types/place";
import type { Layer } from "@deck.gl/core";

/**
 * The globe drew no hotel and no place at all until 2026-09-20 — measured as
 * an empty sphere on /dashboard/lodging?mode=globe with 31 lodgings in the
 * sidebar beside it. These cases hold the two properties that made the fix
 * worth doing rather than just doing: the pins are THERE, and their colour is
 * the user's own, read from the same config the flat map and the legend read.
 */

function lodging(id: string, over: Partial<Lodging> = {}): Lodging {
  return {
    id,
    name: "Hotel " + id,
    type: "hotel",
    lat: 50,
    lon: 8,
    city: "Frankfurt",
    country: "DE",
    stayCount: 2,
    nights: 5,
    chainId: null,
    overallRating: null,
    ...over,
  } as unknown as Lodging;
}

function place(id: string, over: Partial<Place> = {}): Place {
  return {
    id,
    name: "Place " + id,
    category: "nature",
    lat: 48,
    lon: 11,
    city: "München",
    country: "DE",
    visited: true,
    visitCount: 3,
    ...over,
  } as unknown as Place;
}

function layersFor(over: Partial<BuildGlobeLayersOptions> = {}): Layer[] {
  const opts: BuildGlobeLayersOptions = {
    arcsData: [],
    antipodalArcs: [],
    cruisePaths: [],
    airportPoints: [],
    portPoints: [],
    headFlightArc: null,
    activeQuartile: null,
    lite: false,
    occlusionExt: new EarthOcclusionExtension(),
    occlusionProps: { earthOcclusionEnabled: true, earthOcclusionFadeBand: 0.04 },
    onArcHover: vi.fn(),
    onAirportHover: vi.fn(),
    onPortHover: vi.fn(),
    onCruisePathHover: vi.fn(),
    setPinned: vi.fn(),
    flightColorConfig: {
      mode: "status",
      colors: { past: [1, 2, 3] },
    } as unknown as BuildGlobeLayersOptions["flightColorConfig"],
    arcWidthScale: 1,
    cruiseArcWidthScale: 1,
    airportColor: [1, 1, 1],
    portColor: [2, 2, 2],
    airportRadius: 5,
    portRadius: 5,
    lodgings: [],
    lodgingColors: DEFAULT_LODGING_COLOR_CONFIG,
    lodgingRadius: 5,
    places: [],
    placeColors: DEFAULT_PLACE_COLOR_CONFIG,
    placeRadius: 5,
    onPinHover: vi.fn(),
    nightCells: [],
    showNight: false,
    ...over,
  };
  return buildGlobeLayers(opts);
}

function layer(layers: Layer[], id: string): Layer {
  const found = layers.find((l) => l.id === id);
  if (!found) throw new Error("no layer " + id);
  return found;
}

// deck.gl types the accessor bag loosely at the Layer boundary, and the
// accessors are exactly what this file is about — so read them through one
// narrow helper rather than casting at every call site.
function props(l: Layer): Record<string, unknown> {
  return l.props as unknown as Record<string, unknown>;
}

describe("buildGlobeLayers: lodging pins", () => {
  it("draws one pin per lodging that has both coordinates", () => {
    const layers = layersFor({
      lodgings: [
        lodging("a"),
        lodging("b"),
        lodging("c", { lat: null }),
        lodging("d", { lon: null }),
      ],
    });
    expect((props(layer(layers, "globe-lodging-pins")).data as Lodging[]).map((l) => l.id)).toEqual(
      ["a", "b"]
    );
  });

  it("lifts the pins off the sphere and occludes the far side, like the airport dots", () => {
    const p = props(layer(layersFor({ lodgings: [lodging("a")] }), "globe-lodging-pins"));
    const getPosition = p.getPosition as (d: Lodging) => [number, number, number];
    const [lng, lat, alt] = getPosition(lodging("a"));
    expect([lng, lat]).toEqual([8, 50]);
    // MARKER_ALTITUDE_M — above the 5 km cruise-path altitude, so a sea route
    // crossing a coastal hotel cannot draw over it.
    expect(alt).toBe(8_000);
    expect((p.extensions as unknown[]).some((e) => e instanceof EarthOcclusionExtension)).toBe(
      true
    );
    expect(p.earthOcclusionEnabled).toBe(true);
    expect(p.radiusUnits).toBe("pixels");
    expect(p.getRadius).toBe(5);
  });

  it("takes its colour from the user's lodging colour config, not a constant", () => {
    const CHAIN: [number, number, number] = [10, 20, 30];
    const INDEPENDENT: [number, number, number] = [200, 100, 50];
    const colors: LodgingColorConfig = {
      mode: "chain",
      colors: { ...DEFAULT_LODGING_COLORS, chain: CHAIN, independent: INDEPENDENT },
    };
    const p = props(
      layer(
        layersFor({
          lodgings: [lodging("a", { chainId: 7 }), lodging("b")],
          lodgingColors: colors,
        }),
        "globe-lodging-pins"
      )
    );
    const getFillColor = p.getFillColor as (d: Lodging) => number[];
    expect(getFillColor(lodging("a", { chainId: 7 }))).toEqual([...CHAIN, 230]);
    expect(getFillColor(lodging("b"))).toEqual([...INDEPENDENT, 230]);
    // …and it is the shared resolver doing it, not a copy of the palette.
    expect(getFillColor(lodging("b")).slice(0, 3)).toEqual(
      resolveLodgingColor(lodging("b"), colors)
    );
  });
});

describe("buildGlobeLayers: place pins", () => {
  it("draws one pin per place and skips a NaN coordinate", () => {
    const layers = layersFor({
      places: [place("a"), place("b"), place("c", { lat: Number.NaN })],
    });
    expect((props(layer(layers, "globe-place-pins")).data as Place[]).map((p) => p.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("draws a wishlist place hollow and a visited one filled — shape, not hue", () => {
    const p = props(
      layer(layersFor({ places: [place("a"), place("b", { visited: false })] }), "globe-place-pins")
    );
    const fill = p.getFillColor as (d: Place) => number[];
    const line = p.getLineColor as (d: Place) => number[];
    const width = p.getLineWidth as (d: Place) => number;
    expect(fill(place("a"))).toEqual([...DEFAULT_PLACE_COLORS.solid, 230]);
    // A wishlist entry: no fill at all, the colour moves to the ring.
    expect(fill(place("b", { visited: false }))).toEqual([0, 0, 0, 0]);
    expect(line(place("b", { visited: false }))).toEqual([...DEFAULT_PLACE_COLORS.solid, 235]);
    expect(width(place("b", { visited: false }))).toBe(2);
    expect(width(place("a"))).toBe(1);
  });

  it("uses the list colour the caller resolved, in list mode", () => {
    const LIST: [number, number, number] = [9, 99, 199];
    const colors: PlaceColorConfig = { mode: "list", colors: DEFAULT_PLACE_COLORS };
    const p = props(
      layer(
        layersFor({
          places: [place("a")],
          placeColors: colors,
          placeListColors: new Map([["a", LIST]]),
        }),
        "globe-place-pins"
      )
    );
    expect((p.getFillColor as (d: Place) => number[])(place("a"))).toEqual([...LIST, 230]);
  });
});

describe("globePinLabels", () => {
  it("gives every drawable lodging a pill weighted by its stays", () => {
    const pills = lodgingLabelPoints(
      [lodging("a", { stayCount: 4 }), lodging("b", { lat: null })],
      DEFAULT_LODGING_COLOR_CONFIG
    );
    expect(pills).toHaveLength(1);
    expect(pills[0]).toMatchObject({ kind: "lodging", id: "a", weight: 4, lng: 8, lat: 50 });
    expect(pills[0].color).toBe(rgbCss(DEFAULT_LODGING_COLORS.solid));
  });

  it("truncates a long hotel name on the same budget the flat label uses", () => {
    const pills = lodgingLabelPoints(
      [lodging("a", { name: "Kempinski Hotel Bristol Berlin" })],
      DEFAULT_LODGING_COLOR_CONFIG
    );
    expect(pills[0].text).toBe("Kempinski Hotel Bri…");
  });

  it("renders a list's SYMBOL where the flat map can only render the name", () => {
    // deck.gl's font atlas cannot produce colour emoji (placePinsLayer.ts
    // records the black-box measurement); a DOM pill can, so the globe
    // honours the list's icon directly.
    const pills = placeLabelPoints(
      [place("a")],
      DEFAULT_PLACE_COLOR_CONFIG,
      undefined,
      new Map([["a", { labelMode: "icon", icon: "🌳" }]]),
      "list"
    );
    expect(pills[0].text).toBe("🌳");
  });

  it("falls back to the name when the map-wide override says names", () => {
    const pills = placeLabelPoints(
      [place("a")],
      DEFAULT_PLACE_COLOR_CONFIG,
      undefined,
      new Map([["a", { labelMode: "icon", icon: "🌳" }]]),
      "name"
    );
    expect(pills[0].text).toBe("Place a");
  });
});
